// Behind a lifecycle result. A result that says an agent started, restarted, stopped or was retired
// is true of the agent NOW; the roster the window holds may be from BEFORE the act ended. So the
// places that say one agent's state (its page, its panel, its thread's line, its thread's menu) do
// not state the old state plainly behind such a result: for THAT agent they say "Reading…" in the
// state's place, with every act of it off, until the window's roster is one READ AFTER THE ACT
// ENDED (the lead's L13, 24 Nov 2026).
//
// ONE question, about the ROSTER, answered directly (the specialist's ruling of 24 Nov 2026, after
// four forms that answered it by proxy: the stamp of the send, the agent's word, the word per act):
// "was this roster read after the act ended?".
// - The roster's `at` is the plugin SERVER's clock at the START of the status read that made it.
// - The act's answer carries the SAME clock at the act's END: `endedAt`, stamped by the server when
//   its `oats` command returned (contract/lifecycle.ts). One process, one clock: the window's clock
//   is in neither, and is never compared.
// - THE RULE, whole: the window is "before" WHILE the roster it holds has `at` <= `endedAt`: a
//   status read that started before the act ended cannot be trusted to hold what the act did.
// Nothing else: no state is kept, no word, no row, no case per act. A row the server PATCHED from
// the agent's own events (#74) on an older roster is still "before" until the status read the act
// itself asks for has come back (a second or two: "Reading…" leaves a moment LATE over a row that
// is already right: the safe side).
// WHERE: every place of the pilot's screens that says one agent's state or offers its acts: its thread's line and
// menu, its page and panel, a command's key, and the home's cards of an agent that runs outside OATS and of a stopped
// agent that asks. NOT the Souls page's detached agents (Start…, Retire…): not a pilot screen, left as it is.
// And it is bounded: after BOUND_MS the roster's own state is drawn whatever it says (a watch that
// died must not leave "Reading…" on a page). The window's memory only.
import { useSyncExternalStore } from "react";
import type { ReactNode } from "react";
import { useOats } from "../oats";
import type { Oats } from "../oats";

/** The Loading pattern's own word. */
export const READING = "Reading…";
/** How long "Reading…" can stand for one act, at most. */
export const BOUND_MS = 10_000;

/**
 * Whether the roster the window holds was read BEFORE an act ended. Pure. `endedAt`: the server's
 * clock when the act's command returned; `rosterAt`: the same clock at the start of the status
 * read that made the roster (null: no roster is read: nothing of the agent is drawn, and nothing
 * is left standing on nothing). Before: the read started at or before the act's end. A stamp that
 * cannot be read as a time settles it as read: nothing is left standing on a guess (the bound
 * would end it anyway).
 */
export function beforeEnd(endedAt: string, rosterAt: string | null): boolean {
  if (rosterAt === null) return false;
  const [ended, read] = [Date.parse(endedAt), Date.parse(rosterAt)];
  return !Number.isNaN(ended) && !Number.isNaN(read) && read <= ended;
}

type Acted = { endedAt: string; timer: ReturnType<typeof setTimeout> };
let acted: ReadonlyMap<string, Acted> = new Map();
const watchers = new Set<() => void>();
const set = (next: ReadonlyMap<string, Acted>) => {
  acted = next;
  for (const watcher of watchers) watcher();
};
const drop = (instance: string, entry: Acted) => {
  if (acted.get(instance) !== entry) return;
  const next = new Map(acted);
  next.delete(instance);
  set(next);
};

/**
 * A lifecycle result says these agents started, restarted, stopped or were retired (every agent the
 * result names: a stop's or a retire's children too). `endedAt`: when the act ended, on the
 * server's clock, as its answer says.
 */
export function noteActed(instances: readonly string[], endedAt: string): void {
  if (instances.length === 0) return;
  const next = new Map(acted);
  for (const instance of instances) {
    const before = next.get(instance);
    if (before !== undefined) clearTimeout(before.timer);
    const entry: Acted = { endedAt, timer: setTimeout(() => drop(instance, entry), BOUND_MS) };
    next.set(instance, entry);
  }
  set(next);
}

/** When the act noted for an agent ended, while its mark stands (until the bound): null for an agent with none. */
export const actedAt = (instance: string): string | null => acted.get(instance)?.endedAt ?? null;

/** For a test: the page loads again. */
export function forgetActed(): void {
  for (const entry of acted.values()) clearTimeout(entry.timer);
  set(new Map());
}

/** Whether an agent is behind a result now, over this roster: for a place that is no component of one agent (the thread's menu, a command's key). Never while OATS cannot be read. */
export function readingNow(oats: Oats, instance: string): boolean {
  const entry = acted.get(instance);
  return entry !== undefined && oats.phase === "ready" && oats.stale === null && beforeEnd(entry.endedAt, oats.at);
}
/** The marks as they stand: a place that asks `readingNow` in a draw reads this, so that it is drawn again when a mark comes or goes. */
export function useActed(): unknown {
  return useSyncExternalStore(
    (watcher) => {
      watchers.add(watcher);
      return () => watchers.delete(watcher);
    },
    () => acted,
  );
}

/**
 * Whether a place that says this agent's state says "Reading…" instead: a result said it changed,
 * and the window's roster is not yet one read after that act ended. Never while OATS cannot be read (the
 * roster is the last one read: its notice says so, with its age).
 */
export function useReading(instance: string | null): boolean {
  const oats = useOats();
  const all = useSyncExternalStore(
    (watcher) => {
      watchers.add(watcher);
      return () => watchers.delete(watcher);
    },
    () => acted,
  );
  const entry = instance === null ? undefined : all.get(instance);
  return entry !== undefined && instance !== null && oats.phase === "ready" && oats.stale === null && beforeEnd(entry.endedAt, oats.at);
}

/**
 * A ROW's place for what it says of its agent (the sidebar's rows; the home's rows) while that agent is behind a result:
 * the word alone, in the facts' place. No state's word, no soul, no reason: the roster the row is drawn from is from
 * before the act, and after a Stop that archived the agent's thread its row read "Idle · … · may still run", in the
 * warning tone, beside "3 sessions stopped." (the second look's sixth item, 25 Nov 2026).
 */
export function ReadingFacts({ testId = "oats-row-reading", className = "" }: { testId?: string; className?: string }) {
  return (
    <span role="status" data-testid={testId} data-reading="" className={`min-w-0 whitespace-nowrap text-xs text-muted-foreground ${className}`}>
      {READING}
    </span>
  );
}
/** That row's mark: plain. No state's colour and no warning tone (it says no state: `data-state` is not set); hidden from a screen reader, as a row's mark is (the word says it). */
export function ReadingMark() {
  return <span aria-hidden data-mark="" data-reading="" className="inline-block size-2 shrink-0 rounded-full border border-muted-foreground" />;
}

/** The status line's place while the agent's state is being read again: the word, and the place's own buttons (off, where they are acts). */
export function ReadingLine({ action }: { action?: ReactNode }) {
  return (
    <div data-testid="oats-status-line" data-reading="" className="-m-1 min-w-0 overflow-hidden p-1 text-sm text-foreground">
      <div className="flex min-w-0 flex-wrap items-center gap-y-1">
        <span role="status" aria-live="polite" data-testid="oats-reading" className="text-muted-foreground">
          {READING}
        </span>
        {action === undefined || action === null ? null : <span className="ml-auto flex shrink-0 items-center gap-2 pl-4">{action}</span>}
      </div>
    </div>
  );
}
