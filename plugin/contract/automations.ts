// Automations (OATS's own schedules and triggers): the rows and answers that travel between the
// plugin's three parts. The host entry reads the kernel's `oats schedule … --json` and
// `oats trigger … --json` answers into these (kernel/automations.ts), the server passes them on,
// and the app draws them. The kernel places every row (runsHere, reason, enabledHere): nothing
// here, and nothing that reads these, derives a placement again.
import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { answer, hostBase, hostRead } from "./shared.js";

const text = z.string().nullable();
const count = z.number().int().nullable();

export const automationKind = z.enum(["schedule", "trigger"]);
/** Where the page lists a row: this computer runs it (or would), it needs attention here, or it runs elsewhere. */
export const automationGroup = z.enum(["here", "attention", "elsewhere"]);
/** Why a row does not run here. `other` is a reason this plugin does not know: it does not run here, as sent. */
export const automationReason = z.enum(["host-unnamed", "assigned-elsewhere", "owner-mismatch", "untrusted", "other"]);

export const automationOrigin = z.object({
  kind: z.enum(["workspace", "local"]),
  /** the member of a workspace item (the first part of its qualified id) */
  member: text,
  repoKey: text,
  path: text,
  commit: text,
  /** the file's web address at its commit, https only */
  url: text,
  /** the file on this machine: a local item's definitions file, a workspace item's in the member's clone */
  localPath: text,
});

export const automationSoul = z.object({
  name: z.string(),
  origin: z
    .object({ kind: z.string(), package: text, version: text, member: text, repoKey: text, source: text, candidates: count })
    .nullable(),
});

/** One run of a schedule or one fire of a trigger, as the kernel recorded it. */
export const automationRun = z.object({
  at: text,
  startedAt: text,
  scheduledFor: text,
  outcome: text,
  error: text,
  errorCode: text,
  reason: text,
  event: text,
  number: count,
  subject: text,
  key: text,
  instance: text,
});

/** What a trigger watches. `params` are a capability source's, as the trigger file gives them. */
export const automationOn = z.object({
  source: text,
  repo: text,
  events: z.array(z.string()),
  labels: z.array(z.string()),
  base: text,
  poll: text,
  /** `value` is null for a value that is not text */
  params: z.array(z.object({ name: z.string(), value: text })),
});

export const automationProblem = z.object({ code: text, message: text, field: text, at: text });

export const automationRow = z.object({
  kind: automationKind,
  /** what a run does: a schedule's kernel kind (spawn, command, wake, operation); a trigger spawns */
  run: text,
  /** the qualified id (`local/<id>`, `<member>/<id>`): the row's address in every act */
  id: z.string(),
  name: z.string(),
  origin: automationOrigin,
  description: text,
  owner: text,
  runsOn: text,
  runsHere: z.boolean(),
  reason: automationReason.nullable(),
  reasonDetail: text,
  /** the kernel's own word for a reason this plugin does not know */
  reasonCode: text,
  enabledHere: z.boolean(),
  enabled: z.boolean(),
  soul: automationSoul.nullable(),
  task: text,
  message: text,
  home: text,
  operation: text,
  cwd: text,
  argv: z.array(z.string()).nullable(),
  purpose: text,
  backend: text,
  yolo: z.boolean().nullable(),
  wake: z.object({ cron: z.string(), tz: text, message: text }).nullable(),
  /** the job's lock on this computer: a host slot, not proof of a launch */
  running: z.boolean(),
  /** a launch with no recorded result */
  attempt: z
    .object({ scheduledFor: text, startedAt: text, error: text, exited: z.boolean().nullable(), exitStatus: count, exitSignal: text })
    .nullable(),
  pendingWake: z.object({ scheduledFor: text }).nullable(),
  scope: text,
  createdAt: text,
  updatedAt: text,
  cron: text,
  tz: text,
  teams: z.array(z.string()),
  launchConfig: text,
  harness: text,
  model: text,
  concurrency: z.object({ max: count, perKey: count }).nullable(),
  template: z.object({ package: text, template: text, from: text, version: text, commit: text }).nullable(),
  on: automationOn.nullable(),
  lastRun: automationRun.nullable(),
  nextDue: text,
  recentRuns: z.array(automationRun),
  /** the stored definition no longer validates, or (with `at`) a capability source's check failed at a poll */
  invalid: automationProblem.nullable(),
  /** the kernel could not read the row at all */
  unreadable: automationProblem.nullable(),
  group: automationGroup,
});

export const automationHost = z.object({
  /** this machine's `host.name` in oats-local.yaml */
  name: text,
  /** who this machine's gh is logged in as, by GitHub host; null: not logged in there */
  ghUser: z.record(z.string(), text),
});

