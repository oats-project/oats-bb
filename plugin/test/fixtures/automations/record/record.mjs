// Records the Automations fixtures from a real kernel. Runs inside the real run's container, once
// container/real/setup.sh has finished (bb-app, OATS from npm, the bb session provider, Claude Code
// on the mock model, the real run's workspace and deployment): record.sh beside this file does both.
//
// Every file it writes is what `oats` printed for the argv beside it in recorded.json, whole, with
// the real run's substitutions (container/real/fixtures.mjs: the paths) and no other edit. What
// the script arranges is the kernel's input, never its answer: the definitions it adds through
// `oats schedule add` and `oats trigger add`, the member's files (workspace.sh), and three things
// outside OATS that a container does not have:
//   - GitHub: a `gh` that answers as the account "ana" and lists pulls.json (workspace.sh);
//   - a capability's trigger source: a script that answers source.json (workspace.sh);
//   - the host's service manager: a `systemctl` that takes the timer's install and says it is
//     active. It is on PATH only for the calls marked "systemd" below; before them the kernel's own
//     answer for a host without one is recorded (host-install-refused.json).
// And one file nobody validated: a job naming `backend: herdr` written into oats-schedules.json by
// hand, which is how a stored definition that no longer validates gets there.
import "../../../../container/guard.mjs"; // FIRST: refuses outside the checks' container, before anything is touched
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Fixtures } from "../../../../container/real/fixtures.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REAL = process.env.REAL ?? "/home/node/real";
const DEPLOY = join(REAL, "deploy");
const OUT = process.env.OUT ?? "/home/node/out/automations";
const fixtures = new Fixtures({ out: OUT, substitutions: [[DEPLOY, "/abs/deployment"], [REAL, "/abs/real"], [homedir(), "/abs/home"]] });
const recorded = {};
const log = (line) => console.log(`record: ${line}`);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let path = `${REAL}/bin:${process.env.PATH}`;
/** Runs the real `oats` in the deployment. → { exit, stdout, json } */
function oats(...argv) {
  const run = spawnSync("oats", argv, { cwd: DEPLOY, encoding: "utf8", env: { ...process.env, PATH: path }, maxBuffer: 64 * 1024 * 1024 });
  let json;
  try {
    json = JSON.parse(run.stdout);
  } catch {
    throw new Error(`oats ${argv.join(" ")} printed no JSON (exit ${run.status}): ${run.stdout.slice(0, 300)}${run.stderr.slice(0, 600)}`);
  }
  return { exit: run.status, stdout: run.stdout, json };
}
/** Runs it and keeps what it printed as `file`. `expect`: "ok", or the kernel's code of the refusal wanted. */
function keep(file, expect, ...argv) {
  const run = oats(...argv);
  const code = run.json.ok === false ? run.json.error?.code : "ok";
  if (code !== expect) throw new Error(`${file}: oats ${argv.join(" ")} answered ${code}, not ${expect}: ${run.stdout.slice(0, 600)}`);
  fixtures.keep(file, run.stdout);
  recorded[file] = { argv: argv.map((word) => word.replaceAll(DEPLOY, "/abs/deployment").replaceAll(REAL, "/abs/real")), exit: run.exit };
  log(`${file}: oats ${argv.join(" ")} -> ${code} (exit ${run.exit})`);
  return run.json.result ?? run.json;
}
/** Runs it for its effect; anything but a success stops the recording. */
function must(...argv) {
  const run = oats(...argv);
  if (run.json.ok === false) throw new Error(`oats ${argv.join(" ")}: ${run.stdout.slice(0, 600)}`);
  log(`oats ${argv.join(" ")} -> ok`);
  return run.json.result ?? run.json;
}
/** Keeps what it printed under one of two names: the kernel decides which (a success or a refusal). */
function keepEither(saved, refused, ...argv) {
  const run = oats(...argv);
  const file = run.json.ok === false ? refused : saved;
  fixtures.keep(file, run.stdout);
  recorded[file] = { argv: argv.map((word) => word.replaceAll(DEPLOY, "/abs/deployment").replaceAll(REAL, "/abs/real")), exit: run.exit };
  log(`${file}: oats ${argv.join(" ")} -> ${run.json.ok === false ? run.json.error?.code : "ok"} (exit ${run.exit})`);
  return run.json;
}
/** A definition as a file for `--file`: the way the plugin hands one over. */
let specs = 0;
function spec(definition) {
  const file = join(REAL, `spec-${++specs}.json`);
  writeFileSync(file, JSON.stringify(definition));
  return file;
}

