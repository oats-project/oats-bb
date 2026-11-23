// The event path's one pure function (model/events.ts): what an instance's events answer says of
// its row. A table: each case is a row as the status read left it, an answer, and the row after.
// The rows and answers are shaped by hand to the kernel's documented shapes (docs/desktop-cli-api.md,
// "Events", "Waiting on you"), not recorded: the function reads six fields.
import { describe, expect, it } from "vitest";
import { withEvents, type EventsSaid } from "../../model/events";
import type { Agent } from "../../model/types";
import { claimOf, state } from "../../model/view";

const READ_AT = "2026-11-23T10:00:00.000Z"; // when the status read the row came from started
const before = "2026-11-23T09:59:59.000Z";
const after = "2026-11-23T10:00:00.500Z";
const later = "2026-11-23T10:00:00.900Z";
const INCARNATION = "2026-11-23T09:00:00.000Z";

const agent = (over: Partial<Agent> = {}): Agent => ({
  instance: "flaky-ci-developer",
  soul: "oats-developer",
  home: "/abs/deployment/agents/oats-developer/instances/flaky-ci-developer",
  parent: null,
  human: null,
  alias: null,
  team: null,
  address: null,
  backend: "bb",
  server: null,
  projectId: null,
  threadId: "thr_ci",
  running: true,
  runtimeState: "unknown",
  runtimeError: null,
  waiting: null,
  ...over,
});
const said = (over: Partial<EventsSaid> = {}): EventsSaid => ({ truncated: false, incarnation: INCARNATION, waitingOnYou: null, waitingClaims: [], events: [], ...over });
const event = (kind: string, at: string, incarnation: string | null = INCARNATION) => ({ kind, at, incarnation });
const claim = { since: after, reason: "attention", message: "Keep the retry, or fail the job?" };

