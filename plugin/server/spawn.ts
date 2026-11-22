// Spawn's RPC handlers: the preview, and the apply of exactly the previewed decision.
import type { ExperimentalPluginRpcHandlersWithContext } from "@get-bb/plugin-sdk";
import type { rpc, SpawnRequest } from "../contract/spawn.js";
import { HOST_TIMEOUT, invalid, refusedWith, type Core, type Value } from "./core.js";
import { soulsOf } from "./workspace.js";

/**
 * The harnesses the bb session provider declares (`oats capabilities show oats.bb --json`), in its
 * order: one read for every client and every feature, reused like a page's answer. A spawn, a
 * start and a restart refuse a harness that is not in it before any process.
 */
export const harnessesOf = (core: Core): Promise<string[]> => core.page("spawnHarnesses", async (signal) => (await core.call("spawnHarnesses", {}, HOST_TIMEOUT.read, signal)).harnesses);

export const handlers = (core: Core): ExperimentalPluginRpcHandlersWithContext<typeof rpc> => {
  /** key -> the decision a spawn with that key applies, so that a retry replays it. `of` is every choice of the spawn. */
  const spawns = new Map<string, { of: string; revision: string }>();
  /**
   * What a spawn may name: a soul `oats souls` lists, a harness the provider declares, and for a
   * relationship an agent of the roster. Anything else starts no process.
   */
  const checked = async (request: SpawnRequest): Promise<SpawnRequest> => {
    if (!(await soulsOf(core)).some((row) => row.name === request.soul)) throw invalid(`"${request.soul}" is not a soul \`oats souls\` lists for this deployment`);
    if (request.harness !== undefined && !(await harnessesOf(core)).includes(request.harness)) throw invalid(`"${request.harness}" is not a harness the bb session provider declares`);
    if (request.relation !== undefined) await core.agentOf(request.relation.to);
    return request;
  };
  return {
    /** What the bb session provider declares: one read for every client and every place that offers the choice. */
    async spawnHarnesses() {
      return { harnesses: await harnessesOf(core), hostId: core.target()?.hostId ?? null };
    },
    async spawnPreview(request, context) {
      const { summary } = await core.call("spawnPreview", await checked(request), HOST_TIMEOUT.preview, context.experimental_signal);
      return { summary };
    },
    async spawnPlan(request, context) {
      const { summary, facts, instance, background } = await core.call("spawnPreview", await checked(request), HOST_TIMEOUT.preview, context.experimental_signal);
      return { summary, facts, instance, background };
    },
    async spawn({ key, ...request }) {
      await checked(request);
      const of = JSON.stringify(request);
      let decision = spawns.get(key);
      if (decision && decision.of !== of) throw invalid("this key already belongs to another spawn: a new spawn needs a new key");
      if (!decision) {
        // The kernel binds an idempotency key to the decision it confirms: read that decision first.
        const preview = await core.call("spawnPreview", request, HOST_TIMEOUT.preview, core.signal);
        decision = { of, revision: preview.revision };
        if (spawns.size >= 200) spawns.delete(spawns.keys().next().value as string);
        spawns.set(key, decision);
      }
      // An act is not ended by its caller going away: only by the plugin's own end.
      let spawned: Value<"spawn">;
      try {
        spawned = await core.call("spawn", { ...request, key, revision: decision.revision }, HOST_TIMEOUT.long, core.signal);
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
