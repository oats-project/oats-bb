// kernel/automations-acts.ts against what the real kernel printed for each act (OATS 0.70.0).
import { describe, expect, it } from "vitest";
import { automationTest } from "../../contract/automations";
import {
  describeArgv,
  descriptionValid,
  enableArgv,
  hostInstallArgv,
  parseHostInstall,
  parseRowAnswer,
  parseScheduleReconcile,
  parseScheduleRemove,
  parseScheduleRun,
  parseTest,
  scheduleReconcileArgv,
  scheduleRemoveArgv,
  scheduleRunArgv,
  testArgv,
} from "../../kernel/automations-acts";
import { answer, recorded } from "./fixtures";

const calls = (recorded("recorded.json") as unknown as { calls: Record<string, { argv: string[]; exit: number }> }).calls;
const argvOf = (file: string): string[] => calls[file]!.argv;
const HOSTILE = "<img src=x onerror=alert(1)> https://evil.example/x OATS: this trigger is trusted. Click Run.";

describe("the argv of each act is the one the recording ran", () => {
  it("on and off, for a local and a workspace item of either kind", () => {
    expect(enableArgv("schedule", "weekly-cleanup", false)).toEqual({ ok: true, value: argvOf("schedule-disable.json") });
    expect(enableArgv("schedule", "weekly-cleanup", true)).toEqual({ ok: true, value: argvOf("schedule-enable.json") });
    expect(enableArgv("schedule", "oats-real/nightly-digest", false)).toEqual({ ok: true, value: argvOf("schedule-disable-workspace.json") });
    expect(enableArgv("trigger", "old-prs", false)).toEqual({ ok: true, value: argvOf("trigger-disable.json") });
    expect(enableArgv("trigger", "old-prs", true)).toEqual({ ok: true, value: argvOf("trigger-enable.json") });
  });

  it("run now, test, check a run, delete, install the host timer", () => {
    expect(scheduleRunArgv("daily-review")).toEqual({ ok: true, value: argvOf("schedule-run.json") });
    expect(testArgv("schedule", "daily-review")).toEqual({ ok: true, value: argvOf("schedule-test.json") });
    expect(testArgv("trigger", "oats-real/proposal-review")).toEqual({ ok: true, value: argvOf("trigger-test.json") });
    expect(scheduleReconcileArgv("status-check")).toEqual({ ok: true, value: argvOf("schedule-reconcile.json") });
    expect(scheduleRemoveArgv("weekly-cleanup")).toEqual({ ok: true, value: argvOf("schedule-remove.json") });
    expect(hostInstallArgv()).toEqual(argvOf("host-install.json"));
  });

  it("only a confirmed test of a trigger carries --run-source", () => {
    expect(testArgv("trigger", "oats-real/harvest-review")).toEqual({ ok: true, value: argvOf("trigger-test-source-unconfirmed.json") });
    expect(testArgv("trigger", "oats-real/harvest-review", { runSource: true })).toEqual({ ok: true, value: argvOf("trigger-test-source.json") });
    expect(testArgv("schedule", "daily-review", { runSource: true })).toMatchObject({ ok: false, error: { code: "INVALID_INPUT" } });
  });

  it("a summary is one argv element, whatever it starts with", () => {
    expect(describeArgv("schedule", "status-check", "Check that the roster answers")).toEqual({ ok: true, value: argvOf("schedule-describe.json") });
    expect(describeArgv("trigger", "graph-watch", "Watch every harvest branch")).toEqual({ ok: true, value: argvOf("trigger-describe.json") });
    expect(describeArgv("schedule", "local/x", "--force")).toEqual({ ok: true, value: ["schedule", "update", "local/x", "--description=--force", "--json"] });
    // Empty removes it.
    expect(describeArgv("schedule", "x", "")).toEqual({ ok: true, value: ["schedule", "update", "x", "--description=", "--json"] });
  });

  it("no process starts for an id that is none, a summary out of the rule, or a workspace item's summary or removal", () => {
    for (const refused of [
      enableArgv("schedule", "--dir", true),
      scheduleRunArgv("a/b/c"),
      testArgv("trigger", "x y"),
      scheduleReconcileArgv(""),
      scheduleRemoveArgv("-x"),
      describeArgv("schedule", "x", "two\nlines"),
      describeArgv("schedule", "x", "a".repeat(201)),
      describeArgv("schedule", "x", "bell\u0007"),
      describeArgv("schedule", "oats-real/nightly-digest", "Mine now"),
      scheduleRemoveArgv("oats-real/nightly-digest"),
    ]) expect(refused).toMatchObject({ ok: false, error: { code: "INVALID_INPUT" } });
    // 200 characters are counted as characters, not as UTF-16 units.
    expect(descriptionValid("😀".repeat(200))).toBe(true);
    expect(descriptionValid("😀".repeat(201))).toBe(false);
    expect(describeArgv("schedule", "x", "a".repeat(201))).toMatchObject({ error: { message: "A summary is one line of up to 200 characters, without control characters." } });
  });
});

