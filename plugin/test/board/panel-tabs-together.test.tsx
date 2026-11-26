// @vitest-environment jsdom
// The Board tab and the Mail tab on one panel (each has its own rule for when it shows; they meet
// in app/panel/Panel.tsx): the row's order, and which tab an agent's panel opens on when the
// memory was left on Mail for another agent.
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

// ---- one panel, shown for one agent and then for another (bb's side panel is one component: the thread in view changes)
const CHILD = "panel-worktree-helper";
const PARENT = "redesign-ui-lead";
const threadOf = (instance: string): string => panelAgents().find((agent) => agent.instance === instance)?.threadId ?? "";
let showThread: (threadId: string) => void = () => {};
function Shown({ threadId }: { threadId: string }) {
  const [now, setNow] = useState(threadId);
  showThread = setNow;
  return <InstancePanel threadId={now} />;
}
/** Both agents have a messaging id; `boards`: the board of each by its name. */
async function two(boards: Record<string, unknown>) {
  await loadApp();
  const slot = renderSlot<{ threadId: string }, Contract>({ component: Shown }, { threadId: threadOf(CHILD) }, {
    rpc: handlers({
      snapshot: () => panelSnapshot(),
      panelInstance: ({ instance }) => instanceAnswer(instance, (facts) => ({ ...facts, messagingId: `mailspike.test/${instance}` })),
      board: ({ instance }) => ({ at: BOARD_AT, supported: true, board: boards[instance] ?? null, claim: null }),
    }),
    sidebarThreads: panelThreads(),
  });
  const name = () => slot.getByTestId("oats-panel-name").getAttribute("title");
  const shown = () => within(slot.getByRole("tablist", { name: "Instance context" })).getAllByRole("tab").find((tab) => tab.getAttribute("aria-selected") === "true")?.textContent;
  const press = (tab: string) => fireEvent.click(within(slot.getByRole("tablist", { name: "Instance context" })).getByRole("tab", { name: tab }));
  const to = async (instance: string) => {
    act(() => showThread(threadOf(instance)));
    await waitFor(() => expect(name()).toBe(instance));
  };
  const mailReads = () => slot.inspection.rpcCalls.filter((call) => call.method === "mail").length;
  await waitFor(() => expect(name()).toBe(CHILD));
  return { slot, shown, press, to, mailReads };
}
const ASKS = { facts: [], questions: [QUESTION] };
const FACTS = { facts: [FACT], questions: [] };

test("a tab chosen on one agent's panel does not keep ANOTHER agent's panel from opening on Board: the choice is that panel's", async () => {
  const { shown, press, to } = await two({ [CHILD]: ASKS, [PARENT]: ASKS });
  await waitFor(() => expect(shown()).toBe("Board"));
  press("Instance"); // a choice, on the child's panel
  await waitFor(() => expect(shown()).toBe("Instance"));
  await to(PARENT);
  await waitFor(() => expect(shown()).toBe("Board")); // the parent's board asks, and nobody chose a tab on ITS panel
  await to(CHILD);
  await waitFor(() => expect(shown()).toBe("Board")); // and the child's opens anew: it still asks
});

test("opens on Board, is left on Mail, is opened for another agent: in every order, a panel whose board asks opens on Board, one with facts alone on Instance, and mail is read only by a press on that agent's Mail", async () => {
  // A asks, B asks
  let run = await two({ [CHILD]: ASKS, [PARENT]: ASKS });
  await waitFor(() => expect(run.shown()).toBe("Board"));
  run.press("Mail");
  await waitFor(() => expect(run.shown()).toBe("Mail"));
  await waitFor(() => expect(run.mailReads()).toBe(1)); // the child's mail, by the press
  await run.to(PARENT);
  await waitFor(() => expect(run.shown()).toBe("Board"));
  await run.to(CHILD);
  await waitFor(() => expect(run.shown()).toBe("Board")); // not Mail: it takes a press again
  await act(async () => {});
  expect(run.mailReads()).toBe(1);
  resetApp();
  // A asks, B has facts alone
  run = await two({ [CHILD]: ASKS, [PARENT]: FACTS });
  await waitFor(() => expect(run.shown()).toBe("Board"));
  run.press("Mail");
  await waitFor(() => expect(run.shown()).toBe("Mail"));
  await run.to(PARENT);
  await waitFor(() => expect(run.shown()).toBe("Instance"));
  run.press("Board"); // the parent's facts, chosen
  await waitFor(() => expect(run.shown()).toBe("Board"));
  await run.to(CHILD);
  await waitFor(() => expect(run.shown()).toBe("Board"));
  resetApp();
  // A has no board, B asks: the memory left on Mail for A
  run = await two({ [PARENT]: ASKS });
  await waitFor(() => expect(run.shown()).toBe("Instance"));
  run.press("Mail");
  await waitFor(() => expect(run.shown()).toBe("Mail"));
  await run.to(PARENT);
  await waitFor(() => expect(run.shown()).toBe("Board"));
  await run.to(CHILD);
  await waitFor(() => expect(run.shown()).toBe("Instance")); // no board, and Mail takes a press
  await act(async () => {});
  expect(run.mailReads()).toBe(1);
});

test("a board that starts to ask while a person reads the agent's mail does not throw them out of it", async () => {
  let board: unknown = FACTS;
  await loadApp();
  const slot = renderSlot<{ threadId: string }, Contract>({ component: InstancePanel }, { threadId: CHILD_THREAD }, {
    rpc: handlers({
      snapshot: () => panelSnapshot(),
      panelInstance: ({ instance }) => instanceAnswer(instance, (facts) => ({ ...facts, messagingId: `mailspike.test/${instance}` })),
      board: () => ({ at: BOARD_AT, supported: true, board, claim: null }),
    }),
    sidebarThreads: panelThreads(),
  });
  const shown = () => within(slot.getByRole("tablist", { name: "Instance context" })).getAllByRole("tab").find((tab) => tab.getAttribute("aria-selected") === "true")?.textContent;
  await waitFor(() => expect(shown()).toBe("Instance"));
  fireEvent.click(within(slot.getByRole("tablist")).getByRole("tab", { name: "Mail" }));
  await waitFor(() => expect(shown()).toBe("Mail"));
  board = ASKS;
  act(() => slot.behavior.emitRealtime("oats/changed", { at: "2026-11-23T18:17:30.000Z" }));
  await act(async () => void (await new Promise((resolve) => setTimeout(resolve, 80))));
  expect(shown()).toBe("Mail");
});
