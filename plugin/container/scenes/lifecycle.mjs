// The lifecycle's live scenes: the dialogs of Stop, Start, Restart and Retire, each opened from a
// REAL ROW's menu or from the thread's own menu (bb's thread actions, where a person finds them),
// before the act, while it runs, after it and refused, with the focus order walked.
//
// What the fake `oats` answers is recorded from the real kernel (test/fixtures/lifecycle): the
// stop plan and receipt of redesign-ui-lead, a lead with two children; the retire plan and receipt
// and the start and restart answers of weekly-digest-helper, an agent on a worktree with a child;
// the refusals of gone.json. So each act is asked on the agent its recording is of. A scene sets
// which recorded answer a verb gives, and how late (so that an act in progress can be looked at).
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { FOCUSED, showSidebar, testId, textOf, visible } from "../browser.mjs";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "test", "fixtures", "lifecycle");
const recorded = (name) => JSON.parse(readFileSync(join(FIXTURES, name), "utf8"));
/** What the real kernel answered for each act on an agent it no longer has (gone.json): one refusal per act. */
const gone = (act) => ({ stdout: JSON.stringify(recorded("gone.json")[act]) });
/** When the recorded plans were read: the page's clock is set just after, so that "Observed" says what a person would read. */
const STOP_AT = "2026-11-19T12:30:20.000Z";
const RETIRE_AT = "2026-11-21T15:52:20.000Z";

const LEAD = "thr_redesign"; // redesign-ui-lead: working, two children
const HELPER = "thr_digest"; // weekly-digest-helper: stopped (running, in the stage "lifecycle-running")

// ---- the stages: the fixtures' roster, and what a scene makes the fake answer

let tools = null;
let changes = {};
/** The fake answers the roster with the run's thread ids, and what the scene asks of a verb (the rest is each feature's recorded default). */
const answers = (verbs = {}) => tools.fake({ status: { stdout: tools.statusWithRealIds(tools.threads, changes) }, ...verbs });
const stage = (label, states) => ({
  label,
  enter: async (given) => {
    tools = given;
    changes = states;
    answers();
    await given.untilSnapshot((snapshot) => snapshot.ok === true && snapshot.agents.some((agent) => agent.threadId === given.threads.get(HELPER).id && (states["weekly-digest-helper"] === undefined || agent.running === true)));
  },
});
export const stages = {
  lifecycle: stage("LC", {}),
  // The same roster with weekly-digest-helper running: Restart applies to it, and its recorded restart answer is its own.
  "lifecycle-running": stage("LC2", { "weekly-digest-helper": { running: true, runtimeState: "unknown", sessionEnd: null } }),
};

// ---- what a scene asks of the page (exported: the real run's part, container/real/parts/lifecycle.mjs, asks the same)

const confirm = testId("oats-confirm");
export const phaseIs = (kind) => `document.querySelector(${JSON.stringify(confirm)})?.getAttribute("data-phase") === ${JSON.stringify(kind)}`;
export const click = (id) => `document.querySelector(${JSON.stringify(testId(id))}).click()`;
export const closed = `document.querySelector(${JSON.stringify(testId("oats-modal"))}) === null`;
/** What a dialog says: its title, the agent it is about, its phase, its words, what its button says and whether it is off, and where the focus is. */
export const dialog = async (page) =>
  JSON.parse(
    await page.evaluate(
      `JSON.stringify({ title: ${textOf(`${testId("oats-modal")} h2`)}, about: document.querySelector(${JSON.stringify(confirm)})?.getAttribute("data-about") ?? null, phase: document.querySelector(${JSON.stringify(confirm)})?.getAttribute("data-phase") ?? null, body: ${textOf(testId("oats-modal"))}, act: ${textOf(testId("oats-confirm-act"))}, off: document.querySelector(${JSON.stringify(testId("oats-confirm-act"))})?.disabled ?? null, focus: ${FOCUSED} })`,
    ),
  );
