// @vitest-environment jsdom
// A mount is not always an opening (round 4): bb may mount a panel's content TWICE a moment apart. A press made for an
// agent (the thread line's Answer) is good for every mount of that agent's panel within its time.
import { useState } from "react";
import { afterEach, expect, test } from "vitest";
import { act, fireEvent, waitFor, within } from "@testing-library/react";
import { renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { forgetHidden } from "../../app/board";
import { InstancePanel } from "../../app/panel/Panel";
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

for (const remounts of [false, true]) {
  test(`Answer for a claim that is NOT the board's, the panel opened by the press${remounts ? ", then bb mounts the panel a second time" : ""}: Instance`, async () => {
    const app = await loadApp();
    const Row = app.threadHeaderRows[0]!.component;
    const rows = panelAgents().map((agent) => {
      if (agent.instance !== CHILD) return agent;
      const { boardAsks: _asked, ...row } = agent;
      return { ...row, hasBoard: true as const, waiting: { reason: "attention", message: "The deploy key expired: give me a new one", since: "2026-11-23T18:05:00.000Z" } };
    });
    type Props = { threadId: string; projectId: string; environment: null };
    let withPanel = false;
    let mount = 0;
    let rerender: () => void = () => {};
    const Both = (props: Props) => {
      const [, set] = useState(0);
      rerender = () => set((n: number) => n + 1);
      return (<><Row {...props} />{withPanel ? <InstancePanel key={mount} threadId={props.threadId} /> : null}</>);
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
    fireEvent.click(answer);
    withPanel = true;
    await act(async () => rerender());
    await slot.findByTestId("oats-panel-header", {}, { timeout: 4000 });
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 300)); });
    const seen = [selected(slot)];
    if (remounts) {
      mount = 1; // bb's second mount of the same panel, a moment after it opened
      await act(async () => rerender());
      await act(async () => { await new Promise((resolve) => setTimeout(resolve, 300)); });
      seen.push(selected(slot));
    }
    expect(seen).toEqual(remounts ? ["Instance", "Instance"] : ["Instance"]);
  });
}
