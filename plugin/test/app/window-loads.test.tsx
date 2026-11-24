// @vitest-environment jsdom
// A window that loads WHILE the server reads a change. The server answers `snapshot` from its
// cache at once; the read that is in flight ends after that answer was made and publishes
// "oats/changed". The window's first read is then still on its way, and it must not end up
// holding the roster from before the change.
import { afterEach, expect, test } from "vitest";
import { act, waitFor, within } from "@testing-library/react";
import { renderSlot } from "@get-bb/plugin-sdk/testing/app";
import type { PluginThreadListProps } from "@get-bb/plugin-sdk/app";
import type { Agent } from "../../model/types";
import { fixtureAgents, fixtureSnapshot } from "../helpers/fixtures";
import { handlers, loadApp, resetApp, sidebarThreads } from "../helpers/render";
import type { Contract } from "../helpers/render";

afterEach(resetApp);

const WAITS = "desktop-mockups-developer"; // on thr_mockups: it waits on a person before the change, and not after it
const claim = { reason: "attention" as const, message: "Which mockup?", since: "2026-11-19T12:00:00.000Z" };
const before = (): Agent[] => fixtureAgents().map((agent) => (agent.instance === WAITS ? { ...agent, waiting: claim } : agent));
const after = (): Agent[] => fixtureAgents().map((agent) => (agent.instance === WAITS ? { ...agent, waiting: null } : agent));

test("a window that loads while the server reads a change: its first answer is the roster from before, the change is published while that answer is on its way, and the window ends on the new roster with no further change", async () => {
  // The server: the first `snapshot` answer is made from the cache from BEFORE the change and is on its way; every later one is the new roster.
  let calls = 0;
  let deliver: (() => void) | undefined;
  const first = new Promise<void>((resolve) => (deliver = resolve));
  const snapshot = async () => {
    calls += 1;
    if (calls === 1) {
      await first;
      return fixtureSnapshot(before());
    }
    return fixtureSnapshot(after());
  };
  const app = await loadApp();
  const slot = renderSlot<PluginThreadListProps, Contract>(
    app.threadLists[0]!,
    { activeThreadId: null, activeProjectId: null, isCompactViewport: false, onNavigate: () => undefined, searchQuery: "" },
    { rpc: handlers({ snapshot }), sidebarThreads: sidebarThreads() },
  );
  await waitFor(() => expect(calls).toBe(1));
  // The read that was in flight on the server ends and publishes, while the window's first answer is still on its way.
  await act(async () => slot.behavior.emitRealtime("oats/changed", { at: "2026-11-24T12:00:00.000Z" }));
  // The first answer arrives: the roster from before the change.
  await act(async () => deliver!());
  const facts = () => within(slot.getAllByTestId("oats-agent-row").find((row) => row.getAttribute("data-sidebar-thread-id") === "thr_mockups")!).getByTestId("oats-row-facts").textContent;
  await slot.findByTestId("oats-tree");
  // Nothing else changes, and nothing else is published: the window must still come to the new roster.
  await waitFor(() => expect(facts()).not.toMatch(/^Needs you/));
  expect(calls).toBeGreaterThanOrEqual(2);
});

/** The sidebar over a `snapshot` handler of the test's own; what the mockups developer's row says; how many times `snapshot` was answered. */
async function sidebarOver(snapshot: () => Promise<ReturnType<typeof fixtureSnapshot>>) {
  const app = await loadApp();
  const slot = renderSlot<PluginThreadListProps, Contract>(
    app.threadLists[0]!,
    { activeThreadId: null, activeProjectId: null, isCompactViewport: false, onNavigate: () => undefined, searchQuery: "" },
    { rpc: handlers({ snapshot }), sidebarThreads: sidebarThreads() },
  );
  const facts = () => within(slot.getAllByTestId("oats-agent-row").find((row) => row.getAttribute("data-sidebar-thread-id") === "thr_mockups")!).getByTestId("oats-row-facts").textContent;
  return { slot, facts };
}

