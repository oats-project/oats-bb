// Spawn's RPC handlers: the preview, and the apply of exactly the previewed decision.
import type { ExperimentalPluginRpcHandlersWithContext } from "@get-bb/plugin-sdk";
import type { z } from "zod";
import type { host, rpc } from "../contract/spawn.js";
import { checkHarness, checkModel, idsOf } from "../kernel/spawn.js";
import type { Agent } from "../model/types.js";
import { HOST_TIMEOUT, invalid, refusal, refusedWith, type Core, type Value } from "./core.js";
import { soulsOf } from "./workspace.js";

/**
 * The harnesses the bb session provider declares (`oats capabilities show oats.bb --json`), in its
 * order: one read for every client and every feature, reused like a page's answer. A spawn, a
 * start and a restart refuse a harness that is not in it before any process.
 */
export const harnessesOf = async (core: Core): Promise<string[]> => (await synced(core)).harnesses;
/** The provider's read, for whatever ACTS on it (a spawn, a start that names a harness): a provider that is pinned and not synced is the kernel's refusal, with its sentence (which names `oats sync`). Only the New agent form's own read takes it as an answer, to say the way on. */
const synced = async (core: Core): Promise<Value<"spawnHarnesses">> => {
  const provider = await providerOf(core);
  if (provider.unsynced !== undefined) throw refusal(provider.unsynced);
  return provider;
};
/**
 * The bb session provider's own version, as the kernel prints it for the capability the
 * deployment resolves (a release, or a commit for one taken from a repository); null when the
 * kernel prints none. From the same read as the harness list: no second process.
 */
export const providerVersionOf = async (core: Core): Promise<string | null> => (await providerOf(core)).version;
/**
 * The harnesses the kernel launches itself: what a spawn that is not a bb thread (a deployment with no bb session
 * provider) may name. From the version read every feature shares: no process of its own. Only ids, each once: nothing
 * else of the kernel's list is offered, drawn or named.
 */
const kernelHarnessesOf = async (core: Core): Promise<string[]> => idsOf((await core.versionOf()).harnesses);
/** The one read behind both (`oats capabilities show oats.bb --json`), kept like a page's answer. */
const providerOf = (core: Core): Promise<Value<"spawnHarnesses">> => core.page("spawnHarnesses", (signal) => core.call("spawnHarnesses", {}, HOST_TIMEOUT.read, signal));

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

/** SHA-256 of a text, in hex: what a key is remembered by. */
async function digest(text: string): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

type Choices = z.infer<(typeof rpc)["spawnPlan"]["input"]>;
/** The same as the host entry takes them: the host contract's own shape, without where `oats` runs. */
type HostChoices = Omit<z.infer<(typeof host)["spawnPreview"]["input"]>, "deployment" | "oatsBin">;

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
    // Where it runs. A deployment with no bb session provider: the spawn names no backend.
    let absent: boolean;
    if (harness === undefined) {
      // NOTHING of a list is named, so no list is needed: the spawn does not wait on them. A provider read that
      // FAILS (an answer the plugin cannot read, a timeout, a member with no such capability) leaves the spawn what it
      // always was: a bb thread on the soul's default, which the kernel takes or refuses in its
      // own words (the form says "the soul's default is used"). What the read ANSWERS still decides: no provider (the
      // kernel's own place), or pinned and not synced (refused, with the way on).
      const provider = await providerOf(core).catch((): null => null);
      if (provider !== null && provider.unsynced !== undefined) throw refusal(provider.unsynced);
      absent = provider !== null && provider.absent === true;
    } else {
      // A harness IS named: it is one of a list, so the read of where the list is must answer.
      absent = (await synced(core)).absent === true;
    }
    const onBb = !absent;
    if (harness !== undefined) {
      // A bb thread: a harness the provider declares. Anywhere else: one the kernel itself launches.
      const named = onBb ? checkHarness(harness, await harnessesOf(core)) : checkHarness(harness, await kernelHarnessesOf(core), "this OATS launches");
      if (!named.ok) throw invalid(named.error.message);
    }
    if (model !== undefined) {
      const named = checkModel(model);
      if (!named.ok) throw invalid(named.error.message);
    }
    let anchor: HostChoices["relation"];
    if (relation !== undefined) {
      // A spawn is an act: its anchor is an agent of the roster as it is NOW (held while OATS cannot be read, like the acts).
      const to = await core.agentForAct(relation.to);
      const root = agentsRootOf(to);
      anchor = { ...relation, ...(root === null ? {} : { root }) };
    }
    // Only what was chosen goes to the host entry: a call carries no key without a value.
    return { soul, task, ...(name === undefined ? {} : { name }), ...(harness === undefined ? {} : { harness }), ...(model === undefined ? {} : { model }), ...(anchor === undefined ? {} : { relation: anchor }), ...(absent ? { provider: false } : {}) };
  };
  return {
    /** What the bb session provider declares: one read for every client and every place that offers the choice. */
    async spawnHarnesses() {
      const provider = await providerOf(core);
      // Pinned and not synced: the form's read answers it (the way on is said there); nothing else is offered.
      if (provider.unsynced !== undefined) return { harnesses: [], hostId: core.target()?.hostId ?? null, unsynced: provider.unsynced };
      // No provider: the harnesses a spawn may name are the kernel's own (one more shared read, asked only there).
      if (provider.absent === true) return { harnesses: [], hostId: core.target()?.hostId ?? null, provider: false, kernelHarnesses: await kernelHarnessesOf(core) };
      return { harnesses: provider.harnesses, hostId: core.target()?.hostId ?? null, provider: true };
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
      // Kept as a digest: a task may be 100 000 characters, and a caller has no login.
      const of = await digest(JSON.stringify([choices, revision ?? null]));
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
      // Where the deployment has no bb session provider the new agent has no bb thread, and none is asked for: it runs where the kernel decided.
      if (choices.provider === false) return { instance: spawned.instance, threadId: spawned.threadId };
      return { instance: spawned.instance, threadId: await core.threadOf(spawned.instance, spawned.threadId, "Spawned") };
    },
  };
};
