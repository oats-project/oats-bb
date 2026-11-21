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

export const rpc = defineRpcContract({
  spawnPreview: { input: spawnInput.strict(), output: z.object({ summary: spawnSummary }) },
  spawn: {
    input: spawnInput.extend({ key }).strict(),
    output: z.object({ instance: z.string(), threadId: z.string() }),
  },
});

const hostSpawn = z.object({ ...hostBase, ...spawnInput.shape });

export const host = defineRpcContract({
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
