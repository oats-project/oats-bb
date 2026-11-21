// What the plugin's fixed thread tab shows on an agent's own thread. The home's tab is the one tab
// bb gives the plugin on a thread; a feature that has a view of one agent (the instance panel)
// names its component here, in its `register`, and the tab shows it on that agent's thread and the
// home on every other. With none named, the tab is the home everywhere.
import type { ComponentType } from "react";
import type { Agent } from "../../model/types";

export type AgentTabProps = { agent: Agent; threadId: string };

let agentTab: ComponentType<AgentTabProps> | null = null;

/** Names the view of one agent; null takes it away. One feature names it: the last call wins. */
export function setAgentTab(component: ComponentType<AgentTabProps> | null): void {
  agentTab = component;
}

export const getAgentTab = (): ComponentType<AgentTabProps> | null => agentTab;
