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
import { StateMark } from "../ui";
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
export function FoldToggle({
  instance,
  name,
  open,
  pinned = false,
  depth,
  inside = null,
  insideTone = null,
  insideSays = null,
  insideAsks = 0,
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
  /** How many hidden rows ask (their state is needs-you): the toggle's name says the count. */
  insideAsks?: number;
}) {
  // Only a CLOSED parent hides rows: open, each row carries its own mark.
  const hides = open ? null : inside;
  const says = pinned ? `${name}'s agents shown` : `${open ? "Hide" : "Show"} ${name}'s agents`;
  // WHAT A CLOSED PARENT SAYS OF THE ROWS IT HIDES (the lead's ruling of 25 Nov 2026, after its reader's second look):
  // - THE CHEVRON NEVER LEAVES a row that has children: it is what says the row opens. On the row, in this order: the
  //   chevron, the hidden rows' mark, the parent's own dot.
  // - a hidden row that ASKS (its state is needs-you): that row's own mark BESIDE the chevron, after it (the needs-you
  //   disc with its "!"): found without colour;
  // - a hidden row that failed or cannot be reached, or that runs outside OATS or warns, with nobody asking: NO second
  //   dot (two plain dots side by side read as one more state of the parent, told apart by colour alone): the CHEVRON
  //   itself takes the tone: the failure's for the first two, the warning's for the others;
  // - the chevron and the mark are ONE button: pressing either opens the row;
  // - its name and title say what is inside, in words: how many hidden rows ask ("1 needs you"); in the tone cases
  //   what that row itself says (a failed or unreachable row: its state's name; a row in the warning tone: its own
  //   words, as the row draws them: "Stopped · may still run", "Running outside OATS");
  // - opened, the marks leave: the rows show their own.
  const asks = hides === "needs-you";
  const tone = hides === null || asks ? "" : hides === "error" || hides === "unreachable" ? "text-destructive-text" : insideTone === "warning" ? "text-warning-text" : "";
  const inWords = hides === null ? "" : asks ? `${insideAsks} ${insideAsks > 1 ? "need" : "needs"} you` : insideTone === "warning" && insideSays !== null && insideSays !== "" ? insideSays : STATE[hides].name;
  const label = hides === null ? says : `${says}: ${inWords}`;
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
      className={`absolute top-0 z-10 flex h-full w-6 items-center ${asks ? "justify-start" : "justify-center"} rounded-md text-muted-foreground hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:text-muted-foreground ${CHEVRON_AT[depth]}`}
      onClick={() => setOpened(instance, !open)}
    >
      {/* Two marks, never one turned: closed points RIGHT, open points DOWN (the off one is drawn as open). No rotation
          and no transition (a turned glyph was caught mid-turn, pointing left, and sat askew at a phone's width). Its
          box is one size at every width, the mark centred in it. BESIDE A HIDDEN ROW's MARK the gutter's 24 px hold
          both: the chevron at the gutter's start in a box as wide as its glyph (8 px), the mark right after it (12 px),
          and the 4 px that are left stand between that mark and the parent's own dot: the mark belongs to the chevron,
          not to the parent's mark (flush against it, it read as the parent asking). So the chevron of such a row
          stands a few pixels left of a plain parent's. */}
      <span
        aria-hidden="true"
        data-testid="oats-row-toggle-mark"
        data-open={open ? "true" : "false"}
        {...(hides === null ? {} : { "data-inside": hides, ...(insideTone === "warning" ? { "data-tone": "warning" } : {}) })}
        className={["inline-flex items-center justify-center text-xs leading-none", asks ? "h-4 w-2" : "size-4", tone === "" ? "" : `font-bold ${tone}`].filter((part) => part !== "").join(" ")}
      >
        {open ? CHEVRON_OPEN : CHEVRON_CLOSED}
      </span>
      {asks ? (
        <span aria-hidden="true" data-testid="oats-row-toggle-inside" className="inline-flex w-3 items-center justify-center">
          <StateMark state={hides as AgentState} hidden />
        </span>
      ) : null}
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
