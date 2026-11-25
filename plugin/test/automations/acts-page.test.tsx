// @vitest-environment jsdom
// Acting on a row from the Automations page (D-270 to D-272, D-276 to D-278, D-281, D-282): each
// act calls the plugin's server once with the row's id, and what the kernel answered or refused is
// said where the person is looking, in the Desktop's words.
import type { ComponentType } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, waitFor, within } from "@testing-library/react";
import { renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { parseHostInstall, parseScheduleReconcile, parseScheduleRun, parseTest } from "../../kernel/automations-acts";
import { TestCard } from "../../app/automations/acts";
import { handlers, loadApp, resetApp, sidebarThreads } from "../helpers/render";
import type { Contract, Handlers } from "../helpers/render";
import { experimental_PluginRpcCallError as PluginRpcCallError } from "@get-bb/plugin-sdk/app";
import { failureOf } from "../../app/automations/acts";
import { RunningContext } from "../../app/automations/here";
import { UNCONFIRMED_ISSUE } from "../../contract/shared";
import { failedTitle, summaryFailed } from "../../app/automations/words";
import { AT, OATS, STATUSES } from "./handlers";
import { answer, rowOf, schedules, triggers } from "./fixtures";

afterEach(resetApp);
// A test that sets the clock (below) gives it back.
afterEach(() => {
  vi.useRealTimers();
});

/** The page's component as the slot drew it: drawn again at another route, it is the same page. */
let Drawn: ComponentType<{ subPath: string }> | undefined;
async function page(subPath = "", over: Partial<Handlers> = {}) {
  const app = await loadApp();
  const panel = app.navPanels.find((candidate) => candidate.id === "automations")!;
  Drawn = panel.component as ComponentType<{ subPath: string }>;
  return renderSlot<{ subPath: string }, Contract>(panel, { subPath }, { rpc: handlers(over), sidebarThreads: sidebarThreads() });
}
type Slot = Awaited<ReturnType<typeof page>>;
const calls = (slot: Slot, method: string) => slot.inspection.rpcCalls.filter((call) => call.method === method).map((call) => call.input);
const row = async (slot: Slot, id: string) => (await slot.findAllByTestId("oats-automation-row")).find((entry) => entry.dataset.id === id)!;
/** Opens a row's menu and answers its items by their labels. */
async function menu(slot: Slot, id: string) {
  const entry = await row(slot, id);
  fireEvent.click(within(within(entry).getByTestId("oats-automation-menu")).getByRole("button"));
  const items = within(entry).getAllByRole("menuitem");
  return { labels: items.map((item) => item.textContent), press: (label: string) => fireEvent.click(items.find((item) => item.textContent === label)!) };
}
/** On a row's own page: opens its "…" menu and presses the act of that label. */
async function pageAct(slot: Slot, label: string) {
  const holder = await slot.findByTestId("oats-automation-detail-menu");
  fireEvent.click(within(holder).getByRole("button"));
  fireEvent.click(within(holder).getByRole("menuitem", { name: label }));
}
/** A row's switch in the list. */
const switchOf = async (slot: Slot, id: string) => within(await row(slot, id)).getByRole("switch");
const value = <T,>(parsed: { ok: true; value: T } | { ok: false; error: unknown }): T => {
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.error));
  return parsed.value;
};
const refuse = (message: string) => (): never => {
  throw new Error(message);
};
/** The plugin's server turning a request down before any process, as it reaches the app: bb's code `invalid`, and no code leading the message. */
const turnedDown = (message: string) => (): never => {
  throw new PluginRpcCallError({ code: "invalid", message });
};
const NOT_LISTED = '"local/daily-review" is not a schedule of this OATS deployment\'s current list';
const result = async (slot: Slot) => (await slot.findByTestId("oats-automations-result")).textContent;

describe("a row's menu (D-271)", () => {
  it("holds the Desktop's acts for what the row is", async () => {
    const slot = await page();
    expect((await menu(slot, "local/daily-review")).labels).toEqual(["Run now", "Test", "Edit summary", "Open file", "Delete…"]);
    resetApp();
    const again = await page();
    // a run whose state is unknown can be checked; a schedule that is off here is turned on, and not run
    expect((await menu(again, "local/status-check")).labels).toEqual(["Run now", "Test", "Check run state", "Edit summary", "Open file", "Delete…"]);
    resetApp();
    const off = await page();
    expect((await menu(off, "local/weekly-cleanup")).labels).toEqual(["Test", "Edit summary", "Open file", "Delete…"]);
    resetApp();
    // a workspace schedule is changed and removed in its repository; one another computer runs has no switch
    const workspace = await page();
    expect((await menu(workspace, "oats-real/nightly-digest")).labels).toEqual(["Run now", "Test", "Open file"]);
    resetApp();
    const elsewhere = await page();
    expect((await menu(elsewhere, "oats-real/weekly-report")).labels).toEqual(["Test", "Open file"]);
    resetApp();
    const trigger = await page("");
    expect((await menu(trigger, "local/pr-triage")).labels).toEqual(["Test", "Edit summary", "Open file"]);
  });

  it("holds no Open and no on or off: the row and its chevron open it, and its switch turns it", async () => {
    const slot = await page();
    const { labels } = await menu(slot, "oats-real/nightly-digest");
    expect(labels.some((label) => /^Open$|^Turn /.test(label ?? ""))).toBe(false);
    fireEvent.click(within(await row(slot, "oats-real/nightly-digest")).getByTestId("oats-automation-open"));
    expect(slot.inspection.navigateCalls).toEqual([{ method: "toPluginPanel", path: "automations", options: { subPath: "schedules/oats-real/nightly-digest" } }]);
  });

  it("without the feature that writes summaries, Edit summary is not offered", async () => {
    const slot = await page("", { automations: () => ({ at: AT, hostId: "host_falcon", oats: { ...OATS, features: ["automations"] }, statuses: STATUSES(), schedule: { ok: true as const, list: schedules() }, trigger: { ok: true as const, list: triggers() } }) });
    expect((await menu(slot, "local/daily-review")).labels).not.toContain("Edit summary");
  });
});

describe("on and off on this computer (D-272)", () => {
  it("the switch says what a press does, and turns the row off through the kernel; the lists are read again", async () => {
    const slot = await page("", { automationEnable: ({ kind, id }) => ({ row: rowOf(kind === "schedule" ? schedules() : triggers(), id) }) });
    const toggle = within(await row(slot, "local/daily-review")).getByRole("switch");
    expect([toggle.getAttribute("aria-checked"), toggle.textContent, toggle.title]).toEqual(["true", "This computerOn", "On here: click to turn it off on this computer"]);
    fireEvent.click(toggle);
    await waitFor(() => expect(calls(slot, "automationEnable")).toEqual([{ kind: "schedule", id: "local/daily-review", enabled: false }]));
    await waitFor(() => expect(calls(slot, "automations").length).toBeGreaterThan(1));
  });

  it("a row that is off says a press turns it on; one not trusted here says it runs only once trusted; one another computer runs has no switch", async () => {
    const slot = await page();
    const off = within(await row(slot, "local/weekly-cleanup")).getByRole("switch");
    expect([off.getAttribute("aria-checked"), off.title]).toEqual(["false", "Off here: click to turn it on"]);
    expect(within(await row(slot, "oats-real/release-check")).getByRole("switch").title).toBe("On here, but not trusted on this computer: it runs only once oats-local.yaml trusts it");
    expect(within(await row(slot, "oats-real/weekly-report")).queryByRole("switch")).toBeNull();
  });

  it("the kernel's refusal is said in words, its code after", async () => {
    const slot = await page("", { automationEnable: refuse("E_LOCAL_BUSY: oats-local.yaml is being changed by another command") });
    fireEvent.click(await switchOf(slot, "oats-real/nightly-digest"));
    expect(await result(slot)).toBe("nightly-digest was not turned off hereoats-local.yaml is being changed by another commandE_LOCAL_BUSYDismiss");
    expect(within(slot.getByTestId("oats-automations-result")).getByTestId("oats-result").dataset.tone).toBe("failed");
  });
});

