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
import type { AgentState } from "../../model/types";
import { STATE } from "../ui/words";

/**
 * A roster with a parent in it keeps a gutter before every row for the parent's chevron, so that
 * every row's mark stands in one column: each depth one chevron's width further in (`GUTTERED`,
 * in the place of the row's own indent), and the chevron in the gutter of its own depth.
 */
export const GUTTERED = ["pl-6", "pl-10", "pl-14"] as const;
/** The chevron's two marks: a closed parent's points right, an open one's points down. */
export const CHEVRON_CLOSED = "▸";
export const CHEVRON_OPEN = "▾";
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
 * says whose agents it shows or hides, and whether they are shown (`aria-expanded`). Its mark
 * points right while it is closed and down while it is open.
 * `pinned`: the parent holds the row that is open on screen, so it is never closed over it: the
 * chevron is drawn open and OFF (a button that swallows a press is a flaw): disabled, in the
 * pattern book's form for an off control, out of the tab order, and its name says that the agents
 * are shown, not an act. It is live again the moment another row is on screen.
 */
/** The chevron's colour where a closed parent hides a row that carries a mark: that mark's own (the lead's T1: the mark is ON the chevron, never after the parent's state word, which says only the parent). */
const INSIDE: Record<AgentState, string> = {
  "needs-you": "text-warning-text",
  outside: "text-warning-text",
  error: "text-destructive-text",
  unreachable: "text-destructive-text",
  working: "text-success-foreground",
  idle: "",
  stopped: "",
};

export function FoldToggle({
  instance,
  name,
  open,
  pinned = false,
  depth,
  inside = null,
  insideTone = null,
  insideSays = null,
}: {
  instance: string;
  /** the agent's name as words */ name: string;
  open: boolean;
  pinned?: boolean;
  depth: 0 | 1 | 2;
  /** A closed parent: the state of the most urgent row it hides (`insideOf`); null where every hidden row is quiet. */
  inside?: AgentState | null;
  /** "warning": that row's own mark is drawn in the warning tone. */
  insideTone?: "warning" | null;
  /** That row's own words, as the row draws them ("Stopped · may still run"): the chevron's name over a row that WARNS. */
  insideSays?: string | null;
}) {
  // Only a CLOSED parent hides rows: open, each row carries its own mark.
  const hides = open ? null : inside;
  const says = pinned ? `${name}'s agents shown` : `${open ? "Hide" : "Show"} ${name}'s agents`;
  // Named for a screen reader and a pointer: a colour alone says nothing. Over a row that asks: the state's own name
  // ("Needs input"). Over a row that WARNS, the tone is a colour too, and the state's name says nothing of the warning:
  // the name says what that row itself says, its state's word and its reason ("Stopped · may still run"), so a screen
  // reader hears what a sighted person reads once the row is shown (ruled 25 Nov 2026; no word of its own).
  const label = hides === null ? says : `${says}: ${insideTone === "warning" && insideSays !== null && insideSays !== "" ? insideSays : STATE[hides].name}`;
  return (
    <button
      type="button"
      data-testid="oats-row-toggle"
      data-instance={instance}
      aria-expanded={open}
      aria-label={label}
      title={hides === null ? undefined : label}
      disabled={pinned}
      aria-disabled={pinned ? true : undefined}
      className={`absolute top-0 z-10 flex h-full w-6 items-center justify-center rounded-md text-muted-foreground hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:text-muted-foreground ${CHEVRON_AT[depth]}`}
      onClick={() => setOpened(instance, !open)}
    >
      {/* Two marks, never one turned: closed points RIGHT, open points DOWN (the off one is drawn as open). No rotation
          and no transition (a turned glyph was caught mid-turn, pointing left, and sat askew at a phone's width); one
          box of one size at every width, the mark centred in it. */}
      <span
        aria-hidden="true"
        data-testid="oats-row-toggle-mark"
        data-open={open ? "true" : "false"}
        {...(hides === null ? {} : { "data-inside": hides, ...(insideTone === "warning" ? { "data-tone": "warning" } : {}) })}
        className={["inline-flex size-4 items-center justify-center text-xs leading-none", ...(hides === null ? [] : ["font-bold", insideTone === "warning" ? "text-warning-text" : INSIDE[hides]])].filter((part) => part !== "").join(" ")}
      >
        {open ? CHEVRON_OPEN : CHEVRON_CLOSED}
      </span>
    </button>
  );
}

/** A parent row's own keys: Right opens it while it is closed, Left closes it while it is open (never one that holds the row on screen: `pinned`); every other key is the row's. */
export const foldKeys = (instance: string, open: boolean, pinned = false) => (event: KeyboardEvent) => {
  if (pinned || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
  if ((event.key === "ArrowRight" && !open) || (event.key === "ArrowLeft" && open)) {
    event.preventDefault();
    setOpened(instance, !open);
  }
};
