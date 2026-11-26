// The Workspace page and its four tabs (Souls, Capabilities, Teams, Machines), as the sidebar and
// the home link to them: each one's route under the plugin (`/plugins/oats/<path>`) and its title.
// ONE entry of the sidebar, "Workspace", as the Desktop has it (its D-177; the ruling on the pages'
// audit, 25 Nov 2026, R1): a tab is a route of its own, so that a link to a tab, or to a soul, holds.
import { createElement, useEffect, useSyncExternalStore } from "react";
import type { ComponentType } from "react";
import { useBbNavigate, useSettings } from "@get-bb/plugin-sdk/app";
import type { BbNavigate } from "@get-bb/plugin-sdk/app";
import { DEFAULT_PAGES } from "../../model/pages";

export { DEFAULT_PAGES };

/** The Workspace page's tabs, in the Desktop's order. */
export const PAGES = [
  { path: "souls", title: "Souls" },
  { path: "capabilities", title: "Capabilities" },
  { path: "teams", title: "Teams" },
  { path: "machines", title: "Machines" },
] as const;
export type WorkspaceTab = (typeof PAGES)[number]["path"];
/** The Workspace page itself: its route opens the first tab that is shown. */
export const WORKSPACE = { path: "workspace", title: "Workspace" } as const;

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
 * Lists a feature's own page in the sidebar's block, after the Workspace row, in the order the
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

/** The rows of the sidebar's block: Workspace, then what the features added. */
export const pageLinks = (): readonly PageLink[] => [WORKSPACE, ...added];
/** The home's tiles: one per tab of the Workspace page (each has a count of its own), then what the features added. */
export const pageTiles = (): readonly PageLink[] => [...PAGES, ...added];

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
export function shownPage<Props extends object>(path: string, Page: ComponentType<Props>, /** the sidebar's row that is the open one while this page is drawn (a tab's is Workspace) */ row: string = path): ComponentType<Props> {
  return function ShownPage(props: Props) {
    // A page that is not shown in this release has no route: its path answers one line, with a way back.
    const pages = usePagesShown();
    // Which pages are shown is not known until bb has read the settings: nothing is drawn till
    // then, so a page that IS shown never says for a moment that it is not.
    if (!pages.known) return null;
    return pages.has(path) ? createElement(Open<Props>, { path: row, Page, props }) : createElement(NotShown, { path });
  };
}

/** How many pages that are drawn now mark each row as the open one. */
const drawn = new Map<string, number>();
/** The page itself, marked as the open one while it is drawn. */
function Open<Props extends object>({ path, Page, props }: { path: string; Page: ComponentType<Props>; props: Props }) {
  useEffect(() => {
    drawn.set(path, (drawn.get(path) ?? 0) + 1);
    setOpen(path);
    // Only the LAST page that marks this row takes the selection away, and only while the row is still the open one:
    // the next page may have set its own first, and several pages mark ONE row (the Workspace page's four tabs are
    // four routes: where bb draws the next tab before it takes the last one away, the row stays the selected one).
    return () => {
      const left = (drawn.get(path) ?? 1) - 1;
      if (left > 0) drawn.set(path, left);
      else drawn.delete(path);
      if (left === 0 && open === path) setOpen(null);
    };
  }, [path]);
  return createElement(Page, props);
}

