// @vitest-environment jsdom
// The board's detail is a command (`oats inspect`): read ONCE when the board is first in view, again only when the board
// changed: a Board tab shown again shows what was read (round 4).
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

test("the Board tab left and shown again, nothing changed: the detail is read once", async () => {
  await loadApp();
  const slot = renderSlot<{ threadId: string }, Contract>({ component: InstancePanel }, { threadId: CHILD_THREAD }, {
    rpc: handlers({
      snapshot: () => panelSnapshot(), panelInstance: ({ instance }) => instanceAnswer(instance),
      board: () => ({ at: BOARD_AT, supported: true, stale: false, board: { facts: [FACT], questions: [] }, claim: null }),
      boardDetail: () => ({ inspection: { instance: { board: { facts: [{ ...FACT, history: [{ value: "1", at: FACT.at }, { value: "3", at: FACT.at }] }], questions: [] } } } }),
    }),
    sidebarThreads: panelThreads(),
  });
  await slot.findByTestId("oats-panel-header");
  const reads = () => slot.inspection.rpcCalls.filter((call) => call.method === "boardDetail").length;
  const press = (name: string) => fireEvent.click(within(slot.getByRole("tablist", { name: "Instance context" })).getByRole("tab", { name }));
  await waitFor(() => within(slot.getByRole("tablist", { name: "Instance context" })).getByRole("tab", { name: "Board" }));
  press("Board");
  await waitFor(() => expect(slot.getByTestId("oats-board-spark")).toBeTruthy());
  const seen = [reads()];
  for (let round = 0; round < 2; round += 1) {
    press("Instance");
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 2600)); }); // past the two seconds after which bb reads a mounted query again
    press("Board");
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 400)); });
    seen.push(reads());
  }
  expect(seen).toEqual([1, 1, 1]);
}, 20000);
