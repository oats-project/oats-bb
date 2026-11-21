// What the plugin's fixed thread tab shows on an agent's own thread. The home's tab is the one tab
// bb gives the plugin on a thread; a feature that has a view of one agent (the instance panel)
// names its component here, in its `register`, and the tab shows it on that agent's thread and the
// home on every other. With none named, the tab is the home everywhere.
import type { BbNavigate } from "@get-bb/plugin-sdk/app";
import type { ComponentType } from "react";
import type { Agent } from "../../model/types";

export type AgentTabProps = { agent: Agent; threadId: string };

let agentTab: ComponentType<AgentTabProps> | null = null;

/** Names the view of one agent; null takes it away. One feature names it: the last call wins. */
export function setAgentTab(component: ComponentType<AgentTabProps> | null): void {
  agentTab = component;
}

export const getAgentTab = (): ComponentType<AgentTabProps> | null => agentTab;

/**
 * The page of one agent, where a feature has one (the instance panel's, by instance: it is where
 * the agent's view is at the phone's width, where bb has no side panel, and for an agent with no
 * bb thread). The feature names how to open it, in its `register`; null takes it away.
 */
let agentPage: ((navigate: BbNavigate, instance: string) => void) | null = null;

export function setAgentPage(open: ((navigate: BbNavigate, instance: string) => void) | null): void {
  agentPage = open;
}

/** Opens the agent's own page; false when no feature has one, and the caller opens what it has. */
export function openAgentPage(navigate: BbNavigate, instance: string): boolean {
  if (agentPage === null) return false;
  agentPage(navigate, instance);
  return true;
}

/** Whether an agent has a page of its own to open. */
export const hasAgentPage = (): boolean => agentPage !== null;

// The agents the tab has shown, by thread: while the roster cannot be read (a read in flight, a
// failed one) the tab keeps the view of the agent it knew there, and that view says how old what
// it shows is. Never the home's error line where an agent's view was.
const known = new Map<string, Agent>();
export const rememberAgent = (threadId: string, agent: Agent): void => void known.set(threadId, agent);
export const rememberedAgent = (threadId: string): Agent | undefined => known.get(threadId);
/** For tests: a new app window has shown no agent. */
export const forgetAgents = (): void => known.clear();
