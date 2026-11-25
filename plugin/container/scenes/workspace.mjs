// The workspace's live scenes: the Workspace page and its four tabs (Souls, Capabilities, Teams,
// Machines), a soul's own page, and a soul's agent whose thread bb does not have. By the audit of
// the hidden pages and its ruling (25 Nov 2026).
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { fill, testId, textOf, visible } from "../browser.mjs";
import { FAILS, refresh, setVerb } from "./panel.mjs";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "test", "fixtures", "workspace");
/** A recorded answer of the workspace's fixtures, changed for a scene (or as it is): what the fake `oats` prints for a verb. */
function derived(file, change = () => undefined, more = {}) {
  const document = JSON.parse(readFileSync(join(FIXTURES, file), "utf8"));
  change(document.result);
  return { stdout: JSON.stringify(document), ...more };
}

const q = (id) => JSON.stringify(testId(id));
/** The tab strip: each tab's words and whether it is the selected one. */
const TABS = `JSON.stringify([...document.querySelectorAll('[role="tab"]')].map((tab) => [tab.innerText.replace(/\\s+/g, " ").trim(), tab.getAttribute("aria-selected")]))`;
/**
 * The one-line texts of a list (`id`): each is ONE line high, nothing of it passes its row's edge,
 * and one that does not hold its whole text ends at a WORD with "…" (never mid-word): what stands
 * before the "…" is the start of the whole text (its title), and the whole text goes on with a
 * space or a mark there.
 */
const oneLines = (id) =>
  `JSON.stringify([...document.querySelectorAll(${q(id)})].map((line) => { const text = line.innerText.trim(); const whole = line.getAttribute("title") ?? ""; const box = line.getBoundingClientRect(); const cut = text.endsWith("…") && text !== whole; const kept = cut ? text.slice(0, -1) : text; return { text: text.slice(0, 60), oneLine: box.height > 0 && box.height < 2 * parseFloat(getComputedStyle(line).lineHeight || "20"), inside: line.scrollWidth <= line.clientWidth + 1, atWord: !cut || (whole.startsWith(kept) && /^[\\s,;:.()\\-]/.test(whole.slice(kept.length))) }; }).filter((line) => !(line.oneLine && line.inside && line.atWord)))`;
/** The sentences a tab must not hold any more (the audit's CUT rows), and the words that were nobody's. */
const GONE = /Pick a soul|This deployment|Servers OATS knows|saved instance routes|not mapped|thread missing|used by \d|in bb ·|elsewhere|Reading OATS|Spawn in bb/;

