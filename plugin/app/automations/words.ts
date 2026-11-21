// What the Automations page says about a row, in the Desktop's words (awebai/oats
// packages/desktop/renderer/automation-rows.mjs and views/automations.mjs at a4a43220). Pure
// functions over the rows of contract/automations.ts: no bb and no React import. Nothing here
// derives a placement: the kernel's `runsHere`, `reason` and `enabledHere` are read as given.
import type { AutomationHost, AutomationKind, AutomationList, AutomationOn, AutomationRow, AutomationRun, AutomationScheduler, AutomationSoul } from "../../contract/automations";
import { displayLine, MAX_DISPLAY_LINE } from "../../kernel/automations-display";

export const PULL_REQUEST = "github.pull_request";
export const TITLES: Record<AutomationKind, string> = { schedule: "Schedules", trigger: "Triggers" };
export const NOUNS: Record<AutomationKind, string> = { schedule: "schedule", trigger: "trigger" };

// ---- groups, the filter and the search ----
export const GROUPS = [
  { id: "here", title: "Runs on this computer" },
  { id: "attention", title: "Needs attention here" },
  { id: "elsewhere", title: "Runs elsewhere" },
] as const;

/** The groups in page order, each with its rows; a group with no row is left out. */
export function groupRows(rows: readonly AutomationRow[]) {
  return GROUPS.map((group) => ({ ...group, rows: rows.filter((row) => row.group === group.id) })).filter((group) => group.rows.length > 0);
}

export type OriginFilter = "all" | "workspace" | "local";
export const ORIGIN_FILTERS: readonly { id: OriginFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "workspace", label: "Workspace" },
  { id: "local", label: "Local" },
];

/** The origin filter and the search: the id, the soul, the task or wake message, the summary, where it runs and as whom. */
export function filterRows(rows: readonly AutomationRow[], { origin = "all", query = "" }: { origin?: OriginFilter; query?: string } = {}): AutomationRow[] {
  const needle = query.trim().toLowerCase();
  return rows.filter(
    (row) =>
      (origin === "all" || row.origin.kind === origin) &&
      (needle === "" ||
        [row.id, row.soul?.name, row.task, row.message, row.description, row.runsOn, row.owner].some((value) => typeof value === "string" && value.toLowerCase().includes(needle))),
  );
}

// ---- the summary line ----
const PROMPT_LINE = "No summary set — first line of the prompt";
/**
 * The row's summary: the authored description, else the first non-empty line of what it sends to
 * an agent (a spawn's or a trigger's task, a wake's message), marked derived; else null (a command
 * or an operation: "No summary", never a label made from its argv).
 */
export function summaryLine(row: AutomationRow): { text: string; title: string; derived: boolean } | null {
  if (row.description !== null) return { text: row.description, title: row.description, derived: false };
  const prompt = row.run === "wake" ? row.message : row.run === "spawn" ? row.task : null;
  const first = prompt === null ? undefined : prompt.split(/\r\n|[\n\r\u2028\u2029]/).map((line) => line.trim()).find((line) => line !== "");
  return first === undefined ? null : { text: first, title: PROMPT_LINE, derived: true };
}

// ---- a soul and where it comes from ----
/** A soul's origin in words: the short form under its name, the long form as its title. */
export function soulOriginText(origin: AutomationSoul["origin"]): { short: string; long: string } {
  if (origin === null) return { short: "not found here", long: "This name does not resolve in this workspace (or there is no snapshot yet)" };
  if (origin.kind === "package") return { short: `package ${origin.package ?? ""}`.trim(), long: `A soul of the locked package ${[origin.package, origin.version].filter(Boolean).join(" ")}` };
  if (origin.kind === "member") return { short: origin.member ?? "member", long: `A soul in the member ${origin.member ?? origin.repoKey ?? ""}` };
  if (origin.kind === "external") return { short: "external", long: `An external soul${origin.source !== null ? ` from ${origin.source}` : ""}` };
  if (origin.kind === "ambiguous") return { short: "ambiguous name", long: `${origin.candidates ?? "Several"} souls answer to this name; a spawn needs the qualified name` };
  return { short: origin.kind, long: origin.kind };
}

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
  return { label: unit === null ? (future ? "in under a minute" : "just now") : future ? `in ${unit}` : `${unit} ago`, title: new Date(at).toLocaleString() };
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

/** Who this machine's gh is logged in as on the owner's GitHub host: "github.com/alex", "not logged in", or null when the kernel does not say. */
export function hostLogin(host: AutomationHost, owner: string | null): string | null {
  const parts = ownerParts(owner);
  if (parts === null || !Object.hasOwn(host.ghUser, parts.host)) return null;
  const login = host.ghUser[parts.host];
  return login ? `${parts.host}/${login}` : "not logged in";
}

