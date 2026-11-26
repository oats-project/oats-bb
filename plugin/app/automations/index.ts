// Automations' slots: the page, and its row in the "oats" block at the top of the plugin's thread
// list, which carries two marks: amber while an agent an automation made asks, red while one is failing. Like the workspace's pages it
// stays out of bb's own navigation. The components are in this directory.
import type { PluginAppBuilder } from "@get-bb/plugin-sdk/app";
import { addPageLink, shownPage } from "../workspace/pages";
import { AutomationsPage, HeaderTitle, PATH, usePageTitle } from "./Page";
import { useFailedRunMark } from "./read";

import { ICONS } from "./bb";

/** bb's own Automations icon (its navigation's and its page header's), seen on bb-app 0.50.1. */
const ICON = ICONS.page;

export function register(app: PluginAppBuilder): void {
  app.slots.navPanel({ id: "automations", title: "Automations", icon: ICON, path: PATH, experimental_hideFromNavigation: true, experimental_usePageTitle: usePageTitle, experimental_headerTitle: HeaderTitle, component: shownPage(PATH, AutomationsPage) });
  addPageLink({ path: PATH, title: "Automations", useMark: useFailedRunMark });
}
