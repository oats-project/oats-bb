// The sidebar and the home on ONE screen (the reader's P13): "New agent" and "No agents yet." stood twice where the
// sidebar is beside the home (a wide window). Each is said once:
// - "New agent" is the SIDEBAR's where the sidebar is beside the home; the home keeps its own where the sidebar is a
//   drawer (a phone's width), or is not known to be there;
// - "No agents yet." is the HOME's while the home says it in view; the sidebar says it beside every other pane.
// A pane cannot see its neighbours, so each says what it knows through this store, the window's own (as the notice's
// count does: app/roster/unreadable.tsx). The home acts ONLY on a positive fact: a sidebar that is SHOWN beside the
// panes. "Mounted and not compact" is not that fact: bb keeps the thread list mounted, and still says "not compact",
// while a person has COLLAPSED its desktop sidebar (it is then out of the window, or invisible and inert): so the
// sidebar looks at its own root (`sidebarShown`) and says "beside" only while it is drawn in the window. Where that is
// not known (the sidebar not mounted yet; a window without it; a place that cannot tell whether it is drawn) the home
// keeps its own button and its own line: a screen with two is better than a screen with none.
import { useEffect, useState, useSyncExternalStore } from "react";
import { onWindowReset } from "../store";

let sidebarsBeside = 0;
let homesSayingEmpty = 0;
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
  changed();
});

/** Counts one place in (while `on`) and out again; the effect of the two announcing hooks, and a test's own hand. */
export function announce(what: "sidebar-beside" | "home-says-empty", on: boolean): () => void {
  if (!on) return () => undefined;
  const by = (n: number) => {
    if (what === "sidebar-beside") sidebarsBeside = Math.max(0, sidebarsBeside + n);
    else homesSayingEmpty = Math.max(0, homesSayingEmpty + n);
    changed();
  };
  by(1);
  return () => by(-1);
}

/** What the store holds now, for a place that is no component (a test). */
export const besideNow = (): { sidebarBeside: boolean; homeSaysEmpty: boolean } => ({ sidebarBeside: sidebarsBeside > 0, homeSaysEmpty: homesSayingEmpty > 0 });

/**
 * Whether the sidebar's root is drawn in the window, for a person to see and press: not under an inert ancestor, not
 * hidden (its own or an ancestor's `visibility` or `display`), and with a box inside the window. Null where the page
 * cannot tell (no `checkVisibility`): the caller then says nothing.
 */
export function sidebarShown(root: HTMLElement): boolean | null {
  if (typeof root.checkVisibility !== "function") return null;
  if (root.closest("[inert]") !== null) return false;
  if (!root.checkVisibility({ visibilityProperty: true })) return false;
  const box = root.getBoundingClientRect();
  return box.width > 0 && box.height > 0 && box.right > 0 && box.left < window.innerWidth;
}

/**
 * The sidebar: it is BESIDE the panes while bb says the viewport is not compact (compact: bb keeps it in a drawer)
 * AND its own root is drawn in the window (bb collapses its desktop sidebar without unmounting it or saying "compact").
 * Looked at again whenever that can change: an attribute of an ancestor (bb's `data-state`, a class, `inert`), the end
 * of a transition (the sidebar slides out), the window's size. → whether it says "beside" now.
 */
export function useAnnounceSidebar(root: HTMLElement | null, compact: boolean): boolean {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    if (root === null || compact) {
      setShown(false);
      return undefined;
    }
    const look = () => setShown(sidebarShown(root) === true);
    look();
    const watch = typeof MutationObserver === "undefined" ? null : new MutationObserver(look);
    for (let above: HTMLElement | null = root; above !== null; above = above.parentElement) watch?.observe(above, { attributes: true });
    document.addEventListener("transitionend", look, true);
    window.addEventListener("resize", look);
    return () => {
      watch?.disconnect();
      document.removeEventListener("transitionend", look, true);
      window.removeEventListener("resize", look);
    };
  }, [root, compact]);
  useEffect(() => announce("sidebar-beside", shown), [shown]);
  return shown;
}
/** For the home: a sidebar is mounted beside it. False where that is not known. */
export const useSidebarBeside = (): boolean => useSyncExternalStore(subscribe, () => sidebarsBeside > 0);

/** The home, while it says "No agents yet." in view. */
export function useAnnounceEmptyHome(saying: boolean): void {
  useEffect(() => announce("home-says-empty", saying), [saying]);
}
/** For the sidebar: a home on this screen says "No agents yet.": the sidebar's own line yields. */
export const useHomeSaysEmpty = (): boolean => useSyncExternalStore(subscribe, () => homesSayingEmpty > 0);
