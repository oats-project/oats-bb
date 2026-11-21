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

/**
 * A row of the sidebar's "oats" block: a page of the plugin, by its route under the plugin and its
 * title. `useMark` is a hook the row calls while it is drawn: null for no mark, or the label of a
 * mark the row draws as a dot after the title, with the label as the dot's accessible name
 * ("Automations, a run failed").
 */
export type PageLink = { path: string; title: string; useMark?: () => { label: string } | null };

const added: PageLink[] = [];

/**
 * Lists a feature's own page in the sidebar's block, after the four pages, in the order the
 * features register. Called in the feature's `register`; a path listed twice is listed once, as
 * last given. Answers how to take the row away.
 */
export function addPageLink(link: PageLink): () => void {
  const at = added.findIndex((other) => other.path === link.path);
  if (at === -1) added.push(link);
  else added[at] = link;
  return () => {
    const mine = added.indexOf(link);
    if (mine !== -1) added.splice(mine, 1);
  };
}

/** The rows of the sidebar's block: the four pages, then what the features added. */
export const pageLinks = (): readonly PageLink[] => [...PAGES, ...added];
