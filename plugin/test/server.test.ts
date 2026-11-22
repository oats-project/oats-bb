// The server entry on bb's fake plugin host, with the real host entry behind it (bb's host-entry
// harness) and the fake `oats` behind that: the whole backend, from an RPC to a process and back.
import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { createFakePluginHost, makeHostResponse, type FakePluginHost } from "@get-bb/plugin-sdk/testing";
import { experimental_createHostEntryHarness } from "@get-bb/plugin-sdk/testing/host";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { hostContract, REALTIME_CHANGED } from "../contract/index.js";
import { host as lifecycleHost } from "../contract/lifecycle.js";
import { host as rosterHost } from "../contract/roster.js";
import { host as spawnHost } from "../contract/spawn.js";
import { host as workspaceHost } from "../contract/workspace.js";
import { createHostEntry } from "../host.js";
import { codes, timeouts } from "../kernel/index.js";
import plugin, { HOST_TIMEOUT, MIN_INTERVAL_MS } from "../server.js";
import { alive, FIXTURES, installFakeOats, type FakeOats } from "./support/fake-oats.js";

let fake: FakeOats;
let hostEntry: ReturnType<typeof experimental_createHostEntryHarness<any, any>>;
let server: FakePluginHost;
let hosts: ReturnType<typeof makeHostResponse>[];
let projects: unknown[];

const rpc = <Value = any>(method: string, input: unknown = null) => server.harness.callRpc(method, input) as Promise<Value>;
const verbs = async () => (await fake.calls()).map((call) => call.verb);
const refusalOf = (promise: Promise<unknown>) =>
  promise.then(
    () => {
      throw new Error("expected a refusal");
    },
    (error: { code?: string; message: string }) => ({ code: error.code, message: error.message }),
  );

async function load(settings: Record<string, string> = {}) {
  server = createFakePluginHost({
    pluginId: "oats",
    settings: { oatsBin: fake.bin, ...settings },
    sdk: {
      hosts: { list: async () => hosts },
      projects: { list: async () => projects },
    } as never,
    experimental_callHostRpc: (call) => hostEntry.experimental_call(call.method, call.input as never, { signal: call.signal }),
  });
  await plugin(server.bb);
}

beforeEach(async () => {
  fake = await installFakeOats();
  await mkdir(join(fake.deployment, ".agents", "events"), { recursive: true });
  hostEntry = experimental_createHostEntryHarness(createHostEntry(), {
    experimental_paths: { dataDir: join(fake.deployment, "data"), tempDir: fake.tempDir },
    experimental_watch: () => ({ dispose: async () => undefined }),
  });
  hosts = [makeHostResponse({ id: "host_falcon", name: "falcon" })];
  projects = [{ id: "proj_release", sources: [{ hostId: "host_falcon", path: join(fake.deployment, "agents", "oats-maintainer", "instances", "release-070-maintainer") }] }];
  await load();
});
afterEach(async () => {
  await server.harness.dispose();
  await hostEntry.experimental_dispose();
  await fake.remove();
});