// An act whose answer was lost may have happened: only a refusal says it did not. One rule for every act.
describe("a failure that is not a refusal claims nothing", () => {
  const LOST = "OATS_TIMEOUT: `oats` did not answer within 60 s and was stopped";
  const said = "`oats` did not answer within 60 s and was stoppedOATS_TIMEOUTDismiss";
  const off = () => ({ at: AT, hostId: "host_falcon", oats: OATS, statuses: STATUSES(), schedule: { ok: true as const, list: schedules("schedule-list-scheduler-off.json") }, trigger: { ok: true as const, list: triggers() } });

  it("what a failure was, read from the error: refused by the kernel, turned down by the plugin's server, or an answer that was lost", () => {
    const of = (error: unknown) => failureOf(error);
    // the kernel's own no
    expect(of(new Error("E_AUTOMATION_NOT_HERE: it does not run on this host"))).toEqual({ code: "E_AUTOMATION_NOT_HERE", message: "it does not run on this host", refused: true });
    // the plugin's server turning the request down before any process: bb's code, no code leading the message
    expect(of(new PluginRpcCallError({ code: "invalid", message: NOT_LISTED }))).toEqual({ code: null, message: NOT_LISTED, refused: true });
    // an answer that was lost, by each of the plugin's own codes; and a call nobody answered
    for (const code of ["OATS_TIMEOUT", "OATS_BAD_ANSWER", "OATS_NOT_JSON", "OATS_FAILED"]) expect(of(new Error(`${code}: lost`)).refused).toBe(false);
    expect(of(new PluginRpcCallError({ code: "transport_error", message: "the server did not answer" })).refused).toBe(false);
    expect(of(new Error("the server did not answer")).refused).toBe(false);
    // the kernel's marker that it could not confirm what is left: not a plain no
    expect(of(Object.assign(new Error("E_SCHEDULE_HOST: the timer was written, and the service manager failed"), { issues: [UNCONFIRMED_ISSUE] }))).toMatchObject({ code: "E_SCHEDULE_HOST", refused: false });
    const failed = { no: "x was not run", maybe: "x may not have been run" };
    expect([failedTitle(true, failed), failedTitle(false, failed)]).toEqual(["x was not run", "x may not have been run"]);
  });

  it("the plugin's server turning the request down: the act did not happen, and the page says so", async () => {
    const slot = await page("", { scheduleRun: turnedDown(NOT_LISTED) });
    (await menu(slot, "local/daily-review")).press("Run now");
    expect(await result(slot)).toBe(`daily-review was not run${NOT_LISTED}Dismiss`);
  });

  it("the plugin's server turning a test down: the test did not run", async () => {
    const slot = await page("schedules/local/daily-review", { automationTest: turnedDown(NOT_LISTED) });
    await pageAct(slot, "Test");
    expect((await slot.findByTestId("oats-automation-test")).textContent).toBe(`Test resultThe test did not run.${NOT_LISTED}`);
  });

  it("the switch", async () => {
    const slot = await page("", { automationEnable: refuse(LOST) });
    fireEvent.click(await switchOf(slot, "oats-real/nightly-digest"));
    expect(await result(slot)).toBe(`nightly-digest may not have been turned off here${said}`);
  });

  it("Run now", async () => {
    const slot = await page("", { scheduleRun: refuse(LOST) });
    (await menu(slot, "local/daily-review")).press("Run now");
    expect(await result(slot)).toBe(`daily-review may not have been run${said}`);
  });

  it("Check run state", async () => {
    const slot = await page("schedules/local/status-check", { scheduleReconcile: refuse(LOST) });
    await pageAct(slot, "Check run state");
    expect(await result(slot)).toBe(`The run state of status-check may not have been checked${said}`);
  });

  it("Delete", async () => {
    const slot = await page("", { scheduleRemove: refuse(LOST) });
    (await menu(slot, "local/daily-review")).press("Delete…");
    const dialog = await slot.findByRole("dialog");
    fireEvent.click(within(dialog).getByTestId("oats-confirm-act"));
    await waitFor(() => expect(dialog.textContent).toContain("daily-review may not have been deleted"));
    expect(dialog.textContent).not.toContain("was not deleted");
  });

  it("Enable scheduler", async () => {
    const slot = await page("", { automations: off, schedulerEnable: refuse(LOST) });
    fireEvent.click(await slot.findByTestId("oats-automations-enable-scheduler"));
    const dialog = await slot.findByRole("dialog");
    fireEvent.click(within(dialog).getByTestId("oats-confirm-act"));
    await waitFor(() => expect(dialog.textContent).toContain("The scheduler may not have been enabled"));
  });

  it("Enable scheduler turned down before any process: nothing was enabled", async () => {
    const slot = await page("", { automations: off, schedulerEnable: turnedDown("the schedules of this deployment could not be read") });
    fireEvent.click(await slot.findByTestId("oats-automations-enable-scheduler"));
    const dialog = await slot.findByRole("dialog");
    fireEvent.click(within(dialog).getByTestId("oats-confirm-act"));
    await waitFor(() => expect(dialog.textContent).toContain("The scheduler was not enabled"));
  });
});

