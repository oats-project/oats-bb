// @vitest-environment jsdom
// The Board tab and the Mail tab on one panel (each has its own rule for when it is DRAWN; the tab
// SHOWN is the panel's one state: app/panel/tab-state.ts): the row's order, and where an agent's
// panel opens: where it was left, never on a tab of its own choosing.
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
      board: () => ({ at: BOARD_AT, supported: true, stale: false, board, claim: null }),
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

test("left on Mail for another agent: the panel opens on Instance, whether its board asks or holds facts alone (the panel never chooses a tab); it reads no mail", async () => {
  for (const board of [{ facts: [], questions: [QUESTION] }, { facts: [FACT], questions: [] }]) {
    const { slot, tabs } = await panel(board, () => showPanelTab("mail")); // the memory says Mail, pressed for no agent
    await waitFor(() => expect(tabs(), JSON.stringify(board)).toEqual(["Board false", "Instance true", "Soul false", "Mail false"]));
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 100)); });
    expect(tabs()).toEqual(["Board false", "Instance true", "Soul false", "Mail false"]);
    expect(slot.inspection.rpcCalls.map((call) => call.method)).not.toContain("mail");
    resetApp();
  }
});

test("the tabs are a person's: Board by a press, then Mail (this agent's mail), then Board again, then Instance: each press is obeyed and kept", async () => {
  const { slot, tabs } = await panel({ facts: [], questions: [QUESTION] });
  await waitFor(() => expect(tabs()).toEqual(["Board false", "Instance true", "Soul false", "Mail false"]));
  fireEvent.click(within(slot.getByRole("tablist")).getByRole("tab", { name: "Board" }));
  await waitFor(() => expect(tabs()[0]).toBe("Board true"));
  fireEvent.click(within(slot.getByRole("tablist")).getByRole("tab", { name: "Mail" }));
  await waitFor(() => expect(tabs()).toEqual(["Board false", "Instance false", "Soul false", "Mail true"]));
  fireEvent.click(within(slot.getByRole("tablist")).getByRole("tab", { name: "Board" }));
  await waitFor(() => expect(tabs()[0]).toBe("Board true"));
  fireEvent.click(within(slot.getByRole("tablist")).getByRole("tab", { name: "Instance" }));
  await waitFor(() => expect(tabs()[1]).toBe("Instance true"));
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
      board: ({ instance }) => ({ at: BOARD_AT, supported: true, stale: false, board: boards[instance] ?? null, claim: null }),
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

test("the memory is the window's, for every agent: left on Board for one agent, another agent's panel opens on Board where it has a board, on Instance where it has none; left on Instance, both open on Instance though both boards ask", async () => {
  const { shown, press, to } = await two({ [CHILD]: ASKS, [PARENT]: ASKS });
  await waitFor(() => expect(shown()).toBe("Instance")); // the child's board asks: the panel does not open on it by itself
  await to(PARENT);
  await waitFor(() => expect(shown()).toBe("Instance")); // nor the parent's
  press("Board");
  await waitFor(() => expect(shown()).toBe("Board"));
  await to(CHILD);
  await waitFor(() => expect(shown()).toBe("Board")); // where it was left
  resetApp();
  const other = await two({ [CHILD]: ASKS });
  await waitFor(() => expect(other.shown()).toBe("Instance"));
  other.press("Board");
  await waitFor(() => expect(other.shown()).toBe("Board"));
  await other.to(PARENT); // the parent has no board: the tab is not drawn for it
  await waitFor(() => expect(other.shown()).toBe("Instance"));
});

test("left on Mail, opened for another agent, and back, in every order: no panel opens on a tab by itself (whether its board asks or not), and mail is read only by a press on that agent's Mail", async () => {
  for (const boards of [{ [CHILD]: ASKS, [PARENT]: ASKS }, { [CHILD]: ASKS, [PARENT]: FACTS }, { [PARENT]: ASKS }] as Record<string, unknown>[]) {
    const run = await two(boards);
    await waitFor(() => expect(run.shown()).toBe("Instance"));
    run.press("Mail");
    await waitFor(() => expect(run.shown()).toBe("Mail"));
    await waitFor(() => expect(run.mailReads()).toBe(1)); // the child's mail, by the press
    await run.to(PARENT);
    await waitFor(() => expect(run.shown(), JSON.stringify(boards)).toBe("Instance")); // not Mail (pressed for another agent), and not Board
    await run.to(CHILD);
    await waitFor(() => expect(run.shown(), JSON.stringify(boards)).toBe("Instance")); // not Mail: it takes a press again
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 100)); });
    expect(run.shown()).toBe("Instance");
    expect(run.mailReads()).toBe(1);
    resetApp();
  }
});

