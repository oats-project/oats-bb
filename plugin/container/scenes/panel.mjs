// The instance panel's live scenes (container/live-ui.mjs says what a scene is). At 1280x800 the
// panel is the OATS tab of the agent's thread; at 390x800, where bb has no side panel, it is the
// agent's own page.
//   panel         the Instance tab of an agent that needs you, its folds open, its Soul tab, and a
//                 stopped agent
//   panel-states  the states the first stage has none of: running (with a messaging id, an owning
//                 human and a sibling), idle, failed, unreachable with the kernel's runtime error,
//                 an agent with no thread in bb, a soul OATS does not name; the agent's page for a
//                 name OATS does not list and for no name; what the panel keeps when OATS cannot
//                 be read again, and the page when it could never be read; and that a panel opened
//                 again reads again.
//
// Both stages have the fake `oats` print the roster recorded from the real kernel for the panel
// (test/fixtures/panel/status-soul-moved.json: a child on its own worktree, idle in bb, whose board
// asked a question and whose soul's repository moved on; and its parent, stopped), with its thread
// ids replaced by threads the live checks made in bb. The second stage changes that recording, in
// the open and only here: the fields a state is made of, and copies of the child's row under other
// names for the states that need an agent of their own. Those rows are not fixtures: no test reads
// them.
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { testId, textOf, visible } from "../browser.mjs";

const FIXTURE = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "test", "fixtures", "panel", "status-soul-moved.json");
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
function states(threads, model = RUNNING_MODEL) {
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
  groupOf(CHILD.instance).instances.push(copy(IDLE, { running: null, runtimeState: "unknown" }));
  // an agent with no thread in bb: a tmux row
  const tmux = copy(TMUX, { running: true, runtimeState: "running", backend: "tmux", tmux: { session: "oats-agents", socket: "/tmp/tmux-1000/oats" }, open: null });
  delete tmux.session;
  groupOf(CHILD.instance).instances.push(tmux);
  // an agent whose session fell back to a shell, of a soul the roster does not name by a key
  const { instances: _instances, key: _key, description: _description, ...group } = groupOf(CHILD.instance);
  roster.agents.push({ ...group, name: "oats-legacy", instances: [copy(SHELL, { agent: "oats-legacy", running: false, runtimeState: "shell" })] });
  return roster;
}

