// The fold of the roster's tree (Joan's word of 24 Nov 2026: children collapsed by default). Which
// rows are drawn is the model's (model/view.ts `treeRows`, keyed by the agent's instance); here:
// - the window's memory of which parents the person opened: empty when the page loads, kept as the
//   person left it while the window lives (the sidebar is drawn anew when bb's drawer opens: the
//   memory is not the component's), and stored nowhere: no setting, no bb storage;
// - the chevron, a button of its own before a parent's mark;
// - a parent row's keys: Right opens it, Left closes it, as a tree's do.
// For every kind of row: a thread's, and one with no bb thread.
import { useSyncExternalStore } from "react";
import type { KeyboardEvent } from "react";

/**
 * A roster with a parent in it keeps a gutter before every row for the parent's chevron, so that
 * every row's mark stands in one column: each depth one chevron's width further in (`GUTTERED`,
 * in the place of the row's own indent), and the chevron in the gutter of its own depth.
 */
export const GUTTERED = ["pl-6", "pl-10", "pl-14"] as const;
const CHEVRON_AT = ["left-0", "left-4", "left-8"] as const;

let opened: ReadonlySet<string> = new Set();
const watchers = new Set<() => void>();

/** The parents the person opened, by instance. */
export function useOpened(): ReadonlySet<string> {
  return useSyncExternalStore(
    (watcher) => {
      watchers.add(watcher);
      return () => watchers.delete(watcher);
    },
    () => opened,
  );
}

/** The person opens or closes a parent. */
export function setOpened(instance: string, open: boolean): void {
  if (opened.has(instance) === open) return;
  const next = new Set(opened);
  if (open) next.add(instance);
  else next.delete(instance);
  opened = next;
  for (const watcher of watchers) watcher();
}

/** For a test: the page loads again. */
export function forgetOpened(): void {
  opened = new Set();
  for (const watcher of watchers) watcher();
}

/**
 * A parent's chevron: ONE button, before the row's mark, not part of the row's link (it is drawn
 * over the row's gutter, and its `li` is `relative`); as high as the row, so as a control is. It
 * says whose agents it shows or hides, and whether they are shown (`aria-expanded`). The mark is
 * the pattern book's for something that opens (ui `Disclosure`), turned while it is open.
 */
export function FoldToggle({ instance, name, open, depth }: { instance: string; /** the agent's name as words */ name: string; open: boolean; depth: 0 | 1 | 2 }) {
  return (
    <button
      type="button"
      data-testid="oats-row-toggle"
      data-instance={instance}
      aria-expanded={open}
      aria-label={`${open ? "Hide" : "Show"} ${name}'s agents`}
      className={`absolute top-0 z-10 flex h-full w-6 items-center justify-center rounded-md text-muted-foreground hover:text-foreground ${CHEVRON_AT[depth]}`}
      onClick={() => setOpened(instance, !open)}
    >
      <span aria-hidden="true" className={`inline-block transition-transform ${open ? "rotate-90" : ""}`}>
        ▸
      </span>
    </button>
  );
}

/** A parent row's own keys: Right opens it while it is closed, Left closes it while it is open; every other key is the row's. */
export const foldKeys = (instance: string, open: boolean) => (event: KeyboardEvent) => {
  if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
  if ((event.key === "ArrowRight" && !open) || (event.key === "ArrowLeft" && open)) {
    event.preventDefault();
    setOpened(instance, !open);
  }
};
