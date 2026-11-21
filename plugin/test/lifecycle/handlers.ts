// The lifecycle's RPC methods: no slot test reaches them unless it is about them.
import type { PluginRpcTestHandlers } from "@get-bb/plugin-sdk/testing/app";
import type { rpc } from "../../contract/lifecycle";
import { unexpected } from "../helpers/unexpected";

export const defaults = (): PluginRpcTestHandlers<typeof rpc> => ({
  stopPlan: unexpected("stopPlan"),
  stopApply: unexpected("stopApply"),
  start: unexpected("start"),
  restart: unexpected("restart"),
  retirePlan: unexpected("retirePlan"),
  retireApply: unexpected("retireApply"),
});
