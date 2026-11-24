// @vitest-environment jsdom
// A window that loads WHILE the server reads a change. The server answers `snapshot` from its
// cache at once; the read that is in flight ends after that answer was made and publishes
// "oats/changed". The window's first read is then still on its way, and it must not end up
// holding the roster from before the change.
import { afterEach, expect, test } from "vitest";
import { act, waitFor, within } from "@testing-library/react";
import { renderSlot } from "@get-bb/plugin-sdk/testing/app";
import type { PluginThreadListProps } from "@get-bb/plugin-sdk/app";
import type { ReactNode } from "react";
import type { Agent } from "../../model/types";
import { fixtureAgents, fixtureSnapshot } from "../helpers/fixtures";
import { handlers, loadApp, resetApp, sidebarThreads } from "../helpers/render";
import type { Contract } from "../helpers/render";

afterEach(resetApp);

// A ROOT of the tree, so that its row is drawn as the page loads (a child's is folded away under its parent until a person opens it).
const WAITS = "redesign-ui-lead"; // on thr_redesign: it waits on a person before the change, and not after it
const THREAD = "thr_redesign";
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
  const facts = () => within(slot.getAllByTestId("oats-agent-row").find((row) => row.getAttribute("data-sidebar-thread-id") === THREAD)!).getByTestId("oats-row-facts").textContent;
  await slot.findByTestId("oats-tree");
  // Nothing else changes, and nothing else is published: the window must still come to the new roster.
  await waitFor(() => expect(facts()).not.toMatch(/^Needs you/));
  expect(calls).toBeGreaterThanOrEqual(2);
});

