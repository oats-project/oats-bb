// Stop, start, restart and retire, each through OATS so that a stopped agent stays stopped
// (docs/desktop-cli-api.md "Lifecycle: stop and retire", "Start and restart"). A plan and a receipt
// are read into FACTS: what the kernel said, typed, with nothing worded here. The sentences a
// dialog shows are made from them in app/lifecycle/words.ts, in the OATS Desktop's words. An
// apply carries the plan's revision and an idempotency key.
import { z } from "zod";
import { shaped } from "./envelope.js";
import { checkHome, checkInstance, checkKey, checkRevision } from "./input.js";
import { ok, type Result } from "./result.js";
import type { Runner } from "./runner.js";
import { checkHarness, checkModel } from "./spawn.js";

// ---- the facts ----

/**
 * Whether a session runs, as a plan knows it: `unknown` when the kernel could not establish it
 * (never read as idle), `none` when there is nothing to stop, else `there`.
 */
export type SessionFact = "there" | "none" | "unknown";
/** The Git observation of a work tree, summarized; `observed: false` when there was none to make. */
export type WorkFact = { observed: boolean; branch: string | null; detached: boolean; drift: boolean; changed: number; untracked: number };
/** `midTask` is the kernel's `true`, `false` or `"unknown"` (a provider that reports no activity). */
/** `backend` is where the session runs, as the kernel names it ("bb", "tmux"); null when it does not say. */
export type StopTarget = { instance: string; soul: string | null; depth: number; session: SessionFact; backend: string | null; midTask: boolean | "unknown" };
/** `instance` is the agent the KERNEL's plan is for, as its answer names it (null when it names none): what a confirmation is titled with, never the name that was asked for. */
export type StopPlan = {
  action: "stop";
  revision: string;
  instance: string | null;
  /** When the kernel read it; null when it does not say. */
  at: string | null;
  /** Whether the children are stopped too (the tick "Include child instances"). */
  recursive: boolean;
  /** The agent first, then its descendants. */
  targets: StopTarget[];
  /** Children left as they are (`recursive: false`), and children the kernel cannot attribute. */
  skipped: string[];
  ambiguous: string[];
};
export type ExtraTree = { path: string | null; branch: string | null; disposition: string | null; reason: string | null };
export type RetirePlan = {
  action: "retire";
  revision: string;
  instance: string;
  home: string | null;
  at: string | null;
  session: SessionFact;
  /** Where its session runs ("bb": the retire archives its thread); null when the kernel does not say. */
  backend: string | null;
  work: WorkFact;
  /**
   * Whether `work/` is the agent's own work tree, the one a retire keeps or deletes: the kernel's
   * fact (`facts.ownWorktree`), or null from a kernel that does not say (the record's `workMode`
   * then answers, as on the Desktop).
   */
  ownWorktree: boolean | null;
  workMode: string | null;
  recordedBranch: string | null;
  children: string[];
  ambiguous: string[];
  extraTrees: ExtraTree[];
};

/** One row of a stop's results, or of a retire's stopped children. */
export type StoppedRow = {
  instance: string;
  ok: boolean;
  alreadyIdle: boolean;
  /** The kernel's code of a row that failed. */
  code: string | null;
  /** The processes seen alive after the wait; null when the kernel does not say, or says none (which proves nothing without the kernel's feature list). */
  stillRunning: number[] | null;
  /** The kernel's own sentence, kept for a row whose home could not be locked (`E_LIFECYCLE_BUSY`). */
  detail: string | null;
};
export type StopReceipt = { action: "stop"; ok: boolean; replayed: boolean; results: StoppedRow[] };
export type RetireReceipt = {
  action: "retire";
  instance: string;
  replayed: boolean;
  /** The retire was accepted and finishes in the background. */
  deferred: boolean;
  removedDir: boolean;
  retainedHome: string | null;
  worktree: "retained" | "removed" | "absent" | null;
  movedTo: string | null;
  recoveryPath: string | null;
  /** The bb threads the provider archived with the home (`capabilityMeta["oats.bb"].archived`). */
  threadsArchived: number;
  children: StoppedRow[];
  /** What the kernel says its cleanup left (`rollbackIncomplete`); empty when it finished. */
  incomplete: string[];
  /** The branch an interrupted spawn left, which this retire deleted or kept. */
  compensation: { branch: string; deleted: boolean; reason: string | null } | null;
};
/**
 * What a start answered. A start on a bb home engages no launch prompt (the real run's start
 * answers carry no `launchPrompts`), so the Desktop's "Claude Code ignored the channel option"
 * outcome cannot occur here and is not read.
 */
