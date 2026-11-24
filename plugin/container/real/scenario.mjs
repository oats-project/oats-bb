#!/usr/bin/env node
// The real run (container/real/README.md), inside the container once setup.sh has finished: bb-app,
// the OATS kernel, the bb session provider, Claude Code on the mock model, and the plugin
// installed from the checkout with `oatsBin` set to the recording wrapper (oats-record.mjs).
//
// Every act goes through the plugin's own RPC (`bb plugin rpc call oats …`, the calls its UI
// makes). After each one the script reads `oats status --json` and bb, and says what it saw.
//   part A  one agent, flaky-ci-2-developer: spawn preview, spawn, stop (plan, apply), start,
//           restart, retire (plan, apply), with the edge cases between them, and the plugin's tree
//           and header row at 1280x800 and 390x800 for an agent that is working, idle, waiting for
//           a person, stopped by OATS, and whose thread was deleted in bb; and a question Claude
//           Code asks (oats.core's claim), answered on the home's card.
//   part B  the scenes the plugin's fixtures describe: a lead with two children (stop, and a stale
//           stop plan), and an agent on a worktree with a child (start, restart, retire).
//   part C  the steps each other feature adds for its own acts: parts/<feature>.mjs.
// What the kernel printed for the plugin's calls is written to $OUT/fixtures/, with the paths and the
// host name replaced and nothing else edited (fixtures.mjs says how).
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir, hostname } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { launchBrowser, showSidebar, testId, textOf, visible } from "../browser.mjs";
import { sameImages } from "../images.mjs";
import { Fixtures, sampleStatus } from "./fixtures.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REAL = process.env.REAL ?? "/home/node/real";
const OUT = process.env.OUT ?? "/home/node/out/real";
const DEPLOY = join(REAL, "deploy");
const RECORDS = join(REAL, "records");
const HOLDS = join(REAL, "mock", "hold");
const WRAPPER_CONFIG = join(REAL, "bin", "oats-record.json");
const OATS = JSON.parse(readFileSync(WRAPPER_CONFIG, "utf8")).oats;
const BASE = process.env.BB_URL ?? "http://127.0.0.1:38886";
const VIEWPORTS = [
  { name: "1280x800", width: 1280, height: 800, mobile: false },
  { name: "390x800", width: 390, height: 800, mobile: true },
];
// Every image is taken in bb's light theme and again in its dark theme (bb's own appearance
// choice, set as bb keeps it: ../browser.mjs); a dark one's file name ends in "-dark".
const VIEWS = ["light", "dark"].flatMap((theme) => VIEWPORTS.map((viewport) => ({ viewport, theme, suffix: theme === "light" ? "" : "-dark" })));
/** A page of one view, with the theme bb draws checked once it has loaded something. */
async function viewPage(browser, { viewport, theme }, at) {
  const page = await browser.page(viewport, { theme });
  const goto = page.goto;
  let checked = false;
  page.goto = async (path) => {
    await goto(path);
    if (checked) return;
    checked = true;
    const drawn = await page.until(`document.readyState === "complete" && (document.documentElement.classList.contains("dark") ? "dark" : "light")`, 15);
    check(drawn === theme, `${at}: bb draws its ${theme} theme`, String(drawn));
  };
  return page;
}
mkdirSync(OUT, { recursive: true });

// ---- what the run says

let failures = 0;
const say = (line = "") => console.log(line);
const pass = (what) => say(`PASS ${what}`);
const fail = (what, detail = "") => {
  failures += 1;
  say(`FAIL ${what}${detail === "" ? "" : `\n     ${String(detail).slice(0, 1200)}`}`);
};
const check = (ok, what, detail) => (ok ? pass(what) : fail(what, detail));
const note = (what) => say(`NOTE ${what}`);
const show = (label, value) => say(`     ${label}: ${typeof value === "string" ? value : JSON.stringify(value)}`);
const step = (title) => say(`\n== ${title}`);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(what, read, seconds = 60) {
  const deadline = Date.now() + seconds * 1000;
  for (;;) {
    const value = await read();
    if (value) return value;
    if (Date.now() > deadline) {
      fail(`timed out after ${seconds} s waiting for ${what}`);
      return undefined;
    }
    await sleep(500);
  }
}

// ---- bb, the kernel, the mock model

