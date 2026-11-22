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

// ---- the answers of the acts ----

/** What a capability source did when a confirmed test ran it. */
export const automationTestSource = z.object({
  capability: text,
  name: text,
  ok: z.boolean(),
  /** how many events the trigger selects, and how many valid ones it does not */
  events: z.number().int(),
  filtered: z.number().int(),
  refused: z.array(z.object({ text: text, rule: text })),
  skipped: z.array(z.object({ subject: text, why: text })),
  /** its meaning fails */
  invalid: automationProblem.nullable(),
  /** the poll failed: the kernel's cause, error and code, and the source's own refusal */
  cause: text,
  error: text,
  code: text,
  says: says.nullable(),
});

/** `oats schedule test` or `oats trigger test`, as the Test result card reads it. It ran nothing but, when confirmed, a capability's source command. */
export const automationTest = z.object({
  ok: z.boolean(),
  problems: z.array(z.string()),
  warnings: z.array(z.string()),
  /** what would fire now; null where the answer does not say (a schedule's) */
  wouldFire: z
    .array(
      z.object({
        key: text,
        label: z.string(),
        /** the name the spawn would be asked to derive; null when unknown */
        instance: text,
        nameCut: z.boolean(),
        held: z.boolean(),
        /** the kernel's reason for holding it, when it gives one */
        heldReason: text,
        /** a capability source's: text, never a link */
        url: text,
      }),
    )
    .nullable(),
  nextDue: text,
  soul: z.object({ resolves: z.boolean(), error: text }).nullable(),
  /** the account this machine's gh acts as */
  account: text,
  source: automationTestSource.nullable(),
});

/** `oats schedule run`: the run it made, as the kernel recorded it. */
export const scheduleRunReceipt = z.object({ run: automationRun.nullable() });
/** `oats schedule reconcile`: what the kernel now knows of a run whose state was unknown, and what to do when it still is. */
export const scheduleReconciled = z.object({ reconciled: text, remedy: text });

export type AutomationTestSource = z.infer<typeof automationTestSource>;
export type AutomationTest = z.infer<typeof automationTest>;
export type ScheduleRunReceipt = z.infer<typeof scheduleRunReceipt>;
export type ScheduleReconciled = z.infer<typeof scheduleReconciled>;

// ---- a schedule's definition, as the form makes one ----
/** A new schedule's name, as the Desktop's form holds it: lower-case letters, digits and "-". */
export const SCHEDULE_NAME = /^[a-z0-9][a-z0-9-]{0,99}$/;
/** A text of a definition: as typed, of any length a definition may have, with no NUL (the kernel's argv cannot hold one). */
const definitionText = z.string().max(1_048_576).refine((value) => !value.includes("\0"), "a NUL character");
const filled = definitionText.refine((value) => value.trim() !== "", "empty");
/** A soul's key, a harness, a session backend: a name, never an option or a path of the caller's making. */
const named = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._/-]{0,127}$/);
/** A provider operation's address, `<layer>:<operation>`. */
export const operationAddress = z.string().regex(/^[a-z][a-z0-9-]{0,63}:[A-Za-z][A-Za-z0-9._-]{0,127}$/);
const when = { cron: filled, tz: filled, enabled: z.boolean(), description: z.string().optional() };
/** The recurring message of a launched agent: `wake` inside a spawn schedule. */
export const nestedWake = z.object({ cron: filled, tz: filled, message: filled }).strict();
/** A recurring wake-up asked at spawn (`oats spawn --wake-json`). */
export const wake = z.object({ cron: filled, tz: filled, message: filled, enabled: z.literal(true) }).strict();
/**
 * A schedule's definition, one of the three kinds the form makes. Strict: a key the form does not
 * make is refused, so a definition it could not keep whole is never replaced through it.
 */
