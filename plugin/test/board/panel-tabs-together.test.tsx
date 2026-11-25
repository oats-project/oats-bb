// @vitest-environment jsdom
// The Board tab and the Mail tab on one panel (each has its own rule for when it shows; they meet
// in app/panel/Panel.tsx): the row's order, and which tab an agent's panel opens on when the
// memory was left on Mail for another agent.
import { afterEach, expect, test } from "vitest";
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
});

const CHILD_THREAD = "thr_u2jw8887aw";
const FACT = { key: "tests", label: "Tests", value: "3", unit: "failing", link: null, at: "2026-11-23T18:00:58.766Z" };
const QUESTION = { id: "q3", question: "Which base branch?", options: ["main: the default", "release: the 0.1 line"], hasContext: false, since: "2026-11-23T18:01:45.724Z" };

async function panel(board: unknown, before: () => void = () => {}) {
  await loadApp();
  before();
  const agents = panelAgents();
  const slot = renderSlot<{ threadId: string }, Contract>({ component: InstancePanel }, { threadId: CHILD_THREAD }, {
    rpc: handlers({
      snapshot: () => panelSnapshot(agents),
      panelInstance: ({ instance }) => instanceAnswer(instance, (facts) => ({ ...facts, messagingId: `mailspike.test/${instance}` })),
      board: () => ({ at: BOARD_AT, supported: true, board, claim: null }),
    }),
    sidebarThreads: panelThreads(agents),
  });
  await slot.findByTestId("oats-panel-header");
  const tabs = () => within(slot.getByRole("tablist", { name: "Instance context" })).getAllByRole("tab").map((tab) => `${tab.textContent} ${tab.getAttribute("aria-selected")}`);
  return { slot, tabs };
}

test("an agent with a board and a messaging id: Board, Instance, Soul, Mail, in that order", async () => {
  const { tabs } = await panel({ facts: [FACT], questions: [] });
  await waitFor(() => expect(tabs()).toEqual(["Board false", "Instance true", "Soul false", "Mail false"]));
});

test("left on Mail for another agent: a panel whose board asks opens on Board, one whose board has facts alone on Instance; neither reads mail", async () => {
  for (const [board, wanted] of [[{ facts: [], questions: [QUESTION] }, "Board true"], [{ facts: [FACT], questions: [] }, "Instance true"]] as const) {
    const { slot, tabs } = await panel(board, () => showPanelTab("mail")); // the memory says Mail, pressed for no agent
    await waitFor(() => expect(tabs().find((tab) => tab.endsWith("true")), JSON.stringify(board)).toBe(wanted));
    await act(async () => {});
    expect(tabs().find((tab) => tab.endsWith("true"))).toBe(wanted); // and it stays there once the memory has left Mail
    expect(slot.inspection.rpcCalls.map((call) => call.method)).not.toContain("mail");
    resetApp();
  }
});

test("on a panel that opened on Board, a press on Mail shows this agent's mail, and a press on Board comes back", async () => {
  const { slot, tabs } = await panel({ facts: [], questions: [QUESTION] });
  await waitFor(() => expect(tabs()[0]).toBe("Board true"));
  fireEvent.click(within(slot.getByRole("tablist")).getByRole("tab", { name: "Mail" }));
  await waitFor(() => expect(tabs()).toEqual(["Board false", "Instance false", "Soul false", "Mail true"]));
  fireEvent.click(within(slot.getByRole("tablist")).getByRole("tab", { name: "Board" }));
  await waitFor(() => expect(tabs()[0]).toBe("Board true"));
  fireEvent.click(within(slot.getByRole("tablist")).getByRole("tab", { name: "Instance" }));
  await waitFor(() => expect(tabs()[1]).toBe("Instance true")); // a chosen tab is kept: the panel no longer opens by itself
});
