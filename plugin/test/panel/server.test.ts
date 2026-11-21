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
  it("answers the row's facts from the one status read, and the soul from `oats souls`", async () => {
    backend = await startBackend({ verbs: recorded });
    const answer = await backend.rpc<{ at: string; facts: Record<string, unknown>; soul: unknown }>("panelInstance", { instance: "panel-worktree-helper" });
    expect(answer.facts).toMatchObject({
      instance: "panel-worktree-helper", soul: "oats-expert", work: "worktree", repo: "oats-real", branch: "agents/panel-worktree-helper", parent: "redesign-ui-lead",
      harness: "claude", model: "claude-opus-5-5", modelFrom: "soul", backend: "bb", threadId: "thr_gx4sgexjgw", running: null, startedAt: "2026-11-21T18:13:36.478Z",
    });
    expect(answer.soul).toEqual({ key: "oats-expert", description: expect.stringContaining("OATS expert") });
    expect(answer.at).toBe((await backend.rpc<{ at: string }>("snapshot")).at);
    // One status for everybody, and the souls list the pages share: no process of the panel's own.
    expect(await backend.verbs()).toEqual(["status", "souls"]);
    await backend.rpc("panelInstance", { instance: "redesign-ui-lead" });
    expect(await backend.verbs()).toEqual(["status", "souls"]);
  });

  it("the row's facts stand when the souls cannot be listed", async () => {
    backend = await startBackend({ verbs: { ...recorded, souls: { stdout: JSON.stringify({ schemaVersion: 1, ok: false, error: { code: "E_WORKSPACE_UNREACHABLE", message: "the workspace could not be read" } }), exit: 1 } } });
    const answer = await backend.rpc<{ facts: { instance: string }; soul: unknown }>("panelInstance", { instance: "panel-worktree-helper" });
    expect(answer.facts.instance).toBe("panel-worktree-helper");
    expect(answer.soul).toEqual({ key: null, description: null });
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
