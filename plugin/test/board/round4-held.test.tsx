// @vitest-environment jsdom
// A mount is not always an opening (a fresh reviewer's fourth round, its own proofs kept as tests): bb's query client
// may HOLD a board answer from an earlier visit. That one may be shown; it decides nothing: which tabs are drawn is
// decided on a read of the board that ENDED SINCE THIS MOUNT (and where the panel opens, on the memory alone).
import { useState } from "react";
import { afterEach, expect, test } from "vitest";
import { act, waitFor, within } from "@testing-library/react";
import { renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { forgetHidden } from "../../app/board";
import { InstancePanel } from "../../app/panel/Panel";
import { handlers, loadApp, resetApp } from "../helpers/render";
import type { Contract } from "../helpers/render";
import { instanceAnswer, panelAgents, panelSnapshot, panelThreads } from "../panel/handlers";
import { BOARD_AT } from "./handlers";

afterEach(() => { resetApp(); forgetHidden(); });
const FACT = { key: "tests", label: "Tests", value: "3", unit: "failing", link: null, at: "2026-11-23T18:00:58.766Z" };
const QUESTION = { id: "q3", question: "Which base branch?", options: ["main: the default", "release: the 0.1 line"], hasContext: false, since: "2026-11-23T18:01:45.724Z" };
const CHILD = "panel-worktree-helper";
const PARENT = "redesign-ui-lead";
const threadOf = (instance: string): string => panelAgents().find((agent) => agent.instance === instance)?.threadId ?? "";
let showThread: (threadId: string) => void = () => {};
function Shown({ threadId }: { threadId: string }) {
  const [now, setNow] = useState(threadId);
  showThread = setNow;
  return <InstancePanel threadId={now} />;
}
const ASKS = { facts: [FACT], questions: [QUESTION] };
const NONE = null;

for (const [what, before, after, tabsThen] of [
  ["the agent ASKED while its panel was not shown", NONE, ASKS, ["Board", "Instance*", "Soul"]],
  ["the agent CLEARED its board while its panel was not shown", ASKS, NONE, ["Instance*", "Soul"]],
] as const) {
  test(`${what}: the panel, shown again, opens where it was left (Instance), and WHICH TABS ARE DRAWN follows what the board says NOW, not the answer bb holds from the earlier showing`, async () => {
    const boards: Record<string, unknown> = { [CHILD]: before };
    await loadApp();
    const slot = renderSlot<{ threadId: string }, Contract>({ component: Shown }, { threadId: threadOf(CHILD) }, {
      rpc: handlers({
        // (The roster's row says what the board says at each moment: `hasBoard` follows it.)
        snapshot: () => panelSnapshot(panelAgents().map((agent) => { if (agent.instance !== CHILD) return agent; const { hasBoard: _has, boardAsks: _asks, ...row } = agent; return boards[CHILD] === ASKS ? { ...row, hasBoard: true as const } : row; })),
        panelInstance: ({ instance }) => instanceAnswer(instance),
        board: ({ instance }) => ({ at: BOARD_AT, supported: true, stale: false, board: boards[instance] ?? null, claim: null }),
      }),
      sidebarThreads: panelThreads(),
    });
    const name = () => slot.getByTestId("oats-panel-name").getAttribute("title");
    const tabs = () => within(slot.getByRole("tablist", { name: "Instance context" })).getAllByRole("tab").map((tab) => `${tab.textContent}${tab.getAttribute("aria-selected") === "true" ? "*" : ""}`);
    const to = async (instance: string) => { act(() => showThread(threadOf(instance))); await waitFor(() => expect(name()).toBe(instance)); };
    await waitFor(() => expect(name()).toBe(CHILD));
    await waitFor(() => expect(tabs()).toEqual(before === ASKS ? ["Board", "Instance*", "Soul"] : ["Instance*", "Soul"]));
    await to(PARENT);
    boards[CHILD] = after; // the agent changes its board while another agent's panel is shown
    await act(async () => { slot.behavior.emitRealtime("oats/changed", { at: "2026-11-23T18:17:30.000Z" }); await new Promise((resolve) => setTimeout(resolve, 150)); });
    await to(CHILD);
    await waitFor(() => expect(tabs()).toEqual([...tabsThen]));
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 200)); });
    expect(tabs()).toEqual([...tabsThen]);
  });
}
