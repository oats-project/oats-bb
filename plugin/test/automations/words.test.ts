// What the page says about a row, in the Desktop's words, over the rows the real kernel printed.
import { describe, expect, it } from "vitest";
import { displayLine } from "../../app/ui/text";
import type { AutomationRow } from "../../contract/automations";
import { automationRowOf } from "../../kernel/automations";
import {
  capabilitySource,
  causeWords,
  cronInWords,
  harnessName,
  hostUnnamed,
  listBanners,
  onSummary,
  ownerParts,
  dueWords,
  pastTime,
  placementText,
  relativeTime,
  ruleWords,
  runState,
  sourceLabel,
  sourceParams,
  summaryLine,
  taskParts,
  HERE,
  hereOf,
  hostNameHow,
  switchTitle,
  schedulerOffLine,
  earlierNotKept,
  failing,
  inOrder,
  attention,
  runsOnWords,
  ownerWords,
  filterList,
  LIST_FILTERS,
  oneList,
  rowLine,
  runLine,
  runWhen,
  searchRows,
  statusFor,
  whenWords,
  whoWords,
} from "../../app/automations/words";
import { allRuns, pageRuns } from "../../model/automation-runs";
import { busy } from "./busy";
import { STATUSES } from "./handlers";
import { rowOf, schedules, triggers } from "./fixtures";

const NOW = Date.parse("2026-11-21T12:00:00.000Z");
const row = (raw: Record<string, unknown>, kind: "schedule" | "trigger" = "schedule"): AutomationRow => automationRowOf({ id: "x", ...raw }, kind)!;

describe("a row's summary", () => {
  it("the authored one; else the first line of what it sends, marked derived; else none", () => {
    const list = schedules();
    expect(summaryLine(rowOf(list, "local/daily-review"))).toEqual({ text: "Review open pull requests every weekday morning", title: "Review open pull requests every weekday morning", derived: false });
    expect(summaryLine(rowOf(list, "local/hourly-check"))).toEqual({ text: "Check the build queue.", title: "No summary set — first line of the prompt", derived: true });
    expect(summaryLine(list.rows.find((entry) => entry.run === "wake")!)).toMatchObject({ text: "Anything new on your review?", derived: true });
    // A command has nothing it sends to an agent: no label is made from its argv.
    expect(summaryLine(row({ kind: "command", argv: ["oats", "status"] }))).toBeNull();
    expect(summaryLine(row({ kind: "operation", operation: "knowledge:harvest" }))).toBeNull();
    expect(summaryLine(row({ kind: "spawn", task: "\n\n  second line is the first with text  \nthird" }))).toMatchObject({ text: "second line is the first with text", derived: true });
    expect(summaryLine(rowOf(triggers(), "oats-real/docs-review"))).toMatchObject({ text: "Review docs PR {repo}#{number}.", derived: true });
  });
});

describe("a soul and where it comes from", () => {

  it("names a harness as the product does", () => {
    expect([harnessName("claude"), harnessName("pi"), harnessName(" Codex "), harnessName("opencode")]).toEqual(["Claude", "Pi", "Codex", "opencode"]);
  });
});