describe("what an instance's events say of its row", () => {
  it("a claim set: the row waits, with the kernel's reason, message and since; a claim with no reason reads as the row's rule does", () => {
    const row = agent();
    const next = withEvents(row, said({ waitingOnYou: claim, waitingClaims: [{ waiting: true }] }), READ_AT);
    expect(next.waiting).toEqual({ reason: "attention", message: "Keep the retry, or fail the job?", since: after });
    expect(state(next, null)).toBe("needs-you");
    expect({ ...next, waiting: null }).toEqual(row); // nothing else of the row moved
    expect(withEvents(row, said({ waitingOnYou: { since: after, reason: null, message: null }, waitingClaims: [{ waiting: true }] }), READ_AT).waiting).toEqual({ reason: "attention", message: null, since: after });
  });

  it("a claim cleared: no claim, when the answer is whole and no producer's claim is live", () => {
    const row = agent({ waiting: { reason: "attention", message: "Keep the retry?", since: before } });
    const next = withEvents(row, said({ waitingClaims: [{ waiting: false }] }), READ_AT);
    expect(next.waiting).toBeNull();
    expect(claimOf(next)).toBeNull();
    // With no claim row at all in the incarnation: the same (nobody ever asked).
    expect(withEvents(row, said(), READ_AT).waiting).toBeNull();
  });

  it("two producers: one cleared and one live is a claim still; null beside a live claim is unknown, and the row's claim stays", () => {
    const row = agent({ waiting: { reason: "question", message: "Which branch?", since: before } });
    // The kernel's own answer names the claim to show: the other producer's.
    const other = withEvents(row, said({ waitingOnYou: { since: after, reason: "permission", message: null }, waitingClaims: [{ waiting: false }, { waiting: true }] }), READ_AT);
    expect(other.waiting).toEqual({ reason: "permission", message: null, since: after });
    // No `waitingOnYou` beside a live claim: not "not waiting". Nothing moves.
    expect(withEvents(row, said({ waitingOnYou: null, waitingClaims: [{ waiting: false }, { waiting: true }] }), READ_AT)).toBe(row);
  });

  it("an answer that was cut says nothing of a claim that is absent from it", () => {
    const row = agent({ waiting: { reason: "attention", message: null, since: before } });
    expect(withEvents(row, said({ truncated: true }), READ_AT)).toBe(row);
    // What it does say, it says: a claim in a cut answer is a claim.
    expect(withEvents(agent(), said({ truncated: true, waitingOnYou: claim, waitingClaims: [{ waiting: true }] }), READ_AT).waiting).not.toBeNull();
  });

  it("stopped: a provider's row does not run, its word is \"stopped\" and its session ended by a stop; a tmux row keeps its word", () => {
    const next = withEvents(agent(), said({ events: [event("launched", before), event("stopped", after)] }), READ_AT);
    expect([next.running, next.runtimeState, next.sessionEnd]).toEqual([false, "stopped", "stopped"]);
    expect(state(next, null)).toBe("stopped");
    const tmux = withEvents(agent({ backend: "tmux", threadId: null, runtimeState: null }), said({ events: [event("stopped", after)] }), READ_AT);
    expect([tmux.running, tmux.runtimeState, tmux.sessionEnd]).toEqual([false, null, "stopped"]);
    expect(state(tmux, null)).toBe("stopped");
  });

  it("a stopped agent's claim is in the row and is not shown: the one claim rule hides it", () => {
    const next = withEvents(agent(), said({ waitingOnYou: claim, waitingClaims: [{ waiting: true }], events: [event("stopped", after)] }), READ_AT);
    expect(next.waiting).not.toBeNull();
    expect(claimOf(next)).toBeNull();
    expect(state(next, null)).toBe("stopped");
  });

  it("started and restarted are left to the status read: a start after a stop keeps the stop from being applied, and moves nothing itself", () => {
    const row = agent({ running: false, runtimeState: "stopped", sessionEnd: "stopped" });
    expect(withEvents(row, said({ events: [event("launched", after)] }), READ_AT)).toBe(row);
    expect(withEvents(row, said({ events: [event("restarted", after)] }), READ_AT)).toBe(row);
    // Stopped, then started again, both since the row was read: not stopped; the status read places it.
    const running = agent();
    expect(withEvents(running, said({ events: [event("stopped", after), event("launched", later)] }), READ_AT)).toBe(running);
    expect(withEvents(running, said({ events: [event("stopped", after), event("restarted", later)] }), READ_AT)).toBe(running);
  });

  it("an event the status read already holds, or of another incarnation, or of a kind this does not know, says nothing", () => {
    const row = agent();
    expect(withEvents(row, said({ events: [event("stopped", before)] }), READ_AT)).toBe(row); // older than the row's own read
    expect(withEvents(row, said({ events: [event("stopped", READ_AT)] }), READ_AT)).toBe(row); // at that moment: the read has it or the next has
    expect(withEvents(row, said({ events: [event("stopped", after, "2026-11-01T00:00:00.000Z")] }), READ_AT)).toBe(row); // a home of this name before this one
    expect(withEvents(row, said({ events: [event("stop-refused", after), event("worktree-added", after), event("some-kind-of-2027", later)] }), READ_AT)).toBe(row);
    expect(withEvents(row, said({ events: [event("stopped", "not a time")] }), READ_AT)).toBe(row);
    expect(withEvents(row, said({ events: [event("stopped", after)] }), "not a time")).toBe(row);
  });

  it("no change: the same row, the same object, so that nothing is published", () => {
    const waiting = agent({ waiting: { reason: "attention", message: "Keep the retry, or fail the job?", since: after } });
    expect(withEvents(waiting, said({ waitingOnYou: claim, waitingClaims: [{ waiting: true }] }), READ_AT)).toBe(waiting);
    const quiet = agent();
    expect(withEvents(quiet, said(), READ_AT)).toBe(quiet);
    const stopped = agent({ running: false, runtimeState: "stopped", sessionEnd: "stopped" });
    expect(withEvents(stopped, said({ events: [event("stopped", after)] }), READ_AT)).toBe(stopped);
  });
});
