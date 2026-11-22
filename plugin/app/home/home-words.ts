// The home in a person's words: the OATS Desktop's (packages/desktop/renderer/views/home.mjs and
// packages/client/home-board.mjs at awebai/oats 95c7b43b), and the plugin's own where bb's nature
// changes one (plugin/WORDS.md holds each pair). No bb and no React import.
import type { Agent, AgentState } from "../../model/types";
import { count } from "../format";
import { shown } from "../ui/text";
import { STATE, instanceDisplayName } from "../ui/words";

export const HOME = "Home";
export const NEEDS_YOU = "Needs you";
export const NOTHING_NEEDS_YOU = "Nothing needs you.";
export const WORKING = "Working";
export const FINISHED = "Finished, not looked at";
export const EVERY_AGENT = "Every agent";
export const BACK_TO_HOME = "Back to Home";
export const READING = "Reading your agents…";
/** How many needs-you cards show before "Show all N", and how many working agents before "Show all N working". */
export const NEEDS_YOU_SHOWN = 8;
export const WORKING_SHOWN = 5;
export const showAll = (n: number): string => `Show all ${n}`;
export const showAllWorking = (n: number): string => `Show all ${n} working`;
export const SHOW_FEWER = "Show fewer";

/** The states the summary names, in its order; the first two always, the others only when they have agents. */
const SUMMARY: readonly AgentState[] = ["working", "needs-you", "idle", "stopped", "error", "unreachable"];
const ALWAYS: ReadonlySet<AgentState> = new Set<AgentState>(["working", "needs-you"]);
/** A state as the summary counts it: "2 working", "1 needs you" / "3 need you". */
function counted(state: AgentState, n: number): string {
  if (state === "needs-you") return `${n} ${n === 1 ? "needs you" : "need you"}`;
  return `${n} ${STATE[state].word.toLowerCase()}`;
}
/** "8 agents · 2 working · 1 needs you · 3 idle · 1 stopped · 1 failed": every agent is counted once. */
export function summaryLine(counts: Record<AgentState, number>): string {
  const agents = Object.values(counts).reduce((sum, n) => sum + n, 0);
  return [count(agents, "agent"), ...SUMMARY.filter((state) => ALWAYS.has(state) || counts[state] > 0).map((state) => counted(state, counts[state]))].join(" · ");
}

/** A tile's count as it reads: the number, "Counting…" while it is read, "Couldn't count" when that failed. */
export const tileCount = (n: number | "loading" | "failed"): string => (n === "loading" ? "Counting…" : n === "failed" ? "Couldn't count" : String(n));

/** An agent's second line: "<soul> · <machine>". */
export const soulAndMachine = (soul: string, machine: string): string => `${shown(soul)} · ${shown(machine)}`;
/** Who started it: the person OATS attributes it to, else its parent by its name as words; null when the kernel names neither. */
export function startedBy(agent: Pick<Agent, "human" | "parent">): string | null {
  if (agent.human !== null) return `started by ${shown(agent.human)}`;
  return agent.parent === null ? null : `started by ${instanceDisplayName(shown(agent.parent))}`;
}

/** The empty workspace: what OATS does, in two lines. */
export const FIRST_RUN = ["OATS runs your agents: each one is a soul at work on a machine of yours.", "Start one, and Home shows what needs you and what you have."] as const;

// ---- answering from a card
export const replyLabel = (name: string): string => `Reply to ${name}`;
export const replyPlaceholder = (name: string): string => `Write to ${name}…`;
export const SEND = "Send";
export const SENDING = "Sending…";
export const sentTo = (name: string): string => `Sent to ${name}.`;
export const NOT_SENT = "The message was not sent";
export const NOT_ANSWERED = "The answer was not sent";
/** Why a card's acts are off while the roster shown is not a current one (the standard: acts are held on stale data). */
export const HELD = "Held until OATS is read again: what is shown may have changed.";
/** An agent with no bb thread: nothing can be sent to it from bb. */
export const tmuxNote = (where: string): string => `${where}: answer it in its terminal.`;
