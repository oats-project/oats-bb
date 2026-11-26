// The runs of the automations, as the Runs tables draw them: a schedule's kept runs, a trigger's
// fires and, where the kernel keeps them, its failed spawns, each as one entry, and all of them
// merged newest first. Pure, like everything in model/: no bb, no React. The kernel has no single
// read of "all runs": the merge here is of what each automation keeps (a schedule's newest 50
// runs, a trigger's newest 50 fires and 50 failures), so it is bounded by that and says so
// (`cut`), never by a time.
import type { AutomationRow, AutomationRun, TriggerFailure, TriggerStatus, TriggerStatuses } from "../contract/automations.js";

type Fired = TriggerStatus["fired"][number];
type Pending = TriggerStatus["pending"][number];
/** The automation an entry belongs to: its kind, its qualified id (its address) and its name. */
export type RunOwner = Pick<AutomationRow, "kind" | "id" | "name">;
/** One row of a Runs table: a schedule's run, a trigger's fire, or a trigger's failed spawn. */
export type RunEntry =
  | { of: "run"; owner: RunOwner; at: string | null; run: AutomationRun }
  | { of: "fired"; owner: RunOwner; at: string | null; fired: Fired }
  | { of: "failure"; owner: RunOwner; at: string | null; failure: TriggerFailure }
  /** A schedule's launch with no recorded result (the kernel's `attempt`, where the history holds no run of that start): under way (`running`: the job's lock is held), or one whose state nobody knows. On the automation's own page only. */
  | { of: "attempt"; owner: RunOwner; at: string | null; running: boolean; error: string | null }
  /** A trigger's event that waits to fire. On the automation's own page only. */
  | { of: "pending"; owner: RunOwner; at: string | null; pending: Pending }
  /** A schedule's wake that waits to be delivered. On the automation's own page only. */
  | { of: "wake"; owner: RunOwner; at: string | null };

const ownerOf = (row: AutomationRow): RunOwner => ({ kind: row.kind, id: row.id, name: row.name });
/** When a schedule's run happened: its start, else the minute it was due. */
export const runAt = (run: AutomationRun): string | null => run.startedAt ?? run.scheduledFor ?? run.at;
const time = (entry: RunEntry): number => {
  const at = Date.parse(entry.at ?? "");
  return Number.isFinite(at) ? at : -Infinity;
};
/** Newest first; an entry whose time cannot be read sorts last, and equal times keep the order given. */
const newestFirst = (entries: RunEntry[]): RunEntry[] =>
  entries
    .map((entry, index) => ({ entry, index }))
    .sort((a, b) => time(b.entry) - time(a.entry) || a.index - b.index)
    .map(({ entry }) => entry);

/** A schedule's kept runs, as the kernel orders them (newest first). */
export const scheduleRuns = (row: AutomationRow): RunEntry[] => row.recentRuns.map((run) => ({ of: "run", owner: ownerOf(row), at: runAt(run), run }));

/** A trigger's fires and, where the kernel keeps them (`failures` is not null), its failed spawns: one table, newest first. */
export function triggerRuns(row: AutomationRow, status: TriggerStatus): RunEntry[] {
  const owner = ownerOf(row);
  return newestFirst([
    ...status.fired.map((fired): RunEntry => ({ of: "fired", owner, at: fired.at, fired })),
    ...(status.failures ?? []).map((failure): RunEntry => ({ of: "failure", owner, at: failure.at, failure })),
  ]);
}

/**
 * Whether an automation keeps less than it ran: a schedule whose history says older runs were
 * dropped, a trigger that fired or failed more often than its state lists.
 */
export const scheduleCut = (row: AutomationRow): boolean => row.history?.truncated === true;
export const triggerCut = (status: TriggerStatus): boolean =>
  (status.firedTotal !== null && status.firedTotal > status.fired.length) || (status.failures !== null && status.failuresTotal !== null && status.failuresTotal > status.failures.length);

/**
 * Every automation's runs in one list, newest first. `cut` is true where at least one automation
 * keeps less than it ran: the list is then not all there was; `cuts` says which. A trigger with no state read
 * (`statuses` does not name it) adds nothing.
 */
export function allRuns(schedules: readonly AutomationRow[], triggers: readonly AutomationRow[], statuses: TriggerStatuses): { entries: RunEntry[]; cut: boolean; cuts: Map<string, number | null> } {
  const byId = new Map(statuses.map((entry) => [entry.id, entry.status]));
  const entries: RunEntry[] = schedules.flatMap(scheduleRuns);
  // Which automation keeps less than it ran (by `kind:id`), with the kernel's count where it gives one: for a table of one automation's runs.
  const cuts = new Map<string, number | null>(schedules.filter(scheduleCut).map((row) => [`${row.kind}:${row.id}`, null]));
  for (const row of triggers) {
    const status = byId.get(row.id);
    if (status === undefined) continue;
    entries.push(...triggerRuns(row, status));
    if (triggerCut(status)) cuts.set(`${row.kind}:${row.id}`, droppedCount(status));
  }
  return { entries: newestFirst(entries), cut: cuts.size > 0, cuts };
}

/**
 * The Runs table of ONE automation's page: what is under way or waits first (a schedule's launch
 * with no recorded result; a trigger's waiting events, newest observed first), then its kept runs.
 * A trigger whose state is not read yet (`status` null) has none to show.
 */
export function pageRuns(row: AutomationRow, status: TriggerStatus | null): RunEntry[] {
  const owner = ownerOf(row);
  if (row.kind === "schedule") {
    // A launch with no recorded result. One whose run the history already holds (the same start) is that run's row, not a second one.
    const attempt = row.attempt;
    const recorded = attempt !== null && row.recentRuns.some((run) => (attempt.startedAt !== null && run.startedAt === attempt.startedAt) || (attempt.startedAt === null && attempt.scheduledFor !== null && run.scheduledFor === attempt.scheduledFor));
    const open: RunEntry[] = attempt === null || recorded ? [] : [{ of: "attempt", owner, at: attempt.startedAt ?? attempt.scheduledFor, running: row.running, error: attempt.error }];
    const wake: RunEntry[] = row.pendingWake === null ? [] : [{ of: "wake", owner, at: row.pendingWake.scheduledFor }];
    return [...open, ...wake, ...scheduleRuns(row)];
  }
  if (status === null) return [];
  return [...status.pending.map((pending): RunEntry => ({ of: "pending", owner, at: pending.observedAt, pending })), ...triggerRuns(row, status)];
}

/** How many more runs an automation ran than it keeps, where the kernel gives the count (a trigger's fires and failures); null where it says only that some were dropped, or nothing. */
export function droppedCount(status: TriggerStatus): number | null {
  const fired = status.firedTotal !== null ? Math.max(0, status.firedTotal - status.fired.length) : 0;
  const failed = status.failures !== null && status.failuresTotal !== null ? Math.max(0, status.failuresTotal - status.failures.length) : 0;
  return fired + failed > 0 ? fired + failed : null;
}
