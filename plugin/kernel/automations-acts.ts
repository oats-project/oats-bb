// Acting on OATS's own schedules and triggers: turn one on or off on this computer, run a
// schedule now, test one, change a local one's summary, delete a local schedule, check a run
// whose state is unknown, and install the host timer. Each is the kernel's own verb with `--json`
// (docs/desktop-cli-api.md "Schedules and triggers"), the argv the Desktop sends
// (awebai/oats packages/client/cli-adapter.mjs at a4a43220: cliAutomation, cliSchedule). An id is
// checked before any process starts; a summary travels as ONE `--description=<text>` element, so
// text that starts with "-" is never read as an option.
import { z } from "zod";
import type { AutomationKind, AutomationRow, AutomationScheduler, AutomationTest, AutomationTestSource, ScheduleReconciled, ScheduleRunReceipt } from "../contract/automations.js";
import { automationRowOf, checkAutomationId, counted, eventLabel, list, record, refusedEvents, runOf, skippedItems, sourceCheck, sourceSays, text, type Json } from "./automations.js";
import { displayLine } from "../app/ui/text.js";
import { DESCRIPTION_RULE, descriptionValid } from "../model/automations.js";
import { shaped } from "./envelope.js";
import { codes, err, ok, type Result } from "./result.js";
import type { Runner } from "./runner.js";

const idArgv = (kind: AutomationKind, words: string[], id: string, tail: string[] = []): Result<string[]> => {
  const checked = checkAutomationId(kind, id);
  return checked.ok ? ok([kind, ...words, checked.value, ...tail, "--json"]) : checked;
};

// ---- on and off, on this computer ----
/** A local item's own `enabled`; a workspace item's entry in this host's `triggers.disabled` or `schedules.disabled`. */
export const enableArgv = (kind: AutomationKind, id: string, enabled: boolean): Result<string[]> => idArgv(kind, [enabled ? "enable" : "disable"], id);

const rowAnswer = { schedule: z.looseObject({ schedule: z.unknown() }), trigger: z.looseObject({ trigger: z.unknown() }) };
/** `{schedule}` or `{trigger}`: the row as it is now. */
export function parseRowAnswer(document: unknown, kind: AutomationKind, what: string): Result<{ row: AutomationRow }> {
  const parsed = shaped(rowAnswer[kind], document, what);
  if (!parsed.ok) return parsed;
  const row = automationRowOf((parsed.value as Json)[kind], kind);
  return row === null ? err(codes.badAnswer, `\`${what}\` answered no ${kind}`) : ok({ row });
}

// ---- run now ----
export const scheduleRunArgv = (id: string): Result<string[]> => idArgv("schedule", ["run"], id);

const runAnswer = z.looseObject({ run: z.unknown().optional(), schedule: z.unknown().optional() });
/**
 * The run `oats schedule run` made. The receipt's own `run` carries an outcome only for some
 * kinds (a launch's has none); the row beside it holds the same run as its last, with the outcome
 * the kernel recorded, so that one is read when it is the same run.
 */
export function parseScheduleRun(document: unknown): Result<ScheduleRunReceipt> {
  const parsed = shaped(runAnswer, document, "oats schedule run");
  if (!parsed.ok) return parsed;
  const run = runOf(parsed.value.run);
  const last = record(parsed.value.schedule) ? runOf(parsed.value.schedule.lastRun) : null;
  const same = run !== null && last !== null && last.startedAt === run.startedAt && last.scheduledFor === run.scheduledFor;
  return ok({ run: run !== null && run.outcome === null && same ? { ...run, outcome: last.outcome } : run });
}

// ---- test ----
/**
 * `runSource` is a person's confirmed press and nothing else: the one thing that lets the kernel
 * run a capability source's command for a test. It is composed here, for a trigger only; without
 * it the kernel runs nothing of a capability and answers E_TRIGGER_SOURCE_RUN.
 */
export function testArgv(kind: AutomationKind, id: string, { runSource = false }: { runSource?: boolean } = {}): Result<string[]> {
  if (runSource && kind !== "trigger") return err(codes.invalidInput, "only a trigger's test can run a capability source");
  return idArgv(kind, ["test"], id, runSource ? ["--run-source"] : []);
}