/** The sidebar over a `snapshot` handler of the test's own; what that agent's row says; how many times `snapshot` was answered. */
async function sidebarOver(snapshot: () => Promise<ReturnType<typeof fixtureSnapshot>>) {
  const app = await loadApp();
  const slot = renderSlot<PluginThreadListProps, Contract>(
    app.threadLists[0]!,
    { activeThreadId: null, activeProjectId: null, isCompactViewport: false, onNavigate: () => undefined, searchQuery: "" },
    { rpc: handlers({ snapshot }), sidebarThreads: sidebarThreads() },
  );
  const facts = () => within(slot.getAllByTestId("oats-agent-row").find((row) => row.getAttribute("data-sidebar-thread-id") === THREAD)!).getByTestId("oats-row-facts").textContent;
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
  expect([calls, facts()]).toEqual([1, "Needs you · oats-product-expert"]);
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

test("the first answer FAILS while an event is owed a read, and a second event comes while that read is on its way: each is owed its read in turn, and the window ends on the new roster", async () => {
  // Answers: 1 the load, held on its way and then failing; 2 the read owed for the first event, held, made before the second change; 3 the roster after it.
  let calls = 0;
  const held: ((fail: boolean) => void)[] = [];
  const { slot, facts } = await sidebarOver(async () => {
    calls += 1;
    if (calls <= 2) {
      const fail = await new Promise<boolean>((resolve) => held.push(resolve));
      if (fail) throw new Error("E_OATS_TIMEOUT: oats status did not answer");
      return fixtureSnapshot(before());
    }
    return fixtureSnapshot(after());
  });
  await waitFor(() => expect(calls).toBe(1));
  await act(async () => slot.behavior.emitRealtime("oats/changed", { at: "2026-11-24T12:00:00.000Z" }));
  await act(async () => held[0]!(true)); // the first answer fails: the window has no roster yet
  await waitFor(() => expect(calls).toBe(2)); // the read owed for the first event
  await act(async () => slot.behavior.emitRealtime("oats/changed", { at: "2026-11-24T12:00:00.400Z" }));
  expect(calls).toBe(2); // nothing beside the read on its way
  await act(async () => held[1]!(false)); // it answers, with the roster from before the second change
  await slot.findByTestId("oats-tree");
  await waitFor(() => expect(facts()).not.toMatch(/^Needs you/)); // the second event was owed a read too: not swallowed
  expect(calls).toBe(3);
});

// The event path (#74): the server patches the roster it holds from ONE instance's events and publishes the same
// "oats/changed"; the patched roster is still the status read from before (its `at` does not move). To the window it
// is one more event: one that arrives while the first answer is on its way is owed a read like any other, and the
// window must take the patched roster although its `at` is the one it already holds.
test("a PATCH published while the window's first answer is on its way is not lost: the window ends on the patched roster, whose `at` is the first answer's", async () => {
  let calls = 0;
  let deliver: (() => void) | undefined;
  const first = new Promise<void>((resolve) => (deliver = resolve));
  const { slot, facts } = await sidebarOver(async () => {
    calls += 1;
    if (calls === 1) {
      await first;
      return fixtureSnapshot(after()); // the status read, from before the claim: nobody waits
    }
    return fixtureSnapshot(before()); // the same read's roster with the events' claim over it: the same `at`
  });
  await waitFor(() => expect(calls).toBe(1));
  expect(fixtureSnapshot(after()).at).toBe(fixtureSnapshot(before()).at);
  // The server's publish of a patch: the token alone (server/core.ts), later than the read's.
  await act(async () => slot.behavior.emitRealtime("oats/changed", { at: "2026-11-24T12:00:00.250Z" }));
  await act(async () => deliver!());
  await slot.findByTestId("oats-tree");
  await waitFor(() => expect(facts()).toMatch(/^Needs you/));
  await act(async () => new Promise((resolve) => setTimeout(resolve, 50))); // time for a read too many, if one were made
  expect(calls).toBe(2); // the first answer, and the one read owed for the patch's event
});

// Each live read is owed ITS OWN read (app/store.ts `reread`, by the read's key). The sidebar beside the Automations
// page: two live reads that start together, the roster's and the page's own. Both first answers are on their way when
// the server publishes; the roster's read, paid first, must not take the page's with it.
test("two live reads by two keys, both with their first answer on its way when the change is published: each is read once more, and neither pays the other's", async () => {
  const held = () => {
    let deliver: (() => void) | undefined;
    const first = new Promise<void>((resolve) => (deliver = resolve));
    return { calls: 0, first, deliver: () => deliver!() };
  };
  const roster = held();
  const page = held();
  const answers = handlers();
  const app = await loadApp();
  const List = app.threadLists[0]!.component;
  const Automations = app.navPanels.find((candidate) => candidate.id === "automations")!.component as (props: { subPath: string }) => ReactNode;
  const slot = renderSlot<PluginThreadListProps, Contract>(
    {
      component: (props: PluginThreadListProps) => (
        <>
          <List {...props} />
          <Automations subPath="" />
        </>
      ),
    } as never,
    { activeThreadId: null, activeProjectId: null, isCompactViewport: false, onNavigate: () => undefined, searchQuery: "" },
    {
      rpc: handlers({
        snapshot: async () => {
          roster.calls += 1;
          if (roster.calls === 1) await roster.first;
          return fixtureSnapshot(after());
        },
        automations: async (input) => {
          page.calls += 1;
          if (page.calls === 1) await page.first;
          return answers.automations(input);
        },
      }),
      sidebarThreads: sidebarThreads(),
    },
  );
  // Both first answers are on their way.
  await waitFor(() => expect([roster.calls, page.calls]).toEqual([1, 1]));
  await act(async () => slot.behavior.emitRealtime("oats/changed", { at: "2026-11-24T12:00:00.000Z" }));
  // The roster's arrives first, and its owed read is made; the page's is still on its way, and still owed.
  await act(async () => roster.deliver());
  await waitFor(() => expect(roster.calls).toBe(2));
  // The page's arrives: its own owed read is made.
  await act(async () => page.deliver());
  await waitFor(() => expect(page.calls).toBe(2));
  await act(async () => new Promise((resolve) => setTimeout(resolve, 50))); // time for a read too many of either, if one were made
  expect([roster.calls, page.calls]).toEqual([2, 2]); // each its first answer and its one owed read: the page's did not start the roster's again
});