describe("Run now and Check run state (D-277)", () => {
  const ran = (file: string) => () => value(parseScheduleRun(answer(file)));

  it("a launch says Agent launched, by the schedule's id", async () => {
    const slot = await page("", { scheduleRun: ran("schedule-run.json") });
    (await menu(slot, "local/daily-review")).press("Run now");
    expect(await result(slot)).toBe("local/daily-review: Agent launchedDismiss");
    expect(calls(slot, "scheduleRun")).toEqual([{ id: "local/daily-review" }]);
    fireEvent.click(slot.getByTestId("oats-automations-result-dismiss"));
    expect(slot.queryByTestId("oats-automations-result")).toBeNull();
  });

  it("a launch the provider refused says Launch failed, with the kernel's reason and its code", async () => {
    const slot = await page("", { scheduleRun: ran("schedule-run-launch-failed.json") });
    (await menu(slot, "local/hourly-check")).press("Run now");
    expect(await result(slot)).toMatch(/^local\/hourly-check: Launch failedoats-developer-hourly-check-\d{12} was not launched: .*full mode only.*E_BACKEND_SANDBOXED_MODEDismiss$/);
    expect(within(slot.getByTestId("oats-automations-result")).getByTestId("oats-result").dataset.tone).toBe("failed");
  });

  it("a kernel error that looks like a secret is withheld by itself: the result still says which schedule and what happened", async () => {
    const failed = value(parseScheduleRun(answer("schedule-run-launch-failed.json")));
    const slot = await page("", { scheduleRun: () => ({ run: { ...failed.run!, error: "x was not launched: git clone https://ana:hunter2@github.com/acme/app failed" } }) });
    (await menu(slot, "local/hourly-check")).press("Run now");
    expect(await result(slot)).toBe("local/hourly-check: Launch failed[withheld]E_BACKEND_SANDBOXED_MODEDismiss");
  });

  it("a command whose effects are not known says so", async () => {
    const slot = await page("", { scheduleRun: ran("schedule-run-command.json") });
    (await menu(slot, "local/status-check")).press("Run now");
    expect(await result(slot)).toBe("local/status-check: Launch state unknown — needs attentioncommand answered no valid envelope; its side effects are unconfirmedDismiss");
    expect(within(slot.getByTestId("oats-automations-result")).getByTestId("oats-result").dataset.tone).toBe("unknown");
  });

  it("a refusal to run keeps the kernel's message and code", async () => {
    const slot = await page("", { scheduleRun: refuse("E_AUTOMATION_NOT_HERE: oats-real/nightly-digest does not run on this host (owner-mismatch)") });
    (await menu(slot, "oats-real/nightly-digest")).press("Run now");
    expect(await result(slot)).toBe("nightly-digest was not runoats-real/nightly-digest does not run on this host (owner-mismatch)E_AUTOMATION_NOT_HEREDismiss");
  });

  it("Check run state, from the run-state card: still unknown, with what the kernel says to do", async () => {
    const slot = await page("schedules/local/status-check", { scheduleReconcile: () => value(parseScheduleReconcile(answer("schedule-reconcile.json"))) });
    await pageAct(slot, "Check run state");
    expect(await result(slot)).toMatch(/^Run state is still unknown\.the command's effects cannot be proven .*oats schedule reconcile status-check --clear.*Dismiss$/);
    expect(calls(slot, "scheduleReconcile")).toEqual([{ id: "local/status-check" }]);
  });
});

describe("Test (D-281, D-282)", () => {
  const tested = (file: string, kind: "schedule" | "trigger", source: string | null) => () => value(parseTest(answer(file), kind, source));
  const card = async (slot: Slot) => (await slot.findByTestId("oats-automation-test")).textContent;

  it("a schedule that would run here", async () => {
    // The page draws against its own clock, and the recorded due time is a fixed day: the test sets the
    // clock (two hours before it), and only the clock, so the page's waits and timers run as they do.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.parse(value(parseTest(answer("schedule-test.json"), "schedule", null)).nextDue!) - 2 * 3600e3);
    const slot = await page("schedules/local/daily-review", { automationTest: tested("schedule-test.json", "schedule", null) });
    await pageAct(slot, "Test");
    expect(await card(slot)).toBe("Test resultReady: it would run here.Next due in 2 h");
    expect(calls(slot, "automationTest")).toEqual([{ kind: "schedule", id: "local/daily-review" }]);
  });

  it("under a scheduler that is off the card says ready once it is on, and no due time", async () => {
    const off = () => ({ at: AT, hostId: "host_falcon", oats: OATS, statuses: STATUSES(), schedule: { ok: true as const, list: schedules("schedule-list-scheduler-off.json") }, trigger: { ok: true as const, list: triggers() } });
    const slot = await page("schedules/local/daily-review", { automations: off, automationTest: tested("schedule-test.json", "schedule", null) });
    await pageAct(slot, "Test");
    expect(await card(slot)).toBe("Test resultReady once the scheduler is on.");
    // The card alone, both ways: the kernel's test knows nothing of the timer, the page does.
    const test = value(parseTest(answer("schedule-test.json"), "schedule", null));
    const drawn = (running: boolean) => {
      const view = render(
        <RunningContext.Provider value={running}>
          <TestCard tested={{ test }} now={Date.parse(test.nextDue!) - 2 * 3600e3} />
        </RunningContext.Provider>,
      );
      const text = within(view.container).getByTestId("oats-automation-test").textContent;
      view.unmount();
      return text;
    };
    expect([drawn(true), drawn(false)]).toEqual(["Test resultReady: it would run here.Next due in 2 h", "Test resultReady once the scheduler is on."]);
  });

  it("a due time ahead is next; one that has passed was due, and is never called next", () => {
    const test = value(parseTest(answer("schedule-test.json"), "schedule", null));
    const due = Date.parse(test.nextDue!);
    expect(Number.isFinite(due)).toBe(true);
    const drawn = (now: number) => {
      const view = render(<TestCard tested={{ test }} now={now} />);
      const text = view.getByTestId("oats-automation-test").textContent;
      view.unmount();
      return text;
    };
    expect(drawn(due - 2 * 3600e3)).toBe("Test resultReady: it would run here.Next due in 2 h");
    expect(drawn(due + 3 * 60e3)).toBe("Test resultReady: it would run here.Was due 3 min ago");
    expect(drawn(due)).toMatch(/^Test resultReady: it would run here\.Was due /);
    expect(drawn(due + 2 * 86400e3)).not.toContain("Next");
  });

  // A failure that is not a refusal claims nothing: the command may have run, the write may have landed.
  it("a test whose answer cannot be read does not say it did not run", async () => {
    const slot = await page("triggers/oats-real/proposal-review", { automationTest: refuse("OATS_BAD_ANSWER: `oats trigger test` answered with a document the plugin cannot read") });
    await pageAct(slot, "Test");
    expect(await card(slot)).toBe("Test resultThe test gave no answer the plugin can read.`oats trigger test` answered with a document the plugin cannot readOATS_BAD_ANSWER");
  });

  it("one placed elsewhere is not ready here, and says why", async () => {
    const slot = await page("schedules/oats-real/weekly-report", { automationTest: tested("schedule-test-elsewhere.json", "schedule", null) });
    await pageAct(slot, "Test");
    expect(await card(slot)).toMatch(/^Test resultNot ready on this computer\.oats-real\/weekly-report does not run on this host \(assigned-elsewhere: runs on report-server; this host is bb-box\)/);
  });

  it("a pull-request trigger: who gh acts as and what would fire now, with each agent's name and what is held, and why", async () => {
    const slot = await page("triggers/oats-real/proposal-review", { automationTest: tested("trigger-test.json", "trigger", "github.pull_request") });
    await pageAct(slot, "Test");
    expect(await card(slot)).toBe("Test resultReady: it would run here.gh acts as anaWould fire now:#41 → oats-developer-review-pr-41#42 → oats-developer-review-pr-42#43 → oats-developer-review-pr-43 (held: concurrency.max 2 reached (2 live))");
    expect(calls(slot, "automationTest")).toEqual([{ kind: "trigger", id: "oats-real/proposal-review" }]);
  });

  it("a test the kernel refuses leads with a person's words: that it did not run, the kernel's message, its code after", async () => {
    const slot = await page("triggers/oats-real/proposal-review", { automationTest: refuse('E_TRIGGER_UNKNOWN: no trigger "oats-real/proposal-review" in /abs/deployment') });
    await pageAct(slot, "Test");
    expect(await card(slot)).toBe('Test resultThe test did not run.no trigger "oats-real/proposal-review" in /abs/deploymentE_TRIGGER_UNKNOWN');
  });

  it("a test that does not answer in time says so, and that nothing was recorded", async () => {
    const slot = await page("triggers/oats-real/proposal-review", { automationTest: refuse("OATS_TIMEOUT: `oats` did not answer within 45 s and was stopped") });
    await pageAct(slot, "Test");
    expect(await card(slot)).toBe("Test resultThe test did not answer in time. Nothing was recorded.OATS_TIMEOUT");
  });

  it("a capability source's trigger: first what will run and with which parameters, and nothing runs until Run test", async () => {
    const slot = await page("triggers/oats-real/harvest-review", { automationTest: tested("trigger-test-source.json", "trigger", "acme.graph:harvest-branches") });
    await pageAct(slot, "Test");
    const confirm = await slot.findByTestId("oats-automation-test-confirm");
    expect(confirm.textContent).toBe(
      "Test this triggerThis runs acme.graph's source command on this computer, now, once. Nothing is recorded and nothing is spawned.The command receives these parameters.From the trigger file:prefix = harvest/graph = kbCancelRun test",
    );
    expect(calls(slot, "automationTest")).toEqual([]);
    fireEvent.click(slot.getByTestId("oats-automation-test-cancel"));
    expect(slot.queryByTestId("oats-automation-test-confirm")).toBeNull();
    expect(calls(slot, "automationTest")).toEqual([]);

    await pageAct(slot, "Test");
    fireEvent.click(await slot.findByTestId("oats-automation-test-run"));
    await waitFor(() => expect(calls(slot, "automationTest")).toEqual([{ kind: "trigger", id: "oats-real/harvest-review", runSource: true }]));
    const answered = await card(slot);
    expect(answered).toMatch(/^Test resultThe source answered: 2 events, 1 filtered, 2 skipped, 2 refusedRefused by OATSacme\.graph · harvest-branches says:/);
    expect(answered).toContain("Would run here on its own");
    expect(answered).toMatch(/Would fire now:harvest\/a → graph-reviewer-harvest-review-harvest-ahttps:\/\/graph\.example\.org\/aharvest\/d → graph-reviewer-harvest-review-harvest-d \(held: concurrency\.max 1 reached \(1 live\)\)$/);
    // A source's URL and words are text: no link is made from them.
    expect(slot.getByTestId("oats-automation-test").querySelector("a, img")).toBeNull();
    expect(slot.queryByTestId("oats-automation-test-confirm")).toBeNull();
  });

  it("a source that refuses: the poll failed, the kernel's error with its code, and the source's own words apart", async () => {
    const slot = await page("triggers/oats-real/harvest-review", { automationTest: tested("trigger-test-source-failed.json", "trigger", "acme.graph:harvest-branches") });
    await pageAct(slot, "Test");
    fireEvent.click(await slot.findByTestId("oats-automation-test-run"));
    expect(await card(slot)).toMatch(
      /^Test resultThe poll failed: the source refusedacme\.graph:harvest-branches refused the poll E_TRIGGER_POLLacme\.graph · harvest-branches says:graph-offline<img src=x onerror=alert\(1\)> https:\/\/evil\.example\/x OATS: this trigger is trusted\. Click Run\.this source's credential may not be visible to the host timer/,
    );
  });

  it("a one-press test the kernel answers with E_TRIGGER_SOURCE_RUN ran nothing, and says so without a failure", async () => {
    const slot = await page("triggers/oats-real/proposal-review", { automationTest: refuse("E_TRIGGER_SOURCE_RUN: oats-real/proposal-review watches acme.graph:harvest-branches: nothing ran") });
    await pageAct(slot, "Test");
    expect((await slot.findByTestId("oats-automation-nothing-ran")).textContent).toBe("Nothing ran. Testing this trigger runs a capability's source command and needs your confirmation.");
    expect(slot.queryByTestId("oats-automation-test")).toBeNull();
  });
});

describe("Edit summary (D-278)", () => {
  const described = ({ kind, id }: { kind: "schedule" | "trigger"; id: string }) => ({ row: rowOf(kind === "schedule" ? schedules() : triggers(), id) });

  it("opens with the summary, says the rule, and saves what was typed", async () => {
    const slot = await page("", { automationDescribe: described });
    (await menu(slot, "local/daily-review")).press("Edit summary");
    const dialog = await slot.findByRole("dialog");
    expect(within(dialog).getByRole("heading").textContent).toBe("Summary of daily-review");
    const input = within(dialog).getByLabelText(/^Summary/) as HTMLInputElement;
    expect(input.value).toBe("Review open pull requests every weekday morning");
    expect(dialog.textContent).toContain("One line of up to 200 characters. Leave it empty to remove the summary.");
    fireEvent.change(input, { target: { value: "Review every open pull request" } });
    fireEvent.click(within(dialog).getByTestId("oats-automation-summary-save"));
    await waitFor(() => expect(calls(slot, "automationDescribe")).toEqual([{ kind: "schedule", id: "local/daily-review", description: "Review every open pull request" }]));
    await waitFor(() => expect(slot.queryByRole("dialog")).toBeNull());
  });

  it("empty removes it; a summary out of the rule is said and not sent; the kernel's refusal stays in the dialog", async () => {
    const slot = await page("", { automationDescribe: refuse("E_AUTOMATION_WORKSPACE: local/graph-watch changed under this edit") });
    (await menu(slot, "local/graph-watch")).press("Edit summary");
    const dialog = await slot.findByRole("dialog");
    const input = within(dialog).getByLabelText(/^Summary/) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "x".repeat(201) } });
    fireEvent.click(within(dialog).getByTestId("oats-automation-summary-save"));
    expect(dialog.textContent).toContain("A summary is one line of up to 200 characters, without control characters.");
    expect(calls(slot, "automationDescribe")).toEqual([]);
    fireEvent.change(input, { target: { value: "" } });
    fireEvent.click(within(dialog).getByTestId("oats-automation-summary-save"));
    await waitFor(() => expect(calls(slot, "automationDescribe")).toEqual([{ kind: "trigger", id: "local/graph-watch", description: "" }]));
    await waitFor(() => expect(dialog.textContent).toContain("The summary was not saved: local/graph-watch changed under this edit (E_AUTOMATION_WORKSPACE)"));
    // A write whose answer is lost may have landed: the dialog does not say it was not saved.
    expect([summaryFailed(false, "OATS_TIMEOUT", "`oats` did not answer within 15 s and was stopped"), summaryFailed(true, null, NOT_LISTED), summaryFailed(false, null, "the server did not answer")]).toEqual([
      "The summary may not have been saved: `oats` did not answer within 15 s and was stopped (OATS_TIMEOUT)",
      `The summary was not saved: ${NOT_LISTED}`,
      "The summary may not have been saved: the server did not answer",
    ]);
    fireEvent.click(within(dialog).getByTestId("oats-automation-summary-cancel"));
    expect(slot.queryByRole("dialog")).toBeNull();
  });
});

