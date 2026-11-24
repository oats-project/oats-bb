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
 * Whether a message a person sends in the agent's bb thread is the DESIGNED way to carry it on.
 * THE RULE (the spec's author's, 23 Nov 2026): a message is refused only for an agent an OPERATOR
 * stopped, or that is stopped with no word that its session was lost (the kernel's stop: the
 * message would start its harness outside OATS), and where nobody can tell (the kernel cannot
 * reach its session). Everything else that does not run (`running: false`: its session was lost,
 * it ended by itself, or no harness is loaded for it) and is an agent on bb whose thread bb LISTS
 * (not archived, not hidden) carries on by a message: the provider brings its session back, and
 * OATS reads it running at its next read (the kernel's contract for a provider home,
 * docs/desktop-cli-api.md at v0.70.5: a session that a message started reads running at the next
 * status; `outsideOats` is reported only against a recorded stop). A listed thread whose last
 * turn bb calls failed ("error") takes a message as any other: a harness killed in a turn is how
 * a session is lost. Never for an agent on tmux (bb cannot write to it).
 * Never for a thread that FAILED AT ITS START: nothing ran there, and a message would be a first
 * start outside OATS.
 * `thread` is bb's own row of the thread the roster draws the agent on, or null where bb lists none.
 */
export function messageResumes(agent: Row, thread: Thread): boolean {
  if (agent.running !== false || agent.backend === "tmux" || thread === null) return false;
  // (A thread that failed at its start is "never-started": there is no conversation to carry on.)
  const how = rest(agent, thread);
  return how === "lost" || how === "ended" || how === "unloaded";
}
