// THE ONE GUARDED SEND: how the plugin sends a message to an agent's bb thread, and the only place
// that calls bb's `threads.send`. The home's card (a reply, an answer to bb's own request) and the
// board (an option of a question the agent asked) both go through it, so that the two are one
// thing to a person and one rule to read.
//
// THE GUARD: a message typed into the thread of an agent OATS has stopped starts its harness
// behind OATS's back. So nothing goes to bb unless, AT THE PRESS, the roster the plugin's server
// holds reads and says the agent may be written to: what a place drew is asked once more of the
// server (an agent OATS stopped since the place was drawn is not started by the press; nor is a
// message sent to the thread of an agent whose row names another thread by then).
import type { useRpc, useSdk } from "@get-bb/plugin-sdk/app";
import type { rpcContract } from "../../contract";
import type { Agent } from "../../model/types";
import { mayAnswer, refusal } from "./board";
import { NOT_NOW_GONE, NOT_NOW_STOPPED, NOT_NOW_UNREACHABLE, NOT_NOW_UNREAD } from "./home-words";

type Rpc = ReturnType<typeof useRpc<typeof rpcContract>>;
type Sdk = ReturnType<typeof useSdk>;

/** Who is written to, as the place drew it: the agent's row, bb's row of its thread (null: none listed), and whether the roster shown is the last one read (or the place reads "Reading…"). */
export type Target = { agent: Agent; thread: object | null; held: boolean };

/**
 * Whether a place may OFFER to write to the agent at all, for the roster it is drawn from: the
 * home's own rule (app/home/board.ts `mayAnswer`). A place that offers nothing sends nothing.
 */
export const mayWrite = (target: Target): boolean => mayAnswer(target.agent, target.thread, target.held);

/**
 * Runs `run` (what writes to bb) only if the server's roster, read NOW, says the agent may be
 * written to; else it rejects with the sentence that says why, and nothing was sent. `run` is
 * given the agent's row as the server holds it at that moment.
 * The AGENT is the server's roster's, read now; the THREAD is the place's own (bb's row as it was
 * drawn): the guard is fresh on what OATS says, not on what bb says of the thread.
 */
export async function guarded<Result>(rpc: Rpc, target: Target, run: (now: Agent) => Promise<Result>): Promise<Result> {
  const now = await rpc.call("snapshot", null);
  if (!now.ok) throw new Error(NOT_NOW_UNREAD);
  const agent = now.agents.find((each) => each.instance === target.agent.instance);
  if (agent === undefined) throw new Error(NOT_NOW_GONE);
  // THE THREAD written to is the one the place was DRAWN for: where the server's row names another now (the agent was
  // started again on a new thread since the draw), the agent the place shows is no longer the one it would write to.
  if (agent.threadId !== target.agent.threadId) throw new Error(NOT_NOW_GONE);
  const why = refusal(agent, target.thread);
  if (why !== null) throw new Error(why === "unreachable" ? NOT_NOW_UNREACHABLE : NOT_NOW_STOPPED);
  return run(agent);
}

/** A message to a thread, as a person's own: the plugin's ONE call of bb's `threads.send`. Call it only from inside `guarded`. */
export const sendText = (sdk: Sdk, threadId: string, text: string): Promise<unknown> => sdk.threads.send({ threadId, mode: "auto", input: [{ type: "text", text, mentions: [] }] });
