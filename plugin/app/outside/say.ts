// What the plugin says when something happened to an OATS agent outside OATS: ONE pure function of
// the kernel's row and of bb's own answer for the row's thread. The sidebar's row, the thread's
// line (and the home's card) draw what it answers, so they say one thing.
//
// What it reads, and nothing else (nothing is derived from words):
// - the agent's row of `oats status --json`, as the plugin's `Agent` holds it: `running`,
//   `runtimeState`, `session.threadId`, `sessionEnd` and `outsideOats`;
// - bb's answer for that thread id: open, archived, missing (deleted), or not known yet.
// "Archived" is told from "deleted" by bb's answer alone, never by the kernel's message.
import type { Agent, OutsideOats, ThreadWhere } from "../../model/types";
import { state } from "../../model/view";
import {
  ARCHIVED_FACT,
  ARCHIVED_NOTE,
  DELETED_NOTE,
  FAILED_OPEN,
  LOST_ARCHIVED,
  LOST_ARCHIVED_NOTE,
  LOST_DELETED,
  LOST_DELETED_NOTE,
  NO_THREAD_NOTE,
  NOT_SHOWN_NOTE,
  OUTSIDE_NOTE,
  STOPPED_DELETED,
  STOPPED_OPEN,
} from "./words";

export type Act = "stop" | "start" | "restart" | "retire";

export type Kind =
  /** OATS recorded it stopped and a harness runs in it: the kernel's own report. */
  | "outside"
  /** Stopped by an operator, on a thread that is open: a message there starts it again without OATS. */
  | "stopped-open"
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

const base = { sentence: null, note: null, warning: null, acts: null, archived: false } as const;

/** The note of a row whose thread cannot be opened from the tree, by where bb says the thread is. */
function whereNote(where: ThreadWhere): string | null {
  switch (where) {
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
 * runs, one the kernel cannot reach).
 *
 * The STATE is never named here: it is the one state function's (`state`, model/view.ts), which
 * this reads with the same `where`. What this adds to a state is its sentence, the few words of its
 * row, the acts that mend it, and the kernel's report.
 *
 * `where` is bb's answer for the row's thread (`Oats.whereOf`); `attached`: whether the roster
 * draws the agent on its bb thread (a row that opens the thread). An agent it does not (its thread
 * archived, deleted, hidden or another's) always gets a `note` that says where its thread is, once
 * bb has answered.
 *
 * First match wins:
 * 1. `outsideOats` on the row: the kernel's message, whatever bb says of the thread. Stop, Start.
 * 2. the state "archived" (a session lost, the thread archived in bb): Stop, then Start.
 * 3. the state "deleted" (a session lost, no such thread in bb): Start.
 * 4. the state "error" (its session ended in a shell) on an open thread: that a message there starts it again. Restart.
 * 5. the state "stopped": by bb's answer, archived (the fact, and the way to it) or deleted, Start;
 *    on an open thread, for a stop OATS made (not a session it lost: a message then starts an
 *    agent OATS sees running), the interim warning that a message there starts it without OATS.
 */
export function said(agent: Agent, where: ThreadWhere, attached: boolean): Said | null {
  if (agent.backend === "tmux") return null;
  const note = attached ? null : whereNote(where);
  const archived = where === "archived";
  if (agent.outsideOats != null) return { ...base, kind: "outside", note: OUTSIDE_NOTE, warning: agent.outsideOats, acts: ["stop", "start"], archived };
  const threadless: Said | null = note === null ? null : { ...base, kind: "threadless", note, archived };
  // The agent's state without bb's own question on its thread (the roster says that first): what OATS and bb say of the session.
  switch (state(agent, null, where)) {
    case "archived":
      return { ...base, kind: "lost-archived", sentence: LOST_ARCHIVED, note: LOST_ARCHIVED_NOTE, acts: ["stop"], archived };
    case "deleted":
      return { ...base, kind: "lost-deleted", sentence: LOST_DELETED, note: LOST_DELETED_NOTE, acts: ["start"] };
    case "error":
      return where === "open" && attached ? { ...base, kind: "failed-open", sentence: FAILED_OPEN, acts: ["restart"] } : threadless;
    case "stopped":
      if (where === "archived") return { ...base, kind: "stopped-archived", sentence: ARCHIVED_FACT, note: ARCHIVED_NOTE, acts: ["start"], archived };
      if (where === "missing") return { ...base, kind: "stopped-deleted", sentence: STOPPED_DELETED, note: DELETED_NOTE, acts: ["start"] };
      // THE GATE (the one place): whether the bb session provider archives the thread of a home it
      // stops is `stopArchivesThread(providerVersion)` of app/lifecycle/words.ts, which is not on
      // main yet. Until it is, and for every provider version, a stop leaves the thread open, and
      // the warning is said of every stopped agent on an open thread. With it, the same sentence
      // stays for exactly this case (a home stopped before the provider archived, or a thread a
      // person unarchived): the gate then changes no word here, only what the stop's dialog says.
      if (where === "open" && attached && agent.sessionEnd !== "lost") return { ...base, kind: "stopped-open", sentence: STOPPED_OPEN };
      return threadless;
    default:
      return threadless;
  }
}
