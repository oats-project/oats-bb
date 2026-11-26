// @vitest-environment jsdom
// What the delta read on the cut found in round 4's own fixes (the reader's proofs, kept as tests): a detail held
// from an earlier showing is read again where the board changed while no part showed it; a person's own turn ends the
// one second's wait. (Its third, a failed read of the board taken as an answer, went with what it served: which tabs
// are drawn no longer depends on any read.)
import { useState } from "react";
import { afterEach, expect, test, vi } from "vitest";
import { act, fireEvent, waitFor, within } from "@testing-library/react";
import { renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { Board, forgetHidden } from "../../app/board";
import { InstancePanel, showPanelTab } from "../../app/panel/Panel";
import { fixtureAgents, fixtureThreads } from "../helpers/fixtures";
import { handlers, loadApp, resetApp } from "../helpers/render";
import type { Contract } from "../helpers/render";
import { instanceAnswer, panelAgents, panelSnapshot, panelThreads } from "../panel/handlers";
import { BOARD_AT } from "./handlers";

afterEach(() => { resetApp(); forgetHidden(); vi.useRealTimers(); });
const FACT = { key: "tests", label: "Tests", value: "3", unit: "failing", link: null, at: "2026-11-23T18:00:58.766Z" };
const Q1 = { id: "q3", question: "Which base branch?", options: ["main: the default", "release: the 0.1 line"], hasContext: false, since: "2026-11-23T18:01:45.724Z" };
const Q2 = { id: "q4", question: "Squash?", options: ["yes", "no"], hasContext: false, since: "2026-11-23T18:02:45.724Z" };
const Q3 = { id: "q5", question: "Tag?", options: ["now", "later"], hasContext: false, since: "2026-11-23T18:03:45.724Z" };
const CHILD = "panel-worktree-helper";
const PARENT = "redesign-ui-lead";
const threadOf = (instance: string): string => panelAgents().find((agent) => agent.instance === instance)?.threadId ?? "";
const sleep = (ms: number) => act(async () => { await new Promise((resolve) => setTimeout(resolve, ms)); });

// The panel as bb holds it: a thread that changes, a mount that may be made anew (`mount`), a panel that may be closed (`null`).
let show: (next: { threadId: string | null; mount: number }) => void = () => {};
function Shown({ threadId }: { threadId: string }) {
  const [now, setNow] = useState<{ threadId: string | null; mount: number }>({ threadId, mount: 0 });
  show = setNow;
  return now.threadId === null ? null : <InstancePanel key={now.mount} threadId={now.threadId} />;
}
type Slot = ReturnType<typeof renderSlot<{ threadId: string }, Contract>>;
const tabs = (slot: Slot) => within(slot.getByRole("tablist", { name: "Instance context" })).getAllByRole("tab").map((tab) => `${tab.textContent}${tab.getAttribute("aria-selected") === "true" ? "*" : ""}`);
const selected = (slot: Slot) => tabs(slot).find((tab) => tab.endsWith("*"));
const press = (slot: Slot, name: string) => fireEvent.click(within(slot.getByRole("tablist", { name: "Instance context" })).getByRole("tab", { name }));
const rowsWith = (has: () => boolean) => panelAgents().map((agent) => { if (agent.instance !== CHILD) return agent; const { hasBoard: _h, boardAsks: _a, ...row } = agent; return has() ? { ...row, hasBoard: true as const } : row; });

test("the detail: a question WITH CONTEXT asked while the Board tab was not shown (a detail is held from the earlier showing)", async () => {
  await loadApp();
  let board: unknown = { facts: [FACT], questions: [] };
  let inspection: unknown = { instance: { board: { facts: [{ ...FACT, history: [{ value: "1", at: FACT.at }, { value: "3", at: FACT.at }] }], questions: [] } } };
  const slot = renderSlot<{ threadId: string }, Contract>({ component: Shown }, { threadId: threadOf(CHILD) }, {
    rpc: handlers({ snapshot: () => panelSnapshot(rowsWith(() => true)), panelInstance: ({ instance }: { instance: string }) => instanceAnswer(instance), board: () => ({ at: BOARD_AT, supported: true, stale: false, board, claim: null }), boardDetail: () => ({ inspection }) } as never),
    sidebarThreads: panelThreads(),
  });
  const reads = () => slot.inspection.rpcCalls.filter((call) => call.method === "boardDetail").length;
  await waitFor(() => expect(tabs(slot)).toContain("Board"));
  press(slot, "Board");
  await waitFor(() => expect(slot.getByTestId("oats-board-spark")).toBeTruthy());
  expect(reads()).toBe(1);
  press(slot, "Instance");
  const asked = { ...Q1, hasContext: true };
  board = { facts: [FACT], questions: [asked] };
  inspection = { instance: { board: { facts: [{ ...FACT, history: [{ value: "1", at: FACT.at }, { value: "3", at: FACT.at }] }], questions: [{ id: asked.id, since: asked.since, context: "main is protected." }] } } };
  await act(async () => { slot.behavior.emitRealtime("oats/changed", { at: "2026-11-23T18:17:30.000Z" }); await new Promise((resolve) => setTimeout(resolve, 200)); });
  press(slot, "Board");
  await waitFor(() => expect(slot.getByTestId("oats-board-question").textContent).toBe("Which base branch?"));
  const fold = slot.getByTestId("oats-board-context");
  fireEvent.click(fold.querySelector("summary") ?? fold);
  await sleep(500);
  expect(slot.queryByTestId("oats-board-context-text")?.textContent).toBe("main is protected.");
}, 30000);

test("the one second: a person's own turn (›) inside the second after options took a question's place: no wait for the question turned to", async () => {
  await loadApp();
  let questions: unknown = [Q1, Q2, Q3];
  const slot = renderSlot<{ instance: string }, Contract>({ component: Board }, { instance: PARENT }, {
    rpc: handlers({ board: () => ({ at: BOARD_AT, supported: true, stale: false, board: { facts: [], questions }, claim: { producer: "oats.board", reason: "attention" } }) }, fixtureAgents()),
    sidebarThreads: { status: "ready" as const, threads: fixtureThreads() },
    sdk: { threads: { interactions: { list: async () => [] }, send: async () => ({ ok: true }) } } as never,
  });
  await waitFor(() => expect(slot.getByTestId("oats-board").getAttribute("data-state")).toBe("shown"));
  const zone = slot.getByTestId("oats-board-questions");
  const answers = () => within(zone).queryAllByTestId("oats-board-answer") as HTMLButtonElement[];
  await waitFor(() => expect(answers().length).toBe(2));
  questions = [Q2, Q3];
  await act(async () => { slot.behavior.emitRealtime("oats/changed", { at: "2026-11-23T18:17:30.000Z" }); await new Promise((resolve) => setTimeout(resolve, 100)); });
  await waitFor(() => expect(within(zone).getByTestId("oats-board-question").textContent).toBe("Squash?"));
  expect(answers().map((button) => button.disabled)).toEqual([true, true]);
  fireEvent.click(within(zone).getByTestId("oats-board-next"));
  expect(within(zone).getByTestId("oats-board-question").textContent).toBe("Tag?");
  const seen = [answers().map((button) => button.disabled)];
  expect(seen[0]).toEqual([false, false]); // at the turn itself: a person's own turn has no wait
}, 20000);


