// agentStatus(): the state in words, for every place that says one (today the home's card reads its age from it).
import { expect, test } from "vitest";
import { agentStatus } from "../../app/roster/status";
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
    const status = agentStatus(agent, thread, NOW);
    return `${agent.instance}: ${status.state} / ${status.word}`;
  });
  expect(words).toMatchInlineSnapshot(`
    [
      "release-070-maintainer: needs-you / needs you",
      "redesign-ui-lead: working / working",
      "desktop-mockups-developer: working / working",
      "harvest-knowledge-helper: idle / idle",
      "flaky-ci-developer: needs-you / needs you",
      "ranker-v3-probe: needs-you / needs you",
      "weekly-digest-helper: stopped / stopped",
    ]
  `);
});

test("since is how long an agent has waited on a person, and null for one that does not wait", () => {
  const waiting = agents.find((agent) => agent.waiting?.since)!;
  const { thread } = of(waiting.instance);
  const minutes = 12;
  const status = agentStatus(waiting, thread, Date.parse(waiting.waiting!.since!) + minutes * 60_000);
  expect(status).toEqual({ state: "needs-you", word: "needs you", since: "12 min ago" });
  // A claim with no instant, and an agent that needs a person through bb's pending interaction alone.
  expect(agentStatus({ ...waiting, waiting: { ...waiting.waiting!, since: null } }, thread, NOW).since).toBeNull();
  expect(agentStatus({ ...waiting, waiting: null }, { ...thread, hasPendingInteraction: true }, NOW)).toEqual({ state: "needs-you", word: "needs you", since: null });
  const working = agents.find((agent) => agent.running === true && agent.waiting === null)!;
  expect(agentStatus(working, { ...of(working.instance).thread, hasPendingInteraction: false }, NOW)).toEqual({ state: "working", word: "working", since: null });
});
