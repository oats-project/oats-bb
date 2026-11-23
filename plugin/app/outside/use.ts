// What every place asks of this feature: what to say of one agent of the roster it draws (`said`,
// say.ts), from the kernel's row and bb's own answer for the row's thread (`Oats.whereOf`).
import type { Agent } from "../../model/types";
import type { Oats } from "../oats";
import { said, type Said } from "./say";

export type Outside = {
  /** What to say of an agent of the roster; null where the roster's own words stand. */
  of(agent: Agent): Said | null;
  /** The agent whose recorded thread `threadId` is, where the roster does not draw it on that thread because bb has it archived; undefined for any other thread. */
  agentOn(threadId: string): Agent | undefined;
};

const NOTHING: Outside = { of: () => null, agentOn: () => undefined };

/** `oats` is the caller's own `useOats()`: what is said of an agent is said of the row the place holds. No read of its own. */
export function outsideOf(oats: Oats): Outside {
  if (oats.phase !== "ready") return NOTHING;
  const attached = (agent: Agent): boolean => oats.nodeByInstance.get(agent.instance)?.agent === agent;
  return {
    of: (agent) => said(agent, oats.whereOf(agent), attached(agent)),
    agentOn: (threadId) => oats.view.detached.find((agent) => agent.threadId === threadId && oats.whereOf(agent) === "archived"),
  };
}
