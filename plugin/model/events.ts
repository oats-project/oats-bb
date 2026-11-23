// What one instance's events say of its row, between two reads of `oats status` (the event path).
// The server reads `oats instance events <instance> --since <the snapshot's read> --json` when the
// watch names that instance's file, and patches the row it holds with this, so that a claim and a
// stop are on the screen without waiting for a status read. The status read that follows is the
// truth: this function only ever moves a row toward what the events answer SAYS, and leaves the
// row as it is wherever the answer says nothing it understands.
import type { Agent } from "./types";

/** The part of an `oats instance events --json` answer the patch reads (kernel/roster-events.ts reads it from the kernel's). */
export type EventsSaid = {
  /** The answer's rows were cut, or a source was read from its tail: what is absent is then not known to be absent. */
  truncated: boolean;
  /** The home's current incarnation, as the answer says it; null where it names none. */
  incarnation: string | null;
  /** The answer's own `waitingOnYou`: the claim to show, or null, which is "unknown", never "not waiting", by itself. */
  waitingOnYou: { since: string; reason: string | null; message: string | null } | null;
  /** The answer's `waitingClaims`: one per producer of the incarnation, cleared ones included. */
  waitingClaims: readonly { waiting: boolean }[];
  /** The answer's rows, oldest first: their kind, when, and the incarnation they were written in. */
  events: readonly { kind: string; at: string; incarnation: string | null }[];
};

/** The kinds that say where a session is. `launched` and `restarted` say that one began, and nothing this function can place (below). */
const LIFECYCLE: ReadonlySet<string> = new Set(["stopped", "launched", "restarted"]);

/**
 * The row as the events answer says it, or the SAME row (the same object) where the answer changes nothing.
 *
 * THE CLAIM is read from the answer's top level, never from one `waiting` row (a producer's later
 * row, another producer's claim and the session's boundary all decide, and the kernel has decided):
 * - `waitingOnYou` is a claim: the row waits, with its reason (the row's own rule: "attention"
 *   where the kernel names none), its message and since when;
 * - `waitingOnYou` is null, no producer's claim is live (`waitingClaims` holds none with
 *   `waiting: true`) and the answer is whole (`truncated` false): the row does not wait;
 * - anything else (null beside a live claim, or a cut answer): not known; the row's claim stays.
 *
 * STOPPED: the newest event of a kind that says where the session is, written in the answer's
 * incarnation and after `readAt` (the start of the status read the row came from: an older event
 * is in that read already), is `stopped`: the row does not run and its session ended by an
 * operator's stop. A provider's row then carries the kernel's word "stopped"; a tmux row keeps
 * the word it has (the kernel prints "shell" for it: its window is left at a shell), and
 * `sessionEnd` is what `recordedStopped` reads.
 *
 * A START (`launched`, `restarted`) newer than that is NOT applied: the event names the backend
 * and not the thread (a restart of a bb agent is on a new thread), and does not say that a
 * harness runs. It only keeps an older `stopped` from being applied: the status read places it.
 * A kind this function does not know says nothing.
 */
export function withEvents(agent: Agent, said: EventsSaid, readAt: string): Agent {
  let next = agent;
  const change = (fields: Partial<Agent>) => {
    next = { ...next, ...fields };
  };

  // The claim.
  if (said.waitingOnYou !== null) {
    const waiting = { reason: said.waitingOnYou.reason ?? "attention", message: said.waitingOnYou.message, since: said.waitingOnYou.since };
    if (agent.waiting === null || agent.waiting.reason !== waiting.reason || agent.waiting.message !== waiting.message || agent.waiting.since !== waiting.since) change({ waiting });
  } else if (!said.truncated && !said.waitingClaims.some((claim) => claim.waiting) && agent.waiting !== null) {
    change({ waiting: null });
  }

  // Where the session is: the newest event that says, of this incarnation, newer than the row's read.
  const since = Date.parse(readAt);
  const newest = said.events
    .filter((event) => LIFECYCLE.has(event.kind) && (said.incarnation === null || event.incarnation === null || event.incarnation === said.incarnation))
    .map((event) => ({ kind: event.kind, at: Date.parse(event.at) }))
    .filter((event) => Number.isFinite(event.at) && Number.isFinite(since) && event.at > since)
    .reduce<{ kind: string; at: number } | null>((last, event) => (last === null || event.at >= last.at ? event : last), null);
  if (newest !== null && newest.kind === "stopped") {
    const runtimeState = agent.backend === "tmux" ? agent.runtimeState : "stopped";
    if (agent.running !== false || agent.sessionEnd !== "stopped" || agent.runtimeState !== runtimeState) change({ running: false, sessionEnd: "stopped", runtimeState });
  }
  return next;
}
