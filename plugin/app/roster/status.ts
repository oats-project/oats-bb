// The one function that says an agent's state in words, for every place that prints it (the tree,
// the line under a thread's header, the instance panel), so that they say the same thing. Today the
// home's card reads its age from it; the tree still draws the state's dot from the node's own
// state, which is the same `state()`, and prints "· stopped" on a stopped row itself.
// Its `word` is still the existing screens' (`STATE_WORD`, app/format.ts: "needs you", "error"),
// which do not move in the change that brought the patterns. A NEW screen prints a state with
// `State` or `StatusLine` (app/ui.tsx), whose words are the standard's (`STATE`, app/ui/words.ts:
// "Needs you", "Failed"), and passes `state`, not this `word`. The roster's piece moves this
// function, and the tree, onto `STATE`, and `STATE_WORD` and `Dot` go. Pure.
import type { Agent, AgentState, BbThread } from "../../model/types";
import { state } from "../../model/view";
import { age, STATE_WORD } from "../format";

export type AgentStatus = {
  /** The drawn state: the kernel's word for whether the agent runs, and whether it waits on a person. */
  state: AgentState;
  /** The word the state is drawn and announced with ("needs you", "working", …). */
  word: string;
  /** How long the agent has been waiting on a person ("12 min ago"); null when it does not wait, or the kernel names no instant. */
  since: string | null;
};

/** `now` is the clock in epoch milliseconds, as the slot reads it. */
export function agentStatus(agent: Agent, thread: BbThread, now: number): AgentStatus {
  const drawn = state(agent, thread);
  return { state: drawn, word: STATE_WORD[drawn], since: drawn === "needs-you" ? age(agent.waiting?.since ?? null, now) : null };
}
