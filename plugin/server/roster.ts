// The roster's RPC handlers: the one cached snapshot (server/core.ts keeps it), and Retry.
import type { ExperimentalPluginRpcHandlersWithContext } from "@get-bb/plugin-sdk";
import type { rpc } from "../contract/roster.js";
import type { Core } from "./core.js";

export const handlers = (core: Core): ExperimentalPluginRpcHandlersWithContext<typeof rpc> => ({
  snapshot: () => core.clientSnapshot(),
  refresh: () => core.clientRefresh(),
});
