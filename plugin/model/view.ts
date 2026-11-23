// Pure functions from (agents, bbThreads) to what each slot draws. No bb or React import.
import type { Agent, AgentState, BbThread, Node, View } from "./types";

/**
 * Whether the kernel records an agent STOPPED: it says the agent does not run, and its word is
 * "stopped" or it gives none (what it prints for a tmux home whose window is gone). One rule, for
 * every backend, read by the claim gate below. (`state()` still calls every row that does not run
 * "stopped", a word beside it or not: the change that tells a row with no harness loaded apart
 * makes it read this too.)
 */
export function recordedStopped(agent: Pick<Agent, "running" | "runtimeState">): boolean {
  return agent.running === false && (agent.runtimeState === "stopped" || agent.runtimeState === null);
}

/**
 * The claim an agent shows: what it waits on a person for, as the kernel's row carries it, or
 * null. ONE gate (the Desktop's `waitingClaim`), so that the tree, the thread's row, the home and
 * the instance panel say one thing, and one rule for every backend (the spec's A2, as its author
 * amended it on 2026-11-23): a claim is hidden only for an agent the kernel calls stopped
 * (`recordedStopped`): nobody is there to wait. In every other case it shows ("a claim wins"): an
 * agent that runs, one the kernel says nothing of, one whose harness ended in a shell, one that
 * cannot be reached, on bb and on tmux alike.
 * A question bb itself holds on a thread is not a claim: it is bb's own fact, and `state()` counts it.
 */
export function claimOf(agent: Agent): Agent["waiting"] {
  return agent.waiting === null || recordedStopped(agent) ? null : agent.waiting;
}

/**
 * The state of one agent on its thread. First match wins. Activity is the kernel's word
 * (`running`), never inferred: bb cannot tell a live idle agent from a settled one, so an agent
 * the kernel says nothing of (`running` null) is "idle", an unknown `runtimeState` word included.
 * One the kernel calls not running (`running === false`) with no other word is "stopped": what it
 * prints for a tmux row whose window is gone or whose harness does not run (awebai/oats
 * lib/instance-listing.mjs at 95c7b43b3: `{ running: false }`, no `runtimeState`); a bb row comes
 * with "stopped" beside it. A session that ended in a shell, or that the kernel cannot reach, is
 * told first. The one rule for the sidebar's rows, the thread's row and the instance panel.
 */
export function state(agent: Agent, thread: BbThread | null): AgentState {
  if (claimOf(agent) !== null || thread?.hasPendingInteraction === true) return "needs-you";
  if (agent.runtimeState === "unreachable") return "unreachable";
  if (agent.runtimeState === "stopped") return "stopped";
  if (agent.runtimeState === "shell") return "error";
  if (agent.running === true) return "working";
  if (agent.running === false) return "stopped";
  return "idle";
}

const RANK: Record<AgentState, number> = {
  "needs-you": 0,
  working: 1,
  unreachable: 2,
  stopped: 2,
  error: 2,
  idle: 2,
};

/** needs-you, then working, then the rest; each by the thread's `updatedAt`, newest first. */
function byAttention(a: Node, b: Node): number {
  return RANK[a.state] - RANK[b.state] || b.thread.updatedAt - a.thread.updatedAt;
}

/**
 * The instances whose parent link is dropped so the tree has no cycle. Walking up from each
 * agent in the kernel's order, the link that would return to an instance already on the walk
 * (the first repeat) is the one cut: its owner is drawn as a root.
 */
function cutLinks(parentOf: ReadonlyMap<string, string>): Set<string> {
  const cut = new Set<string>();
  for (const start of parentOf.keys()) {
    const seen = new Set<string>([start]);
    let at = start;
    for (;;) {
      const parent = cut.has(at) ? undefined : parentOf.get(at);
      if (parent === undefined) break;
      if (seen.has(parent)) {
        cut.add(at);
        break;
      }
      seen.add(parent);
      at = parent;
    }
  }
  return cut;
}

/** Every node of a tree, parents before their children. */
export function flatten(roots: readonly Node[]): Node[] {
  const out: Node[] = [];
  const walk = (nodes: readonly Node[]) => {
    for (const node of nodes) {
      out.push(node);
      walk(node.children);
    }
  };
  walk(roots);
  return out;
}

/**
 * Joins the kernel's agents to bb's threads, by `agent.threadId === thread.id` only (the ids are
 * the same strings in every bb API; never bb's environment id, which threads on one path share).
 */
export function view(agents: readonly Agent[], threads: readonly BbThread[]): View {
  const threadById = new Map<string, BbThread>();
  for (const thread of threads) if (!threadById.has(thread.id)) threadById.set(thread.id, thread);

  const elsewhere: Agent[] = [];
  const detached: Agent[] = [];
  const drawn = new Map<string, Node>(); // by instance, in the kernel's order
  const taken = new Set<string>(); // thread ids an agent already draws

  for (const agent of agents) {
    if (agent.backend === "tmux") {
      elsewhere.push(agent);
      continue;
    }
    const thread = agent.threadId === null ? undefined : threadById.get(agent.threadId);
    if (
      thread === undefined ||
      thread.isArchived ||
      thread.isHidden ||
      taken.has(thread.id) ||
      drawn.has(agent.instance)
    ) {
      detached.push(agent);
      continue;
    }
    taken.add(thread.id);
    drawn.set(agent.instance, { agent, thread, state: state(agent, thread), depth: 0, children: [] });
  }

  // The tree, by `parent`. A parent that is not drawn makes its child a root.
  const parentOf = new Map<string, string>();
  for (const node of drawn.values()) {
    const parent = node.agent.parent;
    if (parent !== null && parent !== node.agent.instance && drawn.has(parent)) {
      parentOf.set(node.agent.instance, parent);
    }
  }
  const cut = cutLinks(parentOf);
  const roots: Node[] = [];
  for (const node of drawn.values()) {
    const parent = cut.has(node.agent.instance) ? undefined : parentOf.get(node.agent.instance);
    const parentNode = parent === undefined ? undefined : drawn.get(parent);
    if (parentNode === undefined) roots.push(node);
    else parentNode.children.push(node);
  }
  const settle = (nodes: Node[], depth: number) => {
    nodes.sort(byAttention);
    for (const node of nodes) {
      node.depth = depth >= 2 ? 2 : depth === 1 ? 1 : 0; // deeper than 2 is drawn at 2
      settle(node.children, depth + 1);
    }
  };
  settle(roots, 0);

  const all = flatten(roots);
  const newest = (a: Node, b: Node) => b.thread.updatedAt - a.thread.updatedAt;
  const pick = (keep: (node: Node) => boolean) => all.filter(keep).sort(newest);

  return {
    roots,
    others: threads
      .filter((thread) => !taken.has(thread.id) && !thread.isArchived && !thread.isHidden)
      .sort((a, b) => b.updatedAt - a.updatedAt),
    detached,
    elsewhere,
    needsYou: pick((node) => node.state === "needs-you"),
    // Every agent that waits on a person, whether bb has a thread for it or not: the ONE number a
    // place says of who waits. The sidebar's foot reads it; the home and its badge still count
    // `needsYou` (the agents with a thread) until their owner moves them to this. In the kernel's order.
    needing: agents.filter((agent) => {
      const node = drawn.get(agent.instance);
      return (node !== undefined && node.agent === agent ? node.state : state(agent, null)) === "needs-you";
    }),
    working: pick((node) => node.state === "working"),
    finished: pick((node) => node.state === "idle" && node.thread.isUnread),
  };
}
