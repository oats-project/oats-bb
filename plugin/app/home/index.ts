// The home's slots: the full page (bb's navigation entry, with its badge) and the same view as a
// thread's fixed side-panel tab.
import type { PluginAppBuilder } from "@get-bb/plugin-sdk/app";
import { shownPage } from "../workspace/pages";
import { HomePage, HomeTab, useHomeBadge } from "./Home";

/** Checked at runtime on bb-app 0.50.1 (app.tsx says why). */
const ICON = "Bot";

export function register(app: PluginAppBuilder): void {
  app.slots.navPanel({
    id: "home",
    title: "OATS",
    icon: ICON,
    path: "home",
    component: shownPage("home", HomePage),
    experimental_useBadge: useHomeBadge,
  });
  app.slots.experimental_tab({
    id: "home",
    context: { kind: "thread" },
    availability: "fixed",
    title: "OATS",
    icon: ICON,
    layout: "flush",
    component: HomeTab,
  });
}
