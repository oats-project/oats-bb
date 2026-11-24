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
import { BOUND_MS, READING, actedAt, actedWas, beforeAct, ended, fromBefore, keptState, noteActed } from "../../app/roster/reading";
import { fixtureAgents, fixtureSnapshot } from "../helpers/fixtures";
import { handlers, loadApp, resetApp, sidebarThreads } from "../helpers/render";
import type { Contract } from "../helpers/render";
import type { Agent } from "../../model/types";

afterEach(() => {
  vi.useRealTimers();
  resetApp();
});

describe("whether the window's roster is still from before an act (pure: two rosters' stamps, no clock)", () => {
  const SENT = "2026-11-19T12:30:00.000Z"; // the stamp of the roster the window held when the act was sent
  test.each<[string, string | null, boolean]>([
    ["the same roster", SENT, true],
    ["an older roster (one that arrives late)", "2026-11-19T12:29:59.000Z", true],
    ["the same instant, written otherwise", "2026-11-19T12:30:00Z", true],
    ["a roster read one millisecond after", "2026-11-19T12:30:00.001Z", false],
    ["a roster read after", "2026-11-19T12:30:04.000Z", false],
    ["no roster", null, false],
    ["a stamp that is no time: nothing is left standing on a guess", "soon", false],
  ])("%s", (_name, rosterAt, before) => {
    expect(beforeAct(SENT, rosterAt)).toBe(before);
  });
  test("an act sent over a stamp that is no time stands only while the roster is that very one", () => {
    expect([beforeAct("t", "t"), beforeAct("t", "2026-11-19T12:30:00.000Z")]).toEqual([true, false]);
  });
});

// A roster can reach the window DURING an act that takes seconds (a stop of three agents changes the roster at each
// stop). Its stamp is after the send, and it can still say of an agent what the roster at the send said: the window
// then still shows the agent as it was before the act (found by the first review round: "Working" stood behind
// "3 sessions stopped."). So the agent's state at the send is kept too; a restart keeps none (the same word after).
describe("whether the window still shows an agent as it was before an act (pure: two rosters, no clock)", () => {
  const SENT = "2026-11-19T12:30:00.000Z";
  const LATER = "2026-11-19T12:30:02.000Z";
  const OLDER = "2026-11-19T12:29:59.000Z";
  type Now = "working" | "stopped" | "idle" | "needs-you" | "error" | null;
  test.each<[string, { was: "working" | "stopped" | "needs-you" | null; verb: "stop" | "start" | "retire" | "restart" | null }, string | null, Now, boolean]>([
    // A state is kept: "before" lasts until the agent's state says that the ACT HAPPENED, whatever the roster's stamp.
    ["a stop, the roster of the send, the state as at the send: before", { was: "working", verb: "stop" }, SENT, "working", true],
    ["a stop, the roster of the send, the row patched to Stopped from the agent's own events (#74): read", { was: "working", verb: "stop" }, SENT, "stopped", false],
    // THE SECOND REVIEW ROUND'S CASE: a bb agent that worked; the stop archives its thread, which leaves bb's list, so
    // on the roster of the send (its row still says it runs) its state is already "idle": neither the kept word nor
    // the stop's end. Behind "… stopped." that must not read "Idle" with its acts on.
    ["a stop of a Working agent whose thread left bb's list: Idle on the roster of the send: STILL before", { was: "working", verb: "stop" }, SENT, "idle", true],
    ["the same for an agent that read Needs you through a question bb held: still before", { was: "needs-you", verb: "stop" }, SENT, "idle", true],
    ["and on a later roster that still says it runs (idle: its thread gone): still before", { was: "working", verb: "stop" }, LATER, "idle", true],
    ["a stop, a later roster that still says what the send's said (it arrived mid-act): before", { was: "working", verb: "stop" }, LATER, "working", true],
    ["a stop, a later roster that says Stopped: read", { was: "working", verb: "stop" }, LATER, "stopped", false],
    ["a retire, the roster of the send, its thread gone (idle): still before", { was: "working", verb: "retire" }, SENT, "idle", true],
    ["a retire, a roster in which it only reads Stopped (its stop, before it leaves): still before", { was: "working", verb: "retire" }, LATER, "stopped", true],
    ["a retire, a roster with no such agent: read", { was: "working", verb: "retire" }, LATER, null, false],
    ["a start: stopped at the send, still stopped in a later roster: before", { was: "stopped", verb: "start" }, LATER, "stopped", true],
    ["a start: a roster that says Failed: still before (the result said it started: the next roster settles it, or the bound)", { was: "stopped", verb: "start" }, LATER, "error", true],
    ["a start: a later roster says it is idle: read", { was: "stopped", verb: "start" }, LATER, "idle", false],
    // EDGE 1 (the roster developer's): no roster in the window at all. That is only "no roster read yet" (a ready roster
    // always carries its stamp: app/oats.ts; and `useReading` asks only of a ready one): nothing of the agent is drawn
    // then, so nothing is left standing on nothing.
    ["EDGE: no roster read yet, with a kept state: not before (nothing is drawn of the agent to stand over)", { was: "working", verb: "stop" }, null, null, false],
    // EDGE 2: an OLDER roster that arrives late. It is judged like any roster: by what it says of the agent. Saying
    // the act's end state ("read") it lets "Reading…" go a moment early, and the next roster corrects the word: a guard
    // would need a second clock (ruled: not worth one). Saying anything else, "Reading…" stands.
    ["EDGE: an older roster that arrives late and says Stopped after a stop: read (a moment early; the next roster corrects the word)", { was: "working", verb: "stop" }, OLDER, "stopped", false],
    ["EDGE: an older roster that arrives late and says another state than the kept one, not the act's end: before", { was: "working", verb: "stop" }, OLDER, "idle", true],
    // No state kept (a restart; a stop of a stopped target): the stamp alone decides.
    ["no state kept (a restart): a later roster is read", { was: null, verb: null }, LATER, "working", false],
    ["no state kept, the roster of the send: before", { was: null, verb: null }, SENT, "working", true],
    ["no state kept, an older roster that arrives late: before", { was: null, verb: null }, OLDER, "working", true],
    ["no state kept, no roster read yet: not before", { was: null, verb: null }, null, null, false],
  ])("%s", (_name, acted, rosterAt, now, before) => {
    expect(fromBefore({ sentAt: SENT, ...acted }, rosterAt, now)).toBe(before);
  });

  test.each<[Parameters<typeof ended>[0], Now, boolean]>([
    ["stop", "stopped", true], ["stop", "idle", false], ["stop", "working", false], ["stop", null, false],
    ["retire", null, true], ["retire", "stopped", false], ["retire", "idle", false],
    ["start", "idle", true], ["start", "working", true], ["start", "needs-you", true], ["start", "stopped", false], ["start", "error", false], ["start", null, false],
    ["restart", "working", false],
  ])("whether a roster's row says that a %s happened to an agent that reads %s: %s", (verb, now, yes) => {
    expect(ended(verb, now)).toBe(yes);
  });
});