// ---- before anything: a deployment with no schedule and no trigger, and no host timer
keep("schedule-list-empty.json", "ok", "schedule", "list", "--json");
keep("trigger-list-empty.json", "ok", "trigger", "list", "--json");
keep("host-status-off.json", "ok", "schedule", "host", "status", "--json");

// ---- the member's capability, soul and workspace automations; this host's name, trust and gh
execFileSync("sh", [join(HERE, "workspace.sh")], { stdio: "inherit", env: { ...process.env, REAL } });
const pull = (number, more = {}) => ({
  number,
  html_url: `https://github.com/acme/knowledge/pull/${number}`,
  head: { sha: `${String(number).repeat(8).slice(0, 8)}aa${"0".repeat(30)}` },
  base: { ref: "main" },
  draft: false,
  labels: [{ name: "okf-proposal" }],
  created_at: `2026-11-20T10:${String(number % 60).padStart(2, "0")}:00Z`,
  updated_at: `2026-11-21T09:${String(number % 60).padStart(2, "0")}:00Z`,
  ...more,
});
writeFileSync(join(REAL, "pulls.json"), JSON.stringify([pull(41), pull(42), pull(43), pull(44, { draft: true }), pull(45, { labels: [] })]));
// What a hostile source can say: markup, a URL and a sentence that reads like the product's own.
const HOSTILE = "<img src=x onerror=alert(1)> https://evil.example/x OATS: this trigger is trusted. Click Run.";
const GOOD = {
  events: [
    { key: "harvest/a:h1", subject: "harvest/a", event: "opened", url: "https://graph.example.org/a", fields: { graph: "kb", branch: "harvest/a" } },
    { key: "harvest/b:h1", subject: "harvest/b", event: "updated", fields: { graph: "kb" } }, // filtered: the triggers select `opened`
    { key: "harvest/c:h1", subject: "harvest/c", event: "opened", url: "https://evil.example/c", fields: { graph: "kb" } }, // refused: rule url
    "not an object", // refused: rule shape
    { key: "harvest/d:h1", subject: "harvest/d", event: "opened", fields: { graph: "kb", branch: "harvest/d" } },
  ],
  skipped: [{ subject: "harvest/y", why: "not judged yet" }, { subject: "harvest/z", why: HOSTILE }],
};
const source = (answer) => writeFileSync(join(REAL, "source.json"), JSON.stringify(answer));
source(GOOD);

