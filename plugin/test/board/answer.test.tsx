// @vitest-environment jsdom
// Answering a question of the board: a press on an option SENDS `<id>: <option>` to the agent's bb
// thread through the plugin's one guarded send; what is sent is built from the row at the press;
// the question stays, with "Sent." beside the option sent. Where an answer may not be sent, the
// options are text.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { afterEach, expect, test, vi } from "vitest";
import { act, fireEvent, waitFor, within } from "@testing-library/react";
import { renderSlot } from "@get-bb/plugin-sdk/testing/app";
import type { RenderSlotOptions } from "@get-bb/plugin-sdk/testing/app";
import { Board, forgetHidden } from "../../app/board";
import type { Agent } from "../../model/types";
import { fixtureAgents, fixtureSnapshot, fixtureThreads } from "../helpers/fixtures";
import { handlers, loadApp, resetApp } from "../helpers/render";
import type { Contract } from "../helpers/render";
import { BOARD_AT } from "./handlers";

afterEach(() => {
  resetApp();
  forgetHidden();
  vi.useRealTimers();
});

const LEAD = "redesign-ui-lead"; // the pinned roster's agent on a bb thread, which runs
const QUESTION = { id: "q3", question: "Which base branch?", options: ["main: the default", "release: the 0.1 line"], hasContext: false, since: "2026-11-23T18:01:45.724Z" };
const CLAIM = { producer: "oats.board", reason: "attention" };
type Sent = { threadId: string; text: string };

/** The board of `instance`, on the pinned roster with `change` over that agent's row; `rows`: what the server's roster says of the board at each read (the last one stays). */
async function drawn(given: { instance?: string; change?: Partial<Agent>; board?: unknown; claim?: typeof CLAIM | { producer: string; reason: string } | null; pending?: boolean; /** whether answers are expected to be offered once the roster is read (the default); false: the options stay text */ offered?: boolean } = {}) {
  await loadApp();
  const instance = given.instance ?? LEAD;
  const agents = fixtureAgents().map((agent): Agent => (agent.instance === instance ? { ...agent, ...given.change } : agent));
  const threadId = agents.find((agent) => agent.instance === instance)!.threadId;
  const sent: Sent[] = [];
  const asked: string[] = [];
  /** What the server answers from now on, where a test changes it after the draw: the snapshot, and the row's claim. */
  const server: { snapshot: ((agents: Agent[]) => unknown) | null; claim: { producer: string; reason: string } | null | undefined; board: unknown; stale: boolean } = { snapshot: null, claim: given.claim, board: given.board ?? { facts: [], questions: [QUESTION] }, stale: false };
  const threads = fixtureThreads().map((thread) => (thread.id === threadId && given.pending ? { ...thread, hasPendingInteraction: true } : thread));
  const slot = renderSlot<{ instance: string }, Contract>({ component: Board }, { instance }, {
    rpc: handlers(
      {
        snapshot: () => {
          asked.push("snapshot");
          return (server.snapshot === null ? fixtureSnapshot(agents) : server.snapshot(agents)) as never;
        },
        board: () => {
          asked.push("board");
          return { at: BOARD_AT, supported: true, stale: server.stale, board: server.board, claim: server.claim === undefined ? CLAIM : server.claim };
        },
      },
      agents,
    ),
    sidebarThreads: { status: "ready" as const, threads },
    sdk: { threads: { send: async ({ threadId: to, input }: { threadId: string; input: { text: string }[] }) => (sent.push({ threadId: to, text: input.map((part) => part.text).join("") }), { ok: true }) } } as never as RenderSlotOptions<Contract>["sdk"],
  });
  await waitFor(() => expect(slot.getByTestId("oats-board").getAttribute("data-state")).toBe("shown"));
  await act(async () => {});
  const zone = slot.getByTestId("oats-board-questions");
  const answers = () => within(zone).queryAllByTestId("oats-board-answer") as HTMLButtonElement[];
  const options = () => within(zone).getAllByTestId("oats-board-option").map((each) => each.textContent);
  // The answers are offered once the ROSTER is read too (who the agent is, and that it may be written to): wait for that.
  if (given.offered ?? true) await waitFor(() => expect(answers().length).toBeGreaterThan(0));
  else await act(async () => void (await new Promise((resolve) => setTimeout(resolve, 60))));
  return { slot, zone, sent, asked, answers, options, server, threadId: threadId! };
}

