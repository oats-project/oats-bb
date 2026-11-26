// The agent's board, read (model/board.ts): the OATS Desktop's own cases of its board module
// (packages/desktop/test/instance-board.test.mjs), carried over with the rules, and the row the
// real kernel printed (test/fixtures/panel/status-board.json).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { answerText, boardClaim, boardContext, boardData, boardDetailData, boardLink, detailSignature, dialogOpen, FACTS_SHOWN, factsView, questionOccurrence, sparkValues, turnQuestion } from "../../model/board";

const AT = "2026-11-19T10:00:00.000Z";
const fact = (key: string, over: Record<string, unknown> = {}) => ({ key, label: "Best score", value: "0.4312", unit: null, link: null, at: AT, ...over });
const question = (id: string, over: Record<string, unknown> = {}) => ({ id, question: "Squash before merging?", options: ["Yes, one clean commit", "No, keep the history"], hasContext: false, since: AT, ...over });
const board = () => ({ facts: [fact("score"), fact("pr", { label: "Pull request", value: "#1990", link: "https://github.com/oats-project/oats/pull/1990" })], questions: [question("q1"), question("q2", { hasContext: true })] });

describe("a row's board", () => {
  test("is read whole: facts in the order set, questions in the order asked", () => {
    const out = boardData(board())!;
    expect(out.facts.map((each) => each.key)).toEqual(["score", "pr"]);
    expect(out.questions.map((each) => each.id)).toEqual(["q1", "q2"]);
    expect(out.facts[1]!.link).toEqual({ href: "https://github.com/oats-project/oats/pull/1990", host: "github.com" });
    expect(boardData(null)).toBeNull(); // the home has no board file
    expect(boardData(undefined)).toBeNull(); // an older kernel: no key
    expect(boardData({})).toEqual({ facts: [], questions: [], malformed: false, dropped: 0 });
  });

  test("a malformed entry drops only itself, within the kernel's bounds", () => {
    const out = boardData({
      facts: [fact("ok"), fact("Bad Key"), fact("long", { label: "x".repeat(41) }), fact("ctl", { value: "a\u0007b" }), fact("http", { link: "http://example.com" }), fact("cred", { link: "https://u:p@example.com" }), fact("ok")],
      questions: [question("q1", { options: ["only one"] }), question("q2", { options: ["a", "b", "c", "d", "e"] }), question("q3", { question: "two\nlines" }), question("q4")],
    })!;
    expect(out.facts.map((each) => each.key)).toEqual(["ok"]); // a bad key, a long label, a control character, http, credentials, a repeated key
    expect(out.questions.map((each) => each.id)).toEqual(["q4"]); // 2 to 4 options, one line
    const many = boardData({ facts: Array.from({ length: 20 }, (_, index) => fact(`f${index}`)), questions: Array.from({ length: 12 }, (_, index) => question(`q${index}`)) })!;
    expect([many.facts.length, many.questions.length]).toEqual([12, 9]);
  });

  test("no board, an empty board and one that cannot be read are told apart; what was left out is counted", () => {
    expect(boardData({ facts: [], questions: [] })).toEqual({ facts: [], questions: [], malformed: false, dropped: 0 });
    expect(boardData("board")!.malformed).toBe(true);
    expect(boardData({ facts: "x" })!.malformed).toBe(true);
    expect(boardData({ facts: [fact("a"), fact("BAD")], questions: [question("q1", { options: [] })] })!.dropped).toBe(2);
  });

  test("a fact whose address the display filter withholds keeps its value and loses its link", () => {
    const facts = boardData({
      facts: [
        { key: "ci", label: "CI", value: "green", unit: null, link: "https://ci.example.com/run?token=abc123", at: AT },
        { key: "pat", label: "Repo", value: "oats", unit: null, link: "https://example.com/ghp_0123456789abcdefABCDEF", at: AT },
        { key: "pr", label: "PR", value: "#1", unit: null, link: "https://github.com/oats-project/oats/pull/1", at: AT },
      ],
      questions: [],
    })!.facts;
    expect(facts.map((each) => [each.key, each.value, each.link?.href ?? null])).toEqual([
      ["ci", "green", null],
      ["pat", "oats", null],
      ["pr", "#1", "https://github.com/oats-project/oats/pull/1"],
    ]);
  });

  test("an address is https, absolute, printable ASCII, with a host and no credentials", () => {
    expect(boardLink("https://github.com/x")).toEqual({ href: "https://github.com/x", host: "github.com" });
    for (const bad of ["http://github.com/x", "https://u:p@github.com", "/relative", "https://exa mple.com", "javascript:alert(1)", "", 3, `https://example.com/${"x".repeat(520)}`]) expect(boardLink(bad), String(bad)).toBeNull();
  });

  test("the row the real kernel printed (recorded) reads as two facts, one question and the board's own claim", () => {
    const status = JSON.parse(readFileSync(join(__dirname, "..", "fixtures", "panel", "status-board.json"), "utf8")) as { agents: { instances: { instance: string; board?: unknown; waitingOnYou?: { producer?: string } }[] }[] };
    const row = status.agents.flatMap((group) => group.instances).find((each) => each.board !== undefined && each.board !== null)!;
    const read = boardData(row.board)!;
    expect([read.malformed, read.dropped]).toEqual([false, 0]);
    expect(read.facts.map((each) => [each.key, each.label, each.value, each.unit, each.link?.host ?? null])).toEqual([
      ["pr", "Pull request", "#42", null, "github.com"],
      ["tests", "Tests", "3", "failing", null],
    ]);
    expect(read.questions.map((each) => [each.id, each.question, each.options, each.hasContext])).toEqual([["q3", "Which base branch?", ["main: the default", "release: the 0.1 line"], false]]);
    expect(boardClaim(row.waitingOnYou)).toBe(true);
  });
});

