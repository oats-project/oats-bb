// What the page says about a row, in the Desktop's words, over the rows the real kernel printed.
import { describe, expect, it } from "vitest";
import { displayLine } from "../../app/ui/text";
import type { AutomationRow } from "../../contract/automations";
import { automationRowOf } from "../../kernel/automations";
import {
  actsAs,
  capabilitySource,
  causeWords,
  cronInWords,
  filterRows,
  groupRows,
  harnessName,
  hostLogin,
  hostUnnamed,
  hostUnnamedDetail,
  lastNext,
  lastRunFailed,
  listBanners,
  onSummary,
  ownerParts,
  dueWords,
  pastTime,
  placementText,
  reconcileCommand,
  relativeTime,
  ruleWords,
  runState,
  schedulerLine,
  snapshotLine,
  soulOriginText,
  sourceLabel,
  sourceParams,
  summaryLine,
  taskParts,
  templateProvenance,
  HERE,
  hereOf,
  schedulerOff,
  notRunHere,
  hostNameHow,
  emptyHow,
  switchTitle,
} from "../../app/automations/words";
import { rowOf, schedules, triggers } from "./fixtures";

const NOW = Date.parse("2026-11-21T12:00:00.000Z");
const row = (raw: Record<string, unknown>, kind: "schedule" | "trigger" = "schedule"): AutomationRow => automationRowOf({ id: "x", ...raw }, kind)!;

describe("the groups, the filter and the search", () => {
  it("rows are grouped by where they run, in page order, and an empty group is left out", () => {
    const groups = groupRows(schedules().rows);
    expect(groups.map((group) => [group.title, group.rows.map((entry) => entry.name)])).toEqual([
      ["Runs on this computer", ["daily-review", "hourly-check", "notes-checkpoint", "status-check", expect.stringMatching(/^wake-/), "weekly-cleanup", "nightly-digest"]],
      ["Needs attention here", ["legacy-herdr", "reconcile", "release-check"]],
      ["Runs elsewhere", ["weekly-report"]],
    ]);
    expect(groupRows(schedules("schedule-list-empty.json").rows)).toEqual([]);
    expect(groupRows(schedules().rows.filter((entry) => entry.group === "elsewhere")).map((group) => group.id)).toEqual(["elsewhere"]);
  });

  it("All, Workspace and Local filter by where the definition lives", () => {
    const rows = schedules().rows;
    expect(filterRows(rows, { origin: "all" })).toHaveLength(rows.length);
    expect(filterRows(rows, { origin: "workspace" }).map((entry) => entry.name)).toEqual(["nightly-digest", "reconcile", "release-check", "weekly-report"]);
    expect(filterRows(rows, { origin: "local" }).every((entry) => entry.origin.kind === "local")).toBe(true);
  });

  it("the search reads the id, the soul, the task or message, the summary, the host and the account", () => {
    const rows = schedules().rows;
    const found = (query: string, origin: "all" | "workspace" | "local" = "all") => filterRows(rows, { query, origin }).map((entry) => entry.name);
    expect(found("NIGHTLY")).toEqual(["nightly-digest"]);
    expect(found("knowledge-harvester")).toEqual(["nightly-digest"]);
    expect(found("release branch")).toEqual(["release-check"]);
    // A wake's own message is searched; the wake a spawn attaches to its agents is not.
    expect(found("anything new")).toEqual([expect.stringMatching(/^wake-/)]);
    expect(found("billing ledger")).toEqual(["reconcile"]);
    expect(found("report-server")).toEqual(["weekly-report"]);
    expect(found("acme-billing-bot")).toEqual(["reconcile"]);
    expect(found("  ")).toHaveLength(rows.length);
    expect(found("no such thing")).toEqual([]);
    expect(found("review", "workspace")).toEqual([]);
  });
});

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
  it("says the origin in words", () => {
    expect(soulOriginText(rowOf(schedules(), "local/daily-review").soul!.origin)).toEqual({ short: "oats-real", long: "A soul in the member oats-real" });
    expect(soulOriginText({ kind: "package", package: "oats.okf", version: "5.0.0", member: null, repoKey: null, source: null, candidates: null })).toEqual({ short: "package oats.okf", long: "A soul of the locked package oats.okf 5.0.0" });
    expect(soulOriginText({ kind: "external", package: null, version: null, member: null, repoKey: null, source: "github.com/x/y", candidates: null })).toEqual({ short: "external", long: "An external soul from github.com/x/y" });
    expect(soulOriginText({ kind: "ambiguous", package: null, version: null, member: null, repoKey: null, source: null, candidates: 3 })).toEqual({ short: "ambiguous name", long: "3 souls answer to this name; a spawn needs the qualified name" });
    expect(soulOriginText(null)).toEqual({ short: "not found here", long: "This name does not resolve in this workspace (or there is no snapshot yet)" });
  });

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
    const named = hereOf("checks");
    expect([named, hereOf(null), hereOf(undefined), hereOf("")]).toEqual([{ on: "checks", name: "checks" }, HERE, HERE, HERE]);
    expect(HERE).toEqual({ on: "this computer", name: "This computer" });
    // bb's name is free text: it is drawn as a display line.
    expect(hereOf("che\u202Ecks\nx").on).toBe(displayLine("che\u202Ecks\nx"));
    const list = schedules();
    expect(groupRows(list.rows, true, named).map((group) => group.title)).toEqual(["Runs on checks", "Needs attention here", "Runs elsewhere"]);
    expect(groupRows(list.rows, false, named)[0]!.title).toBe("Set to run on checks");
    expect(placementText(rowOf(list, "local/daily-review"), list.host, true, named)).toEqual({ label: "checks", tone: "ok", detail: "Local: runs on checks as its own gh login" });
    expect(placementText(rowOf(list, "oats-real/nightly-digest"), list.host, true, named)).toEqual({ label: "checks", tone: "ok", detail: "checks's host name is bb-box" });
    expect(placementText(rowOf(list, "local/daily-review"), list.host, false, named).detail).toBe("The scheduler is not running on checks");
    expect([schedulerOff(named).title, hostUnnamed(named).title, notRunHere(named)]).toEqual(["The scheduler is not running on checks", "checks has no host name in OATS", "Does not run on checks"]);
    expect(hostNameHow(named)).toBe("In the deployment's oats-local.yaml on checks, set host: name: to the name it goes by in the workspace, then press Refresh.");
    expect(emptyHow("schedule", named)).toContain("or add a local one on checks with oats schedule add.");
    expect(switchTitle(rowOf(list, "local/daily-review"), named)).toBe("On here: click to turn it off on checks");
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

  it("who it acts as, and who this computer's gh is", () => {
    const list = schedules();
    expect(ownerParts("github.com/ana")).toEqual({ host: "github.com", login: "ana" });
    expect(ownerParts("ana")).toBeNull();
    expect(actsAs(rowOf(list, "local/daily-review"))).toBe("local");
    expect(actsAs(rowOf(list, "oats-real/reconcile"))).toBe("as @acme-billing-bot");
    expect(hostLogin(list.host, "github.com/acme-billing-bot")).toBe("github.com/ana");
    expect(hostLogin({ name: "h", ghUser: { "github.com": null } }, "github.com/ana")).toBe("not logged in");
    expect(hostLogin(list.host, "ghe.example/ana")).toBeNull();
    expect(hostLogin(list.host, null)).toBeNull();
  });
});

