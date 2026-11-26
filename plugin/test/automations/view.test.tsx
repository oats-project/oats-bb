// @vitest-environment jsdom
// The Automations page as it is drawn, over the rows the real kernel printed: the two tabs
// (Automations, Runs), the ONE list with its filter, search and order, a row's small line, a row's
// own page with its Runs table and its Details, and the Runs tab. Nothing here reads or acts: the
// page is handed its lists and every trigger's state (Page.tsx reads them).
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, within } from "@testing-library/react";
import { useState } from "react";
import type { ReactNode } from "react";
import type { AutomationList, AutomationRow, TriggerStatus, TriggerStatuses } from "../../contract/automations";
import { shownBlock } from "../../app/ui/text";
import { PROSE_BOUND } from "../../app/automations/Detail";
import { CARD_FLOOR } from "../../app/automations/List";
import { View } from "../../app/automations/View";
import type { Gate, ListRead, Open, Tab, ViewProps } from "../../app/automations/View";
import { automationRowOf } from "../../kernel/automations-read";
import { rowOf, schedules, statusOf, triggers } from "./fixtures";
import { STATUSES } from "./handlers";

// The page is drawn here outside bb: bb's own parts (its icon, its Info row) are stood in for by
// what shows the name and the label they were given. The slot tests (page.test.tsx) draw bb's own.
vi.mock("@get-bb/plugin-sdk/app", async (original) => ({
  ...(await original<typeof import("@get-bb/plugin-sdk/app")>()),
  experimental_Icon: ({ name, className }: { name: string; className?: string }) => <svg className={className} data-icon={name} />,
  experimental_DetailRow: ({ label, children }: { label: ReactNode; children: ReactNode }) => (
    <div data-bb="detail-row">
      <span>{label}</span>
      <span>{children}</span>
    </div>
  ),
}));

afterEach(cleanup);

const ready = (list: AutomationList, readAt: string | null = null): ListRead => ({ list, loading: false, error: null, readAt });
/** Two hours after the recording: every recorded time is in the past, every next run in the future. */
const NOW = Date.parse(schedules().scheduler!.lastTick!) + 2 * 3600e3;

type Over = Partial<Pick<ViewProps, "gate" | "onOpenFile" | "canOpenCapability" | "onOpenCapability" | "refreshing" | "agentLink" | "rowParts" | "statusFailure" | "asking" | "onAnswer">> & {
  schedule?: ListRead;
  trigger?: ListRead;
  statuses?: TriggerStatuses | null;
  tab?: Tab;
  open?: Open | null;
  /** The open trigger's own read; left out, its state is the one read beside the lists. */
  status?: (id: string) => TriggerStatus | null;
};
function Harness({ over, log }: { over: Over; log: string[] }) {
  const [tab, setTab] = useState<Tab>(over.tab ?? "list");
  const [open, setOpen] = useState<Open | null>(over.open ?? null);
  const statuses = over.statuses === undefined ? STATUSES().statuses : over.statuses;
  const beside = open === null || open.kind !== "trigger" ? null : (statuses?.find((entry) => entry.id === open.id)?.status ?? null);
  return (
    <View
      tab={tab}
      onTab={setTab}
      reads={{ schedule: over.schedule ?? ready(schedules()), trigger: over.trigger ?? ready(triggers()) }}
      statuses={statuses}
      gate={over.gate ?? null}
      now={NOW}
      onRefresh={() => log.push("refresh")}
      open={open}
      onOpen={setOpen}
      status={open === null ? null : over.status === undefined ? beside : over.status(open.id)}
      statusFailure={over.statusFailure}
      onOpenFile={over.onOpenFile}
      canOpenCapability={over.canOpenCapability}
      onOpenCapability={over.onOpenCapability}
      refreshing={over.refreshing}
      agentLink={over.agentLink}
      asking={over.asking}
      onAnswer={over.onAnswer}
      rowParts={over.rowParts}
    />
  );
}
function page(over: Over = {}) {
  const log: string[] = [];
  const view = render(<Harness over={over} log={log} />);
  const rows = () => view.queryAllByTestId("oats-automation-row");
  const ids = () => rows().map((entry) => entry.dataset.id);
  const row = (id: string) => rows().find((entry) => entry.dataset.id === id)!;
  const open = (id: string) => fireEvent.click(within(row(id)).getByTestId("oats-automation-open"));
  const text = (testId: string) => view.getByTestId(testId).textContent;
  const runs = () => view.queryAllByTestId("oats-run");
  return { ...view, log, rows, ids, row, open, text, runs };
}
/** A row's small line, part by part. */
const parts = (row: HTMLElement): (string | null)[] => Array.from(within(row).getByTestId("oats-automation-line").querySelectorAll<HTMLElement>("[data-part]")).map((part) => (part.textContent ?? "").replace(/^·/, ""));
const tones = (row: HTMLElement): (string | undefined)[] => Array.from(within(row).getByTestId("oats-automation-line").querySelectorAll<HTMLElement>("[data-part]")).map((part) => part.dataset.tone);
/** Back from a row's page, as a person at a keyboard goes: Escape. (bb's own back arrow and its header are not drawn here.) */
const back = (view: ReturnType<typeof page>) => fireEvent.keyDown(view.getByTestId("oats-automation-detail"), { key: "Escape" });
const radios = (view: ReturnType<typeof page>) => within(view.getAllByRole("radiogroup")[0]!).getAllByRole("radio");
const withRow = (list: AutomationList, id: string, change: (row: AutomationRow) => AutomationRow): AutomationList => ({ ...list, rows: list.rows.map((row) => (row.id === id ? change(row) : row)) });
const withStatus = (id: string, change: (status: TriggerStatus) => TriggerStatus): TriggerStatuses => STATUSES().statuses.map((entry) => (entry.id === id ? { id, status: change(entry.status) } : entry));

/** The list's order on the recording: what is failing first, then what runs on the machine, what needs attention there, what runs elsewhere; in each, schedules then triggers. */
const ORDER = [
  "local/hourly-check",
  "local/legacy-herdr",
  "oats-real/reconcile",
  "oats-real/release-check",
  "oats-real/harvest-closed",
  "local/daily-review",
  "local/notes-checkpoint",
  "local/status-check",
  "local/wake-oats-developer-review-202611212017",
  "local/weekly-cleanup",
  "oats-real/nightly-digest",
  "local/graph-watch",
  "local/old-prs",
  "local/pr-triage",
  "oats-real/harvest-review",
  "oats-real/proposal-review",
  "oats-real/weekly-report",
  "oats-real/docs-review",
];

describe("the page and its two tabs", () => {
  it("shows Automations with the count of both lists, and Runs; the list first", () => {
    const view = page();
    const tabs = view.getAllByRole("tab");
    expect(tabs.map((tab) => [tab.textContent, tab.getAttribute("aria-selected")])).toEqual([
      ["Automations18", "true"],
      ["Runs", "false"],
    ]);
    expect(view.getByRole("tablist").getAttribute("aria-label")).toBe("Automations");
    expect(view.getByRole("tabpanel").getAttribute("aria-labelledby")).toBe(tabs[0]!.id);
    expect(view.rows()).toHaveLength(18);
  });

  it("a click, and Right and Left, switch tabs; focus follows", () => {
    const view = page();
    const tabs = () => view.getAllByRole("tab");
    fireEvent.click(tabs()[1]!);
    expect(tabs()[1]!.getAttribute("aria-selected")).toBe("true");
    expect(view.getByTestId("oats-automations-runs")).toBeTruthy();
    expect(view.queryByTestId("oats-automations-list")).toBeNull();
    fireEvent.keyDown(tabs()[1]!, { key: "ArrowLeft" });
    expect(tabs()[0]!.getAttribute("aria-selected")).toBe("true");
    expect(document.activeElement).toBe(tabs()[0]);
    expect(view.getByTestId("oats-automations-list")).toBeTruthy();
  });

  it("before the lists are read the tab shows no count, and the page says it is reading", () => {
    const none: ListRead = { list: undefined, loading: true, error: null, readAt: null };
    const view = page({ schedule: none, trigger: none });
    expect(view.getAllByRole("tab")[0]!.textContent).toBe("Automations");
    expect(view.getByTestId("oats-loading").textContent).toBe("Reading automations…");
    expect(view.queryByTestId("oats-automations-list")).toBeNull();
  });

  it("Refresh asks again", () => {
    const view = page();
    const refresh = view.getByTestId("oats-automations-refresh");
    expect(refresh.getAttribute("aria-label")).toBe("Refresh automations");
    fireEvent.click(refresh);
    expect(view.log).toEqual(["refresh"]);
  });

  it("the list's tab keeps the page's height, so that its card scrolls alone, down to a floor under which the page scrolls whole; a row's page and the Runs tab scroll whole", () => {
    const view = page();
    expect(view.getByTestId("oats-automations-page").dataset.fixed).toBe("true");
    expect(view.getByTestId("oats-automations").className).toContain("h-full");
    const card = view.getByTestId("oats-automations-rows");
    expect(card.className).toContain("overflow-y-auto");
    // The card has a floor: under it the page scrolls whole, so a notice over the list never squeezes the rows to nothing.
    expect(card.className).toContain(CARD_FLOOR);
    expect(view.getByTestId("oats-automations-page").className).toContain("overflow-y-auto");
    view.open("local/daily-review");
    expect(view.getByTestId("oats-automations-page").dataset.fixed).toBe("false");
    expect(view.getByTestId("oats-automations").className).not.toContain("h-full");
  });
});

describe("the one list", () => {
  it("holds schedules and triggers together: what is failing first, then the rest in the kernel's order", () => {
    const view = page();
    expect(view.ids()).toEqual(ORDER);
    expect(view.rows().map((row) => row.dataset.failing)).toEqual([...Array(5).fill("true"), ...Array(13).fill("false")]);
    expect(view.getByRole("list", { name: "Automations" })).toBe(view.getByTestId("oats-automations-rows"));
  });

  it("one filter of five, each with its count: every row, a kind, what needs a person, or what is failing", () => {
    const view = page();
    expect(radios(view).map((radio) => [radio.textContent, radio.getAttribute("aria-checked")])).toEqual([
      ["All18", "true"],
      ["Schedules11", "false"],
      ["Triggers7", "false"],
      ["Needs you0", "false"],
      ["Failing5", "false"],
    ]);
    fireEvent.click(radios(view)[4]!);
    expect(view.ids()).toEqual(ORDER.slice(0, 5));
    fireEvent.click(radios(view)[2]!);
    expect(view.rows().map((row) => row.dataset.kind)).toEqual(Array(7).fill("trigger"));
    // What is failing leads inside a kind too.
    expect(view.ids()[0]).toBe("oats-real/harvest-closed");
    fireEvent.click(radios(view)[1]!);
    expect(view.rows()).toHaveLength(11);
  });

  it("from twelve rows there is a search: it narrows the list, and says when nothing matches", () => {
    const view = page();
    const search = view.getByRole("searchbox", { name: "Search automations" });
    fireEvent.change(search, { target: { value: "harvest" } });
    // By name, by what it watches, and by who it starts (the soul knowledge-harvester).
    expect(view.ids()).toEqual(["oats-real/harvest-closed", "oats-real/nightly-digest", "local/graph-watch", "oats-real/harvest-review"]);
    fireEvent.change(search, { target: { value: "no such thing" } });
    expect(view.rows()).toHaveLength(0);
    expect(view.text("oats-automations-no-match")).toBe("No match");
    // The filter's counts are of the list, not of the search.
    expect(radios(view)[0]!.textContent).toBe("All18");
  });

  it("a short list has no search field", () => {
    const view = page({ trigger: ready(triggers("trigger-list-empty.json")), statuses: [] });
    expect(view.rows()).toHaveLength(11);
    expect(view.queryByRole("searchbox")).toBeNull();
    expect(radios(view).map((radio) => radio.textContent)).toEqual(["All11", "Schedules11", "Triggers0", "Needs you0", "Failing4"]);
  });

  it("the filter and the search are kept while a row's page is open", () => {
    const view = page();
    fireEvent.click(radios(view)[4]!);
    view.open("local/hourly-check");
    back(view);
    expect(view.ids()).toEqual(ORDER.slice(0, 5));
  });

  it("with nothing yet, says so in two words", () => {
    const view = page({ schedule: ready(schedules("schedule-list-empty.json")), trigger: ready(triggers("trigger-list-empty.json")), statuses: [] });
    expect(view.text("oats-automations-empty")).toBe("No automations");
    expect(view.queryByRole("radiogroup")).toBeNull();
    expect(view.getAllByRole("tab")[0]!.textContent).toBe("Automations0");
  });
});

