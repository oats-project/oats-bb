// @vitest-environment jsdom
// The panel's tabs, as a person meets them (the rule: app/panel/tab-state.ts; its table:
// test/panel/tab-state.test.ts). EVERY AGENT's PANEL HAS THE FOUR TABS, ALWAYS: Board, Instance,
// Soul, Mail; a tab with nothing behind it says so. THE PANEL NEVER CHOOSES A TAB BY ITSELF: it
// opens where it was left, and only a press moves it. Whatever bb mounts twice shows the same
// tab twice. The paths the board's four review rounds and its two delta reads found are here,
// each as what a person sees now.
import { useState } from "react";
import { afterEach, expect, test, vi } from "vitest";
import { act, fireEvent, waitFor, within } from "@testing-library/react";
import { renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { forgetHidden } from "../../app/board";
import { InstancePanel, showPanelTab } from "../../app/panel/Panel";
import { FRESH_MS } from "../../app/ui/words";
import { handlers, loadApp, resetApp } from "../helpers/render";
import type { Contract, Handlers } from "../helpers/render";
import { instanceAnswer, panelAgents, panelSnapshot, panelThreads } from "../panel/handlers";
import { BOARD_AT } from "./handlers";

afterEach(() => {
  vi.useRealTimers();
  resetApp();
  forgetHidden();
});

const CHILD = "panel-worktree-helper";
const PARENT = "redesign-ui-lead";
const FOUR = ["Board", "Instance", "Soul", "Mail"];
const FACT = { key: "tests", label: "Tests", value: "3", unit: "failing", link: null, at: "2026-11-23T18:00:58.766Z" };
const QUESTION = { id: "q3", question: "Which base branch?", options: ["main: the default", "release: the 0.1 line"], hasContext: false, since: "2026-11-23T18:01:45.724Z" };
const ASKS = { facts: [], questions: [QUESTION] };
const FACTS = { facts: [FACT], questions: [] };
const threadOf = (instance: string): string => panelAgents().find((agent) => agent.instance === instance)?.threadId ?? "";

// The panel as bb holds it: a thread that changes, a mount that may be made anew (`mount`: bb mounts a panel's
// content twice now and then), a panel that may be closed (`null`).
type Showing = { threadId: string | null; mount: number; /** another agent's panel mounted beside it, by its name (an agent's page) */ other?: string | null };
let show: (next: Showing) => void = () => {};
function Shown({ threadId }: { threadId: string }) {
  const [now, setNow] = useState<Showing>({ threadId, mount: 0 });
  show = setNow;
  return (
    <>
      <div data-testid="first">{now.threadId === null ? null : <InstancePanel key={now.mount} threadId={now.threadId} />}</div>
      <div data-testid="second">{now.other == null ? null : <InstancePanel instance={now.other} />}</div>
    </>
  );
}
type Which = "first" | "second";

/** `boards`: each agent's board by its name, as it is NOW (a test changes it and calls `changed`); `messaging`: the agents with a messaging id. */
async function panel({ boards = {}, messaging = [CHILD, PARENT], over = {}, before = () => {} }: { boards?: Record<string, unknown>; messaging?: readonly string[]; over?: Partial<Handlers>; before?: () => void } = {}) {
  await loadApp();
  before();
  const slot = renderSlot<{ threadId: string }, Contract>({ component: Shown }, { threadId: threadOf(CHILD) }, {
    rpc: handlers({
      snapshot: () => panelSnapshot(),
      panelInstance: ({ instance }) => instanceAnswer(instance, (facts) => ({ ...facts, messagingId: messaging.includes(instance) ? `mailspike.test/${instance}` : null })),
      board: ({ instance }) => ({ at: BOARD_AT, supported: true, stale: false, board: boards[instance] ?? null, claim: null }),
      ...over,
    }),
    sidebarThreads: panelThreads(),
  });
  const root = (which: Which) => within(slot.getByTestId(which));
  const list = (which: Which = "first") => within(root(which).getByRole("tablist", { name: "Instance context" })).getAllByRole("tab");
  const tabs = (which: Which = "first") => list(which).map((tab) => tab.textContent);
  const shown = (which: Which = "first") => list(which).find((tab) => tab.getAttribute("aria-selected") === "true")?.textContent;
  const press = (tab: string, which: Which = "first") => fireEvent.click(within(root(which).getByRole("tablist", { name: "Instance context" })).getByRole("tab", { name: tab }));
  const name = (which: Which = "first") => root(which).getByTestId("oats-panel-name").getAttribute("title");
  const to = async (instance: string, mount = 0) => {
    act(() => show({ threadId: threadOf(instance), mount }));
    await waitFor(() => expect(name()).toBe(instance));
  };
  const changed = () =>
    act(async () => {
      slot.behavior.emitRealtime("oats/changed", { at: "2026-11-23T18:17:30.000Z" });
      await new Promise((resolve) => setTimeout(resolve, 150));
    });
  const wait = (ms = 150) => act(async () => { await new Promise((resolve) => setTimeout(resolve, ms)); });
  const calls = (method: string, instance?: string) => slot.inspection.rpcCalls.filter((call) => call.method === method && (instance === undefined || (call.input as { instance?: string } | null)?.instance === instance)).length;
  await waitFor(() => expect(name()).toBe(CHILD));
  return { slot, tabs, shown, press, to, changed, wait, calls, name, page: () => root("first").getByRole("tabpanel") };
}

// ---- the four tabs, always
test("every agent's panel has the four tabs, in one order, from its first draw: an agent with a board and mail, and one with neither", async () => {
  const { tabs, shown, to } = await panel({ boards: { [CHILD]: ASKS }, messaging: [CHILD] });
  expect([tabs(), shown()]).toEqual([FOUR, "Instance"]); // at once: nothing about a tab waits for a read
  await to(PARENT); // no board, no messaging id
  expect([tabs(), shown()]).toEqual([FOUR, "Instance"]);
});

test("a tab with nothing behind it says so: Board with no fact and no question: \"No questions.\", alone; Mail for an agent with no messaging layer: \"No messaging.\", from the row alone: no mail is read", async () => {
  const { press, page, calls, wait } = await panel({ messaging: [] });
  press("Board");
  await waitFor(() => expect(page().textContent).toBe("No questions."));
  press("Mail");
  await waitFor(() => expect(page().textContent).toBe("No messaging."));
  await wait();
  expect(calls("mail")).toBe(0);
});

test("an agent with facts and no question shows its facts, and no line; one whose board cannot be shown says what could not be read, on its Board tab (never by the board's silence)", async () => {
  const facts = await panel({ boards: { [CHILD]: FACTS } });
  facts.press("Board");
  await waitFor(() => expect(within(facts.page()).getAllByTestId("oats-board-fact")).toHaveLength(1));
  expect(facts.page().textContent).not.toMatch(/No questions/);
  resetApp();
  for (const [board, said] of [
    ["not a board", "This agent's board could not be read."],
    [{ facts: [{ key: "BAD KEY", label: "x", value: "y", at: "2026-11-23T18:00:58.766Z" }], questions: [{ id: "q1", question: "Which?", options: ["one"], since: "2026-11-23T18:00:58.766Z" }] }, "2 entries of this agent's board could not be shown."],
  ] as const) {
    const run = await panel({ boards: { [CHILD]: board } });
    run.press("Board");
    await waitFor(() => expect(run.page().textContent, JSON.stringify(board)).toBe(said));
    resetApp();
  }
});

test("a board whose read FAILS: its tab says so, with Retry; a kernel that sends no board: its tab says that", async () => {
  let fail = true;
  const failing = await panel({ over: { board: (() => { if (fail) throw new Error("The OATS roster is being read again: try once more."); return { at: BOARD_AT, supported: true, stale: false, board: ASKS, claim: null }; }) as never } });
  failing.press("Board");
  await waitFor(() => expect(within(failing.page()).getByTestId("oats-board-retry")).toBeTruthy());
  expect(failing.page().textContent).toMatch(/^This agent's board could not be read\./);
  fail = false;
  fireEvent.click(within(failing.page()).getByTestId("oats-board-retry"));
  await waitFor(() => expect(within(failing.page()).getByTestId("oats-board-question").textContent).toBe("Which base branch?"));
  resetApp();
  const old = await panel({ over: { board: () => ({ at: BOARD_AT, supported: false, stale: false, board: null, claim: null }) } });
  old.press("Board");
  await waitFor(() => expect(old.page().textContent).toBe("This OATS sends no board."));
});

test("the instance's read FAILED (whether the agent has mail is not known): the Mail tab draws neither the mail's view (no read for an agent not known to have mail) nor \"No messaging.\" (not known is not none): the panel's own notice of a read that failed, with Retry (the mail developer's case)", async () => {
  let fail = true;
  const { press, page, calls, wait } = await panel({ over: { panelInstance: (({ instance }: { instance: string }) => { if (fail) throw new Error("E_HOME_MISSING: no such home"); return instanceAnswer(instance, (facts) => ({ ...facts, messagingId: `mailspike.test/${instance}` })); }) as never } });
  press("Mail");
  await waitFor(() => expect(within(page()).getByRole("button", { name: "Retry" })).toBeTruthy());
  expect(page().textContent).not.toMatch(/No messaging/);
  // The quiet line is only for a tab that would be EMPTY: here the panel's own notice stands, with its Retry.
  expect(page().textContent).not.toMatch(/Mail can't be read/);
  expect(page().querySelector('[data-testid="oats-mail"]')).toBeNull();
  await wait();
  expect(calls("mail")).toBe(0);
  // Read again, and it answers: the agent has mail to read, and its view reads it (the tab is the one a person left it on).
  fail = false;
  fireEvent.click(within(page()).getByRole("button", { name: "Retry" }));
  await waitFor(() => expect(calls("mail")).toBe(1));
});

test("beside a thread, the roster the last one read AND the instance never read: the Mail tab is not empty: \"Mail can't be read.\", quietly, with no second Retry (the thread's own line has the one; the second delta read's proof)", async () => {
  let down = false;
  const { press, page, changed, shown } = await panel({
    over: {
      snapshot: (() => (down ? { ok: false as const, at: "2026-11-23T18:16:26.000Z", code: "OATS_TIMEOUT", message: "`oats` did not answer", machine: null, last: panelSnapshot() } : panelSnapshot())) as never,
      panelInstance: (() => { throw new Error("E_HOME_MISSING: no such home"); }) as never,
    },
  });
  press("Mail");
  await waitFor(() => expect(within(page()).getByRole("button", { name: "Retry" })).toBeTruthy()); // the roster reads: the panel's own notice
  down = true;
  await changed();
  await waitFor(() => expect(page().textContent).toBe("Mail can't be read."));
  expect([shown(), page().querySelectorAll("button").length]).toEqual(["Mail", 0]);
});

test("on an agent's PAGE the Mail tab never says the quiet line: the page's own notice says what could not be read, with its Retry (the roster read again or not)", async () => {
  let down = false;
  const { slot, press, changed, name } = await panel({
    over: {
      snapshot: (() => (down ? { ok: false as const, at: "2026-11-23T18:16:26.000Z", code: "OATS_TIMEOUT", message: "`oats` did not answer", machine: null, last: panelSnapshot() } : panelSnapshot())) as never,
      panelInstance: (() => { throw new Error("E_HOME_MISSING: no such home"); }) as never,
    },
  });
  act(() => show({ threadId: null, mount: 0, other: PARENT }));
  await waitFor(() => expect(name("second")).toBe(PARENT));
  press("Mail", "second");
  const page = () => within(slot.getByTestId("second")).getByRole("tabpanel");
  await waitFor(() => expect(within(page()).getByRole("button", { name: "Retry" })).toBeTruthy());
  expect(page().textContent).not.toMatch(/Mail can't be read/);
  down = true;
  await changed();
  expect(within(page()).getByRole("button", { name: "Retry" })).toBeTruthy();
  expect(page().textContent).not.toMatch(/Mail can't be read/);
});

// ---- the panel never chooses a tab by itself
test("the panel of an agent whose board ASKS opens where it was left (Instance), not on Board; Board is one press away, and a chosen tab stays (round 1, the cut)", async () => {
  const { shown, press, page, wait } = await panel({ boards: { [CHILD]: ASKS } });
  await wait();
  expect(shown()).toBe("Instance");
  press("Board");
  await waitFor(() => expect(within(page()).getByTestId("oats-board-question").textContent).toBe("Which base branch?"));
  await wait();
  expect(shown()).toBe("Board");
});

test("IT DOES NOT MOVE under a reader: the agent asks while the panel is on Instance; clears its question, then its last fact, while it is on Board; asks again: the tab shown is the one a person left it on, each time (rounds 1, 3, 4)", async () => {
  const boards: Record<string, unknown> = { [CHILD]: FACTS };
  const { shown, press, page, changed } = await panel({ boards });
  expect(shown()).toBe("Instance");
  boards[CHILD] = { facts: [FACT], questions: [QUESTION] };
  await changed();
  expect(shown()).toBe("Instance"); // the agent asked: the thread's own line says so, the panel stays
  press("Board");
  await waitFor(() => expect(within(page()).getByTestId("oats-board-question")).toBeTruthy());
  boards[CHILD] = FACTS;
  await changed();
  expect(shown()).toBe("Board"); // cleared: the facts stay under the person's eyes
  boards[CHILD] = { facts: [], questions: [] };
  await changed();
  expect([shown(), page().textContent]).toEqual(["Board", "No questions."]); // the tab does not go: nothing falls
  boards[CHILD] = ASKS;
  await changed();
  expect(shown()).toBe("Board");
  await waitFor(() => expect(within(page()).getByTestId("oats-board-question").textContent).toBe("Which base branch?"));
});

test("a board that starts to ask while a person reads the agent's mail does not throw them out of it (round 1)", async () => {
  const boards: Record<string, unknown> = { [CHILD]: FACTS };
  const { shown, press, changed } = await panel({ boards });
  press("Mail");
  await waitFor(() => expect(shown()).toBe("Mail"));
  boards[CHILD] = ASKS;
  await changed();
  expect(shown()).toBe("Mail");
});

// ---- a press from another feature writes the window, as a tab does
test("another feature that turns the panel to a tab (the thread line's Answer, the palette's Board: a press) is obeyed, also where it names the tab the memory already holds; and the header's soul link (round 2)", async () => {
  const { slot, shown, press } = await panel({ boards: { [CHILD]: ASKS }, before: () => showPanelTab("soul") });
  expect(shown()).toBe("Soul"); // where it was left
  press("Board");
  await waitFor(() => expect(shown()).toBe("Board"));
  fireEvent.click(slot.getByTestId("oats-panel-soul-link")); // it names Soul, which the memory held before the press on Board
  await waitFor(() => expect(shown()).toBe("Soul"));
  act(() => showPanelTab("board"));
  await waitFor(() => expect(shown()).toBe("Board"));
  act(() => showPanelTab("board")); // the memory holds it already: still a press, and nothing breaks
  await waitFor(() => expect(shown()).toBe("Board"));
});

// ---- the memory is the window's
test("the memory is the window's, for every agent: left on Board, another agent's panel opens on Board (and says \"No questions.\" where it has none); left on Soul, on Soul; left on Instance, on Instance though both boards ask", async () => {
  const { shown, press, to, page } = await panel({ boards: { [CHILD]: ASKS } });
  expect(shown()).toBe("Instance");
  await to(PARENT);
  expect(shown()).toBe("Instance");
  await to(CHILD);
  press("Board");
  await waitFor(() => expect(shown()).toBe("Board"));
  await to(PARENT);
  expect(shown()).toBe("Board");
  await waitFor(() => expect(page().textContent).toBe("No questions."));
  press("Soul");
  await to(CHILD);
  expect(shown()).toBe("Soul");
});

// ---- Mail: read only by a press on THAT agent's tab
test("left on Mail, opened for another agent, and back, whatever the boards say: the other agent's panel opens on Instance and reads no mail (its own takes a press on ITS tab); back at the first: MAIL, as a person left it (no mount drops Mail's marker)", async () => {
  for (const boards of [{ [CHILD]: ASKS, [PARENT]: ASKS }, { [CHILD]: ASKS, [PARENT]: FACTS }, { [PARENT]: ASKS }, {}] as Record<string, unknown>[]) {
    const { shown, press, to, calls, wait } = await panel({ boards });
    press("Mail");
    await waitFor(() => expect(shown()).toBe("Mail"));
    await waitFor(() => expect(calls("mail", CHILD)).toBe(1)); // the child's mail, by the press
    await to(PARENT);
    expect(shown(), JSON.stringify(boards)).toBe("Instance");
    await wait();
    expect(calls("mail", PARENT)).toBe(0);
    await to(CHILD);
    expect(shown(), JSON.stringify(boards)).toBe("Mail");
    await wait();
    expect(calls("mail", PARENT)).toBe(0);
    resetApp();
  }
});

test("a press on ANOTHER agent's Mail replaces the marker: back at the first agent, Instance: its mail takes a press on its own tab again", async () => {
  const { shown, press, to, calls, wait } = await panel();
  press("Mail");
  await waitFor(() => expect(calls("mail", CHILD)).toBe(1));
  await to(PARENT);
  press("Mail");
  await waitFor(() => expect(calls("mail", PARENT)).toBe(1));
  await to(CHILD);
  expect(shown()).toBe("Instance");
  await wait();
  expect(calls("mail", CHILD)).toBe(1);
});

// ---- two agents' panels mounted AT ONCE (bb keeps a thread's tab mounted while it is hidden; the panel is also an agent's page)
test("two agents' panels mounted at once: ONE press on one agent's Mail shows Mail in THAT panel alone: the other is on Instance, and its mail is not read (the second delta read's proof)", async () => {
  const { shown, press, wait, calls, name } = await panel();
  act(() => show({ threadId: threadOf(CHILD), mount: 0, other: PARENT }));
  await waitFor(() => expect(name("second")).toBe(PARENT));
  expect([shown("first"), shown("second")]).toEqual(["Instance", "Instance"]);
  press("Mail", "first");
  await waitFor(() => expect(shown("first")).toBe("Mail"));
  await wait(300);
  expect([shown("second"), calls("mail", CHILD), calls("mail", PARENT)]).toEqual(["Instance", 1, 0]);
  // A press on Soul is the window's: both panels turn to it (it reads nothing of another agent).
  press("Soul", "first");
  await waitFor(() => expect([shown("first"), shown("second")]).toEqual(["Soul", "Soul"]));
  // A press on the OTHER panel's Mail: that one shows Mail, and the first shows what its mount would: Instance.
  press("Mail", "second");
  await waitFor(() => expect([shown("first"), shown("second")]).toEqual(["Instance", "Mail"]));
});

test("two agents' panels mounted at once: WHAT A PANEL SHOWS IS WHAT ITS NEXT MOUNT SHOWS, after every press on either panel (the third delta read's proof: Board, then the other's Mail, then bb's second mount: Board fell to Instance with no press)", async () => {
  const { shown, press, wait, name } = await panel();
  act(() => show({ threadId: threadOf(CHILD), mount: 0, other: PARENT }));
  await waitFor(() => expect(name("second")).toBe(PARENT));
  let mount = 0;
  for (const [tab, which] of [["Board", "first"], ["Mail", "second"], ["Mail", "first"], ["Soul", "second"], ["Mail", "first"], ["Mail", "second"], ["Mail", "second"], ["Instance", "first"]] as const) {
    press(tab, which);
    await wait(50);
    const before = [shown("first"), shown("second")];
    expect(before[which === "first" ? 0 : 1], `${tab} on the ${which}`).toBe(tab);
    if (tab === "Mail") expect(before[which === "first" ? 1 : 0], `${tab} on the ${which}: the other`).toBe("Instance");
    else expect(before, `${tab} on the ${which}`).toEqual([tab, tab]);
    mount += 1;
    act(() => show({ threadId: threadOf(CHILD), mount, other: PARENT })); // bb mounts the first again
    await wait(50);
    expect([shown("first"), shown("second")], `${tab} on the ${which}, the first mounted again`).toEqual(before);
  }
});

test("two agents' panels mounted at once: one on Mail; the other's panel mounts beside it; bb mounts the first again: Mail, Mail: nothing drops the marker (the second delta read's proof)", async () => {
  const { shown, press, wait, calls, name } = await panel();
  press("Mail");
  await waitFor(() => expect(calls("mail", CHILD)).toBe(1));
  act(() => show({ threadId: threadOf(CHILD), mount: 0, other: PARENT }));
  await waitFor(() => expect(name("second")).toBe(PARENT));
  await wait(300);
  const seen = [shown("first")];
  act(() => show({ threadId: threadOf(CHILD), mount: 1, other: PARENT }));
  await wait(300);
  seen.push(shown("first"));
  expect(seen).toEqual(["Mail", "Mail"]);
  expect([shown("second"), calls("mail", PARENT)]).toEqual(["Instance", 0]);
});

// ---- whatever bb mounts twice shows the same tab twice
test("TWO MOUNTS, THE SAME TAB TWICE, for every tab a person left the panel on: Instance, Board, Soul and Mail (round 4; the mail developer's case)", async () => {
  for (const tab of FOUR) {
    const { shown, press, to, wait } = await panel({ boards: { [CHILD]: ASKS } });
    if (tab !== "Instance") press(tab);
    await waitFor(() => expect(shown()).toBe(tab));
    const seen: (string | undefined)[] = [];
    await to(CHILD, 1); // bb's second mount of the same panel
    seen.push(shown());
    await wait();
    seen.push(shown());
    expect(seen, tab).toEqual([tab, tab]);
    resetApp();
  }
});

test("two mounts, the same tab twice, MAIL: left on Mail, the panel closed, bb no longer holding the instance's read; opened again and mounted twice: Mail, Mail (the delta read's proof: it showed Instance, then Mail by itself)", async () => {
  const { slot, shown, press, wait } = await panel();
  press("Mail");
  await waitFor(() => expect(shown()).toBe("Mail"));
  act(() => show({ threadId: null, mount: 0 })); // the panel is closed
  await act(async () => {
    // bb's query client drops what it held for the closed panel.
    await slot.behavior.experimental_invalidateRpc(null);
  });
  const seen: (string | undefined)[] = [];
  act(() => show({ threadId: threadOf(CHILD), mount: 1 }));
  await waitFor(() => expect(slot.getByTestId("oats-panel-name").getAttribute("title")).toBe(CHILD));
  seen.push(shown());
  await wait(300);
  seen.push(shown());
  act(() => show({ threadId: threadOf(CHILD), mount: 2 })); // bb's second mount
  await wait(300);
  seen.push(shown());
  expect(seen).toEqual(["Mail", "Mail", "Mail"]);
});

test("two mounts, the same tab twice, BOARD: the memory on Board (a press), the roster's row says the agent has a board, the board's own read says none: Board, Board, saying \"No questions.\" (the delta read's proof: it showed Instance, Board, Instance)", async () => {
  const { shown, press, to, wait, page } = await panel({ boards: {} }); // (the recorded row of the child says it has a board)
  press("Board");
  await waitFor(() => expect(page().textContent).toBe("No questions."));
  const seen: (string | undefined)[] = [shown()];
  await to(CHILD, 1);
  seen.push(shown());
  await wait(300);
  seen.push(shown());
  expect(seen).toEqual(["Board", "Board", "Board"]);
  expect(page().textContent).toBe("No questions.");
});

test("an answer bb HOLDS from an earlier showing decides nothing about the tab: the agent asked, or cleared its board, while another agent's panel was shown: its panel, shown again, is on the tab it was left on (round 4)", async () => {
  for (const [before, after] of [[null, ASKS], [ASKS, null]] as const) {
    const boards: Record<string, unknown> = { [CHILD]: before };
    const { shown, to, changed, wait } = await panel({ boards });
    await wait();
    await to(PARENT);
    boards[CHILD] = after;
    await changed();
    await to(CHILD);
    await wait(300);
    expect(shown(), JSON.stringify(after)).toBe("Instance");
    resetApp();
  }
});

// ---- the one way to a question is a person's press: the thread's own line
test("the agent asks while its panel is open on Instance: the panel stays; the thread's line says so with Answer, and Answer turns the panel to Board, the focus on the question's zone (never on an option)", async () => {
  const app = await loadApp();
  const Row = app.threadHeaderRows[0]!.component;
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
    { threadId: threadOf(CHILD), projectId: "p", environment: null },
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
  await waitFor(() => expect(within(slot.getByRole("tablist", { name: "Instance context" })).getAllByRole("tab").map((tab) => tab.textContent)).toEqual(FOUR));
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

test("Answer for a claim that is NOT the board's, with the panel open on Board (a person's press: the agent's board holds a question too): it leads to Instance, where Needs input is, not to the board's question (round 2, major)", async () => {
  const app = await loadApp();
  const Row = app.threadHeaderRows[0]!.component;
  const rows = panelAgents().map((agent) => {
    if (agent.instance !== CHILD) return agent;
    const { boardAsks: _asked, ...row } = agent;
    return { ...row, hasBoard: true as const, waiting: { reason: "attention", message: "The deploy key expired: give me a new one", since: "2026-11-23T18:05:00.000Z" } };
  });
  type Props = { threadId: string; projectId: string; environment: null };
  const slot = renderSlot<Props, Contract>(
    { component: (props: Props) => (<><Row {...props} /><InstancePanel threadId={props.threadId} /></>) } as never,
    { threadId: threadOf(CHILD), projectId: "p", environment: null },
    {
      rpc: handlers({
        snapshot: () => panelSnapshot(rows),
        panelInstance: ({ instance }) => instanceAnswer(instance),
        board: () => ({ at: BOARD_AT, supported: true, stale: false, board: { facts: [FACT], questions: [QUESTION] }, claim: { producer: "agent", reason: "attention" } }),
      }),
      sidebarThreads: panelThreads(),
      sdk: { threads: { interactions: { list: async () => [] } } } as never,
    },
  );
  const shown = () => within(slot.getByRole("tablist", { name: "Instance context" })).getAllByRole("tab").find((tab) => tab.getAttribute("aria-selected") === "true")?.textContent;
  const answer = await waitFor(() => {
    const button = slot.getByTestId("oats-status-act");
    expect(button.textContent).toBe("Answer");
    return button;
  }, { timeout: 4000 });
  fireEvent.click(within(slot.getByRole("tablist", { name: "Instance context" })).getByRole("tab", { name: "Board" }));
  await waitFor(() => expect(shown()).toBe("Board"));
  fireEvent.click(answer); // it asks for Instance, which the window's memory may already hold: a press all the same
  await waitFor(() => expect(shown()).toBe("Instance"));
  await waitFor(() => expect(slot.getByTestId("oats-panel-waiting").contains(document.activeElement)).toBe(true));
});

// ---- THE ONE PLACE WHERE MAIL IS READ WITH NO NEW PRESS (the mail's owner's edge): an agent's panel left on Mail
// opens on Mail again, and the mail's view reads nothing while what it holds is fresh (FRESH_MS, app/ui/words.ts).
test("A's panel left on Mail, B's shown with no press on B's Mail, A's shown again: INSIDE the minute: Mail, and no second read of A's mail; AFTER the minute: Mail, and exactly one more read, of A, none of B", async () => {
  const NOW = Date.parse("2026-11-25T12:15:00.000Z");
  vi.useFakeTimers({ now: NOW, toFake: ["Date"] });
  const { shown, press, to, calls, wait } = await panel();
  press("Mail");
  await waitFor(() => expect(calls("mail", CHILD)).toBe(1)); // by the press
  await wait();
  // Inside the minute, twice (bb's second mount of A among them): shown as it is held.
  for (const [at, mount] of [[NOW + 1_000, 1], [NOW + FRESH_MS - 1, 2]] as const) {
    await to(PARENT);
    expect(shown()).toBe("Instance");
    vi.setSystemTime(at);
    await to(CHILD, mount);
    expect(shown()).toBe("Mail");
    await wait();
    expect([calls("mail", CHILD), calls("mail", PARENT)], `at ${at - NOW} ms`).toEqual([1, 0]);
  }
  // At the minute: what is held is old: one read behind it, of A.
  await to(PARENT);
  vi.setSystemTime(NOW + FRESH_MS);
  await to(CHILD, 3);
  expect(shown()).toBe("Mail");
  await waitFor(() => expect(calls("mail", CHILD)).toBe(2));
  await wait();
  expect([calls("mail", CHILD), calls("mail", PARENT)]).toEqual([2, 0]);
});
