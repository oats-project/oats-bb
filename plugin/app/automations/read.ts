// The lists as every slot of Automations reads them: one copy per app window (the page and the
// sidebar's mark share it). It is read again whenever the server says OATS changed, and on a timer
// while something shows it, since a run that fails writes no event the server watches for: every
// 30 s while the page is open, once a minute for the sidebar's mark alone.
import { useEffect, useMemo, useRef } from "react";
import { experimental_useRpcQuery as useRpcQuery, experimental_useSidebarThreads as useSidebarThreads, useRpc } from "@get-bb/plugin-sdk/app";
import { rpcContract } from "../../contract";
import { attempt, onWindowReset, useRead } from "../store";
import type { Contract, Read, Result } from "../store";
import { NO_AUTOMATIONS } from "../../contract/automations";
import type { AutomationList, TriggerStatuses } from "../../contract/automations";
import type { Agent, AgentState, BbThread } from "../../model/types";
import { flatten, state as stateOf, view } from "../../model/view";
import { useOats } from "../oats";
import type { PageMark } from "../workspace/pages";
import { attention, FAILED_RUN_TEXT, failing, oneList, statusFor } from "./words";
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

/**
 * WHAT WAS READ LAST, ONE COPY PER WINDOW: each list's rows and every trigger's state, each with the stamp of the read
 * it came from. A list or a state that a later read refuses stays as it was read, and EVERY place that judges an
 * automation reads this one copy: the page (its rows, its filter's counts) and the sidebar's marks. So they cannot
 * disagree on what is kept: neither holds a copy, or a verdict, of its own.
 */
export type Kept = { schedule?: { list: AutomationList; at: string }; trigger?: { list: AutomationList; at: string }; statuses?: { statuses: TriggerStatuses; at: string } };
let kept: Kept = {};
onWindowReset(() => {
  kept = {};
});
/**
 * A kept copy after one more answer: what the answer READ replaces what was kept of it; what it was REFUSED stays as
 * it was kept (or is not there, if nothing of it was ever read); an OATS with no lists at all keeps nothing. Nothing
 * else: no verdict, no count.
 */
export function keptAfter(before: Kept, data: Result<"automations">): Kept {
  // An OATS that has no automations lists (the server's own word for it): the page then shows that in the lists' place, and
  // no row. What was kept is of an OATS that did have them: it is not shown, so it is not kept, and no dot is drawn from it.
  if ((["schedule", "trigger"] as const).some((kind) => !data[kind].ok && data[kind].code === NO_AUTOMATIONS)) return {};
  let after = before;
  for (const kind of ["schedule", "trigger"] as const) {
    const answer = data[kind];
    if (answer.ok && (after[kind]?.list !== answer.list || after[kind]?.at !== data.at)) after = { ...after, [kind]: { list: answer.list, at: data.at } };
  }
  if (data.statuses.ok && (after.statuses?.statuses !== data.statuses.statuses || after.statuses?.at !== data.at)) after = { ...after, statuses: { statuses: data.statuses.statuses, at: data.at } };
  return after;
}
/** The window's kept copy, with what this answer holds taken into it. Every reader of the answer passes it through here; taking it in twice changes nothing. */
export function keptOf(data: Result<"automations"> | undefined): Kept {
  if (data !== undefined) kept = keptAfter(kept, data);
  return kept;
}

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

/**
 * Every agent of a roster by its instance, with its state: the tree's own for an agent the tree draws (its node), else
 * the kernel's row alone (an agent with no bb thread, or whose thread the tree does not draw: hidden, archived, another
 * agent's). THE ONE FUNCTION for the page and for the sidebar's marks: who asks is read the same by both.
 */
export function agentStates(agents: readonly Agent[], nodeByInstance: ReadonlyMap<string, { state: AgentState }>): Map<string, { agent: Agent; state: AgentState }> {
  return new Map(agents.map((agent) => [agent.instance, { agent, state: nodeByInstance.get(agent.instance)?.state ?? stateOf(agent, null) }]));
}

/** The window's roster by instance, with each agent's state (`agentStates`). Null until the roster is read. */
export function useAgents(): ReadonlyMap<string, { agent: Agent; state: AgentState }> | null {
  const oats = useOats();
  const ready = oats.phase === "ready" ? oats : null;
  return useMemo(() => (ready === null ? null : agentStates(ready.agents, ready.nodeByInstance)), [ready?.agents, ready?.nodeByInstance]);
}

/**
 * Which agents of the roster ask, for the sidebar's mark: read from the window's own copy of the
 * roster and bb's own list of threads, and never by a read of its own (the sidebar reads the
 * roster once: a second reader there would read it twice at every change). The states are the
 * page's (`agentStates`), over the tree the same roster and threads make (model/view.ts `view`):
 * an agent whose thread the tree does not draw is judged by the kernel's row alone, here as there.
 */
function useAsksNow(): ReadonlyMap<string, { state: AgentState }> | null {
  // Not enabled, not live: this reader starts no read of the roster and repeats none; it sees the copy the sidebar's own reader keeps.
  const snapshot = useRead("snapshot", { live: false, enabled: false }).data;
  const sidebar = useSidebarThreads();
  const threads = sidebar.threads;
  const roster = snapshot === undefined ? undefined : snapshot.ok ? snapshot.agents : snapshot.last?.agents;
  // Until bb has listed its threads nobody is known to ask, here as on the page (app/oats.ts: the window's roster is ready only then).
  const listed = sidebar.status === "ready";
  return useMemo(() => {
    if (roster === undefined || !listed) return null;
    const nodes = flatten(view(roster, threads as readonly BbThread[]).roots);
    return agentStates(roster, new Map(nodes.map((node) => [node.agent.instance, node])));
  }, [roster, threads, listed]);
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
 * failure", while an automation is failing (its row's small line holds a red part). It holds no
 * verdict of its own: at every draw it judges the rows and the state of the window's kept copy
 * (`keptOf`: what the page draws too, also while a later read is refused) by the roster of now.
 * Before the first read there are no rows, and no mark.
 */
export function marksFor(copy: Kept, agents: ReadonlyMap<string, { state: AgentState }> | null): PageMark[] {
  const known = copy.statuses?.statuses ?? null;
  const asking = askingOf(agents, known);
  // The rows the page lists, in the page's own list of them.
  const rows = oneList(copy.schedule?.list.rows ?? [], copy.trigger?.list.rows ?? []);
  const marks: PageMark[] = [];
  if (rows.some((row) => attention(row, statusFor(row, known), asking) === "needs")) marks.push({ label: `Automations${NEEDS_TEXT}`, tone: "warning" });
  if (rows.some((row) => failing(row, statusFor(row, known)))) marks.push({ label: `Automations${FAILED_RUN_TEXT}` });
  return marks;
}
export function useFailedRunMark(): PageMark[] | null {
  const read = useAutomations();
  const agents = useAsksNow();
  const marks = marksFor(keptOf(read.data), agents);
  return marks.length === 0 ? null : marks;
}
