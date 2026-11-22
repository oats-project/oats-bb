// What the plugin says when something happened to an OATS agent outside OATS: ONE pure function of
// the kernel's row and of bb's own answer for the row's thread. The sidebar's row, the thread's
// line and the home's card draw what it answers, so they say one thing.
//
// What it reads, and nothing else (nothing is derived from words):
// - the agent's row of `oats status --json`: `running`, `runtimeState`, `session.threadId` (the
//   plugin's `Agent`), and from the raw row `sessionEnd` and `outsideOats` (kernel/outside.ts);
// - bb's answer for that thread id: open, archived, missing (deleted), or not known yet.
// "Archived" is told from "deleted" by bb's answer alone, never by the kernel's message.
import type { OutsideOats } from "../../kernel/outside";
import type { Agent, AgentState } from "../../model/types";
import {
  ARCHIVED_FACT,
  ARCHIVED_NOTE,
  DELETED_NOTE,
  FAILED_OPEN,
  LOST_ARCHIVED,
  LOST_ARCHIVED_NOTE,
  LOST_ARCHIVED_WORD,
  LOST_DELETED,
  LOST_DELETED_NOTE,
  LOST_DELETED_WORD,
  NO_THREAD_NOTE,
  NOT_SHOWN_NOTE,
  OUTSIDE_NOTE,
  STOPPED_DELETED,
} from "./words";

/**
 * What bb says of the thread a row names:
 * - `open`: bb lists it and it is not archived (it may be hidden, or drawn by another row);
 * - `archived`: bb has it, with `archivedAt` set;
 * - `missing`: bb has no thread of that id (deleted);
 * - `none`: the row names no thread;
 * - `unknown`: bb has not answered yet, or could not.
 */
export type ThreadFact = "open" | "archived" | "missing" | "none" | "unknown";

/** The two facts of the raw row; null where they were not read (an older server answer, a failed read). */
export type RowFacts = { sessionEnd: string | null; outsideOats: OutsideOats | null };

export type Act = "stop" | "start" | "restart";

export type Kind =
  /** OATS recorded it stopped and a harness runs in it: the kernel's own report. */
  | "outside"
  /** Stopped, and bb has its thread archived: what a stop leaves once the provider archives at stop. */
  | "stopped-archived"
  /** Stopped, and its thread was deleted in bb. */
  | "stopped-deleted"
  /** OATS lost the session and bb has the thread archived: its process still runs. */
  | "lost-archived"
  /** OATS lost the session and bb has no such thread: bb ended the process with it. */
  | "lost-deleted"
  /** Its session ended and its thread is open. */
  | "failed-open"
  /** Not a state of its own: only where its thread is (a row with no thread to open). */
  | "threadless";

export type Said = {
  kind: Kind;
  /** The word in the state's place and its mark, where this replaces the roster's own ("Archived in bb"); null: the state OATS recorded, as the roster says it. */
  state: { mark: AgentState; word: string } | null;
  /** The sentence after the state word on the thread's line; null: the roster's own. */
  sentence: string | null;
  /** The few words after the soul on the sidebar's row; null: none. */
  note: string | null;
  /** The kernel's report, said loudly (the warning tone) under the line; null: none. */
  warning: OutsideOats | null;
  /** The acts offered, in order, through OATS; null: the roster's own for the state. */
  acts: readonly Act[] | null;
  /** Whether bb still has the conversation, archived, to read. */
  archived: boolean;
};

const base = { state: null, sentence: null, note: null, warning: null, acts: null, archived: false } as const;

/** The note of a row whose thread cannot be opened from the tree, by where bb says the thread is. */
function whereNote(thread: ThreadFact): string | null {
  switch (thread) {
    case "archived":
      return ARCHIVED_NOTE;
    case "missing":
      return DELETED_NOTE;
    case "none":
      return NO_THREAD_NOTE;
    case "open":
      return NOT_SHOWN_NOTE;
    default:
      return null;
  }
}

/**
 * What to say of one agent, or null where the roster's own words stand (an agent on tmux, one that
 * runs, one the kernel cannot reach, a stopped one on an open thread: the roster's own line).
 *
 * `attached`: whether the roster draws the agent on its bb thread (a row that opens the thread).
 * An agent it does not (its thread archived, deleted, hidden or another's) always gets a `note`
 * that says where its thread is, once bb has answered.
 *
 * First match wins:
 * 1. `outsideOats` on the row: the kernel's message, whatever bb says of the thread. Stop, Start.
 * 2. the kernel cannot reach it: nothing (status says it, with its reason).
 * 3. its session ended in a shell: on an open thread, that a message there starts it again. Restart.
 * 4. recorded stopped with `sessionEnd: "lost"`: by bb's answer, archived (Stop, then Start) or deleted (Start).
 * 5. recorded stopped otherwise: by bb's answer, archived (the fact, and the way to it) or deleted. Start.
 */
export function said(agent: Agent, thread: ThreadFact, facts: RowFacts | null, attached: boolean): Said | null {
  if (agent.backend === "tmux") return null;
  const note = attached ? null : whereNote(thread);
  const archived = thread === "archived";
  if (facts?.outsideOats != null) return { ...base, kind: "outside", note: OUTSIDE_NOTE, warning: facts.outsideOats, acts: ["stop", "start"], archived };
  const where: Said | null = note === null ? null : { ...base, kind: "threadless", note, archived };
  if (agent.runtimeState === "unreachable") return where;
  if (agent.runtimeState === "shell") return thread === "open" && attached ? { ...base, kind: "failed-open", sentence: FAILED_OPEN, acts: ["restart"] } : where;
  const stopped = agent.runtimeState === "stopped" || (agent.runtimeState === null && agent.running === false);
  if (!stopped) return where;
  if (facts?.sessionEnd === "lost") {
    if (thread === "archived") return { ...base, kind: "lost-archived", state: { mark: "error", word: LOST_ARCHIVED_WORD }, sentence: LOST_ARCHIVED, note: LOST_ARCHIVED_NOTE, acts: ["stop"], archived };
    if (thread === "missing") return { ...base, kind: "lost-deleted", state: { mark: "error", word: LOST_DELETED_WORD }, sentence: LOST_DELETED, note: LOST_DELETED_NOTE, acts: ["start"] };
    return where;
  }
  if (thread === "archived") return { ...base, kind: "stopped-archived", sentence: ARCHIVED_FACT, note: ARCHIVED_NOTE, acts: ["start"], archived };
  if (thread === "missing") return { ...base, kind: "stopped-deleted", sentence: STOPPED_DELETED, note: DELETED_NOTE, acts: ["start"] };
  return where;
}
