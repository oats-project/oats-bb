// Creating and editing OATS's own local schedules, and the recurring wake-up a spawn can ask for.
// A definition travels as ONE argv element, `--spec-json=<json>` (`oats schedule add|update`,
// docs/desktop-cli-api.md): no file is written, and JSON that starts with "{" is never read as an
// option. What Edit starts from is the kernel's own `oats schedule show`, read back into exactly
// what the form can keep (the Desktop's scheduleDraft, awebai/oats
// packages/desktop/renderer/schedule-read-data.mjs at a4a43220): a definition with anything more
// is not a draft, so the form never replaces what it could not show.
import type { AutomationRow, HomeOperation, ScheduleDraft, ScheduleSpec, Wake } from "../contract/automations.js";
import { SCHEDULE_NAME } from "../contract/automations.js";
import { DESCRIPTION_RULE, descriptionValid, HARNESSES } from "../model/automations.js";
import { checkAutomationId, list, record, text, type Json } from "./automations.js";
import { automationKeyLocal, parseRowAnswer } from "./automations-acts.js";
import { shaped } from "./envelope.js";
import { codes, err, ok, type Result } from "./result.js";
import type { Runner } from "./runner.js";
import { z } from "zod";

// ---- save ----
const specElement = (spec: ScheduleSpec): Result<string> =>
  spec.description !== undefined && !descriptionValid(spec.description) ? err(codes.invalidInput, DESCRIPTION_RULE) : ok(`--spec-json=${JSON.stringify(spec)}`);

/** `oats schedule add <name> --spec-json=<json> --json`: a new local schedule. */
export function scheduleAddArgv(id: string, spec: ScheduleSpec): Result<string[]> {
  if (!SCHEDULE_NAME.test(id)) return err(codes.invalidInput, `"${id}" is not a schedule's name: lower-case letters, digits and "-", up to 100 characters`);
  const element = specElement(spec);
  return element.ok ? ok(["schedule", "add", id, element.value, "--json"]) : element;
}
/** `oats schedule update <id> --spec-json=<json> --json`: a local schedule's whole definition, replaced. */
export function scheduleUpdateArgv(id: string, spec: ScheduleSpec): Result<string[]> {
  if (!automationKeyLocal(id)) return err(codes.invalidInput, `${id} is a workspace schedule, defined in Git: it is changed there`);
  const checked = checkAutomationId("schedule", id);
  if (!checked.ok) return checked;
  const element = specElement(spec);
  return element.ok ? ok(["schedule", "update", checked.value, element.value, "--json"]) : element;
}

// ---- what Edit starts from ----
export const scheduleShowArgv = (id: string): Result<string[]> => {
  const checked = checkAutomationId("schedule", id);
  return checked.ok ? ok(["schedule", "show", checked.value, "--json"]) : checked;
};

// What `oats schedule show` adds to the stored definition: the row's own facts (the Desktop's
// automation-rows.mjs ROW_ONLY), and the facts it prints as null where the definition has none.
const ROW_ONLY = ["qualifiedId", "name", "origin", "owner", "runsOn", "runsHere", "reason", "reasonDetail", "enabledHere", "soul", "teams", "concurrency", "nextDue", "invalid"];
const ROW_NULLABLE = ["description", "task", "harness", "model", "launchConfig"];
// What the kernel reports of any schedule beside its definition.
const REPORTED = ["id", "kind", "cron", "tz", "enabled", "description", "createdAt", "updatedAt", "scope", "scheduleApi", "scheduleHistoryApi", "executionStatus", "nextRun", "lastRun", "history", "recentRuns", "running", "attempt", "pendingWake"];
// A definition with one of these runs under a policy the form does not show: not editable here.
const POLICY = ["definitionVersion", "recurrencePolicy", "execution", "preparation", "executionBinding", "responsibleHuman"];
const OWN: Record<ScheduleSpec["kind"], string[]> = {
  spawn: ["agent", "agentsRoot", "repo", "task", "harness", "runtime", "model", "backend", "purpose", "yolo", "wake"],
  wake: ["home", "message"],
  operation: ["home", "operation"],
};
const kept = (value: unknown): value is string => typeof value === "string" && value.length <= 1_048_576 && !value.includes("\0");
const filled = (value: unknown): value is string => kept(value) && value.trim() !== "";
const has = (object: Json, key: string): boolean => Object.hasOwn(object, key);

/**
 * A stored definition as the form's exact inputs, or null when the form could not keep it whole:
 * another kind (a command), a key the form does not make, a policy, a harness or a session backend
 * it does not offer. Nothing is trimmed, defaulted or dropped. `backends`: the session backends the
 * form offers for this schedule's soul.
 */