describe("a row", () => {
  it("a schedule: an icon of its kind, its name, one short sentence of what it does, and one small line: when, the machine it runs on, its owner, its last run", () => {
    const row = page().row("oats-real/nightly-digest");
    expect(within(row).getByTestId("oats-automation-icon").getAttribute("aria-label")).toBe("Schedule");
    expect(within(row).getByTestId("oats-automation-name").textContent).toBe("nightly-digest");
    expect(within(row).getByTestId("oats-automation-name").getAttribute("title")).toBe("oats-real/nightly-digest");
    expect(within(row).getByTestId("oats-automation-sentence").textContent).toBe("Write the nightly digest of what the team shipped");
    expect(parts(row)).toEqual(["Daily at 07:00", "Runs on this computer", "@ana"]);
    expect(within(row).getByTestId("oats-automation-open").getAttribute("aria-label")).toBe("Open nightly-digest");
  });

  it("a trigger: its event with its repository, and its last fire by what fired", () => {
    const view = page();
    expect(within(view.row("local/pr-triage")).getByTestId("oats-automation-icon").getAttribute("aria-label")).toBe("Trigger");
    expect(parts(view.row("local/pr-triage"))).toEqual(["On a pull request, acme/app", "Runs on this computer", "Last 2 h ago, #41"]);
    expect(parts(view.row("local/graph-watch"))).toEqual(["On acme.graph: harvest-branches", "Runs on this computer", "Last 2 h ago, harvest/a"]);
    expect(parts(view.row("oats-real/proposal-review"))).toEqual(["On a pull request, acme/knowledge", "Runs on this computer", "@ana", "Last 2 h ago, #41"]);
  });

  it("the sentence is the automation's own, on one line, cut at a word; one with none has none; a last run says when and what came of it", () => {
    const view = page();
    const sentence = within(view.row("local/daily-review")).getByTestId("oats-automation-sentence");
    expect(sentence.textContent).toBe("Review open pull requests every weekday morning");
    expect(sentence.className).toContain("line-clamp-1");
    expect(within(view.row("local/hourly-check")).queryByTestId("oats-automation-sentence")).toBeNull();
    expect(parts(view.row("local/daily-review"))).toEqual(["Weekdays at 09:00", "Runs on this computer", "Last 2 h ago, Agent active"]);
    expect(parts(view.row("local/wake-oats-developer-review-202611212017"))).toEqual(["Every 30 minutes", "Runs on this computer"]);
    // An owner is drawn only where the kernel gives one: a local automation has none.
    expect(parts(view.row("local/notes-checkpoint"))).toEqual(["Daily at 23:00", "Runs on this computer", "Last 2 h ago, Agent launched"]);
  });

  it("what is failing ends the line in red, and the row's icon is the failing one: a failed launch, an invalid definition, a wrong account, no trust, a failed poll", () => {
    const view = page();
    const last = (id: string) => [parts(view.row(id)).at(-1), tones(view.row(id)).at(-1), within(view.row(id)).getByTestId("oats-automation-icon").getAttribute("aria-label")];
    expect(last("local/hourly-check")).toEqual(["Last 2 h ago, Launch failed", "bad", "Failing"]);
    expect(last("local/legacy-herdr")).toEqual(["Invalid", "bad", "Failing"]);
    expect(last("oats-real/reconcile")).toEqual(["Wrong account", "bad", "Failing"]);
    expect(last("oats-real/release-check")).toEqual(["Not trusted", "bad", "Failing"]);
    expect(last("oats-real/harvest-closed")).toEqual(["Poll failed", "bad", "Failing"]);
    expect(parts(view.row("local/hourly-check"))).toEqual(["Every hour", "Runs on this computer", "Last 2 h ago, Launch failed"]);
    // Only the outcome is red: when it was is said plainly before it.
    expect(within(view.row("local/hourly-check")).getByTestId("oats-automation-line").querySelector(".text-destructive-text")!.textContent).toBe("Launch failed");
    // A row that cannot run on the machine is not said to run on it.
    expect(parts(view.row("oats-real/reconcile"))).toEqual(["Every 30 minutes", "@acme-billing-bot", "Wrong account"]);
  });

  it("a run whose state nobody knows is a warning, not a failure: the row is not among the failing", () => {
    const row = page().row("local/status-check");
    expect([parts(row).at(-1), tones(row).at(-1), row.dataset.failing]).toEqual(["Last 2 h ago, Launch state unknown", "warn", "false"]);
  });

  it("a trigger's failed poll, and its failed spawn that no fire followed, end its line in red", () => {
    const view = page({ trigger: ready(triggers("trigger-list-poll-failed.json")), statuses: STATUSES("trigger-status-poll-failed.json").statuses });
    expect(parts(view.row("local/graph-watch"))).toEqual(["On acme.graph: harvest-branches", "Runs on this computer", "Last 2 h ago, harvest/a", "Poll failed"]);
    cleanup();
    const later = new Date(NOW - 60e3).toISOString();
    const failed = page({ statuses: withStatus("local/pr-triage", (status) => ({ ...status, lastError: { at: later, code: "E_SPAWN", message: "the spawn failed", key: "local/pr-triage:44", says: null } })) });
    expect(parts(failed.row("local/pr-triage")).at(-1)).toBe("Launch failed");
    cleanup();
    // An error older than the last fire is over: a fire followed it.
    const over = page({ statuses: withStatus("local/pr-triage", (status) => ({ ...status, lastError: { at: "2026-11-21T10:00:00.000Z", code: "E_SPAWN", message: "the spawn failed", key: "local/pr-triage:40", says: null } })) });
    expect(parts(over.row("local/pr-triage")).at(-1)).toBe("Last 2 h ago, #41");
  });

  it("a poll that failed once and is well again is not a failed launch: the kernel keeps its last error, with no event's key, and the row is calm", () => {
    // The recorded state after a failed poll (its last error is the poll's: no key), with the poll good again.
    const mended = STATUSES("trigger-status-poll-failed.json").statuses.map((entry) => ({ id: entry.id, status: entry.status.lastPoll !== null && !entry.status.lastPoll.ok ? { ...entry.status, lastPoll: { ...entry.status.lastPoll, ok: true, error: null, cause: null, says: null, events: 3, filtered: 0, skipped: 0, refused: 0 } } : entry.status }));
    const before = STATUSES("trigger-status-poll-failed.json").statuses.find((entry) => entry.id === "local/graph-watch")!.status;
    expect([before.lastPoll?.ok, before.lastError?.key, before.lastError !== null]).toEqual([false, null, true]);
    const view = page({ trigger: ready(triggers()), statuses: mended });
    const row = view.row("local/graph-watch");
    expect(parts(row)).toEqual(["On acme.graph: harvest-branches", "Runs on this computer", "Last 2 h ago, harvest/a"]);
    expect(row.dataset.failing).toBe("false");
    // And one that never fired keeps no red either.
    cleanup();
    const never = page({ statuses: withStatus("local/old-prs", (status) => ({ ...status, lastError: { at: new Date(NOW - 60e3).toISOString(), code: "E_TRIGGER_POLL", message: "gh: not logged in", key: null, says: null } })) });
    expect(never.row("local/old-prs").dataset.failing).toBe("false");
    // Its page keeps the kernel's last error, as what it is: an old one, muted, with when it was; not a red line under a calm head.
    never.open("local/old-prs");
    const old = never.getByTestId("oats-automation-last-error");
    expect([old.dataset.stands, old.className.includes("text-destructive-text"), old.textContent]).toEqual(["false", false, "Last error: gh: not logged in E_TRIGGER_POLL · 1 min ago"]);
  });

  it("one that is off is drawn muted; one another machine runs says which", () => {
    const view = page();
    expect(parts(view.row("local/weekly-cleanup"))).toEqual(["Fridays at 18:00", "Runs on this computer"]);
    expect(within(view.row("local/weekly-cleanup")).getByTestId("oats-automation-name").className).toContain("text-muted-foreground");
    expect(parts(view.row("oats-real/weekly-report"))).toEqual(["Mondays at 09:00", "Runs on report-server", "@acme-bot"]);
    expect(view.row("oats-real/weekly-report").dataset.failing).toBe("false");
  });

  it("a name of sixty characters is whole: never cut, in a place of its own beside the controls' fixed block", () => {
    const name = "customer-support-inbox-triage-and-first-reply-draft-emea-01x";
    expect(name).toHaveLength(60);
    const view = page({ schedule: ready(withRow(schedules(), "local/daily-review", (row) => ({ ...row, name }))) });
    const shownName = within(view.row("local/daily-review")).getByTestId("oats-automation-name");
    expect(shownName.textContent).toBe(name);
    expect(shownName.className).toContain("break-words");
    expect(shownName.className).not.toMatch(/truncate|text-ellipsis|whitespace-nowrap/);
    expect(within(view.row("local/daily-review")).getByTestId("oats-automation-open").className).toContain("min-w-0");
  });

  it("while the state of the triggers is not read, a trigger's last fire is the list's own and nothing is said of a failure", () => {
    const view = page({ statuses: null });
    expect(parts(view.row("local/pr-triage"))).toEqual(["On a pull request, acme/app", "Runs on this computer", "Last 2 h ago, #41"]);
    expect(radios(view)[4]!.textContent).toBe("Failing5");
  });
});