describe("the host scheduler and the list's notices", () => {
  it("on, with when it last checked and how many it runs at once; or off", () => {
    expect(schedulerLine({ installed: true, active: true, registered: true, lastTick: new Date(NOW - 2 * 60e3).toISOString(), maxConcurrent: 5 }, NOW)).toBe("Scheduler on · checked 2 min ago · up to 5 at once");
    expect(schedulerLine({ installed: true, active: true, registered: null, lastTick: null, maxConcurrent: null }, NOW)).toBe("Scheduler on");
    for (const off of [
      { installed: false, active: true, registered: true },
      { installed: true, active: false, registered: true },
      { installed: true, active: true, registered: false },
    ]) expect(schedulerLine({ ...off, lastTick: null, maxConcurrent: 5 }, NOW)).toBe("Scheduler off");
    expect(schedulerLine(schedules().scheduler!, Date.parse(schedules().scheduler!.lastTick!) + 60e3)).toBe("Scheduler on · checked 1 min ago · up to 5 at once");
  });

  it("the banner for a scheduler that is off shows only when something here would run", () => {
    expect(listBanners(schedules("schedule-list-scheduler-off.json"))).toEqual({ hostUnnamed: false, schedulerOff: true });
    expect(listBanners(schedules("schedule-list-empty.json"))).toEqual({ hostUnnamed: false, schedulerOff: false });
    expect(listBanners(schedules())).toEqual({ hostUnnamed: false, schedulerOff: false });
  });

  it("the banner for a host with no name shows when the workspace has rows it cannot place", () => {
    expect(listBanners(schedules("schedule-list-host-unnamed.json")).hostUnnamed).toBe(true);
    expect(listBanners(triggers("trigger-list-host-unnamed.json")).hostUnnamed).toBe(true);
    expect([hostUnnamed().title, hostUnnamedDetail("schedule")]).toEqual(["This computer has no host name in OATS", "It runs none of the workspace's schedules. Name it in this deployment's local settings to take on the ones assigned to it."]);
    expect(hostUnnamedDetail("trigger")).toContain("none of the workspace's triggers");
  });

  it("the line under the list: the last sync, what it could not read, or that none happened yet", () => {
    const list = schedules();
    expect(snapshotLine(list, Date.parse(list.snapshot!.takenAt!) + 3 * 60e3)).toBe("Workspace schedules as of the last sync (3 min ago) · Only members you can read in Git contribute.");
    expect(snapshotLine({ ...list, snapshot: { takenAt: null, problems: 2 } }, NOW)).toBe("Workspace schedules as of the last sync · 2 discovery problems · Only members you can read in Git contribute.");
    expect(snapshotLine({ ...triggers(), snapshot: { takenAt: null, problems: 1 } }, NOW)).toContain("Workspace triggers as of the last sync · 1 discovery problem ·");
    expect(snapshotLine(schedules("schedule-list-empty.json"), NOW)).toBe("Workspace items appear after the next sync · Only members you can read in Git contribute.");
  });
});

