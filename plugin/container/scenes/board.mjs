// The board's live scenes (container/live-ui.mjs says what a scene is): an agent's questions and
// facts, on its Board tab and on the home's card.
//   board       the board the real kernel printed (test/fixtures/panel/status-board.json: two facts,
//               one question, the board's own claim): Board is first in the panel's row, and the panel
//               does NOT open on it by itself (it opens where it was left: Instance); by a press:
//               the question with its options; the facts in bb's own list; the home's card draws
//               the same question.
//   board-later an agent that ASKS while its panel is open on another tab: a screen never moves
//               under a reader. The panel opened on Instance (facts alone); the agent asks; the
//               panel stays; the thread's own line says "Needs you" with Answer; Answer turns the
//               panel to Board, the focus on the question's zone (never on an option).
//   board-busy  THE WORST CASE (specs: every screen has a worst-case twin, judged first): the same
//               row with its board MULTIPLIED to the kernel's bounds: twelve facts with the longest
//               label, value and unit the kernel takes and an address each, nine questions of two
//               hundred characters with four options of sixty, each with a context of two thousand,
//               and twenty values of history a fact. Only names, texts and times are varied: every
//               entry keeps the recorded entry's shape. What must still hold is checked: nothing is
//               pushed off the screen sideways, the question's own controls are in view, a count is
//               whole, a long context has a bound and scrolls.
// The detail (`oats inspect --home --board`) is answered here in the kernel's documented shape:
// the recorded one comes with the real run's part.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { lowTargets, testId, visible } from "../browser.mjs";

const FIXTURE = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "test", "fixtures", "panel", "status-board.json");
const CHILD = { instance: "panel-worktree-helper", recorded: "thr_kjrgkze2sz", thread: "thr_mockups" };
const PARENT = { instance: "redesign-ui-lead", recorded: "thr_bkyz48xf96", thread: "thr_redesign" };

/** The recorded roster, with bb's own ids for its two threads; `change(board)` over the child's board; `asks: false`: without its question and the claim the question set (as the kernel's row is before the agent asks). */
function roster(threads, change = (board) => board, { asks = true } = {}) {
  let status = readFileSync(FIXTURE, "utf8");
  for (const agent of [CHILD, PARENT]) status = status.replaceAll(agent.recorded, threads.get(agent.thread).id);
  const document = JSON.parse(status);
  for (const group of document.agents)
    for (const row of group.instances)
      if (row.instance === CHILD.instance) {
        row.board = change(row.board);
        if (!asks) Object.assign(row, { board: { ...row.board, questions: [] }, waitingOnYou: null });
      }
  return document;
}
const rowOf = (document) => document.agents.flatMap((group) => group.instances).find((row) => row.instance === CHILD.instance);

