// @vitest-environment jsdom
// The notice of a thread that bb archived under an agent that ran, through the plugin's overlay: the
// rule (app/lifecycle/left.ts; its cases are test/lifecycle/left.test.ts) fed by the real `useOats()`
// (the roster from the plugin's server, bb's thread list, bb's answer by id), told through bb's
// toaster, and its one button opening the Stop dialog.
// bb's sidebar list is the SDK's hook, which a slot test gives once: here it is replaced by a list the
// test changes, as bb's changes when a person archives a thread. Nothing else of the SDK is replaced.
import { useSyncExternalStore } from "react";
import { afterEach, expect, test, vi } from "vitest";
import { act, waitFor } from "@testing-library/react";
import { renderSlot } from "@get-bb/plugin-sdk/testing/app";
import type { RenderSlotOptions } from "@get-bb/plugin-sdk/testing/app";
import { fixtureAgents, fixtureSnapshot, fixtureThreads } from "../helpers/fixtures";
import { handlers, loadApp, resetApp, sidebarThreads } from "../helpers/render";
import type { Contract } from "../helpers/render";
import { stopPlanOf } from "./handlers";
import { asked } from "../../app/lifecycle";
import { notified } from "../../app/ui";

const bbList = vi.hoisted(() => {
  let now: { status: "ready"; threads: readonly unknown[] } = { status: "ready", threads: [] };
  const listeners = new Set<() => void>();
  return {
    get: () => now,
    set: (threads: readonly unknown[]) => {
      now = { status: "ready", threads };
      for (const listener of [...listeners]) listener();
    },
    subscribe: (listener: () => void) => (listeners.add(listener), () => void listeners.delete(listener)),
  };
});
vi.mock("@get-bb/plugin-sdk/app", async (original) => ({
  ...(await original<typeof import("@get-bb/plugin-sdk/app")>()),
  experimental_useSidebarThreads: () => useSyncExternalStore(bbList.subscribe, bbList.get, bbList.get),
}));

afterEach(resetApp);

const LEAD = "redesign-ui-lead";
/** bb, asked by id for the threads it does not list: these are archived. */
const bb = (archivedIds: readonly string[]) =>
  ({ threads: { list: async (args: { threadIds: readonly string[] }) => args.threadIds.filter((id) => archivedIds.includes(id)).map((id) => ({ id, archivedAt: 1_763_000_000_000 })), interactions: { list: async () => [] } } }) as never as RenderSlotOptions<Contract>["sdk"];

/** The overlay over a roster whose every read has a new stamp; `after`: the lead's row from the second read on. */
async function overlay(after: object = {}) {
  const app = await loadApp();
  bbList.set(fixtureThreads());
  let reads = 0;
  const snapshot = () => {
    reads += 1;
    const agents = fixtureAgents().map((agent) => (agent.instance === LEAD && reads > 1 ? { ...agent, ...after } : agent));
    return { ...fixtureSnapshot(agents), at: `2026-11-24T18:00:${String(reads).padStart(2, "0")}.000Z` };
  };
  const slot = renderSlot<object, Contract>(app.appOverlays[0]!, {}, { rpc: handlers({ snapshot, stopPlan: () => stopPlanOf() }), sidebarThreads: sidebarThreads(), sdk: bb(["thr_redesign"]) });
  await waitFor(() => expect(slot.inspection.rpcCalls.map((call) => call.method)).toContain("snapshot"));
  await new Promise((resolve) => setTimeout(resolve, 0));
  return slot;
}
const archiveInBb = () => act(() => bbList.set(fixtureThreads().filter((thread) => thread.id !== "thr_redesign")));
const refreshes = (slot: Awaited<ReturnType<typeof overlay>>) => slot.inspection.rpcCalls.filter((call) => call.method === "refresh").length;

test("a person archives in bb the thread of an agent that runs: one notification that stays, with the agent's name and Stop…, which opens the Stop dialog for it", async () => {
  const slot = await overlay();
  expect(notified()).toEqual([]);
  archiveInBb();
  await waitFor(() => expect(notified()).toHaveLength(1));
  expect(refreshes(slot)).toBe(1); // OATS was asked again once, and the roster read after decided
  const toast = notified()[0]!;
  // A warning, not a failure: it stays until dismissed (`unknown`), with one button.
  expect(toast).toMatchObject({ tone: "unknown", title: "Redesign ui lead may still run.", lines: [] });
  expect(toast.open!.label).toBe("Stop…");
  expect(asked()).toBeNull();
  act(() => toast.open!.run());
  expect(asked()).toEqual({ verb: "stop", instance: LEAD });
  await waitFor(() => expect(slot.getByTestId("oats-confirm").getAttribute("data-phase")).toBe("ready"));
  expect(slot.getByRole("dialog").querySelector("h2")!.textContent).toBe("Stop Redesign ui lead?");
  // Once: with the dialog closed again, later reads tell nothing more.
  expect(notified()).toHaveLength(1);
});

test("the thread was archived by a stop through OATS (the row read after says an operator stopped it): nothing is told", async () => {
  const slot = await overlay({ running: false, runtimeState: "stopped", sessionEnd: "stopped" });
  archiveInBb();
  await waitFor(() => expect(refreshes(slot)).toBe(1));
  await waitFor(() => expect(slot.inspection.rpcCalls.filter((call) => call.method === "snapshot").length).toBeGreaterThan(1));
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(notified()).toEqual([]);
});
