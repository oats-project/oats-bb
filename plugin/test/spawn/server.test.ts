// The server's checks of the New agent form's choices (server/spawn.ts), against the whole
// backend: bb's fake plugin host, the real host entry, the fake `oats` on the recorded answers.
// The spawn itself (the preview, the apply, the replay of a key) is test/server.test.ts's.
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { host as spawnHost } from "../../contract/spawn.js";
import { startBackend, type Backend } from "../support/backend.js";

/** What a refused call was refused with: bb's refusal code and the plugin's message. */
const refusalOf = (promise: Promise<unknown>) =>
  promise.then(
    () => null,
    (error: { code?: string; message?: string }) => ({ code: error.code, message: error.message }),
  );

let backend: Backend;
beforeEach(async () => {
  backend = await startBackend();
});
afterEach(async () => {
  await backend.dispose();
});
const spawnCalls = async () => (await backend.fake.calls()).filter((call) => call.verb.startsWith("spawn"));

describe("the choices of the New agent form, at the server", () => {
  it("previews with no name and an empty instruction, and answers the facts and the revision, never the kernel's preview", async () => {
    const preview = (await backend.rpc("spawnPlan", { soul: "oats-developer", task: "" })) as Record<string, unknown>;
    expect(Object.keys(preview).sort()).toEqual(["facts", "revision"]);
    expect(preview.revision).toMatch(/^[0-9a-f]{24}$/);
    expect(JSON.stringify(preview)).not.toContain("settings");
    const [call] = await spawnCalls();
    expect(call!.argv).toEqual(["spawn", "oats-developer", "--backend", "bb", "--yolo", "--preview", "--json"]);
  });

  it("applies the decision the person saw: with a revision there is no second preview, and the same key replays it", async () => {
    const input = { soul: "oats-developer", name: "flaky-ci-2-developer", task: "Fix the flaky CI job.", harness: "pi", key: "spawn-1f0c9a7e", revision: "0123456789abcdef01234567" };
    expect(await backend.rpc("spawn", input)).toEqual({ instance: "flaky-ci-2-developer", threadId: "thr_ad488edeab" });
    await backend.rpc("spawn", input);
    const calls = await spawnCalls();
    expect(calls.map((call) => call.verb)).toEqual(["spawn", "spawn"]);
    for (const call of calls) {
      expect(call.argv[call.argv.indexOf("--expect-decision") + 1]).toBe("0123456789abcdef01234567");
      expect(call.argv[call.argv.indexOf("--harness") + 1]).toBe("pi");
    }
    // The same key with another decision, or other choices, is another spawn: refused.
    expect(await refusalOf(backend.rpc("spawn", { ...input, revision: "ffffffffffffffffffffffff" }))).toMatchObject({ code: "invalid" });
    expect(await refusalOf(backend.rpc("spawn", { ...input, harness: "claude" }))).toMatchObject({ code: "invalid" });
    expect((await spawnCalls()).length).toBe(2);
  });

  it("refuses, with no spawn process: a harness the provider does not declare, a relation to no agent of the roster, a model that reads as an option", async () => {
    const base = { soul: "oats-developer", task: "t" };
    for (const choices of [
      { ...base, harness: "codex" },
      { ...base, relation: { kind: "child", to: "no-such-agent" } },
      { ...base, model: "--yolo" },
    ]) {
      expect(await refusalOf(backend.rpc("spawnPlan", choices)), JSON.stringify(choices)).toMatchObject({ code: "invalid" });
      expect(await refusalOf(backend.rpc("spawn", { ...choices, key: "spawn-1f0c9a7e" })), JSON.stringify(choices)).toMatchObject({ code: "invalid" });
    }
    await expect(backend.rpc("spawnPlan", { ...base, relation: { kind: "owner", to: "flaky-ci-developer" } })).rejects.toThrow();
    await expect(backend.rpc("spawnPlan", { ...base, flag: "--no-launch" })).rejects.toThrow();
    expect(await spawnCalls()).toEqual([]);
  });

  it("takes a harness the provider declares and a relation to an agent of the roster, with the anchor's agents root, from the home the roster's own row names", async () => {
    await backend.rpc("spawnPlan", { soul: "oats-developer", task: "t", harness: "claude", model: "anthropic/claude-opus-5-5", relation: { kind: "sibling", to: "flaky-ci-developer" } });
    const [call] = await spawnCalls();
    // The agents root of the anchor's home, as the kernel's status names that home (test/fixtures/roster/status.json).
    const root = "/abs/deployment/agents";
    expect(call!.argv.slice(-12)).toEqual(["--harness", "claude", "--model", "anthropic/claude-opus-5-5", "--relation", "sibling", "--relative-to", "flaky-ci-developer", "--relative-root", root, "--preview", "--json"]);
    // A caller cannot name the root itself: the contract has no place for it.
    await expect(backend.rpc("spawnPlan", { soul: "oats-developer", task: "t", relation: { kind: "sibling", to: "flaky-ci-developer", root: "/elsewhere" } })).rejects.toThrow();
  });

  it("a preview that is no decision a spawn could apply is refused to the form with the kernel's code", async () => {
    const document = JSON.parse(await readFile(join(process.cwd(), "test/fixtures/spawn/spawn-preview.json"), "utf8")) as { result: { launch: Record<string, unknown> } };
    document.result.launch.problem = { code: "E_LAUNCH_EXECUTABLE", message: "pi is not on PATH" };
    await backend.fake.behave({ "spawn --preview": { stdout: JSON.stringify(document) } });
    expect(await refusalOf(backend.rpc("spawnPlan", { soul: "oats-developer", task: "" }))).toEqual({ code: "conflict", message: "E_LAUNCH_EXECUTABLE: pi is not on PATH" });
  });

  it("the agents root of a home: the home without <agent>/instances/<instance>; a home of another shape names none", async () => {
    const { agentsRootOf } = await import("../../server/spawn.js");
    expect(agentsRootOf({ home: "/abs/deployment/agents/oats-developer/instances/flaky-ci-developer", soul: "oats-developer", instance: "flaky-ci-developer" })).toBe("/abs/deployment/agents");
    expect(agentsRootOf({ home: "/srv/homes/flaky-ci-developer", soul: "oats-developer", instance: "flaky-ci-developer" })).toBeNull();
    expect(agentsRootOf({ home: "/oats-developer/instances/flaky-ci-developer", soul: "oats-developer", instance: "flaky-ci-developer" })).toBeNull();
  });
});

describe("spawn's host verbs bb may retry", () => {
  it("the reads (the provider's list, a preview) are retryable; the spawn itself is not: bb never sends an act twice", () => {
    const retryable = Object.entries(spawnHost).filter(([, method]) => "experimental_retryable" in method && method.experimental_retryable).map(([name]) => name);
    expect(retryable.sort()).toEqual(["spawnHarnesses", "spawnPreview"]);
    expect(Object.keys(spawnHost).sort()).toEqual(["spawn", "spawnHarnesses", "spawnPreview"]);
  });
});