export type Tone = "ok" | "warn" | "muted";
/** Where a row runs, in words, with the tone of its dot and the detail behind it. */
export function placementText(row: AutomationRow, host: AutomationHost): { label: string; tone: Tone; detail: string | null } {
  if (row.origin.kind === "local") return { label: "This computer", tone: row.enabledHere ? "ok" : "muted", detail: "Local: runs on this computer as its own gh login" };
  if (row.reason === "owner-mismatch") return { label: "Wrong account here", tone: "warn", detail: row.reasonDetail };
  if (row.reason === "untrusted") return { label: "Not trusted here", tone: "warn", detail: row.reasonDetail };
  if (row.reason === "other") return { label: "Doesn't run here", tone: "warn", detail: row.reasonDetail ?? `reason: ${row.reasonCode}` };
  if (row.reason === "host-unnamed") return { label: row.runsOn ?? "Not named", tone: "muted", detail: "This computer has no host name" };
  if (row.reason === "assigned-elsewhere") return { label: row.runsOn ?? "Another host", tone: "muted", detail: row.reasonDetail };
  return { label: "This computer", tone: row.enabledHere ? "ok" : "muted", detail: host.name !== null ? `This computer is ${host.name}` : null };
}

/** Under where it runs: "local", or the account it acts as. */
export function actsAs(row: AutomationRow): string {
  if (row.origin.kind === "local") return "local";
  const owner = ownerParts(row.owner);
  return owner !== null ? `as @${owner.login}` : (row.owner ?? "");
}

// ---- the host scheduler ----
/** Nothing runs unless the host timer is installed, active and registered for this deployment. */
export const schedulerOn = (scheduler: AutomationScheduler): boolean => scheduler.installed && scheduler.active && scheduler.registered !== false;
/** The header's line: "Scheduler on · checked 2 min ago · up to 5 at once", or "Scheduler off". */
export function schedulerLine(scheduler: AutomationScheduler, now: number): string {
  if (!schedulerOn(scheduler)) return "Scheduler off";
  const checked = relativeTime(scheduler.lastTick, now);
  return ["Scheduler on", checked !== null ? `checked ${checked.label}` : null, scheduler.maxConcurrent !== null ? `up to ${scheduler.maxConcurrent} at once` : null].filter(Boolean).join(" · ");
}
export const SCHEDULER_OFF = "The scheduler is not running on this computer, so nothing here runs until it is enabled.";
export const hostUnnamed = (kind: AutomationKind): string =>
  `This computer has no host name, so it runs none of the workspace's ${TITLES[kind].toLowerCase()}. Name it in this deployment's local settings to take on the ones assigned to it.`;
/** The banners a list shows above its rows: this host has no name, and the host timer is off. */
export function listBanners(list: AutomationList): { hostUnnamed: boolean; schedulerOff: boolean } {
  return {
    hostUnnamed: list.host.name === null && list.rows.some((row) => row.reason === "host-unnamed"),
    schedulerOff: list.scheduler !== null && !schedulerOn(list.scheduler) && list.rows.some((row) => row.runsHere),
  };
}

/** The line under a list: how old the workspace's items are, and what a sync could not read. */
export function snapshotLine(list: AutomationList, now: number): string {
  const taken = list.snapshot !== null ? relativeTime(list.snapshot.takenAt, now) : null;
  const title = TITLES[list.kind].toLowerCase();
  return [
    list.snapshot !== null ? `Workspace ${title} as of the last sync${taken !== null ? ` (${taken.label})` : ""}` : "Workspace items appear after the next sync",
    list.snapshot !== null && list.snapshot.problems > 0 ? `${list.snapshot.problems} discovery ${list.snapshot.problems === 1 ? "problem" : "problems"}` : null,
    "Only members you can read in Git contribute.",
  ]
    .filter(Boolean)
    .join(" · ");
}

// ---- last and next ----
/** A run's outcome in the list's words (lower case, after "Last 2 h ago · "). */
const OUTCOMES: Record<string, string> = {
  launched: "agent launched",
  active: "agent active",
  running: "agent active",
  ended: "run ended",
  stopped: "agent stopped",
  unknown: "launch state unknown",
  "launch-failed": "launch failed",
  skipped: "skipped",
  delivered: "wake delivered",
};
export const outcomeWords = (outcome: string | null): string | null => (outcome === null ? null : (OUTCOMES[outcome] ?? outcome));

/** When a run happened: a trigger's fire has `at`, a schedule's run its start, else the minute it was due. */
export const runTime = (run: AutomationRun | null): string | null => run?.at ?? run?.startedAt ?? run?.scheduledFor ?? null;

