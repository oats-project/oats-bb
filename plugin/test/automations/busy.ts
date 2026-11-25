// The Automations page's busy set, for the tests that hold it to the worst case (the worst-case
// rule: 37 automations, five failing, some with 50 runs, names of sixty characters). It is made by
// MULTIPLYING the recorded answers (test/fixtures/automations/): every row is a recorded row, as
// the kernel printed it; only its id, its name and, for the ones with a long history, the times and
// ids of its runs are varied. It stands in until the plugin's shared busy set
// (test/fixtures/busy, made by the roster's developer) holds automations: then this file goes.
import type { AutomationList, AutomationRow, TriggerStatuses } from "../../contract/automations";
import { rowOf, schedules, triggers } from "./fixtures";
import { STATUSES } from "./handlers";

const STEMS = [
  "customer-support-inbox-triage-and-first-reply-draft",
  "production-error-log-sweep-and-incident-summary",
  "weekly-release-notes-from-merged-pull-requests",
  "dependency-security-advisories-check-and-upgrade",
  "pull-request-first-review-for-external-contributors",
  "nightly-knowledge-base-checkpoint-and-consolidation",
  "billing-anomaly-detection-on-the-usage-export",
];
const PLACES = ["emea-01", "apac-02", "amer-03", "staging", "canary", "eu-west", "us-east"];
/** A name of exactly sixty characters; seven of them differ only in their last word. */
export const busyName = (at: number): string => `${STEMS[at % STEMS.length]}-${PLACES[Math.floor(at / STEMS.length) % PLACES.length]}-${"x".repeat(60)}`.slice(0, 57) + String(at).padStart(3, "0");

/** The recorded rows the set is made of: five that are failing, and the calm ones it repeats. */
const FAILING_SCHEDULES = ["local/hourly-check", "local/legacy-herdr", "oats-real/reconcile", "oats-real/release-check"];
const CALM_SCHEDULES = ["local/daily-review", "local/notes-checkpoint", "oats-real/nightly-digest", "local/weekly-cleanup", "oats-real/weekly-report", "local/wake-oats-developer-review-202611212017"];
const FAILING_TRIGGERS = ["oats-real/harvest-closed"];
const CALM_TRIGGERS = ["local/pr-triage", "oats-real/proposal-review", "local/graph-watch", "oats-real/harvest-review", "oats-real/docs-review"];

export function busy(): { schedules: AutomationList; triggers: AutomationList; statuses: TriggerStatuses } {
  const recordedSchedules = schedules();
  const recordedTriggers = triggers();
  const recordedStatuses = STATUSES().statuses;
  let at = 0;
  const named = (row: AutomationRow): AutomationRow => {
    const name = busyName(at);
    at += 1;
    return { ...row, id: `${row.id.split("/")[0]}/${name}`, name };
  };
  // Every recorded run, fifty times, a day apart: the history of an automation that has run for weeks.
  const fifty = (row: AutomationRow): AutomationRow => {
    const run = row.recentRuns[0];
    if (run === undefined) return row;
    const start = Date.parse(run.startedAt ?? run.scheduledFor ?? "2026-11-21T20:17:00.000Z");
    return {
      ...row,
      history: { stored: 50, truncated: true },
      recentRuns: Array.from({ length: 50 }, (_, day) => ({ ...run, runId: `${run.runId ?? "run"}-${day}`, startedAt: new Date(start - day * 86400e3).toISOString(), scheduledFor: new Date(start - day * 86400e3).toISOString() })),
    };
  };
  const scheduleRows: AutomationRow[] = FAILING_SCHEDULES.map((id) => named(rowOf(recordedSchedules, id)));
  // 22 calm schedules: the six recorded ones in turn; every one with a run keeps fifty.
  for (let n = 0; n < 22; n += 1) scheduleRows.push(fifty(named(rowOf(recordedSchedules, CALM_SCHEDULES[n % CALM_SCHEDULES.length]!))));
  const triggerRows: AutomationRow[] = [];
  const statuses: TriggerStatuses = [];
  const trigger = (id: string) => {
    const row = named(rowOf(recordedTriggers, id));
    triggerRows.push(row);
    const status = recordedStatuses.find((entry) => entry.id === id);
    if (status !== undefined) statuses.push({ id: row.id, status: status.status });
  };
  FAILING_TRIGGERS.forEach(trigger);
  // 10 calm triggers: the five recorded ones, twice.
  for (let n = 0; n < 10; n += 1) trigger(CALM_TRIGGERS[n % CALM_TRIGGERS.length]!);
  return { schedules: { ...recordedSchedules, rows: scheduleRows }, triggers: { ...recordedTriggers, rows: triggerRows }, statuses };
}
