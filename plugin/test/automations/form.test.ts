// kernel/automations-form.ts and the form's pure pieces against what the real kernel printed
// (OATS 0.70.0): a schedule created and replaced with `--spec-json`, what the kernel holds of one,
// a home's operations, and a spawn that asked for a recurring wake-up.
import { describe, expect, it } from "vitest";
import { scheduleDraft, scheduleSpec, wake as wakeSchema } from "../../contract/automations";
import type { ScheduleSpec } from "../../contract/automations";
import { parseRowAnswer } from "../../kernel/automations-acts";
import { parseHomeOperations, parseScheduleShow, parseSessionProviders, scheduleAddArgv, scheduleDraftOf, scheduleShowArgv, scheduleUpdateArgv, wakeArgv, wakeOutcome } from "../../kernel/automations-form";
import { newWake, repeatOf, REPEATS, WAKE_REPEATS, wakeOf } from "../../model/automations";
import { answer, recorded } from "./fixtures";

const calls = (recorded("recorded.json") as unknown as { calls: Record<string, { argv: string[]; exit: number }> }).calls;
const argvOf = (file: string): string[] => calls[file]!.argv;
/** The definition the recording handed over in a call: the JSON of its `--spec-json=` element. */
const specOf = (file: string): ScheduleSpec => scheduleSpec.parse(JSON.parse(argvOf(file).find((word) => word.startsWith("--spec-json="))!.slice("--spec-json=".length)));
const shown = (file: string): unknown => {
  const parsed = parseScheduleShow(answer(file));
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.error));
  return parsed.value;
};
const HOME = "/abs/deployment/agents/note-keeper/instances/team-notes-keeper";

describe("a schedule is created and replaced with the argv the recording ran", () => {
  it("each kind the form makes is one --spec-json element, which the contract's schema takes as it is", () => {
    // The same words in the same places, and the same definition in its one element (its keys in the schema's order).
    const same = (made: ReturnType<typeof scheduleAddArgv>, file: string) => {
      if (!made.ok) throw new Error(JSON.stringify(made.error));
      const ran = argvOf(file);
      expect(made.value.map((word) => (word.startsWith("--spec-json=") ? "--spec-json=" : word))).toEqual(ran.map((word) => (word.startsWith("--spec-json=") ? "--spec-json=" : word)));
      expect(made.value).toHaveLength(5);
      expect(JSON.parse(made.value[3]!.slice("--spec-json=".length))).toEqual(JSON.parse(ran[3]!.slice("--spec-json=".length)));
    };
    for (const [file, id] of [["schedule-add-wake.json", "form-wake"], ["schedule-add-spawn.json", "form-spawn"], ["schedule-add-operation.json", "form-operation"]] as const) same(scheduleAddArgv(id, specOf(file)), file);
    same(scheduleUpdateArgv("form-wake", specOf("schedule-update.json")), "schedule-update.json");
    expect(scheduleShowArgv("form-wake")).toEqual({ ok: true, value: argvOf("schedule-show-wake.json") });
  });

  it("the kernel's answer to a save is the schedule's row", () => {
    expect(parseRowAnswer(answer("schedule-add-wake.json"), "schedule", "oats schedule add")).toMatchObject({ ok: true, value: { row: { id: "local/form-wake", run: "wake", message: "Anything to write down?\nSay what, then stop.", description: "Ask the note keeper for news" } } });
    expect(parseRowAnswer(answer("schedule-add-spawn.json"), "schedule", "oats schedule add")).toMatchObject({ ok: true, value: { row: { id: "local/form-spawn", run: "spawn", enabled: false } } });
    expect(parseRowAnswer(answer("schedule-update.json"), "schedule", "oats schedule update")).toMatchObject({ ok: true, value: { row: { id: "local/form-wake", cron: "0 * * * *", description: "Ask the note keeper every hour" } } });
  });

  it("a name or an id that is none, a workspace schedule and a summary out of the rule start no process", () => {
    const spec = specOf("schedule-add-wake.json");
    for (const id of ["--force", "Daily", "a/b", "", "x".repeat(101), "local/x"]) expect(scheduleAddArgv(id, spec)).toMatchObject({ ok: false, error: { code: "INVALID_INPUT" } });
    expect(scheduleUpdateArgv("oats-real/nightly-digest", spec)).toMatchObject({ ok: false, error: { code: "INVALID_INPUT", message: expect.stringContaining("defined in Git") } });
    expect(scheduleUpdateArgv("--dir", spec)).toMatchObject({ ok: false });
    expect(scheduleAddArgv("ok", { ...spec, description: "two\nlines" })).toMatchObject({ ok: false, error: { code: "INVALID_INPUT" } });
  });

  it("the contract refuses a definition with a key the form does not make, another kind, or an empty part", () => {
    const spec = specOf("schedule-add-wake.json");
    expect(scheduleSpec.safeParse({ ...spec, argv: ["rm"] }).success).toBe(false);
    expect(scheduleSpec.safeParse({ ...spec, kind: "command" }).success).toBe(false);
    expect(scheduleSpec.safeParse({ ...spec, message: "  " }).success).toBe(false);
    expect(scheduleSpec.safeParse({ ...spec, home: "a\0b" }).success).toBe(false);
    expect(scheduleSpec.safeParse({ ...specOf("schedule-add-spawn.json"), agent: "--agent" }).success).toBe(false);
    expect(scheduleSpec.safeParse({ ...specOf("schedule-add-operation.json"), operation: "checkpoint" }).success).toBe(false);
  });
});

