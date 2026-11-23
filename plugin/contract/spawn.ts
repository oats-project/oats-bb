// Spawn: the preview of `oats spawn --backend bb --yolo`, and the apply bound to its decision.
import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { answer, hostBase, instanceName, key } from "./shared.js";

const soulName = z.string().min(1).max(128);

export const spawnSummary = z.object({
  modules: z.array(z.string()),
  teams: z.array(z.string()),
  launch: z.string().nullable(),
  warnings: z.array(z.string()),
  problems: z.array(z.string()),
});
const spawnInput = z.object({ soul: soulName, name: instanceName, task: z.string().min(1).max(100_000) });

/**
 * The harnesses a spawn, a start or a restart on bb may name: what the bb session provider
 * declares, in its order. `hostId` is the bb machine that holds the deployment, where bb's own
 * list of a harness's models is asked (app/spawn/models.ts); null before it is found.
 */
export const harnessList = z.object({ harnesses: z.array(z.string()), hostId: z.string().nullable() });
export type HarnessList = z.infer<typeof harnessList>;

export const rpc = defineRpcContract({
  /** One read for the New agent form and the Start and Restart dialogs. */
  spawnHarnesses: { input: z.null(), output: harnessList },
  spawnPreview: { input: spawnInput.strict(), output: z.object({ summary: spawnSummary }) },
  spawn: {
    input: spawnInput.extend({ key }).strict(),
    output: z.object({ instance: z.string(), threadId: z.string() }),
  },
});

const hostSpawn = z.object({ ...hostBase, ...spawnInput.shape });

export const host = defineRpcContract({
  /** `oats capabilities show oats.bb --json`. */
  spawnHarnesses: { experimental_retryable: true, input: z.object(hostBase).strict(), output: answer(z.object({ harnesses: z.array(z.string()) })) },
  /** `revision` is the kernel's decision revision for this soul, name and task. */
  spawnPreview: {
    experimental_retryable: true,
    input: hostSpawn.strict(),
    output: answer(z.object({ summary: spawnSummary, revision: z.string() })),
  },
  /**
   * The kernel takes an idempotency key only with the decision it confirms: `revision` is the
   * decision revision a `spawnPreview` of the same soul, name and task answered. Asked again with the
   * same key and revision, the kernel replays that spawn instead of making a second one.
   */
  spawn: {
    input: hostSpawn.extend({ key, revision: z.string() }).strict(),
    output: answer(z.object({ instance: z.string(), threadId: z.string().nullable() })),
  },
});
