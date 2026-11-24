// bb.server entry: composes the RPC handlers of every feature (server/<feature>.ts) over what
// they share (server/core.ts: the settings, where `oats` runs, one cached snapshot for all clients
// and the realtime invalidation). It runs no process: every `oats` runs in the host entry
// (host.ts), on the machine that holds the homes, and the server never sends an argv.
// A new feature adds its module and one line below; a handler is added in the feature's own module.
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { rpcContract } from "./contract/index.js";
import * as automations from "./server/automations.js";
import { createCore } from "./server/core.js";
import * as home from "./server/home.js";
import * as lifecycle from "./server/lifecycle.js";
import * as panel from "./server/panel.js";
import * as roster from "./server/roster.js";
import * as spawn from "./server/spawn.js";
import * as workspace from "./server/workspace.js";

export { rpcContract } from "./contract/index.js";
export { EVENTS_READS_MAX, HOST_TIMEOUT, MIN_INTERVAL_MS, POLL_MS } from "./server/core.js";

export default async function plugin(bb: BbPluginApi) {
  const core = createCore(bb);
  bb.rpc.register(rpcContract, {
    ...roster.handlers(core),
    ...home.handlers(core),
    ...workspace.handlers(core),
    ...spawn.handlers(core),
    ...lifecycle.handlers(core),
    ...automations.handlers(core),
    ...panel.handlers(core),
  });
  core.start();
}
