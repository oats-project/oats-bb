// @vitest-environment jsdom
// The home's card of an agent that needs the person for a question of its board is NEVER left with no question,
// whatever the card offers (a fresh reviewer's third round found the one arm where it was; its proof is the first test).
import { afterEach, expect, test, vi } from "vitest";
import { act, fireEvent, waitFor, within } from "@testing-library/react";
import { renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { forgetHidden } from "../../app/board";
import type { Agent } from "../../model/types";
import { fixtureAgents } from "../helpers/fixtures";
import { handlers, loadApp, resetApp, sidebarThreads } from "../helpers/render";
import type { Contract } from "../helpers/render";
import { BOARD_AT } from "./handlers";

afterEach(() => { resetApp(); forgetHidden(); vi.useRealTimers(); });
const WHO = "flaky-ci-developer";
const QUESTION = { id: "q3", question: "Which base branch?", options: ["main: the default", "release: the 0.1 line"], hasContext: false, since: "2026-11-23T18:01:45.724Z" };

test("the board's question is open AND bb holds an approval; the approval is answered on the card; bb then holds nothing: the card must still say the board's question", async () => {
  const app = await loadApp();
  const panel = app.navPanels.find((candidate) => candidate.id === "home")!;
  const agents = fixtureAgents().map((agent): Agent => (agent.instance === WHO ? { ...agent, hasBoard: true, boardAsks: true, waiting: { reason: "attention", message: "Which base branch?", since: "2026-11-23T18:01:45.726Z" } } : agent));
  let pending = true;
  const listed = sidebarThreads();
  const before = listed.threads.find((thread) => thread.id === "thr_ci")!;
  Object.defineProperty(before, "hasPendingInteraction", { get: () => pending, enumerable: true, configurable: true });
  const slot = renderSlot<{ subPath: string }, Contract>(panel, { subPath: "" }, {
    rpc: handlers({ board: () => ({ at: BOARD_AT, supported: true, stale: false, board: { facts: [], questions: [QUESTION] }, claim: { producer: "oats.board", reason: "attention" } }) }, agents),
    sidebarThreads: listed,
    sdk: {
      threads: {
        interactions: {
          list: async () => (pending ? [{ id: "pint_2", threadId: "thr_ci", status: "pending", payload: { kind: "approval", reason: "scripted", subject: { kind: "command", command: "git push" }, availableDecisions: ["allow_once", "deny"] } }] : []) as never,
          resolve: async () => ((pending = false), {}) as never,
        },
        send: async () => ({ ok: true }),
      },
    } as never,
  });
  const card = (await slot.findAllByTestId("oats-needs-card")).find((each) => each.dataset.instance === WHO)!;
  await waitFor(() => expect(within(card).getAllByTestId("oats-needs-choice").map((choice) => choice.textContent)).toEqual(["Allow", "Deny"]));
  fireEvent.click(within(card).getAllByTestId("oats-needs-choice")[0]!);
  await waitFor(() => expect(within(card).queryAllByTestId("oats-needs-choice")).toEqual([]));
  await act(async () => {
    slot.behavior.emitRealtime("oats/changed", { at: "2026-11-23T18:17:30.000Z" });
    await new Promise((resolve) => setTimeout(resolve, 300));
  });
  // "Answered: Allow.", and under it the board's question with its options, by the board's own component: said once.
  expect(card.dataset.offer).toBe("answered");
  expect(within(card).getByTestId("oats-needs-answered").textContent).toBe("Answered: Allow.");
  await waitFor(() => expect(within(card).getByTestId("oats-board-question").textContent).toBe("Which base branch?"));
  expect(within(card).queryByTestId("oats-needs-question")).toBeNull();
  expect(within(card).getAllByTestId("oats-board-option")).toHaveLength(2);
});

// ---- one test per offer: the card is never without the question
const ASKS = "ranker-v3-probe"; // on thr_research
const CLAIM = { reason: "attention", message: "Which base branch?", since: "2026-11-23T18:01:45.726Z" };
const APPROVAL = { id: "pint_9", threadId: "thr_research", status: "pending", payload: { kind: "approval", reason: "scripted", subject: { kind: "command", command: "git push" }, availableDecisions: ["allow_once", "deny"] } };
const UNKNOWN = { id: "pint_8", threadId: "thr_research", status: "pending", payload: { kind: "something-else" } };
type Case = { offer: string; change: Partial<Agent>; pending?: boolean; interactions?: unknown[]; by: "board" | "claim"; /** what the card says is asked, where it is not the board's question */ says?: string };
const CASES: Case[] = [
  { offer: "reply", change: {}, by: "board" },
  { offer: "choices", change: {}, pending: true, interactions: [APPROVAL], by: "claim" },
  { offer: "in-thread", change: {}, pending: true, interactions: [UNKNOWN], by: "claim" },
  { offer: "stopped", change: { running: false, runtimeState: "stopped" }, pending: true, interactions: [APPROVAL], by: "claim", says: "Run: git push" }, // (OATS stopped it, and bb still holds a request on its thread: a stopped agent's card says bb's request, as ever; its claim is from before the stop)
  { offer: "unreachable", change: { running: null, runtimeState: "unreachable" }, by: "claim" },
  { offer: "elsewhere", change: { backend: "tmux", threadId: null }, by: "claim" },
];
for (const each of CASES) {
  test(`offer "${each.offer}": the card of an agent whose board asks says the question (${each.by === "board" ? "by the board's own component, with its options" : "the claim's text: the card as ever"}), once`, async () => {
    const app = await loadApp();
    const panel = app.navPanels.find((candidate) => candidate.id === "home")!;
    const agents = fixtureAgents().map((agent): Agent => (agent.instance === ASKS ? { ...agent, hasBoard: true, boardAsks: true, waiting: CLAIM, ...each.change } : agent));
    const listed = sidebarThreads();
    if (each.pending === true) Object.defineProperty(listed.threads.find((thread) => thread.id === "thr_research")!, "hasPendingInteraction", { get: () => true, enumerable: true, configurable: true });
    const slot = renderSlot<{ subPath: string }, Contract>(panel, { subPath: "" }, {
      rpc: handlers({ board: () => ({ at: BOARD_AT, supported: true, stale: false, board: { facts: [], questions: [QUESTION] }, claim: { producer: "oats.board", reason: "attention" } }) }, agents),
      sidebarThreads: listed,
      sdk: { threads: { interactions: { list: async () => (each.interactions ?? []) as never }, send: async () => ({ ok: true }) } } as never,
    });
    const card = (await slot.findAllByTestId("oats-needs-card")).find((found) => found.dataset.instance === ASKS)!;
    await waitFor(() => expect(card.dataset.offer).toBe(each.offer));
    if (each.by === "board") {
      await waitFor(() => expect(within(card).getByTestId("oats-board-question").textContent).toBe("Which base branch?"));
      expect(within(card).queryByTestId("oats-needs-question")).toBeNull();
      expect(within(card).getAllByTestId("oats-board-option")).toHaveLength(2);
    } else {
      expect(within(card).getByTestId("oats-needs-question").textContent).toBe(each.says ?? "Which base branch?"); // never without a question
      expect(within(card).queryByTestId("oats-board-questions")).toBeNull(); // no options that send from a card that offers no reply
    }
    expect(card.textContent!.split("Which base branch?").length - 1).toBe(each.says === undefined ? 1 : 0); // and said once
  });
}
