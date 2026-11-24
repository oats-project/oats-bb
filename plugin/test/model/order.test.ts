// The roster's ONE order (model/view.ts `RANK`, `view().rows`): for every row whatever its backend.
// Ruled on the text audit, 23 Nov 2026 (the lead's word with the dropped foot line "N need you":
// with no line that counts who waits, the rows that wait must stand first).
//   rank 0  it needs you;  rank 1  a person must look (running outside OATS, failed);
//   rank 2  everything else, together (working, idle, stopped, unreachable).
// A row's rank is the lowest in its SUBTREE; within a rank, the kernel's own order of the agents.
// Never a thread's `updatedAt`, never Working above Idle: the order does not jump while it is read.
import { describe, expect, test } from "vitest";
import type { Agent, AgentState, BbThread, Node, Top } from "../../model/types";
import { RANK, state, view } from "../../model/view";

const agent = (instance: string, over: Partial<Agent> = {}): Agent => ({
  instance,
  soul: "soul-x",
  home: `/d/agents/soul-x/instances/${instance}`,
  parent: null,
  human: "joan",
  alias: instance,
  team: "default:oats.aweb.ai",
  address: null,
  backend: "bb",
  server: "http://127.0.0.1:38886",
  projectId: `proj_${instance}`,
  threadId: `thr_${instance}`,
  running: true,
  runtimeState: "unknown",
  runtimeError: null,
  waiting: null,
  ...over,
});
const thread = (id: string, over: Partial<BbThread> = {}): BbThread => ({ id, projectId: null, displayTitle: id, updatedAt: 1_000, status: "idle", queuedWork: "none", isUnread: false, isArchived: false, isHidden: false, hasPendingInteraction: false, ...over });
const WAITS = { waiting: { reason: "attention", message: "Which branch?", since: "2026-11-19T12:00:00.000Z" } } as const;
const tmux = (instance: string, over: Partial<Agent> = {}): Agent => agent(instance, { backend: "tmux", server: null, projectId: null, threadId: null, runtimeState: null, ...over });

/** The roster as it is drawn, row by row, top to bottom: each agent with its state and its depth (a thread-less agent is at depth 0). */
type Drawn = { instance: string; state: AgentState; depth: number; root: string };
function drawn(agents: readonly Agent[], threads: readonly BbThread[]): Drawn[] {
  const out: Drawn[] = [];
  const walk = (node: Node, root: string) => {
    out.push({ instance: node.agent.instance, state: node.state, depth: node.depth, root });
    for (const child of node.children) walk(child, root);
  };
  for (const top of view(agents, threads).rows as Top[]) {
    if ("node" in top) walk(top.node, top.node.agent.instance);
    else out.push({ instance: top.agent.instance, state: state(top.agent, null), depth: 0, root: top.agent.instance });
  }
  return out;
}
const names = (rows: readonly Drawn[]) => rows.map((row) => row.instance);
/** A person must look at it: it waits (rank 0), or it runs outside OATS or failed (rank 1). */
const urgent = (row: Drawn) => RANK[row.state] < 2;

/**
 * A roster of 30, mixed: bb agents in a tree three deep, agents on tmux, one whose thread bb does
 * not list. In the kernel's order as written. The ones that need a person are scattered through it,
 * late in the kernel's order, on purpose.
 */