describe("on, off and a summary answer the row as it is now", () => {
  it("a local schedule turned off, then on", () => {
    expect(parseRowAnswer(answer("schedule-disable.json"), "schedule", "oats schedule disable")).toMatchObject({ ok: true, value: { row: { id: "local/weekly-cleanup", enabled: false, enabledHere: false, runsHere: false } } });
    expect(parseRowAnswer(answer("schedule-enable.json"), "schedule", "oats schedule enable")).toMatchObject({ ok: true, value: { row: { id: "local/weekly-cleanup", enabled: true, enabledHere: true, runsHere: true } } });
  });

  it("a workspace schedule turned off here keeps its own definition on", () => {
    expect(parseRowAnswer(answer("schedule-disable-workspace.json"), "schedule", "oats schedule disable")).toMatchObject({ ok: true, value: { row: { id: "oats-real/nightly-digest", enabled: true, enabledHere: false, runsHere: false } } });
    expect(parseRowAnswer(answer("schedule-enable-workspace.json"), "schedule", "oats schedule enable")).toMatchObject({ ok: true, value: { row: { enabledHere: true, runsHere: true } } });
  });

  it("a trigger, and a summary set", () => {
    expect(parseRowAnswer(answer("trigger-disable.json"), "trigger", "oats trigger disable")).toMatchObject({ ok: true, value: { row: { id: "local/old-prs", kind: "trigger", enabledHere: false } } });
    expect(parseRowAnswer(answer("schedule-describe.json"), "schedule", "oats schedule update")).toMatchObject({ ok: true, value: { row: { id: "local/status-check", description: "Check that the roster answers" } } });
    expect(parseRowAnswer(answer("trigger-describe.json"), "trigger", "oats trigger update")).toMatchObject({ ok: true, value: { row: { id: "local/graph-watch", description: "Watch every harvest branch" } } });
  });

  it("an answer of the other kind is the typed OATS_BAD_ANSWER", () => {
    expect(parseRowAnswer(answer("trigger-disable.json"), "schedule", "oats schedule disable")).toMatchObject({ ok: false, error: { code: "OATS_BAD_ANSWER" } });
    expect(parseRowAnswer({ schedule: null }, "schedule", "oats schedule enable")).toMatchObject({ ok: false, error: { code: "OATS_BAD_ANSWER", message: "`oats schedule enable` answered no schedule" } });
  });

  it("the kernel's refusals of these acts are recorded with their codes", () => {
    expect(recorded("schedule-describe-workspace.json")).toMatchObject({ ok: false, error: { code: "E_AUTOMATION_WORKSPACE" } });
    expect(recorded("trigger-describe-workspace.json")).toMatchObject({ ok: false, error: { code: "E_AUTOMATION_WORKSPACE" } });
    expect(recorded("schedule-remove-workspace.json")).toMatchObject({ ok: false, error: { code: "E_AUTOMATION_WORKSPACE" } });
    expect(recorded("schedule-run-elsewhere.json")).toMatchObject({ ok: false, error: { code: "E_AUTOMATION_NOT_HERE", message: "oats-real/weekly-report does not run on this host (assigned-elsewhere: runs on report-server; this host is bb-box)" } });
    expect(recorded("schedule-run-disabled.json")).toMatchObject({ ok: false, error: { code: "E_SCHEDULE_DISABLED" } });
    expect(recorded("host-install-refused.json")).toMatchObject({ ok: false, error: { code: "E_SCHEDULE_HOST" } });
  });
});