describe("last and next", () => {
  it("a schedule: when it is next due, and its last run with the outcome in words", () => {
    const list = schedules();
    const cell = (id: string) => {
      const entry = rowOf(list, id);
      return lastNext(entry, Date.parse(entry.lastRun?.startedAt ?? entry.createdAt!) + 2 * 3600e3);
    };
    expect(cell("local/daily-review")).toMatchObject({ next: expect.stringMatching(/^Next in \d+ (h|d)$/), last: "Last 2 h ago", lastOutcome: expect.stringMatching(/^agent (launched|active)$/), lastTone: null });
    expect(cell("local/hourly-check")).toMatchObject({ last: "Last 2 h ago", lastOutcome: "launch failed", lastTone: "bad" });
    expect(cell("local/status-check")).toMatchObject({ last: "Last 2 h ago", lastOutcome: "launch state unknown", lastTone: "warn" });
    expect(cell("local/weekly-cleanup")).toMatchObject({ next: "Off here", last: "Not run yet", lastTitle: null });
    expect(cell("oats-real/nightly-digest")).toMatchObject({ last: "Not run yet" });
    // Another computer runs it: runs are recorded there.
    expect(cell("oats-real/weekly-report")).toBeNull();
    expect(cell("oats-real/reconcile")).toBeNull();
  });

  it("a trigger: its next poll, and its last fire named by what fired", () => {
    const list = triggers();
    const cell = (id: string) => {
      const entry = rowOf(list, id);
      return lastNext(entry, Date.parse(entry.lastRun?.at ?? entry.createdAt ?? "2026-11-21T00:00:00Z") + 5 * 60e3);
    };
    expect(cell("oats-real/proposal-review")).toMatchObject({ last: "Last 5 min ago", lastOutcome: "#41", lastTone: null });
    expect(cell("oats-real/harvest-review")).toMatchObject({ last: "Last 5 min ago", lastOutcome: "harvest/a" });
    expect(cell("local/old-prs")).toMatchObject({ next: "Off here", last: "Not run yet" });
    expect(cell("oats-real/docs-review")).toBeNull();
    expect(lastNext(row({ runsHere: true }, "trigger"), NOW)).toMatchObject({ next: "Polls at the next tick", last: "Not run yet" });
    expect(lastNext(row({ runsHere: true }), NOW)).toMatchObject({ next: "Next not reported" });
    // What is so: a time that has passed was due, and under a scheduler that is off nothing is next.
    expect(lastNext(row({ runsHere: true, nextDue: new Date(NOW - 9 * 3600e3).toISOString() }), NOW)).toMatchObject({ next: "Was due 9 h ago" });
    expect(lastNext(row({ runsHere: true, nextDue: new Date(NOW + 9 * 3600e3).toISOString() }), NOW)).toMatchObject({ next: "Next in 9 h" });
    expect(lastNext(row({ runsHere: true, nextDue: new Date(NOW + 9 * 3600e3).toISOString() }), NOW, false)).toMatchObject({ next: "Scheduler off" });
    // The whole time is the title only where the text is that time: never behind "Scheduler off" or "Off here".
    const ahead = { runsHere: true, nextDue: new Date(NOW + 9 * 3600e3).toISOString() };
    expect(lastNext(row(ahead), NOW)!.nextTitle).toBe(new Date(NOW + 9 * 3600e3).toLocaleString());
    expect(lastNext(row(ahead), NOW, false)).toMatchObject({ next: "Scheduler off", nextTitle: "Scheduler off" });
    expect(lastNext(row({ ...ahead, enabledHere: false, origin: { kind: "local" }, enabled: false }), NOW)).toMatchObject({ next: "Off here", nextTitle: "Off here" });
    // One rule for a due time, wherever it is said: ahead it is next, at or after its time it was due.
    const due = (ms: number) => dueWords(new Date(NOW + ms).toISOString(), NOW);
    expect([due(9 * 3600e3), due(-3 * 60e3), due(0), dueWords(null, NOW)]).toMatchObject([{ word: "Next", label: "in 9 h" }, { word: "Was due", label: "3 min ago" }, { word: "Was due" }, null]);
    // A row that does not run on the machine (it needs attention there) still shows the run it had there, and says it does not run in place of a next one.
    const ran = row({ runsHere: false, group: "attention", reason: "owner-mismatch", origin: { kind: "workspace" }, nextDue: new Date(NOW + 3600e3).toISOString(), lastRun: { startedAt: new Date(NOW - 86400e3).toISOString(), outcome: "agent-launched" } });
    expect(ran.group).not.toBe("here");
    expect(lastNext(ran, NOW, true, hereOf("checks"))).toMatchObject({ next: "Does not run on checks", last: "Last 1 d ago" });
    expect(lastNext(row({ runsHere: false, reason: "assigned-elsewhere", origin: { kind: "workspace" } }), NOW)).toBeNull();
    // A run that has happened is never said to lie ahead, whatever the browser's clock says; nor is the scheduler's last tick.
    expect(lastNext(row({ runsHere: true, lastRun: { startedAt: new Date(NOW + 30e3).toISOString(), outcome: "agent-launched" } }), NOW)).toMatchObject({ last: "Last less than a minute ago" });
    expect(schedulerLine({ installed: true, active: true, registered: true, lastTick: new Date(NOW + 30e3).toISOString(), maxConcurrent: 5 }, NOW)).toBe("Scheduler on · checked less than a minute ago · up to 5 at once");
    expect(lastNext(row({ runsHere: true, enabledHere: false, nextDue: new Date(NOW + 9 * 3600e3).toISOString() }), NOW, false)).toMatchObject({ next: "Off here" });
    expect(lastNext(row({ runsHere: true, lastRun: { startedAt: new Date(NOW - 60e3).toISOString(), outcome: "newly-named" } }), NOW)).toMatchObject({ last: "Last 1 min ago", lastOutcome: "newly-named", lastTone: null });
    // A subject that is withheld is not dressed as a pull request's number.
    expect(lastNext(row({ runsHere: true, on: { source: "github.pull_request" }, lastRun: { at: new Date(NOW - 60e3).toISOString(), subject: "token=abcdef0123456789" } }, "trigger"), NOW)).toMatchObject({ last: "Last 1 min ago", lastOutcome: "[withheld]" });
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
    expect(reconcileCommand(entry)).toBe("oats schedule reconcile local/status-check --dir /abs/deployment");
    expect(reconcileCommand(entry, { clear: true })).toBe("oats schedule reconcile local/status-check --clear --dir /abs/deployment");
    expect(reconcileCommand(row({ scope: "/home/it's here/dep" }))).toBe("oats schedule reconcile x --dir '/home/it'\\''s here/dep'");
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

describe("where it comes from", () => {
  it("a package template's provenance", () => {
    expect(templateProvenance(row({ template: { package: "oats.okf", template: "proposal-review", version: "v0.4.0", commit: "abc1234def" } }, "trigger").template)).toBe("oats.okf:proposal-review v0.4.0 @abc1234");
    expect(templateProvenance(row({ template: { from: "oats.okf:proposal-review" } }, "trigger").template)).toBe("oats.okf:proposal-review");
    expect(templateProvenance(null)).toBeNull();
  });
});

describe("the failed-run mark", () => {
  it("a schedule whose last run is launch failed or invalid marks; nothing else does", () => {
    const list = schedules();
    expect(list.rows.filter(lastRunFailed).map((entry) => entry.name)).toEqual(["hourly-check", "legacy-herdr"]);
    expect(schedules("schedule-list-scheduler-off.json").rows.filter(lastRunFailed)).toEqual([]);
    expect(triggers().rows.filter(lastRunFailed)).toEqual([]);
    // `unknown` is a launch whose state is not known, not a failed one; a trigger's last run carries no outcome.
    expect(lastRunFailed(rowOf(list, "local/status-check"))).toBe(false);
    expect(lastRunFailed(row({ lastRun: { outcome: "launch-failed" } }, "trigger"))).toBe(false);
    expect(lastRunFailed(row({ lastRun: null }))).toBe(false);
  });
});
