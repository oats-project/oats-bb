// Spawn's RPC handlers: the preview, and the apply of exactly the previewed decision.
import type { ExperimentalPluginRpcHandlersWithContext } from "@get-bb/plugin-sdk";
import type { z } from "zod";
import type { rpc } from "../contract/spawn.js";
import { checkHarness, checkModel } from "../kernel/spawn.js";
import type { Agent } from "../model/types.js";
import { HOST_TIMEOUT, invalid, refusal, refusedWith, type Core, type Value } from "./core.js";
import { soulsOf } from "./workspace.js";

/**
 * The harnesses the bb session provider declares (`oats capabilities show oats.bb --json`), in its
 * order: one read for every client and every feature, reused like a page's answer. A spawn, a
 * start and a restart refuse a harness that is not in it before any process.
 */
export const harnessesOf = (core: Core): Promise<string[]> => core.page("spawnHarnesses", async (signal) => (await core.call("spawnHarnesses", {}, HOST_TIMEOUT.read, signal)).harnesses);

/**
 * The agents root an agent's home is in, for `--relative-root` (it tells same-named anchors
 * apart). The kernel's status names no agents root on a row: it names the home, which OATS lays
 * out as `<agents root>/<agent>/instances/<instance>` (docs/desktop-cli-api.md). So the root is
 * that home without its last three parts; a home of another shape names none, and none is passed.
 */
export function agentsRootOf(agent: Pick<Agent, "home" | "soul" | "instance">): string | null {
  const tail = `/${agent.soul}/instances/${agent.instance}`;
  return agent.home.startsWith("/") && agent.home.endsWith(tail) && agent.home.length > tail.length ? agent.home.slice(0, -tail.length) : null;
}

type Choices = z.infer<(typeof rpc)["spawnPlan"]["input"]>;
type HostChoices = Omit<Choices, "relation"> & { relation?: NonNullable<Choices["relation"]> & { root?: string } };

export const handlers = (core: Core): ExperimentalPluginRpcHandlersWithContext<typeof rpc> => {
  /** key -> the decision a spawn with that key applies, so that a retry replays it. */
  const spawns = new Map<string, { of: string; revision: string }>();
  /**
   * The choices, checked against what OATS lists, before any process: the soul is one `oats souls`
   * lists, a named harness one the bb session provider declares, a relation's instance an agent of
   * the roster. Answers them as the host entry takes them: a relation with its anchor's agents
   * root, from the roster's own row of it, never from the caller.
   */
  const checked = async ({ soul, name, task, harness, model, relation }: Choices): Promise<HostChoices> => {
    if (!(await soulsOf(core)).some((row) => row.name === soul)) throw invalid(`"${soul}" is not a soul \`oats souls\` lists for this deployment`);
    if (harness !== undefined) {
      const named = checkHarness(harness, await harnessesOf(core));
      if (!named.ok) throw invalid(named.error.message);
    }
    if (model !== undefined) {
      const named = checkModel(model);
      if (!named.ok) throw invalid(named.error.message);
    }
    let anchor: HostChoices["relation"];
    if (relation !== undefined) {
      const to = await core.agentOf(relation.to);
      const root = agentsRootOf(to);
      anchor = { ...relation, ...(root === null ? {} : { root }) };
    }
    // Only what was chosen goes to the host entry: a call carries no key without a value.
    return { soul, task, ...(name === undefined ? {} : { name }), ...(harness === undefined ? {} : { harness }), ...(model === undefined ? {} : { model }), ...(anchor === undefined ? {} : { relation: anchor }) };
  };
  return {
    /** What the bb session provider declares: one read for every client and every place that offers the choice. */
    async spawnHarnesses() {
      return { harnesses: await harnessesOf(core), hostId: core.target()?.hostId ?? null };
    },
    async spawnPreview(input, context) {
      const { summary } = await core.call("spawnPreview", await checked(input), HOST_TIMEOUT.preview, context.experimental_signal);
      return { summary };
    },
    async spawnPlan(input, context) {
      const { facts, revision, problem } = await core.call("spawnPreview", await checked(input), HOST_TIMEOUT.preview, context.experimental_signal);
      // No decision a spawn could apply: refused as the kernel's own refusals are, with its code.
      if (problem !== null) throw refusal(problem);
      return { facts, revision };
    },
    async spawn({ key, revision, ...input }) {
      const choices = await checked(input);
      // One key is one intent: the same choices, and the same decision when the caller names one.
      const of = JSON.stringify([choices, revision ?? null]);
      let decision = spawns.get(key);
      if (decision && decision.of !== of) throw invalid("this key already belongs to another spawn: a new spawn needs a new key");
      if (!decision) {
        // The kernel binds an idempotency key to the decision it confirms: the one the person saw
        // (`revision`, a preview's), else the decision as it is now, read first.
        decision = { of, revision: revision ?? (await core.call("spawnPreview", choices, HOST_TIMEOUT.preview, core.signal)).revision };
        if (spawns.size >= 200) spawns.delete(spawns.keys().next().value as string);
        spawns.set(key, decision);
      }
      // An act is not ended by its caller going away: only by the plugin's own end.
      let spawned: Value<"spawn">;
      try {
        spawned = await core.call("spawn", { ...choices, key, revision: decision.revision }, HOST_TIMEOUT.long, core.signal);
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
