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

      // the filter and the search
      await open(page, "", ROW);
      await page.evaluate(`document.querySelector(${JSON.stringify(testId("oats-automations-origin-workspace"))}).click()`);
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
      check(/^This computer has no host name, so it runs none of the workspace's schedules\./.test(unnamed), `${at} a host with no name says what that means and what to do`, unnamed);
      await page.shot(`automations-${viewport.name}-host-unnamed`);
    },
  },
  {
    stage: "automations-scheduler-off",
    name: "no host scheduler",
    run: async ({ page, at, viewport, check }) => {
      const off = await open(page, "", testId("oats-automations-scheduler-off"));
      check(off === "The scheduler is not running on this computer, so nothing here runs until it is enabled.", `${at} a scheduler that is off says nothing here runs`, off);
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
  "automations-empty": {
    label: "AU3",
    enter: async ({ fake, statusWithRealIds, threads, untilSnapshot }) => {
      fake({ status: { stdout: statusWithRealIds(threads) }, ...lists("schedule-list-empty.json", "trigger-list-empty.json") });
      await settled(untilSnapshot);
    },
  },
};
