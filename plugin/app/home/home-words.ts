// The home in a person's words: the OATS Desktop's (packages/desktop/renderer/views/home.mjs and
// packages/client/home-board.mjs at awebai/oats 95c7b43b), and the plugin's own where bb's nature
// changes one (plugin/WORDS.md holds each pair). No bb and no React import.
import type { AgentState } from "../../model/types";
import { STATE } from "../ui/words";

export const NEEDS_YOU = "Needs you";
export const NOTHING_NEEDS_YOU = "Nothing needs you.";
export const WORKING = "Working";
export const FINISHED = "Unread";
/** Home › Agents: every agent OATS has, under this word (no tile opens it: it is reached by its address). */
export const EVERY_AGENT = "Agents";
export const BACK_TO_HOME = "Home";
export const READING = "Reading…";
/** How many needs-you cards show before "Show all N", and how many working agents before theirs. */
export const NEEDS_YOU_SHOWN = 8;
export const WORKING_SHOWN = 5;
export const showAll = (n: number): string => `Show all ${n}`;
export const SHOW_FEWER = "Show fewer";

/** The states the summary names, in its order; the first two always, the others only when they have agents. */
const SUMMARY: readonly Exclude<AgentState, "outside">[] = ["working", "needs-you", "idle", "stopped", "error", "unreachable"];
const ALWAYS: ReadonlySet<AgentState> = new Set<AgentState>(["working", "needs-you"]);
/** A state as the count line counts it: "2 working"; "3 need you", whatever the number (the Desktop's line). */
function counted(state: AgentState, n: number): string {
  if (state === "needs-you") return `${n} need you`;
  return `${n} ${STATE[state].word.toLowerCase()}`;
}
/** "2 working · 1 need you · 3 idle · 1 stopped · 1 failed": every agent is counted once. How many there are in all is the heading's count, over the line. */
export function summaryLine(counts: Record<AgentState, number>): string {
  // "N need you" is the home's heading and its badge too: an agent that runs outside OATS is one of them
  // (`view.needing`), so it is counted there and has no count of its own. Every agent is still counted once.
  const of = (state: Exclude<AgentState, "outside">): number => (state === "needs-you" ? counts["needs-you"] + counts.outside : counts[state]);
  return SUMMARY.filter((state) => ALWAYS.has(state) || of(state) > 0).map((state) => counted(state, of(state))).join(" · ");
}

/** A tile's count as it reads: the number, "Counting…" while it is read, "Couldn't count" when that failed. */
export const tileCount = (n: number | "loading" | "failed"): string => (n === "loading" ? "Counting…" : n === "failed" ? "Couldn't count" : String(n));

/** The empty workspace: New agent is the primary button over it. */
export const FIRST_RUN = "No agents yet.";

// ---- answering from a card
export const replyLabel = (name: string): string => `Reply to ${name}`;
export const replyPlaceholder = (name: string): string => `Write to ${name}…`;
export const SEND = "Send";
export const SENDING = "Sending…";
export const SENT = "Sent.";
export const NOT_SENT = "The message was not sent";
export const NOT_ANSWERED = "The answer was not sent";
// ---- what a card offers, by what its agent asks
/** The card's button: the agent's thread, or, for an agent with none, its own page. Its accessible name says which. */
export const OPEN = "Open";
export const OPEN_THREAD = "Open thread";
export const OPEN_PAGE = "Open its page";
/** A choice was pressed and bb took it. */
export const answeredWith = (label: string): string => `Answered: ${label}.`;
/**
 * The request is answered in the agent's thread (Open is the card's button): bb shows it there in a
 * form the card cannot draw, or the kernel says it waits for a tool approval and bb lists no
 * request to answer here.
 */
/** A card whose request can only be answered in its thread: its button, in the place of "Open" (the same press: it opens the thread). */
export const ANSWER = "Answer";
/** The same button's accessible name, before the agent's name. */
export const ANSWER_IN_THREAD = "Answer in its thread";
/** An agent that needs the person and that the kernel says does not run: an answer or a message to its thread would start it outside OATS, so the card offers neither, and Start. */
export const STOPPED_WAITS = "Not running. Start it to answer.";
/** A press on an agent that OATS stopped since its card was drawn: nothing went to bb. */
export const NOT_NOW_STOPPED = "OATS has stopped this agent since: nothing was sent. Start it to answer.";
/** The same press, on an agent the kernel cannot reach now. */
export const NOT_NOW_UNREACHABLE = "Unreachable now. Nothing was sent.";
/** The card of an agent the kernel cannot reach, in the place of its answer: nobody can tell where an answer or a message would go. No Start: the lifecycle offers none for it. */
export const UNREACHABLE_WAITS = "Nothing is sent from here.";
/** Before it, where the card does not already draw the state's word "Unreachable" (a card under "Needs you" draws the mark alone): never the word twice on one card. */
export const UNREACHABLE = "Unreachable.";
/** A press on an agent the roster no longer names (it was retired, or the deployment changed): nothing went to bb. */
export const NOT_NOW_GONE = "OATS no longer lists this agent: nothing was sent.";
/** A press while the plugin's server holds no roster that reads: nothing went to bb. */
export const NOT_NOW_UNREAD = "OATS cannot be read now, so nothing was sent: whether this agent still runs is not known.";
export const MESSAGE_INSTEAD = "Message instead";
/** What a message does not do, beside a request that has an answer of its own. */
export const MESSAGE_NOT_ANSWER = "A message does not answer its request: it grants nothing, and the request stays open.";
/** An agent on tmux: bb cannot write to it. The command that reaches its terminal is on its page, where Open leads. */
export const TMUX_ANSWER = "Answer it in its terminal.";

// ---- the installed `oats` against what the plugin is built for (kernel/compat.ts)
// As the OATS Desktop's CLI card and its one line (packages/desktop/renderer/views/cli-status.mjs,
// packages/client/above-tested-notice.mjs), said of the plugin.
export const CLI_REQUIRED = "Compatible oats CLI required";
export const CLI_NEWER_API = "This plugin is older than the installed oats CLI";
/** The installed CLI speaks a later version of its answers than the plugin reads: what to do is to update the plugin, never to install an older CLI. */
export const NEWER_API_WHY = "Update the OATS plugin.";
/** Asks the server to read `oats version` again (after an install), as the Desktop's Retry on its card. */
export const CHECK_AGAIN = "Check again";
export const CHECKING = "Checking…";
/** A check that could not be made; what the read said follows it. */
export const CHECK_FAILED = "Check failed:";
export const DETECTED = "Detected";
export const REQUIRED = "Required";
export const detected = (version: string | null): string => version ?? "unknown";
export const required = (floor: string): string => `${floor} or newer`;
/** The command that installs the newest release of the minor the plugin was tested with. */
export const installCommand = (testedMinor: string): string => `npm install -g @awebai/oats@${testedMinor}`;
