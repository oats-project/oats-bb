// The board's RPC verbs through the whole backend: bb's fake plugin host, the real host entry and
// the fake `oats` (test/support/backend.ts).
import { afterEach, describe, expect, it } from "vitest";
import { boardData, boardDetailData } from "../../model/board.js";
import { startBackend, type Backend } from "../support/backend.js";

let backend: Backend | undefined;
afterEach(async () => {
  await backend?.dispose();
  backend = undefined;
});

/** The roster recorded from the real kernel with a board on one row (test/fixtures/panel/status-board.json). */
const recorded = { status: { file: "panel/status-board.json" } };
const ASKS = "panel-worktree-helper";
type Row = { at: string; supported: boolean; board: unknown; claim: { producer: string | null; reason: string | null } | null };

describe("board", () => {
  it("answers the row's board as the kernel printed it, and whose the claim is, from the one status read: no command of its own", async () => {
    backend = await startBackend({ verbs: recorded });
    const answer = await backend.rpc<Row>("board", { instance: ASKS });
    expect(answer.supported).toBe(true);
    expect(answer.claim).toEqual({ producer: "oats.board", reason: "attention" });
    const read = boardData(answer.board)!;
    expect([read.facts.map((each) => each.key), read.questions.map((each) => each.id), read.malformed, read.dropped]).toEqual([["pr", "tests"], ["q3"], false, 0]);
    expect(answer.at).toBe((await backend.rpc<{ at: string }>("snapshot")).at);
    expect((await backend.verbs()).sort()).toEqual(["status", "version"]);
  });

  it("an agent with no board file: null, on a kernel that reports boards; no claim", async () => {
    backend = await startBackend({ verbs: recorded });
    const answer = await backend.rpc<Row>("board", { instance: "redesign-ui-lead" });
    expect([answer.supported, answer.board, answer.claim]).toEqual([true, null, null]);
  });

  it("a kernel that does not list the feature, or a row with no key, says nothing of a board: not supported", async () => {
    backend = await startBackend({ verbs: { ...recorded, version: { stdout: JSON.stringify({ schemaVersion: 1, name: "@awebai/oats", version: "0.70.5", desktopApi: 1, features: ["waiting-on-you"] }) } } });
    expect((await backend.rpc<Row>("board", { instance: ASKS })).supported).toBe(false);
    await backend.dispose();
    // The pinned roster's rows carry no `board` key (an older kernel's).
    backend = await startBackend();
    const old = await backend.rpc<Row>("board", { instance: "kernel-fix-developer" });
    expect([old.supported, old.board]).toEqual([false, null]);
  });

  it("refuses an instance the snapshot does not name", async () => {
    backend = await startBackend({ verbs: recorded });
    await expect(backend.rpc("board", { instance: "no-such-agent" })).rejects.toThrow(/not an agent/);
  });
});

describe("boardDetail", () => {
  it("the answer the REAL kernel printed (recorded: test/fixtures/board/inspect-board.json): the board's part alone is passed on, with each fact's history and each question's context", async () => {
    backend = await startBackend({ verbs: recorded });
    const answer = await backend.rpc<{ inspection: Record<string, unknown> }>("boardDetail", { instance: ASKS });
    // The inspection holds the workspace, the souls, the launch, the identity: none of it is handed to the window.
    expect(Object.keys(answer.inspection)).toEqual(["instance"]);
    expect(Object.keys(answer.inspection.instance as object)).toEqual(["board"]);
    const read = boardDetailData(answer.inspection);
    if (read.state !== "ok") throw new Error(read.state);
    expect(read.facts.get("tests")!.history.map((held) => held.value)).toEqual(["12", "7", "3"]); // oldest first
    expect(read.facts.get("pr")!.history.map((held) => held.value)).toEqual(["#42"]);
    expect(read.questions.get("q1")!.context).toBe("main is protected and moved twice today.\nThe release line is 0.1 and carries the pilot's fix.\nI will cut the branch from the one you pick.");
    expect(read.questions.get("q2")!.context).toBeNull();
  });

  it("runs `oats inspect --home <its home> --board --json` on the home the kernel named, and passes on the board's part of the answer alone", async () => {
    const inspection = { instance: { home: "/abs/deployment/agents/oats-expert/instances/panel-worktree-helper", board: { facts: [{ key: "tests", history: [{ value: "5", at: "2026-11-23T18:00:58.000Z" }, { value: "3", at: "2026-11-23T18:00:58.766Z" }] }], questions: [{ id: "q3", context: "main is protected.\nrelease is the 0.1 line.", since: "2026-11-23T18:01:45.724Z" }] } } };
    backend = await startBackend({ verbs: { ...recorded, "inspect --home --board": { stdout: JSON.stringify(inspection) } } });
    const answer = await backend.rpc<{ inspection: unknown }>("boardDetail", { instance: ASKS });
    expect(answer.inspection).toEqual({ instance: { board: inspection.instance.board } }); // not the home, nor anything else of the inspection
    const read = boardDetailData(answer.inspection);
    if (read.state !== "ok") throw new Error(read.state);
    expect(read.facts.get("tests")!.history.map((held) => held.value)).toEqual(["5", "3"]);
    expect(read.questions.get("q3")!.context).toBe("main is protected.\nrelease is the 0.1 line.");
    const calls = (await backend.fake.calls()).filter((call) => call.argv[0] === "inspect");
    expect(calls.map((call) => call.argv)).toEqual([["inspect", "--home", "/abs/deployment/agents/oats-expert/instances/panel-worktree-helper", "--board", "--json"]]);
  });

  it("an answer with no board at all (a kernel without the feature: the recorded plain inspection) is passed on as an empty one: the app says the kernel sends none", async () => {
    backend = await startBackend({ verbs: { ...recorded, "inspect --home --board": { file: "panel/inspect-home.json" } } });
    const answer = await backend.rpc<{ inspection: unknown }>("boardDetail", { instance: ASKS });
    expect(answer.inspection).toEqual({});
    expect(boardDetailData(answer.inspection).state).toBe("unsupported");
    await backend.dispose();
    // The kernel says the home has no board file: `board: null` is passed on, and is not "unsupported".
    backend = await startBackend({ verbs: { ...recorded, "inspect --home --board": { stdout: JSON.stringify({ schemaVersion: 1, ok: true, result: { instance: { home: "/abs/x", board: null } } }) } } });
    const none = await backend.rpc<{ inspection: unknown }>("boardDetail", { instance: ASKS });
    expect(none.inspection).toEqual({ instance: { board: null } });
    expect(boardDetailData(none.inspection).state).toBe("none");
  });

  it("the kernel's refusal is the refusal", async () => {
    backend = await startBackend({ verbs: { ...recorded, "inspect --home --board": { stdout: JSON.stringify({ schemaVersion: 1, ok: false, error: { code: "E_HOME_MISSING", message: "no such home" } }), exit: 1 } } });
    await expect(backend.rpc("boardDetail", { instance: ASKS })).rejects.toThrow("E_HOME_MISSING: no such home");
  });
});
