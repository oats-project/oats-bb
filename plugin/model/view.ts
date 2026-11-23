// Pure functions from (agents, bbThreads) to what each slot draws. No bb or React import.
import type { Agent, AgentState, BbThread, Node, View } from "./types";

/**
 * Whether the kernel's row says the agent is STOPPED. The one predicate of the claim's gate and of
 * the state, for every backend. The row does not run (`running: false`), and:
 * - where it says how its session ended (`sessionEnd`), THAT decides: "stopped" (an operator's
 *   stop) and "lost" (it ended without OATS stopping it) are stopped, whatever word stands beside
 *   them (a tmux agent stopped with OATS reads "shell": the stop leaves its window at a shell; a
 *   row that still says "stopped" beside "unknown" is a stop too); "exited" (its harness ended by
 *   itself) is not: that agent failed;
 * - where it does not say: the word "stopped", or no word at all (a tmux row whose window is
 *   gone). A row beside another word ("unknown": its session is there and no harness is loaded;
 *   "shell": its session ended) is not stopped, keeps its claim, and is told by its own state.
 * A session the kernel cannot reach is never called stopped: nobody can tell.
 * (The spec's author's rulings of 23 Nov 2026; the tmux rows are recorded: test/fixtures/lifecycle/tmux-row-*.json.)
 */
export function recordedStopped(agent: Pick<Agent, "running" | "runtimeState"> & { sessionEnd?: string | null }): boolean {
  if (agent.running !== false || agent.runtimeState === "unreachable") return false;
  if (agent.sessionEnd === "stopped" || agent.sessionEnd === "lost") return true;
  if (agent.sessionEnd === "exited") return false;
  return agent.runtimeState === "stopped" || agent.runtimeState === null;
}

/**
 * The claim an agent shows: what it waits on a person for, as the kernel's row carries it, or
 * null. ONE gate (the Desktop's `waitingClaim` for a provider's agent; for a tmux agent it shows
 * more than the Desktop, which asks that the kernel says it runs: WORDS.md), so that the tree, the thread's row, the home and
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

/** Whether bb lists a thread: one it has archived or hidden is not drawn, and its status is not read. */
export const isListed = (thread: Pick<BbThread, "isArchived" | "isHidden">): boolean => !thread.isArchived && !thread.isHidden;

/**
 * Whether bb says the agent on a thread WORKS. The rule is the bb session provider's own reading
 * of a thread (oats-package/capabilities/oats-bb/lib/threads.mjs `inspectAnswer`), so that OATS
 * and the plugin say one thing, with two differences named below. bb's statuses
 * (@get-bb/plugin-sdk `threadStatusSchema`, 0.6.157: active, error, idle, pending, starting,
 * stopping) and its `queuedWork` (none, waiting, failed):
 * - a turn runs, is starting or is stopping ("active", "starting", "stopping"): it works;
 * - at rest ("pending", "idle", and "error": bb's last turn failed, the session is there) with a
 *   message bb will start by itself (`queuedWork: "waiting"`): it works; with nothing in line: idle;
 * - at rest with `queuedWork: "failed"`, or a queue word this plugin does not know: idle. This is
 *   the provider's rule from the release that scans its harness (oats-bb #40, b4f1eeb3: "failed"
 *   and "none" are at rest, an unknown word cannot be told); the provider before it counted
 *   "failed" as in line (three cells: pending, idle, error). "failed" may be a message bb is
 *   retrying, or stand over a waiting one: such an agent can turn Working by itself;
 * - a status this plugin does not know: idle, as bb's SDK says to treat one. The provider refuses
 *   such a thread; the plugin has to draw the row.
 */
const TURN_IN_PROGRESS: ReadonlySet<string> = new Set(["active", "starting", "stopping"]);
const AT_REST: ReadonlySet<string> = new Set(["pending", "idle", "error"]);
export const threadWorks = (thread: Pick<BbThread, "status" | "queuedWork">): boolean =>
  TURN_IN_PROGRESS.has(thread.status) || (AT_REST.has(thread.status) && thread.queuedWork === "waiting");