export type Started = {
  /** The thread the session now runs in, when the answer names it (the endpoint is replaced at each start). */
  threadId: string | null;
  instance: string | null;
  harness: string | null;
  model: string | null;
  warnings: string[];
};
/** What a start may choose: nothing (the recorded launch), or a harness the provider declares and a model id. */
export type StartChoices = { harness?: string | undefined; model?: string | undefined };
type Apply = { instance: string; revision: string; key: string };

// ---- reading the kernel's documents ----

const text = z.string().nullish();
const session = z.looseObject({ state: text, present: z.boolean().nullish(), established: z.boolean().nullish(), backend: text }).nullish();
const work = z
  .looseObject({ observed: z.boolean().nullish(), branch: text, detached: z.boolean().nullish(), drift: z.boolean().nullish(), changed: z.number().nullish(), untracked: z.number().nullish() })
  .nullish();

/**
 * The kernel's words for a session with nothing to stop: `shell`, `stopped` and `not-launched` are
 * idle, and one that is established and not present (`absent`) is observably gone. Any other state
 * of an established session, `unknown` included, is a session that is there. One that is not
 * established is unknown, never idle.
 */
function sessionFact(value: z.output<typeof session>): SessionFact {
  if (!value || value.established !== true) return "unknown";
  return value.present === false || value.state === "shell" || value.state === "stopped" || value.state === "not-launched" ? "none" : "there";
}
function workFact(value: z.output<typeof work>): WorkFact {
  if (!value || value.observed !== true) return { observed: false, branch: null, detached: false, drift: false, changed: 0, untracked: 0 };
  return { observed: true, branch: value.branch ?? null, detached: value.detached === true, drift: value.drift === true, changed: value.changed ?? 0, untracked: value.untracked ?? 0 };
}

const stoppedRow = z.looseObject({ instance: text, ok: z.boolean().nullish(), alreadyIdle: z.boolean().nullish(), code: text, message: text, stillRunning: z.array(z.number()).nullish() });
function stoppedRows(rows: readonly z.output<typeof stoppedRow>[] | null | undefined): StoppedRow[] {
  return (rows ?? []).map((row) => {
    const failed = row.ok === false;
    return {
      instance: row.instance ?? "",
      ok: !failed,
      alreadyIdle: !failed && row.alreadyIdle === true,
      code: failed ? (row.code ?? "E_SESSION_STOP_FAILED") : null,
      stillRunning: failed && row.stillRunning && row.stillRunning.length > 0 ? [...row.stillRunning] : null,
      detail: failed && row.code === "E_LIFECYCLE_BUSY" && row.message ? row.message : null,
    };
  });
}

function applyArgv(head: string[], apply: Apply, tail: string[]): Result<string[]> {
  const instance = checkInstance(apply.instance);
  if (!instance.ok) return instance;
  const revision = checkRevision(apply.revision);
  if (!revision.ok) return revision;
  const key = checkKey(apply.key);
  if (!key.ok) return key;
  return ok([...head, instance.value, ...tail, "--plan-revision", revision.value, "--idempotency-key", key.value, "--json"]);
}

// ---- oats instance stop ----
/** `recursive: false` leaves the children as they are (`--no-recursive`); the kernel's default stops them first. */
export function stopPlanArgv(instance: string, recursive = true): Result<string[]> {
  const checked = checkInstance(instance);
  return checked.ok ? ok(["instance", "stop", checked.value, "--plan", ...(recursive ? [] : ["--no-recursive"]), "--json"]) : checked;
}
/** The apply names the same choice as the plan it confirms: the kernel hashes it into the revision. */
export const stopApplyArgv = (apply: Apply, recursive = true): Result<string[]> => applyArgv(["instance", "stop"], apply, ["--apply", ...(recursive ? [] : ["--no-recursive"])]);

const named = z.looseObject({ instance: z.string() });
const stopPlan = z.looseObject({
  planRevision: z.string().min(1),
  at: text,
  recursive: z.boolean().nullish(),
  targets: z.array(z.looseObject({ instance: z.string(), agent: text, depth: z.number().nullish(), session, midTask: z.unknown() })),
  skipped: z.array(named).nullish(),
  ambiguous: z.array(named).nullish(),
});

export function parseStopPlan(document: unknown): Result<StopPlan> {
  const parsed = shaped(stopPlan, document, "oats instance stop --plan");
  if (!parsed.ok) return parsed;
  const plan = parsed.value;
  // The kernel lists the descendants first; a person reads the agent they asked about first.
  const targets = [...plan.targets]
    .sort((a, b) => (a.depth ?? 0) - (b.depth ?? 0))
    .map((target): StopTarget => ({
      instance: target.instance,
      soul: target.agent ?? null,
      depth: target.depth ?? 0,
      session: sessionFact(target.session),
      backend: target.session?.backend ?? null,
      midTask: target.midTask === true ? true : target.midTask === false ? false : "unknown",
    }));
  // The agent the plan is for: the kernel's own target at depth 0.
  const root = targets.find((target) => target.depth === 0);
  return ok({
    action: "stop",
    revision: plan.planRevision,
    instance: root?.instance ?? null,
    at: plan.at ?? null,
    recursive: plan.recursive !== false,
    targets,
    skipped: (plan.skipped ?? []).map((row) => row.instance),
    ambiguous: (plan.ambiguous ?? []).map((row) => row.instance),
  });
}

