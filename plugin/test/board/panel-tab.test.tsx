// @vitest-environment jsdom
// The Board as a tab of the instance panel, the first: turned to, it draws the agent's board and
// nothing of the panel's pages; the board takes the agent's name alone.
import { afterEach, expect, test, vi } from "vitest";
import { fireEvent, waitFor, within } from "@testing-library/react";
import { renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { forgetHidden } from "../../app/board";
import { InstancePanel } from "../../app/panel/Panel";
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
const BOARD = { facts: [{ key: "tests", label: "Tests", value: "3", unit: "failing", link: null, at: "2026-11-23T18:00:58.766Z" }], questions: [{ id: "q3", question: "Which base branch?", options: ["main: the default", "release: the 0.1 line"], hasContext: false, since: "2026-11-23T18:01:45.724Z" }] };

test("Board is the panel's first tab; turned to, the panel's page is the agent's board, asked for by its name alone", async () => {
  await loadApp();
  const asked: unknown[] = [];
  const agents = panelAgents();
  const slot = renderSlot<{ threadId: string }, Contract>({ component: InstancePanel }, { threadId: CHILD_THREAD }, {
    rpc: handlers({
      snapshot: () => panelSnapshot(agents),
      panelInstance: ({ instance }) => instanceAnswer(instance),
      board: (input) => (asked.push(input), { at: BOARD_AT, supported: true, board: BOARD, claim: { producer: "oats.board", reason: "attention" } }),
    }),
    sidebarThreads: panelThreads(agents),
  });
  await slot.findByTestId("oats-panel-work");
  const tabs = within(slot.getByRole("tablist", { name: "Instance context" })).getAllByRole("tab");
  expect(tabs.map((tab) => tab.textContent)).toEqual(["Board", "Instance", "Soul"]);
  expect(asked).toEqual([]); // not read while its tab is not shown
  fireEvent.click(tabs[0]!);
  await waitFor(() => expect(slot.getByTestId("oats-board").getAttribute("data-state")).toBe("shown"));
  expect(asked).toEqual([{ instance: CHILD }]);
  const page = slot.getByRole("tabpanel");
  expect(page.getAttribute("data-testid")).toBe("oats-panel-page-board");
  expect(within(page).getByTestId("oats-board-question").textContent).toBe("Which base branch?");
  expect(within(page).getAllByTestId("oats-board-fact")).toHaveLength(1);
  // Nothing of the Instance page is under it.
  expect(within(page).queryByTestId("oats-panel-work")).toBeNull();
  // The header stays over the tabs.
  expect(slot.getByTestId("oats-panel-name").textContent).toBe("Panel worktree helper");
});