describe("what Edit starts from: the stored definition, read back into what the form can keep", () => {
  it("each kind the form makes reads back as what was saved", () => {
    expect(scheduleDraftOf(shown("schedule-show-wake.json"), ["tmux"])).toEqual({ id: "form-wake", spec: specOf("schedule-add-wake.json") });
    expect(scheduleDraftOf(shown("schedule-show-spawn.json"), ["tmux", "bb"])).toEqual({ id: "form-spawn", spec: specOf("schedule-add-spawn.json") });
    expect(scheduleDraftOf(shown("schedule-show-operation.json"), ["tmux"])).toEqual({ id: "form-operation", spec: specOf("schedule-add-operation.json") });
    for (const file of ["schedule-show-wake.json", "schedule-show-spawn.json", "schedule-show-operation.json"]) expect(scheduleDraft.safeParse(scheduleDraftOf(shown(file), ["tmux", "bb"])).success).toBe(true);
  });

  it("a job on a session backend the kernel does not list for its soul is no draft; nor is a command, nor a job that no longer validates", () => {
    expect(scheduleDraftOf(shown("schedule-show-spawn.json"), ["tmux"])).toBeNull();
    expect(scheduleDraftOf(shown("schedule-show-command.json"), ["tmux", "bb"])).toBeNull();
    expect(scheduleDraftOf(shown("schedule-show-invalid.json"), ["tmux", "bb"])).toBeNull();
    expect(scheduleDraftOf(shown("schedule-show.json"), ["tmux", "bb"])).toMatchObject({ id: "daily-review", spec: { kind: "spawn", backend: "bb", yolo: true, wake: { message: "Anything new on your review?" } } });
  });

  // The Desktop's own cases (awebai/oats packages/desktop/test/schedule-draft.test.mjs).
  const entry = (extra: Record<string, unknown> = {}) => ({
    id: "nightly", scope: "/inert/ws", scheduleApi: 2, scheduleHistoryApi: 3, kind: "spawn", agent: "dev", agentsRoot: "/inert/ws/agents", repo: "/inert/ws",
    task: "  Full draft\r\nbytes  ", purpose: "review", runtime: "pi", model: "model", backend: "tmux", yolo: false, wake: { cron: "0 9 * * *", tz: "UTC", message: "  Wake\r\nbytes  " },
    cron: "0 9 * * *", tz: "UTC", enabled: true, running: false, executionStatus: { kind: "legacy" }, nextRun: "2026-02-02T09:00:00.000Z", lastRun: null,
    history: { status: "ok", stored: 0, truncated: false }, recentRuns: [], ...extra,
  });

  it("a stored spawn definition drafts byte for byte, a kernel's older `runtime` as the harness", () => {
    expect(scheduleDraftOf(entry(), ["tmux"])).toEqual({
      id: "nightly",
      spec: { kind: "spawn", cron: "0 9 * * *", tz: "UTC", enabled: true, agent: "dev", agentsRoot: "/inert/ws/agents", task: "  Full draft\r\nbytes  ", repo: "/inert/ws", model: "model", backend: "tmux", purpose: "review", harness: "pi", yolo: false, wake: { cron: "0 9 * * *", tz: "UTC", message: "  Wake\r\nbytes  " } },
    });
  });

  it("a summary is kept exactly, or the definition is no draft", () => {
    for (const description of ["  Harvest — dev  ", "🙂".repeat(200)]) expect(scheduleDraftOf(entry({ description }), ["tmux"])?.spec.description).toBe(description);
    for (const description of [3, "", "x".repeat(201), "line\nbreak", "a\tb", "a\u0085b", "a\u2028b", "a\u2029b"]) expect(scheduleDraftOf(entry({ description }), ["tmux"])).toBeNull();
  });

  it("a policy, an unknown key, a harness or a backend the form does not offer, and a wake with more than its three parts are no draft", () => {
    for (const key of ["definitionVersion", "recurrencePolicy", "execution", "preparation", "executionBinding", "responsibleHuman"]) expect(scheduleDraftOf(entry({ [key]: null }), ["tmux"])).toBeNull();
    for (const value of [entry({ tz: undefined }), entry({ kind: "command", argv: ["oats", "status"] }), entry({ backend: "future" }), entry({ backend: "herdr" }), entry({ runtime: "future" }), entry({ harness: "pi" }), entry({ wake: { cron: "* * * * *", tz: "UTC", message: "wake", enabled: false } }), entry({ launchConfig: "fast" })]) {
      expect(scheduleDraftOf(value, ["tmux"])).toBeNull();
    }
    expect(scheduleDraftOf(entry({ backend: "bb" }), ["tmux", "bb"])?.spec).toMatchObject({ backend: "bb" });
  });
});

