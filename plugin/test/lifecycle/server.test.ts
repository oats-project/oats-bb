// The lifecycle's RPC verbs, through the whole backend: bb's fake plugin host, the real host entry
// and the fake `oats` (test/support/backend.ts).
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { MIN_INTERVAL_MS } from "../../server.js";
import { startBackend, type Backend } from "../support/backend.js";
import { FIXTURES } from "../support/fake-oats.js";

let backend: Backend | undefined;
afterEach(async () => {
  await backend?.dispose();
  backend = undefined;
});

const refusalOf = (promise: Promise<unknown>) =>
  promise.then(
    () => {
      throw new Error("expected a refusal");
    },
    (error: { code?: string; message: string }) => ({ code: error.code, message: error.message }),
  );
/** Another list than the recorded one (test/fixtures/spawn/capabilities-show-bb.json: claude and pi), as `oats capabilities show oats.bb --json` would answer it. */
const declares = (harnesses: string[] | undefined) => ({ "capabilities show": { stdout: JSON.stringify({ schemaVersion: 1, ok: true, result: { id: "oats.bb", sessionProviders: { bb: harnesses === undefined ? {} : { harnesses } } } }) } });
const HOME = "/abs/deployment/agents/oats-expert/instances/weekly-digest-helper";

describe("stop", () => {
  it("answers the plan as the kernel's facts, applies it with its revision, and shows the kernel's refusal of a stale one unchanged", async () => {
    backend = await startBackend();
    const { rpc, fake } = backend;
    const plan = await rpc<{ revision: string; instance: string; recursive: boolean; targets: { instance: string }[] }>("stopPlan", { instance: "redesign-ui-lead" });
    expect(plan).toMatchObject({ action: "stop", revision: "9c1f2e3d4b5a69788796a5b4", instance: "redesign-ui-lead", recursive: true });
    expect(plan.targets.map((target) => target.instance)).toEqual(["redesign-ui-lead", "desktop-mockups-developer", "harvest-knowledge-helper"]);
    const receipt = await rpc<{ ok: boolean; results: { instance: string; ok: boolean }[] }>("stopApply", { instance: "redesign-ui-lead", revision: plan.revision, key: "stop-7f3a9c2e41b8" });
    expect(receipt).toMatchObject({ action: "stop", ok: true, replayed: false });
    expect(receipt.results.map((row) => [row.instance, row.ok])).toEqual([["harvest-knowledge-helper", true], ["desktop-mockups-developer", true], ["redesign-ui-lead", true]]);
    await fake.behave({ "instance stop --apply": { file: "lifecycle/stop-apply-stale.json" } });
    expect(await refusalOf(rpc("stopApply", { instance: "redesign-ui-lead", revision: plan.revision, key: "stop-0000aaaa1111" }))).toEqual({
      code: "conflict",
      message: "E_PLAN_STALE: the stop plan changed since it was shown (f9dcbb5542487fc328e88b07 → c30af39bbdfb748db5e0b1b5); review the fresh plan",
    });
  });

  it("without the children, the plan and its apply both say so to the kernel", async () => {
    backend = await startBackend();
    const { rpc, fake } = backend;
    await rpc("stopPlan", { instance: "redesign-ui-lead", recursive: false });
    await rpc("stopApply", { instance: "redesign-ui-lead", revision: "9c1f2e3d4b5a69788796a5b4", key: "stop-7f3a9c2e41b8", recursive: false });
    expect((await fake.calls()).filter((call) => call.verb.startsWith("instance stop")).map((call) => call.argv)).toEqual([
      ["instance", "stop", "redesign-ui-lead", "--plan", "--no-recursive", "--json"],
      ["instance", "stop", "redesign-ui-lead", "--apply", "--no-recursive", "--plan-revision", "9c1f2e3d4b5a69788796a5b4", "--idempotency-key", "stop-7f3a9c2e41b8", "--json"],
    ]);
  });

  it("rereads the snapshot after an act", async () => {
    backend = await startBackend();
    const { rpc, verbs } = backend;
    await rpc("snapshot");
    await rpc("stopApply", { instance: "redesign-ui-lead", revision: "9c1f2e3d4b5a69788796a5b4", key: "stop-7f3a9c2e41b8" });
    await expect.poll(async () => (await verbs()).filter((verb) => verb === "status").length, { timeout: MIN_INTERVAL_MS + 4_000 }).toBe(2);
  }, 20_000);
});