const stopReceipt = z.looseObject({ ok: z.boolean().nullish(), replayed: z.boolean().nullish(), results: z.array(stoppedRow).nullish() });

/**
 * A stop's receipt, row by row. A stop that left a session running is a receipt too (`ok: false`):
 * its rows say which stopped and which did not, and the dialog words it from them.
 */
export function parseStopApply(document: unknown): Result<StopReceipt> {
  const parsed = shaped(stopReceipt, document, "oats instance stop --apply");
  if (!parsed.ok) return parsed;
  const results = stoppedRows(parsed.value.results);
  return ok({ action: "stop", ok: parsed.value.ok !== false && results.every((row) => row.ok), replayed: parsed.value.replayed === true, results });
}

// ---- oats session start | restart ----

function sessionArgv(verb: "start" | "restart", home: string, choices: StartChoices = {}, declared: readonly string[] = []): Result<string[]> {
  const checked = checkHome(home);
  if (!checked.ok) return checked;
  const argv = ["session", verb, "--home", checked.value];
  if (choices.harness !== undefined) {
    // One the bb session provider declares (kernel/spawn.ts, the one rule for a spawn, a start and a restart).
    const harness = checkHarness(choices.harness, declared);
    if (!harness.ok) return harness;
    argv.push("--harness", harness.value);
  }
  if (choices.model !== undefined) {
    const model = checkModel(choices.model);
    if (!model.ok) return model;
    argv.push("--model", model.value);
  }
  return ok([...argv, "--json"]);
}
/**
 * Neither names a mode (no `--yolo`): the home's recorded choice stands. With no choice, nothing
 * but the home is passed. `declared`: the harnesses the bb session provider declares, which a
 * chosen harness must be one of.
 */
export const startArgv = (home: string, choices?: StartChoices, declared?: readonly string[]): Result<string[]> => sessionArgv("start", home, choices, declared);
export const restartArgv = (home: string, choices?: StartChoices, declared?: readonly string[]): Result<string[]> => sessionArgv("restart", home, choices, declared);

const started = z.looseObject({
  instance: text,
  harness: text,
  model: text,
  session: z.looseObject({ endpoint: z.looseObject({ threadId: text }).nullish() }).nullish(),
  warnings: z.array(z.unknown()).nullish(),
});

export function parseSessionStart(document: unknown, verb: "start" | "restart" = "start"): Result<Started> {
  const parsed = shaped(started, document, `oats session ${verb}`);
  if (!parsed.ok) return parsed;
  const value = parsed.value;
  return ok({
    threadId: value.session?.endpoint?.threadId ?? null,
    instance: value.instance ?? null,
    harness: value.harness ?? null,
    model: value.model ?? null,
    warnings: (value.warnings ?? []).filter((warning): warning is string => typeof warning === "string"),
  });
}

// ---- oats retire ----
export function retirePlanArgv(instance: string): Result<string[]> {
  const checked = checkInstance(instance);
  return checked.ok ? ok(["retire", checked.value, "--plan", "--json"]) : checked;
}
/** `discardWorktree` deletes the agent's own work tree (`--discard-worktree`); without it the tree is kept, moved aside. */
export const retireApplyArgv = (apply: Apply, discardWorktree = false): Result<string[]> => applyArgv(["retire"], apply, discardWorktree ? ["--discard-worktree"] : []);

const retirePlan = z.looseObject({
  planRevision: z.string().min(1),
  instance: z.string(),
  home: text,
  at: text,
  facts: z
    .looseObject({
      session,
      work,
      workMode: text,
      ownWorktree: z.boolean().nullish(),
      recordedBranch: text,
      children: z.array(named).nullish(),
      ambiguous: z.array(named).nullish(),
      extraWorktrees: z.array(z.looseObject({ path: text, branch: text, disposition: text, reason: text })).nullish(),
    })
    .nullish(),
});

export function parseRetirePlan(document: unknown): Result<RetirePlan> {
  const parsed = shaped(retirePlan, document, "oats retire --plan");
  if (!parsed.ok) return parsed;
  const plan = parsed.value;
  const facts = plan.facts ?? {};
  return ok({
    action: "retire",
    revision: plan.planRevision,
    instance: plan.instance,
    home: plan.home ?? null,
    at: plan.at ?? null,
    session: sessionFact(facts.session),
    backend: facts.session?.backend ?? null,
    work: workFact(facts.work),
    ownWorktree: facts.ownWorktree ?? null,
    workMode: facts.workMode ?? null,
    recordedBranch: facts.recordedBranch ?? null,
    children: (facts.children ?? []).map((child) => child.instance),
    ambiguous: (facts.ambiguous ?? []).map((row) => row.instance),
    extraTrees: (facts.extraWorktrees ?? []).map((tree) => ({ path: tree.path ?? null, branch: tree.branch ?? null, disposition: tree.disposition ?? null, reason: tree.reason ?? null })),
  });
}