const bb = (...args) => execFileSync("bb", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
const bbJson = (...args) => JSON.parse(bb(...args, "--json"));
/**
 * A command one of bb's plugins adds to its CLI (the concurrency limit's), waited for when bb does
 * not have it yet (bb-plugin-command.sh, 60 s). One that never answers throws, with bb's error.
 */
const bbPlugin = (...args) => execFileSync("sh", [join(HERE, "bb-plugin-command.sh"), "60", ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
/** bb's threads, archived ones included; a deleted thread is not among them. */
const bbThreads = () => bbJson("thread", "list", "--include-archived");
const bbThread = (id) => bbThreads().find((thread) => thread.id === id);
/** bb has the thread, and it is not archived. */
const live = (id) => {
  const thread = bbThread(id);
  return thread !== undefined && thread.archivedAt == null;
};
/** bb has the thread, archived. */
const archivedInBb = (id) => {
  const thread = bbThread(id);
  return thread !== undefined && thread.archivedAt != null;
};
const threadsNow = () => JSON.stringify(bbThreads().map((thread) => [thread.id, thread.status, thread.archivedAt]));
/** What bb holds in line for a thread: the turns its concurrency limit has not started. */
const inLine = (id) => {
  const answer = bbJson("thread", "queue", "list", id);
  return Array.isArray(answer) ? answer : (Object.values(answer ?? {}).find(Array.isArray) ?? []);
};
const bbProjects = () => {
  const answer = bbJson("project", "list");
  return Array.isArray(answer) ? answer : (answer.projects ?? answer.items ?? []);
};

/** The real `oats`, run in the deployment as a person would: not through the plugin, not recorded. */
function oats(...args) {
  const run = spawnSync(OATS, args, { cwd: DEPLOY, encoding: "utf8" });
  return { exit: run.status, stdout: run.stdout, stderr: run.stderr };
}
/** `oats status --json`: the document as printed, and its rows by instance. */
function status() {
  const run = oats("status", "--json");
  if (run.exit !== 0) throw new Error(`oats status --json exited ${run.exit}: ${run.stderr}`);
  const document = JSON.parse(run.stdout);
  const rows = new Map();
  for (const group of document.agents) for (const row of group.instances) rows.set(row.instance, row);
  return { text: run.stdout, document, rows };
}
const rowOf = (instance) => status().rows.get(instance);
const brief = (row) =>
  row === undefined
    ? "no row"
    : `backend ${row.backend}, session ${JSON.stringify(row.session)}, running ${row.running}, runtimeState ${row.runtimeState}${row.sessionEnd ? `, sessionEnd ${row.sessionEnd}` : ""}${row.runtimeError ? `, runtimeError ${row.runtimeError}` : ""}${row.waitingOnYou ? `, waitingOnYou ${JSON.stringify(row.waitingOnYou)}` : ""}`;
/**
 * The agent's first turn in its thread is over: bb shows the thread idle. A thread bb has not
 * started yet ("pending") with nothing in line also reads `running: null` in the kernel's row,
 * and is not that.
 */
const settled = (row) => bbThread(row.session?.threadId)?.status === "idle";
/**
 * What the kernel's row says of `running` for an agent that is IDLE: TRUE. `running` is endpoint
 * activity, not work: the bb session provider scans its harness (oats-bb #40), and an idle agent's
 * harness is loaded. (A provider before #40 could not tell and answered null: the run no longer
 * takes that, so a provider that stops telling fails here.) That the agent is idle is what bb says
 * of its thread (`settled`) and what the SCREEN says ("Idle"), which the checks of the page hold.
 */
const idleRunning = (row) => row.running === true;
const untilRow = (instance, what, matches, seconds = 60) =>
  until(`${instance} to read ${what} in oats status`, () => {
    const row = rowOf(instance);
    return row !== undefined && matches(row) ? row : undefined;
  }, seconds);
/**
 * The same for a wait whose predicate asks bb whether the turn is over (`settled`): bb is asked
 * after `oats status` was read, so the row that first matches may be from before the turn ended
 * (its `running` still true, where the provider tells). The row is read once more, after bb said
 * the turn was over, and that one is the answer: what the checks after the wait compare.
 */
const untilRest = async (instance, what, matches, seconds = 60) => {
  const matched = await untilRow(instance, what, matches, seconds);
  return matched === undefined ? matched : (rowOf(instance) ?? matched);
};
/**
 * What a stop by OATS leaves of the home's bb thread, and it differs by provider: the bb provider
 * up to 0.3 stops the thread and leaves it open in bb ("kept"); from the release that archives at
 * stop (oats-bb #40) it stops and ARCHIVES it ("archived"), so that a message in bb cannot start
 * the agent again outside OATS. Which one this run has is READ, once, from what the run's first
 * stop did (A7) and not from the provider's manifest: the manifest's version is the same in both
 * until a release names the new one. Every later stop of the run must then leave the same.
 * → "kept" (there, not archived, not active), "archived", "active" (there, not archived, in a
 * turn: no stop leaves that) or "gone" (bb has no such thread). What the read cannot tell: a
 * provider that changed what its stop does, the same way at every stop, passes as the other kind;
 * the run's NOTE and its last line say which kind it read.
 */
const stopLeft = (of) => {
  // Given the thread's id, or the thread as bb answered it (so that what a check prints is what it judged).
  const thread = typeof of === "string" ? bbThread(of) : of;
  // Anything that is not a thread of bb's (none, or a value that is no thread) is no thread kept.
  if (thread === undefined || thread === null || typeof thread !== "object" || typeof thread.id !== "string") return "gone";
  if (thread.archivedAt != null) return "archived";
  return thread.status === "active" ? "active" : "kept";
};
/** Whether this run's provider archives a home's thread at its stop; null until the first stop said (A7). */
let archivesAtStop = null;
const stopArchives = () => archivesAtStop;
/** The thread of a home OATS stopped (its id, or the thread as bb answered it) is as this run's provider leaves one: archived, or kept and not active. */
const stoppedThread = (of) => archivesAtStop !== null && stopLeft(of) === (archivesAtStop ? "archived" : "kept");
/** The same in words, for a check's line. */
const stoppedAs = () => (archivesAtStop ? "archived (this provider archives at stop)" : "kept, and no longer active");
/** An instance's name as the plugin draws it (app/ui/words.ts `agentName`): "flaky-ci-2-developer" is "Flaky ci 2 developer". */
const nameOf = (instance) => {
  const text = instance.replace(/-+/g, " ").trim();
  return text.charAt(0).toUpperCase() + text.slice(1);
};
/** An agent at rest, for a part of the run: the kernel's row says it is there and not gone (`idleRunning`), and bb says its turn is over. */
const atRest = (row) => row !== undefined && idleRunning(row) && settled(row);

/** A held turn: the mock does not answer a conversation that names `MOCK-HOLD:<name>` while this file exists. */
const hold = (name) => writeFileSync(join(HOLDS, name), "");
const release = (name) => rmSync(join(HOLDS, name), { force: true });
const taskOf = (name, text) => `${text}\nMOCK-HOLD:${name}\n`;
/** The mock's log: one line per model request, with the holds its conversation names. */
const modelRequests = () => {
  const file = join(REAL, "mock", "requests.jsonl");
  return existsSync(file) ? readFileSync(file, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line)) : [];
};

// ---- the plugin's RPC, and what the kernel printed for it

const inputFile = join(OUT, "rpc-input.json");
/** One call of the plugin's RPC, as its UI makes it. A refusal is `{ok: false, message}`. */
function rpc(method, input = null) {
  writeFileSync(inputFile, JSON.stringify(input));
  const started = Date.now();
  const run = spawnSync("bb", ["plugin", "rpc", "call", "oats", method, "--input-file", inputFile, "--json"], { encoding: "utf8" });
  const ms = Date.now() - started;
  let answer;
  try {
    answer = JSON.parse(run.stdout);
  } catch {
    answer = undefined;
  }
  if (run.status === 0 && answer !== undefined && !(answer.ok === false && answer.error !== undefined)) return { ok: true, value: answer.result ?? answer, ms };
  return { ok: false, message: answer?.error?.message ?? (run.stderr.trim() || run.stdout.trim()), ms };
}
/** A call that must go through: its value, shown; a refusal fails the run's check and answers undefined. */
function act(what, method, input) {
  const answer = rpc(method, input);
  if (!answer.ok) {
    fail(`${what}: the plugin's ${method} was refused`, answer.message);
    return undefined;
  }
  pass(`${what} (rpc ${method}, ${answer.ms} ms)`);
  show("input", input);
  show("answer", answer.value);
  return answer.value;
}

const records = () =>
  readdirSync(RECORDS)
    .filter((name) => name.endsWith(".json"))
    .map((name) => JSON.parse(readFileSync(join(RECORDS, name), "utf8")))
    .sort((a, b) => a.at.localeCompare(b.at));
/** The last call the plugin made whose argv starts with `words` and holds every one of `having`. */
function recorded(words, having = []) {
  const found = records().filter((record) => words.every((word, index) => record.argv[index] === word) && having.every((word) => record.argv.includes(word)));
  const last = found[found.length - 1];
  if (last === undefined) throw new Error(`no recorded oats call ${words.join(" ")} ${having.join(" ")}`);
  return last;
}
/**
 * A refusal the plugin must show unchanged: the RPC is refused, the kernel's code is `code`, and the
 * plugin's message ends with the kernel's own code and message, read from what the kernel printed
 * for that call. Another refusal (a kernel busy with something else) fails the check and answers
 * undefined, so that it is never kept as a fixture.
 */
function refused(what, code, method, input, words, having = []) {
  const answer = rpc(method, input);
  if (answer.ok) {
    fail(`${what}: expected the kernel's refusal, and the call went through`, JSON.stringify(answer.value));
    return undefined;
  }
  const record = recorded(words, having);
  let kernel;
  try {
    kernel = JSON.parse(record.stdout).error;
  } catch {
    kernel = undefined;
  }
  if (kernel === undefined) {
    fail(`${what}: the kernel printed no refusal for ${record.argv.join(" ")}`, record.stdout || record.stderr);
    return undefined;
  }
  show("kernel", `${kernel.code}: ${kernel.message}`);
  show("plugin", answer.message);
  if (kernel.code !== code) {
    fail(`${what}: expected the kernel's ${code}, and it refused with ${kernel.code}`);
    return undefined;
  }
  check(answer.message.endsWith(`${kernel.code}: ${kernel.message}`), `${what}: the plugin shows the kernel's refusal unchanged (${kernel.code})`, answer.message);
  return { kernel, record };
}
/**
 * Keeps, as the member `key` of status-recorded.json, the `oats status --json` the kernel printed
 * for the plugin's own read: a refresh makes the plugin read now, and the wrapper's record of that
 * call is what is kept, once every row named in `expected` reads as its check says.
 */
function keepStatus(key, expected) {
  const before = records().length;
  rpc("refresh");
  const fresh = records().slice(before).filter((record) => record.argv[0] === "status" && record.exit === 0);
  const record = fresh[fresh.length - 1];
  if (record === undefined) {
    fail(`status-recorded.json ${key}: the plugin's refresh ran no oats status`);
    return;
  }
  const rows = new Map();
  for (const group of JSON.parse(record.stdout).agents) for (const row of group.instances) rows.set(row.instance, row);
  const wrong = Object.entries(expected).filter(([instance, matches]) => !(rows.has(instance) && matches(rows.get(instance))));
  if (wrong.length > 0 || rows.size !== Object.keys(expected).length) {
    fail(`status-recorded.json ${key}: the status the plugin read is not the state to record`, JSON.stringify([...rows.values()].map((row) => [row.instance, brief(row)])));
    return;
  }
  fixtures.keepIn("roster/status-recorded.json", key, record.stdout);
  pass(`status-recorded.json ${key}: kept from the plugin's own oats status (${[...rows.keys()].join(", ")})`);
}
/** The plugin's own snapshot, read again now; the row of one instance in it. */
function snapshotRow(instance) {
  rpc("refresh");
  const snapshot = rpc("snapshot");
  return snapshot.ok && snapshot.value.ok ? snapshot.value.agents.find((agent) => agent.instance === instance) : undefined;
}
/**
 * Freshness (the UX standard, section 6: "within 3 s of the kernel recording it"): how long after
 * the kernel recorded a change the plugin's own snapshot has it, read as a client reads it (no
 * refresh asked). What brings it is the watch on the event log, or the server's own reread behind a
 * snapshot older than its 15 s poll: this check measures the delay a client sees and holds the order
 * of reads (below), not the watch by itself (live.sh's L2 holds the watch, with the poll off). That the change reaches the tree and the
 * home is the live scenes' (the fake).
 *
 * The delay runs from the kernel's own record: the time of the event the change wrote, as
 * `oats instance events --json` gives it (`kind`, at or after `since`, the moment before the command
 * that made the change), to the moment the snapshot was seen to have it. So it holds the plugin's
 * time and not the `oats` command's own start-up, which on a slow runner is half a second (a run
 * read 3044 ms from before the command, with nothing of the plugin slow). The snapshot is polled
 * first and the event read after, so reading the event costs the measure nothing; the poll starts
 * when the command has returned, and the event taken is the first of its kind since the command, so
 * the delay is never less than the truth. With no such event in
 * the kernel's answer the delay runs from `since` instead, and the check's line says so. The line
 * says both delays, from the kernel's record and from before the command.
 *
 * WHAT IS ASSERTED is the order of reads, not milliseconds (a bound on elapsed time failed pull
 * requests at random on a slow runner: 3145 ms where 3000 were allowed, with nothing of the plugin
 * slow). A snapshot's `at` is the start of the read it is the answer of, and the kernel's event
 * says when it recorded the change: so EVERY snapshot of a read that started at or after the
 * kernel's record must have the change. The check polls the snapshot until it has the change, and
 * fails if any snapshot it saw on the way was of such a read and did not have it (the plugin showed
 * an answer older than the read it made), or if the change never came. It does not fail on what
 * its own polling may have missed: where the change is first seen in the snapshot of a LATER read
 * than the first one started after the record, a NOTE says how many of the plugin's `oats status`
 * calls (the wrapper's records) started between, since the poll cannot tell a snapshot it missed
 * from one that was never shown.
 * WHICH ROAD showed the change is told by order too, and printed (see `by`, below): "its
 * events" only where the snapshot is of a status read that had ENDED before the command that
 * made the change began, and the plugin read that instance's events since; "not told", with
 * why, in every other case of a snapshot older than the record (a status read that ended or was
 * in flight after the command began may hold the change by itself: for a stop the kernel's row
 * says stopped seconds before its event); the status read that started after the
 * record is then waited for, and must confirm what was shown (its delay is printed beside).
 * The delays are still measured and PRINTED, with the kernel's own `oats status` time beside
 * them, and a NOTE reports either one over 3 s (the UX standard's bar): a slow runner is then
 * seen, and fails nothing. What the order cannot hold: HOW SOON the first read after the record
 * started (the watch's signal, the pause after a read in flight: server/core.ts) is time; and a
 * watch that is dead brings the change with the poll's read: live.sh's L2 holds the watch. With no
 * event of the kernel's to count from, the order cannot be told, and the check holds only that the
 * snapshot came to have the change; its line says so.
 */
/** Every freshness measure of the run, for its summary: what changed, and the delay from the kernel's record (null: none to count from, or never seen). */
const freshness = [];
async function fresh(what, { instance, home, kind, since }, matches) {
  let seenAt = null;
  let shownBy = null; // the `at` of the snapshot that first had the change: its read's start
  const without = []; // the `at` of every snapshot polled that did not have it
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    const snapshot = rpc("snapshot");
    if (snapshot.ok && snapshot.value.ok) {
      const agent = snapshot.value.agents.find((candidate) => candidate.instance === instance);
      if (agent !== undefined && matches(agent)) {
        seenAt = Date.now();
        shownBy = Date.parse(snapshot.value.at);
        break;
      }
      without.push(Date.parse(snapshot.value.at));
    }
    await sleep(100);
  }
  const { at: recorded, why } = recordedAt(instance, home, kind, since);
  // WHICH ROAD showed it, told by order and not by the clock, from the wrapper's records of the
  // plugin's own calls:
  // - the snapshot is of a status read that started AFTER the kernel's record: the status read's;
  // - it is of a status read whose call had ENDED before `since`, the moment before the command
  //   that made the change (nothing of the kernel's state has changed before the command starts,
  //   so that answer cannot hold it), and the plugin read this instance's events since: the event
  //   path moved the row;
  // - anything else: NOT TOLD, with why. A status read that ended, or was in flight, between the
  //   command's start and the kernel's record may hold the change by itself: the kernel does not
  //   write its event first. For a stop it writes `stoppedAt` BEFORE it asks the provider and the
  //   "stopped" event seconds later, and `oats status` says stopped from `stoppedAt`: a status
  //   read that ENDED before the event's time can hold it. So the snapshot's older `at` does not
  //   say that the events put the change there, and neither does the event's time.
  let by = null;
  let untold = "";
  if (seenAt !== null && recorded !== null) {
    const calls = records();
    const read = calls.find((record) => record.argv[0] === "status" && Date.parse(record.at) >= shownBy); // the call of the read the snapshot is of: it started just after the server stamped that read
    const eventsRead = calls.some((record) => record.argv[0] === "instance" && record.argv[1] === "events" && record.argv[2] === instance && record.argv.includes("--since") && record.exit === 0 && Date.parse(record.at) >= since && Date.parse(record.at) + record.ms <= seenAt);
    if (shownBy >= recorded) by = "status";
    else if (read === undefined) [by, untold] = ["untold", "the wrapper holds no record of the status read the snapshot is of"];
    else if (Date.parse(read.at) + read.ms >= since) [by, untold] = ["untold", "the snapshot is of a status read that ended, or was in flight, after the command began: it may hold the change by itself"];
    else if (!eventsRead) [by, untold] = ["untold", "the snapshot is of a status read that ended before the command began, and the plugin made no events read of this instance that had answered by then: NEITHER road explains it"];
    else by = "events";
  }
  // Where a status read that started after the record did not show it, that read CONFIRMS it:
  // waited for, and a snapshot of such a read without the change counts against the order below.
  let confirmedAt = by === "status" ? seenAt : null;
  if (by === "events" || by === "untold") {
    for (const end = Date.now() + 30_000; confirmedAt === null && Date.now() < end; await sleep(100)) {
      const snapshot = rpc("snapshot");
      if (!(snapshot.ok && snapshot.value.ok) || Date.parse(snapshot.value.at) <= recorded) continue;
      const agent = snapshot.value.agents.find((candidate) => candidate.instance === instance);
      if (agent !== undefined && matches(agent)) confirmedAt = Date.now();
      else without.push(Date.parse(snapshot.value.at));
    }
  }
  // Both delays are said: from the kernel's record, and from before the command (which holds the command's own run too).
  const fromRecord = seenAt === null || recorded === null ? null : seenAt - recorded;
  const fromCommand = seenAt === null ? null : seenAt - since;
  const confirmed = confirmedAt === null || recorded === null ? null : confirmedAt - recorded;
  const before = Date.now();
  oats("status", "--json");
  const statusMs = Date.now() - before;
  const ms = (delay) => (delay === null ? "never" : `${delay} ms`);
  const counted =
    recorded === null
      ? `${ms(fromCommand)} after the moment before the command`
      : `${ms(fromRecord)} after the kernel recorded it (its "${kind}" event at ${new Date(recorded).toISOString()}), ${ms(fromCommand)} after the moment before the command`;
  const confirmedSaid = `confirmed by the status read that started after the record ${confirmed === null ? "NEVER in 30 s" : `${confirmed} ms after it`}`;
  const road =
    by === "events"
      ? `; shown by ITS EVENTS (the snapshot was of a status read that had ended before the command began, and the plugin read this instance's events since), and ${confirmedSaid}`
      : by === "untold"
        ? `; WHICH ROAD showed it is not told (${untold}), and ${confirmedSaid}`
        : by === "status"
          ? "; shown by a STATUS READ that started after the record (not by its events)"
          : "";
  const timed = `${counted}${road}; the kernel's own oats status took ${statusMs} ms`;
  freshness.push({ what, by, ...(by === "untold" ? { untold } : {}), fromRecordMs: fromRecord, confirmedByStatusMs: by === "events" || by === "untold" ? confirmed : null, fromCommandMs: fromCommand, statusMs });
  if (seenAt === null) {
    fail(`freshness: the plugin's snapshot never had ${what} in 60 s`, timed);
  } else if (recorded === null) {
    pass(`freshness: the plugin's snapshot came to have ${what} (${timed}); the ORDER of reads is not told here: ${why}`);
  } else {
    // A snapshot of a read that started at or after the kernel's record, seen without the change: an answer older than its read.
    const stale = [...new Set(without.filter((at) => at > recorded))]; // (strictly after: the two clocks say milliseconds)
    check(
      stale.length === 0 && confirmedAt !== null,
      `freshness: the plugin's snapshot has ${what}, and no snapshot of a read started after the kernel recorded it was without it (${timed})`,
      stale.length > 0
        ? `${stale.length} snapshot(s) of a read started at or after the kernel's record (${new Date(recorded).toISOString()}) did not have the change: read(s) started ${stale.map((at) => new Date(at).toISOString()).join(", ")}`
        : `no status read that started after the kernel's record (${new Date(recorded).toISOString()}) answered with the change in 30 s: nothing confirmed what was shown`,
    );
    // The plugin's own calls that started after the record and before the read whose snapshot first showed the change.
    const between = records().filter((record) => record.argv[0] === "status" && Date.parse(record.at) >= recorded && Date.parse(record.at) < shownBy);
    if (between.length > 0) note(`freshness: ${what} was first SEEN in the snapshot of a later read: ${between.length} oats status call(s) of the plugin started after the kernel's record and before that read (${between.map((record) => `${record.at} for ${record.ms} ms, exit ${record.exit}`).join("; ")}); the check's own polling may have missed the snapshot of the first`);
  }
  // A delay over 3 s is said, and fails nothing: a slow command, a slow runner, or a change that waited a pause.
  const over = [["after the kernel recorded it", fromRecord], ["after the moment before the command", fromCommand]].filter(([, delay]) => delay !== null && delay > 3000);
  if (over.length > 0) note(`freshness: ${what} was over 3 s: ${over.map(([from, delay]) => `${delay} ms ${from}`).join(", ")} (the kernel's own oats status took ${statusMs} ms)`);
}
/**
 * When the kernel recorded a change: `at`, the time (epoch ms) of the FIRST `kind` event of the
 * instance at or after `since`. The command that makes the change is the first thing after `since`,
 * so its event is the earliest: a later event of the same kind (another claim, by any producer)
 * would make the delay smaller than the truth, and an unrelated one before it only longer. `at` is
 * null when there is none to count from, and `why` then says what was read.
 */
function recordedAt(instance, home, kind, since) {
  const answer = oats("instance", "events", instance, "--home", home, "--limit", "20", "--json");
  const said = (text) => String(text ?? "").replace(/\s+/g, " ").trim().slice(0, 300);
  if (answer.exit !== 0) return { at: null, why: `oats instance events exited ${answer.exit}: ${said(answer.stderr || answer.stdout)}` };
  let events;
  try {
    events = JSON.parse(answer.stdout).result?.events;
  } catch (error) {
    return { at: null, why: `oats instance events printed no JSON (${said(error.message)}): ${said(answer.stdout)}` };
  }
  if (!Array.isArray(events)) return { at: null, why: `oats instance events answered no list of events: ${said(answer.stdout)}` };
  const times = events.filter((event) => event.kind === kind).map((event) => Date.parse(event.at)).filter((at) => Number.isFinite(at) && at >= since);
  return times.length === 0 ? { at: null, why: `the kernel's last ${events.length} events of ${instance} hold no "${kind}" event since then` } : { at: Math.min(...times), why: null };
}
/** The plugin's snapshot agrees with the kernel's row: the thread, and the kernel's words for whether it runs. */
function agrees(instance, row) {
  const mine = snapshotRow(instance);
  check(
    mine !== undefined && mine.threadId === (row.session?.threadId ?? null) && mine.running === (row.running ?? null) && mine.runtimeState === (row.runtimeState ?? null),
    `the plugin's snapshot has ${instance} as the kernel does: thread ${row.session?.threadId}, running ${row.running}, ${row.runtimeState}`,
    JSON.stringify(mine),
  );
}

// ---- the page

let browser;
/** At both widths: the tree's row of the agent, joined to its bb thread, and the thread's header row. */
async function shots(scene, { instance, soul, threadId, state }) {
  const thread = bbThread(threadId);
  for (const view of VIEWS) {
    const { viewport, suffix } = view;
    const at = `${scene} ${view.theme} ${viewport.name}`;
    const page = await viewPage(browser, view, at);
    try {
      await page.goto("/");
      check(await showSidebar(page, viewport), `${at}: the thread list is the OATS sidebar`);
      const row = `${testId("oats-agent-row")}[data-sidebar-thread-id="${threadId}"]`;
      const drawn = await page.until(`document.querySelector(${JSON.stringify(`${row} [data-state="${state}"]`)}) !== null`, 30);
      check(Boolean(drawn), `${at}: the tree has ${instance}, joined to its bb thread ${threadId}, drawn as ${state}`, await page.evaluate(`document.querySelector(${JSON.stringify(row)})?.outerHTML.slice(0, 600) ?? "no such row: " + ${textOf(testId("oats-sidebar"))}`));
      show("row", await page.evaluate(textOf(row)));
      await page.shot(`${scene}-${viewport.name}-sidebar${suffix}`);

      await page.goto(`/projects/${thread.projectId}/threads/${threadId}`);
      check(Boolean(await page.until(visible(testId("oats-identity-row")), 30)), `${at}: the agent's thread shows the header row`);
      // The thread itself says where its agent is, in words (D-113): the state the kernel's row is in, the soul, and OATS.
      // The line's time comes from a read of its own for a stopped agent (its last "stopped" event), which
      // answers after the state is drawn: the line is WAITED for whole, so the image holds what a person
      // ends up seeing, and a time that never came fails the check (part A's UX read, S3).
      const WORD = { working: "Working", idle: "Idle", "needs-you": "Needs you", stopped: "Stopped" };
      const WHOLE = { working: "^Working · started \\S", idle: "^Idle\\b", "needs-you": "^(! )?Needs you\\b", stopped: "^Stopped · since \\S" };
      const lineNow = `JSON.stringify({ state: document.querySelector(${JSON.stringify(testId("oats-status-line"))})?.getAttribute("data-state") ?? null, status: ${textOf(testId("oats-status-line"))}, row: ${textOf(testId("oats-identity-row"))} })`;
      await page.until(`(() => { const line = JSON.parse(${lineNow}); return line.state === ${JSON.stringify(state)} && new RegExp(${JSON.stringify(WHOLE[state])}).test(line.status); })()`, 30);
      const line = JSON.parse(await page.evaluate(lineNow));
      check(line.state === state && new RegExp(WHOLE[state]).test(line.status) && line.row.includes(`instance of ${soul}`) && line.row.includes("Instance panel"), `${at}: the thread's row says "${WORD[state]}"${state === "stopped" ? ", since when (its last recorded stop)" : state === "working" ? ", when OATS last started it" : ""}, the soul with the Desktop's label, and the way to the instance panel`, JSON.stringify(line));
      show("header row", line.row);
      await page.shot(`${scene}-${viewport.name}-thread${suffix}`);
    } finally {
      await page.close();
    }
  }
}
/**
 * For a provider that archives at stop (`stopArchives()`), at both widths: the stopped agent keeps a
 * row in the roster, on no thread (bb lists no archived thread), that says "Stopped" and its soul in
 * the plain tone and opens its archived conversation; and that thread's own row says who it is,
 * "Stopped", since when, "Its conversation is archived in bb. Start begins a new one.", with
 * Start… and Retire… and the way to the instance panel (the plugin's WORDS.md, "Outside OATS"). Each read waits for what it asserts and
 * prints what is there when it is not.
 */
async function archivedShots(scene, { instance, soul, threadId }) {
  for (const view of VIEWS) {
    const { viewport, suffix } = view;
    const at = `${scene} ${view.theme} ${viewport.name}`;
    const page = await viewPage(browser, view, at);
    try {
      await page.goto("/");
      check(await showSidebar(page, viewport), `${at}: the thread list is the OATS sidebar`);
      const row = `${testId("oats-agent-row-threadless")}[data-instance=${JSON.stringify(instance)}]`;
      // The row's words and where it opens come with bb's own answer for the thread, after the roster: both are waited for.
      const ROW = `(() => { const e = document.querySelector(${JSON.stringify(row)}); return JSON.stringify({ facts: (e?.querySelector(${JSON.stringify(testId("oats-row-facts"))})?.innerText ?? "").replace(/\\s+/g, " ").trim(), opens: e?.getAttribute("data-opens") ?? null, mark: e?.querySelector("[data-mark]")?.getAttribute("data-state") ?? null, tone: e?.querySelector("[data-mark]")?.getAttribute("data-tone") ?? null, onItsThread: document.querySelector(${JSON.stringify(`${testId("oats-agent-row")}[data-sidebar-thread-id="${threadId}"]`)}) !== null }); })()`;
      const wanted = JSON.stringify({ facts: `Stopped · ${soul}`, opens: "thread", mark: "stopped", tone: null, onItsThread: false });
      const drawn = (await page.until(`(() => { const read = ${ROW}; return read === ${JSON.stringify(wanted)} ? read : ""; })()`, 30)) || (await page.evaluate(ROW));
      check(drawn === wanted, `${at}: ${instance} keeps its row in the roster, on no thread: "Stopped", its soul, the plain tone, and it opens its archived thread`, `${drawn}; the sidebar: ${await page.evaluate(textOf(testId("oats-sidebar")))}`);
      show("row", await page.evaluate(textOf(row)));
      await page.shot(`${scene}-${viewport.name}-sidebar${suffix}`);

      // The row opens the archived conversation, as a person's press does.
      await page.evaluate(`document.querySelector(${JSON.stringify(row)})?.click()`);
      const opened = await page.until(`location.pathname.endsWith(${JSON.stringify(`/threads/${threadId}`)}) ? location.pathname : ""`, 30);
      check(Boolean(opened), `${at}: the row opens the archived thread ${threadId}`, opened ?? (await page.evaluate("location.pathname")));
      // That thread's own row, once it says where the agent is: the state, the fact, and the two acts that can be pressed.
      const LINE = `(() => { const e = document.querySelector(${JSON.stringify(`${testId("oats-identity-row")}[data-outside="stopped-archived"]`)}); const acts = [...(e?.querySelectorAll(${JSON.stringify('[data-testid^="oats-agent-act-"]')}) ?? [])]; return JSON.stringify({ state: e?.querySelector(${JSON.stringify(testId("oats-status-line"))})?.getAttribute("data-state") ?? null, agent: (e?.querySelector(${JSON.stringify(testId("oats-outside-agent"))})?.innerText ?? "").trim(), line: (e?.querySelector(${JSON.stringify(testId("oats-status-line"))})?.innerText ?? "").replace(/\\s+/g, " ").trim(), acts: acts.map((act) => [act.getAttribute("data-testid"), act.innerText.trim(), act.disabled]), panel: e?.querySelector(${JSON.stringify(testId("oats-open-panel"))})?.innerText.trim() ?? null }); })()`;
      // The whole line: the state, since when (read from the agent's recorded stop, after the row is drawn), the sentence, the acts.
      const WHOLE = String.raw`^Stopped · since .+ · ` + ARCHIVED_IN_BB.replace(/\./g, String.raw`\.`) + String.raw` Start… Retire… Instance panel$`;
      const line = JSON.parse((await page.until(`(() => { const read = JSON.parse(${LINE}); return read.state === "stopped" && new RegExp(${JSON.stringify(WHOLE)}).test(read.line) && read.acts.every((act) => act[2] === false) ? JSON.stringify(read) : ""; })()`, 30)) || (await page.evaluate(LINE)));
      check(
        line.state === "stopped" && new RegExp(WHOLE).test(line.line) && line.agent === nameOf(instance) && JSON.stringify(line.acts) === JSON.stringify([["oats-agent-act-start", "Start…", false], ["oats-agent-act-retire", "Retire…", false]]) && line.panel === "Instance panel",
        `${at}: the archived thread's own row names the agent and says "Stopped", since when, and "${ARCHIVED_IN_BB}", with Start… and Retire… that can be pressed and the way to the instance panel`,
        JSON.stringify(line),
      );
      show("header row", `${line.agent} | ${line.line}`);
      await page.shot(`${scene}-${viewport.name}-thread${suffix}`);
    } finally {
      await page.close();
    }
  }
}
/** What the archived thread's row says of a stopped agent: the plugin's sentence (WORDS.md, "Outside OATS"; app/outside/words.ts). */
const ARCHIVED_IN_BB = "Its conversation is archived in bb. Start begins a new one.";
/**
 * With the release's DEFAULT pages (the home alone: what a person sees first), at both widths: the
 * sidebar holds the real agent's row and who waits, and no link to a page that is not shown. The
 * setting is left as a fresh install has it, UNSET (bb's own `plugin config oats unset pages`),
 * not set to "home": so this holds what an unset setting hides. All six are set again after.
 */
async function defaultPagesShots(scene, { instance, threadId }) {
  bb("plugin", "config", "oats", "unset", "pages");
  try {
    for (const view of VIEWS) {
      const { viewport, suffix } = view;
      const at = `${scene} ${view.theme} ${viewport.name}`;
      const page = await viewPage(browser, view, at);
      try {
        await page.goto("/");
        check(await showSidebar(page, viewport), `${at}: the thread list is the OATS sidebar`);
        const row = `${testId("oats-agent-row")}[data-sidebar-thread-id="${threadId}"]`;
        // Waited for: the row, and the count of who waits as a button (it is one only once bb has given the settings).
        const side = await page.until(`(() => { const s = document.querySelector(${JSON.stringify(testId("oats-sidebar"))}); if (!s || !s.querySelector(${JSON.stringify(row)})) return ""; const needs = s.querySelector(${JSON.stringify(testId("oats-needs-line"))}); if (needs?.tagName !== "BUTTON") return ""; return JSON.stringify({ pages: s.querySelector(${JSON.stringify(testId("oats-pages"))}) !== null, links: s.querySelectorAll('[data-testid^="oats-page-link-"]').length }); })()`, 30);
        check(side === JSON.stringify({ pages: false, links: 0 }), `${at}: with the setting left as installed (unset) the sidebar has ${instance}'s row and who waits, and no link to a page that is not shown`, side ?? (await page.evaluate(textOf(testId("oats-sidebar")))));
        await page.shot(`${scene}-${viewport.name}-sidebar${suffix}`);
      } finally {
        await page.close();
      }
    }
  } finally {
    bb("plugin", "config", "oats", "set", "pages", "home, automations, souls, capabilities, teams, machines");
  }
}
/** At both widths: the agent stays in the roster, as a row that says its thread was deleted in bb, and its soul's page says "thread missing", with Start and Retire. */
async function missingShots(scene, { instance, soul }) {
  for (const view of VIEWS) {
    const { viewport, suffix } = view;
    const at = `${scene} ${view.theme} ${viewport.name}`;
    const page = await viewPage(browser, view, at);
    try {
      await page.goto(`/plugins/oats/souls/${soul}`);
      const line = await page.until(`(() => { const t = (document.querySelector(${JSON.stringify(`${testId("oats-soul-agent-detached")}[data-instance="${instance}"]`)})?.innerText ?? "").replace(/\\s+/g, " ").trim(); return t; })()`, 30);
      check(Boolean(line) && /thread missing/.test(line) && /Start/.test(line) && /Retire/.test(line), `${at}: the soul's page says "thread missing" for ${instance}, with Start and Retire`, line ?? (await page.evaluate(textOf(testId("oats-soul-detail")))));
      show("line", line);
      await page.shot(`${scene}-${viewport.name}-soul${suffix}`);
      await page.goto("/");
      check(await showSidebar(page, viewport), `${at}: the thread list is still drawn`);
      // The agent stays in the roster (S3): a row of its own that says where it is in a word, its soul,
      // and the reason: bb has no thread of that id (app/outside). The read waits on that row's words
      // (bb's own answer for the id arrives after the roster).
      const row = `${testId("oats-agent-row-threadless")}[data-instance=${JSON.stringify(instance)}]`;
      const factsNow = `(document.querySelector(${JSON.stringify(`${row} ${testId("oats-row-facts")}`)})?.innerText ?? "").replace(/\\s+/g, " ").trim()`;
      const DELETED = "Stopped · deleted in bb"; // the reason takes the soul's place on the row
      const facts = (await page.until(`(() => { const facts = ${factsNow}; return facts === ${JSON.stringify(DELETED)} ? facts : ""; })()`, 30)) || (await page.evaluate(factsNow));
      check(facts === DELETED, `${at}: ${instance} stays in the roster: "Stopped", then the reason, "deleted in bb"`, facts ?? (await page.evaluate(textOf(testId("oats-sidebar")))));
      show("row", facts);
      await page.shot(`${scene}-${viewport.name}-sidebar${suffix}`);
    } finally {
      await page.close();
    }
  }
}

// ---- the run

const fixtures = new Fixtures({ out: join(OUT, "fixtures"), substitutions: [[DEPLOY, "/abs/deployment"], [REAL, "/abs/real"], [homedir(), "/abs/home"], [hostname(), "machine"]] });
/** Answers kept as evidence beside the fixtures: verbs whose fixture is not replaced by this run. */
const evidence = new Fixtures({ out: join(OUT, "answers"), substitutions: [] });
/**
 * The server's pacing (server/core.ts, FOLLOW_UP_WITHIN_MS): a read asked for while another is in
 * flight starts AT ONCE when that one ends, if it answered within 2 s, and only once. Shown with the
 * plugin's own `oats status` calls, as the wrapper recorded them (when each started and how long it
 * took, the time it is held here included):
 * - the agent sets a claim (its event starts a read) and clears it while that read is in flight
 *   (each status is held 600 ms for that, and the clear is run the moment the plugin's `oats
 *   status` is SEEN running, in the process list: not after a guess of when it started): the read
 *   that follows must start sooner after the first ended than the pause allows any other read.
 *   The server counts its pause (1 s at least) from a moment after the kernel's exit, and the
 *   next call's start is after the server's own, so a gap under 1 s between two calls is a read
 *   at once, and nothing else makes one (no reload of the plugin and no change of its settings
 *   happens inside this step). A gap BELOW ZERO is two calls alive at once, which the server
 *   must never make: it fails the step, and is never taken for a read at once;
 * - once that first read's record exists and a status is seen running again, the agent sets a
 *   claim again: it lands in the read at once, and the read IT asks for must wait the pause (a gap
 *   of 1 s or more to the plugin's next status call, whatever its exit): never two reads at once
 *   in a row.
 * Why the first form of this step failed a run by chance: the host's watch waits before it tells
 * (250 ms then; 75 ms since the event path), and `oats instance attention` is quick; with the
 * clear run straight after the set, the two events were about one such wait apart: under it they
 * reached the server as ONE signal, before any read had started, and no change landed in a read.
 * The clear was too EARLY, never too late: hence the wait on a status seen running, which holds
 * whatever the watch's wait is. (The event path reads the instance's events on each of these
 * signals too: those calls are the wrapper's `instance …` records, not `status`, are not held,
 * and are not counted here.)
 * The three changes are tried up to four times, and every try is printed with its reads and their
 * times. What the run cannot show it says, and does not pass or fail on: a kernel so slow here
 * that the first read of every try took the server's limit or more, the host call around it
 * counted (the server then rightly waits the pause: a NOTE), and a pair after which no call came
 * (a NOTE: "never two" is then not shown by this run). No limit on elapsed time is asserted: only
 * which rule the reads took.
 */
const statusCalls = (from = 0) => records().slice(from).filter((record) => record.argv[0] === "status");
const statusReads = (from = 0) => statusCalls(from).filter((record) => record.exit === 0);
/** Whether an `oats status` of the plugin's is running now: the wrapper's own process (it holds the call as long as it is told before it starts the kernel). */
const statusRunning = () => execFileSync("ps", ["-eo", "args"], { encoding: "utf8" }).split("\n").some((line) => /oats-record\s+status(\s|$)/.test(line));
/** Waits, looking every 25 ms, until `seen()`; false when it did not come in `seconds`. */
const soon = async (seen, seconds = 15) => {
  const deadline = Date.now() + seconds * 1000;
  while (!seen()) {
    if (Date.now() > deadline) return false;
    await sleep(25);
  }
  return true;
};

/**
 * A WINDOW THAT LOADS WHILE THE PLUGIN READS A CHANGE shows the change when that read ends, on that
 * one read, and with no other change made.
 *
 * The plugin's `oats status` is held (the wrapper) so that a read is surely under way; the agent
 * sets a claim, which starts that read; a NEW window is loaded while the read runs. The server
 * answers the window's first read from its cache, the roster from before the claim, and publishes
 * the change when its read ends. The window must then show the claim.
 *
 * WHAT THIS STEP HOLDS, AND WHAT IT DOES NOT. It holds the whole path for a window loaded inside a
 * read, on the real kernel: the first answer from the cache, the event, the reread, the row. It
 * does NOT meet the race that `app/store.ts` closes (an event published while the window's FIRST
 * answer is still on its way), and cannot: a try counts only when the window had already drawn
 * the roster from its first answer while the read still ran, so in every try that counts the
 * first answer came before the event. With the flaw in the app this step passes too. The race is
 * arranged in test/app/window-loads.test.tsx, and nowhere else: this step is no evidence for that
 * fix. It is here so that the load-inside-a-read path is held on the real kernel once.
 *
 * No bound on elapsed time. The hold grows with each try (6, 10, 14 s) (a window on a slow host takes longer to
 * load and draw than a short hold leaves); a try whose load missed the read is made again; and
 * where every try missed it, the step says NOT SHOWN in a NOTE and fails nothing, as the pacing
 * step does for a slow kernel. What it asserts is the order: the window shows the claim with ONE
 * status read of the plugin's since the claim (the one that carried it, not a later poll's).
 */
async function loadedWhileReading(asInstance, { instance, threadId }) {
  // The hold of each try, longer each time, and well under the 20 s after which a status is given up: the kernel's
  // own status runs after the hold, inside that limit.
  const HOLDS_MS = [6000, 10000, 14000];
  const view = VIEWS[0];
  const at = `A5b3 ${view.theme} ${view.viewport.name}`;
  const facts = `(document.querySelector(${JSON.stringify(`${testId("oats-sidebar")} ${testId("oats-agent-row")}[data-sidebar-thread-id="${threadId}"] ${testId("oats-row-facts")}`)})?.innerText ?? "").replace(/\\s+/g, " ").trim()`;
  const ended = (read) => Date.parse(read.at) + read.ms;
  let held = null; // the try whose window was loaded inside the read: { drawn, shown, reads, ms }
  const missed = [];
  try {
    for (let attempt = 1; attempt <= HOLDS_MS.length && held === null; attempt += 1) {
      const HELD_MS = HOLDS_MS[attempt - 1];
      wrapper({ delays: { status: HELD_MS } });
      // Quiet first: no status of the plugin's is RUNNING (a poll's, held, would be taken for the claim's and have less
      // of its hold left) and none ended in the last 3 s: the claim's event then starts a read with no wait.
      // (And the server's pause after a read is that read's own length: a read held by the try before must be that long past.)
      // (Waited for with `soon`, which fails nothing: on a host where it does not come the try is a miss, not a failure.)
      if (!(await soon(() => !statusRunning() && statusReads().every((read) => Date.now() - ended(read) > Math.max(3000, read.ms)), 120))) {
        missed.push(`try ${attempt} (held ${HELD_MS} ms): the plugin's status reads were not quiet within 120 s`);
        wrapper({});
        continue;
      }
      const before = records().length;
      const page = await viewPage(browser, view, at);
      try {
        const set = asInstance("instance", "attention", "--message", `Loaded while reading ${attempt}`);
        const reading = set.status === 0 && (await soon(statusRunning));
        // The window is loaded NOW, while that read runs: its first answer is the server's cache, from before the claim.
        await page.goto("/");
        const shownSidebar = await showSidebar(page, view.viewport);
        const drawn = (await page.until(facts, 30)) ?? null; // (`page.until` answers undefined when its time is up)
        const inside = reading && statusRunning() && statusReads(before).length === 0; // the read had not ended when the window had drawn its roster
        if (!(shownSidebar && inside && drawn !== null && !/^Needs you/.test(drawn))) {
          missed.push(`try ${attempt} (held ${HELD_MS} ms): ${!reading ? "no read was seen running" : !shownSidebar ? "the sidebar was not shown" : drawn === null ? "the window drew no row in 30 s" : !inside ? "the read had ended before the window drew its roster" : `the window's first roster already said "${drawn}"`}`);
        } else {
          // Nothing else changes from here. The read ends, the server publishes, and the window must show the claim.
          const shown = (await page.until(`/^Needs you/.test(${facts}) ? ${facts} : ""`, 60)) ?? null;
          // No status of the plugin's has ANSWERED since the claim (the kernel's own read ran over what the hold left of
          // its limit and was stopped: a stopped call leaves no record at all, so it is the answered ones that are
          // counted): nothing carried the change to the window, and the try says nothing of the plugin.
          const answered = statusReads(before).length;
          if (shown === null && answered === 0) missed.push(`try ${attempt} (held ${HELD_MS} ms): no oats status of the plugin's answered since the claim`);
          else held = { drawn, shown, reads: answered, ms: HELD_MS };
        }
      } finally {
        await page.close();
        wrapper({});
        asInstance("instance", "attention", "--clear");
        await untilRow(instance, "no claim after the try", (r) => r.waitingOnYou == null);
      }
    }
  } finally {
    wrapper({});
  }
  if (missed.length > 0) say(`NOTE loaded while reading: ${missed.join("; ")}`);
  if (held === null) {
    // No try put the load inside the read: nothing is asserted of the window, and nothing fails (a slow host, not the plugin).
    say(`NOTE loaded while reading: NOT SHOWN in this run: none of the ${HOLDS_MS.length} tries (held ${HOLDS_MS.join(", ")} ms) counted, each for the reason said above`);
    return;
  }
  check(true, `${at}: a window was loaded while the plugin read a change (the read, held ${held.ms} ms, was still running when the window had drawn the roster from before it: "${held.drawn}")`);
  check(held.shown !== null, `${at}: that window shows the change ("${held.shown ?? ""}") once the read has ended, with no other change made: it does not keep the roster from before it`, `the row still said "${held.drawn}" after 60 s; status reads of the plugin's since the claim: ${held.reads}`);
  check(held.shown === null || held.reads === 1, `${at}: it shows it on the ONE read that carried the change (${held.reads} status read(s) of the plugin's since the claim when the window showed it), not on a later poll's`, String(held.reads));
}

async function followedAtOnce(asInstance) {
  const PAUSE_MS = 1000; // the floor between two reads that are not a pair (MIN_INTERVAL_MS)
  const LIMIT_MS = 2000; // FOLLOW_UP_WITHIN_MS
  // The wrapper's `ms` (its hold included) from which the server's own measure, which holds the host
  // call around it too (some tens of ms), is at the limit or over it: under this mark the server
  // must read at once, and a miss is a failure, not a slow kernel.
  const NEAR_MS = LIMIT_MS - 150;
  const HELD_MS = 600;
  const ended = (read) => Date.parse(read.at) + read.ms;
  const tries = [];
  let pair = null; // { first, second, gap, after }: `after` is the gap to the read after the pair, or null
  let slow = 0;
  const overlapped = []; // tries in which two status calls of the plugin's were alive at once
  for (let attempt = 1; attempt <= 4 && (pair === null || pair.after === null); attempt += 1) {
    wrapper({ delays: { status: HELD_MS } });
    // Quiet first: no `oats status` of the plugin's ended in the last 3 s (the last read and its
    // pause are over), so the claim's event starts a read with no wait.
    await until("no oats status of the plugin's in the last 3 s", () => statusReads().every((read) => Date.now() - ended(read) > 3000), 60);
    const before = records().length;
    const set = asInstance("instance", "attention", "--message", `Pacing check ${attempt}`);
    // The read the claim's event started is seen running: the clear is made now, and lands in it.
    const first = await soon(statusRunning);
    const cleared = asInstance("instance", "attention", "--clear");
    // The first read has ended (its record is written at its end) and a status runs again: the read
    // at once, if there is one. The claim is set again now, and lands in that second read.
    const second = (await soon(() => statusReads(before).length >= 1)) && (await soon(statusRunning, 5));
    const again = asInstance("instance", "attention", "--message", `Pacing check ${attempt}, again`);
    // The reads the three changes ask for, waited for: two at least, and then none for 3 s.
    await until("the reads the changes ask for have ended", () => {
      const since = statusReads(before);
      return since.length >= 2 && since.every((read) => Date.now() - ended(read) > 3000);
    }, 60);
    wrapper({});
    // Every status call of the plugin's since the claim, whatever its exit, in the order they started.
    const reads = statusCalls(before);
    const gaps = reads.slice(1).map((read, index) => ({ first: reads[index], second: read, gap: Date.parse(read.at) - ended(reads[index]) }));
    const of = (read) => `a read of ${read.ms} ms${read.exit === 0 ? "" : ` (exit ${read.exit})`}`;
    const said = gaps.map(({ first, second, gap }) => `${of(first)}, then ${gap} ms, then ${of(second)}`).join("; ");
    if (gaps.some(({ gap }) => gap < 0)) overlapped.push(`try ${attempt}: ${said}`);
    tries.push(`try ${attempt} (attention ${set.status}, clear ${cleared.status} ${first ? "with a status seen running" : "with NO status seen running"}, attention ${again.status} ${second ? "with the next status seen running" : "with no next status seen running"}): ${reads.length} reads${said === "" ? "" : `: ${said}`}`);
    if (reads.length > 0 && reads[0].ms >= NEAR_MS) slow += 1;
    // A read at once: two calls that ANSWERED, the second started after the first ended and under the pause after it.
    const at = gaps.findIndex(({ first, second, gap }) => gap >= 0 && gap < PAUSE_MS && first.exit === 0 && second.exit === 0 && first.ms <= LIMIT_MS);
    if (at !== -1 && (pair === null || pair.after === null)) pair = { ...gaps[at], after: gaps[at + 1]?.gap ?? null };
    // The claim of this try is cleared before the next, and before the steps after this one.
    check(asInstance("instance", "attention", "--clear").status === 0, `pacing: the claim of try ${attempt} is cleared`);
  }
  for (const line of tries) show("pacing", line);
  check(overlapped.length === 0, "pacing: no two oats status calls of the plugin's were alive at once", overlapped.join(" | "));
  if (pair === null && slow === tries.length) {
    note(`pacing: NOT SHOWN in this run: the first read of every try took ${NEAR_MS} ms or more with the ${HELD_MS} ms it is held here, which with the host call around it is the server's limit of ${LIMIT_MS} ms or over it, so the server rightly waited the pause: ${tries.join(" | ")}`);
    return;
  }
  check(
    pair !== null,
    pair === null
      ? "pacing: a change that landed while a read was in flight was read at once"
      : `pacing: a change that landed while a read was in flight was read at once: the first read took ${pair.first.ms} ms (the ${HELD_MS} ms it is held here among them), the next started ${pair.gap} ms after it ended (under the ${PAUSE_MS} ms no other read goes below) and took ${pair.second.ms} ms`,
    tries.join(" | "),
  );
  if (pair === null) return;
  if (pair.after === null) note(`pacing: "never two reads at once in a row" is NOT SHOWN in this run: no read followed the pair in any try (the third change did not land in the second read): ${tries.join(" | ")}`);
  else check(pair.after >= PAUSE_MS, `pacing: never two reads at once in a row: the read after the pair started ${pair.after} ms after the pair's second read ended (the pause: ${PAUSE_MS} ms at least)`, tries.join(" | "));
}
const wrapper = (settings) => writeFileSync(WRAPPER_CONFIG, JSON.stringify({ ...JSON.parse(readFileSync(WRAPPER_CONFIG, "utf8")), delayMs: 0, delays: {}, ...settings }));

say(`== the real run: bb ${bb("--version").trim()}, oats ${JSON.parse(oats("version", "--json").stdout).version}, ${existsSync(join(REAL, "refs.json")) ? readFileSync(join(REAL, "refs.json"), "utf8").trim() : "refs not recorded"}`);
// A bb that was never opened shows its first-run guide in place of the app (live-ui.mjs).
bb("settings", "general", "onboardingCompletedAt", new Date().toISOString());
browser = await launchBrowser({ chromium: process.env.CHROMIUM ?? "chromium", out: OUT, base: BASE });

try {
  // ======================================================================= part A
  const A = { instance: "flaky-ci-2-developer", soul: "oats-developer" };
  const home = join(DEPLOY, "agents", A.soul, "instances", A.instance);

  step("A0 the deployment, read through the plugin");
  rpc("refresh");
  const first = rpc("snapshot");
  check(first.ok && first.value.ok === true && first.value.deployment.root === DEPLOY, "the plugin reads the deployment through the real oats", JSON.stringify(first));
  show("snapshot", first.ok ? { ...first.value, agents: first.value.agents.map((agent) => agent.instance) } : first);
  const souls = act("the souls", "souls");
  check(souls?.souls.some((soul) => soul.name === A.soul && soul.spawnable && !soul.capabilities.some((id) => /aweb/.test(id))), `${A.soul} is spawnable and has no messaging capability`, JSON.stringify(souls?.souls.find((soul) => soul.name === A.soul)));

  step("A1 spawn preview");
  hold(A.instance);
  const task = taskOf(A.instance, "Fix the flaky CI job.");
  const preview = act("spawn preview", "spawnPreview", { soul: A.soul, name: A.instance, task });
  check(preview?.summary.problems.length === 0 && /^claude · /.test(preview?.summary.launch ?? ""), "the preview names the launch and no problem", JSON.stringify(preview));
  const previewRecord = recorded(["spawn", A.soul], ["--preview"]);
  evidence.keep("spawn-preview.json", previewRecord.stdout);
  // The deployment has no full-mode default (workspace.sh): the mode is the plugin's own `--yolo`.
  const previewed = JSON.parse(previewRecord.stdout).result;
  check(previewRecord.argv.includes("--yolo") && previewed.decision?.effective?.yolo === true && previewed.launchConfig == null, "the plugin's preview asks for bb's full mode (--yolo), and the kernel's decision has yolo true from no launch configuration", JSON.stringify({ argv: previewRecord.argv, effective: previewed.decision?.effective, launchConfig: previewed.launchConfig }));
  show("the kernel's decision", { yolo: previewed.decision?.effective?.yolo, launchConfig: previewed.launchConfig, backend: previewed.decision?.effective?.backend });

  step("A2 spawn: the new thread's id");
  const spawned = act("spawn", "spawn", { soul: A.soul, name: A.instance, task, key: "spawn-1f0c9a7e" });
  const spawnRecord = recorded(["spawn", A.soul], ["--idempotency-key"]);
  const spawnAnswer = JSON.parse(spawnRecord.stdout).result;
  fixtures.keep("spawn/spawn.json", spawnRecord.stdout);
  check(spawned?.instance === A.instance && /^thr_/.test(spawned?.threadId ?? "") && spawned.threadId === spawnAnswer.session.endpoint.threadId, "the spawn answers the instance and the bb thread the kernel named");
  check(spawnRecord.argv.includes("--yolo") && spawnAnswer.yolo === true && spawnAnswer.launchConfig == null && spawnAnswer.launched === true, "the spawn launched in bb's full mode by the plugin's own --yolo: the answer has yolo true and names no launch configuration", JSON.stringify({ argv: spawnRecord.argv, yolo: spawnAnswer.yolo, launchConfig: spawnAnswer.launchConfig, launched: spawnAnswer.launched }));
  show("the spawn's answer", { yolo: spawnAnswer.yolo, launchConfig: spawnAnswer.launchConfig, launched: spawnAnswer.launched });
  let threadId = spawned.threadId;
  let row = await untilRow(A.instance, "working (running true)", (r) => r.running === true);
  check(row?.backend === "bb" && row.session?.provider === "oats.bb" && row.session.threadId === threadId && row.runtimeState === "unknown" && typeof row.open?.url === "string", "oats status: on bb, the same thread, running true / unknown, with a link to open it", brief(row));
  show("oats status", brief(row));
  // bb shows a thread "starting" before its first turn is "active"; the kernel calls both running.
  let thread = await until("bb to show the thread in its turn", () => {
    const now = bbThread(threadId);
    return now?.status === "active" ? now : undefined;
  }, 30);
  const project = bbProjects().find((candidate) => candidate.id === thread?.projectId);
  check(thread?.status === "active" && JSON.stringify(project ?? {}).includes(home), "bb: the thread is active, in a project rooted at the agent's home", JSON.stringify({ thread, project }));
  show("bb thread", { id: thread?.id, status: thread?.status, projectId: thread?.projectId, title: thread?.title });
  agrees(A.instance, row);
  keepStatus("working", { [A.instance]: (r) => r.running === true && r.runtimeState === "unknown" && r.session?.threadId === threadId });
  await shots("real-working", { ...A, threadId, state: "working" });
  await defaultPagesShots("real-default", { ...A, threadId });

  step("A3 edge: a second spawn with the same name");
  refused("a second spawn of the same name", "E_INSTANCE_NAME_TAKEN", "spawn", { soul: A.soul, name: A.instance, task: "again", key: "spawn-2b1d8c6f" }, ["spawn", A.soul]);

  step("A4 edge: start on a running agent");
  refused("start on a running agent", "E_SESSION_RUNNING", "start", { instance: A.instance }, ["session", "start"]);

  step("A5 the turn ends: idle");
  release(A.instance);
  row = await untilRest(A.instance, "idle", (r) => idleRunning(r) && r.runtimeState === "unknown" && settled(r));
  show("oats status", brief(row));
  thread = bbThread(threadId);
  check(thread?.status === "idle", "bb: the thread is idle", JSON.stringify(thread));
  agrees(A.instance, row);
  keepStatus("idle", { [A.instance]: (r) => idleRunning(r) && r.runtimeState === "unknown" && r.waitingOnYou == null && r.session?.threadId === threadId });
  await shots("real-idle", { ...A, threadId, state: "idle" });

  step("A5b the agent asks for a person (a waiting claim): needs you");
  // As the agent's own session does it: `oats instance attention` in the home, with the session's environment.
  const asInstance = (...args) => spawnSync(OATS, args, { cwd: home, encoding: "utf8", env: { ...process.env, OATS_INSTANCE: A.instance, OATS_INSTANCE_HOME: home } });
  const askedAt = Date.now(); // before the command: the kernel's event of the claim is at or after it
  const asked = asInstance("instance", "attention", "--message", "Keep the retry, or fail the job?");
  check(asked.status === 0, "oats instance attention, run in the agent's home", asked.stdout + asked.stderr);
  await fresh("the claim", { instance: A.instance, home, kind: "waiting", since: askedAt }, (agent) => agent.waiting !== null);
  row = await untilRow(A.instance, "a waiting claim", (r) => r.waitingOnYou != null);
  show("oats status", brief(row));
  const waiting = snapshotRow(A.instance)?.waiting;
  check(waiting?.reason === row?.waitingOnYou?.reason && waiting?.message === "Keep the retry, or fail the job?", "the plugin's snapshot has the claim, with the kernel's reason and the agent's message", JSON.stringify(waiting));
  keepStatus("needsYou", { [A.instance]: (r) => idleRunning(r) && r.waitingOnYou?.message === "Keep the retry, or fail the job?" });
  await shots("real-needs-you", { ...A, threadId, state: "needs-you" });
  const clearedAt = Date.now();
  check(asInstance("instance", "attention", "--clear").status === 0, "the claim is cleared");
  await fresh("the claim cleared", { instance: A.instance, home, kind: "waiting", since: clearedAt }, (agent) => agent.waiting === null);
  await untilRow(A.instance, "no claim", (r) => r.waitingOnYou == null);

  step("A5b2 a change that lands while the plugin reads OATS is read at once when that read ends: one read at once, never two");
  await followedAtOnce(asInstance);
  await untilRow(A.instance, "no claim after the pacing check", (r) => r.waitingOnYou == null);

  step("A5b3 a window that loads while the plugin reads a change shows the change when that read ends, with no other change made");
  await loadedWhileReading(asInstance, { instance: A.instance, threadId });

  step("A5c the agent asks a question (Claude Code's AskUserQuestion): oats.core's claim, answered on the home's card");
  // Not the agent's own claim: the hooks oats.core wrote into the home's Claude settings set it when
  // Claude Code calls AskUserQuestion, and clear it when the session moves on. The mock asks the
  // question a person's message names (mock-anthropic.mjs, MOCK-ASK).
  const QUESTION = "Retry the flaky job once more, or mark it as failed?";
  const ask = { questions: [{ question: QUESTION, header: "Flaky job", multiSelect: false, options: [{ label: "Retry", description: "Run the job one more time." }, { label: "Mark failed", description: "Fail the job now." }] }] };
  const hooks = readFileSync(join(home, ".claude", "settings.json"), "utf8");
  show("the hook that sets the claim", JSON.parse(hooks).hooks?.PreToolUse?.find((group) => group.matcher === "AskUserQuestion")?.hooks?.[0]?.command ?? "none in the home's .claude/settings.json");
  say(`     ${bb("thread", "tell", threadId, `One more thing before you go on.\nMOCK-ASK:${JSON.stringify(ask)}\n`).trim()}`);
  const pendingQuestions = () => bbJson("thread", "interactions", "list", threadId).filter((interaction) => interaction.status === "pending");
  const pendingQuestion = await until("bb to show the question as a pending interaction", () => pendingQuestions()[0], 60);
  check(pendingQuestion?.payload?.kind === "user_question", "bb: the thread has one pending interaction, a question", JSON.stringify(pendingQuestion));
  row = await untilRow(A.instance, "oats.core's claim", (r) => r.waitingOnYou != null);
  check(row?.waitingOnYou?.producer === "oats.core" && row.waitingOnYou.reason === "question" && row.waitingOnYou.message === QUESTION, "oats status: a waiting claim of producer oats.core, reason question, with the question's text", brief(row));
  show("oats status", brief(row));
  const questionClaim = snapshotRow(A.instance)?.waiting;
  check(questionClaim?.reason === "question" && questionClaim.message === QUESTION, "the plugin's snapshot has the claim, with the kernel's reason and the question", JSON.stringify(questionClaim));
  keepStatus("question", { [A.instance]: (r) => r.waitingOnYou?.producer === "oats.core" && r.waitingOnYou.reason === "question" && r.session?.threadId === threadId });
  await shots("real-question", { ...A, threadId, state: "needs-you" });
  // The home's card: the question and one button per option; the last width answers it, as a person does.
  const card = `[...document.querySelectorAll(${JSON.stringify(testId("oats-needs-card"))})].find((e) => e.innerText.includes(${JSON.stringify(QUESTION)}))`;
  for (const view of VIEWS) {
    const { viewport, suffix } = view;
    const at = `real-question ${view.theme} ${viewport.name}`;
    const page = await viewPage(browser, view, at);
    try {
      await page.goto("/plugins/oats/home");
      const choices = await page.until(`(() => { const c = ${card}; const b = c ? [...c.querySelectorAll(${JSON.stringify(testId("oats-needs-choice"))})].map((e) => e.innerText.trim()) : []; return b.length > 0 ? JSON.stringify({ question: c.querySelector(${JSON.stringify(testId("oats-needs-question"))})?.innerText.trim(), choices: b }) : ""; })()`, 30);
      check(choices === JSON.stringify({ question: QUESTION, choices: ["Retry", "Mark failed"] }), `${at}: the home's card shows the question and its two choices`, choices ?? (await page.evaluate(textOf(testId("oats-home-needs")))));
      // The home's tiles count what OATS lists: the image is taken once none still says "Counting…" (one state in an image). True at once on a home with no tiles.
      await page.until(`![...document.querySelectorAll('[data-testid="oats-home-tiles"] button')].some((tile) => tile.innerText.includes("Counting"))`, 20);
      await page.shot(`real-question-${viewport.name}-home${suffix}`);
      if (view !== VIEWS[VIEWS.length - 1]) continue;
      await page.evaluate(`[...(${card}).querySelectorAll(${JSON.stringify(testId("oats-needs-choice"))})].find((e) => e.innerText.trim() === "Retry").click()`);
      // The card says what was answered, until the agent goes on and its card leaves (asked by the home: the lead's ruling on its UX read).
      const said = await page.until(`(() => { const c = ${card}; return c?.querySelector('[data-testid="oats-needs-answered"]')?.innerText.trim() ?? ""; })()`, 15);
      check(said === "Answered: Retry. Waiting for the agent to go on.", `${at}: the card says what was answered`, said ?? (await page.evaluate(textOf(testId("oats-home-needs")))));
      await page.shot(`real-question-${viewport.name}-home-answered${suffix}`);
      const answered = await until("bb to have no pending interaction for the thread", () => pendingQuestions().length === 0, 60);
      check(Boolean(answered), `${at}: "Retry" on the card answers the question (the plugin's threads.interactions.resolve)`, JSON.stringify(bbJson("thread", "interactions", "list", threadId)));
    } finally {
      await page.close();
    }
  }
  row = await untilRest(A.instance, "no claim, its turn over", (r) => r.waitingOnYou == null && idleRunning(r) && settled(r));
  check(row !== undefined, "oats status: the claim is cleared once the question is answered, and the agent is idle", brief(rowOf(A.instance)));
  show("oats status", brief(row));
  const afterAnswer = snapshotRow(A.instance);
  check(afterAnswer !== undefined && afterAnswer.waiting === null && pendingQuestions().length === 0, "the plugin's snapshot has no claim left, and bb no pending interaction", JSON.stringify(afterAnswer));
  // And the tree: the row that was drawn as needing you is drawn idle.
  await shots("real-answered", { ...A, threadId, state: "idle" });
  // The answer reached Claude Code: the model was asked again in that conversation, with the tool's result.
  const asks = modelRequests().filter((request) => request.event === "asked-a-question");
  const after = modelRequests().filter((request) => request.event === "answered" && request.n > asks[0]?.n && request.messages > asks[0]?.messages);
  check(asks.length === 1 && after.length >= 1, "the mock asked the question once, and was asked again with its answer", JSON.stringify({ asks, after }));

  step("A6 edge: oats taking seconds");
  wrapper({ delayMs: 4000 });
  let slow = rpc("refresh");
  let snapshot = rpc("snapshot");
  check(slow.ok && snapshot.ok && snapshot.value.ok === true && slow.ms >= 4000, `with every oats 4 s slower, the snapshot is read (${slow.ms} ms)`, JSON.stringify(snapshot));
  let slowPlan = rpc("stopPlan", { instance: A.instance });
  check(slowPlan.ok && slowPlan.ms >= 4000, `and a stop plan is read (${slowPlan.ms} ms)`, JSON.stringify(slowPlan));
  wrapper({ delays: { status: 600_000 } });
  await sleep(5500); // well past the pause between two reads (1 s after a quick or a failed one)
  slow = rpc("refresh");
  snapshot = rpc("snapshot");
  // 20 s is the plugin's limit for a status. The refresh can wait behind one read the 15 s poll
  // started meanwhile (it runs into the same limit), hence the upper bound of two limits and a floor.
  check(snapshot.ok && snapshot.value.ok === false && snapshot.value.code === "OATS_TIMEOUT" && slow.ms >= 19_000 && slow.ms <= 47_000, `a status that never answers is OATS_TIMEOUT after ${Math.round(slow.ms / 1000)} s`, JSON.stringify(snapshot));
  show("snapshot", snapshot.value);
  wrapper({});
  await sleep(5500);
  rpc("refresh");
  snapshot = rpc("snapshot");
  check(snapshot.ok && snapshot.value.ok === true, "the snapshot is back once oats answers in time", JSON.stringify(snapshot));
  await until("no slow oats left behind", () => !/oats-record/.test(execFileSync("ps", ["-eo", "args"], { encoding: "utf8" })), 30);

  step("A7 stop: the plan, then the apply");
  const stale = act("a stop plan, read and kept aside", "stopPlan", { instance: A.instance });
  const plan = act("stop plan", "stopPlan", { instance: A.instance });
  check(plan?.instance === A.instance && plan.targets?.[0]?.instance === A.instance && plan.targets[0].soul === A.soul, "the plan names the agent", JSON.stringify(plan));
  // What the kernel's plan says of an agent whose thread is idle in bb (README, "What the run found").
  const idlePlan = recorded(["instance", "stop", A.instance], ["--plan"]);
  evidence.keep("stop-plan-idle.json", idlePlan.stdout);
  show("the kernel's plan, for an idle agent", JSON.parse(idlePlan.stdout).result);
  const stopAt = Date.now();
  act("stop apply", "stopApply", { instance: A.instance, revision: plan.revision, key: "stop-a1b2c3d4e5f6" });
  // The stop is the plugin's own act: it rereads by itself afterwards, so this one measures how soon an act's result is on hand, not the watch (that the act rereads is test/lifecycle/server.test.ts's).
  await fresh("the agent stopped (the plugin's own act)", { instance: A.instance, home, kind: "stopped", since: stopAt }, (agent) => agent.runtimeState === "stopped");
  row = await untilRow(A.instance, "stopped by OATS", (r) => r.running === false && r.runtimeState === "stopped");
  check(row?.session?.threadId === threadId, "oats status: running false / stopped, the same thread", brief(row));
  show("oats status", brief(row));
  thread = bbThread(threadId);
  // The run's first stop: what it left of the thread says which provider this is (stopLeft, above).
  const afterStop = stopLeft(thread);
  archivesAtStop = afterStop === "archived";
  check(afterStop === "kept" || afterStop === "archived", `bb: the stopped home's thread is ${afterStop}: one of the two a stop leaves (kept and no longer active, or archived)`, JSON.stringify(thread));
  note(archivesAtStop ? "THIS PROVIDER ARCHIVES A HOME'S THREAD AT ITS STOP (read from this stop): the run expects every stop to archive, and the screen to show a stopped agent on its archived thread" : "this provider keeps a stopped home's thread open in bb (read from this stop): the run expects every stop to leave the thread there and not active");
  show("bb thread", { id: thread?.id, status: thread?.status, archivedAt: thread?.archivedAt });
  agrees(A.instance, row);
  keepStatus("stoppedByOats", { [A.instance]: (r) => r.running === false && r.runtimeState === "stopped" && r.sessionEnd === "stopped" && r.session?.threadId === threadId });
  if (archivesAtStop) await archivedShots("real-stopped", { ...A, threadId });
  else await shots("real-stopped", { ...A, threadId, state: "stopped" });

  step("A8 edge: a stale stop plan (apply after another stop)");
  refused("the apply of the plan read before the stop", "E_PLAN_STALE", "stopApply", { instance: A.instance, revision: stale.revision, key: "stop-0f0e0d0c0b0a" }, ["instance", "stop"], ["--apply", "stop-0f0e0d0c0b0a"]);

  step("A9 edge: stop on a stopped agent");
  const again = act("stop plan of a stopped agent", "stopPlan", { instance: A.instance });
  check(again?.targets?.[0]?.session === "none", "the plan says it is not running", JSON.stringify(again));
  act("stop apply on a stopped agent", "stopApply", { instance: A.instance, revision: again.revision, key: "stop-112233445566" });
  show("the kernel's receipt", JSON.parse(recorded(["instance", "stop"], ["--apply", "stop-112233445566"]).stdout).result.results);
  row = rowOf(A.instance);
  check(row?.running === false && row.runtimeState === "stopped", "oats status: still stopped", brief(row));

  step("A10 start");
  const started = act("start", "start", { instance: A.instance });
  check(/^thr_/.test(started?.threadId ?? "") && started.threadId !== threadId, "start answers a new thread");
  row = await untilRest(A.instance, "its new thread, idle", (r) => r.session?.threadId === started.threadId && idleRunning(r) && settled(r));
  show("oats status", brief(row));
  check(archivedInBb(threadId) && live(started.threadId), "bb: the previous thread is archived, and the new one is there and live", threadsNow());
  agrees(A.instance, row);
  threadId = started.threadId;

  step("A11 restart");
  const restarted = act("restart", "restart", { instance: A.instance });
  check(/^thr_/.test(restarted?.threadId ?? "") && restarted.threadId !== threadId, "restart answers a new thread");
  row = await untilRest(A.instance, "its new thread, idle", (r) => r.session?.threadId === restarted.threadId && idleRunning(r) && settled(r));
  show("oats status", brief(row));
  check(archivedInBb(threadId) && live(restarted.threadId), "bb: the previous thread is archived, and the new one is there and live", threadsNow());
  agrees(A.instance, row);
  threadId = restarted.threadId;

  step("A12 edge: the agent's thread archived in bb, then Start");
  const archived = threadId;
  say(`     ${bb("thread", "archive", archived).trim()}`);
  row = await untilRow(A.instance, "stopped (its thread is archived)", (r) => r.running === false && r.runtimeState === "stopped");
  show("oats status", brief(row));
  agrees(A.instance, row);
  const resumed = act("start, after the archive", "start", { instance: A.instance });
  check(/^thr_/.test(resumed?.threadId ?? "") && resumed.threadId !== archived, "start answers a new thread");
  row = await untilRest(A.instance, "its new thread", (r) => r.session?.threadId === resumed?.threadId && idleRunning(r) && settled(r));
  show("oats status", brief(row));
  check(archivedInBb(archived) && live(resumed.threadId), "bb: the thread archived by hand is still archived, and the new one is there and live", threadsNow());
  agrees(A.instance, row);
  threadId = resumed.threadId;

  step("A13 the agent's thread deleted in bb");
  say(`     ${bb("thread", "delete", threadId, "--yes").trim()}`);
  row = await untilRow(A.instance, "stopped (its thread is deleted)", (r) => r.running === false && r.runtimeState === "stopped");
  check(bbThread(threadId) === undefined, "bb: the thread is gone");
  show("oats status", brief(row));
  agrees(A.instance, row);
  keepStatus("threadDeleted", { [A.instance]: (r) => r.running === false && r.runtimeState === "stopped" && r.session?.threadId === threadId });
  await missingShots("real-missing", A);

  step("A14 retire: the plan, then the apply");
  const retirePlan = act("retire plan", "retirePlan", { instance: A.instance });
  check(retirePlan?.instance === A.instance && retirePlan.home === home, "the plan is for the agent, and names the home that is removed", JSON.stringify(retirePlan));
  // The thread archived by hand in A12 is the home's too: the provider's stop ends its Claude, so nothing works in the home.
  act("retire apply", "retireApply", { instance: A.instance, revision: retirePlan.revision, key: "retire-0a1b2c3d4e5f" });
  check(rowOf(A.instance) === undefined && !existsSync(home), "oats status: no row is left, and the home is removed");
  const left = bbThreads().filter((t) => t.projectId === thread.projectId);
  check(left.length > 0 && left.every((t) => t.archivedAt != null), "bb: every thread the home still has is archived", threadsNow());
  check(snapshotRow(A.instance) === undefined, "the plugin's snapshot no longer has the agent");

  step("A15 edge: every act on the agent that is gone: what the kernel answers (kept, for the plugin's \"not in OATS any more\")");
  // The roster on a screen can be older than this: an act asked from it reaches the kernel, which
  // refuses it for an agent it no longer has. The six refusals are recorded as the kernel prints
  // them, with the argv the plugin's host entry uses. The plugin says "not in OATS any more" for a
  // stop plan or a retire plan refused with E_SESSION_UNKNOWN, by that code alone, and shows every
  // other refusal as the kernel's: its tests read these recordings for both. Each command is refused before it
  // changes anything: the home is not there, the name is no instance's.
  const goneActs = {
    start: ["session", "start", "--home", home, "--json"],
    restart: ["session", "restart", "--home", home, "--json"],
    stopPlan: ["instance", "stop", A.instance, "--plan", "--json"],
    stopApply: ["instance", "stop", A.instance, "--apply", "--plan-revision", "0123456789abcdef01234567", "--idempotency-key", "stop-000000000000", "--json"],
    retirePlan: ["retire", A.instance, "--plan", "--json"],
    retireApply: ["retire", A.instance, "--plan-revision", "0123456789abcdef01234567", "--idempotency-key", "retire-000000000000", "--json"],
  };
  for (const [verb, argv] of Object.entries(goneActs)) {
    const run = oats(...argv);
    let error;
    try {
      error = JSON.parse(run.stdout).error;
    } catch {
      error = undefined; // no JSON printed: the check below says what was
    }
    const refused = run.exit !== 0 && typeof error?.code === "string" && typeof error?.message === "string";
    check(refused, `oats ${argv.slice(0, 2).join(" ")} on the retired agent (${verb}) is refused, with a code and a message`, `exit ${run.exit}: ${run.stdout || run.stderr}`);
    if (refused) {
      show(verb, `${error.code}: ${error.message}`);
      fixtures.keepIn("lifecycle/gone.json", verb, run.stdout);
      // What the plugin's rule rests on: a plan for a name the kernel does not know is refused with this code.
      if (verb === "stopPlan" || verb === "retirePlan") check(error.code === "E_SESSION_UNKNOWN", `the ${verb === "stopPlan" ? "stop" : "retire"} plan of an agent that is gone is refused with E_SESSION_UNKNOWN`, error.code);
    }
  }
  check(!existsSync(home) && rowOf(A.instance) === undefined, "and nothing was made by asking: no home, no row");

  // ======================================================================= part B
  /** A child, spawned as its parent would: on the command line, since the plugin's spawn names no parent. With no parent, an agent of its own. */
  function child(soul, name, parent, text) {
    const file = join(OUT, `task-${name}.md`);
    writeFileSync(file, text);
    // No launch configuration on this host chooses a mode: as the plugin does, the command line asks for full mode.
    const run = oats("spawn", soul, "--backend", "bb", "--yolo", "--name", name, ...(parent ? ["--parent", parent] : []), "--task-file", file, "--json");
    const answer = run.exit === 0 ? JSON.parse(run.stdout).result : undefined;
    check(answer?.session?.endpoint?.threadId !== undefined, `oats spawn ${soul} --name ${name}${parent ? ` --parent ${parent}` : ""}`, run.stdout || run.stderr);
    return answer;
  }

  step("B1 a lead with two children: the stop the fixtures describe");
  const lead = "redesign-ui-lead";
  hold(lead);
  hold("desktop-mockups-developer");
  const leadSpawn = act("spawn the lead", "spawn", { soul: "oats-product-expert", name: lead, task: taskOf(lead, "Redesign the UI."), key: "spawn-3c2e9d7a" });
  await untilRow(lead, "working", (r) => r.running === true);
  // bb runs as many threads at once as the container has processors (2): the second child is
  // spawned once the first one's turn is over, so that both get their turn.
  const harvest = child("knowledge-harvester", "harvest-knowledge-helper", lead, "Harvest what the redesign learned.\n");
  await untilRest("harvest-knowledge-helper", "idle", (r) => idleRunning(r) && r.runtimeState === "unknown" && settled(r));
  const mockups = child("oats-desktop-developer", "desktop-mockups-developer", lead, taskOf("desktop-mockups-developer", "Draw the Desktop mockups."));
  await untilRow("desktop-mockups-developer", "working", (r) => r.running === true);
  for (const name of [lead, "desktop-mockups-developer", "harvest-knowledge-helper"]) show(name, brief(rowOf(name)));
  check(rowOf("desktop-mockups-developer")?.parentInstance === lead && rowOf("harvest-knowledge-helper")?.parentInstance === lead, "oats status: both children name the lead as their parent");
  keepStatus("parentWithTwoChildren", {
    [lead]: (r) => r.running === true && r.parentInstance == null,
    "desktop-mockups-developer": (r) => r.running === true && r.parentInstance === lead,
    "harvest-knowledge-helper": (r) => idleRunning(r) && r.runtimeState === "unknown" && r.parentInstance === lead,
  });

  step("B1b an agent whose turn bb holds in line, stopped: the turn never runs");
  // Two turns are open, which is bb's limit here: bb holds the first turn of one more agent (not
  // the lead's) in line. Its task names a hold that is never set, so the mock's log shows whether
  // that turn ever asked the model.
  const queued = "queued-turn-helper";
  const queuedSpawn = child("knowledge-harvester", queued, null, taskOf(queued, "Wait in bb's line."));
  const queuedThread = queuedSpawn?.session?.endpoint?.threadId;
  row = await untilRow(queued, "its turn held in bb's line", (r) => r.session?.threadId === queuedThread && bbThread(queuedThread)?.status === "pending");
  say(`     ${bbPlugin("concurrency-limit", "status").trim().replace(/\n/g, "\n     ")}`);
  show("oats status", brief(row));
  check(inLine(queuedThread).length === 1 && bbThread(queuedThread)?.queuedWork === "waiting", "bb holds the agent's first turn in line", JSON.stringify({ inLine: inLine(queuedThread), thread: bbThread(queuedThread) }));
  show("bb thread", { id: queuedThread, status: bbThread(queuedThread)?.status, queuedWork: bbThread(queuedThread)?.queuedWork, inLine: inLine(queuedThread).length });
  agrees(queued, row);
  const queuedPlan = act("stop plan", "stopPlan", { instance: queued });
  act("stop apply", "stopApply", { instance: queued, revision: queuedPlan.revision, key: "stop-9d8c7b6a5f4e" });
  row = await untilRow(queued, "stopped", (r) => r.running === false && r.runtimeState === "stopped");
  show("oats status", brief(row));
  // Not a matter of how long bb takes to start a held turn: the stop left nothing in bb's line for the thread.
  check(inLine(queuedThread).length === 0 && bbThread(queuedThread)?.queuedWork === "none", "bb holds nothing in line for the stopped agent's thread", JSON.stringify({ inLine: inLine(queuedThread), thread: bbThread(queuedThread) }));

  step("B1c the lead's stop, and a stale plan");
  const leadPlan = act("stop plan of the lead", "stopPlan", { instance: lead });
  evidence.keep("stop-plan.json", recorded(["instance", "stop", lead], ["--plan"]).stdout);
  check(leadPlan?.targets?.length === 3 && leadPlan.targets[0].instance === lead && leadPlan.targets.slice(1).every((target) => target.depth === 1), "the plan lists the lead, then its children", JSON.stringify(leadPlan));
  // Another stop in between: one child is stopped by itself, so the lead's plan is no longer the one read.
  const one = act("stop plan of one child", "stopPlan", { instance: "harvest-knowledge-helper" });
  act("stop apply of that child", "stopApply", { instance: "harvest-knowledge-helper", revision: one.revision, key: "stop-5e6f7a8b9c0d" });
  await untilRow("harvest-knowledge-helper", "stopped", (r) => r.runtimeState === "stopped");
  const staleLead = refused("the apply of the lead's plan read before that stop", "E_PLAN_STALE", "stopApply", { instance: lead, revision: leadPlan.revision, key: "stop-0000aaaa1111" }, ["instance", "stop", lead], ["--apply", "stop-0000aaaa1111"]);
  if (staleLead) fixtures.keep("lifecycle/stop-apply-stale.json", staleLead.record.stdout);
  const freshLead = act("stop plan of the lead, read again", "stopPlan", { instance: lead });
  act("stop apply of the lead", "stopApply", { instance: lead, revision: freshLead.revision, key: "stop-7f3a9c2e41b8" });
  fixtures.keep("lifecycle/stop-apply.json", recorded(["instance", "stop", lead], ["--apply", "stop-7f3a9c2e41b8"]).stdout);
  for (const name of [lead, "desktop-mockups-developer", "harvest-knowledge-helper"]) {
    const stopped = await untilRow(name, "stopped", (r) => r.running === false && r.runtimeState === "stopped");
    show(name, brief(stopped));
    const its = bbThread(stopped?.session?.threadId);
    check(stoppedThread(its), `bb: the thread of ${name} is ${stoppedAs()}`, JSON.stringify(its));
  }
  release(lead);
  release("desktop-mockups-developer");
  // bb has room again: the turn it held in line for the agent stopped in B1b must not run.
  await sleep(10_000);
  const turns = modelRequests().filter((request) => request.holds?.includes(queued));
  const held = bbThread(queuedThread);
  check(turns.length === 0 && !["active", "starting"].includes(held?.status), "the agent stopped while bb held its turn in line never ran that turn: no model request, and its thread is not active", JSON.stringify({ turns, thread: held }));
  show("bb thread", { id: queuedThread, status: held?.status, archivedAt: held?.archivedAt });
  const retireQueued = act("retire plan", "retirePlan", { instance: queued });
  act("retire apply", "retireApply", { instance: queued, revision: retireQueued.revision, key: "retire-3c4d5e6f7a8b" });
  check(rowOf(queued) === undefined, "oats status: no row is left");

  step("B2 an agent on a worktree, with a child: start, restart, retire");
  const digest = "weekly-digest-helper";
  const digestSpawn = act("spawn the agent", "spawn", { soul: "oats-expert", name: digest, task: "Write the weekly digest.\n", key: "spawn-4d5e6f7a" });
  const links = child("oats-expert", "digest-links-helper", digest, "Check the digest's links.\n");
  await untilRest("digest-links-helper", "idle", (r) => idleRunning(r) && r.runtimeState === "unknown" && settled(r));
  await untilRest(digest, "idle", (r) => idleRunning(r) && r.runtimeState === "unknown" && settled(r));
  const digestHome = rowOf(digest).home;
  writeFileSync(join(digestHome, "work", "digest-draft.md"), "a draft the agent has not committed\n");
  const digestStop = act("stop plan", "stopPlan", { instance: digest });
  act("stop apply", "stopApply", { instance: digest, revision: digestStop.revision, key: "stop-6a7b8c9d0e1f" });
  await untilRow(digest, "stopped", (r) => r.runtimeState === "stopped");
  const digestStart = act("start", "start", { instance: digest });
  fixtures.keep("lifecycle/start.json", recorded(["session", "start", "--home", digestHome]).stdout);
  row = await untilRest(digest, "its new thread", (r) => r.session?.threadId === digestStart.threadId && idleRunning(r) && settled(r));
  show("oats status", brief(row));
  check(archivedInBb(digestSpawn.threadId) && live(digestStart.threadId), "bb: the previous thread is archived, and the new one is there and live", threadsNow());
  const digestRestart = act("restart", "restart", { instance: digest });
  fixtures.keep("lifecycle/restart.json", recorded(["session", "restart", "--home", digestHome]).stdout);
  row = await untilRest(digest, "its new thread", (r) => r.session?.threadId === digestRestart.threadId && idleRunning(r) && settled(r));
  show("oats status", brief(row));
  check(archivedInBb(digestStart.threadId) && live(digestRestart.threadId), "bb: the previous thread is archived, and the new one is there and live", threadsNow());
  const digestStop2 = act("stop plan, before the retire", "stopPlan", { instance: digest });
  act("stop apply", "stopApply", { instance: digest, revision: digestStop2.revision, key: "stop-8c9d0e1f2a3b" });
  await untilRow(digest, "stopped", (r) => r.runtimeState === "stopped");
  const digestRetire = act("retire plan", "retirePlan", { instance: digest });
  fixtures.keep("lifecycle/retire-plan.json", recorded(["retire", digest], ["--plan"]).stdout);
  act("retire apply", "retireApply", { instance: digest, revision: digestRetire.revision, key: "retire-2b9d4e6f8a1c" });
  fixtures.keep("lifecycle/retire-apply.json", recorded(["retire", digest], ["retire-2b9d4e6f8a1c"]).stdout);
  check(rowOf(digest) === undefined && !existsSync(digestHome), "oats status: no row is left, and the home is removed");
  check(archivedInBb(digestRestart.threadId), "bb: the retire archived the agent's current thread", threadsNow());
  const receipt = JSON.parse(recorded(["retire", digest], ["retire-2b9d4e6f8a1c"]).stdout);
  check(receipt.retention?.worktree === "retained" && existsSync(join(receipt.retention.movedTo, "digest-draft.md")), "the work tree is kept, moved out of the home, with the untracked file", JSON.stringify(receipt.retention));
  const kept = rowOf("digest-links-helper");
  check(kept !== undefined && existsSync(kept.home) && kept.running === false && kept.runtimeState === "stopped" && bbThread(kept.session?.threadId) !== undefined, "the child is kept: its row, its home and its bb thread, stopped", brief(kept));
  show("digest-links-helper", brief(kept));

  step("B3 the machines page: two registered servers (no host behind them)");
  for (const [id, ssh, workspace, label] of [["devbox-oats", "devbox.invalid", "/srv/oats", "devbox"], ["build", "build.invalid", "/home/ci/oats", null]]) {
    const run = oats("server", "add", id, "--ssh", ssh, "--workspace", workspace, ...(label ? ["--label", label] : []), "--json");
    check(run.exit === 0, `oats server add ${id}`, run.stdout || run.stderr);
  }
  rpc("refresh"); // the pages' answers are kept 30 s; a refresh drops them
  const machines = act("the machines", "machines");
  check(machines?.machines.length === 3 && machines.machines[0].isThisMachine === true, "this machine, then the two servers", JSON.stringify(machines));
  fixtures.keep("workspace/servers.json", recorded(["server", "list"]).stdout);

  // Start and Restart name no mode: they keep what the home recorded at its spawn.
  const sessions = records().filter((record) => record.argv[0] === "session");
  check(sessions.length > 0 && sessions.every((record) => !record.argv.includes("--yolo")), `none of the plugin's ${sessions.length} start and restart calls names a mode (no --yolo)`, JSON.stringify(sessions.map((record) => record.argv)));

  // Part C: the steps a feature adds for its own acts (container/real/parts/<feature>.mjs, in the
  // files' order). A part's default export is `async (run) => {…}`: `run` holds this script's own
  // helpers, so its acts go through the plugin's RPC and are recorded like the ones above.
  const PARTS = join(HERE, "parts");
  /**
   * For a part that takes images of its own screens on the run's real agents: `draw` is called once
   * per view (bb's light and dark themes, at each width), with a page of that view whose theme is
   * checked, and `shot(name)`, which saves `<scene>-<width>x<height>-<name>[-dark].png` beside the
   * run's other images. The part navigates, WAITS on what it reads (`page.until`), checks it with
   * `check`, then shoots: the image-set rule is one state per scene in both themes.
   */
  const views = async (scene, draw) => {
    for (const view of VIEWS) {
      const { viewport, theme, suffix } = view;
      const at = `${scene} ${theme} ${viewport.name}`;
      const page = await viewPage(browser, view, at);
      try {
        await draw({ page, at, viewport, theme, shot: (name) => page.shot(`${scene}-${viewport.name}-${name}${suffix}`) });
      } finally {
        await page.close();
      }
    }
  };
  const run = { step, check, pass, fail, note, show, until, sleep, bb, bbJson, oats, status, rowOf, bbThread, nameOf, idleRunning, atRest, stopArchives, stoppedThread, stoppedAs, rpc, act, records, recorded, refused, fixtures, evidence, browser, views, VIEWPORTS, DEPLOY, OUT };
  for (const file of existsSync(PARTS) ? readdirSync(PARTS).filter((name) => name.endsWith(".mjs")).sort() : []) {
    step(`C ${file.slice(0, -4)}`);
    await (await import(pathToFileURL(join(PARTS, file)).href)).default(run);
  }

  check(browser.errors.length === 0, "no uncaught exception in the page", browser.errors.slice(0, 3).join(" | "));
} finally {
  await browser.close();
  wrapper({});
}

// The mock's own log of the model requests, beside the other artefacts.
if (existsSync(join(REAL, "mock", "requests.jsonl"))) writeFileSync(join(OUT, "mock-requests.jsonl"), readFileSync(join(REAL, "mock", "requests.jsonl")));

// The run's last line says which kind of provider it read (stopLeft): a log's verdict is read with it.
const onProvider = archivesAtStop === null ? "" : archivesAtStop ? ", on a provider that ARCHIVES a home's thread at its stop" : ", on a provider that keeps a stopped home's thread open";

step("the images");
// Two scenes of different states never produce the same image. The state each scene is in:
const STATE_OF = { "real-working": "working", "real-idle": "idle", "real-answered": "idle", "real-needs-you": "needs-you", "real-question": "needs-you", "real-stopped": "stopped", "real-missing": "missing" };
const sceneOf = (name) => Object.keys(STATE_OF).find((scene) => name.startsWith(`${scene}-`));
// The thread's own row says its agent's state at every width (D-113), so this holds for the thread
// images too: the gap that was reported here until then (S1) is closed.
let same = 0;
for (const names of sameImages(OUT)) {
  const states = new Set(names.map((name) => STATE_OF[sceneOf(name)] ?? name));
  if (states.size === 1) continue; // the same state, read twice (idle, and idle again after an answer)
  same += 1;
  fail(`two scenes of different states produced the same image: ${names.join(" = ")}`);
}
if (same === 0) pass("no two scenes of different states produced the same image");

step("the recorded answers");
// The kernel's version, as it prints it in the deployment: the one answer here that no RPC of the plugin asks for yet.
const version = oats("version", "--json");
check(version.exit === 0, "oats version --json", version.stderr);
if (version.exit === 0) fixtures.keep("roster/version.json", version.stdout);
// status.json stays the design's sample; its bb rows take the session-side fields the kernel printed.
const SAMPLES = join(HERE, "..", "..", "test", "fixtures");
fixtures.keep("roster/status.json", sampleStatus(readFileSync(join(SAMPLES, "roster", "status.json"), "utf8"), readFileSync(join(SAMPLES, "roster", "threads.json"), "utf8"), fixtures.kept("roster/status-recorded.json")));
for (const line of fixtures.write()) say(`     fixtures/${line}`);
for (const line of evidence.write()) say(`     answers/${line}`);

// The run's freshness, in one line a person finds, in every run that reaches its end, green or
// red (a run that throws prints neither this nor its verdict line): the delays are measured
// and fail nothing here (fresh(), above, asserts the order of reads), so a drift has to be SEEN. The
// 3 s bar of the UX standard is asserted on a real host by the release's QA, not by this run.
const delay = ({ by, untold, fromRecordMs, confirmedByStatusMs, fromCommandMs }) =>
  fromRecordMs !== null
    ? `${fromRecordMs} ms${by === "events" ? ` by its events (the status read confirmed it at ${confirmedByStatusMs === null ? "no time in 30 s" : `${confirmedByStatusMs} ms`})` : by === "untold" ? ` (which road is not told: ${untold})` : " by a status read"}`
    : fromCommandMs !== null
      ? `${fromCommandMs} ms from before the command (no event of the kernel's to count from)`
      : "never seen";
// The event path against the REAL kernel (its argument form, the watch's file name, the kernel's
// own answer): at least one of the changes above was on the screen from its events: a snapshot
// of a status read that had ENDED before the command began held it, after the plugin read that
// instance's events (nothing but the event path does that). Which ones is printed; a
// change that a status read showed first, or whose road is not told, is no failure by itself.
check(freshness.some((one) => one.by === "events"), `the event path showed ${freshness.filter((one) => one.by === "events").length} of the ${freshness.length} changes measured before a status read did`, JSON.stringify(freshness));
writeFileSync(join(OUT, "freshness.json"), `${JSON.stringify(freshness, null, 1)}\n`);
say(`\n== freshness, measured from the kernel's record to the plugin's snapshot (printed, not asserted: the run asserts the order of reads): ${freshness.length === 0 ? "nothing measured" : freshness.map((one) => `${one.what} ${delay(one)}`).join(", ")}`);

if (failures > 0) {
  say(`\n== real run: ${failures} check(s) failed${onProvider}`);
  process.exit(1);
}
say(`\n== real run: all checks passed${onProvider}`);