describe("snapshot", () => {
  it("answers the deployment and its agents, read once for every client", async () => {
    const first = await rpc("snapshot");
    expect(first.ok).toBe(true);
    expect(first.deployment.root).toBe(fake.deployment);
    expect(first.deployment.workspace).toBe("oats");
    expect(first.deployment.machine).toBe("falcon"); // the name bb gives the machine, not the host's own
    expect(first.agents).toHaveLength(8);
    const again = await Promise.all([rpc("snapshot"), rpc("snapshot"), rpc("snapshot")]);
    expect(again.every((snapshot) => snapshot.at === first.at)).toBe(true);
    expect(await verbs()).toEqual(["status"]);
    expect(server.harness.realtimeSignals).toEqual([{ channel: REALTIME_CHANGED, payload: { at: first.at } }]);
    // The watch on the event log was asserted on the machine that holds the homes.
    await expect.poll(() => server.harness.experimental_hostRpcCalls.map((call) => call.method)).toEqual(["discover", "status", "watch"]);
    expect(server.harness.experimental_hostRpcCalls.every((call) => call.hostId === "host_falcon")).toBe(true);
  });

  it("rereads on refresh, never sooner than the floor, and publishes only a change", async () => {
    const first = await rpc("snapshot");
    const started = Date.now();
    const [one, two] = await Promise.all([rpc("refresh"), rpc("refresh")]);
    expect(Date.now() - Date.parse(first.at)).toBeGreaterThanOrEqual(MIN_INTERVAL_MS);
    expect(one).toEqual(two); // two callers, one read
    expect(Date.parse(one.at) - Date.parse(first.at)).toBeGreaterThanOrEqual(MIN_INTERVAL_MS - 50);
    expect(Date.now() - started).toBeLessThan(MIN_INTERVAL_MS + 3_000);
    expect(await verbs()).toEqual(["status", "status"]);
    expect(server.harness.realtimeSignals).toHaveLength(1); // the same agents: nothing to invalidate
    expect((await rpc("snapshot")).at).toBe(one.at);
  }, 20_000);

  it("pauses between two reads as long as the last one took, when that is longer than the floor: a slow kernel is not read without pause", async () => {
    await fake.behave({ status: { sleepMs: 2_500 } });
    await rpc("snapshot"); // took about 2.5 s
    const ended = Date.now();
    await fake.behave({});
    const next = await rpc<{ at: string }>("refresh");
    // The next read started no sooner than the last one's own time after it ended, not after 1 s.
    expect(Date.parse(next.at) - ended).toBeGreaterThanOrEqual(2_400);
    expect(Date.parse(next.at) - ended).toBeLessThan(4_500);
    // And after that quick read, the floor is the pause again.
    const after = Date.now();
    const quick = await rpc<{ at: string }>("refresh");
    expect(Date.parse(quick.at) - after).toBeLessThan(MIN_INTERVAL_MS + 800);
    expect(await verbs()).toEqual(["status", "status", "status"]);
  }, 20_000);

  it("after a read that failed the pause is the floor: Retry is not held back by a timeout's own length", async () => {
    await fake.behave({ status: { exit: 1, stdout: "", stderr: "boom", sleepMs: 2_500 } });
    const failed = await rpc<{ ok: boolean; code: string }>("snapshot"); // about 2.5 s, then OATS_FAILED
    expect([failed.ok, failed.code]).toEqual([false, codes.failed]);
    const ended = Date.now();
    await fake.behave({});
    const next = await rpc<{ at: string }>("refresh");
    expect(Date.parse(next.at) - ended).toBeLessThan(MIN_INTERVAL_MS + 800); // not 2.5 s more
    expect((await rpc<{ ok: boolean }>("snapshot")).ok).toBe(true);
  }, 20_000);

  it("with a kernel that hangs, under a burst of events, no more than one oats status is alive at a time", async () => {
    await fake.behave({ status: { sleepMs: 600_000 } });
    const first = rpc<{ ok: boolean; code: string }>("snapshot"); // runs into the 20 s limit
    let most = 0;
    let overlapped = false;
    const deadline = Date.now() + 23_500;
    while (Date.now() < deadline) {
      // A burst: every event asks for a read; they share the one that is queued.
      await server.harness.experimental_emitHostSignal("host_falcon", "changed", { reason: "changed" });
      const calls = (await fake.calls()).filter((call) => call.verb === "status");
      const living = (await Promise.all(calls.map((call) => alive(call.pid)))).filter(Boolean).length;
      most = Math.max(most, living);
      if (living > 1) overlapped = true;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    expect((await first).code).toBe(codes.timeout);
    const statuses = (await fake.calls()).filter((call) => call.verb === "status");
    // The timed-out one was ended, and the next started after the floor: two by now, never two at once.
    expect(statuses).toHaveLength(2);
    expect(await alive(statuses[0]!.pid)).toBe(false);
    expect([most, overlapped]).toEqual([1, false]);
  }, 40_000);

  it("rereads when the host entry signals a change, and publishes it", async () => {
    await rpc("snapshot");
    await fake.behave({ status: { stdout: JSON.stringify({ root: "/abs/deployment", agents: [] }) } });
    await server.harness.experimental_emitHostSignal("host_falcon", "changed", { reason: "changed" });
    await expect.poll(() => server.harness.realtimeSignals.length, { timeout: MIN_INTERVAL_MS + 4_000 }).toBe(2);
    const next = await rpc("snapshot");
    expect(next.agents).toEqual([]);
    expect(server.harness.realtimeSignals[1]).toEqual({ channel: REALTIME_CHANGED, payload: { at: next.at } });
  }, 20_000);

  it("rereads when bb creates or deletes a thread", async () => {
    await rpc("snapshot");
    await server.harness.emitThreadEvent("thread.created", { thread: { id: "thr_new" } } as never);
    await expect.poll(async () => (await verbs()).length, { timeout: MIN_INTERVAL_MS + 4_000 }).toBe(2);
  }, 20_000);

  it("shares the read in flight with a snapshot call that arrives before the first answer", async () => {
    await fake.behave({ status: { sleepMs: 700 } });
    const service = server.harness.runService("snapshot");
    await expect.poll(async () => (await verbs()).length).toBe(1);
    const started = Date.now();
    expect((await rpc("snapshot")).ok).toBe(true);
    expect(Date.now() - started).toBeLessThan(1_500); // the 700 ms of the read in flight, not a second read after the pause
    expect(await verbs()).toEqual(["status"]);
    service.controller.abort();
    await service.done;
  });

  it("says in one line that oats is missing, and keeps answering", async () => {
    await server.harness.setSettings({ oatsBin: join(fake.deployment, "no-oats-here") });
    const snapshot = await rpc("snapshot");
    expect(snapshot.ok).toBe(false);
    expect(snapshot.code).toBe(codes.notFound);
    expect(snapshot.message.split("\n")[0]).toMatch(/^oats was not found on .+: install OATS there, or set the path to oats in the OATS plugin's settings\./);
  });

  it("says that no deployment was found when no project is inside one", async () => {
    await server.harness.dispose();
    projects = [{ id: "proj_other", sources: [{ hostId: "host_falcon", path: "/tmp" }] }];
    await load();
    const snapshot = await rpc("snapshot");
    expect(snapshot).toMatchObject({ ok: false, code: codes.noDeployment });
    expect(snapshot.message).toMatch(/^No OATS deployment found on /);
    expect(await verbs()).toEqual([]);
  });

  it("takes the deployment setting instead of the projects", async () => {
    await server.harness.dispose();
    projects = [];
    await load({ deployment: fake.deployment });
    expect((await rpc("snapshot")).ok).toBe(true);
    await server.harness.dispose();
    await load({ deployment: join(fake.deployment, "agents") });
    expect(await rpc("snapshot")).toMatchObject({ ok: false, code: codes.noDeployment });
  });

  it("does not keep a deployment found with settings that changed meanwhile", async () => {
    await server.harness.dispose();
    let release: () => void = () => {};
    const held = new Promise<void>((resolve) => (release = resolve));
    await load();
    server.harness.sdk.stub("hosts.list", (async () => {
      await held; // the discovery is in flight, with the settings as they were
      return hosts;
    }) as never);
    const first = rpc("snapshot");
    await expect.poll(() => server.harness.sdk.callsTo("hosts.list").length).toBe(1);
    await server.harness.setSettings({ deployment: join(fake.deployment, "agents") }); // holds no oats-local.yaml
    server.harness.sdk.stub("hosts.list", (async () => hosts) as never);
    release();
    await first;
    // The next read looks for the deployment again, with the new setting, instead of using the old one.
    await expect.poll(async () => (await rpc("snapshot")).code, { timeout: MIN_INTERVAL_MS + 4_000 }).toBe(codes.noDeployment);
    // And the roster read under the old settings is not this deployment's "last observation":
    // no client is shown the old one's agents, and no act is lent their homes.
    const failed = await rpc("snapshot");
    expect(failed.last).toBeNull();
    expect(failed.machine).toBe("falcon"); // the machine it looked on, by the name bb gives it
  }, 20_000);

  it("a read in flight across a settings change keeps nothing: a client waits for the new deployment's answer, and an act is refused, never given the old deployment's home", async () => {
    // The old deployment is read and held in its status call; the settings then name a directory that
    // holds no deployment; the old read answers after that.
    expect((await rpc("snapshot")).ok).toBe(true);
    await fake.behave({ status: { sleepMs: 2_000 } });
    const before = (await verbs()).length;
    const reading = rpc("refresh"); // a read is asked; it is in flight under the old settings
    await expect.poll(async () => (await verbs()).length, { timeout: MIN_INTERVAL_MS + 4_000 }).toBe(before + 1);
    await server.harness.setSettings({ deployment: join(fake.deployment, "agents") }); // holds no oats-local.yaml
    // What a client is answered next is the new deployment's: never the old roster.
    const next = await rpc("snapshot");
    expect([next.ok, next.code]).toEqual([false, codes.noDeployment]);
    expect(next.last).toBeNull();
    // An act asked now is refused with why; no `oats session start` ran for the old deployment's home.
    await expect(rpc("start", { instance: "redesign-ui-lead" })).rejects.toThrow(/No OATS deployment found/);
    expect((await verbs()).slice(before)).not.toContain("start");
    await reading.catch(() => undefined); // the old read's own answer is nobody's
    expect((await rpc("snapshot")).code).toBe(codes.noDeployment);
  }, 30_000);

  it("a change of a setting the app alone reads (`pages`) is no other deployment: the roster, and the last one kept while OATS cannot be read, stay", async () => {
    const read = await rpc("snapshot");
    expect(read.ok).toBe(true);
    const before = (await verbs()).length;
    await server.harness.setSettings({ pages: "home, souls" });
    // The roster is still the one read: no client waits for another, and nothing is read for the change.
    expect((await rpc("snapshot")).at).toBe(read.at);
    expect((await verbs()).length).toBe(before);
    // OATS cannot be read: the last roster is kept, also across another change of `pages`.
    await fake.behave({ status: { stdout: JSON.stringify({ schemaVersion: 1, ok: false, error: { code: "E_CONFIG_BROKEN", message: "oats-local.yaml cannot be read" } }) } });
    await rpc("refresh").catch(() => undefined);
    await expect.poll(async () => (await rpc("snapshot")).ok, { timeout: MIN_INTERVAL_MS + 4_000 }).toBe(false);
    const failed = await rpc("snapshot");
    expect(failed.last?.at).toBe(read.at);
    await server.harness.setSettings({ pages: "home" });
    const after = await rpc("snapshot");
    expect([after.ok, after.last?.at]).toEqual([false, read.at]);
  }, 20_000);

  it("asks to choose a machine when the server has several and none is set", async () => {
    await server.harness.dispose();
    hosts = [makeHostResponse({ id: "host_falcon", name: "falcon" }), makeHostResponse({ id: "host_kite", name: "kite" })];
    await load();
    const snapshot = await rpc("snapshot");
    expect(snapshot).toMatchObject({ ok: false, code: codes.chooseHost });
    expect(snapshot.message).toContain("falcon, kite");
    await server.harness.dispose();
    await load({ host: "falcon" });
    expect((await rpc("snapshot")).ok).toBe(true);
    await server.harness.dispose();
    await load({ host: "osprey" });
    expect(await rpc("snapshot")).toMatchObject({ ok: false, code: codes.hostNotFound });
  });

  it("answers the kernel's code and message when oats refuses", async () => {
    await fake.behave({ status: { stdout: JSON.stringify({ schemaVersion: 1, ok: false, error: { code: "E_CONFIG_BROKEN", message: "oats-local.yaml cannot be read" } }) } });
    expect(await rpc("snapshot")).toMatchObject({ ok: false, code: "E_CONFIG_BROKEN", message: "oats-local.yaml cannot be read" });
  });
});

describe("the pages", () => {
  it("answers souls, capabilities with their number of souls, teams and machines", async () => {
    const { souls } = await rpc("souls");
    expect(souls).toHaveLength(10);
    // Every agent of the snapshot is an agent of exactly one soul of the page.
    for (const agent of (await rpc("snapshot")).agents) {
      expect(souls.filter((soul: { agent: string }) => soul.agent === agent.soul), agent.soul).toHaveLength(1);
    }
    const { capabilities } = await rpc("capabilities");
    expect(capabilities.find((row: { id: string }) => row.id === "oats.core").souls).toBeGreaterThan(1);
    const { teams } = await rpc("teams");
    expect(teams[0]).toEqual({ label: "oats", team: "default:oats.aweb.ai", isDefault: true });
    await rpc("snapshot");
    const { machines } = await rpc("machines");
    expect(machines.map((machine: { id: string; isThisMachine: boolean }) => [machine.id, machine.isThisMachine])).toEqual([
      [(await rpc("snapshot")).deployment.machine, true],
      ["devbox-oats", false],
      ["build", false],
    ]);
    // One `oats souls` served the souls page and the capability counts.
    expect((await verbs()).filter((verb) => verb === "souls")).toHaveLength(1);
  });

  it("refuses, and does not crash, when the machine cannot be asked where the deployment is", async () => {
    await server.harness.dispose();
    await hostEntry.experimental_dispose(); // every host call now fails
    await load();
    const refused = await refusalOf(rpc("souls"));
    expect(refused.code).toBe("conflict");
    expect(refused.message).toMatch(/^HOST_UNREACHABLE: The machine that runs oats did not answer: /);
    expect(await rpc("snapshot")).toMatchObject({ ok: false, code: codes.hostUnreachable });
  });

  it("refuses with the kernel's code and message when a page's verb fails, and reads again next time", async () => {
    await fake.behave({ teams: { stdout: JSON.stringify({ schemaVersion: 1, ok: false, error: { code: "E_WORKSPACE_SCHEMA", message: "oats-workspace.yaml: teams must be a mapping" } }) } });
    expect(await refusalOf(rpc("teams"))).toEqual({ code: "conflict", message: "E_WORKSPACE_SCHEMA: oats-workspace.yaml: teams must be a mapping" });
    await fake.behave({});
    expect((await rpc("teams")).teams).toHaveLength(2);
  });
});

describe("acts", () => {
  // The acts are HELD while OATS cannot be read (R4): each lifecycle handler refuses with why,
  // also for an agent of the roster that is still shown, and runs nothing.
  it("takes no act while OATS cannot be read, also on an agent of the last roster read: each of the six is refused with the failure, and no oats verb runs for it", async () => {
    const read = await rpc("snapshot");
    expect(read.ok).toBe(true);
    await fake.behave({ status: { stdout: JSON.stringify({ schemaVersion: 1, ok: false, error: { code: "E_CONFIG_BROKEN", message: "oats-local.yaml cannot be read" } }) } });
    await rpc("refresh").catch(() => undefined);
    await expect.poll(async () => (await rpc("snapshot")).ok, { timeout: MIN_INTERVAL_MS + 4_000 }).toBe(false);
    // The roster is kept as last read, and the agent is one of it.
    const failed = await rpc("snapshot");
    expect(failed.last?.agents.some((agent: { instance: string }) => agent.instance === "weekly-digest-helper")).toBe(true);
    const before = (await verbs()).length;
    const instance = "weekly-digest-helper";
    const acts: [string, Record<string, string>][] = [
      ["stopPlan", { instance }],
      ["stopApply", { instance, revision: "9c1f2e3d4b5a69788796a5b4", key: "stop-7f3a9c2e41b8" }],
      ["start", { instance }],
      ["restart", { instance }],
      ["retirePlan", { instance }],
      ["retireApply", { instance, revision: "ef5028f1e6cb517560247307", key: "retire-2b9d4e6f8a1c" }],
    ];
    for (const [method, input] of acts) {
      expect(await refusalOf(rpc(method, input)), method).toEqual({ code: "conflict", message: "E_CONFIG_BROKEN: oats-local.yaml cannot be read" });
    }
    // Nothing but reads of the roster ran meanwhile.
    expect((await verbs()).slice(before).filter((verb) => verb !== "status")).toEqual([]);
  }, 30_000);

  it("spawns through a preview and an apply bound to its decision, and answers the thread", async () => {
    const spawned = await rpc("spawn", { soul: "oats-developer", name: "flaky-ci-2-developer", task: "Fix the flaky CI job.", key: "spawn-1f0c9a7e" });
    expect(spawned).toEqual({ instance: "flaky-ci-2-developer", threadId: "thr_ad488edeab" });
    const calls = await fake.calls();
    expect(calls.map((call) => call.verb).filter((verb) => verb !== "status")).toEqual(["souls", "spawn --preview", "spawn"]);
    const apply = calls.find((call) => call.verb === "spawn")!;
    expect(apply.argv).toContain("--backend");
    expect(apply.argv).toContain("--yolo");
    expect(apply.argv[apply.argv.indexOf("--idempotency-key") + 1]).toBe("spawn-1f0c9a7e");
    expect(apply.argv[apply.argv.indexOf("--expect-decision") + 1]).toMatch(/^[0-9a-f]{24}$/);
  });

  it("replays a spawn asked again with the same key, with no second preview, and refuses the key for another spawn", async () => {
    const input = { soul: "oats-developer", name: "flaky-ci-2-developer", task: "Fix the flaky CI job.", key: "spawn-1f0c9a7e" };
    await rpc("spawn", input);
    await rpc("spawn", input);
    const calls = (await fake.calls()).filter((call) => call.verb.startsWith("spawn"));
    expect(calls.map((call) => call.verb)).toEqual(["spawn --preview", "spawn", "spawn"]);
    // The same decision and key (each call has a task file of its own, before them in the argv).
    const bound = (argv: string[]) => argv.slice(argv.indexOf("--expect-decision"));
    expect(bound(calls[2]!.argv)).toEqual(bound(calls[1]!.argv));
    expect(bound(calls[1]!.argv)).toHaveLength(5);
    expect(calls[2]!.argv.slice(0, 8)).toEqual(calls[1]!.argv.slice(0, 8));
    expect(await refusalOf(rpc("spawn", { ...input, name: "another-developer" }))).toMatchObject({ code: "invalid" });
  });

  it("reads the decision again after the kernel refused a stale one, under the same key", async () => {
    const input = { soul: "oats-developer", name: "flaky-ci-2-developer", task: "Fix the flaky CI job.", key: "spawn-1f0c9a7e" };
    await fake.behave({ spawn: { stdout: JSON.stringify({ schemaVersion: 1, ok: false, error: { code: "E_DECISION_STALE", message: "the decision moved", details: {} } }) } });
    expect(await refusalOf(rpc("spawn", input))).toEqual({ code: "conflict", message: "E_DECISION_STALE: the decision moved" });
    // The decision the kernel would confirm now is another one.
    const preview = JSON.parse(await readFile(join(FIXTURES, "spawn/spawn-preview.json"), "utf8"));
    preview.result.decision.revision = "aaaaaaaaaaaaaaaaaaaaaaaa";
    await fake.behave({ "spawn --preview": { stdout: JSON.stringify(preview) } });
    expect(await rpc("spawn", input)).toEqual({ instance: "flaky-ci-2-developer", threadId: "thr_ad488edeab" });
    const calls = (await fake.calls()).filter((call) => call.verb.startsWith("spawn"));
    expect(calls.map((call) => call.verb)).toEqual(["spawn --preview", "spawn", "spawn --preview", "spawn"]);
    expect(calls[3]!.argv[calls[3]!.argv.indexOf("--expect-decision") + 1]).toBe("aaaaaaaaaaaaaaaaaaaaaaaa");
    expect(calls[1]!.argv[calls[1]!.argv.indexOf("--expect-decision") + 1]).not.toBe("aaaaaaaaaaaaaaaaaaaaaaaa");
  });

  it("keeps the decision for a retry when the spawn failed another way", async () => {
    const input = { soul: "oats-developer", name: "flaky-ci-2-developer", task: "Fix the flaky CI job.", key: "spawn-1f0c9a7e" };
    await fake.behave({ spawn: { stdout: JSON.stringify({ schemaVersion: 1, ok: false, error: { code: "E_SPAWN_INCOMPLETE", message: "launched, not confirmed" } }) } });
    expect(await refusalOf(rpc("spawn", input))).toMatchObject({ code: "conflict" });
    await fake.behave({});
    await rpc("spawn", input);
    expect((await fake.calls()).filter((call) => call.verb.startsWith("spawn")).map((call) => call.verb)).toEqual(["spawn --preview", "spawn", "spawn"]);
  });

  it("refuses a soul that is not listed and a name that is no instance name, with no spawn process", async () => {
    expect(await refusalOf(rpc("spawn", { soul: "no-such-soul", name: "x-developer", task: "t", key: "spawn-1f0c9a7e" }))).toMatchObject({ code: "invalid" });
    expect(await refusalOf(rpc("spawnPreview", { soul: "no-such-soul", name: "x-developer", task: "t" }))).toMatchObject({ code: "invalid" });
    for (const name of ["two words", "a/b", "Upper", "-leading"]) {
      await expect(rpc("spawn", { soul: "oats-developer", name, task: "t", key: "spawn-1f0c9a7e" })).rejects.toThrow();
    }
    await expect(rpc("spawn", { soul: "oats-developer", name: "x-developer", task: "t", key: "spawn-1f0c9a7e", flag: "--yolo" })).rejects.toThrow();
    expect((await verbs()).filter((verb) => verb.startsWith("spawn"))).toEqual([]);
  });

  it("shows a kernel refusal of a spawn with its code and message", async () => {
    await fake.behave({ "spawn --preview": { stdout: JSON.stringify({ schemaVersion: 1, ok: false, error: { code: "E_BAD_ARGS", message: "--backend must be tmux" } }) } });
    expect(await refusalOf(rpc("spawn", { soul: "oats-developer", name: "x-developer", task: "t", key: "spawn-1f0c9a7e" }))).toEqual({ code: "conflict", message: "E_BAD_ARGS: --backend must be tmux" });
    expect(await refusalOf(rpc("spawnPreview", { soul: "oats-developer", name: "x-developer", task: "t" }))).toEqual({ code: "conflict", message: "E_BAD_ARGS: --backend must be tmux" });
  });

  it("stops with the plan's revision, and shows the kernel's refusal of a stale one unchanged", async () => {
    const plan = await rpc("stopPlan", { instance: "redesign-ui-lead" });
    expect(plan.revision).toBe("9c1f2e3d4b5a69788796a5b4");
    expect(plan.lines[0]).toMatch(/^Stop redesign-ui-lead/);
    expect(await rpc("stopApply", { instance: "redesign-ui-lead", revision: plan.revision, key: "stop-7f3a9c2e41b8" })).toEqual({ ok: true });
    await fake.behave({ "instance stop --apply": { file: "lifecycle/stop-apply-stale.json" } });
    expect(await refusalOf(rpc("stopApply", { instance: "redesign-ui-lead", revision: plan.revision, key: "stop-0000aaaa1111" }))).toEqual({
      code: "conflict",
      message: "E_PLAN_STALE: the stop plan changed since it was shown (f9dcbb5542487fc328e88b07 → c30af39bbdfb748db5e0b1b5); review the fresh plan",
    });
  });

  it("acts only on an instance of the current snapshot, and takes the home from it", async () => {
    for (const method of ["stopPlan", "start", "restart", "retirePlan"]) {
      expect(await refusalOf(rpc(method, { instance: "not-in-the-snapshot" })), method).toMatchObject({ code: "invalid" });
    }
    expect(await refusalOf(rpc("stopApply", { instance: "not-in-the-snapshot", revision: "9c1f2e3d4b5a69788796a5b4", key: "stop-7f3a9c2e41b8" }))).toMatchObject({ code: "invalid" });
    expect(await refusalOf(rpc("retireApply", { instance: "not-in-the-snapshot", revision: "9c1f2e3d4b5a69788796a5b4", key: "stop-7f3a9c2e41b8" }))).toMatchObject({ code: "invalid" });
    await expect(rpc("start", { instance: "weekly-digest-helper", home: "/somewhere/else" })).rejects.toThrow();
    expect(await verbs()).toEqual(["status"]);

    expect(await rpc("start", { instance: "weekly-digest-helper" })).toEqual({ threadId: "thr_7nx8uibthg" });
    expect(await rpc("restart", { instance: "weekly-digest-helper" })).toEqual({ threadId: "thr_d5zug5fnva" });
    const sessions = (await fake.calls()).filter((call) => call.verb.startsWith("session"));
    expect(sessions.map((call) => call.argv)).toEqual([
      ["session", "start", "--home", "/abs/deployment/agents/oats-expert/instances/weekly-digest-helper", "--json"],
      ["session", "restart", "--home", "/abs/deployment/agents/oats-expert/instances/weekly-digest-helper", "--json"],
    ]);
  });

  it("takes the thread from the next snapshot when a start's answer names none", async () => {
    await rpc("snapshot");
    await fake.behave({ "session start": { stdout: JSON.stringify({ schemaVersion: 1, ok: true, result: { instance: "weekly-digest-helper", backend: "bb", warnings: [] } }) } });
    expect(await rpc("start", { instance: "weekly-digest-helper" })).toEqual({ threadId: "thr_digest" });
  }, 20_000);

  it("refuses with a code of its own, never a kernel code, when no thread is named anywhere", async () => {
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

  it("retires through the plan and its guarded apply", async () => {
    const plan = await rpc("retirePlan", { instance: "weekly-digest-helper" });
    expect(plan.revision).toBe("ef5028f1e6cb517560247307");
    expect(plan.lines[0]).toMatch(/^Removed: the home of weekly-digest-helper/);
    expect(await rpc("retireApply", { instance: "weekly-digest-helper", revision: plan.revision, key: "retire-2b9d4e6f8a1c" })).toEqual({ ok: true });
    const retire = (await fake.calls()).find((call) => call.verb === "retire")!;
    expect(retire.argv).toEqual(["retire", "weekly-digest-helper", "--plan-revision", "ef5028f1e6cb517560247307", "--idempotency-key", "retire-2b9d4e6f8a1c", "--json"]);
  });

  it("rereads the snapshot after an act", async () => {
    await rpc("snapshot");
    await rpc("stopApply", { instance: "redesign-ui-lead", revision: "9c1f2e3d4b5a69788796a5b4", key: "stop-7f3a9c2e41b8" });
    await expect.poll(async () => (await verbs()).filter((verb) => verb === "status").length, { timeout: MIN_INTERVAL_MS + 4_000 }).toBe(2);
  }, 20_000);
});

describe("the host-call limits", () => {
  it("leave the kernel's own limit reachable before bb retries a retryable call at half the transport timeout", () => {
    expect(HOST_TIMEOUT.read / 2).toBeGreaterThan(timeouts.read);
    expect(HOST_TIMEOUT.preview / 2).toBeGreaterThan(timeouts.preview);
    // Not retryable: the kernel's limit only has to come first.
    expect(HOST_TIMEOUT.act).toBeGreaterThan(timeouts.act);
    expect(HOST_TIMEOUT.long).toBeGreaterThan(timeouts.long);
    expect(HOST_TIMEOUT.long).toBeLessThanOrEqual(30 * 60_000); // bb's cap for a host call
    // Which verbs bb retries, and so which limit each needs: the reads, never an act. Of the roster,
    // the pages, spawn and the lifecycle; another feature holds the list of its own verbs in its tests.
    const mine = { ...rosterHost, ...workspaceHost, ...spawnHost, ...lifecycleHost };
    const retryable = Object.entries(mine).filter(([, method]) => "experimental_retryable" in method && method.experimental_retryable).map(([name]) => name);
    expect(retryable.sort()).toEqual(["capabilities", "discover", "servers", "souls", "spawnHarnesses", "spawnPreview", "status", "stopPlan", "teams", "version"]);
  });
});

describe("the slow poll", () => {
  it("runs only while a client watches the snapshot", async () => {
    const service = server.harness.runService("snapshot");
    await expect.poll(async () => (await verbs()).length).toBe(1); // the read at the service's start
    const unwatch = server.harness.experimental_watchRpc("snapshot", { input: null });
    await expect.poll(async () => (await verbs()).length, { timeout: 20_000, interval: 250 }).toBe(2);
    unwatch();
    service.controller.abort();
    await service.done;
  }, 30_000);
});
