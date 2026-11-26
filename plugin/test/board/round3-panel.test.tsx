// @vitest-environment jsdom
// What a fresh reviewer's third round found in the panel's tabs (its own proofs, kept as tests): a tab that stops
// being drawn leaves the panel on Instance and it STAYS there, whatever the window's memory holds; and a failed read
// of the board is not its first answer. (The rule itself, as a table: test/panel/tab-state.test.ts.)
import { afterEach, expect, test } from "vitest";
import { act, fireEvent, waitFor, within } from "@testing-library/react";
import { renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { forgetHidden } from "../../app/board";
import { InstancePanel, showPanelTab } from "../../app/panel/Panel";
import { handlers, loadApp, resetApp } from "../helpers/render";
import type { Contract } from "../helpers/render";
import { instanceAnswer, panelSnapshot, panelThreads } from "../panel/handlers";
import { BOARD_AT } from "./handlers";

afterEach(() => { resetApp(); forgetHidden(); });
const CHILD_THREAD = "thr_u2jw8887aw";
const FACT = { key: "tests", label: "Tests", value: "3", unit: "failing", link: null, at: "2026-11-23T18:00:58.766Z" };
const QUESTION = { id: "q3", question: "Which base branch?", options: ["main: the default", "release: the 0.1 line"], hasContext: false, since: "2026-11-23T18:01:45.724Z" };
const QUESTION2 = { ...QUESTION, id: "q4", question: "And the tag?", since: "2026-11-23T18:09:00.000Z" };

async function panel(first: unknown, before: () => void = () => {}) {
  let board = first;
  await loadApp();
  before();
  const slot = renderSlot<{ threadId: string }, Contract>({ component: InstancePanel }, { threadId: CHILD_THREAD }, {
    rpc: handlers({ snapshot: () => panelSnapshot(), panelInstance: ({ instance }) => instanceAnswer(instance), board: () => ({ at: BOARD_AT, supported: true, stale: false, board, claim: null }) }),
    sidebarThreads: panelThreads(),
  });
  const shown = () => within(slot.getByRole("tablist", { name: "Instance context" })).getAllByRole("tab").find((tab) => tab.getAttribute("aria-selected") === "true")?.textContent;
  const change = async (next: unknown) => {
    board = next;
    await act(async () => {
      slot.behavior.emitRealtime("oats/changed", { at: "2026-11-23T18:17:30.000Z" });
      await new Promise((resolve) => setTimeout(resolve, 150));
    });
  };
  await slot.findByTestId("oats-panel-header");
  return { slot, shown, change };
}

test("memory holds Board from an earlier press (the thread line's Answer, the palette, a Board tab): the question is cleared (tab goes, Instance), the agent asks its NEXT question: the panel must stay on Instance", async () => {
  const { shown, change } = await panel({ facts: [], questions: [QUESTION] }, () => showPanelTab("board"));
  await waitFor(() => expect(shown()).toBe("Board"));
  await change({ facts: [], questions: [] });
  expect(shown()).toBe("Instance");
  await change({ facts: [], questions: [QUESTION2] });
  expect(shown()).toBe("Instance");
});

test("the person PRESSES the Board tab on this panel; the board empties (Instance); the agent sets a fact again: the panel must stay on Instance", async () => {
  const { slot, shown, change } = await panel({ facts: [FACT], questions: [] });
  await waitFor(() => expect(shown()).toBe("Instance"));
  fireEvent.click(within(slot.getByRole("tablist")).getByRole("tab", { name: "Board" }));
  await waitFor(() => expect(shown()).toBe("Board"));
  await change({ facts: [], questions: [] });
  expect(shown()).toBe("Instance");
  await change({ facts: [FACT], questions: [] });
  expect(shown()).toBe("Instance");
});

test("the board's own read FAILS (the server refuses it) for an agent whose row says it has a board: the Board tab is drawn by the row's word, the panel says there that it could not be read, with Retry; and once it reads with a question open, that first answer opens the panel on Board", async () => {
  let fail = true;
  await loadApp();
  const slot = renderSlot<{ threadId: string }, Contract>({ component: InstancePanel }, { threadId: CHILD_THREAD }, {
    rpc: handlers({ snapshot: () => panelSnapshot(), panelInstance: ({ instance }) => instanceAnswer(instance), board: () => { if (fail) throw new Error("The OATS roster is being read again: try once more."); return { at: BOARD_AT, supported: true, stale: false, board: { facts: [FACT], questions: [QUESTION] }, claim: null }; } }),
    sidebarThreads: panelThreads(),
  });
  await slot.findByTestId("oats-panel-header");
  const tabs = () => within(slot.getByRole("tablist", { name: "Instance context" })).getAllByRole("tab").map((tab) => `${tab.textContent}${tab.getAttribute("aria-selected") === "true" ? "*" : ""}`);
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 400)); });
  // While the read fails: the tab is there by the row's word (the recorded row has a board), the panel stays where it opened…
  expect(tabs()).toEqual(["Board", "Instance*", "Soul"]);
  // …and on the tab the panel says that the board could not be read, with Retry.
  fireEvent.click(within(slot.getByRole("tablist")).getByRole("tab", { name: "Board" }));
  await waitFor(() => expect(slot.getByTestId("oats-board-retry")).toBeTruthy());
  expect(slot.getByRole("tabpanel").textContent).toMatch(/could not be read|try once more/);
  fireEvent.click(within(slot.getByRole("tablist")).getByRole("tab", { name: "Instance" }));
  fail = false;
  await act(async () => { slot.behavior.emitRealtime("oats/changed", { at: "2026-11-23T18:17:30.000Z" }); await new Promise((resolve) => setTimeout(resolve, 300)); });
  // A press came since the mount (the two above): the first answer moves nothing. The tab stays drawn, now by the board itself.
  expect(tabs()).toEqual(["Board", "Instance*", "Soul"]);
});

test("the board's read fails at first and answers later with a question open, and nobody pressed a tab meanwhile: THAT answer is the first, and the panel opens on Board", async () => {
  let fail = true;
  await loadApp();
  const slot = renderSlot<{ threadId: string }, Contract>({ component: InstancePanel }, { threadId: CHILD_THREAD }, {
    rpc: handlers({ snapshot: () => panelSnapshot(), panelInstance: ({ instance }) => instanceAnswer(instance), board: () => { if (fail) throw new Error("The OATS roster is being read again: try once more."); return { at: BOARD_AT, supported: true, stale: false, board: { facts: [], questions: [QUESTION] }, claim: null }; } }),
    sidebarThreads: panelThreads(),
  });
  await slot.findByTestId("oats-panel-header");
  const tabs = () => within(slot.getByRole("tablist", { name: "Instance context" })).getAllByRole("tab").map((tab) => `${tab.textContent}${tab.getAttribute("aria-selected") === "true" ? "*" : ""}`);
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 300)); });
  expect(tabs()).toEqual(["Board", "Instance*", "Soul"]);
  fail = false;
  await act(async () => { slot.behavior.emitRealtime("oats/changed", { at: "2026-11-23T18:17:30.000Z" }); await new Promise((resolve) => setTimeout(resolve, 300)); });
  expect(tabs()).toEqual(["Board*", "Instance", "Soul"]);
});