describe("the list's notices", () => {
  it("a scheduler that is off, with rows that would run: one line; the list says no next run in any case", () => {
    const view = page({ schedule: ready(schedules("schedule-list-scheduler-off.json")) });
    expect(view.text("oats-automations-scheduler-off")).toBe("The scheduler is off on this computer");
    expect(view.rows().some((row) => parts(row).some((part) => /^(Next|Was due) /.test(part ?? "")))).toBe(false);
  });

  it("a scheduler that is on says nothing", () => {
    const view = page();
    expect(view.queryByTestId("oats-automations-scheduler-off")).toBeNull();
    expect(view.queryByTestId("oats-automations-host-unnamed")).toBeNull();
  });

  it("a machine with no host name: one line, and where the key is under its Details", () => {
    const view = page({ schedule: ready(schedules("schedule-list-host-unnamed.json")), trigger: ready(triggers("trigger-list-host-unnamed.json")), statuses: [] });
    const notice = view.getByTestId("oats-automations-host-unnamed");
    expect(notice.textContent).toBe("This computer has no host name in OATS▸DetailsIn the deployment's oats-local.yaml on this computer, set host: name: to the name it goes by in the workspace, then press Refresh.");
    expect(within(notice).getByTestId("oats-notice-details").hasAttribute("open")).toBe(false);
  });

  it("what cannot be shown at all is said in place of the list, and of a row's page, with the tabs and Refresh still there", () => {
    const gate: Gate = { title: "Automations need OATS 0.29 or later", detail: "Update OATS to see the workspace's schedules and triggers and this computer's own, and where each one runs.", code: "OATS_NO_AUTOMATIONS" };
    const none: ListRead = { list: undefined, loading: false, error: null, readAt: null };
    const view = page({ gate, schedule: none, trigger: none });
    expect(view.text("oats-automations-gate")).toBe(`${gate.title}${gate.detail}${gate.code}`);
    expect(view.getAllByRole("tab")).toHaveLength(2);
    expect(view.queryByTestId("oats-automations-list")).toBeNull();
    cleanup();
    const open = page({ gate, open: { kind: "schedule", id: "local/daily-review" } });
    expect(open.getByTestId("oats-automations-gate")).toBeTruthy();
    expect(open.getAllByRole("tab")).toHaveLength(2);
    expect(open.getByTestId("oats-automations-refresh")).toBeTruthy();
    expect(open.queryByTestId("oats-automation-detail")).toBeNull();
  });

  it("a list that could not be read says so in a person's words, then the kernel's code and message, with Retry, over what was read before; the other list's rows stand", () => {
    const view = page({ schedule: { list: schedules(), loading: false, error: { code: "E_SCHEDULE_INVALID", message: "oats-schedules.json cannot be read" }, readAt: new Date(NOW - 3 * 60e3).toISOString() } });
    const alert = view.getByRole("alert");
    expect(alert.textContent).toBe("Schedules could not be readWhat is below is the last list that was read.Read 3 min ago.E_SCHEDULE_INVALID▸Detailsoats-schedules.json cannot be readRetry");
    fireEvent.click(within(alert).getByText("Retry"));
    expect(view.log).toEqual(["refresh"]);
    expect(view.rows()).toHaveLength(18);
    cleanup();
    const half = page({ trigger: { list: undefined, loading: false, error: { code: "E_TRIGGER_INVALID", message: "oats-triggers.json cannot be read" }, readAt: null }, statuses: null });
    expect(half.getByRole("alert").textContent).toBe("Triggers could not be readNothing can be shown of this deployment's triggers until they are read.E_TRIGGER_INVALID▸Detailsoats-triggers.json cannot be readRetry");
    expect(half.rows()).toHaveLength(11);
  });

  it("while a failed read is asked again the notice says so in words, and Retry cannot be pressed twice", () => {
    const view = page({ refreshing: true, schedule: { list: undefined, loading: false, error: { code: null, message: "the plugin's server is restarting" }, readAt: null } });
    expect(view.getByRole("alert").textContent).toBe("Schedules could not be readNothing can be shown of this deployment's schedules until they are read.Refreshing…▸Detailsthe plugin's server is restartingRetry");
    expect(view.getByTestId("oats-automations-rereading").getAttribute("role")).toBe("status");
    expect((view.getByTestId("oats-automations-retry") as HTMLButtonElement).disabled).toBe(true);
  });

  it("lists read a while ago say how old they are; ones being read again say so, without blanking", () => {
    const at = (ms: number) => new Date(NOW - ms).toISOString();
    const old = page({ schedule: ready(schedules(), at(2 * 60e3)), trigger: ready(triggers(), at(5e3)) });
    expect(old.getByTestId("oats-stale").textContent).toBe("Read 2 min ago.");
    cleanup();
    const fresh = page({ schedule: ready(schedules(), at(5e3)), trigger: ready(triggers(), at(5e3)) });
    expect(fresh.queryByTestId("oats-stale")).toBeNull();
    cleanup();
    const again = page({ refreshing: true, schedule: ready(schedules(), at(5e3)), trigger: ready(triggers(), at(5e3)) });
    expect(again.getByTestId("oats-stale").textContent).toBe("Refreshing… read less than a minute ago.");
    expect(again.rows()).toHaveLength(18);
    expect((again.getByTestId("oats-automations-refresh") as HTMLButtonElement).disabled).toBe(true);
  });
});

describe("an automation's page", () => {
  it("opens from the row, in place of the tabs, with the focus on its name; Escape returns to the row. It draws no breadcrumb: that is bb's own, in bb's header", () => {
    const view = page();
    view.open("local/daily-review");
    expect(view.queryAllByRole("tab")).toHaveLength(0);
    expect(view.getByRole("tabpanel").getAttribute("aria-label")).toBe("Automation");
    expect(document.activeElement).toBe(view.getByRole("heading", { name: "daily-review" }));
    expect(view.queryByRole("navigation")).toBeNull();
    back(view);
    expect(document.activeElement).toBe(within(view.row("local/daily-review")).getByTestId("oats-automation-open"));
    view.open("local/pr-triage");
    back(view);
    expect(document.activeElement).toBe(within(view.row("local/pr-triage")).getByTestId("oats-automation-open"));
  });

  it("its head: the name whole, the small line, and what is wrong under it, in red, by itself", () => {
    const view = page();
    view.open("local/hourly-check");
    const head = view.getByTestId("oats-automation-identity");
    expect(within(head).getByRole("heading").textContent).toBe("hourly-check");
    // The page's own line says the next run too; what is wrong stands under it.
    expect(parts(head)).toEqual(["Every hour", "Runs on this computer", "Was due 1 h ago"]);
    expect(within(head).getByTestId("oats-automation-wrong").textContent).toBe("Launch failed");
    expect(within(head).getByTestId("oats-automation-wrong").className).toContain("text-destructive-text");
  });

  it("the switch and the menu the page hands it stand beside the name", () => {
    const picked: string[] = [];
    const view = page({ rowParts: (row) => ({ identityAction: <span data-testid="its-switch">{row.id}</span>, menu: [{ id: "run", label: "Run now", onSelect: () => picked.push(row.id) }] }) });
    view.open("local/daily-review");
    const head = view.getByTestId("oats-automation-identity");
    expect(within(head).getByTestId("its-switch").textContent).toBe("local/daily-review");
    const menu = within(within(head).getByTestId("oats-automation-detail-menu")).getByRole("button");
    expect(menu.getAttribute("aria-label")).toBe("Actions for daily-review");
    fireEvent.click(menu);
    fireEvent.click(view.getByRole("menuitem", { name: "Run now" }));
    expect(picked).toEqual(["local/daily-review"]);
  });

  it("what it does is a card, named by what a run does: an instruction, a message, a command, an operation; at its foot the soul, the harness and the model", () => {
    const view = page();
    const does = (id: string) => {
      view.open(id);
      const card = view.getByTestId("oats-automation-sends");
      const said = [within(card).getByRole("heading").textContent, card.getAttribute("aria-label")];
      back(view);
      return said;
    };
    expect(does("local/daily-review")).toEqual(["Instruction", "Instruction"]);
    expect(does("local/pr-triage")).toEqual(["Instruction", "Instruction"]);
    expect(does("local/wake-oats-developer-review-202611212017")).toEqual(["Message", "Message"]);
    expect(does("local/status-check")).toEqual(["Command", "Command"]);
    expect(does("local/notes-checkpoint")).toEqual(["Operation", "Operation"]);
    view.open("local/daily-review");
    const row = rowOf(schedules(), "local/daily-review");
    expect(view.getByTestId("oats-automation-prose").textContent).toBe(shownBlock(row.task));
    expect(view.text("oats-automation-foot")).toContain("oats-developer");
  });

  it("a wake's message is whole; a command is its arguments, one by one; an operation is its name", () => {
    const view = page();
    view.open("local/wake-oats-developer-review-202611212017");
    expect(view.getByTestId("oats-automation-prose").textContent).toBe("Anything new on your review?");
    back(view);
    view.open("local/status-check");
    const argv = rowOf(schedules(), "local/status-check").argv!;
    expect(within(view.getByRole("list", { name: "Command arguments" })).getAllByRole("listitem").map((item) => item.textContent)).toEqual(argv);
    back(view);
    view.open("local/notes-checkpoint");
    expect(view.text("oats-automation-sends")).toBe("Operationknowledge:checkpoint");
  });

  it("a wake says which agent it wakes, by its name, and is the way to its chat where the roster lists it; an operation and a command say where they run, under Details", () => {
    const wake = rowOf(schedules(), "local/wake-oats-developer-review-202611212017");
    const opened: string[] = [];
    const listed = page({ agentLink: (instance) => ({ open: () => opened.push(instance), asks: false, start: null }) });
    listed.open(wake.id);
    expect(listed.text("oats-automation-sends")).toBe("MessageAnything new on your review?Wakes oats-developer-review-202611212017");
    fireEvent.click(listed.getByTestId("oats-automation-wakes-open"));
    expect(opened).toEqual(["oats-developer-review-202611212017"]);
    cleanup();
    // An agent the roster no longer lists is named still, as text.
    const gone = page({ agentLink: () => null });
    gone.open(wake.id);
    expect(gone.text("oats-automation-wakes")).toBe("Wakes oats-developer-review-202611212017");
    expect(gone.queryByTestId("oats-automation-wakes-open")).toBeNull();
    back(gone);
    gone.open("local/notes-checkpoint");
    expect(gone.text("oats-automation-detail-runs-in")).toBe("Runs in/abs/deployment/agents/note-keeper/instances/team-notes-keeper");
    back(gone);
    gone.open("local/status-check");
    expect(gone.text("oats-automation-detail-runs-in")).toBe(`Runs in${rowOf(schedules(), "local/status-check").cwd}`);
    back(gone);
    // A spawn has neither: its soul is at the foot.
    gone.open("local/daily-review");
    expect([gone.queryByTestId("oats-automation-wakes"), gone.queryByTestId("oats-automation-detail-runs-in")]).toEqual([null, null]);
  });

  it("an invalid definition says so in a person's words, with the kernel's code, field and message one press away", () => {
    const view = page();
    view.open("local/legacy-herdr");
    const problem = view.getByTestId("oats-automation-problem");
    expect(problem.textContent).toContain("InvalidOATS cannot use this definition as it is written, so it does not run.");
    expect(within(problem).getByTestId("oats-automation-problem-details").textContent).toBe("▸DetailsCodeE_HERDR_REMOVEDFieldbackendMessageHerdr is no longer supported by OATS (removed in 0.31.0); tmux is the only session backend. /abs/deployment/oats-schedules.json sets jobs.legacy-herdr.backend: herdr. Remove it (or use tmux).");
    expect(view.text("oats-automation-wrong")).toBe("Invalid");
  });

  it("its sentence, where one is written, stands under its name, whole", () => {
    const view = page();
    view.open("local/daily-review");
    const sentence = within(view.getByTestId("oats-automation-identity")).getByTestId("oats-automation-sentence");
    expect(sentence.textContent).toBe("Review open pull requests every weekday morning");
    expect(sentence.className).not.toContain("line-clamp");
    back(view);
    view.open("local/hourly-check");
    expect(view.queryByTestId("oats-automation-sentence")).toBeNull();
  });

  it("what it does is plain text between separators: no box around it, none filled", () => {
    const view = page();
    view.open("local/daily-review");
    const card = view.getByTestId("oats-automation-sends");
    expect(card.className).toContain("border-t");
    expect(card.innerHTML).not.toMatch(/rounded-(md|lg) border|bg-(muted|card|background)/);
  });
});

