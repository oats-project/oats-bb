// @vitest-environment jsdom
// A question of the board is ONE thing to a person: the home's needs-you card of an agent whose
// board asks draws THAT question, by the board's own component and its own answer path, in place
// of the claim's text and the free reply. A card of any other claim is as before.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, expect, test, vi } from "vitest";
import { act, fireEvent, waitFor, within } from "@testing-library/react";
import { renderSlot } from "@get-bb/plugin-sdk/testing/app";
import type { RenderSlotOptions } from "@get-bb/plugin-sdk/testing/app";
import { forgetHidden } from "../../app/board";
import { parseStatus } from "../../kernel/roster";
import type { Agent } from "../../model/types";
import { fixtureAgents } from "../helpers/fixtures";
import { handlers, loadApp, resetApp, sidebarThreads } from "../helpers/render";
import type { Contract } from "../helpers/render";
import { BOARD_AT } from "./handlers";

afterEach(() => {
  resetApp();
  forgetHidden();
  vi.useRealTimers();
});

const ASKS = "ranker-v3-probe"; // the pinned roster's agent that waits with a claim, on a bb thread
const QUESTION = { id: "q3", question: "Which base branch?", options: ["main: the default", "release: the 0.1 line"], hasContext: false, since: "2026-11-23T18:01:45.724Z" };

async function home(change: Partial<Agent>, board: unknown = { facts: [], questions: [QUESTION] }) {
  const app = await loadApp();
  const panel = app.navPanels.find((candidate) => candidate.id === "home")!;
  const agents = fixtureAgents().map((agent): Agent => (agent.instance === ASKS ? { ...agent, ...change } : agent));
  const sent: { threadId: string; text: string }[] = [];
  const slot = renderSlot<{ subPath: string }, Contract>(panel, { subPath: "" }, {
    rpc: handlers({ board: () => ({ at: BOARD_AT, supported: true, board, claim: { producer: "oats.board", reason: "attention" } }) }, agents),
    sidebarThreads: sidebarThreads(),
    sdk: { threads: { interactions: { list: async () => [] }, send: async ({ threadId, input }: { threadId: string; input: { text: string }[] }) => (sent.push({ threadId, text: input.map((part) => part.text).join("") }), { ok: true }) } } as never as RenderSlotOptions<Contract>["sdk"],
  });
  const card = (await slot.findAllByTestId("oats-needs-card")).find((each) => each.dataset.instance === ASKS)!;
  return { slot, card, sent };
}

test("the roster's row says that an agent's board asks, from the kernel's own row (recorded), and only on a kernel that reports boards", () => {
  const recorded = JSON.parse(readFileSync(join(__dirname, "..", "fixtures", "panel", "status-board.json"), "utf8")) as { features?: string[] };
  const read = parseStatus(recorded);
  if (!read.ok) throw new Error(read.error.message);
  expect(read.value.agents.filter((agent) => agent.boardAsks === true).map((agent) => agent.instance)).toEqual(["panel-worktree-helper"]);
  expect(read.value.agents.filter((agent) => agent.boardAsks !== true).every((agent) => !("boardAsks" in agent))).toBe(true); // true, or absent
  const old = parseStatus({ ...recorded, features: (recorded.features ?? []).filter((feature) => feature !== "instance-board") });
  if (!old.ok) throw new Error(old.error.message);
  expect(old.value.agents.some((agent) => agent.boardAsks === true)).toBe(false);
});

test("the card of an agent whose board asks draws the QUESTION with its options, in place of the claim's text and the reply; a press sends the answer, and the card says \"Sent.\"", async () => {
  const { card, sent } = await home({ boardAsks: true, waiting: { reason: "attention", message: "Which base branch?", since: "2026-11-23T18:01:45.726Z" } });
  const zone = await within(card).findByTestId("oats-board-questions");
  expect(within(zone).getByTestId("oats-board-question").textContent).toBe("Which base branch?");
  expect(within(card).queryByTestId("oats-needs-question")).toBeNull(); // said once: by the board
  expect(within(card).queryByTestId("oats-reply-send")).toBeNull();
  await waitFor(() => expect(within(zone).getAllByTestId("oats-board-answer")).toHaveLength(2));
  fireEvent.click(within(zone).getAllByTestId("oats-board-answer")[0]!);
  await waitFor(() => expect(within(zone).getByTestId("oats-board-sent").textContent).toBe("Sent."));
  expect(sent).toEqual([{ threadId: "thr_research", text: "q3: main: the default" }]);
});

test("a card of any other claim is as before: the claim's text and the reply, and nothing of a board is read for it", async () => {
  const { slot, card } = await home({});
  expect(within(card).getByTestId("oats-needs-question")).toBeTruthy();
  expect(within(card).getByTestId("oats-reply-send")).toBeTruthy();
  expect(within(card).queryByTestId("oats-board-questions")).toBeNull();
  expect(slot.inspection.rpcCalls.map((call) => call.method)).not.toContain("board");
});