// The state is kept only where the act MUST change the word: else a later roster that says the same word would hold
// "Reading…" for the whole ten seconds over a state that will not change (the delta read of the first review round).
describe("the state kept for an agent of an act", () => {
  test.each<[Parameters<typeof keptState>[0], Parameters<typeof keptState>[1], ReturnType<typeof keptState>]>([
    ["stop", "working", "working"],
    ["stop", "idle", "idle"],
    ["stop", "needs-you", "needs-you"],
    ["stop", "error", "error"],
    ["stop", "stopped", null], // a target that was already stopped: the same word after
    ["start", "stopped", "stopped"],
    ["start", "error", "error"],
    ["start", "idle", null], // not loaded: it can read Idle after too
    ["start", "needs-you", null], // its claim kept: Needs you after too
    ["restart", "working", null],
    ["restart", "error", null],
    ["retire", "working", "working"], // it leaves the roster
    ["retire", "stopped", "stopped"],
    ["stop", null, null],
  ])("%s of an agent that read %s: %s", (verb, was, keeps) => {
    expect(keptState(verb, was)).toBe(keeps);
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

test("a roster that reaches the window during the act and still says what the send's said does not end \"Reading…\": the roster that says another state does", async () => {
  const { slot, answer, read } = await line("thr_digest");
  // The result of a start: the agent was stopped in the roster held at the send.
  act(() => noteActed([DIGEST], AT, { verb: "start", was: new Map([[DIGEST, "stopped"]]) }));
  expect([read().reading, actedWas(DIGEST)]).toEqual([READING, "stopped"]);
  // A roster stamped AFTER the send, in which the agent is still stopped (another agent's change, or one of the act's own steps).
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
  act(() => noteActed([MOCKUPS], AT, { verb: "stop", was: new Map([[MOCKUPS, "working"]]) }));
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

test("a second act on the same agent starts its own ten seconds; an act sent with no roster in the window marks nothing", async () => {
  const { read } = await line("thr_digest");
  vi.useFakeTimers();
  act(() => noteActed([DIGEST], AT));
  act(() => void vi.advanceTimersByTime(6_000));
  act(() => noteActed([DIGEST], AT));
  act(() => void vi.advanceTimersByTime(6_000)); // twelve seconds after the first, six after the second
  expect(read().reading).toBe(READING);
  act(() => void vi.advanceTimersByTime(4_000));
  expect(read().reading).toBeNull();
  act(() => noteActed([DIGEST], null));
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