describe("Delete (D-276)", () => {
  it("asks first, in the Desktop's sentence, with the focus on Cancel; then deletes and says so", async () => {
    const slot = await page("schedules/local/weekly-cleanup", { scheduleRemove: () => ({ removed: "weekly-cleanup" }) });
    await pageAct(slot, "Delete…");
    const dialog = await slot.findByRole("dialog");
    expect(within(dialog).getByRole("heading", { level: 2 }).textContent).toBe("Delete schedule");
    expect(dialog.textContent).toContain("weekly-cleanup is removed from this computer and stops running here.");
    await waitFor(() => expect(document.activeElement).toBe(within(dialog).getByTestId("oats-confirm-cancel")));
    expect(calls(slot, "scheduleRemove")).toEqual([]);
    fireEvent.click(within(dialog).getByTestId("oats-confirm-act"));
    await waitFor(() => expect(calls(slot, "scheduleRemove")).toEqual([{ id: "local/weekly-cleanup" }]));
    await waitFor(() => expect(dialog.textContent).toContain("weekly-cleanup was deleted"));
    // Its page has nothing left to show: back to the list.
    expect(slot.inspection.navigateCalls).toEqual([{ method: "toPluginPanel", path: "automations", options: { subPath: "" } }]);
  });

  it("Cancel deletes nothing; the kernel's refusal is shown in the dialog", async () => {
    const slot = await page("", { scheduleRemove: refuse("E_SCHEDULE_RUNNING: daily-review is running; stop it or pass --force") });
    (await menu(slot, "local/daily-review")).press("Delete…");
    fireEvent.click(within(await slot.findByRole("dialog")).getByTestId("oats-confirm-cancel"));
    expect(slot.queryByRole("dialog")).toBeNull();
    expect(calls(slot, "scheduleRemove")).toEqual([]);
    (await menu(slot, "local/daily-review")).press("Delete…");
    const dialog = await slot.findByRole("dialog");
    fireEvent.click(within(dialog).getByTestId("oats-confirm-act"));
    await waitFor(() => expect(dialog.textContent).toContain("daily-review was not deleted"));
    expect(dialog.textContent).toContain("E_SCHEDULE_RUNNING");
  });
});

