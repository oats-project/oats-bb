// AgentStatusLine: the one status line of one agent, for the thread's row and the panel's header.
// @vitest-environment jsdom
import { afterEach, expect, test } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { AgentStatusLine } from "../../app/roster/AgentStatusLine";
import type { BbThread } from "../../model/types";
import { fixtureAgents, fixtureThreads } from "../helpers/fixtures";

afterEach(cleanup);
const threads = fixtureThreads() as unknown as BbThread[];
const of = (instance: string, over: object = {}) => {
  const agent = { ...fixtureAgents().find((candidate) => candidate.instance === instance)!, ...over };
  return { agent, thread: threads.find((candidate) => candidate.id === agent.threadId) ?? null };
};
const line = () => screen.getByTestId("oats-status-line").textContent;

test("an agent that needs you: the line holds the question itself, wherever it is drawn (the header too)", () => {
  const now = Date.parse("2026-11-19T12:30:00.000Z");
  const since = new Date(now - 12 * 60_000).toISOString();
  render(<AgentStatusLine {...of("release-070-maintainer", { waiting: { reason: "question", message: "Green light at 9f2e1c?", since } })} now={now} />);
  expect(line()).toBe("!Needs you· 12 min· Green light at 9f2e1c?"); // how long, never a clock time
});

test("drawn from a roster kept as last read, the line says so last, with its age; drawn from the one just read, it says none", () => {
  const now = Date.parse("2026-11-19T12:30:00.000Z");
  const { rerender } = render(<AgentStatusLine {...of("desktop-mockups-developer")} now={now} staleAt={new Date(now - 2 * 60_000).toISOString()} />);
  expect(line()).toBe("Working· as of 2 min ago");
  rerender(<AgentStatusLine {...of("desktop-mockups-developer")} now={now} />);
  expect(line()).toBe("Working");
  // A feature that knows more of the agent says what follows the state's word: given the roster's own, it answers its own (and whether the line warns).
  rerender(<AgentStatusLine {...of("desktop-mockups-developer")} now={now} parts={(own) => ({ since: own.since, detail: "Its conversation is archived in bb", tone: "warning" })} />);
  expect(line()).toBe("Working· Its conversation is archived in bb");
  expect(document.querySelector('[data-testid="oats-status-part"][data-tone="warning"]')?.textContent).toContain("Its conversation is archived in bb");
});

test("a stopped agent's line says the state and its act, and no time; an unreachable one says the state alone, with what OATS says under Details", () => {
  const now = new Date(2026, 10, 21, 14, 30).getTime();
  const { rerender } = render(<AgentStatusLine {...of("weekly-digest-helper")} now={now} action={<button type="button">Start</button>} />);
  expect(line()).toBe("StoppedStart"); // when it stopped is a fact of the instance panel's Session, not of a line
  rerender(<AgentStatusLine {...of("weekly-digest-helper")} now={now} />);
  expect(line()).toBe("Stopped");
  rerender(<AgentStatusLine {...of("desktop-mockups-developer", { running: null, runtimeState: "unreachable", runtimeError: "bb did not answer" })} now={now} />);
  expect(line()).toBe("Unreachable"); // no sentence that repeats the word
  expect(screen.getByTestId("oats-status-kernel").querySelector("p")!.textContent).toBe("OATS says: bb did not answer");
});

test("an agent the kernel no longer knows: the line says that in the state's place, once, and nothing of its state", () => {
  render(<AgentStatusLine {...of("weekly-digest-helper")} now={Date.now()} gone />);
  expect(line()).toBe("Not in OATS any more");
  expect(screen.getByTestId("oats-status-line").getAttribute("data-state")).toBe("stopped"); // the mark of an agent that does not run
});
