// The server entry on bb's fake plugin host, with the real host entry behind it (bb's host-entry
// harness) and the fake `oats` behind that: the whole backend, from an RPC to a process and back.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createFakePluginHost, makeHostResponse, type FakePluginHost } from "@get-bb/plugin-sdk/testing";
import { experimental_createHostEntryHarness } from "@get-bb/plugin-sdk/testing/host";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { hostContract, REALTIME_CHANGED } from "../contract/index.js";
import { host as lifecycleHost } from "../contract/lifecycle.js";
import { host as rosterHost } from "../contract/roster.js";
import { host as workspaceHost } from "../contract/workspace.js";
import { createHostEntry } from "../host.js";
import { codes, timeouts } from "../kernel/index.js";
import { isUnconfirmed } from "../contract/shared.js";
import plugin, { EVENTS_READS_MAX, FOLLOW_UP_WITHIN_MS, followsAtOnce, HOST_TIMEOUT, MIN_INTERVAL_MS } from "../server.js";
import { alive, FIXTURES, installFakeOats, type FakeOats } from "./support/fake-oats.js";

let fake: FakeOats;
let hostEntry: ReturnType<typeof experimental_createHostEntryHarness<any, any>>;
let server: FakePluginHost;
let hosts: ReturnType<typeof makeHostResponse>[];
let projects: unknown[];

const rpc = <Value = any>(method: string, input: unknown = null) => server.harness.callRpc(method, input) as Promise<Value>;
const verbs = async () => (await fake.calls()).map((call) => call.verb);
/**
 * A change sent WHILE the server's read number `nth` is in flight, with no race against the
 * time that read is held: the wait is on the server's own call to the host (it is in this
 * process), and the signal is sent in the same turn the call is seen in, so the read's end
 * cannot be handled between the two, however long this process was stalled before.
 */