const menuItems = `[...document.querySelectorAll('[role="menuitem"]')]`;
export const menuTexts = (page) => page.evaluate(`JSON.stringify(${menuItems}.map((item) => item.innerText.replace(/\\s+/g, " ").trim()))`).then(JSON.parse);
export const pick = (page, label) => page.evaluate(`(() => { const item = ${menuItems}.find((each) => each.innerText.includes(${JSON.stringify(label)})); if (!item) return false; item.click(); return true; })()`);

/**
 * bb's own menu of a thread's row in the sidebar, as a right click (a long press, on a phone) opens
 * it. The row takes the focus first, as it does under a person's click: the event alone moves none.
 */
export async function openRowMenu(page, viewport, threadId) {
  await showSidebar(page, viewport);
  const row = `document.querySelector('${testId("oats-agent-row")}[data-sidebar-thread-id="${threadId}"]')`;
  if (!(await page.until(`${row} !== null`, 30))) return false;
  // bb puts the focus in its composer once a page has loaded: the row is pressed after that, as a person presses it.
  await page.until(`document.activeElement !== null && document.activeElement !== document.body`, 5);
  await page.evaluate(`(() => { const row = ${row}; row.scrollIntoView({ block: "center" }); row.focus(); const box = row.getBoundingClientRect(); row.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: box.left + 30, clientY: box.top + 10, button: 2 })); })()`);
  return Boolean(await page.until(`${menuItems}.length > 0`, 10));
}
/** bb's own menu of the thread in view: its "Thread actions" button. */
export async function openThreadMenu(page) {
  const button = `document.querySelector('button[aria-label="Thread actions"]')`;
  // The plugin has read the roster once its own row of the thread is drawn: before that the menu holds none of its acts.
  if (!(await page.until(`${button} !== null && ${visible(testId("oats-status-line"))}`, 40))) return false;
  await page.evaluate(`(() => { const button = ${button}; const at = { bubbles: true, cancelable: true, button: 0, pointerType: "mouse" }; for (const [kind, type] of [[PointerEvent, "pointerdown"], [MouseEvent, "mousedown"], [PointerEvent, "pointerup"], [MouseEvent, "mouseup"], [MouseEvent, "click"]]) button.dispatchEvent(new kind(type, at)); })()`);
  return Boolean(await page.until(`${menuItems}.length > 0`, 10));
}
/** Tab from where the focus is, `times` times: what holds it after each press. */
async function walk(page, times) {
  const order = [];
  for (let step = 0; step < times; step += 1) {
    await page.press("Tab");
    order.push(await page.evaluate(FOCUSED));
  }
  return order;
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const threadPath = (thread) => `/projects/${thread.projectId}/threads/${thread.id}`;

export default [
  {
    stage: "lifecycle",
    name: "Stop, from a row's menu: the dialog before the act, its focus order, in progress, done; a plan that changed; a refusal",
    run: async ({ page, at, viewport, threads, check }) => {
      const lead = threads.get(LEAD);
      const shot = (name) => page.shot(`lifecycle-${viewport.name}-stop-${name}`, { targets: true });
      await page.clock(STOP_AT);
      try {
        // The act in progress can be looked at: the apply answers after a while.
        answers({ "instance stop --apply": { file: "lifecycle/stop-apply.json", sleepMs: 5000 } });
        await page.goto("/");
        check(await openRowMenu(page, viewport, lead.id), `${at} a right click on Redesign ui lead's row opens bb's menu of that thread`);
        const items = await menuTexts(page);
        check(["Stop agent (OATS)", "Restart agent (OATS)", "Retire agent (OATS)"].every((label) => items.includes(label)) && !items.includes("Start agent (OATS)"), `${at} the row's menu of a working agent holds Stop, Restart and Retire, each "(OATS)" beside bb's own, and no Start`, JSON.stringify(items));
        await page.shot(`lifecycle-${viewport.name}-row-menu`);
        check(await pick(page, "Stop agent (OATS)"), `${at} Stop agent (OATS) is pressed in the row's menu`);
        await page.until(phaseIs("ready"), 30);
        const before = await dialog(page);
        check(
          before.title === "Stop Redesign ui lead?" && before.about === "redesign-ui-lead" && /what will happen/i.test(before.body) && before.body.includes("Stops 3 sessions, children first: Redesign ui lead, Desktop mockups developer, Harvest knowledge helper.") && /what is kept/i.test(before.body) && before.body.includes("Nothing is deleted.") && before.body.includes("Include child instances"),
          `${at} Stop opens its dialog and stops nothing: titled with the act and the agent of the kernel's plan, what will happen, what is kept, the choice of its children`,
          JSON.stringify(before),
        );
        check(before.body.includes("Redesign ui lead reports it is in the middle of a task.") && before.body.includes("Observed less than a minute ago"), `${at} it says who is in the middle of a task, and how old the plan is`, before.body);
        check(before.act === "Stop" && before.off === false && before.focus === "oats-confirm-act", `${at} the button is named for the act; a stop deletes nothing, so the focus starts on it`, JSON.stringify(before));
        const order = await walk(page, 4);
        check(same(order, ["oats-switch", "oats-plan-check", "oats-confirm-cancel", "oats-confirm-act"]), `${at} Tab walks the choice, Check again, Cancel, Stop and round again: the focus stays in the dialog`, JSON.stringify(order));
        await shot("before");

        await page.evaluate(click("oats-confirm-act"));
        await page.until(phaseIs("running"), 10);
        const running = await dialog(page);
        check(running.phase === "running" && running.body.includes("Stopping Redesign ui lead. This can take up to a minute.") && running.off === true, `${at} while it runs the dialog says so, and its buttons are off`, JSON.stringify(running));
        await page.press("Escape");
        check((await dialog(page)).phase === "running", `${at} Escape does not dismiss the dialog while the act runs`);
        await shot("running");
        await page.until(phaseIs("done"), 20);
        const done = await dialog(page);
        check(done.body.includes("3 sessions stopped.") && done.body.includes("Redesign ui lead: Stopped") && done.body.includes("Harvest knowledge helper: Was already stopped") && !/what will happen/i.test(done.body) && done.focus === "oats-confirm-close", `${at} the result is said in the dialog, each session on its line, and the focus is on Close`, JSON.stringify(done));
        await shot("done");
        await page.evaluate(click("oats-confirm-close"));
        check(Boolean(await page.until(closed, 10)), `${at} Close closes the dialog`);
        const back = await page.evaluate(`document.activeElement?.getAttribute("data-sidebar-thread-id") ?? ${FOCUSED}`);
        check(viewport.mobile || back === lead.id, `${at} the focus returns to the row the menu was opened on`, back);

        // The plan changed under the confirmation (recorded: the apply of a plan read before a child stopped by itself).
        answers({ "instance stop --apply": { file: "lifecycle/stop-apply-stale.json" } });
        check(await openRowMenu(page, viewport, lead.id), `${at} the row's menu opens again`);
        await pick(page, "Stop agent (OATS)");
        await page.until(phaseIs("ready"), 30);
        await page.evaluate(click("oats-confirm-act"));
        await page.until(`${phaseIs("ready")} && document.querySelector(${JSON.stringify(`${confirm} ${testId("oats-notice")}`)}) !== null`, 20);
        const changed = await dialog(page);
        check(changed.body.includes("Something changed since you opened this. Review it and confirm again.") && /what will happen/i.test(changed.body) && changed.off === false, `${at} a plan that changed comes back for review as it is now, and says so in the Desktop's sentence`, JSON.stringify(changed));
        await shot("changed");

        // A refusal (recorded: the kernel no longer has the agent when the apply arrives).
        answers({ "instance stop --apply": gone("stopApply") });
        await page.evaluate(click("oats-confirm-act"));
        await page.until(phaseIs("failed"), 20);
        const refused = await dialog(page);
        const title = await page.evaluate(textOf(`${confirm} ${testId("oats-result")} h3`));
        check(title === "Redesign ui lead wasn't stopped" && refused.body.indexOf("OATS no longer knows this agent") < refused.body.indexOf("E_SESSION_UNKNOWN") && refused.body.indexOf("E_SESSION_UNKNOWN") > 0, `${at} a refusal leads with a person's words; the kernel's code comes after them`, JSON.stringify({ title, body: refused.body }));
        const details = JSON.parse(await page.evaluate(`JSON.stringify({ open: document.querySelector(${JSON.stringify(testId("oats-act-details"))}).open, text: document.querySelector(${JSON.stringify(testId("oats-act-details"))}).textContent })`));
        check(details.open === false && details.text.includes("no instance"), `${at} the kernel's own message is one press away, under Details`, JSON.stringify(details));
        const after = await walk(page, 4);
        check(refused.focus === "oats-confirm-close" && after.length === 4 && after[0] === "oats-act-review" && after[1].endsWith("Details") && after[2] === "oats-confirm-close" && after[3] === "oats-act-review", `${at} the focus is on Close, and Tab walks Review again, Details, Close and round again`, JSON.stringify({ focus: refused.focus, after }));
        await shot("refused");
        await page.evaluate(click("oats-confirm-close"));
        await page.until(closed, 10);
      } finally {
        answers();
        await page.clock(null);
      }
    },
  },
  {
    stage: "lifecycle",
    name: "Retire, from the thread's own menu: what goes and what stays, the worktree's choice, in progress, done; an agent that is gone; a cleanup that did not finish",
    run: async ({ page, at, viewport, threads, check }) => {
      const helper = threads.get(HELPER);
      const shot = (name) => page.shot(`lifecycle-${viewport.name}-retire-${name}`, { targets: true });
      const open = async () => {
        await page.goto(threadPath(helper));
        return (await openThreadMenu(page)) && (await pick(page, "Retire agent (OATS)"));
      };
      await page.clock(RETIRE_AT);
      try {
        answers({ retire: { file: "lifecycle/retire-apply.json", sleepMs: 5000 } });
        await page.goto(threadPath(helper));
        check(await openThreadMenu(page), `${at} the thread's own menu opens on Weekly digest helper's thread`);
        const items = await menuTexts(page);
        check(["Start agent (OATS)", "Retire agent (OATS)"].every((label) => items.includes(label)) && !items.includes("Stop agent (OATS)") && !items.includes("Restart agent (OATS)"), `${at} the thread's menu of a stopped agent holds Start and Retire, and neither Stop nor Restart`, JSON.stringify(items));
        await page.shot(`lifecycle-${viewport.name}-thread-menu`);
        check(await pick(page, "Retire agent (OATS)"), `${at} Retire agent (OATS) is pressed in the thread's menu`);
        await page.until(phaseIs("ready"), 30);
        const before = await dialog(page);
        check(
          before.title === "Retire Weekly digest helper?" && before.about === "weekly-digest-helper" && before.body.includes("Stops its 1 child instance first: Digest links helper. They are kept, with their homes.") && before.body.includes("Saves a recovery copy of any uncommitted work, then deletes its home folder.") && before.body.includes("Keeps its worktree, moved aside, on branch agents/weekly-digest-helper.") && before.body.includes("Branches and pull requests are not changed."),
          `${at} Retire opens its dialog and retires nothing: what goes and what stays, in the Desktop's sentences, for the agent the kernel's plan names`,
          JSON.stringify(before),
        );
        check(!before.body.includes("SIGTERM") && !before.body.includes("the ADE") && !before.body.includes("/abs/"), `${at} none of the kernel's own notes and no path is pasted into the plan`, before.body);
        check(before.act === "Retire" && before.off === false && before.focus === "oats-confirm-cancel", `${at} Retire is destructive: the focus starts on Cancel`, JSON.stringify(before));
        const order = await walk(page, 4);
        check(same(order, ["oats-confirm-act", "oats-switch", "oats-plan-check", "oats-confirm-cancel"]), `${at} Tab walks Retire, the choice, Check again, Cancel and round again`, JSON.stringify(order));
        await shot("before");

        // Also delete the worktree: what goes and what stays change, and what would be lost is said in words.
        await page.evaluate(`document.querySelector(${JSON.stringify(`${testId("oats-plan-choice")} [role="switch"]`)}).click()`);
        await page.until(`document.querySelector(${JSON.stringify(testId("oats-plan-warning"))}) !== null`, 10);
        const ticked = await dialog(page);
        check(ticked.body.includes("Also delete the worktree On") && ticked.body.includes("Deletes its worktree. Branch agents/weekly-digest-helper stays in the repository.") && !ticked.body.includes("Keeps its worktree") && ticked.body.includes("Deletes the worktree folder, including 1 uncommitted change (a recovery copy is saved first)."), `${at} with "Also delete the worktree" on, the worktree is among what goes, and the dialog says what is lost`, ticked.body);
        await shot("delete-worktree");
        await page.evaluate(`document.querySelector(${JSON.stringify(`${testId("oats-plan-choice")} [role="switch"]`)}).click()`);

        await page.evaluate(click("oats-confirm-act"));
        await page.until(phaseIs("running"), 10);
        const running = await dialog(page);
        check(running.body.includes("Retiring Weekly digest helper. This can take up to a minute while sessions stop.") && running.off === true, `${at} while it runs the dialog says so, and its buttons are off`, JSON.stringify(running));
        await shot("running");
        await page.until(phaseIs("done"), 20);
        const done = await dialog(page);
        check(done.body.includes("Weekly digest helper retired.") && done.body.includes("1 child instance stopped and kept.") && done.body.includes("Home folder deleted.") && done.body.includes("Worktree kept at") && done.body.includes("Recovery copy saved at") && done.focus === "oats-confirm-close", `${at} the result is the Desktop's lines: the children, the home, the worktree, the recovery copy`, JSON.stringify(done));
        await shot("done");
        await page.evaluate(click("oats-confirm-close"));
        await page.until(closed, 10);

        // The agent went after the roster on screen was read (recorded: the plan of an agent the kernel no longer has).
        answers({ "retire --plan": gone("retirePlan") });
        check(await open(), `${at} Retire is asked again from the thread's menu`);
        await page.until(phaseIs("failed"), 30);
        const left = await dialog(page);
        check(left.title === "Retire an agent" && left.body.includes("Weekly digest helper is not in OATS any more") && left.body.includes("Nothing was changed.") && left.act === "" && !left.body.includes("Review again"), `${at} a plan refused for an agent the kernel does not know: the dialog names no agent in its title, says it is not in OATS any more, and offers nothing to confirm or to try again`, JSON.stringify(left));
        await shot("gone");
        await page.evaluate(click("oats-confirm-close"));
        await page.until(closed, 10);

        // The retire ran and its cleanup did not finish (the kernel prints its receipt and exits 1).
        answers({ retire: { file: "lifecycle/retire-incomplete.json", exit: 1 } });
        check(await open(), `${at} Retire is asked once more`);
        await page.until(phaseIs("ready"), 30);
        await page.evaluate(click("oats-confirm-act"));
        await page.until(phaseIs("failed"), 20);
        const partial = await dialog(page);
        check(partial.body.includes("Retirement didn't finish") && partial.body.includes("Home folder kept at") && partial.body.includes("Cleanup didn't finish.") && partial.body.includes("Review again") && partial.body.indexOf("RETIRE_INCOMPLETE") > partial.body.indexOf("Check what was kept before trying again."), `${at} a retire whose cleanup did not finish says what ran and what is kept, the code after the words, and offers Review again`, JSON.stringify(partial));
        await shot("incomplete");
        await page.evaluate(click("oats-confirm-close"));
        await page.until(closed, 10);
      } finally {
        answers();
        await page.clock(null);
      }
    },
  },
  {
    stage: "lifecycle",
    name: "Start, from a row's menu: the agent as the kernel has it now, the harness and the model of the start, its focus order, in progress, started; a refusal",
    run: async ({ page, at, viewport, threads, check }) => {
      const helper = threads.get(HELPER);
      const shot = (name) => page.shot(`lifecycle-${viewport.name}-start-${name}`, { targets: true });
      try {
        answers({ "session start": { file: "lifecycle/start.json", sleepMs: 5000 } });
        await page.goto("/");
        check(await openRowMenu(page, viewport, helper.id), `${at} a right click on Weekly digest helper's row opens bb's menu of that thread`);
        check(await pick(page, "Start agent (OATS)"), `${at} Start agent (OATS) is pressed in the row's menu`);
        await page.until(phaseIs("ready"), 30);
        const before = await dialog(page);
        check(
          before.title === "Start Weekly digest helper" && before.about === "weekly-digest-helper" && before.body.includes("This starts a new conversation using the saved briefing and state.") && before.body.includes("Continue in this instance’s existing home, with its identity, work and notes.") && before.body.includes("Machine") && before.body.includes("Home") && before.body.includes("Ready to start."),
          `${at} Start opens its dialog and starts nothing: titled with the agent as the kernel's roster names it now, what will happen, what is kept, its machine and home`,
          JSON.stringify(before),
        );
        const fields = JSON.parse(await page.evaluate(`JSON.stringify({ harness: [...document.querySelector(${JSON.stringify(testId("oats-start-harness"))}).options].map((option) => option.text), chosen: document.querySelector(${JSON.stringify(testId("oats-start-harness"))}).value, model: document.querySelector(${JSON.stringify(testId("oats-start-model"))}).value })`));
        check(fields.chosen === "" && fields.harness[0].startsWith("Keep the recorded harness") && same(fields.harness.slice(1), ["Claude Code", "pi"]) && fields.model === "", `${at} the harness starts on "Keep the recorded harness", with the ones the provider declares after it; the model is blank`, JSON.stringify(fields));
        check(before.act === "Start" && before.off === false && before.focus === "oats-start-harness", `${at} the focus starts on the form's first field`, JSON.stringify(before));
        const order = await walk(page, 5);
        check(same(order, ["oats-start-model", "oats-start-refresh", "oats-confirm-cancel", "oats-confirm-act", "oats-start-harness"]), `${at} Tab walks the model, Refresh status, Cancel, Start and round again`, JSON.stringify(order));
        await shot("before");

        await page.evaluate(click("oats-confirm-act"));
        await page.until(phaseIs("running"), 10);
        const running = await dialog(page);
        check(running.body.includes("Starting…") && running.off === true, `${at} while it starts the dialog says so, and its buttons are off`, JSON.stringify(running));
        await shot("running");
        await page.until(phaseIs("done"), 20);
        const done = await dialog(page);
        check(done.body.includes("Weekly digest helper started.") && done.focus === "oats-confirm-close", `${at} the dialog says that it started, with the focus on Close`, JSON.stringify(done));
        await shot("done");
        await page.evaluate(click("oats-confirm-close"));
        await page.until(closed, 10);

        // A refusal (recorded: a start on a home that was retired).
        answers({ "session start": gone("start") });
        await page.goto("/");
        check(await openRowMenu(page, viewport, helper.id), `${at} the row's menu opens again`);
        await pick(page, "Start agent (OATS)");
        await page.until(phaseIs("ready"), 30);
        await page.evaluate(click("oats-confirm-act"));
        await page.until(phaseIs("failed"), 20);
        const refused = await dialog(page);
        check(refused.body.includes("OATS refused to start Weekly digest helper") && refused.body.indexOf("E_WORK_INSPECTION_FAILED") > refused.body.indexOf("OATS refused to start") && refused.body.includes("Refresh status") && !refused.body.includes("not in OATS any more"), `${at} a refused start leads with a person's words, the kernel's code after them, and Refresh status before another try; it does not call the agent gone`, JSON.stringify(refused));
        await shot("refused");
        await page.evaluate(click("oats-confirm-close"));
        await page.until(closed, 10);
      } finally {
        answers();
      }
    },
  },
  {
    stage: "lifecycle-running",
    name: "Restart, from the thread's own menu: a dialog first, with the Desktop's warning; restarted",
    run: async ({ page, at, viewport, threads, check }) => {
      const helper = threads.get(HELPER);
      const shot = (name) => page.shot(`lifecycle-${viewport.name}-restart-${name}`, { targets: true });
      try {
        answers({ "session restart": { file: "lifecycle/restart.json", sleepMs: 5000 } });
        await page.goto(threadPath(helper));
        check(await openThreadMenu(page), `${at} the thread's own menu opens on a running agent's thread`);
        const items = await menuTexts(page);
        check(items.includes("Restart agent (OATS)") && items.includes("Stop agent (OATS)") && !items.includes("Start agent (OATS)"), `${at} it holds Restart and Stop, and no Start`, JSON.stringify(items));
        check(await pick(page, "Restart agent (OATS)"), `${at} Restart agent (OATS) is pressed in the thread's menu`);
        await page.until(phaseIs("ready"), 30);
        const before = await dialog(page);
        check(before.title === "Restart Weekly digest helper" && before.body.includes("Restart stops the current harness after checking the new configuration. Save any in-progress work before continuing.") && before.act === "Restart" && before.off === false, `${at} Restart opens its dialog and restarts nothing: it says that the current harness is stopped first`, JSON.stringify(before));
        await shot("before");
        await page.evaluate(click("oats-confirm-act"));
        await page.until(phaseIs("running"), 10);
        check((await dialog(page)).body.includes("Checking configuration and restarting…"), `${at} while it restarts the dialog says so`);
        await shot("running");
        await page.until(phaseIs("done"), 20);
        const done = await dialog(page);
        check(done.body.includes("Weekly digest helper restarted."), `${at} the dialog says that it restarted`, JSON.stringify(done));
        await shot("done");
        await page.evaluate(click("oats-confirm-close"));
        await page.until(closed, 10);
      } finally {
        answers();
      }
    },
  },
  {
    stage: "detached",
    name: "Retire, from a soul's page, of an agent whose thread bb does not have: the same dialog",
    run: async ({ page, at, viewport, check }) => {
      await page.goto("/plugins/oats/souls/oats-expert");
      await page.until(visible(testId("oats-detached-retire")), 30);
      await page.evaluate(click("oats-detached-retire"));
      await page.until(phaseIs("ready"), 30);
      const before = await dialog(page);
      // The image proves what its name says: the dialog is about the agent whose Retire was pressed, and so is the plan in it.
      check(before.title === "Retire Weekly digest helper?" && before.about === "weekly-digest-helper" && before.body.includes("deletes its home folder") && before.focus === "oats-confirm-cancel", `${at} Retire of an agent with no bb thread opens the dialog of the kernel's plan for it, the focus on Cancel`, JSON.stringify(before));
      await page.shot(`a16-${viewport.name}-plan`); // (the page behind the dialog is the soul's: its controls are its scenes' to measure)
      await page.evaluate(click("oats-confirm-cancel"));
      check(Boolean(await page.until(closed, 10)), `${at} Cancel closes the dialog`);
    },
  },
];
