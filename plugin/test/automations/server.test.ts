// Automations' verbs through the whole backend: bb's fake plugin host, the real host entry, and
// the fake `oats` printing what the real kernel printed.
import { afterEach, describe, expect, it } from "vitest";
import { automationList, host, triggerStatus } from "../../contract/automations";
import { LISTS_TTL_MS } from "../../server/automations";
import { startBackend, type Backend } from "../support/backend";
import { alive } from "../support/fake-oats";

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

  it("with lists that are slow and a roster that keeps changing, one pair of list processes runs at a time and one read waits behind it", async () => {
    backend = await startBackend({ verbs: { "schedule list": { file: "automations/schedule-list.json", sleepMs: 6_000 }, "trigger list": { file: "automations/trigger-list.json", sleepMs: 6_000 } } });
    const running = backend;
    const living = async () => {
      const calls = (await running.fake.calls()).filter((call) => call.verb.endsWith(" list"));
      return (await Promise.all(calls.map((call) => alive(call.pid)))).filter(Boolean).length;
    };
    const first = running.rpc<Lists>("automations");
    for (let wait = 0; wait < 100 && (await living()) < 2; wait += 1) await new Promise((resolve) => setTimeout(resolve, 100)); // the first pair runs
    const asks: Promise<Lists>[] = [];
    let most = 0;
    for (let change = 0; change < 3; change += 1) {
      await running.rpc("refresh"); // a new read of OATS: the roster the lists were made beside is no longer the newest
      asks.push(running.rpc<Lists>("automations"));
      await new Promise((resolve) => setTimeout(resolve, 150));
      most = Math.max(most, await living());
    }
    expect(most).toBe(2);
    const [second, third, fourth] = await Promise.all(asks);
    expect((await first).at).not.toBe(second!.at);
    expect([third!.at, fourth!.at]).toEqual([second!.at, second!.at]);
    expect(await argvs(running, "schedule list")).toHaveLength(2);
    expect(await argvs(running, "trigger list")).toHaveLength(2);
    // The read that waited was made beside the newest roster: the next ask is answered by it.
    expect((await running.rpc<Lists>("automations")).at).toBe(second!.at);
    expect(await argvs(running, "schedule list")).toHaveLength(2);
  }, 40_000);

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
    const refusal = JSON.stringify({ schemaVersion: 1, ok: false, error: { code: "E_SCHEDULE_INVALID", message: "/abs/deployment/oats-schedules.json must be {version: 1|2, jobs: {}}" } });
    backend = await startBackend({ verbs: { "schedule list": { stdout: refusal } } });
    const lists = await backend.rpc<Lists>("automations");
    expect(lists.schedule).toEqual({ ok: false, code: "E_SCHEDULE_INVALID", message: "/abs/deployment/oats-schedules.json must be {version: 1|2, jobs: {}}" });
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
  it("bb may retry the reads, and never an act", () => {
    const retryable = Object.entries(host).filter(([, method]) => "experimental_retryable" in method && method.experimental_retryable).map(([name]) => name);
    expect(retryable.sort()).toEqual(["scheduleDraft", "scheduleHomeOperations", "scheduleList", "scheduleSoulBackends", "triggerList", "triggerStatus"]);
    expect(Object.keys(host).filter((name) => !retryable.includes(name)).sort()).toEqual(["automationDescribe", "automationEnable", "automationTest", "scheduleAdd", "scheduleReconcile", "scheduleRemove", "scheduleRun", "scheduleUpdate", "schedulerEnable"]);
  });
});

