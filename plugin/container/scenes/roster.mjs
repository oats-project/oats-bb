// The roster's live scenes: the sidebar's tree, an agent's thread with its header row, the states
// of the dot, and the sidebar while OATS cannot be read. (container/live-ui.mjs says what a scene is.)
import { hostname } from "node:os";
import { showSidebar, testId, textOf, texts, visible } from "../browser.mjs";
import { TMUX_ROSTER } from "../tmux-roster.mjs";

// The machine's name, as the checks' container was given it (ci.sh: MACHINE_NAME, the container's
// host name, by which bb names its machine). A container started another way has no name set: the
// host's own is then what bb shows, and the check says so if it is an id.
const MACHINE = process.env.MACHINE_NAME || hostname();

/** The thread's own row, read once it says `state`: → `{ line, act }` (the status line's words, and its button's), or null. The read waits on the row. */
const statusOf = async (page, state, want = null) => {
  const line = testId("oats-status-line");
  // The line's words as a person reads them: the state's word, then each part with the separator
  // before it; and its act (Start, Restart, Retry) apart. The way to the panel is not the line's words.
  // `want` (a RegExp) is what the line is waited for: a part that arrives after the state (a stopped
  // agent's "since", read from its events) is waited on, not read at once. When the wait runs out
  // the line is read as it is, for the failing check to print.
  const read = (wanted) =>
    `(() => { const e = document.querySelector(${JSON.stringify(`${testId("oats-identity-row")} ${line}`)}); if (!e || e.getAttribute("data-state") !== ${JSON.stringify(state)}) return ""; const flat = (x) => x.innerText.replace(/\\s+/g, " ").trim(); const words = [flat(e.querySelector(${JSON.stringify(testId("oats-state"))})), ...[...e.querySelectorAll(${JSON.stringify(testId("oats-status-part"))})].map(flat)].join(" "); if (${wanted === null ? "false" : `!new RegExp(${JSON.stringify(wanted.source)}).test(words)`}) return ""; return JSON.stringify({ line: words, act: e.querySelector(${JSON.stringify(testId("oats-status-act"))})?.innerText.trim() ?? null, panel: e.querySelector(${JSON.stringify(testId("oats-open-panel"))})?.innerText.trim() ?? null }); })()`;
  const found = (await page.until(read(want), 30)) ?? (want === null ? undefined : await page.evaluate(read(null)));
  return found ? JSON.parse(found) : null;
};
/** What the page shows of the thread's row when a read of it found nothing: for a failing check's line. */
/**
 * Every roster row of the sidebar measured: a row is at most three lines (the name on one or two,
 * cut only after the second; the second block on ONE line, where only the soul may be cut). Counts
 * only, never a name: `{ rows, over, wrapped, nameCut, soulCut, soulGone, whereCut, edgeCut, untitled }`
 * (`soulGone`: a soul squeezed to nothing; `whereCut`: the last phrase cut; `edgeCut`: something past the
 * row's edge, or the state's word cut; `untitled`: a name with no title holding it whole).
 */
const rowLines = (page) =>
  page.evaluate(
    `(() => { const s = document.querySelector(${JSON.stringify(testId("oats-sidebar"))}); const rows = [...s.querySelectorAll(${JSON.stringify(`${testId("oats-agent-row")}, ${testId("oats-agent-row-threadless")}`)})].filter((r) => r.getClientRects().length > 0); const linesOf = (e) => Math.round(e.getBoundingClientRect().height / parseFloat(getComputedStyle(e).lineHeight)); const cutOf = (e) => e.scrollWidth > e.clientWidth + 1; let over = 0, wrapped = 0, nameCut = 0, soulCut = 0, soulGone = 0, whereCut = 0, edgeCut = 0, untitled = 0; for (const row of rows) { const name = row.querySelector(${JSON.stringify(testId("oats-row-name"))}); const facts = row.querySelector(${JSON.stringify(testId("oats-row-facts"))}); const n = linesOf(name), f = linesOf(facts); if (n + f > 3 || n > 2) over += 1; if (f !== 1) wrapped += 1; if (name.scrollHeight > name.clientHeight + 1) nameCut += 1; if (!name.getAttribute("title")) untitled += 1; const soul = facts.querySelector('[data-phrase="soul"]'); if (soul && cutOf(soul)) soulCut += 1; if (soul && soul.getBoundingClientRect().width < 8) soulGone += 1; if ([...facts.querySelectorAll('[data-phrase="where"]')].some(cutOf)) whereCut += 1; const right = facts.getBoundingClientRect().right; if ([...facts.querySelectorAll("[data-phrase], [data-sep]")].some((p) => p.getBoundingClientRect().right > right + 1) || cutOf(facts.querySelector('[data-phrase="state"]'))) edgeCut += 1; } return JSON.stringify({ rows: rows.length, over, wrapped, nameCut, soulCut, soulGone, whereCut, edgeCut, untitled }); })()`,
  );
