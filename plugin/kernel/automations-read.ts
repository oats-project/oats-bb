// OATS's own schedules and triggers, read: `oats schedule list`, `oats trigger list` and
// `oats trigger status <id>` (docs/desktop-cli-api.md "Schedules and triggers"), each read into
// the rows the Automations page draws. This is the one adapter from the kernel's answers to those
// rows, as the Desktop's is (awebai/oats packages/desktop/renderer/automation-rows.mjs at
// a4a43220): the kernel places every row (runsHere, reason, enabledHere), and this module only
// reads those facts. An unknown or missing fact stays null; nothing is guessed. One row the
// plugin cannot read never fails the others.
import { z } from "zod";
import { SCHEDULE_ID, TRIGGER_ID } from "../contract/automations.js";
import type {
  AutomationGroup,
  AutomationKind,
  AutomationList,
  AutomationOn,
  AutomationOrigin,
  AutomationProblem,
  AutomationRow,
  AutomationRun,
  AutomationSoul,
  TriggerStatus,
} from "../contract/automations.js";
import { displayLine } from "../model/text.js";
import { eventLabel, eventWords, PULL_REQUEST } from "../model/automations.js";
import { shaped } from "./envelope.js";
import { codes, err, ok, type Result } from "./result.js";
import type { Runner } from "./runner.js";

export type Json = Record<string, unknown>;
export const record = (value: unknown): value is Json => typeof value === "object" && value !== null && !Array.isArray(value);
export const text = (value: unknown): string | null => (typeof value === "string" && value !== "" ? value : null);
export const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const integer = (value: unknown): number | null => (Number.isInteger(value) ? (value as number) : null);
export const counted = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0;

// ---- the ids an act may name ----
// The kernel's grammar for an id (contract/automations.ts: TRIGGER_ID, SCHEDULE_ID). Neither part
// can start with "-", so an id is never read as an option.
/** `id` as one argv element, or the refusal: no process starts for an id that is not one. */
export function checkAutomationId(kind: AutomationKind, id: string): Result<string> {
  return (kind === "schedule" ? SCHEDULE_ID : TRIGGER_ID).test(id) ? ok(id) : err(codes.invalidInput, `"${id}" is not the id of a ${kind}`);
}

// ---- argv ----
export const scheduleListArgv = (): string[] => ["schedule", "list", "--json"];
export const triggerListArgv = (): string[] => ["trigger", "list", "--json"];
export function triggerStatusArgv(id: string): Result<string[]> {
  const checked = checkAutomationId("trigger", id);
  return checked.ok ? ok(["trigger", "status", checked.value, "--json"]) : checked;
}

// ---- a row ----
const REASONS = new Set(["host-unnamed", "assigned-elsewhere", "owner-mismatch", "untrusted"]);

/**
 * Which group a row belongs to, from the kernel's placement. here: the machine runs it, or
 * would but it is off here. attention: named for the machine but it cannot run (owner-mismatch,
 * untrusted), a reason this plugin does not know, or a definition placed here that is invalid or
 * unreadable. elsewhere: another host, or this host has no name.
 */
export function automationGroupOf(row: Pick<AutomationRow, "reason" | "invalid" | "unreadable">): AutomationGroup {
  if (row.reason === "assigned-elsewhere" || row.reason === "host-unnamed") return "elsewhere";
  if (row.reason === "owner-mismatch" || row.reason === "untrusted" || row.reason === "other") return "attention";
  if (row.invalid !== null || row.unreadable !== null) return "attention";
  return "here";
}