/** The host timer. Nothing runs unless it is installed, active and registered for this deployment. */
export const automationScheduler = z.object({
  installed: z.boolean(),
  active: z.boolean(),
  registered: z.boolean().nullable(),
  lastTick: text,
  maxConcurrent: count,
});

export const automationList = z.object({
  kind: automationKind,
  host: automationHost,
  scheduler: automationScheduler.nullable(),
  /** the last sync's snapshot of the workspace's items; null before the first */
  snapshot: z.object({ takenAt: text, problems: z.number().int() }).nullable(),
  rows: z.array(automationRow),
});

const says = z.object({ code: text, message: text });
const fired = z.object({ key: text, at: text, outcome: text, event: text, label: text, instance: text });

/** One trigger's recorded state (`oats trigger status`): every string is already one display line. */
export const triggerStatus = z.object({
  fired: z.array(fired),
  firedTotal: count,
  live: z.array(z.object({ instance: text, label: text, event: text })),
  liveCount: count,
  max: count,
  /** newest observed first */
  pending: z.array(z.object({ key: text, label: text, event: text, observedAt: text })),
  lastPoll: z
    .object({
      at: z.string(),
      ok: z.boolean(),
      /** a pull-request trigger's good poll */
      prs: count,
      matching: count,
      /** a capability source's good poll: four counts */
      events: count,
      filtered: count,
      skipped: count,
      refused: count,
      /** a failed poll */
      error: text,
      cause: text,
      says: says.nullable(),
    })
    .nullable(),
  lastError: z.object({ at: text, code: text, message: text, key: text, says: says.nullable() }).nullable(),
  /** a capability source's row only: the source as the kernel names it, and its last good poll's lists */
  source: z.object({ capability: text, name: text }).nullable(),
  refused: z.array(z.object({ text: text, rule: text })),
  skipped: z.array(z.object({ subject: text, why: text })),
  invalid: automationProblem.nullable(),
});

export type AutomationKind = z.infer<typeof automationKind>;
export type AutomationGroup = z.infer<typeof automationGroup>;
export type AutomationOrigin = z.infer<typeof automationOrigin>;
export type AutomationSoul = z.infer<typeof automationSoul>;
export type AutomationRun = z.infer<typeof automationRun>;
export type AutomationOn = z.infer<typeof automationOn>;
export type AutomationProblem = z.infer<typeof automationProblem>;
export type AutomationRow = z.infer<typeof automationRow>;
export type AutomationHost = z.infer<typeof automationHost>;
export type AutomationScheduler = z.infer<typeof automationScheduler>;
export type AutomationList = z.infer<typeof automationList>;
export type TriggerStatus = z.infer<typeof triggerStatus>;

// ---- the verbs ----

/** One list as a client gets it: the kernel's answer, or why there is none (the kernel's code and message, or one of the plugin's own). */
export const automationListAnswer = z.union([
  z.object({ ok: z.literal(true), list: automationList }),
  z.object({ ok: z.literal(false), code: z.string(), message: z.string() }),
]);
/** A qualified id (`local/<id>`, `<member>/<id>`) or a bare local one: never a path, never an option. */
export const automationId = z.string().regex(/^(?:[A-Za-z0-9][A-Za-z0-9._-]{0,63}\/)?[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/);

/** app -> server */
export const rpc = defineRpcContract({
  /**
   * Both lists, read together: each tab counts its rows, and one that fails does not hide the
   * other. `hostId` is the bb machine that holds the deployment (a row's file opens there). An
   * OATS that does not list the feature `automations` is not asked for them.
   */
  automations: {
    input: z.null(),
    output: z.object({
      at: z.string(),
      hostId: z.string().nullable(),
      /** what this OATS says of itself (`oats version --json`); null when it could not be asked */
      oats: z.object({ version: z.string(), features: z.array(z.string()), automationsApi: z.number().nullable() }).nullable(),
      schedule: automationListAnswer,
      trigger: automationListAnswer,
    }),
  },
  /** One trigger's recorded state. The id must be a trigger of the current list. */
  triggerStatus: { input: z.object({ id: automationId }).strict(), output: triggerStatus },
});

/** server -> host: one method per `oats` command the feature runs. */
export const host = defineRpcContract({
  scheduleList: { experimental_retryable: true, input: hostRead, output: answer(automationList) },
  triggerList: { experimental_retryable: true, input: hostRead, output: answer(automationList) },
  /** `source` is the list row's `on.source`, which decides how an event is named; it reaches no argv. */
  triggerStatus: {
    experimental_retryable: true,
    input: z.object({ ...hostBase, id: automationId, source: z.string().nullable() }).strict(),
    output: answer(triggerStatus),
  },
});