const changeDuringRead = async (nth: number) => {
  const asked = () => server.harness.experimental_hostRpcCalls.filter((call) => call.method === "status").length;
  const deadline = Date.now() + 20_000;
  while (asked() < nth) {
    if (Date.now() > deadline) throw new Error(`the server's read ${nth} did not start: ${asked()} status calls`);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  expect(asked()).toBe(nth);
  const sent = server.harness.experimental_emitHostSignal("host_falcon", "changed", { reason: "changed", files: [] }); // sent before anything is awaited
  await sent;
};
/** What the server said of each read asked for while another was in flight (its debug log, server/core.ts `reread`). */
const readAgain = () => server.harness.logEntries.filter((entry) => entry.level === "debug" && entry.message.startsWith("oats status is read again")).map((entry) => entry.message);
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

  // The rule alone, with no clock: which read asked for mid-flight starts at once.
  it("a read asked for while another is in flight starts at once only after one that answered within the limit, and that was not itself started at once", () => {
    expect(followsAtOnce({ answeredInMs: 850, startedAtOnce: false })).toBe(true);
    expect(followsAtOnce({ answeredInMs: 1_520, startedAtOnce: false })).toBe(true); // the pilot's host under load
    expect(followsAtOnce({ answeredInMs: FOLLOW_UP_WITHIN_MS, startedAtOnce: false })).toBe(true);
    expect(followsAtOnce({ answeredInMs: FOLLOW_UP_WITHIN_MS + 1, startedAtOnce: false })).toBe(false); // a slow kernel keeps the pause
    expect(followsAtOnce({ answeredInMs: null, startedAtOnce: false })).toBe(false); // a read that failed: its retry waits the floor
    expect(followsAtOnce({ answeredInMs: 850, startedAtOnce: true })).toBe(false); // once: never a third read with no pause
    expect(FOLLOW_UP_WITHIN_MS).toBeGreaterThan(MIN_INTERVAL_MS);
  });

  // Each read after a read in flight is told by the server's own account (its debug log), and held
  // by WHEN it started (a snapshot's `at` is its read's start). The bounds are of two kinds, neither
  // of which a loaded host can fail: a pause is a LOWER bound (a read that waited the pause started
  // no sooner than it), and "at once" is measured against the time the server itself took for the
  // read before it (the read starts in the same turn that read ended in: no wait stands between).
  it("a change during a read is read at once when that read ends, and a change during THAT read waits the pause: one read at once, never two", async () => {
    const statuses = async () => (await verbs()).filter((verb) => verb === "status").length;
    /** The start of the read after the one that started at `last`: the `at` of the first snapshot that has moved on. */
    const startAfter = async (last: string) => {
      const deadline = Date.now() + 20_000;
      for (;;) {
        const { at } = await rpc<{ at: string }>("snapshot");
        if (at !== last) return at;
        if (Date.now() > deadline) throw new Error(`no read after the one that started at ${last}`);
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
    };
    await rpc("snapshot"); // read 1, ended: nothing in flight
    expect(readAgain()).toEqual([]);
    const HELD_MS = 1_000; // long enough in flight for a change to land in it
    await fake.behave({ status: { sleepMs: HELD_MS } });
    const second = rpc<{ at: string }>("refresh"); // read 2: after the pause, then a second in flight
    await changeDuringRead(2); // a change, mid-read
    const secondAt = (await second).at;
    await changeDuringRead(3); // a change during read 3
    const thirdAt = await startAfter(secondAt);
    await expect.poll(statuses, { timeout: 20_000 }).toBe(4);
    const fourthAt = await startAfter(thirdAt);
    const [third, fourth, ...more] = readAgain();
    expect(more).toEqual([]);
    // Read 3: at once, by the time the server measured for read 2 (on a host so loaded that read 2
    // took over the limit, it says the pause and why: the rule, either way).
    const answered = Number(/answered in (\d+) ms/.exec(third ?? "")?.[1]);
    expect(Number.isFinite(answered)).toBe(true);
    const between = (later: string, earlier: string) => Date.parse(later) - Date.parse(earlier);
    if (answered <= FOLLOW_UP_WITHIN_MS) {
      expect(third).toBe(`oats status is read again at once: asked for while a read was in flight, which answered in ${answered} ms`);
      // What it said, it did: read 3 started when read 2 ended (in the same turn: nothing is awaited
      // between the two), not a pause later (the pause is a second at least: half of it tells them apart).
      expect(between(thirdAt, secondAt)).toBeLessThan(answered + MIN_INTERVAL_MS / 2);
      // Read 4 was asked for during the read at once: it says the pause, and it WAITED it: no sooner
      // than read 3's own time in flight and the floor after it.
      expect(fourth).toBe("oats status is read again after the pause: asked for while a read was in flight, which was itself read at once");
      expect(between(fourthAt, thirdAt)).toBeGreaterThanOrEqual(HELD_MS + MIN_INTERVAL_MS - 50);
    } else {
      expect(third).toBe(`oats status is read again after the pause: asked for while a read was in flight, which answered in ${answered} ms, over ${FOLLOW_UP_WITHIN_MS} ms`);
      expect(between(thirdAt, secondAt)).toBeGreaterThanOrEqual(answered + MIN_INTERVAL_MS - 50);
      // (Read 3 was then an ordinary read, and read 4 may follow it at once.)
      expect(fourth).toMatch(/^oats status is read again (at once|after the pause): asked for while a read was in flight, which answered in \d+ ms/);
    }
    expect(await verbs()).toEqual(["status", "status", "status", "status"]);
  }, 90_000);

  it("a read that failed is not followed at once: the read asked for during it waits the floor", async () => {
    await fake.behave({ status: { exit: 1, stdout: "", stderr: "boom", sleepMs: 400 } });
    const first = rpc<{ ok: boolean; at: string }>("snapshot"); // in flight, and it fails
    await changeDuringRead(1);
    const failed = await first;
    expect(failed.ok).toBe(false);
    await expect.poll(async () => (await rpc<{ at: string }>("snapshot")).at, { timeout: 20_000 }).not.toBe(failed.at);
    const next = await rpc<{ at: string }>("snapshot");
    expect(readAgain()).toEqual(["oats status is read again after the pause: asked for while a read was in flight, which gave no answer to count (it failed, or the settings changed under it)"]);
    // And it waited: the floor at least, after the failed read ended (which was no sooner than the 400 ms it was held, after its start).
    expect(Date.parse(next.at) - Date.parse(failed.at)).toBeGreaterThanOrEqual(400 + MIN_INTERVAL_MS - 50);
  }, 40_000);

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
      await server.harness.experimental_emitHostSignal("host_falcon", "changed", { reason: "changed", files: [] });
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
    await server.harness.experimental_emitHostSignal("host_falcon", "changed", { reason: "changed", files: [] });
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

// The event path (server/core.ts, "between two status reads"): the watch names an instance's file,
// the server reads that instance's events and moves its row to what they say, and the status read
// stays the truth. Everything here is told by the SERVER'S OWN ORDER (a snapshot's `at` is its
// status read's start; the fake's log holds each call's start): no bound on elapsed time from above.
describe("the event path", () => {
  const LEAD = "redesign-ui-lead"; // an agent of the fixtures' roster that runs and does not wait
  const FILE = `oats-product-expert--${LEAD}.jsonl`;
  const EVENTS = "instance events --since";
  /** How long the fake holds an events read that a status read is to overtake: far longer than a status read takes, on any host. */
  const ROSTER_EVENTS_HELD_MS = 4_000;
  const CLAIM = { since: "2026-11-23T10:00:00.000Z", producer: "agent", reason: "attention", message: "Keep the retry, or fail the job?" };
  /** An `oats instance events --json` answer, shaped to the kernel's documented one (not recorded: six fields are read). */
  const eventsAnswer = (over: Record<string, unknown> = {}) =>
    JSON.stringify({ schemaVersion: 1, ok: true, result: { eventsApi: 2, instance: LEAD, incarnation: "2026-11-23T09:00:00.000Z", count: 0, returned: 0, truncated: false, events: [], lastEvent: null, waitingOnYou: null, waitingClaims: [], ...over } });
  const claimed = () => eventsAnswer({ waitingOnYou: CLAIM, waitingClaims: [{ producer: "agent", waiting: true, since: CLAIM.since, reason: "attention", message: CLAIM.message }] });
  const named = (files: string[] = [FILE]) => server.harness.experimental_emitHostSignal("host_falcon", "changed", { reason: "changed", files });
  type Shown = { ok: boolean; at: string; agents: { instance: string; running: boolean | null; runtimeState: string | null; waiting: { message: string | null } | null }[] };
  const lead = (snapshot: Shown) => snapshot.agents.find((agent) => agent.instance === LEAD)!;
  // (An events read is told by its words, not by the fake's verb: with no answer set for it the fake names it by the panel's verb.)
  const calls = async (verb: string) => (await fake.calls()).filter((call) => (verb === EVENTS ? call.argv[0] === "instance" && call.argv[1] === "events" && call.argv.includes("--since") : call.verb === verb));
  const eventPath = () => server.harness.logEntries.filter((entry) => entry.level === "debug" && entry.message.startsWith("the event path:")).map((entry) => entry.message);
  /** Waits (no time bound asserted) until `seen()` holds. */
  const until = async (seen: () => boolean | Promise<boolean>, what: string) => {
    const deadline = Date.now() + 30_000;
    while (!(await seen())) {
      if (Date.now() > deadline) throw new Error(`never: ${what}`);
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  };

  it("a named signal reads that instance's events and shows the claim BEFORE the status read ends; the status read that started after is then the truth, whole", async () => {
    const first = await rpc<Shown>("snapshot");
    expect(lead(first).waiting).toBeNull();
    // The status read that the signal asks for is HELD: only the events read can show the claim meanwhile.
    await fake.behave({ status: { sleepMs: 4_000 }, [EVENTS]: { stdout: claimed() } });
    const published = server.harness.realtimeSignals.length;
    await named();
    await until(() => server.harness.realtimeSignals.length > published, "the patch is published");
    const patched = await rpc<Shown>("snapshot");
    // The snapshot is still the FIRST status read's (its `at`), and it has the claim: the event path showed it.
    expect(patched.at).toBe(first.at);
    expect(lead(patched).waiting).toMatchObject({ reason: "attention", message: "Keep the retry, or fail the job?", since: CLAIM.since });
    expect(patched.agents.filter((agent) => agent.instance !== LEAD)).toEqual(first.agents.filter((agent) => agent.instance !== LEAD)); // no other row moved
    // The token of that publish is not the snapshot's `at`: a client acts once per token.
    expect((server.harness.realtimeSignals.at(-1)!.payload as { at: string }).at).not.toBe(first.at);
    // One events read, for that instance and its home, since the snapshot's own read; and the status read was asked for as before.
    const reads = await calls(EVENTS);
    expect(reads.map((call) => call.argv)).toEqual([["instance", "events", LEAD, "--home", `/abs/deployment/agents/oats-product-expert/instances/${LEAD}`, "--since", first.at, "--limit", "50", "--json"]]);
    expect(eventPath().at(-1)).toMatch(new RegExp(`^the event path: ${LEAD}: a claim set, from its events read in \\d+ ms$`));
    // The status read that started AFTER the events read answers (the fake's roster has no claim): it is the truth, whole.
    await until(async () => (await rpc<Shown>("snapshot")).at !== first.at, "the status read after the signal answers");
    const confirmed = await rpc<Shown>("snapshot");
    expect(Date.parse(confirmed.at)).toBeGreaterThan(Date.parse(reads[0]!.at)); // that status read started after the events read did (the fake stamps a call when it starts)
    expect(lead(confirmed).waiting).toBeNull();
    expect(confirmed.agents).toEqual(first.agents);
  }, 60_000);

  // The app acts once per token (the payload's `at`: app/store.ts). A patch leaves the snapshot's
  // `at` as it is, so each publish must carry a token the app has not seen.
  it("two patches and the status read between them publish three different tokens: the app acts on each", async () => {
    const first = await rpc<Shown>("snapshot");
    await fake.behave({ status: { sleepMs: 4_000 }, [EVENTS]: { stdout: claimed() } });
    const published = server.harness.realtimeSignals.length;
    const tokens = () => server.harness.realtimeSignals.slice(published).map((signal) => (signal.payload as { at: string }).at);
    await named(); // patch 1: the claim, over the first status read
    await until(() => tokens().length === 1, "the first patch is published");
    await until(() => tokens().length === 2, "the status read after it is published (the fake's roster has no claim: a change)");
    const between = await rpc<Shown>("snapshot");
    expect(lead(between).waiting).toBeNull();
    await named(); // patch 2: the claim again, over that status read
    await until(() => tokens().length === 3, "the second patch is published");
    const [one, two, three] = tokens() as [string, string, string];
    expect(new Set([first.at, one, two, three]).size).toBe(4); // each a token no client has acted on
    expect([Date.parse(one) < Date.parse(two), Date.parse(two) < Date.parse(three)]).toEqual([true, true]); // and each later than the one before
    const patched = await rpc<Shown>("snapshot");
    expect([patched.at, lead(patched).waiting !== null]).toEqual([between.at, true]); // a patch's token is not the snapshot's `at`
  }, 60_000);

  it("two instances named by ONE signal each publish a token of their own: both patches reach the app", async () => {
    const MOCKUPS = "desktop-mockups-developer";
    const first = await rpc<Shown>("snapshot");
    await fake.behave({ status: { sleepMs: 8_000 }, [EVENTS]: { stdout: claimed() } });
    const published = server.harness.realtimeSignals.length;
    // Both events reads start in the same turn, in the same millisecond more often than not.
    await named([FILE, `oats-desktop-developer--${MOCKUPS}.jsonl`]);
    await until(() => server.harness.realtimeSignals.length >= published + 2, "both patches are published");
    const [one, two] = server.harness.realtimeSignals.slice(published).map((signal) => (signal.payload as { at: string }).at) as [string, string];
    expect(one).not.toBe(two);
    expect(new Set([first.at, one, two]).size).toBe(3);
    const patched = await rpc<Shown>("snapshot");
    expect(patched.at).toBe(first.at); // still the first status read's: the next one is held
    expect([lead(patched).waiting !== null, patched.agents.find((agent) => agent.instance === MOCKUPS)!.waiting !== null]).toEqual([true, true]);
  }, 60_000);

  it("a patch is computed from what the status read said, never from a patched row: events that say \"stopped, then started again\" take an earlier \"stopped\" off", async () => {
    const first = await rpc<Shown>("snapshot");
    const at = (ms: number) => new Date(Date.parse(first.at) + ms).toISOString();
    const row = (kind: string, ms: number) => ({ eventsApi: 2, kind, at: at(ms), incarnation: "2026-11-23T09:00:00.000Z", producer: "kernel", data: {} });
    await fake.behave({ status: { sleepMs: 8_000 }, [EVENTS]: { stdout: eventsAnswer({ events: [row("stopped", 1)] }) } });
    await named();
    await until(async () => lead(await rpc<Shown>("snapshot")).running === false, "the stop is shown");
    // The agent was started again: its events now say so. The status read is still held.
    await fake.behave({ status: { sleepMs: 8_000 }, [EVENTS]: { stdout: eventsAnswer({ events: [row("stopped", 1), row("launched", 2)] }) } });
    await named();
    await until(async () => lead(await rpc<Shown>("snapshot")).running !== false, "the stop is taken off");
    const after = await rpc<Shown>("snapshot");
    expect(after.at).toBe(first.at);
    expect(after.agents).toEqual(first.agents); // as the status read said: a start is the status read's to place
    expect(eventPath().at(-1)).toContain(`the event path: ${LEAD}: not stopped after all`);
  }, 60_000);

  it("a status answer OLDER than the patch never removes it: the read that was in flight when the events were read keeps the claim", async () => {
    const first = await rpc<Shown>("snapshot");
    // The status read in flight answers a roster with one agent more (so that it publishes), and no claim.
    await fake.behave({ status: { stdout: (await rosterOf(1)).stdout, sleepMs: 4_000 }, [EVENTS]: { stdout: claimed() } });
    // A status read is in flight (it started before the events read will), and it will answer with no claim.
    const inFlight = rpc<{ at: string }>("refresh");
    await until(async () => (await calls("status")).length === 2, "the second status read started");
    const published = server.harness.realtimeSignals.length;
    await named();
    await until(async () => lead(await rpc<Shown>("snapshot")).waiting !== null, "the claim is shown");
    expect((await rpc<Shown>("snapshot")).at).toBe(first.at); // shown over the first read, while the second is in flight
    const older = await inFlight; // the read that started BEFORE the events read answers now, with no claim of its own
    const after = await rpc<Shown>("snapshot");
    expect(after.at).toBe(older.at);
    expect(after.agents).toHaveLength(first.agents.length + 1); // it is that read's roster
    expect(lead(after).waiting).toMatchObject({ message: "Keep the retry, or fail the job?" }); // the patch stands over it
    // EVERY publish has a token later than the one before: the status read's too, though ITS read started before the patch's did.
    const [patch, status] = server.harness.realtimeSignals.slice(published).map((signal) => (signal.payload as { at: string }).at) as [string, string];
    expect(Date.parse(older.at)).toBeLessThan(Date.parse(patch));
    expect(Date.parse(status)).toBeGreaterThan(Date.parse(patch));
    // The next status read started after the events read: the truth, whole (the fake's roster has no claim).
    await until(async () => (await rpc<Shown>("snapshot")).at !== older.at, "the status read after the events read answers");
    expect(lead(await rpc<Shown>("snapshot")).waiting).toBeNull();
  }, 60_000);

  // The two rules together (the pacing's one read at once, and the order of answers): a patch
  // over the FIRST read of a pair is older than the read started at once after it, which is the truth.
  it("a patch over a status read in flight is dropped by the status read that starts at once after it: that read started after the events read", async () => {
    await rpc<Shown>("snapshot");
    // The read in flight answers within the pacing's limit (FOLLOW_UP_WITHIN_MS), so the read the signal asks for starts at once when it ends.
    // (Held 400 ms: long enough for the signal below, sent within one 10 ms look of the call being logged, and far under the limit on a loaded host.)
    await fake.behave({ status: { sleepMs: 400 }, [EVENTS]: { stdout: claimed() } });
    const inFlight = rpc<{ at: string }>("refresh");
    await until(async () => (await calls("status")).length === 2, "the second status read started");
    await named(); // asked for while that read is in flight: its events are read now, and a status read follows it at once
    await until(async () => lead(await rpc<Shown>("snapshot")).waiting !== null, "the claim is shown");
    const older = await inFlight;
    // The read at once: it started after the events read did, and the fake's roster has no claim: the truth, whole.
    await until(async () => (await rpc<Shown>("snapshot")).at !== older.at, "the status read started at once answers");
    const after = await rpc<Shown>("snapshot");
    expect(lead(after).waiting).toBeNull();
    expect(readAgain().some((line) => line.startsWith("oats status is read again at once"))).toBe(true);
    expect((await calls("status")).length).toBe(3);
  }, 60_000);

  it("events that say what is shown publish nothing", async () => {
    await rpc<Shown>("snapshot");
    await fake.behave({ status: { sleepMs: 8_000 }, [EVENTS]: { stdout: claimed() } });
    const before = server.harness.realtimeSignals.length;
    await named();
    await until(() => server.harness.realtimeSignals.length === before + 1, "the patch is published");
    await named(); // the same file, the same answer
    await until(() => eventPath().some((line) => line.includes("its events say what is shown")), "the second read says so");
    expect(server.harness.realtimeSignals.length).toBe(before + 1);
  }, 40_000);

  it("a status read that FAILS shows the last roster as oats status said it: a patch leaves the screen with it", async () => {
    const first = await rpc<Shown>("snapshot");
    // A status read in flight, older than the patch: it answers, and the patch stands over it (as the test above).
    await fake.behave({ status: { sleepMs: 3_000 }, [EVENTS]: { stdout: claimed() } });
    const inFlight = rpc<{ at: string }>("refresh");
    await until(async () => (await calls("status")).length === 2, "the second status read started");
    await named();
    await until(async () => lead(await rpc<Shown>("snapshot")).waiting !== null, "the claim is shown");
    const older = await inFlight;
    expect(lead(await rpc<Shown>("snapshot")).waiting).not.toBeNull(); // over the older read's roster too
    // The status read the signal asked for FAILS (it starts after the pause: the fake fails from now on).
    await fake.behave({ status: { exit: 1, stdout: "", stderr: "boom" } });
    await until(async () => (await rpc<{ ok: boolean }>("snapshot")).ok === false, "the status read fails");
    const failed = await rpc<{ ok: boolean; last: { at: string; agents: Shown["agents"] } | null }>("snapshot");
    // What is kept and shown as the last observation is that older read's roster AS OATS STATUS SAID IT: no claim.
    expect(failed.last?.at).toBe(older.at);
    expect(failed.last?.agents).toEqual(first.agents);
  }, 60_000);

  it("an events answer OLDER than the snapshot's status read is dropped", async () => {
    const first = await rpc<Shown>("snapshot");
    // The events read is slow; a status read starts after it did and answers first.
    await fake.behave({ [EVENTS]: { stdout: claimed(), sleepMs: ROSTER_EVENTS_HELD_MS } });
    await named();
    await until(async () => (await calls(EVENTS)).length === 1, "the events read started");
    await until(async () => (await rpc<Shown>("snapshot")).at !== first.at, "a status read that started after it answers");
    const newer = await rpc<Shown>("snapshot");
    await until(() => eventPath().some((line) => line.includes("a status read that started after its events read")), "the events answer is dropped");
    const after = await rpc<Shown>("snapshot");
    expect(after.at).toBe(newer.at);
    expect(lead(after).waiting).toBeNull();
  }, 60_000);

  // The window holds "Reading…" over an agent until it has a roster read AFTER the act ended (the roster's `at`
  // against the act's `endedAt`: app/roster/reading.tsx). A status read that says nothing new is not published, so
  // without this the window never learned that the read after the act was made (the kernel writes its event before
  // the act's command returns: a read that started before the act's end can already hold the final state).
  it("the status read an act asks for as it ends is published although it says nothing new, with a token of its own; a read nobody's act asked for, saying the same, is not", async () => {
    const first = await rpc<Shown>("snapshot");
    const plan = await rpc<{ revision: string }>("stopPlan", { instance: LEAD });
    const published = server.harness.realtimeSignals.length;
    const earlier = new Set(server.harness.realtimeSignals.map((signal) => (signal.payload as { at: string }).at));
    const tokens = () => server.harness.realtimeSignals.slice(published).map((signal) => (signal.payload as { at: string }).at);
    // The act (the fake's roster is the same after it: the read that follows says nothing new).
    const receipt = await rpc<{ endedAt: string }>("stopApply", { instance: LEAD, revision: plan.revision, key: "stop-7f3a9c2e41b8" });
    await until(() => tokens().length === 1, "the read the act asked for is published");
    const after = await rpc<Shown>("snapshot");
    expect(Date.parse(after.at)).toBeGreaterThan(Date.parse(receipt.endedAt)); // the roster the window then fetches was read after the act's end
    expect(after.agents).toEqual(first.agents); // and it says nothing new: it was published for the act alone
    // A token no client has acted on (the app acts once per token), later than the act's end.
    expect(earlier.has(tokens()[0]!) || tokens()[0] === first.at).toBe(false);
    expect(Date.parse(tokens()[0]!)).toBeGreaterThan(Date.parse(receipt.endedAt));
    // A read that no act asked for (a person's Retry), saying the same: read, and not published.
    const again = await rpc<{ at: string }>("refresh");
    expect(Date.parse(again.at)).toBeGreaterThan(Date.parse(after.at));
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(tokens()).toHaveLength(1);
    // And the act's publish is owed ONCE: the read after it, the same again, is not published either.
    await rpc("refresh");
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(tokens()).toHaveLength(1);
  }, 60_000);

  // The stamp is for the roster's `at` and an act's end ALONE. The server's pacing and the poll a client's snapshot
  // asks for compare a read's start with the bare clock, and must go on doing so when the stamp runs ahead of it: a
  // read is in flight, the clock is set back (a time sync), and the read that follows at once takes a stamp LATER
  // than the one before, ahead of the clock by the whole step. Fifteen seconds of the clock later a client's snapshot
  // must still ask for its poll.
  it("the clock is set back while a read is in flight: the next roster's `at` is still later than the one before, and the snapshot's poll still fires after its fifteen seconds of the clock", async () => {
    const real = Date.now.bind(Date);
    const status = async () => (await fake.calls()).filter((call) => call.verb === "status").length;
    const seen = async (more: () => Promise<boolean>) => {
      for (let tries = 0; tries < 400; tries += 1) {
        if (await more()) return true;
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      return false;
    };
    await rpc<Shown>("snapshot");
    await fake.behave({ status: { sleepMs: 800 } });
    const before = await status();
    const one = rpc<{ at: string }>("refresh");
    expect(await seen(async () => (await status()) > before)).toBe(true); // that read is in flight
    let offset = -60_000; // the clock is set back a minute
    const clock = vi.spyOn(Date, "now").mockImplementation(() => real() + offset);
    try {
      const two = rpc<{ at: string }>("refresh"); // asked while the first is in flight: it follows it
      const [first, second] = [await one, await two];
      expect(Date.parse(second.at)).toBeGreaterThan(Date.parse(first.at)); // the stamp: later, though the clock went back
      expect(Date.parse(second.at)).toBeGreaterThan(Date.now() + 30_000); // and so ahead of the clock, by most of the step
      await fake.behave({});
      const settled = await status();
      offset += 20_000; // twenty seconds of the clock later
      await rpc<Shown>("snapshot"); // a client asks: more than the poll's fifteen seconds since the last read STARTED, by the clock
      expect(await seen(async () => (await status()) > settled)).toBe(true); // the poll's read is made
    } finally {
      clock.mockRestore();
    }
  }, 90_000);

  // A client that decides on the roster (the home's card asks `snapshot` at the press, and sends a message only to an
  // agent it sees running) must not be answered, right after a stop, with the roster from before it: the server
  // answers `snapshot` from its cache, and from the act's end until the read the act asked for has ended that cache is
  // the old one. While that read is owed, `snapshot` waits for it.
  it("a snapshot asked between an act's end and the end of the read it asked for WAITS for that read: its roster was read after the act's end, never the cached one from before it", async () => {
    const first = await rpc<Shown>("snapshot");
    const plan = await rpc<{ revision: string }>("stopPlan", { instance: LEAD });
    await fake.behave({ status: { sleepMs: 2_500 } }); // the act's own status read is slow: the gap is wide
    const receipt = await rpc<{ endedAt: string }>("stopApply", { instance: LEAD, revision: plan.revision, key: "stop-7f3a9c2e41b8" });
    // Asked AT ONCE, as a window's guard would at a press: the answer is the act's own read, not the cache.
    const asked = await rpc<Shown>("snapshot");
    expect(asked.at).not.toBe(first.at);
    expect(Date.parse(asked.at)).toBeGreaterThan(Date.parse(receipt.endedAt));
    // And with nothing owed a snapshot is the cached one again, at once: the same roster, no new read.
    const again = await rpc<Shown>("snapshot");
    expect(again.at).toBe(asked.at);
  }, 60_000);

  // The roster's `at` and an act's `endedAt` are whole milliseconds of this server's clock. A status read that STARTS in
  // the very millisecond the act ended is the read after the act, and the window reads a tie as "before" (`<=`), with no
  // later read owed: "Reading…" to its bound. The server stamps both from ONE strictly increasing stamp: the later
  // event has the later stamp, also when the clock has not moved.
  it("a status read that starts in the millisecond an act ended is LATER than the act's end: one increasing stamp for both, also while the clock stands still", async () => {
    const first = await rpc<Shown>("snapshot");
    const plan = await rpc<{ revision: string }>("stopPlan", { instance: LEAD });
    // The clock stands still from here: whatever starts or ends now does so "in the same millisecond".
    const frozen = Date.now() + 2;
    const clock = vi.spyOn(Date, "now").mockReturnValue(frozen);
    try {
      const receipt = await rpc<{ endedAt: string }>("stopApply", { instance: LEAD, revision: plan.revision, key: "stop-7f3a9c2e41b8" });
      let after = first;
      for (let tries = 0; tries < 600 && after.at === first.at; tries += 1) {
        await new Promise((resolve) => setTimeout(resolve, 25));
        after = await rpc<Shown>("snapshot");
      }
      expect(after.at).not.toBe(first.at); // the read the act asked for has answered
      expect(Date.parse(receipt.endedAt)).toBeGreaterThanOrEqual(frozen); // the act ended at the frozen instant (or a stamp after it)
      expect(Date.parse(after.at)).toBeGreaterThan(Date.parse(receipt.endedAt)); // and the read after it is LATER, though the clock never moved
      // A second act and its read, still in that millisecond: later again, each in turn.
      const again = await rpc<{ endedAt: string }>("start", { instance: "weekly-digest-helper" });
      expect(Date.parse(again.endedAt)).toBeGreaterThan(Date.parse(after.at));
    } finally {
      clock.mockRestore();
    }
  }, 60_000);

  // With the event path: a patch published between the act's end and the act's own read keeps the OLDER read's `at`
  // (a patch never moves it), so a window that fetched the patched roster would hold one from before the act's end.
  // It cannot fetch it: a snapshot asked while the act's read is owed waits for that read (`clientSnapshot`), so what
  // the publish of the patch brings to the window is the act's own read, later than the act's end. (The patch's
  // change is then on the screen when that read ends, not before: the cost of never answering from before the act.)
  it("a patch published between an act's end and the act's own read does not pass for that read: the snapshot a window then asks waits for the act's read, and is later than the act's end", async () => {
    const plan = await rpc<{ revision: string }>("stopPlan", { instance: LEAD });
    await fake.behave({ status: { sleepMs: 4_000 }, [EVENTS]: { stdout: claimed() } });
    const published = server.harness.realtimeSignals.length;
    const tokens = () => server.harness.realtimeSignals.slice(published).map((signal) => (signal.payload as { at: string }).at);
    const receipt = await rpc<{ endedAt: string }>("stopApply", { instance: LEAD, revision: plan.revision, key: "stop-7f3a9c2e41b8" });
    // The act's own status read is held; the agent's events are named meanwhile, and the patch is published.
    await named();
    await until(() => tokens().length >= 1, "the patch is published");
    // The window acts on that publish and asks the snapshot: it is answered with the act's own read, not the patched cache.
    const fetched = await rpc<Shown>("snapshot");
    expect(Date.parse(fetched.at)).toBeGreaterThan(Date.parse(receipt.endedAt));
    // The act's own read is published too, with a token of its own.
    await until(() => tokens().length >= 2, "the act's own read is published");
    expect(new Set(tokens()).size).toBe(tokens().length);
  }, 60_000);

  it("fail safe: an events read that errors, answers a shape it does not know, or times out changes nothing and publishes nothing", async () => {
    const first = await rpc<Shown>("snapshot");
    const failures: [string, Record<string, unknown>, RegExp][] = [
      ["errors", { stdout: JSON.stringify({ schemaVersion: 1, ok: false, error: { code: "E_EVENTS_FAILED", message: "the log could not be read" } }), exit: 1 }, /oats instance events answered E_EVENTS_FAILED in \d+ ms$/],
      ["an unknown shape", { stdout: JSON.stringify({ schemaVersion: 1, ok: true, result: { eventsApi: 3, rows: [] } }) }, /oats instance events answered \S+ in \d+ ms$/],
      ["a timeout", { stdout: claimed(), sleepMs: 600_000 }, /oats instance events answered OATS_TIMEOUT in \d+ ms$/],
    ];
    for (const [what, behaviour, said] of failures) {
      // The status read is held meanwhile, so that nothing else can change the snapshot.
      await fake.behave({ status: { sleepMs: 8_000 }, [EVENTS]: behaviour });
      const published = server.harness.realtimeSignals.length;
      const before = eventPath().length;
      await named();
      await until(() => eventPath().length > before, `${what}: the server says what it dropped`);
      expect(eventPath().at(-1), what).toMatch(said);
      expect(eventPath().at(-1), what).toContain(`the event path: ${LEAD}: nothing changed:`);
      expect(server.harness.realtimeSignals.length, what).toBe(published);
      const now = await rpc<Shown>("snapshot");
      expect(lead(now).waiting, what).toBeNull();
      // Let the held status read (and the one the next signal asks for) pass before the next case.
      await fake.behave({});
      await until(async () => (await rpc<Shown>("snapshot")).at !== now.at, `${what}: the status read answers`);
    }
    expect((await rpc<Shown>("snapshot")).agents).toEqual(first.agents);
  }, 120_000);

  it("fail safe: a file that two rows of the snapshot answer to reads no events", async () => {
    // A roster with the same agent twice (two rows of one name under one soul): the file selects no ONE row.
    const status = JSON.parse(await readFile(join(FIXTURES, "roster", "status.json"), "utf8")) as { agents: { name: string; instances: { instance: string }[] }[] };
    const group = status.agents.find((candidate) => candidate.instances.some((instance) => instance.instance === LEAD))!;
    group.instances.push(structuredClone(group.instances.find((instance) => instance.instance === LEAD)!));
    await fake.behave({ status: { stdout: JSON.stringify(status) } });
    const twice = await rpc<Shown>("snapshot");
    expect(twice.agents.filter((agent) => agent.instance === LEAD)).toHaveLength(2);
    await named();
    await expect.poll(async () => (await calls("status")).length, { timeout: MIN_INTERVAL_MS + 4_000 }).toBe(2);
    expect(await calls(EVENTS)).toEqual([]);
  }, 20_000);

  it("fail safe: a file that names no agent of the snapshot, or no file at all, reads no events; the status read is asked for as before", async () => {
    await rpc("snapshot");
    await named(["oats-developer--someone-new-developer.jsonl"]); // an agent spawned since: the status read brings it
    await named([`another-soul--${LEAD}.jsonl`]); // the instance's name under another agent: not this row's file
    await named([]);
    await expect.poll(async () => (await calls("status")).length, { timeout: MIN_INTERVAL_MS + 4_000 }).toBe(2);
    expect(await calls(EVENTS)).toEqual([]);
    expect(eventPath()).toEqual([]);
  }, 20_000);

  it("never two events reads at once for one instance: signals meanwhile make one more read, when the first has ended", async () => {
    await rpc("snapshot");
    const HELD_MS = 2_500; // long enough that the three signals below land in it, on any host
    await fake.behave({ status: { sleepMs: 8_000 }, [EVENTS]: { stdout: eventsAnswer(), sleepMs: HELD_MS } });
    await named();
    await until(async () => (await calls(EVENTS)).length === 1, "the first events read started");
    await named();
    await named();
    await named();
    await until(() => eventPath().length >= 2, "both reads have ended");
    const reads = await calls(EVENTS);
    expect(reads).toHaveLength(2); // three signals during the first read: ONE more read
    // The second started after the first had ended: no sooner than the time the first was held.
    expect(Date.parse(reads[1]!.at) - Date.parse(reads[0]!.at)).toBeGreaterThanOrEqual(HELD_MS - 50);
  }, 40_000);

  /** The fixtures' roster with `count` more agents beside the lead, each a copy of its row under a name of its own (shaped: for the line of events reads). */
  const rosterOf = async (count: number) => {
    const status = JSON.parse(await readFile(join(FIXTURES, "roster", "status.json"), "utf8")) as { agents: { name: string; instances: { instance: string; home: string }[] }[] };
    const group = status.agents.find((candidate) => candidate.instances.some((instance) => instance.instance === LEAD))!;
    const row = group.instances.find((instance) => instance.instance === LEAD)!;
    const names = Array.from({ length: count }, (_, n) => `line-${n}-lead`);
    for (const name of names) group.instances.push({ ...structuredClone(row), instance: name, home: row.home.replace(LEAD, name) });
    return { stdout: JSON.stringify(status), names, files: names.map((name) => `${group.name}--${name}.jsonl`) };
  };
  /** The most events reads alive at once, sampled until `done()`. */
  const mostAlive = async (done: () => boolean | Promise<boolean>) => {
    let most = 0;
    const deadline = Date.now() + 60_000;
    while (!(await done())) {
      if (Date.now() > deadline) throw new Error("never: the events reads ended");
      const living = (await Promise.all((await calls(EVENTS)).map((call) => alive(call.pid)))).filter(Boolean).length;
      most = Math.max(most, living);
      await new Promise((resolve) => setTimeout(resolve, 15));
    }
    return most;
  };

  it("ten instances named in ten signals: never more than two events reads alive, each read in the order it was named, and all ten are patched", async () => {
    const roster = await rosterOf(10);
    await fake.behave({ status: { stdout: roster.stdout } });
    const first = await rpc<Shown>("snapshot");
    expect(first.agents.filter((agent) => roster.names.includes(agent.instance))).toHaveLength(10);
    // The status read is held nearly as long as the kernel's own limit allows: all ten are patched well inside it, on any host.
    await fake.behave({ status: { stdout: roster.stdout, sleepMs: 19_000 }, [EVENTS]: { stdout: claimed(), sleepMs: 400 } });
    for (const file of roster.files) await named([file]); // ten batches, as a mass stop writes them
    await named([roster.files[9]!]); // named again while it waits in line: it is in the line once
    const patchedAll = async () => (await rpc<Shown>("snapshot")).agents.filter((agent) => roster.names.includes(agent.instance) && agent.waiting !== null).length === 10;
    const most = await mostAlive(patchedAll);
    expect(most).toBeLessThanOrEqual(EVENTS_READS_MAX);
    const reads = await calls(EVENTS);
    // Each once, in the order they were named (two are read at a time, and the fake logs the two of a pair as they happen to start: one place apart at most).
    const order = reads.map((call) => call.argv[2]!);
    expect([...order].sort()).toEqual([...roster.names].sort());
    expect(roster.names.map((name, at) => Math.abs(order.indexOf(name) - at) <= 1)).toEqual(roster.names.map(() => true));
    expect((await rpc<Shown>("snapshot")).at).toBe(first.at); // all from their events: the status read is still held
  }, 90_000);

  it("a line of more than eight is dropped whole: those instances are left to the status read, which was asked for all the while", async () => {
    const roster = await rosterOf(12);
    await fake.behave({ status: { stdout: roster.stdout } });
    const first = await rpc<Shown>("snapshot");
    await fake.behave({ status: { stdout: roster.stdout, sleepMs: 4_000 }, [EVENTS]: { stdout: claimed(), sleepMs: 3_000 } });
    for (const file of roster.files) await named([file]); // two are read, eight wait, the eleventh makes nine: the line is dropped; the twelfth waits alone
    await until(() => eventPath().some((line) => line === "the event path: 9 instances wait for their events to be read: none of them is read, the status read carries them"), "the line is dropped");
    const most = await mostAlive(async () => (await calls(EVENTS)).length === 3 && eventPath().filter((line) => line.includes("from its events read")).length === 3);
    expect(most).toBeLessThanOrEqual(EVENTS_READS_MAX);
    expect((await calls(EVENTS)).map((call) => call.argv[2]).sort()).toEqual([roster.names[0], roster.names[1], roster.names[11]].sort());
    // None is lost: the status read the signals asked for answers, for every one of them.
    await until(async () => (await rpc<Shown>("snapshot")).at !== first.at, "the status read answers");
    expect((await calls("status")).length).toBeGreaterThanOrEqual(2);
  }, 90_000);

  it("a change of settings empties the line: an instance that waited is not read for the deployment that was left", async () => {
    const roster = await rosterOf(3);
    await fake.behave({ status: { stdout: roster.stdout } });
    await rpc<Shown>("snapshot");
    const other = join(fake.deployment, "another");
    await mkdir(other, { recursive: true });
    await writeFile(join(other, "oats-local.yaml"), "# another deployment, for this test\n");
    await fake.behave({ status: { stdout: roster.stdout }, [EVENTS]: { stdout: claimed(), sleepMs: 3_000 } });
    for (const file of roster.files) await named([file]); // two are read, the third waits
    await until(async () => (await calls(EVENTS)).length === 2, "two events reads started");
    await server.harness.setSettings({ deployment: other });
    await until(() => eventPath().filter((line) => line.endsWith("the settings changed while its events were read")).length === 2, "both reads in flight are dropped");
    await until(async () => (await rpc<Shown>("snapshot")).ok === true, "the other deployment's roster is read");
    await new Promise((resolve) => setTimeout(resolve, 300)); // (time for a read of the third to start, were one made)
    expect((await calls(EVENTS)).map((call) => call.argv[2]).sort()).toEqual([roster.names[0], roster.names[1]].sort());
  }, 40_000);

  it("an events answer read under settings that changed meanwhile is dropped: it is not this deployment's", async () => {
    await rpc<Shown>("snapshot");
    // Another deployment, whose roster has an agent of the same name (the fake answers the same roster anywhere).
    const other = join(fake.deployment, "another");
    await mkdir(other, { recursive: true });
    await writeFile(join(other, "oats-local.yaml"), "# another deployment, for this test\n");
    await fake.behave({ [EVENTS]: { stdout: claimed(), sleepMs: 3_000 } });
    await named();
    await until(async () => (await calls(EVENTS)).length === 1, "the events read started");
    await server.harness.setSettings({ deployment: other });
    await until(() => eventPath().length >= 1, "the events answer is dropped");
    expect(eventPath()).toEqual([`the event path: ${LEAD}: nothing changed: the settings changed while its events were read`]);
    const now = await rpc<Shown>("snapshot");
    expect(lead(now).waiting).toBeNull();
  }, 40_000);

  it("stopped: the row reads stopped at once, and an act for that agent goes to the kernel as before (nothing of the lifecycle reads the patch)", async () => {
    const first = await rpc<Shown>("snapshot");
    const stopped = new Date(Date.parse(first.at) + 1).toISOString(); // after the snapshot's read started
    await fake.behave({ status: { sleepMs: 4_000 }, [EVENTS]: { stdout: eventsAnswer({ events: [{ eventsApi: 2, kind: "stopped", at: stopped, incarnation: "2026-11-23T09:00:00.000Z", producer: "kernel", data: { state: "stopped" } }] }) } });
    await named();
    await until(async () => lead(await rpc<Shown>("snapshot")).running === false, "the stop is shown");
    const patched = await rpc<Shown>("snapshot");
    expect([patched.at, lead(patched).running, lead(patched).runtimeState]).toEqual([first.at, false, "stopped"]);
    expect(eventPath().at(-1)).toMatch(new RegExp(`^the event path: ${LEAD}: stopped, from its events read in \\d+ ms$`));
    // An act: the stop's plan is asked of the kernel (the fake answers its fixture), as on any roster a moment old.
    const plan = await rpc<{ instance: string }>("stopPlan", { instance: LEAD });
    expect(plan.instance).toBe(LEAD);
    expect((await calls("instance stop --plan")).length).toBe(1);
  }, 40_000);
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

  it("carries the kernel's marker of an unconfirmed outcome on the refusal, as its one issue; a refusal without the marker has none", async () => {
    const input = (key: string) => ({ soul: "oats-developer", name: "x-developer", task: "t", key });
    const failure = (promise: Promise<unknown>) =>
      promise.then(
        () => {
          throw new Error("expected a refusal");
        },
        (error: { code?: string; message: string; issues?: unknown }) => ({ code: error.code, message: error.message, issues: error.issues, unconfirmed: isUnconfirmed(error) }),
      );
    // SHAPED, not recorded (a rollback that fails cannot be made in the real run): the marker and the words are the
    // kernel's, awebai/oats lib/core.mjs at v0.70.5: `unconfirmedSpawn` (3863-3865) and the note of line 5235.
    const refuse = (details: unknown) => fake.behave({ spawn: { stdout: JSON.stringify({ schemaVersion: 1, ok: false, error: { code: "E_BACKEND_NOT_READY", message: "not launched — rollback INCOMPLETE, clean up manually: instance home /abs/home: still present", details } }) } });
    await refuse({ unconfirmed: true, home: "/abs/home" });
    expect(await failure(rpc("spawn", input("spawn-1f0c9a7e")))).toEqual({
      code: "conflict",
      message: "E_BACKEND_NOT_READY: not launched — rollback INCOMPLETE, clean up manually: instance home /abs/home: still present",
      issues: [{ message: "unconfirmed", path: ["details", "unconfirmed"] }],
      unconfirmed: true,
    });
    // The same words without the marker: the refusal's text alone.
    await refuse({ home: "/abs/home" });
    const plain = await failure(rpc("spawn", input("spawn-2a1d8b6f")));
    expect([plain.code, plain.issues ?? null, plain.unconfirmed]).toEqual(["conflict", null, false]);
    // A list under the marker's name (E_SOUL_UNKNOWN's unconfirmed members) is no marker.
    await refuse({ unconfirmed: [{ key: "oats", reason: "unreachable", detail: "d" }] });
    const listed = await failure(rpc("spawn", input("spawn-3c5e7a90")));
    expect([listed.issues ?? null, listed.unconfirmed]).toEqual([null, false]);
  });

  // Stop, start, restart and retire: test/lifecycle/server.test.ts.
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
    // the pages and the lifecycle; another feature (the panel, automations, spawn: test/spawn/server.test.ts) holds the list of its own verbs in its tests.
    const mine = { ...rosterHost, ...workspaceHost, ...lifecycleHost };
    const retryable = Object.entries(mine).filter(([, method]) => "experimental_retryable" in method && method.experimental_retryable).map(([name]) => name);
    expect(retryable.sort()).toEqual(["capabilities", "discover", "rosterEvents", "servers", "souls", "status", "stopPlan", "teams", "version"]);
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