// (This one holds on main too: for a read that HAS an answer bb drops the reread in flight and starts another. It is here so that the fix adds no read to it.)
test("two changes close together: the second is published while the first's reread is on its way, and the window ends on the roster after the second", async () => {
  // Answers: 1 the load (before); 2 the first event's reread, made by the server BEFORE the second change and held on its way; 3 and later: after the second change.
  let calls = 0;
  let deliver: (() => void) | undefined;
  const second = new Promise<void>((resolve) => (deliver = resolve));
  const { slot, facts } = await sidebarOver(async () => {
    calls += 1;
    if (calls === 1) return fixtureSnapshot(before());
    if (calls === 2) {
      await second;
      return fixtureSnapshot(before());
    }
    return fixtureSnapshot(after());
  });
  await slot.findByTestId("oats-tree");
  expect(facts()).toMatch(/^Needs you/);
  await act(async () => slot.behavior.emitRealtime("oats/changed", { at: "2026-11-24T12:00:00.000Z" }));
  await waitFor(() => expect(calls).toBe(2));
  // The second change is published (its own token) while that reread is on its way.
  await act(async () => slot.behavior.emitRealtime("oats/changed", { at: "2026-11-24T12:00:00.400Z" }));
  await act(async () => deliver!());
  await waitFor(() => expect(facts()).not.toMatch(/^Needs you/));
  expect(calls).toBe(3); // one read more, and no more than one
});

test("an event with no read on its way is one read, as before: nothing is read twice", async () => {
  let calls = 0;
  const { slot, facts } = await sidebarOver(async () => {
    calls += 1;
    return fixtureSnapshot(calls === 1 ? before() : after());
  });
  await slot.findByTestId("oats-tree");
  expect([calls, facts()]).toEqual([1, "Needs you · oats-desktop-developer"]);
  await act(async () => slot.behavior.emitRealtime("oats/changed", { at: "2026-11-24T12:00:00.000Z" }));
  await waitFor(() => expect(facts()).not.toMatch(/^Needs you/));
  // Given time for a second read to be made, none is.
  await act(async () => new Promise((resolve) => setTimeout(resolve, 50)));
  expect(calls).toBe(2);
  // The same token again (every slot hears each event; bb may deliver one twice): acted on once.
  await act(async () => slot.behavior.emitRealtime("oats/changed", { at: "2026-11-24T12:00:00.000Z" }));
  await act(async () => new Promise((resolve) => setTimeout(resolve, 50)));
  expect(calls).toBe(2);
});

test("three events while the first answer is on its way: ONE read is owed, not three", async () => {
  let calls = 0;
  let deliver: (() => void) | undefined;
  const first = new Promise<void>((resolve) => (deliver = resolve));
  const { slot, facts } = await sidebarOver(async () => {
    calls += 1;
    if (calls === 1) {
      await first;
      return fixtureSnapshot(before());
    }
    return fixtureSnapshot(after());
  });
  await waitFor(() => expect(calls).toBe(1));
  for (const at of ["2026-11-24T12:00:00.000Z", "2026-11-24T12:00:00.300Z", "2026-11-24T12:00:00.600Z"]) await act(async () => slot.behavior.emitRealtime("oats/changed", { at }));
  expect(calls).toBe(1); // nothing is started beside the read on its way
  await act(async () => deliver!());
  await slot.findByTestId("oats-tree");
  await waitFor(() => expect(facts()).not.toMatch(/^Needs you/));
  await act(async () => new Promise((resolve) => setTimeout(resolve, 50)));
  expect(calls).toBe(2); // the first answer, and one read for the three events
});

test("three events in a row once the window has its roster, each while the reread before it is on its way: the window ends on the last roster, and no read is made that no event asked for", async () => {
  // Answers: 1 the load; 2 and 3 are rereads held on their way, made by the server before the last change; 4 the roster after it.
  let calls = 0;
  const held: (() => void)[] = [];
  const { slot, facts } = await sidebarOver(async () => {
    calls += 1;
    if (calls === 1) return fixtureSnapshot(before());
    if (calls <= 3) {
      await new Promise<void>((resolve) => held.push(resolve));
      return fixtureSnapshot(before());
    }
    return fixtureSnapshot(after());
  });
  await slot.findByTestId("oats-tree");
  await act(async () => slot.behavior.emitRealtime("oats/changed", { at: "2026-11-24T12:00:00.000Z" }));
  await waitFor(() => expect(calls).toBe(2));
  await act(async () => slot.behavior.emitRealtime("oats/changed", { at: "2026-11-24T12:00:00.300Z" }));
  await waitFor(() => expect(calls).toBe(3));
  await act(async () => slot.behavior.emitRealtime("oats/changed", { at: "2026-11-24T12:00:00.600Z" }));
  await waitFor(() => expect(facts()).not.toMatch(/^Needs you/)); // the last event's read answers, whatever became of the two before it
  // The rereads that were dropped answer late, with the roster from before: they change nothing.
  await act(async () => held.forEach((answer) => answer()));
  await act(async () => new Promise((resolve) => setTimeout(resolve, 50)));
  expect(facts()).not.toMatch(/^Needs you/);
  expect(calls).toBe(4); // one read per event after the load: none more
});
