// The notice of a thread that bb archived or deleted under an agent that ran (app/lifecycle/left.ts):
// the rule, held to the cases its design names. The roster here is SHAPED by hand from the fields the
// rule reads (an agent's instance, thread id, backend, `running`, `runtimeState`, `sessionEnd`; bb's
// answer for its thread; the roster's stamp): no kernel answer is restated. The rows a real kernel
// prints are: bb's archive under a running agent, test/fixtures/outside/status-archived-while-running.json
// (it runs) and roster/status-recorded.json#threadDeleted (its session lost); a stop's row,
// `sessionEnd: "stopped"`; and, read in the kernel's code (@awebai/oats 0.70.5 lib/instance-listing.mjs)
// and NOT recorded: a retire on its way (not running, how its session ended withheld) and a launch on its
// way ("unreachable", `running: null`, on the old thread).
import { beforeEach, describe, expect, it } from "vitest";
import { lookForLeft } from "../../app/lifecycle/left";
import type { Oats } from "../../app/oats";
import { resetWindow } from "../../app/store";
import type { Agent, Node, ThreadWhere } from "../../model/types";

type Row = { instance: string; threadId: string | null; backend?: string; running?: boolean | null; runtimeState?: string | null; sessionEnd?: string | null; where: ThreadWhere };
/** The server's stamps are times in one form; here, numbers in one width, in the order they were made. */
let clock = 0;
const stamp = () => `2026-11-24T19:00:${String(++clock).padStart(2, "0")}.000Z`;
/** A roster just read (a new stamp each), of these rows; `over`: stale, gone, a stamp. */
function roster(rows: readonly Row[], over: { stale?: boolean; gone?: readonly string[]; at?: string } = {}): Oats {
  const agents = rows.map((row) => ({ instance: row.instance, threadId: row.threadId, backend: row.backend ?? "bb", running: row.running === undefined ? true : row.running, runtimeState: row.runtimeState === undefined ? "running" : row.runtimeState, sessionEnd: row.sessionEnd ?? null }) as unknown as Agent);
  const where = new Map(rows.map((row, index) => [agents[index]!, row.where]));
  // The roster draws an agent ON its thread only where bb lists it.
  const nodes = new Map(agents.filter((agent) => where.get(agent) === "open").map((agent) => [agent.instance, { agent, thread: { id: agent.threadId } } as unknown as Node]));
  const at = over.at ?? stamp();
  return { phase: "ready", stale: over.stale === true ? { code: "E_X", message: "", at } : null, at, agents, gone: new Set(over.gone ?? []), whereOf: (agent: Agent) => where.get(agent) ?? "none", nodeByInstance: nodes } as unknown as Oats;
}
const LEAD = "redesign-ui-lead";
const open = (over: Partial<Row> = {}): Row => ({ instance: LEAD, threadId: "thr_1", where: "open", ...over });
const archived = (over: Partial<Row> = {}): Row => open({ where: "archived", ...over });
/** The rows a kernel prints: an operator's stop; a session that was lost; not running with no word how (a retire on its way); a launch on its way. */
const STOPPED = { running: false, runtimeState: "stopped", sessionEnd: "stopped" } as const;
const LOST = { running: false, runtimeState: "stopped", sessionEnd: "lost" } as const;
const NO_WORD = { running: false, runtimeState: "stopped", sessionEnd: null } as const;
const UNREACHABLE = { running: null, runtimeState: "unreachable", sessionEnd: null } as const;

let toldOf: string[] = [];
let asks = 0;
/** How OATS answers when asked again: with the stamp of the read it then makes (null: it could not be asked). */
let answer: () => string | null = stamp;
/** One look, and the answer to what it asked (if it asked) landed. */
async function look(oats: Oats, busy = false): Promise<void> {
  lookForLeft(oats, { busy, ask: () => (asks += 1, Promise.resolve(answer())), tell: (instance) => toldOf.push(instance) });
  await Promise.resolve();
  await Promise.resolve();
}

beforeEach(() => {
  resetWindow();
  toldOf = [];
  asks = 0;
  answer = stamp;
});

