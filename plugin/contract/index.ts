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
import * as board from "./board.js";
import * as home from "./home.js";
import * as lifecycle from "./lifecycle.js";
import * as mail from "./mail.js";
import * as panel from "./panel.js";
import * as roster from "./roster.js";
import * as spawn from "./spawn.js";
import * as terminal from "./terminal.js";
import * as workspace from "./workspace.js";

export { instanceName } from "./shared.js";
export { agent, snapshot } from "./roster.js";
export { capability, hostCapability, machine, soul, team } from "./workspace.js";

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
  ...terminal.rpc,
  ...mail.rpc,
  ...board.rpc,
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
  ...terminal.host,
  ...mail.host,
  ...board.host,
};

/** The closed list of the host's verbs: the methods of `hostContract`. */
export const hostVerbs = Object.keys(hostContract) as (keyof typeof hostContract)[];

/** The most event files one `changed` signal names: a batch larger than this (a sweep, a mass stop) names none, and the status read carries it. */
export const CHANGED_FILES_MAX = 8;
/**
 * The name of one instance's file in the deployment's event log, `<agent>--<instance>.jsonl`: the
 * base name alone, never a path. The server only uses it to SELECT a row of its own snapshot (the
 * instance and the home it then reads are that row's).
 */
export const eventFileName = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,200}--[a-z0-9][a-z0-9-]{0,62}\.jsonl$/);
export const hostSignals = {
  /**
   * The deployment's event log changed. `reason` is the watcher's word ("changed", a rescan, an
   * error); `files` names the instances' files that changed, where the watcher said which and they
   * are few: empty for a rescan, an error, a batch over CHANGED_FILES_MAX, or names that are none.
   */
  changed: { payload: z.object({ reason: z.string(), files: z.array(eventFileName).max(CHANGED_FILES_MAX) }).strict() },
} satisfies ExperimentalHostSignals;