export const scheduleSpec = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("wake"), ...when, home: filled, message: filled }).strict(),
  z
    .object({
      kind: z.literal("spawn"),
      ...when,
      agent: named,
      repo: definitionText.optional(),
      agentsRoot: definitionText.optional(),
      task: filled,
      purpose: definitionText.optional(),
      harness: named.optional(),
      model: definitionText.optional(),
      backend: named.optional(),
      yolo: z.boolean().optional(),
      wake: nestedWake.optional(),
    })
    .strict(),
  z.object({ kind: z.literal("operation"), ...when, home: filled, operation: operationAddress }).strict(),
]);
/** A stored definition the form can keep whole, read back for Edit: its id and what a save would send. */
export const scheduleDraft = z.object({ id: z.string(), spec: scheduleSpec });
/** What the form chooses among: the souls a schedule may launch, the homes one may wake or act in. */
export const scheduleTargets = z.object({
  souls: z.array(z.object({ key: z.string(), description: z.string(), spawnable: z.boolean() })),
  homes: z.array(z.object({ instance: z.string(), soul: z.string(), home: z.string(), backend: z.string() })),
});
/** A provider operation a schedule can run in a home: its address and how the form names it. */
export const homeOperation = z.object({ address: z.string(), label: z.string() });

export type ScheduleSpec = z.infer<typeof scheduleSpec>;
export type ScheduleDraft = z.infer<typeof scheduleDraft>;
export type ScheduleTargets = z.infer<typeof scheduleTargets>;
export type HomeOperation = z.infer<typeof homeOperation>;
export type Wake = z.infer<typeof wake>;

// ---- the verbs ----

/** The plugin's own code for an OATS that has no automations lists (feature `automations`, automationsApi 1: OATS 0.29). */
export const NO_AUTOMATIONS = "OATS_NO_AUTOMATIONS";

/** One list as a client gets it: the kernel's answer, or why there is none (the kernel's code and message, or one of the plugin's own). */
export const automationListAnswer = z.union([
  z.object({ ok: z.literal(true), list: automationList }),
  z.object({ ok: z.literal(false), code: z.string(), message: z.string() }),
]);
// The kernel's grammar for a qualified id (`local/<id>`, `<member>/<id>`) or a bare local one: a
// member of at most 64 characters, a trigger's id of at most 64 and a schedule's of at most 100.
export const TRIGGER_ID = /^(?:[A-Za-z0-9][A-Za-z0-9._-]{0,63}\/)?[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
export const SCHEDULE_ID = /^(?:[A-Za-z0-9][A-Za-z0-9._-]{0,63}\/)?[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;
/** An id as an RPC takes it: never a path, never an option. The wider of the two; the host holds each kind to its own. */
export const automationId = z.string().regex(SCHEDULE_ID);

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
  triggerStatus: { input: z.object({ id: z.string().regex(TRIGGER_ID) }).strict(), output: triggerStatus },

  // ---- the acts on a row of the current list; an id it does not name starts no process ----
  /** On or off on this computer: a local item's own switch, a workspace item's entry in this host's opt-outs. */
  automationEnable: { input: z.object({ kind: automationKind, id: automationId, enabled: z.boolean() }).strict(), output: z.object({ row: automationRow }) },
  /** Run a schedule now. A launch can take as long as a spawn. */
  scheduleRun: { input: z.object({ id: automationId }).strict(), output: scheduleRunReceipt },
  /**
   * Test one: it runs nothing, except that `runSource: true` (a person's confirmed press, a
   * capability source's trigger only) lets the kernel run that source's command once.
   */
  automationTest: { input: z.object({ kind: automationKind, id: automationId, runSource: z.literal(true).optional() }).strict(), output: automationTest },
  /** The summary of a local item: one line of up to 200 characters; empty removes it. */
  automationDescribe: { input: z.object({ kind: automationKind, id: automationId, description: z.string().max(800) }).strict(), output: z.object({ row: automationRow }) },
  /** Delete a local schedule. */
  scheduleRemove: { input: z.object({ id: automationId }).strict(), output: z.object({ removed: z.string() }) },
  /** Check a run whose state is unknown. */
  scheduleReconcile: { input: z.object({ id: automationId }).strict(), output: scheduleReconciled },
  /** Install the host timer for this deployment (a systemd user timer, or a launchd agent, of the account bb's machine runs as). */
  schedulerEnable: { input: z.null(), output: z.object({ scheduler: automationScheduler, warnings: z.array(z.string()) }) },

  // ---- creating and editing a local schedule ----
  /** What the form chooses among. */
  scheduleTargets: { input: z.null(), output: scheduleTargets },
  /** The session backends a soul can launch on, beside tmux: the providers its capabilities supply. */
  scheduleSoulBackends: { input: z.object({ soul: named }).strict(), output: z.object({ backends: z.array(z.string()) }) },
  /** The provider operations a schedule can run in a home of the current roster. */
  scheduleHomeOperations: { input: z.object({ home: filled }).strict(), output: z.object({ operations: z.array(homeOperation) }) },
  /** A local schedule's stored definition, read back for Edit; `draft: null` for one the form cannot keep whole. */
  scheduleDraft: { input: z.object({ id: automationId }).strict(), output: z.object({ draft: scheduleDraft.nullable() }) },
  /** Create a local schedule. */
  scheduleAdd: { input: z.object({ id: z.string().regex(SCHEDULE_NAME), spec: scheduleSpec }).strict(), output: z.object({ row: automationRow }) },
  /** Replace a local schedule's definition. */
  scheduleUpdate: { input: z.object({ id: automationId, spec: scheduleSpec }).strict(), output: z.object({ row: automationRow }) },
});

