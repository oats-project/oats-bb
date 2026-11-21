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
  waiting: z
    .object({ reason: z.string(), message: z.string().nullable(), since: z.string().nullable() })
    .nullable(),
});

export const snapshot = z.union([
  z.object({
    ok: z.literal(true),
    at: z.string(),
    deployment: z.object({ root: z.string(), workspace: z.string(), machine: z.string() }),
    agents: z.array(agent),
  }),
  z.object({ ok: z.literal(false), at: z.string(), code: z.string(), message: z.string() }),
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
    /** `rows[n]` is the kernel's own row of `agents[n]`, whole: the server keeps it for the features (server/core.ts). */
    output: answer(
      z.object({ root: z.string(), workspace: z.string().nullable(), agents: z.array(agent), rows: z.array(z.record(z.string(), z.unknown())) }),
    ),
  },
  /** Watches the deployment's event log; each batch is one `changed` signal. Null: nothing to watch yet. */
  watch: {
    input: z.object({ deployment: z.string().min(1) }).strict(),
    output: z.object({ watching: z.string().nullable() }),
  },
});
