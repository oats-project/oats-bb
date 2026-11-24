// @vitest-environment jsdom
// Behind a lifecycle result (app/roster/reading.tsx; the lead's L13, 24 Nov 2026): a result that says an
// agent started, restarted, stopped or was retired is true of the agent before the roster the window
// holds is read again. Until it is, the places that say that agent's state say "Reading…" and its
// acts are off: never the old state stated plainly. Rosters are compared, never clocks; and it
// never stands longer than ten seconds.
import { afterEach, describe, expect, test, vi } from "vitest";
import { act } from "@testing-library/react";
import { renderSlot } from "@get-bb/plugin-sdk/testing/app";
import type { ExperimentalThreadHeaderRowProps } from "@get-bb/plugin-sdk/app";
import { BOUND_MS, READING, actedAt, beforeEnd, noteActed } from "../../app/roster/reading";
import { fixtureAgents, fixtureSnapshot } from "../helpers/fixtures";
import { handlers, loadApp, resetApp, sidebarThreads } from "../helpers/render";
import type { Contract } from "../helpers/render";
import type { Agent } from "../../model/types";

afterEach(() => {
  vi.useRealTimers();
  resetApp();
});

// THE RULE IS ONE COMPARISON (the specialist's ruling of 24 Nov 2026, after four forms that answered the question by
// proxy): "was this roster READ AFTER THE ACT ENDED?". The roster's `at` is the plugin server's clock at the START of
// the status read that made it; the act's answer carries the same clock at the act's END (`endedAt`). Before: the
// read started at or before the end. No state, no word, no row, no case per act. Each row below is a case one of the
// four review rounds found against an earlier form, BY ITS NAME, so that the next reader finds its case already here.
describe("whether the roster the window holds was read before the act ended (pure: two stamps of ONE clock, the server's; never the window's)", () => {
  const ENDED = "2026-11-19T12:30:03.000Z"; // the act's command returned
  test.each<[string, string | null, boolean]>([
    ["the roster of the send (read before the act began): before", "2026-11-19T12:30:00.000Z", true],
    ["a roster READ DURING THE ACT (its read started before the act ended: a Start or a Restart on bb makes a thread, which asks for a read mid-act; a stop of three changes the roster at each): before, whatever it says", "2026-11-19T12:30:02.000Z", true],
    ["a read that started in the very millisecond the act ended: before (it cannot be trusted to hold what the act did)", ENDED, true],
    ["the same instant, written otherwise: before", "2026-11-19T12:30:03Z", true],
    ["a roster whose read started one millisecond after the act ended: read", "2026-11-19T12:30:03.001Z", false],
    ["a roster read after the act ended: read, at once, whatever it says (a Stop whose agent never comes to read Stopped is not held ten seconds)", "2026-11-19T12:30:05.000Z", false],
    ["an OLDER roster that arrives late: before (its read started before the act ended)", "2026-11-19T12:29:59.000Z", true],
    ["no roster read yet (a ready roster always carries its stamp; nothing of the agent is drawn then): not before, nothing is left standing on nothing", null, false],
    ["a stamp that is no time: read (nothing is left standing on a guess; the bound would end it anyway)", "soon", false],
  ])("%s", (_name, rosterAt, before) => {
    expect(beforeEnd(ENDED, rosterAt)).toBe(before);
  });

  // The same, said of the cases by the agent's side: the rule never asks what the agent reads, so each of these is
  // "before" exactly while the roster is one read before the end, and "read" from the first roster read after it.
  test.each<[string]>([
    ["a bb agent that reads Idle because its thread left bb's list after a Stop (the roster has not moved)"],
    ["a Restart of a Failed agent: a mid-act roster still says Failed"],
    ["a Restart of a running agent: a mid-act roster says Stopped (between its stop and its start)"],
    ["a Start of an agent that reads Idle with no harness loaded: a mid-act roster says Idle"],
    ["a Start of a stopped agent that reads Needs you through bb's question on its thread"],
    ["a row the server PATCHED from the agent's own events (#74) on an older roster: still before, until the status read the act asks for has come back (a moment late over a row that is already right: the safe side)"],
    ["a retire's child, and a session that did stop in a stop that did not stop them all: marked with the same end"],
  ])("%s: before on a roster read before the end, read on the first one read after it", () => {
    expect([beforeEnd(ENDED, "2026-11-19T12:30:02.500Z"), beforeEnd(ENDED, "2026-11-19T12:30:03.200Z")]).toEqual([true, false]);
  });

  test("an act whose end is no time marks nothing as before", () => {
    expect([beforeEnd("soon", "2026-11-19T12:30:00.000Z"), beforeEnd("soon", "soon")]).toEqual([false, false]);
  });
});

