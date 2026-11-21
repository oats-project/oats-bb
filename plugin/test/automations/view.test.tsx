// @vitest-environment jsdom
// The Automations page as it is drawn, over the rows the real kernel printed: the two tabs, a
// list with its groups, filter and search, a row's facts, and a row's own page. Nothing here
// reads or acts: the page is handed its lists (Page.tsx reads them).
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, within } from "@testing-library/react";
import { useState } from "react";
import type { AutomationKind, AutomationList, TriggerStatus } from "../../contract/automations";
import { shownBlock } from "../../app/ui/text";
import { View } from "../../app/automations/View";
import type { Gate, ListRead, ViewProps } from "../../app/automations/View";
import { rowOf, schedules, statusOf, triggers } from "./fixtures";

afterEach(cleanup);

const ready = (list: AutomationList, readAt: string | null = null): ListRead => ({ list, loading: false, error: null, readAt });
/** Two hours after the recording: every recorded time is in the past, every next run in the future. */
const NOW = Date.parse(schedules().scheduler!.lastTick!) + 2 * 3600e3;

type Over = Partial<Pick<ViewProps, "gate" | "onOpenFile" | "canOpenCapability" | "onOpenCapability" | "refreshing">> & {
  schedule?: ListRead;
  trigger?: ListRead;
  kind?: AutomationKind;
  status?: (id: string) => TriggerStatus | null;
};
function Harness({ over, log }: { over: Over; log: string[] }) {
  const [kind, setKind] = useState<AutomationKind>(over.kind ?? "schedule");
  const [openId, setOpenId] = useState<string | null>(null);
  return (
    <View
      kind={kind}
      onKind={(next) => {
        setKind(next);
        setOpenId(null);
      }}
      reads={{ schedule: over.schedule ?? ready(schedules()), trigger: over.trigger ?? ready(triggers()) }}
      gate={over.gate ?? null}
      now={NOW}
      onRefresh={() => log.push("refresh")}
      openId={openId}
      onOpen={setOpenId}
      status={openId === null ? null : (over.status?.(openId) ?? null)}
      onOpenFile={over.onOpenFile}
      canOpenCapability={over.canOpenCapability}
      onOpenCapability={over.onOpenCapability}
      refreshing={over.refreshing}
    />
  );
}
function page(over: Over = {}) {
  const log: string[] = [];
  const view = render(<Harness over={over} log={log} />);
  const rows = () => view.queryAllByTestId("oats-automation-row");
  const row = (id: string) => rows().find((entry) => entry.dataset.id === id)!;
  const open = (id: string) => fireEvent.click(within(row(id)).getByTestId("oats-automation-open"));
  const text = (testId: string) => view.getByTestId(testId).textContent;
  return { ...view, log, rows, row, open, text };
}
const cells = (row: HTMLElement) => within(row).getAllByRole("cell").map((cell) => cell.textContent);

describe("the page and its two tabs (D-266)", () => {
  it("shows Schedules and Triggers with their counts, Schedules first", () => {
    const view = page();
    const tabs = view.getAllByRole("tab");
    expect(tabs.map((tab) => [tab.textContent, tab.getAttribute("aria-selected")])).toEqual([
      ["Schedules11", "true"],
      ["Triggers7", "false"],
    ]);
    expect(view.getByRole("tablist").getAttribute("aria-label")).toBe("Automations");
    expect(view.getByRole("tabpanel").getAttribute("aria-labelledby")).toBe(tabs[0]!.id);
    expect(view.rows()).toHaveLength(11);
  });

  it("a click, and Right, Left, Home and End, switch tabs; focus follows", () => {
    const view = page();
    const [schedule, trigger] = view.getAllByRole("tab") as [HTMLElement, HTMLElement];
    fireEvent.click(trigger);
    expect(trigger.getAttribute("aria-selected")).toBe("true");
    expect(view.rows()).toHaveLength(7);
    expect([schedule.tabIndex, trigger.tabIndex]).toEqual([-1, 0]);
    fireEvent.keyDown(trigger, { key: "ArrowRight" }); // wraps
    expect(schedule.getAttribute("aria-selected")).toBe("true");
    expect(document.activeElement).toBe(schedule);
    fireEvent.keyDown(schedule, { key: "ArrowLeft" });
    expect(trigger.getAttribute("aria-selected")).toBe("true");
    fireEvent.keyDown(trigger, { key: "Home" });
    expect(schedule.getAttribute("aria-selected")).toBe("true");
    fireEvent.keyDown(schedule, { key: "End" });
    expect(trigger.getAttribute("aria-selected")).toBe("true");
    expect(document.activeElement).toBe(trigger);
  });

  it("a tab whose list is not read yet shows no count, and its page says it is reading", () => {
    const view = page({ trigger: { list: undefined, loading: true, error: null, readAt: null } });
    expect(view.getAllByRole("tab").map((tab) => tab.textContent)).toEqual(["Schedules11", "Triggers"]);
    fireEvent.click(view.getAllByRole("tab")[1]!);
    expect(view.getByText("Reading triggers…")).toBeTruthy();
    expect((view.getByTestId("oats-automations-refresh") as HTMLButtonElement).disabled).toBe(true);
  });

  it("Refresh asks again, and is named for the list it refreshes", () => {
    const view = page();
    const refresh = view.getByTestId("oats-automations-refresh");
    expect(refresh.getAttribute("aria-label")).toBe("Refresh schedules");
    fireEvent.click(refresh);
    expect(view.log).toEqual(["refresh"]);
  });
});