/** What the path of a page that is not shown answers: that it is not shown, and the way back. */
function NotShown({ path }: { path: string }) {
  const navigate = useBbNavigate();
  const home = usePageShown("home");
  return createElement(
    "div",
    { "data-testid": "oats-page-not-shown", "data-page": path, className: "flex flex-col items-start gap-3 p-4 text-sm text-foreground" },
    createElement("p", null, "This page is not shown in this release of the OATS plugin."),
    createElement(
      "button",
      {
        type: "button",
        "data-testid": "oats-page-not-shown-back",
        className: "inline-flex min-h-11 items-center rounded-md border border-border bg-card px-3 text-sm font-semibold text-foreground hover:bg-accent md:min-h-8",
        onClick: () => (home && path !== "home" ? navigate.toPluginPanel("home") : window.history.back()),
      },
      home && path !== "home" ? "Back to Home" : "Back",
    ),
  );
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

// ---- which pages are shown (the plugin's setting `pages`) ----
// A deployment shows the pages its setting names; the default leaves out the one that is not finished
// (Automations: built and tested, and left out of the navigation). One switch, read here by every place that links to a page or is one.

/** The ids a page can have in the setting `pages`. The default shows the home and the Workspace page's four tabs (the ruling's R5); Automations is not in it. */
export const PAGE_IDS = ["home", "automations", "souls", "capabilities", "teams", "machines"] as const;
/** The Workspace page is shown where any of its tabs is. */
const shows = (ids: { has(id: string): boolean }, id: string): boolean => (id === WORKSPACE.path ? PAGES.some((page) => ids.has(page.path)) : ids.has(id));
/** For the unit tests alone: an unset `pages` stands for every page, a feature's own included. */
let everyPageWhenUnset = false;
/**
 * The unit tests' harness gives a slot no settings unless a test names them. There an unset
 * `pages` stands for a deployment that shows every page, so that each page's tests run
 * (test/helpers/render.ts); a test of a deployment that shows the home alone names `settings: { pages: "home" }`,
 * and one of the release's default turns this off.
 */
export function showEveryPageWhenUnset(on: boolean): void {
  everyPageWhenUnset = on;
}

/**
 * The pages a `pages` value names: its ids, with commas or spaces between them, in any case (the
 * six of PAGE_IDS, and the id of a page a feature adds). The default for a value that is no text
 * (the setting is not set, or bb could not give the settings).
 */
export function pagesShown(value: unknown): { has(id: string): boolean } {
  if (typeof value !== "string" && everyPageWhenUnset) return { has: () => true };
  // (`workspace` is no id of the setting: the page is there while one of its tabs is.)
  // A cleared field is the default, as for every other setting of the plugin.
  const ids = new Set((typeof value === "string" && value.trim() !== "" ? value : DEFAULT_PAGES).split(/[\s,]+/).map((id) => id.trim().toLowerCase()).filter((id) => id !== ""));
  return { has: (id) => shows(ids, id.toLowerCase()) };
}

const NONE = { has: () => false, known: false } as const;

/**
 * The pages shown in this release, from the plugin's settings: `has(id)` for a link to a page, a
 * mark of it, and its own route. `known` is false while bb is still reading the settings: no page
 * is shown till then (a link that appears, never one that is taken away), and a page's own route
 * draws nothing. Settings bb cannot give at all are the default's.
 */
export function usePagesShown(): { has(id: string): boolean; known: boolean } {
  return pagesOf(useSettings());
}
/** The rule of `usePagesShown`, given what bb says of the settings. */
export function pagesOf(settings: { values: Record<string, unknown> | undefined; isLoading: boolean }): { has(id: string): boolean; known: boolean } {
  if (settings.values === undefined && settings.isLoading) return NONE;
  return { ...pagesShown(settings.values?.pages), known: true };
}

/** Whether the page `id` is shown in this release: `usePagesShown().has(id)`, for a place that asks for one. */
export const usePageShown = (id: string): boolean => usePagesShown().has(id);

// ---- "New agent" ----
// The form is the spawn feature's own page. It names how to open it here, in its `register`
// (`setNewAgent(openNewAgent)` of app/spawn); until it does, "New agent" opens the Souls tab (the
// souls, to pick one from), when that tab is shown.
/** Where "New agent" starts: with a soul chosen (its key, as `oats souls` names it), or with none. */
export type NewAgentTarget = { soul?: string };
type OpenNewAgent = (navigate: BbNavigate, target?: NewAgentTarget) => void;
let newAgent: OpenNewAgent | null = null;
export function setNewAgent(open: OpenNewAgent | null): void {
  newAgent = open;
}
/** Opens the New agent form; false when there is nowhere to open it (no feature named one, and the Souls page is not shown). */
export function openNewAgent(navigate: BbNavigate, soulsShown: boolean, target?: NewAgentTarget): boolean {
  if (newAgent !== null) newAgent(navigate, target);
  else if (soulsShown) navigate.toPluginPanel("souls", target?.soul === undefined ? undefined : { subPath: target.soul });
  else return false;
  return true;
}
/** Whether "New agent" has somewhere to open. */
export const hasNewAgent = (soulsShown: boolean): boolean => newAgent !== null || soulsShown;
/**
 * Whether "New agent" is HELD: in its place, off. The ONE rule of every "New agent" there is (the
 * sidebar's, the home's; the lead's ruling T10 on its reader's report, 24 Nov 2026): a button that
 * is off in one place is never live in another. Held while the roster shown is the last one read
 * (`stale`, with the OATS acts), and behind an installed `oats` the plugin does not work with
 * (`cli`, the answer of the one verb `homeCli`: older, a newer API, or a version it cannot tell):
 * a spawn through it is not offered. NOT held while the CLI is not read yet, or its read failed
 * (`cli` undefined): nothing is known against it, and a button that went off at every window's
 * load would blink. Why it is held is said by a notice on the same screen, never beside the button.
 */
export const newAgentHeld = (stale: boolean, cli: { state: string } | undefined): boolean => stale || (cli !== undefined && (cli.state === "older" || cli.state === "unknown" || cli.state === "newer-api"));