const DIGEST = "weekly-digest-helper"; // the sample's stopped agent, on thr_digest: its line's act is Start…
const AT = fixtureSnapshot().at;
const LATER = "2026-11-19T12:30:05.000Z";

/** The thread's line of an agent, over a roster a test changes: `answer.now` is what the server answers next. */
async function line(threadId: string) {
  const app = await loadApp();
  const answer = { now: fixtureSnapshot() as ReturnType<typeof fixtureSnapshot> };
  const slot = renderSlot<ExperimentalThreadHeaderRowProps, Contract>(app.threadHeaderRows[0]!, { threadId, projectId: "proj_x", environment: null }, { rpc: handlers({ snapshot: () => answer.now }), sidebarThreads: sidebarThreads() });
  await slot.findByTestId("oats-identity-row");
  const read = () => {
    const status = slot.getByTestId("oats-status-line");
    return {
      reading: slot.queryByTestId("oats-reading")?.textContent ?? null,
      state: status.querySelector('[data-testid="oats-state"]')?.textContent ?? null,
      acts: Array.from(status.querySelectorAll<HTMLButtonElement>('[data-testid="oats-status-act"]')).map((button) => [button.textContent, button.disabled]),
      text: status.textContent,
    };
  };
  return { slot, answer, read };
}
const started = (agents: Agent[]): Agent[] => agents.map((agent) => (agent.instance === DIGEST ? { ...agent, running: true, runtimeState: "running" } : agent));

test("behind a result that says the agent changed, its thread's line says \"Reading…\" in the state's place and its act is off, until a roster read after the act is in the window", async () => {
  const { slot, answer, read } = await line("thr_digest");
  expect(read()).toMatchObject({ reading: null, state: "Stopped", acts: [["Start…", false]] });
  // The result says it started. The roster the window held when the act was sent is the one it still holds.
  act(() => noteActed([DIGEST], AT));
  expect(read()).toMatchObject({ reading: READING, state: null, acts: [["Start…", true]] });
  expect(READING).toBe("Reading…");
  expect(read().text).not.toMatch(/Stopped|outside OATS/); // never the old state stated plainly, nor its sentence
  expect(slot.getByTestId("oats-reading").getAttribute("role")).toBe("status");
  // The way to the instance panel is no act of the lifecycle: it stays.
  expect((slot.getByTestId("oats-open-panel") as HTMLButtonElement).disabled).toBe(false);
  // The server's roster is read again, and it is still the old one (the same stamp): "Reading…" stands.
  await act(async () => slot.behavior.emitRealtime("oats/changed", { at: AT }));
  expect(read().reading).toBe(READING);
  // A roster read after the act: the state is what it says, at once.
  answer.now = { ...fixtureSnapshot(started(fixtureAgents())), at: LATER };
  await act(async () => slot.behavior.emitRealtime("oats/changed", { at: LATER }));
  await vi.waitFor(() => expect(read().reading).toBeNull());
  expect(read().state).not.toBe("Stopped");
});

test("a roster READ DURING THE ACT (its read started after the send and before the act ended) does not end \"Reading…\", whatever it says: the first roster read after the end does", async () => {
  const { slot, answer, read } = await line("thr_digest");
  // The result of a start, whose command returned at 12:30:03 on the server's clock.
  act(() => noteActed([DIGEST], "2026-11-19T12:30:03.000Z"));
  expect(read().reading).toBe(READING);
  // A roster whose read started at 12:30:02: after the send, before the end. The agent is still stopped in it.
  answer.now = { ...fixtureSnapshot(fixtureAgents()), at: "2026-11-19T12:30:02.000Z" };
  await act(async () => slot.behavior.emitRealtime("oats/changed", { at: answer.now.at }));
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(read()).toMatchObject({ reading: READING, state: null, acts: [["Start…", true]] }); // never "Stopped" behind "… started."
  // The roster that says it runs: the state is what it says.
  answer.now = { ...fixtureSnapshot(started(fixtureAgents())), at: LATER };
  await act(async () => slot.behavior.emitRealtime("oats/changed", { at: LATER }));
  await vi.waitFor(() => expect(read().reading).toBeNull());
  expect(read().state).not.toBe("Stopped");
});

