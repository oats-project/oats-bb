// @vitest-environment jsdom
// What a fresh reviewer's second round found in the panel's tabs (its own proofs, kept as tests): a press is an EVENT. One that
// names the tab the memory already holds moves a panel that opened on Board by itself, and one made for an agent
// whose panel is not open yet decides where that panel opens.
import { useState } from "react";
import { afterEach, expect, test } from "vitest";
import { act, fireEvent, waitFor, within } from "@testing-library/react";
import { renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { forgetHidden } from "../../app/board";
import { InstancePanel, showPanelTab } from "../../app/panel/Panel";
import { handlers, loadApp, resetApp } from "../helpers/render";
import type { Contract } from "../helpers/render";
import { instanceAnswer, panelAgents, panelSnapshot, panelThreads } from "../panel/handlers";
import { BOARD_AT } from "./handlers";

afterEach(() => { resetApp(); forgetHidden(); });
const CHILD_THREAD = "thr_u2jw8887aw";
const CHILD = "panel-worktree-helper";
const FACT = { key: "tests", label: "Tests", value: "3", unit: "failing", link: null, at: "2026-11-23T18:00:58.766Z" };
const QUESTION = { id: "q3", question: "Which base branch?", options: ["main: the default", "release: the 0.1 line"], hasContext: false, since: "2026-11-23T18:01:45.724Z" };
const selected = (slot: { getByRole: (role: string, options: object) => HTMLElement }) => within(slot.getByRole("tablist", { name: "Instance context" })).getAllByRole("tab").find((tab) => tab.getAttribute("aria-selected") === "true")?.textContent;

test("memory left on Soul, panel opens on Board (a question is open); a press on the header's soul link must show Soul", async () => {
  await loadApp();
  showPanelTab("soul");
  const slot = renderSlot<{ threadId: string }, Contract>({ component: InstancePanel }, { threadId: CHILD_THREAD }, {
    rpc: handlers({ snapshot: () => panelSnapshot(), panelInstance: ({ instance }) => instanceAnswer(instance), board: () => ({ at: BOARD_AT, supported: true, stale: false, board: { facts: [FACT], questions: [QUESTION] }, claim: null }) }),
    sidebarThreads: panelThreads(),
  });
  await slot.findByTestId("oats-panel-header");
  await waitFor(() => expect(selected(slot)).toBe("Board"));
  fireEvent.click(slot.getByTestId("oats-panel-soul-link"));
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 150)); });
  expect(selected(slot)).toBe("Soul");
});

for (const open of [true, false]) {
  test(`(${open ? "panel open" : "panel opened by the press"}): a claim that is NOT the board's stands in front of an open board question; the thread line's Answer must lead to Instance ("Needs input"), not Board`, async () => {
    const app = await loadApp();
    const Row = app.threadHeaderRows[0]!.component;
    const rows = panelAgents().map((agent) => {
      if (agent.instance !== CHILD) return agent;
      const { boardAsks: _asked, ...row } = agent;
      return { ...row, hasBoard: true as const, waiting: { reason: "attention", message: "The deploy key expired: give me a new one", since: "2026-11-23T18:05:00.000Z" } };
    });
    type Props = { threadId: string; projectId: string; environment: null };
    let withPanel = open;
    let rerender: () => void = () => {};
    const Both = (props: Props) => {
      const [, set] = useState(0);
      rerender = () => set((n: number) => n + 1);
      return (<><Row {...props} />{withPanel ? <InstancePanel threadId={props.threadId} /> : null}</>);
    };
    const slot = renderSlot<Props, Contract>({ component: Both } as never, { threadId: CHILD_THREAD, projectId: "p", environment: null }, {
      rpc: handlers({
        snapshot: () => panelSnapshot(rows),
        panelInstance: ({ instance }) => instanceAnswer(instance),
        board: () => ({ at: BOARD_AT, supported: true, stale: false, board: { facts: [FACT], questions: [QUESTION] }, claim: { producer: "agent", reason: "attention" } }),
      }),
      sidebarThreads: panelThreads(),
      sdk: { threads: { interactions: { list: async () => [] } } } as never,
    });
    const answer = await waitFor(() => {
      const button = slot.getByTestId("oats-status-act");
      expect(button.textContent).toBe("Answer");
      return button;
    }, { timeout: 4000 });
    if (open) await waitFor(() => expect(selected(slot)).toBe("Board")); // it opened on Board: the board has an open question
    fireEvent.click(answer);
    if (!open) { withPanel = true; await act(async () => rerender()); }
    await slot.findByTestId("oats-panel-header", {}, { timeout: 4000 });
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 400)); });
    expect(selected(slot)).toBe("Instance");
  });
}

// ---- a board that cannot be shown is SAID, on its own tab: never by the board's silence
for (const [what, board, said] of [
  ["a board that is no board (another shape)", "not a board", "This agent's board could not be read."],
  ["a board whose every entry is out of the contract", { facts: [{ key: "BAD KEY", label: "x", value: "y", at: "2026-11-23T18:00:58.766Z" }], questions: [{ id: "q1", question: "Which?", options: ["one"], since: "2026-11-23T18:00:58.766Z" }] }, "2 entries of this agent's board could not be shown."],
] as const) {
  test(`${what}: the Board tab is drawn, and on it the panel says what could not be shown`, async () => {
    await loadApp();
    const slot = renderSlot<{ threadId: string }, Contract>({ component: InstancePanel }, { threadId: CHILD_THREAD }, {
      rpc: handlers({ snapshot: () => panelSnapshot(), panelInstance: ({ instance }) => instanceAnswer(instance), board: () => ({ at: BOARD_AT, supported: true, stale: false, board, claim: null }) }),
      sidebarThreads: panelThreads(),
    });
    await slot.findByTestId("oats-panel-header");
    const tabs = () => within(slot.getByRole("tablist", { name: "Instance context" })).getAllByRole("tab").map((tab) => tab.textContent);
    await waitFor(() => expect(tabs()).toEqual(["Board", "Instance", "Soul"]));
    expect(selected(slot)).toBe("Instance"); // nothing asks: it opens where the memory leads
    fireEvent.click(within(slot.getByRole("tablist")).getByRole("tab", { name: "Board" }));
    await waitFor(() => expect(slot.getByRole("tabpanel").textContent).toBe(said));
    expect(slot.queryByTestId("oats-board-nothing")).toBeNull(); // never read as "nothing to show"
  });
}
