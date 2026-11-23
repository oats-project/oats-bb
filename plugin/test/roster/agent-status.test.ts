// agentStatus(): where an agent is, in words, for every place that says it.
import { expect, test } from "vitest";
import { agentStatus, sessionStarted, stoppedSince } from "../../app/roster/status";
import type { BbThread } from "../../model/types";
import { fixtureAgents, fixtureThreads } from "../helpers/fixtures";

const NOW = Date.parse("2026-11-19T12:30:00.000Z");
const agents = fixtureAgents();
const threads = fixtureThreads() as unknown as BbThread[];
const of = (instance: string) => {
  const agent = agents.find((candidate) => candidate.instance === instance)!;
  return { agent, thread: threads.find((candidate) => candidate.id === agent.threadId)! };
};

test("the word is the state's word, for every agent of the fixtures that has a thread", () => {
  const words = agents.filter((agent) => threads.some((thread) => thread.id === agent.threadId)).map((agent) => {
    const { thread } = of(agent.instance);
    const status = agentStatus(agent, thread, NOW, "open");
    return `${agent.instance}: ${status.state} / ${status.word}`;
  });
  expect(words).toMatchInlineSnapshot(`
    [
      "release-070-maintainer: needs-you / Needs you",
      "redesign-ui-lead: working / Working",
      "desktop-mockups-developer: working / Working",
      "harvest-knowledge-helper: idle / Idle",
      "flaky-ci-developer: needs-you / Needs you",
      "ranker-v3-probe: needs-you / Needs you",
      "weekly-digest-helper: stopped / Stopped",
    ]
  `);
});

test("an agent that waits says since when and what about; the others say only what there is to say", () => {
  const waiting = agents.find((agent) => agent.waiting?.since && agent.waiting.message)!;
  const { thread } = of(waiting.instance);
  const at = new Date(2026, 10, 19, 14, 3).toISOString();
  const now = new Date(2026, 10, 19, 14, 15).getTime();
  const claim = { ...waiting.waiting!, since: at };
  expect(agentStatus({ ...waiting, waiting: claim }, thread, now, "open")).toEqual({ state: "needs-you", word: "Needs you", since: "waiting 12 min (since 14:03)", detail: waiting.waiting!.message, kernel: null });
  // No message: the reason in words; an unknown reason: nothing more than the state.
  expect(agentStatus({ ...waiting, waiting: { ...claim, message: null, reason: "permission" } }, thread, now, "open").detail).toBe("Waiting for a tool approval");
  expect(agentStatus({ ...waiting, waiting: { ...claim, message: null, reason: "whatever" } }, thread, now, "open").detail).toBeNull();
  // A claim with no instant; a question that is bb's own, with no claim.
  expect(agentStatus({ ...waiting, waiting: { ...claim, since: null } }, thread, now, "open").since).toBeNull();
  expect(agentStatus({ ...waiting, waiting: null }, { ...thread, hasPendingInteraction: true }, now, "open")).toEqual({ state: "needs-you", word: "Needs you", since: null, detail: "bb shows its question in this thread", kernel: null });
  // The gate: a row the kernel calls stopped shows no claim, whatever it still carries.
  expect(agentStatus({ ...waiting, running: false, runtimeState: "stopped", waiting: claim }, { ...thread, hasPendingInteraction: false }, now, "open")).toEqual({ state: "stopped", word: "Stopped", since: null, detail: null, kernel: null });
  const working = agents.find((agent) => agent.running === true && agent.waiting === null)!;
  const quiet = { ...of(working.instance).thread, hasPendingInteraction: false };
  expect(agentStatus(working, quiet, now, "open")).toEqual({ state: "working", word: "Working", since: null, detail: null, kernel: null });
  expect(agentStatus({ ...working, running: false, runtimeState: "shell" }, quiet, now, "open")).toEqual({ state: "error", word: "Failed", since: null, detail: "Its session ended", kernel: null });
  expect(agentStatus({ ...working, running: null, runtimeState: "unreachable", runtimeError: "bb did not answer" }, quiet, now, "open")).toEqual({ state: "unreachable", word: "Unreachable", since: null, detail: "OATS cannot reach its session", kernel: "bb did not answer" });
  // An agent with no bb thread (it runs in tmux): the kernel's word alone.
  expect(agentStatus(working, null, now, "unknown")).toEqual({ state: "working", word: "Working", since: null, detail: null, kernel: null });
});

// "Since when", only where the kernel recorded a time (the spec's author, 2026-11-22; WORDS.md has
// the table): the claim's since for Needs you; the session's start for Working, said as that; the
// last "stopped" event for Stopped (from the instance's events, for the open thread's row); none
// for Idle, Failed and Unreachable.
test("a working agent says when its session started, as that; with no start in the kernel's row, no time", () => {
  const now = new Date(2026, 10, 21, 14, 30).getTime();
  const working = fixtureAgents().find((agent) => agent.running === true && agent.waiting === null)!;
  expect(agentStatus({ ...working, startedAt: new Date(2026, 10, 21, 14, 3).toISOString() }, null, now, "unknown")).toMatchObject({ state: "working", since: "session started 14:03", detail: null });
  expect(agentStatus({ ...working, startedAt: null }, null, now, "unknown").since).toBeNull();
  expect(agentStatus(working, null, now, "unknown").since).toBeNull(); // a row with no startedAt
  expect(sessionStarted("not a time", now)).toBeNull();
});

test("a stopped agent's time is its last \"stopped\" event's; none when its events hold none, or none since its session started", () => {
  const now = new Date(2026, 10, 21, 14, 30).getTime();
  const at = (h: number, m: number) => new Date(2026, 10, 21, h, m).toISOString();
  expect(stoppedSince([{ kind: "launched", at: at(9, 0) }, { kind: "stopped", at: at(10, 0) }, { kind: "launched", at: at(11, 0) }, { kind: "stopped", at: at(13, 41) }], at(11, 0), now)).toBe("since 13:41");
  expect(stoppedSince([{ kind: "launched", at: at(9, 0) }], null, now)).toBeNull();
  expect(stoppedSince(undefined, null, now)).toBeNull();
  expect(stoppedSince([{ kind: "stopped", at: "not a time" }], null, now)).toBeNull();
  // The events held are from before this stop (the session started after their last "stopped"):
  // an earlier stop's time is not this one's. A start the roster does not name, or cannot be read, hides nothing.
  expect(stoppedSince([{ kind: "stopped", at: at(10, 0) }], at(11, 0), now)).toBeNull();
  expect(stoppedSince([{ kind: "stopped", at: at(10, 0) }], null, now)).toBe("since 10:00");
  expect(stoppedSince([{ kind: "stopped", at: at(10, 0) }], "not a time", now)).toBe("since 10:00");
  // A stop of an earlier instance of the same name (the events are the address's history) is not this one's.
  expect(stoppedSince([{ kind: "stopped", at: at(10, 0), incarnation: "earlier" }], null, now)).toBeNull();
  expect(stoppedSince([{ kind: "stopped", at: at(9, 0), incarnation: "current" }, { kind: "stopped", at: at(10, 0), incarnation: "earlier" }], null, now)).toBe("since 09:00");
  expect(stoppedSince([{ kind: "stopped", at: at(10, 0), incarnation: "unknown" }], null, now)).toBe("since 10:00");
});
