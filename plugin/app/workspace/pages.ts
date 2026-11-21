// The workspace's four pages, as the sidebar and the home link to them: each one's route under
// the plugin (`/plugins/oats/<path>`) and its title.
import type { BbNavigate } from "@get-bb/plugin-sdk/app";

export const PAGES = [
  { path: "souls", title: "Souls" },
  { path: "capabilities", title: "Capabilities" },
  { path: "teams", title: "Teams" },
  { path: "machines", title: "Machines" },
] as const;

/** Opens one soul's own page: `key` is the soul's key, as `oats souls` names it (`<package>/<soul>` for a package soul). */
export function openSoul(navigate: Pick<BbNavigate, "toPluginPanel">, key: string): void {
  navigate.toPluginPanel("souls", { subPath: key });
}
