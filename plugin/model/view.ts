// Pure functions from (agents, bbThreads) to what each slot draws. No bb or React import.
import type { Agent, AgentState, BbThread, Node, View } from "./types";

/**
 * The claim a row may show, or null: the Desktop's gate (awebai/oats, packages/client/
 * waiting-on-you.mjs `waitingClaim`, read at 95c7b43b3), so that the tree, the thread's row and
 * the instance panel say one thing.
 * - A row on a session provider (bb): the claim the kernel's row carries, unless the kernel calls
 *   the row stopped (`running === false`, its session not one that failed or that it cannot
 *   reach): a home OATS stopped shows none, whatever it still carries.
 * - A tmux row: only while the kernel says it runs (`running === true`, and no `runtimeState`
 *   other than "running").
 * A question bb itself holds on a thread is not a claim: it is bb's own fact, and `state()` counts it.
 */
export function claimOf(agent: Agent): Agent["waiting"] {
  if (agent.waiting === null) return null;
  if (agent.backend === "tmux") return agent.running === true && (agent.runtimeState === null || agent.runtimeState === "running") ? agent.waiting : null;
  const stopped = agent.running === false && agent.runtimeState !== "shell" && agent.runtimeState !== "unreachable";
  return stopped ? null : agent.waiting;
}

/**
 * Whether bb says the agent on a thread WORKS, as the bb session provider itself reads it
 * (oats-package/capabilities/oats-bb/lib/threads.mjs `inspectAnswer`: TURN_IN_PROGRESS, SETTLED),
 * so that the plugin and the provider agree. bb's statuses (@get-bb/plugin-sdk `threadStatusSchema`,
 * 0.6.157: active, error, idle, pending, starting, stopping):
 * - a turn runs, is starting or is stopping ("active", "starting", "stopping"): it works;
 * - "pending" or "idle" with a turn bb holds in line (`queuedWork: "waiting"`: bb starts it by
 *   itself): it works; with nothing in line: idle;
 * - "error" (bb's last turn failed; the session is there, at rest): idle. bb shows the failure in
 *   the thread; where the harness is gone too, the kernel's row says so and the stopped rule takes it;
 * - a status this plugin does not know: idle, as bb's SDK says to treat one.
 */
const TURN_IN_PROGRESS: ReadonlySet<string> = new Set(["active", "starting", "stopping"]);
const SETTLED: ReadonlySet<string> = new Set(["pending", "idle"]);
export const threadWorks = (thread: Pick<BbThread, "status" | "queuedWork">): boolean =>
  TURN_IN_PROGRESS.has(thread.status) || (SETTLED.has(thread.status) && thread.queuedWork === "waiting");

/**
 * The state of one agent on its thread. First match wins.
 *
 * WORKING and IDLE, for an agent on a bb thread, are bb's own status of that thread, never the
 * kernel's `running`: `running` is endpoint activity (true: a harness is loaded; false: it is
 * gone; null: the provider cannot tell), and a provider answers true for an idle agent whose
 * harness is loaded. The kernel's `running` is read for two things only: false, which is
 * "stopped" (what the kernel prints for a tmux row whose window is gone or whose harness does not
 * run: `{ running: false }`, no `runtimeState`; a bb row comes with "stopped" beside it); and a
 * TMUX row's activity, where it is the kernel's own word for whether the agent works.
 * A provider's agent whose thread bb does not list (archived, deleted, hidden) is "idle": its
 * thread's status cannot be seen, and a loaded harness does not say that it works.
 * A session that ended in a shell, or that the kernel cannot reach, is told first. The one rule
 * for the sidebar's rows, the thread's row, the home and the instance panel.
 */
export function state(agent: Agent, thread: BbThread | null): AgentState {
  if (claimOf(agent) !== null || thread?.hasPendingInteraction === true) return "needs-you";
  if (agent.runtimeState === "unreachable") return "unreachable";
  if (agent.runtimeState === "stopped") return "stopped";
  if (agent.runtimeState === "shell") return "error";
  if (agent.running === false) return "stopped";
  if (agent.backend === "tmux") return agent.running === true ? "working" : "idle";
  if (thread === null) return "idle";
  return threadWorks(thread) ? "working" : "idle";
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
