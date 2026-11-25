// Which agent's own page is on screen (app/panel AgentPage), for the sidebar: the roster's tree
// keeps the parents of the row a person is on open (model/view.ts `treeRows`' `selected`), and a
// row with no bb thread is "on screen" when its agent's page is. bb tells the sidebar the open
// THREAD and nothing of a plugin page, so the page says it itself while it is drawn.
import { useEffect, useSyncExternalStore } from "react";

let open: string | null = null;
/** The page that said it last: the one on screen. A page that leaves takes the word away only while it is still that one. */
let holder: object | null = null;
const watchers = new Set<() => void>();
const set = (instance: string | null) => {
  if (open === instance) return;
  open = instance;
  for (const watcher of watchers) watcher();
};

/** The instance whose page is drawn now, or null: a thread, another page, or nothing of an agent's is shown. */
export function useOpenAgent(): string | null {
  return useSyncExternalStore(
    (watcher) => {
      watchers.add(watcher);
      return () => watchers.delete(watcher);
    },
    () => open,
  );
}

/**
 * For an agent's page: while it is drawn, `instance` is the agent on screen (null: the page names
 * none). Only the page that is still the one on screen takes it away: the next may have said its
 * own first, and it may name the SAME agent (so it is the page that is held, not the name).
 */
export function useSayOpenAgent(instance: string | null): void {
  useEffect(() => {
    const mine = {};
    holder = mine;
    set(instance);
    return () => {
      if (holder !== mine) return;
      holder = null;
      set(null);
    };
  }, [instance]);
}

/** For a test: the page loads again. */
export function forgetOpenAgent(): void {
  holder = null;
  set(null);
}
