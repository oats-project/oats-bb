// Spawn's slots: the New agent form, a page of its own (Page.tsx). It is not one of the pages a
// release can leave out (the setting `pages`): whatever is shown, "New agent" opens it: the button
// at the sidebar's foot and the one in the home's heading; any place opens it the same way
// (`openNewAgent` of app/workspace/pages.ts, with a soul chosen or with none). A soul's page still draws the earlier
// form (NewAgent.tsx). Like the plugin's other pages it stays out of bb's own navigation.
import type { PluginAppBuilder } from "@get-bb/plugin-sdk/app";
import type { BbNavigate } from "@get-bb/plugin-sdk/app";
import { setNewAgent } from "../workspace/pages";
import type { NewAgentTarget } from "../workspace/pages";
import { NewAgentPage } from "./Page";

/** The page's id and its route under the plugin: `/plugins/oats/new-agent`, and `/new-agent/<soul>` with a soul chosen. */
export const PATH = "new-agent";
/** Checked at runtime on bb-app 0.50.1 (app.tsx says why). */
const ICON = "Plus";

/** Opens the form: with `target.soul` (a soul's key, as `oats souls` names it) chosen, or with none. */
export function openNewAgent(navigate: Pick<BbNavigate, "toPluginPanel">, target?: NewAgentTarget): void {
  navigate.toPluginPanel(PATH, target?.soul === undefined ? undefined : { subPath: target.soul });
}

export function register(app: PluginAppBuilder): void {
  app.slots.navPanel({ id: PATH, title: "New agent", icon: ICON, path: PATH, experimental_hideFromNavigation: true, component: NewAgentPage });
  setNewAgent(openNewAgent);
}