describe("when it runs", () => {
  it("common crons in words; anything else is shown as the cron itself", () => {
    expect(cronInWords("*/15 * * * *")).toBe("Every 15 minutes");
    expect(cronInWords("0 * * * *")).toBe("Every hour");
    expect(cronInWords("0 9 * * *")).toBe("Daily at 09:00");
    expect(cronInWords("0 9 * * 1-5")).toBe("Weekdays at 09:00");
    expect(cronInWords("30 8 * * 1-5")).toBe("Weekdays at 08:30");
    expect(cronInWords("0 18 * * 5")).toBe("Fridays at 18:00");
    expect(cronInWords("0 7 * * 0")).toBe("Sundays at 07:00");
    for (const cron of ["0 9 1 * *", "0 9 * 1 *", "0 9 * * 1,3", "*/5 9 * * *", "every day", "", "0 9 * *"]) expect(cronInWords(cron), cron).toBeNull();
    expect(cronInWords(null)).toBeNull();
    // every schedule of the recording
    expect(schedules().rows.map((entry) => cronInWords(entry.cron))).toEqual(["Weekdays at 09:00", "Every hour", "Daily at 06:00", "Daily at 23:00", "Every 15 minutes", "Every 30 minutes", "Fridays at 18:00", "Daily at 07:00", "Every 30 minutes", "Weekdays at 08:30", "Mondays at 09:00"]);
  });

  it("what has happened is never said to lie ahead, whatever the two clocks say", () => {
    const at = (ms: number) => pastTime(new Date(NOW + ms).toISOString(), NOW)?.label;
    expect([at(30e3), at(5 * 60e3), at(-30e3), at(-5 * 60e3)]).toEqual(["less than a minute ago", "less than a minute ago", "less than a minute ago", "5 min ago"]);
    expect(pastTime(null, NOW)).toBeNull();
    expect(pastTime("soon", NOW)).toBeNull();
  });

  it("a time relative to now, with the whole time for its title", () => {
    const at = (ms: number) => relativeTime(new Date(NOW + ms).toISOString(), NOW)?.label;
    expect([at(30e3), at(-30e3), at(5 * 60e3), at(-5 * 60e3), at(2 * 3600e3), at(-2 * 3600e3), at(3 * 86400e3), at(-3 * 86400e3)]).toEqual([
      "in under a minute",
      "less than a minute ago",
      "in 5 min",
      "5 min ago",
      "in 2 h",
      "2 h ago",
      "in 3 d",
      "3 d ago",
    ]);
    expect(relativeTime(null, NOW)).toBeNull();
    expect(relativeTime("yesterday", NOW)).toBeNull();
    expect(relativeTime("2026-11-21T11:00:00.000Z", NOW)!.title).toBe(new Date("2026-11-21T11:00:00.000Z").toLocaleString());
  });

  it("a trigger's event in words, with its repo, labels and base", () => {
    const list = triggers();
    expect(onSummary(rowOf(list, "oats-real/proposal-review").on)).toMatchObject({ title: "Pull request opened, reopened, ready for review", repo: "acme/knowledge", labels: ["okf-proposal"], base: "main", poll: "2m", source: null });
    expect(onSummary(rowOf(list, "local/pr-triage").on)).toMatchObject({ title: "Pull request opened, reopened", repo: "acme/app", labels: [], base: null });
    expect(onSummary(null)).toBeNull();
    expect(onSummary(row({ on: { events: [] } }, "trigger").on)).toMatchObject({ title: "Event" });
  });

  it("a capability source is named by its capability and its source, with its own event names", () => {
    const on = rowOf(triggers(), "local/graph-watch").on;
    expect(capabilitySource(on)).toEqual({ id: "acme.graph:harvest-branches", capability: "acme.graph", name: "harvest-branches", lookup: "acme.graph" });
    expect(sourceLabel(capabilitySource(on))).toBe("acme.graph · harvest-branches");
    expect(onSummary(on)).toMatchObject({ title: "acme.graph · harvest-branches: opened, updated", repo: null, labels: [], poll: "1m", events: ["opened", "updated"] });
    expect(capabilitySource(rowOf(triggers(), "local/pr-triage").on)).toBeNull();
    // The status row's own names win; a name that is no capability's is never looked up.
    expect(capabilitySource(on, { capability: "acme.graph", name: "renamed" })).toMatchObject({ name: "renamed" });
    expect(capabilitySource(row({ on: { source: "../evil cap:src" } }, "trigger").on)).toMatchObject({ capability: "../evil cap", name: "src", lookup: null });
    expect(capabilitySource(row({ on: { source: "nocolon" } }, "trigger").on)).toMatchObject({ capability: "nocolon", name: null });
  });

  it("a source's parameters are lines of text, as written", () => {
    expect(sourceParams(rowOf(triggers(), "oats-real/harvest-review").on)).toEqual({ count: 2, lines: [{ text: "prefix = harvest/", note: null }, { text: "graph = kb", note: null }], more: 0 });
    const odd = row({ on: { source: "a:b", params: { empty: "", number: 7, long: "x".repeat(3000), ...Object.fromEntries(Array.from({ length: 16 }, (_, i) => [`p${i}`, "v"])) } } }, "trigger").on;
    const params = sourceParams(odd);
    expect(params.count).toBe(19);
    expect(params.more).toBe(3);
    expect(params.lines).toHaveLength(16);
    expect(params.lines.slice(0, 3)).toEqual([
      { text: "empty =", note: "Its value is empty." },
      { text: "number", note: "Its value is not text: not shown." },
      { text: expect.stringMatching(/^long = x+$/), note: "Cut at 2048 characters: the end is not shown." },
    ]);
    expect(sourceParams(null)).toEqual({ count: 0, lines: [], more: 0 });
  });

  it("a poll's cause and a refused event's rule in words; an unknown one shows its code", () => {
    expect([causeWords("exit"), causeWords("refused"), causeWords("timeout"), causeWords("brand-new"), causeWords(null)]).toEqual(["the source's command failed", "the source refused", "the source's command timed out", "brand-new", null]);
    expect([ruleWords("url"), ruleWords("shape"), ruleWords("duplicate-key"), ruleWords("later"), ruleWords(null)]).toEqual(["a URL that isn't allowed", "not an event object", "a repeated key", "later", null]);
  });

  it("the fields of a trigger's task are told from its text", () => {
    const pr = rowOf(triggers(), "oats-real/proposal-review");
    expect(taskParts(pr.task!, pr.on)).toEqual([{ text: "Review knowledge-base PR " }, { field: "repo" }, { text: "#" }, { field: "number" }, { text: " (" }, { field: "url" }, { text: "). Load knowledge-review first." }]);
    const source = rowOf(triggers(), "oats-real/harvest-review");
    expect(taskParts(source.task!, source.on)).toEqual([{ text: "Review branch " }, { field: "subject" }, { text: " of graph " }, { field: "fields.graph" }, { text: " (" }, { field: "url" }, { text: ")." }]);
    // Only the fields the kernel fills for that source: {repo} is text for a capability source, {fields.x} for a pull request.
    expect(taskParts("{repo} {fields.graph} {nope}", source.on)).toEqual([{ text: "{repo} " }, { field: "fields.graph" }, { text: " {nope}" }]);
    expect(taskParts("{repo} {fields.graph}", pr.on)).toEqual([{ field: "repo" }, { text: " {fields.graph}" }]);
  });
});

