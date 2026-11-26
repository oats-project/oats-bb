// What the Automations page says about a row, in the Desktop's words (awebai/oats
// packages/desktop/renderer/automation-rows.mjs and views/automations.mjs at a4a43220). Pure
// functions over the rows of contract/automations.ts: no bb and no React import. Nothing here
// derives a placement: the kernel's `runsHere`, `reason` and `enabledHere` are read as given.
import type { AutomationHost, AutomationKind, AutomationList, AutomationOn, AutomationRow, AutomationRun, AutomationScheduler, AutomationSoul } from "../../contract/automations";
import { eventLabel, PULL_REQUEST } from "../../model/automations";
import type { RunEntry } from "../../model/automation-runs";
import { displayLine, MAX_DISPLAY_LINE, refusalCode } from "../ui/text";

export const TITLES: Record<AutomationKind, string> = { schedule: "Schedules", trigger: "Triggers" };

// ---- the machine the page is about ----
/**
 * The machine that holds the deployment, as the page names it: bb's name for it, as the sidebar
 * does. "Here" on this page is that machine, which need not be the computer the person sits at,
 * so where the Desktop says "this computer" (it runs on the computer it is on) the page says the
 * name, in one form everywhere. Only while bb gives no name does it keep the Desktop's words.
 * `on` stands inside a sentence, `name` where it starts one or is a label.
 */
export type Here = { on: string; name: string };
export function hereOf(machine: string | null | undefined): Here {
  const name = displayLine(machine);
  return name === null ? { on: "this computer", name: "This computer" } : { on: name, name };
}
/** The machine while bb has not named it. */
export const HERE: Here = hereOf(null);

// ---- groups, the filter and the search ----
export const GROUPS = [{ id: "here" }, { id: "attention" }, { id: "elsewhere" }] as const;





/** A harness's display name (Claude, Pi, Codex), else the value as reported. */
export function harnessName(value: string): string {
  const names: Record<string, string> = { claude: "Claude", pi: "Pi", codex: "Codex" };
  const reported = value.trim();
  return names[reported.toLowerCase()] ?? reported;
}

// ---- when ----
const pad = (n: string): string => n.padStart(2, "0");
const DAYS = ["Sundays", "Mondays", "Tuesdays", "Wednesdays", "Thursdays", "Fridays", "Saturdays"];
/** Common cron shapes in words; anything else is null (the page then shows the cron itself). */
export function cronInWords(cron: string | null): string | null {
  const fields = cron === null ? [] : cron.trim().split(/\s+/);
  if (fields.length !== 5) return null;
  const [min, hour, dom, mon, dow] = fields as [string, string, string, string, string];
  const every = /^\*\/(\d+)$/.exec(min);
  if (every && hour === "*" && dom === "*" && mon === "*" && dow === "*") return `Every ${every[1]} minutes`;
  if (min === "0" && hour === "*" && dom === "*" && mon === "*" && dow === "*") return "Every hour";
  if (!/^\d+$/.test(min) || !/^\d+$/.test(hour) || dom !== "*" || mon !== "*") return null;
  const at = `${pad(hour)}:${pad(min)}`;
  if (dow === "*") return `Daily at ${at}`;
  if (dow === "1-5") return `Weekdays at ${at}`;
  if (/^[0-6]$/.test(dow)) return `${DAYS[Number(dow)]} at ${at}`;
  return null;
}

/** A timestamp relative to now ("in 5 min", "2 h ago"), with the absolute time for its title. */
export function relativeTime(iso: string | null, now: number): { label: string; title: string } | null {
  const at = Date.parse(iso ?? "");
  if (!Number.isFinite(at)) return null;
  const delta = at - now;
  const size = Math.abs(delta);
  const future = delta > 0;
  const unit = size < 60e3 ? null : size < 3600e3 ? `${Math.round(size / 60e3)} min` : size < 86400e3 ? `${Math.round(size / 3600e3)} h` : `${Math.round(size / 86400e3)} d`;
  return { label: unit === null ? (future ? "in under a minute" : "less than a minute ago") : future ? `in ${unit}` : `${unit} ago`, title: new Date(at).toLocaleString() };
}
/**
 * When something that has happened did (a run, a fire, a poll, a check), relative to now. It is
 * never said to lie ahead: a time the kernel stamped a moment after the page's own clock (two
 * clocks, or a page drawn from an older tick) reads as less than a minute ago.
 */
export function pastTime(iso: string | null, now: number): { label: string; title: string } | null {
  const at = Date.parse(iso ?? "");
  return relativeTime(iso, Number.isFinite(at) ? Math.max(now, at) : now);
}

// ---- a trigger's source ----
export type CapabilitySource = { id: string | null; capability: string | null; name: string | null; lookup: string | null };
// The kernel's capability-name grammar: only such a name is ever looked up (Open capability).
const CAPABILITY_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
/**
 * A capability source, from a trigger's `on`: `on.source` is `<capability>:<source>`, an open
 * string (anything that is not github.pull_request). Null for a pull-request trigger and for a
 * definition with no readable source. `status`: the status row's own `source`, preferred.
 */
