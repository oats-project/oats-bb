// Automations' RPC handlers. The two lists are read together, once for all clients that ask while
// the roster stands as it was read: whatever makes the server read OATS again (an event of the
// deployment, one of the plugin's own acts, Retry, the slow poll) makes the next client's lists
// new too. A trigger's state is read for a trigger the current list names, and no other id
// reaches the host.
import type { ExperimentalPluginRpcHandlersWithContext } from "@get-bb/plugin-sdk";
import type { z } from "zod";
import { NO_AUTOMATIONS, type automationListAnswer, type rpc } from "../contract/automations.js";
import { codes, isKernelCode } from "../kernel/result.js";
import { HOST_TIMEOUT, invalid, refusedWith, type Core } from "./core.js";

/** The longest one read of the lists serves: the page, the sidebar's mark and a second window ask at once. */
export const LISTS_TTL_MS = 30_000;

type ListAnswer = z.infer<typeof automationListAnswer>;
type Lists = z.infer<(typeof rpc)["automations"]["output"]>;

/** A refusal as the client is told it: the kernel's code and message, or the plugin's own. */
function failed(error: unknown): ListAnswer {
  const code = (typeof error === "object" && error !== null ? refusedWith.get(error) : undefined) ?? codes.failed;
  const said = error instanceof Error ? error.message : String(error);
  // The refusal's own message leads with its code ("E_…: …"); the code travels beside it here.
  return { ok: false, code, message: said.startsWith(`${code}: `) ? said.slice(code.length + 2) : said };
}

export const handlers = (core: Core): ExperimentalPluginRpcHandlersWithContext<typeof rpc> => {
  /** The lists, and the roster read they were made beside (its `at`). */
  let held: { at: number; roster: string; value: Promise<Lists> } | null = null;

  const read = (kind: "scheduleList" | "triggerList"): Promise<ListAnswer> =>
    core.call(kind, {}, HOST_TIMEOUT.read, core.signal).then(
      (list) => ({ ok: true as const, list }),
      (error: unknown) => failed(error),
    );
  /** Both lists: this read, or the one made beside the same roster read, if it is recent. */
  const lists = async (): Promise<Lists> => {
    const snapshot = await core.clientSnapshot();
    const roster = snapshot.at;
    if (held !== null && held.roster === roster && Date.now() - held.at < LISTS_TTL_MS) return held.value;
    // What the plugin itself lacks (no machine, no deployment, no `oats` there) is said once, in
    // the server's own words for it, which name the machine and what to do: no list is asked for.
    if (!snapshot.ok && !isKernelCode(snapshot.code)) {
      const lack: ListAnswer = { ok: false, code: snapshot.code, message: snapshot.message };
      return { at: snapshot.at, hostId: null, oats: null, schedule: lack, trigger: lack };
    }
    const value = (async (): Promise<Lists> => {
      // The kernel's own word on what it can do; when it cannot be asked, the lists' refusals say why.
      const version = await core.versionOf().catch(() => null);
      const oats = version === null ? null : { version: version.version, features: version.features, automationsApi: version.apis.automationsApi ?? null };
      const supported = oats === null || (oats.features.includes("automations") && oats.automationsApi === 1);
      const none: ListAnswer = { ok: false, code: NO_AUTOMATIONS, message: `OATS ${oats?.version ?? ""} has no automations lists: they need OATS 0.29 or later.` };
      const [schedule, trigger] = supported ? await Promise.all([read("scheduleList"), read("triggerList")]) : [none, none];
      return { at: new Date().toISOString(), hostId: core.target()?.hostId ?? null, oats, schedule, trigger };
    })();
    held = { at: Date.now(), roster, value };
    return value;
  };

  return {
    automations: () => lists(),
    async triggerStatus({ id }, context) {
      const { trigger } = await lists();
      const row = trigger.ok ? trigger.list.rows.find((entry) => entry.id === id || entry.id === `local/${id}`) : undefined;
      if (row === undefined) throw invalid(`"${id}" is not a trigger of this OATS deployment's current list`);
      return core.call("triggerStatus", { id: row.id, source: row.on?.source ?? null }, HOST_TIMEOUT.read, context.experimental_signal);
    },
  };
};