// THE SECOND REVIEW ROUND'S CASE, on the thread's line: an agent on a bb thread that WORKS is stopped. bb says whether it
// works (its thread's own status), and the stop archives the thread: it leaves bb's list while the roster in the window
// is still the one of the send (its row still says it runs). The line then reads the agent as "Idle", acts on. Behind
// "… stopped." it says "Reading…", with its act off, until the roster says Stopped.
test("a Stop of a Working agent: bb no longer says its thread works and the roster is still the send's: the line says \"Reading…\" with its act off, never \"Idle\"; the roster that says Stopped ends it", async () => {
  const MOCKUPS = "desktop-mockups-developer"; // the sample's working child, on thr_mockups
  const app = await loadApp();
  const answer = { now: fixtureSnapshot() as ReturnType<typeof fixtureSnapshot> };
  const threads = sidebarThreads();
  const resting = { ...threads, threads: threads.threads.map((thread) => (thread.id === "thr_mockups" ? { ...thread, status: "idle" as const } : thread)) };
  // (The window as it is right after the stop: bb's row of the thread no longer works; the roster is the send's.)
  const slot = renderSlot<ExperimentalThreadHeaderRowProps, Contract>(app.threadHeaderRows[0]!, { threadId: "thr_mockups", projectId: "proj_x", environment: null }, { rpc: handlers({ snapshot: () => answer.now }), sidebarThreads: resting });
  await slot.findByTestId("oats-identity-row");
  const read = () => ({ reading: slot.queryByTestId("oats-reading")?.textContent ?? null, state: slot.getByTestId("oats-status-line").querySelector('[data-testid="oats-state"]')?.textContent ?? null, acts: Array.from(slot.getByTestId("oats-status-line").querySelectorAll<HTMLButtonElement>('[data-testid="oats-status-act"]')).map((button) => button.disabled) });
  expect(read()).toMatchObject({ reading: null, state: "Idle" }); // what the line would say with no mark: the fault
  // The stop's result: it worked in the roster held at the send.
  act(() => noteActed([MOCKUPS], AT));
  expect(read()).toMatchObject({ reading: READING, state: null });
  expect(read().acts.every((off) => off === true)).toBe(true);
  // The same roster again (the same stamp): it stands.
  await act(async () => slot.behavior.emitRealtime("oats/changed", { at: AT }));
  expect(read().reading).toBe(READING);
  // The roster that says it is stopped: read.
  answer.now = { ...fixtureSnapshot(fixtureAgents().map((agent) => (agent.instance === MOCKUPS ? { ...agent, running: false as const, runtimeState: "stopped", sessionEnd: "operator" } : agent))), at: LATER };
  await act(async () => slot.behavior.emitRealtime("oats/changed", { at: LATER }));
  await vi.waitFor(() => expect(read().reading).toBeNull());
  expect(read().state).toBe("Stopped");
});

// THE RULE HAS TWO HALVES. The window's: "before" while the roster's `at` <= the act's `endedAt`, and the bound. The
// SERVER's: the status read an act asks for as it ends is PUBLISHED whether or not it differs from the last one
// (server/core.ts; the roster developer's mend and its server test). Without the second, this case stood ten seconds:
// a read that STARTED mid-act (the kernel writes the agent's event before its command returns) already holds the final
// state and is published; the act's own read, after the end, says the SAME, and a read that says nothing new was not
// published: the window kept a roster stamped before the end, over a row that was right. Here, the window's side of it.
test("the final state is already on a roster read BEFORE the act ended: \"Reading…\" stands (that read cannot be trusted); the act's own read says the SAME and is published: \"Reading…\" leaves with it", async () => {
  const { slot, answer, read } = await line("thr_digest");
  act(() => noteActed([DIGEST], "2026-11-19T12:30:03.000Z")); // a start whose command returned at 12:30:03
  // A read that started at 12:30:02, mid-act, and already says the agent runs: published (it differs), and in the window.
  answer.now = { ...fixtureSnapshot(started(fixtureAgents())), at: "2026-11-19T12:30:02.000Z" };
  await act(async () => slot.behavior.emitRealtime("oats/changed", { at: answer.now.at }));
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(read()).toMatchObject({ reading: READING, state: null });
  // The act's own read, started after its end: the SAME agents, a later stamp. Published all the same: the window takes it.
  answer.now = { ...fixtureSnapshot(started(fixtureAgents())), at: "2026-11-19T12:30:03.200Z" };
  await act(async () => slot.behavior.emitRealtime("oats/changed", { at: answer.now.at }));
  await vi.waitFor(() => expect(read().reading).toBeNull());
  expect(read().state).not.toBe("Stopped");
});

