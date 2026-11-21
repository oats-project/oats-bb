// The roster's RPC methods as the server would answer them from the pinned fixtures.
import type { PluginRpcTestHandlers } from "@get-bb/plugin-sdk/testing/app";
import type { rpc } from "../../contract/roster";
import type { Agent } from "../../model/types";
import { fixtureAgents, fixtureSnapshot } from "../helpers/fixtures";

export const defaults = (agents: Agent[] = fixtureAgents()): PluginRpcTestHandlers<typeof rpc> => ({
  snapshot: () => fixtureSnapshot(agents),
  refresh: () => ({ at: "2026-11-19T12:31:00.000Z" }),
});