export function scheduleDraftOf(shown: unknown, backends: readonly string[]): ScheduleDraft | null {
  if (!record(shown)) return null;
  const v: Json = {};
  for (const [key, value] of Object.entries(shown)) if (!ROW_ONLY.includes(key) && !(ROW_NULLABLE.includes(key) && value === null)) v[key] = value;
  const kind = v.kind;
  if (kind !== "spawn" && kind !== "wake" && kind !== "operation") return null;
  if (POLICY.some((key) => has(v, key)) || typeof v.id !== "string" || !filled(v.cron) || !filled(v.tz) || typeof v.enabled !== "boolean") return null;
  if (Object.keys(v).some((key) => !REPORTED.includes(key) && !OWN[kind].includes(key))) return null;
  const when: { cron: string; tz: string; enabled: boolean; description?: string } = { cron: v.cron, tz: v.tz, enabled: v.enabled };
  if (has(v, "description")) {
    if (typeof v.description !== "string" || v.description === "" || !descriptionValid(v.description)) return null;
    when.description = v.description;
  }
  if (kind === "wake") return filled(v.home) && filled(v.message) ? { id: v.id, spec: { kind, ...when, home: v.home, message: v.message } } : null;
  if (kind === "operation") return filled(v.home) && filled(v.operation) ? { id: v.id, spec: { kind, ...when, home: v.home, operation: v.operation } } : null;
  if (!filled(v.agent) || !filled(v.task)) return null;
  // A stored job's harness is `harness`, or `runtime` from a kernel before 0.27: never both.
  if (has(v, "harness") && has(v, "runtime")) return null;
  const spec: Extract<ScheduleSpec, { kind: "spawn" }> = { kind, ...when, agent: v.agent, task: v.task };
  for (const key of ["repo", "agentsRoot", "model", "backend", "purpose"] as const) {
    if (!has(v, key)) continue;
    const value = v[key];
    if (!kept(value)) return null;
    spec[key] = value;
  }
  const harness = has(v, "harness") ? v.harness : has(v, "runtime") ? v.runtime : undefined;
  if (harness !== undefined) {
    if (!kept(harness)) return null;
    spec.harness = harness;
  }
  if (has(v, "yolo")) {
    if (typeof v.yolo !== "boolean") return null;
    spec.yolo = v.yolo;
  }
  if (has(v, "wake")) {
    const wake = v.wake;
    if (!record(wake) || Object.keys(wake).some((key) => !["cron", "tz", "message"].includes(key)) || !filled(wake.cron) || !filled(wake.tz) || !filled(wake.message)) return null;
    spec.wake = { cron: wake.cron, tz: wake.tz, message: wake.message };
  }
  // The form cannot keep a choice it does not offer: a harness it does not list, a backend the kernel does not list for this soul.
  if ((spec.harness !== undefined && spec.harness !== "" && !HARNESSES.includes(spec.harness)) || (spec.backend !== undefined && spec.backend !== "" && !backends.includes(spec.backend))) return null;
  return { id: v.id, spec };
}

const shownSchedule = z.looseObject({ schedule: z.unknown() });
/** The stored definition `oats schedule show` printed: what a draft is read from. */
export function parseScheduleShow(document: unknown): Result<unknown> {
  const parsed = shaped(shownSchedule, document, "oats schedule show");
  return parsed.ok ? ok(parsed.value.schedule) : parsed;
}

// ---- the session backends a soul can launch on ----
export const inspectSoulArgv = (soul: string): string[] => ["inspect", "--soul", soul, "--json"];
// A provider's name as the kernel's contract allows it; "tmux" is the kernel's own, and "herdr" was removed.
const PROVIDER_NAME = /^[a-z0-9][a-z0-9-]{0,39}$/;
const inspection = z.looseObject({ sessionProviders: z.unknown().optional(), capabilities: z.unknown().optional() });
/** The session providers an inspection lists, each once, in its order. */
export function parseSessionProviders(document: unknown): Result<{ backends: string[] }> {
  const parsed = shaped(inspection, document, "oats inspect");
  if (!parsed.ok) return parsed;
  const names = list(parsed.value.sessionProviders)
    .map((row) => (record(row) ? row.name : null))
    .filter((name): name is string => typeof name === "string" && name !== "tmux" && name !== "herdr" && name !== "session-provider" && PROVIDER_NAME.test(name));
  return ok({ backends: [...new Set(names)] });
}

