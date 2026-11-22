// The words of what happened to an agent outside OATS (plugin/WORDS.md, "Outside OATS", holds each
// with the fact it rests on). The state word comes first; then one sentence that names one remedy.

/** A stopped agent whose thread bb has archived: the fact after "Stopped". */
export const ARCHIVED_FACT = "Its conversation is archived in bb";
/** The same, as the few words a sidebar's row has room for. */
export const ARCHIVED_NOTE = "its conversation is archived in bb";
/** The link, on the agent's own page and in a notice, that opens the archived thread to read it. */
export const READ_ARCHIVED = "Read it in bb";

/** A session OATS lost because its thread was archived in bb: the word in the state's place, and the sentence. */
export const LOST_ARCHIVED_WORD = "Archived in bb";
export const LOST_ARCHIVED = "OATS lost its session, and its process still runs. Stop it, then start it from OATS.";
export const LOST_ARCHIVED_NOTE = "OATS lost its session";

/** A session OATS lost because its thread was deleted in bb. */
export const LOST_DELETED_WORD = "Deleted in bb";
export const LOST_DELETED = "Its conversation is gone. Start it from OATS for a new one.";
export const LOST_DELETED_NOTE = "its conversation is gone";

/** A stopped agent whose thread was deleted in bb afterwards (no row of the kernel's says it: bb's answer alone). */
export const STOPPED_DELETED = "Its conversation was deleted in bb. Start it from OATS for a new one.";
export const DELETED_NOTE = "its conversation was deleted in bb";

/** A failed agent (its session ended) on a thread that is open: a message there starts it again, and status then sees it. */
export const FAILED_OPEN = "Its session ended. Restart it, or send a message here.";

/** The kernel's `outsideOats` report: the notice's title and the row's few words; its sentence is the kernel's own message. */
export const OUTSIDE_TITLE = "Running outside OATS";
export const OUTSIDE_NOTE = "running outside OATS";

/** An agent on a session provider that OATS names no thread for, or whose thread bb lists but does not show. */
export const NO_THREAD_NOTE = "it has no bb thread";
export const NOT_SHOWN_NOTE = "its bb thread is not shown";