// Behind a result EVERY act of that agent is off (ruled with L13's form): also "Answer", which answers a claim from
// BEFORE the act.
test("behind a result the line's Answer is off too: the claim it answers is from before the act", async () => {
  const claim = { reason: "attention" as const, message: "Which mockup?", since: "2026-11-19T12:00:00.000Z" };
  const app = await loadApp();
  const agents = fixtureAgents().map((agent) => (agent.instance === "desktop-mockups-developer" ? { ...agent, waiting: claim } : agent));
  const slot = renderSlot<ExperimentalThreadHeaderRowProps, Contract>(app.threadHeaderRows[0]!, { threadId: "thr_mockups", projectId: "proj_x", environment: null }, { rpc: handlers({}, agents), sidebarThreads: sidebarThreads() });
  await slot.findByTestId("oats-identity-row");
  const answer = () => Array.from(slot.getByTestId("oats-status-line").querySelectorAll<HTMLButtonElement>('[data-testid="oats-status-act"]')).map((button) => [button.textContent, button.disabled]);
  expect(answer()).toEqual([["Answer", false]]);
  act(() => noteActed(["desktop-mockups-developer"], AT));
  expect([slot.getByTestId("oats-reading").textContent, answer()]).toEqual([READING, [["Answer", true]]]);
});

test("it is that agent's alone: another agent's line says its state and keeps its act", async () => {
  const { read } = await line("thr_digest");
  act(() => noteActed(["release-070-maintainer"], AT));
  expect(read()).toMatchObject({ reading: null, state: "Stopped", acts: [["Start…", false]] });
});

test("BOUNDED: after ten seconds the roster's own state is drawn whatever it says (a watch that died leaves no \"Reading…\" on a page)", async () => {
  const { read } = await line("thr_digest");
  vi.useFakeTimers();
  act(() => noteActed([DIGEST], AT));
  expect(read().reading).toBe(READING);
  act(() => void vi.advanceTimersByTime(BOUND_MS - 1));
  expect(read().reading).toBe(READING);
  act(() => void vi.advanceTimersByTime(1));
  expect(read()).toMatchObject({ reading: null, state: "Stopped", acts: [["Start…", false]] });
  expect(BOUND_MS).toBe(10_000);
  expect(actedAt(DIGEST)).toBeNull();
});

test("a second act on the same agent starts its own ten seconds; a result that names no agent marks nothing", async () => {
  const { read } = await line("thr_digest");
  vi.useFakeTimers();
  act(() => noteActed([DIGEST], AT));
  act(() => void vi.advanceTimersByTime(6_000));
  act(() => noteActed([DIGEST], AT));
  act(() => void vi.advanceTimersByTime(6_000)); // twelve seconds after the first, six after the second
  expect(read().reading).toBe(READING);
  act(() => void vi.advanceTimersByTime(4_000));
  expect(read().reading).toBeNull();
  act(() => noteActed([], AT));
  expect([read().reading, actedAt(DIGEST)]).toEqual([null, null]);
});

test("while OATS cannot be read (the roster is the last one read) the line is the last roster's, under its notice: not \"Reading…\"", async () => {
  const app = await loadApp();
  const last = { at: AT, deployment: fixtureSnapshot().deployment, agents: fixtureAgents() };
  const slot = renderSlot<ExperimentalThreadHeaderRowProps, Contract>(
    app.threadHeaderRows[0]!,
    { threadId: "thr_digest", projectId: "proj_x", environment: null },
    { rpc: handlers({ snapshot: () => ({ ok: false, at: LATER, code: "OATS_TIMEOUT", message: "oats did not answer", last }) }), sidebarThreads: sidebarThreads() },
  );
  await slot.findByTestId("oats-identity-row");
  act(() => noteActed([DIGEST], AT));
  expect(slot.queryByTestId("oats-reading")).toBeNull();
  expect(slot.getByTestId("oats-status-line").querySelector('[data-testid="oats-state"]')!.textContent).toBe("Stopped");
  expect(slot.getByTestId("oats-unreadable")).toBeTruthy();
});
