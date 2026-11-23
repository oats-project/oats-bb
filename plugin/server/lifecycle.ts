// The lifecycle's RPC handlers: stop, start, restart and retire, each through OATS.
import type { ExperimentalPluginRpcHandlersWithContext } from "@get-bb/plugin-sdk";
import { z } from "zod";
import type { rpc } from "../contract/lifecycle.js";
import { HOST_TIMEOUT, invalid, type Core, type Value } from "./core.js";
import { harnessesOf } from "./spawn.js";

/** What the Start and Restart dialogs show of the kernel's own row, beside what `Agent` holds. */
const launch = z.looseObject({ harness: z.string().nullish(), model: z.string().nullish() });

/** Only what was given: a host call's input is JSON, which has no `undefined`. */
const given = <Fields extends Record<string, unknown>>(fields: Fields): { [Key in keyof Fields]?: Exclude<Fields[Key], undefined> } =>
  Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined)) as { [Key in keyof Fields]?: Exclude<Fields[Key], undefined> };

export const handlers = (core: Core): ExperimentalPluginRpcHandlersWithContext<typeof rpc> => {
  /**
   * The retires this server sent, by their key: the instance and the plan's revision each was for.
   * "Check again" asks for the answer to one of them with the same key, and the kernel replays its
   * receipt; by then the retire may have removed the agent, and the roster no longer names it. So
   * a key sent before, for the same instance and revision, is not held to the roster again:
   * nothing new can be done under it (the kernel answers a used key with what it did). Any other
   * key is a new act, on an agent the kernel names now.
   */
  const retires = new Map<string, { instance: string; revision: string }>();
  /** A harness a caller names must be one the provider declares: nothing else reaches the argv. */
  async function chosen(harness: string | undefined): Promise<string | undefined> {
    if (harness === undefined) return undefined;
    if (!(await harnessesOf(core)).includes(harness)) throw invalid(`"${harness}" is not a harness the bb session provider declares`);
    return harness;
  }
  async function begin(verb: "start" | "restart", { instance, harness, model }: { instance: string; harness?: string | undefined; model?: string | undefined }) {
    const agent = await core.agentForAct(instance);
    const choice = given({ harness: await chosen(harness), model });
    let started: Value<"start">;
    try {
      started = await core.call(verb, { home: agent.home, ...choice }, HOST_TIMEOUT.act, core.signal);
    } finally {
      core.rereadSoon();
    }
    return { ...started, threadId: await core.threadOf(instance, started.threadId, verb === "start" ? "Started" : "Restarted") };
  }
  return {
    async stopPlan({ instance, recursive }, context) {
      await core.agentForAct(instance);
      return core.call("stopPlan", { instance, ...given({ recursive }) }, HOST_TIMEOUT.read, context.experimental_signal);
    },
    async stopApply({ instance, revision, key, recursive }) {
      await core.agentForAct(instance);
      try {
        return await core.call("stopApply", { instance, revision, key, ...given({ recursive }) }, HOST_TIMEOUT.act, core.signal);
      } finally {
        core.rereadSoon();
      }
    },
    /**
     * The agent as the kernel names it NOW: the roster is read again for this answer (the one
     * status read everybody shares, never a second process), so the dialog is titled, and gated,
     * by what the kernel knows and not by the row that was pressed.
     */
    async startCheck({ instance }) {
      await core.reread();
      // What a start is decided on: the agent the kernel names NOW. While OATS cannot be read this refuses with why, as every act does.
      const agent = await core.agentForAct(instance);
      const [{ row }, declared] = await Promise.all([core.rowOf(instance), harnessesOf(core)]);
      const read = launch.safeParse(row);
      return {
        instance: agent.instance,
        machine: core.target()?.machine ?? "",
        home: agent.home,
        harness: read.success ? (read.data.harness ?? null) : null,
        model: read.success ? (read.data.model ?? null) : null,
        running: agent.running,
        runtimeState: agent.runtimeState,
        runtimeError: agent.runtimeError,
        harnesses: declared,
      };
    },
    start: (input) => begin("start", input),
    restart: (input) => begin("restart", input),
    async retirePlan({ instance }, context) {
      await core.agentForAct(instance);
      return core.call("retirePlan", { instance }, HOST_TIMEOUT.read, context.experimental_signal);
    },
    async retireApply({ instance, revision, key, discardWorktree }) {
      const sent = retires.get(key);
      if (sent === undefined || sent.instance !== instance || sent.revision !== revision) {
        await core.agentForAct(instance);
        if (retires.size >= 200) retires.delete(retires.keys().next().value as string);
        retires.set(key, { instance, revision });
      }
      try {
        return await core.call("retireApply", { instance, revision, key, ...given({ discardWorktree }) }, HOST_TIMEOUT.long, core.signal);
      } finally {
        core.rereadSoon();
      }
    },
  };
};
