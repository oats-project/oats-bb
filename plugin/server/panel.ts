// The instance panel's RPC handlers, one per verb of contract/panel.ts.
import type { ExperimentalPluginRpcHandlersWithContext } from "@get-bb/plugin-sdk";
import type { rpc } from "../contract/panel.js";
import { parsePanelInstance, text } from "../kernel/panel-instance.js";
import { HOST_TIMEOUT, invalid, refusal, type Core } from "./core.js";

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
  /** The soul as the instance was spawned from it: `oats inspect --home`, of the home the kernel named. */
  async panelSoul({ instance }, context) {
    const agent = await core.agentOf(instance);
    return core.call("panelSoul", { home: agent.home }, HOST_TIMEOUT.read, context.experimental_signal);
  },
  /** The instance's recorded lifecycle events: `oats instance events`, of that exact home. */
  async panelEvents({ instance }, context) {
    const agent = await core.agentOf(instance);
    return core.call("panelEvents", { instance, home: agent.home }, HOST_TIMEOUT.read, context.experimental_signal);
  },
  /** `oats readiness` of the instance's home, or of its soul by the key the roster's agent row names. */
  async panelReadiness({ instance, of }, context) {
    if (of === "instance") {
      const agent = await core.agentOf(instance);
      return core.call("panelReadiness", { home: agent.home }, HOST_TIMEOUT.read, context.experimental_signal);
    }
    const soul = text((await core.rowOf(instance)).agent.key);
    if (soul === null) throw invalid(`OATS names no soul for "${instance}" in this deployment, so its soul's readiness cannot be read`);
    return core.call("panelSoulReadiness", { soul }, HOST_TIMEOUT.read, context.experimental_signal);
  },
});
