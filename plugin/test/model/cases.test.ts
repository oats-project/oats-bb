// The shared case table of a provider home's row (README.md, "A provider home's row, case by
// case"): every recorded row is read against it. The table is the one the bb session provider's
// `inspectAnswer` and the plugin's `state` / `threadWorks` must agree on; this test holds the
// plugin's side, on the rows the kernel printed with that provider.
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { STATE } from "../../app/ui/words";
import { parseStatus } from "../../kernel/roster";
import type { Agent, BbThread } from "../../model/types";
import { state, threadWorks } from "../../model/view";

const FIXTURES = resolve(process.cwd(), "test/fixtures");
const README = readFileSync(resolve(process.cwd(), "README.md"), "utf8");

type Case = { name: string; running: string; runtimeState: string; sessionEnd: string; outsideOats: string; thread: string; says: string; recorded: string | null };
/** The table's rows, as the README holds them. */
function cases(): Case[] {
  const from = README.indexOf("### A provider home's row, case by case");
  if (from < 0) throw new Error("README.md has no section \"A provider home's row, case by case\"");
  const lines = README.slice(from).split("\n");
  const head = lines.findIndex((line) => line.startsWith("| Case |"));
  const rows: Case[] = [];
  for (const line of lines.slice(head + 2)) {
    if (!line.startsWith("|")) break;
    const cells = line.split("|").slice(1, -1).map((cell) => cell.trim());
    const [name, running, runtimeState, sessionEnd, outsideOats, thread, says, recorded] = cells as [string, string, string, string, string, string, string, string];
    rows.push({ name, running, runtimeState, sessionEnd, outsideOats, thread, says, recorded: /^`(.+)`$/.exec(recorded)?.[1] ?? null });
  }
  return rows;
}
/** The one row of a recording: `<file>` (a status document), or `<file>#<key>` (one state of the real run's recording). */
function rowOf(recorded: string): Agent {
  const [file, key] = recorded.split("#") as [string, string | undefined];
  const whole: unknown = JSON.parse(readFileSync(join(FIXTURES, file), "utf8"));
  const status = parseStatus(key === undefined ? whole : (whole as Record<string, unknown>)[key]);
  if (!status.ok) throw new Error(`${recorded}: ${status.error.code}: ${status.error.message}`);
  if (status.value.agents.length !== 1) throw new Error(`${recorded}: expected one row, found ${status.value.agents.length}`);
  return status.value.agents[0]!;
}
/** bb's thread as the table's column says it: in a turn, at rest, or one bb does not list (archived, deleted). */
function threadOf(column: string): BbThread | null {
  const thread = (status: string): BbThread => ({ id: "thr_case", projectId: null, displayTitle: "case", updatedAt: 0, isUnread: false, isArchived: false, isHidden: false, hasPendingInteraction: false, status, queuedWork: "none" }) as BbThread;
  if (column === "in a turn") return thread("active");
  if (column === "at rest") return thread("idle");
  if (column === "at rest, a turn in line") return { ...thread("idle"), queuedWork: "waiting" } as BbThread;
  if (column === "archived" || column === "deleted" || column === "any") return null;
  throw new Error(`the table's thread column says ${JSON.stringify(column)}, which this test does not know`);
}
/** A field as the table writes it: a dash for one the row does not carry. */
const written = (value: unknown): string => (value === undefined || value === null ? "-" : String(value));

describe("the shared case table of a provider home's row", () => {
  const table = cases();

  it("is in the README, with the rows the two functions must agree on, and names both", () => {
    expect(table.length).toBeGreaterThanOrEqual(12);
    // A row with no recording still says a thread this test can build, and what the plugin's `threadWorks` says of it is the row's word.
    for (const row of table.filter((each) => each.recorded === null && each.says === "Working")) expect(threadWorks(threadOf(row.thread)!), row.name).toBe(true);
    expect(README).toMatch(/`inspectAnswer`,\s+`oats-package\/capabilities\/oats-bb\/lib\/threads\.mjs`/);
    expect(README).toMatch(/`state` and `threadWorks`, `model\/view\.ts`/);
    // The state's word is always one of the plugin's set.
    const set = Object.values(STATE).map((each) => each.word);
    for (const row of table) expect(set, row.name).toContain(row.says);
  });

  it("holds for every recorded row: the kernel's four fields, and the state the plugin says with bb's thread as the table gives it", () => {
    const recorded = table.filter((row) => row.recorded !== null);
    expect(recorded.length).toBeGreaterThanOrEqual(7);
    for (const row of recorded) {
      const agent = rowOf(row.recorded!);
      expect([written(agent.running), written(agent.runtimeState), written(agent.sessionEnd), written(agent.outsideOats?.code)], `${row.name}: the row of ${row.recorded}`).toEqual([row.running, row.runtimeState, row.sessionEnd, row.outsideOats]);
      expect(STATE[state(agent, threadOf(row.thread))].word, `${row.name}: what the plugin says of ${row.recorded}`).toBe(row.says);
    }
  });

  it("every row recorded for the outside feature is a case of the table", () => {
    const named = new Set(table.map((row) => row.recorded).filter((file): file is string => file !== null));
    for (const file of readdirSync(join(FIXTURES, "outside")).filter((name) => name.endsWith(".json"))) expect([...named], `outside/${file}`).toContain(`outside/${file}`);
  });

  it("Working and Idle are bb's word on the thread, never the kernel's running: the two rows at rest say Idle, loaded or not, and Working in a turn", () => {
    const loaded = rowOf("outside/status-at-rest.json");
    const unloaded = rowOf("outside/status-not-loaded.json");
    expect([loaded.running, unloaded.running]).toEqual([true, false]);
    for (const agent of [loaded, unloaded]) {
      expect(state(agent, threadOf("at rest"))).toBe("idle");
      expect(state(agent, threadOf("in a turn"))).toBe("working");
    }
    expect([threadWorks({ status: "idle", queuedWork: "none" }), threadWorks({ status: "active", queuedWork: "none" }), threadWorks({ status: "idle", queuedWork: "waiting" })]).toEqual([false, true, true]);
  });
});
