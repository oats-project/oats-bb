// The instance panel's live scenes (container/live-ui.mjs says what a scene is). At 1280x800 the
// panel is the OATS tab of the agent's thread; at 390x800, where bb has no side panel, it is the
// agent's own page.
//   panel         the Instance tab of an agent that needs you, its folds open, its Soul tab, and a
//                 stopped agent; its readiness, its recorded activity and its soul as spawned,
//                 each also while it is read, when the kernel refuses it, and when a read again
//                 fails after one answered; readiness that is not ready, a provider that needs a
//                 sign-in and capability warnings; an incomplete and an empty activity window and
//                 a blocked launch's row; a soul with a filled core slot, a capability turned off,
//                 warnings, and only its core capabilities
//   panel-states  the states the first stage has none of: running (with a messaging id, an owning
//                 human and a sibling), idle, failed, unreachable with the kernel's runtime error,
//                 an agent with no thread in bb, a soul OATS does not name; the agent's page for a
//                 name OATS does not list and for no name; what the panel keeps when OATS cannot
//                 be read again, and the page when it could never be read; and that a panel opened
//                 again reads again.
//
// Two things the panel draws have no scene, because the live checks cannot hold them on screen:
// the instance's read in flight ("Reading this instance…") and the instance's read failing while
// the roster is read ("This instance could not be read", "This instance could not be read again."). The
// server answers `panelInstance` from the roster it holds in memory, in a few milliseconds and
// with no process to slow down or to fail: the first is over before a page can be read, and the
// second happens only between a failed status and the client's next snapshot. Both are drawn with
// the shared Loading, Notice and Stale, which the pattern book's scenes hold under the contrast
// check, and unit tests hold their words (test/panel/panel.test.tsx).
//
// Both stages have the fake `oats` print the roster recorded from the real kernel for the panel
// (test/fixtures/panel/status-board.json: a child on its own worktree, idle in bb, whose board asks
// a question and whose soul's repository moved on; and its parent, stopped), with its thread ids
// replaced by threads the live checks made in bb. It is the roster of the moment the recorded
// activity is of (test/fixtures/panel/events.json): one agent, one story, in every place the panel
// says it. The second stage changes that recording, in the open and only here: the fields a state
// is made of, and copies of the child's row under other
// names for the states that need an agent of their own. Those rows are not fixtures: no test reads
// them.
// The first stage's last two scenes change the recorded answers of `oats readiness`, `oats instance
// events` and `oats inspect` the same way (`derived`), for what the real run's deployment has none
// of: a provider that needs a sign-in, a capability warning, a truncated window, a blocked launch,
// a filled core slot. Readiness that is not ready is a recording
// (test/fixtures/panel/readiness-home-not-ready.json).
import { execFileSync } from "node:child_process";
import { appendFileSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { testId, textOf, visible } from "../browser.mjs";

const FIXTURE = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "test", "fixtures", "panel", "status-board.json");
const FIXTURES = dirname(FIXTURE);
/** A recorded answer of the panel's fixtures, changed for a scene: what the fake `oats` prints for a verb. */
function derived(file, change) {
  const document = JSON.parse(readFileSync(join(FIXTURES, file), "utf8"));
  change(document.result);
  return { stdout: JSON.stringify(document) };
}
/** The recorded inspection with the messaging slot filled (and, for an agent of another soul, that soul's name): what agrees with a messaging id on the Instance tab. */
const withMessaging = (soul = null) =>
  derived("inspect-home.json", (result) => {
    result.layers.messaging = { id: "oats.aweb", from: "workspace" };
    result.capabilities.push({ ...result.capabilities[1], id: "oats.aweb", layer: "messaging", from: { kind: "package", package: "oats.aweb", version: "1.4.0" } });
    if (soul !== null) result.souls[0].name = soul;
  });
/** A read that fails with no answer of the kernel's: the process ends badly. Reading again can go better. */
const FAILS = { stdout: "", stderr: "oats: internal error", exit: 1 };
const FAKE_CONFIG = join(homedir(), ".local/bin/fake-oats.json");
const CHILD = { instance: "panel-worktree-helper", recorded: "thr_kjrgkze2sz", thread: "thr_mockups" };
const PARENT = { instance: "redesign-ui-lead", recorded: "thr_bkyz48xf96", thread: "thr_redesign" };
// The second stage's agents of their own: copies of the child's row.
const IDLE = { instance: "panel-idle-helper", thread: "thr_ci" };
const SHELL = { instance: "panel-shell-helper", thread: "thr_harvest" };
const TMUX = { instance: "panel-tmux-helper", thread: null, soul: "oats-expert" };
const RUNNING_MODEL = "claude-opus-5-5";

/** The recorded roster, with bb's own ids for its two threads. */
function recorded(threads) {
  let status = readFileSync(FIXTURE, "utf8");
  for (const agent of [CHILD, PARENT]) status = status.replaceAll(agent.recorded, threads.get(agent.thread).id);
  return JSON.parse(status);
}

/** The second stage's roster: the recording, changed as the header of this file says. `model` is the running child's. */
function states(threads, model = RUNNING_MODEL, idleClaim = null) {
  const roster = recorded(threads);
  const groupOf = (instance) => roster.agents.find((group) => group.instances.some((row) => row.instance === instance));
  const rowOf = (instance) => groupOf(instance).instances.find((row) => row.instance === instance);
  const child = rowOf(CHILD.instance);
  const copy = (agent, change) => {
    const row = JSON.parse(JSON.stringify(child).replaceAll(CHILD.instance, agent.instance).replaceAll(threads.get(CHILD.thread).id, agent.thread === null ? "thr_none" : threads.get(agent.thread).id));
    Object.assign(row, { waitingOnYou: null, board: null }, change);
    return row;
  };
  // the child: running, with a messaging id, an owning human and a sibling. Its claim is cleared, and its board's
  // question with it (as the kernel does: a question that is cleared takes its claim with it); its facts stay.
  if (child.board) child.board = { ...child.board, questions: [] };
  Object.assign(child, { running: true, waitingOnYou: null, model, identityAddress: "oats.aweb.ai/panel-worktree-helper", attributedHuman: "Ana", siblingInstance: PARENT.instance });
  delete child.parentInstance;
  // its parent: the kernel cannot reach its session
  Object.assign(rowOf(PARENT.instance), { running: null, runtimeState: "unreachable", runtimeError: "bb did not answer at http://127.0.0.1:38886 (connection refused)" });
  delete rowOf(PARENT.instance).sessionEnd;
  groupOf(CHILD.instance).instances.push(copy(IDLE, { running: null, runtimeState: "unknown", waitingOnYou: idleClaim }));
  // an agent with no thread in bb: a tmux row
  const tmux = copy(TMUX, { running: true, runtimeState: "running", backend: "tmux", tmux: { session: "oats-agents", socket: "/tmp/tmux-1000/oats" }, open: null });
  delete tmux.session;
  groupOf(CHILD.instance).instances.push(tmux);
  // an agent whose session fell back to a shell, of a soul the roster does not name by a key
  const { instances: _instances, key: _key, description: _description, ...group } = groupOf(CHILD.instance);
  roster.agents.push({ ...group, name: "oats-legacy", instances: [copy(SHELL, { agent: "oats-legacy", running: false, runtimeState: "shell" })] });
  return roster;
}

/** What the fake `oats` answers for one verb from now on (null: its recorded answer again), while its other verbs stay as they are. */
function setVerb(verb, behaviour) {
  const config = JSON.parse(readFileSync(FAKE_CONFIG, "utf8"));
  const verbs = { ...config.verbs };
  if (behaviour === null) delete verbs[verb];
  else verbs[verb] = behaviour;
  // Written beside and moved into place: the fake reads this file at every `oats` it stands for, and
  // must never read half of it (a read that began during a plain write failed with no answer).
  writeFileSync(`${FAKE_CONFIG}.next`, JSON.stringify({ ...config, verbs }));
  renameSync(`${FAKE_CONFIG}.next`, FAKE_CONFIG);
}
const setStatus = (behaviour) => setVerb("status", behaviour);
/** A kernel refusal, as the kernel prints one. */
const refusal = (code, message) => ({ stdout: JSON.stringify({ schemaVersion: 1, ok: false, error: { code, message } }), exit: 1 });
/**
 * A change the kernel records, as live-ui.mjs's own `record` makes one for the fixtures: the fake
 * answers `roster` from now on, and one line is appended to the deployment's event log, which is
 * what the kernel does and what the plugin's watch sees. → the instant the change was recorded.
 */