test("behind a lifecycle result that says the agent changed (\"Reading…\"), the card's question offers nothing to press: its options are text", async () => {
  const { card } = await home({ boardAsks: true, waiting: { reason: "attention", message: "Which base branch?", since: "2026-11-23T18:01:45.726Z" } });
  const zone = await within(card).findByTestId("oats-board-questions");
  await waitFor(() => expect(within(zone).getAllByTestId("oats-board-answer")).toHaveLength(2));
  const { noteActed } = await import("../../app/roster/reading");
  const { fixtureSnapshot } = await import("../helpers/fixtures");
  act(() => noteActed([ASKS], fixtureSnapshot().at));
  await waitFor(() => expect(within(zone).queryAllByTestId("oats-board-answer")).toEqual([]));
  expect(within(zone).getAllByTestId("oats-board-option").map((each) => each.textContent)).toEqual(["1main: the default", "2release: the 0.1 line"]);
  expect(zone.querySelectorAll("button")).toHaveLength(0); // never an off control alone on the card
});

test("while the roster is the last one read (OATS cannot be read), the card's question offers nothing to press", async () => {
  const app = await loadApp();
  const panel = app.navPanels.find((candidate) => candidate.id === "home")!;
  const { fixtureSnapshot } = await import("../helpers/fixtures");
  const agents = fixtureAgents().map((agent): Agent => (agent.instance === ASKS ? { ...agent, boardAsks: true, waiting: { reason: "attention", message: "Which base branch?", since: "2026-11-23T18:01:45.726Z" } } : agent));
  const slot = renderSlot<{ subPath: string }, Contract>(panel, { subPath: "" }, {
    rpc: handlers({
      snapshot: () => ({ ok: false, at: "2026-11-23T18:17:00.000Z", code: "E_CONFIG_BROKEN", message: "oats-local.yaml cannot be read", machine: null, last: fixtureSnapshot(agents) }) as never,
      board: () => ({ at: BOARD_AT, supported: true, board: { facts: [], questions: [QUESTION] }, claim: { producer: "oats.board", reason: "attention" } }),
    }, agents),
    sidebarThreads: sidebarThreads(),
    sdk: { threads: { interactions: { list: async () => [] } } } as never as RenderSlotOptions<Contract>["sdk"],
  });
  const card = (await slot.findAllByTestId("oats-needs-card")).find((each) => each.dataset.instance === ASKS)!;
  const zone = await within(card).findByTestId("oats-board-questions");
  await act(async () => void (await new Promise((resolve) => setTimeout(resolve, 60))));
  expect(within(zone).queryAllByTestId("oats-board-answer")).toEqual([]);
  expect(zone.querySelectorAll("button")).toHaveLength(0);
});

test("on the card the question has no border of its own and no second age (the card has both); on its Board tab it has both", async () => {
  const { card } = await home({ boardAsks: true, waiting: { reason: "attention", message: "Which base branch?", since: "2026-11-23T18:01:45.726Z" } });
  const zone = await within(card).findByTestId("oats-board-questions");
  expect(zone.hasAttribute("data-in-card")).toBe(true);
  expect(zone.className).not.toMatch(/\bborder\b/);
  expect(within(zone).queryByTestId("oats-board-age")).toBeNull();
});

test("the thread line's Answer turns the panel to BOARD for an agent whose board asks (the question is there, with its options), and to Instance for any other claim", async () => {
  const app = await loadApp();
  const { InstancePanel, showPanelTab } = await import("../../app/panel/Panel");
  const Row = app.threadHeaderRows[0]!.component;
  const selected = (slot: { container: HTMLElement }) => slot.container.querySelector('[role="tab"][aria-selected="true"]')?.textContent;
  for (const [change, tab] of [[{ boardAsks: true as const, hasBoard: true as const }, "Board"], [{}, "Instance"]] as const) {
    const agents = fixtureAgents().map((agent): Agent => (agent.instance === ASKS ? { ...agent, ...change } : agent));
    const slot = renderSlot<{ threadId: string; projectId: string; environment: null }, Contract>(
      { component: (props: { threadId: string; projectId: string; environment: null }) => (<><Row {...props} /><InstancePanel threadId={props.threadId} /></>) } as never,
      { threadId: "thr_research", projectId: "p", environment: null },
      { rpc: handlers({ board: () => ({ at: BOARD_AT, supported: true, board: "boardAsks" in change ? { facts: [], questions: [QUESTION] } : null, claim: { producer: "oats.board", reason: "attention" } }) }, agents), sidebarThreads: sidebarThreads(), sdk: { threads: { interactions: { list: async () => [] } } } as never },
    );
    await slot.findByTestId("oats-status-act");
    act(() => showPanelTab("soul")); // the panel was left on the Soul tab
    await waitFor(() => expect(selected(slot)).toBe("Soul"));
    fireEvent.click(slot.getByTestId("oats-status-act"));
    await waitFor(() => expect(selected(slot), JSON.stringify(change)).toBe(tab));
    resetApp();
  }
});
