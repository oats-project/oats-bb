#!/usr/bin/env node
// THE BUSY WORKSPACE's generator (README.md beside this file; the worst-case rule). It READS the
// recorded answers the fixtures hold and WRITES the busy answers: the same kernel answers, with
// their rows MULTIPLIED. Every busy row is one recorded row with only its names, ids, times and
// relations varied (and a count that follows the rows): `build()` says, for every row it makes,
// the recorded row it came from and exactly what it varied, and test/busy/busy.test.ts puts each
// back and holds it equal to its recorded row.
//
// No clock, no random, no dependency: the same set every run.
//   node test/fixtures/busy/generate.mjs            writes the files beside this script
//   node test/fixtures/busy/generate.mjs --out DIR  writes them into DIR (the test's scratch)
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(HERE, "..");
const recorded = (file) => {
  const document = JSON.parse(readFileSync(join(FIXTURES, file), "utf8"));
  return document.result ?? document;
};
const copy = (value) => (value === undefined ? undefined : JSON.parse(JSON.stringify(value)));

/** Every string of `value` with each `[from, to]` replaced, in order. */
export function swapped(value, swaps) {
  if (typeof value === "string") return swaps.reduce((text, [from, to]) => text.split(from).join(to), value);
  if (Array.isArray(value)) return value.map((each) => swapped(each, swaps));
  if (value !== null && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, each]) => [key, swapped(each, swaps)]));
  return value;
}
const at = (value, path) => path.reduce((inner, key) => (inner === null || inner === undefined ? undefined : inner[key]), value);
function put(value, path, next) {
  const last = path[path.length - 1];
  const holder = path.slice(0, -1).reduce((inner, key) => inner[key], value);
  if (next === undefined) delete holder[last];
  else holder[last] = next;
}
/**
 * One busy row: `from` (a recorded row) with `swaps` applied to every string (a name, an id) and
 * `set` (by path: a relation, a time, a text) put in. → the row, and what was varied, so that it
 * can be put back: `restored(made)` is the recorded row again, or this throws (a name that hides
 * inside another would not come back).
 */
function vary(from, swaps, set = []) {
  const row = swapped(copy(from), swaps);
  const was = set.map(([path]) => [path, copy(at(from, path))]);
  for (const [path, next] of set) put(row, path, next);
  const made = { row, from, swaps, was };
  if (JSON.stringify(restored(made)) !== JSON.stringify(from)) throw new Error(`busy: a row made from ${JSON.stringify(from).slice(0, 80)}… does not come back to it: a varied name hides inside another`);
  return made;
}
/** The recorded row a busy row was made from: its varied fields put back. */
export function restored({ row, swaps, was }) {
  const back = copy(row);
  for (const [path, value] of was) put(back, path, value);
  return swapped(back, [...swaps].reverse().map(([from, to]) => [to, from]));
}

// ---- made-up names (no person, no real project) ----
const TOPICS = [
  "customer-onboarding-redesign-for-enterprise-tier", // 48: with "-developer-1", a name of sixty characters
  "customer-onboarding-redesign-for-the-starter-tier", // reads like the one above where a name is cut
  "billing-reconciliation-pipeline-migration",
  "search-relevance-ranking-experiments",
  "mobile-offline-sync-conflict-resolution",
  "quarterly-compliance-evidence-collection",
];
const ALONE = ["nightly-dependency-audit", "release-notes-drafting", "flaky-test-quarantine", "docs-site-link-checker", "incident-postmortem-timeline", "api-deprecation-sweep", "localization-string-freeze", "accessibility-contrast-audit", "telemetry-schema-registry", "invoice-pdf-rendering", "support-inbox-triage", "design-token-export"];
const SOUL_WORDS = ["platform", "payments", "search", "mobile", "compliance", "growth", "data", "design", "support", "infrastructure", "security", "billing", "documentation", "release", "research"];
const iso = (minutes) => new Date(Date.UTC(2026, 10, 19, 8, 0, 0) + minutes * 60_000).toISOString();
const QUESTION = ["The migration is ready to run against production.", "It rewrites 48 000 invoices and cannot be undone once the old table is dropped.", "A dry run on the copy of last night took 41 minutes and changed nothing it should not.", "Run it now, wait for the Sunday window, or stop here?"].join("\n");
const LONG = (what) => `${what}: every weekday at the start of the working day in each region, with a summary posted to the owning team and a follow-up opened for anything left undone`;