describe("Enable scheduler (D-270)", () => {
  const off = () => ({ at: AT, hostId: "host_falcon", oats: OATS, statuses: STATUSES(), schedule: { ok: true as const, list: schedules("schedule-list-scheduler-off.json") }, trigger: { ok: true as const, list: triggers() } });

  it("names the machine bb chose, which need not be the one the person sits at: the notice, the confirmation, the rows and their switches", async () => {
    const slot = await page("", { automations: () => ({ ...off(), machine: "falcon" }) });
    expect((await slot.findByTestId("oats-automations-scheduler-off")).textContent).toBe("The scheduler is off on falconEnable scheduler");
    expect(slot.container.textContent).not.toMatch(/this (computer|machine)/i);
    expect(within(await row(slot, "local/daily-review")).getByRole("switch").getAttribute("aria-label")).toBe("local/daily-review enabled on falcon");
    fireEvent.click(await slot.findByTestId("oats-automations-enable-scheduler"));
    const dialog = await slot.findByRole("dialog");
    expect(dialog.textContent).toContain("OATS installs its scheduler's timer on falcon, for the account bb's machine runs as:");
    expect(dialog.textContent).toContain("Nothing else on falcon is changed.");
    expect(dialog.textContent).not.toMatch(/this (computer|machine)/i);
  });

  it("is offered where the scheduler is off, says what it installs on this computer, and installs nothing before the press", async () => {
    const slot = await page("", { automations: off, schedulerEnable: () => value(parseHostInstall(answer("host-install.json"))) });
    fireEvent.click(await slot.findByTestId("oats-automations-enable-scheduler"));
    const dialog = await slot.findByRole("dialog");
    expect(within(dialog).getByRole("heading", { level: 2 }).textContent).toBe("Enable scheduler");
    expect(dialog.textContent).toContain("OATS installs its scheduler's timer on this computer, for the account bb's machine runs as: a systemd user timer (oats-schedule-tick.timer) on Linux, a launchd agent (ai.oats.schedule-tick) on macOS.");
    expect(dialog.textContent).toContain("`oats schedule host uninstall`, run in the deployment, removes the timer.");
    expect(calls(slot, "schedulerEnable")).toEqual([]);
    fireEvent.click(within(dialog).getByTestId("oats-confirm-act"));
    await waitFor(() => expect(dialog.textContent).toContain("The scheduler is on"));
    expect(calls(slot, "schedulerEnable")).toEqual([null]);
  });

  it("a computer with no service manager: the kernel's refusal, unchanged", async () => {
    const slot = await page("", { automations: off, schedulerEnable: refuse("E_SCHEDULE_HOST: systemctl --user daemon-reload failed: Failed to connect to bus: No medium found") });
    fireEvent.click(await slot.findByTestId("oats-automations-enable-scheduler"));
    const dialog = await slot.findByRole("dialog");
    fireEvent.click(within(dialog).getByTestId("oats-confirm-act"));
    // The kernel's code here comes after part of the install: the dialog does not say nothing was enabled.
    await waitFor(() => expect(dialog.textContent).toContain("The scheduler may not have been enabled"));
    expect(dialog.textContent).not.toContain("was not enabled");
    expect(dialog.textContent).toContain("systemctl --user daemon-reload failed: Failed to connect to bus: No medium found");
    expect(dialog.textContent).toContain("E_SCHEDULE_HOST");
  });

  it("is not offered while the scheduler is on", async () => {
    const slot = await page();
    await slot.findAllByTestId("oats-automation-row");
    expect(slot.queryByTestId("oats-automations-enable-scheduler")).toBeNull();
  });
});

