// The roster: the agents of `oats status --json`, as one cached snapshot for all clients.
import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { answer, hostRead } from "./shared.js";

export const agent = z.object({
  instance: z.string(),
  soul: z.string(),
  home: z.string(),
  parent: z.string().nullable(),
  human: z.string().nullable(),
  alias: z.string().nullable(),
  team: z.string().nullable(),
  address: z.string().nullable(),
  backend: z.string(),
  server: z.string().nullable(),
  projectId: z.string().nullable(),
  threadId: z.string().nullable(),
  running: z.boolean().nullable(),
  runtimeState: z.string().nullable(),
  runtimeError: z.string().nullable(),
  /** When the agent's session started, as the kernel's row says it; absent where the row names none. */
  startedAt: z.string().nullish(),
  waiting: z
    .object({ reason: z.string(), message: z.string().nullable(), since: z.string().nullable() })
    .nullable(),
});

const raw = z.record(z.string(), z.unknown());
const rawRow = z.object({ row: raw, agent: raw });

const deployment = z.object({ root: z.string(), workspace: z.string(), machine: z.string() });

/**
 * The roster as last read, or why it cannot be read now. A failure carries `last`: the last roster
 * the server read since it started (its `at` is when), so that every place keeps showing it, with
 * its age, while OATS cannot be read; null when none was ever read.
 */
export const snapshot = z.union([
  z.object({ ok: z.literal(true), at: z.string(), deployment, agents: z.array(agent) }),
  z.object({
    ok: z.literal(false),
    at: z.string(),
    code: z.string(),
    message: z.string(),
    /** The machine `oats` was looked for on, by the name bb gives it; absent or null when no machine was chosen. */
    machine: z.string().nullish(),
    last: z.object({ at: z.string(), deployment, agents: z.array(agent) }).nullish(),
  }),
]);

/** app -> server. `refresh` asks the server to reread now (Retry). */
export const rpc = defineRpcContract({
  snapshot: { input: z.null(), output: snapshot },
  refresh: { input: z.null(), output: z.object({ at: z.string() }) },
});

/** server -> host. */
export const host = defineRpcContract({
  /**
   * Finds the deployment directory. `deployment` is the setting ("" = walk up from each of `roots`,
   * the bb project roots on this machine, to the first directory holding `oats-local.yaml`).
   */
  discover: {
    experimental_retryable: true,
    input: z.object({ deployment: z.string(), roots: z.array(z.string()) }).strict(),
    output: z.object({ deployment: z.string().nullable(), machine: z.string() }),
  },
  status: {
    experimental_retryable: true,
    input: hostRead,
    /**
     * `rows[n]` is what the kernel printed for `agents[n]`, whole: its own row, and its agent group's
     * row without the instances. The server keeps them for the features (server/core.ts).
     */
    output: answer(z.object({ root: z.string(), workspace: z.string().nullable(), agents: z.array(agent), rows: z.array(rawRow) })),
  },
  /** `oats version --json`: the kernel's release, its features, and the version of each of its answers (`apis`). */
  version: {
    experimental_retryable: true,
    input: hostRead,
    output: answer(z.object({ version: z.string(), desktopApi: z.number().nullable(), features: z.array(z.string()), apis: z.record(z.string(), z.number()) })),
  },
  /** Watches the deployment's event log; each batch is one `changed` signal. Null: nothing to watch yet. */
  watch: {
    input: z.object({ deployment: z.string().min(1) }).strict(),
    output: z.object({ watching: z.string().nullable() }),
  },
});
