// The sidebar and the home on ONE screen (the reader's P13): "New agent" and "No agents yet." stood twice where the
// sidebar is beside the home (a wide window). Each is said once:
// - "New agent" is the SIDEBAR's where the sidebar is beside the home; the home keeps its own where the sidebar is a
//   drawer (a phone's width), or is not known to be there;
// - "No agents yet." is the HOME's while the home says it in view; the sidebar says it beside every other pane.
// A pane cannot see its neighbours, so each says what it knows through this store, the window's own (as the notice's
// count does: app/roster/unreadable.tsx). The home acts ONLY on a positive fact: a sidebar that is mounted and that bb
// says is not compact. Where that is not known (the sidebar not mounted yet; a window without it) the home keeps its own
// button and its own line: a screen with two is better than a screen with none.
import { useEffect, useSyncExternalStore } from "react";
import { onWindowReset } from "../store";

let sidebarsBeside = 0;
let homesSayingEmpty = 0;
let homesHolding = 0;
const listeners = new Set<() => void>();
const changed = () => {
  for (const listener of listeners) listener();
};
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};
onWindowReset(() => {
  sidebarsBeside = 0;
  homesSayingEmpty = 0;
  homesHolding = 0;
  changed();
});

/** Counts one place in (while `on`) and out again; the effect of the two announcing hooks, and a test's own hand. */
export function announce(what: "sidebar-beside" | "home-says-empty" | "home-holds-new-agent", on: boolean): () => void {
  if (!on) return () => undefined;
  const by = (n: number) => {
    if (what === "sidebar-beside") sidebarsBeside = Math.max(0, sidebarsBeside + n);
    else if (what === "home-says-empty") homesSayingEmpty = Math.max(0, homesSayingEmpty + n);
    else homesHolding = Math.max(0, homesHolding + n);
    changed();
  };
  by(1);
  return () => by(-1);
}

/** What the store holds now, for a place that is no component (a test). */
export const besideNow = (): { sidebarBeside: boolean; homeSaysEmpty: boolean; homeHolds: boolean } => ({ sidebarBeside: sidebarsBeside > 0, homeSaysEmpty: homesSayingEmpty > 0, homeHolds: homesHolding > 0 });

// The home's "New agent" is OFF behind its card of an oats CLI this plugin does not work with (the card says why). Where
// the sidebar's button is the screen's one, it is held by the same fact: the home, which read the CLI, says so here, and
// the card that says why is on the same screen.
/** The home, in view, while its CLI card holds New agent. */
export function useAnnounceHomeHolds(holding: boolean): void {
  useEffect(() => announce("home-holds-new-agent", holding), [holding]);
}
/** For the sidebar: a home on this screen holds New agent behind its CLI card. */
export const useHomeHolds = (): boolean => useSyncExternalStore(subscribe, () => homesHolding > 0);

/** The sidebar, mounted: it is BESIDE the panes while bb says the viewport is not compact (compact: bb keeps it in a drawer). */
export function useAnnounceSidebar(compact: boolean): void {
  useEffect(() => announce("sidebar-beside", !compact), [compact]);
}
/** For the home: a sidebar is mounted beside it. False where that is not known. */
export const useSidebarBeside = (): boolean => useSyncExternalStore(subscribe, () => sidebarsBeside > 0);

/** The home, while it says "No agents yet." in view. */
export function useAnnounceEmptyHome(saying: boolean): void {
  useEffect(() => announce("home-says-empty", saying), [saying]);
}
/** For the sidebar: a home on this screen says "No agents yet.": the sidebar's own line yields. */
export const useHomeSaysEmpty = (): boolean => useSyncExternalStore(subscribe, () => homesSayingEmpty > 0);
