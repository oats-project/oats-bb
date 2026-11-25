// The runs' reads and their merge: what a schedule keeps (its runs, with the agent each made and
// whether older ones were dropped), every trigger's state in one read, and the one list of all
// runs, on what the real kernel printed (test/fixtures/automations/).
import { describe, expect, it } from "vitest";
import { automationRow, triggerStatuses } from "../../contract/automations";
import { parseTriggerStatuses, triggerStatusAllArgv } from "../../kernel/automations";
import { allRuns, runAt, scheduleRuns, triggerRuns } from "../../model/automation-runs";
import { answer, rowOf, schedules, statusOf, triggers } from "./fixtures";

const sources = (): Record<string, string | null> => Object.fromEntries(triggers().rows.map((row) => [row.id, row.on?.source ?? null]));
function statuses() {
  const parsed = parseTriggerStatuses(answer("trigger-status.json"), sources());
  if (!parsed.ok) throw new Error(`${parsed.error.code}: ${parsed.error.message}`);
  return parsed.value;
}

describe("a schedule's runs", () => {
  it("a run names the agent it made, from the kernel's `session`, and its own id", () => {
    const run = rowOf(schedules(), "local/daily-review").recentRuns[0]!;
    expect(run.instance).toBe("oats-developer-review-202611212017");
    expect(run.home).toBe("/abs/deployment/agents/oats-developer/instances/oats-developer-review-202611212017");
    expect(run.runId).toBe("32b84ee63dec280096616896");
    expect(typeof run.settled).toBe("boolean");
  });
  it("a run that made no agent names none", () => {
    const run = rowOf(schedules(), "local/hourly-check").recentRuns[0]!;
    expect(run.outcome).toBe("launch-failed");
    expect(run.instance).toBeNull();
  });
  it("the history says what is stored and that nothing was dropped; a row of a host that does not run it says nothing", () => {
    expect(rowOf(schedules(), "local/daily-review").history).toEqual({ stored: 1, truncated: false });
    expect(rowOf(schedules(), "oats-real/release-check").history).toBeNull();
    for (const row of schedules().rows) expect(automationRow.safeParse(row).success).toBe(true);
  });
});

describe("every trigger's state in one read", () => {
  it("is the kernel's `trigger status` with no id", () => {
    expect(triggerStatusAllArgv()).toEqual(["trigger", "status", "--json"]);
  });
  it("answers one state per trigger, each the same as its own read, and the contract's", () => {
    const all = statuses();
    expect(all.map((entry) => entry.id).sort()).toEqual(triggers().rows.map((row) => row.id).sort());
    for (const entry of all) expect(entry.status).toEqual(statusOf(entry.id));
    expect(triggerStatuses.safeParse(all).success).toBe(true);
  });
  it("a fire names its agent's home", () => {
    const fired = statusOf("local/graph-watch").fired[0]!;
    expect(fired.home).toBe("/abs/deployment/agents/graph-reviewer/instances/graph-reviewer-graph-watch-harvest-a");
  });
  it("a kernel that keeps no failure history (OATS 0.70) answers none: `failures` is null, never an empty list", () => {
    for (const entry of statuses()) {
      expect(entry.status.failures).toBeNull();
      expect(entry.status.failuresTotal).toBeNull();
    }
  });
  it("an answer that is no status is the typed OATS_BAD_ANSWER", () => {
    const parsed = parseTriggerStatuses({ triggers: "none" }, {});
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.error.code).toBe("OATS_BAD_ANSWER");
  });
});

describe("the runs, merged", () => {
  it("a schedule's runs are entries in the kernel's order, each at its start", () => {
    const row = rowOf(schedules(), "local/daily-review");
    const entries = scheduleRuns(row);
    expect(entries).toHaveLength(row.recentRuns.length);
    expect(entries[0]).toMatchObject({ of: "run", owner: { kind: "schedule", id: "local/daily-review" }, at: "2026-11-21T20:17:32.946Z" });
    expect(runAt({ ...row.recentRuns[0]!, startedAt: null })).toBe("2026-11-21T20:17:00.000Z");
  });
  it("a trigger's fires are entries, newest first", () => {
    const row = rowOf(triggers(), "oats-real/proposal-review");
    const entries = triggerRuns(row, statusOf(row.id));
    expect(entries.map((entry) => entry.of)).toEqual(["fired", "fired"]);
    const times = entries.map((entry) => Date.parse(entry.at ?? ""));
    expect(times).toEqual([...times].sort((a, b) => b - a));
  });
  it("all runs of all automations are one list, newest first, and nothing is said to be cut where every history is whole", () => {
    const { entries, cut } = allRuns(schedules().rows, triggers().rows, statuses());
    const runs = schedules().rows.reduce((sum, row) => sum + row.recentRuns.length, 0);
    const fires = statuses().reduce((sum, entry) => sum + entry.status.fired.length, 0);
    expect(entries).toHaveLength(runs + fires);
    const times = entries.map((entry) => Date.parse(entry.at ?? ""));
    expect(times).toEqual([...times].sort((a, b) => b - a));
    expect(new Set(entries.map((entry) => entry.owner.kind))).toEqual(new Set(["schedule", "trigger"]));
    expect(cut).toBe(false);
  });
  it("a schedule whose history dropped runs, or a trigger that fired more than it lists, makes the list cut", () => {
    const schedule = rowOf(schedules(), "local/daily-review");
    expect(allRuns([{ ...schedule, history: { stored: 50, truncated: true } }], [], []).cut).toBe(true);
    const trigger = rowOf(triggers(), "oats-real/proposal-review");
    const status = statusOf(trigger.id);
    expect(allRuns([], [trigger], [{ id: trigger.id, status: { ...status, firedTotal: status.fired.length + 1 } }]).cut).toBe(true);
  });
  it("a trigger whose state was not read adds nothing; a time that cannot be read sorts last", () => {
    const trigger = rowOf(triggers(), "oats-real/proposal-review");
    expect(allRuns([], [trigger], []).entries).toEqual([]);
    const status = statusOf(trigger.id);
    const odd = { ...status, fired: [{ ...status.fired[0]!, at: null }, status.fired[1]!] };
    expect(triggerRuns(trigger, odd).map((entry) => entry.at)).toEqual([status.fired[1]!.at, null]);
  });
});
