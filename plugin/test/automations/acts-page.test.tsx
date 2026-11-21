// @vitest-environment jsdom
// Acting on a row from the Automations page (D-270 to D-272, D-276 to D-278, D-281, D-282): each
// act calls the plugin's server once with the row's id, and what the kernel answered or refused is
// said where the person is looking, in the Desktop's words.
import { afterEach, describe, expect, it } from "vitest";
import { fireEvent, waitFor, within } from "@testing-library/react";
import { renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { parseHostInstall, parseScheduleReconcile, parseScheduleRun, parseTest } from "../../kernel/automations-acts";
import { handlers, loadApp, resetApp, sidebarThreads } from "../helpers/render";
import type { Contract, Handlers } from "../helpers/render";
import { AT, OATS } from "./handlers";
import { answer, rowOf, schedules, triggers } from "./fixtures";

afterEach(resetApp);

async function page(subPath = "", over: Partial<Handlers> = {}) {
  const app = await loadApp();
  const panel = app.navPanels.find((candidate) => candidate.id === "automations")!;
  return renderSlot<{ subPath: string }, Contract>(panel, { subPath }, { rpc: handlers(over), sidebarThreads: sidebarThreads() });
}
type Slot = Awaited<ReturnType<typeof page>>;
const calls = (slot: Slot, method: string) => slot.inspection.rpcCalls.filter((call) => call.method === method).map((call) => call.input);
const row = async (slot: Slot, id: string) => (await slot.findAllByTestId("oats-automation-row")).find((entry) => entry.dataset.id === id)!;
/** Opens a row's menu and answers its items by their labels. */
async function menu(slot: Slot, id: string) {
  const entry = await row(slot, id);
  fireEvent.click(within(entry).getByRole("button", { name: `Actions for ${id}` }));
  const items = within(entry).getAllByRole("menuitem");
  return { labels: items.map((item) => item.textContent), press: (label: string) => fireEvent.click(items.find((item) => item.textContent === label)!) };
}
const value = <T,>(parsed: { ok: true; value: T } | { ok: false; error: unknown }): T => {
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.error));
  return parsed.value;
};
const refuse = (message: string) => (): never => {
  throw new Error(message);
};
const result = async (slot: Slot) => (await slot.findByTestId("oats-automations-result")).textContent;

