// Automations' verbs through the whole backend: bb's fake plugin host, the real host entry, and
// the fake `oats` printing what the real kernel printed.
import { afterEach, describe, expect, it } from "vitest";
import { automationList, host, triggerStatus } from "../../contract/automations";
import { LISTS_TTL_MS } from "../../server/automations";
import { startBackend, type Backend } from "../support/backend";

let backend: Backend | undefined;
afterEach(async () => {
  await backend?.dispose();
  backend = undefined;
});

type Lists = { at: string; hostId: string | null; oats: { version: string; features: string[]; automationsApi: number | null } | null; schedule: { ok: boolean; list?: unknown; code?: string; message?: string }; trigger: { ok: boolean; list?: unknown; code?: string; message?: string } };
const argvs = async (running: Backend, verb: string) => (await running.fake.calls()).filter((call) => call.verb === verb).map((call) => call.argv);

describe("automations", () => {
  it("reads both lists with the kernel's own commands, in the deployment, and names the machine", async () => {
    backend = await startBackend();
    const lists = await backend.rpc<Lists>("automations");
    expect(lists.hostId).toBe("host_falcon");
    expect(automationList.parse(lists.schedule.list).rows).toHaveLength(11);
    expect(automationList.parse(lists.trigger.list).rows).toHaveLength(7);
    expect(await argvs(backend, "schedule list")).toEqual([["schedule", "list", "--json"]]);
    expect(await argvs(backend, "trigger list")).toEqual([["trigger", "list", "--json"]]);
    expect((await backend.fake.calls()).filter((call) => call.verb.endsWith(" list")).map((call) => call.cwd)).toEqual([backend.fake.deployment, backend.fake.deployment]);
  });

  it("says what this OATS is, from the server's one version read", async () => {
    backend = await startBackend();
    const lists = await backend.rpc<Lists>("automations");
    expect(lists.oats).toMatchObject({ version: "0.70.0", automationsApi: 1 });
    expect(lists.oats!.features).toEqual(expect.arrayContaining(["automations", "automation-descriptions", "trigger-sources"]));
  });

  it("an OATS that does not list the feature is not asked for the lists", async () => {
    const old = JSON.stringify({ schemaVersion: 1, name: "@awebai/oats", version: "0.28.0", desktopApi: 1, scheduleApi: 2, features: ["schedule"] });
    backend = await startBackend({ verbs: { version: { stdout: old } } });
    const lists = await backend.rpc<Lists>("automations");
    expect(lists.oats).toEqual({ version: "0.28.0", features: ["schedule"], automationsApi: null });
    expect(lists.schedule).toEqual({ ok: false, code: "OATS_NO_AUTOMATIONS", message: "OATS 0.28.0 has no automations lists: they need OATS 0.29 or later." });
    expect(lists.trigger).toMatchObject({ ok: false, code: "OATS_NO_AUTOMATIONS" });
    expect(await argvs(backend, "schedule list")).toEqual([]);
    expect(await argvs(backend, "trigger list")).toEqual([]);
  });

  it("an OATS that lists the feature with another api is not asked either: the lists' shape is the api's", async () => {
    backend = await startBackend({ verbs: { version: { stdout: JSON.stringify({ schemaVersion: 1, version: "9.0.0", automationsApi: 2, features: ["automations"] }) } } });
    const lists = await backend.rpc<Lists>("automations");
    expect(lists.schedule).toMatchObject({ ok: false, code: "OATS_NO_AUTOMATIONS" });
    expect(await argvs(backend, "schedule list")).toEqual([]);
  });

  it("what the plugin itself lacks is said in the server's own words for it, and no list is asked for", async () => {
    backend = await startBackend({ settings: { oatsBin: "/nowhere/oats" } });
    const lists = await backend.rpc<Lists>("automations");
    expect(lists.schedule).toMatchObject({ ok: false, code: "OATS_NOT_FOUND", message: expect.stringMatching(/^oats was not found on .+: install OATS there, or set the path to oats in the OATS plugin's settings\./) });
    expect(lists.trigger).toEqual(lists.schedule);
    expect([lists.hostId, lists.oats]).toEqual([null, null]);
    expect(await backend.verbs()).toEqual([]);
  });

  it("one read serves every client that asks while the roster stands as it was read", async () => {
    backend = await startBackend();
    const first = await backend.rpc<Lists>("automations");
    const [second, third] = await Promise.all([backend.rpc<Lists>("automations"), backend.rpc<Lists>("automations")]);
    expect([second.at, third.at]).toEqual([first.at, first.at]);
    expect(await argvs(backend, "schedule list")).toHaveLength(1);
    expect(await argvs(backend, "trigger list")).toHaveLength(1);
    expect(LISTS_TTL_MS).toBeLessThanOrEqual(30_000);
  });

  it("Retry reads the lists again: a new read of OATS makes the next lists new", async () => {
    backend = await startBackend();
    const first = await backend.rpc<Lists>("automations");
    await backend.fake.behave({ "schedule list": { file: "automations/schedule-list-scheduler-off.json" } });
    await backend.rpc("refresh");
    const second = await backend.rpc<Lists>("automations");
    expect(second.at).not.toBe(first.at);
    expect(automationList.parse(second.schedule.list).scheduler).toMatchObject({ installed: false });
    expect(await argvs(backend, "schedule list")).toHaveLength(2);
  }, 20_000);

  it("a list the kernel refuses is that list's refusal, with the kernel's code and message; the other list is still answered", async () => {
    const refusal = JSON.stringify({ schemaVersion: 1, ok: false, error: { code: "E_SCHEDULE_INVALID", message: "oats-schedules.json: jobs must be an object" } });
    backend = await startBackend({ verbs: { "schedule list": { stdout: refusal } } });
    const lists = await backend.rpc<Lists>("automations");
    expect(lists.schedule).toEqual({ ok: false, code: "E_SCHEDULE_INVALID", message: "oats-schedules.json: jobs must be an object" });
    expect(lists.trigger.ok).toBe(true);
  });

  it("an answer that is no list is the plugin's own OATS_BAD_ANSWER, never an empty page", async () => {
    backend = await startBackend({ verbs: { "trigger list": { stdout: JSON.stringify({ schemaVersion: 1, ok: true, result: { triggerApi: 1 } }) } } });
    const lists = await backend.rpc<Lists>("automations");
    expect(lists.trigger).toMatchObject({ ok: false, code: "OATS_BAD_ANSWER" });
    expect(lists.schedule.ok).toBe(true);
  });
});

describe("the host verbs", () => {
  it("are all reads: bb may retry each, so each runs under the read limit", () => {
    const retryable = Object.entries(host).filter(([, method]) => "experimental_retryable" in method && method.experimental_retryable).map(([name]) => name);
    expect(retryable.sort()).toEqual(["scheduleList", "triggerList", "triggerStatus"]);
    expect(Object.keys(host).sort()).toEqual(retryable);
  });
});

describe("triggerStatus", () => {
  it("reads one trigger's state by its qualified id, named as its source names events", async () => {
    backend = await startBackend();
    const pr = triggerStatus.parse(await backend.rpc("triggerStatus", { id: "oats-real/proposal-review" }));
    expect(pr.fired.map((fired) => fired.label)).toEqual(["#41", "#42"]);
    const source = triggerStatus.parse(await backend.rpc("triggerStatus", { id: "oats-real/harvest-review" }));
    expect(source.fired.map((fired) => fired.label)).toEqual(["harvest/a"]);
    expect(source.source).toEqual({ capability: "acme.graph", name: "harvest-branches" });
    expect(await argvs(backend, "trigger status")).toEqual([
      ["trigger", "status", "oats-real/proposal-review", "--json"],
      ["trigger", "status", "oats-real/harvest-review", "--json"],
    ]);
  });

  it("a bare local id is the local trigger's", async () => {
    backend = await startBackend();
    await backend.rpc("triggerStatus", { id: "pr-triage" });
    expect(await argvs(backend, "trigger status")).toEqual([["trigger", "status", "local/pr-triage", "--json"]]);
  });

  it("an id that is no trigger of the current list starts no process", async () => {
    backend = await startBackend();
    for (const id of ["local/nope", "oats-real/nightly-digest", "--dir", "../../etc/passwd", "a/b/c", "x y", ""]) {
      await expect(backend.rpc("triggerStatus", { id }), id).rejects.toThrow();
    }
    await expect(backend.rpc("triggerStatus", { id: "local/pr-triage", source: "x" })).rejects.toThrow();
    await expect(backend.rpc("triggerStatus", { id: "local/pr-triage", home: "/tmp" })).rejects.toThrow();
    expect(await argvs(backend, "trigger status")).toEqual([]);
  });

  it("the kernel's refusal is shown with its code and message", async () => {
    const refusal = JSON.stringify({ schemaVersion: 1, ok: false, error: { code: "E_TRIGGER_UNKNOWN", message: "no trigger local/pr-triage" } });
    backend = await startBackend({ verbs: { "trigger status": { stdout: refusal } } });
    await expect(backend.rpc("triggerStatus", { id: "local/pr-triage" })).rejects.toThrow("E_TRIGGER_UNKNOWN: no trigger local/pr-triage");
  });
});
