// Automations' slots: the page, opened from the "oats" block at the top of the plugin's thread
// list; like the workspace's pages it stays out of bb's own navigation. The components are in
// this directory.
import type { PluginAppBuilder } from "@get-bb/plugin-sdk/app";
import { AutomationsPage, PATH } from "./Page";

/** Checked at runtime on bb-app 0.50.1 (app.tsx says why). */
const ICON = "CalendarClock";

export function register(app: PluginAppBuilder): void {
  app.slots.navPanel({ id: "automations", title: "Automations", icon: ICON, path: PATH, experimental_hideFromNavigation: true, component: AutomationsPage });
}
