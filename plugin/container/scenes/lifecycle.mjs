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
/** The roster the fake answers, without the agents named: what the kernel answers once a retire has removed one. */
const without = (instances) => {
  const status = JSON.parse(tools.statusWithRealIds(tools.threads, changes));
  for (const group of status.agents) group.instances = group.instances.filter((row) => !instances.includes(row.instance));
  return JSON.stringify(status);
};
/**
 * A recorded start or restart answer, naming a thread THIS run's bb has in place of the recorded
 * one (the roster's rows get the run's ids the same way: live-ui.mjs `statusWithRealIds`): the
 * thread the dialog then opens is one bb can show.
 */
const startedOn = (name, thread) => {
  const answer = recorded(name);
  Object.assign(answer.result.session.endpoint, { threadId: thread.id, projectId: thread.projectId });
  return JSON.stringify(answer);
};
/** The fake answers the roster with the run's thread ids, and what the scene asks of a verb (the rest is each feature's recorded default). */
const answers = (verbs = {}, status = tools.statusWithRealIds(tools.threads, changes)) => tools.fake({ status: { stdout: status }, ...verbs });
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
/**
 * bb's menu has come in whole (a menu fades in at 1280; a sheet slides up at 390): nothing that holds
 * its first entry is less than opaque, and the entry is where it was at the last look. An image
 * taken before that shows the page through the menu, or the menu half way.
 */
const menuSettled = `(() => { const item = document.querySelector('[role="menuitem"]'); if (!item) return false; for (let node = item; node && node !== document.body; node = node.parentElement) if (Number(getComputedStyle(node).opacity) < 1) return false; const box = item.getBoundingClientRect(); const at = [Math.round(box.left), Math.round(box.top), Math.round(box.width)].join(","); const same = window.__oatsMenuAt === at; window.__oatsMenuAt = at; return same; })()`;
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
  return Boolean(await page.until(`${menuItems}.length > 0 && ${menuSettled}`, 10));
}
/** bb's own menu of the thread in view: its "Thread actions" button. */
export async function openThreadMenu(page) {
  const button = `document.querySelector('button[aria-label="Thread actions"]')`;
  // The plugin has read the roster once its own row of the thread is drawn: before that the menu holds none of its acts.
  if (!(await page.until(`${button} !== null && ${visible(testId("oats-status-line"))}`, 40))) return false;
  await page.evaluate(`(() => { const button = ${button}; const at = { bubbles: true, cancelable: true, button: 0, pointerType: "mouse" }; for (const [kind, type] of [[PointerEvent, "pointerdown"], [MouseEvent, "mousedown"], [PointerEvent, "pointerup"], [MouseEvent, "mouseup"], [MouseEvent, "click"]]) button.dispatchEvent(new kind(type, at)); })()`);
  return Boolean(await page.until(`${menuItems}.length > 0 && ${menuSettled}`, 10));
}
/**
 * Nothing a person needs is cut without a sign (the first UX read of the dialogs, S5 and T5): what
 * the act does (the first sentence of "What will happen", or the result) and the dialog's buttons
 * are in view together; or the dialog says that there is more above or below.
 */
