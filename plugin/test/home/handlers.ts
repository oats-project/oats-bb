// The home has no RPC method of its own yet.
import type { PluginRpcTestHandlers } from "@get-bb/plugin-sdk/testing/app";
import type { rpc } from "../../contract/home";

export const defaults = (): PluginRpcTestHandlers<typeof rpc> => ({});
