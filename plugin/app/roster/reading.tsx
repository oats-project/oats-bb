// Behind a lifecycle result. A result that says an agent started, restarted, stopped or was retired
// is true of the agent NOW; the roster the window holds is from BEFORE the act until it is read
// again (its watch brings it within seconds). So the places that say one agent's state (its page,
// its panel, its thread's line) do not state the old state plainly behind such a result: for THAT
// agent they say "Reading…" in the state's place, with its acts off, until the window's roster is
// one read after the act (the lead's L13, 24 Nov 2026).
//
// Rosters are compared, never clocks: the roster's `at` is the server's stamp, and the window's
// clock is another machine's. What is kept is the `at` of the roster the window held when the act
// was SENT, the act, and the STATE each agent of the act had in it where the act must change that
// word. For such an agent "Reading…" stands until its state in the window's roster says that the
// act happened (a stop: Stopped; a retire: gone; a start: neither Stopped nor Failed), whatever the
// roster's stamp: a roster can reach the window DURING an act that takes seconds and still say
// that the agent runs (the first review round); a bb agent's word can change with bb's own thread
// list while its row has not (the second); and the server can patch the row on the roster of the
// send (#74). Where no state is kept (a restart: the same word before and after) "Reading…" stands
// while the window's roster is still the one of the send, or an older one.
// And it is bounded: after BOUND_MS the roster's own state is drawn whatever it says (a watch that
// died must not leave "Reading…" on a page). The window's memory only.
import { useSyncExternalStore } from "react";
import type { ReactNode } from "react";
import type { AgentState } from "../../model/types";
import { state as stateOf } from "../../model/view";
import { useOats } from "../oats";
import type { Oats } from "../oats";

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

/** The acts whose result marks an agent. */
export type ActVerb = "stop" | "start" | "restart" | "retire";

/**
 * Whether the roster's ROW says that the act happened to the agent: a stop's agent reads Stopped; a
 * retire's is gone from the roster (null); a start's reads neither Stopped nor Failed. (A restart
 * has no such word: the same before and after.) Pure.
 */
export function ended(verb: ActVerb, now: AgentState | null): boolean {
  if (verb === "stop") return now === "stopped";
  if (verb === "retire") return now === null;
  if (verb === "start") return now !== null && now !== "stopped" && now !== "error";
  return false;
}

/**
 * Whether the window still shows an agent as it was before an act. Pure. `sentAt`, `was` and
 * `verb`: the stamp of the roster held when the act was sent, the agent's state in it where one is
 * kept (null: none: a restart, a stop of a stopped target), and the act; `rosterAt` and `now`: the
 * stamp of the roster the window holds (null: none is read: nothing is drawn of the agent, and
 * nothing is left standing on nothing), and the agent's state in it (null: it is not in the roster).
 *
 * Where a state is kept, "before" lasts until the agent's state says that the ACT HAPPENED (`ended`),
 * whatever the roster's stamp. Not "until the state differs from the kept one": an agent on a bb
 * thread reads Working or Idle by bb's own status of its thread, and a stop archives that thread, so
 * on the very roster of the send it already reads "Idle" with its acts on, behind "… stopped." (the
 * second review round's finding). And not the stamp: the server patches a row from the agent's own
 * events and keeps the roster's stamp (#74), so the roster of the send can already say Stopped: that
 * is read. Where no state is kept, the stamp's rule alone.
 */
export function fromBefore(acted: { sentAt: string; was: AgentState | null; verb: ActVerb | null }, rosterAt: string | null, now: AgentState | null): boolean {
  if (acted.was === null || acted.verb === null) return beforeAct(acted.sentAt, rosterAt);
  return rosterAt !== null && !ended(acted.verb, now);
}

/**
 * The state to keep for an agent of an act, from its state at the send: only where the act MUST
 * change the word, so that a later roster saying the same word means "not read yet". A stop changes
 * every state but "stopped" (a target that was already stopped stays that word); a start changes
 * "stopped" and "error" (an agent that reads Idle with no harness loaded, or Needs you with its
 * claim kept, can read the same after); a retire changes every state (the agent leaves the
 * roster); a restart none (the same word after). Null: the stamp's rule alone, never ten seconds of "Reading…" over
 * a state that will not change (the first review round's delta read).
 */
export function keptState(verb: ActVerb, was: AgentState | null): AgentState | null {
  if (was === null || verb === "restart") return null;
  if (verb === "stop") return was === "stopped" ? null : was;
  if (verb === "start") return was === "stopped" || was === "error" ? was : null;
  return was;
}

/** An agent's state in the roster the window holds, as every place says it; null where the roster has no such agent (or none is read). */
export function stateIn(oats: Oats, instance: string): AgentState | null {
  if (oats.phase !== "ready") return null;
  const node = oats.nodeByInstance.get(instance);
  if (node !== undefined) return node.state;
  const agent = oats.agents.find((each) => each.instance === instance);
  return agent === undefined ? null : stateOf(agent, null);
}

type Acted = { sentAt: string; was: AgentState | null; verb: ActVerb | null; timer: ReturnType<typeof setTimeout> };
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
 * stamp of the roster the window held when the act was sent (null: it held none: nothing to mark);
 * `kept`: the act, and each agent's state in that roster where one is kept (`keptState`). Absent, or
 * with no entry for an agent: the stamp alone decides, as for a restart.
 */
export function noteActed(instances: readonly string[], sentAt: string | null, kept?: { verb: ActVerb; was: ReadonlyMap<string, AgentState | null> }): void {
  if (sentAt === null || instances.length === 0) return;
  const next = new Map(acted);
  for (const instance of instances) {
    const before = next.get(instance);
    if (before !== undefined) clearTimeout(before.timer);
    const was = kept?.was.get(instance) ?? null;
    const entry: Acted = { sentAt, was, verb: was === null ? null : (kept?.verb ?? null), timer: setTimeout(() => drop(instance, entry), BOUND_MS) };
    next.set(instance, entry);
  }
  set(next);
}

/** The stamp noted for an agent a result said changed, while it stands (until the bound): null for an agent with none. */
export const actedAt = (instance: string): string | null => acted.get(instance)?.sentAt ?? null;
/** The state kept for that agent, as it was when the act was sent; null where none is kept (no mark, or a restart). */
export const actedWas = (instance: string): AgentState | null => acted.get(instance)?.was ?? null;

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
  return entry !== undefined && instance !== null && oats.phase === "ready" && oats.stale === null && fromBefore(entry, oats.at, stateIn(oats, instance));
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