export function capabilitySource(on: AutomationOn | null, status: { capability: string | null; name: string | null } | null = null): CapabilitySource | null {
  const id = on?.source ?? null;
  if (id === null || id === PULL_REQUEST) return null;
  const at = id.indexOf(":");
  const split = at > 0 ? [id.slice(0, at), id.slice(at + 1)] : [id, ""];
  const capability = status?.capability || split[0]!;
  const name = status?.name || split[1]!;
  return { id: displayLine(id), capability: displayLine(capability), name: displayLine(name), lookup: CAPABILITY_NAME.test(capability) ? capability : null };
}
/** "acme.graph · harvest-branches": how a capability source is named everywhere. */
export const sourceLabel = (source: { capability: string | null; name: string | null } | null): string | null =>
  [source?.capability, source?.name].filter(Boolean).join(" · ") || null;

const SOURCES: Record<string, string> = { [PULL_REQUEST]: "Pull request" };
export type OnSummary = { title: string; repo: string | null; labels: string[]; base: string | null; poll: string | null; source: CapabilitySource | null; events: string[] };
/**
 * A trigger's event in words: "Pull request opened, reopened", with its repo, labels and base. A
 * capability source's is "<capability> · <name>: <events>", its event names as the source declares them.
 */
export function onSummary(on: AutomationOn | null): OnSummary | null {
  if (on === null) return null;
  const source = capabilitySource(on);
  if (source !== null) {
    const events = on.events.map((event) => displayLine(event)).filter((event): event is string => event !== null);
    return { title: [sourceLabel(source), events.join(", ")].filter(Boolean).join(": "), repo: null, labels: [], base: null, poll: displayLine(on.poll), source, events };
  }
  const events = on.events.map((event) => event.replace(/_/g, " "));
  return {
    title: [(on.source !== null ? SOURCES[on.source] : undefined) ?? on.source ?? "Event", events.join(", ")].filter(Boolean).join(" "),
    repo: on.repo !== null ? on.repo.replace(/^github\.com\//, "") : null,
    labels: on.labels,
    base: on.base,
    poll: on.poll,
    source: null,
    events,
  };
}

/** A poll failure's cause in words; an unknown cause shows its code as it is. */
const CAUSES: Record<string, string> = {
  exit: "the source's command failed",
  result: "the source's answer was not valid",
  "too-many-events": "the source returned too many events",
  timeout: "the source's command timed out",
  refused: "the source refused",
  resolution: "the source could not be found",
};
export const causeWords = (cause: string | null): string | null => (cause !== null && Object.hasOwn(CAUSES, cause) ? CAUSES[cause]! : displayLine(cause));
/** Why OATS refused an event, in words; an unknown rule shows its code. */
const RULES: Record<string, string> = {
  shape: "not an event object",
  "unknown-key": "an unknown key",
  key: "a bad key",
  subject: "a bad subject",
  event: "an event this source doesn't declare",
  url: "a URL that isn't allowed",
  fields: "a field that isn't allowed",
  "duplicate-key": "a repeated key",
};
export const ruleWords = (rule: string | null): string | null => (rule !== null && Object.hasOwn(RULES, rule) ? RULES[rule]! : displayLine(rule));

/** At most this many parameters, refused events and skipped items are listed; the rest are counted. */
export const PARAMS_SHOWN = 16;
export const EVENTS_SHOWN = 10;
/**
 * A capability-source trigger's parameters as display-only lines: `name = value`, as written,
 * through the display filter; nothing is substituted, linked or interpreted. A value cut to fit
 * a line says so, as does an empty one and one that is not text.
 */
export function sourceParams(on: AutomationOn | null): { count: number; lines: { text: string | null; note: string | null }[]; more: number } {
  const entries = on?.params ?? [];
  const lines = entries.slice(0, PARAMS_SHOWN).map(({ name, value }) => {
    if (value === null) return { text: displayLine(name), note: "Its value is not text: not shown." };
    const whole = `${name} = ${value}`;
    return { text: displayLine(whole), note: value === "" ? "Its value is empty." : whole.length > MAX_DISPLAY_LINE ? `Cut at ${MAX_DISPLAY_LINE} characters: the end is not shown.` : null };
  });
  return { count: entries.length, lines, more: Math.max(0, entries.length - PARAMS_SHOWN) };
}

/** The lead-ins of the quote treatment: whose text a quoted line is, in the product's own words. */
export const LEAD_INS = {
  /** a trigger source's own words: a skipped item's why, a refused event's text, its refusal */
  source: (capability: string | null, name: string | null): string => `${[capability, name].filter(Boolean).join(" · ") || "The source"} says:`,
  /** a workspace or local trigger file's values (its parameters) */
  triggerFile: "From the trigger file:",
} as const;

// ---- the prompt's fields ----
/** The fields a pull-request trigger's templates take, and a capability source's (which also takes `{fields.<name>}`). */
export const PULL_REQUEST_TASK_FIELDS = ["repo", "number", "url", "event", "headSha", "trigger", "subject", "key"] as const;
export const SOURCE_TASK_FIELDS = ["trigger", "source", "subject", "event", "key", "url"] as const;
export type TaskPart = { text: string } | { field: string };
/** A trigger's task template split into text and the fields the kernel fills from the event, for highlighting. */
export function taskParts(task: string, on: AutomationOn | null): TaskPart[] {
  const named = capabilitySource(on) !== null;
  const fields: readonly string[] = named ? SOURCE_TASK_FIELDS : PULL_REQUEST_TASK_FIELDS;
  const pattern = new RegExp(`\\{(${[...fields, ...(named ? ["fields\\.[A-Za-z][A-Za-z0-9_]{0,39}"] : [])].join("|")})\\}`, "g");
  const parts: TaskPart[] = [];
  let at = 0;
  for (const match of task.matchAll(pattern)) {
    if (match.index > at) parts.push({ text: task.slice(at, match.index) });
    parts.push({ field: match[1]! });
    at = match.index + match[0].length;
  }
  if (at < task.length) parts.push({ text: task.slice(at) });
  return parts;
}

// ---- where it runs ----
/** "github.com/acme-kb-bot" as its host and login. */
export function ownerParts(owner: string | null): { host: string; login: string } | null {
  const match = owner === null ? null : /^([^/\s]+)\/([^/\s]+)$/.exec(owner);
  return match ? { host: match[1]!, login: match[2]! } : null;
}


/** The tone of a placement: it runs here (ok), it cannot (bad), it is off here or another computer's (muted). */
export type Tone = "ok" | "bad" | "muted";
/** Where a row runs, in words, with the tone of its dot and the detail behind it. */
export function placementText(row: AutomationRow, host: AutomationHost, running = true, here: Here = HERE): { label: string; tone: Tone; detail: string | null } {
  const placed = placedText(row, host, here);
  // A row that would run here does not while the host scheduler is off: its mark is not the one of a thing that runs.
  return placed.tone === "ok" && !running ? { ...placed, tone: "muted", detail: schedulerOff(here).title } : placed;
}
function placedText(row: AutomationRow, host: AutomationHost, here: Here): { label: string; tone: Tone; detail: string | null } {
  if (row.origin.kind === "local") {
    // A local row that is on but cannot run (its definition is invalid or unreadable) is not drawn as one that runs: it says what it is.
    if (row.enabledHere && !row.runsHere) return { label: row.unreadable !== null ? "Unreadable" : row.invalid !== null ? "Invalid" : "Doesn't run here", tone: "bad", detail: row.reasonDetail ?? row.unreadable?.message ?? row.invalid?.message ?? null };
    return { label: here.name, tone: row.enabledHere ? "ok" : "muted", detail: `Local: runs on ${here.on} as its own gh login` };
  }
  if (row.reason === "owner-mismatch") return { label: "Wrong account here", tone: "bad", detail: row.reasonDetail };
  if (row.reason === "untrusted") return { label: "Not trusted here", tone: "bad", detail: row.reasonDetail };
  if (row.reason === "other") return { label: "Doesn't run here", tone: "bad", detail: row.reasonDetail ?? `reason: ${row.reasonCode}` };
  if (row.reason === "host-unnamed") return { label: row.runsOn ?? "Not named", tone: "muted", detail: hostUnnamed(here).title };
  if (row.reason === "assigned-elsewhere") return { label: row.runsOn ?? "Another host", tone: "muted", detail: row.reasonDetail };
  return { label: here.name, tone: row.enabledHere ? "ok" : "muted", detail: host.name !== null ? `${here.name}'s host name is ${host.name}` : null };
}


// ---- the host scheduler ----
/** Nothing runs unless the host timer is installed, active and registered for this deployment. */
export const schedulerOn = (scheduler: AutomationScheduler): boolean => scheduler.installed && scheduler.active && scheduler.registered !== false;
// The two notices above a list. The Desktop says each as one sentence in a banner; the plugin's
// notice has a title, so the sentence's first clause is the title and the rest follows (WORDS.md).
export const schedulerOff = (here: Here = HERE) => ({ title: `The scheduler is not running on ${here.on}`, detail: "Nothing here runs until it is enabled." }) as const;
export const hostUnnamed = (here: Here = HERE) => ({ title: `${here.name} has no host name in OATS` }) as const;
/** What helps there, said where the notice is: the plugin has no act for it, so the place and the key are named. */
export const hostNameHow = (here: Here = HERE): string => `In the deployment's oats-local.yaml on ${here.on}, set host: name: to the name it goes by in the workspace, then press Refresh.`;
/** The notices a list shows above its rows: this host has no name, and the host timer is off. */
export function listBanners(list: AutomationList): { hostUnnamed: boolean; schedulerOff: boolean } {
  return {
    hostUnnamed: list.host.name === null && list.rows.some((row) => row.reason === "host-unnamed"),
    schedulerOff: list.scheduler !== null && !schedulerOn(list.scheduler) && list.rows.some((row) => row.runsHere),
  };
}




/**
 * A due time as what is so: ahead it is next; one that has passed (a list kept after a read that
 * failed, a host that was asleep, the moment before the next tick) was due, and is never called
 * next. The one rule for the list, a row's page and a test's card. Null for no time.
 */
export function dueWords(iso: string | null, now: number): { word: "Next" | "Was due"; label: string; title: string } | null {
  const at = relativeTime(iso, now);
  return at === null ? null : { word: Date.parse(iso ?? "") <= now ? "Was due" : "Next", ...at };
}


// ---- run state ----
export type RunState = {
  running: { since: string | null } | null;
  unknown: { since: string | null; scheduledFor: string | null; holdsSlot: boolean; exited: boolean | null; exitStatus: number | null; exitSignal: string | null; error: string | null } | null;
  pendingWake: { scheduledFor: string | null } | null;
};
/**
 * A schedule's run state on the machine, from the kernel's row: unknown, running, and a wake
 * waiting to be delivered. `running` is the job's lock (a host slot), not proof of a launch: an
 * attempt whose effects are unconfirmed keeps its lock, so unknown wins: an attempt with an
 * error, a last run of outcome `unknown`, or an attempt with no lock (a crash before its result).
 * Null when there is nothing to say.
 */
export function runState(row: AutomationRow): RunState | null {
  if (row.kind !== "schedule") return null;
  const { attempt, lastRun: last } = row;
  const unresolved = (attempt !== null && attempt.error !== null) || last?.outcome === "unknown" || (attempt !== null && !row.running);
  const running = row.running && !unresolved ? { since: attempt?.startedAt ?? last?.startedAt ?? null } : null;
  const unknown = unresolved
    ? {
        since: (attempt ?? last)?.startedAt ?? (attempt ?? last)?.scheduledFor ?? null,
        scheduledFor: (attempt ?? last)?.scheduledFor ?? null,
        holdsSlot: row.running,
        exited: attempt?.exited === true ? true : null,
        exitStatus: attempt?.exitStatus ?? null,
        exitSignal: attempt?.exitSignal ?? null,
        error: attempt?.error ?? last?.error ?? null,
      }
    : null;
  const pendingWake = row.pendingWake !== null ? { scheduledFor: row.pendingWake.scheduledFor } : null;
  return running !== null || unknown !== null || pendingWake !== null ? { running, unknown, pendingWake } : null;
}



/** What the red mark says, after the row's name: "Automations, a failure". */
export const FAILED_RUN_TEXT = ", a failure";

// ---- a row's file ----
/** How a row's defining file can be opened: in bb's preview on the machine that holds the deployment, or as its web page. */
export type FileTarget = { kind: "preview"; hostId: string; path: string } | { kind: "web"; url: string };
/**
 * What Open file opens, decided in one place: the file on the deployment's machine when the
 * kernel names it there and that machine is known, else its web page, else nothing, with why.
 */
export function fileTarget(row: AutomationRow, hostId: string | null, here: Here = HERE): { target: FileTarget | null; title: string } {
  const { localPath, url } = row.origin;
  if (localPath !== null && hostId !== null) return { target: { kind: "preview", hostId, path: localPath }, title: localPath };
  if (url !== null) return { target: { kind: "web", url }, title: url };
  return {
    target: null,
    title: localPath !== null ? "The machine that holds this deployment did not answer, so its file cannot be opened from here" : `${here.name} has no clone of this member, and the kernel reports no web address for the file`,
  };
}

// ---- the acts ----
/**
 * What a run now did, in the Desktop's words (views/schedules.mjs scheduleOutcome): the outcome.
 * The Desktop joins the kernel's error and reason to it in one line; here they are lines of their
 * own (`runWhy`), filtered apart from it.
 */
const RUN_OUTCOMES: Record<string, string> = {
  launched: "Agent launched",
  active: "Agent active",
  running: "Agent active",
  ended: "Run ended",
  stopped: "Agent stopped — needs attention",
  unknown: "Launch state unknown — needs attention",
  "launch-failed": "Launch failed",
  skipped: "Skipped",
  delivered: "Wake message delivered",
};
export const scheduleOutcome = (run: AutomationRun | null): string => (run === null ? "Not run yet" : ((run.outcome !== null ? RUN_OUTCOMES[run.outcome] : undefined) ?? run.outcome ?? "Attempt recorded"));
/** The kernel's own words on a run that did not go as asked: its error, then its reason. Drawn apart from the outcome, so one that is withheld leaves the outcome said. */
export const runWhy = (run: AutomationRun | null): string[] => (run === null ? [] : [run.error, run.reason].filter((line): line is string => line !== null && line !== ""));
/** Whether a run now went through, did not, or left a state nobody knows. */
export const runTone = (run: AutomationRun | null): "done" | "failed" | "unknown" =>
  run === null || run.outcome === null ? "unknown" : run.outcome === "launch-failed" || run.outcome === "invalid" ? "failed" : run.outcome === "unknown" || run.outcome === "stopped" ? "unknown" : "done";

/** What a row's switch says it does (its title), as the Desktop's. */
export function switchTitle(row: AutomationRow, here: Here = HERE): string {
  if (row.reason === "untrusted") return `${row.enabledHere ? "On" : "Off"} here, but not trusted on ${here.on}: it runs only once oats-local.yaml trusts it`;
  return row.enabledHere ? `On here: click to turn it off on ${here.on}` : "Off here: click to turn it on";
}

/** A one-click test of a trigger that turned out to watch a capability's source: nothing ran. */
export const NOTHING_RAN = "Nothing ran. Testing this trigger runs a capability's source command and needs your confirmation.";
/** A test that found nothing against the row: it would run here; while the host scheduler is off, only once it is on. */
export const testReady = (running: boolean): string => (running ? "Test passed. It would start." : "Test passed. It would start once the scheduler is on.");
/** A test that found something against the row: it started nothing either; what it found follows, one line each. */
export const TEST_FAILED = "Test failed.";
export const TEST_TIMED_OUT = "The test did not answer in time. Nothing was recorded.";
/** What leads a test the kernel refused: a person's words first, the kernel's message after them. */
export const TEST_REFUSED = "The test did not run.";
/** A test whose answer did not arrive whole: its command may have run, so nothing is claimed either way. */
export const TEST_UNREAD = "The test gave no answer the plugin can read.";
/**
 * The title of an act that failed, as what is so: `no` ("… was not run") when the act was REFUSED
 * (the kernel said no, or the plugin's server turned the request down before any process: what
 * acts.tsx's `failureOf` reads from the error), `maybe` ("… may not have been run") for any other
 * failure, since a lost answer says nothing about what the kernel did. One rule for every act.
 */
export type Failed = { no: string; maybe: string };
export const failedTitle = (refused: boolean, failed: Failed): string => (refused ? failed.no : failed.maybe);
/** What leads a summary that failed to save: that it was not saved when it was refused, else that it may not have been. */
export const summaryFailed = (refused: boolean, code: string | null, message: string): string =>
  `${refused ? "The summary was not saved" : "The summary may not have been saved"}: ${message}${code === null ? "" : ` (${code})`}`;
export const NAME_CUT = "The purpose was cut and a hash added so the name fits 64 characters.";

/** A refusal as the server words it, `<code>: <message>`, apart: the message for a person, the code after it. One rule for what a code is (ui/text). */
export function refusalParts(text: string): { code: string | null; message: string } {
  const code = refusalCode(text);
  return code === null ? { code: null, message: text } : { code, message: text.slice(code.length + 2) };
}

// ---- the list's row and the head of an automation's page ----
// In bb's manner (its own Automations page): the name; one short sentence of what it does, where
// someone wrote one; and one small line: when · the machine it runs on · its owner, where the
// kernel gives one · its last run (when, and what came of it), with what is wrong in red and
// "Needs you" where an agent it made asks. No sentence of the page's own.

/** The last part of a home's path: the agent a wake wakes, by the name of its home. */
export const agentOf = (home: string | null): string | null => (home === null ? null : (displayLine(home.replace(/\/+$/, "").split("/").pop()) ?? null));

/** Who a run starts: the soul it spawns, the agent it wakes, "Command", or the operation by its name. */
export function whoWords(row: AutomationRow): string | null {
  if (row.run === "wake") return agentOf(row.home);
  if (row.soul !== null) return displayLine(row.soul.name);
  if (row.run === "command") return "Command";
  if (row.run === "operation") return displayLine(row.operation);
  return null;
}

/** When it runs: a schedule's cadence in words (else its cron), a trigger's event ("On a pull request, acme/app"; "On acme.graph: harvest-branches"). */
export function whenWords(row: AutomationRow): string | null {
  if (row.kind === "schedule") return cronInWords(row.cron) ?? displayLine(row.cron);
  const on = onSummary(row.on);
  if (on === null) return null;
  if (on.source !== null) return `On ${[on.source.capability, on.source.name].filter(Boolean).join(": ") || "a source"}`;
  return row.on?.source === PULL_REQUEST ? ["On a pull request", displayLine(on.repo)].filter(Boolean).join(", ") : `On ${displayLine(row.on?.source) ?? "an event"}`;
}

/** The machine an automation runs on: the one that holds the deployment (by bb's name for it), or the other host the kernel names. Null where it runs nowhere that can be named (a machine with no host name). */
export function runsOnWords(row: AutomationRow, here: Here = HERE): string | null {
  if (row.group === "elsewhere") return row.reason === "assigned-elsewhere" && row.runsOn !== null ? `Runs on ${displayLine(row.runsOn) ?? ""}`.trim() : null;
  return `Runs on ${here.on}`;
}

/** An automation's owner, where the kernel gives one: the account a workspace automation acts as ("@ana"). A local one has none, and none is drawn. */
export function ownerWords(row: AutomationRow): string | null {
  const owner = ownerParts(row.owner);
  return owner !== null ? `@${displayLine(owner.login) ?? ""}` : displayLine(row.owner);
}

/** One part of the small line. `lead` is said plainly before a text that carries a tone ("Last 1 h ago, " before a red "Launch failed"). */
export type LinePart = { text: string; lead?: string; title?: string; tone?: "bad" | "warn" | "ask" };
/** A trigger's state, as much as the row's line reads of it: its last fire, its last poll and its failed spawns. */
export type LineStatus = { fired: readonly { at: string | null; label: string | null }[]; lastPoll: { ok: boolean } | null; lastError: { at: string | null; key: string | null } | null; failures: readonly { at: string | null; resolved: unknown }[] | null };

/** Why a row cannot run on the machine, as a failure: its account, its trust, its definition. Null where nothing stops it. */
function stoppedPart(row: AutomationRow): LinePart | null {
  if (row.unreadable !== null) return { text: "Unreadable", tone: "bad" };
  if (row.invalid !== null && !(row.kind === "trigger" && row.invalid.at !== null)) return { text: "Invalid", tone: "bad" };
  if (row.reason === "owner-mismatch") return { text: "Wrong account", tone: "bad" };
  if (row.reason === "untrusted") return { text: "Not trusted", tone: "bad" };
  if (row.reason === "other") return { text: "Doesn't run here", tone: "bad" };
  return null;
}

const time = (iso: string | null): number => {
  const at = Date.parse(iso ?? "");
  return Number.isFinite(at) ? at : -Infinity;
};
/**
 * Whether the kernel's last error of a trigger is a failed launch that stands, where it keeps no history of failures.
 * Without a history, the kernel's last error is a failed SPAWN only where it names the event it was for (`key`): a failed poll or
 * source check writes the same field with no key, and the kernel never clears it, so a poll that failed once and mended would read
 * as a failed launch until the next fire.
 */
export function launchErrorStands(status: Pick<LineStatus, "lastError" | "fired">): boolean {
  const fired = Math.max(-Infinity, ...status.fired.map((entry) => time(entry.at)));
  return status.lastError !== null && status.lastError.key !== null && time(status.lastError.at) > fired;
}

/**
 * What failed last on a trigger: its failed last poll, or its failed spawn that no later spawn
 * followed (with a failure history: the newest failure, unless resolved; without: the last error
 * of a spawn, unless a fire is newer). A schedule's failure is its last run's outcome, said with the run.
 */
function triggerFailure(row: AutomationRow, status: LineStatus | null): LinePart | null {
  // A capability source's check that failed at a poll: the definition stands, its source no longer answers to it.
  if (row.invalid !== null && row.invalid.at !== null) return { text: "Poll failed", tone: "bad" };
  if (status === null) return null;
  if (status.lastPoll !== null && !status.lastPoll.ok) return { text: "Poll failed", tone: "bad" };
  const fired = Math.max(-Infinity, ...status.fired.map((entry) => time(entry.at)));
  if (status.failures !== null) {
    const newest = status.failures[0];
    return newest !== undefined && newest.resolved === null && time(newest.at) >= fired ? { text: "Launch failed", tone: "bad" } : null;
  }
  return launchErrorStands(status) ? { text: "Launch failed", tone: "bad" } : null;
}

/** A schedule's last run: when, then what came of it in a person's word, red where it did not launch and a warning where nobody knows. Null where it never ran. */
function lastRunPart(row: AutomationRow, now: number): LinePart | null {
  const run = row.lastRun ?? row.recentRuns[0] ?? null;
  if (run === null) return null;
  const at = pastTime(run.startedAt ?? run.scheduledFor ?? run.at, now);
  const tone = runTone(run);
  const word = (run.outcome !== null ? RUN_WORDS[run.outcome] : undefined) ?? displayLine(run.outcome) ?? "Attempt recorded";
  return { lead: at === null ? "Last: " : `Last ${at.label}, `, text: word, ...(at === null ? {} : { title: at.title }), ...(tone === "failed" ? { tone: "bad" as const } : tone === "unknown" ? { tone: "warn" as const } : {}) };
}
/** A trigger's last fire: when, and what fired. Null where it never fired. */
function lastFirePart(row: AutomationRow, status: LineStatus | null, now: number): LinePart | null {
  const last = status?.fired[0] ?? (row.lastRun === null ? null : { at: row.lastRun.at, label: eventLabel(row.lastRun, row.on?.source ?? null) });
  const at = last === null || last === undefined ? null : pastTime(last.at, now);
  return at === null ? null : { text: [`Last ${at.label}`, last?.label ?? null].filter(Boolean).join(", "), title: at.title };
}

/** What is wrong, for the line's end and for the one rule of what is failing: why the row cannot run, else a schedule's failed last run or a trigger's failed poll or spawn. */
function wrongPart(row: AutomationRow, status: LineStatus | null, now = 0): LinePart | null {
  const stopped = stoppedPart(row);
  if (stopped !== null) return stopped;
  if (row.kind === "trigger") return triggerFailure(row, status);
  const last = lastRunPart(row, now);
  return last !== null && last.tone === "bad" ? last : null;
}

/**
 * Whether an automation is FAILING: its small line holds a red part. One half of the one rule of
 * the row's mark, of the filter and its counts, and of the sidebar's dots (the other half:
 * `attention`). A run whose state nobody knows is a warning, not a failure.
 */
export const failing = (row: AutomationRow, status: LineStatus | null): boolean => wrongPart(row, status) !== null;

/** What an automation asks of a person: an agent it made ASKS ("needs"), else something of it failed ("failing"), else nothing. Needs-you comes first. */
export type Attention = "needs" | "failing" | null;
/** The agent of an automation that asks, by its instance; null where none does. The page answers it from the roster. */
export type Asking = (row: AutomationRow) => string | null;
export const attention = (row: AutomationRow, status: LineStatus | null, asking: Asking | undefined): Attention => (asking?.(row) != null ? "needs" : failing(row, status) ? "failing" : null);

/**
 * The small line, part by part (drawn with "·" between): when · the machine it runs on · its
 * owner · its last run or fire · what is wrong · "Needs you". A part with nothing to say is left
 * out. `next`: with the next run after the owner (an automation's own page says it; the list does not).
 */
export function rowLine(row: AutomationRow, status: LineStatus | null, now: number, { here = HERE, asks = false, next = null }: { here?: Here; asks?: boolean; /** whether the host scheduler is on: only the page that says the next run gives it */ next?: { running: boolean } | null } = {}): LinePart[] {
  const parts: LinePart[] = [];
  const add = (text: string | null, more: Omit<LinePart, "text"> = {}) => {
    if (text !== null && text !== "") parts.push({ text, ...more });
  };
  const stopped = stoppedPart(row);
  add(whenWords(row));
  // A row that cannot run on the machine is not said to run on it: why not is said, in red.
  if (stopped === null) add(runsOnWords(row, here));
  add(ownerWords(row));
  if (next !== null && row.kind === "schedule" && stopped === null && row.runsHere && row.enabledHere && next.running) {
    const due = dueWords(row.nextDue, now);
    if (due !== null) add(`${due.word} ${due.label}`, { title: due.title });
  }
  if (stopped !== null) parts.push(stopped);
  else if (row.kind === "schedule") {
    const last = lastRunPart(row, now);
    if (last !== null) parts.push(last);
  } else {
    const last = lastFirePart(row, status, now);
    if (last !== null) parts.push(last);
    const failure = triggerFailure(row, status);
    if (failure !== null) parts.push(failure);
  }
  if (asks) parts.push({ text: "Needs you", tone: "ask" });
  return parts;
}

/** The list's one filter: every row, one kind, what needs a person, or what is failing (the last two cut across the kinds). */
export type ListFilter = "all" | "schedule" | "trigger" | "needs" | "failing";
export const LIST_FILTERS: readonly { id: ListFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "schedule", label: "Schedules" },
  { id: "trigger", label: "Triggers" },
  { id: "needs", label: "Needs you" },
  { id: "failing", label: "Failing" },
];

