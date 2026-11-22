// The workspace's slots: the four pages. They are opened from the "oats" block at the top of the
// plugin's thread list, and stay out of bb's own navigation.
import type { PluginAppBuilder } from "@get-bb/plugin-sdk/app";
import { CapabilitiesPage, MachinesPage, TeamsPage } from "./Lists";
import { shownPage } from "./pages";
import { SoulsPage } from "./Souls";

/** Checked at runtime on bb-app 0.50.1 (app.tsx says why). */
const ICON = { souls: "Brain", capabilities: "Puzzle", teams: "Layers", machines: "Laptop" } as const;

export function register(app: PluginAppBuilder): void {
  app.slots.navPanel({ id: "souls", title: "Souls", icon: ICON.souls, path: "souls", experimental_hideFromNavigation: true, component: shownPage("souls", SoulsPage) });
  app.slots.navPanel({ id: "capabilities", title: "Capabilities", icon: ICON.capabilities, path: "capabilities", experimental_hideFromNavigation: true, component: shownPage("capabilities", CapabilitiesPage) });
  app.slots.navPanel({ id: "teams", title: "Teams", icon: ICON.teams, path: "teams", experimental_hideFromNavigation: true, component: shownPage("teams", TeamsPage) });
  app.slots.navPanel({ id: "machines", title: "Machines", icon: ICON.machines, path: "machines", experimental_hideFromNavigation: true, component: shownPage("machines", MachinesPage) });
}
