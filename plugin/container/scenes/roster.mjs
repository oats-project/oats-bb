// The roster's live scenes: the sidebar's tree, an agent's thread with its header row, the states
// of the dot, and the sidebar while OATS cannot be read. (container/live-ui.mjs says what a scene is.)
import { readFileSync } from "node:fs";
import { hostname } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { gapsIn, loose, MAX_GAP, openParents, showSidebar, testId, textOf, texts, tight, visible, textsNamed, tmuxMarks } from "../browser.mjs";
import { PILOT_ROSTER, TMUX_ROSTER } from "../tmux-roster.mjs";
import { click, closed, dialog, phaseIs, saysNow } from "./lifecycle.mjs";

// The machine's name, as the checks' container was given it (ci.sh: MACHINE_NAME, the container's
// host name, by which bb names its machine). A container started another way has no name set: the
// host's own is then what bb shows, and the check says so if it is an id.
const MACHINE = process.env.MACHINE_NAME || hostname();

/** The thread's own row, read once it says `state`: → `{ line, act }` (the status line's words, and its button's), or null. The read waits on the row. */
const statusOf = async (page, state, want = null) => {
  const line = testId("oats-status-line");
  // The line's words as a person reads them: the state's word, then each part with the separator
  // before it; and its act (Start, Restart, Retry) apart. The way to the panel is not the line's words.
  // `want` (a RegExp) is what the line is waited for: a part that arrives after the state is
  // waited on, not read at once. When the wait runs out the line is read as it is, for the failing
  // check to print.
  const read = (wanted) =>
    `(() => { const e = document.querySelector(${JSON.stringify(`${testId("oats-identity-row")} ${line}`)}); if (!e || e.getAttribute("data-state") !== ${JSON.stringify(state)}) return ""; const flat = (x) => x.innerText.replace(/\\s+/g, " ").trim(); const words = [flat(e.querySelector(${JSON.stringify(testId("oats-state"))})), ...[...e.querySelectorAll(${JSON.stringify(testId("oats-status-part"))})].map(flat)].join(" "); if (${wanted === null ? "false" : `!new RegExp(${JSON.stringify(wanted.source)}).test(words)`}) return ""; return JSON.stringify({ line: words, act: e.querySelector(${JSON.stringify(testId("oats-status-act"))})?.innerText.trim() ?? null, panel: e.querySelector(${JSON.stringify(testId("oats-open-panel"))})?.innerText.trim() ?? null }); })()`;
  const found = (await page.until(read(want), 30)) ?? (want === null ? undefined : await page.evaluate(read(null)));
  return found ? JSON.parse(found) : null;
};
/** What the page shows of the thread's row when a read of it found nothing: for a failing check's line. */
/**
 * Every roster row of the sidebar measured: a row is at most three lines (the name on one or two,
 * cut only after the second; the second block on ONE line: the state's word, the soul, a reason where there is one, "tmux"). Counts
 * only, never a name: `{ rows, over, wrapped, nameCut, soulCut, soulGone, whereCut, edgeCut, untitled, misordered, reasonCut, reasonLeft }`
 * (`misordered`: a line whose parts are not STATE · SOUL · REASON · where in that order, or that gave way out of order: a soul
 * shortened while a reason that does not warn is still on the line, or a reason that warns shortened, or a state's word that
 * is not its title's (but "Lost" on the row of a session whose title says "Stopped · … · session lost"); `reasonCut`: a reason
 * shortened with "…", `reasonLeft`: one that left its row: both may be)
 * (`soulCut`: a soul cut with "…", which it may be; `soulGone`: a soul squeezed to nothing, which it never is; `whereCut`: the last phrase cut; `edgeCut`: something past the
 * row's edge, or the state's word cut; `untitled`: a name with no title holding it whole).
 */
/**
 * The roster's tree as it is drawn, top to bottom: each visible row of an agent, by its instance
 * (a thread-less row) or its bb thread's id, with how far in it is (0, 1 or 2: the row's indent).
 */
const treeRows = (page) =>
  page.evaluate(
    `JSON.stringify([...document.querySelectorAll(${JSON.stringify(`${testId("oats-sidebar")} ${testId("oats-tree")} ${testId("oats-agent-row")}, ${testId("oats-sidebar")} ${testId("oats-tree")} ${testId("oats-agent-row-threadless")}`)})].filter((row) => row.getClientRects().length > 0).map((row) => { const left = parseFloat(getComputedStyle(row).paddingLeft); return { who: row.getAttribute("data-instance") ?? row.getAttribute("data-sidebar-thread-id"), left }; }))`,
  );
/** The roster's fold, as drawn: how many parents show a chevron, how many of them are closed, and which closed ones carry the mark of a row they hide (by instance or thread id, with that mark's state). */
const folds = (page) =>
  page.evaluate(
    `JSON.stringify((() => { const tree = document.querySelector(${JSON.stringify(`${testId("oats-sidebar")} ${testId("oats-tree")}`)}); const toggles = [...(tree?.querySelectorAll(${JSON.stringify(testId("oats-row-toggle"))}) ?? [])]; const inside = [...(tree?.querySelectorAll(${JSON.stringify(testId("oats-row-inside"))}) ?? [])].map((mark) => { const row = mark.closest(${JSON.stringify(`${testId("oats-agent-row")}, ${testId("oats-agent-row-threadless")}`)}); return [row?.getAttribute("data-instance") ?? row?.getAttribute("data-sidebar-thread-id") ?? null, mark.querySelector("[data-mark]")?.getAttribute("data-state") ?? null]; }); return { parents: toggles.length, closed: toggles.filter((toggle) => toggle.getAttribute("aria-expanded") === "false").length, inside }; })())`,
  );
/** Presses one parent's chevron (by its agent's instance). */
const toggleOf = (instance) => `document.querySelector(${JSON.stringify(`${testId("oats-sidebar")} ${testId("oats-tree")} ${testId("oats-row-toggle")}[data-instance="${instance}"]`)})?.click()`;
/** `treeRows` with each row's depth: the indents drawn, smallest first, are depth 0, 1, 2. */
const depths = (rows) => {
  const lefts = [...new Set(rows.map((row) => row.left))].sort((a, b) => a - b);
  return rows.map((row) => ({ who: row.who, depth: lefts.indexOf(row.left) }));
};
/**
 * What is wrong in a drawn tree, against who is whose parent (`parentOf`: by instance; only the
 * agents it names are looked at): a child that is not drawn one step in from its parent, or not
 * in its parent's own block of rows (the rows after the parent that are further in than it).
 */
const misplaced = (drawn, parentOf, cap = 2) => {
  const at = new Map(drawn.map((row, index) => [row.who, index]));
  const off = [];
  for (const [child, parent] of Object.entries(parentOf)) {
    const c = at.get(child);
    const p = at.get(parent);
    if (c === undefined || p === undefined) {
      off.push(`${child}: ${c === undefined ? "not drawn" : `its parent ${parent} is not drawn`}`);
      continue;
    }
    const wanted = Math.min(drawn[p].depth + 1, cap);
    if (drawn[c].depth !== wanted) off.push(`${child}: at depth ${drawn[c].depth}, not ${wanted}`);
    if (c < p || drawn.slice(p + 1, c).some((row) => row.depth <= drawn[p].depth)) off.push(`${child}: not in the rows under ${parent}`);
  }
  return off;
};

const rowLines = (page) =>
  page.evaluate(
    `(() => { const s = document.querySelector(${JSON.stringify(testId("oats-sidebar"))}); const rows = [...s.querySelectorAll(${JSON.stringify(`${testId("oats-agent-row")}, ${testId("oats-agent-row-threadless")}`)})].filter((r) => r.getClientRects().length > 0); const linesOf = (e) => Math.round(e.getBoundingClientRect().height / parseFloat(getComputedStyle(e).lineHeight)); const cutOf = (e) => e.scrollWidth > e.clientWidth + 1; let over = 0, wrapped = 0, nameCut = 0, soulCut = 0, soulGone = 0, whereCut = 0, edgeCut = 0, untitled = 0, misordered = 0, reasonCut = 0, reasonLeft = 0; for (const row of rows) { const name = row.querySelector(${JSON.stringify(testId("oats-row-name"))}); const facts = row.querySelector(${JSON.stringify(testId("oats-row-facts"))}); const n = linesOf(name), f = linesOf(facts); if (n + f > 3 || n > 2) over += 1; if (f !== 1) wrapped += 1; if (name.scrollHeight > name.clientHeight + 1) nameCut += 1; if (!name.getAttribute("title")) untitled += 1; const soul = facts.querySelector('[data-phrase="soul"]'); if (soul && cutOf(soul)) soulCut += 1; if (soul && soul.getBoundingClientRect().width < 8) soulGone += 1; const reason = facts.querySelector('[data-phrase="reason"]'); if (reason && cutOf(reason)) reasonCut += 1; if (facts.getAttribute("data-reason") === "left") reasonLeft += 1; if (!/^state,soul(,reason)?(,where)?$/.test([...facts.querySelectorAll("[data-phrase]")].map((p) => p.getAttribute("data-phrase")).join(",")) || (soul && cutOf(soul) && reason && reason.getAttribute("data-tone") !== "warning") || (reason && reason.getAttribute("data-tone") === "warning" && cutOf(reason)) || !((facts.getAttribute("title") ?? "").startsWith(facts.querySelector('[data-phrase="state"]').innerText.trim() + " · ") || (facts.querySelector('[data-phrase="state"]').innerText.trim() === "Lost" && !reason && /^Stopped · .* · session lost( · tmux)?$/.test(facts.getAttribute("title") ?? "")))) misordered += 1; if ([...facts.querySelectorAll('[data-phrase="where"]')].some(cutOf)) whereCut += 1; const right = facts.getBoundingClientRect().right; if ([...facts.querySelectorAll("[data-phrase], [data-sep]")].some((p) => p.getBoundingClientRect().right > right + 1) || cutOf(facts.querySelector('[data-phrase="state"]'))) edgeCut += 1; } return JSON.stringify({ rows: rows.length, over, wrapped, nameCut, soulCut, soulGone, whereCut, edgeCut, untitled, misordered, reasonCut, reasonLeft }); })()`,
  );
const rowText = (page) => page.evaluate(textOf(testId("oats-identity-row")));

