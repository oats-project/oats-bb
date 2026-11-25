// @vitest-environment jsdom
// "Terminal" on the page of a tmux agent that runs (app/terminal/Terminal.tsx), in the instance
// panel: where it is drawn, what a press asks of bb, and the one line when the tab did not come up.
import { afterEach, expect, test, vi } from "vitest";
import { act, fireEvent, within } from "@testing-library/react";
import { renderSlot } from "@get-bb/plugin-sdk/testing/app";
import type { RenderSlotOptions } from "@get-bb/plugin-sdk/testing/app";
import { InstancePanel } from "../../app/panel/Panel";
import { SETTLE_MS } from "../../app/terminal/open";
import type { Agent } from "../../model/types";
import { handlers, loadApp, resetApp } from "../helpers/render";
import type { Contract } from "../helpers/render";
import { instanceAnswer, panelAgents, panelSnapshot, panelThreads } from "../panel/handlers";
import { commandFor, HOST } from "./handlers";

afterEach(() => {
  resetApp();
  vi.useRealTimers();
});

const CHILD = "panel-worktree-helper";
const TITLE = "Panel worktree helper";

type Session = { id: string; title: string | null; status: string; exitCode?: number | null; initialCwd?: string | null };
/** bb's terminals for the page: what exists, what a created one is when it is asked, and what bb answers to the open. */
function bb(given: { sessions?: Session[]; after?: { status: string; exitCode?: number | null }; shown?: boolean } = {}) {
  const sessions = [...(given.sessions ?? [])];
  const calls: string[] = [];
  const terminals = {
    list: async ({ scope }: { scope: { hostId: string } }) => {
      calls.push(`list ${scope.hostId}`);
      return { sessions };
    },
    create: async ({ title, start, scope }: { title: string; start: { argv: string[] }; scope: { hostId: string; cwd: string } }) => {
      calls.push(`create ${scope.hostId} "${title}" ${start.argv.join(" ")}`);
      const made = { id: "term_new", title, status: "running", initialCwd: scope.cwd };
      sessions.push(made);
      return made;
    },
    get: async ({ terminalId }: { terminalId: string }) => {
      calls.push(`get ${terminalId}`);
      return terminalId === "term_new" && given.after ? given.after : { status: sessions.find((session) => session.id === terminalId)!.status };
    },
    close: async ({ terminalId, mode }: { terminalId: string; mode: string }) => {
      calls.push(`close ${terminalId} ${mode}`);
      return {};
    },
  };
  return { calls, options: { sdk: { terminals } as never as RenderSlotOptions<Contract>["sdk"], openTerminal: () => given.shown ?? true } };
}

/** The panel of the agent as one on tmux, with `change` over its row. */
async function page(change: Partial<Agent>, options: Partial<RenderSlotOptions<Contract>> = {}, rpc: Parameters<typeof handlers>[0] = {}) {
  await loadApp();
  const agents = panelAgents().map((agent): Agent => (agent.instance === CHILD ? { ...agent, backend: "tmux", threadId: null, running: true, waiting: null, ...change } : agent));
  const slot = renderSlot<{ instance: string }, Contract>({ component: InstancePanel }, { instance: CHILD }, {
    rpc: handlers({ snapshot: () => panelSnapshot(agents), panelInstance: ({ instance }) => instanceAnswer(instance, (facts) => ({ ...facts, backend: "tmux", threadId: null, tmuxSession: "oats-agents" })), ...rpc }),
    sidebarThreads: panelThreads(agents),
    ...options,
  });
  await slot.findByTestId("oats-panel-session");
  return slot;
}
const button = (slot: { queryByTestId(id: string): HTMLElement | null }) => slot.queryByTestId("oats-terminal-open") as HTMLButtonElement | null;
/** The press, and the open's wait for the terminal to settle. */
async function press(slot: { getByTestId(id: string): HTMLElement }) {
  vi.useFakeTimers({ toFake: ["setTimeout"] });
  fireEvent.click(slot.getByTestId("oats-terminal-open"));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(SETTLE_MS + 50);
  });
  vi.useRealTimers();
}

