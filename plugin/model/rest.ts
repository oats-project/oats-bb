// How an agent that does not run is at rest, and whether a message in its bb thread is the
// designed way to carry it on: ONE reading of the kernel's row for every place that asks (the
// home's card, the Start and Restart dialogs, what the plugin says of an agent outside OATS).
// Pure: the row's own fields and bb's own row of the thread; nothing is derived from words.
import type { Agent, BbThread } from "./types";
import { failedAtStart, recordedStopped } from "./view";

type Row = Pick<Agent, "running" | "runtimeState"> & { backend?: string | null; sessionEnd?: string | null; outsideOats?: unknown };

/**
 * - "runs": the kernel does not say the agent does not run (`running` is not false, and its word
 *   is not "stopped");
 * - "stopped": an operator's stop, or a stop that does not say how its session ended (the word
 *   "stopped", or no word at all). A message in its thread would start a harness OATS does not expect;
 * - "lost": its session was LOST (`sessionEnd: "lost"`): it ended without OATS stopping it;
 * - "ended": its session ended by itself (`sessionEnd: "exited"`, or a shell with no word how);
 * - "unloaded": not running beside another word (a provider's "unknown": its session is there
 *   and no harness is loaded);
 * - "unreachable": the kernel cannot reach its session (`runtimeState: "unreachable"`, which it
 *   prints beside `running: null`): nobody can tell whether it runs.
 * - "never-started": bb says its thread FAILED AT ITS START (`thread.startFailure`, from bb's own
 *   events): it never ran, whatever the row says of how its session ended. Nothing to carry on.
 * Where the row says how its session ended, that decides, as in the state (`recordedStopped`).
 * `thread` is bb's own row of the agent's thread, where the place has it (absent: the row alone).
 */
export type Rest = "runs" | "stopped" | "lost" | "ended" | "unloaded" | "unreachable" | "never-started";

/** Any row of the thread (bb's sidebar's, or a place's own): only one that carries bb's word of its start (`BbThread.startFailure`) says that it failed there. */
type Thread = object | null;
const START: keyof BbThread = "startFailure";
const startOf = (thread: Thread): Pick<BbThread, "startFailure"> | null => (thread !== null && START in thread ? (thread as Pick<BbThread, "startFailure">) : null);

export function rest(agent: Row, thread: Thread = null): Rest {
  // Nobody can tell of a session the kernel cannot reach, whatever else the row says (the kernel
  // prints it `running: null` beside "unreachable"): its own answer, before every other.
  if (agent.runtimeState === "unreachable") return "unreachable";
  if (agent.running !== false && agent.runtimeState !== "stopped") return "runs";
  if (failedAtStart(agent, startOf(thread))) return "never-started";
  // The word "stopped" with no word that it does not run (`running` null or true): a stop, whatever
  // else the row says of how its session ended. The kernel prints "stopped" beside `running: false`.
  if (agent.running !== false) return "stopped";
  if (agent.sessionEnd === "lost") return "lost";
  if (agent.sessionEnd === "exited") return "ended";
  if (recordedStopped(agent)) return "stopped"; // as in the state: the row says a stop, or says nothing of how it ended beside "stopped" or no word
  return agent.runtimeState === "shell" ? "ended" : "unloaded";
}

/**
 * Whether a message a person sends in the agent's bb thread is the DESIGNED way to carry it on:
 * the ONE rule of the thread's line, the home's card and the Start dialog.
 * THE RULE (the lead's condition of 24 Nov 2026): it is said only where the kernel's or the
 * provider's fact shows that a message carries the agent on UNDER OATS. Two rows of an agent on
 * bb whose thread bb LISTS (not archived, not hidden) have such a fact:
 * - its session was LOST ("lost"): a message makes bb start the harness again in the same
 *   conversation, and the row then reads running with no `sessionEnd` and no `outsideOats` (the
 *   kernel side's answer, for a home stopped with the host and for one gone while OATS did not
 *   stop it; `outsideOats` is only ever for a home an operator stopped);
 * - no harness is loaded for it ("unloaded"): the real run shows a message carrying the
 *   conversation on, OATS reading it running at its next read on the same thread.
 * NOT a harness that ENDED BY ITSELF ("ended": `sessionEnd: "exited"`, or a shell): no provider
 * prints that row on a bb thread, and nothing shows a message carrying one on; until a recording
 * does, no place invites one (its line keeps its act, the card offers Start, the dialog has no
 * carry-on line). Never for an operator's stop, or a stop with no word that its session was lost
 * (the message would start its harness outside OATS); never where nobody can tell (the kernel
 * cannot reach its session). A listed thread whose LATER turn bb calls failed ("error") takes a
 * message as any other: a harness killed in a turn is how a session is lost. Never for an agent
 * on tmux (bb cannot write to it).
 * Never for a thread that FAILED AT ITS START: nothing ran there, and a message would be a first
 * start outside OATS. And never for a thread in "error" bb has NOT YET ANSWERED for (it may be
 * such a thread): the answer is `null` on the thread once bb says a turn started.
 * `thread` is bb's own row of the thread the roster draws the agent on, or null where bb lists none.
 */
export function messageResumes(agent: Row, thread: Thread): boolean {
  if (agent.running !== false || agent.backend === "tmux" || thread === null) return false;
  // FAIL CLOSED: a thread bb lists in "error" is one whose later turn failed (it takes a message)
  // or one that FAILED AT ITS START (a message would be a first start outside OATS), and until bb
  // has answered for its events (`startFailure` absent) nobody knows which. No message is invited
  // before the answer: not on the line, not by the home's card, not in the Start dialog.
  if ((thread as { status?: unknown }).status === "error" && startOf(thread)?.startFailure === undefined) return false;
  // (A thread that failed at its start is "never-started": there is no conversation to carry on.)
  const how = rest(agent, thread);
  return how === "lost" || how === "unloaded";
}
