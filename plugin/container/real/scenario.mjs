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
const untilRow = (instance, what, matches, seconds = 60) =>
  until(`${instance} to read ${what} in oats status`, () => {
    const row = rowOf(instance);
    return row !== undefined && matches(row) ? row : undefined;
  }, seconds);

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
 * snapshot older than its 15 s poll: this check holds the delay a client sees, not the watch by
 * itself (live.sh's L2 holds the watch, with the poll off). That the change reaches the tree and the
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
 * says both delays, from the kernel's record and from before the command, and a NOTE reports
 * either one over 3 s even where the check passes.
 *
 * 3 s at most on a kernel whose `oats status` answers in under a second; the status's own time is
 * measured and said beside the delay. A kernel slower than that cannot be shown in 3 s by the pause
 * rule itself (the gap between two reads is the time the last one took): it is given twice its
 * status time and the pause, so a slow kernel is told apart from a slow plugin.
 */
async function fresh(what, { instance, home, kind, since }, matches) {
  let seenAt = null;
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    const snapshot = rpc("snapshot");
    const agent = snapshot.ok && snapshot.value.ok ? snapshot.value.agents.find((candidate) => candidate.instance === instance) : undefined;
    if (agent !== undefined && matches(agent)) {
      seenAt = Date.now();
      break;
    }
    await sleep(100);
  }
  const { at: recorded, why } = recordedAt(instance, home, kind, since);
  // Both delays are said: from the kernel's record (the one the 3 s is on), and from before the
  // command (what the check counted until now: it holds the command's own run too).
  const fromRecord = seenAt === null || recorded === null ? null : seenAt - recorded;
  const fromCommand = seenAt === null ? null : seenAt - since;
  const seen = fromRecord ?? fromCommand; // with no event of the kernel's to count from: from before the command
  const before = Date.now();
  oats("status", "--json");
  const statusMs = Date.now() - before;
  const limit = statusMs <= 1000 ? 3000 : 2 * statusMs + 2000;
  const ms = (delay) => (delay === null ? "never" : `${delay} ms`);
  const counted =
    recorded === null
      ? `${ms(fromCommand)} after the moment before the command, which the limit is on here: ${why}`
      : `${ms(fromRecord)} after the kernel recorded it (its "${kind}" event at ${new Date(recorded).toISOString()}), ${ms(fromCommand)} after the moment before the command`;
  // The snapshot cannot have a change before the kernel recorded it: a delay under 0 means the event
  // taken is not this change's, and the check fails on it, with both times in its line.
  check(seen !== null && seen >= 0 && seen <= limit, `freshness: the plugin's snapshot has ${what} ${counted} (${limit} ms at most, on the first; the kernel's own oats status took ${statusMs} ms)${seen !== null && seen < 0 ? `; the snapshot had it at ${new Date(seenAt).toISOString()}, before that event: not this change's event` : ""}`);
  // A delay over 3 s is said even where the check passes: from before the command (a slow command, or
  // a slow runner), or under the wider limit of a kernel whose status takes over a second.
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
      check(line.state === state && new RegExp(WHOLE[state]).test(line.status) && line.row.includes(`instance of ${soul}`) && line.row.includes("Instance panel"), `${at}: the thread's row says "${WORD[state]}"${state === "stopped" ? ", since when (its last recorded stop)" : state === "working" ? ", when its session started" : ""}, the soul with the Desktop's label, and the way to the instance panel`, JSON.stringify(line));
      show("header row", line.row);
      await page.shot(`${scene}-${viewport.name}-thread${suffix}`);
    } finally {
      await page.close();
    }
  }
}
/**
 * With the release's DEFAULT pages (the home alone: what a person sees first), at both widths: the
 * sidebar holds the real agent's row and who waits, and no link to a page that is not shown.
 */