function thirty(): { agents: Agent[]; threads: BbThread[] } {
  const agents: Agent[] = [];
  for (let i = 1; i <= 12; i += 1) agents.push(agent(`quiet-${i}`, { running: i % 2 === 0 ? true : null })); // roots, working or idle by their thread below
  agents.push(agent("root-a")); // a working root …
  agents.push(agent("child-a1", { parent: "root-a" }));
  agents.push(agent("child-a2", { parent: "root-a" }));
  agents.push(agent("grand-a2x", { parent: "child-a2", ...WAITS })); // … with a WAITING grandchild
  agents.push(agent("root-b"));
  agents.push(agent("child-b1", { parent: "root-b", runtimeState: "shell", running: false })); // failed, under a quiet root
  for (let i = 1; i <= 6; i += 1) agents.push(tmux(`tmux-${i}`, { running: i !== 3 })); // on tmux: working, and one stopped
  agents.push(tmux("tmux-waits", WAITS)); // a WAITING agent on tmux
  agents.push(agent("outside", { running: false, runtimeState: "stopped", sessionEnd: "stopped", outsideOats: { code: "running-outside-oats", backend: "bb", message: "a harness runs in outside on bb" } })); // runs OUTSIDE OATS
  agents.push(agent("no-thread", { threadId: "thr_gone" })); // bb lists no such thread
  agents.push(agent("stopped", { running: false, runtimeState: "stopped", sessionEnd: "stopped" }));
  agents.push(agent("waits-late", WAITS)); // a waiting root, last but one in the kernel's order
  agents.push(agent("unreachable", { running: null, runtimeState: "unreachable" }));
  const threads = agents.filter((each) => each.backend === "bb" && each.instance !== "no-thread").map((each, index) => thread(each.threadId!, { status: index % 3 === 0 ? "active" : "idle", updatedAt: 5_000 - index }));
  return { agents, threads };
}

