// @vitest-environment jsdom
// The board's ONE command, "Board": bb takes a plugin's commands once, with fixed titles, and asks
// each whether it applies outside React, with the thread in view alone. It is listed only on the
// thread of an agent whose row says it has a board, and it turns that agent's panel to Board.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { waitFor } from "@testing-library/react";
import { renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { parseStatus } from "../../kernel/roster";
import type { Agent } from "../../model/types";
import { fixtureAgents } from "../helpers/fixtures";
import { handlers, loadApp, resetApp, sidebarThreads } from "../helpers/render";
import type { Contract } from "../helpers/render";

afterEach(() => resetApp());

const HAS = "ranker-v3-probe"; // on bb thread thr_research
const context = (threadId: string | null, opened: unknown[] = []) => ({ threadId, projectId: null, experimental_panel: { openTab: (options: unknown) => (opened.push(options), true) } as never });

/** The app with its overlay mounted (the one holder of the roster for commands), the roster read. */
async function app(change: Partial<Agent>) {
  const loaded = await loadApp();
  const Overlay = loaded.appOverlays[0]!.component;
  const agents = fixtureAgents().map((agent): Agent => (agent.instance === HAS ? { ...agent, ...change } : agent));
  const slot = renderSlot<object, Contract>({ component: Overlay }, {}, { rpc: handlers({}, agents), sidebarThreads: sidebarThreads(), sdk: {} as never });
  await waitFor(() => expect(slot.inspection.rpcCalls.map((call) => call.method)).toContain("snapshot"));
  const { command } = await import("../../app/board");
  return { command, loaded };
}

test("the plugin registers ONE command of the board, titled \"Board\", with no shortcut of its own: nothing per question", async () => {
  const { command } = await app({ hasBoard: true, boardAsks: true });
  expect([command.id, command.title, command.defaultShortcut]).toEqual(["agent-board", "Board", undefined]);
  // What the board's entry registers is that one command and nothing else (bb's collector does not list commands to a test).
  const registered: unknown[] = [];
  const board = await import("../../app/board");
  board.register({ commands: { register: (each: unknown) => registered.push(each) } } as never);
  expect(registered).toEqual([command]);
});

test("it is listed only on the thread of an agent that has a board: not on another agent's thread, a plain thread, or a surface with no thread", async () => {
  const { command } = await app({ hasBoard: true });
  await waitFor(() => expect(command.isAvailable!(context("thr_research"))).toBe(true));
  expect(command.isAvailable!(context("thr_ci"))).toBe(false); // an agent with no board
  expect(command.isAvailable!(context("thr_plain"))).toBe(false); // no agent's thread
  expect(command.isAvailable!(context(null))).toBe(false); // a plugin's page
});

test("an agent with no board is not offered it, and running it there does nothing", async () => {
  const { command } = await app({});
  await waitFor(() => expect(command.isAvailable!(context("thr_ci"))).toBe(false));
  const opened: unknown[] = [];
  expect(command.isAvailable!(context("thr_research", opened))).toBe(false);
  await command.run(context("thr_research", opened));
  expect(opened).toEqual([]);
});

test("run: the agent's panel is turned to Board and the thread's OATS tab is opened", async () => {
  const { command } = await app({ hasBoard: true, boardAsks: true });
  await waitFor(() => expect(command.isAvailable!(context("thr_research"))).toBe(true));
  const opened: unknown[] = [];
  await command.run(context("thr_research", opened));
  expect(opened).toEqual([{ tab: { id: "home", context: { kind: "thread" }, availability: "fixed" } }]);
  const { InstancePanel } = await import("../../app/panel");
  const panel = renderSlot<{ threadId: string }, Contract>({ component: InstancePanel as never }, { threadId: "thr_research" }, {
    rpc: handlers({ board: () => ({ at: "2026-11-23T18:17:00.000Z", supported: true, stale: false, board: { facts: [{ key: "pr", label: "Pull request", value: "#42", unit: null, link: null, at: "2026-11-23T18:01:45.000Z" }], questions: [] }, claim: null }) }, fixtureAgents().map((agent): Agent => (agent.instance === HAS ? { ...agent, hasBoard: true } : agent))),
    sidebarThreads: sidebarThreads(),
    sdk: {} as never,
  });
  // A board with facts alone does not open the panel on Board by itself: the command did.
  await waitFor(() => expect(panel.container.querySelector("#oats-panel-page-tab-board")?.getAttribute("aria-selected")).toBe("true"));
});

test("the roster's row says an agent HAS a board where it holds a fact or a question (recorded), and a board with facts alone does not ask", () => {
  const recorded = JSON.parse(readFileSync(join(__dirname, "..", "fixtures", "panel", "status-board.json"), "utf8")) as { agents: { instances: { instance: string; board: { questions: unknown[] } | null }[] }[] };
  const read = parseStatus(recorded);
  if (!read.ok) throw new Error(read.error.message);
  expect(read.value.agents.filter((agent) => agent.hasBoard === true).map((agent) => agent.instance)).toEqual(["panel-worktree-helper"]);
  for (const group of recorded.agents) for (const row of group.instances) if (row.board !== null && row.board !== undefined) row.board.questions = [];
  const factsOnly = parseStatus(recorded);
  if (!factsOnly.ok) throw new Error(factsOnly.error.message);
  const agent = factsOnly.value.agents.find((each) => each.instance === "panel-worktree-helper")!;
  expect([agent.hasBoard, agent.boardAsks]).toEqual([true, undefined]);
});

test("where the focus lands after the command: on the question's ZONE where the board asks (never on an option: a control that sends); on the Board tab where the board has facts alone", async () => {
  const { InstancePanel } = await import("../../app/panel");
  for (const asks of [true, false]) {
    const loaded = await loadApp();
    const Overlay = loaded.appOverlays[0]!.component;
    const agents = fixtureAgents().map((agent): Agent => (agent.instance === HAS ? { ...agent, hasBoard: true, ...(asks ? { boardAsks: true as const } : {}) } : agent));
    const board = { facts: [{ key: "pr", label: "Pull request", value: "#42", unit: null, link: null, at: "2026-11-23T18:01:45.000Z" }], questions: asks ? [{ id: "q3", question: "Which base branch?", options: ["main: the default", "release: the 0.1 line"], hasContext: false, since: "2026-11-23T18:01:45.724Z" }] : [] };
    const slot = renderSlot<object, Contract>(
      { component: () => (<><Overlay /><InstancePanel threadId="thr_research" /></>) } as never,
      {},
      { rpc: handlers({ board: () => ({ at: "2026-11-23T18:17:00.000Z", supported: true, stale: false, board, claim: asks ? { producer: "oats.board", reason: "attention" } : null }) }, agents), sidebarThreads: sidebarThreads(), sdk: { threads: { interactions: { list: async () => [] } } } as never },
    );
    const { command } = await import("../../app/board");
    await waitFor(() => expect(command.isAvailable!(context("thr_research"))).toBe(true));
    await waitFor(() => expect(slot.container.querySelector("#oats-panel-page-tab-board")).not.toBeNull());
    await command.run(context("thr_research"));
    await waitFor(() => expect(slot.container.querySelector("#oats-panel-page-tab-board")?.getAttribute("aria-selected")).toBe("true"));
    if (asks) {
      await waitFor(() => expect(document.activeElement).toBe(slot.getByTestId("oats-board-questions")));
      expect(slot.getAllByTestId("oats-board-answer").some((option) => option.contains(document.activeElement))).toBe(false);
    } else await waitFor(() => expect(document.activeElement).toBe(slot.container.querySelector("#oats-panel-page-tab-board")));
    resetApp();
  }
});