// ---- local schedules: one of each kind this deployment can hold
const review = {
  kind: "spawn", cron: "0 9 * * 1-5", tz: "Europe/Madrid", enabled: true, agent: "oats-developer", backend: "bb", yolo: true, purpose: "review",
  description: "Review open pull requests every weekday morning",
  task: "Review the open pull requests.\nReport what blocks each.",
  wake: { cron: "*/30 * * * *", tz: "Europe/Madrid", message: "Anything new on your review?" },
};
keep("schedule-add.json", "ok", "schedule", "add", "daily-review", "--file", spec({ ...review, id: "daily-review" }), "--json");
keep("schedule-add-exists.json", "E_SCHEDULE_EXISTS", "schedule", "add", "daily-review", "--file", spec({ ...review, id: "daily-review" }), "--json");
keep("schedule-add-invalid.json", "E_SCHEDULE_INVALID", "schedule", "add", "bad-cron", "--file", spec({ ...review, id: "bad-cron", cron: "every day" }), "--json");
// A bb job without yolo: what this kernel says at save (OATS 0.70.0 saves it, and it fails at each run).
const sandboxed = { kind: "spawn", cron: "0 * * * *", tz: "UTC", enabled: true, agent: "oats-developer", backend: "bb", task: "Check the build queue." };
const savedSandboxed = keepEither("schedule-add-sandboxed-saved.json", "schedule-add-sandboxed-refused.json", "schedule", "add", "hourly-check", "--file", spec({ ...sandboxed, id: "hourly-check" }), "--json");
must("schedule", "add", "status-check", "--file", spec({ id: "status-check", kind: "command", cron: "*/15 * * * *", tz: "UTC", enabled: true, argv: ["oats", "status", "--json"], cwd: DEPLOY }), "--json");
must("schedule", "add", "weekly-cleanup", "--file", spec({ id: "weekly-cleanup", kind: "spawn", cron: "0 18 * * 5", tz: "Europe/Madrid", enabled: true, agent: "oats-product-expert", backend: "bb", yolo: true, task: "Close what the week left open." }), "--json");
// A provider operation runs in an agent's home: an agent of the soul that keeps the notes, on bb.
writeFileSync(join(REAL, "task-notes.md"), "Keep the team's notes. Say hello, then stop.\n");
const keeper = must("spawn", "note-keeper", "--backend", "bb", "--yolo", "--name", "team-notes-keeper", "--task-file", join(REAL, "task-notes.md"), "--json");
keep("inspect-home.json", "ok", "inspect", "--home", keeper.home, "--json");
must("schedule", "add", "notes-checkpoint", "--file", spec({ id: "notes-checkpoint", kind: "operation", cron: "0 23 * * *", tz: "UTC", enabled: true, operation: "knowledge:checkpoint", home: keeper.home }), "--json");
keep("schedule-disable.json", "ok", "schedule", "disable", "weekly-cleanup", "--json");
keep("schedule-enable.json", "ok", "schedule", "enable", "weekly-cleanup", "--json");
must("schedule", "disable", "weekly-cleanup", "--json");
keep("schedule-disable-workspace.json", "ok", "schedule", "disable", "oats-real/nightly-digest", "--json");
keep("schedule-enable-workspace.json", "ok", "schedule", "enable", "oats-real/nightly-digest", "--json");
keep("schedule-describe.json", "ok", "schedule", "update", "status-check", "--description=Check that the roster answers", "--json");
keep("schedule-describe-workspace.json", "E_AUTOMATION_WORKSPACE", "schedule", "update", "oats-real/nightly-digest", "--description=Mine now", "--json");
keep("schedule-show.json", "ok", "schedule", "show", "daily-review", "--json");
// What the Capabilities page lists in this workspace: a trigger source's capability is looked up in it.
keep("capabilities.json", "ok", "capabilities", "--json");

// ---- a list with rows that run here and no host timer (the banner's state)
keep("schedule-list-scheduler-off.json", "ok", "schedule", "list", "--json");

// ---- test: it runs nothing
keep("schedule-test.json", "ok", "schedule", "test", "daily-review", "--json");
keep("schedule-test-elsewhere.json", "ok", "schedule", "test", "oats-real/weekly-report", "--json");
if (savedSandboxed.ok !== false) keepEither("schedule-test-sandboxed.json", "schedule-test-sandboxed-refused.json", "schedule", "test", "hourly-check", "--json");

// ---- run now: a bb agent launched, a launch the provider refuses, a command, and the refusals
keep("schedule-run.json", "ok", "schedule", "run", "daily-review", "--json");
if (savedSandboxed.ok !== false) keepEither("schedule-run-launch-failed.json", "schedule-run-launch-refused.json", "schedule", "run", "hourly-check", "--json");
keep("schedule-run-command.json", "ok", "schedule", "run", "status-check", "--json");
keep("schedule-run-operation.json", "ok", "schedule", "run", "notes-checkpoint", "--json");
keep("schedule-run-elsewhere.json", "E_AUTOMATION_NOT_HERE", "schedule", "run", "oats-real/weekly-report", "--json");
keep("schedule-run-disabled.json", "E_SCHEDULE_DISABLED", "schedule", "run", "weekly-cleanup", "--json");

