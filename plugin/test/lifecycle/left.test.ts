// The notice of a thread that bb archived or deleted under an agent that ran (app/lifecycle/left.ts):
// the rule, held to the cases its design names. The roster here is SHAPED by hand from the fields the
// rule reads (an agent's instance, thread id, backend, `running`, `runtimeState`, `sessionEnd`; bb's
// answer for its thread; the roster's stamp): no kernel answer is restated. The rows a real kernel
// prints for the two ends are test/fixtures/outside/status-archived-while-running.json (bb's archive
// under a running agent) and a stop's row with `sessionEnd: "stopped"`.
import { beforeEach, describe, expect, it } from "vitest";
import { lookForLeft } from "../../app/lifecycle/left";
import type { Oats } from "../../app/oats";
import { resetWindow } from "../../app/store";
import type { Agent, Node, ThreadWhere } from "../../model/types";

type Row = { instance: string; threadId: string | null; backend?: string; running?: boolean | null; runtimeState?: string | null; sessionEnd?: string | null; where: ThreadWhere };
let stamp = 0;
let retries = 0;
/** A roster just read (a new stamp each), of these rows; `over`: stale, gone. */
function roster(rows: readonly Row[], over: { stale?: boolean; gone?: readonly string[]; at?: string } = {}): Oats {
  const agents = rows.map((row) => ({ instance: row.instance, threadId: row.threadId, backend: row.backend ?? "bb", running: row.running === undefined ? true : row.running, runtimeState: row.runtimeState ?? "running", sessionEnd: row.sessionEnd ?? null }) as unknown as Agent);
  const where = new Map(rows.map((row, index) => [agents[index]!, row.where]));
  // The roster draws an agent ON its thread only where bb lists it.
  const nodes = new Map(agents.filter((agent) => where.get(agent) === "open").map((agent) => [agent.instance, { agent, thread: { id: agent.threadId } } as unknown as Node]));
  const at = over.at ?? `at-${++stamp}`;
  return {
    phase: "ready",
    stale: over.stale === true ? { code: "E_X", message: "", at } : null,
    at,
    agents,
    gone: new Set(over.gone ?? []),
    whereOf: (agent: Agent) => where.get(agent) ?? "none",
    nodeByInstance: nodes,
    retry: () => {
      retries += 1;
    },
  } as unknown as Oats;
}
const LEAD = "redesign-ui-lead";
const open = (over: Partial<Row> = {}): Row => ({ instance: LEAD, threadId: "thr_1", where: "open", ...over });
let toldOf: string[] = [];
const look = (oats: Oats, busy = false) => lookForLeft(oats, busy, (instance) => toldOf.push(instance));

beforeEach(() => {
  resetWindow();
  toldOf = [];
  retries = 0;
});