describe("a list (D-267)", () => {
  it("is a table per group with the five headings", () => {
    const view = page();
    const tables = view.getAllByRole("table");
    expect(tables).toHaveLength(3);
    expect(within(tables[0]!).getAllByRole("columnheader").map((head) => head.textContent)).toEqual(["Automation", "Soul", "When", "Runs on", "Last · next"]);
    // each table is named by its group's heading
    expect(tables.map((table) => document.getElementById(table.getAttribute("aria-labelledby")!)!.textContent)).toEqual(["Runs on this computer7", "Needs attention here3", "Runs elsewhere1"]);
  });

  it("All, Workspace and Local filter it, each with its count", () => {
    const view = page();
    const origin = (id: string) => view.getByRole("radio", { name: new RegExp(`^${id}`, "i") });
    expect(view.getByRole("radiogroup").getAttribute("aria-label")).toBe("Show schedules from");
    expect(["all", "workspace", "local"].map((id) => [origin(id).textContent, origin(id).getAttribute("aria-checked")])).toEqual([
      ["All11", "true"],
      ["Workspace4", "false"],
      ["Local7", "false"],
    ]);
    fireEvent.click(origin("workspace"));
    expect(origin("workspace").getAttribute("aria-checked")).toBe("true");
    expect(view.rows().map((row) => row.dataset.id)).toEqual(["oats-real/nightly-digest", "oats-real/reconcile", "oats-real/release-check", "oats-real/weekly-report"]);
    fireEvent.click(origin("local"));
    expect(view.rows()).toHaveLength(7);
    // The counts are of the whole list, whatever is shown.
    expect(origin("all").textContent).toBe("All11");
  });

  it("the search narrows it, and says when nothing matches", () => {
    const view = page();
    const search = view.getByTestId("oats-search") as HTMLInputElement;
    expect([search.getAttribute("aria-label"), search.placeholder]).toEqual(["Search schedules", "Search schedules"]);
    fireEvent.change(search, { target: { value: "digest" } });
    expect(view.rows().map((row) => row.dataset.id)).toEqual(["oats-real/nightly-digest"]);
    fireEvent.change(search, { target: { value: "nothing like this" } });
    expect(view.rows()).toEqual([]);
    expect(view.getByText("No schedules match.")).toBeTruthy();
    expect(view.queryByTestId("oats-automations-empty")).toBeNull();
  });

  it("another tab starts with neither the filter nor the search of the one before", () => {
    const view = page();
    fireEvent.click(view.getByRole("radio", { name: /^Workspace/ }));
    fireEvent.change(view.getByTestId("oats-search"), { target: { value: "digest" } });
    fireEvent.click(view.getAllByRole("tab")[1]!);
    expect((view.getByTestId("oats-search") as HTMLInputElement).value).toBe("");
    expect(view.getByRole("radio", { name: /^All/ }).getAttribute("aria-checked")).toBe("true");
    expect(view.rows()).toHaveLength(7);
  });

  it("with nothing yet, says so and how to add one, for each kind", () => {
    const view = page({ schedule: ready(schedules("schedule-list-empty.json")), trigger: ready(triggers("trigger-list-empty.json")) });
    expect(view.text("oats-automations-empty")).toBe("No schedules yetCommit one to a member repository's schedules folder to share it with the workspace, or add a local one on this computer.");
    fireEvent.click(view.getAllByRole("tab")[1]!);
    expect(view.text("oats-automations-empty")).toBe("No triggers yetCommit one to a member repository's triggers folder to share it with the workspace, or add a local one on this computer.");
    expect(view.text("oats-automations-foot")).toBe("Workspace items appear after the next sync · Only members you can read in Git contribute.");
  });
});

