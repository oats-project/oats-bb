// The instance panel's RPC handlers, one per verb of contract/panel.ts.
import type { ExperimentalPluginRpcHandlersWithContext } from "@get-bb/plugin-sdk";
import type { rpc } from "../contract/panel.js";
import { parsePanelInstance } from "../kernel/panel-instance.js";
import { refusal, type Core } from "./core.js";

const text = (value: unknown): string | null => (typeof value === "string" && value !== "" ? value : null);

export const handlers = (core: Core): ExperimentalPluginRpcHandlersWithContext<typeof rpc> => ({
  /**
   * No process of its own: the facts are read from what the shared status read kept, as the kernel
   * printed it. The instance's own row, the roster's root, and from the row of its agent group
   * the soul's key and description.
   */
  async panelInstance({ instance }) {
    const { at, root, row, agent } = await core.rowOf(instance);
    const facts = parsePanelInstance(row);
    if (!facts.ok) throw refusal(facts.error);
    return { at, facts: facts.value, agentsRoot: text(root), soul: { key: text(agent.key), description: text(agent.description) } };
  },
});