const webUrl = (value: unknown): string | null => (typeof value === "string" && /^https:\/\//.test(value) ? value : null);

function originOf(raw: unknown, qualifiedId: string): AutomationOrigin {
  const origin = record(raw) ? raw : {};
  if (origin.kind === "workspace") {
    const member = qualifiedId.includes("/") ? qualifiedId.slice(0, qualifiedId.indexOf("/")) : null;
    return {
      kind: "workspace",
      member: member !== null && member !== "local" ? member : null,
      repoKey: text(origin.repoKey),
      path: text(origin.path),
      commit: text(origin.commit),
      url: webUrl(origin.url),
      localPath: text(origin.localPath),
    };
  }
  return { kind: "local", member: null, repoKey: null, path: text(origin.path), commit: null, url: null, localPath: text(origin.localPath) };
}

function soulOf(raw: unknown): AutomationSoul | null {
  if (!record(raw)) return null;
  const name = text(raw.name);
  if (name === null) return null;
  const origin = record(raw.origin) ? raw.origin : null;
  const kind = origin === null ? null : text(origin.kind);
  return {
    name,
    origin:
      origin === null || kind === null
        ? null
        : { kind, package: text(origin.package), version: text(origin.version), member: text(origin.member), repoKey: text(origin.repoKey), source: text(origin.source), candidates: integer(origin.candidates) },
  };
}

/** A run's error, as the kernel recorded it: its words, or the message of an error object. */
const errorText = (value: unknown): string | null => text(value) ?? (record(value) ? text(value.message) : null);

export function runOf(raw: unknown): AutomationRun | null {
  if (!record(raw)) return null;
  return {
    at: text(raw.at),
    startedAt: text(raw.startedAt),
    scheduledFor: text(raw.scheduledFor),
    outcome: text(raw.outcome),
    error: errorText(raw.error),
    errorCode: text(raw.errorCode),
    reason: text(raw.reason),
    event: text(raw.event),
    number: integer(raw.number),
    subject: text(raw.subject),
    key: text(raw.key),
    instance: text(raw.instance),
  };
}

function onOf(raw: unknown): AutomationOn | null {
  if (!record(raw)) return null;
  const strings = (value: unknown): string[] => list(value).filter((entry): entry is string => text(entry) !== null);
  return {
    source: text(raw.source),
    repo: text(raw.repo),
    events: strings(raw.events),
    labels: strings(raw.labels),
    base: text(raw.base),
    poll: text(raw.poll),
    params: record(raw.params) ? Object.entries(raw.params).map(([name, value]) => ({ name, value: typeof value === "string" ? value : null })) : [],
  };
}

function problemOf(raw: unknown): AutomationProblem | null {
  if (!record(raw)) return null;
  const at = text(raw.at);
  return { code: text(raw.code), message: text(raw.message), field: text(raw.field), at: at !== null && Number.isFinite(Date.parse(at)) ? at : null };
}

/** One kernel row as the page's row, or null for something that is no row (it has no id). */
export function automationRowOf(raw: unknown, kind: AutomationKind): AutomationRow | null {
  if (!record(raw)) return null;
  const id = text(raw.qualifiedId) ?? text(raw.id);
  if (id === null) return null;
  // A spawn's own settings: a schedule's are top-level, a trigger's sit under `spawn`.
  const spawn = kind === "trigger" ? (record(raw.spawn) ? raw.spawn : {}) : raw;
  const reason = text(raw.reason);
  const wake = kind === "schedule" && record(raw.wake) ? raw.wake : null;
  const wakeCron = wake === null ? null : text(wake.cron);
  const attempt = record(raw.attempt) ? raw.attempt : null;
  const concurrency = record(raw.concurrency) ? raw.concurrency : null;
  const template = record(raw.template) ? raw.template : null;
  const row: Omit<AutomationRow, "group"> = {
    kind,
    run: kind === "schedule" ? text(raw.kind) : "spawn",
    id,
    name: text(raw.name) ?? id.split("/").pop() ?? id,
    origin: originOf(raw.origin, id),
    description: text(raw.description),
    owner: text(raw.owner),
    runsOn: text(raw.runsOn),
    runsHere: raw.runsHere === true,
    reason: reason === null ? null : REASONS.has(reason) ? (reason as AutomationRow["reason"]) : "other",
    reasonDetail: text(raw.reasonDetail),
    reasonCode: reason !== null && !REASONS.has(reason) ? reason.slice(0, 64) : null,
    enabledHere: raw.enabledHere !== false,
    enabled: raw.enabled !== false,
    soul: soulOf(raw.soul),
    task: text(raw.task),
    message: text(raw.message),
    home: text(raw.home),
    operation: text(raw.operation),
    cwd: text(raw.cwd),
    argv: Array.isArray(raw.argv) && raw.argv.every((word) => typeof word === "string") ? (raw.argv as string[]) : null,
    purpose: text(spawn.purpose),
    backend: text(spawn.backend),
    yolo: typeof spawn.yolo === "boolean" ? spawn.yolo : null,
    wake: wake !== null && wakeCron !== null ? { cron: wakeCron, tz: text(wake.tz), message: text(wake.message) } : null,
    running: raw.running === true,
    attempt:
      attempt === null
        ? null
        : {
            scheduledFor: text(attempt.scheduledFor),
            startedAt: text(attempt.startedAt),
            error: text(attempt.error),
            exited: attempt.exited === true ? true : null,
            exitStatus: integer(attempt.exitStatus),
            exitSignal: text(attempt.exitSignal),
          },
    pendingWake: record(raw.pendingWake) ? { scheduledFor: text(raw.pendingWake.scheduledFor) } : null,
    scope: text(raw.scope),
    createdAt: text(raw.createdAt),
    updatedAt: text(raw.updatedAt),
    cron: kind === "schedule" ? text(raw.cron) : null,
    tz: kind === "schedule" ? text(raw.tz) : null,
    teams: list(raw.teams).filter((team): team is string => text(team) !== null),
    launchConfig: text(raw.launchConfig) ?? text(spawn.launchConfig),
    harness: text(raw.harness),
    model: text(raw.model),
    concurrency: concurrency === null ? null : { max: integer(concurrency.max), perKey: integer(concurrency.perKey) },
    template:
      template === null
        ? null
        : { package: text(template.package), template: text(template.template) ?? text(template.id), from: text(template.from), version: text(template.version), commit: text(template.commit) },
    on: kind === "trigger" ? onOf(raw.on) : null,
    lastRun: runOf(raw.lastRun),
    nextDue: text(raw.nextDue),
    recentRuns: list(raw.recentRuns)
      .map(runOf)
      .filter((run): run is AutomationRun => run !== null),
    invalid: problemOf(raw.invalid),
    unreadable: problemOf(raw.unreadable),
  };
  return { ...row, group: automationGroupOf(row) };
}

// ---- a list ----
const scheduleList = z.looseObject({ schedules: z.array(z.unknown()) });
const triggerList = z.looseObject({ triggers: z.array(z.unknown()) });

function listOf(document: Json, raws: unknown[], kind: AutomationKind): AutomationList {
  const host = record(document.host) ? document.host : {};
  const logins = record(host.ghUser) ? host.ghUser : {};
  const snapshot = record(document.snapshot) ? document.snapshot : null;
  const scheduler = record(document.scheduler) ? document.scheduler : null;
  return {
    kind,
    host: { name: text(host.name), ghUser: Object.fromEntries(Object.entries(logins).map(([ghHost, login]) => [ghHost, text(login)])) },
    scheduler:
      scheduler === null
        ? null
        : {
            installed: scheduler.installed === true,
            active: scheduler.active === true,
            registered: typeof scheduler.registered === "boolean" ? scheduler.registered : null,
            lastTick: text(scheduler.lastTick),
            maxConcurrent: integer(scheduler.maxConcurrent),
          },
    snapshot: snapshot === null ? null : { takenAt: text(snapshot.takenAt), problems: integer(snapshot.problems) ?? list(snapshot.problems).length },
    rows: raws.map((raw) => automationRowOf(raw, kind)).filter((row): row is AutomationRow => row !== null),
  };
}

/** `oats schedule list --json`: this machine's local schedules and every workspace one of a readable member. */
export function parseScheduleList(document: unknown): Result<AutomationList> {
  const parsed = shaped(scheduleList, document, "oats schedule list");
  return parsed.ok ? ok(listOf(parsed.value, parsed.value.schedules, "schedule")) : parsed;
}

/** `oats trigger list --json`: the same, for triggers. The two lists stay separate. */
export function parseTriggerList(document: unknown): Result<AutomationList> {
  const parsed = shaped(triggerList, document, "oats trigger list");
  return parsed.ok ? ok(listOf(parsed.value, parsed.value.triggers, "trigger")) : parsed;
}

// ---- a trigger's recorded state ----

/** What a trigger source itself said (`source: { code, message? }` of a failed poll): its own, untrusted words. */
export function sourceSays(raw: unknown): { code: string | null; message: string | null } | null {
  if (!record(raw)) return null;
  const says = { code: displayLine(raw.code), message: displayLine(raw.message) };
  return says.code !== null || says.message !== null ? says : null;
}
export const refusedEvents = (value: unknown) =>
  list(value)
    .filter(record)
    .map((entry) => ({ text: displayLine(entry.text), rule: displayLine(entry.rule) }))
    .filter((entry) => entry.text !== null || entry.rule !== null);
export const skippedItems = (value: unknown) =>
  list(value)
    .filter(record)
    .map((entry) => ({ subject: displayLine(entry.subject), why: displayLine(entry.why) }))
    .filter((entry) => entry.subject !== null || entry.why !== null);
/** A failed meaning check, as display lines. `at` is null unless it is a time. */
export function sourceCheck(raw: unknown): AutomationProblem | null {
  const problem = problemOf(raw);
  return problem === null ? null : { code: displayLine(problem.code), message: displayLine(problem.message), field: displayLine(problem.field), at: problem.at };
}

function lastPollOf(raw: unknown): TriggerStatus["lastPoll"] {
  if (!record(raw)) return null;
  const at = text(raw.at);
  if (at === null || !Number.isFinite(Date.parse(at))) return null;
  const none = { prs: null, matching: null, events: null, filtered: null, skipped: null, refused: null, error: null, cause: null, says: null };
  const n = (value: unknown): number => (counted(value) ? value : 0);
  if (raw.ok === true) {
    if (counted(raw.prs) && counted(raw.matching)) return { ...none, at, ok: true, prs: raw.prs, matching: raw.matching };
    // A capability source's: four counts; one the kernel does not send counts 0.
    return counted(raw.events) ? { ...none, at, ok: true, events: raw.events, filtered: n(raw.filtered), skipped: n(raw.skipped), refused: n(raw.invalidEvents) } : null;
  }
  if (raw.ok !== false) return null;
  const error = raw.error;
  return {
    ...none,
    at,
    ok: false,
    error: displayLine(typeof error === "string" ? error : record(error) ? error.message : null) ?? (record(error) ? displayLine(error.code) : null),
    cause: text(raw.cause),
    says: sourceSays(raw.source),
  };
}

/** The time an event was observed, for sorting: one that cannot be read sorts last. */
const observed = (entry: { observedAt: string | null }): number => {
  const at = Date.parse(entry.observedAt ?? "");
  return Number.isFinite(at) ? at : -Infinity;
};

const statusDocument = z.looseObject({ triggers: z.array(z.unknown()) });

/**
 * One trigger's row of `oats trigger status --json` as the detail page's history: what fired,
 * what is live, what waits (newest observed first), the last poll and the last error. Every
 * kernel string is one display line and every malformed entry is skipped. `source` (the list
 * row's `on.source`) decides the `#` of a label. A capability source's row (it carries `source`)
 * adds the source as the kernel names it, the events OATS refused and the items the source
 * skipped at its last good poll, and a failed check.
 */
export function parseTriggerStatus(document: unknown, id: string, source: string | null): Result<TriggerStatus> {
  const parsed = shaped(statusDocument, document, "oats trigger status");
  if (!parsed.ok) return parsed;
  const row = parsed.value.triggers.find((entry): entry is Json => record(entry) && (entry.id === id || entry.qualifiedId === id));
  if (row === undefined) return err(codes.badAnswer, `\`oats trigger status\` answered no row for ${id}`);
  const named = record(row.source) ? { capability: displayLine(row.source.capability), name: displayLine(row.source.name) } : null;
  const lastError = record(row.lastError) ? row.lastError : null;
  const error =
    lastError === null
      ? null
      : { at: text(lastError.at), code: displayLine(lastError.code), message: displayLine(lastError.message), key: text(lastError.key), says: named === null ? null : sourceSays(lastError.source) };
  const concurrency = record(row.concurrency) ? row.concurrency : null;
  return ok({
    fired: list(row.fired)
      .filter(record)
      .map((entry) => ({ key: text(entry.key), at: text(entry.at), outcome: text(entry.outcome), event: eventWords(entry.event), label: eventLabel(entry, source), instance: displayLine(entry.instance) })),
    firedTotal: integer(row.firedTotal),
    live: list(row.live)
      .filter(record)
      .map((entry) => ({ instance: displayLine(entry.instance), label: eventLabel(entry, source), event: eventWords(entry.event) }))
      .filter((entry) => entry.instance !== null || entry.label !== null),
    liveCount: integer(row.liveCount),
    max: concurrency === null ? null : integer(concurrency.max),
    pending: list(row.pending)
      .filter(record)
      .map((entry) => ({ key: text(entry.key), label: eventLabel(entry, source), event: eventWords(entry.event), observedAt: text(entry.observedAt) }))
      .filter((entry) => entry.label !== null)
      .sort((a, b) => observed(b) - observed(a) || 0),
    lastPoll: lastPollOf(row.lastPoll),
    lastError: error !== null && (error.code !== null || error.message !== null) ? error : null,
    source: named,
    refused: named === null ? [] : refusedEvents(row.invalidEvents),
    skipped: named === null ? [] : skippedItems(row.skipped),
    invalid: named === null ? null : sourceCheck(row.invalid),
  });
}

/** The reads' commands. */
export const verbs = (oats: Runner) => ({
  scheduleList: (signal?: AbortSignal): Promise<Result<AutomationList>> => oats.run(scheduleListArgv(), parseScheduleList, oats.timeouts.read, signal),
  triggerList: (signal?: AbortSignal): Promise<Result<AutomationList>> => oats.run(triggerListArgv(), parseTriggerList, oats.timeouts.read, signal),
  triggerStatus: (id: string, source: string | null, signal?: AbortSignal): Promise<Result<TriggerStatus>> =>
    oats.run(triggerStatusArgv(id), (document) => parseTriggerStatus(document, id, source), oats.timeouts.read, signal),
});

export { eventLabel, eventWords, PULL_REQUEST };