function testSourceOf(raw: unknown): AutomationTestSource | null {
  if (!record(raw)) return null;
  const base = { capability: displayLine(raw.capability), name: displayLine(raw.name), events: 0, filtered: 0, refused: [], skipped: [], invalid: null, cause: null, error: null, code: null, says: null };
  // Here the kernel sends arrays (a status row's last poll has counts); `filtered` is a count.
  if (raw.ok === true) return { ...base, ok: true, events: list(raw.events).length, filtered: counted(raw.filtered) ? raw.filtered : 0, refused: refusedEvents(raw.invalidEvents), skipped: skippedItems(raw.skipped) };
  if (record(raw.invalid)) return { ...base, ok: false, invalid: sourceCheck(raw.invalid) };
  const error = raw.error;
  return { ...base, ok: false, cause: text(raw.cause), error: displayLine(record(error) ? error.message : error), code: record(error) ? displayLine(error.code) : null, says: sourceSays(raw.source) };
}

/**
 * `oats trigger test --json` or `oats schedule test --json` as one shape for the Test result
 * card. `source`: the row's `on.source`, which decides the `#` of a would-fire label. A
 * capability source's answer (it carries `source`) says what the source did, each would-fire
 * entry's URL (the source's: text, never a link), and its problems without the source's failure,
 * which `source` already says (the kernel lists that message there too); every string of such an
 * answer is one display line.
 */
export function parseTest(document: unknown, kind: AutomationKind, source: string | null): Result<AutomationTest> {
  const answer = kind === "schedule" && record(document) && record(document.test) ? document.test : document;
  if (!record(answer)) return err(codes.badAnswer, `\`oats ${kind} test\` answered a document the plugin cannot read`);
  const ran = kind === "trigger" ? testSourceOf(answer.source) : null;
  const strings = (value: unknown): string[] =>
    list(value)
      .map((entry) => (typeof entry === "string" ? entry : record(entry) ? (text(entry.message) ?? text(entry.code)) : null))
      .filter((entry): entry is string => entry !== null && entry !== "");
  // The source's failure is in `problems` as well, word for word: it is said once, by `source`.
  const failed = record(answer.source) ? answer.source : null;
  const failure = ran !== null && !ran.ok && failed !== null ? ((record(failed.invalid) ? text(failed.invalid.message) : null) ?? (record(failed.error) ? text(failed.error.message) : null)) : null;
  const lines = (value: unknown): string[] =>
    ran === null
      ? strings(value)
      : strings(value)
          .filter((entry) => entry !== failure)
          .map((entry) => displayLine(entry))
          .filter((entry): entry is string => entry !== null);
  const soul = record(answer.soul) ? answer.soul : null;
  return ok({
    ok: answer.ok === true,
    problems: lines(answer.problems),
    warnings: lines(answer.warnings),
    wouldFire: Array.isArray(answer.wouldFire)
      ? answer.wouldFire.flatMap((entry) => {
          const label = eventLabel(entry, source);
          // An entry with nothing to name it by is skipped.
          if (!record(entry) || label === null) return [];
          const instance = displayLine(entry.instance);
          // The kernel says an event is held with its reason (a string); `true` is read as held too.
          const held = entry.held === true || text(entry.held) !== null;
          return [{ key: text(entry.key), label, instance, nameCut: instance !== null && entry.nameCut === true, held, heldReason: displayLine(entry.held), url: ran === null ? null : displayLine(entry.url) }];
        })
      : null,
    nextDue: text(answer.nextDue),
    soul: soul === null ? null : { resolves: soul.resolves !== false, error: (record(soul.error) ? text(soul.error.message) : null) ?? text(soul.error) },
    account: record(answer.gh) ? text(answer.gh.account) : null,
    source: ran,
  });
}

// ---- a summary ----
/** A local item's key: bare or `local/`. A workspace item's summary changes in Git, never here. */
export const automationKeyLocal = (id: string): boolean => !id.includes("/") || id.startsWith("local/");

/** `oats <kind> update <id> --description=<text>`: the summary only, of a local item; sent as typed. */
export function describeArgv(kind: AutomationKind, id: string, description: string): Result<string[]> {
  if (!automationKeyLocal(id)) return err(codes.invalidInput, `${id} is a workspace ${kind}: its summary is changed in its repository`);
  if (!descriptionValid(description)) return err(codes.invalidInput, DESCRIPTION_RULE);
  return idArgv(kind, ["update"], id, [`--description=${description}`]);
}

