// Automations' live scenes: the page with each list, a row's page of each kind, the notices of
// a host with no name and no scheduler, and the page with `oats` gone. The lists are what the real
// kernel printed (test/fixtures/automations/); their times are the recording's, so "2 d ago" moves
// with the day the checks run.
import { testId, textOf, texts, visible } from "../browser.mjs";

const ROW = testId("oats-automation-row");
const count = (selector) => `document.querySelectorAll(${JSON.stringify(selector)}).length`;
/** Opens the page at a route and waits for what it should draw. → the text of `wait`, or "" */
async function open(page, route, wait) {
  await page.goto(`/plugins/oats/automations${route}`);
  return page.until(`(() => { const t = ${textOf(wait)}; return t === "" ? "" : t; })()`, 30);
}

export default [
  {
    stage: "fixtures",
    name: "the two lists",
    run: async ({ page, at, viewport, check }) => {
      await open(page, "", ROW);
      const tabs = await page.evaluate(texts('[role="tab"]'));
      check(JSON.stringify(tabs) === JSON.stringify(["Schedules 11", "Triggers 7"]), `${at} Automations shows its two tabs with their counts`, JSON.stringify(tabs));
      const groups = await page.evaluate(texts(`${testId("oats-automations-group")} h3`));
      check(JSON.stringify(groups) === JSON.stringify(["Runs on this computer 7", "Needs attention here 3", "Runs elsewhere 1"]), `${at} the schedules are grouped by where they run`, JSON.stringify(groups));
      const scheduler = await page.evaluate(textOf(testId("oats-automations-scheduler")));
      check(/^Scheduler on · checked .+ · up to 5 at once$/.test(scheduler), `${at} the header says the scheduler is on`, scheduler);
      // From bb's wide layout up a row is five cells under their headings; below it a row is a stack.
      const heads = await page.evaluate(visible('[role="columnheader"]'));
      check(heads === !viewport.mobile, `${at} ${viewport.mobile ? "a row is a stack: the headings are not drawn" : "the rows sit under the five headings"}`);
      await page.shot(`automations-${viewport.name}-schedules`);

      await open(page, "/triggers", ROW);
      const n = await page.evaluate(count(ROW));
      check(n === 7, `${at} the Triggers tab lists its 7 triggers`, String(n));
      await page.shot(`automations-${viewport.name}-triggers`);

      // the sidebar's row and its mark: two schedules of the recording failed their last run
      if (!viewport.mobile) {
        const mark = await page.until(`(() => document.querySelector(${JSON.stringify(`${testId("oats-page-link-automations")} ${testId("oats-mark")}`)})?.getAttribute("aria-label") ?? "")()`, 20);
        check(mark === "Automations, a run failed", `${at} the sidebar's Automations row carries a mark named "Automations, a run failed"`, String(mark));
      }

      // the filter and the search
      await open(page, "", ROW);
      await page.evaluate(`[...document.querySelectorAll('[role="radio"]')].find((radio) => radio.innerText.startsWith("Workspace")).click()`);
      const workspace = await page.until(`(() => ${count(ROW)} === 4 ? "4" : "")()`, 10);
      check(workspace === "4", `${at} Workspace shows the 4 schedules a member's repository holds`, String(await page.evaluate(count(ROW))));
      await page.shot(`automations-${viewport.name}-schedules-workspace`);
    },
  },
  {
    stage: "fixtures",
    name: "a row's page",
    run: async ({ page, at, viewport, check }) => {
      const detail = testId("oats-automation-detail");
      // a spawn schedule on bb: the list gives way to the row's page, with Back
      const spawn = await open(page, "/schedules/local/daily-review", testId("oats-automation-spawns"));
      check(/Backend bb/.test(spawn) && /YOLO — skips permission prompts/.test(spawn), `${at} a schedule's page says what it spawns, on bb, in full mode`, spawn);
      check((await page.evaluate(visible(ROW))) === false && (await page.evaluate(visible(testId("oats-automation-back")))) === true, `${at} the list gives way to the row's page, with Back`);
      await page.shot(`automations-${viewport.name}-schedule`);
      // focus: the row's page opens with focus on Back, and Back returns it to the row it was opened from
      await open(page, "", ROW);
      await page.evaluate(`[...document.querySelectorAll(${JSON.stringify(ROW)})].find((row) => row.dataset.id === "local/daily-review").querySelector(${JSON.stringify(testId("oats-automation-open"))}).click()`);
      const onBack = await page.until(`(() => document.activeElement?.dataset?.testid === "oats-automation-back" ? "back" : "")()`, 15);
      check(onBack === "back", `${at} a row's page opens with the focus on Back`, await page.evaluate("document.activeElement?.outerHTML?.slice(0, 120)"));
      await page.evaluate(`document.querySelector(${JSON.stringify(testId("oats-automation-back"))}).click()`);
      const onRow = await page.until(`(() => document.activeElement?.dataset?.testid === "oats-automation-open" ? document.activeElement.closest(${JSON.stringify(ROW)}).dataset.id : "")()`, 15);
      check(onRow === "local/daily-review", `${at} Back returns the focus to the row the page was opened from`, String(onRow));

      // a run that did not happen, with the kernel's reason
      const failed = await open(page, "/schedules/local/hourly-check", testId("oats-automation-run-error"));
      check(/E_BACKEND_SANDBOXED_MODE/.test(failed), `${at} a launch the provider refused says why, in the kernel's words`, failed);
      await page.shot(`automations-${viewport.name}-schedule-launch-failed`);

      // an unknown run state, an invalid definition, a placement that needs attention
      const unknown = await open(page, "/schedules/local/status-check", testId("oats-automation-run-state"));
      check(/^Run state Run state unknown since/.test(unknown), `${at} a run whose state is unknown says so, with the command that checks it`, unknown);
      await page.shot(`automations-${viewport.name}-schedule-run-unknown`);
      const invalid = await open(page, "/schedules/local/legacy-herdr", testId("oats-automation-problem"));
      check(/^Invalid Code E_HERDR_REMOVED Field backend/.test(invalid), `${at} an invalid definition shows the kernel's code, field and message`, invalid);
      await page.shot(`automations-${viewport.name}-schedule-invalid`);
      const where = await open(page, "/schedules/oats-real/reconcile", testId("oats-automation-where"));
      check(/Wrong account here/.test(where) && /Logged in github\.com\/ana/.test(where), `${at} a workspace schedule says why it does not run here`, where);
      await page.shot(`automations-${viewport.name}-schedule-wrong-account`);

      // a pull-request trigger with its state
      await page.goto("/plugins/oats/automations/triggers/oats-real/proposal-review");
      const lead = await page.until(`(() => { const t = ${textOf(`${testId("oats-automation-history")} h3`)}; return /live now/.test(t) ? t : ""; })()`, 30);
      check(lead === "Recent fires on this computer · 2 of 2 live now · 2 fired in all · 1 waiting", `${at} a trigger's page reads its state: what is live, fired and waiting`, lead ?? (await page.evaluate(textOf(detail))));
      await page.shot(`automations-${viewport.name}-trigger`);

      // a capability source's trigger: its parameters and the source's own words, quoted
      await page.goto("/plugins/oats/automations/triggers/oats-real/harvest-review");
      const skipped = await page.until(`(() => ${textOf(testId("oats-automation-skipped"))})()`, 30);
      check(/says: harvest\/y not judged yet harvest\/z <img src=x onerror=alert\(1\)>/.test(skipped ?? ""), `${at} a capability source's words are quoted text, under whose they are`, skipped);
      const made = await page.evaluate(`document.querySelector(${JSON.stringify(detail)}).querySelectorAll("img, a").length`);
      check(made === 0, `${at} no image and no link is made from a source's text`, String(made));
      await page.shot(`automations-${viewport.name}-trigger-source`);
    },
  },
  {
    stage: "automations-host-unnamed",
    name: "a host with no name",
    run: async ({ page, at, viewport, check }) => {
      const unnamed = await open(page, "", testId("oats-automations-host-unnamed"));
      check(/^This computer has no host name It runs none of the workspace's schedules\./.test(unnamed), `${at} a host with no name says what that means and what to do`, unnamed);
      await page.shot(`automations-${viewport.name}-host-unnamed`);
    },
  },
  {
    stage: "automations-scheduler-off",
    name: "no host scheduler",
    run: async ({ page, at, viewport, check }) => {
      const off = await open(page, "", testId("oats-automations-scheduler-off"));
      check(off === "The scheduler is not running on this computer Nothing here runs until it is enabled.", `${at} a scheduler that is off says nothing here runs`, off);
      const header = await page.evaluate(textOf(testId("oats-automations-scheduler")));
      check(header === "Scheduler off", `${at} the header says Scheduler off`, header);
      await page.shot(`automations-${viewport.name}-scheduler-off`);
    },
  },
  {
    stage: "automations-empty",
    name: "no schedule and no trigger yet",
    run: async ({ page, at, viewport, check }) => {
      const empty = await open(page, "", testId("oats-automations-empty"));
      check(/^No schedules yet/.test(empty), `${at} with no schedule yet the page says so and how to add one`, empty);
      const foot = await page.evaluate(textOf(testId("oats-automations-foot")));
      check(/^Workspace items appear after the next sync/.test(foot), `${at} before the first sync the page says when workspace items appear`, foot);
      await page.shot(`automations-${viewport.name}-empty`);
    },
  },
  {
    stage: "automations-failed",
    name: "a list the kernel refuses",
    run: async ({ page, at, viewport, check }) => {
      const failed = await open(page, "", testId("oats-automations-failed"));
      check(failed === "Schedules could not be read oats-schedules.json: jobs must be an object E_SCHEDULE_INVALID Retry", `${at} a list the kernel refuses says so in words, then the kernel's message, its code after, with Retry`, failed);
      const tabs = await page.evaluate(texts('[role="tab"]'));
      check(JSON.stringify(tabs) === JSON.stringify(["Schedules", "Triggers 7"]), `${at} the other list is still read`, JSON.stringify(tabs));
      await page.shot(`automations-${viewport.name}-failed`);
    },
  },
  {
    stage: "no-oats",
    name: "Automations without oats",
    run: async ({ page, at, viewport, check }) => {
      const gate = await open(page, "", testId("oats-automations-gate"));
      check(gate === "Schedules need the OATS CLI", `${at} with oats gone the page says what it needs`, gate);
      await page.shot(`automations-${viewport.name}-no-oats`);
    },
  },
];

const lists = (schedule, trigger) => ({ "schedule list": { file: `automations/${schedule}` }, "trigger list": { file: `automations/${trigger}` } });
const settled = (untilSnapshot) => untilSnapshot((snapshot) => snapshot.ok === true);

export const stages = {
  // `host.name` taken out of oats-local.yaml: every workspace row is unplaced.
  "automations-host-unnamed": {
    label: "AU1",
    enter: async ({ fake, statusWithRealIds, threads, untilSnapshot }) => {
      fake({ status: { stdout: statusWithRealIds(threads) }, ...lists("schedule-list-host-unnamed.json", "trigger-list-host-unnamed.json") });
      await settled(untilSnapshot);
    },
  },
  // The lists as they were before the host timer was installed.
  "automations-scheduler-off": {
    label: "AU2",
    enter: async ({ fake, statusWithRealIds, threads, untilSnapshot }) => {
      fake({ status: { stdout: statusWithRealIds(threads) }, ...lists("schedule-list-scheduler-off.json", "trigger-list.json") });
      await settled(untilSnapshot);
    },
  },
  "automations-failed": {
    label: "AU4",
    enter: async ({ fake, statusWithRealIds, threads, untilSnapshot }) => {
      const refusal = JSON.stringify({ schemaVersion: 1, ok: false, error: { code: "E_SCHEDULE_INVALID", message: "oats-schedules.json: jobs must be an object" } });
      fake({ status: { stdout: statusWithRealIds(threads) }, "schedule list": { stdout: refusal } });
      await settled(untilSnapshot);
    },
  },
  "automations-empty": {
    label: "AU3",
    enter: async ({ fake, statusWithRealIds, threads, untilSnapshot }) => {
      fake({ status: { stdout: statusWithRealIds(threads) }, ...lists("schedule-list-empty.json", "trigger-list-empty.json") });
      await settled(untilSnapshot);
    },
  },
};
