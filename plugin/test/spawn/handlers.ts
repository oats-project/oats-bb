// Spawn's RPC methods: no slot test reaches them unless it is about them.
import type { PluginRpcTestHandlers } from "@get-bb/plugin-sdk/testing/app";
import type { rpc } from "../../contract/spawn";
import { unexpected } from "../helpers/unexpected";

export const defaults = (): PluginRpcTestHandlers<typeof rpc> => ({
  // What the bb session provider declares on main, and the machine bb's own model list is asked of.
  spawnHarnesses: () => ({ harnesses: ["claude", "pi"], hostId: "host_falcon" }),
  spawnPreview: unexpected("spawnPreview"),
  spawnPlan: unexpected("spawnPlan"),
  spawn: unexpected("spawn"),
});