// ---- delete a local schedule ----
export function scheduleRemoveArgv(id: string): Result<string[]> {
  if (!automationKeyLocal(id)) return err(codes.invalidInput, `${id} is a workspace schedule: it is removed in its repository`);
  return idArgv("schedule", ["remove"], id);
}
const removed = z.looseObject({ removed: z.string() });
export function parseScheduleRemove(document: unknown): Result<{ removed: string }> {
  const parsed = shaped(removed, document, "oats schedule remove");
  return parsed.ok ? ok({ removed: parsed.value.removed }) : parsed;
}

// ---- a run whose state is unknown ----
export const scheduleReconcileArgv = (id: string): Result<string[]> => idArgv("schedule", ["reconcile"], id);
const reconciled = z.looseObject({ reconciled: z.string().nullish(), remedy: z.string().nullish() });
export function parseScheduleReconcile(document: unknown): Result<ScheduleReconciled> {
  const parsed = shaped(reconciled, document, "oats schedule reconcile");
  return parsed.ok ? ok({ reconciled: parsed.value.reconciled ?? null, remedy: parsed.value.remedy ?? null }) : parsed;
}

// ---- the host timer ----
/** `oats schedule host install`: registers this deployment and installs the one timer of this user on this computer (a systemd user timer, or a launchd agent). */
export const hostInstallArgv = (): string[] => ["schedule", "host", "install", "--json"];
const installed = z.looseObject({ scheduler: z.looseObject({ installed: z.boolean().nullish(), active: z.boolean().nullish(), registered: z.boolean().nullish(), lastTick: z.string().nullish(), maxConcurrent: z.number().nullish() }), warnings: z.array(z.unknown()).nullish() });
export function parseHostInstall(document: unknown): Result<{ scheduler: AutomationScheduler; warnings: string[] }> {
  const parsed = shaped(installed, document, "oats schedule host install");
  if (!parsed.ok) return parsed;
  const { scheduler, warnings } = parsed.value;
  return ok({
    scheduler: {
      installed: scheduler.installed === true,
      active: scheduler.active === true,
      registered: scheduler.registered ?? null,
      lastTick: scheduler.lastTick ?? null,
      maxConcurrent: Number.isInteger(scheduler.maxConcurrent) ? (scheduler.maxConcurrent as number) : null,
    },
    warnings: (warnings ?? []).map((warning) => (typeof warning === "string" ? warning : record(warning) ? (text(warning.message) ?? text(warning.code)) : null)).filter((warning): warning is string => warning !== null),
  });
}

/** The acts' commands. */
export const verbs = (oats: Runner) => ({
  automationEnable: (kind: AutomationKind, id: string, enabled: boolean, signal?: AbortSignal): Promise<Result<{ row: AutomationRow }>> =>
    oats.run(enableArgv(kind, id, enabled), (document) => parseRowAnswer(document, kind, `oats ${kind} ${enabled ? "enable" : "disable"}`), oats.timeouts.act, signal),
  /** A run launches what the schedule launches: a spawn's own hooks can take minutes. */
  scheduleRun: (id: string, signal?: AbortSignal): Promise<Result<ScheduleRunReceipt>> => oats.run(scheduleRunArgv(id), parseScheduleRun, oats.timeouts.long, signal),
  /** The kernel gives a test's own checks a preview's time; a capability source's command gets 30 s of it. */
  automationTest: (kind: AutomationKind, id: string, options: { source: string | null; runSource: boolean }, signal?: AbortSignal): Promise<Result<AutomationTest>> =>
    oats.run(testArgv(kind, id, { runSource: options.runSource }), (document) => parseTest(document, kind, options.source), oats.timeouts.preview, signal),
  automationDescribe: (kind: AutomationKind, id: string, description: string, signal?: AbortSignal): Promise<Result<{ row: AutomationRow }>> =>
    oats.run(describeArgv(kind, id, description), (document) => parseRowAnswer(document, kind, `oats ${kind} update`), oats.timeouts.act, signal),
  scheduleRemove: (id: string, signal?: AbortSignal): Promise<Result<{ removed: string }>> => oats.run(scheduleRemoveArgv(id), parseScheduleRemove, oats.timeouts.act, signal),
  scheduleReconcile: (id: string, signal?: AbortSignal): Promise<Result<ScheduleReconciled>> => oats.run(scheduleReconcileArgv(id), parseScheduleReconcile, oats.timeouts.act, signal),
  schedulerEnable: (signal?: AbortSignal): Promise<Result<{ scheduler: AutomationScheduler; warnings: string[] }>> => oats.run(hostInstallArgv(), parseHostInstall, oats.timeouts.act, signal),
});

export { descriptionValid };
