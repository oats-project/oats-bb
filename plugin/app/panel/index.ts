// The instance panel's slots: the view of one agent in the plugin's fixed thread tab (the home's
// tab shows it on an agent's own thread: app/home/agent-tab.ts), and the same panel as a page of
// its own, by instance. Its components are in this directory.
import type { PluginAppBuilder } from "@get-bb/plugin-sdk/app";
import { setAgentPage, setAgentTab } from "../home/agent-tab";
import { AGENT_PAGE, AgentPage, openAgentPage } from "./AgentPage";
import { AgentTab } from "./Panel";

export { openAgentPage } from "./AgentPage";
export { InstancePanel, showPanelTab } from "./Panel";
export type { TabId } from "./Panel";

/** Checked at runtime on bb-app 0.50.1 (app.tsx says why). */
const ICON = "Bot";

export function register(app: PluginAppBuilder): void {
  setAgentTab(AgentTab);
  // Where the other features open one agent's page from: the thread's OATS chip at the phone's
  // width, and the row of an agent with no bb thread.
  setAgentPage(openAgentPage);
  // Opened from an agent's row or thread, never from bb's own navigation.
  app.slots.navPanel({ id: "agent", title: "Agent", icon: ICON, path: AGENT_PAGE, experimental_hideFromNavigation: true, component: AgentPage });
}
