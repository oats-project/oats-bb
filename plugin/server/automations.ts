// Automations' RPC handlers: its developer adds them here, one per verb of contract/automations.ts.
import type { ExperimentalPluginRpcHandlersWithContext } from "@get-bb/plugin-sdk";
import type { rpc } from "../contract/automations.js";
import type { Core } from "./core.js";

export const handlers = (_core: Core): ExperimentalPluginRpcHandlersWithContext<typeof rpc> => ({});