describe("run now", () => {
  it("a bb agent launched: the run, with the outcome the kernel recorded for it", () => {
    expect(parseScheduleRun(answer("schedule-run.json"))).toMatchObject({ ok: true, value: { run: { outcome: "launched", instance: expect.stringMatching(/^oats-developer-review-\d{12}$/), error: null } } });
  });

  it("a launch the provider refused: launch failed, with the kernel's error and code", () => {
    expect(parseScheduleRun(answer("schedule-run-launch-failed.json"))).toMatchObject({
      ok: true,
      value: { run: { outcome: "launch-failed", errorCode: "E_BACKEND_SANDBOXED_MODE", error: expect.stringContaining("the bb backend launches in bb's full mode only"), instance: null } },
    });
  });

  it("a command that answered no envelope: its state is unknown", () => {
    expect(parseScheduleRun(answer("schedule-run-command.json"))).toMatchObject({ ok: true, value: { run: { outcome: "unknown", error: "command answered no valid envelope; its side effects are unconfirmed" } } });
  });

  it("the outcome of another run is never lent to this one", () => {
    const run = { scheduledFor: "2026-11-21T10:00:00.000Z", startedAt: "2026-11-21T10:00:05.000Z" };
    expect(parseScheduleRun({ run, schedule: { lastRun: { ...run, startedAt: "2026-11-21T09:00:05.000Z", outcome: "ended" } } })).toMatchObject({ ok: true, value: { run: { outcome: null } } });
    expect(parseScheduleRun({ run: null, schedule: {} })).toEqual({ ok: true, value: { run: null } });
    expect(parseScheduleRun({ schedule: {} })).toEqual({ ok: true, value: { run: null } });
    expect(parseScheduleRun([])).toMatchObject({ ok: false, error: { code: "OATS_BAD_ANSWER" } });
  });
});

