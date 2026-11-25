// The Automations scenes' busy set (the worst-case rule: 37 automations, five failing, some with
// 50 runs, names of sixty characters): the three answers of the fake `oats` (`schedule list`,
// `trigger list`, `trigger status`), made by MULTIPLYING the recorded ones
// (test/fixtures/automations/). Every row is a recorded row, as the kernel printed it; only its id,
// its name and, for a schedule with a run, the times and ids of fifty runs are varied. It stands in
// until the plugin's shared busy set (test/fixtures/busy) holds automations: then this file goes.
// (test/automations/busy.ts makes the same set for the unit tests, from the parsed rows.)
import { readFileSync } from "node:fs";
import { join } from "node:path";

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
export const busyName = (at) => `${STEMS[at % STEMS.length]}-${PLACES[Math.floor(at / STEMS.length) % PLACES.length]}-${"x".repeat(60)}`.slice(0, 57) + String(at).padStart(3, "0");

const FAILING_SCHEDULES = ["local/hourly-check", "local/legacy-herdr", "oats-real/reconcile", "oats-real/release-check"];
const CALM_SCHEDULES = ["local/daily-review", "local/notes-checkpoint", "oats-real/nightly-digest", "local/weekly-cleanup", "oats-real/weekly-report", "local/wake-oats-developer-review-202611212017"];
const FAILING_TRIGGERS = ["oats-real/harvest-closed"];
const CALM_TRIGGERS = ["local/pr-triage", "oats-real/proposal-review", "local/graph-watch", "oats-real/harvest-review", "oats-real/docs-review"];
/** A long instruction: the recorded one, many times over, as a real one of several paragraphs is. */
export const LONG_TASK = Array.from({ length: 12 }, (_, at) => `${at + 1}. Read the support inbox of the enterprise accounts since the last run. For each new message find the account, its plan and its open incidents; sort it as a bug, a billing question, an access request or a how-to; draft a first reply in the customer's language and tone, never promising a date.`).join("\n");

/**
 * `agents`: instances of the scene's roster (one that asks, one that is stopped, one that runs):
 * each becomes the agent of the newest run of one calm schedule, in turn from the first (the long
 * one), so that a run's row has an agent the roster names. A relation, as the rule allows: the
 * run is the recorded one.
 * → `{ schedules, triggers, status, ids }`: the three answers as text (envelopes, as the kernel
 * prints them), and the ids of what the scenes look at: the five failing rows in the list's order,
 * a schedule that keeps fifty runs and has a long instruction, and the schedules given an agent.
 */
export function busy(fixtures, { agents = [] } = {}) {
  const read = (name) => JSON.parse(readFileSync(join(fixtures, "automations", name), "utf8"));
  const schedules = read("schedule-list.json");
  const triggers = read("trigger-list.json");
  const status = read("trigger-status.json");
  const idOf = (row) => row.qualifiedId ?? row.id;
  const pick = (rows, id) => {
    const row = rows.find((entry) => idOf(entry) === id);
    if (row === undefined) throw new Error(`busy: the recording holds no ${id}`);
    return row;
  };
  let at = 0;
  const named = (row) => {
    const name = busyName(at);
    at += 1;
    const member = idOf(row).split("/")[0];
    return { ...row, id: name, name, qualifiedId: `${member}/${name}` };
  };
  const fifty = (row) => {
    const run = row.recentRuns?.[0];
    if (run === undefined) return row;
    const start = Date.parse(run.startedAt ?? run.scheduledFor);
    const recentRuns = Array.from({ length: 50 }, (_, day) => ({ ...run, runId: `${run.runId ?? "run"}-${day}`, startedAt: new Date(start - day * 86400e3).toISOString(), scheduledFor: new Date(start - day * 86400e3).toISOString() }));
    return { ...row, history: { status: "ok", stored: 50, truncated: true }, recentRuns, lastRun: recentRuns[0] };
  };
  const scheduleRows = FAILING_SCHEDULES.map((id) => named(pick(schedules.result.schedules, id)));
  for (let n = 0; n < 22; n += 1) scheduleRows.push(fifty(named(pick(schedules.result.schedules, CALM_SCHEDULES[n % CALM_SCHEDULES.length]))));
  // The first calm schedule (a spawn with a run): the one whose page the scenes open. Its instruction is a long one.
  const long = scheduleRows[FAILING_SCHEDULES.length];
  long.task = LONG_TASK;
  const made = agents.map((instance, n) => {
    const row = scheduleRows[FAILING_SCHEDULES.length + n * CALM_SCHEDULES.length];
    // The newest runs of this one, each the next agent's: the first given is the newest run's.
    row.recentRuns = row.recentRuns.map((run, at) => (at === 0 ? { ...run, session: { ...run.session, instance } } : run));
    if (n === 0) row.recentRuns = row.recentRuns.map((run, at) => (at > 0 && at < agents.length ? { ...run, session: { ...run.session, instance: agents[at] } } : run));
    row.lastRun = row.recentRuns[0];
    return idOf(row);
  });
  const triggerRows = [];
  const statusRows = [];
  const trigger = (id) => {
    const row = named(pick(triggers.result.triggers, id));
    triggerRows.push(row);
    const recorded = status.result.triggers.find((entry) => idOf(entry) === id);
    if (recorded !== undefined) statusRows.push({ ...recorded, id: row.id, name: row.name, qualifiedId: row.qualifiedId });
  };
  FAILING_TRIGGERS.forEach(trigger);
  for (let n = 0; n < 10; n += 1) trigger(CALM_TRIGGERS[n % CALM_TRIGGERS.length]);
  const text = (envelope, key, rows) => JSON.stringify({ ...envelope, result: { ...envelope.result, [key]: rows } });
  return {
    schedules: text(schedules, "schedules", scheduleRows),
    triggers: text(triggers, "triggers", triggerRows),
    status: text(status, "triggers", statusRows),
    ids: { failing: [...scheduleRows.slice(0, 4), triggerRows[0]].map(idOf), long: idOf(long), made, names: [...scheduleRows, ...triggerRows].map((row) => row.name) },
  };
}
