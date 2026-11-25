// THE BUSY WORKSPACE (test/fixtures/busy; the worst-case rule): the committed set is exactly what
// its generator makes, every row of it is a recorded row with only its names, ids, times and
// relations varied, it holds what the rule's busy workspace holds, and the plugin reads it.
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseScheduleList, parseTriggerList } from "../../kernel/automations-read.js";
import { parseStatus } from "../../kernel/roster.js";
import { parseServers, parseSouls, parseTeams } from "../../kernel/workspace.js";
// @ts-expect-error the generator is plain JavaScript, with no types of its own
import { build, restored } from "../fixtures/busy/generate.mjs";

const BUSY = join(fileURLToPath(new URL("..", import.meta.url)), "fixtures", "busy");
type Made = { row: Record<string, unknown>; from: Record<string, unknown>; swaps: [string, string][]; was: [string[], unknown][]; kind?: string; shaped?: string[] };
const { files, made } = build() as { files: Record<string, unknown>; made: Record<"agents" | "souls" | "schedules" | "triggers" | "teams" | "servers" | "runs", Made[]> };

describe("the busy set", () => {
  it("is exactly what its generator makes: the same files, byte for byte, and no other", async () => {
    const committed = (await readdir(BUSY)).filter((name) => name.endsWith(".json")).sort();
    expect(committed).toEqual(Object.keys(files).sort());
    for (const [name, document] of Object.entries(files)) expect([name, await readFile(join(BUSY, name), "utf8")]).toEqual([name, `${JSON.stringify(document, null, 1)}\n`]);
    // The same set every time it is made.
    expect(JSON.stringify(build().files)).toBe(JSON.stringify(files));
  });

  it("THE RULE: every busy row, with its varied fields put back, is the recorded row it was multiplied from", () => {
    let rows = 0;
    for (const list of Object.values(made)) {
      for (const each of list) {
        expect(restored(each)).toEqual(each.from);
        rows += 1;
      }
    }
    expect(rows).toBeGreaterThan(300); // 60 agents, 24 souls, 37 automations, 200 runs, 7 teams, 5 machines
  });

  it("what is varied is a name, an id, a time, a relation or a text, and nothing else; the ONE shaped kind is said", () => {
    const ALLOWED: Record<string, string[]> = {
      agents: ["agent", "parentInstance", "waitingOnYou.since", "waitingOnYou.message", "running", "runtimeState"],
      souls: ["description"],
      schedules: ["cron", "description", "recentRuns", "history.stored"],
      triggers: ["description"],
      teams: ["label", "team", "description", "default"],
      servers: ["label"],
      runs: ["scheduledFor", "startedAt"],
    };
    for (const [list, rows] of Object.entries(made)) for (const each of rows) expect([list, each.was.map(([path]) => path.join(".")).filter((path) => !ALLOWED[list]!.includes(path))]).toEqual([list, []]);
    // The session's keys are set on the FAILED rows alone (no kernel answer of a failed agent is recorded: README.md).
    const shaped = made.agents.filter((each) => each.was.some(([path]) => path[0] === "running" || path[0] === "runtimeState"));
    expect(shaped.map((each) => each.kind)).toEqual(["failed", "failed", "failed"]);
    expect(shaped.every((each) => each.row.running === false && each.row.runtimeState === "shell")).toBe(true);
    // A swap is a name or an id: never a word of two letters, never empty, and every one took.
    for (const rows of Object.values(made)) for (const each of rows) for (const [from, to] of each.swaps) expect([from.length > 3, to.length > 3, JSON.stringify(each.row).includes(to)]).toEqual([true, true, true]);
  });

  it("holds the busy workspace of the rule: sixty agents four levels deep, eleven asking, some failed, lost and outside OATS; 24 souls; 37 automations, five failing, some with fifty runs; seven teams; five machines; names of sixty characters; a question of four lines", () => {
    const status = parseStatus(files["status.json"]);
    expect(status.ok).toBe(true);
    if (!status.ok) return;
    const agents = status.value.agents;
    expect(agents).toHaveLength(60);
    expect(new Set(agents.map((agent) => agent.instance)).size).toBe(60);
    const parent = new Map(agents.map((agent) => [agent.instance, agent.parent]));
    const depth = (instance: string): number => (parent.get(instance) ? 1 + depth(parent.get(instance)!) : 0);
    expect(Math.max(...agents.map((agent) => depth(agent.instance)))).toBe(3); // four levels
    expect(agents.filter((agent) => agent.parent !== null && !parent.has(agent.parent))).toEqual([]);
    expect(agents.filter((agent) => agent.waiting !== null)).toHaveLength(11);
    expect(agents.filter((agent) => agent.runtimeState === "shell").length).toBeGreaterThanOrEqual(3);
    expect(agents.filter((agent) => agent.sessionEnd === "lost").length).toBeGreaterThanOrEqual(5);
    expect(agents.filter((agent) => agent.outsideOats !== undefined).length).toBeGreaterThanOrEqual(2);
    expect(agents.filter((agent) => agent.backend === "bb").length).toBeGreaterThanOrEqual(50); // a workspace whose agents are mostly on bb threads
    expect(agents.filter((agent) => agent.instance.length >= 60).length).toBeGreaterThanOrEqual(6);
    expect(Math.max(...agents.map((agent) => agent.instance.length))).toBeLessThanOrEqual(63);
    expect(agents.filter((agent) => (agent.waiting?.message ?? "").split("\n").length === 4).length).toBeGreaterThanOrEqual(2);
    // A folded parent that itself asks and hides a child that asks (the rule's open point).
    expect(agents.some((agent) => agent.waiting !== null && agents.some((child) => child.parent === agent.instance && child.waiting !== null))).toBe(true);
    // Every agent's soul is one the workspace lists.
    const souls = parseSouls(files["souls.json"]);
    expect(souls.ok && souls.value.souls.length).toBe(24);
    if (souls.ok) expect(agents.filter((agent) => !souls.value.souls.some((soul) => soul.agent === agent.soul)).map((agent) => agent.soul)).toEqual([]);
    const schedules = parseScheduleList(files["schedule-list.json"]);
    const triggers = parseTriggerList(files["trigger-list.json"]);
    expect(schedules.ok && triggers.ok).toBe(true);
    if (!schedules.ok || !triggers.ok) return;
    const rows = [...schedules.value.rows, ...triggers.value.rows];
    expect(rows).toHaveLength(37);
    expect(new Set(rows.map((row) => `${row.kind}:${row.id}`)).size).toBe(37);
    const failing = rows.filter((row) => row.invalid !== null || row.lastRun?.outcome === "launch-failed" || row.lastRun?.outcome === "invalid" || row.lastRun?.outcome === "unknown");
    expect(failing).toHaveLength(5);
    const raw = (files["schedule-list.json"] as { schedules: { recentRuns?: { runId: string }[] }[] }).schedules;
    expect(raw.filter((row) => row.recentRuns?.length === 50).length).toBeGreaterThanOrEqual(3);
    for (const row of raw.filter((each) => each.recentRuns?.length === 50)) expect(new Set(row.recentRuns!.map((run) => run.runId)).size).toBe(50);
    expect(rows.filter((row) => (row.description ?? "").length > 150 && !(row.description ?? "").includes("\n")).length).toBeGreaterThanOrEqual(10);
    const teams = parseTeams(files["teams.json"]);
    expect(teams.ok && teams.value.teams.length).toBe(7);
    const machines = parseServers(files["servers.json"]);
    expect(machines.ok && machines.value.machines.length).toBe(5);
  });

  it("names no person and no place of a person's: what it adds to the recorded answers is made up", () => {
    const added = [...made.agents, ...made.souls, ...made.schedules, ...made.triggers, ...made.teams, ...made.servers].flatMap((each) => each.swaps.map(([, to]) => to));
    expect(added.length).toBeGreaterThan(100);
    expect(added.filter((name) => /\/home\/|@|joan|reyero|octolens/i.test(name))).toEqual([]);
  });
});
