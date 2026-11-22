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
// the roster is read ("This instance could not be read", "It could not be read again"). The
// server answers `panelInstance` from the roster it holds in memory, in a few milliseconds and
// with no process to slow down or to fail: the first is over before a page can be read, and the
// second happens only between a failed status and the client's next snapshot. Both are drawn with
// the shared Loading, Notice and Stale, which the pattern book's scenes hold under the contrast
// check, and unit tests hold their words (test/panel/panel.test.tsx).
//
// Both stages have the fake `oats` print the roster recorded from the real kernel for the panel
// (test/fixtures/panel/status-soul-moved.json: a child on its own worktree, idle in bb, whose board
// asked a question and whose soul's repository moved on; and its parent, stopped), with its thread
// ids replaced by threads the live checks made in bb. The second stage changes that recording, in
// the open and only here: the fields a state is made of, and copies of the child's row under other
// names for the states that need an agent of their own. Those rows are not fixtures: no test reads
// them.
// The first stage's last two scenes change the recorded answers of `oats readiness`, `oats instance
// events` and `oats inspect` the same way (`derived`), for what the real run's deployment has none
// of: a provider that needs a sign-in, a capability warning, a truncated window, a blocked launch,
// a filled core slot. Readiness that is not ready is a recording
// (test/fixtures/panel/readiness-home-not-ready.json).
import { execFileSync } from "node:child_process";
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { testId, textOf, visible } from "../browser.mjs";

const FIXTURE = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "test", "fixtures", "panel", "status-soul-moved.json");
const FIXTURES = dirname(FIXTURE);
/** A recorded answer of the panel's fixtures, changed for a scene: what the fake `oats` prints for a verb. */
function derived(file, change) {
  const document = JSON.parse(readFileSync(join(FIXTURES, file), "utf8"));
  change(document.result);
  return { stdout: JSON.stringify(document) };
}
const FAKE_CONFIG = join(homedir(), ".local/bin/fake-oats.json");
const CHILD = { instance: "panel-worktree-helper", recorded: "thr_gx4sgexjgw", thread: "thr_mockups" };
const PARENT = { instance: "redesign-ui-lead", recorded: "thr_uz64t6aahn", thread: "thr_redesign" };
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
  // the child: running, with a messaging id, an owning human and a sibling
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
  writeFileSync(FAKE_CONFIG, JSON.stringify({ ...config, verbs }));
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
      fake({ status: { stdout: JSON.stringify(states(threads)) } });
      await untilSnapshot((snapshot) => snapshot.ok === true && snapshot.agents.some((agent) => agent.instance === SHELL.instance) && snapshot.agents.some((agent) => agent.instance === CHILD.instance && agent.running === true));
    },
  },
};

const inPanel = (id) => `${testId("oats-panel")} ${testId(id)}`;
/** The header's state: [the mark's state, the word, what follows it, whether the mark is hidden from a screen reader]. */
const stateOf = `(() => { const line = document.querySelector(${JSON.stringify(`${testId("oats-panel")} ${testId("oats-panel-state")} ${testId("oats-status-line")}`)}); const state = line?.querySelector(${JSON.stringify(testId("oats-state"))}); const mark = state?.querySelector("[data-state]"); const word = state?.querySelector("span:not([data-state])")?.innerText.trim() ?? ""; const rest = [...(line?.children ?? [])].slice(1).map((e) => e.innerText.trim()).join(" "); return JSON.stringify([mark?.getAttribute("data-state"), word, rest, mark?.getAttribute("aria-hidden") === "true"]); })()`;
const click = (selector) => `document.querySelector(${JSON.stringify(selector)}).click()`;

/**
 * Shows the panel of `agent` the way a person gets to it: the OATS chip of its thread (the thread's
 * tab at 1280, the agent's own page at the phone's width), or for an agent with no thread in bb the
 * Open button of its row on its soul's page.
 */
async function open(page, viewport, threads, agent) {
  if (agent.thread === null) {
    await page.goto(`/plugins/oats/souls/${agent.soul}`);
    const row = `[...document.querySelectorAll(${JSON.stringify(testId("oats-soul-agent-elsewhere"))})].find((e) => e.innerText.includes(${JSON.stringify(agent.instance)}))`;
    await page.until(`Boolean(${row})`, 30);
    await page.evaluate(`${row}.querySelector(${JSON.stringify(testId("oats-soul-agent-open"))}).click()`);
  } else {
    const thread = threads.get(agent.thread);
    await page.goto(`/projects/${thread.projectId}/threads/${thread.id}`);
    await page.until(visible(testId("oats-chip-oats")), 30);
    await page.evaluate(click(testId("oats-chip-oats")));
  }
  const shown = await page.until(`${visible(testId("oats-panel"))} && document.querySelector(${JSON.stringify(inPanel("oats-panel-name"))})?.getAttribute("title") === ${JSON.stringify(agent.instance)}`, 30);
  // At the phone's width, and for an agent with no thread, that is the agent's own page.
  const onPage = await page.evaluate(`location.pathname.endsWith(${JSON.stringify(`/plugins/oats/agent/${agent.instance}`)})`);
  return Boolean(shown) && onPage === (viewport.mobile || agent.thread === null);
}

/**
 * What is measured of the panel before a screenshot: nothing it draws reaches past the panel's own
 * right edge, the page does not scroll sideways, and every control of it is high enough to press.
 * `past` is how far bb's side panel itself reaches past the window: at 1280 with bb's sidebar, a
 * thread and the side panel open, bb 0.50.1 widens the thread's column once its composer has
 * loaded and pushes the side panel off the window (by how much varies with what
 * the page holds). That cut is bb's, on every tab of its side panel; it is printed with the check, not hidden and not held against the panel.
 */
