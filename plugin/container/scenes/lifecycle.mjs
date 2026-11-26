// The lifecycle's live scenes: the dialogs of Stop, Start, Restart and Retire, each opened from a
// REAL ROW's menu or from the thread's own menu (bb's thread actions, where a person finds them),
// before the act, while it runs, after it and refused, with the focus order walked.
//
// What the fake `oats` answers is recorded from the real kernel (test/fixtures/lifecycle): the
// stop plan and receipt of redesign-ui-lead, a lead with two children; the retire plan and receipt
// and the start and restart answers of weekly-digest-helper, an agent on a worktree with a child;
// the refusals of gone.json. So each act is asked on the agent its recording is of. A scene sets
// which recorded answer a verb gives, and how late (so that an act in progress can be looked at).
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { fill, FOCUSED, showSidebar, testId, textOf, visible } from "../browser.mjs";
import { completeLines } from "../files.mjs";

/** The fake kernel's own log of the calls it answered: what the plugin really asked of `oats`. */
const FAKE_LOG = join(homedir(), "fake-oats.log");
const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "test", "fixtures", "lifecycle");
const recorded = (name) => JSON.parse(readFileSync(join(FIXTURES, name), "utf8"));
/** What the real kernel answered for each act on an agent it no longer has (gone.json): one refusal per act. */
const gone = (act) => ({ stdout: JSON.stringify(recorded("gone.json")[act]) });
/** When the recorded plans were read: the page's clock is set just after. */
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
let verbsNow = {};
const answers = (verbs = {}, status = tools.statusWithRealIds(tools.threads, changes)) => {
  verbsNow = verbs;
  return tools.fake({ status: { stdout: status }, "capabilities show": { stdout: PILOT_PROVIDER }, ...verbs });
};
/**
 * The bb session provider these scenes run on: the recorded `oats capabilities show oats.bb` with
 * the version of the release that archives a thread at stop (oats-bb 0.4.0, the pilot's), in place
 * of the recording's commit: so the Stop dialog says the pilot's one line, "Archives its thread.".
 * (Below that release the line is the warning: the unit tests draw both.) SHAPED in that one field.
 */
const PILOT_PROVIDER = (() => {
  const answer = JSON.parse(readFileSync(join(FIXTURES, "..", "spawn", "capabilities-show-bb.json"), "utf8"));
  answer.result.version = "0.4.0";
  return JSON.stringify(answer);
})();
/**
 * The PILOT's provider archives a home's thread at its stop, and the Stop dialog's RESULT says what
 * bb shows of the thread after the stop. The fake kernel stops nothing: so, on these stages (the
 * pilot's provider by its version), a scene that confirms a stop does what that stop does, to EVERY
 * session the recorded receipt says it stopped (`STOPPED`: the agent and its two children, "3
 * sessions stopped."), while the fake's apply is on its way: it archives each one's thread in bb,
 * as that provider would, and makes the fake's roster say of each what a kernel says of a home an
 * operator stopped (sessionEnd "stopped"). (A stop that moved the agent's row alone left its
 * children "Working" and "Idle" behind a result that says three sessions stopped: the fixture's
 * untruth, which the lead's reader took for the product's: S5, 24 Nov 2026. And a row left running
 * on an archived thread reads as one bb archived under a running agent: "<Name> may still run.")
 * All of it is put back once the result is read (the stage holds the threads live and the agents
 * running for the scenes that follow). What is not yet put back is kept, so that a scene that fails
 * leaves bb and the fake as its stage holds them.
 * (The recorded retire's one child, digest-links-helper, is no agent of these stages' roster: a
 * Retire scene has no child's row to move.)
 * (The product's other case, a provider that says 0.4.0 and a thread bb did not archive, keeps its
 * warning, and its unit test: test/lifecycle/actions.test.tsx, "a stop's result says of the agent's thread what bb shows after the stop".)
 */
