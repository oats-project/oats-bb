// @vitest-environment jsdom
// Round 4's two about the press: options that take another question's place WITHOUT a person's turn are off for a
// moment (the clock is the board's own, set here: no test waits on the real one); and the press sends to the thread the
// place was drawn for only where the server's row still names it.
import { afterEach, expect, test, vi } from "vitest";
import { act, fireEvent, waitFor, within } from "@testing-library/react";
import { renderSlot } from "@get-bb/plugin-sdk/testing/app";
import type { RenderSlotOptions } from "@get-bb/plugin-sdk/testing/app";
import { Board, forgetHidden } from "../../app/board";
import { fixtureAgents, fixtureSnapshot, fixtureThreads } from "../helpers/fixtures";
import { handlers, loadApp, resetApp } from "../helpers/render";
import type { Contract } from "../helpers/render";
import { BOARD_AT } from "./handlers";

afterEach(() => { resetApp(); forgetHidden(); vi.useRealTimers(); });
const LEAD = "redesign-ui-lead";
const Q1 = { id: "q3", question: "Which base branch?", options: ["main: the default", "release: the 0.1 line"], hasContext: false, since: "2026-11-23T18:01:45.724Z" };
const Q2 = { id: "q4", question: "Squash?", options: ["yes", "no"], hasContext: false, since: "2026-11-23T18:02:45.724Z" };

import { clock, SETTLE_MS } from "../../app/board/clock";

const real = { now: clock.now, after: clock.after };
afterEach(() => Object.assign(clock, real));
/** The board's clock, held by the test: `tick(ms)` moves it and runs what was to run by then. */
function held() {
  let at = 1_000_000;
  const waits: { due: number; run: () => void }[] = [];
  clock.now = () => at;
  clock.after = (ms, run) => {
    const wait = { due: at + ms, run };
    waits.push(wait);
    return () => void waits.splice(waits.indexOf(wait), 1);
  };
  return (ms: number) => {
    at += ms;
    for (const wait of waits.filter((each) => each.due <= at)) {
      waits.splice(waits.indexOf(wait), 1);
      wait.run();
    }
  };
}

async function board(first: unknown, agents = fixtureAgents()) {
  await loadApp();
  let questions = first;
  const sent: string[] = [];
  const slot = renderSlot<{ instance: string }, Contract>({ component: Board }, { instance: LEAD }, {
    rpc: handlers({ board: () => ({ at: BOARD_AT, supported: true, stale: false, board: { facts: [], questions }, claim: { producer: "oats.board", reason: "attention" } }) }, agents),
    sidebarThreads: { status: "ready" as const, threads: fixtureThreads() },
    sdk: { threads: { interactions: { list: async () => [] }, send: async ({ input }: { input: { text: string }[] }) => (sent.push(input.map((part) => part.text).join("")), { ok: true }) } } as never as RenderSlotOptions<Contract>["sdk"],
  });
  await waitFor(() => expect(slot.getByTestId("oats-board").getAttribute("data-state")).toBe("shown"));
  const zone = slot.getByTestId("oats-board-questions");
  const answers = () => within(zone).queryAllByTestId("oats-board-answer") as HTMLButtonElement[];
  await waitFor(() => expect(answers().length).toBe(2));
  const change = async (next: unknown) => {
    questions = next;
    await act(async () => {
      slot.behavior.emitRealtime("oats/changed", { at: "2026-11-23T18:17:30.000Z" });
      await new Promise((resolve) => setTimeout(resolve, 100));
    });
  };
  return { slot, zone, answers, sent, change };
}

test("the agent CLEARS the question shown under a pointer: the next question stands in its place with its options OFF for a second; a press inside it sends nothing and says nothing; after it, a press sends", async () => {
  const tick = held();
  const { zone, answers, sent, change } = await board([Q1, Q2]);
  expect(within(zone).getByTestId("oats-board-place").textContent).toBe("1 of 2");
  await change([Q2]); // q3 is cleared: q4 is the one shown now, where q3 stood
  await waitFor(() => expect(within(zone).getByTestId("oats-board-question").textContent).toBe("Squash?"));
  expect(answers().map((button) => button.disabled)).toEqual([true, true]);
  fireEvent.click(answers()[0]!); // the click that was meant for q3
  await act(async () => {});
  expect(sent).toEqual([]);
  expect(within(zone).queryByTestId("oats-board-refused")).toBeNull();
  expect(within(zone).queryByTestId("oats-board-sent")).toBeNull();
  await act(async () => tick(SETTLE_MS - 1));
  expect(answers().map((button) => button.disabled)).toEqual([true, true]);
  await act(async () => tick(1));
  expect(answers().map((button) => button.disabled)).toEqual([false, false]);
  fireEvent.click(answers()[0]!);
  await waitFor(() => expect(sent).toEqual(["q4: yes"]));
});

