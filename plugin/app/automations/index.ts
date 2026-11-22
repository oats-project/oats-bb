// Automations' slots: the page, and its row in the "oats" block at the top of the plugin's thread
// list, which carries a mark while a schedule's last run failed. Like the workspace's pages it
// stays out of bb's own navigation. The components are in this directory.
import type { PluginAppBuilder } from "@get-bb/plugin-sdk/app";
import { addPageLink, shownPage } from "../workspace/pages";
import { AutomationsPage, PATH } from "./Page";
import { useFailedRunMark } from "./read";

/** Checked at runtime on bb-app 0.50.1 (app.tsx says why). */
const ICON = "Clock";

export function register(app: PluginAppBuilder): void {
  app.slots.navPanel({ id: "automations", title: "Automations", icon: ICON, path: PATH, experimental_hideFromNavigation: true, component: shownPage(PATH, AutomationsPage) });
  addPageLink({ path: PATH, title: "Automations", useMark: useFailedRunMark });
}
