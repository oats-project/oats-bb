// The instance panel's RPC verbs, through the whole backend: bb's fake plugin host, the real host
// entry and the fake `oats` (test/support/backend.ts).
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
    expect(Object.keys(answer).sort()).toEqual(["agentsRoot", "at", "facts", "soul"]);
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
