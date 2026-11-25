// The words of what happened to an agent outside OATS (plugin/WORDS.md, "Outside OATS", holds each
// with the fact it rests on). The STATE word is one of the plugin's set (Needs you, Working, Idle,
// Stopped, Failed, Unreachable, and "Running outside OATS": app/ui/words.ts); what is here is the
// REASON after it: two or three words, on the thread's line and on the sidebar's row; a sentence
// only where a person would otherwise do harm (a message that starts an agent outside OATS, a
// process that may still run), and never the remedy: that is the button beside it.

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

/**
 * The reason, on a row and on a line, for every agent whose thread bb has archived (what Start does is the Start
 * dialog's one line). Of an agent that is stopped with its session not lost it is the fact alone (what a stop leaves
 * once the provider archives at stop), and its row opens the conversation to read.
 */
export const ARCHIVED_NOTE = "archived in bb";

/** OATS lost its session, and bb has the thread archived: bb's Archive never ends the harness. */
export const LOST_ARCHIVED = "Archived in bb while running: it may still run.";
/**
 * The same on a ROW, in the reason's place and in the warning tone: what a person must not miss
 * is that its process may run, not where its thread is. A row whose state reads "Stopped" (the
 * kernel's row: not running, its session lost) then says both halves, "Stopped · may still run";
 * the line and the row's own title say the whole ("Archived in bb while running: it may still
 * run."). The state word is unchanged. (The lead's ruling on the read of 24 Nov 2026, T8.)
 */
export const MAY_RUN_NOTE = "may still run";

/**
 * The reason, on a row and on its page, for every agent whose thread bb no longer has (deleted in bb), whether OATS
 * stopped it or lost its session: bb's Delete ends the harness. Start is the button.
 */
export const DELETED_NOTE = "deleted in bb";

// ---- an agent that is not stopped

/**
 * Its session is there and no harness is loaded (a reboot on a host without `oats host run`, or bb
 * let the harness exit): an idle agent. A message in its thread carries the conversation on, and
 * OATS reads it running at its next read; Start would begin a NEW thread, and its dialog says so
 * first. No warning.
 */
export const NOT_LOADED_NOTE = "not loaded";

// ---- where a message is the way on

/**
 * After the reason, on the line of an agent's own listed thread where a MESSAGE is the designed
 * way on (model/rest.ts `messageResumes`), for a LOST session and for NO HARNESS LOADED:
 * "Stopped · session lost · message to continue", "Idle · not loaded · message to continue". It
 * stands in the place of the act that would mislead: such a line has no Start…, which begins a
 * NEW conversation and whose dialog would say first to message instead; Start… stays in the
 * thread's menu, the panel and the agent's page. (The lead's ruling on the read of 24 Nov 2026,
 * T5, and its condition: said only where the kernel's or the provider's fact shows that a message
 * carries the agent on under OATS. So not of a failed agent, whose line keeps its act; an
 * operator's stop keeps its warning and Start…; and on a thread in "error" the words wait for
 * bb's answer that a turn started there.)
 */
export const MESSAGE_CONTINUES = "message to continue";

// ---- the kernel's report: "Running outside OATS" is its state (app/ui/words.ts)

/**
 * The fact after the state on its line, in a person's words: the agent is stopped in OATS, which
 * is no longer what it does ("Running outside OATS · stopped in OATS"). (The kernel's phrase was
 * "recorded stopped": the lead's ruling on the read of 24 Nov 2026, T7.)
 */
export const OUTSIDE_RECORDED = "stopped in OATS";
/**
 * What it needs, on the home's card under those words: the TWO steps, in three words. Stop alone
 * does not bring it back running: it ends the harness that runs and archives its thread, and the
 * agent is then what OATS has it, stopped (no message can reach an archived thread); Start…, a
 * new conversation, is then the way on under OATS. Start… first does not do: it does not adopt
 * what runs, and while the outside thread is in a turn the provider refuses it ("stop it before
 * starting again"). So Stop… is the primary act and Start… the second. (The lead's ruling of 24
 * Nov 2026 on T7's form: not "Stop it to bring it back.", which reads as a contradiction.)
 */
export const OUTSIDE_NEEDS = "Stop, then Start.";
/** The label of the time OATS recorded the stop, on the page of an agent that runs outside OATS: what its line says ("stopped in OATS"), never "Stopped" alone beside a header that says it runs. */
export const OUTSIDE_STOPPED_FACT = "Stopped in OATS";
export const OUTSIDE_WHAT = `Someone sent it a message in bb. ${OUTSIDE_NEEDS}`;
/** The same, of an agent the lifecycle offers no Start for here (its session provider is neither bb nor tmux; the report is never a tmux agent's): the one remedy this plugin has is Stop. */
export const OUTSIDE_WHAT_STOP = "Someone sent it a message. Stop it, so that it is stopped as OATS recorded it.";

// ---- a row the tree draws on no thread, in any other state: where its thread is

export const NO_THREAD_NOTE = "no bb thread";
export const NOT_SHOWN_NOTE = "thread not shown in bb";