describe("the roster's one order", () => {
  test("a roster of 30, mixed backends: every row drawn once; every row that needs a person stands above every root whose subtree has none", () => {
    const { agents, threads } = thirty();
    expect(agents).toHaveLength(30);
    const rows = drawn(agents, threads);
    expect(names(rows).sort()).toEqual(agents.map((each) => each.instance).sort());
    // The states the table is about are all in it.
    expect(new Set(rows.map((row) => row.state))).toEqual(new Set<AgentState>(["needs-you", "outside", "error", "working", "idle", "stopped", "unreachable"]));
    // A root's subtree is urgent when any row of it is.
    const urgentRoots = new Set(rows.filter(urgent).map((row) => row.root));
    const firstQuietRoot = rows.findIndex((row) => row.depth === 0 && !urgentRoots.has(row.root));
    const lastUrgent = rows.reduce((last, row, index) => (urgent(row) ? index : last), -1);
    expect(firstQuietRoot).toBeGreaterThan(lastUrgent);
    // And those that WAIT (rank 0) stand above those a person must only look at (rank 1), root by root.
    const rootRank = (root: string) => Math.min(...rows.filter((row) => row.root === root).map((row) => RANK[row.state]));
    const rootsInOrder = rows.filter((row) => row.depth === 0).map((row) => rootRank(row.root));
    expect(rootsInOrder).toEqual([...rootsInOrder].sort((a, b) => a - b));
  });

  test("the only row above a waiting one that does not itself need a person is its own ancestor, or a quieter branch of a subtree that waits above it", () => {
    // (A tree is drawn subtree by subtree: the quiet child of an urgent root stands under that root, and so above
    // the next urgent root. Among siblings, and among roots, nothing quiet stands above something urgent.)
    const { agents, threads } = thirty();
    const rows = drawn(agents, threads);
    const parentOf = new Map(agents.map((each) => [each.instance, each.parent]));
    const ancestors = (instance: string): string[] => {
      const up: string[] = [];
      for (let at = parentOf.get(instance) ?? null; at !== null && !up.includes(at); at = parentOf.get(at) ?? null) up.push(at);
      return up;
    };
    const urgentRoots = new Set(rows.filter(urgent).map((row) => row.root));
    rows.forEach((row, index) => {
      if (!urgent(row)) return;
      for (const above of rows.slice(0, index)) {
        if (urgent(above) || ancestors(row.instance).includes(above.instance)) continue;
        // Not urgent, not an ancestor: it is in a subtree that is itself urgent (never under a quiet root).
        expect(urgentRoots.has(above.root), `${above.instance} above ${row.instance}`).toBe(true);
      }
    });
    // The waiting grandchild lifts its working root to the top of the tree, and stands first among its siblings' subtrees.
    expect(names(rows).slice(0, 4)).toEqual(["root-a", "child-a2", "grand-a2x", "child-a1"]);
    // Then the other rows that wait, in the kernel's order, whatever their backend: the one on tmux, the late root.
    expect(names(rows).slice(4, 6)).toEqual(["tmux-waits", "waits-late"]);
    // Then those a person must look at, in the kernel's order: the failed child lifts its root; the agent that runs outside OATS.
    expect(names(rows).slice(6, 9)).toEqual(["root-b", "child-b1", "outside"]);
    // Then everything else, in the kernel's order: working, idle, stopped, unreachable together; thread-less agents among them, no block of their own.
    const rest = names(rows).slice(9);
    expect(rest).toEqual(agents.map((each) => each.instance).filter((instance) => rest.includes(instance)));
    expect(rest.indexOf("tmux-1")).toBeLessThan(rest.indexOf("no-thread"));
    expect(rest.indexOf("no-thread")).toBeLessThan(rest.indexOf("unreachable"));
  });

  test("a roster of ONLY tmux agents, eight, one waiting: it is the first row; the others keep the kernel's order", () => {
    const agents = [1, 2, 3, 4, 5, 6, 7, 8].map((i) => tmux(`t-${i}`, i === 6 ? WAITS : { running: i % 2 === 0 }));
    expect(names(drawn(agents, []))).toEqual(["t-6", "t-1", "t-2", "t-3", "t-4", "t-5", "t-7", "t-8"]);
    // Nobody waits: the kernel's order, exactly.
    expect(names(drawn(agents.map((each) => ({ ...each, waiting: null })), []))).toEqual(["t-1", "t-2", "t-3", "t-4", "t-5", "t-6", "t-7", "t-8"]);
  });

  test("the order does not jump for a state that is not more urgent: Working to Idle, and a thread's updatedAt moving, give the SAME order", () => {
    const { agents, threads } = thirty();
    const before = names(drawn(agents, threads));
    // One agent's thread goes from a running turn to idle, another's the other way, and every thread's updatedAt moves (a message in each).
    const moved = threads.map((each, index) => ({ ...each, status: each.status === "active" ? ("idle" as const) : index % 2 === 0 ? ("active" as const) : each.status, updatedAt: 9_000 + ((index * 7) % 13) }));
    expect(names(drawn(agents, moved))).toEqual(before);
    // An agent on tmux that stops working (the kernel's own word) moves no row either.
    expect(names(drawn(agents.map((each) => (each.instance === "tmux-2" ? { ...each, running: null } : each)), threads))).toEqual(before);
  });

  test("a quiet agent that starts to need you rises, and falls back to its kernel place when answered", () => {
    const { agents, threads } = thirty();
    const before = names(drawn(agents, threads));
    const asks = agents.map((each) => (each.instance === "quiet-9" ? { ...each, ...WAITS } : each));
    const risen = names(drawn(asks, threads));
    // It stands among those that wait, at its kernel place among them (before the tmux one and the late root, after root-a's subtree, which the kernel lists… later: the kernel's order decides).
    expect(risen.indexOf("quiet-9")).toBeLessThan(before.indexOf("quiet-9"));
    expect(risen.slice(0, 7)).toEqual(["quiet-9", "root-a", "child-a2", "grand-a2x", "child-a1", "tmux-waits", "waits-late"]);
    // Answered: exactly the order it had.
    expect(names(drawn(agents, threads))).toEqual(before);
    // The same through bb's own word on the thread (a pending request there, no claim of the kernel's).
    const pending = threads.map((each) => (each.id === "thr_quiet-9" ? { ...each, hasPendingInteraction: true } : each));
    expect(names(drawn(agents, pending)).slice(0, 1)).toEqual(["quiet-9"]);
  });

  test("three ranks only, and none puts Working above Idle", () => {
    expect(RANK).toEqual({ "needs-you": 0, outside: 1, error: 1, working: 2, idle: 2, stopped: 2, unreachable: 2 });
  });
});
