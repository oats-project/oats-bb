// The lifecycle's RPC handlers: stop, start, restart and retire, each through OATS.
import type { ExperimentalPluginRpcHandlersWithContext } from "@get-bb/plugin-sdk";
import { z } from "zod";
import type { rpc } from "../contract/lifecycle.js";
import type { Asker } from "./act-log.js";
import { HOST_TIMEOUT, invalid, refusedWith, type Core } from "./core.js";
import { harnessesOf, providerVersionOf } from "./spawn.js";

/** The kernel's code for a capability its workspace's catalog does not hold (recorded: test/fixtures/lifecycle/capabilities-show-no-provider.json). */
const NO_PROVIDER = "E_CAPABILITY_UNKNOWN";

/** What the Start and Restart dialogs show of the kernel's own row, beside what `Agent` holds. */
const launch = z.looseObject({ harness: z.string().nullish(), model: z.string().nullish(), sessionEnd: z.string().nullish() });

/** Only what was given: a host call's input is JSON, which has no `undefined`. */
const given = <Fields extends Record<string, unknown>>(fields: Fields): { [Key in keyof Fields]?: Exclude<Fields[Key], undefined> } =>
  Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined)) as { [Key in keyof Fields]?: Exclude<Fields[Key], undefined> };

/** How long a stop plan the kernel has answered waits for the provider's version before it goes without it. */
const VERSION_WAIT_MS = 3_000;
/** `asked`, or null when it has not answered within `ms` (its timer is cleared either way). */
function within<Answer>(ms: number, asked: Promise<Answer>): Promise<Answer | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), ms);
  });
  return Promise.race([asked, late]).finally(() => clearTimeout(timer));
}

