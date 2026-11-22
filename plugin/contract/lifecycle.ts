// Stop, start, restart and retire, each through OATS. A plan and a receipt travel as the kernel's
// facts (kernel/lifecycle.ts reads them); the app words them (app/lifecycle/words.ts).
import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";
import type { RetirePlan, RetireReceipt, Started, StopPlan, StopReceipt } from "../kernel/lifecycle.js";
import { answer, hostApply, hostHome, hostInstance, instanceName, key } from "./shared.js";

const sessionFact = z.enum(["there", "none", "unknown"]);
const workFact = z.object({ observed: z.boolean(), branch: z.string().nullable(), detached: z.boolean(), drift: z.boolean(), changed: z.number(), untracked: z.number() });
export const stopPlan = z.object({
  action: z.literal("stop"),
  revision: z.string(),
  instance: z.string().nullable(),
  at: z.string().nullable(),
  recursive: z.boolean(),
  targets: z.array(z.object({ instance: z.string(), soul: z.string().nullable(), depth: z.number(), session: sessionFact, backend: z.string().nullable(), midTask: z.union([z.boolean(), z.literal("unknown")]) })),
  skipped: z.array(z.string()),
  ambiguous: z.array(z.string()),
}) satisfies z.ZodType<StopPlan>;
export const retirePlan = z.object({
  action: z.literal("retire"),
  revision: z.string(),
  instance: z.string(),
  home: z.string().nullable(),
  at: z.string().nullable(),
  session: sessionFact,
  backend: z.string().nullable(),
  work: workFact,
  ownWorktree: z.boolean().nullable(),
  workMode: z.string().nullable(),
  recordedBranch: z.string().nullable(),
  children: z.array(z.string()),
  ambiguous: z.array(z.string()),
  extraTrees: z.array(z.object({ path: z.string().nullable(), branch: z.string().nullable(), disposition: z.string().nullable(), reason: z.string().nullable() })),
}) satisfies z.ZodType<RetirePlan>;
const stoppedRow = z.object({ instance: z.string(), ok: z.boolean(), alreadyIdle: z.boolean(), code: z.string().nullable(), stillRunning: z.array(z.number()).nullable(), detail: z.string().nullable() });
export const stopReceipt = z.object({ action: z.literal("stop"), ok: z.boolean(), replayed: z.boolean(), results: z.array(stoppedRow) }) satisfies z.ZodType<StopReceipt>;
export const retireReceipt = z.object({
  action: z.literal("retire"),
  instance: z.string(),
  replayed: z.boolean(),
  deferred: z.boolean(),
  removedDir: z.boolean(),
  retainedHome: z.string().nullable(),
  worktree: z.enum(["retained", "removed", "absent"]).nullable(),
  movedTo: z.string().nullable(),
  recoveryPath: z.string().nullable(),
  threadsArchived: z.number(),
  children: z.array(stoppedRow),
  incomplete: z.array(z.string()),
  compensation: z.object({ branch: z.string(), deleted: z.boolean(), reason: z.string().nullable() }).nullable(),
}) satisfies z.ZodType<RetireReceipt>;
const started = z.object({
  threadId: z.string().nullable(),
  instance: z.string().nullable(),
  harness: z.string().nullable(),
  model: z.string().nullable(),
  warnings: z.array(z.string()),
}) satisfies z.ZodType<Started>;

/** A harness and a model as a caller may name them: kernel/spawn.ts checks each before any process (a harness the provider declares; a model that is no option). */
const harness = z.string().min(1).max(40);
const model = z.string().min(1).max(256);

const instance = z.object({ instance: instanceName }).strict();
const apply = { instance: instanceName, revision: z.string(), key };
/** What a start may choose; left out, the home's recorded launch stands and nothing is passed. */
const choices = { harness: harness.optional(), model: model.optional() };

/**
 * What the Start and Restart dialogs show before the act ("Checking instance…"): the agent as the
 * kernel names it in a roster read for this answer, and the harnesses the bb session provider
 * declares. A start has no plan of the kernel's: this is what the dialog is titled with.
 */
const startCheck = z.object({
  instance: z.string(),
  machine: z.string(),
  home: z.string(),
  harness: z.string().nullable(),
  model: z.string().nullable(),
  /** The kernel's `running` and `runtimeState`, as its row says them. */
  running: z.boolean().nullable(),
  runtimeState: z.string().nullable(),
  runtimeError: z.string().nullable(),
  /** The harnesses a start may name (the provider's declared list: contract/spawn.ts `spawnHarnesses`); with one or none, no choice is offered. */
  harnesses: z.array(z.string()),
});
/** The thread the agent is in after the act, and what the kernel said of the start. */
const startedIn = started.extend({ threadId: z.string() });

export const rpc = defineRpcContract({
  stopPlan: { input: z.object({ instance: instanceName, recursive: z.boolean().optional() }).strict(), output: stopPlan },
  stopApply: { input: z.object({ ...apply, recursive: z.boolean().optional() }).strict(), output: stopReceipt },
  startCheck: { input: instance, output: startCheck },
  start: { input: z.object({ instance: instanceName, ...choices }).strict(), output: startedIn },
  restart: { input: z.object({ instance: instanceName, ...choices }).strict(), output: startedIn },
  retirePlan: { input: instance, output: retirePlan },
  retireApply: { input: z.object({ ...apply, discardWorktree: z.boolean().optional() }).strict(), output: retireReceipt },
});

const hostStart = z.object({ ...hostHome.shape, ...choices }).strict();

export const host = defineRpcContract({
  stopPlan: { experimental_retryable: true, input: z.object({ ...hostInstance.shape, recursive: z.boolean().optional() }).strict(), output: answer(stopPlan) },
  stopApply: { input: z.object({ ...hostApply.shape, recursive: z.boolean().optional() }).strict(), output: answer(stopReceipt) },
  start: { input: hostStart, output: answer(started) },
  restart: { input: hostStart, output: answer(started) },
  /** Not retryable: each retire plan appends one `retire-planned` event to the workspace log. */
  retirePlan: { input: hostInstance, output: answer(retirePlan) },
  retireApply: { input: z.object({ ...hostApply.shape, discardWorktree: z.boolean().optional() }).strict(), output: answer(retireReceipt) },
});