const EVENTS = join(homedir(), "deployment", ".agents", "events", "live-ui.jsonl");
function record(roster) {
  setStatus({ stdout: JSON.stringify(roster) });
  const at = Date.now();
  appendFileSync(EVENTS, `${JSON.stringify({ kind: "live-ui", at: new Date(at).toISOString() })}\n`);
  return at;
}
/** Asks the plugin's server to read OATS again now, as its Retry does. */
function refresh() {
  const input = join(homedir(), "panel-refresh-input.json");
  writeFileSync(input, "null");
  execFileSync("bb", ["plugin", "rpc", "call", "oats", "refresh", "--input-file", input, "--json"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}
const REFUSED = refusal("E_LOCAL_MISSING", "no oats-local.yaml at or above this directory");

export const stages = {
  panel: {
    label: "P1",
    enter: async ({ fake, threads, untilSnapshot }) => {
      fake({ status: { stdout: JSON.stringify(recorded(threads)) } });
      await untilSnapshot((snapshot) => snapshot.ok === true && snapshot.agents.some((agent) => agent.instance === CHILD.instance && agent.threadId === threads.get(CHILD.thread).id && agent.waiting !== null));
    },
  },
  "panel-states": {
    label: "P2",
    enter: async ({ fake, threads, untilSnapshot }) => {
      // The second stage's agents have a messaging id: the soul they were spawned from fills the messaging slot.
      fake({ status: { stdout: JSON.stringify(states(threads)) }, "inspect --home": withMessaging() });
      await untilSnapshot((snapshot) => snapshot.ok === true && snapshot.agents.some((agent) => agent.instance === SHELL.instance) && snapshot.agents.some((agent) => agent.instance === CHILD.instance && agent.running === true));
    },
  },
};

const inPanel = (id) => `${testId("oats-panel")} ${testId(id)}`;
/** The header's state: [the mark's state, the word, what follows it, whether the mark is hidden from a screen reader]. */
const stateOf = `(() => { const line = document.querySelector(${JSON.stringify(`${testId("oats-panel")} ${testId("oats-panel-state")} ${testId("oats-status-line")}`)}); const state = line?.querySelector(${JSON.stringify(testId("oats-state"))}); const mark = state?.querySelector("[data-state]"); const word = state?.querySelector("span:not([data-state])")?.innerText.trim() ?? ""; const rest = [...(line?.querySelectorAll('[data-testid="oats-status-part"]') ?? [])].map((e) => e.innerText.replace(/\\s+/g, " ").trim()).join(" "); return JSON.stringify([mark?.getAttribute("data-state"), word, rest, mark?.getAttribute("aria-hidden") === "true"]); })()`;
const click = (selector) => `document.querySelector(${JSON.stringify(selector)}).click()`;

/**
 * The live checks' `check`, for this file's scenes: a check that fails always prints what it read.
 * The harness prints a failing check's detail unless it is "" (container/live-ui.mjs), and the
 * text of an element that is not on the page is "": the very case a failure is most often about.
 * So a detail that is no text, or empty text, is printed as its JSON (`""`, `null`, `false`), and
 * one that is undefined (a wait that ran out answers that) as `undefined`. A check given no detail
 * at all has none to print: its title says the one thing it read.
 */
const printing =
  (check) =>
  (ok, what, ...given) =>
    given.length === 0 ? check(ok, what) : check(ok, what, typeof given[0] === "string" && given[0] !== "" ? given[0] : String(JSON.stringify(given[0])));

/**
 * Shows the panel of `agent` the way a person gets to it: the OATS chip of its thread (the thread's
 * tab at 1280, the agent's own page at the phone's width), or for an agent with no thread in bb the
 * Open button of its row on its soul's page. → `ok`: the panel names the agent, where it should
 * be, in a side panel that is whole; `read`: what was read of those, for a failing check to print.
 */
async function open(page, viewport, threads, agent) {
  let whole = true;
  if (agent.thread === null) {
    await page.goto(`/plugins/oats/souls/${agent.soul}`);
    const row = `document.querySelector(${JSON.stringify(`${testId("oats-soul-agent-elsewhere")}[data-instance="${agent.instance}"]`)})`;
    await page.until(`Boolean(${row})`, 30);
    await page.evaluate(`${row}.querySelector(${JSON.stringify(testId("oats-soul-agent-open"))}).click()`);
  } else {
    const thread = threads.get(agent.thread);
    await page.goto(`/projects/${thread.projectId}/threads/${thread.id}`);
    await page.until(visible(testId("oats-open-panel")), 30);
    await page.evaluate(click(testId("oats-open-panel")));
    // bb's side panel must be whole before anything is opened in it (`panelWhole` says why).
    if (!viewport.mobile) whole = Boolean(await page.until(panelWhole, 30));
  }
  const shown = await page.until(`${visible(testId("oats-panel"))} && document.querySelector(${JSON.stringify(inPanel("oats-panel-name"))})?.getAttribute("title") === ${JSON.stringify(agent.instance)}`, 30);
  // The panel OPENS on its Board tab where the agent's board holds an open question (the recorded child's does:
  // scenes/board.mjs holds that): these scenes are of the Instance and Soul tabs, so the Instance tab is turned to,
  // as a person would, where it is not the one shown.
  if (shown) {
    const instanceTab = `document.getElementById("oats-panel-page-tab-instance")`;
    await page.until(`${instanceTab} !== null`, 10);
    await page.evaluate(`(() => { const tab = ${instanceTab}; if (tab && tab.getAttribute("aria-selected") !== "true") tab.click(); })()`);
    await page.until(`${instanceTab}?.getAttribute("aria-selected") === "true"`, 10);
  }
  // At the phone's width, and for an agent with no thread, that is the agent's own page.
  const onPage = viewport.mobile || agent.thread === null;
  const name = await page.evaluate(`document.querySelector(${JSON.stringify(inPanel("oats-panel-name"))})?.getAttribute("title") ?? null`);
  const path = await page.evaluate("location.pathname");
  return {
    ok: Boolean(shown) && whole && path.endsWith(`/plugins/oats/agent/${agent.instance}`) === onPage,
    read: `the panel names ${JSON.stringify(name)} (wanted ${JSON.stringify(agent.instance)}), at ${path} (wanted ${onPage ? "the agent's own page" : "the thread"})${whole ? "" : "; bb's side panel never became whole (panelWhole)"}`,
  };
}

/**
 * bb's side panel is whole. bb 0.50.1 can first draw the panel's tab strip
 * (`thread-secondary-panel-top-chrome`) and its content straight in the panel's column, whether
 * the panel came up open with the page (bb remembers it, and its tab) or was opened by the press,
 * and 40 to 400 ms later puts the two inside one more element (measured: the node that holds the
 * plugin's panel is removed from bb's `app-layout-content-shell` and a new one added, in 8 of 28
 * opens at 1280 px in each of two runs, whether or not the composer's footer has loaded). The plugin's tab is mounted
 * again by that: what a scene opened in it (a fold, whose open state is the DOM's) is closed
 * again, and the next read is of content that is not on the page. The panel is whole once the
 * element that holds both the tab strip and the plugin's panel is that inner one (bb gives it
 * `flex-1`; the column itself has `h-full`): from then on bb does not mount the panel again.
 */
const panelWhole = `(() => { const strip = document.querySelector('[data-testid="thread-secondary-panel-top-chrome"]'); const panel = document.querySelector(${JSON.stringify(testId("oats-panel"))}); if (!strip || !panel) return false; let both = strip; while (both && !both.contains(panel)) both = both.parentElement; return Boolean(both) && both.classList.contains("flex-1"); })()`;

/**
 * What is measured of the panel before a screenshot: nothing it draws reaches past the panel's own
 * right edge NOR past the window's (the panel draws within the part of bb's side panel that is in
 * the window: app/panel/Panel.tsx `useVisibleWidth`), the page does not scroll sideways, no word,
 * id or path segment is broken across two lines (a line may end at a space, after a slash or after
 * a hyphen, nowhere else), no two of its controls overlap where they are drawn (a press lands on
 * the control under it; what the scrolling page hides under the header, and what a closed fold
 * holds, is not drawn),
 * and every control of it is high enough to press.
 * `past` is how far bb's side panel itself reaches past the window: at 1280 with bb's sidebar, a
 * thread and the side panel open, bb 0.50.1 widens the thread's column once its composer has
 * loaded and pushes the side panel off the window (by how much varies with what
 * the page holds). That cut is bb's, on every tab of its side panel; it is printed with the check, not hidden and not held against the panel.
 */
async function fits(page, viewport, root = testId("oats-panel")) {
  const need = viewport.mobile ? 44 : 32;
  return JSON.parse(
    await page.evaluate(
      `(() => { const panel = document.querySelector(${JSON.stringify(root)}); const low = [...panel.querySelectorAll("button, summary, a")].filter((e) => e.getClientRects().length > 0 && e.getBoundingClientRect().height < ${need} - 0.5).map((e) => (e.innerText || e.getAttribute("aria-label") || e.tagName).trim() + " " + Math.round(e.getBoundingClientRect().height)); const edge = panel.getBoundingClientRect().right; const seen = Math.min(edge, document.documentElement.clientWidth); const broken = []; const walk = document.createTreeWalker(panel, NodeFilter.SHOW_TEXT); for (let node = walk.nextNode(); node; node = walk.nextNode()) { if (!node.parentElement || node.parentElement.getClientRects().length === 0) continue; const atom = /[^\\s\\/\\-]+/g; for (let found = atom.exec(node.data); found; found = atom.exec(node.data)) { if (found[0].length < 2) continue; const range = document.createRange(); range.setStart(node, found.index); range.setEnd(node, found.index + found[0].length); const tops = new Set([...range.getClientRects()].filter((box) => box.width > 0).map((box) => Math.round(box.top))); if (tops.size > 1) broken.push(found[0]); } } const wide = [...panel.querySelectorAll("*")].filter((e) => e.getClientRects().length > 0 && e.getBoundingClientRect().width > 0 && e.getBoundingClientRect().right > seen + 0.5).length; const shownBox = (e) => { const box = e.getBoundingClientRect(); const pane = e.closest('[role="tabpanel"]'); if (!pane) return box; const within = pane.getBoundingClientRect(); return { left: Math.max(box.left, within.left), right: Math.min(box.right, within.right), top: Math.max(box.top, within.top), bottom: Math.min(box.bottom, within.bottom) }; }; const targets = [...panel.querySelectorAll("a, button, summary")].filter((e) => e.getClientRects().length > 0 && (typeof e.checkVisibility !== "function" || e.checkVisibility())).map((e) => [e, shownBox(e)]).filter(([, box]) => box.right - box.left > 1 && box.bottom - box.top > 1); const overlap = []; for (let i = 0; i < targets.length; i += 1) for (let j = i + 1; j < targets.length; j += 1) { const [a, x] = targets[i], [b, y] = targets[j]; if (a.contains(b) || b.contains(a)) continue; if (Math.min(x.right, y.right) - Math.max(x.left, y.left) > 1 && Math.min(x.bottom, y.bottom) - Math.max(x.top, y.top) > 1) overlap.push((a.innerText || a.getAttribute("aria-label") || a.tagName).trim() + " / " + (b.innerText || b.getAttribute("aria-label") || b.tagName).trim()); } const turned = [...panel.querySelectorAll("details")].filter((fold) => fold.querySelector(":scope > summary")?.getClientRects().length > 0).filter((fold) => { const mark = fold.querySelector(':scope > summary [data-testid=oats-disclosure-mark]'); if (!mark) return false; const look = getComputedStyle(mark); const isTurned = look.transform !== "none" || (look.rotate !== undefined && look.rotate !== "none"); return isTurned !== fold.open; }).map((fold) => (fold.querySelector(":scope > summary").innerText.trim() + (fold.open ? " (open, its mark not turned)" : " (closed, its mark turned)"))); return JSON.stringify({ low, wide, broken, overlap, turned, scroll: document.documentElement.scrollWidth - innerWidth, past: Math.max(0, Math.round(edge - innerWidth)) }); })()`,
    ),
  );
}
/** The check of `fits`, printed as what it measures, with bb's own cut beside it. */
async function fitted(page, viewport, check, at, what) {
  const fit = await fits(page, viewport);
  check(
    fit.low.length === 0 && fit.wide === 0 && fit.scroll <= 0 && fit.broken.length === 0 && fit.overlap.length === 0 && fit.turned.length === 0,
    `${at} ${what}: nothing the panel draws is cut by its own edge or by the window's, no word, id or path segment is broken across two lines, no two controls overlap, a fold's mark is turned when its own fold is open and only then, and every control of the panel is high enough to press${fit.past > 0 ? ` (bb's side panel is ${fit.past} px past the window: bb's own layout at this width; the panel draws within what is in the window)` : ""}`,
    JSON.stringify(fit),
  );
}
/**
 * What a scene waits for before an image: nothing on the page is still moving, and bb's composer
 * under a thread has loaded its footer (from then on bb's layout no longer moves), so the light
 * and the dark image of one scene are taken of the same drawing.
 */
async function settled(page, viewport) {
  // A fold that was just opened turns its mark over a moment: an image is taken once nothing moves,
  // so the light and the dark image of one scene show the same drawing.
  await page.until(`document.getAnimations().every((animation) => animation.playState !== "running")`, 5);
  if (viewport.mobile) return;
  await page.until(`!location.pathname.includes("/threads/") || document.body.innerText.includes("Project checkout")`, 20);
}

const first = [
  {
    stage: "panel",
    name: "the Instance tab of an agent that needs you, its sections open, its Soul tab, a stopped agent",
    run: async ({ page, at, viewport, threads, check: plain }) => {
      const check = printing(plain);
      const where = viewport.mobile ? "the agent's page" : "the OATS tab of the agent's thread";
      {
        const opened = await open(page, viewport, threads, CHILD);
        check(opened.ok, `${at} the panel shows on ${where}`, opened.read);
      }
      await page.until(visible(inPanel("oats-panel-work-sentence")), 30);
      const tabs = await page.evaluate(`[...document.querySelectorAll('${testId("oats-panel")} [role="tablist"][aria-label="Instance context"] [role="tab"]')].map((e) => e.innerText.trim() + ":" + e.getAttribute("aria-selected")).join(" ")`);
      // The recorded child has a board: its tab is the first (the panel opened on it; `open` turned to Instance, which these scenes are of).
      check(tabs === "Board:false Instance:true Soul:false", `${at} the tabs, named Instance context: Board (the agent has a board), Instance (selected), Soul`, tabs);
      {
        const read = await page.evaluate(textOf(inPanel("oats-panel-name")));
        check(read === "Panel worktree helper", `${at} the header names the instance as words`, read);
      }
      // The state is a mark AND its word; beside its word the mark is hidden from a screen reader, which reads the word.
      const state = await page.evaluate(stateOf);
      check(/^\["needs-you","Needs you","· (under a minute|\d+ (min|h|d))",true\]$/.test(state), `${at} the header says the state in words beside its mark, and how long it has waited: Needs you · …`, state);
      // Its soul stands under its acts by its name alone: no "instance of".
      const soulLine = await page.evaluate(`(document.querySelector(${JSON.stringify(inPanel("oats-panel-soul-link"))})?.parentElement?.innerText ?? "").replace(/\\s+/g, " ").trim()`);
      check(soulLine === "oats-expert", `${at} the header names the soul alone, as the way to the Soul tab`, soulLine);
      // What it asks stands first on the page, under no heading: its message alone. How long it has waited is said once, in the header.
      const asks = await page.evaluate(`(() => { const block = document.querySelector(${JSON.stringify(inPanel("oats-panel-waiting"))}); return block ? JSON.stringify({ text: block.innerText.replace(/\\s+/g, " ").trim(), headings: block.querySelectorAll("h1, h2, h3").length, head: block.querySelector(${JSON.stringify(testId("oats-panel-waiting-head"))}) !== null, first: block.parentElement.firstElementChild === block }) : ""; })()`);
      check(asks === '{"text":"Which base branch?","headings":0,"head":false,"first":true}', `${at} what the agent asks is first on the page, under no heading: its message alone; no sentence for the reason, and no second age under the header's`, asks);
      const tip = await page.evaluate(`document.querySelector(${JSON.stringify(inPanel("oats-panel-state"))})?.getAttribute("title")`);
      check(tip === null, `${at} and the clock time is in no tooltip of the header (a phone has no hover): the activity's row holds the claim's instant`, String(tip));
      const asked = await page.evaluate(`(document.querySelector(${JSON.stringify(testId("oats-panel"))})?.innerText ?? "").split("Which base branch?").length - 1`);
      check(asked === 1, `${at} the question is said once in the pane`, String(asked));
      const work = await page.evaluate(textOf(inPanel("oats-panel-work-sentence")));
      check(work === "worktree · agents/panel-worktree-helper", `${at} Work: the mode as a fact, with its branch`, work);
      const session = await page.evaluate(textOf(inPanel("oats-panel-session"))); // (the heading is drawn in capitals: innerText reads what is drawn)
      check(/^SESSION Harness Claude Model claude-opus-5-5 Runs in bb thread Started \S.*$/.test(session) && !session.includes(threads.get(CHILD.thread).id) && !session.includes("the soul's choice"), `${at} Session: the harness, the model, where it runs in a word, since when, each a labelled fact; no id and no "where the model came from" on its face`, session);
      {
        const read = await page.evaluate(textOf(inPanel("oats-panel-lineage")));
        check(read.includes("Parent Redesign ui lead"), `${at} Lineage: the parent, by its name as words`, read);
      }
      await settled(page, viewport);
      await fitted(page, viewport, check, at, "the Instance tab");
      // The Instance tab's cards, each as high as what it holds: Work, Session, Lineage, Readiness, Activity.
      await page.shot(`panel-${viewport.name}-instance`, { gaps: ["oats-panel-work", "oats-panel-session", "oats-panel-lineage", "oats-panel-readiness-instance", "oats-panel-activity"].map(inPanel).join(", ") });

      // the older-build chip and the paths, open
      const moved = ["older build", "Its soul's repository has moved on since it was spawned."];
      const drift = await reads(page, inPanel("oats-panel-drift"), moved);
      check(holds(drift, moved), `${at} older build opens to what moved since the spawn`, drift);
      const folders = ["Folder", "/instances/panel-worktree-helper/work", "Home", `bb thread ${threads.get(CHILD.thread).id}`, "Model the soul's choice"];
      const paths = await reads(page, inPanel("oats-panel-paths"), folders);
      check(holds(paths, folders), `${at} Paths: the folder and the home, each with its Copy; then the session's id and where the model came from`, paths);
      const copies = await page.evaluate(`[...document.querySelectorAll('${testId("oats-panel-paths")} button')].map((e) => e.getAttribute("aria-label")).join(", ")`);
      check(copies === "Copy folder path, Copy home path", `${at} the Copy buttons are named for what they copy`, copies);
      await bring(page, check, at, "oats-panel-work");
      await settled(page, viewport);
      await fitted(page, viewport, check, at, "its folds open");
      await page.shot(`panel-${viewport.name}-instance-open`);

      // bb's side panel pushed past the window: the panel draws within what is in the window. bb 0.50.1 did this by
      // itself in the live checks up to oats-bb 84720c5 (by up to 138 px at 1280 px) and has not since; what made it
      // stop was not found, so the scene makes it: bb's panel column is moved 120 px to the right by hand.
      if (!viewport.mobile) {
        const push = (px) => `(() => { let column = document.querySelector(${JSON.stringify(testId("oats-panel"))}); while (column && !String(column.className).includes("transition-[flex")) column = column.parentElement; if (!column) return false; column.style.transform = ${JSON.stringify("")} + (${px} === 0 ? "" : "translateX(" + ${px} + "px)"); return true; })()`;
        const widths = `(() => { const panel = document.querySelector(${JSON.stringify(testId("oats-panel"))}); const inner = document.querySelector(${JSON.stringify(inPanel("oats-panel-visible"))}); const box = panel.getBoundingClientRect(); return JSON.stringify({ past: Math.round(box.right - document.documentElement.clientWidth), panel: Math.round(box.width), drawn: Math.round(inner.getBoundingClientRect().width), right: Math.round(inner.getBoundingClientRect().right) }); })()`;
        const pushed = await page.evaluate(push(120));
        check(pushed === true, `${at} bb's side panel column is found, to push it`, pushed);
        const narrowed = await page.until(`(() => { const now = JSON.parse(${widths}); return now.past > 0 && now.right <= document.documentElement.clientWidth ? JSON.stringify(now) : ""; })()`, 15);
        const now = JSON.parse(narrowed ?? (await page.evaluate(widths)));
        check(now.past === 120 && now.drawn === now.panel - 120, `${at} pushed 120 px past the window, the panel draws 120 px narrower: all of it is in the window`, JSON.stringify(now));
        await fitted(page, viewport, check, at, "bb's side panel pushed past the window");
        await page.shot(`panel-${viewport.name}-pushed`);
        await page.evaluate(push(0));
        const back = await page.until(`(() => { const now = JSON.parse(${widths}); return now.past <= 0 && now.drawn === now.panel ? JSON.stringify(now) : ""; })()`, 15);
        check(Boolean(back), `${at} back in the window, the panel is as wide as bb gives it`, back ?? (await page.evaluate(widths)));
      }

      // the Soul tab, from the soul's name in the header
      await page.evaluate(click(inPanel("oats-panel-soul-link")));
      check(Boolean(await page.until(`${textOf(inPanel("oats-panel-soul-name"))} === "oats-expert"`, 15)), `${at} the soul's name opens the Soul tab`, await page.evaluate(textOf(inPanel("oats-panel-soul-name"))));
      {
        const read = await page.evaluate(textOf(inPanel("oats-panel-soul-description")));
        check(read === "OATS expert: answers questions about OATS.", `${at} the Soul tab: the soul's description`, read);
      }
      // No lone "Details" at the tab's foot: the agents root is said under what it explains (Readiness's fold, "Soul: <key> · <agents root>": the unit tests read it).
      const lone = await page.evaluate(`JSON.stringify({ details: document.querySelector(${JSON.stringify(inPanel("oats-panel-details"))}) !== null, said: /agents root/i.test(document.querySelector(${JSON.stringify(inPanel("oats-panel-page-soul"))})?.innerText ?? "") })`);
      check(lone === '{"details":false,"said":false}', `${at} the Soul tab has no fold of its own for the agents root at its foot`, lone);
      const offered = await page.evaluate(`document.querySelector(${JSON.stringify(inPanel("oats-panel-open-soul"))})?.disabled ?? null`);
      check(offered === false, `${at} Open soul page is offered`, `the button's disabled: ${offered} (null: no such button)`);
      await settled(page, viewport);
      await fitted(page, viewport, check, at, "the Soul tab");
      // No image here: the Soul tab's image is the next scene's (`soul-spawned`), taken once its body is read.
      await page.evaluate(click(inPanel("oats-panel-open-soul")));
      check(Boolean(await page.until(`location.pathname.endsWith("/plugins/oats/souls/oats-expert")`, 15)), `${at} Open soul page opens the soul on the Souls page`, await page.evaluate("location.pathname"));

      // a stopped agent, in its own folder
      {
        const opened = await open(page, viewport, threads, PARENT);
        check(opened.ok, `${at} the stopped agent's panel shows on ${where}`, opened.read);
      }
      await page.evaluate(click(inPanel("oats-tab-instance")));
      await page.until(visible(inPanel("oats-panel-work-sentence")), 30);
      const stopped = await page.evaluate(stateOf);
      check(stopped === JSON.stringify(["stopped", "Stopped", "", true]), `${at} a stopped agent's header says Stopped, beside its mark`, stopped);
      {
        const read = await page.evaluate(textOf(inPanel("oats-panel-work-sentence")));
        check(read === "own folder", `${at} Work: an agent in its own folder, in two words`, read);
      }
      check(!(await page.evaluate(visible(inPanel("oats-panel-waiting")))), `${at} a stopped agent shows no question`);
      await settled(page, viewport);
      await fitted(page, viewport, check, at, "a stopped agent");
      await page.shot(`panel-${viewport.name}-instance-stopped`);
      if (viewport.mobile) {
        await page.evaluate(click(testId("oats-agent-back")));
        check(Boolean(await page.until(`location.pathname.endsWith("/threads/${threads.get(PARENT.thread).id}")`, 15)), `${at} Back returns to the agent's thread`, await page.evaluate("location.pathname"));
      }
    },
  },
];

/**
 * The text of a part of the panel as a person reads it once every fold around it and in it is
 * open: a fold's content is not text of the page while the fold is closed.
 */
const unfolded = (selector) =>
  `(() => { const e = document.querySelector(${JSON.stringify(selector)}); if (!e) return ""; for (let fold = e.closest("details"); fold; fold = fold.parentElement?.closest("details")) fold.open = true; e.querySelectorAll("details").forEach((fold) => { fold.open = true; }); return e.innerText.replace(/\\s+/g, " ").trim(); })()`;
/**
 * Reads a part of the panel: opens its folds and waits until its text holds every one of `wants`
 * (a fold opened while the panel draws again is opened again at the next look). → that text; when
 * it never held them, what was read last, in words a failing check prints.
 */
async function reads(page, selector, wants, seconds = 15) {
  const text = unfolded(selector);
  const read = await page.until(`(() => { const text = ${text}; return ${JSON.stringify(wants)}.every((want) => text.includes(want)) ? text : ""; })()`, seconds);
  return read ?? `(not there after ${seconds} s; read: ${JSON.stringify(await page.evaluate(text))})`;
}
/** Whether `text` holds every one of `wants`. */
const holds = (text, wants) => wants.every((want) => text.includes(want));
/** The titled notice of a part of the panel, as a person reads it: "title | role | all its text"; "" with none. */
const noticeOf = (part) =>
  `(() => { const e = document.querySelector(${JSON.stringify(`${inPanel(part)} ${testId("oats-notice")}`)}); return e ? e.querySelector("h3").innerText.trim() + " | " + e.getAttribute("role") + " | " + e.innerText.replace(/\\s+/g, " ").trim() : ""; })()`;
/**
 * A part's notice once its read has ended, holding every one of `wants` (and `also`, a condition
 * of the page). A failed read's notice is there in two states: while that read is tried again its
 * act says "Reading…", and once it has ended, "Retry". A check of the notice's words and its act
 * is about the second state, so it waits for it: a notice read the moment it is there can be the
 * first. → the notice as `noticeOf` reads it; when the wait runs out, what is there then, which
 * the check fails on and prints.
 */
async function noticeAtRest(page, part, { wants = [], also = "true", seconds = 30 } = {}) {
  const notice = JSON.stringify(`${inPanel(part)} ${testId("oats-notice")}`);
  const reading = `[...(document.querySelector(${notice})?.querySelectorAll("button") ?? [])].some((act) => act.innerText.trim() === "Reading…")`;
  const read = await page.until(`(() => { const t = ${noticeOf(part)}; return t !== "" && !${reading} && ${JSON.stringify(wants)}.every((want) => t.includes(want)) && (${also}) ? t : ""; })()`, seconds);
  return read ?? (await page.evaluate(noticeOf(part)));
}
/** Whether a notice (as `noticeOf` reads it) offers Retry. */
const offersRetry = (read) => /(^| )Retry( |$)/.test(read ?? "");

/**
 * Brings a part of the panel into view for an image. The page scrolls to the start of one of its
 * parts, with room above it, so an image never opens on a sliced heading, card or sentence: to the
 * named part's own start where the page can scroll that far, else (a part near the page's end) to
 * the latest part's start from which the named part's heading and first lines are still in view;
 * where no part's start does that (a short page end under a tall header, at a phone's width), to
 * the page's end, as a person scrolls there: the named part is whole, and the part above it is
 * cut where the page's end cuts it. → whether the named part's heading and first lines are in view.
 */
const scroll = (id) =>
  `(() => { const part = document.querySelector(${JSON.stringify(inPanel(id))}); const pane = part?.closest('[role="tabpanel"]'); if (!part || !pane) return false; const box = () => pane.getBoundingClientRect(); const at = (e) => e.getBoundingClientRect().top - box().top + pane.scrollTop; const most = pane.scrollHeight - pane.clientHeight; const need = at(part) + Math.min(part.getBoundingClientRect().height, 96); const starts = [...pane.children].map((child) => Math.max(0, at(child) - 12)).filter((start) => start <= most + 0.5 && start <= at(part) && need <= start + pane.clientHeight).sort((a, b) => b - a); pane.scrollTop = starts.length > 0 ? starts[0] : Math.min(most, Math.max(0, at(part) - 12)); const top = part.getBoundingClientRect().top; return top >= box().top - 0.5 && top + Math.min(part.getBoundingClientRect().height, 96) <= box().bottom + 0.5; })()`;
/** Brings a part into view (`scroll`) and checks that it is: the part an image is named for is in the image. */
async function bring(page, check, at, id) {
  const inView = await page.evaluate(scroll(id));
  check(inView === true, `${at} ${id} is in view for its image: its heading and first lines, with nothing sliced above it`, inView);
}


const second = [
  {
    stage: "panel",
    name: "readiness and the recorded activity on the Instance tab; the soul as spawned and its readiness on the Soul tab",
    run: async ({ page, at, viewport, threads, check: plain }) => {
      const check = printing(plain);
      {
        const opened = await open(page, viewport, threads, CHILD);
        check(opened.ok, `${at} the panel is open`, opened.read);
      }
      await page.evaluate(click(inPanel("oats-tab-instance")));

      // the instance's readiness: the summary up front, the checks and the policy behind a fold
      const ready = await page.until(`${textOf(inPanel("oats-panel-readiness-instance") + " " + testId("oats-panel-readiness-summary"))}`, 30);
      check(ready === "Ready", `${at} Readiness: the summary, in a word`, ready);
      // Closed, the block is its heading (one word for both tabs), the summary, its one fold and its one act.
      const readinessFace = await page.evaluate(textOf(inPanel("oats-panel-readiness-instance")));
      check(/^readiness Ready ▸ ?Checks and policy Refresh$/i.test(readinessFace), `${at} Readiness, closed: its heading, "Ready", "Checks and policy" and Refresh, and nothing else`, readinessFace);
      const fourChecks = ["Instance: panel-worktree-helper · ", "Independent kernel observations, not launch permission.", "Target: instance.", "Installed pass", "Configured not-applicable", "Member pass", "Providers pass", "oats.bb session backend bb · pass · required · 2 warnings", "View policy"];
      const checks = await reads(page, inPanel("oats-panel-readiness-checks"), fourChecks);
      check(holds(checks, fourChecks), `${at} Checks and policy: the four checks with their items, and the policy`, checks);
      {
        // An item that does not apply says so in the kernel's word, as the Desktop's line does: for an agent on a session
        // provider the kernel reads no folder trust (OATS 0.70.5), and names no configuration file.
        const launch = await page.evaluate(`(() => { const item = [...document.querySelectorAll(${JSON.stringify(`${inPanel("oats-panel-readiness-checks")} ${testId("oats-panel-check-item")}`)})].map((node) => ({ node, line: (node.querySelector("summary") ?? node).textContent.split("▸").join("").split(/\\s+/).join(" ").trim() })).find((each) => each.line.startsWith("launch ")); return item ? JSON.stringify({ line: item.line, facts: [...item.node.querySelectorAll("dt")].map((dt) => dt.textContent.trim()) }) : ""; })()`);
        const read = launch ? JSON.parse(launch) : null;
        check(read !== null && read.line === "launch · not-applicable · optional" && read.facts.includes("Reason") && !read.facts.includes("Configuration file"), `${at} the launch item, which does not apply to an agent on a session provider, says "not-applicable" on its line, with the kernel's reason and no configuration file`, launch || checks);
      }
      const allowed = ["Lifecycle authority, not an OS sandbox.", "Child spawns: allowed · enforced · default: no spawn option: children allowed"];
      const policy = await reads(page, inPanel("oats-panel-policy"), allowed);
      check(holds(policy, allowed), `${at} View policy: what is allowed, and by whom`, policy);
      await bring(page, check, at, "oats-panel-readiness-instance");
      await settled(page, viewport);
      await fitted(page, viewport, check, at, "readiness");
      await page.shot(`panel-${viewport.name}-readiness`);

      // the recorded activity: nothing until a person asks
      const before = await page.evaluate(textOf(inPanel("oats-panel-activity")));
      check(/^activity load$/i.test(before), `${at} the activity is not read until asked: its heading and Load`, before);
      await page.evaluate(click(inPanel("oats-panel-activity-load")));
      const summary = await page.until(`${textOf(inPanel("oats-panel-activity-summary"))}`, 30);
      check(/^Last: Waiting claim · (\w{3} \d+, |\d{4}-\d\d-\d\d )?\d\d:\d\d$/.test(summary ?? ""), `${at} Load reads it: "Last:", the newest row's kind and its instant in the plugin's one form; nothing of what the agent waits for (the header says that)`, summary);
      {
        const read = await page.until(`(() => { const face = ${textOf(inPanel("oats-panel-activity"))}; return /Refresh$/.test(face) && document.querySelector(${JSON.stringify(inPanel("oats-panel-activity-status"))}) === null ? face : ""; })()`, 15);
        check(/^activity Last: Waiting claim · .+ ▸ ?Events Refresh$/i.test(read ?? ""), `${at} and the block is then its heading, the newest event, the fold "Events" and Refresh: no line says that it was loaded`, read ?? (await page.evaluate(textOf(inPanel("oats-panel-activity")))));
      }
      const rows = ["What OATS recorded about this agent, newest first. It is history, not what the agent does now.", "8 displayed / 8 observed rows. This is address history, not current runtime state.", "Spawned", "Work mode worktree", "Reading this starts nothing and allows nothing."];
      const list = await reads(page, inPanel("oats-panel-activity-list"), rows);
      check(holds(list, rows), `${at} Events: the window, the rows with their facts, the note`, list.slice(0, 400));
      // The titles as a person reads them, with their fold open: waited for, like the fold's text.
      const eight = "Waiting claim, Launched, Stopped, Launched, Restarted, Waiting claim, Launched, Spawned";
      const titlesOf = `(() => { ${unfolded(inPanel("oats-panel-activity-list"))}; return [...document.querySelectorAll(${JSON.stringify(`${inPanel("oats-panel-activity-list")} ${testId("oats-panel-event")} strong`)})].map((e) => e.innerText.trim()).join(", "); })()`;
      const titles = (await page.until(`(() => { const titles = ${titlesOf}; return titles === ${JSON.stringify(eight)} ? titles : ""; })()`, 15)) ?? `(not there after 15 s; read: ${JSON.stringify(await page.evaluate(titlesOf))})`;
      check(titles === eight, `${at} the rows, newest first, by the Desktop's titles`, titles);
      await bring(page, check, at, "oats-panel-activity");
      await settled(page, viewport);
      await fitted(page, viewport, check, at, "activity");
      await page.shot(`panel-${viewport.name}-activity`);

      // the Soul tab: the soul as spawned
      await page.evaluate(click(inPanel("oats-tab-soul")));
      const spawned = await page.until(`${textOf(inPanel("oats-panel-spawned-from"))}`, 30);
      check(spawned === "Spawned from oats-expert @ ca07fa8", `${at} the Soul tab: where the instance was spawned from`, spawned);
      {
        const read = await page.evaluate(`JSON.stringify({ sentence: document.querySelector(${JSON.stringify(inPanel("oats-panel-as-spawned"))}) !== null, modules: document.querySelector(${JSON.stringify(inPanel("oats-panel-modules"))}) !== null, said: /never changes under itself|Modules as spawned/.test(document.querySelector(${JSON.stringify(inPanel("oats-panel-soul-body"))}).innerText) })`);
        check(read === JSON.stringify({ sentence: false, modules: false, said: false }), `${at} with no sentence that explains "as spawned", and no count of modules`, read);
      }
      check((await page.evaluate(factsOf("oats-panel-core"))) === "Knowledge: None | Messaging: None | Tasks: None", `${at} Core capabilities: the three slots (none is filled in the recording)`, await page.evaluate(factsOf("oats-panel-core")));
      // Each capability is a row that opens, closed until pressed: its name and why it is here in a word.
      const capabilities = await page.evaluate(textOf(inPanel("oats-panel-capabilities")));
      const closed = await page.evaluate(`[...document.querySelectorAll(${JSON.stringify(`${inPanel("oats-panel-capabilities")} details`)})].filter((fold) => fold.open).length`);
      check(/^capabilities 2 ▸ ?oats\.bb default ▸ ?oats\.core default$/i.test(capabilities) && closed === 0, `${at} Capabilities: each a row with its name and why it is here in a word, closed`, capabilities);
      // One press away, in the row: why in a sentence, and where it comes from.
      const opened = ["oats.core default Here because Not declared by this soul: a workspace or team default (the kernel does not say which) From oats.framework 1.26.0"];
      const rowsOpen = await reads(page, inPanel("oats-panel-capabilities"), opened);
      check(holds(rowsOpen, opened), `${at} a capability's row opens to why it is there in a sentence, and its source`, rowsOpen);
      const soulReady = await page.until(`${textOf(inPanel("oats-panel-readiness-soul") + " " + testId("oats-panel-readiness-summary"))}`, 30);
      check(soulReady === "Ready", `${at} the soul's Readiness: the summary, in a word`, soulReady);
      {
        const read = await page.evaluate(`(document.querySelector(${JSON.stringify(`${inPanel("oats-panel-readiness-soul")} h2`)})?.innerText ?? "").trim()`);
        check(/^readiness$/i.test(read), `${at} under one heading, "Readiness": the tab says whose it is`, read);
      }
      await settled(page, viewport);
      await fitted(page, viewport, check, at, "the soul as spawned");
      await page.shot(`panel-${viewport.name}-soul-spawned`);
      await page.evaluate(click(inPanel("oats-tab-instance")));
    },
  },
  {
    stage: "panel",
    name: "a read in flight and a refused read, of readiness, of the activity and of the soul as spawned",
    run: async ({ page, at, viewport, threads, check: plain }) => {
      const check = printing(plain);
      const slow = (verb) => setVerb(verb, { file: { "readiness --home": "panel/readiness-home.json", "instance events": "panel/events.json", "inspect --home": "panel/inspect-home.json", "readiness --soul": "panel/readiness-soul.json" }[verb], sleepMs: 6000 });
      try {
        // in flight: the kernel takes its time
        slow("readiness --home");
        {
          const opened = await open(page, viewport, threads, CHILD);
          check(opened.ok, `${at} the panel is open`, opened.read);
        }
        await page.evaluate(click(inPanel("oats-tab-instance")));
        const loading = await page.until(`${textOf(inPanel("oats-panel-readiness-instance") + " " + testId("oats-loading"))}`, 15);
        check(loading === "Reading…", `${at} while readiness is read: Reading…`, loading);
        await bring(page, check, at, "oats-panel-readiness-instance");
        await page.shot(`panel-${viewport.name}-readiness-loading`);
        // One state per image: the activity is asked for once readiness is there, so this image shows the activity alone in flight.
        await page.until(`${textOf(inPanel("oats-panel-readiness-instance") + " " + testId("oats-panel-readiness-summary"))} !== ""`, 30);
        slow("instance events");
        await page.evaluate(click(inPanel("oats-panel-activity-load")));
        const reading = await page.until(`${textOf(inPanel("oats-panel-activity") + " " + testId("oats-loading"))}`, 15);
        check(reading === "Reading…", `${at} while the activity is read: Reading…`, reading);
        await bring(page, check, at, "oats-panel-activity");
        await page.shot(`panel-${viewport.name}-activity-loading`);
        // Both reads of the Soul tab take their time, so this image shows both in flight in either theme.
        slow("inspect --home");
        slow("readiness --soul");
        await page.evaluate(click(inPanel("oats-tab-soul")));
        const soul = await page.until(`${textOf(inPanel("oats-panel-soul-body") + " " + testId("oats-loading"))}`, 15);
        {
          const read = await page.until(`${textOf(inPanel("oats-panel-readiness-soul") + " " + testId("oats-loading"))}`, 15);
          check(read === "Reading…", `${at} and while the soul's readiness is read: Reading…`, read);
        }
        check(soul === "Reading…", `${at} while the soul is read: Reading…`, soul);
        await page.shot(`panel-${viewport.name}-soul-loading`);

        // refused: what happened in one sentence of a person's, the kernel's code after it; what to do next and the
        // kernel's message under Details; Retry only where reading again can change the answer
        setVerb("readiness --home", refusal("E_HOME_MISMATCH", "the home is not this deployment's"));
        setVerb("instance events", refusal("E_AMBIGUOUS_INSTANCE", "two homes hold an instance of this name"));
        setVerb("inspect --home", refusal("E_UNSUPPORTED_MODE", "this home has no modules"));
        setVerb("readiness --soul", FAILS);
        {
          const opened = await open(page, viewport, threads, CHILD);
          check(opened.ok, `${at} the panel is open again`, opened.read);
        }
        await page.evaluate(click(inPanel("oats-tab-soul")));
        // the soul's readiness, failed: reading again may go better, so Retry. (Waited for first: the soul's own read, refused, draws nothing to wait on.)
        const soulReadinessFailed = await noticeAtRest(page, "oats-panel-readiness-soul");
        // The soul as spawned, where OATS keeps none for this kind of agent: nothing to show, so nothing is
        // drawn for it: no notice, no sentence that says there is nothing, and nothing to press.
        const soulRefused = await page.until(`(() => { const body = document.querySelector(${JSON.stringify(inPanel("oats-panel-soul-body"))}); return body && body.querySelector(${JSON.stringify(testId("oats-loading"))}) === null ? JSON.stringify({ text: body.innerText.replace(/\\s+/g, " ").trim(), notices: body.querySelectorAll(${JSON.stringify(testId("oats-notice"))}).length, again: document.querySelectorAll(${JSON.stringify(inPanel("oats-panel-soul-again"))}).length, said: /OATS keeps no record|E_UNSUPPORTED_MODE/.test(document.querySelector(${JSON.stringify(testId("oats-panel"))}).innerText) }) : ""; })()`, 30);
        check(
          soulRefused === JSON.stringify({ text: "", notices: 0, again: 0, said: false }),
          `${at} the soul as spawned, where OATS keeps none for this kind of agent: nothing is drawn for it, neither a notice nor a sentence, and nothing to press`,
          soulRefused,
        );
        check(
          (soulReadinessFailed ?? "").startsWith("Readiness could not be read | alert | ") && soulReadinessFailed.includes("The installed CLI could not complete the readiness read.") && soulReadinessFailed.includes("OATS_FAILED") && offersRetry(soulReadinessFailed),
          `${at} the soul's readiness, failed: a person's sentence, the code, and Retry`,
          soulReadinessFailed,
        );
        await settled(page, viewport);
        await fitted(page, viewport, check, at, "the Soul tab's refused reads");
        await page.shot(`panel-${viewport.name}-soul-refused`);
        await page.evaluate(click(inPanel("oats-tab-instance")));
        const readinessRefused = await page.until(noticeOf("oats-panel-readiness-instance"), 30);
        check(
          (readinessRefused ?? "").startsWith("Readiness could not be read | alert | ") && /^Readiness could not be read This agent's folder is no longer the one OATS recorded for it\. E_HOME_MISMATCH ▸ ?Details$/.test(readinessRefused.split(" | ")[2] ?? "") && !offersRetry(readinessRefused),
          `${at} readiness, refused: what happened in one sentence, then the kernel's code, and Details; no Retry that cannot help`,
          readinessRefused,
        );
        {
          const own = await page.evaluate(textOf(`${inPanel("oats-panel-readiness-instance")} ${testId("oats-panel-readiness-refresh")}`));
          check(own === "Refresh", `${at} and the part's own Refresh stays`, own);
        }
        await page.evaluate(click(inPanel("oats-panel-activity-load")));
        const activityRefused = await page.until(noticeOf("oats-panel-activity"), 30);
        check(
          (activityRefused ?? "").startsWith("The recorded activity could not be read | alert | ") && /^The recorded activity could not be read OATS knows more than one agent by this name\. E_AMBIGUOUS_INSTANCE ▸ ?Details$/.test(activityRefused.split(" | ")[2] ?? "") && !offersRetry(activityRefused),
          `${at} the activity, refused: what happened in one sentence, then the kernel's code, and Details; no Retry that cannot help`,
          activityRefused,
        );
        {
          // What to do next is one press away, with the kernel's own message: under each notice's fold.
          const nextReadiness = ["`oats status`, on the machine that holds it, shows where the agent is now.", "E_HOME_MISMATCH: the home is not this deployment's"];
          const nextActivity = ["Retire or rename one of them with OATS, on the machine that holds them.", "E_AMBIGUOUS_INSTANCE: two homes hold an instance of this name"];
          const underReadiness = await reads(page, `${inPanel("oats-panel-readiness-instance")} ${testId("oats-notice-details")}`, nextReadiness);
          const underActivity = await reads(page, `${inPanel("oats-panel-activity")} ${testId("oats-notice-details")}`, nextActivity);
          check(holds(underReadiness, nextReadiness) && holds(underActivity, nextActivity), `${at} under Details: what to do next, then the kernel's code and message`, `${underReadiness} || ${underActivity}`);
          // (The folds are closed again for the image: closed is how a person meets them.)
          await page.evaluate(`document.querySelectorAll(${JSON.stringify(`${testId("oats-panel")} ${testId("oats-notice-details")}`)}).forEach((fold) => { fold.open = false; })`);
        }
        await bring(page, check, at, "oats-panel-readiness-instance");
        await settled(page, viewport);
        await fitted(page, viewport, check, at, "refused reads");
        await page.shot(`panel-${viewport.name}-reads-refused`);

        // Refresh, the section's own act, once the kernel answers
        setVerb("readiness --home", null);
        await page.evaluate(click(`${inPanel("oats-panel-readiness-instance")} ${testId("oats-panel-readiness-refresh")}`));
        const again = await page.until(`${textOf(inPanel("oats-panel-readiness-instance") + " " + testId("oats-panel-readiness-summary"))}`, 30);
        check(again === "Ready", `${at} Refresh reads it again`, again);
      } finally {
        for (const verb of ["readiness --home", "readiness --soul", "instance events", "inspect --home"]) setVerb(verb, null);
        await page.evaluate(click(inPanel("oats-tab-instance")));
      }
    },
  },
  {
    stage: "panel",
    name: "readiness that is not ready, a sign-in needed, warnings; an incomplete and an empty activity window, a blocked launch; a read again that fails",
    run: async ({ page, at, viewport, threads, check: plain }) => {
      const check = printing(plain);
      const VERBS = ["readiness --home", "readiness --soul", "instance events", "inspect --home"];
      const summaryOf = (of) => textOf(`${inPanel(`oats-panel-readiness-${of}`)} ${testId("oats-panel-readiness-summary")}`);
      const flat = (selector) => `(() => { const e = document.querySelector(${JSON.stringify(selector)}); return e ? e.innerText.replace(/\\s+/g, " ").trim() : ""; })()`;
      try {
        // not ready: the kernel's own answer when it cannot run bb (a recording)
        setVerb("readiness --home", { file: "panel/readiness-home-not-ready.json" });
        // the soul's: a provider that is set up and not signed in, and one capability warning
        setVerb("readiness --soul", derived("readiness-soul.json", (result) => {
          const item = result.checks.providers.items[0];
          Object.assign(item, { status: "fail", required: true, reason: "sign in to bb on this computer", result: { status: "authorization-required", problems: [{ code: "E_BACKEND_SIGNED_OUT", message: "sign in to bb on this computer" }], warnings: [] } });
          result.checks.providers.status = "fail";
          Object.assign(result.summary, { ready: false, required: 4, fail: 1 });
          result.warnings = [{ code: "hook-event-unsupported", capability: "oats.bb", path: "oats.json", message: "one declared hook never runs here: bb has no session-end event" }];
        }));
        {
          const opened = await open(page, viewport, threads, CHILD);
          check(opened.ok, `${at} the panel is open`, opened.read);
        }
        await page.evaluate(click(inPanel("oats-tab-instance")));
        const notReady = await page.until(`${summaryOf("instance")} === "1 failing · 0 unknown · 4 required checks"`, 30);
        check(Boolean(notReady), `${at} Instance readiness, not ready: how many fail, are unknown and are required`, await page.evaluate(summaryOf("instance")));
        const failed = ["Providers fail", "oats.bb session backend bb · fail · required · 2 warnings", "Producer session provider check", "Reason the bb version could not be read (cannot run bb: spawn bb ENOENT: install bb-app or set settings.oats.bb.cli)", "Problem code E_BACKEND_VERSION", "The provider says: needs configuration.", "Warning: bubblewrap (bwrap) is not on this host's PATH"];
        const failing = await reads(page, `${inPanel("oats-panel-readiness-instance")} ${testId("oats-panel-check-providers")}`, failed);
        check(holds(failing, failed), `${at} the failing check, open: the item's line, its producer, the kernel's reason, the problem's code, the provider's own answer and its warnings`, failing);
        await bring(page, check, at, "oats-panel-readiness-instance");
        await settled(page, viewport);
        await fitted(page, viewport, check, at, "readiness that is not ready");
        await page.shot(`panel-${viewport.name}-readiness-not-ready`);

        // Refresh reads again, and then says nothing more: what it read stands there, and no line says "updated".
        // (The kernel answers "ready" from now on: the summary that changes is the proof that it was read again.)
        setVerb("readiness --home", null);
        await page.evaluate(click(`${inPanel("oats-panel-readiness-instance")} ${testId("oats-panel-readiness-refresh")}`));
        const updated = await page.until(`(() => { const part = document.querySelector(${JSON.stringify(inPanel("oats-panel-readiness-instance"))}); const button = part?.querySelector(${JSON.stringify(testId("oats-panel-readiness-refresh"))}); return ${summaryOf("instance")} === "Ready" && button && !button.disabled && part.querySelector(${JSON.stringify(testId("oats-panel-readiness-status"))}) === null ? part.innerText.replace(/\\s+/g, " ").trim() : ""; })()`, 30);
        check(Boolean(updated) && !/Readiness updated/.test(updated ?? ""), `${at} Refresh reads readiness again ("Ready" now) and then says nothing more: no line says "updated"`, updated ?? (await page.evaluate(textOf(inPanel("oats-panel-readiness-instance")))));

        // the activity: an incomplete window, and a blocked launch's row
        setVerb("instance events", derived("events.json", (result) => {
          result.truncated = true;
          result.integrity.unreadableRows = 1;
          result.events.push({ ...result.events[1], at: "2026-11-23T18:27:26.000Z", kind: "launch-prompt", data: { status: "blocked", class: "development-channel", differed: { nearest: "claude-folder-trust-2", firstDifference: { index: 12, expected: "Do you trust the files in this folder?", found: "" } } } });
        }));
        await page.evaluate(click(inPanel("oats-panel-activity-load")));
        const blocked = await page.until(`${textOf(inPanel("oats-panel-activity-summary"))}.startsWith("Last: Launch prompt · ")`, 30);
        check(Boolean(blocked), `${at} the activity's summary says "Last:" and the last row: a launch prompt`, await page.evaluate(textOf(inPanel("oats-panel-activity-summary"))));
        const incompleteLine = await reads(page, inPanel("oats-panel-activity-incomplete"), ["Incomplete evidence"]);
        check(incompleteLine === "Incomplete evidence: 1 unreadable rows · 0 foreign rows · window or source truncated.", `${at} an incomplete window says what is missing`, incompleteLine);
        const differed = await reads(page, inPanel("oats-panel-event-differed"), ["Where the screen first differed"]);
        check(differed === "Where the screen first differed from the confirmation OATS answers: OATS expected: Do you trust the files in this folder? The terminal showed: (no visible text) Nearest entry claude-folder-trust-2, first difference at 12", `${at} a blocked launch's row: what OATS expected and what the terminal showed, each under whose text it is`, differed);
        await bring(page, check, at, "oats-panel-activity");
        await settled(page, viewport);
        await fitted(page, viewport, check, at, "an incomplete activity window");
        await page.shot(`panel-${viewport.name}-activity-incomplete`);

        // the tab left and come back to: what was read is shown again, with Refresh; nothing is read, and no line says "retained" or "loaded"
        await page.evaluate(click(inPanel("oats-tab-soul")));
        await page.until(visible(inPanel("oats-panel-soul-body")), 15);
        await page.evaluate(click(inPanel("oats-tab-instance")));
        const kept = await page.until(`(() => { const summary = ${textOf(inPanel("oats-panel-activity-summary"))}; return summary.startsWith("Last: Launch prompt · ") ? JSON.stringify({ status: document.querySelector(${JSON.stringify(inPanel("oats-panel-activity-status"))}) !== null, said: /Last observation retained|Reported observation loaded/.test(document.querySelector(${JSON.stringify(inPanel("oats-panel-activity"))}).innerText) }) : ""; })()`, 15);
        const button = await page.evaluate(textOf(inPanel("oats-panel-activity-load")));
        check(kept === JSON.stringify({ status: false, said: false }) && button === "Refresh", `${at} back on the tab, the activity read earlier is shown again, with Refresh, and no line about it`, `read: ${JSON.stringify(kept)}; the button: ${JSON.stringify(button)}`);

        // an empty window
        setVerb("instance events", derived("events.json", (result) => Object.assign(result, { count: 0, returned: 0, events: [], waitingOnYou: null, waitingClaims: [] })));
        await page.evaluate(click(inPanel("oats-panel-activity-load")));
        const none = await page.until(`${textOf(inPanel("oats-panel-activity-summary"))} === "No events"`, 30);
        check(Boolean(none), `${at} an empty window: No events`, await page.evaluate(textOf(inPanel("oats-panel-activity-summary"))));
        const emptyList = await reads(page, inPanel("oats-panel-activity-list"), ["0 displayed / 0 observed rows"]);
        check(!emptyList.includes("No events") && !emptyList.includes("Null waiting"), `${at} and it is said once: the fold holds the window and no row, and no footnote about what is not shown`, emptyList);
        await bring(page, check, at, "oats-panel-activity");
        await settled(page, viewport);
        await fitted(page, viewport, check, at, "an empty activity window");
        await page.shot(`panel-${viewport.name}-activity-empty`);

        // a read again that fails keeps what was read, under the one drawing of a failed read: the titled notice, with
        // how old what is shown is, said once and never as a clock time
        setVerb("readiness --home", FAILS);
        setVerb("instance events", FAILS);
        await page.evaluate(click(`${inPanel("oats-panel-readiness-instance")} ${testId("oats-panel-readiness-refresh")}`));
        const staleReadiness = await noticeAtRest(page, "oats-panel-readiness-instance", { wants: ["could not be read again"] });
        check(
          /^Readiness could not be read again \| alert \| Readiness could not be read again The installed CLI could not complete the readiness read\. Read (less than a minute|\d+ (min|h|d)) ago\. OATS_FAILED .*Retry$/.test(staleReadiness ?? ""),
          `${at} readiness read again and failed: the titled notice, a person's sentence, a relative age said once, the code and Retry`,
          staleReadiness,
        );
        {
          const read = await page.evaluate(summaryOf("instance"));
          check(read === "Ready", `${at} and the summary read before is still shown`, read);
        }
        await page.evaluate(click(inPanel("oats-panel-activity-load")));
        const staleActivity = await noticeAtRest(page, "oats-panel-activity", { wants: ["could not be read again"] });
        check(
          /^The recorded activity could not be read again \| alert \| The recorded activity could not be read again The installed CLI could not complete the activity read\. Read (less than a minute|\d+ (min|h|d)) ago\. OATS_FAILED .*Retry$/.test(staleActivity ?? ""),
          `${at} the activity read again and failed: the same drawing, with its own age`,
          staleActivity,
        );
        {
          const boxes = await page.evaluate(`document.querySelectorAll(${JSON.stringify(inPanel("oats-stale"))}).length`);
          check(boxes === 0, `${at} and no second drawing for what is stale`, boxes);
        }
        await bring(page, check, at, "oats-panel-readiness-instance");
        await settled(page, viewport);
        await fitted(page, viewport, check, at, "reads that failed after one answered");
        await page.shot(`panel-${viewport.name}-reads-stale`);

        // the Soul tab: its readiness needs a sign-in and has a warning, its fold open
        await page.evaluate(click(inPanel("oats-tab-soul")));
        const signIn = await page.until(`${summaryOf("soul")} === "1 failing · 0 unknown · 4 required checks"`, 30);
        check(Boolean(signIn), `${at} the soul's readiness, not ready`, await page.evaluate(summaryOf("soul")));
        const signedOut = ["Providers sign in needed", "oats.bb session backend bb · sign in needed · required", "Sign in needed: the provider is set up but is not signed in.", "Problem code E_BACKEND_SIGNED_OUT"];
        const providers = await reads(page, `${inPanel("oats-panel-readiness-soul")} ${testId("oats-panel-check-providers")}`, signedOut);
        check(holds(providers, signedOut), `${at} a provider that is not signed in: sign in needed, in the check's state, the item's line and the provider's sentence`, providers);
        // The warning's own Details stays closed here: the line as it reads before a press.
        const warnings = (await page.until(flat(inPanel("oats-panel-readiness-warnings-soul")), 15)) ?? "(not on the page after 15 s)";
        check(/^warnings 1 Warning oats\.bb one declared hook never runs here: bb has no session-end event \S? ?Details$/i.test(warnings), `${at} readiness' capability warnings: the capability, the kernel's message, Details`, warnings);
        await bring(page, check, at, "oats-panel-readiness-soul");
        await settled(page, viewport);
        await fitted(page, viewport, check, at, "the soul's readiness, its fold open");
        await page.shot(`panel-${viewport.name}-soul-readiness-open`);
      } finally {
        for (const verb of VERBS) setVerb(verb, null);
        await page.evaluate(click(inPanel("oats-tab-instance")));
      }
    },
  },
  {
    stage: "panel",
    name: "the Soul tab of a soul with a filled core slot, a capability turned off and warnings; one with only its core capabilities; its read again that fails",
    run: async ({ page, at, viewport, threads, check: plain }) => {
      const check = printing(plain);
      const flat = (selector) => `(() => { const e = document.querySelector(${JSON.stringify(selector)}); return e ? e.innerText.replace(/\\s+/g, " ").trim() : ""; })()`;
      const okf = (result) => {
        result.layers.knowledge = { id: "oats.okf", from: "workspace" };
        result.capabilities.push({ ...result.capabilities[1], id: "oats.okf", layer: "knowledge", from: { kind: "package", package: "oats.okf", version: "0.9.2" } });
      };
      try {
        setVerb("inspect --home", derived("inspect-home.json", (result) => {
          okf(result);
          result.capabilitiesOff = [{ id: "oats.review", reason: "off" }];
          result.warnings = [{ code: "hook-event-unsupported", capability: "oats.okf", path: "oats.json", message: "one declared hook never runs here: bb has no session-end event" }];
        }));
        {
          const opened = await open(page, viewport, threads, CHILD);
          check(opened.ok, `${at} the panel is open`, opened.read);
        }
        await page.evaluate(click(inPanel("oats-tab-soul")));
        await page.until(`${textOf(inPanel("oats-panel-core-knowledge"))}.includes("oats.okf")`, 30);
        const knowledge = await page.evaluate(flat(inPanel("oats-panel-core-knowledge")));
        check(/^▸ ?oats\.okf 0\.9\.2$/.test(knowledge), `${at} Core capabilities: the knowledge slot's provider with its source, as a row that opens, closed`, knowledge || (await page.evaluate(textOf(inPanel("oats-panel-core")))));
        {
          const why = await reads(page, inPanel("oats-panel-core-knowledge"), ["Resolved the workspace default at spawn"]);
          check(/oats\.okf 0\.9\.2 Resolved the workspace default at spawn$/.test(why), `${at} and why it fills its slot is one press away, in the row`, why);
          await page.evaluate(`document.querySelectorAll(${JSON.stringify(`${inPanel("oats-panel-core")} details`)}).forEach((fold) => { fold.open = false; })`);
        }
        const off = await page.evaluate(`(() => { const rows = [...document.querySelectorAll(${JSON.stringify(`${inPanel("oats-panel-capabilities")} ${testId("oats-panel-capability")}`)})]; const row = rows[rows.length - 1]; const struck = [...row.querySelectorAll("span")].some((e) => getComputedStyle(e).textDecorationLine === "line-through"); return JSON.stringify([rows.length, row.innerText.replace(/\\s+/g, " ").trim(), struck]); })()`);
        check(/^\[3,"▸ ?oats\.review off",true\]$/.test(off), `${at} Capabilities: one the soul turned off is last, struck through, and says "off"`, off);
        {
          const why = ["Not here This soul turns off a default"];
          const offOpen = await reads(page, `${inPanel("oats-panel-capabilities")} ${testId("oats-panel-capability")}:last-child`, why);
          check(holds(offOpen, why), `${at} and its row opens to the sentence: that the soul turned it off`, offOpen);
          await page.evaluate(`document.querySelectorAll(${JSON.stringify(`${inPanel("oats-panel-capabilities")} details`)}).forEach((fold) => { fold.open = false; })`);
        }
        const warnings = await reads(page, inPanel("oats-panel-soul-warnings"), ["hook-event-unsupported"]);
        check(/^warnings 1 Warning oats\.okf one declared hook never runs here: bb has no session-end event \S? ?Details Code hook-event-unsupported Path oats\.json$/i.test(warnings), `${at} Warnings: the capability, the kernel's message, and its code and path under Details`, warnings);
        {
          const read = await page.evaluate(`document.querySelector(${JSON.stringify(inPanel("oats-panel-modules"))}) === null && !/Modules as spawned/.test(document.querySelector(${JSON.stringify(inPanel("oats-panel-soul-body"))}).innerText)`);
          check(read === true, `${at} and no count of modules is drawn`, read);
        }
        {
          const read = await page.evaluate(flat(inPanel("oats-panel-capabilities")));
          check(/^capabilities 2 /i.test(read), `${at} the count beside Capabilities is of the two the instance has: the one turned off is listed, not counted`, read);
        }
        await bring(page, check, at, "oats-panel-core");
        await settled(page, viewport);
        await fitted(page, viewport, check, at, "a soul with a core capability, one turned off and a warning");
        await page.shot(`panel-${viewport.name}-soul-composed`);

        // only its core capabilities
        setVerb("inspect --home", derived("inspect-home.json", (result) => {
          okf(result);
          result.capabilities = result.capabilities.filter((capability) => capability.id === "oats.okf");
        }));
        {
          const opened = await open(page, viewport, threads, CHILD);
          check(opened.ok, `${at} the panel is open again`, opened.read);
        }
        await page.evaluate(click(inPanel("oats-tab-soul")));
        await page.until(`/^capabilities 0 None$/i.test(${flat(inPanel("oats-panel-capabilities"))})`, 30);
        const only = await page.evaluate(flat(inPanel("oats-panel-capabilities")));
        // When it is not there, the check prints what the Soul tab says in its place, a notice's folded details included (seen once: the read was refused).
        check(/^capabilities 0 None$/i.test(only), `${at} a soul with only core capabilities: under Capabilities, "None"`, only !== "" ? only : `(no capabilities part; the Soul tab says: ${await page.evaluate(`(document.querySelector(${JSON.stringify(testId("oats-panel"))})?.textContent ?? "").replace(/\\s+/g, " ").trim().slice(0, 900)`)})`);
        // The image is named for the part that says so: with the header's acts above the tabs, the Core
        // capabilities part alone fills a phone's window, and is the same in the scene before this one.
        await bring(page, check, at, "oats-panel-capabilities");
        await settled(page, viewport);
        await fitted(page, viewport, check, at, "a soul with only its core capabilities");
        await page.shot(`panel-${viewport.name}-soul-core-only`);

        // read again (the instance was started again) and failed: what was read stays, under the titled notice
        setVerb("inspect --home", FAILS);
        const restarted = recorded(threads);
        restarted.agents.flatMap((group) => group.instances).find((row) => row.instance === CHILD.instance).startedAt = new Date().toISOString();
        record(restarted);
        const stale = await noticeAtRest(page, "oats-panel-soul-body", { wants: ["could not be read again"] });
        check(
          /^The soul as spawned could not be read again \| alert \| The soul as spawned could not be read again OATS could not finish reading it\. Read (less than a minute|\d+ (min|h|d)) ago\. OATS_FAILED .*Retry$/.test(stale ?? ""),
          `${at} the soul read again and failed: what was read stays under the titled notice, with its age, the code and Retry`,
          stale,
        );
        {
          const read = await page.evaluate(textOf(inPanel("oats-panel-capabilities")));
          check(/None$/.test(read), `${at} and the soul read before is still shown`, read);
        }
        await page.evaluate(`document.querySelector(${JSON.stringify(inPanel("oats-panel-page-soul"))}).scrollTop = 0`);
        await settled(page, viewport);
        await fitted(page, viewport, check, at, "the soul, read again and refused");
        await page.shot(`panel-${viewport.name}-soul-stale`);
      } finally {
        setVerb("inspect --home", null);
        // the stage's roster again: the recording, with bb's ids for its threads
        record(recorded(threads));
        await page.evaluate(click(inPanel("oats-tab-instance")));
      }
    },
  },
];

/** The state line of the open panel, as a screen reader reads it: the word, then what follows it. */
const said = `(() => { const line = document.querySelector(${JSON.stringify(`${testId("oats-panel")} ${testId("oats-panel-state")} ${testId("oats-status-line")}`)})?.cloneNode(true); if (!line) return ""; line.querySelectorAll('[aria-hidden="true"]').forEach((e) => e.remove()); return line.innerText.replace(/\\s+/g, " ").trim(); })()`;
/** The facts of a section of the open panel: "label: value", in order. */
const factsOf = (section) => `[...document.querySelectorAll(${JSON.stringify(`${inPanel(section)} ${testId("oats-fact")}`)})].map((e) => e.querySelector("dt").innerText.trim() + ": " + e.querySelector("dd").innerText.replace(/\\s+/g, " ").trim()).join(" | ")`;

const more = [
  {
    stage: "panel-states",
    name: "running, idle, failed, unreachable; a messaging id, an owning human, a sibling; a soul OATS does not name",
    run: async ({ page, at, viewport, threads, check: plain }) => {
      const check = printing(plain);
      // running, with a messaging id and a lineage of an owning human and a sibling
      {
        const opened = await open(page, viewport, threads, CHILD);
        check(opened.ok, `${at} the running agent's panel shows`, opened.read);
      }
      await page.until(visible(inPanel("oats-panel-work-sentence")), 30);
      const running = await page.evaluate(said);
      check(running === "Working", `${at} a running agent's header says Working, the word its row and its thread say, and no time after it`, running);
      {
        // The lifecycle's acts for its state stand under it, in the header.
        const acts = await page.evaluate(`JSON.stringify([...document.querySelectorAll(${JSON.stringify(`${inPanel("oats-panel-header")} ${testId("oats-agent-acts")} button`)})].map((button) => button.innerText.trim() + (button.disabled ? " (off)" : "")))`);
        check(acts === JSON.stringify(["Stop…", "Restart…", "Retire…"]), `${at} and offers the acts of a working agent under it: Stop…, Restart…, Retire…`, acts);
      }
      {
        const started = await page.evaluate(`document.querySelector(${JSON.stringify(inPanel("oats-panel-started"))})?.closest(${JSON.stringify(testId("oats-fact"))})?.innerText.replace(/\\s+/g, " ").trim() ?? ""`);
        check(/^Started (just now|\d+ (min|h|d) ago|\d{4}-\d\d-\d\d)$/.test(started), `${at} since when it runs is a labelled fact of its session: Started …`, started);
      }
      check(!(await page.evaluate(visible(inPanel("oats-panel-waiting")))), `${at} an agent that does not wait shows no question`);
      // Lineage: on the page's face the agents it is related to; who owns it and its messaging ID are under its fold, closed.
      const FOLD = inPanel("oats-panel-lineage-details");
      const face = await page.evaluate(`JSON.stringify({ text: (document.querySelector(${JSON.stringify(inPanel("oats-panel-lineage"))})?.innerText ?? "").replace(/\\s+/g, " ").trim(), open: document.querySelector(${JSON.stringify(FOLD)})?.open ?? null })`);
      check(/^\{"text":"LINEAGE Sibling Redesign ui lead ▸ ?Details","open":false\}$/.test(face), `${at} Lineage: the sibling, by its name as words, on the page's face; "Owning human" and "Messaging ID" are not on it: one fold, closed`, face);
      await page.evaluate(click(`${FOLD} summary`));
      const lineage = await page.until(`document.querySelector(${JSON.stringify(FOLD)})?.open === true ? ${factsOf("oats-panel-lineage-details")} : ""`, 10);
      check(lineage === "Owning human: Ana | Messaging ID: oats.aweb.ai/panel-worktree-helper Copy", `${at} opened, the fold holds the owning human, then the messaging ID with its Copy`, String(lineage));
      const noHeading = await page.evaluate(`document.querySelector(${JSON.stringify(inPanel("oats-panel-messaging"))}) === null && !/Messaging & Teams/i.test(document.querySelector(${JSON.stringify(testId("oats-panel"))}).innerText)`);
      check(noHeading === true, `${at} under no heading of its own`, noHeading);
      const copyId = await page.evaluate(`document.querySelector(${JSON.stringify(`${inPanel("oats-panel-lineage")} button`)})?.getAttribute("aria-label")`);
      check(copyId === "Copy messaging ID", `${at} its Copy is named Copy messaging ID`, copyId);
      // Closed again for the image: the page's face.
      await page.evaluate(click(`${FOLD} summary`));
      check((await page.until(`document.querySelector(${JSON.stringify(FOLD)})?.open === false`, 10)) === true, `${at} and it closes again`);
      await bring(page, check, at, "oats-panel-session");
      await settled(page, viewport);
      await fitted(page, viewport, check, at, "instance-running");
      await page.shot(`panel-${viewport.name}-instance-running`);

      // idle: neither running nor stopped, nothing waiting
      {
        const opened = await open(page, viewport, threads, IDLE);
        check(opened.ok, `${at} the idle agent's panel shows`, opened.read);
      }
      const idle = await page.evaluate(said);
      check(idle === "Idle", `${at} an agent the kernel calls neither running nor stopped says Idle, never "Not reported"`, idle);
      await settled(page, viewport);
      await fitted(page, viewport, check, at, "instance-idle");
      await page.shot(`panel-${viewport.name}-instance-idle`);

      // unreachable, with the kernel's runtime error
      {
        const opened = await open(page, viewport, threads, PARENT);
        check(opened.ok, `${at} the unreachable agent's panel shows`, opened.read);
      }
      const unreachable = await page.until(`(() => { const t = ${said}; return t.startsWith("Unreachable") ? t : ""; })()`, 30);
      check(unreachable === "Unreachable", `${at} an agent the kernel cannot reach says Unreachable, the word alone, in its header`, unreachable);
      const kernel = await page.until(`document.querySelector(${JSON.stringify(`${inPanel("oats-panel-state")} ${testId("oats-status-kernel")} p`)})?.textContent ?? ""`, 15);
      check(kernel === "OATS says: bb did not answer at http://127.0.0.1:38886 (connection refused)", `${at} and what OATS says of it is one press away, under Details in its header`, kernel);
      await page.until(visible(inPanel("oats-panel-session")), 30);
      const again = await page.evaluate(`document.querySelectorAll(${JSON.stringify(inPanel("oats-panel-runtime-error"))}).length`);
      check(again === 0, `${at} and the Session card does not say it a second time`, again);
      await settled(page, viewport);
      await fitted(page, viewport, check, at, "instance-unreachable");
      await page.shot(`panel-${viewport.name}-instance-unreachable`);

      // failed: its session fell back to a shell; and its soul has no key in the roster
      {
        const opened = await open(page, viewport, threads, SHELL);
        check(opened.ok, `${at} the failed agent's panel shows`, opened.read);
      }
      const failed = await page.evaluate(said);
      check(failed === "Failed· session ended", `${at} an agent whose session fell back to a shell says Failed and why in two words, as its thread's line does`, failed);
      await settled(page, viewport);
      await fitted(page, viewport, check, at, "instance-failed");
      await page.shot(`panel-${viewport.name}-instance-failed`);
      // This agent is of another soul: the kernel's inspection of it names that soul.
      setVerb("inspect --home", withMessaging("oats-legacy"));
      await page.evaluate(click(inPanel("oats-tab-soul")));
      const why = await page.until(`${textOf(inPanel("oats-panel-open-soul-why"))}`, 15);
      check(why === "OATS lists no soul of this name here, so there is no soul page to open.", `${at} a soul OATS does not name: Open soul page is off, and the reason is beside it`, why);
      const off = await page.evaluate(`document.querySelector(${JSON.stringify(inPanel("oats-panel-open-soul"))})?.disabled ?? null`);
      check(off === true, `${at} Open soul page is disabled there`, `the button's disabled: ${off} (null: no such button)`);
      {
        // One state per image: the soul as spawned is there before the image is taken.
        const read = await page.until(`${textOf(inPanel("oats-panel-spawned-from"))}`, 30);
        check((read ?? "").startsWith("Spawned from oats-legacy @ "), `${at} and the soul as spawned is read: the soul the header names`, read);
      }
      // What "unnamed" is, in the image: Open soul page off, with its reason beside it, under the soul's name.
      await page.evaluate(`document.querySelector(${JSON.stringify(inPanel("oats-panel-page-soul"))}).scrollTop = 0`);
      {
        const seen = await page.evaluate(visible(inPanel("oats-panel-open-soul-why")));
        check(seen === true, `${at} the reason Open soul page is off is in view for the image`, seen);
      }
      await settled(page, viewport);
      await fitted(page, viewport, check, at, "soul-unnamed");
      await page.shot(`panel-${viewport.name}-soul-unnamed`);
      setVerb("inspect --home", withMessaging());
      await page.evaluate(click(inPanel("oats-tab-instance")));
    },
  },
  {
    stage: "panel-states",
    name: "freshness: a claim the kernel records is in the panel's header within 3 s, and gone within 3 s of its end",
    run: async ({ page, at, viewport, threads, check: plain }) => {
      const check = printing(plain);
      try {
        {
          const opened = await open(page, viewport, threads, IDLE);
          check(opened.ok, `${at} the idle agent's panel is open`, opened.read);
        }
        check(Boolean(await page.until(`${said} === "Idle"`, 30)), `${at} before the claim its header says Idle`, await page.evaluate(said));
        const claimed = record(states(threads, RUNNING_MODEL, { since: new Date().toISOString(), producer: "agent", reason: "attention", message: "Keep the retry, or fail the job?" }));
        const needs = (await page.until(`${said}.startsWith("Needs you")`, 15)) ? Date.now() - claimed : null;
        check(needs !== null && needs <= 3000, `${at} the header says Needs you ${needs === null ? "never" : `${needs} ms`} after the kernel recorded the claim (3 s at most)`, await page.evaluate(said));
        {
          const read = await page.evaluate(textOf(inPanel("oats-panel-waiting-message")));
          check(read === "Keep the retry, or fail the job?", `${at} and the page says the agent's message, first`, read);
        }
        const cleared = record(states(threads));
        const idle = (await page.until(`${said} === "Idle"`, 15)) ? Date.now() - cleared : null;
        check(idle !== null && idle <= 3000, `${at} and Idle again ${idle === null ? "never" : `${idle} ms`} after the kernel recorded its end (3 s at most)`, await page.evaluate(said));
      } finally {
        setStatus({ stdout: JSON.stringify(states(threads)) });
      }
    },
  },
  {
    stage: "panel-states",
    name: "the agent's page: an agent with no thread in bb, a name OATS does not list, no name",
    run: async ({ page, at, viewport, threads, check: plain }) => {
      const check = printing(plain);
      {
        const opened = await open(page, viewport, threads, TMUX);
        check(opened.ok, `${at} Open, on its soul's page, opens the page of an agent with no thread in bb`, opened.read);
      }
      await page.until(visible(inPanel("oats-panel-session")), 30);
      const session = await page.evaluate(factsOf("oats-panel-session"));
      check(/Runs in: tmux session( \||$)/.test(session) && !session.includes("oats-agents"), `${at} Session: where an agent on tmux runs, in a word (its session's name is under Paths)`, session);
      // How to reach it: one word, and the kernel's own command to copy.
      const attach = await page.evaluate(`(() => { const part = document.querySelector(${JSON.stringify(inPanel("oats-panel-attach"))}); return part ? JSON.stringify({ says: part.querySelector("p").innerText.trim(), command: part.querySelector('[data-testid="oats-command"]')?.innerText.replace(/\\s+/g, " ").trim() ?? null, copy: part.querySelector('[data-testid="oats-copy"]') !== null }) : ""; })()`);
      check(attach !== "" && JSON.parse(attach).says === "Attach:" && /^oats session attach --home \S+\/panel-tmux-helper$/.test(JSON.parse(attach).command ?? "") && JSON.parse(attach).copy === true, `${at} and how to reach its session: "Attach:" and the attach command to copy`, attach);
      {
        const read = await page.evaluate(textOf(testId("oats-agent-back")));
        check(read === "‹ Home", `${at} with no thread to go back to, the way back is Home`, read);
      }
      await settled(page, viewport);
      await fitted(page, viewport, check, at, "page-tmux");
      await page.shot(`panel-${viewport.name}-page-tmux`);

      await page.goto("/plugins/oats/agent/gone-helper");
      const gone = await page.until(`(() => { const t = ${textOf(`${testId("oats-agent-page")} ${testId("oats-empty")}`)}; return t; })()`, 30);
      check(gone === "This agent is not in OATS", `${at} the page of a name OATS does not list says so in its title, and nothing under it`, gone);
      await page.shot(`panel-${viewport.name}-page-gone`);

      await page.goto("/plugins/oats/agent");
      const none = await page.until(`${textOf(`${testId("oats-agent-page")} ${testId("oats-empty")}`)}`, 30);
      check(none === "No agent to show", `${at} the page with no name says so in its title, and nothing under it`, none);
      await page.shot(`panel-${viewport.name}-page-none`);
    },
  },
  {
    stage: "panel-states",
    name: "a panel opened again reads again; what it keeps when OATS cannot be read again; the page when OATS could not be read",
    run: async ({ page, at, viewport, threads, check: plain, sleep }) => {
      const check = printing(plain);
      const model = `${inPanel("oats-panel-model")}`;
      try {
        // Opened again: leave the agent's page inside the app, change what OATS says, come back.
        await page.goto(`/plugins/oats/agent/${CHILD.instance}`);
        check(Boolean(await page.until(`${textOf(model)}.startsWith(${JSON.stringify(RUNNING_MODEL)})`, 30)), `${at} the agent's page shows its model`, await page.evaluate(textOf(model)));
        await page.evaluate(click(testId("oats-agent-back")));
        await page.until(`location.pathname.endsWith("/threads/${threads.get(CHILD.thread).id}")`, 15);
        setStatus({ stdout: JSON.stringify(states(threads, "claude-fable-5.2")) });
        refresh();
        await sleep(1500);
        await page.evaluate("history.back()");
        const reread = await page.until(`${textOf(model)}.startsWith("claude-fable-5.2")`, 20);
        check(Boolean(reread), `${at} a panel opened again shows what OATS says now, not what it read before`, await page.evaluate(textOf(model)));

        // OATS cannot be read again: the panel keeps what it read. THE NOTICE STANDS ONCE, in the pane a person is
        // looking at (the lead's T3): on the agent's page (a phone: the panel is the page) the panel says it, whole,
        // with the one Retry; in the thread's tab (a wide window) the thread's own line says it and the tab draws
        // none: it only holds its buttons.
        {
          const opened = await open(page, viewport, threads, CHILD);
          check(opened.ok, `${at} the panel is open before OATS stops answering`, opened.read);
        }
        await page.until(visible(inPanel("oats-panel-work-sentence")), 30);
        setStatus(REFUSED);
        refresh();
        /** The Retry buttons drawn in the window now (whoever draws them): the lead's "one Retry on a screen". */
        const RETRIES = `[...document.querySelectorAll("button")].filter((b) => b.innerText.trim() === "Retry" && b.getClientRects().length > 0).length`;
        if (viewport.mobile) {
        // Waited for: the notice of the read that was refused, once that read has ended (its act says Retry, not "Reading…").
        const stale = await noticeAtRest(page, "oats-panel-page-instance", { wants: ["OATS could not read this deployment", "Read "], seconds: 40 });
        check(
          /^OATS could not read this deployment \| alert \| OATS could not read this deployment Read (less than a minute|\d+ (min|h|d)) ago\. Acts are off\. ▸ ?Details Retry$/.test(stale ?? ""),
          `${at} when OATS cannot be read again the agent's page says it as the sidebar does (the titled notice, the same title), how old what it shows is, that the acts are off, Details and Retry`,
          stale,
        );
        } else {
          // The thread's own line says it, on one line; the tab beside it draws no notice of the roster's and holds its acts.
          const line = `${testId("oats-identity-row")} ${testId("oats-unreadable")}[data-compact]`;
          const said = (await page.until(`(() => { const e = document.querySelector(${JSON.stringify(line)}); const t = (e?.innerText ?? "").replace(/\\s+/g, " ").trim(); return /Acts are off\\. Retry$/.test(t) ? t : ""; })()`, 40)) ?? null;
          check(said !== null && /^OATS could not read this deployment Read (less than a minute|\d+ (min|h|d)) ago\. Acts are off\. Retry$/.test(said), `${at} when OATS cannot be read again the thread's own line says it: the title, how old what is shown is, that the acts are off, and Retry`, said ?? (await page.evaluate(textOf(testId("oats-identity-row")))));
          const tab = JSON.parse(await page.evaluate(`JSON.stringify({ notice: ${noticeOf("oats-panel-page-instance")}, held: document.querySelector(${JSON.stringify(inPanel("oats-held"))}) !== null, acts: [...document.querySelectorAll(${JSON.stringify(`${inPanel("oats-agent-acts")} button`)})].map((b) => b.disabled) })`));
          check(tab.notice === "" && tab.held === false && tab.acts.length > 0 && tab.acts.every((off) => off === true), `${at} and the tab beside it draws no notice of its own (it stood there a second or third time): it keeps what it read and holds its buttons`, JSON.stringify(tab));
        }
        {
          const retries = await page.evaluate(RETRIES);
          check(retries === 1, `${at} ONE Retry on the screen while OATS cannot be read (${viewport.mobile ? "the agent's page's" : "the thread's line's; none in the sidebar beside it, none in the tab"})`, String(retries));
        }
        if (viewport.mobile) {
          // The kernel's code and its line are one press away, as in the sidebar's notice.
          const under = ["E_LOCAL_MISSING: no oats-local.yaml at or above this directory"];
          const folded = await reads(page, `${inPanel("oats-panel-page-instance")} ${testId("oats-notice-details")}`, under);
          check(holds(folded, under), `${at} under Details: the kernel's code and its line`, folded);
          await page.evaluate(`document.querySelectorAll(${JSON.stringify(`${inPanel("oats-panel-page-instance")} ${testId("oats-notice-details")}`)}).forEach((fold) => { fold.open = false; })`);
        }
        const kept = [await page.evaluate(textOf(inPanel("oats-panel-name"))), await page.evaluate(visible(inPanel("oats-panel-work-sentence")))];
        check(kept[0] === "Panel worktree helper" && kept[1] === true, `${at} and keeps the agent and its facts on screen`, `the name read: ${JSON.stringify(kept[0])}; the work sentence in view: ${kept[1]}`);
        if (viewport.mobile) {
          const back = await page.evaluate(textOf(testId("oats-agent-back")));
          check(back === "‹ Thread", `${at} and the way back`, back);
        }
        await settled(page, viewport);
      await fitted(page, viewport, check, at, "stale");
        await page.shot(`panel-${viewport.name}-stale`);

        // A page opened while OATS cannot be read: the plugin's server keeps the last roster it read,
        // so the page shows the agent as last read, with how old that is and why, and Retry.
        await page.goto(`/plugins/oats/agent/${CHILD.instance}`);
        const opened = await noticeAtRest(page, "oats-panel-page-instance", { wants: ["OATS could not read this deployment", "Read "], also: `document.querySelector(${JSON.stringify(testId("oats-agent-page"))}) !== null`, seconds: 40 });
        const named = await page.evaluate(textOf(inPanel("oats-panel-name")));
        check(
          // The server answers the agent's facts from the last roster it read, so the settled notice says how old they are.
          /^OATS could not read this deployment \| alert \| OATS could not read this deployment Read (less than a minute|\d+ (min|h|d)) ago\. Acts are off\. ▸ ?Details Retry$/.test(opened ?? "") && named === "Panel worktree helper",
          `${at} a page opened while OATS cannot be read: the agent as last read, how old that is, that the acts are off, and why, with Retry`,
          `the notice: ${JSON.stringify(opened)}; the name: ${JSON.stringify(named)}`,
        );
        // No image here: it is the picture `stale` is (the same page, the same notice). The page with no roster ever
        // read (the sidebar's notice whole, `Unreadable`) has no scene: the plugin's server keeps the last roster it
        // read for as long as it runs, and the live checks' server has read one. A unit test holds that page
        // (test/panel/panel.test.tsx, "while OATS cannot be read the page shows the notice every place shows").

        // Retry, once OATS answers again.
        setStatus({ stdout: JSON.stringify(states(threads)) });
        // The press waits for the act to say Retry: while a read is in flight the same button says "Reading…".
        const pressed = await page.until(`(() => { const act = [...document.querySelectorAll(${JSON.stringify(`${testId("oats-agent-page")} ${inPanel("oats-panel-page-instance")} ${testId("oats-notice")} button`)})].find((e) => e.innerText.trim() === "Retry"); if (!act) return ""; act.click(); return "pressed"; })()`, 30);
        check(pressed === "pressed", `${at} the notice's act says Retry, and it is pressed`, await page.evaluate(noticeOf("oats-panel-page-instance")));
        check(Boolean(await page.until(`${visible(testId("oats-panel"))} && ${textOf(model)}.startsWith(${JSON.stringify(RUNNING_MODEL)})`, 40)), `${at} Retry reads OATS again and shows the agent`, await page.evaluate(textOf(model)));
      } finally {
        setStatus({ stdout: JSON.stringify(states(threads)) });
      }
    },
  },
];

/** For the other scenes of this developer (the home's): the every-image measurement, the wait before an image, the printing check, and the fake's verbs. */
export { FAILS, fits, printing, refresh, setVerb, settled };

/**
 * The lifecycle's acts on the agent's own page, where an agent with no thread in bb has them. The
 * release's default shows the home alone: the Souls page, where such an agent's Start and Retire
 * also are, is not shown then, so the page its row opens is the one place for them.
 */
const acts = [
  {
    stage: "detached",
    name: "under the release's default pages, the page of an agent whose bb thread is gone offers Start and Retire",
    run: async ({ page, at, viewport, check: plain, pages, ALL_PAGES }) => {
      const check = printing(plain);
      const GONE = "weekly-digest-helper";
      const actsNow = `JSON.stringify([...document.querySelectorAll(${JSON.stringify(`${inPanel("oats-agent-acts")} button`)})].map((button) => button.innerText.trim() + (button.disabled ? " (off)" : "")))`;
      pages("home");
      try {
        await page.goto(`/plugins/oats/agent/${GONE}`);
        const drawn = await page.until(`(() => { const acts = ${actsNow}; return acts !== "[]" ? acts : ""; })()`, 40);
        check(drawn === JSON.stringify(["Start…", "Retire…"]), `${at} the page of an agent whose bb thread is gone offers Start… and Retire…, and no other act`, drawn ?? (await page.evaluate(textOf(testId("oats-agent-page")))));
        const header = await page.evaluate(`(() => { const header = document.querySelector(${JSON.stringify(inPanel("oats-panel-header"))}); return JSON.stringify({ name: header?.querySelector('[data-testid="oats-panel-name"]')?.innerText.trim(), state: (header?.querySelector('[data-testid="oats-panel-state"]')?.innerText ?? "").replace(/\\s+/g, " ").trim(), actsInHeader: header?.querySelector('[data-testid="oats-agent-acts"]') !== null }); })()`);
        check(JSON.parse(header).name === "Weekly digest helper" && /Stopped/.test(JSON.parse(header).state) && JSON.parse(header).actsInHeader === true, `${at} they stand in the header, under the agent's name and its state`, header);
        // The page under the header is drawn before its image: this agent's facts start at Session (a stopped agent whose thread is gone has no Work part).
        const session = await page.until(`(() => { const t = ${textOf(inPanel("oats-panel-session-line"))}; return t !== "" ? t : ""; })()`, 30);
        check(Boolean(session), `${at} and its facts are drawn under the header: where its session ran`, session ?? (await page.evaluate(textOf(testId("oats-agent-page")))));
        // Instance readiness is a later read (a command of its own), and it is in the image: the page is whole once it says its answer.
        const readiness = await page.until(`(() => { const t = ${textOf(`${inPanel("oats-panel-readiness-instance")} ${testId("oats-panel-readiness-summary")}`)}; return t !== "" ? t : ""; })()`, 40);
        check(Boolean(readiness), `${at} and its readiness is read before the image: the page is whole`, readiness ?? (await page.evaluate(textOf(inPanel("oats-panel-readiness-instance")))));
        await settled(page, viewport);
        await fitted(page, viewport, check, at, "page-missing-acts");
        await page.shot(`panel-${viewport.name}-page-missing-acts`);
        // A press opens that act's dialog, about this agent; nothing runs on the press.
        await page.evaluate(`document.querySelector(${JSON.stringify(inPanel("oats-agent-act-start"))})?.click()`);
        const dialog = await page.until(`(() => { const body = document.querySelector(${JSON.stringify(testId("oats-confirm"))}); return body ? JSON.stringify({ about: body.getAttribute("data-about"), title: body.closest('[role="dialog"]')?.querySelector("h2, h3")?.innerText.trim() ?? null }) : ""; })()`, 20);
        check(Boolean(dialog) && JSON.parse(dialog).about === GONE, `${at} Start… opens the lifecycle's dialog, about this agent`, dialog ?? (await page.evaluate(textOf("body")).catch((error) => String(error))));
        await page.evaluate(`(document.querySelector(${JSON.stringify(testId("oats-confirm-cancel"))}) ?? document.querySelector(${JSON.stringify(testId("oats-confirm-close"))}))?.click()`);
        check(Boolean(await page.until(`document.querySelector(${JSON.stringify(testId("oats-confirm"))}) === null`, 10)), `${at} and its Cancel closes it`, await page.evaluate(`document.querySelector(${JSON.stringify(testId("oats-confirm"))})?.getAttribute("data-phase") ?? "gone"`));
        // The default is in force: the Souls page, the other place of those acts, answers that it is not shown.
        const notShown = await (async () => {
          await page.goto("/plugins/oats/souls");
          return page.until(`document.querySelector(${JSON.stringify(testId("oats-page-not-shown"))}) !== null ? "not shown" : ""`, 20);
        })();
        check(notShown === "not shown", `${at} and the Souls page, where those acts also are, is not shown under the default`, notShown);
      } finally {
        pages(ALL_PAGES);
      }
    },
  },
];

export default [...first, ...second, ...more, ...acts];