describe("what needs a person", () => {
  const ASKS = "oats-developer-review-202611212017";
  const asking = (row: AutomationRow) => (row.id === "local/daily-review" ? ASKS : null);

  it("an automation whose agent asks comes first, before what is failing, with the needs-you mark, the words, and Answer, which opens that agent's chat", () => {
    const answered: string[] = [];
    const view = page({ asking, onAnswer: (instance) => answered.push(instance) });
    expect(view.ids().slice(0, 6)).toEqual(["local/daily-review", ...ORDER.slice(0, 5)]);
    const row = view.row("local/daily-review");
    expect([row.dataset.state, within(row).getByTestId("oats-automation-icon").getAttribute("aria-label")]).toEqual(["needs", "Needs you"]);
    expect([parts(row).at(-1), tones(row).at(-1)]).toEqual(["Needs you", "ask"]);
    const answers = within(row).getAllByTestId("oats-automation-answer");
    expect(answers.map((button) => [button.textContent, button.getAttribute("aria-label")])).toEqual(Array(2).fill(["Answer", "Answer daily-review"]));
    fireEvent.click(answers[0]!);
    expect(answered).toEqual([ASKS]);
    expect(within(view.row("local/hourly-check")).queryByTestId("oats-automation-answer")).toBeNull();
  });

  it("the filter counts it and keeps it; one that also fails is among the failing too", () => {
    const view = page({ asking: (row) => (row.id === "local/daily-review" || row.id === "local/hourly-check" ? ASKS : null) });
    expect(radios(view).map((radio) => radio.textContent)).toEqual(["All18", "Schedules11", "Triggers7", "Needs you2", "Failing5"]);
    fireEvent.click(radios(view)[3]!);
    expect(view.ids()).toEqual(["local/daily-review", "local/hourly-check"]);
    fireEvent.click(radios(view)[4]!);
    expect(view.ids()).toContain("local/hourly-check");
  });

  it("on its own page: the mark's place, Needs you in its line, and Answer beside its switch", () => {
    const answered: string[] = [];
    const view = page({ asking, onAnswer: (instance) => answered.push(instance) });
    view.open("local/daily-review");
    const head = view.getByTestId("oats-automation-identity");
    expect(parts(head).at(-1)).toBe("Needs you");
    // The head's mark is the roster's needs-you mark, as its row's is.
    const icon = within(head).getByTestId("oats-automation-head-icon");
    expect([icon.dataset.state, icon.querySelector('[data-state="needs-you"]') !== null]).toEqual(["needs", true]);
    fireEvent.click(within(head).getByTestId("oats-automation-answer"));
    expect(answered).toEqual([ASKS]);
  });
});