// ---- the provider operations a schedule can run in a home ----
export const inspectHomeArgv = (home: string): string[] => ["inspect", "--home", home, "--json"];
/**
 * The operations of a home a schedule can run by itself: an action of a capability that fills a
 * layer, available, with no argument a person would have to give (the Desktop's rule,
 * views/schedules.mjs loadOperations). Its address is `<layer>:<operation>`.
 */
export function parseHomeOperations(document: unknown): Result<{ operations: HomeOperation[] }> {
  const parsed = shaped(inspection, document, "oats inspect");
  if (!parsed.ok) return parsed;
  const operations: HomeOperation[] = [];
  for (const capability of list(parsed.value.capabilities)) {
    if (!record(capability)) continue;
    const layer = text(capability.layer);
    if (layer === null) continue;
    for (const operation of list(capability.operations)) {
      if (!record(operation) || operation.kind !== "action" || operation.available !== true) continue;
      const name = text(operation.name);
      if (name === null || list(operation.args).some((arg) => record(arg) && arg.required === true)) continue;
      operations.push({ address: `${layer}:${name}`, label: `${layer}: ${name} — ${text(operation.description) ?? text(capability.id) ?? layer}` });
    }
  }
  return ok({ operations });
}

// ---- a recurring wake-up asked at spawn ----
/** What `oats spawn` takes for it: ONE element, `--wake-json=<{cron, tz, message, enabled}>`. The kernel saves the wake schedule after the spawn, bound to the new home. */
export const wakeArgv = (wake: Wake): string[] => [`--wake-json=${JSON.stringify({ cron: wake.cron, tz: wake.tz, message: wake.message, enabled: wake.enabled })}`];

/** Whether the wake schedule a spawn asked for was saved, from the spawn's own answer; null when the answer speaks of none. */
export type WakeOutcome = { saved: true; id: string | null; code: null; message: null } | { saved: false; id: null; code: string; message: string | null };
export function wakeOutcome(document: unknown): WakeOutcome | null {
  const answer = record(document) && record(document.result) ? document.result : document;
  if (!record(answer)) return null;
  if (record(answer.wakeScheduleError)) return { saved: false, id: null, code: text(answer.wakeScheduleError.code) ?? "E_SCHEDULE", message: text(answer.wakeScheduleError.message) };
  if (record(answer.wakeSchedule)) return { saved: true, id: text(answer.wakeSchedule.id), code: null, message: null };
  return null;
}

/** The form's verbs. A draft is two reads: the stored definition, and for a job on a session backend the providers its soul can launch on. */
export const verbs = (oats: Runner) => ({
  scheduleAdd: (id: string, spec: ScheduleSpec, signal?: AbortSignal): Promise<Result<{ row: AutomationRow }>> =>
    oats.run(scheduleAddArgv(id, spec), (document) => parseRowAnswer(document, "schedule", "oats schedule add"), oats.timeouts.act, signal),
  scheduleUpdate: (id: string, spec: ScheduleSpec, signal?: AbortSignal): Promise<Result<{ row: AutomationRow }>> =>
    oats.run(scheduleUpdateArgv(id, spec), (document) => parseRowAnswer(document, "schedule", "oats schedule update"), oats.timeouts.act, signal),
  scheduleSoulBackends: (soul: string, signal?: AbortSignal): Promise<Result<{ backends: string[] }>> => oats.run(ok(inspectSoulArgv(soul)), parseSessionProviders, oats.timeouts.read, signal),
  scheduleHomeOperations: (home: string, signal?: AbortSignal): Promise<Result<{ operations: HomeOperation[] }>> => oats.run(ok(inspectHomeArgv(home)), parseHomeOperations, oats.timeouts.read, signal),
  async scheduleDraft(id: string, signal?: AbortSignal): Promise<Result<{ draft: ScheduleDraft | null }>> {
    const shown = await oats.run(scheduleShowArgv(id), parseScheduleShow, oats.timeouts.read, signal);
    if (!shown.ok) return shown;
    const stored = record(shown.value) ? shown.value : {};
    let backends = ["tmux"];
    if (stored.kind === "spawn" && typeof stored.backend === "string" && stored.backend !== "tmux" && typeof stored.agent === "string" && PROVIDER_NAME.test(stored.backend)) {
      const providers = await oats.run(ok(inspectSoulArgv(stored.agent)), parseSessionProviders, oats.timeouts.read, signal);
      if (!providers.ok) return providers;
      backends = [...backends, ...providers.value.backends];
    }
    return ok({ draft: scheduleDraftOf(shown.value, backends) });
  },
});
