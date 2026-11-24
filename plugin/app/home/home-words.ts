// The home in a person's words: the OATS Desktop's (packages/desktop/renderer/views/home.mjs and
// packages/client/home-board.mjs at awebai/oats 95c7b43b), and the plugin's own where bb's nature
// changes one (plugin/WORDS.md holds each pair). No bb and no React import.
import type { Agent, AgentState } from "../../model/types";
import { count } from "../format";
import { shown } from "../ui/text";
import { STATE, agentName } from "../ui/words";

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
const SUMMARY: readonly Exclude<AgentState, "outside">[] = ["working", "needs-you", "idle", "stopped", "error", "unreachable"];
const ALWAYS: ReadonlySet<AgentState> = new Set<AgentState>(["working", "needs-you"]);
/** A state as the summary counts it: "2 working"; "3 need you" as the sidebar's foot says it, whatever the number (the Desktop's line). */
function counted(state: AgentState, n: number): string {
  if (state === "needs-you") return `${n} need you`;
  return `${n} ${STATE[state].word.toLowerCase()}`;
}
/** "8 agents · 2 working · 1 need you · 3 idle · 1 stopped · 1 failed": every agent is counted once. */
export function summaryLine(counts: Record<AgentState, number>): string {
  const agents = Object.values(counts).reduce((sum, n) => sum + n, 0);
  // "N need you" is the sidebar's foot and the home's heading: an agent that runs outside OATS is one of them
  // (`view.needing`), so it is counted there and has no count of its own. Every agent is still counted once.
  const of = (state: Exclude<AgentState, "outside">): number => (state === "needs-you" ? counts["needs-you"] + counts.outside : counts[state]);
  return [count(agents, "agent"), ...SUMMARY.filter((state) => ALWAYS.has(state) || of(state) > 0).map((state) => counted(state, of(state)))].join(" · ");
}

/** A tile's count as it reads: the number, "Counting…" while it is read, "Couldn't count" when that failed. */
export const tileCount = (n: number | "loading" | "failed"): string => (n === "loading" ? "Counting…" : n === "failed" ? "Couldn't count" : String(n));

/** An agent's second line: "<soul> · <machine>". */
export const soulAndMachine = (soul: string, machine: string): string => `${shown(soul)} · ${shown(machine)}`;
/** Who started it: the person OATS attributes it to, else its parent by its name as words; null when the kernel names neither. */
export function startedBy(agent: Pick<Agent, "human" | "parent">): string | null {
  if (agent.human !== null) return `started by ${shown(agent.human)}`;
  return agent.parent === null ? null : `started by ${agentName(agent.parent)}`;
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
// ---- what a card offers, by what its agent asks
export const OPEN_THREAD = "Open thread";
export const OPEN_PAGE = "Open its page";
/** A choice was pressed and bb took it. */
export const answeredWith = (label: string): string => `Answered: ${label}. Waiting for the agent to go on.`;
/** bb shows the request in the thread, in a form the card cannot draw. */
export const IN_THREAD = "bb shows its request in its thread: open the thread to answer it.";
/** The kernel says it waits for a tool approval, and bb lists no request to answer (the claim is older than bb's request, or already answered there). */
export const PERMISSION_IN_THREAD = "It waits for an approval, and bb lists no request to answer here: open its thread to see what it waits for.";
/** An agent that needs the person and that the kernel says does not run: an answer or a message to its thread would start it outside OATS. */
export const STOPPED_WAITS = "This agent is not running, and its request waits for it: an answer or a message would start it outside OATS. Start it to answer.";
/** A press on an agent that OATS stopped since its card was drawn: nothing went to bb. */
export const NOT_NOW_STOPPED = "OATS has stopped this agent since: nothing was sent. Start it to answer.";
/** The same press, on an agent the kernel cannot reach now. */
export const NOT_NOW_UNREACHABLE = "OATS cannot reach this agent's session now: nothing was sent.";
/** The card of an agent the kernel cannot reach, in the place of its answer: nobody can tell where an answer or a message would go. No Start: the lifecycle offers none for it. */
export const UNREACHABLE_WAITS = "OATS cannot reach this agent's session, so nothing is sent to it from here. Open its thread to see it.";
/** A press on an agent the roster no longer names (it was retired, or the deployment changed): nothing went to bb. */
export const NOT_NOW_GONE = "OATS no longer lists this agent: nothing was sent.";
/** A press while the plugin's server holds no roster that reads: nothing went to bb. */
export const NOT_NOW_UNREAD = "OATS cannot be read now, so nothing was sent: whether this agent still runs is not known.";
export const MESSAGE_INSTEAD = "Write a message instead";
/** What a message does not do, beside a request that has an answer of its own. */
export const MESSAGE_NOT_ANSWER = "A message does not answer its request: it grants nothing, and the request stays open.";
/** An agent on tmux: where its terminal is. */
export const tmuxWhere = (machine: string): string => `It runs in tmux on ${machine}, where bb cannot write to it. Answer it in its terminal there:`;
export const THREAD_GONE = "Its bb thread is gone, so nothing can be sent to it from here.";
/** The same card, for an agent whose thread bb still has and does not list (archived, hidden), or that names none: said only as far as bb's answer goes. */
export const THREAD_NOT_LISTED = "bb lists no thread of it to write in, so nothing can be sent to it from here.";
/** Where Open leads for an agent with no thread. */
export const PAGE_LEADS = "Open its page shows who it is and how it runs.";

// ---- the installed `oats` against what the plugin is built for (kernel/compat.ts)
// As the OATS Desktop's CLI card and its one line (packages/desktop/renderer/views/cli-status.mjs,
// packages/client/above-tested-notice.mjs), said of the plugin.
export const CLI_REQUIRED = "Compatible oats CLI required";
export const CLI_REQUIRED_WHY = "Everything the plugin shows and does runs through the installed oats CLI.";
export const CLI_NEWER_API = "This plugin is older than the installed oats CLI";
/** The installed CLI speaks a later version of its answers than the plugin reads: what to do is to update the plugin, never to install an older CLI. */
export const newerApiWhy = (version: string | null, api: number | null, reads: number): string =>
  `The installed oats CLI${version === null ? "" : ` is ${version}, which`} speaks a newer desktop API${api === null ? "" : ` (${api})`} than this plugin's (${reads}). Update the OATS plugin to use it.`;
/** The one line for a CLI of a later minor than the plugin was tested with: nothing is turned off. */
export const testedWhy = (testedThrough: string, version: string): string => `This plugin was tested with oats CLIs up to ${testedThrough}; the installed CLI is ${version}.`;
/** Asks the server to read `oats version` again (after an install), as the Desktop's Retry on its card. */
export const CHECK_AGAIN = "Check again";
export const CHECKING = "Checking…";
/** A check that could not be made; what the read said follows it. */
export const CHECK_FAILED = "The installed oats could not be checked again:";
/** No version could be read, though the roster reads. */
export const CLI_UNCHECKED = "The installed oats could not be checked.";
export const DETECTED = "Detected";
export const REQUIRED = "Required";
export const detected = (version: string | null): string => version ?? "unknown: oats answered no version the plugin can read";
export const required = (floor: string, api: number): string => `${floor} or newer, with desktop API ${api}`;
/** The command that installs the newest release of the minor the plugin was tested with. */
export const installCommand = (testedMinor: string): string => `npm install -g @awebai/oats@${testedMinor}`;
/** Why New agent is off behind the card. */
export const NEW_AGENT_HELD = "Off until a compatible oats CLI is installed.";
