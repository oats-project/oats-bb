// The words of what happened to an agent outside OATS (plugin/WORDS.md, "Outside OATS", holds each
// with the fact it rests on). The STATE word is one of the plugin's set (Needs you, Working, Idle,
// Stopped, Failed, Unreachable, and "Running outside OATS": app/ui/words.ts); what is here is the
// REASON after it: two or three words, on the thread's line and on the sidebar's row; a sentence
// only where a person would otherwise do harm (a message that starts an agent outside OATS, a
// process that may still run), and never the remedy: that is the button beside it.
import { agentName } from "../ui/words";

// ---- a stopped agent

/**
 * Stopped, and not with the host, its thread OPEN: bb's composer is live under it, and a message typed
 * there starts the agent again without OATS knowing (OATS keeps saying "stopped"). The interim
 * warning: it stays for as long as a stop leaves the thread open, and after that for a home stopped
 * before the provider archived at stop, and for a thread a person unarchived.
 */
export const STOPPED_OPEN = "A message here starts it outside OATS.";
/**
 * The same where the line's state is not "Stopped": bb holds a question on the thread of an agent
 * OATS stopped, so the line says "Needs you", and an answer typed there is such a message. The
 * sentence then says first what OATS recorded.
 */
export const STOPPED_OPEN_ASKING = "Stopped. An answer here starts it outside OATS.";

/**
 * Its session was LOST (`sessionEnd: "lost"`): it ended without OATS stopping it. The kernel
 * names no cause and no time of the loss (the host went down, its harness was killed, a tmux
 * window died), so the plugin guesses none, and promises nothing the kernel may not do (nothing
 * brings a lost session back by itself on a host that does not run `oats host run`). ONE reason
 * word, for an agent on bb and on tmux, on the row, on the thread's line and on the agent's page:
 * the reason alone, and no sentence (the text audit of 23 Nov 2026, T14). What a person does next
 * is said where they do it: the Start dialog's first line (a message carries a bb agent on) and
 * its one consequence line (a lost tmux agent: "Tries to continue its last conversation; else
 * starts fresh."). No warning: nobody did anything wrong.
 */
export const LOST_NOTE = "session lost";

/** Stopped (its session not lost), and bb has its thread archived (what a stop leaves once the provider archives at stop): the fact, and the row opens the conversation to read. */
/** The reason, on a row and on a line, for every agent whose thread bb has archived (what Start does is the Start dialog's one line). */
export const ARCHIVED_NOTE = "archived in bb";
export const ARCHIVED_FACT = ARCHIVED_NOTE;

/** OATS lost its session, and bb has the thread archived: bb's Archive never ends the harness. */
export const LOST_ARCHIVED = "Archived in bb while running: it may still run.";

/** bb has no thread of its id (deleted in bb), whether OATS stopped it or lost its session: bb's Delete ends the harness. */
/** The reason, on a row and on its page, for every agent whose thread bb no longer has (Start is the button). */
export const DELETED_NOTE = "deleted in bb";
export const DELETED = DELETED_NOTE;

// ---- an agent that is not stopped

/**
 * Its session is there and no harness is loaded (a reboot on a host without `oats host run`, or bb
 * let the harness exit): an idle agent. A message in its thread carries the conversation on, and
 * OATS reads it running at its next read; Start would begin a NEW thread, and its dialog says so
 * first. No warning.
 */
export const NOT_LOADED_NOTE = "not loaded";
export const NOT_LOADED = NOT_LOADED_NOTE;

/** A failed agent (its session ended) on a thread that is open: the reason alone, as on every failed agent's line (Restart is the line's button). */
export const FAILED_OPEN = "session ended";

// ---- the kernel's report: "Running outside OATS" is its state (app/ui/words.ts)

/** The fact after the state on its line: what OATS recorded, which is no longer what the agent does. */
export const OUTSIDE_RECORDED = "recorded stopped";
export const OUTSIDE_WHAT = "Someone sent it a message in bb. Stop it, or start it from OATS so that OATS tracks it again.";
/** The same, of an agent the lifecycle offers no Start for here (its session provider is neither bb nor tmux; the report is never a tmux agent's): the one remedy this plugin has is Stop. */
export const OUTSIDE_WHAT_STOP = "Someone sent it a message. Stop it, so that it is stopped as OATS recorded it.";

// ---- a row the tree draws on no thread, in any other state: where its thread is

export const NO_THREAD_NOTE = "no bb thread";
export const NOT_SHOWN_NOTE = "thread not shown in bb";