describe("an act says it is on its way, and its answer comes to the person", () => {
  /** A handler that waits to be released. */
  function held<Value>(answer: () => Value) {
    let release = () => undefined as void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    return { handler: async () => (await gate, answer()), release: () => release() };
  }
  const focused = () => (document.activeElement as HTMLElement | null)?.dataset.testid ?? null;

  it("while Run now runs the page says so in words; then the result takes the focus", async () => {
    const run = held(() => value(parseScheduleRun(answer("schedule-run.json"))));
    const slot = await page("", { scheduleRun: run.handler });
    (await menu(slot, "local/daily-review")).press("Run now");
    const doing = await slot.findByTestId("oats-automations-doing");
    expect([doing.textContent, within(doing).getByRole("status").textContent]).toEqual(["Running daily-review…", "Running daily-review…"]);
    expect(slot.queryByTestId("oats-automations-result")).toBeNull();
    run.release();
    expect(await result(slot)).toBe("local/daily-review: Agent launchedDismiss");
    expect(slot.queryByTestId("oats-automations-doing")).toBeNull();
    await waitFor(() => expect(focused()).toBe("oats-automations-result"));
  });

  it("an act pressed while the lists are read again after the act before it is read back too", async () => {
    const reread = held(() => ({ at: AT }));
    let rereads = 0;
    const slot = await page("", {
      automationEnable: ({ id }) => ({ row: rowOf(schedules(), id) }),
      refresh: async () => {
        rereads += 1;
        // The first re-read is held open: the second act ends while it is still under way.
        if (rereads === 1) await reread.handler();
        return { at: AT };
      },
    });
    const press = async (id: string) => fireEvent.click(within(await row(slot, id)).getByRole("switch"));
    await press("local/daily-review");
    await waitFor(() => expect(rereads).toBe(1));
    await press("local/hourly-check");
    await waitFor(() => expect(calls(slot, "automationEnable")).toHaveLength(2));
    reread.release();
    await waitFor(() => expect(rereads).toBe(2));
  });

  it("Test from a row's menu opens the row's page, where its answer is shown", async () => {
    const slot = await page("", { automationTest: () => value(parseTest(answer("schedule-test.json"), "schedule", null)) });
    (await menu(slot, "local/daily-review")).press("Test");
    expect(slot.inspection.navigateCalls).toEqual([{ method: "toPluginPanel", path: "automations", options: { subPath: "schedules/local/daily-review" } }]);
    await waitFor(() => expect(calls(slot, "automationTest")).toEqual([{ kind: "schedule", id: "local/daily-review" }]));
  });

  it("on a row's page a test says it is on its way, and its answer takes the focus", async () => {
    const test = held(() => value(parseTest(answer("schedule-test.json"), "schedule", null)));
    const slot = await page("schedules/local/daily-review", { automationTest: test.handler });
    await pageAct(slot, "Test");
    await waitFor(() => expect(slot.getByTestId("oats-automation-detail").textContent).toContain("Testing daily-review…"));
    expect(slot.inspection.navigateCalls).toEqual([]);
    test.release();
    expect((await slot.findByTestId("oats-automation-test")).textContent).toMatch(/^Test resultReady: it would run here\./);
    await waitFor(() => expect(focused()).toBe("oats-automation-test-arrived"));
  });

  it("a capability source's confirmation takes the focus, says Testing… only for its own test, and is for the row as it was shown", async () => {
    const enable = held(() => ({ row: rowOf(triggers(), "oats-real/harvest-review") }));
    let params = [{ name: "prefix", value: "harvest/" }, { name: "graph", value: "kb" }];
    const lists = () => {
      const list = triggers();
      const rows = list.rows.map((entry) => (entry.id === "oats-real/harvest-review" && entry.on !== null ? { ...entry, on: { ...entry.on, params } } : entry));
      return { at: AT, hostId: "host_falcon", oats: OATS, statuses: STATUSES(), schedule: { ok: true as const, list: schedules() }, trigger: { ok: true as const, list: { ...list, rows } } };
    };
    const slot = await page("triggers/oats-real/harvest-review", { automations: lists, automationEnable: enable.handler });
    await pageAct(slot, "Test");
    const confirm = await slot.findByTestId("oats-automation-test-confirm");
    await waitFor(() => expect(focused()).toBe("oats-automation-test-confirm-arrived"));
    // Another act on its way: the confirmation's buttons are off, and it does not say a test is running.
    fireEvent.click(within(slot.getByTestId("oats-automation-identity")).getByRole("switch"));
    await waitFor(() => expect((slot.getByTestId("oats-automation-test-run") as HTMLButtonElement).disabled).toBe(true));
    expect(confirm.textContent).not.toContain("Testing…");
    expect(calls(slot, "automationTest")).toEqual([]);
    // The lists are read again and the trigger's parameters are others: what was shown is no longer what would run.
    params = [{ name: "prefix", value: "release/" }, { name: "graph", value: "kb" }];
    enable.release();
    await waitFor(() => expect(slot.queryByTestId("oats-automation-test-confirm")).toBeNull());
    expect(calls(slot, "automationTest")).toEqual([]);
  });

  /** bb opening another page of the panel: the same slot, drawn at another route. */
  async function go(slot: Slot, subPath: string) {
    const Panel = Drawn!;
    slot.lifecycle.rerender(<Panel subPath={subPath} />);
  }

  it("Test from the list's menu on a capability source's trigger: its page opens and the confirmation holds the focus, not Back", async () => {
    const slot = await page("");
    (await menu(slot, "oats-real/harvest-review")).press("Test");
    expect(slot.inspection.navigateCalls).toEqual([{ method: "toPluginPanel", path: "automations", options: { subPath: "triggers/oats-real/harvest-review" } }]);
    await go(slot, "triggers/oats-real/harvest-review");
    expect((await slot.findByTestId("oats-automation-test-confirm")).textContent).toMatch(/^Test this trigger/);
    await waitFor(() => expect(focused()).toBe("oats-automation-test-confirm-arrived"));
    expect(calls(slot, "automationTest")).toEqual([]);
  });

  it("a confirmation left with Back is not there when the row's page is opened again", async () => {
    const slot = await page("triggers/oats-real/harvest-review");
    await pageAct(slot, "Test");
    await slot.findByTestId("oats-automation-test-confirm");
    await go(slot, "triggers");
    await row(slot, "oats-real/harvest-review");
    await go(slot, "triggers/oats-real/harvest-review");
    await slot.findByTestId("oats-automation-detail-menu");
    expect(slot.queryByTestId("oats-automation-test-confirm")).toBeNull();
  });

  it("a press that turns off or removes the control it was made on gives the focus back: the switch, the page's menu after a test's Cancel, the tab after Dismiss", async () => {
    const slot = await page("", { automationEnable: ({ id }) => ({ row: rowOf(schedules(), id) }), scheduleRun: () => value(parseScheduleRun(answer("schedule-run.json"))) });
    const toggle = within(await row(slot, "local/daily-review")).getByRole("switch");
    toggle.focus();
    fireEvent.click(toggle);
    await waitFor(() => expect(calls(slot, "automationEnable")).toHaveLength(1));
    await waitFor(() => expect(document.activeElement?.getAttribute("aria-label")).toBe("local/daily-review enabled on this computer"));
    (await menu(slot, "local/daily-review")).press("Run now");
    fireEvent.click(await slot.findByTestId("oats-automations-result-dismiss"));
    await waitFor(() => expect(document.activeElement?.getAttribute("role")).toBe("tab"));
    resetApp();
    const onPage = await page("triggers/oats-real/harvest-review");
    await pageAct(onPage, "Test");
    fireEvent.click(await onPage.findByTestId("oats-automation-test-cancel"));
    // Test was pressed in the page's "…" menu: the focus is back on that menu's button.
    await waitFor(() => expect(document.activeElement).toBe(within(onPage.getByTestId("oats-automation-detail-menu")).getByRole("button")));
  });

  it("a name is drawn through the display filter where an act says it runs and where a delete says what it did", async () => {
    const list = schedules();
    const hostile = list.rows.map((entry) => (entry.id === "local/weekly-cleanup" ? { ...entry, name: "weekly\u202ecleanup" } : entry));
    const remove = held(() => ({ removed: "weekly-cleanup" }));
    const slot = await page("schedules/local/weekly-cleanup", {
      automations: () => ({ at: AT, hostId: "host_falcon", oats: OATS, statuses: STATUSES(), schedule: { ok: true as const, list: { ...list, rows: hostile } }, trigger: { ok: true as const, list: triggers() } }),
      automationTest: held(() => value(parseTest(answer("schedule-test.json"), "schedule", null))).handler,
      scheduleRemove: remove.handler,
    });
    await pageAct(slot, "Test");
    await waitFor(() => expect(slot.getByTestId("oats-automation-detail").textContent).toMatch(/Testing weekly.cleanup…/));
    expect(slot.getByTestId("oats-automation-detail").textContent).not.toContain("\u202e");
    resetApp();
    const again = await page("schedules/local/weekly-cleanup", { automations: () => ({ at: AT, hostId: "host_falcon", oats: OATS, statuses: STATUSES(), schedule: { ok: true as const, list: { ...list, rows: hostile } }, trigger: { ok: true as const, list: triggers() } }), scheduleRemove: () => ({ removed: "weekly-cleanup" }) });
    await pageAct(again, "Delete…");
    const dialog = await again.findByRole("dialog");
    fireEvent.click(within(dialog).getByTestId("oats-confirm-act"));
    await waitFor(() => expect(dialog.textContent).toContain("was deleted"));
    expect(dialog.textContent).not.toContain("\u202e");
  });

  it("a confirmation is for the trigger's whole definition: a re-read that changes its events withdraws it", async () => {
    let events = ["opened", "updated"];
    const lists = () => {
      const list = triggers();
      const rows = list.rows.map((entry) => (entry.id === "oats-real/harvest-review" && entry.on !== null ? { ...entry, on: { ...entry.on, events } } : entry));
      return { at: AT, hostId: "host_falcon", oats: OATS, statuses: STATUSES(), schedule: { ok: true as const, list: schedules() }, trigger: { ok: true as const, list: { ...list, rows } } };
    };
    const slot = await page("triggers/oats-real/harvest-review", { automations: lists });
    await pageAct(slot, "Test");
    await slot.findByTestId("oats-automation-test-confirm");
    events = ["opened"];
    await slot.behavior.emitRealtime("oats/changed", { at: "2026-11-21T20:50:00.000Z" });
    await waitFor(() => expect(slot.queryByTestId("oats-automation-test-confirm")).toBeNull());
  });

  it("a schedule and a trigger may share an id: what a test put on one's page is not on the other's", async () => {
    const list = triggers();
    const twin = { ...rowOf(list, "local/pr-triage"), id: "local/daily-review", name: "daily-review" };
    const slot = await page("schedules/local/daily-review", {
      automations: () => ({ at: AT, hostId: "host_falcon", oats: OATS, statuses: STATUSES(), schedule: { ok: true as const, list: schedules() }, trigger: { ok: true as const, list: { ...list, rows: [...list.rows, twin] } } }),
      automationTest: () => value(parseTest(answer("schedule-test.json"), "schedule", null)),
    });
    await pageAct(slot, "Test");
    await slot.findByTestId("oats-automation-test");
    await go(slot, "triggers/local/daily-review");
    await slot.findByTestId("oats-automation-detail-menu");
    await waitFor(() => expect(slot.getByTestId("oats-automation-detail").textContent).toContain("Triage every new pull request of the app"));
    expect(slot.queryByTestId("oats-automation-test")).toBeNull();
    expect(calls(slot, "automationTest")).toEqual([{ kind: "schedule", id: "local/daily-review" }]);
  });

  it("a result left on the page takes no focus from a confirmation that arrives after it", async () => {
    const slot = await page("", { scheduleRun: () => value(parseScheduleRun(answer("schedule-run.json"))) });
    (await menu(slot, "local/daily-review")).press("Run now");
    await result(slot);
    await waitFor(() => expect(focused()).toBe("oats-automations-result"));
    await go(slot, "triggers/oats-real/harvest-review");
    await pageAct(slot, "Test");
    await slot.findByTestId("oats-automation-test-confirm");
    expect(slot.getByTestId("oats-automations-result")).toBeTruthy();
    await waitFor(() => expect(focused()).toBe("oats-automation-test-confirm-arrived"));
  });

  it("a test's answer is for the row as it was tested: a re-read that shows another source drops it", async () => {
    let source = "github.pull_request";
    const lists = () => {
      const list = triggers();
      const rows = list.rows.map((entry) => (entry.id === "oats-real/proposal-review" && entry.on !== null ? { ...entry, on: { ...entry.on, source } } : entry));
      return { at: AT, hostId: "host_falcon", oats: OATS, statuses: STATUSES(), schedule: { ok: true as const, list: schedules() }, trigger: { ok: true as const, list: { ...list, rows } } };
    };
    const slot = await page("triggers/oats-real/proposal-review", { automations: lists, automationTest: () => value(parseTest(answer("trigger-test.json"), "trigger", "github.pull_request")) });
    await pageAct(slot, "Test");
    await slot.findByTestId("oats-automation-test");
    source = "acme.graph:harvest-branches";
    await slot.behavior.emitRealtime("oats/changed", { at: "2026-11-21T20:50:00.000Z" });
    await waitFor(() => expect(slot.queryByTestId("oats-automation-test")).toBeNull());
  });

  it("a test still on its way is said above the list once its row's page is left", async () => {
    const test = held(() => value(parseTest(answer("schedule-test.json"), "schedule", null)));
    const slot = await page("schedules/local/daily-review", { automationTest: test.handler });
    await pageAct(slot, "Test");
    await waitFor(() => expect(slot.getByTestId("oats-automation-detail").textContent).toContain("Testing daily-review…"));
    expect(slot.queryByTestId("oats-automations-doing")).toBeNull();
    await go(slot, "schedules");
    expect((await slot.findByTestId("oats-automations-doing")).textContent).toBe("Testing daily-review…");
    test.release();
    await waitFor(() => expect(slot.queryByTestId("oats-automations-doing")).toBeNull());
  });

  it("after a delete the focus is on the row beside the deleted one, named while that row was still there", async () => {
    const all = schedules();
    let rows = all.rows;
    const slot = await page("", {
      automations: () => ({ at: AT, hostId: "host_falcon", oats: OATS, statuses: STATUSES(), schedule: { ok: true as const, list: { ...all, rows } }, trigger: { ok: true as const, list: triggers() } }),
      scheduleRemove: () => ((rows = rows.filter((entry) => entry.id !== "local/hourly-check")), { removed: "hourly-check" }),
    });
    const shown = (await slot.findAllByTestId("oats-automation-row")).map((entry) => entry.dataset.id!);
    const beside = shown[shown.indexOf("local/hourly-check") + 1]!;
    (await menu(slot, "local/hourly-check")).press("Delete…");
    const dialog = await slot.findByRole("dialog");
    fireEvent.click(within(dialog).getByTestId("oats-confirm-act"));
    await waitFor(() => expect(dialog.textContent).toContain("was deleted"));
    // The list is read again and the row is gone before Close is pressed.
    await waitFor(() => expect(slot.getAllByTestId("oats-automation-row").map((entry) => entry.dataset.id)).not.toContain("local/hourly-check"));
    fireEvent.click(within(dialog).getByTestId("oats-confirm-close"));
    await waitFor(() => expect((document.activeElement as HTMLElement | null)?.closest<HTMLElement>('[data-testid="oats-automation-row"]')?.dataset.id).toBe(beside));
    expect(focused()).toBe("oats-automation-open");
  });

  it("Enable scheduler is held while the Schedules list could not be read again; a row's acts follow its own kind's list", async () => {
    const off = value(parseHostInstall(answer("host-install.json"))).scheduler;
    const stopped = { ...off, installed: false, active: false };
    let asked = 0;
    const lists = () => {
      asked += 1;
      const refused = { ok: false as const, code: "E_SCHEDULE_INVALID", message: "/abs/deployment/oats-schedules.json must be {version: 1|2, jobs: {}}" };
      return { at: AT, hostId: "host_falcon", oats: OATS, statuses: STATUSES(), schedule: asked > 1 ? refused : { ok: true as const, list: { ...schedules(), scheduler: stopped } }, trigger: { ok: true as const, list: { ...triggers(), scheduler: stopped } } };
    };
    const slot = await page("", { automations: lists });
    const enable = async () => (await slot.findByTestId("oats-automations-enable-scheduler")) as HTMLButtonElement;
    expect((await enable()).disabled).toBe(false);
    fireEvent.click(slot.getByTestId("oats-automations-refresh"));
    await slot.findByTestId("oats-automations-held");
    expect((await enable()).disabled).toBe(true);
    // A row's acts follow its own kind's list: the triggers' are not held by the Schedules list, the schedules' are.
    expect((within(await row(slot, "local/pr-triage")).getByRole("switch") as HTMLButtonElement).disabled).toBe(false);
    expect((within(await row(slot, "local/daily-review")).getByRole("switch") as HTMLButtonElement).disabled).toBe(true);
  });

  it("a delete the kernel refuses because the row is already gone: closed, the focus is on the row that was beside it", async () => {
    const all = schedules();
    let rows = all.rows;
    const slot = await page("", {
      automations: () => ({ at: AT, hostId: "host_falcon", oats: OATS, statuses: STATUSES(), schedule: { ok: true as const, list: { ...all, rows } }, trigger: { ok: true as const, list: triggers() } }),
      scheduleRemove: () => {
        rows = rows.filter((entry) => entry.id !== "local/hourly-check");
        throw new Error('E_SCHEDULE_UNKNOWN: no schedule "hourly-check" in /abs/deployment');
      },
    });
    const shown = (await slot.findAllByTestId("oats-automation-row")).map((entry) => entry.dataset.id!);
    const beside = shown[shown.indexOf("local/hourly-check") + 1]!;
    (await menu(slot, "local/hourly-check")).press("Delete…");
    const dialog = await slot.findByRole("dialog");
    fireEvent.click(within(dialog).getByTestId("oats-confirm-act"));
    await waitFor(() => expect(dialog.textContent).toContain("was not deleted"));
    await waitFor(() => expect(slot.getAllByTestId("oats-automation-row").map((entry) => entry.dataset.id)).not.toContain("local/hourly-check"));
    fireEvent.click(within(dialog).getByTestId("oats-confirm-close"));
    await waitFor(() => expect((document.activeElement as HTMLElement | null)?.closest<HTMLElement>('[data-testid="oats-automation-row"]')?.dataset.id).toBe(beside));
  });

  it("the row beside a deleted one is the next one the list shows, under its search", async () => {
    const all = schedules();
    let rows = all.rows;
    const slot = await page("", {
      automations: () => ({ at: AT, hostId: "host_falcon", oats: OATS, statuses: STATUSES(), schedule: { ok: true as const, list: { ...all, rows } }, trigger: { ok: true as const, list: triggers() } }),
      scheduleRemove: () => ((rows = rows.filter((entry) => entry.id !== "local/status-check")), { removed: "status-check" }),
    });
    const ids = () => slot.getAllByTestId("oats-automation-row").map((entry) => entry.dataset.id!);
    await row(slot, "local/status-check");
    const whole = ids();
    fireEvent.change(slot.getByTestId("oats-search"), { target: { value: "check" } });
    await waitFor(() => expect(ids().length).toBeLessThan(whole.length));
    const shown = ids();
    const at = shown.indexOf("local/status-check");
    // The row after it, else the one before it (it is the last one this search shows).
    const beside = (shown[at + 1] ?? shown[at - 1])!;
    // The deleted row is not the first one shown, and the search hides the row that is beside it
    // in the whole list: neither the first shown row nor that hidden one is the neighbour.
    expect(at).toBeGreaterThan(0);
    expect(beside).toBeDefined();
    expect(shown).not.toContain(whole[whole.indexOf("local/status-check") + 1]);
    (await menu(slot, "local/status-check")).press("Delete…");
    const dialog = await slot.findByRole("dialog");
    fireEvent.click(within(dialog).getByTestId("oats-confirm-act"));
    await waitFor(() => expect(dialog.textContent).toContain("was deleted"));
    await waitFor(() => expect(ids()).not.toContain("local/status-check"));
    expect(ids()[0]).not.toBe(beside);
    fireEvent.click(within(dialog).getByTestId("oats-confirm-close"));
    await waitFor(() => expect((document.activeElement as HTMLElement | null)?.closest<HTMLElement>('[data-testid="oats-automation-row"]')?.dataset.id).toBe(beside));
  });



  it("a delete or a summary the kernel refuses is followed by a new read of the lists", async () => {
    let reads = 0;
    const slot = await page("schedules/local/weekly-cleanup", { refresh: () => ((reads += 1), { at: AT }), scheduleRemove: refuse("E_SCHEDULE_UNKNOWN: no schedule \"weekly-cleanup\" in /abs/deployment") });
    await pageAct(slot, "Delete…");
    fireEvent.click(within(await slot.findByRole("dialog")).getByTestId("oats-confirm-act"));
    await waitFor(() => expect(slot.getByRole("dialog").textContent).toContain("was not deleted"));
    await waitFor(() => expect(reads).toBe(1));
  });

  it("while a summary is saved the focus stays on the dialog", async () => {
    const save = held(() => ({ row: rowOf(schedules(), "local/daily-review") }));
    const slot = await page("", { automationDescribe: save.handler });
    (await menu(slot, "local/daily-review")).press("Edit summary");
    const dialog = await slot.findByRole("dialog");
    fireEvent.click(within(dialog).getByTestId("oats-automation-summary-save"));
    await waitFor(() => expect(dialog.textContent).toContain("Saving the summary…"));
    await waitFor(() => expect(document.activeElement).toBe(dialog));
    save.release();
    await waitFor(() => expect(slot.queryByRole("dialog")).toBeNull());
  });
});
