// The lists as every slot of Automations reads them: one copy per app window (the page and the
// sidebar's mark share it). It is read again whenever the server says OATS changed, and on a timer
// while something shows it, since a run that fails writes no event the server watches for: every
// 30 s while the page is open, once a minute for the sidebar's mark alone.
import { useEffect, useMemo, useRef } from "react";
import { experimental_useRpcQuery as useRpcQuery, experimental_useSidebarThreads as useSidebarThreads, useRpc } from "@get-bb/plugin-sdk/app";
import { rpcContract } from "../../contract";
import { attempt, onWindowReset, useRead } from "../store";
import type { Contract, Read, Result } from "../store";
import type { AutomationKind, TriggerStatuses } from "../../contract/automations";
import type { Agent, AgentState } from "../../model/types";
import { claimOf, state as stateOf } from "../../model/view";
import { useOats } from "../oats";
import type { PageMark } from "../workspace/pages";
import { FAILED_RUN_TEXT, failing, statusFor } from "./words";
import type { Asking } from "./words";

/** The timer of the sidebar's mark, when no page is open: the Desktop rereads the lists for its mark this often. */
export const REREAD_MS = 60_000;
/** While the page shows the lists they are never older than this without saying so (the UX standard, freshness). */
export const PAGE_REREAD_MS = 30_000;

/** When this window last asked on its own clock: every slot shares the one timer's worth of reads. */
let rereadAt = 0;
onWindowReset(() => {
  rereadAt = 0;
});

export function useAutomations(every: number = REREAD_MS): Read<Result<"automations">> & { retry(): void; refresh(): Promise<void> } {
  const read = useRead("automations");
  const rpc = useRpc<Contract>();
  // The same shared copy, held for its `refetch`.
  const query = useRpcQuery({ contract: rpcContract, method: "automations", input: null });
  const refetch = useRef(query.refetch);
  useEffect(() => {
    refetch.current = query.refetch;
  });
  useEffect(() => {
    const timer = setInterval(() => {
      // Several slots share the one copy: whichever asks first asks for all.
      if (Date.now() - rereadAt < every - 1_000) return;
      rereadAt = Date.now();
      void refetch.current();
    }, every);
    return () => clearInterval(timer);
  }, [every]);
  /** Asks the server to read OATS again now, then reads the lists: settles when that read did, whatever it answered. */
  const refresh = (): Promise<void> => {
    // Whether or not the server could be asked to read OATS again, the lists' own read says what is.
    const reread = () => refetch.current();
    return attempt(() => rpc.call("refresh", null)).then(reread, reread);
  };
  return { ...read, refresh };
}

/** Every agent of the window's roster by its instance, with its state: the tree's own for an agent the tree draws, else the kernel's row alone (an agent with no bb thread). Null until the roster is read. */
export function useAgents(): ReadonlyMap<string, { agent: Agent; state: AgentState }> | null {
  const oats = useOats();
  const ready = oats.phase === "ready" ? oats : null;
  return useMemo(() => {
    if (ready === null) return null;
    return new Map(ready.agents.map((agent) => [agent.instance, { agent, state: ready.nodeByInstance.get(agent.instance)?.state ?? stateOf(agent, null) }]));
  }, [ready?.agents, ready?.nodeByInstance]);
}

/**
 * Which agents of the roster ask, for the sidebar's mark: read from the window's own copy of the
 * roster and bb's own list of threads, and never by a read of its own (the sidebar reads the
 * roster once: a second reader there would read it twice at every change). An agent asks by the
 * kernel's claim, or by a question its thread waits on (the two halves of the tree's "Needs you").
 */
function useAsksNow(): ReadonlyMap<string, { state: AgentState }> | null {
  // Not enabled, not live: this reader starts no read of the roster and repeats none; it sees the copy the sidebar's own reader keeps.
  const snapshot = useRead("snapshot", { live: false, enabled: false }).data;
  const threads = useSidebarThreads().threads;
  const roster = snapshot === undefined ? undefined : snapshot.ok ? snapshot.agents : snapshot.last?.agents;
  return useMemo(() => {
    if (roster === undefined) return null;
    const pending = new Set(threads.filter((thread) => thread.hasPendingInteraction === true).map((thread) => thread.id));
    return new Map(roster.map((agent) => [agent.instance, { state: claimOf(agent) !== null || (agent.threadId !== null && pending.has(agent.threadId)) ? ("needs-you" as const) : ("idle" as const) }]));
  }, [roster, threads]);
}

/**
 * The agent of an automation that ASKS, by its instance: among the agents its runs made (a
 * schedule's kept runs; a trigger's fires), the first the roster says needs a person. The one
 * answer of the row's "Needs you", the filter's count and the sidebar's amber dot.
 */
export function askingOf(agents: ReadonlyMap<string, { state: AgentState }> | null, statuses: TriggerStatuses | null): Asking {
  return (row) => {
    if (agents === null) return null;
    const made = row.kind === "schedule" ? row.recentRuns.map((run) => run.instance) : (statuses?.find((entry) => entry.id === row.id)?.status.fired.map((fired) => fired.instance) ?? []);
    return made.find((instance): instance is string => instance !== null && agents.get(instance)?.state === "needs-you") ?? null;
  };
}

/** What the marks say, after the row's name. */
export const NEEDS_TEXT = ", needs you";

/**
 * The sidebar row's marks, by the one rule of the page (words.ts `attention`): an amber dot,
 * "Automations, needs you", while an agent an automation made asks; a red one, "Automations, a
 * failure", while an automation is failing (its row's small line holds a red part). The verdict
 * is of a whole read (both lists); a list that could not be read keeps the last verdict of its
 * own rows, and before the first read there is no mark.
 */
export function useFailedRunMark(): PageMark[] | null {
  const read = useAutomations();
  const agents = useAsksNow();
  const statuses = read.data?.statuses;
  const known = statuses !== undefined && statuses.ok ? statuses.statuses : null;
  const asking = askingOf(agents, known);
  const kept = useRef<Record<AutomationKind, { failing: boolean; needs: boolean }>>({ schedule: { failing: false, needs: false }, trigger: { failing: false, needs: false } });
  for (const kind of ["schedule", "trigger"] as const) {
    const answer = read.data?.[kind];
    if (answer === undefined || !answer.ok) continue;
    // A trigger's failed poll or spawn, and the agents it made, are read from its state: while that could not be read, the verdict of the triggers stands as it was.
    if (kind === "trigger" && known === null) continue;
    kept.current[kind] = { failing: answer.list.rows.some((row) => failing(row, statusFor(row, known))), needs: answer.list.rows.some((row) => asking(row) !== null) };
  }
  const { schedule, trigger } = kept.current;
  const marks: PageMark[] = [];
  if (schedule.needs || trigger.needs) marks.push({ label: `Automations${NEEDS_TEXT}`, tone: "warning" });
  if (schedule.failing || trigger.failing) marks.push({ label: `Automations${FAILED_RUN_TEXT}` });
  return marks.length === 0 ? null : marks;
}
