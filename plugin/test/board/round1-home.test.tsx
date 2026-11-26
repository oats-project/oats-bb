// @vitest-environment jsdom
// What a fresh reviewer's first round found on the home's card (its own proofs, kept as tests): a claim that is not
// the board's must keep its text and its reply; a card is never empty while the board is read or cannot be; and a
// card starts no process by being shown.
import { afterEach, expect, test, vi } from "vitest";
import { act, within } from "@testing-library/react";
import { renderSlot } from "@get-bb/plugin-sdk/testing/app";
import type { RenderSlotOptions } from "@get-bb/plugin-sdk/testing/app";
import { forgetHidden } from "../../app/board";
import type { Agent } from "../../model/types";
import { fixtureAgents } from "../helpers/fixtures";
import { handlers, loadApp, resetApp, sidebarThreads } from "../helpers/render";
import type { Contract } from "../helpers/render";
import { BOARD_AT } from "./handlers";

afterEach(() => { resetApp(); forgetHidden(); vi.useRealTimers(); });
const ASKS = "ranker-v3-probe";
const QUESTION = { id: "q3", question: "Which base branch?", options: ["main: the default", "release: the 0.1 line"], hasContext: false, since: "2026-11-23T18:01:45.724Z" };

async function home(change: Partial<Agent>, board: () => unknown) {
  const app = await loadApp();
  const panel = app.navPanels.find((candidate) => candidate.id === "home")!;
  const agents = fixtureAgents().map((agent): Agent => (agent.instance === ASKS ? { ...agent, ...change } : agent));
  const slot = renderSlot<{ subPath: string }, Contract>(panel, { subPath: "" }, {
    rpc: handlers({ board: board as never }, agents),
    sidebarThreads: sidebarThreads(),
    sdk: { threads: { interactions: { list: async () => [] }, send: async () => ({ ok: true }) } } as never as RenderSlotOptions<Contract>["sdk"],
  });
  const card = (await slot.findAllByTestId("oats-needs-card")).find((each) => each.dataset.instance === ASKS)!;
  return { slot, card };
}

test("a claim that is NOT the board's, live in front of the board's question: the card says THAT claim and keeps its reply; the board's question is not drawn in its place", async () => {
  const { card } = await home(
    { boardAsks: true, waiting: { reason: "attention", message: "I need the staging password before I can go on", since: "2026-11-23T18:09:00.000Z" } },
    () => ({ at: BOARD_AT, supported: true, stale: false, board: { facts: [], questions: [QUESTION] }, claim: { producer: "agent", reason: "attention" } }),
  );
  // (The roster's row would not say `boardAsks` for it: kernel/roster.ts reads the claim's producer. This is the
  // card's own second look, for the seconds in which an agent's event has patched the claim and the status read
  // that follows has not yet come: the board's read names whose the claim is.)
  await within(card).findByTestId("oats-reply-send");
  expect(within(card).getByTestId("oats-needs-question").textContent).toBe("I need the staging password before I can go on");
  expect(within(card).queryByTestId("oats-board-questions")).toBeNull();
  expect(within(card).queryByTestId("oats-board-answer")).toBeNull();
});

test("the board's read FAILS for a card whose row says the board asks: the card is the card as ever, the claim's text and the reply, never empty", async () => {
  const { card } = await home(
    { boardAsks: true, waiting: { reason: "attention", message: "Which base branch?", since: "2026-11-23T18:01:45.726Z" } },
    () => { throw new Error("The machine that runs oats did not answer."); },
  );
  await within(card).findByTestId("oats-reply-send");
  expect(within(card).getByTestId("oats-needs-question").textContent).toBe("Which base branch?");
});

test("while the board is read the card says what is asked (the claim's text), with nothing to press yet; then the question with its options", async () => {
  let land: (value: unknown) => void = () => {};
  const { card } = await home(
    { boardAsks: true, waiting: { reason: "attention", message: "Which base branch?", since: "2026-11-23T18:01:45.726Z" } },
    () => new Promise((resolve) => { land = resolve; }),
  );
  await act(async () => void (await new Promise((resolve) => setTimeout(resolve, 50))));
  expect(within(card).getByTestId("oats-needs-question").textContent).toBe("Which base branch?");
  expect(within(card).queryByTestId("oats-reply-send")).toBeNull(); // no field that would go away under a person's hands
  expect(card.querySelectorAll("button, textarea").length).toBe(1); // Open alone
  await act(async () => land({ at: BOARD_AT, supported: true, stale: false, board: { facts: [], questions: [QUESTION] }, claim: { producer: "oats.board", reason: "attention" } }));
  await within(card).findByTestId("oats-board-questions");
  expect(within(card).queryByTestId("oats-needs-question")).toBeNull(); // said once: by the board

});

test("a card whose question has a context starts no inspection by being shown: the detail is read when its Context fold is opened", async () => {
  const withContext = { ...QUESTION, hasContext: true };
  const { slot, card } = await home(
    { boardAsks: true, waiting: { reason: "attention", message: "Which base branch?", since: "2026-11-23T18:01:45.726Z" } },
    () => ({ at: BOARD_AT, supported: true, stale: false, board: { facts: [], questions: [withContext] }, claim: { producer: "oats.board", reason: "attention" } }),
  );
  const fold = (await within(card).findByTestId("oats-board-context")) as HTMLDetailsElement;
  await act(async () => void (await new Promise((resolve) => setTimeout(resolve, 50))));
  const reads = () => slot.inspection.rpcCalls.filter((call) => call.method === "boardDetail").length;
  expect(reads()).toBe(0);
  act(() => {
    fold.open = true;
    fold.dispatchEvent(new Event("toggle"));
  });
  await act(async () => void (await new Promise((resolve) => setTimeout(resolve, 50))));
  expect(reads()).toBe(1);
});