describe("answering", () => {
  test("the answer is `<id>: <option>`: never a bare digit, never a line end, never a text the display filter withholds", () => {
    const asked = boardData({ questions: [question("q2", { options: ["Yes, one clean commit", "token=abcdefgh"] })] })!.questions[0]!;
    expect(answerText(asked, 0)).toBe("q2: Yes, one clean commit");
    expect(answerText(asked, 1)).toBeNull(); // an option the display filter withholds is not sent
    expect(answerText(asked, 2)).toBeNull(); // no such option
    expect(answerText(asked, 0)).not.toMatch(/^\d+$|[\r\n]/);
  });

  test("a live permission or question claim, of any producer, says a harness dialog is open; the board's own claim does not; unknown does not", () => {
    expect(dialogOpen({ producer: "pi.harness", reason: "permission" })).toBe(true);
    expect(dialogOpen({ producer: "x", reason: "question" })).toBe(true);
    expect(dialogOpen({ producer: "oats.board", reason: "attention" })).toBe(false);
    expect(dialogOpen(null)).toBe(false);
    expect(dialogOpen(undefined)).toBe(false);
    expect([boardClaim({ producer: "oats.board" }), boardClaim({ producer: "agent" }), boardClaim(null)]).toEqual([true, false, false]);
  });

  test("turning the questions wraps at the ends; a question asked again is another occurrence", () => {
    expect([turnQuestion(0, -1, 3), turnQuestion(2, 1, 3), turnQuestion(0, 1, 0)]).toEqual([2, 0, 0]);
    expect(questionOccurrence({ id: "q2", since: AT })).toBe(`q2@${AT}`);
    expect(questionOccurrence({ id: "q2", since: AT })).not.toBe(questionOccurrence({ id: "q2", since: "2026-11-19T11:00:00.000Z" }));
  });
});

describe("the facts shown", () => {
  test("three are shown and the rest folded; a hidden fact shows again when its value changes", () => {
    const facts = boardData({ facts: ["a", "b", "c", "d", "e"].map((key) => fact(key)) })!.facts;
    const view = factsView(facts);
    expect(FACTS_SHOWN).toBe(3);
    expect([view.shown.map((each) => each.key), view.folded.map((each) => each.key)]).toEqual([["a", "b", "c"], ["d", "e"]]);
    const hidden = factsView(facts, new Map([["a", "0.4312"], ["b", "an older value"]]));
    expect([hidden.hidden.map((each) => each.key), hidden.shown.map((each) => each.key)]).toEqual([["a"], ["b", "c", "d"]]);
    expect(factsView(facts, new Map(), { unfolded: true }).shown).toHaveLength(5);
  });
});

