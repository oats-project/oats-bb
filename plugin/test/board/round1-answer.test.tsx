// @vitest-environment jsdom
// What a fresh reviewer's first round found in answering (its own proof, kept as a test): "on its way" is the
// window's, by the agent and the question's occurrence, not the mounted component's.
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

test("one press is one send, however often the question's options are mounted anew: a press, the question turned away and back while the send is on its way, another press: ONE answer is sent", async () => {
  await loadApp();
  const agents = fixtureAgents();
  const sent: string[] = [];
  let slow = false;
  let release: () => void = () => {};
  const slot = renderSlot<{ instance: string }, Contract>({ component: Board }, { instance: LEAD }, {
    rpc: handlers({
      snapshot: (async () => { if (slow) await new Promise<void>((resolve) => { release = resolve; slow = false; }); return fixtureSnapshot(agents); }) as never,
      board: () => ({ at: BOARD_AT, supported: true, stale: false, board: { facts: [], questions: [Q1, Q2] }, claim: { producer: "oats.board", reason: "attention" } }),
    }, agents),
    sidebarThreads: { status: "ready" as const, threads: fixtureThreads() },
    sdk: { threads: { send: async ({ input }: { input: { text: string }[] }) => (sent.push(input.map((part) => part.text).join("")), { ok: true }) } } as never as RenderSlotOptions<Contract>["sdk"],
  });
  await waitFor(() => expect(slot.getByTestId("oats-board").getAttribute("data-state")).toBe("shown"));
  const zone = slot.getByTestId("oats-board-questions");
  const answers = () => within(zone).queryAllByTestId("oats-board-answer") as HTMLButtonElement[];
  await waitFor(() => expect(answers().length).toBe(2));
  slow = true; // the press's read of the roster takes a moment (a machine over the network)
  fireEvent.click(answers()[0]!); // "main"
  await act(async () => {});
  expect(answers().every((button) => button.disabled)).toBe(true);
  fireEvent.click(within(zone).getByTestId("oats-board-next"));
  fireEvent.click(within(zone).getByTestId("oats-board-previous"));
  await act(async () => {});
  fireEvent.click(answers()[1]!); // "release", for the same question
  await act(async () => { release(); });
  await waitFor(() => expect(sent.length).toBeGreaterThan(0));
  await act(async () => void (await new Promise((resolve) => setTimeout(resolve, 100))));
  expect(sent).toEqual(["q3: main: the default"]);
});