const bb = (...args) => execFileSync("bb", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
const archivedByStop = new Map();
let changesBeforeStop = null;
const LEAD_INSTANCE = "redesign-ui-lead";
/** Every session the recorded stop's receipt says it stopped (test/fixtures/lifecycle/stop-apply.json): the agent and its children. */
const STOPPED = recorded("stop-apply.json").result.results.filter((row) => row.ok).map((row) => row.instance);
/** This run's bb thread of an agent of the stage's roster. */
const threadIdOf = (instance) => JSON.parse(tools.statusWithRealIds(tools.threads, {})).agents.flatMap((group) => group.instances).find((row) => row.instance === instance).session.threadId;
/**
 * `slowRead`: from now OATS takes this long to answer a status read, as a real roster does after an act: the
 * window then holds the roster from before the act for a while after the result ("Reading…" stands over it).
 */
const pilotStopArchives = ({ slowRead = 0 } = {}) => {
  if (changesBeforeStop === null) changesBeforeStop = changes;
  // The roster first, then bb's list: a kernel records the stop of a home BEFORE its provider archives the thread
  // (and the fake's apply must find the roster of the stop whenever it ends: archiving three threads takes seconds).
  for (const instance of STOPPED) changes = { ...changes, [instance]: { running: false, runtimeState: "stopped", sessionEnd: "stopped" } };
  tools.fake({ status: { stdout: tools.statusWithRealIds(tools.threads, changes), ...(slowRead > 0 ? { sleepMs: slowRead } : {}) }, "capabilities show": { stdout: PILOT_PROVIDER }, ...verbsNow });
  for (const instance of STOPPED) {
    const id = threadIdOf(instance);
    bb("thread", "archive", id);
    archivedByStop.set(id, instance);
  }
};
/** The sidebar's row of an agent whose thread bb no longer lists, and what its second line says (its title: the whole line). */
const rowOfStopped = (instance) => `${testId("oats-agent-row-threadless")}[data-instance="${instance}"]`;
const rowsSay = `JSON.stringify(${JSON.stringify(STOPPED)}.map((instance) => document.querySelector(\`[data-testid="oats-agent-row-threadless"][data-instance="\${instance}"] [data-testid="oats-row-facts"]\`)?.getAttribute("title") ?? null))`;
/** Waits until the row of EVERY agent the stop took says "Stopped"; answers what the three rows say. */
const untilAllStopped = async (page, seconds = 40) => {
  await page.until(`JSON.parse(${rowsSay}).every((line) => typeof line === "string" && line.startsWith("Stopped"))`, seconds);
  return JSON.parse(await page.evaluate(rowsSay));
};
const allStopped = (lines) => lines.length === STOPPED.length && lines.every((line) => typeof line === "string" && line.startsWith("Stopped"));
const putBack = async () => {
  if (archivedByStop.size === 0 && changesBeforeStop === null) return;
  const instances = [...STOPPED];
  for (const id of [...archivedByStop.keys()]) {
    bb("thread", "unarchive", id);
    archivedByStop.delete(id);
  }
  changes = changesBeforeStop ?? changes;
  changesBeforeStop = null;
  answers(verbsNow);
  await tools.untilSnapshot((snapshot) => snapshot.ok === true && instances.every((instance) => snapshot.agents.some((agent) => agent.instance === instance && agent.running !== false)));
};
/** The plugin's server keeps the provider's answer for 30 s (server/core.ts PAGE_TTL_MS): the first of these stages waits that out ONCE, so that no dialog is drawn on an earlier stage's answer. */
let providerSettled = false;
const stage = (label, states) => ({
  label,
  enter: async (given) => {
    tools = given;
    changes = states;
    answers();
    if (!providerSettled) {
      await new Promise((resolve) => setTimeout(resolve, 31_000));
      providerSettled = true;
    }
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
/** What is under a fold of the dialog (its Details): whether it is open, and its words. A closed fold's words are not in the dialog's `body` (innerText reads what is drawn). */
export const folded = (id) => `(() => { const fold = document.querySelector(${JSON.stringify(testId(id))}); return JSON.stringify(fold === null ? null : { open: fold.open, summary: fold.querySelector("summary")?.innerText.trim() ?? null, text: fold.textContent.replace(/\\s+/g, " ").trim() }); })()`;
/** The dialog's lines before the act, in view: its one consequence line, and at most one more. */
/** Open the Start or Restart dialog's Harness choice, read what it offers and what is chosen, and close it again with Escape. */
export const HARNESS_CHOICE = `(async () => { const field = document.querySelector('[data-testid="oats-start-harness"]'); if (!field) return JSON.stringify({ harness: [], chosen: null, tag: null }); const tag = field.tagName; const chosen = field.getAttribute("data-value"); field.click(); let options = []; for (let i = 0; i < 40 && options.length === 0; i += 1) { await new Promise((done) => requestAnimationFrame(done)); options = [...document.querySelectorAll('[data-testid="oats-start-harness-option"]')]; } const harness = options.map((option) => option.querySelector("span")?.innerText.trim() ?? ""); document.querySelector('[data-testid="oats-start-harness-options"]')?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); return JSON.stringify({ harness, chosen, tag }); })()`;
export const saysNow = `JSON.stringify([...document.querySelectorAll(${JSON.stringify(`${testId("oats-confirm-says")} li`)})].map((line) => line.innerText.trim()))`;
/** No section heading of the four the cut removed, and one fold at most, in the dialog. */
export const plainNow = `(() => { const dialog = document.querySelector(${JSON.stringify(confirm)}); return JSON.stringify({ headings: [...dialog.querySelectorAll("h3")].map((each) => each.innerText.trim()).filter((text) => /^(what will happen|what is kept|before you confirm|current state)$/i.test(text)), folds: dialog.querySelectorAll("details").length }); })()`;
/** A toast of ours (found by what it says) has come in whole: it is opaque, and where it was at the last look. An image taken before shows it half way. */
const toastSettled = (text) =>
  `(() => { const toast = [...document.querySelectorAll("[data-sonner-toast]")].find((each) => each.innerText.includes(${JSON.stringify(text)})); if (!toast || Number(getComputedStyle(toast).opacity) < 1) return false; const top = Math.round(toast.getBoundingClientRect().top); const was = window.__oatsToastTop; window.__oatsToastTop = top; return was === top; })()`;
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
 * the act does (the dialog's one consequence line, or the result) and the dialog's buttons
 * are in view together; or the dialog says that there is more above or below.
 */
const whole = (key) => `(() => {
  const body = document.querySelector(${JSON.stringify(testId("oats-modal-body"))});
  if (!body) return JSON.stringify({ ok: false, why: "no dialog" });
  const frame = body.getBoundingClientRect();
  const inBody = (node) => { const box = node.getBoundingClientRect(); return box.height > 0 && box.top >= frame.top - 1 && box.bottom <= frame.bottom + 1; };
  const onScreen = (node) => { const box = node.getBoundingClientRect(); return box.height > 0 && box.top >= 0 && box.bottom <= innerHeight; };
  // And nothing lies over it: what is at its own centre is the button itself (bb's menu, closing, once covered them).
  const uncovered = (node) => { const box = node.getBoundingClientRect(); const at = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2); return at !== null && (at === node || node.contains(at)); };
  // What matters now: what the scene names; else, while the act runs, the line that says so; once it has an answer, the result; before, the notice or the first sentence of the plan.
  const phase = document.querySelector(${JSON.stringify(testId("oats-confirm"))})?.getAttribute("data-phase");
  const first = body.querySelector(${JSON.stringify(key)} ?? (phase === "running" ? ${JSON.stringify(testId("oats-confirm-running"))} : phase === "done" || phase === "failed" ? ${JSON.stringify(`${testId("oats-result")} h3`)} : ${JSON.stringify(`${testId("oats-notice")}, li, ${testId("oats-loading")}`)}));
  const buttons = [...document.querySelectorAll(${JSON.stringify(`${testId("oats-confirm-cancel")}, ${testId("oats-confirm-leave")}, ${testId("oats-confirm-act")}, ${testId("oats-confirm-close")}`)})];
  const says = [${JSON.stringify(testId("oats-modal-above"))}, ${JSON.stringify(testId("oats-modal-below"))}].map((id) => document.querySelector(id)?.innerText ?? null);
  const above = body.scrollTop > 1;
  const below = body.scrollHeight - body.clientHeight - body.scrollTop > 1;
  return JSON.stringify({ ok: first !== null && inBody(first) && buttons.length > 0 && buttons.every(onScreen) && buttons.every(uncovered) && (!above || says[0] !== null) && (!below || says[1] !== null), first: first?.innerText.slice(0, 60) ?? null, above, below, says, covered: buttons.filter((button) => !uncovered(button)).map((button) => button.innerText.trim()) });
})()`;
/** The image of a dialog's state, taken once the dialog is whole on screen (WHOLE) and its controls are high enough. */
async function dialogShot({ page, at, viewport, check }, verb, name, key = null) {
  // (What the dialog says of what is out of sight is drawn a moment after its content changed: it is waited for, briefly.)
  await page.until(`JSON.parse(${whole(key)}).ok`, 3);
  const seen = JSON.parse(await page.evaluate(whole(key)));
  check(seen.ok, `${at} ${verb}-${name}: what the act does and the dialog's buttons are on screen together, and where the dialog holds more than fits it says so`, JSON.stringify(seen));
  await page.shot(`lifecycle-${viewport.name}-${verb}-${name}`, { targets: true, gaps: `${testId("oats-modal")} [role="dialog"]` }); // (the dialog's own box: oats-modal is the screen's veil)
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
        check(["Stop (OATS)", "Restart (OATS)", "Retire (OATS)"].every((label) => items.includes(label)) && !items.includes("Start (OATS)"), `${at} the row's menu of a working agent holds Stop, Restart and Retire, each "(OATS)" beside bb's own, and no Start`, JSON.stringify(items));
        const named = items.indexOf("Redesign ui lead · Working");
        check(named >= 0 && items[named + 1] === "Stop (OATS)" && items.indexOf("Archive") > items.indexOf("Retire (OATS)"), `${at} the OATS entries start with a row that names the agent and its state, and stand before bb's own Archive and Delete`, JSON.stringify(items));
        // A separator is a gap in the list: more room between Retire and Archive than between two entries of one group.
        const apart = await page.evaluate(`(() => { const rows = [...document.querySelectorAll('[role="menuitem"]')]; const row = (text) => rows.find((each) => each.innerText.trim() === text)?.getBoundingClientRect(); const [stop, restart, retire, archive] = ["Stop (OATS)", "Restart (OATS)", "Retire (OATS)", "Archive"].map(row); if (!stop || !restart || !retire || !archive) return false; return archive.top - retire.bottom > restart.top - stop.bottom + 4; })()`);
        check(apart, `${at} bb sets the OATS entries apart from its own Archive and Delete`);
        await page.shot(`lifecycle-${viewport.name}-row-menu`);
        check(await pick(page, "Stop (OATS)"), `${at} Stop (OATS) is pressed in the row's menu`);
        await page.until(phaseIs("ready"), 30);
        const before = await dialog(page);
        check(
          before.title === "Stop Redesign ui lead?" && before.about === "redesign-ui-lead" && before.body.includes("Also stop Desktop mockups developer, Harvest knowledge helper On") && before.body.split("Also stop Desktop mockups developer").length === 2 && !/child instances|Also stops:|nothing is forced|Stops \d+ sessions|transcript|Observed|To talk to it again|Nothing is deleted/.test(before.body),
          `${at} Stop opens its dialog and stops nothing: titled with the act and the agent of the kernel's plan, with the choice of its children, which names them, once (no line says again who is stopped; the box of who is mid-turn is another fact; "agents", never "instances"), and none of the sentences the cut removed`,
          JSON.stringify(before),
        );
        const stopSays = await page.evaluate(saysNow);
        check(stopSays === JSON.stringify(["Archives its thread."]), `${at} in view, under no heading: its ONE consequence line, "Archives its thread." (the pilot's provider), and no other line`, stopSays);
        const stopPlain = await page.evaluate(plainNow);
        check(stopPlain === JSON.stringify({ headings: [], folds: 1 }), `${at} the dialog has none of the four section headings, and ONE fold`, stopPlain);
        const stopFold = JSON.parse(await page.evaluate(folded("oats-plan-details")));
        check(stopFold !== null && stopFold.open === false && /Details$/.test(stopFold.summary) && stopFold.text.includes("Nothing is deleted.") && stopFold.text.includes("Redesign ui lead") && stopFold.text.includes("Session running"), `${at} under Details, closed: that nothing is deleted, and each session's state`, JSON.stringify(stopFold));
        check(!before.body.includes("uncommitted work") && !before.body.includes("in the middle of a task") && !before.body.includes("Check again"), `${at} it says nothing of uncommitted work (a stop deletes nothing: the box says only what the act affects, a turn in progress); Check again is not on the dialog's face`, before.body);
        check(before.act === "Stop" && before.off === false && before.focus === "oats-confirm-cancel", `${at} the button is named for the act; the focus STARTS on Cancel`, JSON.stringify(before));
        await shot("before");
        const order = await walk(page, 4);
        check(order.length === 4 && order[0] === "oats-confirm-act" && order[1].endsWith("Details") && same(order.slice(2), ["oats-switch", "oats-confirm-cancel"]), `${at} Tab walks Stop, Details (closed: Check again is inside it), the choice, Cancel and round again: the focus stays in the dialog`, JSON.stringify(order));

        await page.evaluate(click("oats-confirm-act"));
        await page.until(phaseIs("running"), 10);
        const running = await dialog(page);
        check(running.phase === "running" && running.body.includes("Stopping…") && running.off === true, `${at} while it runs the dialog says so, and the act cannot be asked again`, JSON.stringify(running));
        // As the pilot's provider stops the home: its thread is archived in bb (the fake's apply is still on its way).
        pilotStopArchives();
        const leave = JSON.parse(await page.evaluate(`JSON.stringify({ line: ${textOf(testId("oats-confirm-leave-line"))}, close: ${textOf(testId("oats-confirm-leave"))}, off: document.querySelector(${JSON.stringify(testId("oats-confirm-leave"))})?.disabled ?? null })`));
        check(leave.line === "" && leave.close === "Close" && leave.off === false, `${at} while it runs the dialog can be left: Close is on (not Cancel), and no line says so`, JSON.stringify(leave));
        await shot("running");
        await page.until(phaseIs("done"), 20);
        const done = await dialog(page);
        const stopResult = await page.evaluate(textOf(`${confirm} ${testId("oats-result")}`));
        check(done.body.includes("3 sessions stopped.") && !/: Stopped|already stopped|Archives its thread/.test(done.body) && done.focus === "oats-confirm-close", `${at} the result is said in the dialog by its title, with no row for a session that stopped and no plan over it, and the focus is on Close`, JSON.stringify(done));
        // What it says of the thread is what bb SHOWS of it after the stop: the pilot's provider archived it, as the
        // dialog said it would ("Archives its thread."): the result is its title alone, with no warning of a message.
        check(stopResult === "3 sessions stopped.", `${at} the result is the title ALONE: bb shows the thread archived, as the dialog said before the act; nothing warns of a message in it`, stopResult);
        // Behind the result, once the roster is read again: EVERY agent the receipt names reads "Stopped": the agent and its two children.
        const behind = await untilAllStopped(page);
        check(allStopped(behind), `${at} behind "3 sessions stopped." the rows of all three agents the stop took say "Stopped": none still reads Working or Idle`, JSON.stringify(behind));
        await shot("done");
        await page.evaluate(click("oats-confirm-close"));
        check(Boolean(await page.until(closed, 10)), `${at} Close closes the dialog`);
        // The stage holds the thread live for what follows: it is put back (its row is waited for where it is next asked for).
        await putBack();

        // The plan changed under the confirmation (recorded: the apply of a plan read before a child stopped by
        // itself is refused E_PLAN_STALE, and its answer carries the plan as it is now: the fake answers that
        // plan to the read that follows).
        const stale = recorded("stop-apply-stale.json");
        answers({ "instance stop --apply": { file: "lifecycle/stop-apply-stale.json" } });
        check(await openRowMenu(page, viewport, lead.id), `${at} the row's menu opens again`);
        await pick(page, "Stop (OATS)");
        await page.until(phaseIs("ready"), 30);
        answers({ "instance stop --apply": { file: "lifecycle/stop-apply-stale.json" }, "instance stop --plan": { stdout: JSON.stringify({ schemaVersion: 1, ok: true, result: stale.error.details.plan }) } });
        await page.evaluate(click("oats-confirm-act"));
        await page.until(`${phaseIs("ready")} && document.querySelector(${JSON.stringify(`${confirm} ${testId("oats-notice")}`)}) !== null`, 20);
        const changed = await dialog(page);
        const notice = JSON.parse(await page.evaluate(`(() => { const notice = document.querySelector(${JSON.stringify(`${confirm} ${testId("oats-notice")}`)}); const box = notice.getBoundingClientRect(); return JSON.stringify({ text: notice.innerText.replace(/\\s+/g, " ").trim(), first: notice.parentElement.firstElementChild === notice, onScreen: box.top >= 0 && box.bottom <= innerHeight }); })()`));
        check(notice.first && notice.onScreen && notice.text.startsWith("Something changed since you opened this") && notice.text.includes("Harvest knowledge helper: its session was running, and is now not running.") && notice.text.includes("Review again"), `${at} a plan that changed comes back for review: the notice is the first thing in the dialog, on screen, and says WHAT changed, with Review again`, JSON.stringify(notice));
        check(changed.off === true && changed.focus === "oats-confirm-cancel" && !changed.body.includes("Read what changed"), `${at} the changed plan is NOT armed: Stop is off under the notice that says why (no words beside the button), and the focus is on Cancel`, JSON.stringify(changed));
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
        check(title === "Redesign ui lead wasn't stopped" && refused.body.includes("OATS no longer knows this agent") && !refused.body.includes("E_SESSION_UNKNOWN"), `${at} a refusal is a person's words; the kernel's code is not on its face`, JSON.stringify({ title, body: refused.body }));
        const details = JSON.parse(await page.evaluate(`JSON.stringify({ open: document.querySelector(${JSON.stringify(testId("oats-act-details"))}).open, text: document.querySelector(${JSON.stringify(testId("oats-act-details"))}).textContent })`));
        check(details.open === false && details.text.includes("no instance") && details.text.includes("E_SESSION_UNKNOWN"), `${at} the kernel's own message and its code are one press away, under the result's Details`, JSON.stringify(details));
        await shot("refused");
        const after = await walk(page, 4);
        check(refused.focus === "oats-confirm-close" && after.length === 4 && after[0] === "oats-act-review" && after[1].endsWith("Details") && after[2] === "oats-confirm-close" && after[3] === "oats-act-review", `${at} the focus is on Close, and Tab walks Review again, Details, Close and round again`, JSON.stringify({ focus: refused.focus, after }));
        await page.evaluate(click("oats-confirm-close"));
        await page.until(closed, 10);
        // (This dialog was opened from the row's menu, and the row is still the one it was opened on.)
        const back = await page.evaluate(`document.activeElement?.getAttribute("data-sidebar-thread-id") ?? ${FOCUSED}`);
        check(viewport.mobile || back === lead.id, `${at} the focus returns to the row the menu was opened on`, back);
      } finally {
        await putBack();
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
        check(await pick(page, "Stop (OATS)"), `${at} Stop (OATS) is pressed in the row's menu`);
      };
      await page.clock(STOP_AT);
      try {
        // The plan being read: the kernel takes a while to answer it.
        answers({ "instance stop --plan": { file: "lifecycle/stop-plan.json", sleepMs: 5000 } });
        await open();
        await page.until(phaseIs("reading"), 10);
        // The dialog is there only once bb's own menu has left the screen: it never lies under the menu's closing frames.
        check(await page.evaluate(`[...document.querySelectorAll('[role="menuitem"]')].every((entry) => { const box = entry.getBoundingClientRect(); return !(box.width > 0 && box.height > 0 && box.bottom > 0 && box.top < innerHeight); })`), `${at} the dialog opens after bb's menu has left the screen (at this width bb keeps a closed sheet in the page, below the window)`);
        const reading = await dialog(page);
        check(reading.phase === "reading" && reading.title === "Stop Redesign ui lead?" && reading.body.includes("Checking…") && reading.off === true, `${at} while the plan is read the dialog says that it checks, names the agent that was asked for in its title, and cannot be confirmed`, JSON.stringify(reading));
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
          unread.body.includes("Couldn't check Redesign ui lead") && unread.body.includes("Nothing was changed.") && unread.body.includes("Review again") && !/Archives its thread|Also stops/.test(unread.body),
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
          lost.body.includes("Result not confirmed") && lost.body.includes("Check again before assuming nothing happened.") && !lost.body.includes("OATS didn't confirm the result.") && lost.body.includes("Check again") && !lost.body.includes("wasn't stopped"),
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
        // As the pilot's provider stops the home: its thread is archived in bb (the fake's apply is still on its way).
        pilotStopArchives();
        const told = await page.until(`(() => { const toast = [...document.querySelectorAll("[data-sonner-toast]")].find((each) => each.innerText.includes("3 sessions stopped.")); return toast ? toast.innerText.replace(/\\s+/g, " ").trim() : null; })()`, 30);
        check(Boolean(told) && !/starts it outside OATS/.test(String(told)), `${at} the result of a stop whose dialog was left is told through bb's toaster: that it stopped, and nothing of a message in its thread (bb shows it archived)`, String(told));
        await page.until(toastSettled("3 sessions stopped."), 10);
        // The image is of the result AND of what stands behind it: the three rows as the roster read after the stop says them.
        const behindToast = await untilAllStopped(page, 20);
        check(allStopped(behindToast), `${at} beside the toast the rows of all three agents the stop took say "Stopped"`, JSON.stringify(behindToast));
        await page.shot(`lifecycle-${viewport.name}-stop-left-toast`);
        await putBack();
        await page.evaluate(`[...document.querySelectorAll("[data-sonner-toast]")].find((each) => each.innerText.includes("3 sessions stopped."))?.querySelector('button[aria-label="Dismiss notification"]')?.click()`);

        // A refusal that arrives after the dialog was left: a toast cannot hold it (no Details, no Review again).
        // It stays, names no button of the dialog, and "Show result" opens the dialog again on the refusal.
        answers({ "instance stop --apply": { ...gone("stopApply"), sleepMs: 4000 } });
        await open();
        await page.until(phaseIs("ready"), 30);
        await page.evaluate(click("oats-confirm-act"));
        await page.until(phaseIs("running"), 10);
        await page.evaluate(click("oats-confirm-leave"));
        await page.until(closed, 10);
        const refusedToast = `[...document.querySelectorAll("[data-sonner-toast]")].find((each) => each.innerText.includes("Redesign ui lead wasn't stopped"))`;
        const said = await page.until(`(() => { const toast = ${refusedToast}; return toast ? JSON.stringify({ text: toast.innerText.replace(/\\s+/g, " ").trim(), buttons: [...toast.querySelectorAll("button")].map((button) => button.innerText.trim()).filter((label) => label !== "") }) : null; })()`, 30);
        const toast = said ? JSON.parse(said) : { text: "", buttons: [] };
        check(toast.buttons.includes("Show result") && !/Review again|Details|Check again/.test(toast.text), `${at} a refusal that arrives after the dialog was left is told by its title, with Show result, and names no button of the dialog`, JSON.stringify(toast));
        await page.until(toastSettled("Redesign ui lead wasn't stopped"), 10);
        await page.shot(`lifecycle-${viewport.name}-stop-left-refused-toast`);
        await page.evaluate(`[...${refusedToast}.querySelectorAll("button")].find((button) => button.innerText.trim() === "Show result").click()`);
        await page.until(phaseIs("failed"), 10);
        const shown = await dialog(page);
        check(shown.body.includes("Redesign ui lead wasn't stopped") && shown.body.includes("Review again") && shown.body.includes("Details"), `${at} Show result opens the dialog again on that refusal, with Review again and Details`, JSON.stringify(shown));
        // bb takes the toast away once its button was pressed: the result is shown once, in the dialog.
        check(Boolean(await page.until(`${refusedToast} === undefined`, 10)), `${at} the toast leaves once its result is shown`);
        // No image of it: the dialog opened again IS the refusal's dialog as it was (the run's own check found the
        // two images the same, pixel for pixel, once the toast had left); `stop-refused` is its image.
        await page.evaluate(click("oats-confirm-close"));
        await page.until(closed, 10);
      } finally {
        await putBack();
        answers();
        await page.clock(null);
      }
    },
  },
  {
    stage: "lifecycle",
    name: "Stop, behind its result: every agent the stop took says Reading… until the roster is read again, then Stopped",
    run: async ({ page, at, viewport, threads, check }) => {
      const lead = threads.get(LEAD);
      // The acts of a place that says one agent's state: the thread's own line of an archived thread, the agent's page.
      const ACT = '[data-testid="oats-status-act"], [data-testid^="oats-agent-act-"]';
      try {
        answers({ "instance stop --apply": { file: "lifecycle/stop-apply.json", sleepMs: 12000 } });
        await page.goto("/");
        check(await openRowMenu(page, viewport, lead.id), `${at} a right click on Redesign ui lead's row opens bb's menu of that thread`);
        check(await pick(page, "Stop (OATS)"), `${at} Stop (OATS) is pressed`);
        await page.until(phaseIs("ready"), 30);
        await page.evaluate(click("oats-confirm-act"));
        await page.until(phaseIs("running"), 10);
        // The dialog is left (it would cover the places that are read below); the stop goes on.
        await page.evaluate(click("oats-confirm-leave"));
        await page.until(closed, 10);
        // What a place says of one agent: "Reading…" in its state's place, or its state; and whether its acts are off.
        const placeOf = (instance) => `(() => { const reading = [...document.querySelectorAll(${JSON.stringify(testId("oats-reading"))})].some((each) => each.innerText.trim() === "Reading…"); const state = document.querySelector(${JSON.stringify(`${testId("oats-status-line")}[data-state]`)})?.getAttribute("data-state") ?? document.querySelector(${JSON.stringify(`${testId("oats-panel-state")} ${testId("oats-state")}`)})?.getAttribute("data-state") ?? null; return JSON.stringify({ here: location.pathname.includes(${JSON.stringify(threadIdOf(instance))}) || location.pathname.includes(${JSON.stringify(instance)}), reading, state, acts: [...document.querySelectorAll(${JSON.stringify(ACT)})].map((act) => act.disabled) }); })()`;
        // A CHILD's own thread is opened while the stop still runs: its line says its state of now, with its acts on.
        const [child, ...rest] = STOPPED;
        if (viewport.mobile) await showSidebar(page, viewport);
        await page.evaluate(`document.querySelector('[data-sidebar-thread-id="${threadIdOf(child)}"]').click()`);
        const was = JSON.parse((await page.until(`(() => { const now = JSON.parse(${placeOf(child)}); return now.here && now.state !== null ? JSON.stringify(now) : ""; })()`, 20)) || (await page.evaluate(placeOf(child))));
        check(was.here && was.reading === false && was.state !== "stopped" && was.acts.some((off) => off === false), `${at} while the stop still runs, the child ${child}'s thread says its state of now, with an act on`, JSON.stringify(was));
        // As the pilot's provider stops the three homes. And from now OATS takes its time to answer a status read, as a
        // real roster does after an act: the result is on screen before the window holds a roster read after the stop.
        pilotStopArchives({ slowRead: 6000 });
        const told = await page.until(`[...document.querySelectorAll("[data-sonner-toast]")].some((each) => each.innerText.includes("3 sessions stopped."))`, 40);
        check(Boolean(told), `${at} the stop's result is told: "3 sessions stopped."`);
        // BETWEEN the result and the read, on the child's thread, with nothing pressed: "Reading…" in its state's
        // place, and every act of it off. Never the state of before the stop with its acts on.
        const between = JSON.parse((await page.until(`(() => { const now = JSON.parse(${placeOf(child)}); return now.here && now.reading ? JSON.stringify(now) : ""; })()`, 20)) || (await page.evaluate(placeOf(child))));
        check(between.here && between.reading && between.acts.length > 0 && between.acts.every((off) => off === true), `${at} between the result and the read the CHILD ${child}, which the stop took, says "Reading…" in its state's place, with every act of it off`, JSON.stringify(between));
        // THE ROWS of the three, at that same moment (the second look's sixth item; added by the roster developer): each
        // says "Reading…" in its facts' place, or, read again by then, "Stopped": never the roster's word of before the
        // stop, and never a warning ("may still run": the threads are archived by now) beside "3 sessions stopped.".
        if (viewport.mobile) await showSidebar(page, viewport);
        const rowsBetween = JSON.parse(
          await page.evaluate(
            `JSON.stringify(${JSON.stringify(STOPPED.map((instance) => [instance, threadIdOf(instance)]))}.map(([instance, thread]) => { const row = document.querySelector(\`[data-testid="oats-agent-row-threadless"][data-instance="\${instance}"], [data-testid="oats-agent-row"][data-sidebar-thread-id="\${thread}"]\`); if (!row) return { instance, row: false }; return { instance, row: true, reading: row.querySelector('[data-testid="oats-row-reading"]')?.innerText.trim() ?? null, says: row.querySelector('[data-testid="oats-row-facts"]')?.getAttribute("title") ?? null, warns: row.querySelector('[data-mark][data-tone="warning"], [data-phrase="reason"][data-tone="warning"]') !== null }; }))`,
          ),
        );
        check(
          rowsBetween.every((row) => row.row && !row.warns && (row.reading === "Reading…" || /^Stopped/.test(row.says ?? ""))) && rowsBetween.some((row) => row.reading === "Reading…"),
          `${at} between the result and the read the ROWS of the three say "Reading…" in their facts' place (or, read again by then, "Stopped"): none says the state of before the stop, and none warns`,
          JSON.stringify(rowsBetween),
        );
        // The moment's image (the roster developer's, for the second look's index): the child's thread says "Reading…"
        // and the rows say it. A HELD moment: this scene holds the status read for six seconds to have a "between" to
        // read (under the ten seconds "Reading…" stands at most, with room for the server's own wait before its read).
        await page.shot(`lifecycle-${viewport.name}-stop-child-reading`);
        // (This scene HOLDS the status read to have a "between" to read; a real one is a
        // second or two. The images of a stop's result are `stop-done` and `stop-left-toast`, taken once the roster is read.)
        // The other two, each opened from its row: "Reading…" with its acts off too. ("Reading…" stands for ten seconds
        // at most, app/roster/reading.tsx BOUND_MS, and the places are opened one after the other: one that is opened
        // after the roster was read again says "Stopped" by then, which is the truth too.)
        const seenBetween = [true];
        for (const instance of rest) {
          if (viewport.mobile) await showSidebar(page, viewport);
          await page.until(`document.querySelector(${JSON.stringify(rowOfStopped(instance))}) !== null`, 10);
          await page.evaluate(`document.querySelector(${JSON.stringify(rowOfStopped(instance))}).click()`);
          const said = await page.until(`(() => { const now = JSON.parse(${placeOf(instance)}); return now.here && (now.reading || now.state !== null) ? JSON.stringify(now) : ""; })()`, 10);
          const seen = JSON.parse(said || (await page.evaluate(placeOf(instance))));
          seenBetween.push(seen.reading);
          check(seen.here && (seen.reading ? seen.acts.length > 0 && seen.acts.every((off) => off === true) : seen.state === "stopped"), `${at} behind the result ${instance} says "Reading…" in its state's place with its acts off (or, read again by then, "Stopped"): never the state of before the stop with its acts on (${seenBetween.filter(Boolean).length} of ${seenBetween.length} seen in between so far)`, JSON.stringify(seen));
        }
        if (viewport.mobile) await showSidebar(page, viewport);
        // AFTER the read: all three say "Stopped", in the sidebar and where the last one is open.
        const after = await untilAllStopped(page, 60);
        check(allStopped(after), `${at} once the roster is read again the rows of all three say "Stopped"`, JSON.stringify(after));
        check(Boolean(await page.until(`![...document.querySelectorAll(${JSON.stringify(testId("oats-reading"))})].some((each) => each.innerText.trim() === "Reading…")`, 20)), `${at} and no place says "Reading…" any more`);
        await page.evaluate(`[...document.querySelectorAll("[data-sonner-toast]")].find((each) => each.innerText.includes("3 sessions stopped."))?.querySelector('button[aria-label="Dismiss notification"]')?.click()`);
      } finally {
        await putBack();
        answers();
        await page.goto("/");
      }
    },
  },
  {
    stage: "lifecycle",
    name: "Restart of an agent that works on a turn now: that it stops what it is doing, then that it starts a new conversation; the focus on Cancel",
    run: async ({ page, at, viewport, threads, check }) => {
      const lead = threads.get(LEAD);
      const shot = (name) => dialogShot({ page, at, viewport, check }, "restart", name);
      try {
        await page.goto("/");
        // bb says a turn runs on its thread (the stage holds one open): the row says "Working".
        const works = await page.until(`(document.querySelector('[data-sidebar-thread-id="${lead.id}"] [data-testid="oats-row-facts"]')?.getAttribute("title") ?? "").startsWith("Working")`, 30);
        check(Boolean(works), `${at} Redesign ui lead works on a turn now: its row says "Working"`, await page.evaluate(`document.querySelector('[data-sidebar-thread-id="${lead.id}"] [data-testid="oats-row-facts"]')?.getAttribute("title") ?? null`));
        check(await openRowMenu(page, viewport, lead.id), `${at} a right click on its row opens bb's menu of that thread`);
        check(await pick(page, "Restart (OATS)"), `${at} Restart (OATS) is pressed`);
        await page.until(phaseIs("ready"), 30);
        const before = await dialog(page);
        const says = await page.evaluate(saysNow);
        check(before.title === "Restart Redesign ui lead" && before.about === "redesign-ui-lead" && says === JSON.stringify(["Stops what it is doing now.", "Starts a new conversation."]), `${at} the Restart dialog of an agent that works says, in this order, that it stops what it is doing now, and that it starts a new conversation`, JSON.stringify({ before, says }));
        check(before.act === "Restart" && before.off === false && before.focus === "oats-confirm-cancel", `${at} it cuts a turn: the focus STARTS on Cancel, and Restart can be pressed`, JSON.stringify(before));
        await shot("working");
        await page.evaluate(click("oats-confirm-cancel"));
        check(Boolean(await page.until(closed, 10)), `${at} Cancel closes the dialog, and nothing was restarted`);
      } finally {
        answers();
      }
    },
  },
  {
    stage: "lifecycle",
    name: "A thread that a person archives in bb under an agent that runs: the notice, at once, with Stop…",
    run: async ({ page, at, viewport, threads, check }) => {
      const lead = threads.get(LEAD);
      const notice = `[...document.querySelectorAll("[data-sonner-toast]")].find((each) => each.innerText.includes("Redesign ui lead may still run."))`;
      const row = `document.querySelector('[data-sidebar-thread-id="${lead.id}"]')`;
      let archived = false;
      try {
        await page.goto("/");
        check(Boolean(await page.until(`${row} !== null`, 30)), `${at} Redesign ui lead, which runs, is drawn on its thread, and nothing has been said of it`);
        const before = await page.evaluate(`${notice} === undefined`);
        // bb's own Archive, as a person presses it in the thread's menu: bb stops nothing OATS knows of, and the roster still says that the agent runs.
        bb("thread", "archive", lead.id);
        archived = true;
        const said = await page.until(`(() => { const toast = ${notice}; return toast ? JSON.stringify({ text: toast.innerText.replace(/\\s+/g, " ").trim(), buttons: [...toast.querySelectorAll("button")].map((button) => button.innerText.trim()).filter((text) => text !== "") }) : null; })()`, 60);
        const toast = said ? JSON.parse(said) : { text: "", buttons: [] };
        check(before === true && toast.text.startsWith("Redesign ui lead may still run.") && same(toast.buttons, ["Stop…"]), `${at} bb archived the thread of an agent that runs: at once a notification says "Redesign ui lead may still run.", with ONE button, Stop…`, JSON.stringify({ before, toast }));
        await page.until(toastSettled("Redesign ui lead may still run."), 10);
        await page.shot(`lifecycle-${viewport.name}-archived-while-running`);
        const count = await page.evaluate(`[...document.querySelectorAll("[data-sonner-toast]")].filter((each) => each.innerText.includes("may still run.")).length`);
        check(count === 1, `${at} it is said once`, String(count));
        await page.evaluate(`[...${notice}.querySelectorAll("button")].find((button) => button.innerText.trim() === "Stop…").click()`);
        await page.until(phaseIs("ready"), 30);
        const stop = await dialog(page);
        check(stop.title === "Stop Redesign ui lead?" && stop.about === "redesign-ui-lead" && stop.act === "Stop" && stop.off === false, `${at} Stop… opens the Stop dialog for that agent: the kernel's plan, to be confirmed (nothing was stopped by the press)`, JSON.stringify(stop));
        await page.evaluate(click("oats-confirm-cancel"));
        await page.until(closed, 10);
        // (That it is said once per agent and thread, whatever is read after, is the rule's unit test: test/lifecycle/left.test.ts.)
        await page.evaluate(`${notice}?.querySelector('button[aria-label="Dismiss notification"]')?.click()`);
      } finally {
        if (archived) bb("thread", "unarchive", lead.id);
        answers();
        await tools.untilSnapshot((snapshot) => snapshot.ok === true && snapshot.agents.some((agent) => agent.instance === LEAD_INSTANCE && agent.running !== false));
        await page.goto("/");
        await page.until(`${row} !== null`, 30);
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
        return (await openThreadMenu(page)) && (await pick(page, "Retire (OATS)"));
      };
      await page.clock(RETIRE_AT);
      try {
        await page.goto(threadPath(helper));
        check(await openThreadMenu(page), `${at} the thread's own menu opens on Weekly digest helper's thread`);
        const items = await menuTexts(page);
        check(["Start (OATS)", "Retire (OATS)"].every((label) => items.includes(label)) && !items.includes("Stop (OATS)") && !items.includes("Restart (OATS)"), `${at} the thread's menu of a stopped agent holds Start and Retire, and neither Stop nor Restart`, JSON.stringify(items));
        await page.shot(`lifecycle-${viewport.name}-thread-menu`);
        check(await pick(page, "Retire (OATS)"), `${at} Retire (OATS) is pressed in the thread's menu`);
        await page.until(phaseIs("ready"), 30);
        const before = await dialog(page);
        check(
          before.title === "Retire Weekly digest helper?" && before.about === "weekly-digest-helper" && !/won't stop|pull requests|recovery copy|stays readable|Stops its session|Observed|Deletes its home|Keeps its worktree/.test(before.body),
          `${at} Retire opens its dialog and retires nothing, for the agent the kernel's plan names, with none of the sentences the cut removed or folded`,
          JSON.stringify(before),
        );
        const retireSays = await page.evaluate(saysNow);
        check(retireSays === JSON.stringify(["This cannot be undone.", "Also stops: Digest links helper."]), `${at} in view, under no heading: its ONE consequence line, "This cannot be undone.", then who else it stops`, retireSays);
        const retirePlain = await page.evaluate(plainNow);
        check(retirePlain === JSON.stringify({ headings: [], folds: 1 }), `${at} the dialog has none of the four section headings, and ONE fold`, retirePlain);
        const retireFold = JSON.parse(await page.evaluate(folded("oats-plan-details")));
        check(retireFold !== null && retireFold.open === false && retireFold.text.includes("Deletes its home.") && retireFold.text.includes("Keeps its worktree, moved aside, on branch agents/weekly-digest-helper.") && retireFold.text.includes("Uncommitted work") && !retireFold.text.includes("/abs/"), `${at} under Details, closed: what goes and what stays, and the current state; no path`, JSON.stringify(retireFold));
        check(!before.body.includes("SIGTERM") && !before.body.includes("the ADE") && !before.body.includes("/abs/"), `${at} none of the kernel's own notes and no path is pasted into the plan`, before.body);
        check(before.act === "Retire" && before.off === false && before.focus === "oats-confirm-cancel", `${at} Retire is destructive: the focus starts on Cancel`, JSON.stringify(before));
        await shot("before");
        const order = await walk(page, 4);
        check(order.length === 4 && order[0] === "oats-confirm-act" && order[1].endsWith("Details") && same(order.slice(2), ["oats-switch", "oats-confirm-cancel"]), `${at} Tab walks Retire, Details (closed: Check again is inside it), the choice, Cancel and round again`, JSON.stringify(order));

        // Also delete the worktree: what goes and what stays change, and what would be lost is said in words.
        await page.evaluate(`document.querySelector(${JSON.stringify(`${testId("oats-plan-choice")} [role="switch"]`)}).click()`);
        await page.until(`document.querySelector(${JSON.stringify(testId("oats-plan-warning"))}) !== null`, 10);
        const ticked = await dialog(page);
        const tickedSays = await page.evaluate(saysNow);
        const tickedFold = JSON.parse(await page.evaluate(folded("oats-plan-details")));
        check(ticked.body.includes("Also delete the worktree On") && tickedSays === JSON.stringify(["This cannot be undone.", "Also stops: Digest links helper."]) && (await page.evaluate(`(() => { const line = document.querySelector(${JSON.stringify(testId("oats-plan-warning"))}); return line !== null && line.previousElementSibling === document.querySelector(${JSON.stringify(testId("oats-plan-choice"))}) ? line.innerText.trim() : ""; })()`)) === "Deletes 1 uncommitted change too (a copy is saved)." && !tickedFold.text.includes("Keeps its worktree") && ticked.body.split("uncommitted change").length === 2, `${at} with "Also delete the worktree" on, what is lost is said AT the tick, under its label, counted and said once; the dialog's two lines stay (who else it stops is in view)`, JSON.stringify({ says: tickedSays, fold: tickedFold }));
        await shot("delete-worktree", testId("oats-plan-warning")); // what would be lost is what this image is of
        await page.evaluate(`document.querySelector(${JSON.stringify(`${testId("oats-plan-choice")} [role="switch"]`)}).click()`);

        // From here the kernel answers what it answers once the agent is retired: its receipt, and a roster without it.
        answers({ retire: { file: "lifecycle/retire-apply.json", sleepMs: 5000 } }, without(["weekly-digest-helper"]));
        await page.evaluate(click("oats-confirm-act"));
        await page.until(phaseIs("running"), 10);
        const running = await dialog(page);
        check(running.body.includes("Retiring…") && running.off === true, `${at} while it runs the dialog says so, and the act cannot be asked again`, JSON.stringify(running));
        await shot("running");
        await page.until(phaseIs("done"), 20);
        const done = await dialog(page);
        check(done.body.includes("Weekly digest helper retired.") && done.body.includes("1 child agent stopped and kept.") && !/Home folder deleted|Session stopped|, at:|\/abs\//.test(done.body) && done.body.includes("Worktree kept.") && done.body.includes("Recovery copy saved.") && done.body.includes("Conversation archived in bb.") && done.focus === "oats-confirm-close", `${at} the result is the facts a person needs later: the children, where the worktree and the recovery copy are, the thread; no step that only says what was asked`, JSON.stringify(done));
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
        check(left.title === "Retire Weekly digest helper" && left.body.includes("Weekly digest helper is not in OATS any more") && left.body.includes("Nothing was changed.") && left.act === "" && !left.body.includes("Review again"), `${at} a plan refused for an agent the kernel does not know: the dialog keeps the asked agent's name in its title, says it is not in OATS any more, and offers nothing to confirm or to try again`, JSON.stringify(left));
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
        check(partial.body.includes("Retirement didn't finish") && partial.body.includes("Home folder kept.") && !/, at:|\/abs\//.test(partial.body) && !partial.body.includes("Cleanup didn't finish.") && partial.body.includes("Its home was kept: a message in its thread would start it outside OATS.") && partial.body.includes("Check what was kept before trying again.") && partial.body.includes("Review again") && !partial.body.includes("RETIRE_INCOMPLETE"), `${at} a retire whose cleanup did not finish says what is kept and to check it, and offers Review again; the code is not on its face`, JSON.stringify(partial));
        const warned = JSON.parse(await page.evaluate(`(() => { const result = document.querySelector(${JSON.stringify(`${confirm} ${testId("oats-result")}`)}); const warning = result?.querySelector(${JSON.stringify(testId("oats-result-warning"))}); const headline = result?.querySelector("h3"); return JSON.stringify({ tone: warning?.getAttribute("data-tone") ?? null, headline: headline?.innerText ?? null, first: Boolean(warning && headline && (headline.compareDocumentPosition(warning) & Node.DOCUMENT_POSITION_FOLLOWING) && headline.getBoundingClientRect().bottom <= warning.getBoundingClientRect().top), box: document.querySelector(${JSON.stringify(`${confirm} ${testId("oats-notice")}`)}) !== null }); })()`));
        const keptFold = JSON.parse(await page.evaluate(folded("oats-act-details")));
        check(warned.tone === "warning" && warned.headline === "Retirement didn't finish" && warned.first && warned.box === false && keptFold !== null && keptFold.open === false && keptFold.text.includes("No status row, no hooks OATS runs for it, no stop by OATS.") && keptFold.text.includes("Home folder kept, at:") && keptFold.text.includes("RETIRE_INCOMPLETE"), `${at} the headline first; then that the home was kept, the result's first line, in the warning tone (no box above the headline); the rest (the release lane's words, where the home is, the kernel's lines, the code) is one press away, under the result's ONE Details`, JSON.stringify({ warned, keptFold }));
        await shot("incomplete", testId("oats-result-warning")); // the warning is what this image is of
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
        check(await pick(page, "Start (OATS)"), `${at} Start (OATS) is pressed in the row's menu`);
        await page.until(phaseIs("ready"), 30);
        const before = await dialog(page);
        check(
          before.title === "Start Weekly digest helper" && before.about === "weekly-digest-helper" && before.body.includes("Starts a new conversation.") && !/message it instead|existing home|stays readable|Ready to start|full mode|Refresh status|Leave blank|saved for later/.test(before.body) && /The model is saved for later starts too\./.test((await page.evaluate(`document.querySelector(${JSON.stringify(testId("oats-start-details"))})?.textContent ?? ""`)) ?? ""),
          `${at} Start opens its dialog and starts nothing: titled with the agent as the kernel's roster names it now, with its one line and none of the sentences the cut removed or folded (that the model is saved is under Details); a Start that can run says nothing more`,
          JSON.stringify(before),
        );
        const startSaid = await page.evaluate(saysNow);
        const startPlain = await page.evaluate(plainNow);
        check(startSaid === JSON.stringify(["Starts a new conversation."]) && startPlain === JSON.stringify({ headings: [], folds: 1 }), `${at} in view, under no heading: its ONE consequence line; and ONE fold`, `${startSaid} ${startPlain}`);
        // The Harness field is the plugin's own choice (a button that opens a list), never the browser's select: it is
        // opened, read as a person reads it, and closed with Escape (which closes the list alone, not the dialog).
        const fields = { ...JSON.parse(await page.evaluate(HARNESS_CHOICE)), model: await page.evaluate(`document.querySelector(${JSON.stringify(testId("oats-start-model"))}).value`) };
        check(fields.tag === "BUTTON" && fields.chosen === "" && fields.harness[0].startsWith("Keep the recorded harness") && same(fields.harness.slice(1), ["Claude Code", "pi"]) && fields.model === "", `${at} the harness starts on "Keep the recorded harness", with the ones the provider declares after it, in the plugin's own choice; the model is blank`, JSON.stringify(fields));
        check(await page.evaluate(`${phaseIs("ready")} && document.querySelector(${JSON.stringify(testId("oats-start-harness-options"))}) === null`), `${at} Escape in the open list closes the list, and the dialog stays`);
        // Its list, open: what a person chooses from, in the look of the plugin's fields.
        await page.evaluate(click("oats-start-harness"));
        const listed = await page.until(`document.querySelectorAll(${JSON.stringify(testId("oats-start-harness-option"))}).length === 3 && (() => { const box = document.querySelector(${JSON.stringify(testId("oats-start-harness-options"))}).getBoundingClientRect(); return box.height > 0 && box.top >= 0 && box.bottom <= innerHeight; })()`, 10);
        check(Boolean(listed), `${at} the open list of harnesses is whole in view, inside the dialog`);
        await page.shot(`lifecycle-${viewport.name}-start-harness-open`);
        await page.press("Escape");
        check(Boolean(await page.until(`${phaseIs("ready")} && document.querySelector(${JSON.stringify(testId("oats-start-harness-options"))}) === null`, 10)), `${at} Escape closes the list again, and the dialog stays`);
        check(before.act === "Start" && before.off === false && before.focus === "oats-confirm-act", `${at} the focus starts on the dialog's primary button, Start: not on a field`, JSON.stringify(before));
        const startFold = JSON.parse(await page.evaluate(folded("oats-start-details")));
        check(startFold !== null && startFold.open === false && startFold.text.includes("Runs in bb's full mode: no sandbox.") && startFold.text.includes("Machine") && startFold.text.includes("Home"), `${at} under Details, closed: that the agent runs in bb's full mode, with no sandbox, its machine and its home`, JSON.stringify(startFold));
        await shot("before");
        const order = await walk(page, 5);
        check(order.length === 5 && same(order.slice(0, 3), ["oats-start-model", "oats-confirm-cancel", "oats-confirm-act"]) && order[3].endsWith("Details") && order[4] === "oats-start-harness", `${at} Tab walks the model, Cancel, Start, Details and round again (no Refresh status: it is for a Start that is off)`, JSON.stringify(order));

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
        // Behind the result the agent's thread is open and loaded, and its row no longer says Stopped: it says what
        // bb says of the thread, which in this fixture has no turn running (Idle; after a real start bb runs the
        // agent's first turn, and the real run holds that).
        const opened = await page.until(`location.pathname.endsWith("/threads/${helper.id}") && ${textOf(testId("oats-status-line"))}.startsWith("Idle")`, 30);
        check(Boolean(opened), `${at} behind the result the agent's thread is open, and its row says it is there, at rest (Idle)`, await page.evaluate(`location.pathname + " | " + ${textOf(testId("oats-status-line"))}`));
        await shot("done");
        await page.evaluate(click("oats-confirm-close"));
        await page.until(closed, 10);

        // A refusal (recorded: a start on a home that was retired).
        changes = {};
        answers({ "session start": gone("start") });
        await tools.untilSnapshot((snapshot) => snapshot.ok === true && snapshot.agents.some((agent) => agent.instance === "weekly-digest-helper" && agent.running === false));
        await page.goto("/");
        check(await openRowMenu(page, viewport, helper.id), `${at} the row's menu opens again`);
        await pick(page, "Start (OATS)");
        await page.until(phaseIs("ready"), 30);
        await page.evaluate(click("oats-confirm-act"));
        await page.until(phaseIs("failed"), 20);
        const refused = await dialog(page);
        check(refused.body.includes("OATS refused to start Weekly digest helper") && refused.body.includes("Refresh its status before another try.") && !refused.body.includes("OATS says:") && !refused.body.includes("E_WORK_INSPECTION_FAILED") && JSON.parse(await page.evaluate(folded("oats-act-details"))).text.includes("directory instance home was removed or exchanged") && JSON.parse(await page.evaluate(folded("oats-act-details"))).text.includes("E_WORK_INSPECTION_FAILED") && refused.body.includes("Refresh status") && !refused.body.includes("not in OATS any more"), `${at} a refused start is a person's words, with Refresh status before another try; WHY, in the kernel's own line, and the code are under Details; it does not call the agent gone`, JSON.stringify(refused));
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
        check(await pick(page, "Start (OATS)"), `${at} Start (OATS) is pressed in the row's menu`);
        const pointed = await page.until(`${phaseIs("ready")} && document.querySelector(${JSON.stringify(testId("oats-start-thread"))}) !== null`, 30);
        if (!pointed) {
          // What was there in its place, so that a failure says why: the dialog as it is (or that there is none), the
          // kernel's row the dialog's check was answered with, and bb's own row of the agent's thread as the page has it.
          const seen = await page.evaluate(
            `JSON.stringify({ dialog: document.querySelector(${JSON.stringify(testId("oats-modal"))}) === null ? null : { phase: document.querySelector(${JSON.stringify(confirm)})?.getAttribute("data-phase") ?? null, text: document.querySelector(${JSON.stringify(testId("oats-modal"))}).innerText.replace(/\\s+/g, " ").trim() }, path: location.pathname, statusLine: document.querySelector(${JSON.stringify(testId("oats-status-line"))})?.innerText ?? null })`,
          );
          const row = JSON.parse(tools.statusWithRealIds(tools.threads, changes)).agents?.flatMap((agent) => agent.instances ?? []).find((instance) => instance.instance === "weekly-digest-helper") ?? null;
          check(false, `${at} the Start dialog of an agent whose session was lost points at its thread`, `the page: ${seen}; the kernel's row the check was answered with: ${JSON.stringify(row === null ? null : { running: row.running ?? null, runtimeState: row.runtimeState ?? null, sessionEnd: row.sessionEnd ?? null, backend: row.backend ?? null, endpoint: row.session?.endpoint ?? row.runtime ?? null })}; bb's thread of the agent: ${JSON.stringify({ id: helper.id, status: helper.status ?? null, archivedAt: helper.archivedAt ?? null })}`);
          // Nothing more is read of a dialog that is not the one this scene is about.
          if (await page.evaluate(`document.querySelector(${JSON.stringify(testId("oats-modal"))}) !== null && document.querySelector(${JSON.stringify(testId("oats-confirm-cancel"))}) !== null`)) await page.evaluate(click("oats-confirm-cancel"));
          return;
        }
        check(true, `${at} the Start dialog of an agent whose session was lost points at its thread`);
        const said = JSON.parse(
          await page.evaluate(
            `(() => { const confirm = document.querySelector(${JSON.stringify(confirm)}); const notice = confirm.querySelector(${JSON.stringify(testId("oats-notice"))}); return JSON.stringify({ first: confirm.firstElementChild === notice, title: notice?.querySelector("h3")?.innerText ?? null, open: document.querySelector(${JSON.stringify(testId("oats-start-thread"))})?.innerText ?? null, next: notice?.nextElementSibling?.innerText ?? "" }); })()`,
          ),
        );
        check(
          said.first && said.title === "To continue its conversation, message it instead." && said.open === "Open Weekly digest helper" && said.next.trim() === "Starts a new conversation.",
          `${at} the dialog says FIRST to message it instead to continue its conversation, with Open Weekly digest helper, and then that a start begins a new conversation`,
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
        check(await pick(page, "Retire (OATS)"), `${at} Retire (OATS) is pressed in the thread's menu`);
        await page.until(phaseIs("ready"), 30);
        await page.evaluate(click("oats-confirm-act"));
        await page.until(`${phaseIs("done")} && document.querySelector(${JSON.stringify(`${confirm} ${testId("oats-result")}`)})?.getAttribute("data-tone") === "unknown"`, 30);
        const accepted = await dialog(page);
        check(
          accepted.body.includes("Retirement accepted") && !accepted.body.includes("will finish in the background") && accepted.body.includes("Its row in the sidebar shows the result.") && !accepted.body.includes("retired."),
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
        check(await pick(page, "Start (OATS)"), `${at} Start (OATS) is pressed in the row's menu`);
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
    stage: "lifecycle",
    name: "Start, of an agent on tmux whose session was lost: it tries to continue its last conversation; back, started fresh, the harness waiting; the plain start on purpose",
    run: async ({ page, at, viewport, check }) => {
      const TMUX = "kernel-fix-developer";
      const shot = (name) => dialogShot({ page, at, viewport, check }, "start", name);
      const actStart = `document.querySelector(${JSON.stringify(`${testId("oats-panel")} ${testId("oats-agent-act-start")}`)})`;
      // The agent has no bb thread: its acts are on its own page.
      const open = async () => {
        await page.goto(`/plugins/oats/agent/${TMUX}`);
        check(Boolean(await page.until(`${actStart} !== null && ${actStart}.disabled === false`, 30)), `${at} the page of a tmux agent that does not run offers Start…`);
        await page.evaluate(`${actStart}.click()`);
        await page.until(phaseIs("ready"), 30);
      };
      const resumed = (file) => ({ "session start --resume": { file: `lifecycle/${file}`, sleepMs: 1500 } });
      try {
        // The pilot's row: on tmux, not running, no word of the runtime's, its session lost.
        changes = { [TMUX]: { running: false, runtimeState: null, sessionEnd: "lost" } };
        // The recorded answer of a real tmux home, with one substitution: the name of the agent it was recorded
        // on, for the sample roster's agent on tmux (the name, and so its home; no other edit).
        answers({ "session start --resume": { stdout: readFileSync(join(FIXTURES, "tmux-start-resume.json"), "utf8").replaceAll("lost-tmux-developer", TMUX), sleepMs: 1500 } });
        await tools.untilSnapshot((snapshot) => snapshot.ok === true && snapshot.agents.some((agent) => agent.instance === TMUX && agent.running === false));
        await open();
        const before = await dialog(page);
        const fields = await page.evaluate(`JSON.stringify({ harness: document.querySelector(${JSON.stringify(testId("oats-start-harness"))}) !== null, model: document.querySelector(${JSON.stringify(testId("oats-start-model"))}) !== null, fresh: document.querySelector(${JSON.stringify(`${testId("oats-start-fresh-choice")} [role="switch"]`)})?.getAttribute("aria-checked") ?? null })`);
        check(
          before.title === "Start Kernel fix developer" &&
            (await page.evaluate(saysNow)) === JSON.stringify(["Tries to continue its last conversation; else starts fresh."]) &&
            !/full mode|stays readable in bb|Claude may|how to load/.test(before.body) &&
            !JSON.parse(await page.evaluate(folded("oats-start-details"))).text.includes("full mode") &&
            before.act === "Start" &&
            before.off === false,
          `${at} Start of a lost tmux agent says in its one line that it tries to continue its last conversation, else starts fresh; nothing of bb's full mode (under Details either) or thread, nor of a question its harness may ask`,
          JSON.stringify(before),
        );
        check(fields === JSON.stringify({ harness: false, model: false, fresh: "false" }), `${at} no harness and no model are offered; the plain start is a choice that is off`, fields);
        await shot("resume-before");
        await page.evaluate(click("oats-confirm-act"));
        await page.until(phaseIs("done"), 30);
        const back = await dialog(page);
        const where = await page.evaluate(`document.querySelector(${JSON.stringify(testId("oats-start-where"))})?.innerText.replace(/\\s+/g, " ").trim() ?? ""`);
        check(back.body.includes("Kernel fix developer is back in its last conversation.") && (await page.evaluate("location.pathname")).endsWith(`/plugins/oats/agent/${TMUX}`), `${at} the result says what the kernel answered: it is back in its last conversation; no thread opens`, JSON.stringify(back));
        check(where.startsWith("Attach:") && !where.includes("Runs in tmux") && where.includes("oats session attach --home ") && where.includes(TMUX), `${at} and the command that attaches to it, under the panel's own word, "Attach:"`, where);
        await shot("resume-back");
        await page.evaluate(click("oats-confirm-close"));
        await page.until(closed, 10);

        // The kernel started it fresh: its last conversation was not found.
        answers(resumed("start-resume-fresh.json"));
        await open();
        await page.evaluate(click("oats-confirm-act"));
        await page.until(phaseIs("done"), 30);
        const fresh = await dialog(page);
        const tone = await page.evaluate(`document.querySelector(${JSON.stringify(`${confirm} ${testId("oats-result")}`)})?.getAttribute("data-tone")`);
        check(fresh.body.includes("Kernel fix developer started fresh.") && !fresh.body.includes("was not brought back") && fresh.body.includes("Its last conversation was not found.") && !fresh.body.includes("is back in its last conversation") && tone === "unknown", `${at} a resume that started fresh leads with that, in the warning tone, then the kernel's reason in words`, JSON.stringify({ fresh, tone }));
        await shot("resume-fresh");
        await page.evaluate(click("oats-confirm-close"));
        await page.until(closed, 10);

        // It is back, and its harness waits in its terminal before it loads the conversation.
        answers(resumed("start-resume-waiting.json"));
        await open();
        await page.evaluate(click("oats-confirm-act"));
        await page.until(`${phaseIs("done")} && document.querySelector(${JSON.stringify(testId("oats-start-waiting"))}) !== null`, 30);
        const waiting = await page.evaluate(`document.querySelector(${JSON.stringify(testId("oats-start-waiting"))}).innerText.replace(/\\s+/g, " ").trim()`);
        const reach = await page.evaluate(`document.querySelector(${JSON.stringify(testId("oats-start-where"))})?.innerText.replace(/\\s+/g, " ").trim() ?? ""`);
        check(waiting === "Waiting for you in its terminal." && reach.includes("oats session attach --home ") && reach.includes(TMUX), `${at} a harness that waits for its person is said apart, in the attention tone, and the command that attaches follows`, `${waiting} | ${reach}`);
        await shot("resume-waiting");
        await page.evaluate(click("oats-confirm-close"));
        await page.until(closed, 10);

        // The plain start, on purpose: the choice says what it loses.
        // (The recorded answer of a plain start of a real tmux home, with the one substitution: the agent's name.)
        answers({ "session start": { stdout: readFileSync(join(FIXTURES, "tmux-start.json"), "utf8").replaceAll("lost-tmux-developer", TMUX) } });
        await open();
        await page.evaluate(`document.querySelector(${JSON.stringify(`${testId("oats-start-fresh-choice")} [role="switch"]`)}).click()`);
        await page.until(`document.querySelector(${JSON.stringify(testId("oats-start-fresh-warning"))}) !== null`, 10);
        const chosen = await dialog(page);
        check(chosen.body.includes("Its last conversation is not brought back.") && (await page.evaluate(saysNow)) === JSON.stringify(["Starts a new conversation."]) && !chosen.body.includes("Tries to continue its last conversation"), `${at} the plain start, chosen on purpose, says what it loses and what it does`, JSON.stringify(chosen));
        await shot("resume-fresh-choice");
        await page.evaluate(click("oats-confirm-cancel"));
        await page.until(closed, 10);
      } finally {
        // The stage's own roster again, read by the plugin's server.
        changes = {};
        answers();
        await tools.untilSnapshot((snapshot) => snapshot.ok === true && snapshot.agents.some((agent) => agent.instance === TMUX && agent.running === true));
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
        check(items.includes("Restart (OATS)") && items.includes("Stop (OATS)") && !items.includes("Start (OATS)"), `${at} it holds Restart and Stop, and no Start`, JSON.stringify(items));
        check(await pick(page, "Restart (OATS)"), `${at} Restart (OATS) is pressed in the thread's menu`);
        await page.until(phaseIs("ready"), 30);
        const before = await dialog(page);
        check(before.title === "Restart Weekly digest helper" && (await page.evaluate(saysNow)) === JSON.stringify(["Starts a new conversation."]) && !/full mode|stays readable|Save any in-progress|Stops what it is doing/.test(before.body) && (({ text }) => /Runs in bb's full mode: no sandbox\./.test(text) && !/Starts a new conversation/.test(text))(JSON.parse(await page.evaluate(folded("oats-start-details")))) && before.act === "Restart" && before.off === false, `${at} Restart opens its dialog and restarts nothing: its line says that it starts a new conversation (of an agent that is idle nothing is said to be stopped); bb's full mode is under Details`, JSON.stringify(before));
        check(before.focus === "oats-confirm-act", `${at} the focus STARTS on the dialog's primary button, Restart (nothing is being done that it would cut): not on a field`, before.focus);
        await shot("before");
        const order = await walk(page, 5);
        check(order.length === 5 && order[0].endsWith("Details") && same(order.slice(1), ["oats-start-harness", "oats-start-model", "oats-confirm-cancel", "oats-confirm-act"]), `${at} Tab walks Details, the harness, the model, Cancel, Restart and round again (no Refresh status: it is for a Restart that is off)`, JSON.stringify(order));
        await page.evaluate(click("oats-confirm-act"));
        await page.until(phaseIs("running"), 10);
        check((await dialog(page)).body.includes("Restarting…"), `${at} while it restarts the dialog says so`);
        await shot("running");
        await page.until(phaseIs("done"), 20);
        const done = await dialog(page);
        check(done.body.includes("Weekly digest helper restarted."), `${at} the dialog says that it restarted`, JSON.stringify(done));
        check(Boolean(await page.until(`location.pathname.endsWith("/threads/${helper.id}") && ${textOf(testId("oats-status-line"))}.startsWith("Idle")`, 30)), `${at} behind the result the agent's thread is open and loaded (its row says Idle: bb has no turn running on this fixture's thread)`);
        await shot("done");
        await page.evaluate(click("oats-confirm-close"));
        await page.until(closed, 10);

        // A refusal (recorded: a restart on a home that was retired).
        answers({ "session restart": gone("restart") });
        check((await openThreadMenu(page)) && (await pick(page, "Restart (OATS)")), `${at} Restart is asked again from the thread's menu`);
        await page.until(phaseIs("ready"), 30);
        await page.evaluate(click("oats-confirm-act"));
        await page.until(phaseIs("failed"), 20);
        const refused = await dialog(page);
        check(refused.body.includes("OATS refused to restart Weekly digest helper") && refused.body.includes("Refresh its status before another try.") && !refused.body.includes("OATS says:") && !refused.body.includes("E_WORK_INSPECTION_FAILED") && JSON.parse(await page.evaluate(folded("oats-act-details"))).text.includes("directory instance home was removed or exchanged") && JSON.parse(await page.evaluate(folded("oats-act-details"))).text.includes("E_WORK_INSPECTION_FAILED") && refused.body.includes("Refresh status") && refused.focus === "oats-confirm-close", `${at} a refused restart is a person's words, with Refresh status and the focus on Close; why, in the kernel's own line, and the code are under Details`, JSON.stringify(refused));
        await shot("refused");
        const after = await walk(page, 4);
        check(after.length === 4 && after[0] === "oats-start-refresh" && after[1].endsWith("Details") && after[2] === "oats-confirm-close" && after[3] === "oats-start-refresh", `${at} Tab walks Refresh status, Details, Close and round again`, JSON.stringify(after));
        await page.evaluate(click("oats-confirm-close"));
        await page.until(closed, 10);

        // Restart does not stop what it cannot start: a model the person changed to one bb's list does not serve
        // is HELD (the kernel stops the running session before the provider judges the model). Nothing is sent.
        const restartsAsked = () => completeLines(FAKE_LOG).map((line) => JSON.parse(line)).filter((call) => call.argv[0] === "session" && call.argv[1] === "restart").length;
        const asked = restartsAsked();
        check((await openThreadMenu(page)) && (await pick(page, "Restart (OATS)")), `${at} Restart is asked once more from the thread's menu`);
        await page.until(phaseIs("ready"), 30);
        await page.evaluate(fill(testId("oats-start-model"), "a-model-bb-does-not-list"));
        const modelSays = `(document.querySelector(${JSON.stringify(testId("oats-start-model"))}).closest(${JSON.stringify(testId("oats-field"))}).querySelector('[role="alert"]')?.innerText ?? "")`;
        check(Boolean(await page.until(`${modelSays} === "Not found"`, 20)), `${at} a changed model that bb's list does not serve is marked "Not found" on the Model field`, await page.evaluate(modelSays));
        const heldAt = await page.evaluate(`({ off: document.querySelector(${JSON.stringify(testId("oats-confirm-act"))}).disabled, beside: document.querySelector(${JSON.stringify(testId("oats-confirm-blocked"))})?.innerText ?? null, why: document.getElementById(document.querySelector(${JSON.stringify(testId("oats-confirm-act"))}).getAttribute("aria-describedby") ?? "")?.innerText ?? "", folds: document.querySelectorAll('[role="dialog"] details').length, details: document.querySelector(${JSON.stringify(testId("oats-start-unlisted"))})?.closest("details")?.open ?? null, inFold: document.querySelector(${JSON.stringify(testId("oats-start-unlisted"))})?.closest("details")?.getAttribute("data-testid") ?? null, body: document.querySelector('[role="dialog"]').innerText })`);
        check(heldAt.off === true && heldAt.beside === null && heldAt.why === "Not found" && heldAt.folds === 1 && heldAt.inFold === "oats-start-details" && heldAt.details === false && !heldAt.body.includes("Any model ID can be typed") && !heldAt.body.includes("Ready to start."), `${at} Restart is off, described by the field's mark, with no copy of the word beside it; the way to an unlisted model is under the dialog's one Details, closed; nothing says that any model can be typed, or that it is ready to start`, JSON.stringify(heldAt));
        // (The field that holds Restart is what matters now: at phone width the dialog scrolls to it, and says that there is more above.)
        await dialogShot({ page, at, viewport, check }, "restart", "held", testId("oats-start-model"));
        await page.evaluate(`document.querySelector(${JSON.stringify(`${testId("oats-start-details")} summary`)}).click()`);
        const line = await page.until(`document.querySelector(${JSON.stringify(testId("oats-start-details"))}).open && document.querySelector(${JSON.stringify(testId("oats-start-unlisted"))}).innerText.includes("To use a model bb does not list: stop it, then start it with that model.")`, 10);
        check(Boolean(line), `${at} Details holds the one line: to use a model bb does not list, stop it, then start it with that model`);
        await dialogShot({ page, at, viewport, check }, "restart", "held-details", testId("oats-start-unlisted"));
        // Pressed all the same: the dialog stays, and the kernel was asked for no restart.
        await page.evaluate(click("oats-confirm-act"));
        check((await page.evaluate(phaseIs("ready"))) && restartsAsked() === asked, `${at} the held Restart sends nothing: the kernel was asked for no restart`, `${restartsAsked()} restarts asked, ${asked} before`);
        // The field left blank again is the agent's own model: armed, as the dialog opened.
        await page.evaluate(fill(testId("oats-start-model"), ""));
        const armed = await page.until(`document.querySelector(${JSON.stringify(testId("oats-confirm-act"))}).disabled === false && ${modelSays} === ""`, 10);
        check(Boolean(armed), `${at} the model left blank again arms Restart: the agent's own model, unchanged`, await page.evaluate(`JSON.stringify({ off: document.querySelector(${JSON.stringify(testId("oats-confirm-act"))}).disabled, says: ${modelSays}, why: document.querySelector(${JSON.stringify(testId("oats-confirm-blocked"))})?.innerText ?? null, value: document.querySelector(${JSON.stringify(testId("oats-start-model"))}).value })`));
        await page.evaluate(click("oats-confirm-cancel"));
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
        check(await pick(page, "Restart (OATS)"), `${at} Restart (OATS) is pressed in the thread's menu`);
        check(Boolean(await page.until(`${phaseIs("ready")} && document.querySelector(${JSON.stringify(testId("oats-start-thread"))}) !== null`, 30)), `${at} the Restart dialog of an agent whose session was lost points at its thread`);
        const said = JSON.parse(
          await page.evaluate(
            `(() => { const confirm = document.querySelector(${JSON.stringify(confirm)}); const notice = confirm.querySelector(${JSON.stringify(testId("oats-notice"))}); return JSON.stringify({ first: confirm.firstElementChild === notice, title: notice?.querySelector("h3")?.innerText ?? null, open: document.querySelector(${JSON.stringify(testId("oats-start-thread"))})?.innerText ?? null, next: notice?.nextElementSibling?.innerText ?? "" }); })()`,
          ),
        );
        check(
          said.first && said.title === "To continue its conversation, message it instead." && said.open === "Open Weekly digest helper" && said.next.trim() === "Starts a new conversation.",
          `${at} the dialog says FIRST to message it instead to continue its conversation, with Open Weekly digest helper, and then its one line, that a restart starts a new conversation (the agent does not run: nothing is said to be stopped)`,
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
      // (A soul's page lists its agents as the roster says them; the acts of one whose thread bb does not have are on its row.)
      const retire = `[...document.querySelectorAll(${JSON.stringify(`${testId("oats-soul-agent")}[data-instance="weekly-digest-helper"] button`)})].find((button) => button.innerText.trim() === "Retire…")`;
      await page.until(`Boolean(${retire})`, 30);
      await page.evaluate(`${retire}.click()`);
      await page.until(phaseIs("ready"), 30);
      const before = await dialog(page);
      // The image proves what its name says: the dialog is about the agent whose Retire was pressed, and so is the plan in it.
      check(before.title === "Retire Weekly digest helper?" && before.about === "weekly-digest-helper" && before.body.includes("This cannot be undone.") && before.focus === "oats-confirm-cancel", `${at} Retire of an agent with no bb thread opens the dialog of the kernel's plan for it, the focus on Cancel`, JSON.stringify(before));
      await page.shot(`a16-${viewport.name}-plan`); // (the page behind the dialog is the soul's: its controls are its scenes' to measure)
      await page.evaluate(click("oats-confirm-cancel"));
      check(Boolean(await page.until(closed, 10)), `${at} Cancel closes the dialog`);
    },
  },
];
