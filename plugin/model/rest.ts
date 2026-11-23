// How an agent that does not run is at rest, and whether a message in its bb thread is the
// designed way to carry it on: ONE reading of the kernel's row for every place that asks (the
// home's card, the Start and Restart dialogs, what the plugin says of an agent outside OATS).
// Pure: the row's own fields and bb's own row of the thread; nothing is derived from words.
import type { Agent } from "./types";
import { recordedStopped } from "./view";

type Row = Pick<Agent, "running" | "runtimeState" | "backend"> & { sessionEnd?: string | null };

/**
 * - "runs": the kernel does not say the agent does not run (`running` is not false, and its word
 *   is not "stopped");
 * - "stopped": the kernel calls it stopped (`recordedStopped`, or the word "stopped" alone, or a
 *   row that still says an operator stopped it) and its session was not lost: an operator's stop,
 *   a harness that ended by itself, or a row that does not say how its session ended. A message
 *   in its thread would start a harness OATS does not expect;
 * - "lost": the kernel calls it stopped and says its session was LOST (`sessionEnd: "lost"`): it
 *   ended without OATS stopping it. Nobody stopped it;
 * - "unloaded": not running beside a word that is not "stopped": a provider's "unknown" (its
 *   session is there and no harness is loaded), or a session that ended in a shell or cannot be
 *   reached (each told by its own state). Nobody stopped it either.
 */
export type Rest = "runs" | "stopped" | "lost" | "unloaded";

export function rest(agent: Row): Rest {
  if (agent.running !== false && agent.runtimeState !== "stopped") return "runs";
  if (recordedStopped(agent) || agent.runtimeState === "stopped" || agent.sessionEnd === "stopped") return agent.sessionEnd === "lost" ? "lost" : "stopped";
  return "unloaded";
}

/**
 * Whether a message a person sends in the agent's bb thread is the DESIGNED way to carry it on:
 * the kernel says it does not run (`running: false`) and that nobody stopped it (its session was
 * lost, or no harness is loaded for it), and it is an agent on bb whose thread bb lists (not
 * archived, not hidden) and does not call failed. Then an answer or a message reaches a session
 * the provider brings back, and OATS reads it running at its next read. Never for a stop (the
 * message would start it outside OATS), and never for an agent on tmux (bb cannot write to it).
 * `thread` is bb's own row of the thread the roster draws the agent on, or null.
 */
export function messageResumes(agent: Row, thread: { status: string } | null): boolean {
  const how = rest(agent);
  return agent.running === false && (how === "lost" || how === "unloaded") && agent.backend !== "tmux" && thread !== null && thread.status !== "error";
}