describe("a thread that bb archived or deleted under an agent that ran", () => {
  it.each(["archived", "missing"] as const)("bb says the thread is %s and the row read after still says it runs: OATS is asked again once, and the roster read after that tells it, once", async (where) => {
    await look(roster([open()]));
    const gone = roster([open({ where })]);
    await look(gone);
    expect([toldOf, asks]).toEqual([[], 1]); // not at once: an act through OATS archives the thread too, before the roster is read
    await look(gone); // the same roster, drawn again (it was read BEFORE OATS was asked): nothing more is asked, nothing is told
    expect([toldOf, asks]).toEqual([[], 1]);
    await look(roster([open({ where })]));
    expect([toldOf, asks]).toEqual([[LEAD], 1]);
    // Once per agent and thread: later rosters say the same and tell nothing.
    await look(roster([open({ where })]));
    await look(roster([open({ where, ...LOST })]));
    expect([toldOf, asks]).toEqual([[LEAD], 1]);
  });

  it("the row read after says its session was lost (what a kernel says once bb's archive ended the harness): told, it was not stopped through OATS", async () => {
    await look(roster([open()]));
    await look(roster([archived()]));
    await look(roster([archived(LOST)]));
    expect(toldOf).toEqual([LEAD]);
  });

  it("a roster read BEFORE OATS was asked that reaches the window after (a read that was in flight; its stamp is older): it does not decide; the asked read does", async () => {
    await look(roster([open()]));
    const inFlight = stamp(); // a read that began before the question
    await look(roster([archived()]));
    await look(roster([archived()], { at: inFlight })); // it still says "runs", and is not the read after
    expect(toldOf).toEqual([]);
    await look(roster([archived(STOPPED)]));
    expect(toldOf).toEqual([]);
  });

  it("a stop through OATS (the plugin's own, or one from a terminal): the row read after says an operator stopped it, and nothing is told, then or later", async () => {
    await look(roster([open()]));
    await look(roster([archived()]));
    await look(roster([archived(STOPPED)]));
    await look(roster([archived({ running: true, runtimeState: "running" })])); // (whatever a later row says: the candidate is gone)
    expect([toldOf, asks]).toEqual([[], 1]);
  });

  it.each([
    ["a retire through OATS on its way (the kernel withholds how the session ended): not running, with no word how", NO_WORD],
    ["a restart from a terminal on its way: the row is unreachable, on its old thread", UNREACHABLE],
  ] as const)("%s: the row says neither that it runs nor that it was lost: nothing is told, OATS is not asked again, and a later roster decides", async (_name, row) => {
    await look(roster([open()]));
    await look(roster([archived()]));
    await look(roster([archived(row)]));
    await look(roster([archived(row)]));
    expect([toldOf, asks]).toEqual([[], 1]);
    // Then the agent is gone from the roster (retired), or on a new thread (restarted): nothing, ever.
    await look(roster([]));
    await look(roster([open({ threadId: "thr_2" })]));
    await look(roster([archived({ threadId: "thr_1" })]));
    expect([toldOf, asks]).toEqual([[], 1]);
  });

  it("a row that said neither, and then says that it runs after all (the retire or the restart did not happen): told then, without asking again", async () => {
    await look(roster([open()]));
    await look(roster([archived()]));
    await look(roster([archived(UNREACHABLE)]));
    await look(roster([archived()]));
    expect([toldOf, asks]).toEqual([[LEAD], 1]);
  });

  it("while an act of ours is in flight or its dialog is on screen nothing is asked or told; after it, OATS is asked, and the read after decides", async () => {
    await look(roster([open()]));
    await look(roster([archived()]), true);
    await look(roster([archived()]), true);
    expect([toldOf, asks]).toEqual([[], 0]);
    await look(roster([archived()]));
    expect([toldOf, asks]).toEqual([[], 1]);
    await look(roster([archived(STOPPED)]));
    expect(toldOf).toEqual([]);
  });

  it("an act that begins after OATS was asked: the look waits again, the answer to the earlier question is nobody's, and OATS is asked again after the act", async () => {
    await look(roster([open()]));
    await look(roster([archived()]));
    await look(roster([archived()]), true);
    await look(roster([archived()]), true); // a roster read after the first question, while the act is on: it decides nothing
    expect([toldOf, asks]).toEqual([[], 1]);
    await look(roster([archived()]));
    expect([toldOf, asks]).toEqual([[], 2]);
    await look(roster([archived()]));
    expect(toldOf).toEqual([LEAD]);
  });

  it("an answer that lands after an act of ours began is dropped: the stamp of a read made before the act ended decides nothing", async () => {
    await look(roster([open()]));
    let land!: (at: string) => void;
    lookForLeft(roster([archived()]), { busy: false, ask: () => new Promise<string>((resolve) => (land = resolve)), tell: (instance) => toldOf.push(instance) });
    await look(roster([archived()]), true); // our act begins while the question is out
    land(stamp());
    await look(roster([archived()]), true);
    await look(roster([archived()])); // the act ended: asked anew
    expect([toldOf, asks]).toEqual([[], 1]);
    await look(roster([archived(STOPPED)]));
    expect(toldOf).toEqual([]);
  });

  it("OATS could not be asked: nothing is decided, and it is asked again on a later roster, not at each draw of the same one", async () => {
    answer = () => null;
    await look(roster([open()]));
    const same = roster([archived()]);
    await look(same);
    await look(same);
    await look(same);
    expect([toldOf, asks]).toEqual([[], 1]);
    answer = stamp;
    await look(roster([archived()]));
    expect(asks).toBe(2);
    await look(roster([archived()]));
    expect(toldOf).toEqual([LEAD]);
  });

  it("an agent that did not run when its thread was last listed: nothing", async () => {
    await look(roster([open(STOPPED)]));
    await look(roster([archived(STOPPED)]));
    await look(roster([archived(STOPPED)]));
    expect([toldOf, asks]).toEqual([[], 0]);
  });

  it("bb has not answered yet for the thread it no longer lists: nothing until it does", async () => {
    await look(roster([open()]));
    await look(roster([open({ where: "unknown" })]));
    await look(roster([open({ where: "unknown" })]));
    expect([toldOf, asks]).toEqual([[], 0]);
    await look(roster([open({ where: "missing" })]));
    await look(roster([open({ where: "missing" })]));
    expect([toldOf, asks]).toEqual([[LEAD], 1]);
  });

  it("bb stops saying of the thread for a while (one failed answer forgets them all): the archive is not lost; it is told once bb says again", async () => {
    await look(roster([open()]));
    await look(roster([archived()]));
    await look(roster([open({ where: "unknown" })]));
    await look(roster([open({ where: "unknown" })]));
    expect(toldOf).toEqual([]);
    for (let read = 0; read < 3; read += 1) await look(roster([archived()]));
    expect([toldOf, asks]).toEqual([[LEAD], 1]);
  });

  it("a start or a restart gave the agent a new thread (the old one archived): nothing, before or after OATS is asked", async () => {
    await look(roster([open()]));
    await look(roster([open({ threadId: "thr_2" })]));
    expect(asks).toBe(0);
    // And where the old thread was seen archived first, the new thread at the read after:
    await look(roster([archived({ threadId: "thr_2" })]));
    await look(roster([open({ threadId: "thr_3" })]));
    expect(toldOf).toEqual([]);
  });

  it("a thread that was already archived or gone when the window opened, and an agent on tmux: nothing (the row warns)", async () => {
    const rows = [archived(), { instance: "kernel-fix-developer", threadId: null, backend: "tmux", where: "none" as ThreadWhere }];
    await look(roster(rows));
    await look(roster(rows));
    expect([toldOf, asks]).toEqual([[], 0]);
  });

  it("the agent is gone from the roster read after (retired), or the kernel no longer knows it: nothing", async () => {
    await look(roster([open()]));
    await look(roster([archived()]));
    await look(roster([]));
    await look(roster([open()]));
    await look(roster([archived()]));
    await look(roster([archived()], { gone: [LEAD] }));
    expect(toldOf).toEqual([]);
  });

  it("the thread is back (unarchived) before the read after: nothing, and a later archive is looked at anew", async () => {
    await look(roster([open()]));
    await look(roster([archived()]));
    await look(roster([open()]));
    expect(toldOf).toEqual([]);
    await look(roster([archived()]));
    await look(roster([archived()]));
    expect([toldOf, asks]).toEqual([[LEAD], 2]);
  });

  it("a roster that is the last one read (OATS cannot be read), or none: nothing is remembered, asked or decided on it", async () => {
    await look(roster([open()]));
    await look(roster([archived()]));
    await look(roster([archived()], { stale: true }));
    await look({ phase: "loading" } as unknown as Oats);
    expect(toldOf).toEqual([]);
    await look(roster([archived()]));
    expect(toldOf).toEqual([LEAD]);
  });

  it("two agents: each is told of by itself, once", async () => {
    const other = { instance: "harvest-knowledge-helper", threadId: "thr_9", where: "open" as ThreadWhere };
    await look(roster([open(), other]));
    await look(roster([archived(), { ...other, where: "missing" }]));
    await look(roster([archived(), { ...other, where: "missing" }]));
    expect([toldOf, asks]).toEqual([[LEAD, other.instance], 2]);
  });

  it("a new app window remembers nothing of the one before", async () => {
    await look(roster([open()]));
    resetWindow();
    await look(roster([archived()]));
    await look(roster([archived()]));
    expect(toldOf).toEqual([]);
  });
});