const rowText = (page) => page.evaluate(textOf(testId("oats-identity-row")));

export default [
  {
    stage: "fixtures",
    name: "the sidebar, an agent's thread, a thread that is no agent",
    run: async ({ page, at, viewport, threads, fixtureThreads, check, sleep }) => {
      // the sidebar with the tree
      await page.goto("/");
      check(await showSidebar(page, viewport), `${at} the thread list is the OATS sidebar`);
      await page.until(visible(testId("oats-tree")), 30);
      const rows = await page.evaluate(`[...document.querySelectorAll(${JSON.stringify(testId("oats-agent-row"))})].map((e) => e.getAttribute("data-sidebar-thread-id"))`);
      const expected = fixtureThreads.filter((thread) => thread.id !== "thr_plain").map((thread) => threads.get(thread.id).id);
      check(rows.length === 7 && expected.every((id) => rows.includes(id)), `${at} the tree draws the 7 bb agents, joined by bb's own thread ids`, JSON.stringify(rows));
      const child = `${testId("oats-agent-row")}[data-sidebar-thread-id="${threads.get("thr_mockups").id}"]`;
      check(await page.evaluate(`document.querySelector(${JSON.stringify(child)})?.className.includes("pl-6") === true`), `${at} a child is indented under its parent`);
      // The machine is shown by the name bb gives it, which is the host's own (G1): a name, never an id.
      check(!/^[0-9a-f]{12}$/.test(MACHINE), `${at} the machine the checks run on has a name (${MACHINE}), not a container's id: start the container through ci.sh, or with --hostname and MACHINE_NAME`);
      check((await page.evaluate(textOf(testId("oats-workspace-line")))) === `oats · ${MACHINE} · 8 agents`, `${at} the workspace line: the workspace, the machine by its name (${MACHINE}), and as many agents as rows`, await page.evaluate(textOf(testId("oats-workspace-line"))));
      check((await page.evaluate(textOf(testId("oats-needs-line")))) === "! 3 need you", `${at} "3 need you", with the mark of an agent that waits`, await page.evaluate(textOf(testId("oats-needs-line"))));
      // What the image's name says: every agent a row, each with its state in a word and its soul; the
      // one that runs in tmux among them; the roster first, then who waits, New agent, the pages.
      const drawn = JSON.parse(await page.evaluate(`JSON.stringify({ facts: ${texts(`${testId("oats-tree")} ${testId("oats-row-facts")}`)}, order: [...document.querySelectorAll(${JSON.stringify(["oats-tree", "oats-needs-line", "oats-new-agent", "oats-pages"].map(testId).join(", "))})].map((e) => e.getAttribute("data-testid")), marks: document.querySelectorAll(${JSON.stringify(`${testId("oats-tree")} [data-mark]`)}).length })`));
      const WORDS = /^(Needs you|Working|Idle|Stopped|Failed|Unreachable) · \S/;
      check(
        drawn.facts.length === 8 && drawn.marks === 8 && drawn.facts.every((line) => WORDS.test(line)) && drawn.facts.includes("Working · oats-developer · tmux") && JSON.stringify(drawn.order) === JSON.stringify(["oats-tree", "oats-needs-line", "oats-new-agent", "oats-pages"]),
        `${at} eight agents, eight rows: each its mark, its state in a word and its soul, the one in tmux among them; then who waits, New agent and the pages`,
        JSON.stringify(drawn),
      );
      // No row's second line is cut: each is as wide as its text needs, on as many lines as it takes.
      const cut = await page.evaluate(`[...document.querySelectorAll(${JSON.stringify(`${testId("oats-tree")} ${testId("oats-row-facts")}`)})].filter((e) => e.scrollWidth > e.clientWidth + 1).map((e) => e.innerText)`);
      check(cut.length === 0, `${at} no row's state and soul are cut`, JSON.stringify(cut));
      const others = await page.evaluate(texts(testId("oats-other-row")));
      check(others.some((text) => text.includes("Plain bb thread")), `${at} the thread that is no agent is under Other threads`, JSON.stringify(others));
      await page.shot(`a13-${viewport.name}-sidebar`);

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
      // The image's name says a thread with its row: the row says where the agent is in words, then who it is, each fact with its label.
      const line = await statusOf(page, "working");
      const facts = await page.evaluate(texts(`${testId("oats-identity-facts")} > *`));
      check(
        line !== null && /^Working( · started .+)?$/.test(line.line) && line.act === "Stop" && line.panel === "Instance panel" && JSON.stringify(facts) === JSON.stringify(["instance of oats-desktop-developer", "Parent Redesign ui lead", "Messaging ID desktop-mockups-developer"]),
        `${at} the row: the state in words, the act that applies (Stop) and the way to the instance panel, then the soul, the parent and the messaging id, each with the Desktop's label`,
        JSON.stringify({ line, facts }),
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
      check(leadLine !== null && leadLine.act === "Stop", `${at} a working agent's line offers Stop`, JSON.stringify(leadLine));
      await page.evaluate(`document.querySelector(${JSON.stringify(`${testId("oats-status-line")} ${testId("oats-status-act")}`)}).click()`);
      // The dialog is titled with the agent the kernel's plan names, once the plan is read ("Stop an agent" until then).
      const asked = await page.until(`(() => { const m = document.querySelector(${JSON.stringify(testId("oats-modal"))}); const t = m?.querySelector("h2")?.innerText.trim() ?? ""; return /^Stop .+\\?$/.test(t) ? t : ""; })()`, 20);
      check(asked === "Stop Redesign ui lead?", `${at} Stop on the thread's line opens the stop confirmation of that agent, by its one name, once the plan is read`, asked ?? (await page.evaluate(`document.querySelector(${JSON.stringify(testId("oats-modal"))})?.innerText.slice(0, 300) ?? "no dialog"`)));
      await page.shot(`a13-${viewport.name}-thread-stop-asked`, { targets: true });
      await page.press("Escape");
      await page.until(`document.querySelector(${JSON.stringify(testId("oats-modal"))}) === null`, 10);

      // the thread of an agent that needs you: its row is the open one, with the "!" and "Needs you"
      const release = threads.get("thr_release");
      await page.goto(`/projects/${release.projectId}/threads/${release.id}`);
      // The thread itself says it first (S1), before anything of the sidebar is opened over it: the
      // state's word, since when the agent has waited, and what it asked.
      const needs = await statusOf(page, "needs-you");
      check(
        needs !== null && /^! Needs you · waiting .+ \(since [^)]+\) · Green light at 9f2e1c\? Second reader done\.$/.test(needs.line) && needs.act === "Answer",
        `${at} the thread of an agent that waits says so in its own row: "Needs you", since when, its question, and Answer as the way to reply`,
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
      const marked = await page.until(`(() => { const row = document.querySelector(${JSON.stringify(open)}); return row?.querySelector('[data-mark][data-state="needs-you"]')?.innerText.trim() === "!" && row.querySelector(${JSON.stringify(testId("oats-row-facts"))})?.innerText.replace(/\\s+/g, " ").trim().startsWith("Needs you · ") ? getComputedStyle(row).backgroundColor : ""; })()`, 30);
      const resting = await page.evaluate(`getComputedStyle(document.querySelector(${JSON.stringify(`${testId("oats-agent-row")}[data-sidebar-thread-id="${mockups.id}"]`)})).backgroundColor`);
      check(Boolean(marked) && marked !== resting, `${at} the open row of an agent that needs you has its "!" and says "Needs you", on the open row's background`, `${marked} against ${resting}`);
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
      // The time comes from the agent's events, after the state: waited for. Then the interim warning (the outside feature's sentence): its composer is live.
      const STOPPED = /^Stopped · since (\w+ \d+, )?\d\d:\d\d · A message sent here in bb starts it again without OATS\. Use Start\.$/;
      const stopped = await statusOf(page, "stopped", STOPPED);
      check(stopped !== null && STOPPED.test(stopped.line) && stopped.act === "Start", `${at} the thread of a stopped agent says "Stopped", since when (its last recorded stop), that a message here starts it again without OATS, with Start`, stopped === null ? await rowText(page) : JSON.stringify(stopped));
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
    name: "the event path: a claim the kernel records is in the tree while the status read is still held, and the status read then confirms it",
    run: async ({ page, at, viewport, threads, check, sleep, record, recordFor, snapshot }) => {
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
      const during = snapshot();
      check(
        shown !== null && waits(during) && Date.parse(during.at) < recorded,
        `${at} the tree shows the agent waiting ${shown === null ? "never" : `${shown} ms`} after the kernel recorded it, from its events alone: the snapshot is still the status read from before the record (the status is held ${HELD_MS} ms)`,
        JSON.stringify({ shown, ok: during.ok, at: during.at, recorded: new Date(recorded).toISOString(), waits: waits(during) }),
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
      check(cut !== null && cut.line === "Unreachable · OATS cannot reach its session" && cut.act === "Retry", `${at} the thread of an agent the kernel cannot reach says "Unreachable", in a person's words, with Retry`, cut === null ? await rowText(page) : JSON.stringify(cut));
      await page.shot(`a16-${viewport.name}-thread-unreachable`, { targets: true });

      const failed = threads.get("thr_harvest");
      await page.goto(`/projects/${failed.projectId}/threads/${failed.id}`);
      const ended = await statusOf(page, "error");
      check(ended !== null && ended.line === "Failed · Its session ended. Restart it, or send a message here." && ended.act === "Restart", `${at} the thread of an agent whose session fell back to a shell says "Failed", that its session ended and what brings it back (the outside feature's sentence), with Restart`, ended === null ? await rowText(page) : JSON.stringify(ended));
      await page.shot(`a16-${viewport.name}-thread-failed`, { targets: true });

      check(await showSidebar(page, viewport), `${at} the thread list is the OATS sidebar`);
      const factsOf = (id) => `(document.querySelector(${JSON.stringify(`${testId("oats-agent-row")}[data-sidebar-thread-id="${id}"] ${testId("oats-row-facts")}`)})?.innerText ?? "").replace(/\\s+/g, " ").trim()`;
      const words = await page.until(`(() => { const rows = [${factsOf(unreachable.id)}, ${factsOf(failed.id)}]; return rows[0].startsWith("Unreachable · ") && rows[1].startsWith("Failed · ") ? JSON.stringify(rows) : ""; })()`, 30);
      check(Boolean(words), `${at} in the sidebar the two rows say "Unreachable" and "Failed", each beside its mark`, words ?? (await page.evaluate(`JSON.stringify([${factsOf(unreachable.id)}, ${factsOf(failed.id)}])`)));
      // And the agent whose bb thread is gone stays in the roster (S3): bb has no thread of its id, and the row says so (the outside feature's words).
      const gone = await page.until(`(document.querySelector(${JSON.stringify(`${testId("oats-agent-row-threadless")}[data-instance="weekly-digest-helper"] ${testId("oats-row-facts")}`)})?.innerText ?? "").replace(/\\s+/g, " ").trim()`, 30);
      check(gone === "Stopped · deleted in bb", `${at} the agent whose bb thread is gone stays in the roster, and says "Stopped", then the reason, "deleted in bb"`, gone ?? (await page.evaluate(textOf(testId("oats-tree")))));
      // At 1280 the image of the failed thread already shows the sidebar's rows; at 390 they are in bb's drawer.
      // The detached row says what happened in the soul's place ("deleted in bb"), which does not give way: it obeys the row's rule too:
      // one line, nothing past the row's edge, the state's word whole (and the soul of every other row still there with its "…").
      const detachedRows = await rowLines(page);
      const d = JSON.parse(detachedRows);
      check(d.over === 0 && d.wrapped === 0 && d.edgeCut === 0 && d.soulGone === 0 && d.untitled === 0, `${at} the rows of this roster, the one whose thread is gone included, keep to three lines: no second block on two, no soul squeezed to nothing, nothing past the row's edge`, detachedRows);
      if (viewport.mobile) await page.shot(`a16-${viewport.name}-states`);
    },
  },
  {
    stage: "no-oats",
    name: "stale: OATS cannot be read after it was: the one notice (its age once, the acts held, Retry), the tree as last read",
    run: async ({ page, at, viewport, threads, check }) => {
      await page.goto("/");
      check(await showSidebar(page, viewport), `${at} the thread list is still drawn`);
      // A titled notice in a person's words, with the age of what is still shown and Retry.
      const notice = await page.until(`(() => { const e = document.querySelector(${JSON.stringify(testId("oats-unreadable"))}); const t = e?.querySelector("h3")?.innerText ?? ""; return t === ${JSON.stringify(`OATS is not installed on ${MACHINE}`)} ? JSON.stringify({ title: t, code: e.getAttribute("data-code"), text: e.innerText.replace(/\\s+/g, " "), retry: [...e.querySelectorAll("button")].some((b) => b.innerText.trim() === "Retry"), settings: [...e.querySelectorAll("a")].some((a) => a.innerText.trim() === "Open settings") }) : ""; })()`, 30);
      const said = notice ? JSON.parse(notice) : null;
      check(said !== null && said.code === "OATS_NOT_FOUND" && /Showing what was read /.test(said.text) && said.retry && said.settings, `${at} the notice says what is missing in a person's words, how old what is shown is, with Retry and Open settings: ${said?.title ?? ""}`, await page.evaluate(textOf(testId("oats-sidebar"))));
      // One drawing, the age said once and in one form, and the acts held: the sentence names Retry first.
      const AGE = "(less than a minute ago|\\d+ min ago|\\d+ h ago)";
      const once = JSON.parse(await page.evaluate(`JSON.stringify({ held: ${textOf(`${testId("oats-sidebar")} ${testId("oats-held")}`)}, ages: (document.querySelector(${JSON.stringify(testId("oats-sidebar"))}).innerText.match(/${AGE}/g) ?? []).length, second: document.querySelector(${JSON.stringify(testId("oats-last-observation"))}) !== null })`));
      check(once.held === "Press Retry: Stop, Start, Restart, Retire and New agent return when OATS is read again." && once.ages === 1 && once.second === false, `${at} the notice says that the acts are held, Retry first, and the age of what is shown once, in one form`, JSON.stringify(once));
      // The roster stays: the agents as last read, joined to their threads, never bb's flat list.
      const rows = await page.evaluate(`[...document.querySelectorAll(${JSON.stringify(testId("oats-agent-row"))})].map((e) => e.getAttribute("data-sidebar-thread-id"))`);
      check(rows.length >= 6 && rows.includes(threads.get("thr_release").id), `${at} the tree is still drawn, as last read (${rows.length} agents)`, JSON.stringify(rows));
      // "New agent" is held with the acts: in its place, off, with the reason.
      const newAgent = await page.evaluate(`(() => { const b = document.querySelector(${JSON.stringify(`${testId("oats-sidebar")} ${testId("oats-new-agent")}`)}); return b ? JSON.stringify({ text: b.innerText.trim(), off: b.disabled, why: b.title }) : "none"; })()`);
      check(newAgent === JSON.stringify({ text: "New agent", off: true, why: "Comes back when OATS is read again" }), `${at} "New agent" stays in its place, off, with the reason`, newAgent);
      await page.shot(`a14-${viewport.name}-sidebar`);

      const target = threads.get("thr_redesign");
      await page.evaluate(`document.querySelector('${testId("oats-agent-row")}[data-sidebar-thread-id="${target.id}"]').click()`);
      const opened = await page.until(`location.pathname.endsWith("/threads/${target.id}")`, 15);
      check(Boolean(opened), `${at} a thread opens from the tree`, await page.evaluate("location.pathname"));
      // The thread's own row is still there, from the last roster: its line as last read, and under it
      // the same notice on one line: the title, the age, that the acts are held, Retry.
      const kept = await page.until(`(() => { const row = document.querySelector(${JSON.stringify(testId("oats-identity-row"))}); const said = row?.querySelector(${JSON.stringify(`${testId("oats-unreadable")}[data-compact]`)}); return said ? JSON.stringify({ line: row.querySelector(${JSON.stringify(testId("oats-status-line"))}).getAttribute("data-state"), said: said.innerText.replace(/\\s+/g, " ").trim() }) : ""; })()`, 15);
      const row = kept ? JSON.parse(kept) : null;
      check(
        row !== null && row.line === "working" && new RegExp(`^OATS is not installed on ${MACHINE} Showing what was read ${AGE}\\. Press Retry: Stop, Start, Restart, Retire and New agent return when OATS is read again\\. Retry$`).test(row.said),
        `${at} the open thread keeps its OATS row, from the last roster, with the one notice on a line: its age, the acts held, Retry`,
        kept ?? (await page.evaluate(textOf(testId("oats-identity-row")))),
      );
      // Holding is SHOWN: the act that applies to this agent (Stop: it works) stays on its line, off, with the reason.
      const heldAct = await page.evaluate(`(() => { const b = document.querySelector(${JSON.stringify(`${testId("oats-identity-row")} ${testId("oats-status-act")}`)}); return b ? JSON.stringify({ text: b.innerText.trim(), off: b.disabled, why: b.title }) : "none"; })()`);
      check(heldAct === JSON.stringify({ text: "Stop", off: true, why: "Comes back when OATS is read again" }), `${at} the act on the thread's line (Stop) is held: in its place, off, with the reason`, heldAct);
      await page.shot(`a14-${viewport.name}-thread`, { targets: true });

      // The home keeps what it showed, under the same notice.
      await page.goto("/plugins/oats/home");
      const home = await page.until(`(() => { const e = document.querySelector(${JSON.stringify(`${testId("oats-home-page")} ${testId("oats-unreadable")}`)}); const cards = document.querySelectorAll(${JSON.stringify(testId("oats-needs-card"))}).length; return e && cards > 0 ? JSON.stringify({ title: e.querySelector("h3")?.innerText ?? "", text: e.innerText.replace(/\\s+/g, " "), cards }) : ""; })()`, 30);
      const shown = home ? JSON.parse(home) : null;
      check(shown !== null && /^OATS is not installed on /.test(shown.title) && /Showing what was read /.test(shown.text) && shown.cards === 3, `${at} the home keeps its three cards under the same notice, with the age of what it shows`, home ?? (await page.evaluate(textOf(testId("oats-home-page")))));
      // One full notice on a screen: beside the page's notice the sidebar says one line, how old the roster is, and Retry.
      if (viewport.mobile) check(await showSidebar(page, viewport), `${at} the sidebar opens over the home`);
      const oneLine = await page.until(`(() => { const s = document.querySelector(${JSON.stringify(testId("oats-sidebar"))}); const l = s?.querySelector(${JSON.stringify(testId("oats-last-observation"))}); return l ? JSON.stringify({ line: l.innerText.replace(/\\s+/g, " ").trim(), full: s.querySelector(${JSON.stringify(testId("oats-held"))}) !== null, why: s.querySelector(${JSON.stringify(testId("oats-new-agent-held"))})?.innerText.trim() ?? null }) : ""; })()`, 15);
      check(oneLine !== null && new RegExp(`^\\{"line":"Last observation — ${AGE} Retry","full":false,"why":"Comes back when OATS is read again"\\}$`).test(oneLine), `${at} beside the home's full notice the sidebar says one line: "Last observation — <age>" and Retry, and the held New agent says why under it`, oneLine ?? (await page.evaluate(textOf(testId("oats-sidebar")))));
      // (The home's image, below, holds the sidebar's one line beside the page's notice.)
      // (The home's own controls are measured when the home is rebuilt, in its piece: no size check on this image.)
      await page.shot(`a14-${viewport.name}-home`);
      // The home left (a page of bb's own, with no notice of the plugin's): the sidebar's notice is whole
      // again. A page bb kept mounted out of sight would leave the one line with no full notice in view.
      await page.goto("/");
      check(await showSidebar(page, viewport), `${at} the sidebar is shown after the home is left`);
      const whole = await page.until(`(() => { const s = document.querySelector(${JSON.stringify(testId("oats-sidebar"))}); return s?.querySelector(${JSON.stringify(testId("oats-held"))}) ? JSON.stringify({ line: s.querySelector(${JSON.stringify(testId("oats-last-observation"))}) !== null, why: s.querySelector(${JSON.stringify(testId("oats-new-agent-held"))}) !== null }) : ""; })()`, 15);
      check(whole === JSON.stringify({ line: false, why: false }), `${at} with the home left the sidebar's notice is whole again: no one line, and New agent's reason is in the notice alone`, whole ?? (await page.evaluate(textOf(testId("oats-sidebar")))));
    },
  },
  {
    stage: "pages-default",
    name: "the release's default: only the home is a page; no link, no mark, no route and no dangling link to another",
    run: async ({ page, at, viewport, threads, check }) => {
      const mockups = threads.get("thr_mockups");
      await page.goto(`/projects/${mockups.projectId}/threads/${mockups.id}`);
      check(await showSidebar(page, viewport), `${at} the thread list is the OATS sidebar`);
      // The sidebar: the roster and who waits; no list of pages, no link to one, no mark of one.
      const side = await page.until(`(() => { const s = document.querySelector(${JSON.stringify(testId("oats-sidebar"))}); if (!s || !s.querySelector(${JSON.stringify(testId("oats-tree"))})) return ""; return JSON.stringify({ pages: s.querySelector(${JSON.stringify(testId("oats-pages"))}) !== null, links: [...s.querySelectorAll('[data-testid^="oats-page-link-"]')].map((e) => e.getAttribute("data-testid")), needs: s.querySelector(${JSON.stringify(testId("oats-needs-line"))})?.tagName ?? "" }); })()`, 30);
      check(side === JSON.stringify({ pages: false, links: [], needs: "BUTTON" }), `${at} the sidebar has the roster and who waits (which opens the home), and no page link`, side ?? (await page.evaluate(textOf(testId("oats-sidebar")))));
      // The thread's own row: the soul by its name alone (its page is not shown: no link leads nowhere).
      // Read AFTER the sidebar: the needs line is a button only once bb has given the settings, and
      // until then no page is known shown under any value, so an earlier read would prove nothing.
      const soul = await page.until(`(() => { const e = document.querySelector(${JSON.stringify(testId("oats-fact-soul"))}); return e ? JSON.stringify({ text: e.innerText.replace(/\\s+/g, " ").trim(), links: e.querySelectorAll("a").length }) : ""; })()`, 30);
      check(soul === JSON.stringify({ text: "instance of oats-desktop-developer", links: 0 }), `${at} the thread's row names the soul with no link to a page that is not shown`, soul ?? (await page.evaluate(textOf(testId("oats-identity-row")))));
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
    name: "a deployment that is mostly tmux agents: every one a row that says where it runs, the count of who waits, no phrase broken, the last row reachable, and a row opens its agent's page",
    run: async ({ page, at, viewport, threads, check }) => {
      await page.goto("/");
      check(await showSidebar(page, viewport), `${at} the thread list is the OATS sidebar`);
      const side = JSON.stringify(testId("oats-sidebar"));
      const tmux = TMUX_ROSTER.tmux;
      // Every tmux agent is a row, by its one name, and says its state, its soul and "tmux".
      const rows = await page.until(`(() => { const rows = [...document.querySelectorAll(${JSON.stringify(`${testId("oats-sidebar")} ${testId("oats-agent-row-threadless")}`)})]; return rows.length >= ${tmux.length} ? JSON.stringify(rows.map((row) => [row.getAttribute("data-instance"), row.querySelector(${JSON.stringify(testId("oats-row-facts"))})?.innerText.replace(/\\s+/g, " ").trim() ?? ""])) : ""; })()`, 30);
      const read = rows === null ? [] : JSON.parse(rows);
      const wanted = tmux.map(([instance, soul, , how]) => [instance, `${how === "waiting" ? "Needs you" : how === "stopped" ? "Stopped" : "Working"} · ${soul} · tmux`]);
      const bySort = (list) => [...list].sort((a, b) => a[0].localeCompare(b[0]));
      check(JSON.stringify(bySort(read)) === JSON.stringify(bySort(wanted)), `${at} each of the ${tmux.length} tmux agents is a row: its state in a word, its soul, "tmux"`, rows ?? (await page.evaluate(textOf(testId("oats-sidebar")))));
      // Who waits: the three on tmux that wait... every one that waits, with a thread or not, in ONE number.
      const waiting = tmux.filter(([, , , how]) => how === "waiting").length + 1; // and release-070-maintainer, on bb
      const needs = await page.until(`(() => { const t = document.querySelector(${JSON.stringify(`${testId("oats-sidebar")} ${testId("oats-needs-line")}`)})?.innerText.replace(/\\s+/g, " ").trim() ?? ""; return /need you/.test(t) ? t : ""; })()`, 15);
      check(needs === `! ${waiting} need you` || needs === `${waiting} need you`, `${at} the foot counts every agent that waits, the ${waiting - 1} on tmux included: ${waiting}`, needs);
      // Every row is at most three lines: the name on one or two, the second block on ONE line, where only
      // the soul gives way; the state's word and "tmux" are never cut.
      const measured = await rowLines(page);
      const rowsRead = JSON.parse(measured);
      check(rowsRead.rows >= tmux.length + TMUX_ROSTER.bb.length && rowsRead.over === 0 && rowsRead.wrapped === 0, `${at} no row is over three lines, and no row's second block is on two`, measured);
      check(rowsRead.edgeCut === 0 && rowsRead.whereCut === 0 && rowsRead.soulGone === 0 && rowsRead.untitled === 0, `${at} the state's word and "tmux" are never cut, a soul that gives way keeps its "…" (${rowsRead.soulCut} cut), and every name has the whole name as its title`, measured);
      await page.shot(`tmux-roster-${viewport.name}-sidebar`, { targets: true });
      // Scale: with twenty and more rows the list scrolls, and the last row and the foot can be brought into view.
      const reach = await page.evaluate(`(() => { const rows = [...document.querySelectorAll(${JSON.stringify(`${testId("oats-sidebar")} ${testId("oats-agent-row-threadless")}`)})]; const last = rows[rows.length - 1]; last.scrollIntoView({ block: "center" }); const r = last.getBoundingClientRect(); const lastIn = r.height > 0 && r.top >= 0 && r.bottom <= window.innerHeight; const foot = document.querySelector(${JSON.stringify(`${testId("oats-sidebar")} ${testId("oats-needs-line")}`)}); foot.scrollIntoView({ block: "center" }); const f = foot.getBoundingClientRect(); return JSON.stringify({ last: lastIn, foot: f.top >= 0 && f.bottom <= window.innerHeight }); })()`);
      check(reach === JSON.stringify({ last: true, foot: true }), `${at} with ${tmux.length + TMUX_ROSTER.bb.length} agents the last row and the count of who waits can be scrolled into view`, reach);
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
    },
  },
  {
    // By hand only (LIVE_UI_STATUS_FILE): a real deployment's roster, for a look at it. Nothing of it
    // is printed but counts; its images stay with whoever ran it.
    stage: "local-roster",
    name: "a real deployment's roster, drawn from its own oats status, with the release's default pages",
    run: async ({ page, at, viewport, check }) => {
      await page.goto("/");
      check(await showSidebar(page, viewport), `${at} the thread list is the OATS sidebar`);
      const rows = await page.until(`(() => { const n = document.querySelectorAll(${JSON.stringify(`${testId("oats-sidebar")} ${testId("oats-agent-row")}, ${testId("oats-sidebar")} ${testId("oats-agent-row-threadless")}`)}).length; return n > 0 ? String(n) : ""; })()`, 30);
      const measured = await rowLines(page);
      const read = JSON.parse(measured);
      check(Number(rows) > 0 && read.over === 0 && read.wrapped === 0 && read.edgeCut === 0 && read.soulGone === 0 && read.untitled === 0, `${at} the roster is drawn: no row over three lines, no second block on two, nothing past a row's edge, no soul squeezed to nothing, every name whole in its title (a soul, or the last phrase of a row whose thread is gone, may be cut): ${measured}`, measured);
      await page.shot(`local-roster-${viewport.name}-sidebar`);
    },
  },
];