describe("a thread that bb archived or deleted under an agent that ran", () => {
  it.each(["archived", "missing"] as const)("bb says the thread is %s and the agent's row still does not say it was stopped: OATS is asked again once, and the roster read after tells it, once", (where) => {
    look(roster([open()]));
    const gone = roster([open({ where })]);
    look(gone);
    expect([toldOf, retries]).toEqual([[], 1]); // not at once: a stop through OATS archives the thread too, before the roster is read
    look(gone); // the same roster, drawn again: nothing more is asked, nothing is told
    expect([toldOf, retries]).toEqual([[], 1]);
    look(roster([open({ where })]));
    expect([toldOf, retries]).toEqual([[LEAD], 1]);
    // Once per agent and thread: later rosters say the same and tell nothing.
    look(roster([open({ where })]));
    look(roster([open({ where, running: false, runtimeState: "stopped", sessionEnd: "lost" })]));
    expect([toldOf, retries]).toEqual([[LEAD], 1]);
  });

  it("the row read after says not running, its session lost (what a kernel says once bb's archive ended the harness): told all the same, it was not stopped through OATS", () => {
    look(roster([open()]));
    look(roster([open({ where: "archived" })]));
    look(roster([open({ where: "archived", running: false, runtimeState: "stopped", sessionEnd: "lost" })]));
    expect(toldOf).toEqual([LEAD]);
  });

  it("a stop through OATS (the plugin's own, or one from a terminal): the row read after says an operator stopped it, and nothing is told", () => {
    look(roster([open()]));
    look(roster([open({ where: "archived" })]));
    look(roster([open({ where: "archived", running: false, runtimeState: "stopped", sessionEnd: "stopped" })]));
    look(roster([open({ where: "archived", running: false, runtimeState: "stopped", sessionEnd: "stopped" })]));
    expect([toldOf, retries]).toEqual([[], 1]);
  });

  it("while an act of ours is in flight or its dialog is on screen nothing is asked or told; after it, OATS is asked, and the read after decides", () => {
    look(roster([open()]));
    look(roster([open({ where: "archived" })]), true);
    look(roster([open({ where: "archived" })]), true);
    expect([toldOf, retries]).toEqual([[], 0]);
    look(roster([open({ where: "archived" })]));
    expect([toldOf, retries]).toEqual([[], 1]);
    look(roster([open({ where: "archived", running: false, runtimeState: "stopped", sessionEnd: "stopped" })]));
    expect(toldOf).toEqual([]);
  });

  it("an act that begins after OATS was asked: the look waits again, and asks again after it", () => {
    look(roster([open()]));
    look(roster([open({ where: "archived" })]));
    look(roster([open({ where: "archived" })]), true);
    expect([toldOf, retries]).toEqual([[], 1]);
    look(roster([open({ where: "archived" })]));
    expect([toldOf, retries]).toEqual([[], 2]);
    look(roster([open({ where: "archived" })]));
    expect(toldOf).toEqual([LEAD]);
  });

  it("an agent that did not run when its thread was last listed: nothing", () => {
    look(roster([open({ running: false, runtimeState: "stopped", sessionEnd: "stopped" })]));
    look(roster([open({ where: "archived", running: false, runtimeState: "stopped", sessionEnd: "stopped" })]));
    look(roster([open({ where: "archived", running: false, runtimeState: "stopped", sessionEnd: "stopped" })]));
    expect([toldOf, retries]).toEqual([[], 0]);
  });

  it("bb has not answered yet for the thread it no longer lists: nothing until it does", () => {
    look(roster([open()]));
    look(roster([open({ where: "unknown" })]));
    look(roster([open({ where: "unknown" })]));
    expect([toldOf, retries]).toEqual([[], 0]);
    look(roster([open({ where: "missing" })]));
    look(roster([open({ where: "missing" })]));
    expect([toldOf, retries]).toEqual([[LEAD], 1]);
  });

  it("a start or a restart gave the agent a new thread (the old one archived): nothing, before or after OATS is asked", () => {
    look(roster([open()]));
    look(roster([open({ threadId: "thr_2" })]));
    expect(retries).toBe(0);
    // And where the old thread was seen archived first, the new thread at the read after:
    look(roster([open({ threadId: "thr_2", where: "archived" })]));
    look(roster([open({ threadId: "thr_3" })]));
    expect(toldOf).toEqual([]);
  });

  it("a thread that was already archived or gone when the window opened, and an agent on tmux: nothing (the row warns)", () => {
    look(roster([open({ where: "archived" }), { instance: "kernel-fix-developer", threadId: null, backend: "tmux", where: "none" }]));
    look(roster([open({ where: "archived" }), { instance: "kernel-fix-developer", threadId: null, backend: "tmux", where: "none" }]));
    expect([toldOf, retries]).toEqual([[], 0]);
  });

  it("the agent is gone from the roster read after (retired), or the kernel no longer knows it: nothing", () => {
    look(roster([open()]));
    look(roster([open({ where: "archived" })]));
    look(roster([]));
    look(roster([open()]));
    look(roster([open({ where: "archived" })]));
    look(roster([open({ where: "archived" })], { gone: [LEAD] }));
    expect(toldOf).toEqual([]);
  });

  it("the thread is back (unarchived) before the read after: nothing, and a later archive is looked at anew", () => {
    look(roster([open()]));
    look(roster([open({ where: "archived" })]));
    look(roster([open()]));
    expect(toldOf).toEqual([]);
    look(roster([open({ where: "archived" })]));
    look(roster([open({ where: "archived" })]));
    expect([toldOf, retries]).toEqual([[LEAD], 2]);
  });

  it("a roster that is the last one read (OATS cannot be read), or none: nothing is remembered, asked or decided on it", () => {
    look(roster([open()]));
    look(roster([open({ where: "archived" })]));
    look(roster([open({ where: "archived" })], { stale: true }));
    look({ phase: "loading" } as unknown as Oats);
    expect(toldOf).toEqual([]);
    look(roster([open({ where: "archived" })]));
    expect(toldOf).toEqual([LEAD]);
  });

  it("two agents: each is told of by itself, once", () => {
    const other = { instance: "harvest-knowledge-helper", threadId: "thr_9", where: "open" as ThreadWhere };
    look(roster([open(), other]));
    look(roster([open({ where: "archived" }), { ...other, where: "missing" }]));
    look(roster([open({ where: "archived" }), { ...other, where: "missing" }]));
    expect([toldOf, retries]).toEqual([[LEAD, other.instance], 2]);
  });

  it("a new app window remembers nothing of the one before", () => {
    look(roster([open()]));
    resetWindow();
    look(roster([open({ where: "archived" })]));
    look(roster([open({ where: "archived" })]));
    expect(toldOf).toEqual([]);
  });
});