test("a turn by ‹ › is the person's own: the options of the question turned to are pressable at once", async () => {
  held();
  const { zone, answers } = await board([Q1, Q2]);
  fireEvent.click(within(zone).getByTestId("oats-board-next"));
  await waitFor(() => expect(within(zone).getByTestId("oats-board-question").textContent).toBe("Squash?"));
  expect(answers().map((button) => button.disabled)).toEqual([false, false]);
});

test("the server's row at the press names ANOTHER thread than the one the place was drawn for (the agent was started again on a new thread): nothing is sent, and the home's sentence says so", async () => {
  held();
  await loadApp();
  const agents = fixtureAgents();
  let now = agents;
  const sent: string[] = [];
  const slot = renderSlot<{ instance: string }, Contract>({ component: Board }, { instance: LEAD }, {
    rpc: handlers({
      snapshot: (() => fixtureSnapshot(now)) as never,
      board: () => ({ at: BOARD_AT, supported: true, stale: false, board: { facts: [], questions: [Q1] }, claim: { producer: "oats.board", reason: "attention" } }),
    }, agents),
    sidebarThreads: { status: "ready" as const, threads: fixtureThreads() },
    sdk: { threads: { interactions: { list: async () => [] }, send: async ({ input }: { input: { text: string }[] }) => (sent.push(input.map((part) => part.text).join("")), { ok: true }) } } as never as RenderSlotOptions<Contract>["sdk"],
  });
  await waitFor(() => expect(slot.getByTestId("oats-board").getAttribute("data-state")).toBe("shown"));
  const zone = slot.getByTestId("oats-board-questions");
  const answers = () => within(zone).queryAllByTestId("oats-board-answer") as HTMLButtonElement[];
  await waitFor(() => expect(answers().length).toBe(2));
  // Between the draw and the press the server's row names another thread (this window has not drawn it yet).
  now = agents.map((agent) => (agent.instance === LEAD ? { ...agent, threadId: "thr_plain" } : agent));
  fireEvent.click(answers()[0]!);
  await waitFor(() => expect(within(zone).getByTestId("oats-board-refused").textContent).toBe("OATS no longer lists this agent: nothing was sent."));
  expect(sent).toEqual([]);
});

test("the same on the home's card (the guard is the one guarded send's): a reply drawn for one thread, the server's row naming another at the press: nothing is sent, and the card says so", async () => {
  const app = await loadApp();
  const panel = app.navPanels.find((candidate) => candidate.id === "home")!;
  const WHO = "ranker-v3-probe"; // a claim of its own, on thr_research: the card offers a reply
  const agents = fixtureAgents();
  let now = agents;
  const sent: string[] = [];
  const { sidebarThreads } = await import("../helpers/render");
  const slot = renderSlot<{ subPath: string }, Contract>(panel, { subPath: "" }, {
    rpc: handlers({ snapshot: (() => fixtureSnapshot(now)) as never }, agents),
    sidebarThreads: sidebarThreads(),
    sdk: { threads: { interactions: { list: async () => [] }, send: async ({ input }: { input: { text: string }[] }) => (sent.push(input.map((part) => part.text).join("")), { ok: true }) } } as never as RenderSlotOptions<Contract>["sdk"],
  });
  const card = (await slot.findAllByTestId("oats-needs-card")).find((each) => each.dataset.instance === WHO)!;
  const box = (await within(card).findByTestId("oats-reply-text")) as HTMLTextAreaElement;
  fireEvent.change(box, { target: { value: "use main" } });
  now = agents.map((agent) => (agent.instance === WHO ? { ...agent, threadId: "thr_plain" } : agent)); // T1 drawn, T2 on the server's row
  fireEvent.click(within(card).getByTestId("oats-reply-send"));
  await waitFor(() => expect(within(card).getByTestId("oats-needs-why").textContent).toBe("OATS no longer lists this agent: nothing was sent."));
  expect(sent).toEqual([]);
  expect(box.value).toBe("use main"); // what was typed is kept
});