async function fits(page, viewport) {
  const need = viewport.mobile ? 44 : 32;
  return JSON.parse(
    await page.evaluate(
      `(() => { const panel = document.querySelector(${JSON.stringify(testId("oats-panel"))}); const low = [...panel.querySelectorAll("button, summary, a")].filter((e) => e.getClientRects().length > 0 && e.getBoundingClientRect().height < ${need} - 0.5).map((e) => (e.innerText || e.getAttribute("aria-label") || e.tagName).trim() + " " + Math.round(e.getBoundingClientRect().height)); const edge = panel.getBoundingClientRect().right; const wide = [...panel.querySelectorAll("*")].filter((e) => e.getClientRects().length > 0 && e.getBoundingClientRect().right > edge + 0.5).length; return JSON.stringify({ low, wide, scroll: document.documentElement.scrollWidth - innerWidth, past: Math.max(0, Math.round(edge - innerWidth)) }); })()`,
    ),
  );
}
/** The check of `fits`, printed as what it measures, with bb's own cut beside it. */
async function fitted(page, viewport, check, at, what) {
  const fit = await fits(page, viewport);
  check(
    fit.low.length === 0 && fit.wide === 0 && fit.scroll <= 0,
    `${at} ${what}: nothing reaches past the panel's own edge, and every control of the panel is high enough to press${fit.past > 0 ? ` (bb's side panel is ${fit.past} px past the window: bb's own layout at this width)` : ""}`,
    JSON.stringify(fit),
  );
}
/**
 * bb's composer under a thread has loaded its footer: from then on bb's layout no longer moves, so
 * the light and the dark image of one scene are taken of the same layout. Nothing to wait for on a
 * page of the plugin's own.
 */
async function settled(page, viewport) {
  if (viewport.mobile) return;
  await page.until(`!location.pathname.includes("/threads/") || document.body.innerText.includes("Project checkout")`, 20);
}

