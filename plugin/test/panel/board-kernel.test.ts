// The agent's board: `oats inspect --home --board` read into facts and questions, and the answer
// to a question as `oats session input`: against the answers recorded from the real kernel.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { answerOf } from "../../kernel/envelope.js";
import { mkdtempSync, readdirSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { answerText, boardAnswerArgv, boardLink, checkAnswerText, panelBoard, panelBoardArgv, parseBoardAnswer, parsePanelBoard, rowBoard, type PanelQuestion } from "../../kernel/panel-board.js";
import { verbs } from "../../kernel/panel.js";
import type { Runner } from "../../kernel/runner.js";

const text = (name: string): string => readFileSync(resolve(process.cwd(), "test/fixtures/panel", name), "utf8");
type Inspection = Record<string, unknown> & { instance: Record<string, unknown> & { board: { facts: unknown[]; questions: unknown[] } | null } };
const recorded = (name = "inspect-board.json"): Inspection => structuredClone((JSON.parse(text(name)) as { result: Inspection }).result);
const HOME = "/abs/deployment/agents/oats-expert/instances/panel-worktree-helper";
/** What the kernel printed, as the plugin's reader of a finished process takes it. */
const printed = (name: string, code: number) => answerOf({ kind: "exit", code, signal: null, stdout: text(name), stderr: "" }, "oats");

describe("the board's read", () => {
  it("asks the kernel for the board of the home it named", () => {
    expect(panelBoardArgv(HOME)).toEqual({ ok: true, value: ["inspect", "--home", HOME, "--board", "--json"] });
    expect(panelBoardArgv("--board").ok).toBe(false);
  });

  it("the recorded board: two facts with their history, two questions, one with its context", () => {
    const answer = parsePanelBoard(recorded());
    expect(answer.ok).toBe(true);
    if (!answer.ok) return;
    expect(panelBoard.parse(answer.value)).toEqual(answer.value);
    expect(answer.value).toEqual({
      state: "ok",
      dropped: 0,
      facts: [
        {
          key: "pr", label: "Pull request", value: "#42", unit: null, link: { href: "https://github.com/oats-project/oats-bb/pull/42", host: "github.com" }, at: "2026-11-21T18:14:11.580Z", withheld: false,
          history: [{ value: "#42", at: "2026-11-21T18:14:11.580Z" }],
        },
        {
          key: "tests", label: "Tests", value: "3", unit: "failing", link: null, at: "2026-11-21T18:14:12.802Z", withheld: false,
          history: [{ value: "12", at: "2026-11-21T18:14:11.692Z" }, { value: "3", at: "2026-11-21T18:14:12.802Z" }],
        },
      ],
      questions: [
        {
          id: "q3", question: "Which base branch?", options: ["main: the default", "release: the 0.1 line"], withheld: false, optionsWithheld: [false, false], since: "2026-11-21T18:23:39.827Z",
          hasContext: false, context: null,
        },
        {
          id: "q4", question: "How should I merge the pull request?", options: ["Squash: one clean commit", "Merge: keep the three commits"], withheld: false, optionsWithheld: [false, false],
          since: "2026-11-21T18:26:49.200Z", hasContext: true,
          context: "Squash or merge the three commits\nI rebased the branch on main and all checks pass.\nI will merge with the method you pick.\nhttps://github.com/oats-project/oats-bb/pull/42",
        },
      ],
    });
  });

  it("a stop ends the session's questions and keeps the facts", () => {
    const answer = parsePanelBoard(recorded("inspect-board-stopped.json"));
    expect(answer.ok && { state: answer.value.state, facts: answer.value.facts.map((fact) => fact.key), questions: answer.value.questions }).toEqual({ state: "ok", facts: ["pr", "tests"], questions: [] });
  });

  it("no board, an OATS without boards and a board that is not one are told apart", () => {
    const none = recorded();
    none.instance.board = null;
    expect(parsePanelBoard(none)).toEqual({ ok: true, value: { state: "none", facts: [], questions: [], dropped: 0 } });
    const unsupported = recorded();
    delete (unsupported.instance as Record<string, unknown>).board;
    expect(parsePanelBoard(unsupported)).toMatchObject({ ok: true, value: { state: "unsupported" } });
    const malformed = recorded() as Record<string, unknown> & { instance: Record<string, unknown> };
    malformed.instance.board = { facts: "x" };
    expect(parsePanelBoard(malformed)).toMatchObject({ ok: true, value: { state: "malformed" } });
    const notInspection = parsePanelBoard("x");
    expect(!notInspection.ok && notInspection.error.code).toBe("OATS_BAD_ANSWER");
  });

  it("an entry out of the contract drops by itself and is counted", () => {
    const document = recorded();
    const board = document.instance.board!;
    board.facts.push(
      { key: "Bad Key", label: "x", value: "1", at: "2026-11-21T18:14:11.580Z" },
      { key: "long", label: "x".repeat(41), value: "1", at: "2026-11-21T18:14:11.580Z" },
      { key: "ftp", label: "x", value: "1", link: "http://example.com/", at: "2026-11-21T18:14:11.580Z" },
      { key: "pr", label: "again", value: "2", at: "2026-11-21T18:14:11.580Z" },
      { key: "ok", label: "Coverage", value: "41 %", unit: null, link: null, at: "2026-11-21T18:14:11.580Z" },
    );
    board.questions.push({ id: "q9", question: "One option?", options: ["only"], since: "2026-11-21T18:14:11.580Z" }, { id: "q8", question: "Line\nbreak?", options: ["a", "b"], since: "2026-11-21T18:14:11.580Z" });
    const answer = parsePanelBoard(document);
    expect(answer.ok && answer.value.facts.map((fact) => fact.key)).toEqual(["pr", "tests", "ok"]);
    expect(answer.ok && answer.value.questions.map((question) => question.id)).toEqual(["q3", "q4"]);
    // Three facts out of the contract, one repeated key and two questions.
    expect(answer.ok && answer.value.dropped).toBe(6);
    expect(answer.ok && answer.value.facts[2]?.history).toBeNull();
  });

  it("what may hold a secret is withheld: a fact's text, a link, an option, a context", () => {
    const document = recorded();
    const board = document.instance.board!;
    board.facts = [
      { key: "key", label: "Deploy", value: "token=abc123", unit: null, link: null, at: "2026-11-21T18:14:11.580Z" },
      { key: "run", label: "Run", value: "7", unit: null, link: "https://ci.example.com/run?token=abc123", at: "2026-11-21T18:14:11.580Z" },
    ];
    board.questions = [{ id: "q1", question: "Which key?", options: ["password: hunter2", "none"], hasContext: true, context: "the api_key=abc is in the vault", since: "2026-11-21T18:14:11.580Z" }];
    const answer = parsePanelBoard(document);
    expect(answer.ok && answer.value.facts.map(({ withheld, link }) => ({ withheld, link }))).toEqual([{ withheld: true, link: null }, { withheld: false, link: null }]);
    expect(answer.ok && answer.value.questions[0]).toMatchObject({ withheld: false, optionsWithheld: [true, false], context: null });
  });

  it("a link is an absolute https address with a host and no credentials", () => {
    expect(boardLink("https://github.com/oats-project/oats-bb/pull/42")).toEqual({ href: "https://github.com/oats-project/oats-bb/pull/42", host: "github.com" });
    expect(["http://github.com/", "https://user:pw@github.com/", "javascript:alert(1)", "https://exa mple.com/", `https://example.com/${"x".repeat(520)}`, "", 7].map(boardLink)).toEqual([null, null, null, null, null, null, null]);
  });
});

describe("answering a question", () => {
  const question: PanelQuestion = { id: "q4", question: "How should I merge?", options: ["Squash: one clean commit", "password: hunter2"], withheld: false, optionsWithheld: [false, true], since: "2026-11-21T18:26:49.200Z", hasContext: false, context: null };

  it("the text is the question's id and the option, one line", () => {
    expect(answerText(question, 0)).toEqual({ ok: true, value: "q4: Squash: one clean commit" });
  });
  it("no such option, and an option that is withheld, send nothing", () => {
    expect(answerText(question, 2)).toEqual({ ok: false, error: { code: "INVALID_INPUT", message: "question q4 has no option 3" } });
    expect(answerText(question, 0.5).ok).toBe(false);
    expect(answerText(question, 1)).toEqual({ ok: false, error: { code: "INVALID_INPUT", message: "option 2 of question q4 is withheld: it may hold a secret, so it is not sent" } });
  });
  it("goes as one session input, from a file", () => {
    expect(boardAnswerArgv(HOME, "/tmp/answer-1.txt")).toEqual({ ok: true, value: ["session", "input", "--home", HOME, "--text-file", "/tmp/answer-1.txt", "--json"] });
    expect(boardAnswerArgv("home", "/tmp/answer-1.txt").ok).toBe(false);
  });
  it("the kernel's answer is given as it is: sent, or its refusal with its code and message", () => {
    const sent = printed("input-sent.json", 0);
    expect(sent.ok && parseBoardAnswer(sent.value)).toEqual({ ok: true, value: { submitted: true, verified: true } });
    expect(printed("input-prompt-open.json", 1)).toEqual({
      ok: false,
      error: { code: "E_SESSION_PROMPT_OPEN", message: "bb thread thr_t9xz6jqajf waits on a person (1 pending user_question): nothing was sent. Answer it in bb. Open: pint_mnnkqxkpwh" },
    });
    expect(printed("input-not-running.json", 1)).toEqual({
      ok: false,
      error: { code: "E_SESSION_NOT_RUNNING", message: `panel-worktree-helper was stopped by OATS; nothing was sent. Start it first: oats session start --home ${HOME}` },
    });
    expect(parseBoardAnswer({ home: HOME }).ok).toBe(false);
  });
});

describe("the board of the roster's row", () => {
  type Roster = { agents: { instances: Record<string, unknown>[] }[] };
  const row = (file: string, instance = "panel-worktree-helper") =>
    (JSON.parse(text(file)) as Roster).agents.flatMap((group) => group.instances).find((each) => each.instance === instance)!;
  it("is the board as it is now: the same facts and questions as the inspection's, with no history and no context", () => {
    const now = rowBoard(row("status-board.json"));
    const detail = parsePanelBoard(recorded());
    expect(now.state).toBe("ok");
    expect(now.facts.map((fact) => [fact.key, fact.value, fact.at, fact.history])).toEqual([["pr", "#42", "2026-11-21T18:14:11.580Z", null], ["tests", "3", "2026-11-21T18:14:12.802Z", null]]);
    expect(now.questions.map((question) => [question.id, question.since, question.hasContext, question.context])).toEqual([
      ["q3", "2026-11-21T18:23:39.827Z", false, null], ["q4", "2026-11-21T18:26:49.200Z", true, null],
    ]);
    // The detail read names the same occurrences: what the view needs to show a context under its own question.
    expect(detail.ok && detail.value.questions.map((question) => [question.id, question.since])).toEqual(now.questions.map((question) => [question.id, question.since]));
  });
  it("a row with no board, and a row of an OATS without boards", () => {
    expect(rowBoard(row("status-board.json", "redesign-ui-lead")).state).toBe("none");
    expect(rowBoard({ instance: "x" }).state).toBe("unsupported");
  });
});

describe("the answer's file", () => {
  it("a text that is no board answer starts no process and writes no file", () => {
    for (const bad of ["", "q4", "q4: ", "Q4: yes", "q4: one\ntwo", "q4: use token=abc123", "q4: \u202Eevil", `q4: ${"x".repeat(61)}`, "--home: /tmp", "q4:yes"]) expect(checkAnswerText(bad).ok, bad).toBe(false);
    expect(checkAnswerText("q4: Squash: one clean commit")).toEqual({ ok: true, value: "q4: Squash: one clean commit" });
  });
  it("holds exactly the line, is the caller's alone (0600) for the length of the call, and is gone after it", async () => {
    const dir = mkdtempSync(join(tmpdir(), "oats-board-"));
    const seen: { argv: string[]; mode: string; text: string }[] = [];
    const runner = {
      timeouts: { act: 1 },
      run: async (argv: { ok: true; value: string[] }) => {
        const file = argv.value[argv.value.indexOf("--text-file") + 1]!;
        seen.push({ argv: argv.value.map((word) => (word === file ? "<file>" : word)), mode: (statSync(file).mode & 0o777).toString(8), text: readFileSync(file, "utf8") });
        return { ok: true as const, value: { submitted: true, verified: true } };
      },
    } as unknown as Runner;
    expect(await verbs(runner).panelBoardAnswer(HOME, "q4: Squash: one clean commit", dir)).toEqual({ ok: true, value: { submitted: true, verified: true } });
    expect(seen).toEqual([{ argv: ["session", "input", "--home", HOME, "--text-file", "<file>", "--json"], mode: "600", text: "q4: Squash: one clean commit" }]);
    expect(readdirSync(dir)).toEqual([]);
    // Refused before the file: a text that is no answer, a home that is no absolute path.
    expect((await verbs(runner).panelBoardAnswer(HOME, "rm -rf", dir)).ok).toBe(false);
    expect((await verbs(runner).panelBoardAnswer("--native-record", "q4: Squash: one clean commit", dir)).ok).toBe(false);
    expect(seen).toHaveLength(1);
    expect(readdirSync(dir)).toEqual([]);
  });
});
