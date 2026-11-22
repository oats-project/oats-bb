// The outside feature's one RPC verb, through the whole backend: bb's fake plugin host, the real
// host entry and the fake `oats` (test/support/backend.ts).
import { afterEach, describe, expect, it } from "vitest";
import { startBackend, type Backend } from "../support/backend.js";
import { OUTSIDE_STATUS, OUTSIDE_VERSION } from "./rows.js";

let backend: Backend | undefined;
afterEach(async () => {
  await backend?.dispose();
  backend = undefined;
});

type Facts = { at: string; feature: boolean; rows: { instance: string; sessionEnd: string | null; outsideOats: { code: string; backend: string; message: string } | null }[] };
const REPORT = {
  code: "running-outside-oats", backend: "bb",
  message: "a harness runs in flaky-ci-2-developer on bb, and OATS recorded this instance stopped: stop it with `oats instance stop flaky-ci-2-developer`, or start it from OATS",
};

describe("outsideFacts", () => {
  it("answers the kernel's report of a home OATS stopped whose harness runs, on a kernel that lists provider-outside-oats: from the one status read and the one version read", async () => {
    backend = await startBackend({ verbs: { status: { file: OUTSIDE_STATUS }, version: { file: OUTSIDE_VERSION } } });
    const answer = await backend.rpc<Facts>("outsideFacts");
    expect(answer.feature).toBe(true);
    expect(answer.rows).toEqual([{ instance: "flaky-ci-2-developer", sessionEnd: "stopped", outsideOats: REPORT }]);
    expect(answer.at).toBe((await backend.rpc<{ at: string }>("snapshot")).at);
    // The snapshot's own row stays what OATS recorded: stopped, not running.
    const { agents } = await backend.rpc<{ agents: { instance: string; running: boolean | null; runtimeState: string | null }[] }>("snapshot");
    expect(agents.map((agent) => [agent.instance, agent.running, agent.runtimeState])).toEqual([["flaky-ci-2-developer", false, "stopped"]]);
    // No process of its own: one status and one version for everybody, also when asked again.
    await backend.rpc("outsideFacts");
    expect((await backend.verbs()).sort()).toEqual(["status", "version"]);
  });

  it("says nothing of it on an OATS that does not list the feature (0.70.0), for the same row", async () => {
    backend = await startBackend({ verbs: { status: { file: OUTSIDE_STATUS } } });
    const answer = await backend.rpc<Facts>("outsideFacts");
    expect(answer.feature).toBe(false);
    expect(answer.rows).toEqual([{ instance: "flaky-ci-2-developer", sessionEnd: "stopped", outsideOats: null }]);
  });

  it("a version that cannot be read is a kernel whose features are not known: nothing is said of outsideOats, and how each session ended is still answered", async () => {
    backend = await startBackend({ verbs: { status: { file: OUTSIDE_STATUS }, version: { stdout: "not json", exit: 0 } } });
    const answer = await backend.rpc<Facts>("outsideFacts");
    expect([answer.feature, answer.rows]).toEqual([false, [{ instance: "flaky-ci-2-developer", sessionEnd: "stopped", outsideOats: null }]]);
  });

  it("answers the two facts of each row of the pinned roster and nothing else of a raw row", async () => {
    backend = await startBackend();
    const answer = await backend.rpc<Facts>("outsideFacts");
    expect(Object.keys(answer).sort()).toEqual(["at", "feature", "rows"]);
    expect(answer.rows).toHaveLength(8);
    for (const row of answer.rows) expect(Object.keys(row).sort()).toEqual(["instance", "outsideOats", "sessionEnd"]);
    expect(answer.rows.find((row) => row.instance === "weekly-digest-helper")).toEqual({ instance: "weekly-digest-helper", sessionEnd: "stopped", outsideOats: null });
    expect(JSON.stringify(answer)).not.toMatch(/\/abs\/|settings|127\.0\.0\.1/);
  });

  it("takes no input, and a failed status is the snapshot's own refusal", async () => {
    backend = await startBackend({ verbs: { status: { stdout: JSON.stringify({ schemaVersion: 1, ok: false, error: { code: "E_LOCAL_MISSING", message: "no oats-local.yaml here" } }), exit: 1 } } });
    await expect(backend.rpc("outsideFacts")).rejects.toThrow("E_LOCAL_MISSING: no oats-local.yaml here");
    await expect(backend.rpc("outsideFacts", { instance: "x" })).rejects.toThrow();
  });
});