test("a board that starts to ask while a person reads the agent's mail does not throw them out of it", async () => {
  let board: unknown = FACTS;
  await loadApp();
  const slot = renderSlot<{ threadId: string }, Contract>({ component: InstancePanel }, { threadId: CHILD_THREAD }, {
    rpc: handlers({
      snapshot: () => panelSnapshot(),
      panelInstance: ({ instance }) => instanceAnswer(instance, (facts) => ({ ...facts, messagingId: `mailspike.test/${instance}` })),
      board: () => ({ at: BOARD_AT, supported: true, stale: false, board, claim: null }),
    }),
    sidebarThreads: panelThreads(),
  });
  const shown = () => within(slot.getByRole("tablist", { name: "Instance context" })).getAllByRole("tab").find((tab) => tab.getAttribute("aria-selected") === "true")?.textContent;
  await waitFor(() => expect(shown()).toBe("Instance"));
  fireEvent.click(within(slot.getByRole("tablist")).getByRole("tab", { name: "Mail" }));
  await waitFor(() => expect(shown()).toBe("Mail"));
  board = ASKS;
  await act(async () => {
    slot.behavior.emitRealtime("oats/changed", { at: "2026-11-23T18:17:30.000Z" });
    await new Promise((resolve) => setTimeout(resolve, 80));
  });
  expect(shown()).toBe("Mail");
});

// bb's own second mount: bb 0.50.1 now and then mounts the side panel's content again a moment after it opens (the
// mail developer's measure: 2 opens of 12, at 1280). The SAME agent's panel, Mail pressed, mounted again with the
// instance's read already held: Mail is known to be drawn in the new mount's FIRST draw, so the panel is still on Mail.
test("bb mounts the panel again for the SAME agent a moment after Mail was pressed: it is still on Mail, with no press, and its mail is not read a second time by a tab that left and came back", async () => {
  await loadApp();
  let remount: () => void = () => {};
  function Twice({ threadId }: { threadId: string }) {
    const [mount, setMount] = useState(0);
    remount = () => setMount((count) => count + 1);
    return <InstancePanel key={mount} threadId={threadId} />;
  }
  const slot = renderSlot<{ threadId: string }, Contract>({ component: Twice }, { threadId: CHILD_THREAD }, {
    rpc: handlers({
      snapshot: () => panelSnapshot(),
      panelInstance: ({ instance }) => instanceAnswer(instance, (facts) => ({ ...facts, messagingId: `mailspike.test/${instance}` })),
      board: () => ({ at: BOARD_AT, supported: true, stale: false, board: null, claim: null }),
    }),
    sidebarThreads: panelThreads(),
  });
  const shown = () => within(slot.getByRole("tablist", { name: "Instance context" })).getAllByRole("tab").find((tab) => tab.getAttribute("aria-selected") === "true")?.textContent;
  await slot.findByTestId("oats-panel-header");
  await waitFor(() => expect(within(slot.getByRole("tablist", { name: "Instance context" })).getAllByRole("tab").map((tab) => tab.textContent)).toEqual(["Instance", "Soul", "Mail"]));
  fireEvent.click(within(slot.getByRole("tablist")).getByRole("tab", { name: "Mail" }));
  await waitFor(() => expect(shown()).toBe("Mail"));
  // bb's second mount of the same panel.
  const seen: (string | undefined)[] = [];
  await act(async () => {
    remount();
  });
  seen.push(shown()); // the new mount's first draw that a person can see
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 150)); });
  seen.push(shown());
  expect(seen).toEqual(["Mail", "Mail"]);
});
