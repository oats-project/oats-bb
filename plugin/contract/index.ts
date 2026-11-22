// The contracts between the plugin's three parts, composed from one module per feature
// (contract/<feature>.ts: its schemas, its RPC verbs and its host verbs).
//   app.tsx -> server.ts : rpcContract (bb.rpc)
//   server.ts -> host.ts : hostContract (bb.hosts), signal `changed`
//   server.ts -> app.tsx : realtime channel REALTIME_CHANGED, payload { at }
// A new feature adds its module and one line to each of the two lists below; a verb is added in the
// feature's own module, never here.
import type { ExperimentalHostSignals } from "@get-bb/plugin-sdk";
import { z } from "zod";
import * as automations from "./automations.js";
import * as home from "./home.js";
import * as lifecycle from "./lifecycle.js";
import * as outside from "./outside.js";
import * as panel from "./panel.js";
import * as roster from "./roster.js";
import * as spawn from "./spawn.js";
import * as workspace from "./workspace.js";

export { instanceName } from "./shared.js";
export { agent, snapshot } from "./roster.js";
export { capability, hostCapability, machine, soul, team } from "./workspace.js";
export { spawnSummary } from "./spawn.js";

export const REALTIME_CHANGED = "oats/changed";

/** app -> server. */
export const rpcContract = {
  ...roster.rpc,
  ...home.rpc,
  ...workspace.rpc,
  ...spawn.rpc,
  ...lifecycle.rpc,
  ...automations.rpc,
  ...panel.rpc,
  ...outside.rpc,
};

/**
 * server -> host. The host entry builds every argv itself from a closed list of verbs: the server
 * never sends a command, a flag or a path other than the deployment and the home the kernel named.
 * Each verb has its own typed input (deployment root, oats binary, and that verb's arguments), and
 * the read verbs are marked `experimental_retryable`.
 */
export const hostContract = {
  ...roster.host,
  ...home.host,
  ...workspace.host,
  ...spawn.host,
  ...lifecycle.host,
  ...automations.host,
  ...panel.host,
  ...outside.host,
};

/** The closed list of the host's verbs: the methods of `hostContract`. */
export const hostVerbs = Object.keys(hostContract) as (keyof typeof hostContract)[];

export const hostSignals = {
  changed: { payload: z.object({ reason: z.string() }).strict() },
} satisfies ExperimentalHostSignals;