describe("the acts", () => {
  const acts = async (running: Backend) => (await running.fake.calls()).filter((call) => !["status", "version", "schedule list", "trigger list"].includes(call.verb)).map((call) => call.argv);

  it("each is the kernel's own command for the row the list names, by its qualified id", async () => {
    backend = await startBackend();
    await backend.rpc("automationEnable", { kind: "schedule", id: "local/weekly-cleanup", enabled: true });
    await backend.rpc("automationEnable", { kind: "trigger", id: "old-prs", enabled: false });
    await backend.rpc("scheduleRun", { id: "local/daily-review" });
    await backend.rpc("automationTest", { kind: "schedule", id: "local/daily-review" });
    await backend.rpc("automationTest", { kind: "trigger", id: "oats-real/proposal-review" });
    await backend.rpc("automationDescribe", { kind: "schedule", id: "local/status-check", description: "--force" });
    await backend.rpc("scheduleRemove", { id: "local/weekly-cleanup" });
    await backend.rpc("scheduleReconcile", { id: "local/status-check" });
    await backend.rpc("schedulerEnable");
    expect(await acts(backend)).toEqual([
      ["schedule", "enable", "local/weekly-cleanup", "--json"],
      ["trigger", "disable", "local/old-prs", "--json"],
      ["schedule", "run", "local/daily-review", "--json"],
      ["schedule", "test", "local/daily-review", "--json"],
      ["trigger", "test", "oats-real/proposal-review", "--json"],
      ["schedule", "update", "local/status-check", "--description=--force", "--json"],
      ["schedule", "remove", "local/weekly-cleanup", "--json"],
      ["schedule", "reconcile", "local/status-check", "--json"],
      ["schedule", "host", "install", "--json"],
    ]);
  });

  it("answers what the kernel answered: the row as it is now, the run with its outcome, the test, the check, the scheduler", async () => {
    backend = await startBackend();
    expect(await backend.rpc("automationEnable", { kind: "schedule", id: "local/weekly-cleanup", enabled: true })).toMatchObject({ row: { id: "local/weekly-cleanup", enabledHere: true } });
    expect(await backend.rpc("scheduleRun", { id: "local/daily-review" })).toMatchObject({ run: { outcome: "launched" } });
    expect(await backend.rpc("automationTest", { kind: "trigger", id: "oats-real/proposal-review" })).toMatchObject({ ok: true, account: "ana", wouldFire: [{ label: "#41" }, { label: "#42" }, { label: "#43", held: true }] });
    expect(await backend.rpc("scheduleReconcile", { id: "local/status-check" })).toMatchObject({ reconciled: "unknown" });
    expect(await backend.rpc("schedulerEnable")).toMatchObject({ scheduler: { installed: true, active: true }, warnings: [] });
  });

  it("after an act the lists are read again for the next client", async () => {
    backend = await startBackend();
    await backend.rpc("automations");
    await backend.rpc("automationEnable", { kind: "schedule", id: "local/weekly-cleanup", enabled: true });
    await backend.rpc("automations");
    expect(await argvs(backend, "schedule list")).toHaveLength(2);
  }, 20_000);

  it("an act that ends while the lists are being read makes the next lists a read after it, never one beside it", async () => {
    backend = await startBackend();
    const running = backend;
    await running.rpc("automations");
    await running.fake.behave({
      "schedule enable": { file: "automations/schedule-enable.json", sleepMs: 2_000 },
      "schedule list": { file: "automations/schedule-list.json", sleepMs: 5_000 },
      "trigger list": { file: "automations/trigger-list.json", sleepMs: 5_000 },
    });
    const act = running.rpc("automationEnable", { kind: "schedule", id: "local/weekly-cleanup", enabled: true });
    await running.rpc("refresh");
    const during = running.rpc<Lists>("automations"); // a read of the lists that starts before the act ends
    await act;
    const after = running.rpc<Lists>("automations");
    await new Promise((resolve) => setTimeout(resolve, 300));
    const calls = (await running.fake.calls()).filter((call) => call.verb.endsWith(" list"));
    expect((await Promise.all(calls.map((call) => alive(call.pid)))).filter(Boolean)).toHaveLength(2);
    expect((await after).at).not.toBe((await during).at);
    expect(await argvs(running, "schedule list")).toHaveLength(3);
  }, 40_000);

  it("only a confirmed test of a capability source's trigger carries --run-source", async () => {
    backend = await startBackend();
    await backend.rpc("automationTest", { kind: "trigger", id: "oats-real/harvest-review", runSource: true });
    await expect(backend.rpc("automationTest", { kind: "trigger", id: "oats-real/proposal-review", runSource: true })).rejects.toThrow("has no capability source for a test to run");
    await expect(backend.rpc("automationTest", { kind: "schedule", id: "local/daily-review", runSource: true })).rejects.toThrow();
    await expect(backend.rpc("automationTest", { kind: "trigger", id: "oats-real/harvest-review", runSource: false })).rejects.toThrow();
    await expect(backend.rpc("automationTest", { kind: "trigger", id: "oats-real/harvest-review", runSource: "yes" })).rejects.toThrow();
    expect(await acts(backend)).toEqual([["trigger", "test", "oats-real/harvest-review", "--run-source", "--json"]]);
  });

  it("an id the list does not name, a flag, a path or one more key starts no process", async () => {
    backend = await startBackend();
    for (const [method, input] of [
      ["automationEnable", { kind: "schedule", id: "local/nope", enabled: true }],
      ["automationEnable", { kind: "trigger", id: "local/daily-review", enabled: true }],
      ["scheduleRun", { id: "--force" }],
      ["scheduleRun", { id: "oats-real/proposal-review" }],
      ["scheduleRun", { id: "local/daily-review", force: true }],
      ["automationTest", { kind: "schedule", id: "../../x" }],
      ["automationDescribe", { kind: "schedule", id: "local/status-check", description: "x", file: "/etc/passwd" }],
      ["scheduleRemove", { id: "local/daily-review", force: true }],
      ["scheduleReconcile", { id: "local/status-check", clear: true }],
      ["schedulerEnable", { maxConcurrent: 99 }],
    ] as const) await expect(backend.rpc(method, input), `${method} ${JSON.stringify(input)}`).rejects.toThrow();
    expect(await acts(backend)).toEqual([]);
  });

  it("a summary out of the kernel's rule, and a workspace item's summary or removal, start no process", async () => {
    backend = await startBackend();
    await expect(backend.rpc("automationDescribe", { kind: "schedule", id: "local/status-check", description: "two\nlines" })).rejects.toThrow("A summary is one line of up to 200 characters, without control characters.");
    await expect(backend.rpc("automationDescribe", { kind: "schedule", id: "oats-real/nightly-digest", description: "Mine now" })).rejects.toThrow("its summary is changed in its repository");
    await expect(backend.rpc("scheduleRemove", { id: "oats-real/nightly-digest" })).rejects.toThrow("it is removed in its repository");
    expect(await acts(backend)).toEqual([]);
  });

  it("an act on a list that cannot be read is refused with why the list cannot be read, never as a row the list does not name, and starts no process", async () => {
    const refusal = JSON.stringify({ schemaVersion: 1, ok: false, error: { code: "E_SCHEDULE_INVALID", message: "/abs/deployment/oats-schedules.json must be {version: 1|2, jobs: {}}" } });
    backend = await startBackend({ verbs: { "schedule list": { stdout: refusal } } });
    await expect(backend.rpc("automationEnable", { kind: "schedule", id: "local/daily-review", enabled: false })).rejects.toThrow("E_SCHEDULE_INVALID: /abs/deployment/oats-schedules.json must be {version: 1|2, jobs: {}}");
    await expect(backend.rpc("scheduleRun", { id: "local/daily-review" })).rejects.toThrow(/^E_SCHEDULE_INVALID: /);
    expect(await argvs(backend, "schedule disable")).toEqual([]);
    expect(await argvs(backend, "schedule run")).toEqual([]);
    // The other list answers: its rows can be acted on.
    await backend.rpc("automationEnable", { kind: "trigger", id: "local/pr-triage", enabled: false });
    expect(await argvs(backend, "trigger disable")).toHaveLength(1);
  });

  it("the kernel's refusal of an act is shown with its code and message", async () => {
    const refusals = { "schedule run": "schedule-run-disabled.json", "schedule host install": "host-install-refused.json", "trigger test": "trigger-test-source-unconfirmed.json" };
    backend = await startBackend({ verbs: Object.fromEntries(Object.entries(refusals).map(([verb, file]) => [verb, { file: `automations/${file}` }])) });
    await expect(backend.rpc("scheduleRun", { id: "local/weekly-cleanup" })).rejects.toThrow("E_SCHEDULE_DISABLED: schedule weekly-cleanup is disabled; enable it or pass --force");
    await expect(backend.rpc("schedulerEnable")).rejects.toThrow("E_SCHEDULE_HOST: systemctl --user daemon-reload failed: Failed to connect to bus: No medium found");
    await expect(backend.rpc("automationTest", { kind: "trigger", id: "oats-real/harvest-review" })).rejects.toThrow(/^E_TRIGGER_SOURCE_RUN: /);
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
    const refusal = JSON.stringify({ schemaVersion: 1, ok: false, error: { code: "E_TRIGGER_UNKNOWN", message: 'no trigger "local/pr-triage" in /abs/deployment' } });
    backend = await startBackend({ verbs: { "trigger status": { stdout: refusal } } });
    await expect(backend.rpc("triggerStatus", { id: "local/pr-triage" })).rejects.toThrow('E_TRIGGER_UNKNOWN: no trigger "local/pr-triage" in /abs/deployment');
  });
});
