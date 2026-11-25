// The one function that says where an agent is, in words, for every place that says it: the tree,
// the line under a thread's header, the home and the instance panel print what this answers
// (through `State` and `StatusLine`, app/ui.tsx), so they say the same thing. Pure.
import { GONE_MARK, GONE_WORD } from "./gone";
import type { Agent, AgentState, BbThread } from "../../model/types";
import { claimOf, failedAtStart, state } from "../../model/view";
import { STATE, waitingClock, waitingDetail, waitingSince } from "../ui/words";

export type AgentStatus = {
  /** The drawn state (model/view.ts `state`): whether the agent waits on a person, what the kernel says of its session, and for an agent on a bb thread whether bb has a turn running on it. */
  state: AgentState;
  /**
   * The state's word, the standard's ("Needs you", "Working", "Failed", …); for an agent on tmux
   * that runs, "Running" (`stateWord`). Every place that says an agent's state in words says THIS.
   */
  word: string;
  /** For an agent that waits on a person, how long: "12 min", "4 d"; null otherwise, or when the kernel names no instant. */
  since: string | null;
  /**
   * What the state is about, in a person's words, for the states that have something to say: the
   * agent's question or the reason in a word (needs you), that its session ended (failed). The
   * question is an agent's text: `StatusLine` draws it through the filter.
   */
  detail: string | null;
  /**
   * The kernel's own text behind the words, where it gave one (what it says of a session it cannot
   * reach: often a raw URL or an errno): a place shows it one press away, under Details, never as
   * the line's words. null where the kernel said nothing more.
   */
  kernel: string | null;
  /**
   * bb's own reason for a thread that failed at its start (`BbThread.startFailure`), shown the
   * same way: one press away, under Details. Absent for every other agent.
   */
  bb?: string;
};

/** The reason after "Failed": the Desktop's "Its session ended", as a reason. */
export const SESSION_ENDED = "session ended";

/** What is said of an agent on tmux that runs, in the state's place. */
export const RUNNING = "Running";

/**
 * The word of an agent's state, by its backend: the ONE place (the lead's ruling T4 on its reader's
 * report, 24 Nov 2026). The STATE does not change with it: the mark, the order, the acts and the
 * counts are the state's. An agent on tmux that runs reads "Running", never "Working": the kernel
 * knows of a tmux session that it runs, and nothing of a turn (it gives such a row no turn facts),
 * so "Working" would say more than anyone knows. An agent on a bb thread keeps "Working": bb says
 * its thread has a turn running.
 */
export const stateWord = (agent: Pick<Agent, "backend">, drawn: AgentState): string => (drawn === "working" && agent.backend === "tmux" ? RUNNING : STATE[drawn].word);

/** `thread` is null for an agent that has no bb thread (it runs in tmux, or its thread is gone); `now` is the clock in epoch milliseconds. */
export function agentStatus(agent: Agent, thread: BbThread | null, now: number): AgentStatus {
  const drawn = state(agent, thread);
  const base = { state: drawn, word: stateWord(agent, drawn), kernel: null };
  switch (drawn) {
    case "needs-you": {
      // The kernel's claim, through the one gate; with none, the question is bb's own.
      const claim = claimOf(agent);
      // (bb's own question is in the thread under the line: the line says nothing of it.)
      if (claim === null) return { ...base, since: null, detail: null };
      return { ...base, since: waitingSince(claim.since, now), detail: waitingDetail(claim) };
    }
    case "error": {
      // It never ran (bb says its thread failed at its start): the word alone, and bb's reason under Details.
      const failure = failedAtStart(agent, thread) ? (thread?.startFailure ?? null) : null;
      if (failure !== null) return { ...base, since: null, detail: null, bb: failure.detail ?? failure.message };
      return { ...base, since: null, detail: SESSION_ENDED };
    }
    case "unreachable":
      // "Unreachable" says it; the kernel's own text is one press away.
      return { ...base, since: null, detail: null, kernel: agent.runtimeError };
    default:
      // (When a working agent was last started, and when a stopped one stopped, are facts of the
      // instance panel's Session, not of a line.)
      return { ...base, since: null, detail: null };
  }
}

/**
 * What a row draws in its state's place: the state's mark and word, or, for an agent the kernel has
 * since refused as one it does not know, the mark of an agent that does not run and "Not in OATS
 * any more". The one function for the sidebar's rows and the thread's own row.
 */
export function rowState(status: AgentStatus, gone: boolean): { state: AgentStatus["state"]; word: string } {
  return gone ? { state: GONE_MARK, word: GONE_WORD } : { state: status.state, word: status.word };
}

/**
 * When an agent OATS stopped was stopped ("14:03", "Nov 21, 18:23"): the time of its last "stopped"
 * event, from the instance's recorded events (`oats instance events`: read for the one agent whose
 * panel is open, never for the roster). null when the events hold none, or none that can be read; and
 * when the last one is older than the session's start the roster names (`startedAt`): the events
 * held were read before this stop, and an earlier stop's time is not this one's.
 */
export function stoppedAt(events: readonly { kind: string; at: string; incarnation?: string }[] | undefined, startedAt: string | null, now: number): string | null {
  // The events are the address's history: a stop of an EARLIER instance of the same name (retired, then spawned again) is not this one's.
  const last = (events ?? []).filter((event) => event.kind === "stopped" && event.incarnation !== "earlier").at(-1);
  if (last === undefined) return null;
  const [stoppedAt, started] = [Date.parse(last.at), startedAt === null ? NaN : Date.parse(startedAt)];
  if (!Number.isNaN(started) && !Number.isNaN(stoppedAt) && stoppedAt < started) return null;
  const clock = waitingClock(last.at, now);
  return clock === "" ? null : clock;
}
