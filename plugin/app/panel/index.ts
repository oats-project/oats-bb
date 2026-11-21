// The instance panel's slot: the view of one agent in the plugin's fixed thread tab (the home's
// tab shows it on an agent's own thread: app/home/agent-tab.ts). Its components are in this directory.
import type { PluginAppBuilder } from "@get-bb/plugin-sdk/app";
import { setAgentTab } from "../home/agent-tab";
import { AgentTab } from "./Panel";

export { InstancePanel, showPanelTab } from "./Panel";
export type { TabId } from "./parts";

export function register(_app: PluginAppBuilder): void {
  setAgentTab(AgentTab);
}
