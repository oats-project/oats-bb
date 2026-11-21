// The lifecycle's RPC handlers: stop, start, restart and retire, each through OATS.
import type { ExperimentalPluginRpcHandlersWithContext } from "@get-bb/plugin-sdk";
import type { rpc } from "../contract/lifecycle.js";
import { HOST_TIMEOUT, type Core, type Value } from "./core.js";

export const handlers = (core: Core): ExperimentalPluginRpcHandlersWithContext<typeof rpc> => ({
  async stopPlan({ instance }, context) {
    await core.agentOf(instance);
    return core.call("stopPlan", { instance }, HOST_TIMEOUT.read, context.experimental_signal);
  },
  async stopApply({ instance, revision, key }) {
    await core.agentOf(instance);
    try {
      await core.call("stopApply", { instance, revision, key }, HOST_TIMEOUT.act, core.lifetime.signal);
    } finally {
      core.rereadSoon();
    }
    return { ok: true as const };
  },
  async start({ instance }) {
    const agent = await core.agentOf(instance);
    let started: Value<"start">;
    try {
      started = await core.call("start", { home: agent.home }, HOST_TIMEOUT.act, core.lifetime.signal);
    } finally {
      core.rereadSoon();
    }
    return { threadId: await core.threadOf(instance, started.threadId, "Started") };
  },
  async restart({ instance }) {
    const agent = await core.agentOf(instance);
    let started: Value<"restart">;
    try {
      started = await core.call("restart", { home: agent.home }, HOST_TIMEOUT.act, core.lifetime.signal);
    } finally {
      core.rereadSoon();
    }
    return { threadId: await core.threadOf(instance, started.threadId, "Restarted") };
  },
  async retirePlan({ instance }, context) {
    await core.agentOf(instance);
    return core.call("retirePlan", { instance }, HOST_TIMEOUT.read, context.experimental_signal);
  },
  async retireApply({ instance, revision, key }) {
    await core.agentOf(instance);
    try {
      await core.call("retireApply", { instance, revision, key }, HOST_TIMEOUT.long, core.lifetime.signal);
    } finally {
      core.rereadSoon();
    }
    return { ok: true as const };
  },
});