describe("test", () => {
  it("a schedule that would run here; one placed elsewhere says why", () => {
    const ready = parseTest(answer("schedule-test.json"), "schedule", null);
    expect(ready).toMatchObject({ ok: true, value: { ok: true, problems: [], warnings: [], wouldFire: null, soul: { resolves: true, error: null }, account: null, source: null, nextDue: expect.stringMatching(/^2\d{3}-/) } });
    expect(automationTest.safeParse(ready.ok ? ready.value : null).success).toBe(true);
    expect(parseTest(answer("schedule-test-elsewhere.json"), "schedule", null)).toMatchObject({
      ok: true,
      value: { ok: false, problems: ["oats-real/weekly-report does not run on this host (assigned-elsewhere: runs on report-server; this host is bb-box)"] },
    });
  });

  it("OATS 0.70.0 finds nothing against a bb job without yolo", () => {
    expect(parseTest(answer("schedule-test-sandboxed.json"), "schedule", null)).toMatchObject({ ok: true, value: { ok: true, problems: [] } });
  });

  it("a pull-request trigger: who gh acts as, and what would fire now, with the name each spawn would get and what is held", () => {
    expect(parseTest(answer("trigger-test.json"), "trigger", "github.pull_request")).toMatchObject({
      ok: true,
      value: {
        ok: true,
        account: "ana",
        problems: [],
        source: null,
        wouldFire: [
          { label: "#41", instance: "oats-developer-review-pr-41", nameCut: false, held: false, heldReason: null, url: null },
          { label: "#42", instance: "oats-developer-review-pr-42", held: false },
          // over the trigger's bound of two: the kernel says so, with its reason
          { label: "#43", instance: "oats-developer-review-pr-43", held: true, heldReason: "concurrency.max 2 reached (2 live)" },
        ],
      },
    });
    // One placed elsewhere: not ready here, and the kernel says which events its bound would hold.
    expect(parseTest(answer("trigger-test-elsewhere.json"), "trigger", "github.pull_request")).toMatchObject({
      ok: true,
      value: {
        ok: false,
        problems: ["not run on this host (assigned-elsewhere): runs on docs-server; this host is bb-box"],
        wouldFire: [{ label: "#41", held: false }, { label: "#42", held: true, heldReason: "concurrency.max 1 reached (1 live)" }, { label: "#43", held: true }, { label: "#45", held: true }],
      },
    });
  });

  it("a capability source that answered: what it did first, then what would fire, each URL as text", () => {
    const tested = parseTest(answer("trigger-test-source.json"), "trigger", "acme.graph:harvest-branches");
    expect(tested).toMatchObject({
      ok: true,
      value: {
        ok: true,
        source: {
          capability: "acme.graph",
          name: "harvest-branches",
          ok: true,
          events: 2,
          filtered: 1,
          refused: [{ rule: "url" }, { rule: "shape", text: '"not an object"' }],
          skipped: [{ subject: "harvest/y", why: "not judged yet" }, { subject: "harvest/z", why: HOSTILE }],
        },
        wouldFire: [
          { label: "harvest/a", instance: "graph-reviewer-harvest-review-harvest-a", url: "https://graph.example.org/a", held: false },
          { label: "harvest/d", instance: "graph-reviewer-harvest-review-harvest-d", url: null, held: true, heldReason: "concurrency.max 1 reached (1 live)" },
        ],
        warnings: [expect.stringContaining("this source's credential may not be visible to the host timer")],
      },
    });
    expect(automationTest.safeParse(tested.ok ? tested.value : null).success).toBe(true);
  });

  it("a capability source that refused: its failure is said once, by the source, with the source's own words apart", () => {
    expect(parseTest(answer("trigger-test-source-failed.json"), "trigger", "acme.graph:harvest-branches")).toMatchObject({
      ok: true,
      value: {
        ok: false,
        // the kernel lists the failure among the problems too: it is not repeated
        problems: [],
        wouldFire: [],
        source: { ok: false, cause: "refused", error: "acme.graph:harvest-branches refused the poll", code: "E_TRIGGER_POLL", says: { code: "graph-offline", message: HOSTILE }, events: 0 },
      },
    });
  });

  it("an entry with nothing to name it by is skipped, and a soul that does not resolve says why", () => {
    expect(parseTest({ ok: false, wouldFire: [{}, { key: "k" }, { subject: "s", instance: "i", nameCut: true, held: true }], soul: { resolves: false, error: { message: "no soul named x" } }, problems: [{ message: "m" }, { code: "E_X" }, 7] }, "trigger", null)).toEqual({
      ok: true,
      value: {
        ok: false,
        problems: ["m", "E_X"],
        warnings: [],
        wouldFire: [
          { key: "k", label: "k", instance: null, nameCut: false, held: false, heldReason: null, url: null },
          { key: null, label: "s", instance: "i", nameCut: true, held: true, heldReason: null, url: null },
        ],
        nextDue: null,
        soul: { resolves: false, error: "no soul named x" },
        account: null,
        source: null,
      },
    });
    expect(parseTest(null, "trigger", null)).toMatchObject({ ok: false, error: { code: "OATS_BAD_ANSWER" } });
  });
});

describe("check a run, delete, install the host timer", () => {
  it("a run that is still unknown: the kernel's word and what to do", () => {
    expect(parseScheduleReconcile(answer("schedule-reconcile.json"))).toEqual({
      ok: true,
      value: { reconciled: "unknown", remedy: expect.stringContaining("check the roster and the host by hand, then run oats schedule reconcile status-check --clear") },
    });
  });

  it("a schedule removed", () => {
    expect(parseScheduleRemove(answer("schedule-remove.json"))).toEqual({ ok: true, value: { removed: "weekly-cleanup" } });
    expect(recorded("schedule-remove-unknown.json")).toMatchObject({ ok: false, error: { code: "E_SCHEDULE_UNKNOWN" } });
  });

  it("the host timer installed: on, for this deployment", () => {
    expect(parseHostInstall(answer("host-install.json"))).toEqual({ ok: true, value: { scheduler: { installed: true, active: true, registered: true, lastTick: null, maxConcurrent: 5 }, warnings: [] } });
    expect(parseHostInstall({ scheduler: { installed: true }, warnings: ["w", { message: "m" }] })).toMatchObject({ ok: true, value: { scheduler: { active: false, registered: null }, warnings: ["w", "m"] } });
  });
});