// ---- the worst case: the recorded entries, multiplied to the kernel's bounds
const MORE = "and what follows from it for the people who wait on this change before the week is over and the next one starts with the release notes still to be read by two more readers";
/** `text` made as long as the kernel takes (`length` characters at most), in whole words. */
const fill = (text, length) => {
  const words = `${text} ${MORE} ${MORE} ${MORE} ${MORE} ${MORE} ${MORE} ${MORE} ${MORE} ${MORE} ${MORE} ${MORE} ${MORE}`.split(" ");
  let made = "";
  for (const word of words) {
    if (made.length + word.length + 1 > length) break;
    made = made === "" ? word : `${made} ${word}`;
  }
  return made;
};
const LABELS = ["Pull request for the release branch", "Tests failing on the integration runner", "Best score of the ranking run today", "Coverage of the kernel's own suite", "Open review threads on the change", "Time of the slowest live stage", "Bundle size after the last build", "Latency at the ninety-fifth percentile", "Memory of the host daemon at rest", "Queue of the scheduled wakes", "Commits ahead of the default branch", "Flaky checks seen in ten runs"];
const LONG_HOST = "pr-424-release-candidate-preview.oats-bb-plugin-staging.example-deployments.internal.example.org";
function busy(board) {
  const [link, plain] = board.facts;
  const question = board.questions[0];
  const facts = LABELS.map((label, index) => ({
    ...(index % 2 === 0 ? link : plain),
    key: `fact${index + 1}`,
    label: label.slice(0, 40),
    value: index % 3 === 0 ? fill(`${1000 + index * 37} of ${2000 + index * 91} checks passed on the release candidate`, 80) : String(40 + index * 3),
    unit: index % 3 === 0 ? null : "milliseconds p95",
    // One address on a LONG host (a preview deployment's): the label's line is cut at its end, never run under the age and the ×.
    link: index === 4 ? `https://${LONG_HOST}/pull/424` : index % 2 === 0 ? `https://github.com/oats-project/oats-bb/pull/${420 + index}` : null,
    at: new Date(Date.parse(plain.at) - index * 3_600_000).toISOString(),
  }));
  const questions = Array.from({ length: 9 }, (_, index) => ({
    ...question,
    id: `q${index + 3}`,
    question: fill(`Question ${index + 1}: which base branch should the release candidate be cut from, given that main moved twice today and the 0.1 line still carries the fix the pilot needs before Thursday,`, 199) + "?",
    options: ["main: the default branch, as it stands after today's merges", "release: the 0.1 line, which carries the pilot's fix already", "a new branch from the tag v0.5.0, with the fix picked on it", "wait: ask the maintainer first and cut nothing until then"],
    hasContext: true,
    since: new Date(Date.parse(question.since) - index * 600_000).toISOString(),
  }));
  // Every text within the kernel's bounds: the board leaves out an entry that is over one, and the scene would show less than it says.
  const over = [
    ...facts.flatMap((fact) => [[fact.label, 40], [fact.value, 80], [fact.unit ?? "", 16]]),
    ...questions.flatMap((asked) => [[asked.question, 200], ...asked.options.map((option) => [option, 60])]),
  ].filter(([text, most]) => text.length > most);
  if (over.length > 0 || facts.length > 12 || questions.length > 9) throw new Error(`scenes/board.mjs: the busy board is out of the kernel's bounds: ${JSON.stringify(over)}`);
  return { facts, questions };
}
/** The detail's answer for a board, in the kernel's documented shape: twenty values a fact, a context of two thousand characters a question. */
function detailOf(board) {
  const context = fill("main is protected and moved twice today; the release line is 0.1 and carries the pilot's fix; a branch from the tag would need the fix picked.\nThe maintainer asked for no merge before the checks are green.", 1990);
  return {
    stdout: JSON.stringify({
      schemaVersion: 1,
      ok: true,
      result: {
        instance: {
          board: {
            facts: board.facts.map((fact, index) => ({ ...fact, history: Array.from({ length: 20 }, (_, step) => ({ value: String(Math.round(50 + 30 * Math.sin((step + index) / 3) + step)), at: new Date(Date.parse(fact.at) - (20 - step) * 600_000).toISOString() })) })),
            questions: board.questions.map((question) => ({ ...question, context })),
          },
        },
      },
    }),
  };
}

const asksNow = (snapshot) => snapshot.ok === true && snapshot.agents.some((agent) => agent.instance === CHILD.instance && agent.boardAsks === true);
export const stages = {
  board: {
    label: "BD",
    enter: async ({ fake, threads, untilSnapshot }) => {
      const document = roster(threads);
      fake({ status: { stdout: JSON.stringify(document) }, "inspect --home --board": detailOf(rowOf(document).board) });
      await untilSnapshot(asksNow);
    },
  },
  "board-later": {
    label: "BDL",
    enter: async ({ fake, threads, untilSnapshot }) => {
      const document = roster(threads, undefined, { asks: false });
      fake({ status: { stdout: JSON.stringify(document) }, "inspect --home --board": detailOf(rowOf(document).board) });
      await untilSnapshot((snapshot) => snapshot.ok === true && snapshot.agents.some((agent) => agent.instance === CHILD.instance && agent.hasBoard === true && agent.boardAsks !== true && agent.waiting === null));
    },
  },
  "board-busy": {
    label: "BDB",
    enter: async ({ fake, threads, untilSnapshot }) => {
      const document = roster(threads, busy);
      fake({ status: { stdout: JSON.stringify(document) }, "inspect --home --board": detailOf(rowOf(document).board) });
      await untilSnapshot(asksNow);
    },
  },
};