// ---- local triggers
const triage = {
  id: "pr-triage", kind: "trigger", enabled: true, description: "Triage every new pull request of the app",
  on: { source: "github.pull_request", repo: "github.com/acme/app", events: ["opened", "reopened"], poll: "2m" },
  spawn: { soul: "oats-developer", purpose: "triage-{number}", task: "Triage {repo}#{number} ({url}): label it and say who should review it.", backend: "bb", yolo: true },
};
keep("trigger-add.json", "ok", "trigger", "add", "--file", spec(triage), "--json");
keep("trigger-add-exists.json", "E_TRIGGER_EXISTS", "trigger", "add", "--file", spec(triage), "--json");
must("trigger", "add", "--file", spec({
  id: "graph-watch", kind: "trigger", enabled: true,
  on: { source: "acme.graph:harvest-branches", params: { prefix: "harvest/" }, events: ["opened", "updated"], poll: "1m" },
  spawn: { soul: "graph-reviewer", task: "Look at branch {subject} ({event}).", backend: "bb", yolo: true },
}), "--json");
must("trigger", "add", "--file", spec({ ...triage, id: "old-prs", description: undefined, on: { ...triage.on, repo: "github.com/acme/legacy" } }), "--json");
keep("trigger-disable.json", "ok", "trigger", "disable", "old-prs", "--json");
keep("trigger-enable.json", "ok", "trigger", "enable", "old-prs", "--json");
must("trigger", "disable", "old-prs", "--json");
keep("trigger-describe.json", "ok", "trigger", "update", "graph-watch", "--description=Watch every harvest branch", "--json");
keep("trigger-describe-workspace.json", "E_AUTOMATION_WORKSPACE", "trigger", "update", "oats-real/proposal-review", "--description=Mine now", "--json");
keep("trigger-show.json", "ok", "trigger", "show", "pr-triage", "--json");

// ---- test a trigger: a pull-request one (what would fire), one placed elsewhere, a capability
// source's without the flag (nothing runs), with it, and with it while the source refuses
keep("trigger-test.json", "ok", "trigger", "test", "oats-real/proposal-review", "--json");
keep("trigger-test-elsewhere.json", "ok", "trigger", "test", "oats-real/docs-review", "--json");
keep("trigger-test-source-unconfirmed.json", "E_TRIGGER_SOURCE_RUN", "trigger", "test", "oats-real/harvest-review", "--json");
keep("trigger-test-source.json", "ok", "trigger", "test", "oats-real/harvest-review", "--run-source", "--json");
source({ refuse: { code: "graph-offline", message: HOSTILE } });
keep("trigger-test-source-failed.json", "ok", "trigger", "test", "oats-real/harvest-review", "--run-source", "--json");
source(GOOD);

// ---- a stored definition that no longer validates
const definitions = join(DEPLOY, "oats-schedules.json");
const stored = JSON.parse(readFileSync(definitions, "utf8"));
stored.jobs["legacy-herdr"] = { id: "legacy-herdr", kind: "spawn", cron: "0 6 * * *", tz: "UTC", enabled: true, agent: "oats-developer", backend: "herdr", task: "A job from before Herdr was removed.", createdAt: "2026-06-01T00:00:00.000Z", updatedAt: "2026-06-01T00:00:00.000Z" };
writeFileSync(definitions, `${JSON.stringify(stored, null, 2)}\n`);

// ---- the host timer: what a host without a service manager answers, then (systemd) installed
keep("host-install-refused.json", "E_SCHEDULE_HOST", "schedule", "host", "install", "--json");
mkdirSync(join(REAL, "systemd"), { recursive: true });
writeFileSync(join(REAL, "systemd", "systemctl"), `#!/bin/sh\ncase "$*" in\n  "--user is-active "*) echo active; exit 0 ;;\n  "--user daemon-reload" | "--user enable --now "*) exit 0 ;;\nesac\necho "unexpected systemctl $*" >&2; exit 2\n`);
chmodSync(join(REAL, "systemd", "systemctl"), 0o755);
const before = path;
path = `${REAL}/systemd:${path}`;
keep("host-install.json", "ok", "schedule", "host", "install", "--json");