/** The search over the one list: the name, the id, who it starts, the instruction or message, the summary. */
export function searchRows(rows: readonly AutomationRow[], query: string): AutomationRow[] {
  const needle = query.trim().toLowerCase();
  if (needle === "") return [...rows];
  return rows.filter((row) => [row.name, row.id, whoWords(row), whenWords(row), row.task, row.message, row.description, row.runsOn, row.owner].some((value) => typeof value === "string" && value.toLowerCase().includes(needle)));
}
/** From this many rows the list has a search field (bb's own page has one always; a short list needs none). */
export const SEARCH_FROM = 12;
/** The rows of both lists in the one list's order: what runs on the machine, what needs attention there, what runs elsewhere; in each, schedules then triggers, as the kernel lists them. */
export function oneList(schedules: readonly AutomationRow[], triggers: readonly AutomationRow[]): AutomationRow[] {
  const all = [...schedules, ...triggers];
  return GROUPS.flatMap((group) => all.filter((row) => row.group === group.id));
}
/** A trigger's state among every trigger's, by its id; null for a schedule, and for a trigger whose state was not read. */
export const statusFor = (row: AutomationRow, statuses: readonly { id: string; status: LineStatus }[] | null): LineStatus | null =>
  row.kind === "trigger" ? (statuses?.find((entry) => entry.id === row.id)?.status ?? null) : null;
