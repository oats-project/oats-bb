// @vitest-environment jsdom
// A mount is not always an opening (a fresh reviewer's fourth round, its own proofs kept as tests): bb's query client
// may HOLD a board answer from an earlier visit. That one may be shown; it decides nothing: where the panel opens is
// decided on a read of the board that ENDED SINCE THIS MOUNT.
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
const FACTS = { facts: [FACT], questions: [] };

for (const [what, before, after, wanted] of [
  ["the agent ASKED while its panel was not shown", FACTS, ASKS, "Board"],
  ["the agent CLEARED its question while its panel was not shown", ASKS, FACTS, "Instance"],
] as const) {
  test(`${what}: the panel, shown again, opens by what the board says NOW (${wanted})`, async () => {
    const boards: Record<string, unknown> = { [CHILD]: before };
    await loadApp();
    const slot = renderSlot<{ threadId: string }, Contract>({ component: Shown }, { threadId: threadOf(CHILD) }, {
      rpc: handlers({
        snapshot: () => panelSnapshot(),
        panelInstance: ({ instance }) => instanceAnswer(instance),
        board: ({ instance }) => ({ at: BOARD_AT, supported: true, stale: false, board: boards[instance] ?? null, claim: null }),
      }),
      sidebarThreads: panelThreads(),
    });
    const name = () => slot.getByTestId("oats-panel-name").getAttribute("title");
    const shown = () => within(slot.getByRole("tablist", { name: "Instance context" })).getAllByRole("tab").find((tab) => tab.getAttribute("aria-selected") === "true")?.textContent;
    const to = async (instance: string) => { act(() => showThread(threadOf(instance))); await waitFor(() => expect(name()).toBe(instance)); };
    await waitFor(() => expect(name()).toBe(CHILD));
    await waitFor(() => expect(shown()).toBe(before === ASKS ? "Board" : "Instance"));
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 200)); });
    await to(PARENT);
    boards[CHILD] = after; // the agent changes its board while another agent's panel is shown
    await to(CHILD);
    // The answer held from the first visit decides nothing; the read this mount asks for does, when it ends.
    await waitFor(() => expect(shown()).toBe(wanted));
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 200)); });
    expect(shown()).toBe(wanted);
    const boardCalls = slot.inspection.rpcCalls.filter((call) => call.method === "board" && (call.input as { instance: string }).instance === CHILD).length;
    expect(boardCalls).toBeGreaterThanOrEqual(2); // read again at the mount: no wait for bb's own two seconds
  });
}