async function defaultPagesShots(scene, { instance, threadId }) {
  bb("plugin", "config", "oats", "set", "pages", "home");
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
        check(side === JSON.stringify({ pages: false, links: 0 }), `${at}: with the default pages the sidebar has ${instance}'s row and who waits, and no link to a page that is not shown`, side ?? (await page.evaluate(textOf(testId("oats-sidebar")))));
        await page.shot(`${scene}-${viewport.name}-sidebar${suffix}`);
      } finally {
        await page.close();
      }
    }
  } finally {
    bb("plugin", "config", "oats", "set", "pages", "home, automations, souls, capabilities, teams, machines");
  }
}
/** At both widths: the agent stays in the roster, as a row that says its bb thread is gone, and its soul's page says "thread missing", with Start and Retire. */
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
      // and that its bb thread is gone. The read waits on that row.
      const row = `${testId("oats-agent-row-threadless")}[data-instance=${JSON.stringify(instance)}]`;
      const facts = await page.until(`(document.querySelector(${JSON.stringify(`${row} ${testId("oats-row-facts")}`)})?.innerText ?? "").replace(/\\s+/g, " ").trim()`, 30);
      check(typeof facts === "string" && facts.endsWith(`· ${soul} · its bb thread is gone`), `${at}: ${instance} stays in the roster: its state in a word, its soul, "its bb thread is gone"`, facts ?? (await page.evaluate(textOf(testId("oats-sidebar")))));
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
  row = await untilRow(A.instance, "idle (running null)", (r) => r.running === null && r.runtimeState === "unknown" && settled(r));
  show("oats status", brief(row));
  thread = bbThread(threadId);
  check(thread?.status === "idle", "bb: the thread is idle", JSON.stringify(thread));
  agrees(A.instance, row);
  keepStatus("idle", { [A.instance]: (r) => r.running === null && r.runtimeState === "unknown" && r.waitingOnYou == null && r.session?.threadId === threadId });
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
  keepStatus("needsYou", { [A.instance]: (r) => r.running === null && r.waitingOnYou?.message === "Keep the retry, or fail the job?" });
  await shots("real-needs-you", { ...A, threadId, state: "needs-you" });
  const clearedAt = Date.now();
  check(asInstance("instance", "attention", "--clear").status === 0, "the claim is cleared");
  await fresh("the claim cleared", { instance: A.instance, home, kind: "waiting", since: clearedAt }, (agent) => agent.waiting === null);
  await untilRow(A.instance, "no claim", (r) => r.waitingOnYou == null);

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
      const answered = await until("bb to have no pending interaction for the thread", () => pendingQuestions().length === 0, 60);
      check(Boolean(answered), `${at}: "Retry" on the card answers the question (the plugin's threads.interactions.resolve)`, JSON.stringify(bbJson("thread", "interactions", "list", threadId)));
    } finally {
      await page.close();
    }
  }
  row = await untilRow(A.instance, "no claim, its turn over", (r) => r.waitingOnYou == null && r.running === null && settled(r));
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
  // The stop is the plugin's own act: it rereads by itself afterwards, so this one holds that an act's result is on hand at once, not the watch.
  await fresh("the agent stopped (the plugin's own act)", { instance: A.instance, home, kind: "stopped", since: stopAt }, (agent) => agent.runtimeState === "stopped");
  row = await untilRow(A.instance, "stopped by OATS", (r) => r.running === false && r.runtimeState === "stopped");
  check(row?.session?.threadId === threadId, "oats status: running false / stopped, the same thread", brief(row));
  show("oats status", brief(row));
  thread = bbThread(threadId);
  check(thread !== undefined && thread.status !== "active" && thread.archivedAt == null, "bb: the thread is kept, and no longer active", JSON.stringify(thread));
  show("bb thread", { id: thread?.id, status: thread?.status, archivedAt: thread?.archivedAt });
  agrees(A.instance, row);
  keepStatus("stoppedByOats", { [A.instance]: (r) => r.running === false && r.runtimeState === "stopped" && r.sessionEnd === "stopped" && r.session?.threadId === threadId });
  await shots("real-stopped", { ...A, threadId, state: "stopped" });

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
  row = await untilRow(A.instance, "its new thread, idle", (r) => r.session?.threadId === started.threadId && r.running === null && settled(r));
  show("oats status", brief(row));
  check(archivedInBb(threadId) && live(started.threadId), "bb: the previous thread is archived, and the new one is there and live", threadsNow());
  agrees(A.instance, row);
  threadId = started.threadId;

  step("A11 restart");
  const restarted = act("restart", "restart", { instance: A.instance });
  check(/^thr_/.test(restarted?.threadId ?? "") && restarted.threadId !== threadId, "restart answers a new thread");
  row = await untilRow(A.instance, "its new thread, idle", (r) => r.session?.threadId === restarted.threadId && r.running === null && settled(r));
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
  row = await untilRow(A.instance, "its new thread", (r) => r.session?.threadId === resumed?.threadId && r.running === null && settled(r));
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
  await untilRow("harvest-knowledge-helper", "idle", (r) => r.running === null && r.runtimeState === "unknown" && settled(r));
  const mockups = child("oats-desktop-developer", "desktop-mockups-developer", lead, taskOf("desktop-mockups-developer", "Draw the Desktop mockups."));
  await untilRow("desktop-mockups-developer", "working", (r) => r.running === true);
  for (const name of [lead, "desktop-mockups-developer", "harvest-knowledge-helper"]) show(name, brief(rowOf(name)));
  check(rowOf("desktop-mockups-developer")?.parentInstance === lead && rowOf("harvest-knowledge-helper")?.parentInstance === lead, "oats status: both children name the lead as their parent");
  keepStatus("parentWithTwoChildren", {
    [lead]: (r) => r.running === true && r.parentInstance == null,
    "desktop-mockups-developer": (r) => r.running === true && r.parentInstance === lead,
    "harvest-knowledge-helper": (r) => r.running === null && r.runtimeState === "unknown" && r.parentInstance === lead,
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
    check(its !== undefined && its.status !== "active" && its.archivedAt == null, `bb: the thread of ${name} is kept, and no longer active`, JSON.stringify(its));
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
  await untilRow("digest-links-helper", "idle", (r) => r.running === null && r.runtimeState === "unknown" && settled(r));
  await untilRow(digest, "idle", (r) => r.running === null && r.runtimeState === "unknown" && settled(r));
  const digestHome = rowOf(digest).home;
  writeFileSync(join(digestHome, "work", "digest-draft.md"), "a draft the agent has not committed\n");
  const digestStop = act("stop plan", "stopPlan", { instance: digest });
  act("stop apply", "stopApply", { instance: digest, revision: digestStop.revision, key: "stop-6a7b8c9d0e1f" });
  await untilRow(digest, "stopped", (r) => r.runtimeState === "stopped");
  const digestStart = act("start", "start", { instance: digest });
  fixtures.keep("lifecycle/start.json", recorded(["session", "start", "--home", digestHome]).stdout);
  row = await untilRow(digest, "its new thread", (r) => r.session?.threadId === digestStart.threadId && r.running === null && settled(r));
  show("oats status", brief(row));
  check(archivedInBb(digestSpawn.threadId) && live(digestStart.threadId), "bb: the previous thread is archived, and the new one is there and live", threadsNow());
  const digestRestart = act("restart", "restart", { instance: digest });
  fixtures.keep("lifecycle/restart.json", recorded(["session", "restart", "--home", digestHome]).stdout);
  row = await untilRow(digest, "its new thread", (r) => r.session?.threadId === digestRestart.threadId && r.running === null && settled(r));
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
  const run = { step, check, pass, fail, note, show, until, sleep, bb, bbJson, oats, status, rowOf, rpc, act, records, recorded, refused, fixtures, evidence, browser, views, VIEWPORTS, DEPLOY, OUT };
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

if (failures > 0) {
  say(`\n== real run: ${failures} check(s) failed`);
  process.exit(1);
}
say("\n== real run: all checks passed");
