// @vitest-environment jsdom
// The board as a person sees it (app/board/Board.tsx): questions first, then facts; what cannot be
// shown, said in its place; every word of it the agent's, as text.
import { afterEach, expect, test, vi } from "vitest";
import { act, fireEvent, waitFor, within } from "@testing-library/react";
import { renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { Board, forgetHidden } from "../../app/board";
import { handlers, loadApp, resetApp } from "../helpers/render";
import type { Contract } from "../helpers/render";
import { BOARD_AT } from "./handlers";

afterEach(() => {
  resetApp();
  forgetHidden();
  vi.useRealTimers();
});

const NOW = Date.parse("2026-11-23T18:16:56.000Z");
const AGENT = "panel-worktree-helper";
const AT = "2026-11-23T18:00:58.000Z"; // 16 min before NOW
const fact = (key: string, over: Record<string, unknown> = {}) => ({ key, label: "Tests", value: "3", unit: "failing", link: null, at: AT, ...over });
const question = (id: string, over: Record<string, unknown> = {}) => ({ id, question: "Which base branch?", options: ["main: the default", "release: the 0.1 line"], hasContext: false, since: "2026-11-23T18:01:45.724Z", ...over });
type Given = { board?: unknown; supported?: boolean; detail?: unknown | (() => unknown); claim?: { producer: string | null; reason: string | null } | null };

async function drawn(given: Given, over: Parameters<typeof handlers>[0] = {}) {
  await loadApp();
  vi.useFakeTimers({ now: NOW, toFake: ["Date"] });
  const asked: string[] = [];
  const slot = renderSlot<{ instance: string }, Contract>({ component: Board }, { instance: AGENT }, {
    rpc: handlers({
      board: () => ({ at: BOARD_AT, supported: given.supported ?? true, stale: false, board: given.board ?? null, claim: given.claim ?? null }),
      boardDetail: () => {
        asked.push("detail");
        const detail = typeof given.detail === "function" ? (given.detail as () => unknown)() : given.detail;
        return { inspection: (detail ?? { instance: { board: null } }) as Record<string, unknown> };
      },
      ...over,
    }),
  });
  // Until the board's read has answered, and the detail's where one is read.
  await waitFor(() => expect(slot.getByTestId("oats-board").getAttribute("data-state")).not.toBe("reading"));
  await act(async () => {});
  await waitFor(() => expect(slot.queryByTestId("oats-board-context-reading")).toBeNull());
  await act(async () => {});
  return { slot, asked };
}
const texts = (root: HTMLElement, id: string) => within(root).queryAllByTestId(id).map((each) => each.textContent);

test("an agent with no board, and one whose board is empty, says the one line; a kernel that reports no boards draws nothing", async () => {
  const none = await drawn({ board: null });
  expect(none.slot.getByTestId("oats-board").getAttribute("data-state")).toBe("empty");
  expect(texts(none.slot.container, "oats-board-nothing")).toEqual(["This agent has no questions or facts to show."]);
  expect(none.asked).toEqual([]); // nothing to read a detail for
  resetApp();
  const empty = await drawn({ board: { facts: [], questions: [] } });
  expect(texts(empty.slot.container, "oats-board-nothing")).toEqual(["This agent has no questions or facts to show."]);
  resetApp();
  const old = await drawn({ supported: false });
  expect(old.slot.getByTestId("oats-board").textContent).toBe("");
});

test("questions come first, then facts; a question is its age, its text and its numbered options, and nothing tells how to answer", async () => {
  const { slot } = await drawn({ board: { facts: [fact("tests")], questions: [question("q3")] } });
  const board = slot.getByTestId("oats-board");
  const order = Array.from(board.querySelectorAll('[data-testid="oats-board-questions"], [data-testid="oats-board-facts"]')).map((each) => each.getAttribute("data-testid"));
  expect(order).toEqual(["oats-board-questions", "oats-board-facts"]);
  const zone = slot.getByTestId("oats-board-questions");
  expect(texts(zone, "oats-board-question")).toEqual(["Which base branch?"]);
  expect(texts(zone, "oats-board-option")).toEqual(["1main: the default", "2release: the 0.1 line"]);
  // One question: no place, no turning; its age alone, the instant in the title.
  expect(within(zone).queryByTestId("oats-board-place")).toBeNull();
  expect(within(zone).queryByTestId("oats-board-previous")).toBeNull();
  const age = within(zone).getByTestId("oats-board-age");
  expect([age.textContent, age.getAttribute("title")]).toEqual(["15 min ago", "2026-11-23T18:01:45.724Z"]);
  expect(zone.textContent).not.toMatch(/asked|updated|Answer|type|thread|terminal/i);
  // No Context fold where the agent sent none.
  expect(within(zone).queryByTestId("oats-board-context")).toBeNull();
  expect(zone.querySelectorAll("button")).toHaveLength(0);
});

test("several questions: one at a time, \"2 of 3\", turned by ‹ and › (wrapping) and by the arrow keys on the zone", async () => {
  const { slot } = await drawn({ board: { facts: [], questions: [question("q1", { question: "First?" }), question("q2", { question: "Second?" }), question("q3", { question: "Third?" })] } });
  const zone = slot.getByTestId("oats-board-questions");
  const shownNow = () => [within(zone).getByTestId("oats-board-place").textContent, within(zone).getByTestId("oats-board-question").textContent, Array.from(within(zone).getByTestId("oats-board-dots").children).findIndex((dot) => dot.hasAttribute("data-current"))];
  expect(shownNow()).toEqual(["1 of 3", "First?", 0]);
  fireEvent.click(within(zone).getByRole("button", { name: "Next question" }));
  expect(shownNow()).toEqual(["2 of 3", "Second?", 1]);
  fireEvent.click(within(zone).getByRole("button", { name: "Previous question" }));
  fireEvent.click(within(zone).getByRole("button", { name: "Previous question" }));
  expect(shownNow()).toEqual(["3 of 3", "Third?", 2]); // it wraps
  zone.focus();
  fireEvent.keyDown(zone, { key: "ArrowRight" });
  expect(shownNow()).toEqual(["1 of 3", "First?", 0]);
  fireEvent.keyDown(zone, { key: "ArrowLeft" });
  expect(shownNow()).toEqual(["3 of 3", "Third?", 2]);
});

test("a fact is its label, its value and unit, its age; bb's own list is given every visible fact and the limit of three (it folds the rest behind its own \"N more\")", async () => {
  const { slot } = await drawn({ board: { facts: ["a", "b", "c", "d", "e"].map((key, index) => fact(key, { label: `Fact ${key}`, value: String(index) })), questions: [] } });
  const facts = slot.getByTestId("oats-board-facts");
  const rows = within(facts).getAllByTestId("oats-board-fact");
  // (The test host's stand-in for bb's list draws every item and keeps the limit it was given; the fold itself is bb's: the live scene shows it.)
  expect(rows.map((row) => row.getAttribute("data-key"))).toEqual(["a", "b", "c", "d", "e"]);
  expect(facts.querySelector("ul")!.getAttribute("data-limit")).toBe("3");
  expect(within(rows[0]!).getByTestId("oats-board-fact-value").textContent).toBe("0 failing");
  // ONE ORDER for every fact: the value over the label; the label is the part that gives way (its whole text in its title), never the value.
  expect(rows[0]!.textContent).toMatch(/^0 failingFact a16 min ago×$/); // the two lines, then the column of the age and the ×
  expect(within(rows[0]!).getByTestId("oats-board-fact-value").className).not.toMatch(/truncate|whitespace-nowrap/);
  const label = within(rows[0]!).getByTestId("oats-board-fact-label");
  expect([label.className.includes("truncate"), label.getAttribute("title")]).toEqual([true, "Fact a"]);
  const age = within(rows[0]!).getByTestId("oats-board-age");
  expect([age.textContent, age.getAttribute("title")]).toEqual(["16 min ago", AT]);
  expect(facts.textContent).not.toMatch(/updated/);
});

test("a fact hidden on this computer leaves the list and is counted; \"N hidden · show\" brings all back; it shows again by itself when its value changes", async () => {
  const board = { facts: [fact("tests"), fact("pr", { label: "Pull request", value: "#42", unit: null })], questions: [] };
  let now: unknown = board;
  const { slot } = await drawn({}, { board: () => ({ at: BOARD_AT, supported: true, stale: false, board: now, claim: null }) });
  const keys = () => within(slot.getByTestId("oats-board-facts")).queryAllByTestId("oats-board-fact").map((row) => row.getAttribute("data-key"));
  expect(keys()).toEqual(["tests", "pr"]);
  fireEvent.click(within(slot.getAllByTestId("oats-board-fact")[0]!).getByRole("button", { name: "Hide on this computer: Tests" }));
  expect(keys()).toEqual(["pr"]);
  expect(slot.getByTestId("oats-board-hidden").textContent).toBe("1 hidden · show");
  fireEvent.click(slot.getByTestId("oats-board-hidden"));
  expect(keys()).toEqual(["tests", "pr"]);
  expect(slot.queryByTestId("oats-board-hidden")).toBeNull();
  // Hidden again; then the agent says a new value: it is back.
  fireEvent.click(within(slot.getAllByTestId("oats-board-fact")[0]!).getByRole("button", { name: "Hide on this computer: Tests" }));
  expect(keys()).toEqual(["pr"]);
  now = { facts: [fact("tests", { value: "0" }), board.facts[1]], questions: [] };
  await act(async () => {
    slot.behavior.emitRealtime("oats/changed", { at: "2026-11-23T18:17:00.000Z" });
  });
  await waitFor(() => expect(keys()).toEqual(["tests", "pr"]));
});

test("a value is never cut, and every fact has the same two lines: a long value wraps on its own line, whole; the label, with the address's host after it, is the line under", async () => {
  const long = "1000 of 2000 checks passed on the release candidate, the rest wait for a runner"; // 78: within the kernel's 80
  const { slot } = await drawn({ board: { facts: [fact("long", { label: "Checks", value: long, unit: null, link: "https://github.com/oats-project/oats-bb/pull/42" }), fact("short", { label: "Tests", value: "3", unit: "failing" })], questions: [] } });
  const [first, second] = within(slot.getByTestId("oats-board-facts")).getAllByTestId("oats-board-fact");
  for (const row of [first!, second!]) {
    const value = within(row).getByTestId("oats-board-fact-value");
    const label = within(row).getByTestId("oats-board-fact-label");
    expect(value.className).not.toMatch(/truncate|whitespace-nowrap/);
    expect(value.parentElement!.className).toMatch(/break-words/);
    // the value's line is before the label's, in the same order for a long fact and a short one
    expect(value.compareDocumentPosition(label) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(value.parentElement!.parentElement).not.toBe(label.parentElement);
  }
  expect(within(first!).getByTestId("oats-board-fact-value").textContent).toBe(long);
  // the address belongs to its fact: on the label's own line, after it
  expect(within(first!).getByTestId("oats-board-fact-label").parentElement!.textContent).toBe("Checks · github.com");
  expect(within(second!).queryByTestId("oats-board-link")).toBeNull();
});

test("who says the addresses is said ONCE, on the Facts heading's line, and only where a fact in view has an address", async () => {
  const link = "https://github.com/oats-project/oats-bb/pull/42";
  const { slot } = await drawn({ board: { facts: [fact("a", { link }), fact("b", { link: "https://ci.example.org/runs/7" }), fact("c")], questions: [] } });
  expect(slot.getAllByTestId("oats-board-says").map((each) => each.textContent)).toEqual(["Panel worktree helper says"]);
  expect(slot.getAllByTestId("oats-board-link-show").map((each) => each.textContent)).toEqual(["github.com", "ci.example.org"]);
  resetApp();
  const none = await drawn({ board: { facts: [fact("c")], questions: [] } });
  expect(none.slot.queryByTestId("oats-board-says")).toBeNull();
});

test("a fact's address: the host alone at the row, as text; a press shows the whole address as text; only then Open in browser, which leaves bb", async () => {
  const { slot } = await drawn({ board: { facts: [fact("pr", { label: "Pull request", value: "#42", unit: null, link: "https://github.com/oats-project/oats-bb/pull/42" })], questions: [] } });
  const link = slot.getByTestId("oats-board-link");
  expect(within(link).getByTestId("oats-board-link-show").textContent).toBe("github.com");
  expect(within(link).getByTestId("oats-board-link-show").className).not.toMatch(/underline/); // the agent's text, not a link of ours
  const row = slot.getByTestId("oats-board-fact");
  expect(within(row).queryByTestId("oats-board-link-address")).toBeNull();
  expect(slot.getByTestId("oats-board-fact").querySelector("a")).toBeNull(); // never a link a click follows
  fireEvent.click(within(link).getByTestId("oats-board-link-show"));
  expect(within(row).getByTestId("oats-board-link-address").textContent).toBe("https://github.com/oats-project/oats-bb/pull/42");
  expect(slot.inspection.navigateCalls).toEqual([]);
  fireEvent.click(within(row).getByRole("button", { name: "Open in browser" }));
  expect(slot.inspection.navigateCalls).toEqual([{ method: "openUrl", url: "https://github.com/oats-project/oats-bb/pull/42" }]);
});

test("an address that looks like it holds a secret is never shown: the fact stays, with no link", async () => {
  const { slot } = await drawn({ board: { facts: [fact("ci", { label: "CI", value: "green", unit: null, link: "https://ci.example.com/run?token=abc123" })], questions: [] } });
  expect(within(slot.getByTestId("oats-board-fact")).getByTestId("oats-board-fact-value").textContent).toBe("green");
  expect(slot.queryByTestId("oats-board-link")).toBeNull();
  expect(slot.getByTestId("oats-board").textContent).not.toMatch(/token|abc123/);
});

test("the detail is read once the board is in view: a fact with two numbers in its history draws its small line; one read, and again only when the board it was read for changed", async () => {
  const board = { facts: [fact("tests")], questions: [] };
  let now: unknown = board;
  const detail = { instance: { board: { facts: [{ key: "tests", history: [{ value: "5", at: AT }, { value: "3", at: AT }] }], questions: [] } } };
  const { slot, asked } = await drawn({ detail }, { board: () => ({ at: BOARD_AT, supported: true, stale: false, board: now, claim: null }) });
  expect(asked).toEqual(["detail"]);
  expect(within(slot.getByTestId("oats-board-fact")).getByTestId("oats-board-spark").querySelector("polyline")!.getAttribute("points")!.split(" ")).toHaveLength(2);
  // The roster changes and the board is the same: no new read.
  await act(async () => {
    slot.behavior.emitRealtime("oats/changed", { at: "2026-11-23T18:17:00.000Z" });
  });
  await act(async () => {});
  await new Promise((resolve) => setTimeout(resolve, 30)); // (time for a read to be asked, if one were)
  expect(asked).toEqual(["detail"]);
  // The fact changed: read again.
  now = { facts: [fact("tests", { value: "2", at: "2026-11-23T18:16:00.000Z" })], questions: [] };
  await act(async () => {
    slot.behavior.emitRealtime("oats/changed", { at: "2026-11-23T18:17:30.000Z" });
  });
  await waitFor(() => expect(asked).toEqual(["detail", "detail"]));
});

test("a question's context is a fold, offered only where the agent sent one: the agent's text, plain, its line breaks kept", async () => {
  const detail = { instance: { board: { facts: [], questions: [{ id: "q3", context: "main is protected.\n<b>release</b> is the 0.1 line.", since: "2026-11-23T18:01:45.724Z" }] } } };
  const { slot } = await drawn({ board: { facts: [], questions: [question("q3", { hasContext: true })] }, detail });
  const fold = slot.getByTestId("oats-board-context");
  expect(fold.querySelector("summary")!.textContent).toMatch(/Context$/);
  const text = within(fold).getByTestId("oats-board-context-text");
  expect(text.className).toMatch(/max-h-\[33vh\]/); // a long context has a bound: a third of the window,
  expect(text.className).toMatch(/overflow-y-auto/); // and scrolls alone (reached by the keyboard: it takes the focus)
  expect(text.getAttribute("tabindex")).toBe("0");
  expect(text.textContent).toBe("main is protected.\n<b>release</b> is the 0.1 line.");
  expect(text.querySelector("b")).toBeNull(); // text, never markup
});

test("what cannot be shown is said in its place: a board that is no board, entries left out, a history that could not be read, an OATS that sends none, a context that could not be read", async () => {
  const unreadable = await drawn({ board: "not a board" });
  expect(texts(unreadable.slot.container, "oats-board-unreadable")).toEqual(["This agent's board could not be read."]);
  expect(unreadable.slot.queryByTestId("oats-board-nothing")).toBeNull(); // never read as "nothing to show"
  resetApp();
  const dropped = await drawn({ board: { facts: [fact("tests"), fact("BAD KEY")], questions: [question("q1", { options: ["one"] })] } });
  expect(texts(dropped.slot.container, "oats-board-dropped")).toEqual(["2 entries of this agent's board could not be shown."]);
  expect(within(dropped.slot.getByTestId("oats-board-facts")).getAllByTestId("oats-board-fact")).toHaveLength(1);
  resetApp();
  const failed = await drawn({ board: { facts: [fact("tests")], questions: [question("q3", { hasContext: true })] } }, {
    boardDetail: () => {
      throw new Error("E_HOME_MISSING: no such home");
    },
  });
  expect(texts(failed.slot.container, "oats-board-history-failed")).toEqual(["History could not be read."]);
  expect(texts(failed.slot.container, "oats-board-context-failed")).toEqual(["The context could not be read."]);
  expect(failed.slot.getByTestId("oats-board-history-failed").getAttribute("data-tone")).toBe("warning");
  expect(failed.slot.getByTestId("oats-board-context-failed").getAttribute("data-tone")).toBe("warning"); // a read FAILED
  resetApp();
  // A detail that was READ and holds no context for the question (the kernel sent none, or the display filter withholds it): said quietly, nothing failed.
  const without = await drawn({ board: { facts: [], questions: [question("q3", { hasContext: true })] }, detail: { instance: { board: { facts: [], questions: [{ id: "q3", since: question("q3").since, context: null }] } } } });
  await waitFor(() => expect(texts(without.slot.container, "oats-board-context-failed")).toEqual(["The context could not be read."]));
  expect(without.slot.getByTestId("oats-board-context-failed").getAttribute("data-tone")).toBeNull();
  resetApp();
  // A detail read for an EARLIER occurrence of the question: its context is never shown under this one, and nothing failed.
  const earlier = await drawn({ board: { facts: [], questions: [question("q3", { hasContext: true })] }, detail: { instance: { board: { facts: [], questions: [{ id: "q3", since: "2026-11-23T17:00:00.000Z", context: "from before" }] } } } });
  await waitFor(() => expect(texts(earlier.slot.container, "oats-board-context-failed")).toEqual(["The context could not be read."]));
  expect(earlier.slot.getByTestId("oats-board-context-failed").getAttribute("data-tone")).toBeNull();
  expect(earlier.slot.container.textContent).not.toContain("from before");
  resetApp();
  const none = await drawn({ board: { facts: [fact("tests")], questions: [] }, detail: { operationsApi: 2 } });
  expect(texts(none.slot.container, "oats-board-no-history")).toEqual(["This OATS sends no history."]);
  expect(none.slot.getByTestId("oats-board-no-history").getAttribute("data-tone")).toBeNull(); // quiet: nothing failed
});

test("the board's read failed with nothing held: said, with Retry; never an empty board", async () => {
  const { slot } = await drawn({}, {
    board: () => {
      throw new Error("E_CONFIG_BROKEN: oats-local.yaml cannot be read");
    },
  });
  expect(slot.getByTestId("oats-board").getAttribute("data-state")).toBe("failed");
  expect(texts(slot.container, "oats-board-unreadable")).toEqual(["This agent's board could not be read."]);
  expect(slot.getByRole("button", { name: "Retry" })).toBeTruthy();
  expect(slot.queryByTestId("oats-board-nothing")).toBeNull();
});