describe("what the form chooses among", () => {
  it("a home's operations a schedule can run by itself: an available action of a layer's capability with no required argument", () => {
    expect(parseHomeOperations(answer("inspect-home.json"))).toEqual({ ok: true, value: { operations: [{ address: "knowledge:checkpoint", label: "knowledge: checkpoint — Record this instance's checkpoint" }] } });
    const inspection = { capabilities: [{ id: "x", layer: "tasks", operations: [{ name: "a", kind: "query", available: true }, { name: "b", kind: "action", available: false }, { name: "c", kind: "action", available: true, args: [{ name: "id", required: true }] }, { name: "d", kind: "action", available: true, args: [{ name: "n" }] }] }, { id: "y", operations: [{ name: "e", kind: "action", available: true }] }] };
    expect(parseHomeOperations(inspection)).toEqual({ ok: true, value: { operations: [{ address: "tasks:d", label: "tasks: d — x" }] } });
  });

  it("the session providers an inspection lists, never tmux or one OATS removed", () => {
    expect(parseSessionProviders(answer("inspect-home.json"))).toEqual({ ok: true, value: { backends: ["bb"] } });
    expect(parseSessionProviders({ sessionProviders: [{ name: "bb" }, { name: "bb" }, { name: "herdr" }, { name: "tmux" }, { name: "--x" }, "bb", { name: 3 }] })).toEqual({ ok: true, value: { backends: ["bb"] } });
    expect(parseSessionProviders({})).toEqual({ ok: true, value: { backends: [] } });
  });
});

describe("a recurring wake-up asked at spawn", () => {
  const asked = { cron: "*/15 * * * *", tz: "Europe/Madrid", message: "Check your pending work and report anything that needs attention.", enabled: true as const };

  it("is one argv element of the spawn, the one the recording ran", () => {
    expect(wakeArgv(asked)).toEqual([argvOf("spawn-wake.json").find((word) => word.startsWith("--wake-json="))]);
    expect(wakeSchema.safeParse(asked).success).toBe(true);
    expect(wakeSchema.safeParse({ ...asked, enabled: false }).success).toBe(false);
    expect(wakeSchema.safeParse({ ...asked, home: "/x" }).success).toBe(false);
  });

  it("the spawn's own answer says whether its wake schedule was saved", () => {
    expect(wakeOutcome(recorded("spawn-wake.json"))).toEqual({ saved: true, id: "wake-wake-at-spawn-developer", code: null, message: null });
    expect(wakeOutcome(recorded("spawn-wake-not-saved.json"))).toMatchObject({ saved: false, code: "E_SCHEDULE_INVALID", message: expect.stringContaining("cron") });
    // The parsed result alone, and an answer that speaks of no wake.
    expect(wakeOutcome(answer("spawn-wake.json"))).toMatchObject({ saved: true });
    expect(wakeOutcome({ schemaVersion: 1, ok: true, result: { instance: "x" } })).toBeNull();
    expect(wakeOutcome(null)).toBeNull();
  });

  it("the group asks for nothing while off, for the wake when whole, and says the Desktop's sentence otherwise", () => {
    const draft = newWake("Europe/Madrid");
    expect(draft).toEqual({ enabled: false, cron: "*/15 * * * *", tz: "Europe/Madrid", message: "" });
    expect(wakeOf(draft)).toEqual({ ok: true, wake: undefined });
    expect(wakeOf({ ...draft, enabled: true, cron: " */5 * * * * ", message: " Look.\n" })).toEqual({ ok: true, wake: { cron: "*/5 * * * *", tz: "Europe/Madrid", message: " Look.\n", enabled: true } });
    for (const lacking of [{ message: "  " }, { cron: " " }, { tz: "" }]) expect(wakeOf({ ...draft, enabled: true, message: "x", ...lacking })).toEqual({ ok: false, error: "Specify the wake schedule, time zone, and message" });
  });

  it("a cron stands for its preset, else for Custom cron", () => {
    expect(repeatOf("0 9 * * 1-5", REPEATS)).toBe("0 9 * * 1-5");
    expect(repeatOf("0 9 * * 1-5", WAKE_REPEATS)).toBe("custom");
    expect(repeatOf("5 4 * * *", REPEATS)).toBe("custom");
  });
});
