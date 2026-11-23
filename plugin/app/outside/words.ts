// The words of what happened to an agent outside OATS (plugin/WORDS.md, "Outside OATS", holds each
// with the fact it rests on). The STATE word is one of the plugin's set (Needs you, Working, Idle,
// Stopped, Failed, Unreachable, and "Running outside OATS": app/ui/words.ts); what is here is the
// REASON after it: one sentence on the thread's line, with one remedy, and a few words on the
// sidebar's row, where the reason takes the soul's place.
import { agentName } from "../ui/words";

// ---- a stopped agent

/**
 * Stopped, and not with the host, its thread OPEN: bb's composer is live under it, and a message typed
 * there starts the agent again without OATS knowing (OATS keeps saying "stopped"). The interim
 * warning: it stays for as long as a stop leaves the thread open, and after that for a home stopped
 * before the provider archived at stop, and for a thread a person unarchived.
 */
export const STOPPED_OPEN = "A message sent here in bb starts it again without OATS. Use Start.";
/**
 * The same where the line's state is not "Stopped": bb holds a question on the thread of an agent
 * OATS stopped, so the line says "Needs you", and an answer typed there is such a message. The
 * sentence then says first what OATS recorded.
 */
export const STOPPED_OPEN_ASKING = `OATS recorded it stopped. ${STOPPED_OPEN}`;

/**
 * Its session was LOST (`sessionEnd: "lost"`): it ended without OATS stopping it. The kernel
 * names no cause and no time of the loss (the host went down, its harness was killed, a tmux
 * window died), so the plugin guesses none, and promises nothing the kernel may not do (nothing
 * brings a lost session back by itself on a host that does not run `oats host run`). ONE reason
 * word on the row, for an agent on bb and on tmux; two sentences, because what a person does
 * differs. No warning: nobody did anything wrong.
 */
export const LOST_NOTE = "session lost";
/** On bb, its thread open: a message there is how it comes back (the Start dialog says the same first). */
export const LOST_OPEN = "Its session ended without OATS stopping it. Nobody stopped it. To carry on, send it a message here. Start begins a new conversation.";
/** On tmux: bb cannot write to it. What is so, in every case. */
export const LOST_TMUX = "Its session ended without OATS stopping it. Nobody stopped it.";
/** After it, ONLY where the lifecycle offers Start for that agent (`actsFor`): "Start" is never named with nothing to press. Start resumes a lost tmux session; its dialog says what happened after. */
export const LOST_TMUX_START = "Start tries to continue its last conversation.";
/** After it, where the row has the time of its last start: the start whose session was lost. Never "lost since": the kernel records no time of the loss. */
export const lastStarted = (when: string): string => `Last started ${when}`;

/** Stopped (its session not lost), and bb has its thread archived (what a stop leaves once the provider archives at stop): the fact, and the row opens the conversation to read. */
export const ARCHIVED_FACT = "Its conversation is archived in bb. Start begins a new one.";
/** The reason on a row, for every agent whose thread bb has archived. */
export const ARCHIVED_NOTE = "archived in bb";

/** OATS lost its session, and bb has the thread archived: bb's Archive never ends the harness. */
export const LOST_ARCHIVED = "Its conversation was archived in bb while it ran, and its process may still run. Stop it, then start it from OATS.";

/** bb has no thread of its id (deleted in bb), whether OATS stopped it or lost its session: bb's Delete ends the harness. */
export const DELETED = "Its conversation was deleted in bb. Start it from OATS for a new one.";
/** The reason on a row, for every agent whose thread bb no longer has. */
export const DELETED_NOTE = "deleted in bb";

// ---- an agent that is not stopped

/**
 * Its session is there and no harness is loaded (a reboot on a host without `oats host run`, or bb
 * let the harness exit): an idle agent. A message in its thread carries the conversation on, and
 * OATS reads it running at its next read; Start would begin a NEW thread. No warning.
 */
export const NOT_LOADED = "not loaded. To carry on, send it a message here. Start begins a new conversation.";
export const NOT_LOADED_NOTE = "not loaded";

/** A failed agent (its session ended) on a thread that is open: a message there starts it again, and status then sees it. */
export const FAILED_OPEN = "Its session ended. Restart it, or send a message here.";

// ---- the kernel's report: "Running outside OATS" is its state (app/ui/words.ts)

/** The fact after the state on its line: what OATS recorded, which is no longer what the agent does. */
export const OUTSIDE_RECORDED = "recorded stopped";
/** The notice, in a person's words: what is so, what happened, what to do. The kernel's own sentence and its code are behind Details. */
export const outsideTitle = (instance: string, onBb = true): string => `${agentName(instance)} is running${onBb ? " in bb" : ""}, but OATS recorded it as stopped.`; // ("in bb" of an agent on bb only: the report's backend is the row's)
export const OUTSIDE_WHAT = "Someone sent it a message in bb. Stop it, or start it from OATS so that OATS tracks it again.";
/** The same, of an agent the lifecycle offers no Start for here (its session provider is not bb): the one remedy this plugin has is Stop. */
export const OUTSIDE_WHAT_STOP = "Someone sent it a message. Stop it, so that it is stopped as OATS recorded it.";
/** What each of the notice's two acts does here. */
export const OUTSIDE_STOP = "stops the harness that runs outside OATS";
export const OUTSIDE_START = "starts it from OATS, in a new conversation";

// ---- a row the tree draws on no thread, in any other state: where its thread is

export const NO_THREAD_NOTE = "no bb thread";
export const NOT_SHOWN_NOTE = "thread not shown in bb";
