// The OATS home has no RPC verb of its own yet (contract/home.ts).
import type { ExperimentalPluginRpcHandlersWithContext } from "@get-bb/plugin-sdk";
import type { rpc } from "../contract/home.js";
import type { Core } from "./core.js";

export const handlers = (_core: Core): ExperimentalPluginRpcHandlersWithContext<typeof rpc> => ({});
