// @vitest-environment jsdom
// The New agent form's result when the thread it made FAILS AT ITS START in bb (a model the
// harness cannot resolve): the kernel said "launched", and the form must not say "Created" over a
// thread that failed. It waits for bb's own status of the thread to leave its start (10 s at
// most), then reads bb's events by the one rule (app/outside/threads.ts).
// The clock is the test's: no real timer runs here.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, expect, test, vi } from "vitest";
import { act, fireEvent, waitFor } from "@testing-library/react";
import { renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { START_WAIT_MS } from "../../app/outside/threads";
import { notified } from "../../app/ui";
import { formFacts } from "../../model/spawn";
import { handlers, loadApp, resetApp, sidebarThreads } from "../helpers/render";
import type { Contract } from "../helpers/render";

afterEach(() => {
  vi.useRealTimers();
  resetApp();
});

const recorded = (JSON.parse(readFileSync(join(process.cwd(), "test/fixtures/spawn/spawn-preview.json"), "utf8")) as { result: Record<string, unknown> }).result;
type Event = { type: string; seq: number; data: Record<string, unknown> };
const events = (name: "never-started" | "later-turn-failed"): Event[] => JSON.parse(readFileSync(join(process.cwd(), `test/fixtures/outside/events/${name}.json`), "utf8"));
const REASON = 'Failed to resolve Pi model "nosuchmodel"';

/** The form, ready to spawn; bb answers the new thread's status from `statuses` (its last one from then on; with none, bb never answers) and its events from `log`. */
async function ready(statuses: (string | Error)[], log: Event[] = []) {
  const asked = { get: 0, events: [] as { types?: readonly string[] }[] };
  const get = async () => {
    asked.get++;
    // With no status to give, bb never answers.
    if (statuses.length === 0) return new Promise<never>(() => undefined);
    const next = statuses[Math.min(asked.get - 1, statuses.length - 1)]!;
    if (next instanceof Error) throw next;
    return { id: "thr_new", status: next };
  };
  const list = async (args: { types?: readonly string[] }) => (asked.events.push(args), log.filter((event) => args.types === undefined || args.types.includes(event.type)));
  const app = await loadApp();
  const panel = app.navPanels.find((candidate) => candidate.id === "new-agent")!;
  const slot = renderSlot<{ subPath: string }, Contract>(panel, { subPath: "oats-developer" }, {
    rpc: handlers({ spawnPlan: (input) => ({ facts: formFacts(recorded, { name: input.name ?? null }), revision: "f48a98cea8a3a34508aab024" }), spawn: () => ({ instance: "ranker-v4-probe", threadId: "thr_new" }) }),
    sidebarThreads: sidebarThreads(),
    sdk: {
      providers: { models: (async () => ({ modelLoadError: null, models: [] })) as never },
      system: { providerStates: (async () => Promise.reject(new Error("bb did not say"))) as never } as never,
      threads: { get, events: { list } } as never,
    },
  });
  await waitFor(() => expect(slot.getByTestId("oats-spawn-preview").textContent).toContain("numbered by the kernel"));
  await waitFor(() => expect((slot.getByTestId("oats-spawn-submit") as HTMLButtonElement).disabled).toBe(false));
  return { slot, asked };
}
type Slot = Awaited<ReturnType<typeof ready>>["slot"];
const submit = (slot: Slot) => slot.getByTestId("oats-spawn-submit") as HTMLButtonElement;
/** Press Spawn under the test's clock, and let the spawn's answer and bb's first status arrive. */
async function press(slot: Slot) {
  vi.useFakeTimers();
  fireEvent.click(submit(slot));
  await act(async () => void (await vi.advanceTimersByTimeAsync(0)));
}
const pass = (ms: number) => act(async () => void (await vi.advanceTimersByTimeAsync(ms)));
const titles = () => notified().map((note) => [note.tone, note.title, note.open?.label]);

test("the thread fails at its start: the form says \"<Name> did not start\", bb's reason under Details and one button, Open; never \"Created\"", async () => {
  const { slot, asked } = await ready(["starting", "starting", "error"], events("never-started"));
  await press(slot);
  // While bb starts the thread the form is busy, as while it spawns: nothing is called created yet.
  expect([submit(slot).textContent, submit(slot).disabled, slot.queryByTestId("oats-result")]).toEqual(["Spawning…", true, null]);
  await pass(1_000);
  const result = slot.getByTestId("oats-result");
  expect([result.getAttribute("data-tone"), result.querySelector("h3")!.textContent]).toEqual(["failed", "Ranker v4 probe did not start"]);
  // No sentence: the title, Details, the one button.
  expect(Array.from(result.querySelectorAll(":scope > div > p"))).toEqual([]);
  const details = slot.getByTestId("oats-spawn-start-details");
  expect([details.querySelector("summary")!.textContent, details.querySelector("p")!.textContent]).toEqual([expect.stringMatching(/Details$/), REASON]);
  expect(Array.from(result.querySelectorAll("button")).map((button) => button.textContent)).toEqual(["Open"]);
  expect(result.textContent).not.toMatch(/Created/);
  expect(slot.getByTestId("oats-spawn-status").textContent).not.toMatch(/Created/);
  // Nothing is said of the model but bb's own reason, nothing navigates under the person, and no notification says "Created".
  expect(result.textContent!.replace(REASON, "")).not.toMatch(/model/i);
  expect(slot.inspection.navigateCalls).toEqual([]);
  expect(titles()).toEqual([]);
  // An instance exists: the form stays held, and Spawn is off.
  expect(submit(slot).disabled).toBe(true);
  expect(slot.getByTestId("oats-spawn-cancel").textContent).toBe("Close");
  // bb was asked for its events by type only.
  expect(asked.events.map((args) => JSON.stringify(args.types)).sort()).toEqual(['["system/error"]', '["turn/started"]']);
  fireEvent.click(slot.getByTestId("oats-spawn-open"));
  expect(slot.inspection.navigateCalls).toHaveLength(1);
});

test("for a person who left the form: the notification says \"<Name> did not start\" and stays, with Open; never \"Created <Name>.\"", async () => {
  const { slot } = await ready(["starting", "error"], events("never-started"));
  await press(slot);
  slot.unmount();
  await pass(1_000);
  expect(titles()).toEqual([["failed", "Ranker v4 probe did not start", "Open"]]);
  expect(notified()[0]!.lines).toEqual([]);
});

test("a thread past its start is created as before: at rest, working, or failed in a later turn", async () => {
  for (const [statuses, log] of [[["idle"], []], [["starting", "active"], []], [["error"], events("later-turn-failed")]] as [string[], Event[]][]) {
    const { slot } = await ready(statuses, log);
    await press(slot);
    await pass(600);
    expect(slot.getByTestId("oats-result").querySelector("h3")!.textContent).toBe("Created Ranker v4 probe");
    expect(titles()).toEqual([["done", "Created Ranker v4 probe.", "Open Ranker v4 probe"]]);
    expect(slot.inspection.navigateCalls).toEqual([{ method: "toThread", threadId: "thr_new" }]);
    vi.useRealTimers();
    resetApp();
  }
});

test("a thread still starting after 10 s, and one bb cannot answer for, are created as before: the wait is bounded", async () => {
  const waiting = await ready(["starting"]);
  await press(waiting.slot);
  await pass(START_WAIT_MS - 1_000);
  expect([submit(waiting.slot).textContent, waiting.slot.queryByTestId("oats-result")]).toEqual(["Spawning…", null]);
  await pass(1_000);
  expect(waiting.slot.getByTestId("oats-result").querySelector("h3")!.textContent).toBe("Created Ranker v4 probe");
  expect(waiting.asked.get).toBeLessThanOrEqual(START_WAIT_MS / 500 + 1);
  expect(waiting.asked.events).toEqual([]);
  vi.useRealTimers();
  resetApp();
  // bb never answers at all (its connection gone while it spawns): the wait ends by the clock, and the form is not held for good.
  const silent = await ready([]);
  await press(silent.slot);
  await pass(START_WAIT_MS - 1);
  expect([submit(silent.slot).textContent, silent.slot.queryByTestId("oats-result")]).toEqual(["Spawning…", null]);
  await pass(1);
  expect(silent.slot.getByTestId("oats-result").querySelector("h3")!.textContent).toBe("Created Ranker v4 probe");
  expect(titles()).toEqual([["done", "Created Ranker v4 probe.", "Open Ranker v4 probe"]]);
  vi.useRealTimers();
  resetApp();
  const away = await ready([new Error("bb is away")]);
  await press(away.slot);
  expect(away.slot.getByTestId("oats-result").querySelector("h3")!.textContent).toBe("Created Ranker v4 probe");
});