describe("the detail (`oats inspect --home --board`)", () => {
  test("gives each fact's history and each question's context; a small line needs two numbers", () => {
    const detail = boardDetailData({
      board: { facts: [{ key: "score", history: [{ value: "0.40", at: AT }, { value: "41 %", at: AT }, { value: "x\u0007", at: AT }] }], questions: [{ id: "q1", context: "a\nb" }, { id: "q2", context: "a\u0007" }] },
    });
    if (detail.state !== "ok") throw new Error(detail.state);
    expect(detail.facts.get("score")!.history.map((held) => held.value)).toEqual(["0.40", "41 %"]);
    expect([detail.questions.get("q1")!.context, detail.questions.get("q2")!.context]).toEqual(["a\nb", null]);
    expect(sparkValues(detail.facts.get("score")!.history)).toEqual([0.4, 41]);
    expect(sparkValues([{ value: "1" }])).toBeNull();
    expect(sparkValues([{ value: "green" }, { value: "red" }])).toBeNull();
    const inInstance = boardDetailData({ instance: { board: { facts: [], questions: [] } } });
    expect(inInstance.state === "ok" && inInstance.facts.size).toBe(0); // `instance.board` is read too
  });

  test("no board, an OATS that sends none, and an answer that cannot be read are distinct outcomes", () => {
    expect(boardDetailData({ board: null })).toEqual({ state: "none" });
    expect(boardDetailData({ operationsApi: 2 })).toEqual({ state: "unsupported" });
    expect(boardDetailData("x")).toEqual({ state: "malformed" });
    expect(boardDetailData({ board: { facts: {} } })).toEqual({ state: "malformed" });
    expect(boardDetailData({ board: { facts: [], questions: [] } }).state).toBe("ok");
  });

  test("history and context stay within the contract's bounds, and stay TEXT", () => {
    const detail = boardDetailData({
      board: { facts: [{ key: "a", history: [{ value: "y".repeat(81), at: AT }, { value: "<b>1</b>", at: AT }] }], questions: [{ id: "q1", context: "x".repeat(2001) }, { id: "q2", context: "<img src=x onerror=alert(1)>" }] },
    });
    if (detail.state !== "ok") throw new Error(detail.state);
    expect(detail.facts.get("a")!.history.map((held) => held.value)).toEqual(["<b>1</b>"]); // a value over 80 code points is left out
    expect(detail.questions.get("q1")!.context).toBeNull(); // over 2000 code points
    expect(detail.questions.get("q2")!.context).toBe("<img src=x onerror=alert(1)>"); // text: whoever draws it draws it as text
    const many = boardDetailData({ board: { facts: [{ key: "a", history: Array.from({ length: 30 }, (_, index) => ({ value: String(index), at: AT })) }], questions: [] } });
    expect(many.state === "ok" && many.facts.get("a")!.history.length).toBe(20);
    expect([boardContext("token=abcdefgh"), boardContext("  \n "), boardContext(4)]).toEqual([null, null, null]);
  });

  test("is read again when a fact changed or a question with context was asked, never for an unchanged board", () => {
    const one = boardData(board());
    expect(detailSignature(one)).toBe(detailSignature(boardData(board())));
    expect(detailSignature(one)).not.toBe(detailSignature(boardData({ ...board(), facts: [fact("score", { at: "2026-11-19T10:05:00.000Z" })] })));
    expect(detailSignature(one)).not.toBe(detailSignature(boardData({ ...board(), questions: [question("q1"), question("q2", { hasContext: true, since: "2026-11-19T10:06:00.000Z" })] })));
    // A question with no context asked again asks for no new read.
    expect(detailSignature(one)).toBe(detailSignature(boardData({ ...board(), questions: [question("q1", { since: "2026-11-19T10:06:00.000Z" }), question("q2", { hasContext: true })] })));
    expect(detailSignature(null)).toBe("none");
  });
});