describe("a prompt and a wake message are drawn whole, and a long one has a bound", () => {
  const withTask = (task: string) => ready(withRow(schedules(), "local/daily-review", (row) => ({ ...row, task })));
  const opened = (task: string) => {
    const view = page({ schedule: withTask(task) });
    view.open("local/daily-review");
    return view;
  };
  const prose = (task: string) => opened(task).getByTestId("oats-automation-prose");

  it("keeps every line, blank line and indentation, however a line break was written", () => {
    expect(shownBlock("Review the open PRs.\r\n\r\nSteps:\n  1. list them\n\t- nested\u2028done")).toBe("Review the open PRs.\n\nSteps:\n  1. list them\n\t- nested\ndone");
    const block = prose("Review the open PRs.\n\nSteps:\n  1. list them");
    expect(block.textContent).toBe("Review the open PRs.\n\nSteps:\n  1. list them");
    expect(block.className).toContain("whitespace-pre-wrap");
  });

  it("withholds nothing and cuts nothing: a prompt that names a password is the prompt, and a long one is all in the page", () => {
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

  it("a short text has no bound; a long one is drawn to its bound, with Show more to the rest and Show less back", () => {
    const short = opened("Review the open pull requests.");
    expect(short.getByTestId("oats-automation-prose").dataset.bounded).toBe("false");
    expect(short.queryByTestId("oats-automation-prose-more")).toBeNull();
    // The bound is a number of whole lines, never a height that cuts a line through its letters.
    expect(short.getByTestId("oats-automation-prose").className).toMatch(/line-clamp-\[8\]/);
    expect(short.getByTestId("oats-automation-prose").className).not.toMatch(/max-h-/);
    cleanup();
    for (const long of ["z".repeat(PROSE_BOUND.characters + 1), Array(PROSE_BOUND.lines + 1).fill("a line").join("\n")]) {
      const view = opened(long);
      const block = view.getByTestId("oats-automation-prose");
      const more = view.getByTestId("oats-automation-prose-more");
      expect([block.dataset.bounded, more.textContent, more.getAttribute("aria-expanded")]).toEqual(["true", "Show more", "false"]);
      expect(block.className).toContain("overflow-hidden");
      fireEvent.click(more);
      expect([block.dataset.bounded, more.textContent, more.getAttribute("aria-expanded")]).toEqual(["false", "Show less", "true"]);
      expect(block.className).not.toContain("overflow-hidden");
      cleanup();
    }
  });

  it("a trigger's fields the event fills are told from its text", () => {
    const view = page();
    view.open("oats-real/proposal-review");
    const fields = Array.from(view.getByTestId("oats-automation-prose").querySelectorAll<HTMLElement>("[data-field]")).map((field) => field.textContent);
    expect(fields.length).toBeGreaterThan(0);
    expect(fields.every((field) => /^\{[a-z]+\}$/.test(field ?? ""))).toBe(true);
  });
});

describe("an automation's runs", () => {
  const said = (run: HTMLElement) => within(run).getByTestId("oats-run-said").textContent;
  const mark = (run: HTMLElement) => within(run).getByRole("img").getAttribute("aria-label");

  it("a schedule: one row per run: a mark with its name, when, the outcome in a person's word, and the agent it made", () => {
    const view = page();
    view.open("local/daily-review");
    expect(within(view.getByTestId("oats-automation-history")).getByRole("heading").textContent).toBe("Runs");
    const [run] = view.runs();
    expect(view.runs()).toHaveLength(1);
    expect([run!.dataset.of, mark(run!), said(run!)]).toEqual(["run", "Done", "Agent launched"]);
    expect(within(run!).getByRole("time").getAttribute("datetime")).toBe("2026-11-21T20:17:32.946Z");
    expect(within(run!).getByTestId("oats-run-agent").textContent).toBe("oats-developer-review-202611212017");
  });

  it("the WHOLE row opens the chat of the agent the run made, while the roster lists it; once it does not, the row opens nothing and has no chevron: its agent's name, plain, with no word after it", () => {
    const opened: string[] = [];
    const listed = page({ agentLink: (instance) => ({ open: () => opened.push(instance), asks: false, start: null }) });
    listed.open("local/daily-review");
    const [run] = listed.runs();
    const row = within(run!).getByTestId("oats-run-row");
    expect([row.tagName, row.getAttribute("aria-label")]).toEqual(["BUTTON", "Open oats-developer-review-202611212017"]);
    expect(within(run!).getByTestId("oats-run-chevron")).toBeTruthy();
    expect(within(run!).getByTestId("oats-run-agent").dataset.listed).toBe("true");
    fireEvent.click(row);
    expect(opened).toEqual(["oats-developer-review-202611212017"]);
    // Nothing else in the row: no Answer, no menu.
    expect(within(run!).queryByTestId("oats-run-answer")).toBeNull();
    expect(within(run!).queryByTestId("oats-run-menu")).toBeNull();
    cleanup();
    const gone = page({ agentLink: () => null });
    gone.open("local/daily-review");
    const [left] = gone.runs();
    expect(within(left!).queryByTestId("oats-run-row")).toBeNull();
    expect(within(left!).queryByTestId("oats-run-chevron")).toBeNull();
    const plain = within(left!).getByTestId("oats-run-agent");
    expect([plain.tagName, plain.dataset.listed, plain.textContent]).toEqual(["SPAN", "false", "oats-developer-review-202611212017"]);
  });

  it("a run whose agent asks says Needs you by its mark and its word, with Answer; one whose agent is stopped has Start… in its menu, the lifecycle's own", () => {
    const log: string[] = [];
    const asks = page({ agentLink: (instance) => ({ open: () => log.push(`open ${instance}`), asks: true, start: null }) });
    asks.open("local/daily-review");
    const [asking] = asks.runs();
    expect([asking!.dataset.outcome, mark(asking!), said(asking!)]).toEqual(["asks", "Needs you", "Needs you"]);
    fireEvent.click(within(asking!).getByTestId("oats-run-answer"));
    expect(log).toEqual(["open oats-developer-review-202611212017"]);
    cleanup();
    const stopped = page({ agentLink: (instance) => ({ open: () => undefined, asks: false, start: () => log.push(`start ${instance}`) }) });
    stopped.open("local/daily-review");
    const [run] = stopped.runs();
    fireEvent.click(within(within(run!).getByTestId("oats-run-menu")).getByRole("button"));
    const item = stopped.getByRole("menuitem");
    expect(item.textContent).toBe("Start…");
    fireEvent.click(item);
    expect(log.at(-1)).toBe("start oats-developer-review-202611212017");
  });

  it("what an agent is now is said ONCE, on the newest run that names it: older runs of the same agent keep their own mark and word, and still open its chat", () => {
    // A wake's runs all name the one agent it wakes: three runs of one instance, which asks.
    const run = rowOf(schedules(), "local/daily-review").recentRuns[0]!;
    const three = [0, 1, 2].map((day) => ({ ...run, runId: `run-${day}`, outcome: day === 1 ? "launch-failed" : "ended", error: day === 1 ? "the provider refused" : null, startedAt: new Date(Date.parse(run.startedAt!) - day * 86400e3).toISOString() }));
    const opened: string[] = [];
    const view = page({ schedule: ready(withRow(schedules(), "local/daily-review", (row) => ({ ...row, recentRuns: three }))), agentLink: (instance) => ({ open: () => opened.push(instance), asks: true, start: () => undefined }) });
    view.open("local/daily-review");
    expect(view.runs().map((entry) => [entry.dataset.outcome, mark(entry), said(entry), within(entry).queryByTestId("oats-run-answer") !== null, within(entry).queryByTestId("oats-run-menu") !== null])).toEqual([
      ["asks", "Needs you", "Needs you", true, true],
      ["failed", "Failed", "Launch failed", false, false],
      ["done", "Done", "Run ended", false, false],
    ]);
    // Each of them is still the way into the agent's chat.
    for (const entry of view.runs()) fireEvent.click(within(entry).getByTestId("oats-run-row"));
    expect(opened).toHaveLength(3);
  });

  it("a run that failed says so by its mark and its word; the newest one stands open to the kernel's code and message, and closes", () => {
    const view = page();
    view.open("local/hourly-check");
    const [run] = view.runs();
    expect([mark(run!), said(run!), run!.dataset.outcome]).toEqual(["Failed", "Launch failed", "failed"]);
    const error = within(run!).getByTestId("oats-run-error");
    expect(error.textContent).toMatch(/^E_BACKEND_SANDBOXED_MODEoats-developer-hourly-check-202611212017 was not launched: /);
    const toggle = within(run!).getByTestId("oats-run-toggle");
    expect([toggle.textContent, toggle.getAttribute("aria-expanded")]).toEqual(["▸Details", "true"]);
    fireEvent.click(toggle);
    expect(within(run!).queryByTestId("oats-run-error")).toBeNull();
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
  });

  it("a run whose state nobody knows is one row, with the kernel's words one press away: the attempt the history already holds is not a second row", () => {
    const view = page();
    view.open("local/status-check");
    expect(view.runs()).toHaveLength(1);
    const [run] = view.runs();
    expect([run!.dataset.of, mark(run!), said(run!)]).toEqual(["run", "Not known", "Launch state unknown"]);
    expect(within(run!).queryByTestId("oats-run-error")).toBeNull();
    fireEvent.click(within(run!).getByTestId("oats-run-toggle"));
    expect(within(run!).getByTestId("oats-run-error").textContent).toBe("command answered no valid envelope; its side effects are unconfirmed");
  });

  it("a launch with no recorded result is a row of its own: under way while the job's lock is held, else not known; a wake that waits is a row", () => {
    const attempt = { scheduledFor: "2026-11-21T21:00:00.000Z", startedAt: "2026-11-21T21:00:03.000Z", error: null, exited: null, exitStatus: null, exitSignal: null };
    const running = page({ schedule: ready(withRow(schedules(), "local/daily-review", (row) => ({ ...row, running: true, attempt }))) });
    running.open("local/daily-review");
    expect(running.runs().map((run) => [run.dataset.of, mark(run), said(run)])).toEqual([
      ["attempt", "Running", "Running"],
      ["run", "Done", "Agent launched"],
    ]);
    cleanup();
    // An attempt that carries an error is not under way, though the job's lock is held: not known, as the row's own state says (and its menu offers "Check run state").
    const errored = page({ schedule: ready(withRow(schedules(), "local/daily-review", (row) => ({ ...row, running: true, attempt: { ...attempt, error: "boom" } }))) });
    errored.open("local/daily-review");
    expect(errored.runs().slice(0, 1).map((run) => [run.dataset.of, mark(run), said(run)])).toEqual([["attempt", "Not known", "Launch state unknown"]]);
    cleanup();
    const lost = page({ schedule: ready(withRow(schedules(), "local/daily-review", (row) => ({ ...row, running: false, attempt, pendingWake: { scheduledFor: "2026-11-21T21:30:00.000Z" } }))) });
    lost.open("local/daily-review");
    expect(lost.runs().map((run) => [run.dataset.of, mark(run), said(run)])).toEqual([
      ["attempt", "Not known", "Launch state unknown"],
      ["wake", "Waiting", "Waiting"],
      ["run", "Done", "Agent launched"],
    ]);
  });

  it("a schedule with no run says so in two words", () => {
    const view = page();
    view.open("oats-real/nightly-digest");
    expect(view.text("oats-runs-empty")).toBe("No runs");
  });

  it("a trigger that never fired says no Last in its row, and its own page is not silent: its Runs say No runs", () => {
    // The recorded trigger that never fired.
    const never = STATUSES().statuses.find((entry) => entry.id === "local/old-prs")!.status;
    expect([never.fired.length, never.pending.length]).toEqual([0, 0]);
    const view = page();
    expect(parts(view.row("local/old-prs")).some((part) => /^Last/.test(part ?? ""))).toBe(false);
    view.open("local/old-prs");
    expect(view.text("oats-runs-empty")).toBe("No runs");
  });

  it("fifty runs are not a wall: ten, then Older, ten more a press; and where older ones were dropped, the table says so at its end", () => {
    const run = rowOf(schedules(), "local/daily-review").recentRuns[0]!;
    const fifty = Array.from({ length: 50 }, (_, at) => ({ ...run, runId: `run-${at}`, startedAt: new Date(Date.parse(run.startedAt!) - at * 86400e3).toISOString() }));
    const view = page({ schedule: ready(withRow(schedules(), "local/daily-review", (row) => ({ ...row, recentRuns: fifty, history: { stored: 50, truncated: true } }))) });
    view.open("local/daily-review");
    expect(view.runs()).toHaveLength(10);
    expect(view.queryByTestId("oats-runs-cut")).toBeNull();
    const older = () => view.getByTestId("oats-runs-older");
    expect(older().textContent).toBe("Older");
    fireEvent.click(older());
    expect(view.runs()).toHaveLength(20);
    for (let press = 0; press < 3; press += 1) fireEvent.click(older());
    expect(view.runs()).toHaveLength(50);
    expect(view.queryByTestId("oats-runs-older")).toBeNull();
    expect(view.text("oats-runs-cut")).toBe("Earlier runs are not kept");
  });

  it("a trigger: what waits first, then what fired, each by its event, with the agent it made", () => {
    const view = page();
    view.open("local/pr-triage");
    expect(view.runs().map((run) => [run.dataset.of, mark(run), said(run)])).toEqual([
      ["pending", "Waiting", "#42 opened · Waiting"],
      ["pending", "Waiting", "#43 opened · Waiting"],
      ["pending", "Waiting", "#45 opened · Waiting"],
      ["fired", "Done", "#41 opened · Agent launched"],
    ]);
    expect(within(view.runs()[3]!).getByTestId("oats-run-agent").textContent).toBe("oats-developer-triage-41");
  });

  it("a trigger that fired more than its state lists says how many earlier runs are not kept: the kernel's own count", () => {
    const view = page({ statuses: withStatus("local/pr-triage", (status) => ({ ...status, firedTotal: status.fired.length + 3 })) });
    view.open("local/pr-triage");
    expect(view.text("oats-runs-cut")).toBe("3 earlier runs are not kept");
  });

  it("before a trigger's state is read nothing is said of its runs, least of all that there are none; when that read fails, the notice says so with Retry", () => {
    const view = page({ statuses: null });
    view.open("local/pr-triage");
    expect(view.queryByTestId("oats-runs-empty")).toBeNull();
    expect(within(view.getByTestId("oats-automation-history")).getByTestId("oats-loading").textContent).toBe("Reading…");
    cleanup();
    let retried = 0;
    const failed = page({ statuses: null, open: { kind: "trigger", id: "local/pr-triage" }, statusFailure: { code: "E_TRIGGER_UNKNOWN", message: "no trigger local/pr-triage", readAt: null, onRetry: () => (retried += 1) } });
    const notice = failed.getByTestId("oats-automation-status-failed");
    expect(notice.textContent).toBe("This trigger's state could not be readE_TRIGGER_UNKNOWN▸Detailsno trigger local/pr-triageRetry");
    expect(failed.queryByTestId("oats-runs-empty")).toBeNull();
    expect(within(failed.getByTestId("oats-automation-history")).queryByTestId("oats-loading")).toBeNull();
    fireEvent.click(failed.getByTestId("oats-automation-status-retry"));
    expect(retried).toBe(1);
  });

  it("on a kernel that keeps no history of failures, the last error alone is said, as the kernel words it, and nothing claims a history", () => {
    const view = page({ statuses: withStatus("local/pr-triage", (status) => ({ ...status, lastError: { at: new Date(NOW - 60e3).toISOString(), code: "E_SPAWN_NAME", message: "the name is taken", key: "local/pr-triage:44", says: null } })) });
    view.open("local/pr-triage");
    expect(view.text("oats-automation-last-error")).toBe("Last error: the name is taken E_SPAWN_NAME");
    expect(view.runs().some((run) => run.dataset.of === "failure")).toBe(false);
  });

  // The fields of a failed spawn (`failures[]`: attempt, at, key, event, subject, code, message, resolved) are those the
  // kernel's contract names for the feature `trigger-failure-history` (awebai/oats docs/desktop-cli-api.md), ADDED BY HAND
  // to a recorded state: no released kernel answers them yet.
  it("NAMED FIELDS ADDED TO A RECORDED ANSWER: with a history of failures, each failed spawn is a row of the table; its attempt from the second on, and 'Launched later' once a later attempt spawned, under its fold", () => {
    const failure = { attempt: 1, at: new Date(NOW - 30 * 60e3).toISOString(), key: "local/pr-triage:44", event: "opened", label: "#44", code: "E_SPAWN_NAME", message: "the name is taken", instance: null, resolved: null };
    const failures = [
      { ...failure, attempt: 2, at: new Date(NOW - 10 * 60e3).toISOString() },
      { ...failure, resolved: { at: new Date(NOW - 5 * 60e3).toISOString(), instance: "oats-developer-triage-44" } },
    ];
    const view = page({ statuses: withStatus("local/pr-triage", (status) => ({ ...status, failures, failuresTotal: 2, lastError: { at: failures[0]!.at, code: "E_SPAWN_NAME", message: "the name is taken", key: null, says: null } })) });
    view.open("local/pr-triage");
    const rows = view.runs().filter((run) => run.dataset.of === "failure");
    expect(rows.map((run) => [mark(run), said(run)])).toEqual([
      ["Failed", "#44 opened · Launch failed"],
      ["Failed", "#44 opened · Launch failed"],
    ]);
    // Newest first among what happened: both failures are after the recorded fire.
    expect(view.runs().map((run) => run.dataset.of)).toEqual(["pending", "pending", "pending", "failure", "failure", "fired"]);
    expect(within(rows[1]!).getByTestId("oats-run-agent").textContent).toBe("oats-developer-triage-44");
    fireEvent.click(within(rows[0]!).getByTestId("oats-run-toggle"));
    // The row is its mark, when, what came of it and the agent, and nothing else: which attempt it was, and that a later one launched, are under its fold with the kernel's words.
    expect(within(rows[0]!).getByTestId("oats-run-error").textContent).toBe("attempt 2E_SPAWN_NAMEthe name is taken");
    fireEvent.click(within(rows[1]!).getByTestId("oats-run-toggle"));
    expect(within(rows[1]!).getByTestId("oats-run-error").textContent).toBe("Launched laterE_SPAWN_NAMEthe name is taken");
    // The history says it: the last error is not said a second time.
    expect(view.queryByTestId("oats-automation-last-error")).toBeNull();
  });

  it("a failed poll is a notice over the runs: when, its cause in words, the kernel's error one press away, the source's own words as a quote", () => {
    const view = page({ trigger: ready(triggers("trigger-list-poll-failed.json")), statuses: STATUSES("trigger-status-poll-failed.json").statuses });
    view.open("local/graph-watch");
    const notice = view.getByTestId("oats-automation-last-poll");
    expect(notice.textContent).toContain("The last poll failed");
    expect(notice.textContent).toContain("the source refused");
    expect(within(notice).getByTestId("oats-automation-source-says")).toBeTruthy();
    expect(view.text("oats-automation-wrong")).toBe("Poll failed");
  });
});

describe("an automation's Details: one closed fold, in bb's own rows, of what is set", () => {
  const rowsOf = (view: ReturnType<typeof page>) => Array.from(view.getByTestId("oats-automation-details").querySelectorAll<HTMLElement>('[data-testid^="oats-automation-detail-"]')).map((row) => row.dataset.testid!.replace("oats-automation-detail-", ""));
  const value = (view: ReturnType<typeof page>, id: string) => view.getByTestId(`oats-automation-detail-${id}`).textContent;

  it("is closed until it is opened", () => {
    const view = page();
    view.open("local/daily-review");
    expect(view.getByTestId("oats-automation-details").hasAttribute("open")).toBe(false);
    expect(within(view.getByTestId("oats-automation-details")).getByText("Details")).toBeTruthy();
  });

  it("a local schedule: where it runs, its cron and time zone, its file", () => {
    const view = page();
    view.open("local/daily-review");
    const row = rowOf(schedules(), "local/daily-review");
    expect(rowsOf(view).slice(0, 4)).toEqual(["id", "runs-on", "schedule", "file"]);
    expect(value(view, "id")).toBe("Idlocal/daily-review");
    expect(value(view, "runs-on")).toBe("Runs onThis computer");
    expect(value(view, "schedule")).toBe(`Schedule${row.cron} · ${row.tz}`);
    expect(value(view, "file")).toBe(`File${row.origin.path ?? row.origin.localPath}`);
  });

  it("its id, whole: two automations of one name in two members are told apart there", () => {
    // The recorded nightly digest, and a second of the same name in another member.
    const list = schedules();
    const twin = { ...rowOf(list, "oats-real/nightly-digest"), id: "acme-tools/nightly-digest" };
    const view = page({ schedule: ready({ ...list, rows: [...list.rows, twin] }) });
    const names = view.rows().filter((row) => ["oats-real/nightly-digest", "acme-tools/nightly-digest"].includes(row.dataset.id!)).map((row) => within(row).getByTestId("oats-automation-name").textContent);
    expect(names).toEqual(["nightly-digest", "nightly-digest"]);
    const ids: (string | null)[] = [];
    for (const id of ["oats-real/nightly-digest", "acme-tools/nightly-digest"]) {
      view.open(id);
      ids.push(value(view, "id"));
      expect(view.getByTestId("oats-automation-detail-id").querySelector(".truncate, .line-clamp-1")).toBeNull();
      back(view);
    }
    expect(ids).toEqual(["Idoats-real/nightly-digest", "Idacme-tools/nightly-digest"]);
  });

  it("one that does not run here says why, in the kernel's words", () => {
    const view = page();
    view.open("oats-real/release-check");
    const row = rowOf(schedules(), "oats-real/release-check");
    expect(value(view, "runs-on")).toBe(`Runs onNot trusted here${row.reasonDetail}`);
  });

  it("teams, a concurrency, a launch configuration: only where they are set", () => {
    const view = page({ schedule: ready(withRow(schedules(), "local/daily-review", (row) => ({ ...row, teams: [], concurrency: null, launchConfig: null, wake: null }))) });
    view.open("local/daily-review");
    expect(rowsOf(view)).toEqual(["id", "runs-on", "schedule", "file"]);
    cleanup();
    const set = page({ schedule: ready(withRow(schedules(), "local/daily-review", (row) => ({ ...row, teams: ["platform", "support"], concurrency: { max: 2, perKey: null }, launchConfig: "fast", wake: null }))) });
    set.open("local/daily-review");
    expect(rowsOf(set)).toEqual(["id", "runs-on", "schedule", "file", "teams", "concurrency", "launch-config"]);
    expect([value(set, "teams"), value(set, "concurrency"), value(set, "launch-config")]).toEqual(["Teamsplatform, support", "Concurrency2 at once", "Launch configurationfast"]);
  });

  it("the file opens where the page can open it, and is its path as text where it cannot", () => {
    const opened: unknown[] = [];
    const target = { kind: "preview" as const, hostId: "host_falcon", path: "/abs/deployment/oats-schedules.json" };
    const view = page({ onOpenFile: (file) => opened.push(file), rowParts: () => ({ file: target }) });
    view.open("local/daily-review");
    fireEvent.click(view.getByTestId("oats-automation-open-file"));
    expect(opened).toEqual([target]);
    cleanup();
    const none = page({ onOpenFile: (file) => opened.push(file), rowParts: () => ({ file: null }) });
    none.open("local/daily-review");
    expect(none.queryByTestId("oats-automation-open-file")).toBeNull();
    expect(value(none, "file")).toContain("File");
  });

  it("a pull-request trigger: its event, labels, base and poll where set, how many are live, and its last poll in counts", () => {
    const view = page();
    view.open("oats-real/proposal-review");
    expect(rowsOf(view)).toContain("event");
    expect(value(view, "event")).toMatch(/^EventPull request /);
    expect(value(view, "last-poll")).toBe("Last poll2 h ago: 5 pull requests, 4 matching");
    const status = statusOf("oats-real/proposal-review");
    expect(value(view, "concurrency")).toContain(`${status.liveCount} of ${status.max} live now`);
  });

  it("a capability source: its source, which opens the capability only where the Capabilities page lists it; its events; the trigger file's parameters and what its last good poll refused and skipped, as quotes", () => {
    const opened: string[] = [];
    const view = page({ canOpenCapability: (name) => name === "acme.graph", onOpenCapability: (name) => opened.push(name) });
    view.open("oats-real/harvest-review");
    expect(value(view, "source")).toBe("Sourceacme.graph · harvest-branches");
    fireEvent.click(view.getByTestId("oats-automation-open-capability"));
    expect(opened).toEqual(["acme.graph"]);
    expect(value(view, "last-poll")).toBe("Last poll2 h ago: 2 events, 1 filtered, 2 skipped, 2 refused");
    expect(view.getByTestId("oats-automation-refused")).toBeTruthy();
    expect(view.getByTestId("oats-automation-skipped")).toBeTruthy();
    cleanup();
    const unlisted = page({ canOpenCapability: () => false, onOpenCapability: (name) => opened.push(name) });
    unlisted.open("oats-real/harvest-review");
    expect(unlisted.queryByTestId("oats-automation-open-capability")).toBeNull();
    expect(value(unlisted, "source")).toBe("Sourceacme.graph · harvest-branches");
  });
});

describe("the Runs tab: every automation's runs, newest first", () => {
  const owners = (view: ReturnType<typeof page>) => view.runs().map((run) => within(run).getByTestId("oats-run-owner").textContent);

  it("each row is led by its automation's name, newest first, schedules' runs and triggers' fires together", () => {
    const view = page({ tab: "runs" });
    expect(view.runs()).toHaveLength(9);
    expect(owners(view)[0]).toBe("harvest-review");
    expect(new Set(view.runs().map((run) => run.dataset.of))).toEqual(new Set(["run", "fired"]));
    const times = view.runs().map((run) => Date.parse(within(run).getByRole("time").getAttribute("datetime")!));
    expect(times).toEqual([...times].sort((a, b) => b - a));
    expect(view.queryByTestId("oats-runs-cut")).toBeNull();
  });

  it("an automation's name opens the automation's page", () => {
    const view = page({ tab: "runs" });
    fireEvent.click(within(view.runs()[0]!).getByTestId("oats-run-owner"));
    expect(view.getByTestId("oats-automation-detail").dataset.id).toBe("oats-real/harvest-review");
  });

  it("is filtered by automation and by result", () => {
    const view = page({ tab: "runs" });
    const by = view.getByRole("combobox", { name: "Automation" }) as HTMLSelectElement;
    expect(by.options[0]!.textContent).toBe("All automations");
    expect(Array.from(by.options).map((option) => option.textContent)).toContain("proposal-review");
    fireEvent.change(by, { target: { value: "trigger:oats-real/proposal-review" } });
    expect(owners(view)).toEqual(["proposal-review", "proposal-review"]);
    fireEvent.change(by, { target: { value: "" } });
    const result = within(view.getByRole("radiogroup", { name: "Result" })).getAllByRole("radio");
    expect(result.map((radio) => radio.textContent)).toEqual(["All", "Failed"]);
    fireEvent.click(result[1]!);
    expect(owners(view)).toEqual(["hourly-check"]);
    // Both at once: an automation with no failed run has none to show.
    fireEvent.change(by, { target: { value: "trigger:oats-real/proposal-review" } });
    expect(view.text("oats-runs-empty")).toBe("No runs");
  });

  it("hundreds are bounded: fifty, then Older; and where any automation keeps less than it ran, it says so at the table's end", () => {
    const run = rowOf(schedules(), "local/daily-review").recentRuns[0]!;
    const many = (id: string, days: number) => (row: AutomationRow) => ({
      ...row,
      history: { stored: 50, truncated: id === "local/daily-review" },
      recentRuns: Array.from({ length: 50 }, (_, at) => ({ ...run, runId: `${id}-${at}`, startedAt: new Date(Date.parse(run.startedAt!) - (at + days) * 86400e3).toISOString() })),
    });
    const list = withRow(withRow(schedules(), "local/daily-review", many("local/daily-review", 1)), "oats-real/nightly-digest", many("oats-real/nightly-digest", 2));
    const view = page({ tab: "runs", schedule: ready(list) });
    expect(view.runs()).toHaveLength(50);
    expect(view.queryByTestId("oats-runs-cut")).toBeNull();
    fireEvent.click(view.getByTestId("oats-runs-older"));
    expect(view.runs()).toHaveLength(100);
    fireEvent.click(view.getByTestId("oats-runs-older"));
    expect(view.runs()).toHaveLength(108);
    expect(view.queryByTestId("oats-runs-older")).toBeNull();
    expect(view.text("oats-runs-cut")).toBe("Earlier runs are not kept");
    // With ONE automation chosen, it is said of that one alone: the one that keeps every run says nothing; the one that is cut says it.
    const choose = (id: string) => fireEvent.change(view.getByTestId("oats-runs-by-automation"), { target: { value: `schedule:${id}` } });
    const toTheEnd = () => {
      while (view.queryByTestId("oats-runs-older") !== null) fireEvent.click(view.getByTestId("oats-runs-older"));
    };
    choose("oats-real/nightly-digest");
    toTheEnd();
    expect(view.runs()).toHaveLength(50);
    expect(view.queryByTestId("oats-runs-cut")).toBeNull();
    choose("local/daily-review");
    toTheEnd();
    expect(view.runs()).toHaveLength(50);
    expect(view.text("oats-runs-cut")).toBe("Earlier runs are not kept");
  });

  it("with no run anywhere, says so in two words, with no filter", () => {
    const view = page({ tab: "runs", schedule: ready(schedules("schedule-list-scheduler-off.json")), statuses: [] });
    expect(view.text("oats-runs-empty")).toBe("No runs");
    expect(view.queryByRole("combobox")).toBeNull();
  });
});

// What the page drew before the rework and still draws, each held again here: the audit of the base's expectations
// (the branch's hand-back lists every one of them, with where its fact is now or the ruling that cut it).
describe("kept from before the rework", () => {
  it("Home and End go to the first and the last tab", () => {
    const view = page();
    const [list, runs] = view.getAllByRole("tab");
    fireEvent.keyDown(list!, { key: "End" });
    expect([runs!.getAttribute("aria-selected"), document.activeElement]).toEqual(["true", view.getAllByRole("tab")[1]]);
    fireEvent.keyDown(view.getAllByRole("tab")[1]!, { key: "Home" });
    expect(view.getAllByRole("tab")[0]!.getAttribute("aria-selected")).toBe("true");
  });

  it("a scheduler that is off with nothing that would run on the machine says nothing", () => {
    const view = page({ schedule: ready(schedules("schedule-list-empty.json")), trigger: ready(triggers("trigger-list-empty.json")), statuses: [] });
    expect(schedules("schedule-list-empty.json").scheduler).not.toBeNull();
    expect(view.queryByTestId("oats-automations-scheduler-off")).toBeNull();
  });

  it("the panel is named by its tab, and in a word on a row's page, where no tab is drawn", () => {
    const view = page();
    const panel = () => view.getByRole("tabpanel");
    expect(document.getElementById(panel().getAttribute("aria-labelledby")!)?.textContent).toMatch(/^Automations/);
    expect(panel().getAttribute("aria-label")).toBeNull();
    view.open("local/daily-review");
    expect([panel().getAttribute("aria-labelledby"), panel().getAttribute("aria-label")]).toEqual([null, "Automation"]);
  });

  it("an unreadable row says so in the list, in red, and on its page, with the kernel's code and message one press away", () => {
    const list = schedules();
    const unreadable = automationRowOf({ id: "broken", scope: "/abs/deployment", unreadable: { code: "E_SCHEDULE_INVALID", message: "the job's record cannot be read" }, history: { status: "corrupt" }, recentRuns: [], origin: { kind: "local" } }, "schedule")!;
    const view = page({ schedule: ready({ ...list, rows: [...list.rows, unreadable] }) });
    expect([parts(view.row("broken")), tones(view.row("broken")), view.row("broken").dataset.failing]).toEqual([["Unreadable"], ["bad"], "true"]);
    view.open("broken");
    expect(view.getByTestId("oats-automation-problem").textContent).toBe("UnreadableOATS cannot read this definition, so it does not run.▸DetailsCodeE_SCHEDULE_INVALIDMessagethe job's record cannot be read");
  });

  it("each kind of run with nothing to send says so", () => {
    const list = schedules();
    const bare = (raw: Record<string, unknown>) => automationRowOf({ scope: "/abs/deployment", origin: { kind: "local" }, runsHere: true, ...raw }, "schedule")!;
    const rows = [bare({ id: "w", kind: "wake" }), bare({ id: "c", kind: "command" }), bare({ id: "o", kind: "operation" }), bare({ id: "s", kind: "spawn" }), bare({ id: "x", kind: "later-kind" })];
    const view = page({ schedule: ready({ ...list, rows }), trigger: ready(triggers("trigger-list-empty.json")), statuses: [] });
    const sends = (id: string) => {
      view.open(id);
      const text = view.getByTestId("oats-automation-sends").textContent;
      back(view);
      return text;
    };
    expect([sends("w"), sends("c"), sends("o"), sends("s"), sends("x")]).toEqual(["MessageNo wake message reported.", "CommandNo command reported.", "OperationNo operation reported.", "InstructionNo prompt reported.", "InstructionNothing to show for a later-kind run."]);
    // A row the kernel reported no cron for says no "when": nothing stands in its place.
    expect(rows.map((row) => parts(view.row(row.id)))).toEqual(rows.map(() => ["Runs on this computer"]));
  });

  it("only the person's own definition text is drawn whole: a kernel message on the same page, with a line break and a secret-looking word, still goes through the display filter", () => {
    const list = schedules();
    const prompt = "Line one.\n\npassword=hunter2 stays, as written.";
    const rows = list.rows.map((row) =>
      row.id === "local/daily-review"
        ? { ...row, task: prompt, invalid: { code: "E_SCHEDULE_INVALID", message: "the cron is not valid\nsecond line", field: null, at: null }, recentRuns: [{ ...row.recentRuns[0]!, outcome: "launch-failed", errorCode: "E_LAUNCH", error: "the launch failed with password=hunter2\nand a second line" }, ...row.recentRuns.slice(1)] }
        : row,
    );
    const view = page({ schedule: ready({ ...list, rows }) });
    view.open("local/daily-review");
    expect(view.getByTestId("oats-automation-prose").textContent).toBe(prompt);
    // The kernel's words: one line each, a line break folded, a secret-looking text withheld whole.
    const problem = view.getByTestId("oats-automation-problem").textContent ?? "";
    expect(problem).toContain("the cron is not valid second line");
    expect(problem).not.toContain("\n");
    const error = view.getAllByTestId("oats-run-error")[0]!.textContent ?? "";
    expect(error).toBe("E_LAUNCH[withheld]");
    // Every call of shownBlock in the feature is an instruction or a wake's message: row.task, row.message.
    const source = readFileSync(resolve(process.cwd(), "app/automations/Detail.tsx"), "utf8");
    expect(source.match(/shownBlock\(([^)]*)\)/g)).toEqual(["shownBlock(row.message)", "shownBlock(row.task)"]);
    for (const file of readdirSync(resolve(process.cwd(), "app/automations")).filter((name) => name !== "Detail.tsx")) expect(readFileSync(resolve(process.cwd(), "app/automations", file), "utf8")).not.toContain("shownBlock");
  });

  it("what a member's file or the kernel names is drawn through the filter under Details too", () => {
    const list = schedules();
    const odd = withRow(withRow(list, "local/status-check", (row) => ({ ...row, cwd: "/srv/\u202egnp.exe", launchConfig: "fast\u0007\u200b" })), "oats-real/nightly-digest", (row) => ({ ...row, origin: { ...row.origin, path: "services/\u202egnp.yaml" } }));
    const view = page({ schedule: ready(odd) });
    for (const id of ["local/status-check", "oats-real/nightly-digest"]) {
      view.open(id);
      const fold = view.getByTestId("oats-automation-details");
      expect(`${fold.textContent} ${Array.from(fold.querySelectorAll("[title]")).map((element) => element.getAttribute("title")).join(" ")}`).not.toMatch(/[\u202e\u0007\u200b]/);
      back(view);
    }
  });

  it("what fired a trigger last is a source's text of any length, and a cron the page has no words for is the cron: each wraps, and nothing in the line is held on one line", () => {
    const all = triggers();
    const subject = "harvest/2026-11-21-weekly-knowledge-digest-for-the-billing-team-and-what-it-found";
    const view = page({ trigger: ready(withRow(all, "oats-real/harvest-review", (row) => (row.lastRun === null ? row : { ...row, lastRun: { ...row.lastRun, subject } }))), statuses: null });
    const line = within(view.row("oats-real/harvest-review")).getByTestId("oats-automation-line");
    expect(line.textContent).toContain(subject);
    expect(line.querySelector(".whitespace-nowrap, .truncate")).toBeNull();
    for (const part of Array.from(line.querySelectorAll("[data-part]"))) expect(part.className).toContain("break-words");
    cleanup();
    const cron = "0,5,10,15,20,25,30,35,40,45,50,55 9-17 * * 1-5";
    const minutes = page({ schedule: ready(withRow(schedules(), "local/daily-review", (row) => ({ ...row, cron }))) });
    expect(parts(minutes.row("local/daily-review"))[0]).toBe(cron);
  });

  it("a source check that failed at a poll: the problem in a person's words, with the kernel's message, code, field and when one press away; the kernel's last error, which repeats it, is not said twice", () => {
    const view = page();
    view.open("oats-real/harvest-closed");
    expect(view.getByTestId("oats-automation-problem").textContent).toMatch(/^Source check failedThe source's check failed at the last poll \(.+ago\), so this trigger did not fire\.▸DetailsMessageon\.events: acme\.graph:harvest-branches has no event closed \(its events: opened, updated\)CodeE_TRIGGER_INVALIDFieldon\.eventsChecked.+ago$/);
    expect(view.queryByTestId("oats-automation-last-error")).toBeNull();
  });
});

// What the mutation run found no test for: each decision below was negated and every test still passed. Now each has one.
describe("pinned after the mutation run", () => {
  const icon = (row: HTMLElement) => within(row).getByTestId("oats-automation-icon");
  const drawnIcon = (element: HTMLElement) => element.querySelector("svg[data-icon]")?.getAttribute("data-icon") ?? null;

  it("a row's icon is its kind's, by bb's name for it, with the kind as its accessible name; a failing row's is the failing one, in red; one that needs a person carries the needs-you mark in its place", () => {
    const view = page({ asking: (row) => (row.id === "local/weekly-cleanup" ? "release-070-maintainer" : null) });
    const read = (id: string) => [drawnIcon(icon(view.row(id))), icon(view.row(id)).getAttribute("aria-label"), icon(view.row(id)).className.includes("text-destructive-text")];
    expect(read("local/daily-review")).toEqual(["Calendar", "Schedule", false]);
    expect(read("local/wake-oats-developer-review-202611212017")).toEqual(["Clock", "Schedule", false]);
    expect(read("local/pr-triage")).toEqual(["GitPullRequest", "Trigger", false]);
    expect(read("local/hourly-check")).toEqual(["CircleX", "Failing", true]);
    expect(read("oats-real/harvest-closed")).toEqual(["CircleX", "Failing", true]);
    expect([drawnIcon(icon(view.row("local/weekly-cleanup"))), icon(view.row("local/weekly-cleanup")).getAttribute("aria-label")]).toEqual([null, "Needs you"]);
    // The page's head: the same icon, red only where it is failing.
    view.open("local/hourly-check");
    const head = view.getByTestId("oats-automation-head-icon");
    expect([drawnIcon(head), head.className.includes("text-destructive-text")]).toEqual(["CircleX", true]);
    back(view);
    view.open("local/daily-review");
    expect([drawnIcon(view.getByTestId("oats-automation-head-icon")), view.getByTestId("oats-automation-head-icon").className.includes("text-destructive-text")]).toEqual(["Calendar", false]);
  });

  it("the small line's parts are parted by a dot between them, never before the first", () => {
    const view = page();
    const line = within(view.row("local/daily-review")).getByTestId("oats-automation-line");
    const dots = Array.from(line.querySelectorAll<HTMLElement>("[data-part]")).map((part) => part.querySelectorAll('[aria-hidden="true"]').length);
    expect(dots).toEqual([0, 1, 1]);
  });

  it("the sentence is one line in the list, with the whole of it one hover away; on the automation's own page it is whole, with no hover", () => {
    const view = page();
    const inList = within(view.row("oats-real/nightly-digest")).getByTestId("oats-automation-sentence");
    expect([inList.className.includes("line-clamp-1"), inList.getAttribute("title")]).toEqual([true, inList.textContent]);
    view.open("oats-real/nightly-digest");
    const whole = within(view.getByTestId("oats-automation-identity")).getByTestId("oats-automation-sentence");
    expect([whole.className.includes("line-clamp-1"), whole.getAttribute("title")]).toEqual([false, null]);
  });

  it("the foot of what it does names the harness and the model where they are set, and neither where they are not", () => {
    const set = page({ schedule: ready(withRow(schedules(), "local/daily-review", (row) => ({ ...row, harness: "pi", model: "sol-5.5" }))) });
    set.open("local/daily-review");
    expect(Array.from(set.getByTestId("oats-automation-foot").children).map((part) => part.textContent)).toEqual(["oats-developer", "Pi", "sol-5.5"]);
    cleanup();
    const bare = page();
    bare.open("local/daily-review");
    expect(Array.from(bare.getByTestId("oats-automation-foot").children).map((part) => part.textContent)).toEqual(["oats-developer"]);
  });

  it("Details of a pull-request trigger: its labels, its base and its poll each only where set; of a recurring wake-up: its time zone and its message where set", () => {
    const view = page();
    const row = (id: string) => view.queryByTestId(`oats-automation-detail-${id}`)?.textContent ?? null;
    view.open("oats-real/proposal-review");
    expect([row("labels"), row("base"), row("polls")]).toEqual(["Labelsokf-proposal", "Basemain", "Pollsevery 2m"]);
    back(view);
    view.open("local/pr-triage");
    expect([row("labels"), row("base"), row("polls")]).toEqual([null, null, "Pollsevery 2m"]);
    back(view);
    // A capability's source polls too.
    view.open("local/graph-watch");
    expect(row("polls")).toBe("Pollsevery 1m");
    back(view);
    view.open("local/daily-review");
    expect(row("wake")).toBe("Recurring wake-upEvery 30 minutes · Europe/Madrid · Anything new on your review?");
    cleanup();
    const bare = page({ schedule: ready(withRow(schedules(), "local/daily-review", (entry) => ({ ...entry, wake: { ...entry.wake!, tz: null, message: null } }))) });
    bare.open("local/daily-review");
    expect(bare.getByTestId("oats-automation-detail-wake").textContent).toBe("Recurring wake-upEvery 30 minutes");
  });

  it("the trigger file's parameters are quoted only for a source that has some", () => {
    const view = page();
    view.open("oats-real/harvest-review");
    expect(view.queryByTestId("oats-automation-params")).not.toBeNull();
    back(view);
    view.open("oats-real/harvest-closed");
    expect(view.queryByTestId("oats-automation-params")).toBeNull();
    back(view);
    view.open("local/pr-triage");
    expect(view.queryByTestId("oats-automation-params")).toBeNull();
  });

  it("a run's mark is bb's icon for what came of it, and its word has that tone: failed in red, not known in amber, the rest quiet; one whose agent asks carries the needs-you mark", () => {
    const run = rowOf(schedules(), "local/daily-review").recentRuns[0]!;
    const at = (day: number) => new Date(Date.parse(run.startedAt!) - day * 86400e3).toISOString();
    const runs = [
      { ...run, runId: "a", outcome: "launch-failed", error: "refused", startedAt: at(1) },
      { ...run, runId: "b", outcome: "ended", startedAt: at(2) },
    ];
    const attempt = { scheduledFor: at(0), startedAt: at(0), error: null, exited: null, exitStatus: null, exitSignal: null };
    const drawn = (view: ReturnType<typeof page>) => view.runs().map((entry) => [drawnIcon(within(entry).getByRole("img")), ["text-destructive-text", "text-warning-text", "text-muted-foreground"].find((tone) => within(entry).getByTestId("oats-run-said").className.includes(tone))]);
    const running = page({ schedule: ready(withRow(schedules(), "local/daily-review", (row) => ({ ...row, running: true, attempt, recentRuns: runs, pendingWake: { scheduledFor: at(-1) } }))) });
    running.open("local/daily-review");
    expect(drawn(running)).toEqual([["Spinner", "text-muted-foreground"], ["Clock", "text-muted-foreground"], ["CircleX", "text-destructive-text"], ["CircleCheck", "text-muted-foreground"]]);
    cleanup();
    const lost = page({ schedule: ready(withRow(schedules(), "local/daily-review", (row) => ({ ...row, running: false, attempt, recentRuns: runs }))) });
    lost.open("local/daily-review");
    expect(drawn(lost)[0]).toEqual(["CircleQuestion", "text-warning-text"]);
    cleanup();
    const asks = page({ schedule: ready(withRow(schedules(), "local/daily-review", (row) => ({ ...row, recentRuns: runs }))), agentLink: () => ({ open: () => undefined, asks: true, start: null }) });
    asks.open("local/daily-review");
    expect(drawn(asks)[0]).toEqual([null, "text-warning-text"]);
  });

  it("a run's whole time is one hover away: on the row's own button where it opens an agent, on the time where it opens nothing", () => {
    const plain = page({ agentLink: () => null });
    plain.open("local/daily-review");
    const time = plain.runs()[0]!.querySelector("time")!;
    expect(time.getAttribute("title")).toMatch(/2026/);
    cleanup();
    const linked = page({ agentLink: () => ({ open: () => undefined, asks: false, start: null }) });
    linked.open("local/daily-review");
    expect([linked.runs()[0]!.querySelector("time")!.getAttribute("title"), within(linked.runs()[0]!).getByTestId("oats-run-row").getAttribute("title")]).toEqual([null, time.getAttribute("title")]);
  });

  it("an attempt that carries an error has the kernel's words under its fold", () => {
    const attempt = { scheduledFor: "2026-11-21T21:00:00.000Z", startedAt: "2026-11-21T21:00:03.000Z", error: "boom", exited: null, exitStatus: null, exitSignal: null };
    const view = page({ schedule: ready(withRow(schedules(), "local/daily-review", (row) => ({ ...row, running: true, attempt }))) });
    view.open("local/daily-review");
    const run = view.runs()[0]!;
    if (within(run).queryByTestId("oats-run-error") === null) fireEvent.click(within(run).getByTestId("oats-run-toggle"));
    expect(within(run).getByTestId("oats-run-error").textContent).toBe("boom");
    // One with none has no fold.
    cleanup();
    const quiet = page({ schedule: ready(withRow(schedules(), "local/daily-review", (row) => ({ ...row, running: true, attempt: { ...attempt, error: null } }))) });
    quiet.open("local/daily-review");
    expect(within(quiet.runs()[0]!).queryByTestId("oats-run-toggle")).toBeNull();
  });

  it("the tab that is open, the filter that is chosen and a switch that is on each look it, and only the chosen one is in the Tab order", () => {
    const view = page({ tab: "runs" });
    expect(view.getAllByRole("tab").map((tab) => [tab.getAttribute("tabindex"), tab.className.includes("bg-accent")])).toEqual([["-1", false], ["0", true]]);
    fireEvent.click(within(view.getByRole("radiogroup", { name: "Result" })).getByRole("radio", { name: "Failed" }));
    expect(within(view.getByRole("radiogroup", { name: "Result" })).getAllByRole("radio").map((radio) => [radio.textContent, radio.getAttribute("aria-checked"), radio.getAttribute("tabindex"), radio.className.includes("bg-accent")])).toEqual([["All", "false", "-1", false], ["Failed", "true", "0", true]]);
  });

  it("Escape in the search clears what is written, and does not leave the page; with nothing written it is the page's own Escape", () => {
    const view = page();
    const search = view.getByTestId("oats-search") as HTMLInputElement;
    fireEvent.change(search, { target: { value: "nightly" } });
    expect(view.rows()).toHaveLength(1);
    fireEvent.keyDown(view.getByTestId("oats-search"), { key: "Escape" });
    expect([(view.getByTestId("oats-search") as HTMLInputElement).value, view.rows().length]).toEqual(["", 18]);
  });

  it("one fault that failed both lists is one notice, named for both; a fault of one list is named for it", () => {
    const fault = { code: "E_X", message: "the same fault" };
    const both = page({ schedule: { list: undefined, loading: false, error: fault, readAt: null }, trigger: { list: undefined, loading: false, error: fault, readAt: null } });
    expect(both.getAllByTestId("oats-automations-failed").map((notice) => notice.dataset.kind)).toEqual(["both"]);
    cleanup();
    const one = page({ trigger: { list: undefined, loading: false, error: fault, readAt: null } });
    expect(one.getAllByTestId("oats-automations-failed").map((notice) => notice.dataset.kind)).toEqual(["trigger"]);
  });

  it("with a history of failures: the newest failure stands until a later attempt launched or a later fire followed; then the row is calm", () => {
    const failure = (at: string, resolved: { at: string; instance: string | null } | null) => ({ attempt: 1, at, key: "local/pr-triage:44", event: "opened", label: "#44", code: "E_SPAWN_NAME", message: "the name is taken", instance: null, resolved });
    const fired = STATUSES().statuses.find((entry) => entry.id === "local/pr-triage")!.status.fired[0]!.at!;
    const after = new Date(Date.parse(fired) + 60e3).toISOString();
    const before = new Date(Date.parse(fired) - 60e3).toISOString();
    const failingWith = (failures: ReturnType<typeof failure>[]) => {
      const view = page({ statuses: withStatus("local/pr-triage", (status) => ({ ...status, failures, failuresTotal: failures.length })) });
      const answer = view.row("local/pr-triage").dataset.failing;
      cleanup();
      return answer;
    };
    expect(failingWith([failure(after, null)])).toBe("true");
    expect(failingWith([failure(after, { at: after, instance: "oats-developer-triage-44" })])).toBe("false");
    expect(failingWith([failure(before, null)])).toBe("false");
    expect(failingWith([])).toBe("false");
  });

  it("a last run whose time cannot be read still says what came of it", () => {
    const view = page({ schedule: ready(withRow(schedules(), "local/daily-review", (row) => ({ ...row, lastRun: row.lastRun === null ? null : { ...row.lastRun, at: null, startedAt: null, scheduledFor: null } }))) });
    // No time to say: "Last:" and the outcome's word, and no "ago".
    expect(parts(view.row("local/daily-review")).at(-1)).toMatch(/^Last: [A-Z][a-z]+ [a-z]+$/);
  });
});
