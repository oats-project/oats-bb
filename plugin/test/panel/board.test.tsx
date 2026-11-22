// @vitest-environment jsdom
// The agent's board on the Instance tab (D-114 to D-122): its questions and its facts, drawn from
// the roster and the inspection recorded from the real kernel, and an answer sent only after the
// person confirmed the exact line.
import { afterEach, expect, test, vi } from "vitest";
import { act, fireEvent, waitFor, within } from "@testing-library/react";
import { renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { InstancePanel } from "../../app/panel/Panel";
import { answerLine, askedText, detailSignature, factsView, sparkValues, turnQuestion, updatedText, zoneHint } from "../../app/panel/board-words";
import type { PanelBoard } from "../../kernel/panel-board";
import { handlers, resetApp } from "../helpers/render";
import type { Contract, Handlers } from "../helpers/render";
import { instanceAnswer, panelAgents, panelSnapshot, panelThreads, recordedBoard } from "./handlers";

afterEach(() => {
  resetApp();
  vi.useRealTimers();
  localStorage.clear();
});

const CHILD = "panel-worktree-helper";
const ROSTER = "status-board.json";
const NOW = Date.parse("2026-11-21T18:29:30.000Z");
const text = (element: Element) => element.textContent;
const child = () => panelAgents(ROSTER).find((agent) => agent.instance === CHILD)!;
type Answer = ReturnType<typeof instanceAnswer>;

/** The panel of the recorded agent whose board holds two facts and two open questions. `board` changes the row's board. */
function panel(over: Partial<Handlers> = {}, change: { board?: (board: PanelBoard) => PanelBoard; answer?: (answer: Answer) => Answer } = {}) {
  vi.useFakeTimers({ now: NOW, toFake: ["Date"] });
  const agents = panelAgents(ROSTER);
  const answer = (instance: string): Answer => {
    const recorded = instanceAnswer(instance, undefined, ROSTER);
    const changed = instance === CHILD && change.board ? { ...recorded, board: change.board(recorded.board) } : recorded;
    return instance === CHILD && change.answer ? change.answer(changed) : changed;
  };
  return renderSlot<{ threadId: string }, Contract>({ component: InstancePanel }, { threadId: child().threadId! }, {
    rpc: handlers({ snapshot: () => panelSnapshot(agents), panelInstance: ({ instance }) => answer(instance), ...over }),
    sidebarThreads: panelThreads(agents),
  });
}
const calls = (slot: { inspection: { rpcCalls: { method: string; input: unknown }[] } }, method: string) => slot.inspection.rpcCalls.filter((call) => call.method === method);
const options = (slot: ReturnType<typeof panel>) => slot.getAllByTestId("oats-panel-question-option");

// ---- questions

test("Questions: one at a time, which one and since when, its options numbered; the board's own claim is not said a second time as Needs input", async () => {
  const slot = panel();
  const zone = await slot.findByTestId("oats-panel-question");
  expect(text(within(slot.getByTestId("oats-panel-questions")).getByRole("heading"))).toBe("Questions2");
  expect(zone.getAttribute("aria-label")).toBe("Question 1 of 2 from Panel worktree helper");
  expect(text(slot.getByTestId("oats-panel-question-tag"))).toBe("question 1 of 2 · asked 5 min ago");
  expect(text(slot.getByTestId("oats-panel-question-text"))).toBe("Which base branch?");
  expect(options(slot).map((option) => [text(option), option.getAttribute("aria-keyshortcuts"), (option as HTMLButtonElement).disabled])).toEqual([["1main: the default", "1", false], ["2release: the 0.1 line", "2", false]]);
  // a question with no context has no fold
  expect(slot.queryByTestId("oats-panel-question-context")).toBeNull();
  expect(slot.queryByTestId("oats-panel-waiting")).toBeNull();
  // the header still says the agent needs the person
  expect(text(slot.getByTestId("oats-panel-state"))).toContain("Needs you");
});

test("Previous and Next turn the questions, wrapping, and so do the arrow keys; the shown question stays the same one across reads", async () => {
  const slot = panel();
  await slot.findByTestId("oats-panel-question");
  expect(slot.getByTestId("oats-panel-question-next").getAttribute("aria-label")).toBe("Next question");
  expect(slot.getByTestId("oats-panel-question-previous").getAttribute("aria-label")).toBe("Previous question");
  fireEvent.click(slot.getByTestId("oats-panel-question-next"));
  expect(text(slot.getByTestId("oats-panel-question-text"))).toBe("How should I merge the pull request?");
  expect(text(slot.getByTestId("oats-panel-question-tag"))).toBe("question 2 of 2 · asked 2 min ago");
  // one dot per question, named, the shown one marked; a dot shows its question
  const dots = () => slot.getAllByTestId("oats-panel-question-dot").map((dot) => [dot.getAttribute("aria-label"), dot.getAttribute("aria-current")]);
  expect(dots()).toEqual([["Question 1", null], ["Question 2", "true"]]);
  fireEvent.click(slot.getAllByTestId("oats-panel-question-dot")[0]!);
  expect(text(slot.getByTestId("oats-panel-question-text"))).toBe("Which base branch?");
  expect(dots()).toEqual([["Question 1", "true"], ["Question 2", null]]);
  fireEvent.click(slot.getAllByTestId("oats-panel-question-dot")[1]!);
  // the same dots as an indicator for a phone's width, hidden from a screen reader
  expect(slot.getByTestId("oats-panel-question-dots-shown").getAttribute("aria-hidden")).toBe("true");
  expect(slot.getByTestId("oats-panel-question-dots-shown").children).toHaveLength(2);
  fireEvent.keyDown(slot.getByTestId("oats-panel-question"), { key: "ArrowRight" });
  expect(text(slot.getByTestId("oats-panel-question-text"))).toBe("Which base branch?");
  fireEvent.keyDown(slot.getByTestId("oats-panel-question"), { key: "ArrowLeft" });
  expect(text(slot.getByTestId("oats-panel-question-text"))).toBe("How should I merge the pull request?");
  // the roster is read again: the same question is still the one shown
  await act(async () => slot.behavior.emitRealtime("oats/changed", { at: "2026-11-21T18:29:40.000Z" }));
  await waitFor(() => expect(calls(slot, "panelInstance").length).toBeGreaterThan(1));
  expect(text(slot.getByTestId("oats-panel-question-text"))).toBe("How should I merge the pull request?");
});

test("Context: the agent's context as plain text under the words that say whose it is, read with the board's detail; c opens it", async () => {
  const slot = panel();
  await slot.findByTestId("oats-panel-question");
  fireEvent.click(slot.getByTestId("oats-panel-question-next"));
  const fold = await slot.findByTestId("oats-panel-question-context");
  expect(text(fold.querySelector("summary")!)).toContain("Context");
  expect(fold.hasAttribute("open")).toBe(false);
  fireEvent.keyDown(slot.getByTestId("oats-panel-question"), { key: "c" });
  await waitFor(() => expect(fold.hasAttribute("open")).toBe(true));
  await waitFor(() => expect(text(fold)).toContain("I rebased the branch on main and all checks pass."));
  expect(text(fold)).toContain("Panel worktree helper says:");
  // the lines are the agent's, kept
  expect(fold.querySelector("p[tabindex]")?.textContent).toBe("Squash or merge the three commits\nI rebased the branch on main and all checks pass.\nI will merge with the method you pick.\nhttps://github.com/oats-project/oats-bb/pull/42");
  expect(calls(slot, "panelBoard").map((call) => call.input)).toEqual([{ instance: CHILD }]);
});

test("the context fold says what it cannot show: still reading, none sent, not readable, an OATS that sends none", async () => {
  const withContext = (board: PanelBoard): PanelBoard => ({ ...board, questions: board.questions.filter((question) => question.hasContext) });
  const said = async (over: Partial<Handlers>) => {
    const slot = panel(over, { board: withContext });
    const fold = await slot.findByTestId("oats-panel-question-context");
    return { slot, fold };
  };
  let release: (() => void) | null = null;
  const reading = await said({ panelBoard: () => new Promise((done) => (release = () => done(recordedBoard()))) });
  expect(text(reading.fold)).toContain("Reading the context…");
  act(() => release?.());
  await waitFor(() => expect(text(reading.fold)).toContain("I rebased the branch"));
  reading.slot.unmount();
  resetApp();
  const none = await said({ panelBoard: () => ({ ...recordedBoard(), questions: recordedBoard().questions.map((question) => ({ ...question, context: null })) }) });
  await waitFor(() => expect(text(none.fold)).toContain("The agent sent no context for this question."));
  none.slot.unmount();
  resetApp();
  const failed = await said({
    panelBoard: () => {
      throw new Error("OATS_TIMEOUT: `oats` did not answer within 20 s and was stopped");
    },
  });
  await waitFor(() => expect(text(failed.fold)).toContain("The context could not be read."));
  failed.slot.unmount();
  resetApp();
  const unsupported = await said({ panelBoard: () => ({ state: "unsupported", facts: [], questions: [], dropped: 0 }) });
  await waitFor(() => expect(text(unsupported.fold)).toContain("This OATS sends no context: ask the agent."));
  unsupported.slot.unmount();
  resetApp();
  // a detail read for an earlier asking of the same id says nothing about this one
  const earlier = await said({ panelBoard: () => ({ ...recordedBoard(), questions: recordedBoard().questions.map((question) => ({ ...question, since: "2026-11-21T18:00:00.000Z" })) }) });
  await waitFor(() => expect(calls(earlier.slot, "panelBoard")).toHaveLength(1));
  expect(text(earlier.fold)).toContain("Reading the context…");
  expect(text(earlier.fold)).not.toContain("I rebased the branch");
});

test("a detail held from an earlier board, which does not name the question asked now, is read once more and never in a loop", async () => {
  const withContext = (board: PanelBoard): PanelBoard => ({ ...board, questions: board.questions.filter((question) => question.hasContext) });
  const earlier = { ...recordedBoard(), questions: [] };
  let reads = 0;
  const slot = panel({ panelBoard: () => (++reads === 1 ? earlier : recordedBoard()) }, { board: withContext });
  const fold = await slot.findByTestId("oats-panel-question-context");
  await waitFor(() => expect(text(fold)).toContain("I rebased the branch"));
  expect(reads).toBe(2);
  slot.unmount();
  resetApp();
  // a kernel whose detail never names it: one more read, then the fold says there is none
  reads = 0;
  const never = panel({ panelBoard: () => (++reads, earlier) }, { board: withContext });
  const none = await never.findByTestId("oats-panel-question-context");
  await waitFor(() => expect(reads).toBe(2));
  await waitFor(() => expect(text(none)).toContain("The agent sent no context for this question."));
  await act(async () => { await new Promise((done) => setTimeout(done, 50)); });
  expect(reads).toBe(2);
});

// ---- answering

test("an option opens a dialog with the exact line; nothing is sent until Send answer, and then that line, for that question and option", async () => {
  const slot = panel();
  await slot.findByTestId("oats-panel-question");
  fireEvent.click(slot.getByTestId("oats-panel-question-next"));
  fireEvent.click(options(slot)[0]!);
  const dialog = await slot.findByTestId("oats-confirm");
  expect(text(slot.getByRole("dialog").querySelector("h2, h1, h3")!)).toBe("Answer Panel worktree helper?");
  expect(text(dialog)).toContain("OATS sends this line to Panel worktree helper as its next input, and Panel worktree helper starts a turn with it.");
  expect(text(slot.getByTestId("oats-panel-answer"))).toBe("How should I merge the pull request?q4: Squash: one clean commit");
  expect(text(slot.getByTestId("oats-panel-answer-line"))).toBe("q4: Squash: one clean commit");
  expect(text(slot.getByTestId("oats-confirm-act"))).toBe("Send answer");
  expect(calls(slot, "panelBoardAnswer")).toHaveLength(0);
  fireEvent.click(slot.getByTestId("oats-confirm-act"));
  await waitFor(() => expect(dialog.getAttribute("data-phase")).toBe("done"));
  expect(calls(slot, "panelBoardAnswer").map((call) => call.input)).toEqual([{ instance: CHILD, id: "q4", since: "2026-11-21T18:26:49.200Z", option: 0, text: "q4: Squash: one clean commit" }]);
  expect(text(dialog)).toContain("Answer sent");
  expect(text(dialog)).toContain("q4: Squash: one clean commit");
  fireEvent.click(slot.getByTestId("oats-confirm-close"));
  // the question stays until the agent clears it, with a quiet note that its answer went
  expect(text(slot.getByTestId("oats-panel-question-sent"))).toBe("Sent to the agent as its next input. The question stays until the agent clears it.");
  expect(text(slot.getByTestId("oats-panel-question-text"))).toBe("How should I merge the pull request?");
});

test("Cancel sends nothing; a number key opens the same dialog", async () => {
  const slot = panel();
  const zone = await slot.findByTestId("oats-panel-question");
  fireEvent.keyDown(zone, { key: "2" });
  expect(text(await slot.findByTestId("oats-panel-answer"))).toBe("Which base branch?q3: release: the 0.1 line");
  fireEvent.click(slot.getByTestId("oats-confirm-cancel"));
  await waitFor(() => expect(slot.queryByTestId("oats-confirm")).toBeNull());
  expect(calls(slot, "panelBoardAnswer")).toHaveLength(0);
  expect(slot.queryByTestId("oats-panel-question-sent")).toBeNull();
  // a number the question has no option for, and a key with a modifier, do nothing
  fireEvent.keyDown(zone, { key: "3" });
  fireEvent.keyDown(zone, { key: "1", ctrlKey: true });
  expect(slot.queryByTestId("oats-confirm")).toBeNull();
});

test("an answer the kernel refuses: why, in words, then the kernel's code and message; nothing reads as sent", async () => {
  const slot = panel({
    panelBoardAnswer: () => {
      throw new Error("E_SESSION_PROMPT_OPEN: bb thread thr_t9xz6jqajf waits on a person (1 pending user_question): nothing was sent. Answer it in bb. Open: pint_mnnkqxkpwh");
    },
  });
  await slot.findByTestId("oats-panel-question");
  fireEvent.click(options(slot)[0]!);
  fireEvent.click(await slot.findByTestId("oats-confirm-act"));
  const dialog = slot.getByTestId("oats-confirm");
  await waitFor(() => expect(dialog.getAttribute("data-phase")).toBe("failed"));
  expect(text(dialog)).toContain("The answer was not sent");
  expect(text(dialog)).toContain("The agent's thread is showing a prompt: answer it there first.");
  expect(text(dialog)).toContain("E_SESSION_PROMPT_OPEN");
  expect(text(dialog)).toContain("nothing was sent. Answer it in bb.");
  fireEvent.click(slot.getByTestId("oats-confirm-close"));
  expect(slot.queryByTestId("oats-panel-question-sent")).toBeNull();
});

test("a failure that is no refusal says the answer may have gone, and not to send it again", async () => {
  const slot = panel({
    panelBoardAnswer: () => {
      throw new Error("OATS_TIMEOUT: `oats` did not answer within 120 s and was stopped");
    },
  });
  await slot.findByTestId("oats-panel-question");
  fireEvent.click(options(slot)[0]!);
  fireEvent.click(await slot.findByTestId("oats-confirm-act"));
  const dialog = slot.getByTestId("oats-confirm");
  await waitFor(() => expect(dialog.getAttribute("data-phase")).toBe("failed"));
  expect(text(dialog)).toContain("It is not known whether the answer was sent");
  expect(text(dialog)).not.toContain("The answer was not sent");
  expect(text(dialog)).toContain("OATS did not answer, so the answer may have reached the agent. Do not send it again unless the agent asks.");
  expect(text(dialog)).toContain("OATS_TIMEOUT");
});

test("the line in the dialog is the line sent, character for character: an id that ends in a secret's word, an option with spaces", async () => {
  const slot = panel({}, { board: (board) => ({ ...board, questions: [{ ...board.questions[0]!, id: "api-key", options: ["yes   please", "Keep it"] }] }) });
  await slot.findByTestId("oats-panel-question");
  expect(options(slot).map((option) => (option as HTMLButtonElement).disabled)).toEqual([false, false]);
  fireEvent.click(options(slot)[0]!);
  expect(text(await slot.findByTestId("oats-panel-answer-line"))).toBe("api-key: yes   please");
  fireEvent.click(slot.getByTestId("oats-confirm-act"));
  await waitFor(() => expect(calls(slot, "panelBoardAnswer")).toHaveLength(1));
  expect((calls(slot, "panelBoardAnswer")[0]!.input as { text: string }).text).toBe("api-key: yes   please");
});

test("an agent on tmux: its questions are shown, the answers are off, and the zone says to type the answer in its terminal", async () => {
  const slot = panel({}, { answer: (answer) => ({ ...answer, answerable: false }) });
  await slot.findByTestId("oats-panel-question");
  expect(text(slot.getByTestId("oats-panel-question-note"))).toBe("This agent runs in a terminal, not in a bb thread: type the answer in its terminal (for example q3: main: the default).");
  expect(options(slot).every((option) => (option as HTMLButtonElement).disabled)).toBe(true);
  fireEvent.keyDown(slot.getByTestId("oats-panel-question"), { key: "1" });
  expect(slot.queryByTestId("oats-confirm")).toBeNull();
});

test("a detail read again keeps what the last one showed until the next lands: an open context, a sparkline", async () => {
  let release: (() => void) | null = null;
  let reads = 0;
  let board: PanelBoard | null = null;
  const slot = panel(
    { panelBoard: () => (++reads === 1 ? recordedBoard() : new Promise((done) => (release = () => done(recordedBoard())))) },
    { board: (recorded) => board ?? recorded },
  );
  await slot.findByTestId("oats-panel-question");
  fireEvent.click(slot.getByTestId("oats-panel-question-next"));
  const fold = await slot.findByTestId("oats-panel-question-context");
  await waitFor(() => expect(text(fold)).toContain("I rebased the branch"));
  await waitFor(() => expect(slot.queryByTestId("oats-panel-fact-spark")).not.toBeNull());
  // a fact changes: the detail is read again, and that read is slow
  const recorded = instanceAnswer(CHILD, undefined, ROSTER).board;
  board = { ...recorded, facts: recorded.facts.map((fact) => (fact.key === "pr" ? { ...fact, at: "2026-11-21T18:29:35.000Z" } : fact)) };
  await act(async () => slot.behavior.emitRealtime("oats/changed", { at: "2026-11-21T18:29:50.000Z" }));
  await waitFor(() => expect(reads).toBe(2));
  expect(text(fold)).toContain("I rebased the branch");
  expect(text(fold)).not.toContain("Reading the context…");
  expect(slot.queryByTestId("oats-panel-fact-spark")).not.toBeNull();
  act(() => release?.());
});

test("an answer OATS could not see land says so, and not to send it again", async () => {
  const slot = panel({ panelBoardAnswer: ({ text: line }) => ({ submitted: true, verified: false, text: line }) });
  await slot.findByTestId("oats-panel-question");
  fireEvent.click(options(slot)[0]!);
  fireEvent.click(await slot.findByTestId("oats-confirm-act"));
  await waitFor(() => expect(slot.getByTestId("oats-confirm").getAttribute("data-phase")).toBe("done"));
  expect(text(slot.getByTestId("oats-confirm"))).toContain("OATS saw no change on the agent's session yet. That is no sign it was lost: do not send it again unless the agent asks.");
});

test("while the agent's thread shows a prompt of its harness, the answers are off and the zone says why", async () => {
  // The roster recorded while Claude's own question was open: the row's claim is the harness's, reason `question`.
  vi.useFakeTimers({ now: NOW, toFake: ["Date"] });
  const agents = panelAgents("status-question.json");
  const asking = agents.find((agent) => agent.instance === CHILD)!;
  const slot = renderSlot<{ threadId: string }, Contract>({ component: InstancePanel }, { threadId: asking.threadId! }, {
    rpc: handlers({ snapshot: () => panelSnapshot(agents), panelInstance: ({ instance }) => instanceAnswer(instance, undefined, "status-question.json") }),
    sidebarThreads: panelThreads(agents),
  });
  await slot.findByTestId("oats-panel-question");
  expect(asking.waiting?.reason).toBe("question");
  expect(text(slot.getByTestId("oats-panel-question-note"))).toBe("The agent's thread is showing a prompt: answer it there first.");
  expect(options(slot).every((option) => (option as HTMLButtonElement).disabled)).toBe(true);
  fireEvent.keyDown(slot.getByTestId("oats-panel-question"), { key: "1" });
  expect(slot.queryByTestId("oats-confirm")).toBeNull();
  // that claim is not the board's: Needs input says it
  expect(slot.getByTestId("oats-panel-waiting")).not.toBeNull();
});

test("a question or an option that may hold a secret is not shown and cannot be sent", async () => {
  const slot = panel({}, {
    board: (board) => ({
      ...board,
      questions: [{ ...board.questions[0]!, options: ["use token=abc123", "main: the default"], optionsWithheld: [true, false] }, { ...board.questions[1]!, question: "password: hunter2 ok?", withheld: true }],
    }),
  });
  await slot.findByTestId("oats-panel-question");
  expect(options(slot).map((option) => [text(option), (option as HTMLButtonElement).disabled])).toEqual([["1[withheld]", true], ["2main: the default", false]]);
  fireEvent.click(slot.getByTestId("oats-panel-question-next"));
  expect(text(slot.getByTestId("oats-panel-question-text"))).toBe("[withheld]");
  expect(options(slot).every((option) => (option as HTMLButtonElement).disabled)).toBe(true);
  expect(answerLine({ ...recordedBoard().questions[0]!, withheld: true }, 0)).toBeNull();
});

// ---- facts

test("Facts: label, value and unit, when it changed, a sparkline once the history holds two numbers", async () => {
  const slot = panel();
  const section = await slot.findByTestId("oats-panel-facts");
  expect(text(within(section).getByRole("heading"))).toBe("Facts2");
  const rows = within(section).getAllByTestId("oats-panel-fact");
  expect(rows.map((row) => row.querySelector('[role="group"]')!.getAttribute("aria-label"))).toEqual(["Pull request: #42, updated 15 min ago", "Tests: 3 failing, updated 15 min ago"]);
  // the history comes with the detail read: "12" then "3"
  await waitFor(() => expect(rows[1]!.querySelector('[data-testid="oats-panel-fact-spark"]')).not.toBeNull());
  expect(text(rows[1]!)).toContain("last 2");
  expect(rows[0]!.querySelector('[data-testid="oats-panel-fact-spark"]')).toBeNull();
  expect(rows[1]!.querySelector('[data-testid="oats-panel-fact-spark"]')!.getAttribute("aria-hidden")).toBe("true");
});

test("a fact's link shows its whole address first, said to be the agent's, and only Open in browser opens it", async () => {
  const opened: unknown[][] = [];
  vi.stubGlobal("open", (...args: unknown[]) => void opened.push(args));
  const slot = panel();
  const link = await slot.findByTestId("oats-panel-fact-link");
  expect(link.getAttribute("aria-label")).toBe("The address Panel worktree helper gives, on github.com: show it");
  expect(text(link)).toBe("Panel worktree helper says:github.com…");
  expect(link.getAttribute("aria-expanded")).toBe("false");
  expect(slot.queryByTestId("oats-panel-fact-address")).toBeNull();
  fireEvent.click(link);
  const address = slot.getByTestId("oats-panel-fact-address");
  expect(address.getAttribute("aria-label")).toBe("The address Panel worktree helper gives");
  expect(text(address)).toBe("Panel worktree helper says:https://github.com/oats-project/oats-bb/pull/42Open in browser");
  expect(opened).toEqual([]);
  fireEvent.click(slot.getByTestId("oats-panel-fact-open"));
  expect(opened).toEqual([["https://github.com/oats-project/oats-bb/pull/42", "_blank", "noopener,noreferrer"]]);
  vi.unstubAllGlobals();
});

test("three facts show and the rest fold; a fact is hidden on this computer with its × or u, comes back with N hidden · show, and by itself when its value changes", async () => {
  const more = (board: PanelBoard): PanelBoard => ({
    ...board,
    facts: ["a", "b", "c", "d", "e"].map((key, index) => ({ ...board.facts[1]!, key, label: `Fact ${key}`, value: String(index), unit: null })),
  });
  const slot = panel({ panelBoard: () => ({ state: "unsupported", facts: [], questions: [], dropped: 0 }) }, { board: more });
  const section = await slot.findByTestId("oats-panel-facts");
  const labels = () => within(section).getAllByTestId("oats-panel-fact").map((row) => text(row.querySelector("span span")!));
  expect(labels()).toEqual(["Fact a", "Fact b", "Fact c"]);
  const fold = slot.getByTestId("oats-panel-facts-more");
  expect([text(fold), fold.getAttribute("aria-expanded")]).toEqual(["2 more", "false"]);
  fireEvent.click(fold);
  expect(labels()).toEqual(["Fact a", "Fact b", "Fact c", "Fact d", "Fact e"]);
  expect(text(slot.getByTestId("oats-panel-facts-more"))).toBe("Fold");
  // an OATS that sends no history says so, once
  await waitFor(() => expect(text(slot.getByTestId("oats-panel-facts-note"))).toBe("This OATS sends no history."));
  const hide = within(section).getAllByTestId("oats-panel-fact-hide");
  expect([hide[1]!.getAttribute("aria-label"), hide[1]!.getAttribute("title")]).toEqual(["Hide Fact b on this computer", "Hide on this computer (u)"]);
  fireEvent.click(hide[1]!);
  expect(labels()).toEqual(["Fact a", "Fact c", "Fact d", "Fact e"]);
  fireEvent.keyDown(within(section).getAllByTestId("oats-panel-fact")[0]!, { key: "u" });
  expect(labels()).toEqual(["Fact c", "Fact d", "Fact e"]);
  expect(text(slot.getByTestId("oats-panel-facts-hidden"))).toBe("2 hidden · show");
  // it is this computer's: kept in the browser's storage, by the agent's home
  expect(JSON.parse(localStorage.getItem("oats.bb.board.hidden")!)).toEqual({ "/abs/deployment/agents/oats-expert/instances/panel-worktree-helper": { b: "1", a: "0" } });
  fireEvent.click(slot.getByTestId("oats-panel-facts-hidden"));
  expect(labels()).toEqual(["Fact a", "Fact b", "Fact c", "Fact d", "Fact e"]);
  expect(localStorage.getItem("oats.bb.board.hidden")).toBe("{}");
  // a hidden fact whose value changed shows again
  const facts = more(recordedBoard()).facts;
  expect(factsView(facts, new Map([["a", "0"], ["b", "old"]]), true)).toMatchObject({ shown: [{ key: "b" }, { key: "c" }, { key: "d" }, { key: "e" }], hidden: [{ key: "a" }] });
});

test("what the board cannot show is said: entries left out, a board that is not one; an agent with no board shows neither section", async () => {
  const dropped = panel({}, { board: (board) => ({ ...board, dropped: 2 }) });
  expect(text(await dropped.findByTestId("oats-panel-facts-note"))).toBe("2 entries of this agent's board could not be shown.");
  dropped.unmount();
  resetApp();
  const malformed = panel({}, { board: () => ({ state: "malformed", facts: [], questions: [], dropped: 0 }) });
  expect(text(await malformed.findByTestId("oats-panel-facts-note"))).toBe("This agent's board could not be read.");
  expect(malformed.queryByTestId("oats-panel-questions")).toBeNull();
  malformed.unmount();
  resetApp();
  const none = panel({}, { board: () => ({ state: "none", facts: [], questions: [], dropped: 0 }), answer: (answer) => ({ ...answer, boardClaim: false }) });
  await none.findByTestId("oats-panel-work");
  expect(none.queryByTestId("oats-panel-facts")).toBeNull();
  expect(none.queryByTestId("oats-panel-questions")).toBeNull();
  // nothing of a board to add: no detail read
  expect(calls(none, "panelBoard")).toHaveLength(0);
});

test("the detail is read again only when a fact's instant or a question with a context changes", async () => {
  let board: PanelBoard | null = null;
  const slot = panel({}, { board: (recorded) => board ?? recorded });
  await slot.findByTestId("oats-panel-facts");
  await waitFor(() => expect(calls(slot, "panelBoard")).toHaveLength(1));
  // the same board read again: nothing more
  await act(async () => slot.behavior.emitRealtime("oats/changed", { at: "2026-11-21T18:29:40.000Z" }));
  await waitFor(() => expect(calls(slot, "panelInstance").length).toBeGreaterThan(1));
  expect(calls(slot, "panelBoard")).toHaveLength(1);
  // a fact changed
  const recorded = instanceAnswer(CHILD, undefined, ROSTER).board;
  board = { ...recorded, facts: recorded.facts.map((fact) => (fact.key === "tests" ? { ...fact, value: "0", at: "2026-11-21T18:29:35.000Z" } : fact)) };
  await act(async () => slot.behavior.emitRealtime("oats/changed", { at: "2026-11-21T18:29:50.000Z" }));
  await waitFor(() => expect(calls(slot, "panelBoard")).toHaveLength(2));
  expect(detailSignature(board)).not.toBe(detailSignature(recorded));
});

// ---- the words

test("the board's words: when a fact changed, when a question was asked, the keys, the sparkline's numbers", () => {
  const at = Date.parse("2026-11-21T12:00:00.000Z");
  expect([30_000, 4 * 60_000, 3 * 3_600_000, 2 * 86_400_000, 40 * 86_400_000, -5_000].map((ago) => updatedText(new Date(at - ago).toISOString(), at))).toEqual([
    "updated just now", "updated 4 min ago", "updated 3 h ago", "updated 2 d ago", "updated 2026-10-12", "updated just now",
  ]);
  expect(updatedText("never", at)).toBe("");
  expect([askedText(new Date(at - 20_000).toISOString(), at), askedText(new Date(at - 4 * 60_000).toISOString(), at)]).toEqual(["asked just now", "asked 4 min ago"]);
  expect([zoneHint(2, 1), zoneHint(4, 3)]).toEqual(["1–2 choose an answer · c the context", "1–4 choose an answer · ← → the other questions · c the context"]);
  expect([turnQuestion(0, -1, 3), turnQuestion(2, 1, 3), turnQuestion(0, 1, 0)]).toEqual([2, 0, 0]);
  const history = (values: string[]) => values.map((value) => ({ value, at: "2026-11-21T12:00:00.000Z" }));
  expect(sparkValues(history(["0.4312", "41 %", "done", "-3,5"]))).toEqual([0.4312, 41, -3.5]);
  expect(sparkValues(history(["12"]))).toBeNull();
  expect(sparkValues(null)).toBeNull();
});
