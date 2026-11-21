// The pattern book: one hidden page (/plugins/oats/patterns) that draws every pattern of app/ui.tsx
// in each of its states, with sample words. It is what the live checks read the patterns'
// contrast, target sizes, accessible names and focus order from, in both themes and at both
// widths, and what a person compares with the Desktop. It reads nothing from OATS.
import type { PluginAppBuilder } from "@get-bb/plugin-sdk/app";
import { PatternBook } from "./PatternBook";

export function register(app: PluginAppBuilder): void {
  app.slots.navPanel({ id: "patterns", title: "OATS patterns", icon: "Puzzle", path: "patterns", experimental_hideFromNavigation: true, component: PatternBook });
}