/** A fire's label from a list row's last run: its subject, else its number, as `#42` for a pull request; else its key. */
export function fireLabel(run: AutomationRun, source: string | null): string | null {
  const name = displayLine(run.subject) ?? (run.number !== null && run.number > 0 ? String(run.number) : null);
  if (name !== null) return source === PULL_REQUEST ? `#${name}` : name;
  return displayLine(run.key);
}

/**
 * The row's last cell: "Next in 5 min" (or "Off here", "Polls at the next tick", "Next not
 * reported") over "Last 2 h ago · agent launched" (or "Not run yet"). Null for a row another
 * computer runs: runs are recorded where they happen.
 */
export function lastNext(row: AutomationRow, now: number): { next: string; nextTitle: string; last: string; lastTitle: string | null } | null {
  if (!row.runsHere && row.group !== "here") return null;
  const next = relativeTime(row.nextDue, now);
  const last = relativeTime(runTime(row.lastRun), now);
  // A trigger that runs here but has not polled yet polls at the next tick (nextDue null).
  const nextText = next !== null ? `Next ${next.label}` : !row.enabledHere ? "Off here" : row.runsHere && row.kind === "trigger" ? "Polls at the next tick" : "Next not reported";
  // A trigger's last fire is named by its event's subject, else its number; a schedule's by its outcome.
  const fired = row.lastRun === null ? null : row.kind === "trigger" ? fireLabel(row.lastRun, row.on?.source ?? null) : row.lastRun.number ? `#${row.lastRun.number}` : null;
  const outcome = outcomeWords(row.lastRun?.outcome ?? null);
  return {
    next: nextText,
    nextTitle: next !== null ? next.title : nextText,
    last: last !== null ? `Last ${last.label}${outcome !== null ? ` · ${outcome}` : fired !== null ? ` · ${fired}` : ""}` : "Not run yet",
    lastTitle: last !== null ? last.title : null,
  };
}

// ---- run state ----
export type RunState = {
  running: { since: string | null } | null;
  unknown: { since: string | null; scheduledFor: string | null; holdsSlot: boolean; exited: boolean | null; exitStatus: number | null; exitSignal: string | null; error: string | null } | null;
  pendingWake: { scheduledFor: string | null } | null;
};
/**
 * A schedule's run state on this computer, from the kernel's row: unknown, running, and a wake
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

// The kernel's own shell-safe word test for a --dir it prints.
const shellWord = (value: string): string => (/^[\w./@%+=:,-]+$/.test(value) ? value : `'${value.replaceAll("'", `'\\''`)}'`);
/** `oats schedule reconcile <qualified id> [--clear] --dir <scope>`: a command that works when pasted. */
export function reconcileCommand(row: AutomationRow, { clear = false }: { clear?: boolean } = {}): string {
  return ["oats schedule reconcile", shellWord(row.id), clear ? "--clear" : null, row.scope !== null ? `--dir ${shellWord(row.scope)}` : null].filter(Boolean).join(" ");
}

// ---- where it comes from ----
/** "oats.okf:proposal-review" for a row's package template. */
export function templateLabel(template: AutomationRow["template"]): string | null {
  if (template === null) return null;
  return [template.package, template.template].filter(Boolean).join(":") || null;
}
/** A package template's provenance in words: "oats.okf:proposal-review v0.4.0 @abc1234", or a workspace trigger's `from:`. */
export function templateProvenance(template: AutomationRow["template"]): string | null {
  if (template === null) return null;
  const label = templateLabel(template) ?? template.from;
  if (label === null) return null;
  return [label, template.version !== null ? `v${template.version.replace(/^v/, "")}` : null, template.commit !== null ? `@${template.commit.slice(0, 7)}` : null].filter(Boolean).join(" ");
}

// ---- the failed-run mark ----
/** The producer's words for a run that did not happen. */
export const FAILED_OUTCOMES: readonly string[] = ["launch-failed", "invalid"];
/** What the mark says, after the row's name: "Automations, a run failed". */
export const FAILED_RUN_TEXT = ", a run failed";
/**
 * Whether a row failed its last run. Only a schedule's can: a trigger's last run records a fire
 * and carries no outcome, and `unknown`, a missing last run and any other word do not mark.
 */
export const lastRunFailed = (row: AutomationRow): boolean => row.kind === "schedule" && row.lastRun !== null && row.lastRun.outcome !== null && FAILED_OUTCOMES.includes(row.lastRun.outcome);
/** How many rows of the lists failed their last run. */
export const failedRuns = (lists: readonly AutomationList[]): number => lists.reduce((sum, list) => sum + list.rows.filter(lastRunFailed).length, 0);
