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
import { BOUND_MS, READING, actedAt, actedWas, beforeAct, fromBefore, noteActed } from "../../app/roster/reading";
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
  test.each<[string, { was: "working" | "stopped" | null }, string | null, "working" | "stopped" | "idle" | null, boolean]>([
    ["the roster of the send: before, whatever the state", { was: "working" }, SENT, "working", true],
    ["a later roster that still says what the send's said (it arrived mid-act): before", { was: "working" }, LATER, "working", true],
    ["a later roster that says another state: read", { was: "working" }, LATER, "stopped", false],
    ["a later roster with no such agent (retired): read", { was: "working" }, LATER, null, false],
    ["a start: stopped at the send, still stopped in a later roster: before", { was: "stopped" }, LATER, "stopped", true],
    ["a start: a later roster says it is idle: read", { was: "stopped" }, LATER, "idle", false],
    ["no state kept (a restart): the stamp alone decides: a later roster is read", { was: null }, LATER, "working", false],
    ["no state kept, the roster of the send: before", { was: null }, SENT, "working", true],
    ["no roster in the window: not before (nothing is left standing on nothing)", { was: "working" }, null, null, false],
  ])("%s", (_name, acted, rosterAt, now, before) => {
    expect(fromBefore({ sentAt: SENT, ...acted }, rosterAt, now)).toBe(before);
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
  act(() => noteActed([DIGEST], AT, new Map([[DIGEST, "stopped"]])));
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