export default [
  {
    stage: "fixtures",
    name: "the sidebar, an agent's thread, a thread that is no agent",
    run: async ({ page, at, viewport, threads, fixtureThreads, check, sleep }) => {
      // the sidebar with the tree, as the page loads it: every parent closed (the fold)
      await page.goto("/");
      check(await showSidebar(page, viewport, { fold: "asLoaded" }), `${at} the thread list is the OATS sidebar`);
      await page.until(visible(testId("oats-tree")), 30);
      {
        const LEAD = threads.get("thr_redesign").id; // redesign-ui-lead: the one parent, of desktop-mockups-developer and harvest-knowledge-helper
        const KIDS = [threads.get("thr_mockups").id, threads.get("thr_harvest").id];
        const lead = `${testId("oats-sidebar")} ${testId("oats-agent-row")}[data-sidebar-thread-id="${LEAD}"]`;
        const toggle = `${testId("oats-sidebar")} ${testId("oats-row-toggle")}`;
        const fold = `JSON.stringify({ rows: [...document.querySelectorAll(${JSON.stringify(`${testId("oats-sidebar")} ${testId("oats-agent-row")}`)})].map((e) => e.getAttribute("data-sidebar-thread-id")), toggles: [...document.querySelectorAll(${JSON.stringify(toggle)})].map((b) => [b.tagName, b.getAttribute("data-instance"), b.getAttribute("aria-expanded"), b.getAttribute("aria-label"), b.innerText.trim()]) })`;
        const closedNow = { toggles: [["BUTTON", "redesign-ui-lead", "false", "Show Redesign ui lead's agents", "▸"]] };
        const openNow = { toggles: [["BUTTON", "redesign-ui-lead", "true", "Hide Redesign ui lead's agents", "▾"]] }; // (open: the mark that points down; closed: right)
        const is = (read, want, kids) => JSON.stringify(read.toggles) === JSON.stringify(want.toggles) && read.rows.length === (kids ? 7 : 5) && KIDS.every((id) => read.rows.includes(id) === kids);
        const loaded = JSON.parse(await page.evaluate(fold));
        check(is(loaded, closedNow, false), `${at} on load every parent is closed: the five roots on bb are rows, the lead's two children are not, and the lead has ONE chevron, a button that says "Show Redesign ui lead's agents" (no count)`, JSON.stringify(loaded));
        // The chevron is before the row's mark, inside the row, not over it; and it is not part of the row's link.
        const placed = await page.evaluate(`(() => { const b = document.querySelector(${JSON.stringify(toggle)}).getBoundingClientRect(); const row = document.querySelector(${JSON.stringify(lead)}); const r = row.getBoundingClientRect(); const m = row.querySelector("[data-mark]").getBoundingClientRect(); return JSON.stringify({ inRow: b.left >= r.left - 1 && b.top >= r.top - 1 && b.bottom <= r.bottom + 1, beforeMark: b.right <= m.left + 1, high: Math.round(b.height) >= ${viewport.mobile ? 44 : 32}, wide: Math.round(b.width) >= 24, apart: !row.contains(document.querySelector(${JSON.stringify(toggle)})) }); })()`);
        check(placed === JSON.stringify({ inRow: true, beforeMark: true, high: true, wide: true, apart: true }), `${at} the chevron stands in the row, before its mark, as high as a control (${viewport.mobile ? 44 : 32} px) and 24 px wide, and is no part of the row's link`, placed);
        // Every row's mark stands in one column: the gutter is every row's.
        const column = await page.evaluate(`JSON.stringify([...new Set([...document.querySelectorAll(${JSON.stringify(`${testId("oats-tree")} > li > [data-testid], ${testId("oats-tree")} > li a[data-testid]`)})].filter((row) => row.matches(${JSON.stringify(`${testId("oats-agent-row")}, ${testId("oats-agent-row-threadless")}`)})).map((row) => Math.round(row.querySelector("[data-mark]").getBoundingClientRect().left)))])`);
        check(JSON.parse(column).length === 1, `${at} every root's mark starts in one column, the parent's among them`, column);
        // The image of the sidebar as a fresh install shows it: the tree closed.
        await page.shot(`a13-${viewport.name}-sidebar`, { targets: true });
        // The keys, on the row: Right opens, Left closes.
        // (The key goes to the element that has the focus: the row is focused, the focus is read back, and the key is
        // pressed once more if the first did not land, as a person does.)
        const keyOn = async (key, rows) => {
          for (let tries = 0; tries < 2; tries += 1) {
            await page.until(`(() => { const row = document.querySelector(${JSON.stringify(lead)}); row.focus(); return document.activeElement === row ? "1" : ""; })()`, 5);
            await page.press(key);
            const read = await page.until(`(() => { const now = ${fold}; return JSON.parse(now).rows.length === ${rows} ? now : ""; })()`, 5);
            if (read) return read;
          }
          return page.evaluate(fold);
        };
        const byKey = await keyOn("ArrowRight", 7);
        check(is(JSON.parse(byKey), openNow, true), `${at} Right on the lead's row opens it: its two children are rows, and the chevron says "Hide Redesign ui lead's agents"`, byKey);
        const closedByKey = await keyOn("ArrowLeft", 5);
        check(is(JSON.parse(closedByKey), closedNow, false), `${at} Left closes it again`, closedByKey);
        // The chevron by the keyboard: it takes the focus, and Enter presses it.
        const focused = await page.evaluate(`(() => { const b = document.querySelector(${JSON.stringify(toggle)}); b.focus(); return document.activeElement === b && b.tabIndex === 0; })()`);
        await page.press("Enter");
        const byEnter = (await page.until(`(() => { const now = ${fold}; return JSON.parse(now).rows.length === 7 ? now : ""; })()`, 10)) || (await page.evaluate(fold));
        check(focused === true && is(JSON.parse(byEnter), openNow, true), `${at} the chevron takes the keyboard's focus, and Enter on it opens the lead`, `${focused} ${byEnter}`);
        // The mark as drawn, open: it points down (its own glyph, never the closed one turned), in a box of 16 px at every width.
        const MARK = `(() => { const m = document.querySelector(${JSON.stringify(`${toggle} ${testId("oats-row-toggle-mark")}`)}); const r = m.getBoundingClientRect(); const b = m.parentElement.getBoundingClientRect(); return JSON.stringify({ glyph: m.innerText.trim(), turned: getComputedStyle(m).transform !== "none" || getComputedStyle(m.parentElement).transform !== "none", box: [Math.round(r.width), Math.round(r.height)], centred: Math.abs((r.left + r.width / 2) - (b.left + b.width / 2)) <= 1 && Math.abs((r.top + r.height / 2) - (b.top + b.height / 2)) <= 1 }); })()`;
        const openMark = await page.evaluate(MARK);
        check(openMark === JSON.stringify({ glyph: "▾", turned: false, box: [16, 16], centred: true }), `${at} the open parent's mark points DOWN: its own glyph, not turned, in a 16 px box centred in the button`, openMark);
        await page.evaluate(`document.querySelector(${JSON.stringify(toggle)}).click()`);
        await page.until(`document.querySelector(${JSON.stringify(toggle)})?.getAttribute("aria-expanded") === "false" ? "1" : ""`, 10);
        const closedMark = await page.evaluate(MARK);
        check(closedMark === JSON.stringify({ glyph: "▸", turned: false, box: [16, 16], centred: true }), `${at} the closed parent's mark points RIGHT, in the same box`, closedMark);
        await page.evaluate(`document.querySelector(${JSON.stringify(toggle)}).click()`);
        await page.until(`document.querySelector(${JSON.stringify(toggle)})?.getAttribute("aria-expanded") === "true" ? "1" : ""`, 10);
        const where = await page.evaluate(`location.pathname`);
        check(where === "/", `${at} opening and closing a parent opens no thread`, where);
        await page.shot(`a13-${viewport.name}-sidebar-opened`, { targets: true });
      }
      const rows = await page.evaluate(`[...document.querySelectorAll(${JSON.stringify(testId("oats-agent-row"))})].map((e) => e.getAttribute("data-sidebar-thread-id"))`);
      const expected = fixtureThreads.filter((thread) => thread.id !== "thr_plain").map((thread) => threads.get(thread.id).id);
      check(rows.length === 7 && expected.every((id) => rows.includes(id)), `${at} the tree draws the 7 bb agents, joined by bb's own thread ids`, JSON.stringify(rows));
      const child = `${testId("oats-agent-row")}[data-sidebar-thread-id="${threads.get("thr_mockups").id}"]`;
      check(await page.evaluate(`document.querySelector(${JSON.stringify(child)})?.className.split(/\\s+/).includes("pl-10") === true && document.querySelector(${JSON.stringify(`${testId("oats-agent-row")}[data-sidebar-thread-id="${threads.get("thr_redesign").id}"]`)})?.className.split(/\\s+/).includes("pl-6") === true`), `${at} a child is indented one step under its parent (the roster's gutter for the chevron is every row's)`);
      // The machine is shown by the name bb gives it, which is the host's own (G1): a name, never an id.
      check(!/^[0-9a-f]{12}$/.test(MACHINE), `${at} the machine the checks run on has a name (${MACHINE}), not a container's id: start the container through ci.sh, or with --hostname and MACHINE_NAME`);
      // The workspace's name alone heads the roster: no machine, no count, and no heading "Agents" under it.
      check((await page.evaluate(textOf(testId("oats-workspace-line")))) === "oats", `${at} the workspace's name alone heads the roster: no machine and no count`, await page.evaluate(textOf(testId("oats-workspace-line"))));
      const headings = await page.evaluate(`JSON.stringify([...document.querySelectorAll(${JSON.stringify(`${testId("oats-sidebar")} h2`)})].map((e) => e.innerText.trim().toLowerCase()))`);
      check(headings === JSON.stringify(["workspace", "other threads"]), `${at} the sidebar's headings are "Workspace" and "Other threads": none names the roster`, headings);
      const waits = await page.evaluate(`JSON.stringify({ marked: document.querySelectorAll(${JSON.stringify(`${testId("oats-sidebar")} ${testId("oats-tree")} [data-mark][data-state="needs-you"]`)}).length, foot: !(document.querySelector(${JSON.stringify(`${testId("oats-sidebar")} ${testId("oats-needs-line")}`)}) === null) })`);
      check(waits === JSON.stringify({ marked: 3, foot: false }), `${at} three rows carry the mark of an agent that waits, and no line at the roster's foot counts them`, waits);
      // What the image's name says: every agent a row, each with its state in a word and its soul; the
      // one that runs in tmux among them; the roster first, then New agent, the pages.
      const drawn = JSON.parse(await page.evaluate(`JSON.stringify({ facts: [...document.querySelectorAll(${JSON.stringify(`${testId("oats-tree")} ${testId("oats-row-facts")}`)})].map((e) => e.getAttribute("title")), order: [...document.querySelectorAll(${JSON.stringify(["oats-tree", "oats-needs-line", "oats-new-agent", "oats-pages"].map(testId).join(", "))})].map((e) => e.getAttribute("data-testid")), marks: document.querySelectorAll(${JSON.stringify(`${testId("oats-tree")} [data-mark]`)}).length })`));
      const WORDS = /^(Needs you|Working|Idle|Stopped|Failed|Unreachable) · [a-z][a-z0-9.\/-]*( · tmux)?$/;
      check(
        drawn.facts.length === 8 && drawn.marks === 8 && drawn.facts.every((line) => WORDS.test(line)) && drawn.facts.includes("Working · oats-developer · tmux") && drawn.facts.includes("Needs you · oats-maintainer") && JSON.stringify(drawn.order) === JSON.stringify(["oats-tree", "oats-new-agent", "oats-pages"]),
        `${at} eight agents, eight rows: each its mark, its state in a word and its soul; the one in tmux says "tmux"; then New agent and the pages`,
        JSON.stringify(drawn),
      );
      // "tmux" on the row is bb's own terminal glyph, named "tmux" (the plugin draws no icon of its own): the
      // app looked, where it first drew it, that bb's set holds the glyph (else it would draw the word).
      const tmuxMark = await page.evaluate(tmuxMarks);
      check(tmuxMark === JSON.stringify({ marks: 1, glyphs: 1, named: 1, drawn: 1 }), `${at} "tmux" on the row of the agent on tmux is bb's terminal glyph, named "tmux" for a screen reader, with no word beside it`, tmuxMark);
      // No row's second line is cut: each is as wide as its text needs, on as many lines as it takes.
      const cut = await page.evaluate(`[...document.querySelectorAll(${JSON.stringify(`${testId("oats-tree")} ${testId("oats-row-facts")}`)})].filter((e) => e.scrollWidth > e.clientWidth + 1).map((e) => e.innerText)`);
      check(cut.length === 0, `${at} no row's second line is cut`, JSON.stringify(cut));
      const others = await page.evaluate(texts(testId("oats-other-row")));
      check(others.some((text) => text.includes("Plain bb thread")), `${at} the thread that is no agent is under Other threads`, JSON.stringify(others));

      // the home's badge: bb's own navigation entry for the home (the rail on desktop, the drawer on a
      // phone), never the plugin's own "3 need you" line, carries the label and draws the count
      const badge = await page.until(
        `(() => { const own = document.querySelector(${JSON.stringify(testId("oats-sidebar"))}); const entry = [...document.querySelectorAll("[aria-label]")].find((e) => !own?.contains(e) && /^OATS\\b.*3 agents need you/.test(e.getAttribute("aria-label"))); if (!entry) return ""; const r = entry.getBoundingClientRect(); const drawn = [...entry.querySelectorAll("*")].some((e) => e.children.length === 0 && e.textContent.trim() === "3"); return r.width > 0 && drawn ? entry.getAttribute("aria-label") : ""; })()`,
        15,
      );
      check(Boolean(badge), `${at} bb's navigation entry for the home shows the badge 3 (${badge ?? "not found"})`, await page.evaluate(`JSON.stringify([...document.querySelectorAll("[aria-label]")].map((e) => e.getAttribute("aria-label")).filter((l) => /OATS/.test(l)))`));

      // an agent's thread with its header row
      const mockups = threads.get("thr_mockups");
      await page.goto(`/projects/${mockups.projectId}/threads/${mockups.id}`);
      check(Boolean(await page.until(visible(testId("oats-identity-row")), 30)), `${at} an agent's thread shows the identity row`);
      // The image's name says a thread with its row: the row says where the agent is in a word, with the
      // act that applies and the way to the instance panel, and nothing else: who it is (its soul, its
      // parent, its messaging ID) is the panel's.
      const line = await statusOf(page, "working");
      const whole = await page.evaluate(`(document.querySelector(${JSON.stringify(testId("oats-identity-row"))})?.innerText ?? "").replace(/\\s+/g, "")`);
      const facts = await page.evaluate(`document.querySelectorAll(${JSON.stringify(`${testId("oats-identity-facts")}, ${testId("oats-identity-row")} [data-testid^="oats-fact-"], ${testId("oats-identity-row")} a`)}).length`);
      check(
        line !== null && line.line === "Working" && line.act === "Stop…" && line.panel === "Instance panel" && whole === "WorkingStop…Instancepanel" && facts === 0,
        `${at} the row: the state in a word, the act that applies (Stop) and the way to the instance panel, and no fact and no link under it`,
        JSON.stringify({ line, whole, facts }),
      );
      // Nothing of the row is cut or scrolls out of sight: it is as wide as its place, and every piece
      // of TEXT in it is drawn inside it and inside the window. (The text itself is measured, not its
      // box: a separator that would start a line of the status line is clipped on purpose.)
      const outside = JSON.parse(
        await page.evaluate(
          `(() => { const row = document.querySelector(${JSON.stringify(testId("oats-identity-row"))}); const box = row.getBoundingClientRect(); const out = []; const walk = document.createTreeWalker(row, NodeFilter.SHOW_TEXT); for (let node = walk.nextNode(); node; node = walk.nextNode()) { if (node.data.trim() === "" || node.parentElement.closest("[data-sep]")) continue; const range = document.createRange(); range.selectNodeContents(node); for (const r of range.getClientRects()) if (r.width > 0 && (r.left < box.left - 1 || r.right > Math.min(box.right, innerWidth) + 1)) out.push(node.data.trim().slice(0, 40)); } return JSON.stringify({ scrolls: row.scrollWidth > row.clientWidth + 1, out }); })()`,
        ),
      );
      check(outside.scrolls === false && outside.out.length === 0, `${at} nothing of the row is cut or out of sight`, JSON.stringify(outside));
      await page.shot(`a13-${viewport.name}-thread`, { targets: true });
      // A confirmation opened from a real row: Stop on the line reads the plan and asks, and stops nothing by itself.
      // On the thread of the agent whose stop plan was recorded (redesign-ui-lead: the fake answers that plan),
      // so the dialog is the one of the row pressed.
      const lead = threads.get("thr_redesign");
      await page.goto(`/projects/${lead.projectId}/threads/${lead.id}`);
      const leadLine = await statusOf(page, "working");
      check(leadLine !== null && leadLine.act === "Stop…", `${at} a working agent's line offers Stop…`, JSON.stringify(leadLine));
      await page.evaluate(`document.querySelector(${JSON.stringify(`${testId("oats-status-line")} ${testId("oats-status-act")}`)}).click()`);
      // The dialog is titled with the agent that was asked for, from its opening; the plan is read under it.
      const asked = await page.until(`(() => { const m = document.querySelector(${JSON.stringify(testId("oats-modal"))}); const t = m?.querySelector("h2")?.innerText.trim() ?? ""; return /^Stop .+\\?$/.test(t) ? t : ""; })()`, 20);
      check(asked === "Stop Redesign ui lead?", `${at} Stop on the thread's line opens the stop confirmation of that agent, by its one name, once the plan is read`, asked ?? (await page.evaluate(`document.querySelector(${JSON.stringify(testId("oats-modal"))})?.innerText.slice(0, 300) ?? "no dialog"`)));
      await page.shot(`a13-${viewport.name}-thread-stop-asked`, { targets: true });
      await page.press("Escape");
      await page.until(`document.querySelector(${JSON.stringify(testId("oats-modal"))}) === null`, 10);

      // the thread of an agent that needs you: its row is the open one, with the "!" and "Needs you"
      const release = threads.get("thr_release");
      await page.goto(`/projects/${release.projectId}/threads/${release.id}`);
      // The thread itself says it first (S1), before anything of the sidebar is opened over it: the
      // state's word, how long the agent has waited (no clock time), and what it asked.
      const needs = await statusOf(page, "needs-you");
      check(
        needs !== null && /^! Needs you · (under a minute|\d+ (min|h|d)) · Green light at 9f2e1c\? Second reader done\.$/.test(needs.line) && needs.act === "Answer",
        `${at} the thread of an agent that waits says so in its own row: "Needs you", how long, its question, and Answer as the way to reply`,
        needs === null ? await rowText(page) : JSON.stringify(needs),
      );
      // No line of it starts with a separator (B4): the "·" of a part that begins a line is outside what
      // the line's frame shows, and the "·" of a part that follows another on its line is inside it.
      const seps = JSON.parse(
        await page.evaluate(
          `(() => { const line = document.querySelector(${JSON.stringify(`${testId("oats-identity-row")} ${testId("oats-status-line")}`)}); const frame = line.getBoundingClientRect(); const first = line.querySelector(${JSON.stringify(testId("oats-state"))}).getBoundingClientRect(); const out = { starts: 0, shown: 0, wrong: [] }; for (const part of line.querySelectorAll(${JSON.stringify(testId("oats-status-part"))})) { const range = document.createRange(); range.selectNodeContents(part.querySelector("[data-sep]")); const dot = [...range.getClientRects()].find((r) => r.width > 0); const starts = part.getBoundingClientRect().top > first.bottom - 1 && part.getBoundingClientRect().left <= frame.left; if (!dot) { out.wrong.push("no separator drawn: " + part.innerText.slice(0, 30)); continue; } if (starts) { out.starts += 1; if (dot.right > frame.left + 0.5) out.wrong.push("a line starts with the separator: " + part.innerText.slice(0, 30)); } else { out.shown += 1; if (dot.left < frame.left) out.wrong.push("a separator between two parts is cut: " + part.innerText.slice(0, 30)); } } return JSON.stringify(out); })()`,
        ),
      );
      check(seps.wrong.length === 0 && seps.starts + seps.shown === 2 && (!viewport.mobile || seps.starts >= 1), `${at} no line of the status line starts with a separator (${seps.starts} part(s) begin a line, ${seps.shown} follow another)`, JSON.stringify(seps));
      await page.shot(`a13-${viewport.name}-thread-needs`, { targets: true });
      check(await showSidebar(page, viewport), `${at} the thread list is the OATS sidebar`);
      const open = `${testId("oats-agent-row")}[data-sidebar-thread-id="${release.id}"]`;
      const marked = await page.until(`(() => { const row = document.querySelector(${JSON.stringify(open)}); return row?.querySelector('[data-mark][data-state="needs-you"]')?.innerText.trim() === "!" && row.querySelector(${JSON.stringify(testId("oats-row-facts"))})?.getAttribute("title") === "Needs you · oats-maintainer" ? getComputedStyle(row).backgroundColor : ""; })()`, 30);
      const resting = await page.evaluate(`getComputedStyle(document.querySelector(${JSON.stringify(`${testId("oats-agent-row")}[data-sidebar-thread-id="${mockups.id}"]`)})).backgroundColor`);
      check(Boolean(marked) && marked !== resting, `${at} the open row of an agent that needs you has its "!" and says "Needs you" and its soul, on the open row's background`, `${marked} against ${resting}`);
      // At 1280 the sidebar is beside the thread: the image above already shows the open row. At 390 it is bb's drawer, over the thread.
      if (viewport.mobile) await page.shot(`a13-${viewport.name}-sidebar-open-row`);

      // D-037: the row of the plugin's page that is shown is the selected one, and stops being it
      // when a thread is opened from the sidebar (no reload: bb's own navigation).
      await page.goto("/plugins/oats/teams");
      check(await showSidebar(page, viewport), `${at} the thread list is the OATS sidebar`);
      const current = `JSON.stringify([...document.querySelectorAll(${JSON.stringify(`${testId("oats-pages")} button`)})].filter((e) => e.getAttribute("aria-current") === "page").map((e) => e.innerText.trim()))`;
      const onTeams = await page.until(`(() => { const now = ${current}; return now === '["Teams"]' ? now : ""; })()`, 30);
      check(Boolean(onTeams), `${at} while the Teams page is shown its row is the selected one, and no other`, onTeams ?? (await page.evaluate(current)));
      if (viewport.mobile) await page.shot(`a13-${viewport.name}-sidebar-page-selected`);
      await page.evaluate(`document.querySelector(${JSON.stringify(`${testId("oats-agent-row")}[data-sidebar-thread-id="${release.id}"]`)}).click()`);
      check(Boolean(await page.until(`location.pathname.endsWith("/threads/${release.id}")`, 15)), `${at} a thread opens from the sidebar`, await page.evaluate("location.pathname"));
      if (viewport.mobile) check(await showSidebar(page, viewport), `${at} the thread list is the OATS sidebar`);
      const none = await page.until(`(() => { const now = ${current}; return document.querySelector(${JSON.stringify(testId("oats-pages"))}) !== null && now === "[]" ? "none" : ""; })()`, 15);
      check(none === "none", `${at} and no page's row is selected once a thread is shown`, none ?? (await page.evaluate(current)));

      // the thread of an agent OATS stopped: "Stopped", and the act that brings it back
      const digest = threads.get("thr_digest");
      await page.goto(`/projects/${digest.projectId}/threads/${digest.id}`);
      // The state, then the warning (the outside feature's sentence): its composer is live. No time on the line: when it stopped is the panel's.
      const STOPPED = /^Stopped · A message here starts it outside OATS\.$/;
      const stopped = await statusOf(page, "stopped", STOPPED);
      check(stopped !== null && STOPPED.test(stopped.line) && stopped.act === "Start…", `${at} the thread of a stopped agent says "Stopped" and that a message here starts it outside OATS, with Start, and no time`, stopped === null ? await rowText(page) : JSON.stringify(stopped));
      await page.shot(`a13-${viewport.name}-thread-stopped`, { targets: true });

      // a thread that is no agent has no row
      const plain = threads.get("thr_plain");
      await page.goto(`/projects/${plain.projectId}/threads/${plain.id}`);
      await sleep(3000);
      check(!(await page.evaluate(visible(testId("oats-identity-row")))), `${at} a thread that is no agent has no identity row`);
    },
  },
  {
    stage: "fixtures",
    name: "freshness: a change the kernel records is in the tree within 3 s",
    run: async ({ page, at, viewport, threads, check, record }) => {
      await page.goto("/");
      check(await showSidebar(page, viewport), `${at} the thread list is the OATS sidebar`);
      const row = `${testId("oats-agent-row")}[data-sidebar-thread-id="${threads.get("thr_harvest").id}"]`;
      const drawn = (state) => `document.querySelector(${JSON.stringify(`${row} [data-state="${state}"]`)}) !== null`;
      check(Boolean(await page.until(drawn("idle"), 30)), `${at} before the change the agent is drawn idle`);
      // The kernel records that the agent was stopped: its status row, and a line in the event log.
      const stopped = record({ "harvest-knowledge-helper": { running: false, runtimeState: "stopped" } });
      const shown = (await page.until(drawn("stopped"), 15)) ? Date.now() - stopped : null;
      check(shown !== null && shown <= 3000, `${at} the tree shows the agent stopped ${shown === null ? "never" : `${shown} ms`} after the kernel recorded it (3 s at most)`);
      // And back, so the scenes after this one draw the fixtures.
      const back = record();
      const again = (await page.until(drawn("idle"), 15)) ? Date.now() - back : null;
      check(again !== null && again <= 3000, `${at} and idle again ${again === null ? "never" : `${again} ms`} after the kernel recorded that (3 s at most)`);
    },
  },
  {
    stage: "fixtures",
    name: "the fold: a closed parent whose child waits on a person carries the child's mark after its own state; the parent of the thread on screen is open",
    run: async ({ page, at, viewport, threads, check, record, snapshot, sleep }) => {
      const LEAD = threads.get("thr_redesign").id;
      const CHILD = threads.get("thr_mockups").id;
      const lead = `${testId("oats-sidebar")} ${testId("oats-agent-row")}[data-sidebar-thread-id="${LEAD}"]`;
      const child = `${testId("oats-sidebar")} ${testId("oats-agent-row")}[data-sidebar-thread-id="${CHILD}"]`;
      const toggle = `${testId("oats-sidebar")} ${testId("oats-row-toggle")}`;
      // THE ROSTER THE PAGE LOADS. This scene loads the page anew after the kernel records a change, and a page that
      // loads WHILE the server is reading that change can be given the roster from before it and then miss the event that
      // says it changed (shown by this scene run ten times a view: logs of 24 Nov 2026; the window's read, not the
      // fold: the child's own row said the same old thing). So the scene waits on the roster it needs: the SERVER's,
      // as the app gets it, holds the change BEFORE the page is loaded; then the row is read.
      const CHILD_NAME = "desktop-mockups-developer";
      const claimOf = () => {
        try {
          const now = snapshot();
          const agent = now?.agents?.find((each) => each.instance === CHILD_NAME);
          return { at: now?.at ?? null, claim: agent === undefined ? "no such agent" : agent.waiting === null ? null : "waiting" };
        } catch (error) {
          return { at: null, claim: `snapshot failed: ${String(error?.message ?? error).split("\n")[0]}` };
        }
      };
      /** Waits until the server's roster says `wanted` of the child's claim (60 s at most) → what it says, and after how long. */
      const serverSays = async (wanted) => {
        const from = Date.now();
        let server = claimOf();
        while (server.claim !== wanted && Date.now() - from < 60_000) {
          await sleep(500);
          server = claimOf();
        }
        return { ...server, seconds: Math.round((Date.now() - from) / 100) / 10 };
      };
      // The kernel records that the lead's child waits on a person.
      record({ "desktop-mockups-developer": { waitingOnYou: { since: "2026-11-19T12:40:00.000Z", producer: "oats.core", reason: "attention", message: "Which mockup do I keep?" } } });
      const held = await serverSays("waiting");
      check(held.claim === "waiting", `${at} the server's roster holds the child's claim after the kernel records it (${held.seconds} s)`, JSON.stringify(held));
      await page.goto("/");
      check(await showSidebar(page, viewport, { fold: "asLoaded" }), `${at} the thread list is the OATS sidebar`);
      const read = `(() => { const row = document.querySelector(${JSON.stringify(lead)}); if (!row) return ""; const inside = row.querySelector(${JSON.stringify(`${testId("oats-row-inside")} [data-mark]`)}); return JSON.stringify({ own: row.querySelector("[data-mark]").getAttribute("data-state"), word: row.querySelector('[data-phrase="state"]').innerText.trim(), inside: inside ? [inside.getAttribute("data-state"), inside.getAttribute("role"), inside.getAttribute("aria-label")] : null, after: row.querySelector(${JSON.stringify(testId("oats-row-inside"))})?.previousElementSibling?.getAttribute("data-phrase") ?? null, lines: Math.round(row.querySelector(${JSON.stringify(testId("oats-row-facts"))}).getBoundingClientRect().height / parseFloat(getComputedStyle(row.querySelector(${JSON.stringify(testId("oats-row-facts"))})).lineHeight)), open: document.querySelector(${JSON.stringify(toggle)})?.getAttribute("aria-expanded") ?? null, child: document.querySelector(${JSON.stringify(child)}) !== null, first: document.querySelector(${JSON.stringify(`${testId("oats-tree")} ${testId("oats-agent-row")}, ${testId("oats-tree")} ${testId("oats-agent-row-threadless")}`)}) === null ? null : [...document.querySelectorAll(${JSON.stringify(`${testId("oats-tree")} ${testId("oats-agent-row")}, ${testId("oats-tree")} ${testId("oats-agent-row-threadless")}`)})].findIndex((r) => r === row) }); })()`;
      const marked = (await page.until(`(() => { const now = ${read}; return now !== "" && JSON.parse(now).inside !== null ? now : ""; })()`, 30)) || (await page.evaluate(read));
      const m = marked === "" ? {} : JSON.parse(marked);
      check(m.open === "false" && m.child === false && m.own === "working" && m.word === "Working" && JSON.stringify(m.inside) === JSON.stringify(["needs-you", "img", "Needs input"]) && m.after === "state" && m.lines === 1, `${at} the closed lead keeps its own state ("Working", its own mark), and carries after it the mark of the child that waits, named for a screen reader, on the same one line; the child's row is not drawn`, marked);
      check(typeof m.first === "number" && m.first <= 2, `${at} the lead stands among the rows that need a person: its subtree's most urgent state brings it up`, marked);
      await page.shot(`a13-${viewport.name}-sidebar-child-waits`, { targets: true });
      // Opened: the child's own row says it, and the lead carries no mark.
      await page.evaluate(`document.querySelector(${JSON.stringify(toggle)}).click()`);
      const opened = (await page.until(`(() => { const now = ${read}; return now !== "" && JSON.parse(now).child ? now : ""; })()`, 10)) || (await page.evaluate(read));
      const childState = await page.evaluate(`document.querySelector(${JSON.stringify(`${child} [data-mark]`)})?.getAttribute("data-state") ?? null`);
      check(opened !== "" && JSON.parse(opened).inside === null && JSON.parse(opened).open === "true" && childState === "needs-you", `${at} opened, the child's own row is marked and the lead carries no mark`, `${opened} ${childState}`);
      await page.shot(`a13-${viewport.name}-sidebar-child-waits-opened`);
      // The thread on screen is the child's: after a load its parent is open, and a press on the chevron does not hide the row.
      await page.goto(`/projects/${threads.get("thr_mockups").projectId}/threads/${CHILD}`);
      check(await showSidebar(page, viewport, { fold: "asLoaded" }), `${at} the thread list is shown beside the child's thread`);
      const onScreen = await page.until(`(() => { const row = document.querySelector(${JSON.stringify(child)}); return row && row.getAttribute("aria-current") === "page" ? document.querySelector(${JSON.stringify(toggle)})?.getAttribute("aria-expanded") ?? "" : ""; })()`, 30);
      check(onScreen === "true", `${at} with the child's thread on screen its parent is open on load`, String(onScreen));
      // Its chevron is OFF while it holds the row on screen: disabled, out of the tab order, named as open; a press does nothing.
      const off = await page.evaluate(`(() => { const b = document.querySelector(${JSON.stringify(toggle)}); b.focus(); const focused = document.activeElement === b; b.click(); return JSON.stringify({ disabled: b.disabled, aria: b.getAttribute("aria-disabled"), name: b.getAttribute("aria-label"), focused, open: document.querySelector(${JSON.stringify(toggle)})?.getAttribute("aria-expanded") ?? null, child: document.querySelector(${JSON.stringify(child)}) !== null, muted: Number(getComputedStyle(b).opacity) < 1 }); })()`);
      check(off === JSON.stringify({ disabled: true, aria: "true", name: "Redesign ui lead's agents shown", focused: false, open: "true", child: true, muted: true }), `${at} the chevron of the parent that holds the row on screen is drawn open and off (disabled, muted, no focus), named "Redesign ui lead's agents shown": a parent is never closed over the row on screen, and no button swallows a press`, off);
      await page.shot(`a13-${viewport.name}-sidebar-parent-of-open-thread`);
      // And back, so the scenes after this one draw the fixtures: the server's roster first, then the page.
      record();
      const dropped = await serverSays(null);
      check(dropped.claim === null, `${at} the server's roster drops the child's claim after the kernel records it (${dropped.seconds} s)`, JSON.stringify(dropped));
      await page.goto("/");
      // (At a phone's width bb may keep its drawer as it was over the reload: asked twice, the second press opens one the first closed.)
      if (!(await showSidebar(page, viewport, { fold: "asLoaded" }))) await showSidebar(page, viewport, { fold: "asLoaded" });
      const recordedAt = Date.now();
      const cleared = `(() => { const now = ${read}; return now !== "" && JSON.parse(now).inside === null && JSON.parse(now).open === "false" ? now : ""; })()`;
      const back = await page.until(cleared, 15);
      const rowAfter = Date.now() - recordedAt;
      const titled = await page.evaluate(`document.querySelector(${JSON.stringify(`${lead} ${testId("oats-row-facts")}`)})?.getAttribute("title") ?? null`);
      // What a failure is, said from the page itself (never guessed): the lead opened, does the CHILD's own row still say
      // it waits (then the roster in the window is the old one: the mark follows it); does the window come right by itself
      // within one more poll; and does a new load of the page.
      let why = "";
      if (!back) {
        await page.evaluate(`document.querySelector(${JSON.stringify(toggle)}).click()`);
        const childNow = await page.until(`document.querySelector(${JSON.stringify(`${child} [data-mark]`)})?.getAttribute("data-state") ?? ""`, 5);
        await page.evaluate(`document.querySelector(${JSON.stringify(toggle)})?.getAttribute("aria-expanded") === "true" && document.querySelector(${JSON.stringify(toggle)}).click()`);
        const later = await page.until(cleared, 25);
        await page.goto("/");
        await showSidebar(page, viewport, { fold: "asLoaded" });
        const reloaded = await page.until(cleared, 15);
        why = `the row still carries a mark 15 s after the page was loaded, on a server's roster that had dropped the claim. The child's own row, the lead opened: ${JSON.stringify(childNow)} (needs-you: the window's roster is the old one, and the mark follows it; anything else: the mark is the fold's own fault). The window by itself within 25 s more: ${later ? "came right" : "did not"}. A new load of the page: ${reloaded ? "right" : "still marked"}. The server's roster now: ${JSON.stringify(claimOf())}; the lead's title at the failure: ${JSON.stringify(titled)}`;
      }
      check(Boolean(back), `${at} once the child no longer waits the closed lead carries no mark (the row without the mark ${Math.round(rowAfter / 100) / 10} s after the page was loaded on the server's roster without the claim)`, back ?? why);
    },
  },
  {
    stage: "fixtures",
    name: "the event path: a claim the kernel records is in the tree while the status read is still held, and the status read then confirms it",
    run: async ({ page, at, viewport, threads, check, sleep, record, recordFor, statusAnsweredSinceRecord, snapshot }) => {
      await page.goto("/");
      check(await showSidebar(page, viewport), `${at} the thread list is the OATS sidebar`);
      const row = `${testId("oats-agent-row")}[data-sidebar-thread-id="${threads.get("thr_harvest").id}"]`;
      const drawn = (state) => `document.querySelector(${JSON.stringify(`${row} [data-state="${state}"]`)}) !== null`;
      check(Boolean(await page.until(drawn("idle"), 30)), `${at} before the change the agent is drawn idle`);
      const waits = (shot) => shot.ok === true && shot.agents.some((agent) => agent.instance === "harvest-knowledge-helper" && agent.waiting !== null);
      // The kernel records a claim of that agent: a line in ITS file of the event log, which the watch
      // names; its events say the claim; and `oats status` is HELD, so no status read can answer yet.
      const HELD_MS = 6000;
      const claim = { since: new Date().toISOString(), producer: "agent", reason: "attention", message: "Keep the retry, or fail the job?" };
      const recorded = recordFor(
        { agent: "knowledge-harvester", instance: "harvest-knowledge-helper" },
        { changes: { "harvest-knowledge-helper": { waitingOnYou: claim } }, said: { waitingOnYou: claim, waitingClaims: [{ producer: "agent", waiting: true, since: claim.since, reason: "attention", message: claim.message }] }, statusHeldMs: HELD_MS },
      );
      const shown = (await page.until(drawn("needs-you"), 15)) ? Date.now() - recorded : null;
      // By the server's own order, not by the clock: the snapshot that has the claim is still the
      // one of a status read that STARTED BEFORE the kernel recorded it. Only the events can have put it there.
      // And no status read that could carry the claim has answered yet (the fake's own log): the status is still held.
      const answered = statusAnsweredSinceRecord();
      const during = snapshot();
      check(
        shown !== null && waits(during) && Date.parse(during.at) < recorded && answered === false,
        `${at} the tree shows the agent waiting ${shown === null ? "never" : `${shown} ms`} after the kernel recorded it, from its events alone: the snapshot is still the status read from before the record (the status is held ${HELD_MS} ms)`,
        JSON.stringify({ shown, ok: during.ok, at: during.at, recorded: new Date(recorded).toISOString(), waits: waits(during), aStatusReadAnswered: answered }),
      );
      await page.shot(`event-path-${viewport.name}-claim-before-status`);
      // The status read that the same signal asked for answers, with the claim: it confirms, and the row stays.
      let confirmed = during;
      for (const deadline = Date.now() + 30_000; Date.now() < deadline && !(confirmed.ok === true && Date.parse(confirmed.at) >= recorded); await sleep(250)) confirmed = snapshot();
      const still = await page.evaluate(drawn("needs-you"));
      check(confirmed.ok === true && Date.parse(confirmed.at) >= recorded && waits(confirmed) && still === true, `${at} and the status read that started after the record confirms it: the agent still waits`, JSON.stringify({ ok: confirmed.ok, at: confirmed.at, waits: waits(confirmed), still }));
      // And back, so the scenes after this one draw the fixtures.
      record();
      check(Boolean(await page.until(drawn("idle"), 30)), `${at} and idle again once the kernel's status says so`);
    },
  },
  {
    stage: "detached",
    name: "the states no fixture row is in",
    run: async ({ page, at, viewport, threads, check }) => {
      // Two failures are two words (S11), in the thread's own row and in the sidebar's.
      const unreachable = threads.get("thr_mockups");
      await page.goto(`/projects/${unreachable.projectId}/threads/${unreachable.id}`);
      const cut = await statusOf(page, "unreachable");
      check(cut !== null && cut.line === "Unreachable" && cut.act === "Retry", `${at} the thread of an agent the kernel cannot reach says "Unreachable", the word alone, with Retry`, cut === null ? await rowText(page) : JSON.stringify(cut));
      await page.shot(`a16-${viewport.name}-thread-unreachable`, { targets: true });

      const failed = threads.get("thr_harvest");
      await page.goto(`/projects/${failed.projectId}/threads/${failed.id}`);
      const ended = await statusOf(page, "error");
      check(ended !== null && ended.line === "Failed · session ended" && ended.act === "Start…", `${at} the thread of an agent whose session fell back to a shell says "Failed", the reason in two words, with Start (nothing runs)`, ended === null ? await rowText(page) : JSON.stringify(ended));
      await page.shot(`a16-${viewport.name}-thread-failed`, { targets: true });

      check(await showSidebar(page, viewport), `${at} the thread list is the OATS sidebar`);
      const factsOf = (id) => `(document.querySelector(${JSON.stringify(`${testId("oats-agent-row")}[data-sidebar-thread-id="${id}"] ${testId("oats-row-facts")}`)})?.getAttribute("title") ?? "")`;
      const words = await page.until(`(() => { const rows = [${factsOf(unreachable.id)}, ${factsOf(failed.id)}]; return rows[0] === "Unreachable · oats-desktop-developer" && rows[1] === "Failed · knowledge-harvester" ? JSON.stringify(rows) : ""; })()`, 30);
      check(Boolean(words), `${at} in the sidebar the two rows say "Unreachable" and "Failed", each beside its mark and before its soul`, words ?? (await page.evaluate(`JSON.stringify([${factsOf(unreachable.id)}, ${factsOf(failed.id)}])`)));
      // And the agent whose bb thread is gone stays in the roster (S3): bb has no thread of its id, and the row says so (the outside feature's words).
      const gone = await page.until(`(document.querySelector(${JSON.stringify(`${testId("oats-agent-row-threadless")}[data-instance="weekly-digest-helper"] ${testId("oats-row-facts")}`)})?.getAttribute("title") ?? "")`, 30);
      check(gone === "Stopped · oats-expert · deleted in bb", `${at} the agent whose bb thread is gone stays in the roster, and says "Stopped", then the reason, "deleted in bb", then its soul`, gone ?? (await page.evaluate(textOf(testId("oats-tree")))));
      // At 1280 the image of the failed thread already shows the sidebar's rows; at 390 they are in bb's drawer.
      // The detached row says what happened after its state's word ("deleted in bb"), which does not give way: it obeys the row's rule too:
      // one line, nothing past the row's edge, the state's word whole.
      const detachedRows = await rowLines(page);
      const d = JSON.parse(detachedRows);
      check(d.over === 0 && d.wrapped === 0 && d.edgeCut === 0 && d.soulGone === 0 && d.misordered === 0 && d.untitled === 0, `${at} the rows of this roster, the one whose thread is gone included, keep to three lines: no second block on two, nothing past the row's edge`, detachedRows);
      if (viewport.mobile) await page.shot(`a16-${viewport.name}-states`);
    },
  },
  {
    stage: "no-oats",
    name: "stale: OATS cannot be read after it was: the one notice (its age once, that the acts are off, Retry), the tree as last read",
    run: async ({ page, at, viewport, threads, check }) => {
      await page.goto("/");
      check(await showSidebar(page, viewport), `${at} the thread list is still drawn`);
      // A titled notice in a person's words, with the age of what is still shown and Retry.
      const notice = await page.until(`(() => { const e = document.querySelector(${JSON.stringify(testId("oats-unreadable"))}); const t = e?.querySelector("h3")?.innerText ?? ""; return t === ${JSON.stringify(`OATS is not installed on ${MACHINE}`)} ? JSON.stringify({ title: t, code: e.getAttribute("data-code"), text: e.innerText.replace(/\\s+/g, " "), retry: [...e.querySelectorAll("button")].some((b) => b.innerText.trim() === "Retry"), settings: [...e.querySelectorAll("a")].some((a) => a.innerText.trim() === "Open settings") }) : ""; })()`, 30);
      const said = notice ? JSON.parse(notice) : null;
      const AGE = "(less than a minute ago|\\d+ min ago|\\d+ h ago)";
      // Its face, whole: the title, the age and that the acts are off on one line, its one fold (closed), Retry and Open settings.
      check(said !== null && said.code === "OATS_NOT_FOUND" && new RegExp(`^OATS is not installed on ${MACHINE} ?Read ${AGE}\\. Acts are off\\. ?▸ ?Details ?Retry ?Open settings$`).test(said.text.trim()) && said.retry && said.settings, `${at} the notice says what is missing in a person's words, how old what is shown is and that the acts are off, with Details, Retry and Open settings, and nothing else: ${said?.title ?? ""}`, notice ?? (await page.evaluate(textOf(testId("oats-sidebar")))));
      // One drawing, the age said once and in one form, and the acts off.
      const once = JSON.parse(await page.evaluate(`JSON.stringify({ held: ${textOf(`${testId("oats-sidebar")} ${testId("oats-held")}`)}, ages: (document.querySelector(${JSON.stringify(testId("oats-sidebar"))}).innerText.match(/${AGE}/g) ?? []).length, second: document.querySelector(${JSON.stringify(testId("oats-last-observation"))}) !== null })`));
      check(once.held === "Acts are off." && once.ages === 1 && once.second === false, `${at} the notice says that the acts are off, and the age of what is shown once, in one form`, JSON.stringify(once));
      // What to do in a sentence, the code and the kernel's message are one press away: under the notice's fold, closed.
      const fold = await page.evaluate(`(() => { const d = document.querySelector(${JSON.stringify(`${testId("oats-sidebar")} ${testId("oats-notice-details")}`)}); return d ? JSON.stringify({ open: d.open, lines: [...d.querySelectorAll("p")].map((p) => p.textContent) }) : "none"; })()`);
      const folded = fold === "none" ? null : JSON.parse(fold);
      check(folded !== null && folded.open === false && folded.lines[0] === "Install OATS there, or set the path to oats in the plugin's settings." && /^OATS_NOT_FOUND: /.test(folded.lines[1] ?? ""), `${at} what to do, then the code and the message, are under the notice's one fold, closed`, fold);
      // The roster stays: the agents as last read, joined to their threads, never bb's flat list.
      const rows = await page.evaluate(`[...document.querySelectorAll(${JSON.stringify(testId("oats-agent-row"))})].map((e) => e.getAttribute("data-sidebar-thread-id"))`);
      check(rows.length >= 6 && rows.includes(threads.get("thr_release").id), `${at} the tree is still drawn, as last read (${rows.length} agents)`, JSON.stringify(rows));
      // "New agent" is held with the acts: in its place, off, with no reason of its own (the notice over the roster says why).
      const newAgent = await page.evaluate(`(() => { const b = document.querySelector(${JSON.stringify(`${testId("oats-sidebar")} ${testId("oats-new-agent")}`)}); return b ? JSON.stringify({ text: b.innerText.trim(), off: b.disabled, why: b.title, said: /Comes back when/.test(document.querySelector(${JSON.stringify(testId("oats-sidebar"))}).innerText) }) : "none"; })()`);
      check(newAgent === JSON.stringify({ text: "New agent", off: true, why: "", said: false }), `${at} "New agent" stays in its place, off, under the notice that says why: no reason beside it or in a title`, newAgent);
      await page.shot(`a14-${viewport.name}-sidebar`);

      const target = threads.get("thr_redesign");
      await page.evaluate(`document.querySelector('${testId("oats-agent-row")}[data-sidebar-thread-id="${target.id}"]').click()`);
      const opened = await page.until(`location.pathname.endsWith("/threads/${target.id}")`, 15);
      check(Boolean(opened), `${at} a thread opens from the tree`, await page.evaluate("location.pathname"));
      // The thread's own row is still there, from the last roster: its line as last read, and under it
      // the same notice on one line: the title, the age, that the acts are off, Retry.
      const kept = await page.until(`(() => { const row = document.querySelector(${JSON.stringify(testId("oats-identity-row"))}); const said = row?.querySelector(${JSON.stringify(`${testId("oats-unreadable")}[data-compact]`)}); return said ? JSON.stringify({ line: row.querySelector(${JSON.stringify(testId("oats-status-line"))}).getAttribute("data-state"), said: said.innerText.replace(/\\s+/g, " ").trim() }) : ""; })()`, 15);
      const row = kept ? JSON.parse(kept) : null;
      check(
        row !== null && row.line === "working" && new RegExp(`^OATS is not installed on ${MACHINE} Read ${AGE}\\. Acts are off\\. Retry$`).test(row.said),
        `${at} the open thread keeps its OATS row, from the last roster, with the one notice on a line: its age, that the acts are off, Retry`,
        kept ?? (await page.evaluate(textOf(testId("oats-identity-row")))),
      );
      // Holding is SHOWN: the act that applies to this agent (Stop: it works) stays on its line, off; the notice under it says why.
      const heldAct = await page.evaluate(`(() => { const b = document.querySelector(${JSON.stringify(`${testId("oats-identity-row")} ${testId("oats-status-act")}`)}); return b ? JSON.stringify({ text: b.innerText.trim(), off: b.disabled, why: b.title }) : "none"; })()`);
      check(heldAct === JSON.stringify({ text: "Stop…", off: true, why: "" }), `${at} the act on the thread's line (Stop…) is held: in its place, off, over the one-line notice that says why`, heldAct);
      await page.shot(`a14-${viewport.name}-thread`, { targets: true });

      // The home keeps what it showed, under the same notice.
      await page.goto("/plugins/oats/home");
      const home = await page.until(`(() => { const e = document.querySelector(${JSON.stringify(`${testId("oats-home-page")} ${testId("oats-unreadable")}`)}); const cards = document.querySelectorAll(${JSON.stringify(testId("oats-needs-card"))}).length; return e && cards > 0 ? JSON.stringify({ title: e.querySelector("h3")?.innerText ?? "", text: e.innerText.replace(/\\s+/g, " "), cards }) : ""; })()`, 30);
      const shown = home ? JSON.parse(home) : null;
      check(shown !== null && /^OATS is not installed on /.test(shown.title) && new RegExp(`Read ${AGE}\\. Acts are off\\.`).test(shown.text) && shown.cards === 3, `${at} the home keeps its three cards under the same notice, with the age of what it shows and that the acts are off`, home ?? (await page.evaluate(textOf(testId("oats-home-page")))));
      // One full notice on a screen: beside the page's notice the sidebar says one line, how old the roster is, and Retry.
      if (viewport.mobile) check(await showSidebar(page, viewport), `${at} the sidebar opens over the home`);
      const oneLine = await page.until(`(() => { const s = document.querySelector(${JSON.stringify(testId("oats-sidebar"))}); const l = s?.querySelector(${JSON.stringify(testId("oats-last-observation"))}); return l ? JSON.stringify({ line: l.innerText.replace(/\\s+/g, " ").trim(), full: s.querySelector(${JSON.stringify(testId("oats-held"))}) !== null, why: s.querySelector(${JSON.stringify(testId("oats-new-agent-held"))})?.innerText.trim() ?? null, off: s.querySelector(${JSON.stringify(testId("oats-new-agent"))})?.disabled ?? null }) : ""; })()`, 15);
      check(oneLine !== null && new RegExp(`^\\{"line":"Read ${AGE}\\. Acts are off\\. Retry","full":false,"why":null,"off":true\\}$`).test(oneLine), `${at} beside the home's full notice the sidebar says one line: "Read <age>. Acts are off." and Retry; New agent stays off under it, with no reason of its own (in bb's drawer, over the page, the line itself says why)`, oneLine ?? (await page.evaluate(textOf(testId("oats-sidebar")))));
      // (The home's image, below, holds the sidebar's one line beside the page's notice.)
      // (The home's own controls are measured when the home is rebuilt, in its piece: no size check on this image.)
      await page.shot(`a14-${viewport.name}-home`);
      // The home left (a page of bb's own, with no notice of the plugin's): the sidebar's notice is whole
      // again. A page bb kept mounted out of sight would leave the one line with no full notice in view.
      await page.goto("/");
      check(await showSidebar(page, viewport), `${at} the sidebar is shown after the home is left`);
      const whole = await page.until(`(() => { const s = document.querySelector(${JSON.stringify(testId("oats-sidebar"))}); return s?.querySelector(${JSON.stringify(testId("oats-held"))}) ? JSON.stringify({ line: s.querySelector(${JSON.stringify(testId("oats-last-observation"))}) !== null, why: s.querySelector(${JSON.stringify(testId("oats-new-agent-held"))}) !== null }) : ""; })()`, 15);
      check(whole === JSON.stringify({ line: false, why: false }), `${at} with the home left the sidebar's notice is whole again: no one line, and no reason under New agent`, whole ?? (await page.evaluate(textOf(testId("oats-sidebar")))));
    },
  },
  {
    stage: "pages-default",
    name: "the release's default, with the setting left as installed (unset): only the home is a page; no link, no mark, no route and no dangling link to another",
    run: async ({ page, at, viewport, threads, check }) => {
      const mockups = threads.get("thr_mockups");
      await page.goto(`/projects/${mockups.projectId}/threads/${mockups.id}`);
      check(await showSidebar(page, viewport), `${at} the thread list is the OATS sidebar`);
      // The sidebar: the roster; no line that counts who waits, no list of pages, no link to one, no mark of one.
      const side = await page.until(`(() => { const s = document.querySelector(${JSON.stringify(testId("oats-sidebar"))}); if (!s || !s.querySelector(${JSON.stringify(testId("oats-tree"))})) return ""; return JSON.stringify({ pages: s.querySelector(${JSON.stringify(testId("oats-pages"))}) !== null, links: [...s.querySelectorAll('[data-testid^="oats-page-link-"]')].map((e) => e.getAttribute("data-testid")), needs: s.querySelector(${JSON.stringify(testId("oats-needs-line"))})?.tagName ?? "" }); })()`, 30);
      check(side === JSON.stringify({ pages: false, links: [], needs: "" }), `${at} with the setting left as installed the sidebar has the roster, and no page link and no line that counts who waits`, side ?? (await page.evaluate(textOf(testId("oats-sidebar")))));
      // The thread's own row: no soul on it and no link at all (who the agent is is the instance panel's): nothing leads to a page that is not shown.
      // Read AFTER the sidebar: bb gives the settings a moment after the roster.
      const soul = await page.until(`(() => { const e = document.querySelector(${JSON.stringify(testId("oats-identity-row"))}); return e && e.querySelector(${JSON.stringify(testId("oats-status-line"))}) ? JSON.stringify({ text: e.innerText.replace(/\\s+/g, ""), links: e.querySelectorAll("a").length }) : ""; })()`, 30);
      check(soul === JSON.stringify({ text: "WorkingStop…Instancepanel", links: 0 }), `${at} the thread's row is its line alone: no soul and no link to a page that is not shown`, soul ?? (await page.evaluate(textOf(testId("oats-identity-row")))));
      await page.shot(`pages-default-${viewport.name}-sidebar`, { targets: true });
      // A page that is not shown has no route: its path answers one line and the way back.
      for (const path of ["souls", "capabilities", "teams", "machines", "automations"]) {
        await page.goto(`/plugins/oats/${path}`);
        const said = await page.until(`(document.querySelector(${JSON.stringify(`${testId("oats-page-not-shown")}[data-page="${path}"]`)})?.innerText ?? "").replace(/\\s+/g, " ").trim()`, 30);
        check(said === "This page is not shown in this release of the OATS plugin. Back to Home", `${at} /plugins/oats/${path} says it is not shown, with the way back`, said ?? (await page.evaluate("document.body.innerText.slice(0, 300)")));
      }
      await page.shot(`pages-default-${viewport.name}-not-shown`, { targets: true });
    },
  },
  {
    stage: "tmux-roster",
    name: "a deployment that is mostly tmux agents: every one a row that says where it runs, each one that waits marked, no phrase broken, the last row reachable, and a row opens its agent's page",
    run: async ({ page, at, viewport, threads, check }) => {
      await page.goto("/");
      check(await showSidebar(page, viewport, { fold: "asLoaded" }), `${at} the thread list is the OATS sidebar`);
      const side = JSON.stringify(testId("oats-sidebar"));
      const tmux = TMUX_ROSTER.tmux;
      // As the page loads every parent is CLOSED, whatever its backend: the roots alone are drawn. Two closed parents
      // hide an agent that waits, and carry its mark after their own word.
      const roots = tmux.filter(([, , parent]) => parent === null).length + 2; // and the two roots on bb threads (release-070-maintainer, redesign-ui-lead)
      const rootParents = tmux.filter(([instance, , parent]) => parent === null && tmux.some(([, , of]) => of === instance)).map(([instance]) => instance);
      const hidesWaiting = rootParents.filter((instance) => { const under = (name) => tmux.filter(([, , of]) => of === name).flatMap(([child, , , how]) => [how, ...under(child)]); return under(instance).includes("waiting"); });
      const closedTree = await page.until(`(() => { const rows = [...document.querySelectorAll(${JSON.stringify(`${testId("oats-sidebar")} ${testId("oats-tree")} ${testId("oats-agent-row")}, ${testId("oats-sidebar")} ${testId("oats-tree")} ${testId("oats-agent-row-threadless")}`)})]; return rows.length === ${roots} ? "1" : ""; })()`, 30);
      const foldsClosed = JSON.parse(await folds(page));
      check(Boolean(closedTree) && foldsClosed.parents === rootParents.length + 1 && foldsClosed.closed === foldsClosed.parents, `${at} as the page loads the ${roots} roots alone are drawn, and each of the ${rootParents.length + 1} that has agents under it (${rootParents.length} of them on tmux) has its chevron, closed`, JSON.stringify(foldsClosed));
      check(JSON.stringify(foldsClosed.inside.map(([who, state]) => `${who}:${state}`).sort()) === JSON.stringify(hidesWaiting.map((instance) => `${instance}:needs-you`).sort()), `${at} the ${hidesWaiting.length} closed tmux parents that hide an agent that waits carry its mark after their own word, and no other parent carries one`, JSON.stringify(foldsClosed.inside));
      await page.shot(`tmux-roster-${viewport.name}-sidebar-closed`, { targets: true });
      // Every parent opened: the rest of this scene reads every agent's row.
      const openedNow = await openParents(page);
      check(openedNow === tmux.filter(([instance]) => tmux.some(([, , of]) => of === instance)).length + 1, `${at} every parent opens by its chevron, a parent under a parent too: ${openedNow}`, String(openedNow));
      // Every tmux agent is a row, by its one name, and says its state, its soul and "tmux".
      const rows = await page.until(`(() => { const rows = [...document.querySelectorAll(${JSON.stringify(`${testId("oats-sidebar")} ${testId("oats-agent-row-threadless")}`)})]; return rows.length >= ${tmux.length} ? JSON.stringify(rows.map((row) => [row.getAttribute("data-instance"), (row.querySelector(${JSON.stringify(testId("oats-row-facts"))})?.getAttribute("title") ?? "")])) : ""; })()`, 30);
      const read = rows === null ? [] : JSON.parse(rows);
      const wanted = tmux.map(([instance, soul, , how]) => [instance, `${how === "waiting" ? "Needs you" : how === "stopped" ? "Stopped" : how === "lost" ? "Stopped" : "Working"} · ${soul}${how === "lost" ? " · session lost" : ""} · tmux`]);
      const bySort = (list) => [...list].sort((a, b) => a[0].localeCompare(b[0]));
      check(JSON.stringify(bySort(read)) === JSON.stringify(bySort(wanted)), `${at} each of the ${tmux.length} tmux agents is a row: its state in a word, its soul, then "tmux"`, rows ?? (await page.evaluate(textOf(testId("oats-sidebar")))));
      // ONE tree: each tmux agent that has a parent is drawn under it, one step in (deeper than 2 at 2), in its parent's own block of rows.
      const parents = Object.fromEntries(tmux.filter(([, , parent]) => parent !== null).map(([instance, , parent]) => [instance, parent]));
      const tree = depths(JSON.parse(await treeRows(page)));
      const off = misplaced(tree, parents);
      check(off.length === 0 && tree.filter((row) => row.depth === 2).length >= 1, `${at} each of the ${Object.keys(parents).length} tmux agents that has a parent is drawn under it, one step in, a child's child two steps in`, off.join("; ") || JSON.stringify(tree));
      // ("tmux" in that reading is the glyph's name: every tmux row draws bb's terminal glyph, named, and no word.)
      const glyphs = JSON.parse(await page.evaluate(tmuxMarks));
      check(glyphs.marks === tmux.length && glyphs.glyphs === tmux.length && glyphs.named === tmux.length && glyphs.drawn === tmux.length, `${at} on each of the ${tmux.length} rows "tmux" is bb's terminal glyph, named "tmux"`, JSON.stringify(glyphs));
      // Who waits: the three on tmux that wait... every one that waits, with a thread or not, in ONE number.
      const waiting = tmux.filter(([, , , how]) => how === "waiting").length + 1; // and release-070-maintainer, on bb
      const needs = await page.until(`(() => { const n = document.querySelectorAll(${JSON.stringify(`${testId("oats-sidebar")} ${testId("oats-tree")} [data-mark][data-state="needs-you"]`)}).length; return n >= ${waiting} ? String(n) : ""; })()`, 15);
      check(needs === String(waiting) && (await page.evaluate(`document.querySelector(${JSON.stringify(`${testId("oats-sidebar")} ${testId("oats-needs-line")}`)}) === null`)) === true, `${at} every agent that waits carries the mark on its row, the ${waiting - 1} on tmux included: ${waiting}; no foot line counts them`, needs);
      // Every row is at most three lines: the name on one or two, the second block on ONE line; the
      // state's word and "tmux" are never cut.
      const measured = await rowLines(page);
      const rowsRead = JSON.parse(measured);
      check(rowsRead.rows >= tmux.length + TMUX_ROSTER.bb.length && rowsRead.over === 0 && rowsRead.wrapped === 0, `${at} no row is over three lines, and no row's second block is on two`, measured);
      check(rowsRead.edgeCut === 0 && rowsRead.whereCut === 0 && rowsRead.soulGone === 0 && rowsRead.misordered === 0 && rowsRead.untitled === 0, `${at} the state's word and "tmux" are never cut, no soul is squeezed to nothing (${rowsRead.soulCut} cut with "…"), and every name has the whole name as its title`, measured);
      await page.shot(`tmux-roster-${viewport.name}-sidebar`, { targets: true });
      // Scale: with twenty and more rows the list scrolls, and the last row and the foot can be brought into view.
      const reach = await page.evaluate(`(() => { const rows = [...document.querySelectorAll(${JSON.stringify(`${testId("oats-sidebar")} ${testId("oats-agent-row-threadless")}`)})]; const last = rows[rows.length - 1]; last.scrollIntoView({ block: "center" }); const r = last.getBoundingClientRect(); const lastIn = r.height > 0 && r.top >= 0 && r.bottom <= window.innerHeight; const foot = document.querySelector(${JSON.stringify(`${testId("oats-sidebar")} ${testId("oats-new-agent")}`)}); foot.scrollIntoView({ block: "center" }); const f = foot.getBoundingClientRect(); return JSON.stringify({ last: lastIn, foot: f.top >= 0 && f.bottom <= window.innerHeight }); })()`);
      check(reach === JSON.stringify({ last: true, foot: true }), `${at} with ${tmux.length + TMUX_ROSTER.bb.length} agents the last row and New agent under it can be scrolled into view`, reach);
      await page.shot(`tmux-roster-${viewport.name}-sidebar-end`);
      // A SELECTED row whose name takes two lines: the bb-thread agent with the long name, on its own thread.
      const long = threads.get("thr_mockups");
      await page.goto(`/projects/${long.projectId}/threads/${long.id}`);
      check(await showSidebar(page, viewport), `${at} the sidebar is shown on the agent's thread`);
      const selected = await page.until(`(() => { const row = document.querySelector(${JSON.stringify(`${testId("oats-sidebar")} ${testId("oats-agent-row")}[data-sidebar-thread-id="${long.id}"]`)}); const name = row?.querySelector(${JSON.stringify(testId("oats-row-name"))}); if (!name) return ""; const lines = Math.round(name.getBoundingClientRect().height / parseFloat(getComputedStyle(name).lineHeight)); return lines === 2 ? JSON.stringify({ lines, cut: name.scrollHeight > name.clientHeight + 1, title: name.getAttribute("title") }) : ""; })()`, 20);
      check(selected === JSON.stringify({ lines: 2, cut: true, title: TMUX_ROSTER.renamed["desktop-mockups-developer"] }), `${at} the open thread's row holds its long name on two lines, cut only after the second, and whole in its title`, selected ?? (await rowLines(page)));
      await page.shot(`tmux-roster-${viewport.name}-selected-two-line-name`, { targets: true });
      await page.goto("/");
      check(await showSidebar(page, viewport), `${at} the sidebar is shown again`);
      // A tmux row leads to its agent's own page, by its instance (never by the name drawn).
      const [instance] = tmux.find(([, , , how]) => how === "waiting");
      // (The sidebar was drawn again: its row is waited for before it is pressed.)
      await page.until(`document.querySelector(${JSON.stringify(`${testId("oats-sidebar")} ${testId("oats-agent-row-threadless")}[data-instance="${instance}"]`)}) !== null`, 30);
      await page.evaluate(`document.querySelector(${JSON.stringify(`${testId("oats-sidebar")} ${testId("oats-agent-row-threadless")}[data-instance="${instance}"]`)}).click()`);
      const opened = await page.until(`location.pathname.includes(${JSON.stringify(`/agent/${instance}`)}) ? location.pathname : ""`, 15);
      check(Boolean(opened), `${at} the row of ${instance} opens that agent's own page`, opened ?? (await page.evaluate("location.pathname")));
      await page.until(visible(testId("oats-panel")), 30);
      await page.shot(`tmux-roster-${viewport.name}-agent-page`);
      if (opened) {
        // The page of an agent with no bb thread IS the row on screen: loaded anew on the page of a child's child (no chevron
        // was pressed: the page loads with every parent closed), its two parents are open, by chevrons that are off, and its row is drawn.
        const [deep, , over] = tmux.find(([, , parent]) => parent !== null && tmux.some(([instance, , above]) => instance === parent && above !== null));
        const [, , top] = tmux.find(([instance]) => instance === over);
        await page.goto(opened.replace(`/agent/${instance}`, `/agent/${deep}`));
        await page.until(visible(testId("oats-panel")), 30);
        check(await showSidebar(page, viewport, { fold: "asLoaded" }), `${at} the sidebar is shown beside the page of ${deep}`);
        const held = await page.until(
          `(() => { const side = document.querySelector(${side}); const row = side?.querySelector(${JSON.stringify(`${testId("oats-agent-row-threadless")}[data-instance="${deep}"]`)}); if (!row) return ""; const toggles = Object.fromEntries([...side.querySelectorAll(${JSON.stringify(testId("oats-row-toggle"))})].map((toggle) => [toggle.getAttribute("data-instance"), [toggle.getAttribute("aria-expanded"), toggle.disabled]])); return JSON.stringify([toggles[${JSON.stringify(top)}] ?? null, toggles[${JSON.stringify(over)}] ?? null]); })()`,
          30,
        );
        check(held === JSON.stringify([["true", true], ["true", true]]), `${at} on the page of ${deep}, loaded anew, its row is drawn and its parents ${top} and ${over} are open, held by it: their chevrons are off`, held ?? (await folds(page)));
        const others = JSON.parse(await folds(page));
        check(others.parents - others.closed === 2, `${at} no other parent is open: every one but those two is as the page loaded it, closed`, JSON.stringify(others));
        await page.shot(`tmux-roster-${viewport.name}-child-page-parents-open`, { targets: true });
      }
    },
  },
  {
    // The pilot's own shape: after a host's restart EVERY tmux agent's session is lost, so every row has the same reason.
    // The row's order is STATE · SOUL · REASON · glyph (the lead's L16), and a lost session's word in the state's place is
    // "Lost", with no reason after it (L17): at bb's sidebar width the reason had to leave every such row.
    stage: "tmux-roster",
    name: "a roster whose sessions were all lost: every row reads \"Lost\", its soul and where it is; its title keeps \"Stopped · <soul> · session lost · tmux\"",
    run: async ({ page, at, viewport, check, fake, tmuxStatus }) => {
      const all = Object.fromEntries(TMUX_ROSTER.tmux.map(([instance]) => [instance, "lost"]));
      fake({ status: { stdout: tmuxStatus(all) } });
      try {
        await page.goto("/");
        check(await showSidebar(page, viewport), `${at} the thread list is the OATS sidebar`);
        const titles = `[...document.querySelectorAll(${JSON.stringify(`${testId("oats-sidebar")} ${testId("oats-agent-row-threadless")} ${testId("oats-row-facts")}`)})].map((e) => e.getAttribute("title"))`;
        const lost = (await page.until(`(() => { const now = ${titles}; return now.length === ${TMUX_ROSTER.tmux.length} && now.every((title) => / · session lost · tmux$/.test(title)) ? JSON.stringify(now) : ""; })()`, 30)) ?? null; // (the harness's until answers undefined at its time's end: null, so that the check fails with what was read, never a throw)
        const wanted = TMUX_ROSTER.tmux.map(([, soul]) => `Stopped · ${soul} · session lost · tmux`).sort();
        check(lost !== null && JSON.stringify(JSON.parse(lost).sort()) === JSON.stringify(wanted), `${at} each of the ${TMUX_ROSTER.tmux.length} rows says, whole in its title, "Stopped · <soul> · session lost · tmux"`, lost ?? (await page.evaluate(`JSON.stringify(${titles})`)));
        const measured = await rowLines(page);
        const rows = JSON.parse(measured);
        check(rows.misordered === 0 && rows.edgeCut === 0 && rows.whereCut === 0 && rows.wrapped === 0 && rows.over === 0 && rows.soulGone === 0 && rows.reasonCut === 0 && rows.reasonLeft === 0, `${at} every row keeps the order: no state or glyph cut, nothing past a row's edge, and no reason that had to shorten or leave (${rows.soulCut} soul(s) shortened with "…")`, measured);
        // What each row DRAWS: "Lost" in the state's place (the kernel's own word), its soul, the glyph; on the mark of a stopped agent.
        const words = await page.evaluate(`JSON.stringify([...new Set([...document.querySelectorAll(${JSON.stringify(`${testId("oats-sidebar")} ${testId("oats-agent-row-threadless")}`)})].map((row) => [row.querySelector('[data-phrase="state"]').innerText.trim(), [...row.querySelectorAll("[data-phrase]")].map((p) => p.getAttribute("data-phrase")).join(" "), row.querySelector("[data-mark]").getAttribute("data-state"), row.querySelector("[data-mark]").getAttribute("data-tone")].join("|")))])`);
        check(words === JSON.stringify(["Lost|state soul where|stopped|"]), `${at} each row draws "Lost", its soul and the glyph, with the mark of a stopped agent in the plain tone: "session lost" is said by the word in the state's place`, words);
        // A row whose reason is on the line draws the parts in the order: the state, the soul, the reason, the glyph, left to right.
        const drawn = await page.evaluate(`JSON.stringify([...document.querySelectorAll(${JSON.stringify(`${testId("oats-sidebar")} ${testId("oats-agent-row-threadless")} ${testId("oats-row-facts")}`)})].filter((facts) => facts.getClientRects().length > 0).map((facts) => { const left = (kind) => facts.querySelector('[data-phrase="' + kind + '"]')?.getBoundingClientRect().left ?? null; return [left("state"), left("soul"), left("reason"), left("where")].filter((x) => x !== null); }).filter((xs) => xs.some((x, i) => i > 0 && x <= xs[i - 1])).length)`);
        check(drawn === "0", `${at} on every row the parts stand left to right in that order`, drawn);
        await page.shot(`tmux-roster-${viewport.name}-all-lost`, { targets: true });
      } finally {
        // The stage's own roster again, for the scenes after this one.
        fake({ status: { stdout: tmuxStatus() } });
      }
    },
  },
  {
    // The pilot's own screen: an agent on tmux whose session was lost (a host that was restarted prints that row for
    // every tmux agent). Its page says the reason alone; what Start does is its dialog's one line.
    stage: "tmux-roster",
    name: "the page of a tmux agent whose session was lost, opened from its row: Stopped, \"session lost\", no sentence; Start… and Retire…; Start's dialog says that it tries to continue its last conversation; after the press it is back, and its row says Working",
    run: async ({ page, at, viewport, check, fake, tmuxStatus }) => {
      const [LOST] = TMUX_ROSTER.tmux.find(([, , , how]) => how === "lost");
      await page.goto("/");
      check(await showSidebar(page, viewport), `${at} the thread list is the OATS sidebar`);
      const row = `${testId("oats-sidebar")} ${testId("oats-agent-row-threadless")}[data-instance="${LOST}"]`;
      // The longest row there is: a lost session with a long soul. On a row its state's word is "Lost" (the kernel's own),
      // with no reason after it; the title keeps "Stopped · <soul> · session lost · tmux". The state and the glyph never shrink.
      await page.until(`document.querySelector(${JSON.stringify(row)}) !== null`, 30);
      await page.evaluate(`document.querySelector(${JSON.stringify(row)}).scrollIntoView({ block: "center" })`);
      const longest = await page.evaluate(`(() => { const row = document.querySelector(${JSON.stringify(row)}); const facts = row.querySelector(${JSON.stringify(testId("oats-row-facts"))}); const box = (e) => { const r = e.getBoundingClientRect(); return [Math.round(r.left), Math.round(r.right)]; }; const part = (kind) => facts.querySelector('[data-phrase="' + kind + '"]'); const cut = (e) => e.scrollWidth > e.clientWidth + 1; const reason = part("reason"); return JSON.stringify({ title: facts.getAttribute("title"), drawn: part("state").innerText.trim(), order: [...facts.querySelectorAll("[data-phrase]")].map((p) => p.getAttribute("data-phrase")).join(" "), lines: Math.round(facts.getBoundingClientRect().height / parseFloat(getComputedStyle(facts).lineHeight)), state: getComputedStyle(part("state")).flexShrink === "0" && !cut(part("state")), reason: facts.getAttribute("data-reason"), reasonCut: reason ? cut(reason) : null, reasonRoom: reason ? reason.clientWidth >= 4 * parseFloat(getComputedStyle(facts).fontSize) - 1 || !cut(reason) : null, soulCut: cut(part("soul")), soulRoom: part("soul").clientWidth >= 12, glyphIn: box(part("where"))[1] <= box(facts)[1] + 1 && box(part("where"))[0] >= box(facts)[0], inRow: box(facts)[1] <= box(row)[1] + 1 }); })()`);
      const long = JSON.parse(longest);
      check(long.title === "Stopped · oats-contrib-developer · session lost · tmux" && long.lines === 1 && long.state === true && long.glyphIn === true && long.inRow === true, `${at} the longest row is ONE line whose title says all of it ("Stopped · oats-contrib-developer · session lost · tmux"): the state's word whole, the glyph inside the row, nothing past the row's edge`, longest);
      check(long.drawn === "Lost" && long.reason === null && long.order === "state soul where" && long.soulRoom === true, `${at} on the row a lost session reads "Lost" in the state's place, then its soul and the glyph: no reason has to fit or leave, and the soul${long.soulCut ? " shortens with \"…\"" : " is whole"}`, longest);
      await page.shot(`tmux-roster-${viewport.name}-longest-row`);
      // (The roster back at its top: bb's drawer keeps where it was scrolled, and a sidebar scrolled away reads as not shown.)
      await page.evaluate(`document.querySelector(${JSON.stringify(testId("oats-sidebar"))}).scrollIntoView({ block: "start" })`);
      const facts = await page.until(`(() => { const row = document.querySelector(${JSON.stringify(row)}); const facts = row?.querySelector(${JSON.stringify(testId("oats-row-facts"))}); return facts ? (facts.getAttribute("title") ?? "") : ""; })()`, 30);
      check(facts === "Stopped · oats-contrib-developer · session lost · tmux", `${at} its row: "Stopped", its soul, "session lost", then where it is (bb's terminal glyph, named "tmux")`, facts ?? (await page.evaluate(textOf(testId("oats-sidebar")))));
      await page.evaluate(`document.querySelector(${JSON.stringify(row)}).click()`);
      const opened = await page.until(`location.pathname.endsWith(${JSON.stringify(`/plugins/oats/agent/${LOST}`)}) && document.querySelector(${JSON.stringify(`${testId("oats-panel-header")} ${testId("oats-agent-acts")} button`)}) !== null && document.querySelector(${JSON.stringify(`${testId("oats-panel-state")}[data-outside="lost-tmux"]`)}) !== null && /Runs in/.test(document.querySelector(${JSON.stringify(testId("oats-panel-session"))})?.innerText ?? "") ? location.pathname : ""`, 30);
      check(Boolean(opened), `${at} its row opens its own page, and its Session card is read`, opened ?? (await page.evaluate("location.pathname")));
      const flat = `(e) => (e?.innerText ?? "").replace(/\\s+/g, " ").trim()`;
      const read = JSON.parse(
        await page.evaluate(
          `(() => { const flat = ${flat}; const head = document.querySelector(${JSON.stringify(testId("oats-panel-header"))}); const block = document.querySelector(${JSON.stringify(testId("oats-outside-agent-block"))}); const session = document.querySelector(${JSON.stringify(testId("oats-panel-session"))}); const whole = flat(document.querySelector(${JSON.stringify(testId("oats-agent-page"))})); return JSON.stringify({ state: flat(head?.querySelector(${JSON.stringify(`${testId("oats-panel-state")} ${testId("oats-state")}`)})), acts: [...(head?.querySelectorAll(${JSON.stringify(`${testId("oats-agent-acts")} button`)}) ?? [])].map(flat), reason: [...(head?.querySelectorAll(${JSON.stringify(`${testId("oats-panel-state")} ${testId("oats-status-part")}`)}) ?? [])].map((part) => flat(part).replace(/^· /, "")).join(" | "), kind: head?.querySelector(${JSON.stringify(testId("oats-panel-state"))})?.getAttribute("data-outside") ?? null, alone: block !== null, times: (whole.match(/session lost/g) ?? []).length, session: flat(session), sentence: /Nobody stopped|without OATS stopping|Start tries|To carry on|Last started/.test(whole) }); })()`,
        ),
      );
      check(read.state === "Stopped" && read.kind === "lost-tmux" && read.reason === "session lost" && read.alone === false && read.times === 1 && read.sentence === false, `${at} its page says "Stopped · session lost" on its header's state line, once: nothing of it alone under the tabs, no sentence, and no "Last started"`, JSON.stringify(read));
      check(JSON.stringify(read.acts) === JSON.stringify(["Start…", "Retire…"]), `${at} its acts are Start… and Retire…, and no Restart (nothing runs)`, JSON.stringify(read.acts));
      check(/^SESSION\b/i.test(read.session) && /Runs in tmux/.test(read.session) && !/Last started|Stopped/.test(read.session), `${at} its Session card: that it runs in tmux, and no "Stopped <time>" (the kernel records no time of a loss, and an earlier stop's is not this one's)`, read.session);
      // The page's header and its Session card are as high as what they hold: no empty room between two lines.
      const pageGaps = JSON.parse(await page.evaluate(gapsIn(`${testId("oats-panel-header")}, ${testId("oats-panel-session")}`)));
      check(pageGaps.length === 2 && tight(pageGaps), `${at} the page's header and its Session card hold no gap over ${MAX_GAP} px between two of their lines (heights ${pageGaps.map((block) => block.height).join(", ")} px)`, loose(pageGaps));
      await page.shot(`tmux-roster-${viewport.name}-lost-page`, { targets: true });
      // Start…: the dialog's ONE consequence line for a lost tmux agent; nothing starts on the press.
      await page.evaluate(click("oats-agent-act-start"));
      await page.until(phaseIs("ready"), 30);
      const before = await dialog(page);
      const says = await page.evaluate(saysNow);
      check(before.about === LOST && before.act === "Start" && before.off === false && says === JSON.stringify(["Tries to continue its last conversation; else starts fresh."]) && !/full mode|Claude may|how to load/.test(before.body), `${at} Start… opens the dialog for that agent: its one line says that it tries to continue its last conversation, else starts fresh; nothing of bb's full mode`, JSON.stringify({ before, says }));
      const dialogGaps = JSON.parse(await page.evaluate(gapsIn(`${testId("oats-modal")} [role="dialog"]`))); // (the dialog's own box: oats-modal is the screen's veil)
      check(dialogGaps.length === 1 && tight(dialogGaps), `${at} the dialog is as high as what it holds: no gap over ${MAX_GAP} px between two of its lines or at its edges (${dialogGaps[0]?.height} px)`, loose(dialogGaps));
      await page.shot(`tmux-roster-${viewport.name}-lost-start-before`, { targets: true });
      // The press: the kernel's recorded answer to a resume that brought the conversation back (test/fixtures/lifecycle/tmux-start-resume.json,
      // for this agent's name). The result says what the kernel answered, with the command that attaches; no thread opens.
      const resumed = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "..", "test", "fixtures", "lifecycle", "tmux-start-resume.json"), "utf8").replaceAll("lost-tmux-developer", LOST);
      try {
        // From the press on OATS says it runs; its status takes a few seconds to read, as a real roster does after an act:
        // the result is on screen before the window's roster is one read after the act.
        fake({ status: { stdout: tmuxStatus({ [LOST]: "running" }), sleepMs: 5000 }, "session start --resume": { stdout: resumed, sleepMs: 1500 } });
        await page.evaluate(click("oats-confirm-act"));
        await page.until(phaseIs("done"), 30);
        // BEHIND THE RESULT (the lead's L13): the page's header does not say the old state plainly ("Stopped · session lost",
        // beside "is back in its last conversation"): it says "Reading…", and offers no act, until the roster is read again.
        const header = `(() => { const head = document.querySelector(${JSON.stringify(testId("oats-panel-header"))}); const state = head?.querySelector(${JSON.stringify(testId("oats-panel-state"))}); return JSON.stringify({ reading: state?.querySelector(${JSON.stringify(testId("oats-reading"))})?.innerText.trim() ?? null, state: state?.querySelector(${JSON.stringify(testId("oats-state"))})?.innerText.trim() ?? null, acts: [...(head?.querySelectorAll(${JSON.stringify(`${testId("oats-agent-acts")} button`)}) ?? [])].map((b) => b.disabled) }); })()`;
        const behind = await page.evaluate(header);
        check(behind === JSON.stringify({ reading: "Reading…", state: null, acts: [true, true] }), `${at} behind the result the page's header says "Reading…" in the state's place, never "Stopped · session lost", and its acts are off`, behind);
        const done = await dialog(page);
        const where = await page.evaluate(`document.querySelector(${JSON.stringify(testId("oats-start-where"))})?.innerText.replace(/\\s+/g, " ").trim() ?? ""`);
        check(done.body.includes("Overnight sweep developer is back in its last conversation.") && !done.body.includes("started fresh") && where.startsWith("Attach:") && where.includes("oats session attach --home ") && where.includes(LOST) && done.focus === "oats-confirm-close", `${at} after the press the result says that it is back in its last conversation, with the command that attaches to it; the focus is on Close`, JSON.stringify({ done, where }));
        await page.shot(`tmux-roster-${viewport.name}-lost-start-done`, { targets: true });
        // The roster is read again (within the ten seconds "Reading…" can stand): the header says what it says now.
        const settled = (await page.until(`(() => { const now = ${header}; return JSON.parse(now).reading === null ? now : ""; })()`, 20)) ?? null;
        check(settled !== null && JSON.parse(settled).state === "Working" && JSON.parse(settled).acts.every((off) => off === false), `${at} once the roster is read again the header says "Working", with its acts on`, settled ?? (await page.evaluate(header)));
        // OATS says it runs: its row says so, at its kernel place, with no reason.
        fake({ status: { stdout: tmuxStatus({ [LOST]: "running" }) } });
        await page.evaluate(click("oats-confirm-close"));
        check(Boolean(await page.until(closed, 10)), `${at} Close closes the dialog`);
        check(await showSidebar(page, viewport), `${at} the sidebar is shown again`);
        const after = await page.until(`(() => { const facts = document.querySelector(${JSON.stringify(`${row} ${testId("oats-row-facts")}`)}); const text = facts ? (facts.getAttribute("title") ?? "") : ""; return text === "Working · oats-contrib-developer · tmux" ? text : ""; })()`, 60);
        check(after === "Working · oats-contrib-developer · tmux", `${at} its row then says "Working", its soul and where it is: no "session lost" any more`, after ?? (await page.evaluate(textOf(row))));
        await page.evaluate(`document.querySelector(${JSON.stringify(row)})?.scrollIntoView({ block: "center" })`);
        await page.shot(`tmux-roster-${viewport.name}-lost-row-after`);
      } finally {
        // The stage's own roster again, for the next theme and width: the agent's session lost.
        fake({ status: { stdout: tmuxStatus() } });
        await page.until(`(() => { const facts = document.querySelector(${JSON.stringify(`${row} ${testId("oats-row-facts")}`)}); return facts && /session lost/.test(facts.getAttribute("title") ?? "") ? "1" : ""; })()`, 60);
      }
    },
  },
  {
    // The pilot's own roster shape (tmux-roster.mjs PILOT_ROSTER): eight agents on tmux, every session lost, one a
    // child of another. Before the one tree every one of the eight was a flat root, and a fold had nothing to fold.
    stage: "tmux-roster",
    name: "the pilot's own roster shape: eight agents on tmux, one a child of another: seven rows as the page loads, its one parent closed; opened, the child under it; a child that waits marks its closed parent and carries it to the top",
    run: async ({ page, at, viewport, check, fake, tmuxStatus, pilot, threads, ownThreads }) => {
      const names = PILOT_ROSTER.tmux.map(([instance]) => instance);
      const [CHILD, , PARENT] = PILOT_ROSTER.tmux.find(([, , parent]) => parent !== null);
      const rowsOf = `[...document.querySelectorAll(${JSON.stringify(`${testId("oats-sidebar")} ${testId("oats-tree")} ${testId("oats-agent-row")}, ${testId("oats-sidebar")} ${testId("oats-tree")} ${testId("oats-agent-row-threadless")}`)})]`;
      // A row's words are read from its line's TITLE, which always says all of them ("tmux" for the glyph included): a narrow row may not draw its reason.
      const factsOf = (instance) => `(document.querySelector(${JSON.stringify(`${testId("oats-sidebar")} ${testId("oats-agent-row-threadless")}[data-instance="${instance}"] ${testId("oats-row-facts")}`)})?.getAttribute("title") ?? "")`;
      try {
        fake({ status: { stdout: tmuxStatus({}, PILOT_ROSTER) } });
        // In the pilot's image pass (by hand) the test container's own bb threads are archived for this scene: this roster
        // has no agent on a thread, so they would all stand under it as "Other threads", which is nothing of the pilot's.
        if (pilot) ownThreads.away(threads);
        await page.goto("/");
        check(await showSidebar(page, viewport, { fold: "asLoaded" }), `${at} the thread list is the OATS sidebar`);
        // Waited for: the roster is the pilot's, and nobody else (the stage's own agents are gone from it). As the page
        // loads the parent is CLOSED: seven rows, one chevron, and no mark of a hidden row (the child does not wait).
        const roots = names.filter((name) => name !== CHILD);
        const seven = await page.until(`(() => { const rows = ${rowsOf}; const who = rows.map((row) => row.getAttribute("data-instance")); return JSON.stringify([...who].sort()) === ${JSON.stringify(JSON.stringify([...roots].sort()))} ? JSON.stringify(who) : ""; })()`, 60);
        check(Boolean(seven), `${at} as the page loads the roster is seven rows: the pilot's eight agents less the child, whose parent is closed`, seven ?? (await page.evaluate(textOf(testId("oats-sidebar")))));
        if (pilot) check(Boolean(await page.until(`document.querySelectorAll(${JSON.stringify(`${testId("oats-sidebar")} ${testId("oats-other-row")}`)}).length === 0 ? "1" : ""`, 30)), `${at} (image pass) no thread of the test container's own stands under the roster`, await page.evaluate(textOf(testId("oats-sidebar"))));
        const closed = JSON.parse(await folds(page));
        check(JSON.stringify(closed) === JSON.stringify({ parents: 1, closed: 1, inside: [] }), `${at} ${PARENT} alone has a chevron, closed, and carries no mark of what it hides (its child does not wait)`, JSON.stringify(closed));
        await page.shot(`pilot-roster-${viewport.name}-closed`, { targets: true });
        // Opened by its chevron: the child is under its parent, one step in.
        await page.evaluate(toggleOf(PARENT));
        const eight = await page.until(`${rowsOf}.length === ${names.length} ? "1" : ""`, 15);
        const tree = depths(JSON.parse(await treeRows(page)));
        const before = JSON.parse(seven ?? "null");
        const placed = tree.findIndex((row) => row.who === CHILD) === tree.findIndex((row) => row.who === PARENT) + 1 && misplaced(tree, { [CHILD]: PARENT }).length === 0;
        check(Boolean(eight) && placed && tree.filter((row) => row.depth === 0).length === roots.length && JSON.stringify(tree.filter((row) => row.who !== CHILD).map((row) => row.who)) === JSON.stringify(before), `${at} opened, ${CHILD} is the row under ${PARENT}, one step in, and the seven roots stay where they were`, JSON.stringify(tree));
        const said = JSON.parse(await page.evaluate(`JSON.stringify([${factsOf(PARENT)}, ${factsOf(CHILD)}])`));
        const LOST = "Stopped · oats-developer · session lost · tmux";
        check(said.every((line) => line === LOST), `${at} the parent and its child each say, whole in the line's title, "${LOST}"`, JSON.stringify(said));
        const measured = JSON.parse(await rowLines(page));
        check(measured.over === 0 && measured.wrapped === 0 && measured.edgeCut === 0 && measured.whereCut === 0 && measured.untitled === 0, `${at} a row under its parent keeps to its lines: nothing past its edge, its last phrase whole`, JSON.stringify(measured));
        await page.shot(`pilot-roster-${viewport.name}-opened`, { targets: true });
        // Closed again, and then the child WAITS on a person (its session runs again and carries a claim): its parent,
        // itself still stopped, stands first and carries the child's mark after its own word.
        await page.evaluate(toggleOf(PARENT));
        await page.until(`${rowsOf}.length === ${roots.length} ? "1" : ""`, 15);
        fake({ status: { stdout: tmuxStatus({ [CHILD]: "waiting" }, PILOT_ROSTER) } });
        const marked = await page.until(`(() => { const rows = ${rowsOf}; const first = rows[0]; return first?.getAttribute("data-instance") === ${JSON.stringify(PARENT)} && first.querySelector(${JSON.stringify(`${testId("oats-row-inside")} [data-mark][data-state="needs-you"]`)}) !== null ? String(rows.length) : ""; })()`, 60);
        const parentSaid = await page.evaluate(factsOf(PARENT));
        // (The hidden row's mark stands after the parent's own word, in the line; the line's title stays the parent's own words.)
        check(marked === String(roots.length) && parentSaid === "Stopped · oats-developer · session lost · tmux", `${at} with ${CHILD} waiting and its parent closed: ${PARENT} is the first of the seven rows, says what it is itself ("Stopped", "session lost") and carries the mark of the agent that waits under it after its own word`, `${marked}; ${parentSaid}`);
        await page.shot(`pilot-roster-${viewport.name}-child-waits-closed`, { targets: true });
        await page.evaluate(toggleOf(PARENT));
        const waits = await page.until(`(() => ${factsOf(CHILD)}.startsWith("Needs you") ? JSON.stringify(${rowsOf}.slice(0, 2).map((row) => row.getAttribute("data-instance"))) : "")()`, 15);
        const after = JSON.parse(await folds(page));
        check(waits === JSON.stringify([PARENT, CHILD]) && after.inside.length === 0, `${at} opened, ${CHILD} is the second row and says "Needs you"; its parent no longer carries its mark (the row itself is there)`, `${waits}; ${JSON.stringify(after)}`);
        await page.shot(`pilot-roster-${viewport.name}-child-waits-opened`, { targets: true });
      } finally {
        // The stage's own roster again, for the next theme and width (and, in the image pass, the threads it archived).
        fake({ status: { stdout: tmuxStatus() } });
        if (pilot) ownThreads.back();
        await page.until(`${rowsOf}.some((row) => row.getAttribute("data-instance") === ${JSON.stringify(TMUX_ROSTER.tmux[0][0])}) ? "1" : ""`, 60);
      }
    },
  },
  {
    // By hand only (LIVE_UI_STATUS_FILE): a real deployment's roster, for a look at it. Nothing of it
    // is printed but counts; its images stay with whoever ran it.
    stage: "local-roster",
    name: "a real deployment's roster, drawn from its own oats status, with the release's default pages (the setting left as installed)",
    run: async ({ page, at, viewport, check }) => {
      await page.goto("/");
      check(await showSidebar(page, viewport), `${at} the thread list is the OATS sidebar`);
      const rows = await page.until(`(() => { const n = document.querySelectorAll(${JSON.stringify(`${testId("oats-sidebar")} ${testId("oats-agent-row")}, ${testId("oats-sidebar")} ${testId("oats-agent-row-threadless")}`)}).length; return n > 0 ? String(n) : ""; })()`, 30);
      const measured = await rowLines(page);
      const read = JSON.parse(measured);
      check(Number(rows) > 0 && read.over === 0 && read.wrapped === 0 && read.edgeCut === 0 && read.soulGone === 0 && read.misordered === 0 && read.untitled === 0, `${at} the roster is drawn: no row over three lines, no second block on two, nothing past a row's edge, no soul squeezed to nothing, every name whole in its title (the last phrase of a row whose thread is gone may be cut): ${measured}`, measured);
      await page.shot(`local-roster-${viewport.name}-sidebar`);
    },
  },
];
