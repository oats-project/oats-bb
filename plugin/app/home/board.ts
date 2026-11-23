// The home's board: what needs the person and what they have, grouped from the roster the sidebar
// shows. As the OATS Desktop's `homeBoard` and `homeAgents` (packages/client/home-board.mjs at
// awebai/oats 95c7b43b), over the plugin's own states: an agent's state is the one function every
// place reads (app/roster/status.ts), so the home's counts are the sidebar's by construction.
// Pure: no bb, no React.
import type { Agent, AgentState, BbThread, Node, View } from "../../model/types";
import { claimOf, flatten } from "../../model/view";
import { agentStatus, type AgentStatus } from "../roster/status";

/** One agent on the home: the kernel's row, its bb thread where it has one, and where it is. */
export type Entry = { agent: Agent; thread: BbThread | null; status: AgentStatus };

export type Board = {
  /** every agent OATS has, in the sidebar's order: the tree, then the agents whose thread is gone, then the ones on tmux */
  all: Entry[];
  /** the agents that need the person: those with a thread in bb (answered here) first; within each, newest claim first (one with no instant last), then the sidebar's order */
  needsYou: Entry[];
  /** the agents that work and do not need the person, in the sidebar's order */
  working: Entry[];
  /** idle agents whose thread holds something the person has not looked at, in the sidebar's order */
  finished: Entry[];
  /** how many agents are in each state; they add up to `all.length` */
  counts: Record<AgentState, number>;
};

/** When the claim the card shows was made: through the one gate (`claimOf`), so a claim an agent OATS stopped still carries orders nothing. */
const instant = (entry: Entry): number => {
  const since = claimOf(entry.agent)?.since ?? null;
  const at = since === null ? Number.NaN : Date.parse(since);
  return Number.isFinite(at) ? at : Number.NEGATIVE_INFINITY;
};

/** `view` is the roster as the sidebar draws it; `now` is the clock, for how long an agent has waited. */
export function board(view: Pick<View, "roots" | "detached" | "elsewhere" | "finished">, now: number): Board {
  const threaded: Entry[] = flatten(view.roots).map((node: Node) => ({ agent: node.agent, thread: node.thread, status: agentStatus(node.agent, node.thread, now) }));
  const threadless: Entry[] = [...view.detached, ...view.elsewhere].map((agent) => ({ agent, thread: null, status: agentStatus(agent, null, now) }));
  const all = [...threaded, ...threadless];
  const counts: Record<AgentState, number> = { "needs-you": 0, working: 0, idle: 0, stopped: 0, error: 0, unreachable: 0, outside: 0 };
  for (const entry of all) counts[entry.status.state] += 1;
  const order = new Map(all.map((entry, index) => [entry.agent.instance, index]));
  // Those a person can answer here (they have a thread in bb) come before those answered elsewhere;
  // within each, the newest claim first, then the sidebar's order.
  const here = (entry: Entry): number => (entry.thread === null ? 1 : 0);
  const needsYou = all
    // (An agent that runs outside OATS is among them, as in the sidebar's foot and `view.needing`: its card says why; app/outside.)
    .filter((entry) => entry.status.state === "needs-you" || entry.status.state === "outside")
    .sort((a, b) => here(a) - here(b) || instant(b) - instant(a) || (order.get(a.agent.instance) ?? 0) - (order.get(b.agent.instance) ?? 0));
  const unread = new Set(view.finished.map((node) => node.agent.instance));
  return {
    all,
    needsYou,
    working: all.filter((entry) => entry.status.state === "working"),
    finished: all.filter((entry) => unread.has(entry.agent.instance)),
    counts,
  };
}

/**
 * Whether the kernel says the agent does not run: it is stopped (`runtimeState: "stopped"`), or its
 * word on whether it runs is no (`running: false`: stopped, or its session ended). An answer or a
 * message in bb to the thread of such an agent starts its harness again behind OATS's back (a
 * stopped agent stays stopped), so the home offers and makes neither. (When the plugin has one
 * shared predicate for "the kernel calls it stopped", this is that one.)
 */
export const notRunning = (agent: Pick<Agent, "running" | "runtimeState">): boolean => agent.running === false || agent.runtimeState === "stopped";
/** Whether the home may answer a request of the agent, or send it a message, now: never while the roster shown is the last one read, and never to an agent the kernel says does not run. The card's handlers ask this, whatever drew the control that was pressed. */
export const mayAnswer = (agent: Pick<Agent, "running" | "runtimeState">, held: boolean): boolean => !held && !notRunning(agent);
