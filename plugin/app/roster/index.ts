// The roster's slots: the sidebar's thread list (the agents as a tree) and the line of chips under
// an agent's thread header.
import type { PluginAppBuilder } from "@get-bb/plugin-sdk/app";
import { IdentityRow } from "./IdentityRow";
import { Sidebar } from "./Sidebar";

export function register(app: PluginAppBuilder): void {
  app.slots.experimental_threadList({
    id: "agents",
    title: "OATS agents",
    description: "Your OATS agents as a tree, children under parents, then every other thread.",
    component: Sidebar,
  });
  app.slots.experimental_threadHeaderRow({ id: "identity", order: 0, component: IdentityRow });
}