describe("where it runs", () => {
  it("the machine is named by bb's name for it, never as the computer the person sits at; unnamed, it is this computer", () => {
    const falcon = hereOf("falcon");
    expect([falcon, hereOf(null), hereOf(undefined), hereOf("")]).toEqual([{ on: "falcon", name: "falcon" }, HERE, HERE, HERE]);
    expect(HERE).toEqual({ on: "this computer", name: "This computer" });
    // bb's name is free text: it is drawn as a display line.
    expect(hereOf("fal\u202Econ\nx").on).toBe(displayLine("fal\u202Econ\nx"));
    const list = schedules();
    expect(placementText(rowOf(list, "local/daily-review"), list.host, true, falcon)).toEqual({ label: "falcon", tone: "ok", detail: "Local: runs on falcon as its own gh login" });
    expect(placementText(rowOf(list, "oats-real/nightly-digest"), list.host, true, falcon)).toEqual({ label: "falcon", tone: "ok", detail: "falcon's host name is bb-box" });
    expect(placementText(rowOf(list, "local/daily-review"), list.host, false, falcon).detail).toBe("The scheduler is not running on falcon");
    expect([schedulerOffLine(falcon), hostUnnamed(falcon).title]).toEqual(["The scheduler is off on falcon", "falcon has no host name in OATS"]);
    expect(hostNameHow(falcon)).toBe("In the deployment's oats-local.yaml on falcon, set host: name: to the name it goes by in the workspace, then press Refresh.");
    expect(switchTitle(rowOf(list, "local/daily-review"), falcon)).toBe("On here: click to turn it off on falcon");
  });
  it("each placement in words, with its tone and the kernel's detail", () => {
    const list = schedules();
    const placed = (id: string) => placementText(rowOf(list, id), list.host);
    expect(placed("local/daily-review")).toEqual({ label: "This computer", tone: "ok", detail: "Local: runs on this computer as its own gh login" });
    expect(placed("local/weekly-cleanup")).toMatchObject({ label: "This computer", tone: "muted" });
    expect(placed("oats-real/nightly-digest")).toEqual({ label: "This computer", tone: "ok", detail: "This computer's host name is bb-box" });
    expect(placed("oats-real/reconcile")).toEqual({ label: "Wrong account here", tone: "bad", detail: "acts as github.com/acme-billing-bot; this host's gh is logged in as github.com/ana" });
    expect(placed("oats-real/release-check")).toMatchObject({ label: "Not trusted here", tone: "bad", detail: expect.stringContaining("oats-local.yaml") });
    expect(placed("oats-real/weekly-report")).toEqual({ label: "report-server", tone: "muted", detail: "runs on report-server; this host is bb-box" });
    const unnamed = schedules("schedule-list-host-unnamed.json");
    expect(placementText(rowOf(unnamed, "oats-real/weekly-report"), unnamed.host)).toEqual({ label: "report-server", tone: "muted", detail: "This computer has no host name in OATS" });
  });

  it("a placement the kernel leaves bare, and a reason this plugin does not know", () => {
    const host = { name: null, ghUser: {} };
    const workspace = { origin: { kind: "workspace" }, qualifiedId: "ws/x" };
    expect(placementText(row({ ...workspace, reason: "host-unnamed" }), host)).toMatchObject({ label: "Not named" });
    expect(placementText(row({ ...workspace, reason: "assigned-elsewhere" }), host)).toMatchObject({ label: "Another host" });
    expect(placementText(row({ ...workspace, reason: "quarantined" }), host)).toEqual({ label: "Doesn't run here", tone: "bad", detail: "reason: quarantined" });
    expect(placementText(row({ ...workspace, runsHere: true }), host)).toEqual({ label: "This computer", tone: "ok", detail: null });
  });

});

