// The instance panel's RPC handlers, one per verb of contract/panel.ts.
import type { ExperimentalPluginRpcHandlersWithContext } from "@get-bb/plugin-sdk";
import type { rpc } from "../contract/panel.js";
import { parsePanelInstance } from "../kernel/panel-instance.js";
import type { Soul } from "../model/types.js";
import { refusal, type Core } from "./core.js";
import { soulsOf } from "./workspace.js";

export const handlers = (core: Core): ExperimentalPluginRpcHandlersWithContext<typeof rpc> => ({
  /**
   * No process of its own: the facts are read from the row the shared status read kept. The soul's
   * key and description are `oats souls`' (the answer the Souls page shares, reused for a while).
   */
  async panelInstance({ instance }) {
    const held: { at: string; row: unknown; root?: unknown } = await core.rowOf(instance);
    const { at, row } = held;
    const facts = parsePanelInstance(row);
    if (!facts.ok) throw refusal(facts.error);
    let listed: Soul | undefined;
    try {
      listed = (await soulsOf(core)).find((soul) => soul.agent === facts.value.soul);
    } catch {
      // The souls could not be listed: the row's own facts stand, and the soul's key and description are unreported.
      listed = undefined;
    }
    return { at, facts: facts.value, agentsRoot: typeof held.root === "string" && held.root !== "" ? held.root : null, soul: { key: listed?.name ?? null, description: listed?.description ? listed.description : null } };
  },
});
