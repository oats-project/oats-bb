// Where ONE agent is, whole, for every place that says it of one agent (the thread's row, the
// instance panel's header): the state's word, since when, the question or the reason, the act that
// applies, and under the line what the kernel itself says where it said more. One component, so
// that a header says what the thread's row says (the panel read's F1: the question is in the header).
import type { ReactNode } from "react";
import type { Agent, BbThread } from "../../model/types";
import { KernelSays, StatusLine } from "../ui";
import { readAge } from "../ui/words";
import { agentStatus, rowState, stoppedSince } from "./status";

export type AgentStatusLineProps = {
  agent: Agent;
  /** The agent's bb thread; null for an agent that has none. */
  thread: BbThread | null;
  /** The clock, in epoch milliseconds. */
  now: number;
  /** The instance's recorded events, where the place has read them: a stopped agent's time is its last "stopped". */
  events?: readonly { kind: string; at: string; incarnation?: string }[] | undefined;
  /** When the roster this is drawn from was read, while OATS cannot be read again: the line says "as of <age>". */
  staleAt?: string | null;
  /** A sentence that takes the place of the state's own question or reason (a feature that knows more of this agent says it); absent: the state's. */
  detail?: string | null;
  /** The kernel has since refused this agent as one it does not know: the line says that, and nothing of its state. */
  gone?: boolean;
  /** The act that applies, and the place's own buttons: buttons only (the line's frame clips a list). */
  action?: ReactNode;
};

export function AgentStatusLine({ agent, thread, now, events, staleAt = null, detail, gone = false, action }: AgentStatusLineProps) {
  const read = agentStatus(agent, thread, now);
  const status = read.state === "stopped" ? { ...read, since: stoppedSince(events, agent.startedAt ?? null, now) } : read;
  const age = staleAt === null ? null : readAge(staleAt, now);
  const asOf = age === null ? null : `as of ${age}`;
  if (gone) return <StatusLine {...rowState(status, true)} detail="OATS has no agent of this name now" action={action} />;
  return (
    <>
      <StatusLine state={status.state} since={status.since} detail={detail ?? status.detail} asOf={asOf} action={action} />
      {/* The kernel's own text for a session it cannot reach: one press away, never the line's words. */}
      <KernelSays text={status.kernel} />
    </>
  );
}
