// Automations' RPC handlers. The two lists are read together, once for all clients that ask
// within a few seconds; a trigger's state is read for a trigger the current list names, and no
// other id reaches the host.
import type { ExperimentalPluginRpcHandlersWithContext } from "@get-bb/plugin-sdk";
import type { z } from "zod";
import type { automationListAnswer, rpc } from "../contract/automations.js";
import { codes } from "../kernel/result.js";
import { HOST_TIMEOUT, invalid, refusedWith, type Core } from "./core.js";

/** How long one read of the lists serves every client: the page, the sidebar's mark and a second window ask at once. */
export const LISTS_TTL_MS = 5_000;

type ListAnswer = z.infer<typeof automationListAnswer>;
type Lists = { at: string; hostId: string | null; schedule: ListAnswer; trigger: ListAnswer };

/** A refusal as the client is told it: the kernel's code and message, or the plugin's own. */
function failed(error: unknown): ListAnswer {
  const code = (typeof error === "object" && error !== null ? refusedWith.get(error) : undefined) ?? codes.failed;
  const said = error instanceof Error ? error.message : String(error);
  // The refusal's own message leads with its code ("E_…: …"); the code travels beside it here.
  const message = said.startsWith(`${code}: `) ? said.slice(code.length + 2) : said;
  return { ok: false, code, message };
}

export const handlers = (core: Core): ExperimentalPluginRpcHandlersWithContext<typeof rpc> => {
  let held: { at: number; value: Promise<Lists> } | null = null;

  const read = (kind: "scheduleList" | "triggerList"): Promise<ListAnswer> =>
    core.call(kind, {}, HOST_TIMEOUT.read, core.lifetime.signal).then(
      (list) => ({ ok: true as const, list }),
      (error: unknown) => failed(error),
    );
  /** Both lists, from this read or one started within LISTS_TTL_MS. */
  const lists = (): Promise<Lists> => {
    if (held !== null && Date.now() - held.at < LISTS_TTL_MS) return held.value;
    const value = Promise.all([read("scheduleList"), read("triggerList")]).then(([schedule, trigger]) => ({
      at: new Date().toISOString(),
      hostId: core.target()?.hostId ?? null,
      schedule,
      trigger,
    }));
    held = { at: Date.now(), value };
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