describe("a row's menu (D-271)", () => {
  it("holds the Desktop's acts for what the row is", async () => {
    const slot = await page();
    expect((await menu(slot, "local/daily-review")).labels).toEqual(["Open", "Test", "Run now", "Turn off here", "Open file", "Edit summary", "Delete…"]);
    resetApp();
    const again = await page();
    // a run whose state is unknown can be checked; a schedule that is off here is turned on, and not run
    expect((await menu(again, "local/status-check")).labels).toEqual(["Open", "Test", "Run now", "Turn off here", "Open file", "Edit summary", "Check run state", "Delete…"]);
    resetApp();
    const off = await page();
    expect((await menu(off, "local/weekly-cleanup")).labels).toEqual(["Open", "Test", "Turn on here", "Open file", "Edit summary", "Delete…"]);
    resetApp();
    // a workspace schedule is changed and removed in its repository; one another computer runs has no switch
    const workspace = await page();
    expect((await menu(workspace, "oats-real/nightly-digest")).labels).toEqual(["Open", "Test", "Run now", "Turn off here", "Open file"]);
    resetApp();
    const elsewhere = await page();
    expect((await menu(elsewhere, "oats-real/weekly-report")).labels).toEqual(["Open", "Test", "Open file"]);
    resetApp();
    const trigger = await page("triggers");
    expect((await menu(trigger, "local/pr-triage")).labels).toEqual(["Open", "Test", "Turn off here", "Open file", "Edit summary"]);
  });

  it("Open opens the row's page", async () => {
    const slot = await page();
    (await menu(slot, "oats-real/nightly-digest")).press("Open");
    expect(slot.inspection.navigateCalls).toEqual([{ method: "toPluginPanel", path: "automations", options: { subPath: "schedules/oats-real/nightly-digest" } }]);
  });

  it("without the feature that writes summaries, Edit summary is not offered", async () => {
    const slot = await page("", { automations: () => ({ at: AT, hostId: "host_falcon", oats: { ...OATS, features: ["automations"] }, schedule: { ok: true as const, list: schedules() }, trigger: { ok: true as const, list: triggers() } }) });
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
    (await menu(slot, "oats-real/nightly-digest")).press("Turn off here");
    expect(await result(slot)).toBe("nightly-digest was not turned off hereoats-local.yaml is being changed by another commandE_LOCAL_BUSYDismiss");
    expect(within(slot.getByTestId("oats-automations-result")).getByTestId("oats-result").dataset.tone).toBe("failed");
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
    expect(await result(slot)).toMatch(/^local\/hourly-check: Launch failed · oats-developer-hourly-check-\d{12} was not launched: .*full mode only.*E_BACKEND_SANDBOXED_MODEDismiss$/);
    expect(within(slot.getByTestId("oats-automations-result")).getByTestId("oats-result").dataset.tone).toBe("failed");
  });

  it("a command whose effects are not known says so", async () => {
    const slot = await page("", { scheduleRun: ran("schedule-run-command.json") });
    (await menu(slot, "local/status-check")).press("Run now");
    expect(await result(slot)).toBe("local/status-check: Launch state unknown — needs attention · command answered no valid envelope; its side effects are unconfirmedDismiss");
    expect(within(slot.getByTestId("oats-automations-result")).getByTestId("oats-result").dataset.tone).toBe("unknown");
  });

  it("a refusal to run keeps the kernel's message and code", async () => {
    const slot = await page("", { scheduleRun: refuse("E_AUTOMATION_NOT_HERE: oats-real/nightly-digest does not run on this host (owner-mismatch)") });
    (await menu(slot, "oats-real/nightly-digest")).press("Run now");
    expect(await result(slot)).toBe("nightly-digest was not runoats-real/nightly-digest does not run on this host (owner-mismatch)E_AUTOMATION_NOT_HEREDismiss");
  });

  it("Check run state, from the run-state card: still unknown, with what the kernel says to do", async () => {
    const slot = await page("schedules/local/status-check", { scheduleReconcile: () => value(parseScheduleReconcile(answer("schedule-reconcile.json"))) });
    fireEvent.click(await slot.findByTestId("oats-automation-reconcile"));
    expect(await result(slot)).toMatch(/^Run state is still unknown\.the command's effects cannot be proven .*oats schedule reconcile status-check --clear.*Dismiss$/);
    expect(calls(slot, "scheduleReconcile")).toEqual([{ id: "local/status-check" }]);
  });
});

describe("Test (D-281, D-282)", () => {
  const tested = (file: string, kind: "schedule" | "trigger", source: string | null) => () => value(parseTest(answer(file), kind, source));
  const card = async (slot: Slot) => (await slot.findByTestId("oats-automation-test")).textContent;

  it("a schedule that would run here", async () => {
    const slot = await page("schedules/local/daily-review", { automationTest: tested("schedule-test.json", "schedule", null) });
    fireEvent.click(await slot.findByTestId("oats-automation-test-button"));
    expect(await card(slot)).toMatch(/^Test resultReady: it would run here\.Next due in .+$/);
    expect(calls(slot, "automationTest")).toEqual([{ kind: "schedule", id: "local/daily-review" }]);
  });

  it("one placed elsewhere is not ready here, and says why", async () => {
    const slot = await page("schedules/oats-real/weekly-report", { automationTest: tested("schedule-test-elsewhere.json", "schedule", null) });
    fireEvent.click(await slot.findByTestId("oats-automation-test-button"));
    expect(await card(slot)).toMatch(/^Test resultNot ready on this computer\.oats-real\/weekly-report does not run on this host \(assigned-elsewhere: runs on report-server; this host is bb-box\)/);
  });

  it("a pull-request trigger: who gh acts as and what would fire now, with each agent's name and what is held, and why", async () => {
    const slot = await page("triggers/oats-real/proposal-review", { automationTest: tested("trigger-test.json", "trigger", "github.pull_request") });
    fireEvent.click(await slot.findByTestId("oats-automation-test-button"));
    expect(await card(slot)).toBe("Test resultReady: it would run here.gh acts as anaWould fire now:#41 → oats-developer-review-pr-41#42 → oats-developer-review-pr-42#43 → oats-developer-review-pr-43 (held: concurrency.max 2 reached (2 live))");
    expect(calls(slot, "automationTest")).toEqual([{ kind: "trigger", id: "oats-real/proposal-review" }]);
  });

  it("a test that does not answer in time says so, and that nothing was recorded", async () => {
    const slot = await page("triggers/oats-real/proposal-review", { automationTest: refuse("OATS_TIMEOUT: `oats` did not answer within 45 s and was stopped") });
    fireEvent.click(await slot.findByTestId("oats-automation-test-button"));
    expect(await card(slot)).toBe("Test resultThe test did not answer in time. Nothing was recorded.OATS_TIMEOUT");
  });

  it("a capability source's trigger: first what will run and with which parameters, and nothing runs until Run test", async () => {
    const slot = await page("triggers/oats-real/harvest-review", { automationTest: tested("trigger-test-source.json", "trigger", "acme.graph:harvest-branches") });
    fireEvent.click(await slot.findByTestId("oats-automation-test-button"));
    const confirm = await slot.findByTestId("oats-automation-test-confirm");
    expect(confirm.textContent).toBe(
      "Test this triggerThis runs acme.graph's source command on this computer, now, once. Nothing is recorded and nothing is spawned.The command receives these parameters.From the trigger file:prefix = harvest/graph = kbCancelRun test",
    );
    expect(calls(slot, "automationTest")).toEqual([]);
    fireEvent.click(slot.getByTestId("oats-automation-test-cancel"));
    expect(slot.queryByTestId("oats-automation-test-confirm")).toBeNull();
    expect(calls(slot, "automationTest")).toEqual([]);

    fireEvent.click(slot.getByTestId("oats-automation-test-button"));
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
    fireEvent.click(await slot.findByTestId("oats-automation-test-button"));
    fireEvent.click(await slot.findByTestId("oats-automation-test-run"));
    expect(await card(slot)).toMatch(
      /^Test resultThe poll failed: the source refusedacme\.graph:harvest-branches refused the poll E_TRIGGER_POLLacme\.graph · harvest-branches says:graph-offline<img src=x onerror=alert\(1\)> https:\/\/evil\.example\/x OATS: this trigger is trusted\. Click Run\.this source's credential may not be visible to the host timer/,
    );
  });

  it("a one-press test the kernel answers with E_TRIGGER_SOURCE_RUN ran nothing, and says so without a failure", async () => {
    const slot = await page("triggers/oats-real/proposal-review", { automationTest: refuse("E_TRIGGER_SOURCE_RUN: oats-real/proposal-review watches acme.graph:harvest-branches: nothing ran") });
    fireEvent.click(await slot.findByTestId("oats-automation-test-button"));
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
    const slot = await page("triggers", { automationDescribe: refuse("E_AUTOMATION_WORKSPACE: local/graph-watch changed under this edit") });
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
    await waitFor(() => expect(dialog.textContent).toContain("E_AUTOMATION_WORKSPACE: local/graph-watch changed under this edit"));
    fireEvent.click(within(dialog).getByTestId("oats-automation-summary-cancel"));
    expect(slot.queryByRole("dialog")).toBeNull();
  });
});

describe("Delete (D-276)", () => {
  it("asks first, in the Desktop's sentence, with the focus on Cancel; then deletes and says so", async () => {
    const slot = await page("schedules/local/weekly-cleanup", { scheduleRemove: () => ({ removed: "weekly-cleanup" }) });
    fireEvent.click(await slot.findByTestId("oats-automation-delete"));
    const dialog = await slot.findByRole("dialog");
    expect(within(dialog).getByRole("heading", { level: 2 }).textContent).toBe("Delete schedule");
    expect(dialog.textContent).toContain("weekly-cleanup is removed from this computer and stops running here.");
    await waitFor(() => expect(document.activeElement).toBe(within(dialog).getByTestId("oats-confirm-cancel")));
    expect(calls(slot, "scheduleRemove")).toEqual([]);
    fireEvent.click(within(dialog).getByTestId("oats-confirm-act"));
    await waitFor(() => expect(calls(slot, "scheduleRemove")).toEqual([{ id: "local/weekly-cleanup" }]));
    await waitFor(() => expect(dialog.textContent).toContain("weekly-cleanup was deleted"));
    // Its page has nothing left to show: back to the list.
    expect(slot.inspection.navigateCalls).toEqual([{ method: "toPluginPanel", path: "automations", options: { subPath: "schedules" } }]);
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
  const off = () => ({ at: AT, hostId: "host_falcon", oats: OATS, schedule: { ok: true as const, list: schedules("schedule-list-scheduler-off.json") }, trigger: { ok: true as const, list: triggers() } });

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
    await waitFor(() => expect(dialog.textContent).toContain("The scheduler was not enabled"));
    expect(dialog.textContent).toContain("systemctl --user daemon-reload failed: Failed to connect to bus: No medium found");
    expect(dialog.textContent).toContain("E_SCHEDULE_HOST");
  });

  it("is not offered while the scheduler is on", async () => {
    const slot = await page();
    await slot.findAllByTestId("oats-automation-row");
    expect(slot.queryByTestId("oats-automations-enable-scheduler")).toBeNull();
  });
});