describe("a row's facts (D-268, D-269)", () => {
  it("a local spawn on bb: name, where it is from, its summary, its soul, when in words, where it runs, last and next", () => {
    const view = page();
    expect(cells(view.row("local/daily-review"))).toEqual([
      "daily-reviewlocalReview open pull requests every weekday morning",
      "Soul: oats-developeroats-real",
      "When: Weekdays at 09:000 9 * * 1-5 · Europe/Madrid",
      "Runs on: This computerlocal",
      expect.stringMatching(/^Last and next: Next in \d+ (h|d)Last 2 h ago · agent (launched|active)$/),
    ]);
  });

  it("a summary derived from the prompt is in italics and says so; a row with none says No summary", () => {
    const view = page();
    const derived = within(view.row("local/hourly-check")).getByText("Check the build queue.");
    expect([derived.dataset.derived, derived.title, derived.className.includes("italic")]).toEqual(["true", "No summary set — first line of the prompt", true]);
    const authored = within(view.row("local/daily-review")).getByText("Review open pull requests every weekday morning");
    expect([authored.dataset.derived, authored.className.includes("italic")]).toEqual(["false", false]);
    expect(cells(view.row("local/legacy-herdr"))[0]).toBe("legacy-herdrlocalInvalidA job from before Herdr was removed.");
    expect(cells(view.row("oats-real/reconcile"))[0]).toBe("reconcileoats-realReconcile the billing ledger as the billing bot");
  });

  it("a command and a wake have no soul: the row says what they are", () => {
    const view = page();
    expect(cells(view.row("local/status-check")).slice(0, 3)).toEqual(["status-checklocalCheck that the roster answers", "Soul: command", "When: Every 15 minutes*/15 * * * * · UTC"]);
    const wake = view.rows().find((row) => row.dataset.id!.startsWith("local/wake-"))!;
    expect(cells(wake)[1]).toBe("Soul: wake");
    expect(cells(wake)[0]).toMatch(/^wake-oats-developer-review-\d{12}localAnything new on your review\?$/);
  });

  it("where each runs, and why not here, in words and with the kernel's detail", () => {
    const view = page();
    const runsOn = (id: string) => {
      const cell = within(view.row(id)).getAllByRole("cell")[3]!;
      const place = within(cell).getByTestId("oats-automation-place");
      return [cell.textContent, (place.querySelector("[data-tone]") as HTMLElement).dataset.tone, place.title];
    };
    expect(runsOn("oats-real/nightly-digest")).toEqual(["Runs on: This computeras @ana", "ok", "This computer is bb-box"]);
    expect(runsOn("oats-real/reconcile")).toEqual(["Runs on: Wrong account hereas @acme-billing-bot", "bad", "acts as github.com/acme-billing-bot; this host's gh is logged in as github.com/ana"]);
    expect(runsOn("oats-real/release-check")).toEqual(["Runs on: Not trusted hereas @ana", "bad", expect.stringContaining("oats-local.yaml")]);
    expect(runsOn("oats-real/weekly-report")).toEqual(["Runs on: report-serveras @acme-bot", "muted", "runs on report-server; this host is bb-box"]);
    expect(runsOn("local/weekly-cleanup")).toEqual(["Runs on: This computerlocal", "muted", "Local: runs on this computer as its own gh login"]);
    // Not trusted here: the kernel's words, which name the line to add, are in the row itself.
    expect(cells(view.row("oats-real/release-check"))[0]).toContain(rowOf(schedules(), "oats-real/release-check").reasonDetail);
  });

  it("the groups say where: this computer, needing attention here, elsewhere", () => {
    const view = page();
    expect(view.getAllByTestId("oats-automations-group").map((group) => [group.dataset.group, within(group).getAllByTestId("oats-automation-row").map((row) => row.dataset.id!.split("/")[1]!.replace(/-\d{12}$/, ""))])).toEqual([
      ["here", ["daily-review", "hourly-check", "notes-checkpoint", "status-check", "wake-oats-developer-review", "weekly-cleanup", "nightly-digest"]],
      ["attention", ["legacy-herdr", "reconcile", "release-check"]],
      ["elsewhere", ["weekly-report"]],
    ]);
  });

  it("a row that is off here says so, and its next run is Off here; one another computer runs has no last or next", () => {
    const view = page();
    expect(cells(view.row("local/weekly-cleanup"))).toEqual([
      "weekly-cleanuplocalOff hereClose what the week left open.",
      "Soul: oats-product-expertoats-real",
      "When: Fridays at 18:000 18 * * 5 · Europe/Madrid",
      "Runs on: This computerlocal",
      "Last and next: Off hereNot run yet",
    ]);
    expect(cells(view.row("oats-real/weekly-report"))[4]).toBe("Last and next: —");
  });

  it("a failed launch, an invalid definition and an unknown state each say so in the row", () => {
    const view = page();
    expect(cells(view.row("local/hourly-check"))[4]).toMatch(/· launch failed$/);
    expect(cells(view.row("local/status-check"))[4]).toMatch(/· launch state unknown$/);
    const invalid = within(view.row("local/legacy-herdr")).getByText("Invalid");
    expect(invalid.title).toContain("Herdr is no longer supported by OATS");
  });

  it("a trigger: its event in words with its repo and labels, and its last fire by what fired", () => {
    const view = page({ kind: "trigger" });
    expect(cells(view.row("oats-real/proposal-review"))).toEqual([
      "proposal-reviewoats-realReview every knowledge proposal pull request",
      "Soul: oats-developeroats-real",
      "When: Pull request opened, reopened, ready for reviewacme/knowledge · #okf-proposal",
      "Runs on: This computeras @ana",
      expect.stringMatching(/^Last and next: Next (in .+|just now|\d+ .+ ago)Last 2 h ago · #41$/),
    ]);
    expect(cells(view.row("oats-real/harvest-review")).slice(2)).toEqual(["When: acme.graph · harvest-branches: opened", "Runs on: This computeras @ana", expect.stringMatching(/Last 2 h ago · harvest\/a$/)]);
    expect(cells(view.row("oats-real/harvest-closed"))[0]).toBe("harvest-closedoats-realSource check failedArchive branch {subject}.");
    expect(cells(view.row("local/old-prs"))[4]).toBe("Last and next: Off hereNot run yet");
  });
});

describe("the host scheduler and the list's notices (D-270, D-285)", () => {
  it("on: the header says so, when it last checked and how many it runs at once", () => {
    const view = page();
    expect(view.text("oats-automations-scheduler")).toBe("Scheduler on · checked 2 h ago · up to 5 at once");
    expect(view.getByTestId("oats-automations-scheduler").querySelector("[data-tone]")!.getAttribute("data-tone")).toBe("ok");
    expect(view.queryByTestId("oats-automations-scheduler-off")).toBeNull();
  });

  it("off, with rows that would run here: Scheduler off, and the banner that nothing runs until it is enabled", () => {
    const view = page({ schedule: ready(schedules("schedule-list-scheduler-off.json")) });
    expect(view.text("oats-automations-scheduler")).toBe("Scheduler off");
    expect(view.getByTestId("oats-automations-scheduler").querySelector("[data-tone]")!.getAttribute("data-tone")).toBe("bad");
    expect(view.text("oats-automations-scheduler-off")).toBe("The scheduler is not running on this computerNothing here runs until it is enabled.");
    expect(within(view.getByTestId("oats-automations-scheduler-off")).getByTestId("oats-notice").dataset.tone).toBe("warning");
  });

  it("off, with nothing to run here: no banner", () => {
    const view = page({ schedule: ready(schedules("schedule-list-empty.json")) });
    expect(view.text("oats-automations-scheduler")).toBe("Scheduler off");
    expect(view.queryByTestId("oats-automations-scheduler-off")).toBeNull();
  });

  it("this computer has no host name: the banner says what that means and what to do", () => {
    const view = page({ schedule: ready(schedules("schedule-list-host-unnamed.json")), trigger: ready(triggers("trigger-list-host-unnamed.json")) });
    expect(view.text("oats-automations-host-unnamed")).toBe("This computer has no host nameIt runs none of the workspace's schedules. Name it in this deployment's local settings to take on the ones assigned to it.");
    expect(within(view.row("oats-real/weekly-report")).getByTestId("oats-automation-place").title).toBe("This computer has no host name");
    fireEvent.click(view.getAllByRole("tab")[1]!);
    expect(view.text("oats-automations-host-unnamed")).toContain("It runs none of the workspace's triggers");
  });

  it("the line under the list says how old the workspace's items are", () => {
    expect(page().text("oats-automations-foot")).toMatch(/^Workspace schedules as of the last sync \(2 h ago\) · Only members you can read in Git contribute\.$/);
  });

  it("what cannot be shown at all is said in place of the list, with the tabs still there", () => {
    const gate: Gate = { title: "Schedules need OATS 0.29 or later", detail: "Update OATS to see the workspace's schedules and this computer's own, and where each one runs." };
    const view = page({ gate, schedule: { list: undefined, loading: false, error: null, readAt: null } });
    expect(view.text("oats-automations-gate")).toBe(`${gate.title}${gate.detail}`);
    expect(view.getAllByRole("tab")).toHaveLength(2);
    expect(view.queryByTestId("oats-automations-list")).toBeNull();
    expect(view.queryByTestId("oats-automations-scheduler")).toBeNull();
  });

  it("what cannot be shown takes the place of a row's page too, with the tabs and Refresh still there", () => {
    const gate: Gate = { title: "Schedules need the OATS CLI", detail: null };
    function Open() {
      return <View kind="schedule" onKind={() => undefined} reads={{ schedule: ready(schedules()), trigger: ready(triggers()) }} gate={gate} now={NOW} onRefresh={() => undefined} openId="local/daily-review" onOpen={() => undefined} status={null} />;
    }
    const view = render(<Open />);
    expect(view.getByTestId("oats-automations-gate").textContent).toBe("Schedules need the OATS CLI");
    expect(view.getAllByRole("tab")).toHaveLength(2);
    expect(view.getByTestId("oats-automations-refresh")).toBeTruthy();
    expect(view.queryByTestId("oats-automation-detail")).toBeNull();
  });

  it("a read that failed says so in a person's words, then the kernel's message and its code, with Retry, over what was read before and how old that is", () => {
    const view = page({ schedule: { list: schedules(), loading: false, error: { code: "E_SCHEDULE_INVALID", message: "oats-schedules.json cannot be read" }, readAt: new Date(NOW - 3 * 60e3).toISOString() } });
    const alert = view.getByRole("alert");
    expect(alert.textContent).toBe("Schedules could not be readoats-schedules.json cannot be readShowing what was read 3 min ago.E_SCHEDULE_INVALIDRetry");
    fireEvent.click(within(alert).getByText("Retry"));
    expect(view.log).toEqual(["refresh"]);
    expect(view.rows()).toHaveLength(11);
  });

  it("a list read a while ago says how old it is; one being read again says so, without blanking", () => {
    const old = page({ schedule: { ...ready(schedules()), readAt: new Date(NOW - 2 * 60e3).toISOString() } });
    expect(old.getByTestId("oats-stale").textContent).toBe("Showing what was read 2 min ago.");
    cleanup();
    const fresh = page({ schedule: { ...ready(schedules()), readAt: new Date(NOW - 5e3).toISOString() } });
    expect(fresh.queryByTestId("oats-stale")).toBeNull();
    cleanup();
    const again = page({ refreshing: true, schedule: { ...ready(schedules()), readAt: new Date(NOW - 5e3).toISOString() } });
    expect(again.getByTestId("oats-stale").textContent).toBe("Refreshing… showing what was read just now.");
    expect(again.rows()).toHaveLength(11);
    expect((again.getByTestId("oats-automations-refresh") as HTMLButtonElement).disabled).toBe(true);
  });

});

describe("a row's page (D-279)", () => {
  const card = (view: ReturnType<typeof page>, testId: string) => view.getByTestId(testId).textContent;

  it("opens from the row, in place of the list, with focus on Back; Back and Escape return to the row", () => {
    const view = page();
    view.open("local/daily-review");
    expect(view.queryByTestId("oats-automations-list")).toBeNull();
    expect(view.queryByRole("tablist")).toBeNull();
    const back = view.getByTestId("oats-automation-back");
    expect([back.textContent, back.getAttribute("aria-label")]).toEqual(["‹ Schedules", "Back to Schedules"]);
    expect(document.activeElement).toBe(back);
    fireEvent.click(back);
    expect(view.rows()).toHaveLength(11);
    expect(document.activeElement).toBe(within(view.row("local/daily-review")).getByTestId("oats-automation-open"));
    view.open("oats-real/nightly-digest");
    fireEvent.keyDown(view.getByTestId("oats-automation-back"), { key: "Escape" });
    expect(document.activeElement).toBe(within(view.row("oats-real/nightly-digest")).getByTestId("oats-automation-open"));
  });

  it("a spawn schedule: its name and address, the whole prompt, when, what it spawns, where it runs and where it comes from", () => {
    const view = page();
    view.open("local/daily-review");
    expect(card(view, "oats-automation-identity")).toBe("daily-reviewlocal/daily-reviewlocalReview open pull requests every weekday morning");
    expect(card(view, "oats-automation-sends")).toBe("PromptReview the open pull requests.\nReport what blocks each.");
    expect(card(view, "oats-automation-when")).toMatch(/^WhenRunsWeekdays at 09:00Cron0 9 \* \* 1-5Time zoneEurope\/MadridNextin \d+ (h|d)$/);
    expect(card(view, "oats-automation-spawns")).toBe("SpawnsSouloats-developer · oats-realPurposereviewPermissionsYOLO — skips permission promptsBackendbbWakes itEvery 30 minutes · Europe/MadridWake messageAnything new on your review?");
    expect(card(view, "oats-automation-where")).toBe("Where it runsRuns onThis computerRuns on this computer");
    expect(card(view, "oats-automation-from")).toMatch(/^Comes fromLocal to this computer; not shared through Git\.Created2 h agoUpdated2 h ago$/);
    expect(card(view, "oats-automation-history")).toMatch(/^Recent runson this computer2 h agoagent (launched|active) · oats-developer-review-\d{12}$/);
    expect(view.queryByTestId("oats-automation-problem")).toBeNull();
    // Its agent still lives: the job holds its slot on this computer.
    expect(card(view, "oats-automation-run-state")).toMatch(/^Run stateRunning since .+ · 2 h ago$/);
  });

  it("a workspace schedule: who it acts as and who this computer is logged in as; its member, repo, path and commit", () => {
    const view = page();
    view.open("oats-real/reconcile");
    expect(card(view, "oats-automation-where")).toBe(
      "Where it runsRuns onbb-boxThis computerbb-boxActs asgithub.com/acme-billing-botLogged ingithub.com/anaWrong account hereacts as github.com/acme-billing-bot; this host's gh is logged in as github.com/ana",
    );
    expect(card(view, "oats-automation-from")).toMatch(/^Comes fromMemberoats-realRepolocal\/\/abs\/real\/src\/oats-realPathservices\/billing\/reconcile\.oats-schedule\.yamlCommit[0-9a-f]{7}$/);
    expect(card(view, "oats-automation-sends")).toBe("Commandrun as written, without a shelloatsstatus--jsonRuns in/abs/deployment");
    expect(within(view.getByTestId("oats-automation-sends")).getAllByRole("listitem").map((item) => item.textContent)).toEqual(["oats", "status", "--json"]);
    expect(view.queryByTestId("oats-automation-spawns")).toBeNull();
    expect(view.queryByTestId("oats-automation-run-state")).toBeNull();
    expect(card(view, "oats-automation-history")).toBe("Recent runson this computerRuns are recorded on the computer that runs it.");
    expect(card(view, "oats-automation-when")).toBe("WhenRunsEvery 30 minutesCron*/30 * * * *Time zoneUTC");
  });

  it("a provider operation: the operation and the home it runs in; the row says what it is", () => {
    const view = page();
    expect(cells(view.row("local/notes-checkpoint")).slice(0, 3)).toEqual(["notes-checkpointlocalNo summary", "Soul: operation", "When: Daily at 23:000 23 * * * · UTC"]);
    view.open("local/notes-checkpoint");
    expect(card(view, "oats-automation-sends")).toBe("OperationOperationknowledge:checkpointRuns in/abs/deployment/agents/note-keeper/instances/team-notes-keeper");
    expect(view.queryByTestId("oats-automation-spawns")).toBeNull();
  });

  it("a wake: its message whole and the home it wakes", () => {
    const view = page();
    const wake = schedules().rows.find((row) => row.run === "wake")!;
    view.open(wake.id);
    expect(card(view, "oats-automation-sends")).toBe(`Wake messageAnything new on your review?Wakes${wake.home}`);
    expect(card(view, "oats-automation-identity")).toBe(`${wake.name}${wake.id}localNo summary`);
  });

  it("a run that did not happen says why, in the kernel's words", () => {
    const view = page();
    view.open("local/hourly-check");
    const run = view.getByTestId("oats-automation-run");
    expect(run.textContent).toMatch(/^2 h agolaunch failedoats-developer-hourly-check-\d{12} was not launched: .*E_BACKEND_SANDBOXED_MODE: this launch would run in bb's accept-edits mode/);
    // The code is in the kernel's message already: it is not said twice.
    expect(within(run).getByTestId("oats-automation-run-error").querySelector("code")).toBeNull();
  });

  it("an invalid definition: the kernel's code, field and message", () => {
    const view = page();
    view.open("local/legacy-herdr");
    expect(card(view, "oats-automation-problem")).toMatch(/^InvalidCodeE_HERDR_REMOVEDFieldbackendMessageHerdr is no longer supported by OATS \(removed in 0\.31\.0\)/);
  });

  it("a run whose state is unknown: since when, what the kernel knows, and the command that checks it", () => {
    const view = page();
    view.open("local/status-check");
    expect(card(view, "oats-automation-run-state")).toMatch(
      /^Run stateRun state unknown since .+ · 2 h agoScheduled2 h agoExitedyesExit status0Errorcommand answered no valid envelope; its side effects are unconfirmedFrom a terminal: oats schedule reconcile local\/status-check --dir \/abs\/deployment\. If its effects can’t be proven, check by hand, then oats schedule reconcile local\/status-check --clear --dir \/abs\/deployment records it as launch failed and frees its slot\.$/,
    );
  });

  it("what a member's file or the kernel names is drawn through the filter in the cards too, and a command that could not be pasted is not shown", () => {
    const list = schedules();
    const odd = {
      ...list,
      rows: list.rows.map((row) =>
        row.id === "local/status-check"
          ? { ...row, scope: "/srv/\u202egnp.exe", template: { package: "acme\u202etools", template: "digest\u0007", from: null, version: "1.0\u200b", commit: "abc1234def" } }
          : row.id === "oats-real/nightly-digest"
            ? { ...row, origin: { ...row.origin, commit: "0123456\u202e89abcdef" } }
            : row,
      ),
    };
    const view = page({ schedule: ready(odd) });
    view.open("local/status-check");
    const from = view.getByTestId("oats-automation-from");
    expect(from.textContent).not.toMatch(/[\u202e\u0007\u200b]/);
    expect(Array.from(from.querySelectorAll("[title]")).map((element) => element.getAttribute("title")).join(" ")).not.toMatch(/[\u202e\u0007\u200b]/);
    expect(view.getByTestId("oats-automation-reconcile-command").textContent).toBe("The command that checks it from a terminal (oats schedule reconcile) cannot be shown: this schedule's id or its directory holds characters that are not text.");
    fireEvent.click(view.getByTestId("oats-automation-back"));
    view.open("oats-real/nightly-digest");
    const commit = view.getByTestId("oats-automation-from");
    expect(`${commit.textContent} ${Array.from(commit.querySelectorAll("[title]")).map((element) => element.getAttribute("title")).join(" ")}`).not.toContain("\u202e");
  });

  it("Open file opens the definition where this client can, and says where it is", () => {
    const opened: string[] = [];
    const view = page({ onOpenFile: (row) => opened.push(row.id) });
    view.open("oats-real/nightly-digest");
    const button = view.getByTestId("oats-automation-open-file") as HTMLButtonElement;
    expect([button.textContent, button.disabled, button.title]).toEqual(["Open file", false, "/abs/deployment/oats-real/oats-schedules/nightly-digest.yaml"]);
    fireEvent.click(button);
    expect(opened).toEqual(["oats-real/nightly-digest"]);
    // Where this client cannot open files, the page offers none.
    cleanup();
    const without = page();
    without.open("oats-real/nightly-digest");
    expect(without.queryByTestId("oats-automation-open-file")).toBeNull();
  });
});

describe("a prompt and a wake message are drawn whole (D-279)", () => {
  const withTask = (task: string) => {
    const list = schedules();
    return ready({ ...list, rows: list.rows.map((row) => (row.id === "local/daily-review" ? { ...row, task } : row)) });
  };
  const prose = (task: string) => {
    const view = page({ schedule: withTask(task) });
    view.open("local/daily-review");
    return view.getByTestId("oats-automation-prose");
  };

  it("keeps every line, blank line and indentation, however a line break was written", () => {
    expect(shownBlock("Review the open PRs.\r\n\r\nSteps:\n  1. list them\n\t- nested\u2028done")).toBe("Review the open PRs.\n\nSteps:\n  1. list them\n\t- nested\ndone");
    const block = prose("Review the open PRs.\n\nSteps:\n  1. list them");
    expect(block.textContent).toBe("Review the open PRs.\n\nSteps:\n  1. list them");
    expect(block.className).toContain("whitespace-pre-wrap");
  });

  it("withholds nothing and cuts nothing: a prompt that names a password is the prompt", () => {
    expect(prose("Check that password=hunter2 never appears in logs.").textContent).toBe("Check that password=hunter2 never appears in logs.");
    cleanup();
    const long = `Read this.\n${"y".repeat(5000)}`;
    expect(prose(long).textContent).toBe(long);
  });

  it("a character that is not text is drawn as U+FFFD: a bidi override, a control, a zero-width space", () => {
    expect(prose("pay \u202eeno ot\u202c me").textContent).toBe("pay \ufffdeno ot\ufffd me");
    expect(shownBlock("bell\u0007 zero\u200bwidth tag\u{E0041}")).toBe("bell\ufffd zero\ufffdwidth tag\ufffd");
    expect(shownBlock(7)).toBe("");
  });

  it("a wake's message is whole too, and a trigger's fields are still told from its text across lines", () => {
    const list = schedules();
    const wake = list.rows.find((row) => row.run === "wake")!;
    const view = page({ schedule: ready({ ...list, rows: list.rows.map((row) => (row.id === wake.id ? { ...row, message: "Anything new?\n  token: is it still valid" } : row)) }) });
    view.open(wake.id);
    expect(view.getByTestId("oats-automation-prose").textContent).toBe("Anything new?\n  token: is it still valid");
    cleanup();
    const all = triggers();
    const multi = page({ kind: "trigger", trigger: ready({ ...all, rows: all.rows.map((row) => (row.id === "oats-real/proposal-review" ? { ...row, task: "Review {repo}#{number}.\n\nThen say so on {url}." } : row)) }) });
    multi.open("oats-real/proposal-review");
    const block = multi.getByTestId("oats-automation-prose");
    expect(block.textContent).toBe("Review {repo}#{number}.\n\nThen say so on {url}.");
    expect(Array.from(block.querySelectorAll("[data-field]")).map((field) => field.textContent)).toEqual(["{repo}", "{number}", "{url}"]);
  });
});

describe("a trigger's page (D-279, D-280, D-283)", () => {
  const status = (name?: string) => (id: string) => statusOf(id, name);
  const text = (view: ReturnType<typeof page>, testId: string) => view.getByTestId(testId).textContent;

  it("a pull-request trigger: its event, repo, labels, base and poll; what it spawns; its prompt with the event's fields marked", () => {
    const view = page({ kind: "trigger", status: status() });
    view.open("oats-real/proposal-review");
    expect(text(view, "oats-automation-when")).toBe("OnEventPull request opened, reopened, ready for reviewRepoacme/knowledgeLabelsokf-proposalBasemainPollsevery 2m");
    expect(text(view, "oats-automation-spawns")).toBe("SpawnsSouloats-developer · oats-realPurposereview-pr-{number}PermissionsYOLO — skips permission promptsBackendbbConcurrency2 at once · 1 per event");
    const sends = view.getByTestId("oats-automation-sends");
    expect(sends.textContent).toBe(
      "Prompthighlighted fields are filled from the eventReview knowledge-base PR {repo}#{number} ({url}). Load knowledge-review first.Pull request titles and bodies are never inserted: the instance reads them from its event file.",
    );
    expect(Array.from(sends.querySelectorAll("[data-field]")).map((field) => field.textContent)).toEqual(["{repo}", "{number}", "{url}"]);
  });

  it("its state: how many are live and fired, the last poll, what waits, what is live, what fired", () => {
    const view = page({ kind: "trigger", status: status() });
    view.open("oats-real/proposal-review");
    const history = view.getByTestId("oats-automation-history");
    expect(within(history).getByRole("heading").textContent).toBe("Recent fires");
    expect(within(history).getByTestId("oats-automation-history-note").textContent).toBe("on this computer · 2 of 2 live now · 2 fired in all · 1 waiting");
    expect(text(view, "oats-automation-last-poll")).toBe("Last poll 2 h ago: 5 pull requests, 4 matching");
    expect(within(history).getByRole("list", { name: "Waiting" }).textContent).toBe("2 h ago#43 · opened");
    expect(within(within(history).getByRole("list", { name: "Live now" })).getAllByRole("listitem").map((item) => item.textContent)).toEqual(["#41 · opened · oats-developer-review-pr-41", "#42 · opened · oats-developer-review-pr-42"]);
    expect(within(within(history).getByRole("list", { name: "Fired" })).getAllByRole("listitem").map((item) => item.textContent)).toEqual(["2 h ago#41 · opened · oats-developer-review-pr-41", "2 h ago#42 · opened · oats-developer-review-pr-42"]);
    expect(within(history).getAllByText(/^(Waiting|Live now|Fired)$/).map((head) => head.textContent)).toEqual(["Waiting", "Live now", "Fired"]);
  });

  it("before its state is read, and when that read fails, the row's own last fire shows", () => {
    const view = page({ kind: "trigger" });
    view.open("oats-real/proposal-review");
    expect(text(view, "oats-automation-history")).toBe("Recent fireson this computer2 h ago#41 · opened · oats-developer-review-pr-41");
  });

  it("a trigger that never fired here, and one another computer runs", () => {
    const view = page({ kind: "trigger", status: status() });
    view.open("local/old-prs");
    // Turned off here: the kernel says it does not run here.
    expect(text(view, "oats-automation-history")).toBe("Recent fireson this computer · 0 of 1 live nowRuns are recorded on the computer that runs it.");
    fireEvent.click(view.getByTestId("oats-automation-back"));
    view.open("oats-real/docs-review");
    expect(text(view, "oats-automation-history")).toContain("Runs are recorded on the computer that runs it.");
    expect(text(view, "oats-automation-where")).toBe("Where it runsRuns ondocs-serverThis computerbb-boxActs asgithub.com/acme-botLogged ingithub.com/anadocs-serverruns on docs-server; this host is bb-box");
  });

  it("a capability source: its source, events, poll and the trigger file's parameters as a quote", () => {
    const view = page({ kind: "trigger", status: status() });
    view.open("oats-real/harvest-review");
    expect(text(view, "oats-automation-when")).toBe("OnSourceacme.graph · harvest-branchesEventsopenedPollsevery 1mParametersFrom the trigger file:prefix = harvest/graph = kb");
    const params = view.getByTestId("oats-automation-params");
    expect(within(params).getByRole("group").getAttribute("aria-labelledby")).toBe(within(params).getByText("From the trigger file:").id);
    expect(Array.from(params.querySelectorAll("blockquote")).map((quote) => quote.textContent)).toEqual(["prefix = harvest/", "graph = kb"]);
    expect(text(view, "oats-automation-sends")).toContain("The highlighted fields are filled from the source's event after OATS checks them. They are still the source's data, and the instance is told so.");
    expect(Array.from(view.getByTestId("oats-automation-sends").querySelectorAll("[data-field]")).map((field) => field.textContent)).toEqual(["{subject}", "{fields.graph}", "{url}"]);
  });

  it("Open capability shows only for a capability the Capabilities page lists, and opens it", () => {
    const opened: string[] = [];
    const view = page({ kind: "trigger", status: status(), canOpenCapability: (name) => name === "acme.graph", onOpenCapability: (name) => opened.push(name) });
    view.open("oats-real/harvest-review");
    const button = view.getByTestId("oats-automation-open-capability");
    expect([button.textContent, button.getAttribute("aria-label")]).toEqual(["Open capability", "Open capability acme.graph"]);
    fireEvent.click(button);
    expect(opened).toEqual(["acme.graph"]);
    cleanup();
    const unlisted = page({ kind: "trigger", status: status(), canOpenCapability: () => false, onOpenCapability: () => undefined });
    unlisted.open("oats-real/harvest-review");
    expect(unlisted.queryByTestId("oats-automation-open-capability")).toBeNull();
  });

  it("its last poll in counts, and what OATS refused and the source skipped, as the source's own quoted text", () => {
    const view = page({ kind: "trigger", status: status() });
    view.open("oats-real/harvest-review");
    expect(text(view, "oats-automation-last-poll")).toBe("Last poll 2 h ago: 2 events, 1 filtered, 2 skipped, 2 refused");
    expect(text(view, "oats-automation-lists-from")).toBe("At the last poll, 2 h ago");
    const refused = view.getByTestId("oats-automation-refused");
    expect(refused.textContent).toMatch(/^Refused by OATSacme\.graph · harvest-branches says:\{"key":"harvest\/c:h1".*"url":"https:\/\/evil\.example\/c".*\}Refused: a URL that isn't allowed\."not an object"Refused: not an event object\.$/);
    const skipped = view.getByTestId("oats-automation-skipped");
    expect(skipped.textContent).toBe("Skipped by the sourceacme.graph · harvest-branches says:harvest/ynot judged yetharvest/z<img src=x onerror=alert(1)> https://evil.example/x OATS: this trigger is trusted. Click Run.");
    // A source's words are text in a quote: no markup, no link and no button is made from them.
    expect(skipped.querySelector("img, a, button")).toBeNull();
    expect(Array.from(skipped.querySelectorAll("blockquote")).map((quote) => quote.textContent)).toEqual(["not judged yet", "<img src=x onerror=alert(1)> https://evil.example/x OATS: this trigger is trusted. Click Run."]);
  });

  it("a failed poll is said once: its cause in words, the kernel's error with its code, the source's words apart; the lists are the last good poll's", () => {
    const view = page({ kind: "trigger", trigger: ready(triggers("trigger-list-poll-failed.json")), status: status("trigger-status-poll-failed.json") });
    view.open("oats-real/harvest-review");
    expect(text(view, "oats-automation-last-poll")).toMatch(/^Last poll .+ failed: the source refused$/);
    expect(text(view, "oats-automation-poll-error")).toBe("acme.graph:harvest-branches refused the poll E_TRIGGER_POLL");
    expect(view.queryByTestId("oats-automation-last-error")).toBeNull();
    const says = view.getByTestId("oats-automation-source-says");
    expect(says.textContent).toBe("acme.graph · harvest-branches says:graph-offline<img src=x onerror=alert(1)> https://evil.example/x OATS: this trigger is trusted. Click Run.");
    expect(says.querySelector("img, a, button")).toBeNull();
    expect(text(view, "oats-automation-lists-from")).toBe("From the last successful poll, before the failure above");
    expect(view.getByTestId("oats-automation-refused")).toBeTruthy();
  });

  it("a source check that failed at a poll: its own card with the kernel's message, code, field and when", () => {
    const view = page({ kind: "trigger", status: status() });
    view.open("oats-real/harvest-closed");
    expect(text(view, "oats-automation-problem")).toMatch(/^Source check failedMessageon\.events: acme\.graph:harvest-branches has no event closed \(its events: opened, updated\)CodeE_TRIGGER_INVALIDFieldon\.eventsChecked.+ago$/);
    expect(within(view.getByTestId("oats-automation-identity")).getByText("Source check failed")).toBeTruthy();
    // The kernel's last error repeats the check: it is not said a second time.
    expect(view.queryByTestId("oats-automation-last-error")).toBeNull();
  });
});