test("an agent on a bb thread that runs: each option is a button; a press sends `<id>: <option>` to its thread, once; the question stays, with \"Sent.\" beside the option sent and the options off", async () => {
  const { zone, sent, asked, answers, options, threadId } = await drawn();
  expect(answers().map((button) => [button.textContent, button.disabled])).toEqual([["1main: the default", false], ["2release: the 0.1 line", false]]);
  asked.length = 0;
  fireEvent.click(answers()[1]!);
  fireEvent.click(answers()[1]!); // a second press of the same moment
  await waitFor(() => expect(within(zone).getByTestId("oats-board-sent").textContent).toBe("Sent."));
  expect(sent).toEqual([{ threadId, text: "q3: release: the 0.1 line" }]);
  expect(sent[0]!.text).not.toMatch(/[\r\n]/);
  // The roster and the board were asked of the server AT THE PRESS, before anything went to bb.
  expect(asked.slice(0, 2)).toEqual(["snapshot", "board"]);
  expect(options()).toEqual(["1main: the default", "2release: the 0.1 lineSent."]);
  expect(answers().map((button) => button.disabled)).toEqual([true, true]);
  expect(within(zone).getByTestId("oats-board-question").textContent).toBe("Which base branch?"); // only the agent clears it
  expect(within(zone).queryByTestId("oats-board-refused")).toBeNull();
});

test("the question the agent CLEARED between the draw and the press: refused with the sentence, and nothing is sent", async () => {
  const { zone, sent, answers, server } = await drawn();
  server.board = { facts: [], questions: [] };
  fireEvent.click(answers()[0]!);
  await waitFor(() => expect(within(zone).getByTestId("oats-board-refused").textContent).toBe("No longer asked. Nothing sent."));
  expect(sent).toEqual([]);
  expect(within(zone).queryByTestId("oats-board-sent")).toBeNull();
});

test("the row the server answers at the press is the LAST roster's (OATS could not be read since the roster the press was guarded by): nothing is sent on what OATS said before", async () => {
  const { zone, sent, answers, server } = await drawn();
  server.stale = true;
  fireEvent.click(answers()[0]!);
  await waitFor(() => expect(within(zone).getByTestId("oats-board-refused").textContent).not.toBe(""));
  expect(sent).toEqual([]);
  expect(within(zone).queryByTestId("oats-board-sent")).toBeNull();
  // A refusal ends "on its way": the question can be answered once OATS is read again.
  server.stale = false;
  await waitFor(() => expect(answers().every((button) => !button.disabled)).toBe(true));
  fireEvent.click(answers()[0]!);
  await waitFor(() => expect(sent.map((each) => each.text)).toEqual(["q3: main: the default"]));
});

test("the same id asked AGAIN (another `since`) at the press: refused, nothing sent", async () => {
  const { zone, sent, answers, server } = await drawn();
  server.board = { facts: [], questions: [{ ...QUESTION, since: "2026-11-23T18:05:00.000Z" }] };
  fireEvent.click(answers()[0]!);
  await waitFor(() => expect(within(zone).getByTestId("oats-board-refused").textContent).toBe("No longer asked. Nothing sent."));
  expect(sent).toEqual([]);
});

test("another option in that place at the press (the row's own text is what would be sent): refused, nothing sent", async () => {
  const { zone, sent, answers, server } = await drawn();
  server.board = { facts: [], questions: [{ ...QUESTION, options: ["develop", "release: the 0.1 line"] }] };
  fireEvent.click(answers()[0]!);
  await waitFor(() => expect(within(zone).getByTestId("oats-board-refused")).toBeTruthy());
  expect(sent).toEqual([]);
});