test("a tmux agent that runs has Terminal in its Session card, over the attach command, which stays", async () => {
  const slot = await page({});
  const attach = slot.getByTestId("oats-panel-attach");
  expect(button(slot)!.textContent).toBe("Terminal");
  expect(button(slot)!.disabled).toBe(false);
  expect(button(slot)!.title).toBe(""); // no tooltip
  expect(attach.contains(button(slot))).toBe(true);
  // The button first, then "Attach:" and the command to copy, as before.
  expect(Array.from(attach.querySelectorAll("button")).map((each) => each.getAttribute("aria-label") ?? each.textContent)).toEqual(["Terminal", "Copy the attach command"]);
  expect(within(attach).getByTestId("oats-command").textContent).toMatch(/^oats session attach --home \S+$/);
  expect(slot.queryByTestId("oats-terminal-failed")).toBeNull();
});

test("no Terminal where there is no session to show: stopped, lost, unreachable, nothing said; nor for an agent on a bb thread", async () => {
  for (const [what, change] of [
    ["stopped with OATS", { running: false, runtimeState: "shell", sessionEnd: "stopped" }],
    ["lost", { running: false, runtimeState: null, sessionEnd: "lost" }],
    ["unreachable", { running: null, runtimeState: "unreachable" }],
    ["nothing said of whether it runs", { running: null }],
  ] as const) {
    const slot = await page(change as Partial<Agent>);
    expect(button(slot), what).toBeNull();
    resetApp();
  }
  // On a bb thread (the panel's agent as recorded): its screen is bb's own thread.
  await loadApp();
  const onBb = renderSlot<{ instance: string }, Contract>({ component: InstancePanel }, { instance: CHILD }, { rpc: handlers({ snapshot: () => panelSnapshot(panelAgents()), panelInstance: ({ instance }) => instanceAnswer(instance) }), sidebarThreads: panelThreads(panelAgents()) });
  await onBb.findByTestId("oats-panel-session");
  expect(button(onBb)).toBeNull();
});

test("a press asks the server for the command, then bb: one terminal on the deployment's machine, titled with the agent's name, shown; nothing is said", async () => {
  const { calls, options } = bb();
  const asked: string[] = [];
  const slot = await page({}, options, { terminalCommand: ({ instance }) => (asked.push(instance), commandFor(instance)) });
  await press(slot);
  expect(asked).toEqual([CHILD]);
  expect(calls).toEqual([`list ${HOST}`, `create ${HOST} "${TITLE}" ${commandFor(CHILD).argv.join(" ")}`, "get term_new"]);
  expect(slot.inspection.navigateCalls).toContainEqual({ method: "experimental_openTerminal", options: { terminalId: "term_new" } });
  expect(slot.queryByTestId("oats-terminal-failed")).toBeNull();
  expect(button(slot)!.disabled).toBe(false);
});

test("pressed again while its tab is open: the same terminal is shown, none is created", async () => {
  const { calls, options } = bb({ sessions: [{ id: "term_held", title: TITLE, status: "running", initialCwd: commandFor(CHILD).cwd }] });
  const slot = await page({}, options);
  await press(slot);
  expect(calls).toEqual([`list ${HOST}`, "get term_held"]);
  expect(slot.inspection.navigateCalls).toContainEqual({ method: "experimental_openTerminal", options: { terminalId: "term_held" } });
});

test("the command ended at once: ONE line in the warning tone, and a fold that says the command and how it ended", async () => {
  const { options } = bb({ after: { status: "exited", exitCode: 127 } });
  const slot = await page({}, options);
  await press(slot);
  const failed = slot.getByTestId("oats-terminal-failed");
  expect([within(failed).getByTestId("oats-terminal-said").textContent, within(failed).getByTestId("oats-terminal-said").getAttribute("data-tone")]).toEqual(["Terminal did not open.", "warning"]);
  const details = within(failed).getByTestId("oats-terminal-details");
  expect(details.querySelector("summary")!.textContent).toMatch(/Details$/);
  expect((details as HTMLDetailsElement).open).toBe(false);
  expect(Array.from(details.querySelectorAll("p")).map((line) => line.textContent)).toEqual([commandFor(CHILD).argv.join(" "), "The command ended at once, with status 127."]);
  // The button is there to press again, and the attach command to copy is still under it.
  expect(button(slot)!.disabled).toBe(false);
  expect(within(slot.getByTestId("oats-panel-attach")).getByTestId("oats-command")).toBeTruthy();
});

