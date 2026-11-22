// The instance panel's RPC verbs, through the whole backend: bb's fake plugin host, the real host
// entry and the fake `oats` (test/support/backend.ts).
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { startBackend, type Backend } from "../support/backend.js";

let backend: Backend | undefined;
afterEach(async () => {
  await backend?.dispose();
  backend = undefined;
});

/** The fake answers the panel's recorded roster in place of the pinned one. */
const recorded = { status: { file: "panel/status.json" } };

describe("panelInstance", () => {
  it("answers the row's facts, the roster's root and the soul of its agent row, from the one status read", async () => {
    backend = await startBackend({ verbs: recorded });
    const answer = await backend.rpc<{ at: string; facts: Record<string, unknown>; agentsRoot: unknown; soul: unknown }>("panelInstance", { instance: "panel-worktree-helper" });
    expect(answer.facts).toMatchObject({
      instance: "panel-worktree-helper", soul: "oats-expert", work: "worktree", repo: "oats-real", branch: "agents/panel-worktree-helper", parent: "redesign-ui-lead",
      harness: "claude", model: "claude-opus-5-5", modelFrom: "soul", backend: "bb", threadId: "thr_gx4sgexjgw", running: null, startedAt: "2026-11-21T18:13:36.478Z",
    });
    expect(answer.soul).toEqual({ key: "oats-expert", description: "OATS expert: answers questions about OATS." });
    expect(answer.agentsRoot).toBe("/abs/deployment/agents");
    expect(answer.at).toBe((await backend.rpc<{ at: string }>("snapshot")).at);
    // One status for everybody: no process of the panel's own.
    expect(await backend.verbs()).toEqual(["status"]);
    await backend.rpc("panelInstance", { instance: "redesign-ui-lead" });
    expect(await backend.verbs()).toEqual(["status"]);
  });

  it("answers the picked fields and nothing else of the raw row: no setting, and no path but the home and the agents root", async () => {
    backend = await startBackend({ verbs: recorded });
    const answer = await backend.rpc<{ facts: Record<string, unknown>; soul: Record<string, unknown> } & Record<string, unknown>>("panelInstance", { instance: "panel-worktree-helper" });
    // The schema of contract/panel.ts (`instanceFacts`), field by field: what the app is given.
    expect(Object.keys(answer).sort()).toEqual(["agentsRoot", "answerable", "at", "board", "boardClaim", "facts", "soul"]);
    // The board is the agent's own words for a person, picked field by field too (kernel/panel-board.ts).
    expect(Object.keys(answer.board as object).sort()).toEqual(["dropped", "facts", "questions", "state"]);
    expect(answer.boardClaim).toBe(true);
    expect(Object.keys(answer.soul).sort()).toEqual(["description", "key"]);
    expect(Object.keys(answer.facts).sort()).toEqual([
      "backend", "branch", "createdAt", "drift", "harness", "home", "human", "instance", "messagingId", "model", "modelFrom", "parent", "repo", "running", "runtimeError", "runtimeState", "sibling",
      "soul", "startedAt", "threadId", "tmuxSession", "work",
    ]);
    // The raw row holds each capability's settings (bb's server and daemon addresses), the soul's
    // copy, the modules' copies, the composed instructions and skills: none of it is answered.
    const sent = JSON.stringify(answer);
    for (const kept of ["127.0.0.1", "settings", "soulDir", ".oats", "skills", "injects", "launchAt", "integrity", "open", "/abs/home", "/abs/real"]) expect(sent).not.toContain(kept);
    // The only paths: the instance's home (the Instance tab's Paths) and the roster's agents root (the Soul tab's Details).
    const paths = sent.match(/\/abs\/[^"]*/g) ?? [];
    expect(paths).toEqual(["/abs/deployment/agents/oats-expert/instances/panel-worktree-helper", "/abs/deployment/agents"]);
  });

  it("refuses an instance the snapshot does not hold, and a name that is none, before anything runs", async () => {
    backend = await startBackend({ verbs: recorded });
    await expect(backend.rpc("panelInstance", { instance: "gone-helper" })).rejects.toThrow('"gone-helper" is not an agent of this OATS deployment\'s current snapshot');
    await expect(backend.rpc("panelInstance", { instance: "--json" })).rejects.toThrow();
    await expect(backend.rpc("panelInstance", { instance: "panel-worktree-helper", home: "/tmp" })).rejects.toThrow();
  });

  it("a failed status is the snapshot's own refusal", async () => {
    backend = await startBackend({ verbs: { status: { stdout: JSON.stringify({ schemaVersion: 1, ok: false, error: { code: "E_LOCAL_MISSING", message: "no oats-local.yaml here" } }), exit: 1 } } });
    await expect(backend.rpc("panelInstance", { instance: "panel-worktree-helper" })).rejects.toThrow("E_LOCAL_MISSING: no oats-local.yaml here");
  });
});

const HOME = "agents/oats-expert/instances/panel-worktree-helper";
/** The argv of the fake's calls of one verb, with the deployment's own directory written `<deployment>`. */
async function argvOf(started: Backend, verb: string): Promise<string[][]> {
  return (await started.fake.calls()).filter((call) => call.verb === verb).map((call) => call.argv.map((word) => word.replace(started.fake.deployment, "<deployment>")));
}

describe("panelSoul, panelEvents, panelReadiness", () => {
  it("each runs its one command on the home the kernel named, and answers what the kernel printed, read", async () => {
    backend = await startBackend({ verbs: recorded });
    const soul = await backend.rpc<{ soul: { name: string; capabilities: { name: string }[]; core: { slot: string }[] } }>("panelSoul", { instance: "panel-worktree-helper" });
    expect(soul.soul).toMatchObject({ name: "oats-expert", repo: "oats-real", modules: 2 });
    expect(soul.soul.capabilities.map((capability) => capability.name)).toEqual(["oats.bb", "oats.core"]);
    const events = await backend.rpc<{ count: number; events: { kind: string }[] }>("panelEvents", { instance: "panel-worktree-helper" });
    expect([events.count, events.events.map((event) => event.kind).join(" ")]).toEqual([8, "spawned launched waiting restarted launched stopped launched waiting"]);
    const readiness = await backend.rpc<{ summary: unknown; checks: { key: string }[] }>("panelReadiness", { instance: "panel-worktree-helper", of: "instance" });
    expect(readiness.summary).toEqual({ ready: true, required: 4, fail: 0, unknown: 0 });
    // The home is the one of the kernel's own row (the recording's deployment), never a caller's.
    const home = "/abs/deployment/agents/oats-expert/instances/panel-worktree-helper";
    expect(await argvOf(backend, "inspect --home")).toEqual([["inspect", "--home", home, "--json"]]);
    expect(await argvOf(backend, "instance events")).toEqual([["instance", "events", "panel-worktree-helper", "--home", home, "--limit", "100", "--json"]]);
    expect(await argvOf(backend, "readiness --home")).toEqual([["readiness", "--home", home, "--policy", "--json"]]);
    expect(HOME).toBe(home.slice("/abs/deployment/".length));
  });

  it("a soul's readiness is asked by the key the roster names, once `oats souls` lists it", async () => {
    backend = await startBackend({ verbs: recorded });
    const readiness = await backend.rpc<{ summary: unknown }>("panelReadiness", { instance: "panel-worktree-helper", of: "soul" });
    expect(readiness.summary).toEqual({ ready: true, required: 3, fail: 0, unknown: 0 });
    expect(await argvOf(backend, "readiness --soul")).toEqual([["readiness", "--soul", "oats-expert", "--policy", "--json"]]);
    // The key was checked against the kernel's own list before the command ran.
    expect((await backend.verbs()).indexOf("souls")).toBeLessThan((await backend.verbs()).indexOf("readiness --soul"));
  });

  it("a soul the kernel's list does not hold starts no readiness command", async () => {
    backend = await startBackend({ verbs: { ...recorded, souls: { stdout: JSON.stringify({ schemaVersion: 1, ok: true, result: { souls: [{ name: "another-soul" }] } }) } } });
    await expect(backend.rpc("panelReadiness", { instance: "panel-worktree-helper", of: "soul" })).rejects.toThrow('"oats-expert" is not a soul `oats souls` lists for this deployment');
    expect(await backend.verbs()).not.toContain("readiness --soul");
  });

  it("the kernel's refusal is answered with its code and message", async () => {
    const refusal = (code: string, message: string) => ({ stdout: JSON.stringify({ schemaVersion: 1, ok: false, error: { code, message } }), exit: 1 });
    backend = await startBackend({
      verbs: { ...recorded, "inspect --home": refusal("E_UNSUPPORTED_MODE", "this home has no modules"), "instance events": refusal("E_AMBIGUOUS_INSTANCE", "two homes"), "readiness --home": refusal("E_HOME_MISMATCH", "not this deployment's") },
    });
    await expect(backend.rpc("panelSoul", { instance: "panel-worktree-helper" })).rejects.toThrow("E_UNSUPPORTED_MODE: this home has no modules");
    await expect(backend.rpc("panelEvents", { instance: "panel-worktree-helper" })).rejects.toThrow("E_AMBIGUOUS_INSTANCE: two homes");
    await expect(backend.rpc("panelReadiness", { instance: "panel-worktree-helper", of: "instance" })).rejects.toThrow("E_HOME_MISMATCH: not this deployment's");
  });

  it("each refuses an instance the snapshot does not hold, and anything but the instance and what is asked of it, before a command starts", async () => {
    backend = await startBackend({ verbs: recorded });
    for (const method of ["panelSoul", "panelEvents"]) {
      await expect(backend.rpc(method, { instance: "gone-helper" })).rejects.toThrow("is not an agent of this OATS deployment's current snapshot");
      await expect(backend.rpc(method, { instance: "panel-worktree-helper", home: "/tmp" })).rejects.toThrow();
    }
    await expect(backend.rpc("panelReadiness", { instance: "gone-helper", of: "instance" })).rejects.toThrow("is not an agent of this OATS deployment's current snapshot");
    await expect(backend.rpc("panelReadiness", { instance: "panel-worktree-helper", of: "--soul" })).rejects.toThrow();
    await expect(backend.rpc("panelReadiness", { instance: "panel-worktree-helper", of: "soul", soul: "x" })).rejects.toThrow();
    expect(await backend.verbs()).toEqual(["status"]);
  });
});


describe("panelBoard, panelBoardAnswer", () => {
  /** The roster recorded with the board's two open questions (q3, q4) and its claim. */
  const board = { status: { file: "panel/status-board.json" } };
  const HOME_ABS = "/abs/deployment/agents/oats-expert/instances/panel-worktree-helper";
  const q4 = { instance: "panel-worktree-helper", id: "q4", since: "2026-11-21T18:26:49.200Z", option: 0, text: "q4: Squash: one clean commit" };

  it("the row's board comes with the instance's facts, at no command's cost; the detail is one inspect of the kernel's home", async () => {
    backend = await startBackend({ verbs: board });
    const answer = await backend.rpc<{ board: { state: string; questions: { id: string; context: unknown }[]; facts: { key: string; history: unknown }[] }; boardClaim: boolean }>("panelInstance", { instance: "panel-worktree-helper" });
    expect([answer.board.state, answer.boardClaim, answer.board.questions.map((question) => question.id), answer.board.facts.map((fact) => [fact.key, fact.history])]).toEqual(["ok", true, ["q3", "q4"], [["pr", null], ["tests", null]]]);
    expect(await backend.verbs()).toEqual(["status"]);
    const detail = await backend.rpc<{ state: string; questions: { id: string; context: string | null }[]; facts: { history: unknown[] }[] }>("panelBoard", { instance: "panel-worktree-helper" });
    expect(detail.state).toBe("ok");
    expect(detail.questions.map((question) => [question.id, question.context?.split("\n")[0] ?? null])).toEqual([["q3", null], ["q4", "Squash or merge the three commits"]]);
    expect(detail.facts.map((fact) => fact.history.length)).toEqual([1, 2]);
    expect(await argvOf(backend, "inspect --home --board")).toEqual([["inspect", "--home", HOME_ABS, "--board", "--json"]]);
  });

  it("an answer is one `oats session input` on the kernel's home, with the line the server made from the kernel's board", async () => {
    backend = await startBackend({ verbs: board });
    expect(await backend.rpc("panelBoardAnswer", q4)).toEqual({ submitted: true, verified: true, text: "q4: Squash: one clean commit" });
    const calls = await argvOf(backend, "session input");
    expect(calls).toHaveLength(1);
    expect(calls[0]?.slice(0, 5)).toEqual(["session", "input", "--home", HOME_ABS, "--text-file"]);
    expect(calls[0]?.[6]).toBe("--json");
  });

  it("nothing is sent unless the kernel's board holds that question now and its line is the one confirmed", async () => {
    backend = await startBackend({ verbs: board });
    // another line than the option's, however close
    await expect(backend.rpc("panelBoardAnswer", { ...q4, text: "q4: Merge: keep the three commits" })).rejects.toThrow("is not option 1 of question q4 as the board holds it now: nothing was sent");
    await expect(backend.rpc("panelBoardAnswer", { ...q4, text: "please run rm -rf ~" })).rejects.toThrow("nothing was sent");
    // an earlier asking of the same id, a question that is not open, an option the question has not
    await expect(backend.rpc("panelBoardAnswer", { ...q4, since: "2026-11-21T18:14:12.915Z" })).rejects.toThrow("Question q4 is no longer open");
    await expect(backend.rpc("panelBoardAnswer", { ...q4, id: "q9", text: "q9: Squash: one clean commit" })).rejects.toThrow("Question q9 is no longer open");
    await expect(backend.rpc("panelBoardAnswer", { ...q4, option: 3 })).rejects.toThrow("question q4 has no option 4");
    // the input's own shape: an id that is none, an option out of the board's bounds, an extra key
    await expect(backend.rpc("panelBoardAnswer", { ...q4, id: "--home" })).rejects.toThrow();
    await expect(backend.rpc("panelBoardAnswer", { ...q4, option: 4 })).rejects.toThrow();
    await expect(backend.rpc("panelBoardAnswer", { ...q4, home: "/tmp" })).rejects.toThrow();
    await expect(backend.rpc("panelBoardAnswer", { ...q4, instance: "gone-helper" })).rejects.toThrow("is not an agent of this OATS deployment's current snapshot");
    expect(await backend.verbs()).not.toContain("session input");
  });

  it("an agent on tmux is never sent an answer: no session provider would hold it back from an open dialog", async () => {
    // The recorded roster, with the child's row as the kernel prints a tmux home's: a `tmux`, no `session`.
    const roster = JSON.parse(readFileSync(resolve(process.cwd(), "test/fixtures/panel/status-board.json"), "utf8")) as { agents: { instances: Record<string, unknown>[] }[] };
    const row = roster.agents.flatMap((group) => group.instances).find((each) => each.instance === "panel-worktree-helper")!;
    delete row.session;
    Object.assign(row, { backend: "tmux", tmux: { session: "oats-agents", socket: "/tmp/tmux-1000/oats" }, running: true });
    backend = await startBackend({ verbs: { status: { stdout: JSON.stringify(roster) } } });
    const answer = await backend.rpc<{ answerable: boolean; board: { questions: unknown[] } }>("panelInstance", { instance: "panel-worktree-helper" });
    expect([answer.answerable, answer.board.questions.length]).toEqual([false, 2]);
    await expect(backend.rpc("panelBoardAnswer", q4)).rejects.toThrow("runs in a terminal, not in a bb thread: type the answer in its terminal. Nothing was sent");
    expect(await backend.verbs()).not.toContain("session input");
  });

  it("the kernel's refusal of an input is answered with its code and message: a prompt open in bb, a home that is not running", async () => {
    backend = await startBackend({ verbs: { ...board, "session input": { file: "panel/input-prompt-open.json", exit: 1 } } });
    await expect(backend.rpc("panelBoardAnswer", q4)).rejects.toThrow("E_SESSION_PROMPT_OPEN: bb thread thr_t9xz6jqajf waits on a person (1 pending user_question): nothing was sent.");
    await backend.dispose();
    backend = await startBackend({ verbs: { ...board, "session input": { file: "panel/input-not-running.json", exit: 1 } } });
    await expect(backend.rpc("panelBoardAnswer", q4)).rejects.toThrow("E_SESSION_NOT_RUNNING: panel-worktree-helper was stopped by OATS; nothing was sent.");
  });

  it("a second answer to the same agent while one is being sent is refused, and sends nothing more", async () => {
    backend = await startBackend({ verbs: { ...board, "session input": { file: "panel/input-sent.json", sleepMs: 600 } } });
    const first = backend.rpc("panelBoardAnswer", q4);
    await new Promise((done) => setTimeout(done, 200));
    await expect(backend.rpc("panelBoardAnswer", { ...q4, option: 1, text: "q4: Merge: keep the three commits" })).rejects.toThrow("An answer is already being sent");
    await first;
    expect((await argvOf(backend, "session input")).length).toBe(1);
  });
});