test("the home's guard holds at the press: an agent OATS stopped since the board was drawn is not written to", async () => {
  const { zone, sent, answers, server } = await drawn();
  server.snapshot = (agents) => fixtureSnapshot(agents.map((agent): Agent => (agent.instance === LEAD ? { ...agent, running: false, runtimeState: "stopped", sessionEnd: "stopped" } : agent)));
  fireEvent.click(answers()[0]!);
  await waitFor(() => expect(within(zone).getByTestId("oats-board-refused").textContent).toBe("OATS has stopped this agent since: nothing was sent. Start it to answer."));
  expect(sent).toEqual([]);
});

test("nor while OATS cannot be read at the press: whether it still runs is not known", async () => {
  const { zone, sent, answers, server } = await drawn();
  server.snapshot = () => ({ ok: false, at: "2026-11-23T18:17:00.000Z", code: "E_CONFIG_BROKEN", message: "oats-local.yaml cannot be read", machine: null, last: null });
  fireEvent.click(answers()[0]!);
  await waitFor(() => expect(within(zone).getByTestId("oats-board-refused").textContent).toMatch(/^OATS cannot be read now, so nothing was sent/));
  expect(sent).toEqual([]);
});

test("an approval the agent waits on (the claim's reason is permission) when the board is drawn: a message would answer THAT: the options are text", async () => {
  const { answers, options } = await drawn({ claim: { producer: "pi.harness", reason: "permission" }, offered: false });
  expect(answers()).toEqual([]);
  expect(options()).toEqual(["1main: the default", "2release: the 0.1 line"]);
});

test("an approval that arose since the draw: refused at the press, nothing sent", async () => {
  const { zone, sent, answers, server } = await drawn();
  server.claim = { producer: "pi.harness", reason: "permission" };
  fireEvent.click(answers()[0]!);
  await waitFor(() => expect(within(zone).getByTestId("oats-board-refused").textContent).toBe("It waits on an approval. Nothing sent."));
  expect(sent).toEqual([]);
});

for (const [what, given] of [
  ["an agent on tmux", { instance: "kernel-fix-developer" }],
  ["an agent stopped with OATS", { change: { running: false, runtimeState: "stopped", sessionEnd: "stopped" } }],
  ["a thread on which bb holds a request of its own", { pending: true }],
] as const) {
  test(`not offered, the options stay text: ${what}`, async () => {
    const { answers, options, zone } = await drawn({ ...given, offered: false } as never);
    expect(answers()).toEqual([]);
    expect(options()).toEqual(["1main: the default", "2release: the 0.1 line"]);
    expect(zone.textContent).not.toMatch(/Answer|type|terminal|thread/i); // nothing tells how to answer
  });
}

test("an option the display filter withholds is never a button and never sent; the others are", async () => {
  const { answers, options } = await drawn({ board: { facts: [], questions: [{ ...QUESTION, options: ["main: the default", "token=abcdefgh12345"] }] } });
  expect(answers().map((button) => button.textContent)).toEqual(["1main: the default"]);
  expect(options()[1]).not.toMatch(/abcdefgh/);
});

test("there is exactly ONE call of bb's threads.send in the plugin's app: the guarded send's", () => {
  const files: string[] = [];
  const walk = (directory: string) => {
    for (const name of readdirSync(directory)) {
      const path = join(directory, name);
      if (statSync(path).isDirectory()) walk(path);
      else if (/\.tsx?$/.test(name)) files.push(path);
    }
  };
  walk(join(__dirname, "..", "..", "app"));
  const calls = files.flatMap((file) => (readFileSync(file, "utf8").match(/threads\s*\.\s*send\s*\(/g) ?? []).map(() => file.replace(/.*\/app\//, "app/")));
  expect(calls).toEqual(["app/home/send.ts"]);
});
