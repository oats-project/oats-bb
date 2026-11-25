// What the plugin says when something happened to an OATS agent outside OATS: ONE pure function of
// the kernel's row and of bb's own answer for the row's thread. The sidebar's row, the thread's
// line and the instance panel's header draw what it answers, so they say one thing.
//
// The STATE is never named here. It is the one state function's (`state`, model/view.ts), and its
// word is one of the plugin's set (app/ui/words.ts): Needs you, Working, Idle, Stopped, Failed,
// Unreachable, and "Running outside OATS" for a row with the kernel's report. What this adds to a
// state is the REASON: the sentence after it on the thread's line, the few words that take the
// soul's place on the sidebar's row, whether it is said in the warning tone, and the acts.
//
// What it reads, and nothing else (nothing is derived from words):
// - the agent's row of `oats status --json`, as the plugin's `Agent` holds it: `running`,
//   `runtimeState`, `session.threadId`, `sessionEnd` and `outsideOats`;
// - bb's answer for that thread id (`Oats.whereOf`): open, archived, missing (deleted), or not known yet.
// "Archived" is told from "deleted" by bb's answer alone, never by the kernel's message.
import type { Agent, OutsideOats, ThreadWhere } from "../../model/types";
import { messageResumes, rest } from "../../model/rest";
import { state } from "../../model/view";
import { SESSION_ENDED } from "../roster/status";
import {
  ARCHIVED_NOTE,
  DELETED_NOTE,
  LOST_ARCHIVED,
  MAY_RUN_NOTE,
  NO_THREAD_NOTE,
  NOT_LOADED_NOTE,
  NOT_SHOWN_NOTE,
  OUTSIDE_RECORDED,
  LOST_NOTE,
  STOPPED_OPEN,
} from "./words";

export type Act = "stop" | "start" | "retire";

export type Kind =
  /** OATS recorded it stopped and a harness runs in it: the kernel's own report. Its state is "Running outside OATS". */
  | "outside"
  /** Stopped (an operator's stop, or a stop that does not say how its session ended), on a thread that is open: a message there starts it again without OATS. */
  | "stopped-open"
  /** Its session was lost, on bb, on a thread that is open: a message there carries it on. */
  | "lost-open"
  /** Its session was lost, on tmux: Start tries to continue its last conversation. */
  | "lost-tmux"
  /** Stopped (its session not lost), and bb has its thread archived: what a stop leaves once the provider archives at stop. */
  | "stopped-archived"
  /** OATS lost the session and bb has the thread archived: its process may still run. */
  | "lost-archived"
  /** The row still says it runs (it is not stopped, and the kernel does not say its harness is gone) and bb has the thread archived: a person archived the conversation of an agent whose process goes on. */
  | "running-archived"
  /** bb has no thread of its id: deleted in bb, whether OATS stopped it or lost its session. */
  | "deleted"
  /** Idle with no harness loaded, on a thread that is open: a message there carries the conversation on. */
  | "idle-unloaded"
  /** Its session ended and its thread is open. */
  | "failed-open"
  /** Not a reason of its own: only where its thread is (a row with no thread to open). */
  | "threadless";

export type Said = {
  kind: Kind;
  /** The reason after the state word on the thread's line: one sentence, one remedy; null: the roster's own. */
  sentence: string | null;
  /** "warning": the line's sentence is said in the warning tone (the MARK follows the row's, `rowTone`: one colour for an agent's dot): a remedy is needed, or a person may do the wrong thing; "plain": it says how things are. */
  tone: "warning" | "plain";
  /** The reason on the sidebar's row, in the soul's place (a row is never three lines); "": nothing after the state's word; null: the soul. */
  note: string | null;
  /** "warning": the row's mark is drawn in the warning tone (a stopped agent that needs a remedy); "plain": the state's own mark. */
  rowTone: "warning" | "plain";
  /** The kernel's report, for the notice under the line; null: none. */
  warning: OutsideOats | null;
  /**
   * The acts this feature itself offers, in order: the two of the kernel's report (Stop, Start),
   * Start on the line of a stop that warns, Stop for a session lost to bb's Archive; NONE (an empty
   * list) on a line where a message is the way on (`message`: a lost session, no harness loaded),
   * and Start there while bb has not answered for a thread in "error". null: the acts are the
   * lifecycle's own for the agent's state (the line's own act; `AgentActs` for an agent with no listed thread).
   */
  acts: readonly Act[] | null;
  /** Whether bb still has the conversation, archived, to read. */
  archived: boolean;
  /**
   * A MESSAGE in the agent's own listed thread is the designed way on (model/rest.ts
   * `messageResumes`): the line says so after the reason ("message to continue"), and has no
   * Start… or Restart… (`acts` is empty: the act would begin a new conversation).
   */
  message: boolean;
};