describe("every act", () => {
  it("acts only on an instance of the current snapshot, and takes the home from it", async () => {
    backend = await startBackend();
    const { rpc, fake, verbs } = backend;
    for (const method of ["stopPlan", "startCheck", "start", "restart", "retirePlan"]) {
      expect(await refusalOf(rpc(method, { instance: "not-in-the-snapshot" })), method).toMatchObject({ code: "invalid" });
    }
    expect(await refusalOf(rpc("stopApply", { instance: "not-in-the-snapshot", revision: "9c1f2e3d4b5a69788796a5b4", key: "stop-7f3a9c2e41b8" }))).toMatchObject({ code: "invalid" });
    expect(await refusalOf(rpc("retireApply", { instance: "not-in-the-snapshot", revision: "9c1f2e3d4b5a69788796a5b4", key: "stop-7f3a9c2e41b8" }))).toMatchObject({ code: "invalid" });
    await expect(rpc("start", { instance: "weekly-digest-helper", home: "/somewhere/else" })).rejects.toThrow();
    expect((await verbs()).filter((verb) => verb !== "status")).toEqual([]);

    expect(await rpc("start", { instance: "weekly-digest-helper" })).toMatchObject({ threadId: "thr_7nx8uibthg", instance: "weekly-digest-helper", harness: "claude", warnings: [] });
    expect(await rpc("restart", { instance: "weekly-digest-helper" })).toMatchObject({ threadId: "thr_d5zug5fnva" });
    const sessions = (await fake.calls()).filter((call) => call.verb.startsWith("session"));
    expect(sessions.map((call) => call.argv)).toEqual([
      ["session", "start", "--home", HOME, "--json"],
      ["session", "restart", "--home", HOME, "--json"],
    ]);
  });
});

describe("start and restart", () => {
  it("startCheck reads the roster again and answers the agent as the kernel has it now, with the harnesses the provider declares", async () => {
    backend = await startBackend({ verbs: declares(["claude", "pi"]) });
    const { rpc, verbs } = backend;
    await rpc("snapshot");
    const before = (await verbs()).filter((verb) => verb === "status").length;
    expect(await rpc("startCheck", { instance: "weekly-digest-helper" })).toEqual({
      instance: "weekly-digest-helper",
      machine: "falcon",
      home: HOME,
      // The pinned sample roster holds neither for a row: a fact the kernel does not print is null, never guessed.
      harness: null,
      model: null,
      running: false,
      runtimeState: "stopped",
      runtimeError: null,
      // How its session ended, as the kernel's own row says it: an operator's stop.
      sessionEnd: "stopped",
      harnesses: ["claude", "pi"],
    });
    // One more read of the one status everybody shares, and the provider asked once for every dialog.
    expect((await verbs()).filter((verb) => verb === "status").length).toBe(before + 1);
    await rpc("startCheck", { instance: "weekly-digest-helper" });
    expect((await verbs()).filter((verb) => verb === "capabilities show")).toHaveLength(1);
  }, 20_000);

  it("startCheck answers the harness and the model the kernel's own row records", async () => {
    // The roster the real kernel printed (the panel's recording), whose rows hold both.
    backend = await startBackend({ verbs: { ...declares(["claude", "pi"]), status: { file: "panel/status.json" } } });
    expect(await backend.rpc("startCheck", { instance: "panel-worktree-helper" })).toMatchObject({ instance: "panel-worktree-helper", harness: "claude", model: "claude-opus-5-5" });
  }, 20_000);

  it("a provider from before the list declares none: the dialog then offers no choice, and a named harness is refused", async () => {
    backend = await startBackend({ verbs: declares(undefined) });
    expect((await backend.rpc<{ harnesses: string[] }>("startCheck", { instance: "weekly-digest-helper" })).harnesses).toEqual([]);
    expect(await refusalOf(backend.rpc("start", { instance: "weekly-digest-helper", harness: "claude" }))).toMatchObject({ code: "invalid" });
  }, 20_000);

  it("passes a harness the provider declares and a model; refuses any other harness, and a model that is a flag, before any process", async () => {
    backend = await startBackend({ verbs: declares(["claude", "pi"]) });
    const { rpc, fake } = backend;
    await rpc("start", { instance: "weekly-digest-helper", harness: "pi", model: "anthropic/claude-opus-5-5" });
    expect(await refusalOf(rpc("restart", { instance: "weekly-digest-helper", harness: "codex" }))).toMatchObject({ code: "invalid" });
    await expect(rpc("start", { instance: "weekly-digest-helper", model: "--yolo" })).rejects.toThrow();
    await expect(rpc("start", { instance: "weekly-digest-helper", harness: "--yolo" })).rejects.toThrow();
    expect((await fake.calls()).filter((call) => call.verb.startsWith("session")).map((call) => call.argv)).toEqual([["session", "start", "--home", HOME, "--harness", "pi", "--model", "anthropic/claude-opus-5-5", "--json"]]);
  }, 20_000);

  it("takes the thread from the next snapshot when a start's answer names none", async () => {
    backend = await startBackend();
    const { rpc, fake } = backend;
    await rpc("snapshot");
    await fake.behave({ "session start": { stdout: JSON.stringify({ schemaVersion: 1, ok: true, result: { instance: "weekly-digest-helper", backend: "bb", warnings: [] } }) } });
    expect(await rpc("start", { instance: "weekly-digest-helper" })).toMatchObject({ threadId: "thr_digest" });
  }, 20_000);

  it("refuses with a code of its own, never a kernel code, when no thread is named anywhere", async () => {
    backend = await startBackend();
    const { rpc, fake } = backend;
    const roster = JSON.parse(await readFile(join(FIXTURES, "roster/status.json"), "utf8"));
    for (const group of roster.agents) for (const instance of group.instances) if (instance.instance === "weekly-digest-helper") delete instance.session;
    await fake.behave({
      status: { stdout: JSON.stringify(roster) },
      "session start": { stdout: JSON.stringify({ schemaVersion: 1, ok: true, result: { instance: "weekly-digest-helper", backend: "bb", warnings: [] } }) },
    });
    expect(await refusalOf(rpc("start", { instance: "weekly-digest-helper" }))).toEqual({
      code: "conflict",
      message: "NO_THREAD_NAMED: Started weekly-digest-helper, but the kernel named no bb thread for it",
    });
  }, 20_000);
});

