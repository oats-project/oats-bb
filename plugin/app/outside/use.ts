// What every place asks of this feature: what to say of one agent (`said`, say.ts), from the
// kernel's rows (the read `outsideFacts`) and bb's own answer for each row's thread.
import { useMemo } from "react";
import type { Agent } from "../../model/types";
import type { Oats } from "../oats";
import { useNow } from "../roster/now";
import { useRead } from "../store";
import { said, type RowFacts, type Said, type ThreadFact } from "./say";
import { useArchived } from "./threads";

export type Outside = {
  /** What to say of an agent of the roster; null where the roster's own words stand. */
  of(agent: Agent): Said | null;
  /** What bb says of the thread an agent's row names. */
  threadOf(agent: Agent): ThreadFact;
  /** The agent whose recorded thread `threadId` is, where the roster does not draw it on that thread (bb has it archived); undefined for any other thread. */
  agentOn(threadId: string): Agent | undefined;
};

const NO_ONE: readonly Agent[] = [];

/**
 * `oats` is the caller's own `useOats()`: the roster the place draws, so that what is said of an
 * agent is said of the row the place holds (and the roster is read once per place).
 */
export function useOutside(oats: Oats, { enabled = true }: { /** false: read nothing now (a place that is not shown, a hidden tab) */ enabled?: boolean } = {}): Outside {
  const read = useRead("outsideFacts", { enabled });
  // Asked of bb again at each roster read and each minute: bb tells nobody when an archived thread is deleted.
  const minute = Math.floor(useNow(60_000) / 60_000);
  const detached = enabled && oats.phase === "ready" ? oats.view.detached : NO_ONE;
  const ids = useMemo(() => detached.flatMap((agent) => (agent.threadId === null ? [] : [agent.threadId])), [detached]);
  const archived = useArchived(ids, `${oats.phase === "ready" ? (oats.stale?.at ?? read.data?.at ?? "") : ""} ${minute}`);
  const facts = useMemo(() => new Map<string, RowFacts>((read.data?.rows ?? []).map((row) => [row.instance, { sessionEnd: row.sessionEnd, outsideOats: row.outsideOats }])), [read.data]);

  const attached = (agent: Agent): boolean => oats.phase === "ready" && oats.nodeByInstance.get(agent.instance)?.agent === agent;
  const threadOf = (agent: Agent): ThreadFact => {
    if (agent.backend === "tmux") return "none";
    if (attached(agent)) return "open";
    if (agent.threadId === null) return "none";
    const answer = archived.get(agent.threadId);
    if (answer === undefined) return "unknown";
    if (answer === "archived") return "archived";
    // bb has no archived thread of that id: it lists it (hidden, or another row's), or it does not have it.
    return oats.threadById.has(agent.threadId) ? "open" : "missing";
  };
  return {
    threadOf,
    of: (agent) => said(agent, threadOf(agent), facts.get(agent.instance) ?? null, attached(agent)),
    agentOn: (threadId) => detached.find((agent) => agent.threadId === threadId && archived.get(threadId) === "archived"),
  };
}