const whole = (key) => `(() => {
  const body = document.querySelector(${JSON.stringify(testId("oats-modal-body"))});
  if (!body) return JSON.stringify({ ok: false, why: "no dialog" });
  const frame = body.getBoundingClientRect();
  const inBody = (node) => { const box = node.getBoundingClientRect(); return box.height > 0 && box.top >= frame.top - 1 && box.bottom <= frame.bottom + 1; };
  const onScreen = (node) => { const box = node.getBoundingClientRect(); return box.height > 0 && box.top >= 0 && box.bottom <= innerHeight; };
  // What matters now: what the scene names; else, while the act runs, the line that says so; once it has an answer, the result; before, the notice or the first sentence of the plan.
  const phase = document.querySelector(${JSON.stringify(testId("oats-confirm"))})?.getAttribute("data-phase");
  const first = body.querySelector(${JSON.stringify(key)} ?? (phase === "running" ? ${JSON.stringify(testId("oats-confirm-leave-line"))} : phase === "done" || phase === "failed" ? ${JSON.stringify(`${testId("oats-result")} h3`)} : ${JSON.stringify(`${testId("oats-notice")}, li, ${testId("oats-loading")}`)}));
  const buttons = [...document.querySelectorAll(${JSON.stringify(`${testId("oats-confirm-cancel")}, ${testId("oats-confirm-leave")}, ${testId("oats-confirm-act")}, ${testId("oats-confirm-close")}`)})];
  const says = [${JSON.stringify(testId("oats-modal-above"))}, ${JSON.stringify(testId("oats-modal-below"))}].map((id) => document.querySelector(id)?.innerText ?? null);
  const above = body.scrollTop > 1;
  const below = body.scrollHeight - body.clientHeight - body.scrollTop > 1;
  return JSON.stringify({ ok: first !== null && inBody(first) && buttons.length > 0 && buttons.every(onScreen) && (!above || says[0] !== null) && (!below || says[1] !== null), first: first?.innerText.slice(0, 60) ?? null, above, below, says });
})()`;
/** The image of a dialog's state, taken once the dialog is whole on screen (WHOLE) and its controls are high enough. */
async function dialogShot({ page, at, viewport, check }, verb, name, key = null) {
  // (What the dialog says of what is out of sight is drawn a moment after its content changed: it is waited for, briefly.)
  await page.until(`JSON.parse(${whole(key)}).ok`, 3);
  const seen = JSON.parse(await page.evaluate(whole(key)));
  check(seen.ok, `${at} ${verb}-${name}: what the act does and the dialog's buttons are on screen together, and where the dialog holds more than fits it says so`, JSON.stringify(seen));
  await page.shot(`lifecycle-${viewport.name}-${verb}-${name}`, { targets: true });
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
      const shot = (name) => dialogShot({ page, at, viewport, check }, "stop", name);
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
        check(before.act === "Stop" && before.off === false && before.focus === "oats-confirm-cancel", `${at} the button is named for the act; the focus STARTS on Cancel`, JSON.stringify(before));
        check(before.body.includes("A message sent in its thread starts it again without OATS. To talk to it again, use Start."), `${at} it says what a stop means for the agent's thread`, before.body);
        await shot("before");
        const order = await walk(page, 4);
        check(same(order, ["oats-confirm-act", "oats-switch", "oats-plan-check", "oats-confirm-cancel"]), `${at} Tab walks Stop, the choice, Check again, Cancel and round again: the focus stays in the dialog`, JSON.stringify(order));

        await page.evaluate(click("oats-confirm-act"));
        await page.until(phaseIs("running"), 10);
        const running = await dialog(page);
        check(running.phase === "running" && running.body.includes("Stopping Redesign ui lead. This can take up to a minute.") && running.off === true, `${at} while it runs the dialog says so, and the act cannot be asked again`, JSON.stringify(running));
        const leave = JSON.parse(await page.evaluate(`JSON.stringify({ line: ${textOf(testId("oats-confirm-leave-line"))}, close: ${textOf(testId("oats-confirm-leave"))}, off: document.querySelector(${JSON.stringify(testId("oats-confirm-leave"))})?.disabled ?? null })`));
        check(leave.line === "You can close this; stopping continues." && leave.close === "Close" && leave.off === false, `${at} while it runs the dialog says that it can be closed and that stopping continues, with Close on`, JSON.stringify(leave));
        await shot("running");
        await page.until(phaseIs("done"), 20);
        const done = await dialog(page);
        check(done.body.includes("3 sessions stopped.") && done.body.includes("Redesign ui lead: Stopped") && done.body.includes("Harvest knowledge helper: Was already stopped") && !/what will happen/i.test(done.body) && done.focus === "oats-confirm-close", `${at} the result is said in the dialog, each session on its line, and the focus is on Close`, JSON.stringify(done));
        check(done.body.includes("A message sent in its thread starts it again without OATS. To talk to it again, use Start."), `${at} the result says again what a stop means for the thread`, done.body);
        await shot("done");
        await page.evaluate(click("oats-confirm-close"));
        check(Boolean(await page.until(closed, 10)), `${at} Close closes the dialog`);
        const back = await page.evaluate(`document.activeElement?.getAttribute("data-sidebar-thread-id") ?? ${FOCUSED}`);
        check(viewport.mobile || back === lead.id, `${at} the focus returns to the row the menu was opened on`, back);

        // The plan changed under the confirmation (recorded: the apply of a plan read before a child stopped by
        // itself is refused E_PLAN_STALE, and its answer carries the plan as it is now: the fake answers that
        // plan to the read that follows).
        const stale = recorded("stop-apply-stale.json");
        answers({ "instance stop --apply": { file: "lifecycle/stop-apply-stale.json" } });
        check(await openRowMenu(page, viewport, lead.id), `${at} the row's menu opens again`);
        await pick(page, "Stop agent (OATS)");
        await page.until(phaseIs("ready"), 30);
        answers({ "instance stop --apply": { file: "lifecycle/stop-apply-stale.json" }, "instance stop --plan": { stdout: JSON.stringify({ schemaVersion: 1, ok: true, result: stale.error.details.plan }) } });
        await page.evaluate(click("oats-confirm-act"));
        await page.until(`${phaseIs("ready")} && document.querySelector(${JSON.stringify(`${confirm} ${testId("oats-notice")}`)}) !== null`, 20);
        const changed = await dialog(page);
        const notice = JSON.parse(await page.evaluate(`(() => { const notice = document.querySelector(${JSON.stringify(`${confirm} ${testId("oats-notice")}`)}); const box = notice.getBoundingClientRect(); return JSON.stringify({ text: notice.innerText.replace(/\\s+/g, " ").trim(), first: notice.parentElement.firstElementChild === notice, onScreen: box.top >= 0 && box.bottom <= innerHeight }); })()`));
        check(notice.first && notice.onScreen && notice.text.startsWith("Something changed since you opened this") && notice.text.includes("Harvest knowledge helper: its session was running, and is now not running.") && notice.text.includes("Review again"), `${at} a plan that changed comes back for review: the notice is the first thing in the dialog, on screen, and says WHAT changed, with Review again`, JSON.stringify(notice));
        check(changed.off === true && changed.focus === "oats-confirm-cancel" && changed.body.includes("Read what changed, then press Review again."), `${at} the changed plan is NOT armed: Stop is off with the reason, and the focus is on Cancel`, JSON.stringify(changed));
        await shot("changed");
        await page.evaluate(click("oats-plan-review"));
        const reviewed = await page.until(`${phaseIs("ready")} && document.querySelector(${JSON.stringify(`${confirm} ${testId("oats-notice")}`)}) === null && document.querySelector(${JSON.stringify(testId("oats-confirm-act"))}).disabled === false`, 20);
        check(Boolean(reviewed), `${at} Review again reads the plan once more, and only then can it be confirmed`);

        // A refusal (recorded: the kernel no longer has the agent when the apply arrives).
        answers({ "instance stop --apply": gone("stopApply"), "instance stop --plan": { stdout: JSON.stringify({ schemaVersion: 1, ok: true, result: stale.error.details.plan }) } });
        await page.evaluate(click("oats-confirm-act"));
        await page.until(phaseIs("failed"), 20);
        const refused = await dialog(page);
        const title = await page.evaluate(textOf(`${confirm} ${testId("oats-result")} h3`));
        check(title === "Redesign ui lead wasn't stopped" && refused.body.indexOf("OATS no longer knows this agent") < refused.body.indexOf("E_SESSION_UNKNOWN") && refused.body.indexOf("E_SESSION_UNKNOWN") > 0, `${at} a refusal leads with a person's words; the kernel's code comes after them`, JSON.stringify({ title, body: refused.body }));
        const details = JSON.parse(await page.evaluate(`JSON.stringify({ open: document.querySelector(${JSON.stringify(testId("oats-act-details"))}).open, text: document.querySelector(${JSON.stringify(testId("oats-act-details"))}).textContent })`));
        check(details.open === false && details.text.includes("no instance"), `${at} the kernel's own message is one press away, under Details`, JSON.stringify(details));
        await shot("refused");
        const after = await walk(page, 4);
        check(refused.focus === "oats-confirm-close" && after.length === 4 && after[0] === "oats-act-review" && after[1].endsWith("Details") && after[2] === "oats-confirm-close" && after[3] === "oats-act-review", `${at} the focus is on Close, and Tab walks Review again, Details, Close and round again`, JSON.stringify({ focus: refused.focus, after }));
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
    name: "Stop, the states between the menu and the result: the plan being read, a plan that cannot be read, a result that is not confirmed and is asked again, a dialog that is left while the act runs",
    run: async ({ page, at, viewport, threads, check }) => {
      const lead = threads.get(LEAD);
      const shot = (name) => dialogShot({ page, at, viewport, check }, "stop", name);
      const open = async () => {
        await page.goto("/");
        check(await openRowMenu(page, viewport, lead.id), `${at} a right click on Redesign ui lead's row opens bb's menu of that thread`);
        check(await pick(page, "Stop agent (OATS)"), `${at} Stop agent (OATS) is pressed in the row's menu`);
      };
      await page.clock(STOP_AT);
      try {
        // The plan being read: the kernel takes a while to answer it.
        answers({ "instance stop --plan": { file: "lifecycle/stop-plan.json", sleepMs: 5000 } });
        await open();
        await page.until(phaseIs("reading"), 10);
        const reading = await dialog(page);
        check(reading.phase === "reading" && reading.title === "Stop an agent" && reading.body.includes("Checking what stopping Redesign ui lead will do…") && reading.off === true, `${at} while the plan is read the dialog says what it checks, names no agent in its title yet, and cannot be confirmed`, JSON.stringify(reading));
        await shot("reading");
        await page.until(phaseIs("ready"), 30);
        await page.evaluate(click("oats-confirm-cancel"));
        await page.until(closed, 10);

        // A plan that cannot be read: oats ends with no answer at all.
        answers({ "instance stop --plan": { stdout: "", stderr: "oats: internal error", exit: 1 } });
        await open();
        await page.until(phaseIs("failed"), 30);
        const unread = await dialog(page);
        check(
          unread.body.includes("Couldn't check what stopping Redesign ui lead will do") && unread.body.includes("Nothing was changed.") && unread.body.includes("Review again") && !/what will happen/i.test(unread.body),
          `${at} a plan that cannot be read says so in a person's words, that nothing was changed, and offers to read it again; no plan is drawn`,
          JSON.stringify(unread),
        );
        await shot("unreadable");
        // Read again, and the kernel answers: the plan is there.
        answers();
        await page.evaluate(click("oats-act-review"));
        check(Boolean(await page.until(phaseIs("ready"), 30)), `${at} Review again reads the plan, and it can be confirmed`);

        // A result that is not confirmed: the apply's answer is lost (oats prints nothing the plugin can read).
        answers({ "instance stop --apply": { stdout: "", exit: 0 } });
        await page.evaluate(click("oats-confirm-act"));
        await page.until(`${phaseIs("done")} && document.querySelector(${JSON.stringify(`${confirm} ${testId("oats-result")}`)})?.getAttribute("data-tone") === "unknown"`, 30);
        const lost = await dialog(page);
        check(
          lost.body.includes("Result not confirmed") && lost.body.includes("OATS didn't confirm the result. Check again before assuming nothing happened.") && lost.body.includes("Check again") && !lost.body.includes("wasn't stopped"),
          `${at} an apply whose answer is lost is told as not confirmed, never as stopped and never as not stopped, with Check again`,
          JSON.stringify(lost),
        );
        await shot("not-confirmed");
        // Check again asks for the answer to the same apply: the kernel has it.
        answers({ "instance stop --apply": { file: "lifecycle/stop-apply.json" } });
        await page.evaluate(click("oats-act-check"));
        await page.until(`${phaseIs("done")} && document.querySelector(${JSON.stringify(`${confirm} ${testId("oats-result")}`)})?.getAttribute("data-tone") === "done"`, 30);
        check((await dialog(page)).body.includes("3 sessions stopped."), `${at} Check again reads the result of that apply: stopped`);
        await page.evaluate(click("oats-confirm-close"));
        await page.until(closed, 10);

        // A dialog that is left while the act runs: the result comes through bb's toaster.
        answers({ "instance stop --apply": { file: "lifecycle/stop-apply.json", sleepMs: 4000 } });
        await open();
        await page.until(phaseIs("ready"), 30);
        await page.evaluate(click("oats-confirm-act"));
        await page.until(phaseIs("running"), 10);
        await page.evaluate(click("oats-confirm-leave"));
        check(Boolean(await page.until(closed, 10)), `${at} Close leaves the dialog while the stop runs`);
        const told = await page.until(`(() => { const toast = [...document.querySelectorAll("[data-sonner-toast]")].find((each) => each.innerText.includes("3 sessions stopped.")); return toast ? toast.innerText.replace(/\\s+/g, " ").trim() : null; })()`, 30);
        check(Boolean(told), `${at} the result of a stop whose dialog was left is told through bb's toaster`, String(told));
        await page.shot(`lifecycle-${viewport.name}-stop-left-toast`);
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
      const shot = (name, key) => dialogShot({ page, at, viewport, check }, "retire", name, key);
      const open = async () => {
        await page.goto(threadPath(helper));
        return (await openThreadMenu(page)) && (await pick(page, "Retire agent (OATS)"));
      };
      await page.clock(RETIRE_AT);
      try {
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
        check(before.body.includes("This cannot be undone. Its conversation stays readable in bb, archived."), `${at} it says that a retire cannot be undone, and that its conversation stays readable in bb, archived`, before.body);
        await shot("before");
        const order = await walk(page, 4);
        check(same(order, ["oats-confirm-act", "oats-switch", "oats-plan-check", "oats-confirm-cancel"]), `${at} Tab walks Retire, the choice, Check again, Cancel and round again`, JSON.stringify(order));

        // Also delete the worktree: what goes and what stays change, and what would be lost is said in words.
        await page.evaluate(`document.querySelector(${JSON.stringify(`${testId("oats-plan-choice")} [role="switch"]`)}).click()`);
        await page.until(`document.querySelector(${JSON.stringify(testId("oats-plan-warning"))}) !== null`, 10);
        const ticked = await dialog(page);
        check(ticked.body.includes("Also delete the worktree On") && ticked.body.includes("Deletes its worktree. Branch agents/weekly-digest-helper stays in the repository.") && !ticked.body.includes("Keeps its worktree") && ticked.body.includes("Deletes the worktree folder, including 1 uncommitted change (a recovery copy is saved first)."), `${at} with "Also delete the worktree" on, the worktree is among what goes, and the dialog says what is lost`, ticked.body);
        await shot("delete-worktree", testId("oats-plan-warning")); // what would be lost is what this image is of
        await page.evaluate(`document.querySelector(${JSON.stringify(`${testId("oats-plan-choice")} [role="switch"]`)}).click()`);

        // From here the kernel answers what it answers once the agent is retired: its receipt, and a roster without it.
        answers({ retire: { file: "lifecycle/retire-apply.json", sleepMs: 5000 } }, without(["weekly-digest-helper"]));
        await page.evaluate(click("oats-confirm-act"));
        await page.until(phaseIs("running"), 10);
        const running = await dialog(page);
        check(running.body.includes("Retiring Weekly digest helper. This can take up to a minute while sessions stop.") && running.off === true, `${at} while it runs the dialog says so, and the act cannot be asked again`, JSON.stringify(running));
        await shot("running");
        await page.until(phaseIs("done"), 20);
        const done = await dialog(page);
        check(done.body.includes("Weekly digest helper retired.") && done.body.includes("1 child instance stopped and kept.") && done.body.includes("Home folder deleted.") && done.body.includes("Worktree kept, at:") && done.body.includes("Recovery copy saved at") && done.body.includes("Its conversation stays readable in bb, archived.") && done.focus === "oats-confirm-close", `${at} the result is the Desktop's lines: the children, the home, the worktree, the recovery copy; and the thread`, JSON.stringify(done));
        // Behind the result the retired agent is gone from the roster, and its thread offers no Start (the real run shows the same).
        const behind = await page.until(`document.querySelector(${JSON.stringify(testId("oats-status-act"))}) === null && document.querySelector('${testId("oats-agent-row")}[data-sidebar-thread-id="${helper.id}"]') === null`, 20);
        check(Boolean(behind), `${at} behind the result the agent is in no row, and its thread offers no Start`);
        await shot("done");
        await page.evaluate(click("oats-confirm-close"));
        await page.until(closed, 10);

        // The agent went after the roster on screen was read (recorded: the plan of an agent the kernel no longer has).
        answers({ "retire --plan": gone("retirePlan") });
        await tools.untilSnapshot((snapshot) => snapshot.ok === true && snapshot.agents.some((agent) => agent.instance === "weekly-digest-helper"));
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
        check(partial.body.includes("Retirement didn't finish") && partial.body.includes("Home folder kept, at:") && partial.body.includes("Cleanup didn't finish.") && partial.body.includes("Its home was kept. Its thread can be unarchived in bb, and a message then starts it again with no OATS around it.") && partial.body.includes("Review again") && partial.body.indexOf("RETIRE_INCOMPLETE") > partial.body.indexOf("Check what was kept before trying again."), `${at} a retire whose cleanup did not finish says what ran and what is kept, the code after the words, and offers Review again`, JSON.stringify(partial));
        const warned = JSON.parse(await page.evaluate(`(() => { const warning = document.querySelector(${JSON.stringify(`${testId("oats-act-warning")} ${testId("oats-notice")}`)}); const result = document.querySelector(${JSON.stringify(`${confirm} ${testId("oats-result")}`)}); return JSON.stringify({ tone: warning?.getAttribute("data-tone") ?? null, first: Boolean(warning && result && (warning.compareDocumentPosition(result) & Node.DOCUMENT_POSITION_FOLLOWING)), details: warning?.querySelector("details")?.open ?? null }); })()`));
        check(warned.tone === "warning" && warned.first && warned.details === false, `${at} that the home was kept is a warning of its own, before the steps, with the rest one press away`, JSON.stringify(warned));
        await shot("incomplete", `${testId("oats-act-warning")} h3`); // the warning is what this image is of
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
      const shot = (name) => dialogShot({ page, at, viewport, check }, "start", name);
      try {
        await page.goto("/");
        check(await openRowMenu(page, viewport, helper.id), `${at} a right click on Weekly digest helper's row opens bb's menu of that thread`);
        check(await pick(page, "Start agent (OATS)"), `${at} Start agent (OATS) is pressed in the row's menu`);
        await page.until(phaseIs("ready"), 30);
        const before = await dialog(page);
        check(
          before.title === "Start Weekly digest helper" && before.about === "weekly-digest-helper" && before.body.includes("Starts a new conversation. The current one stays readable in bb, archived.") && !before.body.includes("carry on its conversation") && before.body.includes("Continue in this instance’s existing home, with its identity, work and notes.") && before.body.includes("Machine") && before.body.includes("Home") && before.body.includes("Ready to start."),
          `${at} Start opens its dialog and starts nothing: titled with the agent as the kernel's roster names it now, what will happen, what is kept, its machine and home`,
          JSON.stringify(before),
        );
        const fields = JSON.parse(await page.evaluate(`JSON.stringify({ harness: [...document.querySelector(${JSON.stringify(testId("oats-start-harness"))}).options].map((option) => option.text), chosen: document.querySelector(${JSON.stringify(testId("oats-start-harness"))}).value, model: document.querySelector(${JSON.stringify(testId("oats-start-model"))}).value })`));
        check(fields.chosen === "" && fields.harness[0].startsWith("Keep the recorded harness") && same(fields.harness.slice(1), ["Claude Code", "pi"]) && fields.model === "", `${at} the harness starts on "Keep the recorded harness", with the ones the provider declares after it; the model is blank`, JSON.stringify(fields));
        check(before.act === "Start" && before.off === false && before.focus === "oats-start-harness", `${at} the focus starts on the form's first field`, JSON.stringify(before));
        check(before.body.includes("Runs in bb's full mode: no sandbox."), `${at} it says that the agent runs in bb's full mode, with no sandbox`, before.body);
        await shot("before");
        const order = await walk(page, 5);
        check(same(order, ["oats-start-model", "oats-start-refresh", "oats-confirm-cancel", "oats-confirm-act", "oats-start-harness"]), `${at} Tab walks the model, Refresh status, Cancel, Start and round again`, JSON.stringify(order));

        // From here the kernel answers a start as it does: its recorded answer, on a thread this run's bb has, and a roster in which the agent runs.
        changes = { "weekly-digest-helper": { running: true, runtimeState: "unknown", sessionEnd: null } };
        answers({ "session start": { stdout: startedOn("start.json", helper), sleepMs: 5000 } });

        await page.evaluate(click("oats-confirm-act"));
        await page.until(phaseIs("running"), 10);
        const running = await dialog(page);
        check(running.body.includes("Starting…") && running.off === true, `${at} while it starts the dialog says so, and the act cannot be asked again`, JSON.stringify(running));
        await shot("running");
        await page.until(phaseIs("done"), 20);
        const done = await dialog(page);
        check(done.body.includes("Weekly digest helper started.") && done.focus === "oats-confirm-close", `${at} the dialog says that it started, with the focus on Close`, JSON.stringify(done));
        // Behind the result the agent's thread is open and loaded, and says that it works.
        const opened = await page.until(`location.pathname.endsWith("/threads/${helper.id}") && ${textOf(testId("oats-status-line"))}.startsWith("Working")`, 30);
        check(Boolean(opened), `${at} behind the result the agent's thread is open, and its row says Working`, await page.evaluate(`location.pathname + " | " + ${textOf(testId("oats-status-line"))}`));
        await shot("done");
        await page.evaluate(click("oats-confirm-close"));
        await page.until(closed, 10);

        // A refusal (recorded: a start on a home that was retired).
        changes = {};
        answers({ "session start": gone("start") });
        await tools.untilSnapshot((snapshot) => snapshot.ok === true && snapshot.agents.some((agent) => agent.instance === "weekly-digest-helper" && agent.running === false));
        await page.goto("/");
        check(await openRowMenu(page, viewport, helper.id), `${at} the row's menu opens again`);
        await pick(page, "Start agent (OATS)");
        await page.until(phaseIs("ready"), 30);
        await page.evaluate(click("oats-confirm-act"));
        await page.until(phaseIs("failed"), 20);
        const refused = await dialog(page);
        check(refused.body.includes("OATS refused to start Weekly digest helper") && refused.body.includes("OATS says: directory instance home was removed or exchanged") && refused.body.indexOf("E_WORK_INSPECTION_FAILED") > refused.body.indexOf("OATS says:") && refused.body.includes("Refresh status") && !refused.body.includes("not in OATS any more"), `${at} a refused start leads with a person's words and says WHY in the kernel's own line, under its name; the code comes after, and Refresh status before another try; it does not call the agent gone`, JSON.stringify(refused));
        await shot("refused");
        await page.evaluate(click("oats-confirm-close"));
        await page.until(closed, 10);
      } finally {
        changes = {};
        answers();
      }
    },
  },
  {
    stage: "lifecycle",
    name: "Start, of an agent whose session was lost (not stopped by an operator): first, that a message in its thread carries its conversation on, with the way there",
    run: async ({ page, at, viewport, threads, check }) => {
      const helper = threads.get(HELPER);
      const shot = (name) => dialogShot({ page, at, viewport, check }, "start", name);
      try {
        // The kernel's row of a session lost with the host (lib/instance-listing.mjs): not running, stopped, and not by an operator.
        changes = { "weekly-digest-helper": { running: false, runtimeState: "stopped", sessionEnd: "lost" } };
        answers();
        await page.goto("/");
        check(await openRowMenu(page, viewport, helper.id), `${at} a right click on Weekly digest helper's row opens bb's menu of that thread`);
        check(await pick(page, "Start agent (OATS)"), `${at} Start agent (OATS) is pressed in the row's menu`);
        check(Boolean(await page.until(`${phaseIs("ready")} && document.querySelector(${JSON.stringify(testId("oats-start-thread"))}) !== null`, 30)), `${at} the Start dialog of an agent whose session was lost points at its thread`);
        const said = JSON.parse(
          await page.evaluate(
            `(() => { const confirm = document.querySelector(${JSON.stringify(confirm)}); const notice = confirm.querySelector(${JSON.stringify(testId("oats-notice"))}); return JSON.stringify({ first: confirm.firstElementChild === notice, title: notice?.querySelector("h3")?.innerText ?? null, open: document.querySelector(${JSON.stringify(testId("oats-start-thread"))})?.innerText ?? null, next: notice?.nextElementSibling?.innerText ?? "" }); })()`,
          ),
        );
        check(
          said.first && said.title === "To carry on its conversation, send it a message in its thread instead." && said.open === "Open Weekly digest helper" && said.next.includes("Starts a new conversation. The current one stays readable in bb, archived."),
          `${at} the dialog says FIRST to send a message in its thread to carry on, with Open Weekly digest helper, and then that a start begins a new conversation`,
          JSON.stringify(said),
        );
        const before = await dialog(page);
        check(before.act === "Start" && before.off === false, `${at} Start stays possible`, JSON.stringify(before));
        await shot("cut-off");
        await page.evaluate(click("oats-start-thread"));
        check(Boolean(await page.until(`${closed} && location.pathname.endsWith("/threads/${helper.id}")`, 15)), `${at} Open Weekly digest helper closes the dialog on the agent's thread, and starts nothing`);
      } finally {
        // The stage's own roster again, and READ by the plugin's server: the dialog's check made the server read the lost row.
        changes = {};
        answers();
        await tools.untilSnapshot((snapshot) => snapshot.ok === true && snapshot.agents.some((agent) => agent.instance === "weekly-digest-helper" && agent.running === false));
      }
    },
  },
  {
    stage: "lifecycle",
    name: "A retire that was accepted and finishes in the background; a start whose thread is not ready yet",
    run: async ({ page, at, viewport, threads, check }) => {
      const helper = threads.get(HELPER);
      try {
        // The kernel accepts a retire it will finish in the background (`deferred`): the answer as its source
        // shapes it (lib/core.mjs; no run of ours has met one to record).
        answers({ retire: { stdout: JSON.stringify({ retired: "weekly-digest-helper", deferred: true, planRevision: "ef5028f1e6cb517560247307", idempotencyKey: "retire-2b9d4e6f8a1c", replayed: false }) } });
        await page.clock(RETIRE_AT);
        await page.goto(threadPath(helper));
        check(await openThreadMenu(page), `${at} the thread's own menu opens on Weekly digest helper's thread`);
        check(await pick(page, "Retire agent (OATS)"), `${at} Retire agent (OATS) is pressed in the thread's menu`);
        await page.until(phaseIs("ready"), 30);
        await page.evaluate(click("oats-confirm-act"));
        await page.until(`${phaseIs("done")} && document.querySelector(${JSON.stringify(`${confirm} ${testId("oats-result")}`)})?.getAttribute("data-tone") === "unknown"`, 30);
        const accepted = await dialog(page);
        check(
          accepted.body.includes("Retirement accepted") && accepted.body.includes("Retirement was accepted and will finish in the background.") && accepted.body.includes("Its row in the sidebar shows the result.") && !accepted.body.includes("retired."),
          `${at} a retire the kernel accepted and finishes later is told as accepted, never as done`,
          JSON.stringify(accepted),
        );
        await dialogShot({ page, at, viewport, check }, "retire", "accepted");
        await page.evaluate(click("oats-confirm-close"));
        await page.until(closed, 10);
        await page.clock(null);

        // A start the kernel answered, naming no thread, of an agent whose row names none either:
        // it started, and there is no thread to open yet.
        answers();
        await page.goto("/");
        check(await openRowMenu(page, viewport, helper.id), `${at} a right click on Weekly digest helper's row opens bb's menu of that thread`);
        check(await pick(page, "Start agent (OATS)"), `${at} Start agent (OATS) is pressed in the row's menu`);
        await page.until(phaseIs("ready"), 30);
        const started = recorded("start.json");
        delete started.result.session.endpoint.threadId;
        changes = { "weekly-digest-helper": { running: true, runtimeState: "unknown", sessionEnd: null, session: null } };
        answers({ "session start": { stdout: JSON.stringify(started) } });
        await page.evaluate(click("oats-confirm-act"));
        await page.until(`${phaseIs("done")} && document.querySelector(${JSON.stringify(`${confirm} ${testId("oats-result")}`)})?.getAttribute("data-tone") === "unknown"`, 60);
        const unready = await dialog(page);
        check(
          unready.body.includes("Weekly digest helper was started, but its thread isn't ready yet") && unready.body.includes("Open it from its row when it is.") && !unready.body.includes("wasn't started"),
          `${at} a start that named no thread is told as started with its thread not ready, never as a failure`,
          JSON.stringify(unready),
        );
        await dialogShot({ page, at, viewport, check }, "start", "thread-not-ready");
        await page.evaluate(click("oats-confirm-close"));
        await page.until(closed, 10);
      } finally {
        // The stage's own roster again, read by the plugin's server.
        changes = {};
        answers();
        await page.clock(null);
        await tools.untilSnapshot((snapshot) => snapshot.ok === true && snapshot.agents.some((agent) => agent.instance === "weekly-digest-helper" && agent.running === false && agent.threadId === helper.id));
      }
    },
  },
  {
    stage: "lifecycle-running",
    name: "Restart, from the thread's own menu: a dialog first, with the Desktop's warning, its focus order; restarted; a refusal",
    run: async ({ page, at, viewport, threads, check }) => {
      const helper = threads.get(HELPER);
      const shot = (name) => dialogShot({ page, at, viewport, check }, "restart", name);
      try {
        answers({ "session restart": { stdout: startedOn("restart.json", helper), sleepMs: 5000 } });
        await page.goto(threadPath(helper));
        check(await openThreadMenu(page), `${at} the thread's own menu opens on a running agent's thread`);
        const items = await menuTexts(page);
        check(items.includes("Restart agent (OATS)") && items.includes("Stop agent (OATS)") && !items.includes("Start agent (OATS)"), `${at} it holds Restart and Stop, and no Start`, JSON.stringify(items));
        check(await pick(page, "Restart agent (OATS)"), `${at} Restart agent (OATS) is pressed in the thread's menu`);
        await page.until(phaseIs("ready"), 30);
        const before = await dialog(page);
        check(before.title === "Restart Weekly digest helper" && before.body.includes("Restart stops the current harness after checking the new configuration. Save any in-progress work before continuing.") && before.body.includes("Starts a new conversation. The current one stays readable in bb, archived.") && before.body.includes("Runs in bb's full mode: no sandbox.") && before.act === "Restart" && before.off === false, `${at} Restart opens its dialog and restarts nothing: it says that the current harness is stopped first, that it starts a new conversation and the current one stays in bb, archived, and that it runs in bb's full mode`, JSON.stringify(before));
        check(before.focus === "oats-start-harness", `${at} the focus STARTS on the form's first field`, before.focus);
        await shot("before");
        const order = await walk(page, 5);
        check(same(order, ["oats-start-model", "oats-start-refresh", "oats-confirm-cancel", "oats-confirm-act", "oats-start-harness"]), `${at} Tab walks the model, Refresh status, Cancel, Restart and round again`, JSON.stringify(order));
        await page.evaluate(click("oats-confirm-act"));
        await page.until(phaseIs("running"), 10);
        check((await dialog(page)).body.includes("Checking configuration and restarting…"), `${at} while it restarts the dialog says so`);
        await shot("running");
        await page.until(phaseIs("done"), 20);
        const done = await dialog(page);
        check(done.body.includes("Weekly digest helper restarted."), `${at} the dialog says that it restarted`, JSON.stringify(done));
        check(Boolean(await page.until(`location.pathname.endsWith("/threads/${helper.id}") && ${textOf(testId("oats-status-line"))}.startsWith("Working")`, 30)), `${at} behind the result the agent's thread is open and loaded`);
        await shot("done");
        await page.evaluate(click("oats-confirm-close"));
        await page.until(closed, 10);

        // A refusal (recorded: a restart on a home that was retired).
        answers({ "session restart": gone("restart") });
        check((await openThreadMenu(page)) && (await pick(page, "Restart agent (OATS)")), `${at} Restart is asked again from the thread's menu`);
        await page.until(phaseIs("ready"), 30);
        await page.evaluate(click("oats-confirm-act"));
        await page.until(phaseIs("failed"), 20);
        const refused = await dialog(page);
        check(refused.body.includes("OATS refused to restart Weekly digest helper") && refused.body.includes("OATS says: directory instance home was removed or exchanged") && refused.body.indexOf("E_WORK_INSPECTION_FAILED") > refused.body.indexOf("OATS says:") && refused.body.includes("Refresh status") && refused.focus === "oats-confirm-close", `${at} a refused restart leads with a person's words and says why in the kernel's own line; the code comes after, with Refresh status, and the focus on Close`, JSON.stringify(refused));
        await shot("refused");
        const after = await walk(page, 4);
        check(after.length === 4 && after[0] === "oats-start-refresh" && after[1].endsWith("Details") && after[2] === "oats-confirm-close" && after[3] === "oats-start-refresh", `${at} Tab walks Refresh status, Details, Close and round again`, JSON.stringify(after));
        await page.evaluate(click("oats-confirm-close"));
        await page.until(closed, 10);
      } finally {
        answers();
      }
    },
  },
  {
    stage: "lifecycle-running",
    name: "Restart, of an agent whose session was lost after its menu opened: first, that a message in its thread carries its conversation on, with the way there",
    run: async ({ page, at, viewport, threads, check }) => {
      const helper = threads.get(HELPER);
      const shot = (name) => dialogShot({ page, at, viewport, check }, "restart", name);
      try {
        await page.goto(threadPath(helper));
        check(await openThreadMenu(page), `${at} the thread's own menu opens on a running agent's thread`);
        // A menu offers Restart for an agent that runs. Its session is lost with the host before Restart is pressed:
        // the dialog reads the kernel's row again, and it is the lost one (not running, stopped, not by an operator).
        changes = { "weekly-digest-helper": { running: false, runtimeState: "stopped", sessionEnd: "lost" } };
        answers();
        check(await pick(page, "Restart agent (OATS)"), `${at} Restart agent (OATS) is pressed in the thread's menu`);
        check(Boolean(await page.until(`${phaseIs("ready")} && document.querySelector(${JSON.stringify(testId("oats-start-thread"))}) !== null`, 30)), `${at} the Restart dialog of an agent whose session was lost points at its thread`);
        const said = JSON.parse(
          await page.evaluate(
            `(() => { const confirm = document.querySelector(${JSON.stringify(confirm)}); const notice = confirm.querySelector(${JSON.stringify(testId("oats-notice"))}); return JSON.stringify({ first: confirm.firstElementChild === notice, title: notice?.querySelector("h3")?.innerText ?? null, open: document.querySelector(${JSON.stringify(testId("oats-start-thread"))})?.innerText ?? null, next: notice?.nextElementSibling?.innerText ?? "" }); })()`,
          ),
        );
        check(
          said.first && said.title === "To carry on its conversation, send it a message in its thread instead." && said.open === "Open Weekly digest helper" && said.next.includes("Starts a new conversation. The current one stays readable in bb, archived."),
          `${at} the dialog says FIRST to send a message in its thread to carry on, with Open Weekly digest helper, and then that a restart begins a new conversation`,
          JSON.stringify(said),
        );
        const before = await dialog(page);
        check(before.title === "Restart Weekly digest helper" && before.act === "Restart" && before.off === false, `${at} Restart stays possible`, JSON.stringify(before));
        await shot("cut-off");
        await page.evaluate(click("oats-start-thread"));
        check(Boolean(await page.until(`${closed} && location.pathname.endsWith("/threads/${helper.id}")`, 15)), `${at} Open Weekly digest helper closes the dialog on the agent's thread, and restarts nothing`);
      } finally {
        // The stage's own roster again (the agent runs), and the plugin's server has READ it: the dialog's check
        // made the server read the lost row, and the next scene of this stage opens a menu on what the server holds.
        changes = { "weekly-digest-helper": { running: true, runtimeState: "unknown", sessionEnd: null } };
        answers();
        await tools.untilSnapshot((snapshot) => snapshot.ok === true && snapshot.agents.some((agent) => agent.instance === "weekly-digest-helper" && agent.running === true));
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