test("bb showed no tab: the same one line, the fold says so, and the terminal is closed again", async () => {
  const { calls, options } = bb({ shown: false });
  const slot = await page({}, options);
  await press(slot);
  expect(within(slot.getByTestId("oats-terminal-failed")).getByTestId("oats-terminal-said").textContent).toBe("Terminal did not open.");
  expect(Array.from(slot.getByTestId("oats-terminal-details").querySelectorAll("p")).map((line) => line.textContent)).toEqual([commandFor(CHILD).argv.join(" "), "bb did not show it."]);
  expect(calls.at(-1)).toBe("close term_new force");
});

test("two presses of one moment are one open", async () => {
  const { calls, options } = bb();
  const slot = await page({}, options);
  vi.useFakeTimers({ toFake: ["setTimeout"] });
  // Both in ONE act: the second lands before the button is drawn off.
  act(() => {
    slot.getByTestId("oats-terminal-open").click();
    slot.getByTestId("oats-terminal-open").click();
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(SETTLE_MS + 50);
  });
  vi.useRealTimers();
  expect(calls.filter((call) => call.startsWith("list"))).toHaveLength(1);
  expect(calls.filter((call) => call.startsWith("create"))).toHaveLength(1);
});

test("the server refuses (no oats found on the machine): the same one line, with the server's own words under Details, and bb is not asked", async () => {
  const { calls, options } = bb();
  const slot = await page({}, options, {
    terminalCommand: () => {
      throw new Error("OATS_NOT_FOUND: oats is not on this machine's PATH");
    },
  });
  await press(slot);
  expect(within(slot.getByTestId("oats-terminal-failed")).getByTestId("oats-terminal-said").textContent).toBe("Terminal did not open.");
  expect(Array.from(slot.getByTestId("oats-terminal-details").querySelectorAll("p")).map((line) => line.textContent)).toEqual(["OATS_NOT_FOUND: oats is not on this machine's PATH"]);
  expect(calls).toEqual([]);
});

test("a second press clears what the first said, and one press is one open: a press while it goes asks nothing more", async () => {
  const first = bb({ after: { status: "exited", exitCode: 1 } });
  const slot = await page({}, first.options);
  await press(slot);
  expect(slot.getByTestId("oats-terminal-failed")).toBeTruthy();
  vi.useFakeTimers({ toFake: ["setTimeout"] });
  fireEvent.click(slot.getByTestId("oats-terminal-open"));
  fireEvent.click(slot.getByTestId("oats-terminal-open"));
  await act(async () => {});
  expect(button(slot)!.disabled).toBe(true);
  expect(slot.queryByTestId("oats-terminal-failed")).toBeNull(); // gone while it tries again
  await act(async () => {
    await vi.advanceTimersByTimeAsync(SETTLE_MS + 50);
  });
  vi.useRealTimers();
  expect(first.calls.filter((call) => call.startsWith("list"))).toHaveLength(2); // the first press, and ONE more
});

test("behind \"Reading…\" the button is off with the page's other acts, with no reason of its own", async () => {
  const { calls, options } = bb();
  const slot = await page({}, options);
  expect(button(slot)!.disabled).toBe(false);
  const { noteActed } = await import("../../app/roster/reading");
  act(() => noteActed([CHILD], panelSnapshot(panelAgents()).at));
  expect(button(slot)!.disabled).toBe(true);
  expect(button(slot)!.title).toBe("");
  fireEvent.click(slot.getByTestId("oats-terminal-open"));
  await act(async () => {});
  expect(calls).toEqual([]);
});