export default [
  {
    stage: "fixtures",
    name: "the Workspace page: its route opens the Souls tab; the strip holds the four tabs in the Desktop's order, Souls and Capabilities with their count; a press goes to a tab's own route",
    run: async ({ page, at, viewport, check }) => {
      await page.goto("/plugins/oats/workspace");
      check(Boolean(await page.until(visible(testId("oats-soul-row")), 30)), `${at} /plugins/oats/workspace draws the Souls tab`);
      const tabs = await page.until(`(() => { const now = ${TABS}; return /Souls \\d+/.test(now) && /Capabilities \\d+/.test(now) ? now : ""; })()`, 30);
      const read = JSON.parse(tabs || (await page.evaluate(TABS)));
      check(read.length === 4 && /^Souls \d+$/.test(read[0][0]) && /^Capabilities \d+$/.test(read[1][0]) && read[2][0] === "Teams" && read[3][0] === "Machines" && read.map((tab) => tab[1]).join() === "true,false,false,false", `${at} the strip: Souls and Capabilities with their count, Teams, Machines; Souls is the selected one`, JSON.stringify(read));
      // Nothing of the strip is cut, and it does not scroll sideways, at either width.
      const strip = JSON.parse(await page.evaluate(`(() => { const strip = document.querySelector(${q("oats-tabs")}); const last = [...strip.querySelectorAll('[role="tab"]')].at(-1).getBoundingClientRect(); return JSON.stringify({ fits: strip.scrollWidth <= strip.clientWidth + 1, last: last.right <= innerWidth }); })()`));
      check(strip.fits && strip.last, `${at} the four tabs fit the page's width: none is cut, and the strip does not scroll sideways`, JSON.stringify(strip));
      await page.evaluate(`document.querySelector(${q("oats-tab-teams")}).click()`);
      const onTeams = await page.until(`location.pathname.endsWith("/plugins/oats/teams") && document.querySelector(${q("oats-tab-teams")})?.getAttribute("aria-selected") === "true" && ${visible(testId("oats-team-row"))}`, 30);
      check(Boolean(onTeams), `${at} a press on Teams goes to its route, and its tab is the selected one`, await page.evaluate("location.pathname"));
    },
  },
  {
    stage: "fixtures",
    name: "the strip's keys: Right, and Right again, go on from tab to tab: each tab's page takes the focus on its own selected tab",
    run: async ({ page, at, check }) => {
      await page.goto("/plugins/oats/souls");
      await page.until(visible(testId("oats-soul-row")), 30);
      await page.evaluate(`document.querySelector(${q("oats-tab-souls")}).focus()`);
      /** The route, and the test id of what holds the focus. */
      const held = (path, tab) => `location.pathname.endsWith("/plugins/oats/${path}") && document.activeElement?.getAttribute("data-testid") === "oats-tab-${tab}" && document.activeElement.getAttribute("aria-selected") === "true"`;
      const now = `JSON.stringify([location.pathname, document.activeElement?.getAttribute("data-testid") ?? document.activeElement?.tagName])`;
      await page.press("ArrowRight");
      check(Boolean(await page.until(held("capabilities", "capabilities"), 30)), `${at} Right on Souls: the Capabilities tab's route, and the focus is on its tab`, await page.evaluate(now));
      await page.press("ArrowRight");
      check(Boolean(await page.until(held("teams", "teams"), 30)), `${at} Right again: the Teams tab's route, and the focus is on its tab (the keys go on, they do not stop after one)`, await page.evaluate(now));
      await page.press("ArrowLeft");
      check(Boolean(await page.until(held("capabilities", "capabilities"), 30)), `${at} Left: back on Capabilities, the focus on its tab`, await page.evaluate(now));
    },
  },
  {
    stage: "fixtures",
    name: "the four tabs: rows, no sentence, a description on one line that ends at a word",
    run: async ({ page, at, viewport, check }) => {
      const tabs = [
        ["souls", "oats-soul-row", "Souls", "oats-soul-does"],
        ["capabilities", "oats-capability-row", "Capabilities", "oats-capability-does"],
        ["teams", "oats-team-row", "Teams", null],
        ["machines", "oats-machine-row", "Machines", null],
      ];
      for (const [path, row, title, line] of tabs) {
        await page.goto(`/plugins/oats/${path}`);
        const drawn = await page.until(visible(testId(row)), 30);
        const n = await page.evaluate(`document.querySelectorAll(${q(row)}).length`);
        check(Boolean(drawn) && n > 0, `${at} ${title} renders (${n} rows)`);
        const said = await page.evaluate(textOf(testId(`oats-${path}-page`)));
        check(!GONE.test(said), `${at} ${title} holds none of the sentences and words the audit cut`, said.slice(0, 400));
        if (line !== null) {
          // (The lines are measured once the page has laid them out: waited for, the first one says so by its width.)
          await page.until(`document.querySelector(${q(line)})?.clientWidth > 0`, 10);
          const wrong = JSON.parse(await page.evaluate(oneLines(line)));
          check(wrong.length === 0, `${at} ${title}: what each row does is ONE line, inside its row, and one that is cut ends at a word with "…"`, JSON.stringify(wrong.slice(0, 4)));
        }
        await page.shot(`a13-${viewport.name}-${path}`, { targets: true });
      }
      // Souls: in groups by where they come from, a package's soul by its own name under its group (its key whole in the row's title: nothing cut mid-word).
      await page.goto("/plugins/oats/souls");
      await page.until(visible(testId("oats-soul-row")), 30);
      const groups = JSON.parse(await page.evaluate(`JSON.stringify([...document.querySelectorAll(${q("oats-soul-group")})].map((group) => group.querySelector("h2")?.innerText.replace(/\\s+/g, " ").trim() ?? null))`));
      check(groups.length >= 2 && /^WORKSPACE \d+$/i.test(groups[0]) && groups.slice(1).every((heading) => /\d+$/.test(heading ?? "")), `${at} Souls: the workspace's own first, then each package with its version, each with its count`, JSON.stringify(groups));
      const names = JSON.parse(await page.evaluate(`JSON.stringify([...document.querySelectorAll(${q("oats-soul-name")})].map((name) => ({ text: name.innerText.trim(), whole: name.scrollWidth <= name.clientWidth + 1 })))`));
      check(names.length > 0 && names.every((name) => name.whole && !name.text.endsWith("…")), `${at} Souls: no soul's name is cut`, JSON.stringify(names.filter((name) => !name.whole || name.text.endsWith("…"))));
      // Capabilities: the core places first, and what capabilities are one press away, closed.
      await page.goto("/plugins/oats/capabilities");
      await page.until(visible(testId("oats-capability-row")), 30);
      const core = JSON.parse(await page.evaluate(`JSON.stringify([...document.querySelectorAll(${JSON.stringify(`${testId("oats-capabilities-core")} ${testId("oats-fact")}`)})].map((fact) => fact.querySelector("dt").innerText.trim()))`));
      const about = JSON.parse(await page.evaluate(`(() => { const fold = document.querySelector(${q("oats-capabilities-about")}); return JSON.stringify({ open: fold?.open ?? null, summary: fold?.querySelector("summary")?.innerText.replace(/\\s+/g, " ").trim() ?? null, folds: document.querySelectorAll(${JSON.stringify(`${testId("oats-capabilities-page")} details`)}).length }); })()`));
      check(JSON.stringify(core) === JSON.stringify(["Knowledge", "Messaging", "Tasks"]) && about.open === false && /About capabilities$/.test(about.summary ?? "") && about.folds === 1, `${at} Capabilities: the three core places first; what capabilities are is ONE fold, closed`, JSON.stringify({ core, about }));
    },
  },
  {
    stage: "fixtures",
    name: "a soul's own page: over the list with the way back, its facts, its capabilities and why, its agents as the roster says them, and New agent, which opens the form with that soul",
    run: async ({ page, at, viewport, check }) => {
      await page.goto("/plugins/oats/souls/oats-developer");
      check(Boolean(await page.until(visible(testId("oats-soul-detail")), 30)), `${at} a soul's page renders`, await page.evaluate(textOf(testId("oats-souls-page"))));
      const head = JSON.parse(await page.evaluate(`JSON.stringify({ list: document.querySelector(${q("oats-soul-row")}) !== null, tabs: document.querySelector(${q("oats-tabs")}) !== null, back: ${textOf(testId("oats-back"))}, key: ${textOf(`${testId("oats-soul-detail")} h2`)}, button: ${textOf(testId("oats-soul-new-agent"))}, off: document.querySelector(${q("oats-soul-new-agent")})?.disabled ?? null, fields: document.querySelectorAll(${JSON.stringify(`${testId("oats-souls-page")} input, ${testId("oats-souls-page")} textarea`)}).length })`));
      check(head.list === false && head.tabs === false && head.back === "← Souls" && head.key === "oats-developer" && head.button === "New agent" && head.off === false && head.fields === 0, `${at} the page is the soul's alone, at this width too: the way back, its key, ONE button "New agent", and no form of its own`, JSON.stringify(head));
      const facts = JSON.parse(await page.evaluate(`JSON.stringify([...document.querySelectorAll(${JSON.stringify(`${testId("oats-soul-detail")} ${testId("oats-fact")}`)})].map((fact) => fact.querySelector("dt").innerText.trim()))`));
      check(JSON.stringify(facts) === JSON.stringify(["Harness · model", "Teams"]), `${at} what its agents start with, and its teams`, JSON.stringify(facts));
      const capabilities = JSON.parse(await page.evaluate(`JSON.stringify([...document.querySelectorAll(${q("oats-soul-capability")})].map((row) => [...row.children].map((part) => part.innerText.trim())))`));
      check(capabilities.length > 0 && capabilities.every((row) => row.length >= 2) && capabilities.findIndex((row) => !row.includes("core")) >= capabilities.filter((row) => row.includes("core")).length, `${at} its capabilities are rows, the core ones first, each with why the soul has it`, JSON.stringify(capabilities));
      const agents = JSON.parse(await page.until(`(() => { const rows = [...document.querySelectorAll(${q("oats-soul-agent")})]; return rows.length === 0 ? "" : JSON.stringify(rows.map((row) => ({ where: row.getAttribute("data-where"), word: row.querySelector(${q("oats-state")})?.innerText.trim() ?? "", mark: row.querySelector(${JSON.stringify(`${testId("oats-state")} [data-mark]`)}) !== null }))); })()`, 30));
      check(agents.length === 2 && agents.every((agent) => agent.mark && agent.word !== ""), `${at} its agents are the roster's rows: each state a mark AND its word`, JSON.stringify(agents));
      const under = JSON.parse(await page.evaluate(`(() => { const fold = document.querySelector(${q("oats-soul-details")}); return JSON.stringify({ open: fold?.open ?? null, origin: /^from /.test(fold?.querySelector("p")?.textContent ?? ""), face: /github\\.com/.test(document.querySelector(${JSON.stringify(`${testId("oats-soul-detail")} header`)}).innerText) }); })()`));
      check(under.open === false && under.origin && under.face === false, `${at} where it is defined is under the page's one Details, closed, and not on its face`, JSON.stringify(under));
      await page.shot(`a13-${viewport.name}-soul`, { targets: true });
      // New agent: the form's own page, with this soul chosen.
      await page.evaluate(`document.querySelector(${q("oats-soul-new-agent")}).click()`);
      const form = await page.until(`location.pathname.endsWith("/plugins/oats/new-agent/oats-developer") && ${visible(testId("oats-spawn-form"))} ? location.pathname : ""`, 30);
      check(Boolean(form), `${at} New agent opens the New agent form with that soul chosen`, await page.evaluate("location.pathname"));
      // The way back from a soul's page, and a package soul: its row opens its own page by its key.
      await page.goto("/plugins/oats/souls");
      await page.until(visible(testId("oats-soul-row")), 30);
      const key = await page.evaluate(`(() => { const row = [...document.querySelectorAll(${q("oats-soul-row")})].find((each) => (each.getAttribute("title") ?? "").includes("/")); row?.click(); return row?.getAttribute("title") ?? null; })()`);
      const heading = key === null ? "" : await page.until(`(() => { const t = ${textOf(`${testId("oats-soul-detail")} h2`)}; return t === ${JSON.stringify(key)} ? t : ""; })()`, 15);
      check(key !== null && heading === key, `${at} a package soul's row opens its page (${key})`, await page.evaluate("location.pathname + ' | ' + document.body.innerText.slice(0, 200)"));
      await page.evaluate(`document.querySelector(${q("oats-back")}).click()`);
      check(Boolean(await page.until(`location.pathname.endsWith("/plugins/oats/souls") && ${visible(testId("oats-soul-row"))}`, 15)), `${at} "← Souls" goes back to the list`, await page.evaluate("location.pathname"));
    },
  },
  {
    stage: "fixtures",
    name: "a tab's other states: a read that failed, a list that is read, an empty list, a search that narrows and one that finds nothing",
    run: async ({ page, at, viewport, check }) => {
      const face = textOf(testId("oats-souls-page"));
      try {
        // A read that failed: a notice in a person's words with Retry; the kernel's message is under its Details, never the page's face.
        setVerb("souls", FAILS);
        refresh();
        await page.goto("/plugins/oats/souls");
        const failed = await page.until(`(() => { const notice = document.querySelector(${q("oats-souls-page")} + ' [role="alert"]'); return notice && notice.querySelector(${q("oats-read-retry")}) ? JSON.stringify({ title: notice.querySelector("h3")?.innerText.trim(), open: notice.querySelector("details")?.open ?? null, rows: document.querySelectorAll(${q("oats-soul-row")}).length }) : ""; })()`, 30);
        const notice = failed ? JSON.parse(failed) : null;
        check(notice !== null && notice.title === "OATS could not be read" && notice.open === false && notice.rows === 0, `${at} Souls, its read failed: ONE notice, "OATS could not be read", with Retry; the kernel's message under Details, closed; no row`, failed ?? (await page.evaluate(face)));
        await page.shot(`workspace-${viewport.name}-souls-failed`, { targets: true });
        // Retry reads it again: the rows are back.
        setVerb("souls", null);
        // (The lists are read again with every roster read too: the notice gives way to "Reading…" for that moment, so the press waits for the button, and is not needed once the rows are back.)
        await page.until(`(() => { if (document.querySelector(${q("oats-soul-row")})) return "rows"; const retry = document.querySelector(${q("oats-read-retry")}); if (!retry) return ""; retry.click(); return "pressed"; })()`, 20);
        check(Boolean(await page.until(visible(testId("oats-soul-row")), 30)), `${at} Retry reads the souls again: the rows are drawn`, await page.evaluate(face));
        // While it is read: "Reading…" in the rows' place.
        setVerb("souls", derived("souls.json", undefined, { sleepMs: 8000 }));
        refresh();
        await page.goto("/plugins/oats/souls");
        const reading = await page.until(`(() => { const t = ${face}; return /Reading…/.test(t) && document.querySelectorAll(${q("oats-soul-row")}).length === 0 ? t : ""; })()`, 20);
        check(Boolean(reading), `${at} while the souls are read the tab says "Reading…", and draws no row`, await page.evaluate(face));
        await page.shot(`workspace-${viewport.name}-souls-reading`, { targets: true });
        check(Boolean(await page.until(visible(testId("oats-soul-row")), 30)), `${at} and the rows follow`, await page.evaluate(face));
        // No soul at all: two words.
        setVerb("souls", derived("souls.json", (result) => { result.souls = []; }));
        refresh();
        await page.goto("/plugins/oats/souls");
        const none = await page.until(`(() => { const t = ${face}; return /No souls\\.$/.test(t.trim()) ? t : ""; })()`, 30);
        check(Boolean(none), `${at} no soul at all: "No souls.", and nothing else under the strip`, await page.evaluate(face));
        await page.shot(`workspace-${viewport.name}-souls-empty`, { targets: true });
      } finally {
        setVerb("souls", null);
        refresh();
      }
      // A search that narrows (the recorded workspace has twelve capabilities: the field is there): the tab says how many of how many; one that finds nothing says so in two words.
      await page.goto("/plugins/oats/capabilities");
      await page.until(visible(testId("oats-capability-row")), 30);
      const all = await page.evaluate(`document.querySelectorAll(${q("oats-capability-row")}).length`);
      const tab = `(document.querySelector(${q("oats-tab-capabilities")})?.innerText ?? "").replace(/\\s+/g, " ").trim()`;
      check(all >= 12 && (await page.evaluate(`document.querySelector(${q("oats-search")}) !== null`)), `${at} Capabilities, ${all} rows: the search field is there`, await page.evaluate(tab));
      await page.evaluate(fill(testId("oats-search"), "oats.core"));
      const narrowed = await page.until(`(() => { const now = ${tab}; return /^Capabilities \\d+ of ${all}$/.test(now) ? now : ""; })()`, 15);
      const left = await page.evaluate(`document.querySelectorAll(${q("oats-capability-row")}).length`);
      check(Boolean(narrowed) && left > 0 && left < all && narrowed === `Capabilities ${left} of ${all}`, `${at} a search narrows the list, and the tab says "${left} of ${all}"`, `${narrowed} | ${left} rows`);
      await page.shot(`workspace-${viewport.name}-capabilities-search`, { targets: true });
      await page.evaluate(fill(testId("oats-search"), "no capability is named so"));
      const nothing = await page.until(`(() => { const t = ${textOf(testId("oats-capabilities-page"))}; return /Nothing matches\\./.test(t) && document.querySelectorAll(${q("oats-capability-row")}).length === 0 ? ${tab} : ""; })()`, 15);
      check(nothing === `Capabilities 0 of ${all}`, `${at} a search that finds nothing: "Nothing matches.", no row, "0 of ${all}" in the tab`, String(nothing));
      await page.shot(`workspace-${viewport.name}-capabilities-nothing`, { targets: true });
    },
  },
  {
    stage: "fixtures",
    name: "the default team with no address: a notice first, and a mark on the Teams tab",
    run: async ({ page, at, viewport, check }) => {
      const KERNEL = "the default team oats has no provider id yet";
      setVerb("teams", derived("teams.json", (result) => {
        const team = result.teams.find((each) => each.default === true);
        team.team = null;
        result.problems = [{ code: "team-unmapped", label: team.label, default: true, message: KERNEL, fix: "its owner runs `oats aweb setup`, then commits the id" }];
      }));
      try {
        refresh();
        await page.goto("/plugins/oats/teams");
        const read = await page.until(`(() => { const notice = document.querySelector(${q("oats-teams-page")} + " " + ${q("oats-notice")}); const row = document.querySelector(${q("oats-team-row")}); if (!notice || !row) return ""; const mark = document.querySelector(${q("oats-tab-teams")} + " " + ${q("oats-mark")}); return JSON.stringify({ title: notice.querySelector("h3")?.innerText.trim(), open: notice.querySelector("details")?.open ?? null, first: Boolean(notice.compareDocumentPosition(row) & Node.DOCUMENT_POSITION_FOLLOWING), row: row.innerText.replace(/\\s+/g, " ").trim(), mark: mark?.getAttribute("aria-label") ?? null, face: (document.querySelector(${q("oats-teams-page")})?.innerText ?? "").includes(${JSON.stringify(KERNEL)}) && !notice.querySelector("details")?.open }); })()`, 30);
        const said = read ? JSON.parse(read) : null;
        check(said !== null && said.title === "The default team oats has no address yet: nothing can be spawned until it has one." && said.open === false && said.first, `${at} Teams: the notice says it first, in a person's words; the kernel's words are under its Details, closed`, read ?? (await page.evaluate(textOf(testId("oats-teams-page")))));
        check(said !== null && /No address yet/.test(said.row) && said.mark === "Teams: the default team has no address yet", `${at} its row says "No address yet", and the Teams tab has a mark with words`, read ?? "");
        await page.shot(`workspace-${viewport.name}-teams-no-address`, { targets: true });
        // The mark stands on the tab from the other tabs too.
        await page.goto("/plugins/oats/machines");
        check(Boolean(await page.until(`document.querySelector(${q("oats-tab-teams")} + " " + ${q("oats-mark")}) !== null && ${visible(testId("oats-machine-row"))}`, 30)), `${at} the Teams tab keeps its mark while another tab is open`);
      } finally {
        setVerb("teams", null);
        refresh();
      }
      await page.goto("/plugins/oats/teams");
      check(Boolean(await page.until(`${visible(testId("oats-team-row"))} && document.querySelector(${q("oats-tab-teams")} + " " + ${q("oats-mark")}) === null && document.querySelector(${q("oats-teams-page")} + " " + ${q("oats-notice")}) === null`, 30)), `${at} with the teams as recorded there is no notice and no mark`, await page.evaluate(textOf(testId("oats-teams-page"))));
    },
  },
  {
    stage: "fixtures",
    name: "a soul that cannot be spawned, and a soul the deployment does not have",
    run: async ({ page, at, viewport, check }) => {
      // The recorded workspace has one the kernel could not resolve: its row says "Can't spawn"; its page keeps New agent, off, with the one reason, and says nothing of its capabilities.
      await page.goto("/plugins/oats/souls");
      await page.until(visible(testId("oats-soul-row")), 30);
      const key = await page.evaluate(`(() => { const row = [...document.querySelectorAll(${q("oats-soul-row")})].find((each) => each.querySelector(${q("oats-soul-cannot")})); row?.click(); return row?.getAttribute("title") ?? null; })()`);
      const read = key === null ? "" : await page.until(`(() => { const detail = document.querySelector(${q("oats-soul-detail")}); if (!detail || detail.querySelector("h2")?.innerText.trim() !== ${JSON.stringify(key)}) return ""; const button = detail.querySelector(${q("oats-soul-new-agent")}); return JSON.stringify({ off: button?.disabled ?? null, reason: detail.querySelector(${q("oats-disabled-reason")})?.innerText.trim() ?? null, capabilities: detail.querySelector(${q("oats-soul-capabilities")}) !== null, details: detail.querySelector(${q("oats-soul-details")})?.open ?? null }); })()`, 30);
      const soul = read ? JSON.parse(read) : null;
      check(soul !== null && soul.off === true && soul.reason === "Can't spawn here" && soul.capabilities === false && soul.details === false, `${at} a soul that cannot be spawned (${key}): New agent is there, off, with "Can't spawn here"; nothing is said of its capabilities; why is under Details, closed`, read || (await page.evaluate(textOf(testId("oats-souls-page")))));
      await page.shot(`workspace-${viewport.name}-soul-cannot-spawn`, { targets: true });
      // A soul the URL names and the deployment does not have: one line, and the way back.
      await page.goto("/plugins/oats/souls/no-such-soul");
      const unknown = await page.until(`(() => { const t = ${textOf(testId("oats-souls-page"))}; return /This deployment has no soul named no-such-soul\\./.test(t) && document.querySelector(${q("oats-back")}) ? t : ""; })()`, 30);
      check(Boolean(unknown) && !/New agent/.test(unknown), `${at} a soul the deployment does not have: one line that says so, the way back, and no New agent`, await page.evaluate(textOf(testId("oats-souls-page"))));
      await page.shot(`workspace-${viewport.name}-soul-unknown`, { targets: true });
    },
  },
  {
    stage: "detached",
    name: "a soul's agent whose thread bb does not have: what its row says elsewhere, with its acts",
    run: async ({ page, at, viewport, check }) => {
      await page.goto("/plugins/oats/souls/oats-expert");
      const row = `document.querySelector(${JSON.stringify(`${testId("oats-soul-agent")}[data-instance="weekly-digest-helper"]`)})`;
      const line = await page.until(`(() => { const t = (${row}?.innerText ?? "").replace(/\\s+/g, " ").trim(); return /Retire…/.test(t) ? t : ""; /* the agent by its one name, the instance as words */ })()`, 30);
      check(Boolean(line) && /Weekly digest helper/.test(line) && /(archived|deleted) in bb/.test(line) && !/thread missing/.test(line), `${at} the soul's page says of the agent whose thread bb does not have what the roster says of it ("archived in bb" or "deleted in bb"), with its acts`, line ?? (await page.evaluate(textOf(testId("oats-souls-page")))));
      await page.shot(`a16-${viewport.name}-soul`, { targets: true });
    },
  },
];
