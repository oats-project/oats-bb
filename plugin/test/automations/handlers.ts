// The feature's RPC methods as a slot test's default: its developer adds one per verb of contract/automations.ts.
import type { PluginRpcTestHandlers } from "@get-bb/plugin-sdk/testing/app";
import type { rpc } from "../../contract/automations";

export const defaults = (): PluginRpcTestHandlers<typeof rpc> => ({});
