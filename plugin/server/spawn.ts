// Spawn's RPC handlers: the preview, and the apply of exactly the previewed decision.
import type { ExperimentalPluginRpcHandlersWithContext } from "@get-bb/plugin-sdk";
import type { rpc } from "../contract/spawn.js";
import { HOST_TIMEOUT, invalid, refusedWith, type Core, type Value } from "./core.js";
import { soulsOf } from "./workspace.js";

export const handlers = (core: Core): ExperimentalPluginRpcHandlersWithContext<typeof rpc> => {
  /** key -> the decision a spawn with that key applies, so that a retry replays it. */
  const spawns = new Map<string, { soul: string; name: string; revision: string }>();
  return {
    async spawnPreview({ soul, name, task }, context) {
      if (!(await soulsOf(core)).some((row) => row.name === soul)) throw invalid(`"${soul}" is not a soul \`oats souls\` lists for this deployment`);
      const { summary } = await core.call("spawnPreview", { soul, name, task }, HOST_TIMEOUT.preview, context.experimental_signal);
      return { summary };
    },
    async spawn({ soul, name, task, key }) {
      if (!(await soulsOf(core)).some((row) => row.name === soul)) throw invalid(`"${soul}" is not a soul \`oats souls\` lists for this deployment`);
      let decision = spawns.get(key);
      if (decision && (decision.soul !== soul || decision.name !== name)) throw invalid("this key already belongs to another spawn: a new spawn needs a new key");
      if (!decision) {
        // The kernel binds an idempotency key to the decision it confirms: read that decision first.
        const preview = await core.call("spawnPreview", { soul, name, task }, HOST_TIMEOUT.preview, core.signal);
        decision = { soul, name, revision: preview.revision };
        if (spawns.size >= 200) spawns.delete(spawns.keys().next().value as string);
        spawns.set(key, decision);
      }
      // An act is not ended by its caller going away: only by the plugin's own end.
      let spawned: Value<"spawn">;
      try {
        spawned = await core.call("spawn", { soul, name, task, key, revision: decision.revision }, HOST_TIMEOUT.long, core.signal);
      } catch (error) {
        // The decision moved and the kernel created nothing: there is nothing to replay under this
        // key, so the next call with it reads the decision again instead of sending the stale one.
        if (error instanceof Error && refusedWith.get(error) === "E_DECISION_STALE") spawns.delete(key);
        throw error;
      } finally {
        core.rereadSoon();
      }
      return { instance: spawned.instance, threadId: await core.threadOf(spawned.instance, spawned.threadId, "Spawned") };
    },
  };
};