describe("the host scheduler and the list's notices", () => {

  it("the banner for a scheduler that is off shows only when something here would run", () => {
    expect(listBanners(schedules("schedule-list-scheduler-off.json"))).toEqual({ hostUnnamed: false, schedulerOff: true });
    expect(listBanners(schedules("schedule-list-empty.json"))).toEqual({ hostUnnamed: false, schedulerOff: false });
    expect(listBanners(schedules())).toEqual({ hostUnnamed: false, schedulerOff: false });
  });

  it("the banner for a host with no name shows when the workspace has rows it cannot place", () => {
    expect(listBanners(schedules("schedule-list-host-unnamed.json")).hostUnnamed).toBe(true);
    expect(listBanners(triggers("trigger-list-host-unnamed.json")).hostUnnamed).toBe(true);
    expect(hostUnnamed().title).toBe("This computer has no host name in OATS");
  });

});

describe("a schedule's run state", () => {
  it("unknown: an attempt with no recorded result, with what the kernel knows of it", () => {
    const entry = rowOf(schedules(), "local/status-check");
    expect(runState(entry)).toEqual({
      running: null,
      unknown: { since: entry.attempt!.startedAt, scheduledFor: entry.attempt!.scheduledFor, holdsSlot: false, exited: true, exitStatus: 0, exitSignal: null, error: "command answered no valid envelope; its side effects are unconfirmed" },
      pendingWake: null,
    });
  });

  it("running is a held lock with nothing unresolved; a wake that waits is said; nothing to say is null", () => {
    expect(runState(row({ running: true, attempt: { startedAt: "2026-11-21T10:00:00.000Z" } }))).toEqual({ running: { since: "2026-11-21T10:00:00.000Z" }, unknown: null, pendingWake: null });
    expect(runState(row({ running: true, attempt: { startedAt: "2026-11-21T10:00:00.000Z", error: "boom" } }))).toMatchObject({ running: null, unknown: { holdsSlot: true, error: "boom" } });
    expect(runState(row({ running: false, lastRun: { outcome: "unknown", scheduledFor: "2026-11-21T10:00:00.000Z", error: "lost" } }))).toMatchObject({ unknown: { since: "2026-11-21T10:00:00.000Z", error: "lost" } });
    expect(runState(row({ pendingWake: { scheduledFor: "2026-11-21T10:30:00.000Z" } }))).toEqual({ running: null, unknown: null, pendingWake: { scheduledFor: "2026-11-21T10:30:00.000Z" } });
    expect(runState(rowOf(schedules(), "oats-real/nightly-digest"))).toBeNull();
    expect(runState(rowOf(triggers(), "local/pr-triage"))).toBeNull();
  });
});

