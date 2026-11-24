// Behind a lifecycle result. A result that says an agent started, restarted, stopped or was retired
// is true of the agent NOW; the roster the window holds is from BEFORE the act until it is read
// again (its watch brings it within seconds). So the places that say one agent's state (its page,
// its panel, its thread's line) do not state the old state plainly behind such a result: for THAT
// agent they say "Reading…" in the state's place, with its acts off, until the window's roster is
// one read after the act (the lead's L13, 24 Nov 2026).
//
// Rosters are compared, never clocks: the roster's `at` is the server's stamp, and the window's
// clock is another machine's. What is kept is the `at` of the roster the window held when the act
// was SENT: "Reading…" stands while the window's roster is still that one, or an older one.
// And it is bounded: after BOUND_MS the roster's own state is drawn whatever it says (a watch that
// died must not leave "Reading…" on a page). The window's memory only.
import { useSyncExternalStore } from "react";
import type { ReactNode } from "react";
import { useOats } from "../oats";

/** The Loading pattern's own word. */
export const READING = "Reading…";
/** How long "Reading…" can stand for one act, at most. */
export const BOUND_MS = 10_000;

/**
 * Whether the roster the window holds (`rosterAt`: its server stamp; null while none is read) is
 * still from before an act: the one held when the act was sent (`sentAt`), or an older one. Pure.
 * A stamp that cannot be read as a time settles it as read: nothing is left standing on a guess.
 */
export function beforeAct(sentAt: string, rosterAt: string | null): boolean {
  if (rosterAt === null) return false;
  if (rosterAt === sentAt) return true;
  const [sent, held] = [Date.parse(sentAt), Date.parse(rosterAt)];
  return !Number.isNaN(sent) && !Number.isNaN(held) && held <= sent;
}

type Acted = { sentAt: string; timer: ReturnType<typeof setTimeout> };
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
 * A lifecycle result says these agents started, restarted, stopped or were retired. `sentAt`: the
 * stamp of the roster the window held when the act was sent (null: it held none: nothing to mark).
 */
export function noteActed(instances: readonly string[], sentAt: string | null): void {
  if (sentAt === null || instances.length === 0) return;
  const next = new Map(acted);
  for (const instance of instances) {
    const before = next.get(instance);
    if (before !== undefined) clearTimeout(before.timer);
    const entry: Acted = { sentAt, timer: setTimeout(() => drop(instance, entry), BOUND_MS) };
    next.set(instance, entry);
  }
  set(next);
}

/** The stamp noted for an agent a result said changed, while it stands (until the bound): null for an agent with none. */
export const actedAt = (instance: string): string | null => acted.get(instance)?.sentAt ?? null;

/** For a test: the page loads again. */
export function forgetActed(): void {
  for (const entry of acted.values()) clearTimeout(entry.timer);
  set(new Map());
}

/**
 * Whether a place that says this agent's state says "Reading…" instead: a result said it changed,
 * and the window's roster is not yet one read after that act. Never while OATS cannot be read (the
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
  return entry !== undefined && oats.phase === "ready" && oats.stale === null && beforeAct(entry.sentAt, oats.at);
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