describe("retire", () => {
  it("the retire plan is answered with the harness the kernel's own row records, which the plan does not say; null where the row records none", async () => {
    // The roster the real kernel printed (the panel's recording), whose rows hold the harness.
    backend = await startBackend({ verbs: { status: { file: "panel/status.json" } } });
    expect(await backend.rpc("retirePlan", { instance: "panel-worktree-helper" })).toMatchObject({ action: "retire", harness: "claude" });
    await backend.dispose();
    // The pinned sample roster holds no harness for a row: never guessed.
    backend = await startBackend();
    expect(await backend.rpc("retirePlan", { instance: "weekly-digest-helper" })).toMatchObject({ action: "retire", harness: null });
  }, 20_000);

  it("the answer of a retire that was sent can be asked again with its key after the retire removed the agent from the roster; any other key is a new act, and is refused", async () => {
    backend = await startBackend();
    const { rpc, fake } = backend;
    const plan = await rpc<{ revision: string }>("retirePlan", { instance: "weekly-digest-helper" });
    const apply = { instance: "weekly-digest-helper", revision: plan.revision, key: "retire-2b9d4e6f8a1c" };
    await rpc("retireApply", apply);
    // The roster as the kernel answers it once the agent is retired.
    const roster = JSON.parse(await readFile(join(FIXTURES, "roster/status.json"), "utf8"));
    for (const group of roster.agents) group.instances = group.instances.filter((row: { instance: string }) => row.instance !== "weekly-digest-helper");
    const receipt = JSON.parse(await readFile(join(FIXTURES, "lifecycle/retire-apply.json"), "utf8"));
    await fake.behave({ status: { stdout: JSON.stringify(roster) }, retire: { stdout: JSON.stringify({ schemaVersion: 1, ok: true, result: { ...receipt, replayed: true } }) } });
    await rpc("refresh");
    // Check again: the same revision and key. The kernel is asked, and replays its receipt.
    expect(await rpc("retireApply", apply)).toMatchObject({ instance: "weekly-digest-helper", removedDir: true, replayed: true });
    expect((await fake.calls()).filter((call) => call.verb === "retire")).toHaveLength(2);
    // Another key, or another revision under that key, is no question about that retire: the agent must be one the roster names.
    expect(await refusalOf(rpc("retireApply", { ...apply, key: "retire-0000aaaa1111" }))).toMatchObject({ code: "invalid" });
    expect(await refusalOf(rpc("retireApply", { ...apply, revision: "0123456789abcdef01234567" }))).toMatchObject({ code: "invalid" });
    expect(await refusalOf(rpc("retirePlan", { instance: "weekly-digest-helper" }))).toMatchObject({ code: "invalid" });
    expect((await fake.calls()).filter((call) => call.verb === "retire")).toHaveLength(2);
  }, 20_000);

  it("answers the plan as the kernel's facts and retires through its guarded apply, answering the receipt", async () => {
    backend = await startBackend();
    const { rpc, fake } = backend;
    const plan = await rpc<{ revision: string }>("retirePlan", { instance: "weekly-digest-helper" });
    expect(plan).toMatchObject({ action: "retire", revision: "ef5028f1e6cb517560247307", instance: "weekly-digest-helper", ownWorktree: true, children: ["digest-links-helper"], session: "none" });
    expect(await rpc("retireApply", { instance: "weekly-digest-helper", revision: plan.revision, key: "retire-2b9d4e6f8a1c" })).toMatchObject({ action: "retire", instance: "weekly-digest-helper", removedDir: true, worktree: "retained", incomplete: [] });
    await rpc("retireApply", { instance: "weekly-digest-helper", revision: plan.revision, key: "retire-3c0e5f7a9b2d", discardWorktree: true });
    expect((await fake.calls()).filter((call) => call.verb === "retire").map((call) => call.argv)).toEqual([
      ["retire", "weekly-digest-helper", "--plan-revision", "ef5028f1e6cb517560247307", "--idempotency-key", "retire-2b9d4e6f8a1c", "--json"],
      ["retire", "weekly-digest-helper", "--discard-worktree", "--plan-revision", "ef5028f1e6cb517560247307", "--idempotency-key", "retire-3c0e5f7a9b2d", "--json"],
    ]);
  });
});
