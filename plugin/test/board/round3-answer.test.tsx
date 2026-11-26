// @vitest-environment jsdom
// What a fresh reviewer's third round found in answering (by reading; held here by a test): a refusal at the press is
// the window's too, by the agent and the question's occurrence: it is said under the options also where they were
// drawn anew while the answer travelled.
import { afterEach, expect, test, vi } from "vitest";
import { act, fireEvent, waitFor, within } from "@testing-library/react";
import { renderSlot } from "@get-bb/plugin-sdk/testing/app";
import type { RenderSlotOptions } from "@get-bb/plugin-sdk/testing/app";
import { Board, forgetHidden } from "../../app/board";
import { fixtureAgents, fixtureSnapshot, fixtureThreads } from "../helpers/fixtures";
import { handlers, loadApp, resetApp } from "../helpers/render";
import type { Contract } from "../helpers/render";
import { BOARD_AT } from "./handlers";

afterEach(() => { resetApp(); forgetHidden(); vi.useRealTimers(); });
const LEAD = "redesign-ui-lead";
const Q1 = { id: "q3", question: "Which base branch?", options: ["main: the default", "release: the 0.1 line"], hasContext: false, since: "2026-11-23T18:01:45.724Z" };
const Q2 = { id: "q4", question: "Squash?", options: ["yes", "no"], hasContext: false, since: "2026-11-23T18:02:45.724Z" };

test("a press refused while the question's options were drawn anew (turned away and back as the answer travelled): the refusal is still said, once, under those options, and they can be pressed again", async () => {
  await loadApp();
  const agents = fixtureAgents();
  const sent: string[] = [];
  let slow = false;
  let release: () => void = () => {};
  let questions: unknown[] = [Q1, Q2];
  const slot = renderSlot<{ instance: string }, Contract>({ component: Board }, { instance: LEAD }, {
    rpc: handlers({
      snapshot: (async () => { if (slow) await new Promise<void>((resolve) => { release = resolve; slow = false; }); return fixtureSnapshot(agents); }) as never,
      board: () => ({ at: BOARD_AT, supported: true, stale: false, board: { facts: [], questions }, claim: { producer: "oats.board", reason: "attention" } }),
    }, agents),
    sidebarThreads: { status: "ready" as const, threads: fixtureThreads() },
    sdk: { threads: { interactions: { list: async () => [] }, send: async ({ input }: { input: { text: string }[] }) => (sent.push(input.map((part) => part.text).join("")), { ok: true }) } } as never as RenderSlotOptions<Contract>["sdk"],
  });
  await waitFor(() => expect(slot.getByTestId("oats-board").getAttribute("data-state")).toBe("shown"));
  const zone = slot.getByTestId("oats-board-questions");
  const answers = () => within(zone).queryAllByTestId("oats-board-answer") as HTMLButtonElement[];
  await waitFor(() => expect(answers().length).toBe(2));
  slow = true; // the press's read of the roster takes a moment
  fireEvent.click(answers()[0]!);
  await act(async () => {});
  // The options of q3 are drawn anew while the answer travels…
  fireEvent.click(within(zone).getByTestId("oats-board-next"));
  fireEvent.click(within(zone).getByTestId("oats-board-previous"));
  await act(async () => {});
  expect(within(zone).getByTestId("oats-board-question").textContent).toBe("Which base branch?");
  // …and the server's row at the press holds the question asked AGAIN (another occurrence): refused.
  const window = questions;
  questions = [{ ...Q1, since: "2026-11-23T18:05:00.000Z" }, Q2];
  await act(async () => { release(); });
  await waitFor(() => expect(within(zone).getAllByTestId("oats-board-refused").map((each) => each.textContent)).toEqual(["No longer asked. Nothing sent."]));
  expect(sent).toEqual([]);
  expect(answers().every((button) => !button.disabled)).toBe(true);
  // A new press takes the refusal away, and what it is answered is what is said then.
  questions = window;
  fireEvent.click(answers()[0]!);
  await waitFor(() => expect(sent).toEqual(["q3: main: the default"]));
  expect(within(zone).queryByTestId("oats-board-refused")).toBeNull();
});