const first = [
  {
    stage: "panel",
    name: "the Instance tab of an agent that needs you, its sections open, its Soul tab, a stopped agent",
    run: async ({ page, at, viewport, threads, check }) => {
      const where = viewport.mobile ? "the agent's page" : "the OATS tab of the agent's thread";
      check(await open(page, viewport, threads, CHILD), `${at} the panel shows on ${where}`);
      await page.until(visible(inPanel("oats-panel-work-sentence")), 30);
      const tabs = await page.evaluate(`[...document.querySelectorAll('${testId("oats-panel")} [role="tablist"][aria-label="Instance context"] [role="tab"]')].map((e) => e.innerText.trim() + ":" + e.getAttribute("aria-selected")).join(" ")`);
      check(tabs === "Instance:true Soul:false", `${at} the tabs, named Instance context: Instance (selected), Soul`, tabs);
      check((await page.evaluate(textOf(inPanel("oats-panel-name")))) === "Panel worktree helper", `${at} the header names the instance as words`);
      // The state is a mark AND its word; beside its word the mark is hidden from a screen reader, which reads the word.
      const state = await page.evaluate(stateOf);
      check(/^\["needs-you","Needs you","· waiting \d+ (min|h|d) \(since .+\)",true\]$/.test(state), `${at} the header says the state in words beside its mark, and since when: Needs you · waiting …`, state);
      const head = await page.evaluate(textOf(inPanel("oats-panel-waiting-head")));
      check(/^Asked for your attention · waiting \d+ (min|h|d) \(since .+\)$/.test(head), `${at} Needs input: the reason in words, how long and since when`, head);
      check((await page.evaluate(textOf(inPanel("oats-panel-waiting-message")))) === "How should I merge the pull request?", `${at} Needs input: the agent's message`);
      const work = await page.evaluate(textOf(inPanel("oats-panel-work-sentence")));
      check(work === "Works in its own worktree of oats-real, on branch agents/panel-worktree-helper.", `${at} Work: the mode in one sentence`, work);
      const session = await page.evaluate(textOf(inPanel("oats-panel-session")));
      check(["Harness Claude", "Model claude-opus-5-5 · the soul's choice", `Runs in bb · thread ${threads.get(CHILD.thread).id}`, "Started "].every((part) => session.includes(part)), `${at} Session: the harness, the model and where it came from, the thread, since when, each a labelled fact`, session);
      check((await page.evaluate(textOf(inPanel("oats-panel-lineage")))).includes("Parent redesign-ui-lead"), `${at} Lineage: the parent`);
      await settled(page, viewport);
      await fitted(page, viewport, check, at, "the Instance tab");
      await page.shot(`panel-${viewport.name}-instance`);

      // the older-build chip and the paths, open
      await page.evaluate(`document.querySelectorAll('${testId("oats-panel")} details').forEach((e) => { e.open = true; })`);
      const drift = await page.evaluate(textOf(inPanel("oats-panel-drift")));
      check(drift.includes("older build") && drift.includes("Its soul's repository has moved on since it was spawned."), `${at} older build opens to what moved since the spawn`, drift);
      const paths = await page.evaluate(textOf(inPanel("oats-panel-paths")));
      check(paths.includes("Folder") && paths.includes("/instances/panel-worktree-helper/work") && paths.includes("Home"), `${at} Paths: the folder and the home, each with its Copy`, paths);
      const copies = await page.evaluate(`[...document.querySelectorAll('${testId("oats-panel-paths")} button')].map((e) => e.getAttribute("aria-label")).join(", ")`);
      check(copies === "Copy folder path, Copy home path", `${at} the Copy buttons are named for what they copy`, copies);
      await page.evaluate(`document.querySelector(${JSON.stringify(inPanel("oats-panel-paths"))}).scrollIntoView({ block: "center" })`);
      await settled(page, viewport);
      await fitted(page, viewport, check, at, "its folds open");
      await page.shot(`panel-${viewport.name}-instance-open`);

      // the Soul tab, from the soul's name in the header
      await page.evaluate(click(inPanel("oats-panel-soul-link")));
      check(Boolean(await page.until(`${textOf(inPanel("oats-panel-soul-name"))} === "oats-expert"`, 15)), `${at} the soul's name opens the Soul tab`);
      check((await page.evaluate(textOf(inPanel("oats-panel-soul-description")))) === "OATS expert: answers questions about OATS.", `${at} the Soul tab: the soul's description`);
      await page.evaluate(`document.querySelector(${JSON.stringify(inPanel("oats-panel-details"))}).open = true`);
      const details = await page.evaluate(textOf(inPanel("oats-panel-details")));
      check(details.includes("Details") && /agents root/i.test(details) && details.includes("/agents"), `${at} Details: the agents root, with its Copy`, details);
      check((await page.evaluate(`document.querySelector(${JSON.stringify(inPanel("oats-panel-open-soul"))})?.disabled`)) === false, `${at} Open soul page is offered`);
      await settled(page, viewport);
      await fitted(page, viewport, check, at, "the Soul tab");
      await page.shot(`panel-${viewport.name}-soul`);
      await page.evaluate(click(inPanel("oats-panel-open-soul")));
      check(Boolean(await page.until(`location.pathname.endsWith("/plugins/oats/souls/oats-expert")`, 15)), `${at} Open soul page opens the soul on the Souls page`, await page.evaluate("location.pathname"));

      // a stopped agent, in its own folder
      check(await open(page, viewport, threads, PARENT), `${at} the stopped agent's panel shows on ${where}`);
      await page.evaluate(click(inPanel("oats-tab-instance")));
      await page.until(visible(inPanel("oats-panel-work-sentence")), 30);
      const stopped = await page.evaluate(stateOf);
      check(stopped === JSON.stringify(["stopped", "Stopped", "", true]), `${at} a stopped agent's header says Stopped, beside its mark`, stopped);
      check((await page.evaluate(textOf(inPanel("oats-panel-work-sentence")))).startsWith("Has its own folder, not tied to one repository"), `${at} Work: an agent in its own folder`);
      check(!(await page.evaluate(visible(inPanel("oats-panel-waiting")))), `${at} a stopped agent shows no Needs input`);
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

/** The text of a fold of the panel, once it is open. */
const openFold = (id) => `(() => { const fold = document.querySelector(${JSON.stringify(inPanel(id))}); if (!fold) return ""; fold.open = true; return fold.innerText.replace(/\\s+/g, " ").trim(); })()`;
const scroll = (id) => `document.querySelector(${JSON.stringify(inPanel(id))})?.scrollIntoView({ block: "start" })`;

const second = [
  {
    stage: "panel",
    name: "readiness and the recorded activity on the Instance tab; the soul as spawned and its readiness on the Soul tab",
    run: async ({ page, at, viewport, threads, check }) => {
      check(await open(page, viewport, threads, CHILD), `${at} the panel is open`);
      await page.evaluate(click(inPanel("oats-tab-instance")));

      // the instance's readiness: the summary up front, the checks and the policy behind a fold
      const ready = await page.until(`${textOf(inPanel("oats-panel-readiness-instance") + " " + testId("oats-panel-readiness-summary"))}`, 30);
      check(ready === "Ready — every required check passes or is not applicable.", `${at} Instance readiness: the summary`, ready);
      const checks = await page.evaluate(openFold("oats-panel-readiness-checks"));
      check(["Instance: panel-worktree-helper · ", "Independent kernel observations, not launch permission.", "Target: instance.", "Installed pass", "Configured not-applicable", "Member pass", "Providers pass", "oats.bb session backend bb · pass · required · 2 warnings", "View policy"].every((part) => checks.includes(part)), `${at} Checks and policy: the four checks with their items, and the policy`, checks);
      const policy = await page.evaluate(openFold("oats-panel-policy"));
      check(policy.includes("Lifecycle authority, not an OS sandbox.") && policy.includes("Child spawns: allowed · enforced · default: no spawn option: children allowed"), `${at} View policy: what is allowed, and by whom`, policy);
      await page.evaluate(scroll("oats-panel-readiness-instance"));
      await settled(page, viewport);
      await fitted(page, viewport, check, at, "readiness");
      await page.shot(`panel-${viewport.name}-readiness`);

      // the recorded activity: nothing until a person asks
      const before = await page.evaluate(textOf(inPanel("oats-panel-activity")));
      check(/^reported lifecycle activity load activity$/i.test(before), `${at} the activity is not read until asked: Load activity`, before);
      await page.evaluate(click(inPanel("oats-panel-activity-load")));
      const summary = await page.until(`${textOf(inPanel("oats-panel-activity-summary"))}`, 30);
      check((summary ?? "").startsWith("Waiting claim · 2026-11-21T18:23:39.829Z · Current recorded incarnation · Reported waiting: oats.board since"), `${at} Load activity reads it: the last event and what is reported of waiting`, summary);
      check((await page.evaluate(textOf(inPanel("oats-panel-activity-load")))) === "Refresh activity", `${at} and the button becomes Refresh activity`);
      const list = await page.evaluate(openFold("oats-panel-activity-list"));
      check(list.includes("8 displayed / 8 observed rows. This is address history, not current runtime state.") && list.includes("Spawned") && list.includes("Work mode worktree") && list.includes("no action is authorized by these events."), `${at} Recent lifecycle events: the window, the rows with their facts, the note`, list.slice(0, 400));
      const titles = await page.evaluate(`[...document.querySelectorAll(${JSON.stringify(`${inPanel("oats-panel-activity-list")} ${testId("oats-panel-event")} strong`)})].map((e) => e.innerText.trim()).join(", ")`);
      check(titles === "Waiting claim, Launched, Stopped, Launched, Restarted, Waiting claim, Launched, Spawned", `${at} the rows, newest first, by the Desktop's titles`, titles);
      await page.evaluate(scroll("oats-panel-activity"));
      await settled(page, viewport);
      await fitted(page, viewport, check, at, "activity");
      await page.shot(`panel-${viewport.name}-activity`);

      // the Soul tab: the soul as spawned
      await page.evaluate(click(inPanel("oats-tab-soul")));
      const spawned = await page.until(`${textOf(inPanel("oats-panel-spawned-from"))}`, 30);
      check(spawned === "Spawned from oats-expert @ 0ab9f62", `${at} the Soul tab: where the instance was spawned from`, spawned);
      check((await page.evaluate(textOf(inPanel("oats-panel-as-spawned")))) === "As spawned: an instance never changes under itself. A newer soul or module needs a new instance.", `${at} and that it is as spawned`);
      check((await page.evaluate(factsOf("oats-panel-core"))) === "Knowledge: None | Messaging: None | Tasks: None", `${at} Core capabilities: the three slots (none is filled in the recording)`, await page.evaluate(factsOf("oats-panel-core")));
      const capabilities = await page.evaluate(textOf(inPanel("oats-panel-capabilities")));
      check(/^capabilities 2 /i.test(capabilities) && capabilities.includes("oats.bb") && capabilities.includes("oats.core default oats.framework 1.26.0"), `${at} Capabilities: each with why it is there and its source`, capabilities);
      const soulReady = await page.until(`${textOf(inPanel("oats-panel-readiness-soul") + " " + testId("oats-panel-readiness-summary"))}`, 30);
      check(soulReady === "Ready — every required check passes or is not applicable.", `${at} Soul readiness: the summary`, soulReady);
      await settled(page, viewport);
      await fitted(page, viewport, check, at, "the soul as spawned");
      await page.shot(`panel-${viewport.name}-soul-spawned`);
      await page.evaluate(click(inPanel("oats-tab-instance")));
    },
  },
  {
    stage: "panel",
    name: "a read in flight and a refused read, of readiness, of the activity and of the soul as spawned",
    run: async ({ page, at, viewport, threads, check }) => {
      const slow = (verb) => setVerb(verb, { file: { "readiness --home": "panel/readiness-home.json", "instance events": "panel/events.json", "inspect --home": "panel/inspect-home.json" }[verb], sleepMs: 6000 });
      try {
        // in flight: the kernel takes its time
        slow("readiness --home");
        check(await open(page, viewport, threads, CHILD), `${at} the panel is open`);
        await page.evaluate(click(inPanel("oats-tab-instance")));
        const loading = await page.until(`${textOf(inPanel("oats-panel-readiness-instance") + " " + testId("oats-loading"))}`, 15);
        check(loading === "Loading readiness…", `${at} while readiness is read: Loading readiness…`, loading);
        await page.evaluate(scroll("oats-panel-readiness-instance"));
        await page.shot(`panel-${viewport.name}-readiness-loading`);
        slow("instance events");
        await page.evaluate(click(inPanel("oats-panel-activity-load")));
        const reading = await page.until(`${textOf(inPanel("oats-panel-activity") + " " + testId("oats-loading"))}`, 15);
        check(reading === "Reading reported lifecycle activity…", `${at} while the activity is read: Reading reported lifecycle activity…`, reading);
        await page.evaluate(scroll("oats-panel-activity"));
        await page.shot(`panel-${viewport.name}-activity-loading`);
        slow("inspect --home");
        await page.evaluate(click(inPanel("oats-tab-soul")));
        const soul = await page.until(`${textOf(inPanel("oats-panel-soul-body") + " " + testId("oats-loading"))}`, 15);
        check(soul === "Reading the soul as this instance was spawned from it…", `${at} while the soul is read: Reading the soul as this instance was spawned from it…`, soul);
        await page.shot(`panel-${viewport.name}-soul-loading`);

        // refused: the kernel's code after the words, its message under Details, Retry
        setVerb("readiness --home", refusal("E_HOME_MISMATCH", "the home is not this deployment's"));
        setVerb("instance events", refusal("E_AMBIGUOUS_INSTANCE", "two homes hold an instance of this name"));
        setVerb("inspect --home", refusal("E_UNSUPPORTED_MODE", "this home has no modules"));
        setVerb("readiness --soul", refusal("E_SOUL_UNKNOWN", "no soul of this name"));
        check(await open(page, viewport, threads, CHILD), `${at} the panel is open again`);
        await page.evaluate(click(inPanel("oats-tab-soul")));
        const notice = (section) => `(() => { const e = document.querySelector(${JSON.stringify(`${testId("oats-panel")} `)} + ${JSON.stringify(section)} + ${JSON.stringify(` ${testId("oats-notice")}`)}); return e ? e.querySelector("h3").innerText.trim() + " | " + e.getAttribute("role") + " | " + e.innerText.replace(/\\s+/g, " ").trim() : ""; })()`;
        const soulRefused = await page.until(notice(testId("oats-panel-soul-body")), 30);
        check((soulRefused ?? "").startsWith("The soul as spawned could not be read | alert | ") && soulRefused.includes("E_UNSUPPORTED_MODE") && soulRefused.includes("Details") && soulRefused.includes("Retry"), `${at} the soul as spawned, refused: a notice in words, the kernel's code, Details and Retry`, soulRefused);
        // the soul's readiness, refused, under the soul's refused read
        const soulReadinessRefused = await page.until(notice(testId("oats-panel-readiness-soul")), 30);
        check((soulReadinessRefused ?? "").startsWith("Readiness could not be read | alert | ") && soulReadinessRefused.includes("Select one local soul and its exact agents root.") && soulReadinessRefused.includes("E_SOUL_UNKNOWN"), `${at} the soul's readiness, refused: the Desktop's sentence for the code, then the code`, soulReadinessRefused);
        await settled(page, viewport);
        await fitted(page, viewport, check, at, "the Soul tab's refused reads");
        await page.shot(`panel-${viewport.name}-soul-refused`);
        await page.evaluate(click(inPanel("oats-tab-instance")));
        const readinessRefused = await page.until(notice(testId("oats-panel-readiness-instance")), 30);
        check((readinessRefused ?? "").startsWith("Readiness could not be read | alert | ") && readinessRefused.includes("The instance home no longer matches its admitted identity.") && readinessRefused.includes("E_HOME_MISMATCH"), `${at} readiness, refused: the Desktop's sentence for the code, then the kernel's code`, readinessRefused);
        await page.evaluate(click(inPanel("oats-panel-activity-load")));
        const activityRefused = await page.until(notice(testId("oats-panel-activity")), 30);
        check((activityRefused ?? "").startsWith("The recorded activity could not be read | alert | ") && activityRefused.includes("Choose one exact instance home.") && activityRefused.includes("E_AMBIGUOUS_INSTANCE"), `${at} the activity, refused: the Desktop's sentence for the code, then the kernel's code`, activityRefused);
        await page.evaluate(scroll("oats-panel-readiness-instance"));
        await settled(page, viewport);
        await fitted(page, viewport, check, at, "refused reads");
        await page.shot(`panel-${viewport.name}-reads-refused`);

        // Retry, once the kernel answers
        setVerb("readiness --home", null);
        await page.evaluate(`[...document.querySelectorAll(${JSON.stringify(`${inPanel("oats-panel-readiness-instance")} ${testId("oats-notice")} button`)})].find((e) => e.innerText.trim() === "Retry").click()`);
        const again = await page.until(`${textOf(inPanel("oats-panel-readiness-instance") + " " + testId("oats-panel-readiness-summary"))}`, 30);
        check(again === "Ready — every required check passes or is not applicable.", `${at} Retry reads readiness again`, again);
      } finally {
        for (const verb of ["readiness --home", "readiness --soul", "instance events", "inspect --home"]) setVerb(verb, null);
        await page.evaluate(click(inPanel("oats-tab-instance")));
      }
    },
  },
  {
    stage: "panel",
    name: "readiness that is not ready, a sign-in needed, warnings; an incomplete and an empty activity window, a blocked launch; a read again that fails",
    run: async ({ page, at, viewport, threads, check }) => {
      const VERBS = ["readiness --home", "readiness --soul", "instance events", "inspect --home"];
      const summaryOf = (of) => textOf(`${inPanel(`oats-panel-readiness-${of}`)} ${testId("oats-panel-readiness-summary")}`);
      const flat = (selector, open = false) => `(() => { const e = document.querySelector(${JSON.stringify(selector)}); if (!e) return ""; if (${open}) e.querySelectorAll("details").forEach((d) => { d.open = true; }); return e.innerText.replace(/\\s+/g, " ").trim(); })()`;
      const staleOf = (section) => flat(`${inPanel(section)} ${testId("oats-stale")}`);
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
        check(await open(page, viewport, threads, CHILD), `${at} the panel is open`);
        await page.evaluate(click(inPanel("oats-tab-instance")));
        const notReady = await page.until(`${summaryOf("instance")} === "1 failing · 0 unknown · 4 required checks"`, 30);
        check(Boolean(notReady), `${at} Instance readiness, not ready: how many fail, are unknown and are required`, await page.evaluate(summaryOf("instance")));
        await page.evaluate(openFold("oats-panel-readiness-checks"));
        const failing = await page.evaluate(flat(inPanel("oats-panel-check-providers"), true));
        check(
          ["Providers fail", "oats.bb session backend bb · fail · required · 2 warnings", "Producer session provider check", "Reason the bb version could not be read (cannot run bb: spawn bb ENOENT: install bb-app or set settings.oats.bb.cli)", "Problem code E_BACKEND_VERSION", "The provider says: needs configuration.", "Warning: bubblewrap (bwrap) is not on this host's PATH"].every((part) => failing.includes(part)),
          `${at} the failing check, open: the item's line, its producer, the kernel's reason, the problem's code, the provider's own answer and its warnings`,
          failing,
        );
        await page.evaluate(scroll("oats-panel-readiness-instance"));
        await settled(page, viewport);
        await fitted(page, viewport, check, at, "readiness that is not ready");
        await page.shot(`panel-${viewport.name}-readiness-not-ready`);

        // Refresh readiness says that it read again
        await page.evaluate(click(`${inPanel("oats-panel-readiness-instance")} ${testId("oats-panel-readiness-refresh")}`));
        const updated = await page.until(`${textOf(`${inPanel("oats-panel-readiness-instance")} ${testId("oats-panel-readiness-status")}`)} === "Readiness updated"`, 30);
        check(Boolean(updated), `${at} Refresh readiness says Readiness updated once it read again`);

        // the activity: an incomplete window, and a blocked launch's row
        setVerb("instance events", derived("events.json", (result) => {
          result.truncated = true;
          result.integrity.unreadableRows = 1;
          result.events.push({ ...result.events[1], at: "2026-11-21T18:40:00.000Z", kind: "launch-prompt", data: { status: "blocked", class: "development-channel", differed: { nearest: "claude-folder-trust-2", firstDifference: { index: 12, expected: "Do you trust the files in this folder?", found: "" } } } });
        }));
        await page.evaluate(click(inPanel("oats-panel-activity-load")));
        const blocked = await page.until(`${textOf(inPanel("oats-panel-activity-summary"))}.startsWith("Launch prompt · 2026-11-21T18:40:00.000Z")`, 30);
        check(Boolean(blocked), `${at} the activity's summary leads with the last row: a launch prompt`, await page.evaluate(textOf(inPanel("oats-panel-activity-summary"))));
        await page.evaluate(openFold("oats-panel-activity-list"));
        const incompleteLine = await page.evaluate(textOf(inPanel("oats-panel-activity-incomplete")));
        check(incompleteLine === "Incomplete evidence: 1 unreadable rows · 0 foreign rows · window or source truncated.", `${at} an incomplete window says what is missing`, incompleteLine);
        const differed = await page.evaluate(flat(inPanel("oats-panel-event-differed")));
        check(differed === "Where the screen first differed from the confirmation OATS answers: OATS expected: Do you trust the files in this folder? The terminal showed: (no visible text) Nearest entry claude-folder-trust-2, first difference at 12", `${at} a blocked launch's row: what OATS expected and what the terminal showed, each under whose text it is`, differed);
        await page.evaluate(scroll("oats-panel-activity"));
        await settled(page, viewport);
        await fitted(page, viewport, check, at, "an incomplete activity window");
        await page.shot(`panel-${viewport.name}-activity-incomplete`);

        // the tab left and come back to: what was read is the last observation, and nothing is read
        await page.evaluate(click(inPanel("oats-tab-soul")));
        await page.until(visible(inPanel("oats-panel-soul-body")), 15);
        await page.evaluate(click(inPanel("oats-tab-instance")));
        const kept = await page.until(`${textOf(inPanel("oats-panel-activity-status"))}`, 15);
        check(kept === "Last observation retained; refresh required." && (await page.evaluate(textOf(inPanel("oats-panel-activity-load")))) === "Refresh activity", `${at} back on the tab, the activity read earlier is said to be the last observation, with Refresh activity`, kept);

        // an empty window
        setVerb("instance events", derived("events.json", (result) => Object.assign(result, { count: 0, returned: 0, events: [], waitingOnYou: null, waitingClaims: [] })));
        await page.evaluate(click(inPanel("oats-panel-activity-load")));
        const none = await page.until(`${textOf(inPanel("oats-panel-activity-summary"))} === "No recorded lifecycle events in this observed window. · Waiting on you: unknown"`, 30);
        check(Boolean(none), `${at} an empty window: No recorded lifecycle events in this observed window.`, await page.evaluate(textOf(inPanel("oats-panel-activity-summary"))));
        await page.evaluate(openFold("oats-panel-activity-list"));
        check((await page.evaluate(textOf(inPanel("oats-panel-activity-none")))) === "No recorded lifecycle events in this observed window.", `${at} and its fold says the same, with no row`);
        await page.evaluate(scroll("oats-panel-activity"));
        await settled(page, viewport);
        await fitted(page, viewport, check, at, "an empty activity window");
        await page.shot(`panel-${viewport.name}-activity-empty`);

        // a read again that fails keeps what was read: readiness (with its age) and the activity
        setVerb("readiness --home", refusal("E_HOME_MISMATCH", "the home is not this deployment's"));
        setVerb("instance events", refusal("E_NOT_IN_SCOPE", "the instance is outside this deployment"));
        await page.evaluate(click(`${inPanel("oats-panel-readiness-instance")} ${testId("oats-panel-readiness-refresh")}`));
        const staleReadiness = await page.until(staleOf("oats-panel-readiness-instance"), 30);
        check(/^Showing what was read .+\. The instance home no longer matches its admitted identity\. \(E_HOME_MISMATCH\) ?Retry$/.test(staleReadiness ?? ""), `${at} readiness read again and refused: what was read stays, with its age, the Desktop's sentence, the code and Retry`, staleReadiness);
        check((await page.evaluate(summaryOf("instance"))) === "1 failing · 0 unknown · 4 required checks", `${at} and the summary read before is still shown`);
        await page.evaluate(click(inPanel("oats-panel-activity-load")));
        const staleActivity = await page.until(staleOf("oats-panel-activity"), 30);
        check((staleActivity ?? "").includes("The selected instance is outside this workspace scope. (E_NOT_IN_SCOPE)") && staleActivity.endsWith("Retry"), `${at} the activity read again and refused: what was read stays, with the Desktop's sentence, the code and Retry`, staleActivity);
        await page.evaluate(scroll("oats-panel-readiness-instance"));
        await settled(page, viewport);
        await fitted(page, viewport, check, at, "reads that failed after one answered");
        await page.shot(`panel-${viewport.name}-reads-stale`);

        // the Soul tab: its readiness needs a sign-in and has a warning, its fold open
        await page.evaluate(click(inPanel("oats-tab-soul")));
        const signIn = await page.until(`${summaryOf("soul")} === "1 failing · 0 unknown · 4 required checks"`, 30);
        check(Boolean(signIn), `${at} Soul readiness, not ready`, await page.evaluate(summaryOf("soul")));
        await page.evaluate(openFold("oats-panel-readiness-checks"));
        const providers = await page.evaluate(flat(inPanel("oats-panel-check-providers"), true));
        check(["Providers sign in needed", "oats.bb session backend bb · sign in needed · required", "Sign in needed: the provider is set up but is not signed in.", "Problem code E_BACKEND_SIGNED_OUT"].every((part) => providers.includes(part)), `${at} a provider that is not signed in: sign in needed, in the check's state, the item's line and the provider's sentence`, providers);
        const warnings = await page.evaluate(flat(inPanel("oats-panel-readiness-warnings-soul")));
        check(/^warnings 1 Warning oats\.bb one declared hook never runs here: bb has no session-end event \S? ?Details$/i.test(warnings), `${at} readiness' capability warnings: the capability, the kernel's message, Details`, warnings);
        await page.evaluate(scroll("oats-panel-readiness-soul"));
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
    run: async ({ page, at, viewport, threads, check }) => {
      const flat = (selector, open = false) => `(() => { const e = document.querySelector(${JSON.stringify(selector)}); if (!e) return ""; if (${open}) e.querySelectorAll("details").forEach((d) => { d.open = true; }); return e.innerText.replace(/\\s+/g, " ").trim(); })()`;
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
        check(await open(page, viewport, threads, CHILD), `${at} the panel is open`);
        await page.evaluate(click(inPanel("oats-tab-soul")));
        await page.until(`${textOf(inPanel("oats-panel-core-knowledge"))}.includes("oats.okf")`, 30);
        const knowledge = await page.evaluate(flat(inPanel("oats-panel-core-knowledge")));
        check(knowledge.includes("oats.okf 0.9.2") && knowledge.endsWith("Resolved the workspace default at spawn"), `${at} Core capabilities: the knowledge slot's provider with its source, and why it is there`, knowledge || (await page.evaluate(textOf(inPanel("oats-panel-core")))));
        const off = await page.evaluate(`(() => { const rows = [...document.querySelectorAll(${JSON.stringify(`${inPanel("oats-panel-capabilities")} ${testId("oats-panel-capability")}`)})]; const row = rows[rows.length - 1]; const struck = [...row.querySelectorAll("span")].some((e) => getComputedStyle(e).textDecorationLine === "line-through"); return JSON.stringify([rows.length, row.innerText.replace(/\\s+/g, " ").trim(), struck]); })()`);
        check(off === JSON.stringify([3, "oats.review turned off by soul", true]), `${at} Capabilities: one the soul turned off is last, struck through, with "turned off by soul" beside it`, off);
        const warnings = await page.evaluate(flat(inPanel("oats-panel-soul-warnings"), true));
        check(/^warnings 1 Warning oats\.okf one declared hook never runs here: bb has no session-end event \S? ?Details Code hook-event-unsupported Path oats\.json$/i.test(warnings), `${at} Warnings: the capability, the kernel's message, and its code and path under Details`, warnings);
        check((await page.evaluate(textOf(inPanel("oats-panel-modules")))) === "Modules as spawned · 3", `${at} Modules as spawned · 3`);
        check(/^capabilities 2 /i.test(await page.evaluate(flat(inPanel("oats-panel-capabilities")))), `${at} the count beside Capabilities is of the two the instance has: the one turned off is listed, not counted`);
        await page.evaluate(scroll("oats-panel-core"));
        await settled(page, viewport);
        await fitted(page, viewport, check, at, "a soul with a core capability, one turned off and a warning");
        await page.shot(`panel-${viewport.name}-soul-composed`);

        // only its core capabilities
        setVerb("inspect --home", derived("inspect-home.json", (result) => {
          okf(result);
          result.capabilities = result.capabilities.filter((capability) => capability.id === "oats.okf");
        }));
        check(await open(page, viewport, threads, CHILD), `${at} the panel is open again`);
        await page.evaluate(click(inPanel("oats-tab-soul")));
        await page.until(`/only the core ones/.test(${textOf(inPanel("oats-panel-capabilities"))})`, 30);
        const only = await page.evaluate(flat(inPanel("oats-panel-capabilities")));
        check(/^capabilities 0 No other capabilities: only the core ones\.$/i.test(only), `${at} a soul with only core capabilities: No other capabilities: only the core ones.`, only);
        await page.evaluate(scroll("oats-panel-core"));
        await settled(page, viewport);
        await fitted(page, viewport, check, at, "a soul with only its core capabilities");
        await page.shot(`panel-${viewport.name}-soul-core-only`);

        // read again (the instance was started again) and refused: what was read stays
        setVerb("inspect --home", refusal("E_UNSUPPORTED_MODE", "this home has no modules"));
        const restarted = recorded(threads);
        restarted.agents.flatMap((group) => group.instances).find((row) => row.instance === CHILD.instance).startedAt = new Date().toISOString();
        record(restarted);
        const stale = await page.until(flat(`${inPanel("oats-panel-soul-body")} ${testId("oats-stale")}`), 30);
        check((stale ?? "").includes("It could not be read again. (E_UNSUPPORTED_MODE)") && stale.endsWith("Retry"), `${at} the soul read again and refused: what was read stays, with the code and Retry`, stale);
        check(/only the core ones/.test(await page.evaluate(textOf(inPanel("oats-panel-capabilities")))), `${at} and the soul read before is still shown`);
        await page.evaluate(`document.querySelector(${JSON.stringify(`${inPanel("oats-panel-soul-body")} ${testId("oats-stale")}`)}).scrollIntoView({ block: "center" })`);
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
    run: async ({ page, at, viewport, threads, check }) => {
      // running, with a messaging id and a lineage of an owning human and a sibling
      check(await open(page, viewport, threads, CHILD), `${at} the running agent's panel shows`);
      await page.until(visible(inPanel("oats-panel-work-sentence")), 30);
      const running = await page.evaluate(said);
      check(/^Running ?· (<1m|\d+[mhd])$/.test(running), `${at} a running agent's header says Running and since when`, running);
      check(!(await page.evaluate(visible(inPanel("oats-panel-waiting")))), `${at} an agent that does not wait shows no Needs input`);
      check((await page.evaluate(factsOf("oats-panel-messaging"))).startsWith("Messaging ID: oats.aweb.ai/panel-worktree-helper"), `${at} Messaging & Teams: the messaging id`, await page.evaluate(factsOf("oats-panel-messaging")));
      const copyId = await page.evaluate(`document.querySelector(${JSON.stringify(`${inPanel("oats-panel-messaging")} button`)})?.getAttribute("aria-label")`);
      check(copyId === "Copy messaging ID", `${at} its Copy is named Copy messaging ID`, copyId);
      const lineage = await page.evaluate(factsOf("oats-panel-lineage"));
      check(lineage === "Owning human: Ana | Sibling: redesign-ui-lead", `${at} Lineage: the owning human and the sibling`, lineage);
      await page.evaluate(`document.querySelector(${JSON.stringify(inPanel("oats-panel-lineage"))}).scrollIntoView({ block: "end" })`);
      await settled(page, viewport);
      await fitted(page, viewport, check, at, "instance-running");
      await page.shot(`panel-${viewport.name}-instance-running`);

      // idle: neither running nor stopped, nothing waiting
      check(await open(page, viewport, threads, IDLE), `${at} the idle agent's panel shows`);
      const idle = await page.evaluate(said);
      check(idle === "Idle", `${at} an agent the kernel calls neither running nor stopped says Idle, never "Not reported"`, idle);
      await settled(page, viewport);
      await fitted(page, viewport, check, at, "instance-idle");
      await page.shot(`panel-${viewport.name}-instance-idle`);

      // unreachable, with the kernel's runtime error
      check(await open(page, viewport, threads, PARENT), `${at} the unreachable agent's panel shows`);
      await page.until(visible(inPanel("oats-panel-runtime-error")), 30);
      const unreachable = await page.evaluate(said);
      check(unreachable === "Unreachable", `${at} an agent the kernel cannot reach says Unreachable`, unreachable);
      const error = await page.evaluate(textOf(inPanel("oats-panel-runtime-error")));
      check(error === "OATS says: bb did not answer at http://127.0.0.1:38886 (connection refused)", `${at} Session: the kernel's runtime error, with who says it`, error);
      await page.evaluate(`document.querySelector(${JSON.stringify(inPanel("oats-panel-runtime-error"))}).scrollIntoView({ block: "center" })`);
      await settled(page, viewport);
      await fitted(page, viewport, check, at, "instance-unreachable");
      await page.shot(`panel-${viewport.name}-instance-unreachable`);

      // failed: its session fell back to a shell; and its soul has no key in the roster
      check(await open(page, viewport, threads, SHELL), `${at} the failed agent's panel shows`);
      const failed = await page.evaluate(said);
      check(failed === "Failed", `${at} an agent whose session fell back to a shell says Failed, as the tree does`, failed);
      await settled(page, viewport);
      await fitted(page, viewport, check, at, "instance-failed");
      await page.shot(`panel-${viewport.name}-instance-failed`);
      await page.evaluate(click(inPanel("oats-tab-soul")));
      const why = await page.until(`${textOf(inPanel("oats-panel-open-soul-why"))}`, 15);
      check(why === "OATS lists no soul of this name here, so there is no soul page to open.", `${at} a soul OATS does not name: Open soul page is off, and the reason is beside it`, why);
      check((await page.evaluate(`document.querySelector(${JSON.stringify(inPanel("oats-panel-open-soul"))})?.disabled`)) === true, `${at} Open soul page is disabled there`);
      await settled(page, viewport);
      await fitted(page, viewport, check, at, "soul-unnamed");
      await page.shot(`panel-${viewport.name}-soul-unnamed`);
      await page.evaluate(click(inPanel("oats-tab-instance")));
    },
  },
  {
    stage: "panel-states",
    name: "freshness: a claim the kernel records is in the panel's header within 3 s, and gone within 3 s of its end",
    run: async ({ page, at, viewport, threads, check }) => {
      try {
        check(await open(page, viewport, threads, IDLE), `${at} the idle agent's panel is open`);
        check(Boolean(await page.until(`${said} === "Idle"`, 30)), `${at} before the claim its header says Idle`);
        const claimed = record(states(threads, RUNNING_MODEL, { since: new Date().toISOString(), producer: "agent", reason: "attention", message: "Keep the retry, or fail the job?" }));
        const needs = (await page.until(`${said}.startsWith("Needs you")`, 15)) ? Date.now() - claimed : null;
        check(needs !== null && needs <= 3000, `${at} the header says Needs you ${needs === null ? "never" : `${needs} ms`} after the kernel recorded the claim (3 s at most)`, await page.evaluate(said));
        check((await page.evaluate(textOf(inPanel("oats-panel-waiting-message")))) === "Keep the retry, or fail the job?", `${at} and the Needs input section says the agent's message`);
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
    run: async ({ page, at, viewport, threads, check }) => {
      check(await open(page, viewport, threads, TMUX), `${at} Open, on its soul's page, opens the page of an agent with no thread in bb`);
      await page.until(visible(inPanel("oats-panel-session")), 30);
      const session = await page.evaluate(factsOf("oats-panel-session"));
      check(session.includes("Runs in: tmux · oats-agents"), `${at} Session: where an agent on tmux runs`, session);
      check((await page.evaluate(textOf(testId("oats-agent-back")))) === "Back to Home", `${at} with no thread to go back to, the way back is Home`);
      await settled(page, viewport);
      await fitted(page, viewport, check, at, "page-tmux");
      await page.shot(`panel-${viewport.name}-page-tmux`);

      await page.goto("/plugins/oats/agent/gone-helper");
      const gone = await page.until(`(() => { const t = ${textOf(`${testId("oats-agent-page")} ${testId("oats-empty")}`)}; return t; })()`, 30);
      check(gone === "OATS lists no agent named gone-helper in this deployment: it may have been retired.", `${at} the page of a name OATS does not list says so`, gone);
      await page.shot(`panel-${viewport.name}-page-gone`);

      await page.goto("/plugins/oats/agent");
      const none = await page.until(`${textOf(`${testId("oats-agent-page")} ${testId("oats-empty")}`)}`, 30);
      check(none === "No agent is named here.", `${at} the page with no name says so`, none);
      await page.shot(`panel-${viewport.name}-page-none`);
    },
  },
  {
    stage: "panel-states",
    name: "a panel opened again reads again; what it keeps when OATS cannot be read again; the page when OATS could not be read",
    run: async ({ page, at, viewport, threads, check, sleep }) => {
      const model = `${inPanel("oats-panel-model")}`;
      try {
        // Opened again: leave the agent's page inside the app, change what OATS says, come back.
        await page.goto(`/plugins/oats/agent/${CHILD.instance}`);
        check(Boolean(await page.until(`${textOf(model)}.startsWith(${JSON.stringify(RUNNING_MODEL)})`, 30)), `${at} the agent's page shows its model`);
        await page.evaluate(click(testId("oats-agent-back")));
        await page.until(`location.pathname.endsWith("/threads/${threads.get(CHILD.thread).id}")`, 15);
        setStatus({ stdout: JSON.stringify(states(threads, "claude-fable-5.2")) });
        refresh();
        await sleep(1500);
        await page.evaluate("history.back()");
        const reread = await page.until(`${textOf(model)}.startsWith("claude-fable-5.2")`, 20);
        check(Boolean(reread), `${at} a panel opened again shows what OATS says now, not what it read before`, await page.evaluate(textOf(model)));

        // OATS cannot be read again: the panel keeps what it read, with its age, the code and Retry,
        // in the thread's tab as on the agent's page.
        check(await open(page, viewport, threads, CHILD), `${at} the panel is open before OATS stops answering`);
        await page.until(visible(inPanel("oats-panel-work-sentence")), 30);
        setStatus(REFUSED);
        refresh();
        const stale = await page.until(`(() => { const t = ${textOf(inPanel("oats-stale"))}; return t.includes("could not be read again") ? t : ""; })()`, 40);
        check(/howing what was read (just now|\d+s ago|\d+ min ago)\. OATS could not be read again \(E_LOCAL_MISSING\)\. Retry$/.test(stale ?? ""), `${at} when OATS cannot be read again the panel says how old what it shows is, and why, with Retry`, stale);
        check((await page.evaluate(textOf(inPanel("oats-panel-name")))) === "Panel worktree helper" && (await page.evaluate(visible(inPanel("oats-panel-work-sentence")))), `${at} and keeps the agent and its facts on screen`);
        if (viewport.mobile) check((await page.evaluate(textOf(testId("oats-agent-back")))) === "Back to the thread", `${at} and the way back`);
        await settled(page, viewport);
      await fitted(page, viewport, check, at, "stale");
        await page.shot(`panel-${viewport.name}-stale`);

        // Never read: a page opened while OATS cannot be read.
        await page.goto(`/plugins/oats/agent/${CHILD.instance}`);
        const notice = await page.until(`(() => { const e = document.querySelector(${JSON.stringify(`${testId("oats-agent-page")} ${testId("oats-notice")}`)}); return e ? e.querySelector("h3").innerText.trim() + " | " + e.getAttribute("role") + " | " + e.innerText.replace(/\\s+/g, " ").trim() : ""; })()`, 40);
        check((notice ?? "").startsWith("OATS could not be read | alert | ") && notice.includes("E_LOCAL_MISSING") && notice.includes("Details") && notice.includes("Retry"), `${at} a page opened while OATS cannot be read: a notice in words, the code after them, Details and Retry`, notice);
        await page.shot(`panel-${viewport.name}-page-unreadable`);

        // Retry, once OATS answers again.
        setStatus({ stdout: JSON.stringify(states(threads)) });
        await page.evaluate(`[...document.querySelectorAll(${JSON.stringify(`${testId("oats-agent-page")} ${testId("oats-notice")} button`)})].find((e) => e.innerText.trim() === "Retry").click()`);
        check(Boolean(await page.until(`${visible(testId("oats-panel"))} && ${textOf(model)}.startsWith(${JSON.stringify(RUNNING_MODEL)})`, 40)), `${at} Retry reads OATS again and shows the agent`);
      } finally {
        setStatus({ stdout: JSON.stringify(states(threads)) });
      }
    },
  },
];

export default [...first, ...second, ...more];