export function build() {
  const made = { agents: [], souls: [], schedules: [], triggers: [], teams: [], servers: [], runs: [] };

  // ---- souls: the recorded souls, each multiplied (24) ----
  const soulsDoc = recorded("workspace/souls.json");
  const soulModels = soulsDoc.souls.filter((soul, index, all) => all.findIndex((other) => other.name === soul.name) === index);
  const busySouls = [];
  for (let n = 0; n < 24; n += 1) {
    const from = soulModels[n % soulModels.length];
    const turn = Math.floor(n / soulModels.length);
    // The recorded souls stand as they are (their names are the roster's groups); the others are longer names of the same shape.
    const name = turn === 0 ? from.name : `${SOUL_WORDS[(n * 7) % SOUL_WORDS.length]}-${["feature-delivery", "quality-and-release-readiness"][turn - 1]}-${from.name}`;
    const row = vary(from, turn === 0 ? [] : [[from.name, name]], turn === 0 ? [] : [[["description"], LONG(`Works on ${name.replace(/-/g, " ")}`)]]);
    made.souls.push(row);
    // The name the roster gives this soul's agents: the soul's own, or `<package>--<soul>` for a package's soul ("." written "-").
    busySouls.push(typeof row.row.package === "string" ? `${row.row.package.replaceAll(".", "-")}--${name}` : name);
  }
  const souls = { ...copy(soulsDoc), souls: made.souls.map((each) => each.row) };

  // ---- the roster: the recorded rows of each kind, multiplied (60, four levels) ----
  const status = recorded("roster/status.json");
  const rowsOf = (document) => document.agents.flatMap((group) => group.instances.map((row) => ({ row, soul: group.name ?? row.agent })));
  const byName = new Map(rowsOf(status).map((each) => [each.row.instance, each]));
  const outside = rowsOf(recorded("outside/status-outside.json"))[0];
  const lostBb = rowsOf(recorded("outside/status-archived-while-running.json"))[0];
  const tmuxLost = { row: recorded("lifecycle/tmux-row-lost.json"), soul: recorded("lifecycle/tmux-row-lost.json").agent };
  const MODELS = {
    ask: ["release-070-maintainer", "flaky-ci-developer", "ranker-v3-probe"].map((name) => byName.get(name)),
    work: [byName.get("redesign-ui-lead"), byName.get("desktop-mockups-developer")],
    idle: [byName.get("harvest-knowledge-helper")],
    stopped: [byName.get("weekly-digest-helper")],
    // FAILED has no recorded row (README: "its session ended in a shell … (no recording)"): the recorded idle row, with the
    // two session keys of that line of the README's table set. The ONE kind here that is shaped; README.md says so.
    failed: [byName.get("harvest-knowledge-helper")],
    outside: [outside],
    lost: [lostBb],
    tmux: [byName.get("kernel-fix-developer")],
    "tmux-lost": [tmuxLost],
  };
  // Who there is: six efforts of eight (a lead, three developers, a helper under each, a reviewer under the first
  // helper: four levels) and twelve agents alone. [name, parent, kind]
  const plan = [];
  const KINDS = {
    lead: ["ask", "work", "work", "idle", "failed", "work"],
    developer: ["ask", "work", "idle", "work", "idle", "stopped", "ask", "work", "tmux", "idle", "work", "lost", "work", "idle", "ask", "outside", "work", "tmux-lost"],
    helper: ["ask", "idle", "tmux", "work", "idle", "failed", "idle", "ask", "tmux-lost", "idle", "work", "stopped", "ask", "idle", "tmux", "lost", "idle", "work"],
    reviewer: ["ask", "idle", "tmux-lost", "work", "idle", "failed"],
    alone: ["ask", "work", "idle", "stopped", "tmux", "ask", "outside", "idle", "tmux-lost", "lost", "stopped", "ask"],
  };
  TOPICS.forEach((topic, effort) => {
    const lead = `${topic}-lead`;
    plan.push([lead, null, KINDS.lead[effort]]);
    for (let d = 0; d < 3; d += 1) {
      const developer = `${topic}-developer-${d + 1}`;
      plan.push([developer, lead, KINDS.developer[effort * 3 + d]]);
      const helper = `${topic}-helper-${d + 1}`;
      plan.push([helper, developer, KINDS.helper[effort * 3 + d]]);
      if (d === 0) plan.push([`${topic}-reviewer`, helper, KINDS.reviewer[effort]]);
    }
  });
  ALONE.forEach((topic, n) => plan.push([`${topic}-${["probe", "helper", "developer"][n % 3]}`, null, KINDS.alone[n]]));

  if (new Set(plan.map(([instance]) => instance)).size !== plan.length || plan.some(([instance]) => !/^[a-z0-9][a-z0-9-]{0,62}$/.test(instance))) throw new Error("busy: an agent's name is taken twice, or is none the kernel would give");
  const used = {};
  const groups = new Map();
  plan.forEach(([instance, parent, kind], n) => {
    const models = MODELS[kind];
    const model = models[(used[kind] = (used[kind] ?? 0) + 1) % models.length];
    const soul = busySouls[(n * 5) % busySouls.length];
    const swaps = [];
    if (model.soul !== soul) swaps.push([`/agents/${model.soul}/`, `/agents/${soul}/`]);
    swaps.push([model.row.instance, instance]);
    const thread = model.row.session?.threadId;
    if (typeof thread === "string") swaps.push([thread, `thr_busy_${String(n + 1).padStart(2, "0")}`]);
    const set = [[["agent"], soul], [["parentInstance"], parent]];
    if (kind === "ask") set.push([["waitingOnYou", "since"], iso(n * 37)], [["waitingOnYou", "message"], n % 4 === 0 ? QUESTION : `${model.row.waitingOnYou.message} (${instance.replace(/-/g, " ")})`]);
    if (kind === "failed") set.push([["running"], false], [["runtimeState"], "shell"]);
    const row = vary(model.row, swaps, set);
    made.agents.push({ ...row, kind, shaped: kind === "failed" ? ["running", "runtimeState"] : [] });
    if (!groups.has(soul)) groups.set(soul, { ...copy(status.agents[0]), name: soul, instances: [] });
    groups.get(soul).instances.push(row.row);
  });
  const busyStatus = { ...copy(status), features: copy(recorded("outside/status-outside.json").features), agents: [...groups.values()] };

  // ---- automations: the recorded schedules (25) and triggers (12); five fail; some hold fifty runs ----
  const scheduleDoc = recorded("automations/schedule-list.json");
  const triggerDoc = recorded("automations/trigger-list.json");
  const schedule = (id) => scheduleDoc.schedules.find((row) => row.id === id);
  const trigger = (id) => triggerDoc.triggers.find((row) => row.id === id);
  // [recorded id, how many]: the failing ones are hourly-check (not launched) ×2, legacy-herdr (invalid) ×1, status-check (unknown) ×1.
  const SCHEDULES = [["daily-review", 6], ["hourly-check", 2], ["legacy-herdr", 1], ["notes-checkpoint", 4], ["status-check", 1], ["weekly-cleanup", 4], ["oats-real/nightly-digest", 3], ["oats-real/reconcile", 1], ["oats-real/release-check", 1], ["oats-real/weekly-report", 2]];
  // …and among the triggers harvest-closed (invalid) ×1: five in all.
  const TRIGGERS = [["local/graph-watch", 2], ["local/old-prs", 2], ["local/pr-triage", 2], ["oats-real/docs-review", 1], ["oats-real/harvest-closed", 1], ["oats-real/harvest-review", 2], ["oats-real/proposal-review", 2]];
  const bare = (id) => id.slice(id.lastIndexOf("/") + 1);
  let s = 0;
  for (const [id, count] of SCHEDULES) {
    for (let k = 0; k < count; k += 1, s += 1) {
      const from = schedule(id);
      const name = `${bare(id)}-${ALONE[s % ALONE.length]}`;
      const set = [[["cron"], from.cron.replace(/^\S+/, String((s * 7) % 60))]];
      if (typeof from.description === "string") set.push([["description"], LONG(`${from.description} (${name.replace(/-/g, " ")})`)]);
      // Fifty runs: the recorded run, fifty times, each with its own id and times; the history's count follows.
      if (k === 0 && Array.isArray(from.recentRuns) && from.recentRuns.length > 0 && typeof from.recentRuns[0].runId === "string") {
        const runs = Array.from({ length: 50 }, (_, r) => {
          const run = vary(from.recentRuns[0], [[from.recentRuns[0].runId, `${String(s).padStart(2, "0")}${String(r).padStart(2, "0")}${from.recentRuns[0].runId.slice(4)}`]], [[["scheduledFor"], iso(-r * 60)], [["startedAt"], iso(-r * 60 + 1)]]);
          made.runs.push(run);
          return run.row;
        });
        set.push([["recentRuns"], runs]);
        if (from.history && typeof from.history.stored === "number") set.push([["history", "stored"], runs.length]);
      }
      made.schedules.push(vary(from, [[bare(id), name]], set));
    }
  }
  let t = 0;
  for (const [id, count] of TRIGGERS) {
    for (let k = 0; k < count; k += 1, t += 1) {
      const from = trigger(id);
      const name = `${bare(id)}-${ALONE[(t + 5) % ALONE.length]}`;
      made.triggers.push(vary(from, [[bare(id), name]], typeof from.description === "string" ? [[["description"], LONG(`${from.description} (${name.replace(/-/g, " ")})`)]] : []));
    }
  }
  const schedules = { ...copy(scheduleDoc), schedules: made.schedules.map((each) => each.row), triggers: { ...copy(scheduleDoc.triggers), count: made.triggers.length } };
  const triggers = { ...copy(triggerDoc), triggers: made.triggers.map((each) => each.row) };

  // ---- teams (7) and machines (5) ----
  const teamsDoc = recorded("workspace/teams.json");
  const TEAMS = ["oats", "payments-and-billing-platform", "search-and-discovery", "mobile-clients", "docs", "compliance-and-audit-evidence", "developer-experience"];
  const problems = [];
  TEAMS.forEach((label, n) => {
    const from = teamsDoc.teams[n === 0 ? 0 : n === 4 ? 1 : n % 2 === 0 ? 1 : 0];
    const row = vary(from, label === from.label ? [] : [[`/teams/${from.label}`, `/teams/${label}`]], label === from.label ? [] : [[["label"], label], ...(from.team === null ? [] : [[["team"], `${label}:busy.invalid`]]), ...(from.description === null ? [] : [[["description"], LONG(`The ${label.replace(/-/g, " ")} team`)]]), ...(from.default === true ? [[["default"], false]] : [])]);
    made.teams.push(row);
    // An unmapped team's problem row follows it (the recorded problem, for that team).
    const problem = teamsDoc.problems.find((each) => each.label === from.label);
    if (problem !== undefined) problems.push(label === from.label ? copy(problem) : { ...swapped(copy(problem), [[`/teams/${from.label}`, `/teams/${label}`], [`team ${from.label} `, `team ${label} `]]), label });
  });
  const teams = { ...copy(teamsDoc), teams: made.teams.map((each) => each.row), problems };
  const serversDoc = recorded("workspace/servers.json");
  const MACHINES = ["devbox", "build", "gpu-training-cluster-east", "staging-eu-central", "customer-sandbox-long-running-evaluations"];
  MACHINES.forEach((label, n) => {
    const from = serversDoc.servers[n % serversDoc.servers.length];
    const host = from.sshHost.split(".")[0];
    made.servers.push(vary(from, n < serversDoc.servers.length ? [] : [[`${host}.invalid`, `${label}.invalid`], [from.id, `${label}-box`]], n < serversDoc.servers.length || from.label === undefined ? [] : [[["label"], label]]));
  });
  const servers = { ...copy(serversDoc), servers: made.servers.map((each) => each.row) };

  return { files: { "status.json": busyStatus, "souls.json": souls, "schedule-list.json": schedules, "trigger-list.json": triggers, "teams.json": teams, "servers.json": servers }, made };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const out = process.argv.includes("--out") ? process.argv[process.argv.indexOf("--out") + 1] : HERE;
  mkdirSync(out, { recursive: true });
  const { files, made } = build();
  for (const [name, document] of Object.entries(files)) writeFileSync(join(out, name), `${JSON.stringify(document, null, 1)}\n`);
  console.log(`busy: ${made.agents.length} agents, ${made.souls.length} souls, ${made.schedules.length + made.triggers.length} automations (${made.runs.length} runs), ${made.teams.length} teams, ${made.servers.length} machines → ${out}`);
}