const retireReceipt = z.looseObject({
  retired: z.string().min(1),
  deferred: z.boolean().nullish(),
  replayed: z.boolean().nullish(),
  removedDir: z.boolean().nullish(),
  rollbackIncomplete: z.array(z.string()).nullish(),
  retainedHome: text,
  retention: z.looseObject({ worktree: text, movedTo: text }).nullish(),
  workRecovery: z.looseObject({ path: text }).nullish(),
  childrenStopped: z.array(stoppedRow).nullish(),
  spawnCompensation: z.looseObject({ branch: text, branchDeleted: z.boolean().nullish(), reason: text }).nullish(),
  capabilityMeta: z.looseObject({ "oats.bb": z.looseObject({ archived: z.array(z.unknown()).nullish() }).nullish() }).nullish(),
});

/** A retire receipt that says its cleanup is incomplete: the one document `oats retire` prints with exit 1. */
export const isIncompleteRetire = (document: unknown): boolean => {
  const parsed = retireReceipt.safeParse(document);
  return parsed.success && Array.isArray(parsed.data.rollbackIncomplete);
};

/**
 * A first guarded retire prints the receipt itself; a replayed one prints it in an envelope. A
 * receipt with `rollbackIncomplete` (printed with exit 1) is a retire whose cleanup is incomplete:
 * the home is kept, and `incomplete` holds the kernel's own lines of what is left.
 */
export function parseRetireApply(document: unknown): Result<RetireReceipt> {
  const parsed = shaped(retireReceipt, document, "oats retire");
  if (!parsed.ok) return parsed;
  const receipt = parsed.value;
  const kept = receipt.retention?.worktree;
  const compensation = receipt.spawnCompensation;
  return ok({
    action: "retire",
    instance: receipt.retired,
    replayed: receipt.replayed === true,
    deferred: receipt.deferred === true,
    removedDir: receipt.removedDir === true,
    retainedHome: receipt.retainedHome ?? null,
    worktree: kept === "retained" || kept === "removed" || kept === "absent" ? kept : null,
    movedTo: receipt.retention?.movedTo ?? null,
    recoveryPath: receipt.workRecovery?.path ?? null,
    threadsArchived: receipt.capabilityMeta?.["oats.bb"]?.archived?.length ?? 0,
    children: stoppedRows(receipt.childrenStopped),
    incomplete: receipt.rollbackIncomplete ?? [],
    compensation: compensation?.branch ? { branch: compensation.branch, deleted: compensation.branchDeleted === true, reason: compensation.reason ?? null } : null,
  });
}

/** The lifecycle's commands. */
export const verbs = (oats: Runner) => ({
  stopPlan: (instance: string, signal?: AbortSignal, recursive = true): Promise<Result<StopPlan>> =>
    oats.run(stopPlanArgv(instance, recursive), parseStopPlan, oats.timeouts.read, signal),
  stopApply: (apply: Apply & { recursive?: boolean }, signal?: AbortSignal): Promise<Result<StopReceipt>> =>
    oats.run(stopApplyArgv(apply, apply.recursive !== false), parseStopApply, oats.timeouts.act, signal),
  start: (home: string, signal?: AbortSignal, choices?: StartChoices, declared?: readonly string[]): Promise<Result<Started>> =>
    oats.run(startArgv(home, choices, declared), (document) => parseSessionStart(document, "start"), oats.timeouts.act, signal),
  restart: (home: string, signal?: AbortSignal, choices?: StartChoices, declared?: readonly string[]): Promise<Result<Started>> =>
    oats.run(restartArgv(home, choices, declared), (document) => parseSessionStart(document, "restart"), oats.timeouts.act, signal),
  retirePlan: (instance: string, signal?: AbortSignal): Promise<Result<RetirePlan>> =>
    oats.run(retirePlanArgv(instance), parseRetirePlan, oats.timeouts.read, signal),
  retireApply: (apply: Apply & { discardWorktree?: boolean }, signal?: AbortSignal): Promise<Result<RetireReceipt>> =>
    // An incomplete retire prints its receipt and exits 1: the receipt is what says what is left.
    oats.run(retireApplyArgv(apply, apply.discardWorktree === true), parseRetireApply, oats.timeouts.long, signal, { failedDocument: isIncompleteRetire }),
});
