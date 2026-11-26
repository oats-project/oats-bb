// The workspace's slots: the Workspace page, whose four tabs are routes of their own. It is opened
// from the "oats" block at the top of the plugin's thread list, and stays out of bb's own navigation.
import type { ComponentType } from "react";
import type { PluginAppBuilder, PluginNavPanelProps } from "@get-bb/plugin-sdk/app";
import { CapabilitiesPage, MachinesPage, TeamsPage } from "./Lists";
import { PAGES, shownPage, usePagesShown, WORKSPACE } from "./pages";
import type { WorkspaceTab } from "./pages";
import { SoulsPage } from "./Souls";

/** Checked at runtime on bb-app 0.50.1 (app.tsx says why). */
const ICON = { souls: "Brain", capabilities: "Puzzle", teams: "Layers", machines: "Laptop", workspace: "Layers" } as const;

/** The Workspace page's own route: the first tab this release shows. */
function FirstTab(props: PluginNavPanelProps) {
  const pages = usePagesShown();
  const first = PAGES.find((page) => pages.has(page.path))?.path;
  const Tab = first === "souls" ? SoulsPage : first === "capabilities" ? CapabilitiesPage : first === "teams" ? TeamsPage : first === "machines" ? MachinesPage : null;
  return Tab === null ? null : <Tab {...props} subPath="" />;
}

export function register(app: PluginAppBuilder): void {
  // (Every route's title is the page's, "Workspace": the tab says which part it is.)
  const tab = (id: WorkspaceTab, icon: string, Page: ComponentType<PluginNavPanelProps>) =>
    app.slots.navPanel({ id, title: WORKSPACE.title, icon, path: id, experimental_hideFromNavigation: true, component: shownPage(id, Page, WORKSPACE.path) });
  tab("souls", ICON.souls, SoulsPage);
  tab("capabilities", ICON.capabilities, CapabilitiesPage);
  tab("teams", ICON.teams, TeamsPage);
  tab("machines", ICON.machines, MachinesPage);
  app.slots.navPanel({ id: WORKSPACE.path, title: WORKSPACE.title, icon: ICON.workspace, path: WORKSPACE.path, experimental_hideFromNavigation: true, component: shownPage(WORKSPACE.path, FirstTab) });
}