const hostAutomation = z.object({ ...hostBase, id: automationId }).strict();

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
  // The acts: never retried by bb. `id` is the qualified id the list named.
  automationEnable: { input: z.object({ ...hostBase, kind: automationKind, id: automationId, enabled: z.boolean() }).strict(), output: answer(z.object({ row: automationRow })) },
  scheduleRun: { input: hostAutomation, output: answer(scheduleRunReceipt) },
  automationTest: {
    input: z.object({ ...hostBase, kind: automationKind, id: automationId, source: z.string().nullable(), runSource: z.boolean() }).strict(),
    output: answer(automationTest),
  },
  automationDescribe: { input: z.object({ ...hostBase, kind: automationKind, id: automationId, description: z.string().max(800) }).strict(), output: answer(z.object({ row: automationRow })) },
  scheduleRemove: { input: hostAutomation, output: answer(z.object({ removed: z.string() })) },
  scheduleReconcile: { input: hostAutomation, output: answer(scheduleReconciled) },
  schedulerEnable: { input: hostRead, output: answer(z.object({ scheduler: automationScheduler, warnings: z.array(z.string()) })) },
  // The form's reads: `oats inspect --soul`, `oats inspect --home`, `oats schedule show`.
  scheduleSoulBackends: { experimental_retryable: true, input: z.object({ ...hostBase, soul: named }).strict(), output: answer(z.object({ backends: z.array(z.string()) })) },
  scheduleHomeOperations: { experimental_retryable: true, input: z.object({ ...hostBase, home: filled }).strict(), output: answer(z.object({ operations: z.array(homeOperation) })) },
  scheduleDraft: { experimental_retryable: true, input: hostAutomation, output: answer(z.object({ draft: scheduleDraft.nullable() })) },
  // The form's saves: never retried by bb. The definition is one argv element, `--spec-json=<json>`.
  scheduleAdd: { input: z.object({ ...hostBase, id: z.string().regex(SCHEDULE_NAME), spec: scheduleSpec }).strict(), output: answer(z.object({ row: automationRow })) },
  scheduleUpdate: { input: z.object({ ...hostBase, id: automationId, spec: scheduleSpec }).strict(), output: answer(z.object({ row: automationRow })) },
});
