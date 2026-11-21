// Spawn's RPC methods: no slot test reaches them unless it is about them.
import type { PluginRpcTestHandlers } from "@get-bb/plugin-sdk/testing/app";
import type { rpc } from "../../contract/spawn";
import { unexpected } from "../helpers/unexpected";

export const defaults = (): PluginRpcTestHandlers<typeof rpc> => ({
  spawnPreview: unexpected("spawnPreview"),
  spawn: unexpected("spawn"),
});