/**
 * Every control of the plugin is as high as a person can press (32 px; 44 at the phone's width),
 * WITH ONE NAMED EXCEPTION: the toggle of bb's own list ("N more" / "Show less"), which is bb's
 * part and is 24 px at both widths (measured, bb 0.50.1). It is kept as bb draws it, and its size
 * is printed with the check, so a bb that changes it shows here.
 */
async function targets(page, viewport, check, at, name) {
  const min = viewport.mobile ? 44 : 32;
  const low = JSON.parse(await page.evaluate(lowTargets(min)));
  const BB = /^(\d+ more|Show less) (\d+)px$/;
  const ours = low.filter((each) => !BB.test(each));
  const bbs = low.filter((each) => BB.test(each));
  check(ours.length === 0 && bbs.every((each) => Number(BB.exec(each)[2]) === 24), `${at} ${name}: every control of ours is at least ${min} px high${bbs.length === 0 ? "" : `; the exception, bb's own list toggle: ${bbs.join(", ")}`}`, low.join(" | "));
}

const flat = `(e) => (e?.innerText ?? "").replace(/\\s+/g, " ").trim()`;
const inBoard = (id) => `${testId("oats-board")} ${testId(id)}`;
/** The agent's panel, the way a person gets to it: the OATS chip of its thread (the thread's tab at 1280, its own page at the phone's width). */
async function openPanel(page, threads) {
  const thread = threads.get(CHILD.thread);
  await page.goto(`/projects/${thread.projectId}/threads/${thread.id}`);
  await page.until(visible(testId("oats-open-panel")), 30);
  await page.evaluate(`document.querySelector(${JSON.stringify(testId("oats-open-panel"))}).click()`);
  // The panel opens where it was left (Instance): the Board tab is there, first, and is PRESSED, as a person does.
  const board = `document.getElementById("oats-panel-page-tab-board")`;
  const opened = await page.until(`(() => { const tab = ${board}; const first = document.querySelector('[role="tablist"][aria-label="Instance context"] [role="tab"]'); const on = document.querySelector('[role="tablist"][aria-label="Instance context"] [role="tab"][aria-selected="true"]'); return ${visible(testId("oats-panel"))} && tab !== null && first === tab && on ? on.innerText.trim() : ""; })()`, 40);
  await page.until("false", 1); // what a move of the panel's own would need to show
  const stayed = await page.evaluate(`document.querySelector('[role="tablist"][aria-label="Instance context"] [role="tab"][aria-selected="true"]')?.innerText.trim() ?? ""`);
  await page.evaluate(`${board}?.click()`);
  const shown = await page.until(`${visible(testId("oats-panel"))} && document.querySelector(${JSON.stringify(inBoard("oats-board-question"))}) !== null`, 40);
  return shown ? { opened, stayed } : null;
}
/** What the board shows: the tabs, the question's place, its text, its options, the facts' rows in view, and whether anything is pushed off sideways. */
const read = `(() => { const flat = ${flat}; const board = document.querySelector(${JSON.stringify(testId("oats-board"))}); if (!board) return ""; const zone = board.querySelector(${JSON.stringify(testId("oats-board-questions"))}); const box = (e) => { const r = e.getBoundingClientRect(); return { left: Math.round(r.left), right: Math.round(r.right), top: Math.round(r.top), bottom: Math.round(r.bottom) }; }; const pane = board.closest('[role="tabpanel"]') ?? board.parentElement; return JSON.stringify({ tabs: [...document.querySelectorAll('[role="tablist"][aria-label="Instance context"] [role="tab"]')].map((t) => flat(t) + (t.getAttribute("aria-selected") === "true" ? "*" : "")), place: flat(zone?.querySelector(${JSON.stringify(testId("oats-board-place"))})), question: flat(zone?.querySelector(${JSON.stringify(testId("oats-board-question"))})), options: [...(zone?.querySelectorAll(${JSON.stringify(testId("oats-board-option"))}) ?? [])].map(flat), answers: zone?.querySelectorAll(${JSON.stringify(testId("oats-board-answer"))}).length ?? 0, turn: [zone?.querySelector(${JSON.stringify(testId("oats-board-previous"))}), zone?.querySelector(${JSON.stringify(testId("oats-board-next"))})].filter(Boolean).map((b) => { const r = b.getBoundingClientRect(); return r.width > 0 && r.left >= 0 && r.right <= innerWidth; }), facts: [...board.querySelectorAll(${JSON.stringify(testId("oats-board-fact"))})].filter((f) => f.getClientRects().length > 0).length, more: [...board.querySelectorAll(${JSON.stringify(testId("oats-board-facts"))} + " button")].map(flat).filter((t) => /more/.test(t)), sideways: pane.scrollWidth > pane.clientWidth + 1 || document.documentElement.scrollWidth > innerWidth + 1, zone: zone ? box(zone) : null, pane: box(pane), window: innerHeight }); })()`;

export default [
  {
    stage: "board",
    name: "the board the kernel printed: Board is first in the row and the panel does not open on it by itself; pressed: the question with its options, then the facts; the home's card draws the same question",
    run: async ({ page, at, viewport, threads, check }) => {
      const shown = await openPanel(page, threads);
      const drawn = shown ? JSON.parse(await page.evaluate(read)) : null;
      check(shown !== null && shown.opened === "Instance" && shown.stayed === "Instance", `${at} the panel of an agent whose board asks opens where it was left (Instance), with Board first in the row, and stays there: it never chooses a tab by itself`, JSON.stringify(shown));
      check(drawn !== null && drawn.tabs[0] === "Board*" && drawn.tabs.includes("Instance") && drawn.place === "" && drawn.question === "Which base branch?" && drawn.options.length === 2 && drawn.facts === 2 && drawn.sideways === false, `${at} Board, pressed: its one question ("Which base branch?") with two options, then its two facts; nothing is pushed off sideways`, JSON.stringify(drawn));
      await targets(page, viewport, check, at, `board-${viewport.name}-tab`);
      await page.shot(`board-${viewport.name}-tab`);
      await page.goto("/plugins/oats/home");
      const card = `document.querySelector(${JSON.stringify(`${testId("oats-needs-card")}[data-instance="${CHILD.instance}"] ${testId("oats-board-question")}`)})`;
      const asked = await page.until(`(${flat})(${card})`, 40);
      check(asked === "Which base branch?", `${at} the home's card of that agent draws the same question, by the board's own component`, String(asked));
      await targets(page, viewport, check, at, `board-${viewport.name}-home-card`);
      await page.shot(`board-${viewport.name}-home-card`);
    },
  },
  {
    stage: "board-later",
    name: "an agent asks while its panel is open on Instance: the panel stays (a screen never moves under a reader); the thread's line says it, and its Answer turns the panel to Board",
    run: async ({ page, at, viewport, threads, check, fake }) => {
      const selected = `[...document.querySelectorAll('[role="tablist"][aria-label="Instance context"] [role="tab"]')].find((t) => t.getAttribute("aria-selected") === "true")?.innerText.trim() ?? ""`;
      const before = roster(threads, undefined, { asks: false });
      const after = roster(threads);
      // (Each view starts from the agent that has not asked yet: the view before left it asking.)
      fake({ status: { stdout: JSON.stringify(before) }, "inspect --home --board": detailOf(rowOf(before).board) });
      // The server's roster is that one before anything is opened: the home is drawn, with no card of the agent.
      await page.goto("/plugins/oats/home");
      const quiet = await page.until(`document.querySelector(${JSON.stringify(testId("oats-home-tiles"))}) !== null && document.querySelector(${JSON.stringify(`${testId("oats-needs-card")}[data-instance="${CHILD.instance}"]`)}) === null ? "yes" : ""`, 60);
      check(quiet === "yes", `${at} before it asks, the agent has no needs-you card on the home`, String(quiet));
      const thread = threads.get(CHILD.thread);
      const act = `document.querySelector(${JSON.stringify(testId("oats-status-act"))})`;
      const line = `(${flat})(document.querySelector(${JSON.stringify(`${testId("oats-identity-row")} ${testId("oats-status-line")}`)}))`;
      if (viewport.mobile) {
        // At the phone's width bb has no side panel: the agent's panel is a page of its own, with no thread line beside it.
        await page.goto(`/plugins/oats/agent/${CHILD.instance}`);
        const opened = await page.until(`(() => { const now = ${selected}; return document.querySelectorAll('[role="tablist"][aria-label="Instance context"] [role="tab"]').length === 3 && now === "Instance" ? now : ""; })()`, 60);
        check(opened === "Instance", `${at} the page of an agent with facts alone opens on Instance, with a Board tab`, String(opened));
        fake({ status: { stdout: JSON.stringify(after) }, "inspect --home --board": detailOf(rowOf(after).board) });
        const asks = await page.until(`/Needs you/.test((${flat})(document.querySelector(${JSON.stringify(`${testId("oats-panel")} ${testId("oats-panel-state")}`)}))) ? "yes" : ""`, 60);
        await page.until("false", 2); // what a jump would need to show
        check(asks === "yes" && (await page.evaluate(selected)) === "Instance", `${at} the agent asks while the page is on Instance: the header says "Needs you", and the page STAYS on Instance`, `asks: ${asks}; selected: ${await page.evaluate(selected)}`);
        // (No image at this width: the page that stayed is the state the panel's own scene has an image of, and Board,
        // pressed, the one the stage "board" has: two scenes of one state make one image. The checks are what it adds.)
        await page.evaluate(`document.getElementById("oats-panel-page-tab-board")?.click()`);
        const there = await page.until(`(${flat})(document.querySelector(${JSON.stringify(inBoard("oats-board-question"))}))`, 30);
        check(there === "Which base branch?", `${at} a press on Board shows the question`, String(there));
        return;
      }
      await page.goto(`/projects/${thread.projectId}/threads/${thread.id}`);
      await page.until(visible(testId("oats-open-panel")), 30);
      await page.evaluate(`document.querySelector(${JSON.stringify(testId("oats-open-panel"))}).click()`);
      const opened = await page.until(`(() => { const now = ${selected}; return ${visible(testId("oats-panel"))} && document.querySelectorAll('[role="tablist"][aria-label="Instance context"] [role="tab"]').length === 3 && now === "Instance" ? now : ""; })()`, 60);
      check(opened === "Instance", `${at} the panel of an agent with facts alone opens on Instance, with a Board tab`, String(opened));
      // The agent asks.
      fake({ status: { stdout: JSON.stringify(after) }, "inspect --home --board": detailOf(rowOf(after).board) });
      const said = await page.until(`(() => { const line = ${line}; const button = ${act}; return /Needs you/.test(line) && button && button.innerText.trim() === "Answer" ? line : ""; })()`, 60);
      await page.until("false", 2); // what a jump would need to show
      check(Boolean(said) && (await page.evaluate(selected)) === "Instance", `${at} the agent asks while the panel is open on Instance: the thread's line says "Needs you" with Answer, and the panel STAYS on Instance`, `the line: ${JSON.stringify(said)}; selected: ${await page.evaluate(selected)}`);
      await page.shot(`board-${viewport.name}-later-stays`);
      await page.evaluate(`${act}.click()`);
      const turned = await page.until(`(() => { const now = ${selected}; const zone = document.querySelector(${JSON.stringify(inBoard("oats-board-questions"))}); return now === "Board" && zone !== null && document.activeElement === zone && zone.querySelector(${JSON.stringify(testId("oats-board-answer"))}) !== null ? (${flat})(document.querySelector(${JSON.stringify(inBoard("oats-board-question"))})) : ""; })()`, 40);
      check(turned === "Which base branch?", `${at} Answer turns the panel to Board: the question, with the focus on its zone, not on an option (a control that sends)`, `${turned}; selected: ${await page.evaluate(selected)}`);
      await page.shot(`board-${viewport.name}-later`);
    },
  },
  {
    stage: "board-busy",
    name: "THE WORST CASE: nine questions of two hundred characters with four long options and a long context, twelve facts at the kernel's bounds: the controls stay in view, the counts are whole, nothing is pushed off sideways",
    run: async ({ page, at, viewport, threads, check }) => {
      const shown = await openPanel(page, threads);
      const drawn = shown ? JSON.parse(await page.evaluate(read)) : null;
      check(drawn !== null && drawn.tabs[0] === "Board*" && drawn.place === "1 of 9" && drawn.options.length === 4 && drawn.turn.length === 2 && drawn.turn.every(Boolean) && drawn.sideways === false, `${at} BUSY: "1 of 9", the question whole with its four options, ‹ and › in view, and nothing pushed off sideways`, JSON.stringify(drawn));
      check(drawn !== null && drawn.facts === 3 && drawn.more.length === 1 && /^9 more$/.test(drawn.more[0]), `${at} BUSY: three of the twelve facts are shown, and bb's own list says "9 more", whole`, JSON.stringify(drawn === null ? null : { facts: drawn.facts, more: drawn.more }));
      await targets(page, viewport, check, at, `board-${viewport.name}-busy-tab`);
      await page.shot(`board-${viewport.name}-busy-tab`);
      // The long context: a fold; open, it has a bound of its own and a way to the rest, and the options stay reachable.
      await page.evaluate(`(() => { const fold = document.querySelector(${JSON.stringify(inBoard("oats-board-context"))}); if (fold) fold.open = true; })()`);
      const context = await page.until(`(() => { const t = document.querySelector(${JSON.stringify(inBoard("oats-board-context-text"))}); if (!t) return ""; const r = t.getBoundingClientRect(); return JSON.stringify({ length: t.innerText.length, height: Math.round(r.height), scrolls: t.scrollHeight > t.clientHeight + 1, window: innerHeight }); })()`, 30);
      const text = context ? JSON.parse(context) : null;
      check(text !== null && text.length > 1500 && text.height <= text.window / 3 + 1 && text.scrolls === true, `${at} BUSY: the context of two thousand characters is whole behind its fold, in a box no higher than a third of the window that scrolls alone`, String(context));
      // In view for its image: at the phone's width the open context is under the four options.
      await page.evaluate(`document.querySelector(${JSON.stringify(inBoard("oats-board-context"))})?.scrollIntoView({ block: "start" })`);
      await targets(page, viewport, check, at, `board-${viewport.name}-busy-context`);
      await page.shot(`board-${viewport.name}-busy-context`);
      // All twelve facts, by bb's own toggle.
      await page.evaluate(`[...document.querySelectorAll(${JSON.stringify(inBoard("oats-board-facts"))} + " button")].find((b) => /more/.test(b.innerText))?.click()`);
      const all = await page.until(`document.querySelectorAll(${JSON.stringify(inBoard("oats-board-fact"))}).length === 12 ? "12" : ""`, 20);
      const after = JSON.parse(await page.evaluate(read));
      check(all === "12" && after.sideways === false, `${at} BUSY: all twelve facts: nothing is pushed off sideways`, JSON.stringify({ all, sideways: after.sideways }));
      // A value is never cut: each is drawn whole (no box of a value holds more than it shows), at both widths.
      const cut = JSON.parse(await page.evaluate(`JSON.stringify([...document.querySelectorAll(${JSON.stringify(inBoard("oats-board-fact-value"))})].filter((v) => v.getBoundingClientRect().right > innerWidth || getComputedStyle(v).textOverflow === "ellipsis" || getComputedStyle(v).whiteSpace === "nowrap").map((v) => v.innerText.slice(0, 30)))`));
      check(cut.length === 0, `${at} BUSY: no value of the twelve facts is cut (a long one wraps on its line)`, JSON.stringify(cut));
      // ONE ORDER for every fact: the value's line over the label's, both starting at one left edge; the address on the label's line.
      // (The host is as high as a press needs by its padding: it is on the label's line when their MIDDLES agree, and it stands after the label.)
      const lines = JSON.parse(await page.evaluate(`JSON.stringify([...document.querySelectorAll(${JSON.stringify(inBoard("oats-board-fact"))})].map((f) => { const box = (id) => { const e = f.querySelector('[data-testid="' + id + '"]'); return e ? e.getBoundingClientRect() : null; }; const v = box("oats-board-fact-value"), l = box("oats-board-fact-label"), h = box("oats-board-link-show"); return { left: [Math.round(v.left), Math.round(l.left)], over: v.bottom <= l.top + 1, host: h === null ? null : Math.abs((h.top + h.bottom) / 2 - (l.top + l.bottom) / 2) < 4 && h.left >= l.right - 1 && h.right <= innerWidth }; }))`));
      const lefts = new Set(lines.flatMap((line) => line.left));
      check(lines.length === 12 && lefts.size === 1 && lines.every((line) => line.over && line.host !== false), `${at} BUSY: every fact is the same two lines, from one left edge: its value over its label, and an address on the label's line`, JSON.stringify({ lefts: [...lefts], lines }));
      const says = JSON.parse(await page.evaluate(`JSON.stringify({ says: [...document.querySelectorAll(${JSON.stringify(inBoard("oats-board-says"))})].map(${flat}), hosts: [...document.querySelectorAll(${JSON.stringify(inBoard("oats-board-link-show"))})].map(${flat}) })`));
      check(says.says.length === 1 && says.says[0] === "Panel worktree helper says" && says.hosts.length === 6 && says.hosts.filter((host) => host === "github.com").length === 5 && says.hosts.includes(LONG_HOST), `${at} BUSY: who says the six addresses is said once, on the Facts heading's line; each address is its host alone`, JSON.stringify(says));
      // A long host: cut at its end inside its fact's line (its whole text is its title), the label keeps a few characters, and the age and the × stay clear of it.
      const long = JSON.parse(await page.evaluate(`(() => { const fact = [...document.querySelectorAll(${JSON.stringify(inBoard("oats-board-fact"))})].find((f) => f.querySelector('[data-testid="oats-board-link-show"]')?.innerText.trim() === ${JSON.stringify(LONG_HOST)}); if (!fact) return "null"; const box = (id) => fact.querySelector('[data-testid="' + id + '"]').getBoundingClientRect(); const host = fact.querySelector('[data-testid="oats-board-link-show"]'); const h = box("oats-board-link-show"), l = box("oats-board-fact-label"), a = box("oats-board-age"); return JSON.stringify({ label: Math.round(l.width), hostRight: Math.round(h.right), ageLeft: Math.round(a.left), cut: host.scrollWidth > host.clientWidth, title: host.getAttribute("title") }); })()`));
      check(long !== null && long.label >= 12 && long.hostRight <= long.ageLeft && long.title === LONG_HOST && (viewport.mobile ? long.cut : true), `${at} BUSY: a long host stays inside its fact's line: the label keeps a few characters, the host ends before the age${viewport.mobile ? " and is cut at its end" : ""}, its whole text is its title`, JSON.stringify(long));
      await page.evaluate(`document.querySelector(${JSON.stringify(inBoard("oats-board-facts"))})?.scrollIntoView({ block: "start" })`);
      await targets(page, viewport, check, at, `board-${viewport.name}-busy-facts`);
      await page.shot(`board-${viewport.name}-busy-facts`);
      await page.goto("/plugins/oats/home");
      const card = `document.querySelector(${JSON.stringify(`${testId("oats-needs-card")}[data-instance="${CHILD.instance}"]`)})`;
      const onHome = await page.until(`(() => { const c = ${card}; const q = c?.querySelector(${JSON.stringify(testId("oats-board-question"))}); if (!q) return ""; const r = c.getBoundingClientRect(); return JSON.stringify({ place: (${flat})(c.querySelector(${JSON.stringify(testId("oats-board-place"))})), options: c.querySelectorAll(${JSON.stringify(testId("oats-board-option"))}).length, height: Math.round(r.height), sideways: document.documentElement.scrollWidth > innerWidth + 1, window: innerHeight }); })()`, 40);
      const home = onHome ? JSON.parse(onHome) : null;
      check(home !== null && home.place === "1 of 9" && home.options === 4 && home.sideways === false, `${at} BUSY: the home's card draws the first of the nine questions with its four options; nothing is pushed off sideways`, String(onHome));
      await targets(page, viewport, check, at, `board-${viewport.name}-busy-home-card`);
      await page.shot(`board-${viewport.name}-busy-home-card`);
    },
  },
];
