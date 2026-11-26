// @vitest-environment jsdom
// What a fresh reviewer's first round found in the panel's tabs (its own proofs, kept as tests): an open panel never
// turns by itself. (Since then the panel no longer opens on Board by itself either: it opens where it was left, and
// Board is reached by a press: the tab, the thread line's Answer, the palette.)
import { afterEach, expect, test } from "vitest";
import { act, fireEvent, waitFor, within } from "@testing-library/react";
import { renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { forgetHidden } from "../../app/board";
import { InstancePanel } from "../../app/panel/Panel";
import { handlers, loadApp, resetApp } from "../helpers/render";
import type { Contract } from "../helpers/render";
import { instanceAnswer, panelSnapshot, panelThreads } from "../panel/handlers";
import { BOARD_AT } from "./handlers";

afterEach(() => { resetApp(); forgetHidden(); });
const CHILD_THREAD = "thr_u2jw8887aw";
const FACT = { key: "tests", label: "Tests", value: "3", unit: "failing", link: null, at: "2026-11-23T18:00:58.766Z" };
const QUESTION = { id: "q3", question: "Which base branch?", options: ["main: the default", "release: the 0.1 line"], hasContext: false, since: "2026-11-23T18:01:45.724Z" };

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

test("a person reads the facts on Board (their press); the agent clears its question: the panel stays on Board while the tab is drawn", async () => {
  const { slot, shown, change } = await panel({ facts: [FACT], questions: [QUESTION] });
  await waitFor(() => expect(shown()).toBe("Instance")); // it opens where it was left: never on Board by itself
  fireEvent.click(within(slot.getByRole("tablist")).getByRole("tab", { name: "Board" }));
  await waitFor(() => expect(shown()).toBe("Board"));
  // what a person does on the Board that is not a press on a tab: hides a fact
  fireEvent.click(await slot.findByTestId("oats-board-fact-hide"));
  await change({ facts: [FACT], questions: [] });
  expect(shown()).toBe("Board");
});

test("a panel the memory opened on another tab stays there when the agent asks: it does not turn to Board under the reader", async () => {
  const { shown, change } = await panel({ facts: [FACT], questions: [] });
  await waitFor(() => expect(shown()).toBe("Instance")); // facts alone: the memory's tab, and no tab was pressed
  await change({ facts: [FACT], questions: [QUESTION] });
  expect(shown()).toBe("Instance");
});

test("a Board tab that goes (its last fact and question gone) leaves the panel on Instance, and the panel does not come back to Board by itself when the agent asks again", async () => {
  const { slot, shown, change } = await panel({ facts: [], questions: [QUESTION] });
  await waitFor(() => expect(shown()).toBe("Instance"));
  fireEvent.click(within(slot.getByRole("tablist")).getByRole("tab", { name: "Board" }));
  await waitFor(() => expect(shown()).toBe("Board"));
  await change({ facts: [], questions: [] });
  expect(shown()).toBe("Instance");
  await change({ facts: [], questions: [QUESTION] });
  expect(shown()).toBe("Instance");
});

test("the agent asks while its panel is open on Instance: the panel stays; the thread's line says so with Answer, and Answer turns the panel to Board, the focus on the question's zone (never on an option)", async () => {
  const { panelAgents } = await import("../panel/handlers");
  const app = await loadApp();
  const Row = app.threadHeaderRows[0]!.component;
  const CHILD = "panel-worktree-helper";
  const rows = (asks: boolean) =>
    panelAgents().map((agent) => {
      if (agent.instance !== CHILD) return agent;
      const { boardAsks: _asked, ...row } = agent;
      return asks ? { ...row, hasBoard: true as const, boardAsks: true as const, waiting: { reason: "attention", message: "Which base branch?", since: QUESTION.since } } : { ...row, hasBoard: true as const, waiting: null };
    });
  let asks = false;
  type Props = { threadId: string; projectId: string; environment: null };
  const slot = renderSlot<Props, Contract>(
    { component: (props: Props) => (<><Row {...props} /><InstancePanel threadId={props.threadId} /></>) } as never,
    { threadId: CHILD_THREAD, projectId: "p", environment: null },
    {
      rpc: handlers({
        snapshot: () => panelSnapshot(rows(asks)),
        panelInstance: ({ instance }) => instanceAnswer(instance),
        board: () => ({ at: BOARD_AT, supported: true, stale: false, board: { facts: [FACT], questions: asks ? [QUESTION] : [] }, claim: asks ? { producer: "oats.board", reason: "attention" } : null }),
      }),
      sidebarThreads: panelThreads(),
      sdk: { threads: { interactions: { list: async () => [] } } } as never,
    },
  );
  const shown = () => within(slot.getByRole("tablist", { name: "Instance context" })).getAllByRole("tab").find((tab) => tab.getAttribute("aria-selected") === "true")?.textContent;
  await slot.findByTestId("oats-panel-header", {}, { timeout: 4000 });
  await waitFor(() => expect(within(slot.getByRole("tablist", { name: "Instance context" })).getAllByRole("tab").map((tab) => tab.textContent)).toEqual(["Board", "Instance", "Soul"]));
  expect(shown()).toBe("Instance");
  asks = true;
  await act(async () => {
    slot.behavior.emitRealtime("oats/changed", { at: "2026-11-23T18:17:30.000Z" });
    await new Promise((resolve) => setTimeout(resolve, 150));
  });
  const answer = await waitFor(() => {
    const button = slot.getByTestId("oats-status-act");
    expect(button.textContent).toBe("Answer");
    return button;
  });
  expect(slot.getByTestId("oats-identity-row").textContent).toMatch(/Needs you/);
  expect(shown()).toBe("Instance"); // a screen never moves under a reader
  fireEvent.click(answer);
  await waitFor(() => expect(shown()).toBe("Board"));
  await waitFor(() => expect(document.activeElement).toBe(slot.getByTestId("oats-board-questions")));
});
