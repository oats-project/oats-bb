// The workspace's four pages, as the sidebar and the home link to them: each one's route under
// the plugin (`/plugins/oats/<path>`) and its title.
import { createElement, useEffect, useSyncExternalStore } from "react";
import type { ComponentType } from "react";
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

// ---- which page is open (D-037: the row of the page shown carries the selection) ----
// bb gives a plugin no hook for the route it shows, so a page says so itself while it is drawn.

let open: string | null = null;
const watchers = new Set<() => void>();
const setOpen = (path: string | null) => {
  if (open === path) return;
  open = path;
  for (const watcher of watchers) watcher();
};

/**
 * A page's component, for its `navPanel` registration: while it is drawn, `path` is the open page
 * and its row in the sidebar's block is the selected one. `component: shownPage("souls", SoulsPage)`.
 */
export function shownPage<Props extends object>(path: string, Page: ComponentType<Props>): ComponentType<Props> {
  return function ShownPage(props: Props) {
    useEffect(() => {
      setOpen(path);
      // Only the page that is still the open one takes the selection away: the next page may have set its own first.
      return () => {
        if (open === path) setOpen(null);
      };
    }, []);
    return createElement(Page, props);
  };
}

/** The path of the plugin's page that is drawn now, or null: a thread, or a page of bb's own, is shown. */
export function useOpenPage(): string | null {
  return useSyncExternalStore(
    (watcher) => {
      watchers.add(watcher);
      return () => watchers.delete(watcher);
    },
    () => open,
  );
}