const base = { sentence: null, tone: "plain", note: null, rowTone: "plain", warning: null, acts: null, archived: false, message: false } as const;
/** No act of the line's own: where a message is the way on. */
const NO_ACTS: readonly Act[] = [];

/** The reason of a row whose thread cannot be opened from the tree, by where bb says the thread is. */
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
 * `where` is bb's answer for the row's thread; `attached`: whether the roster draws the agent on
 * its bb thread (a row that opens the thread). An agent it does not (its thread archived, deleted,
 * hidden or another's) gets a `note` that says where its thread is, once bb has answered; but an
 * agent OATS stopped whose thread bb has archived, which keeps its soul on its row.
 *
 * By the agent's state, as the one state function gives it (without bb's own question on its
 * thread, which the roster says first):
 * - "outside" (the kernel's report): that OATS recorded it stopped; the notice has Stop and Start.
 * - one that NEVER RAN (bb says its thread failed at its start, `thread.startFailure`): nothing of
 *   this feature's; the roster's own words stand ("Failed", bb's reason under Details, Start).
 * - "error" on an open thread: that a message there starts it again.
 * - "stopped", by bb's answer and by how the kernel says the session ended:
 *   - bb has no such thread: that it was deleted; to start it for a new one. A warning.
 *   - bb has it archived, and OATS LOST the session (`sessionEnd: "lost"`): bb's Archive never
 *     ends the harness, so its process may still run; to stop it, then start it. A warning, with Stop.
 *   - bb has it archived, otherwise: the fact, and the way to it (what a stop leaves once the provider archives).
 *   - its thread is open, and its session was LOST (`sessionEnd: "lost"`): that nobody stopped it,
 *     and that a message there carries it on. No cause, no time, no promise.
 *   - its thread is open, for every other stop (an operator's, or one that does not say how its
 *     session ended): the interim warning that a message there starts it without OATS. The
 *     warning is the default (the spec's author's ruling of 23 Nov 2026). A harness that ended by
 *     itself ("exited") is not a stop: the state function calls it failed ("error", above).
 * - an agent on TMUX whose session was lost: that nobody stopped it (`sentenceOf` adds what Start
 *   does where the lifecycle offers Start for it). Nothing else is said of an agent on tmux.
 * - "idle" of a row the kernel calls not running (`running: false` beside `runtimeState:
 *   "unknown"`: no harness is loaded), on an open thread: the reason, "not loaded".
 * ONE RULE over two of the lines above (the lead's ruling on the read of 24 Nov 2026, T5): on the
 * agent's own listed thread, where a MESSAGE is the designed way on (`messageResumes`,
 * model/rest.ts), for a LOST session and for NO HARNESS LOADED, `message` is set: the line says
 * "message to continue" after the reason and has NO act of its own (`acts` is empty): Start…
 * begins a new conversation, and stays in the thread's menu, the panel and the agent's page. Not
 * for a failed agent (no fact shows a message carrying one on), not for an operator's stop (its
 * warning and Start… stay), and not on a thread in "error" bb has not answered for.
 */
export function said(agent: Agent, where: ThreadWhere, attached: boolean, thread: object | null = null): Said | null {
  // An agent on tmux has no thread in bb: this feature says one thing of it, that its session was
  // lost (the one reading of the row, model/rest.ts), so that it never reads as stopped by a person.
  if (agent.backend === "tmux") return rest(agent) === "lost" ? { ...base, kind: "lost-tmux", sentence: LOST_NOTE, note: LOST_NOTE } : null;
  const note = attached ? null : whereNote(where);
  const archived = where === "archived";
  const threadless: Said | null = note === null ? null : { ...base, kind: "threadless", note, archived };
  // How it is at rest: the one reading of the row (model/rest.ts), which the home's card and the Start dialog read too.
  const how = rest(agent, thread);
  // It never ran (bb says its thread failed at its start): the roster's own words stand ("Failed",
  // bb's reason under Details, Start): no sentence of this feature's, and never that a message carries it on.
  if (how === "never-started") return threadless;
  // Its state. A stop that still shows a claim (the word "stopped" with no word that the row does
  // not run: the claim's gate lets it through) is drawn "Needs you": this feature says of it what
  // it says of a stop, so that its line warns where the home's card refuses.
  const drawn = state(agent, null);
  const is = how === "stopped" && drawn === "needs-you" ? "stopped" : drawn;
  // THE RULE of the line (the lead's T5): on the agent's own listed thread, where a message is the
  // designed way on (the ONE predicate the home's card and the Start dialog read), the line says
  // so and offers no Start…: for a lost session and for no harness loaded. The predicate fails
  // closed on a thread in "error" that bb has not answered for (it may never have started): the
  // line then says the reason alone and keeps Start….
  // (With no row of the thread given, nothing is invited: a caller that draws an agent on its thread passes it.)
  const message = where === "open" && attached && thread !== null && messageResumes(agent, thread);
  // Archived while it RAN: bb's Archive never touches the harness, so the process goes on with no
  // thread a person can see. The row keeps its state's word, in the warning tone, and where it
  // leads says the remedy. "Still says it runs": the row is not stopped, failed, or unreachable
  // (by its own word: a claim makes such a row "Needs you", and it is still not one that runs),
  // and the kernel does not say that no harness is loaded (`running: false`).
  const cannotRun = agent.runtimeState === "shell" || how === "unreachable" || agent.running === false;
  if (archived && !attached && (is === "idle" || is === "needs-you") && !cannotRun) {
    return { ...base, kind: "running-archived", sentence: LOST_ARCHIVED, tone: "warning", note: MAY_RUN_NOTE, rowTone: "warning", acts: ["stop"], archived };
  }
  switch (is) {
    case "outside":
      // Its row says the state alone: the words fill the row's one line, and say what is wrong.
      // `outsideOats` is set (the state function's own test).
      return { ...base, kind: "outside", sentence: OUTSIDE_RECORDED, tone: "warning", note: "", warning: agent.outsideOats ?? null, acts: ["stop", "start"], archived };
    case "error":
      // "message to continue" is NOT said of a failed agent, and its line keeps the roster's own act
      // (the lead's ruling of 24 Nov 2026 on T5's condition: the words are said only where the
      // kernel's or the provider's fact shows that a message carries the agent on under OATS; no
      // provider prints a session that ended by itself on a bb thread, and nothing shows a message
      // carrying one on).
      return where === "open" && attached ? { ...base, kind: "failed-open", sentence: SESSION_ENDED } : threadless;
    case "stopped": {
      if (where === "missing") return { ...base, kind: "deleted", sentence: DELETED_NOTE, tone: "warning", note: DELETED_NOTE, rowTone: "warning" };
      const lost = how === "lost";
      if (where === "archived") {
        if (lost) return { ...base, kind: "lost-archived", sentence: LOST_ARCHIVED, tone: "warning", note: MAY_RUN_NOTE, rowTone: "warning", acts: ["stop"], archived };
        // The row keeps the soul beside "Stopped", in the plain tone: once the provider archives at
        // stop this is EVERY stopped agent, and nothing is wrong with it (the spec's author's ruling).
        // The row opens the archived thread, whose own row says since when and that it is archived.
        return { ...base, kind: "stopped-archived", sentence: ARCHIVED_NOTE, archived };
      }
      if (where === "open" && attached) {
        // THE GATE (the one place): whether the bb session provider archives the thread of a home
        // it stops is `stopArchivesThread(providerVersion)` (app/lifecycle/words.ts). It changes no
        // word here: before the provider archives at stop, every operator's stop leaves the thread
        // open; after it, an open thread under a stopped agent is a home stopped before that
        // release or a thread a person unarchived, and the warning stays for exactly that case.
        // Start is this feature's on that line, so that the line has the act its sentence names
        // whatever its state's word is (bb's own question on the thread makes it "Needs you").
        if (lost) return { ...base, kind: "lost-open", sentence: LOST_NOTE, note: LOST_NOTE, acts: message ? NO_ACTS : ["start"], message };
        // Every other stop warns: a safety sentence fails CLOSED. An operator's stop (`sessionEnd:
        // "stopped"`) and a row that names no end of its session (the kernel gives none while a
        // retire is pending, a rollback is incomplete or a spawn is in progress): in each, a
        // message in bb starts a harness OATS does not expect.
        return { ...base, kind: "stopped-open", sentence: STOPPED_OPEN, tone: "warning", acts: ["start"] };
      }
      return threadless;
    }
    case "idle":
      // The kernel's own word that no harness runs: `running: false`. (With no thread given, the state
      // function answers "idle" for every provider row that is not stopped, failed or unreachable:
      // one whose harness is loaded reads `true`, one the provider cannot tell reads `null`.)
      if (where === "open" && attached && how === "unloaded") return { ...base, kind: "idle-unloaded", sentence: NOT_LOADED_NOTE, note: NOT_LOADED_NOTE, acts: message ? NO_ACTS : ["start"], message };
      return threadless;
    default:
      return threadless;
  }
}
