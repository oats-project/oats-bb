// The outside feature's RPC method as a slot test's default: a kernel that lists the feature and
// reports nothing of any agent (every row as the pinned sample has it: no `sessionEnd`, no report).
import type { PluginRpcTestHandlers } from "@get-bb/plugin-sdk/testing/app";
import type { rpc } from "../../contract/outside";

export const OUTSIDE_AT = "2026-11-19T12:30:00.000Z";

export const defaults = (): PluginRpcTestHandlers<typeof rpc> => ({
  outsideFacts: () => ({ at: OUTSIDE_AT, feature: true, rows: [] }),
});