describe("the row's small line", () => {
  const AT = Date.parse(schedules().scheduler!.lastTick!) + 2 * 3600e3;
  const lineOf = (id: string, kind: "schedule" | "trigger" = "schedule", options: Parameters<typeof rowLine>[3] = {}) => {
    const entry = rowOf(kind === "schedule" ? schedules() : triggers(), id);
    return rowLine(entry, statusFor(entry, STATUSES().statuses), AT, options).map((part) => `${part.lead ?? ""}${part.text}`);
  };

  it("who it starts: the soul, the agent a wake wakes, Command, the operation by its name", () => {
    const list = schedules();
    expect(whoWords(rowOf(list, "local/daily-review"))).toBe("oats-developer");
    expect(whoWords(rowOf(list, "local/wake-oats-developer-review-202611212017"))).toBe("oats-developer-review-202611212017");
    expect(whoWords(rowOf(list, "local/status-check"))).toBe("Command");
    expect(whoWords(rowOf(list, "local/notes-checkpoint"))).toBe("knowledge:checkpoint");
    expect(whoWords(row({ kind: "wake" }))).toBeNull();
  });

  it("when: a cadence in words, else the cron itself; a trigger's event with its repository, or its capability and source", () => {
    expect(whenWords(rowOf(schedules(), "local/hourly-check"))).toBe("Every hour");
    expect(whenWords(row({ cron: "7 3 1 * *" }))).toBe("7 3 1 * *");
    expect(whenWords(rowOf(triggers(), "local/pr-triage"))).toBe("On a pull request, acme/app");
    expect(whenWords(rowOf(triggers(), "local/graph-watch"))).toBe("On acme.graph: harvest-branches");
  });

  it("the machine it runs on: the one that holds the deployment, by bb's name for it, or the other host the kernel names", () => {
    expect(runsOnWords(rowOf(schedules(), "local/daily-review"))).toBe("Runs on this computer");
    expect(runsOnWords(rowOf(schedules(), "local/daily-review"), hereOf("falcon"))).toBe("Runs on falcon");
    expect(runsOnWords(rowOf(schedules(), "oats-real/weekly-report"), hereOf("falcon"))).toBe("Runs on report-server");
    // A machine with no host name runs none of the workspace's: nowhere to name.
    expect(runsOnWords(rowOf(schedules("schedule-list-host-unnamed.json"), "oats-real/nightly-digest"))).toBeNull();
  });

  it("the owner only where the kernel gives one: the account a workspace automation acts as; a local one has none", () => {
    expect(ownerWords(rowOf(schedules(), "oats-real/nightly-digest"))).toBe("@ana");
    expect(ownerWords(rowOf(schedules(), "local/daily-review"))).toBeNull();
    expect(ownerWords(row({ owner: "someone" }))).toBe("someone");
  });

  it("when · runs on · owner · the last run with what came of it; the list says no next run, an automation's own page does", () => {
    expect(lineOf("oats-real/nightly-digest")).toEqual(["Daily at 07:00", "Runs on this computer", "@ana"]);
    expect(lineOf("oats-real/nightly-digest", "schedule", { next: { running: true } })).toEqual(["Daily at 07:00", "Runs on this computer", "@ana", "Next in 8 h"]);
    expect(lineOf("oats-real/nightly-digest", "schedule", { next: { running: false } })).toEqual(["Daily at 07:00", "Runs on this computer", "@ana"]);
    expect(lineOf("local/weekly-cleanup", "schedule", { next: { running: true } })).toEqual(["Fridays at 18:00", "Runs on this computer"]);
    expect(lineOf("local/daily-review")).toEqual(["Weekdays at 09:00", "Runs on this computer", "Last 2 h ago, Agent active"]);
    expect(lineOf("local/hourly-check")).toEqual(["Every hour", "Runs on this computer", "Last 2 h ago, Launch failed"]);
    expect(lineOf("oats-real/weekly-report")).toEqual(["Mondays at 09:00", "Runs on report-server", "@acme-bot"]);
    expect(lineOf("local/pr-triage", "trigger")).toEqual(["On a pull request, acme/app", "Runs on this computer", "Last 2 h ago, #41"]);
  });

  it("a row that cannot run on the machine is not said to run on it: why not is said, in red; one whose agent asks ends in Needs you", () => {
    expect(lineOf("oats-real/reconcile")).toEqual(["Every 30 minutes", "@acme-billing-bot", "Wrong account"]);
    expect(lineOf("local/legacy-herdr")).toEqual(["Daily at 06:00", "Invalid"]);
    const entry = rowOf(schedules(), "local/daily-review");
    expect(rowLine(entry, null, AT, { asks: true }).at(-1)).toEqual({ text: "Needs you", tone: "ask" });
  });

  it("a reason this plugin does not know is said as that the row does not run here", () => {
    const odd = { ...rowOf(schedules(), "oats-real/weekly-report"), group: "attention" as const, reason: "other" as const, reasonCode: "quarantined" };
    expect(rowLine(odd, null, NOW).at(-1)).toEqual({ text: "Doesn't run here", tone: "bad" });
    expect(failing(odd, null)).toBe(true);
  });
});

