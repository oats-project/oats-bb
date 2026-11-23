// The home's RPC verbs as the server would answer them for the fixtures: the recorded `oats version --json` is a tested one.
import type { PluginRpcTestHandlers } from "@get-bb/plugin-sdk/testing/app";
import type { rpc } from "../../contract/home";

export const defaults = (): PluginRpcTestHandlers<typeof rpc> => ({
  homeCli: () => ({ version: "0.70.5", desktopApi: 1, state: "tested" as const }),
});