/**
 * The state of one agent on its thread. First match wins.
 *
 * WORKING and IDLE, for an agent on a bb thread, are bb's own status of that thread, never the
 * kernel's `running`: `running` is endpoint activity (true: a harness is loaded; false: it is
 * gone; null: the provider cannot tell), and a provider answers true for an idle agent whose
 * harness is loaded. The kernel's `running` is read for two things only: false, which with what
 * the row says of how its session ended decides whether it is stopped or failed (the next
 * paragraph); and a TMUX row's activity, where it is the kernel's own word for whether the agent works.
 * A provider's agent whose thread bb does not list (archived, deleted, hidden) is "idle": its
 * thread's status cannot be seen, and a loaded harness does not say that it works.
 * A session that ended in a shell, or that the kernel cannot reach, is told first. The one rule
 * for the sidebar's rows, the thread's row, the home and the instance panel.
 *
 * STOPPED and FAILED, for a row that does not run: `recordedStopped` (above) decides, for every
 * backend. Where the row says how its session ended, that decides beside any word: an operator's
 * stop and a lost session are stopped (a tmux agent stopped with OATS reads "shell"), a harness
 * that ended by itself ("exited") failed. Where it does not say: the word "stopped", or no word at
 * all, is stopped; "shell" failed; a tmux row that does not run is stopped. `running: false`
 * beside "unknown" is a session that is there with no harness loaded (a reboot on a host without
 * `oats host run`, or bb let the harness exit): it is not stopped, and reads as bb says of its
 * thread. Calling it stopped would advise Start, which begins a new thread and leaves its
 * conversation behind.
 *
 * "outside" comes before everything else: the kernel reports that a harness runs in a home OATS
 * recorded stopped (`outsideOats` on the row, feature `provider-outside-oats`: a message sent in
 * the provider's own product started it again). The row's other fields stay what OATS recorded
 * (stopped, not running), and they would say "Stopped" of an agent that runs: ONE statement about
 * it, "Running outside OATS", in every place.
 */
/**
 * Whether the agent NEVER RAN: bb says its thread failed at its start (`BbThread.startFailure`),
 * and the kernel does not say that it runs (`running` is not false beside a word that is not
 * "stopped": an agent started again since). The one test, for the state and for how it is at rest (model/rest.ts).
 */
export function failedAtStart(agent: Pick<Agent, "running" | "runtimeState"> & { backend?: string | null }, thread: Pick<BbThread, "startFailure"> | null | undefined): boolean {
  if (agent.backend === "tmux" || thread?.startFailure == null) return false;
  return agent.running === false || agent.runtimeState === "stopped";
}

export function state(agent: Agent, thread: BbThread | null): AgentState {
  if (agent.backend !== "tmux" && agent.outsideOats != null) return "outside";
  if (claimOf(agent) !== null || thread?.hasPendingInteraction === true) return "needs-you";
  if (agent.runtimeState === "unreachable") return "unreachable";
  // Its thread FAILED AT ITS START (bb's own events, joined on the thread: `startFailure`): it never
  // ran, whatever the row says of how its session ended (the kernel reads such a home "stopped",
  // its session "lost"). Failed, in every place. Not of a row the kernel does not call at rest.
  if (failedAtStart(agent, thread)) return "error";
  // A row that does not run and says how its session ended: that decides (`recordedStopped`): an
  // operator's stop and a lost session are stopped beside any word; a harness that ended by itself failed.
  if (recordedStopped(agent)) return "stopped";
  if (agent.running === false && agent.sessionEnd === "exited") return "error";
  if (agent.runtimeState === "stopped") return "stopped";
  if (agent.runtimeState === "shell") return "error";
  // Not running, and no word of the kernel's beside it (a tmux row whose window is gone): stopped.
  // With a word that is not "stopped" (a provider row reads `runtimeState: "unknown"`: its session
  // is there and no harness is loaded) the agent is not stopped, and a message in its thread
  // carries its conversation on: it reads as bb says of its thread, below.
  if (agent.running === false && agent.backend === "tmux") return "stopped";
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
  // An agent that runs outside OATS is listed with the ones a person must look at: after those
  // that wait, before the rest.
  outside: 1,
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
      !isListed(thread) ||
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
      .filter((thread) => !taken.has(thread.id) && isListed(thread))
      .sort((a, b) => b.updatedAt - a.updatedAt),
    detached,
    elsewhere,
    needsYou: pick((node) => node.state === "needs-you"),
    // Every agent that needs a person, whether bb has a thread for it or not: the ONE number a
    // place says of who needs one. An agent that waits on a person; and one that runs outside OATS
    // (the state "outside"), which only a person can stop or start again. The sidebar's foot, the
    // home's badge and the home's list (app/home/board.ts) count the same agents. In the kernel's order.
    needing: agents.filter((agent) => {
      const node = drawn.get(agent.instance);
      const now = node !== undefined && node.agent === agent ? node.state : state(agent, null);
      return now === "needs-you" || now === "outside";
    }),
    working: pick((node) => node.state === "working"),
    finished: pick((node) => node.state === "idle" && node.thread.isUnread),
  };
}
