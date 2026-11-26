// @vitest-environment jsdom
// The Board as a tab of the instance panel: drawn, first, only for an agent whose board has a fact
// or a question; the panel opens on it where a question is open; its body is the board alone.
import { afterEach, expect, test, vi } from "vitest";
import { act, fireEvent, waitFor, within } from "@testing-library/react";
import { renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { forgetHidden } from "../../app/board";
import { InstancePanel, showPanelTab } from "../../app/panel/Panel";
import { handlers, loadApp, resetApp } from "../helpers/render";
import type { Contract } from "../helpers/render";
import { instanceAnswer, panelAgents, panelSnapshot, panelThreads } from "../panel/handlers";
import { BOARD_AT } from "./handlers";

afterEach(() => {
  resetApp();
  forgetHidden();
  vi.useRealTimers();
});

const CHILD = "panel-worktree-helper";
const CHILD_THREAD = "thr_u2jw8887aw";
const FACT = { key: "tests", label: "Tests", value: "3", unit: "failing", link: null, at: "2026-11-23T18:00:58.766Z" };
const QUESTION = { id: "q3", question: "Which base branch?", options: ["main: the default", "release: the 0.1 line"], hasContext: false, since: "2026-11-23T18:01:45.724Z" };

async function panel(board: unknown) {
  await loadApp();
  const asked: unknown[] = [];
  const agents = panelAgents();
  const slot = renderSlot<{ threadId: string }, Contract>({ component: InstancePanel }, { threadId: CHILD_THREAD }, {
    rpc: handlers({
      snapshot: () => panelSnapshot(agents),
      panelInstance: ({ instance }) => instanceAnswer(instance),
      board: (input) => (asked.push(input), { at: BOARD_AT, supported: true, stale: false, board, claim: null }),
    }),
    sidebarThreads: panelThreads(agents),
  });
  await slot.findByTestId("oats-panel-header");
  const tabs = () => within(slot.getByRole("tablist", { name: "Instance context" })).getAllByRole("tab").map((tab) => `${tab.textContent} ${tab.getAttribute("aria-selected")}`);
  return { slot, asked, tabs };
}

test("an agent whose board has no fact and no question has no Board tab: the tab row is as before", async () => {
  for (const board of [null, { facts: [], questions: [] }]) {
    const { slot, tabs } = await panel(board);
    await slot.findByTestId("oats-panel-work");
    await act(async () => {});
    expect(tabs(), JSON.stringify(board)).toEqual(["Instance true", "Soul false"]);
    resetApp();
  }
});

test("an agent with a fact has the Board tab, FIRST; the panel opens as before (on Instance), and Board is one press away", async () => {
  const { slot, tabs, asked } = await panel({ facts: [FACT], questions: [] });
  await waitFor(() => expect(tabs()).toEqual(["Board false", "Instance true", "Soul false"]));
  expect(asked).toEqual([{ instance: CHILD }]); // the board is asked for by the agent's name alone
  fireEvent.click(within(slot.getByRole("tablist")).getByRole("tab", { name: "Board" }));
  await waitFor(() => expect(slot.getByTestId("oats-board").getAttribute("data-state")).toBe("shown"));
  const page = slot.getByRole("tabpanel");
  expect(page.getAttribute("data-testid")).toBe("oats-panel-page-board");
  expect(within(page).getAllByTestId("oats-board-fact")).toHaveLength(1);
  expect(within(page).queryByTestId("oats-panel-work")).toBeNull(); // nothing of the Instance page is under it
  expect(slot.getByTestId("oats-panel-name").textContent).toBe("Panel worktree helper"); // the header stays over the tabs
});

test("an agent whose board has an OPEN QUESTION: the panel opens on Board; a tab chosen on this panel stays chosen", async () => {
  const { slot, tabs } = await panel({ facts: [FACT], questions: [QUESTION] });
  await waitFor(() => expect(tabs()).toEqual(["Board true", "Instance false", "Soul false"]));
  expect(within(slot.getByRole("tabpanel")).getByTestId("oats-board-question").textContent).toBe("Which base branch?");
  // A press on Instance: the panel no longer turns to Board by itself.
  fireEvent.click(within(slot.getByRole("tablist")).getByRole("tab", { name: "Instance" }));
  await slot.findByTestId("oats-panel-work");
  await act(async () => slot.behavior.emitRealtime("oats/changed", { at: "2026-11-23T18:17:00.000Z" }));
  await act(async () => {});
  expect(tabs()).toEqual(["Board false", "Instance true", "Soul false"]);
});

test("another feature that turns the panel to a tab is obeyed on a panel that opened on Board", async () => {
  const { slot, tabs } = await panel({ facts: [], questions: [QUESTION] });
  await waitFor(() => expect(tabs()[0]).toBe("Board true"));
  act(() => showPanelTab("soul"));
  await waitFor(() => expect(tabs()).toEqual(["Board false", "Instance false", "Soul true"]));
  expect(slot.getByRole("tabpanel").getAttribute("data-testid")).toBe("oats-panel-page-soul");
});
