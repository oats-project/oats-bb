// The one function that says where an agent is, in words, for every place that says it: the tree,
// the line under a thread's header, the home and the instance panel print what this answers
// (through `State` and `StatusLine`, app/ui.tsx), so they say the same thing. Pure.
import { GONE_MARK, GONE_WORD } from "./gone";
import type { Agent, AgentState, BbThread } from "../../model/types";
import { claimOf, state } from "../../model/view";
import { STATE, waitingClock, waitingDetail, waitingSince } from "../ui/words";

export type AgentStatus = {
  /** The drawn state: the kernel's word for whether the agent runs, and whether it waits on a person. */
  state: AgentState;
  /** The state's word, the standard's ("Needs you", "Working", "Failed", …). */
  word: string;
  /** For an agent that waits on a person: "waiting 12 min (since 14:03)"; null otherwise, or when the kernel names no instant. */
  since: string | null;
  /**
   * What the state is about, in a person's words, for the states that have something to say: the
   * agent's question or the reason (needs you), that its session ended (failed), that OATS cannot
   * reach its session (unreachable). The question is an agent's text: `StatusLine` draws it
   * through the filter.
   */
  detail: string | null;
  /**
   * The kernel's own text behind the words, where it gave one (what it says of a session it cannot
   * reach: often a raw URL or an errno): a place shows it one press away, under Details, never as
   * the line's words. null where the kernel said nothing more.
   */
  kernel: string | null;
};

/** The reason an unreachable agent's line says, in a person's words (the kernel's own text goes under Details). */
export const UNREACHABLE = "OATS cannot reach its session";

/** `thread` is null for an agent that has no bb thread (it runs in tmux, or its thread is gone); `now` is the clock in epoch milliseconds. */
export function agentStatus(agent: Agent, thread: BbThread | null, now: number): AgentStatus {
  const drawn = state(agent, thread);
  const base = { state: drawn, word: STATE[drawn].word, kernel: null };
  switch (drawn) {
    case "needs-you": {
      // The kernel's claim, through the one gate; with none, the question is bb's own.
      const claim = claimOf(agent);
      if (claim === null) return { ...base, since: null, detail: "bb shows its question in this thread" };
      return { ...base, since: waitingSince(claim.since, now), detail: waitingDetail(claim) };
    }
    case "error":
      return { ...base, since: null, detail: "Its session ended" };
    case "unreachable":
      return { ...base, since: null, detail: UNREACHABLE, kernel: agent.runtimeError };
    case "working":
      // The one time the kernel records for an agent that works: when its session started, said as
      // what it is (not "since": the turn it works on may be newer).
      return { ...base, since: sessionStarted(agent.startedAt ?? null, now), detail: null };
    default:
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

/** "session started 14:03" (or with its date, as the waiting clock says one); null when the kernel's row names no start that can be read. */
export function sessionStarted(startedAt: string | null, now: number): string | null {
  if (startedAt === null) return null;
  const clock = waitingClock(startedAt, now);
  return clock === "" ? null : `session started ${clock}`;
}

/**
 * "since 14:03" for an agent OATS stopped: the time of its last "stopped" event, from the
 * instance's recorded events (`oats instance events`: read for the one agent whose thread or panel
 * is open, never for the roster). null when the events hold none, or none that can be read.
 */
export function stoppedSince(events: readonly { kind: string; at: string }[] | undefined, now: number): string | null {
  const last = (events ?? []).filter((event) => event.kind === "stopped").at(-1);
  if (last === undefined) return null;
  const clock = waitingClock(last.at, now);
  return clock === "" ? null : `since ${clock}`;
}