// When an act ended (`core.actEnded()`, an answer's `endedAt`): the server's one increasing stamp at
// the instant the act's `oats` command returned. The roster's `at` is the same stamp at the start
// of a status read (core.ts `stamp`), so of the two the later event has the later stamp, also in
// one millisecond; and every act asks for a read when it ends (`rereadAfterAct`, which queues a new
// read behind one in flight and has its roster published also when it says nothing new): so a
// roster whose `at` is later than this was read after the act, it reaches the window, and the
// window compares the two (contract/lifecycle.ts `endedAt`).

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
  /**
   * The harnesses the bb session provider declares; NONE where the deployment does not hold that
   * provider: the kernel then refuses `oats capabilities show oats.bb` with E_CAPABILITY_UNKNOWN
   * (a deployment whose agents all run on tmux). Its agents are started all the same: a start that
   * names no harness needs no list. With none declared the dialog offers no choice of a harness,
   * and a harness that IS named is refused below, as any other that nothing declares.
   * ANY OTHER failure of that read (OATS not reached, an answer that is none) stays the refusal it is.
   */
  const declared = (): Promise<string[]> =>
    harnessesOf(core).catch((cause: unknown) => {
      if (typeof cause === "object" && cause !== null && refusedWith.get(cause) === NO_PROVIDER) return [];
      throw cause;
    });
  /** A harness a caller names must be one the provider declares: nothing else reaches the argv. */
  async function chosen(harness: string | undefined): Promise<string | undefined> {
    if (harness === undefined) return undefined;
    if (!(await declared()).includes(harness)) throw invalid(`"${harness}" is not a harness the bb session provider declares`, "harness-not-declared");
    return harness;
  }
  async function begin(verb: "start" | "restart", { instance, harness, model, resume }: { instance: string; harness?: string | undefined; model?: string | undefined; resume?: true | undefined }, asker: Asker) {
    // What the plugin checks before it asks the kernel: `core.act` runs it, and logs what it refuses as a hold (server/act-log.ts).
    const guards = async () => {
    const agent = await core.agentForAct(instance);
    // A resume is for a home on tmux alone (on bb `--resume` is another act: a notice into the same thread), and
    // takes no harness and no model. Whether its session is still LOST is the kernel's to say, under its own
    // claim (E_RESUME_NOT_LOST): this never turns a resume into a plain start, nor the reverse.
    if (resume === true && (agent.backend !== "tmux" || harness !== undefined || model !== undefined)) throw invalid(`a resume is the start of a tmux home with no harness and no model ("${instance}" runs on ${agent.backend ?? "no backend the kernel names"})`, "resume-not-tmux");
    // The harness list and the models the plugin knows are the bb session provider's: no other home is started with
    // a choice of them. It starts with the launch its home recorded.
    if (agent.backend !== "bb" && (harness !== undefined || model !== undefined)) throw invalid(`a harness or a model is chosen for a home on bb alone ("${instance}" runs on ${agent.backend ?? "no backend the kernel names"})`, "choice-not-bb");
    return { agent, choice: given({ harness: await chosen(harness), model, resume }) };
    };
    let backend: string | null = null;
    // The act ended when its command returned (`endedAt`: not after the wait for the new thread, below); the read it
    // asks for as it ends is `core.act`'s last step, after that stamp.
    const { value: started, endedAt } =
      verb === "start"
        ? await core.act("start", { instance }, asker, HOST_TIMEOUT.act, async () => { const { agent, choice } = await guards(); backend = agent.backend; return { home: agent.home, ...choice }; }, core.rereadAfterAct)
        : await core.act("restart", { instance }, asker, HOST_TIMEOUT.act, async () => { const { agent, choice } = await guards(); backend = agent.backend; return { home: agent.home, ...given({ harness: choice.harness, model: choice.model }) }; }, core.rereadAfterAct);
    // A home on bb is in a new thread after the act; any other has no bb thread, and none is waited for.
    return { ...started, endedAt, threadId: backend === "bb" ? await core.threadOf(instance, started.threadId, verb === "start" ? "Started" : "Restarted") : null };
  }
  return {
    async stopPlan({ instance, recursive }, context) {
      await core.agentForAct(instance);
      // The provider's version beside the plan (the read every dialog shares). It is an optional fact: a version
      // that cannot be read, or is not read within a moment, fails and holds nothing: it is then not known, and
      // the dialog keeps the sentence that warns.
      // Both are asked at once; the version is waited for only a moment AFTER the plan answered (one that came
      // while the kernel made its plan cost nothing, and is used).
      const version = providerVersionOf(core).catch(() => null);
      const plan = await core.call("stopPlan", { instance, ...given({ recursive }) }, HOST_TIMEOUT.read, context.experimental_signal);
      return { ...plan, providerVersion: await within(VERSION_WAIT_MS, version) };
    },
    async stopApply({ instance, revision, key, recursive }, context) {
      const { value: receipt, endedAt } = await core.act("stopApply", { instance }, context, HOST_TIMEOUT.act, async () => { await core.agentForAct(instance); return { instance, revision, key, ...given({ recursive }) }; }, core.rereadAfterAct);
      return { ...receipt, endedAt };
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
      // (Where the deployment does not hold the provider, none is declared, and this answers: `declared`.)
      const [{ row }, harnesses] = await Promise.all([core.rowOf(instance), declared()]);
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
        sessionEnd: read.success ? (read.data.sessionEnd ?? null) : null,
        backend: agent.backend,
        harnesses,
      };
    },
    start: (input, context) => begin("start", input, context),
    restart: (input, context) => begin("restart", input, context),
    async retirePlan({ instance }, context) {
      await core.agentForAct(instance);
      // The harness is the kernel's status row's, not the plan's: the roster this act was admitted on holds it.
      // (A row that cannot be read now fails nothing: the harness is then not known, and the plan the kernel answered stands.)
      const [plan, row] = await Promise.all([core.call("retirePlan", { instance }, HOST_TIMEOUT.read, context.experimental_signal), core.rowOf(instance).then(({ row }) => row, () => null)]);
      const read = launch.safeParse(row);
      return { ...plan, harness: read.success ? (read.data.harness ?? null) : null };
    },
    async retireApply({ instance, revision, key, discardWorktree }, context) {
      const guards = async () => {
        const sent = retires.get(key);
        if (sent === undefined || sent.instance !== instance || sent.revision !== revision) {
          await core.agentForAct(instance);
          if (retires.size >= 200) retires.delete(retires.keys().next().value as string);
          retires.set(key, { instance, revision });
        }
        return { instance, revision, key, ...given({ discardWorktree }) };
      };
      const { value: receipt, endedAt } = await core.act("retireApply", { instance }, context, HOST_TIMEOUT.long, guards, core.rereadAfterAct);
      return { ...receipt, endedAt };
    },
  };
};