/** What the fake `oats` answers for `status`, while the stage's other verbs stay as they are. */
function setStatus(behaviour) {
  const config = JSON.parse(readFileSync(FAKE_CONFIG, "utf8"));
  writeFileSync(FAKE_CONFIG, JSON.stringify({ ...config, verbs: { ...config.verbs, status: behaviour } }));
}
/** Asks the plugin's server to read OATS again now, as its Retry does. */
function refresh() {
  const input = join(homedir(), "panel-refresh-input.json");
  writeFileSync(input, "null");
  execFileSync("bb", ["plugin", "rpc", "call", "oats", "refresh", "--input-file", input, "--json"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}
const REFUSED = { stdout: JSON.stringify({ schemaVersion: 1, ok: false, error: { code: "E_LOCAL_MISSING", message: "no oats-local.yaml at or above this directory" } }), exit: 1 };

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
 * What the standard asks of every screen, for what the panel draws: nothing of it reaches past the
 * panel's own right edge, the page does not scroll sideways, and every control is high enough to
 * press. Where bb gives the panel a place wider than what is left of the window (at 1280 with the
 * sidebar, a thread and the side panel open, bb's thread column keeps its own least width), that is
 * bb's layout and not seen here.
 */
async function fits(page, viewport) {
  const need = viewport.mobile ? 44 : 32;
  return JSON.parse(
    await page.evaluate(
      `(() => { const panel = document.querySelector(${JSON.stringify(testId("oats-panel"))}); const low = [...panel.querySelectorAll("button, summary, a")].filter((e) => e.getClientRects().length > 0 && e.getBoundingClientRect().height < ${need} - 0.5).map((e) => (e.innerText || e.getAttribute("aria-label") || e.tagName).trim() + " " + Math.round(e.getBoundingClientRect().height)); const edge = panel.getBoundingClientRect().right; const wide = [...panel.querySelectorAll("*")].filter((e) => e.getClientRects().length > 0 && e.getBoundingClientRect().right > edge + 0.5).length; return JSON.stringify({ low, wide, scroll: document.documentElement.scrollWidth - innerWidth }); })()`,
    ),
  );
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
      let fit = await fits(page, viewport);
      check(fit.low.length === 0 && fit.wide === 0 && fit.scroll <= 0, `${at} nothing is cut sideways and every control is high enough to press`, JSON.stringify(fit));
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
      fit = await fits(page, viewport);
      check(fit.low.length === 0 && fit.wide === 0 && fit.scroll <= 0, `${at} open, nothing is cut sideways and every control is high enough to press`, JSON.stringify(fit));
      await page.shot(`panel-${viewport.name}-instance-open`);

      // the Soul tab, from the soul's name in the header
      await page.evaluate(click(inPanel("oats-panel-soul-link")));
      check(Boolean(await page.until(`${textOf(inPanel("oats-panel-soul-name"))} === "oats-expert"`, 15)), `${at} the soul's name opens the Soul tab`);
      check((await page.evaluate(textOf(inPanel("oats-panel-soul-description")))) === "OATS expert: answers questions about OATS.", `${at} the Soul tab: the soul's description`);
      await page.evaluate(`document.querySelector(${JSON.stringify(inPanel("oats-panel-details"))}).open = true`);
      const details = await page.evaluate(textOf(inPanel("oats-panel-details")));
      check(details.includes("Details") && /agents root/i.test(details) && details.includes("/agents"), `${at} Details: the agents root, with its Copy`, details);
      check((await page.evaluate(`document.querySelector(${JSON.stringify(inPanel("oats-panel-open-soul"))})?.disabled`)) === false, `${at} Open soul page is offered`);
      fit = await fits(page, viewport);
      check(fit.low.length === 0 && fit.wide === 0 && fit.scroll <= 0, `${at} the Soul tab: nothing is cut sideways and every control is high enough to press`, JSON.stringify(fit));
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
      await page.shot(`panel-${viewport.name}-instance-stopped`);
      if (viewport.mobile) {
        await page.evaluate(click(testId("oats-agent-back")));
        check(Boolean(await page.until(`location.pathname.endsWith("/threads/${threads.get(PARENT.thread).id}")`, 15)), `${at} Back returns to the agent's thread`, await page.evaluate("location.pathname"));
      }
    },
  },
];

/** The state line of the open panel, as a screen reader reads it: the word, then what follows it. */
const said = `(() => { const line = document.querySelector(${JSON.stringify(`${testId("oats-panel")} ${testId("oats-panel-state")} ${testId("oats-status-line")}`)})?.cloneNode(true); if (!line) return ""; line.querySelectorAll('[aria-hidden="true"]').forEach((e) => e.remove()); return line.innerText.replace(/\\s+/g, " ").trim(); })()`;
/** The facts of a section of the open panel: "label: value", in order. */
const factsOf = (section) => `[...document.querySelectorAll(${JSON.stringify(`${inPanel(section)} ${testId("oats-fact")}`)})].map((e) => e.querySelector("dt").innerText.trim() + ": " + e.querySelector("dd").innerText.replace(/\\s+/g, " ").trim()).join(" | ")`;

/** Before a screenshot: nothing of the panel is cut sideways, and each of its controls is high enough to press. */
async function fitted(page, viewport, check, at, what) {
  const fit = await fits(page, viewport);
  check(fit.low.length === 0 && fit.wide === 0 && fit.scroll <= 0, `${at} ${what}: nothing is cut sideways and every control of the panel is high enough to press`, JSON.stringify(fit));
}

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
      await fitted(page, viewport, check, at, "instance-running");
      await page.shot(`panel-${viewport.name}-instance-running`);

      // idle: neither running nor stopped, nothing waiting
      check(await open(page, viewport, threads, IDLE), `${at} the idle agent's panel shows`);
      const idle = await page.evaluate(said);
      check(idle === "Idle", `${at} an agent the kernel calls neither running nor stopped says Idle, never "Not reported"`, idle);
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
      await fitted(page, viewport, check, at, "instance-unreachable");
      await page.shot(`panel-${viewport.name}-instance-unreachable`);

      // failed: its session fell back to a shell; and its soul has no key in the roster
      check(await open(page, viewport, threads, SHELL), `${at} the failed agent's panel shows`);
      const failed = await page.evaluate(said);
      check(failed === "Failed", `${at} an agent whose session fell back to a shell says Failed, as the tree does`, failed);
      await fitted(page, viewport, check, at, "instance-failed");
      await page.shot(`panel-${viewport.name}-instance-failed`);
      await page.evaluate(click(inPanel("oats-tab-soul")));
      const why = await page.until(`${textOf(inPanel("oats-panel-open-soul-why"))}`, 15);
      check(why === "OATS lists no soul of this name here, so there is no soul page to open.", `${at} a soul OATS does not name: Open soul page is off, and the reason is beside it`, why);
      check((await page.evaluate(`document.querySelector(${JSON.stringify(inPanel("oats-panel-open-soul"))})?.disabled`)) === true, `${at} Open soul page is disabled there`);
      await fitted(page, viewport, check, at, "soul-unnamed");
      await page.shot(`panel-${viewport.name}-soul-unnamed`);
      await page.evaluate(click(inPanel("oats-tab-instance")));
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

export default [...first, ...more];