describe("what is failing: one rule for the row's red, the filter's count and the sidebar's dot", () => {
  const statuses = STATUSES().statuses;
  const all = oneList(schedules().rows, triggers().rows);
  const bad = (rows: typeof all) => rows.filter((entry) => failing(entry, statusFor(entry, statuses))).map((entry) => entry.id);

  it("on the recording: a refused launch, an invalid definition, a wrong account, no trust, a failed source check; an unknown state is not one", () => {
    expect(bad(all)).toEqual(["local/hourly-check", "local/legacy-herdr", "oats-real/reconcile", "oats-real/release-check", "oats-real/harvest-closed"]);
  });

  it("a row is failing exactly when its line holds a red part", () => {
    for (const entry of all) {
      const status = statusFor(entry, statuses);
      expect([entry.id, rowLine(entry, status, NOW).some((part) => part.tone === "bad")]).toEqual([entry.id, failing(entry, status)]);
    }
  });

  it("what needs a person comes before what is failing, and is counted by its own filter; one that does both is in both", () => {
    const asking = (entry: AutomationRow) => (entry.id === "local/daily-review" || entry.id === "local/hourly-check" ? "an-agent" : null);
    expect(inOrder(all, statuses, asking).slice(0, 3).map((entry) => entry.id)).toEqual(["local/daily-review", "local/hourly-check", "local/legacy-herdr"]);
    expect(filterList(all, "needs", statuses, asking).map((entry) => entry.id)).toEqual(["local/daily-review", "local/hourly-check"]);
    expect(filterList(all, "failing", statuses, asking)).toHaveLength(5);
    expect([attention(rowOf(schedules(), "local/hourly-check"), null, asking), attention(rowOf(schedules(), "local/hourly-check"), null, undefined), attention(rowOf(schedules(), "local/notes-checkpoint"), null, asking)]).toEqual(["needs", "failing", null]);
  });

  it("the filter: every row, one kind, or what is failing; and what is failing leads the list, the rest in its order", () => {
    expect(LIST_FILTERS.map((option) => [option.label, filterList(all, option.id, statuses).length])).toEqual([["All", 18], ["Schedules", 11], ["Triggers", 7], ["Needs you", 0], ["Failing", 5]]);
    expect(filterList(all, "failing", statuses).map((entry) => entry.id)).toEqual(bad(all));
    const first = inOrder(all, statuses).map((entry) => entry.id);
    expect(first.slice(0, 5)).toEqual(bad(all));
    expect(first.slice(5)).toEqual(all.map((entry) => entry.id).filter((id) => !bad(all).includes(id)));
  });

  it("THE BUSY SET (37 automations, five failing, names of sixty characters): the rows drawn red, the filter's count and the dot's verdict agree", () => {
    const set = busy();
    const rows = oneList(set.schedules.rows, set.triggers.rows);
    expect(rows).toHaveLength(37);
    expect(rows.every((entry) => entry.name.length === 60)).toBe(true);
    expect(new Set(rows.map((entry) => `${entry.kind}:${entry.id}`)).size).toBe(37);
    const red = rows.filter((entry) => rowLine(entry, statusFor(entry, set.statuses), NOW).some((part) => part.tone === "bad"));
    const counted = filterList(rows, "failing", set.statuses);
    const dot = rows.some((entry) => failing(entry, statusFor(entry, set.statuses)));
    expect([red.length, counted.length, dot]).toEqual([5, 5, true]);
    expect(counted.map((entry) => entry.id)).toEqual(red.map((entry) => entry.id));
    expect(inOrder(rows, set.statuses).slice(0, 5).map((entry) => entry.id)).toEqual(red.map((entry) => entry.id));
    // With none failing, none of the three says so.
    const calm = rows.filter((entry) => !red.includes(entry));
    expect([filterList(calm, "failing", set.statuses).length, calm.some((entry) => failing(entry, statusFor(entry, set.statuses)))]).toEqual([0, false]);
    // Some automations of it keep fifty runs, and the Runs tab's list is of hundreds.
    expect(set.schedules.rows.filter((entry) => entry.recentRuns.length === 50).length).toBeGreaterThan(2);
    expect(allRuns(set.schedules.rows, set.triggers.rows, set.statuses).entries.length).toBeGreaterThan(200);
  });

  it("the search reads the name, the id, who it starts, when, what it sends and the summary", () => {
    const found = (query: string) => searchRows(all, query).map((entry) => entry.name);
    expect(found("NIGHTLY")).toEqual(["nightly-digest"]);
    expect(found("knowledge-harvester")).toEqual(["nightly-digest"]);
    expect(found("every hour")).toEqual(["hourly-check"]);
    expect(found("acme/app")).toEqual(["pr-triage"]);
    expect(found("  ")).toHaveLength(18);
    expect(found("no such thing")).toEqual([]);
  });
});