type Statuses = readonly { id: string; status: LineStatus }[] | null;
/** The list as drawn: what needs a person first, then what is failing, then the rest, each in `oneList`'s order. */
export function inOrder<Row extends AutomationRow>(rows: readonly Row[], statuses: Statuses, asking?: Asking): Row[] {
  const of = (row: Row) => attention(row, statusFor(row, statuses), asking);
  return [...rows.filter((row) => of(row) === "needs"), ...rows.filter((row) => of(row) === "failing"), ...rows.filter((row) => of(row) === null)];
}
/** The rows a filter keeps. "Failing" keeps every failing one, one that also needs a person among them. */
export const filterList = <Row extends AutomationRow>(rows: readonly Row[], filter: ListFilter, statuses: Statuses, asking?: Asking): Row[] =>
  rows.filter((row) => filter === "all" || (filter === "needs" ? asking?.(row) != null : filter === "failing" ? failing(row, statusFor(row, statuses)) : row.kind === filter));

/** The one-line notices above the list. An unnamed machine's says where the key is under its Details. */
export const schedulerOffLine = (here: Here = HERE): string => `The scheduler is off on ${here.on}`;
export const EMPTY = "No automations";
export const NO_MATCH = "No match";


// ---- a run's row (an automation's page, and the Runs tab) ----
/** What a run's mark says: it went through, it did not, nobody knows, it is under way, it waits. Each has its own glyph AND its word beside it: never a colour alone. */
export type RunMark = "done" | "failed" | "unknown" | "running" | "waiting";
/** A run's outcome as a person's word, on a run's row. */
const RUN_WORDS: Record<string, string> = {
  launched: "Agent launched",
  active: "Agent active",
  running: "Agent active",
  ended: "Run ended",
  stopped: "Agent stopped",
  unknown: "Launch state unknown",
  "launch-failed": "Launch failed",
  invalid: "Invalid",
  skipped: "Skipped",
  delivered: "Wake message delivered",
};
export type RunLine = {
  mark: RunMark;
  /** when: its start, else when it was due; a fire's time; when an event was first seen */
  at: string | null;
  /** a trigger's event: "#412 opened" */
  what: string | null;
  /** the outcome's word */
  word: string;
  /** after the word: "attempt 2", "Launched later" */
  notes: string[];
  /** the agent the run made or woke, by its instance's name */
  agent: string | null;
  /** the kernel's own code and message, for the row's fold */
  error: { code: string | null; message: string | null } | null;
};
const what = (label: string | null, event: string | null): string | null => [label, event].filter(Boolean).join(" ") || null;
/** One run as its row says it. */
export function runLine(entry: RunEntry): RunLine {
  const none = { what: null, notes: [], agent: null, error: null };
  if (entry.of === "attempt") return { ...none, mark: entry.running ? "running" : "unknown", at: entry.at, word: entry.running ? "Running" : "Launch state unknown", error: entry.error === null ? null : { code: null, message: entry.error } };
  if (entry.of === "wake") return { ...none, mark: "waiting", at: entry.at, word: "Waiting" };
  if (entry.of === "pending") return { ...none, mark: "waiting", at: entry.at, what: what(entry.pending.label, entry.pending.event), word: "Waiting" };
  if (entry.of === "fired") return { ...none, mark: "done", at: entry.at, what: what(entry.fired.label, entry.fired.event), word: "Agent launched", agent: entry.fired.instance };
  if (entry.of === "failure") {
    const { failure } = entry;
    return {
      mark: "failed",
      at: entry.at,
      what: what(failure.label, failure.event),
      word: "Launch failed",
      notes: [failure.attempt !== null && failure.attempt > 1 ? `attempt ${failure.attempt}` : null, failure.resolved !== null ? "Launched later" : null].filter((note): note is string => note !== null),
      agent: failure.resolved?.instance ?? null,
      error: { code: failure.code, message: failure.message },
    };
  }
  const { run } = entry;
  // A wake held by a claim: the kernel's reason for it, beside a run that is still pending.
  const held = run.reason === "waiting-on-you";
  const tone = runTone(run);
  return {
    ...none,
    mark: held ? "waiting" : tone,
    at: entry.at,
    word: held ? "Held" : ((run.outcome !== null ? RUN_WORDS[run.outcome] : undefined) ?? displayLine(run.outcome) ?? "Attempt recorded"),
    agent: displayLine(run.instance),
    error: run.error === null && run.errorCode === null ? null : { code: displayLine(run.errorCode), message: run.error },
  };
}
/** Whether a run is one the Runs tab's "Failed" keeps. */
export const runFailed = (entry: RunEntry): boolean => runLine(entry).mark === "failed";

/** "Nov 25, 09:00" (this year), else with its year: a run's time, as bb's own Runs table says one. Its title is the whole time. */
export function runWhen(iso: string | null, now: number): { label: string; title: string } | null {
  const at = Date.parse(iso ?? "");
  if (!Number.isFinite(at)) return null;
  const date = new Date(at);
  const sameYear = date.getFullYear() === new Date(now).getFullYear();
  return { label: date.toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", ...(sameYear ? {} : { year: "numeric" }) }), title: date.toLocaleString() };
}

/** Under a Runs table whose automation keeps less than it ran: with the count where the kernel gives one. */
export const earlierNotKept = (count: number | null): string => (count === null ? "Earlier runs are not kept" : `${count} earlier ${count === 1 ? "run is" : "runs are"} not kept`);
export const NO_RUNS = "No runs";
export const OLDER = "Older";
/** How many runs a table shows before "Older", and how many each press adds: an automation's page, and the Runs tab. */
export const RUNS_SHOWN = { page: 10, tab: 50 } as const;
