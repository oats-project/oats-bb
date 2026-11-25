// @vitest-environment jsdom
// The notice of a thread that bb archived under an agent that ran, through the plugin's overlay: the
// rule (app/lifecycle/left.ts; its cases are test/lifecycle/left.test.ts) fed by the real `useOats()`
// (the roster from the plugin's server, bb's thread list, bb's answer by id), told through bb's
// toaster, and its one button opening the Stop dialog.
// bb's sidebar list is the SDK's hook, which a slot test gives once: here it is replaced by a list the
// test changes, as bb's changes when a person archives a thread. Nothing else of the SDK is replaced.
import { useSyncExternalStore } from "react";
import { afterEach, expect, test, vi } from "vitest";
import { act, fireEvent, waitFor } from "@testing-library/react";
import { renderSlot } from "@get-bb/plugin-sdk/testing/app";
import type { RenderSlotOptions } from "@get-bb/plugin-sdk/testing/app";
import { fixtureAgents, fixtureSnapshot, fixtureThreads } from "../helpers/fixtures";
import { handlers, loadApp, resetApp, sidebarThreads } from "../helpers/render";
import type { Contract } from "../helpers/render";
import { modelsSdk, retirePlanOf, retireReceiptOf, startCheckOf, startedIn, stopPlanOf, stopReceiptOf } from "./handlers";
import { asked, openAct } from "../../app/lifecycle";
import type { Handlers } from "../helpers/render";
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
  ({ ...modelsSdk(), threads: { list: async (args: { threadIds: readonly string[] }) => args.threadIds.filter((id) => archivedIds.includes(id)).map((id) => ({ id, archivedAt: 1_763_000_000_000 })), interactions: { list: async () => [] } } }) as never as RenderSlotOptions<Contract>["sdk"];

/** The overlay over a roster whose every read has a new stamp; `after`: the lead's row from the second read on (a function: from when it says so). */
async function overlay(after: object | (() => object | null) = {}, over: Partial<Handlers> = {}) {
  const app = await loadApp();
  bbList.set(fixtureThreads());
  let reads = 0;
  const snapshot = () => {
    reads += 1;
    const row = typeof after === "function" ? after() : reads > 1 ? after : null;
    const agents = fixtureAgents().map((agent) => (agent.instance === LEAD && row !== null ? { ...agent, ...row } : agent));
    return { ...fixtureSnapshot(agents), at: `2026-11-24T18:00:${String(reads).padStart(2, "0")}.000Z` };
  };
  const slot = renderSlot<object, Contract>(app.appOverlays[0]!, {}, { rpc: handlers({ snapshot, stopPlan: () => stopPlanOf(), ...over }), sidebarThreads: sidebarThreads(), sdk: bb(["thr_redesign"]) });
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
  // OATS was asked again ONCE (the server reads its status and answers with that read's stamp; the window then reads
  // what the server holds, through the roster's own Retry, which asks the server once more), and the roster read after decided.
  expect(refreshes(slot)).toBe(2);
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
  await waitFor(() => expect(refreshes(slot)).toBe(2));
  await waitFor(() => expect(slot.inspection.rpcCalls.filter((call) => call.method === "snapshot").length).toBeGreaterThan(1));
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(notified()).toEqual([]);
});

/** When an act ended, on the server's clock (on its answer): before the rosters this file's server reads. */
const ENDED = "2026-11-24T18:00:00.500Z";
const settle = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 0)));
const press = (slot: Awaited<ReturnType<typeof overlay>>, id: string) => fireEvent.click(slot.getByTestId(id));
const phaseIs = (slot: Awaited<ReturnType<typeof overlay>>, kind: string) => waitFor(() => expect(slot.getByTestId("oats-confirm").getAttribute("data-phase")).toBe(kind));

test("while a dialog of ours is on screen nothing is asked or told of a thread that leaves bb's list; once it is closed OATS is asked, and the read after decides", async () => {
  const slot = await overlay();
  act(() => openAct("stop", LEAD));
  await phaseIs(slot, "ready");
  archiveInBb();
  await settle();
  await settle();
  // The dialog may be about to do it itself: the look waits.
  expect([refreshes(slot), notified()]).toEqual([0, []]);
  press(slot, "oats-confirm-cancel");
  // Nothing was stopped: the agent runs, and its thread is archived in bb. Now it is asked, and told.
  await waitFor(() => expect(notified().map((toast) => toast.title)).toEqual(["Redesign ui lead may still run."]));
  expect(refreshes(slot)).toBe(2);
});

test("while a stop of ours is in flight, its dialog left, nothing is asked or told; when it lands and the row says the stop, only the stop's own result is told", async () => {
  type Stopped = ReturnType<typeof stopReceiptOf> & { endedAt: string };
  let land!: (receipt: Stopped) => void;
  const held = new Promise<Stopped>((resolve) => (land = resolve));
  // The window's roster says that the agent runs until the stop has landed (it had not read the row of the stop yet).
  let landed = false;
  const slot = await overlay(() => (landed ? { running: false, runtimeState: "stopped", sessionEnd: "stopped" } : null), { stopApply: () => held });
  act(() => openAct("stop", LEAD));
  await phaseIs(slot, "ready");
  press(slot, "oats-confirm-act");
  await phaseIs(slot, "running");
  press(slot, "oats-confirm-leave"); // the dialog is gone; the stop goes on
  await waitFor(() => expect(slot.queryByTestId("oats-confirm")).toBeNull());
  archiveInBb(); // as the provider archives the thread at the stop
  await settle();
  await settle();
  expect([refreshes(slot), notified()]).toEqual([0, []]);
  landed = true;
  await act(async () => land({ ...stopReceiptOf(), endedAt: ENDED }));
  // The stop landed: the look asks OATS, the row read after says an operator stopped it, and the one thing told is the stop's result.
  await waitFor(() => expect(refreshes(slot)).toBeGreaterThanOrEqual(2));
  await waitFor(() => expect(notified()).toHaveLength(1));
  await settle();
  await settle();
  expect(notified().map((toast) => toast.title).join(" ")).not.toContain("may still run");
});

test.each([
  ["a retire", "retire", (held: Promise<void>): Partial<Handlers> => ({ retireApply: () => held.then(() => ({ ...retireReceiptOf(), endedAt: ENDED })) })],
  ["a start", "start", (held: Promise<void>): Partial<Handlers> => ({ start: () => held.then(() => ({ ...startedIn("thr_digest_2"), endedAt: ENDED })) })],
] as const)("%s of ours in flight on ANOTHER agent holds the look as well (any act of ours may be what archives a thread: a parent's stop archives its children's); once it lands OATS is asked, and an agent that still runs is told of", async (_name, verb, answers) => {
  let land!: () => void;
  const held = new Promise<void>((resolve) => (land = resolve));
  const slot = await overlay({}, { retirePlan: () => retirePlanOf(), startCheck: ({ instance }) => startCheckOf(instance), ...answers(held) });
  act(() => openAct(verb, "weekly-digest-helper"));
  await phaseIs(slot, "ready");
  press(slot, "oats-confirm-act");
  await phaseIs(slot, "running");
  press(slot, "oats-confirm-leave");
  await waitFor(() => expect(slot.queryByTestId("oats-confirm")).toBeNull());
  archiveInBb(); // the lead's thread, in bb, by a person: nothing of ours did it
  await settle();
  await settle();
  expect([refreshes(slot), notified()]).toEqual([0, []]);
  await act(async () => land());
  await waitFor(() => expect(notified().map((toast) => toast.title)).toContain("Redesign ui lead may still run."));
});
