// The four pages' RPC handlers: one answer per page for all clients, reused for a while.
import type { ExperimentalPluginRpcHandlersWithContext } from "@get-bb/plugin-sdk";
import type { rpc } from "../contract/workspace.js";
import { withSoulCounts } from "../kernel/workspace.js";
import type { Capability, Machine, Soul, Team } from "../model/types.js";
import { HOST_TIMEOUT, type Core } from "./core.js";

/** The souls `oats souls` lists: the Souls page's rows, and what a spawn's soul is checked against. */
export const soulsOf = (core: Core): Promise<Soul[]> =>
  core.page("souls", async (signal) => (await core.call("souls", {}, HOST_TIMEOUT.read, signal)).souls);

export const handlers = (core: Core): ExperimentalPluginRpcHandlersWithContext<typeof rpc> => ({
  async souls() {
    return { souls: await soulsOf(core) };
  },
  async capabilities() {
    const capabilities = await core.page<Capability[]>("capabilities", async (signal) =>
      withSoulCounts((await core.call("capabilities", {}, HOST_TIMEOUT.read, signal)).capabilities, await soulsOf(core)),
    );
    return { capabilities };
  },
  async teams() {
    const teams = await core.page<Team[]>("teams", async (signal) => (await core.call("teams", {}, HOST_TIMEOUT.read, signal)).teams);
    return { teams };
  },
  async machines() {
    const machines = await core.page<Machine[]>("machines", async (signal) => {
      const registered = (await core.call("servers", {}, HOST_TIMEOUT.read, signal)).machines;
      const target = core.target();
      const here: Machine[] = target ? [{ id: target.machine, route: null, isThisMachine: true, note: target.deployment }] : [];
      return [...here, ...registered];
    });
    return { machines };
  },
});