describe("a run's row", () => {
  const lines = (id: string, kind: "schedule" | "trigger" = "schedule") => {
    const entry = rowOf(kind === "schedule" ? schedules() : triggers(), id);
    const status = STATUSES().statuses.find((candidate) => candidate.id === id)?.status ?? null;
    return pageRuns(entry, status).map(runLine);
  };

  it("a schedule's run: its mark, its outcome in a person's word, its agent, and the kernel's own words where it has some", () => {
    expect(lines("local/daily-review")).toEqual([{ mark: "done", at: "2026-11-21T20:17:32.946Z", what: null, word: "Agent launched", notes: [], agent: "oats-developer-review-202611212017", error: null }]);
    const [failed] = lines("local/hourly-check");
    expect([failed!.mark, failed!.word, failed!.agent, failed!.error!.code]).toEqual(["failed", "Launch failed", null, "E_BACKEND_SANDBOXED_MODE"]);
    const [unknown] = lines("local/status-check");
    expect([unknown!.mark, unknown!.word]).toEqual(["unknown", "Launch state unknown"]);
  });

  it("an outcome this plugin has no word for is the kernel's own; a wake held by a claim is Held", () => {
    const run = rowOf(schedules(), "local/daily-review").recentRuns[0]!;
    const owner = { kind: "schedule" as const, id: "x", name: "x" };
    expect(runLine({ of: "run", owner, at: null, run: { ...run, outcome: "blocked" } }).word).toBe("blocked");
    expect(runLine({ of: "run", owner, at: null, run: { ...run, outcome: null } }).word).toBe("Attempt recorded");
    expect(runLine({ of: "run", owner, at: null, run: { ...run, outcome: "skipped", reason: "waiting-on-you" } })).toMatchObject({ mark: "waiting", word: "Held" });
    expect(runLine({ of: "run", owner, at: null, run: { ...run, outcome: "stopped" } })).toMatchObject({ mark: "unknown", word: "Agent stopped" });
    expect(runLine({ of: "run", owner, at: null, run: { ...run, outcome: "delivered" } })).toMatchObject({ mark: "done", word: "Wake message delivered" });
  });

  it("a trigger: what waits, then what fired, each by its event", () => {
    expect(lines("local/pr-triage", "trigger").map((line) => [line.mark, line.what, line.word, line.agent])).toEqual([
      ["waiting", "#42 opened", "Waiting", null],
      ["waiting", "#43 opened", "Waiting", null],
      ["waiting", "#45 opened", "Waiting", null],
      ["done", "#41 opened", "Agent launched", "oats-developer-triage-41"],
    ]);
  });

  it("a run's time is a date and a time, with its year only when it is not this one; no time is no label", () => {
    const at = "2026-11-21T20:17:32.946Z";
    const when = runWhen(at, Date.parse("2026-11-25T12:00:00.000Z"))!;
    expect(when.label).toBe(new Date(at).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }));
    expect(when.title).toBe(new Date(at).toLocaleString());
    expect(runWhen(at, Date.parse("2027-01-02T12:00:00.000Z"))!.label).toContain("2026");
    expect(runWhen(null, NOW)).toBeNull();
    expect(runWhen("not a time", NOW)).toBeNull();
  });

  it("what is not kept is said with the count only where the kernel gives one", () => {
    expect([earlierNotKept(null), earlierNotKept(3), earlierNotKept(1)]).toEqual(["Earlier runs are not kept", "3 earlier runs are not kept", "1 earlier run is not kept"]);
  });
});