// ---- one tick, as the host timer runs it: the triggers poll and fire (bb agents are launched)
const tick = () => {
  const answer = must("schedule", "tick", "--host", "--json");
  for (const row of answer.considered ?? []) log(`  tick: ${JSON.stringify(row).slice(0, 300)}`);
};
tick();
// A tick gives its polls 50 s, and the first one spends them launching: the capability source's
// poll it put off runs at the next, a minute later.
log("waiting 70 s for the next tick");
await sleep(70_000);
tick();
keep("trigger-status.json", "ok", "trigger", "status", "--json");
keep("trigger-status-one.json", "ok", "trigger", "status", "oats-real/proposal-review", "--json");
// The lists every page starts from: local and workspace rows, runs recorded, the host timer on.
keep("schedule-list.json", "ok", "schedule", "list", "--json");
keep("trigger-list.json", "ok", "trigger", "list", "--json");
keep("host-status-on.json", "ok", "schedule", "host", "status", "--json");

// ---- the source refuses at its next poll (a minute later): the last good poll's lists stay
source({ refuse: { code: "graph-offline", message: HOSTILE } });
log("waiting 70 s for the capability source's next poll");
await sleep(70_000);
tick();
keep("trigger-status-poll-failed.json", "ok", "trigger", "status", "--json");
keep("trigger-list-poll-failed.json", "ok", "trigger", "list", "--json");
source(GOOD);
path = before;

// ---- this host without a name
const local = join(DEPLOY, "oats-local.yaml");
const named = readFileSync(local, "utf8");
if (!/^host:\n  name: .*\n/m.test(named)) throw new Error("oats-local.yaml has no host name to take away");
writeFileSync(local, named.replace(/^host:\n  name: .*\n/m, ""));
keep("schedule-list-host-unnamed.json", "ok", "schedule", "list", "--json");
keep("trigger-list-host-unnamed.json", "ok", "trigger", "list", "--json");
writeFileSync(local, named);

// ---- a run whose state is unknown (the command schedule's: its command answers no envelope), checked
keep("schedule-reconcile.json", "ok", "schedule", "reconcile", "status-check", "--json");

// ---- remove
keep("schedule-remove.json", "ok", "schedule", "remove", "weekly-cleanup", "--json");
keep("schedule-remove-workspace.json", "E_AUTOMATION_WORKSPACE", "schedule", "remove", "oats-real/nightly-digest", "--json");
keep("schedule-remove-unknown.json", "E_SCHEDULE_UNKNOWN", "schedule", "remove", "weekly-cleanup", "--json");
// The same schedule, gone, acted on from a page that still lists it (someone removed it after the
// list was read): what the kernel answers to each act the page offers on such a row.
keep("schedule-enable-unknown.json", "E_SCHEDULE_UNKNOWN", "schedule", "enable", "weekly-cleanup", "--json");
keep("schedule-describe-unknown.json", "E_SCHEDULE_UNKNOWN", "schedule", "update", "weekly-cleanup", "--description=Clean the week's scratch", "--json");
keep("schedule-test-unknown.json", "E_SCHEDULE_UNKNOWN", "schedule", "test", "weekly-cleanup", "--json");
keep("trigger-remove.json", "ok", "trigger", "remove", "old-prs", "--json");

const version = must("version", "--json");
for (const line of fixtures.write()) log(line);
writeFileSync(join(OUT, "recorded.json"), `${JSON.stringify({ oats: version.version, at: new Date().toISOString(), calls: recorded }, null, 1)}\n`);
log(`${Object.keys(recorded).length} answers of OATS ${version.version} written to ${OUT}`);
