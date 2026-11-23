// inspect and inspectMany: contract item 4's table, one thread per home, and a bb that
// does not answer is an error, never "stopped".
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { inspectAnswer, inspectHome } from "../../oats-package/capabilities/oats-bb/lib/threads.mjs";
import { UNRECOGNISED, processLook, threadProcesses } from "../../oats-package/capabilities/oats-bb/lib/processes.mjs";
import { NOT_FOUND, UNREACHABLE, bbHarness, call, fakeBbIn, scratch, threadRow } from "../fixtures/harness.mjs";

const SERVER = "http://127.0.0.1:38886";
const settings = { version: "0.50.1", trust: "single-user" };
const endpoint = { server: SERVER, projectId: "proj_a", threadId: "thr_a" };
const OPEN = { label: "Open in bb", url: `${SERVER}/projects/proj_a/threads/thr_a` };

async function inspectWith(t, threads, input = {}) {
  const { dir, home } = scratch(t);
  const bb = fakeBbIn(dir, { "thread list": { stdout: typeof threads === "function" ? threads(home) : threads } });
  const answer = await call("inspect", { home, endpoint, ...input }, { settings, bb });
  return { answer, bb, home };
}

// The provider reads a process's environment, name and working directory from Linux's /proc.
const NO_PROC = existsSync("/proc/self/environ") ? false : "no /proc on this host";
// `running` of a thread at rest with no harness of its own in the home: false where the
// processes can be looked at, and null where they cannot (never a guess).
const NO_HARNESS = NO_PROC ? null : false;

for (const [status, expected] of [
  ["starting", { present: true, state: "unknown", running: true }],
  ["active", { present: true, state: "unknown", running: true }],
  ["stopping", { present: true, state: "unknown", running: true }],
  // At rest, and no harness works in the home (these tests start none): it does not run.
  ["pending", { present: true, state: "unknown", running: NO_HARNESS }],
  ["idle", { present: true, state: "unknown", running: NO_HARNESS }],
  // A thread in error with no process of its own on this host is a lost session, as the
  // kernel reads one: eligible for a resume. (With one, below.)
  ["error", { present: false, state: "stopped", running: false }],
]) {
  test(`a bb thread that is ${status} reads ${JSON.stringify(expected)}, with the link to open it`, async (t) => {
    const { answer, bb } = await inspectWith(t, [threadRow("thr_a", "proj_a", status)]);
    assert.deepEqual(answer.result, { ...expected, open: OPEN });
    assert.equal(answer.ok, true);
    assert.deepEqual(Object.keys(answer.result), ["present", "state", "running", "open"]);
    // One read of bb, against the endpoint's server, with no thread context leaking in.
    assert.deepEqual(bb.calls().map((c) => c.argv), [["thread", "list", "--include-hidden", "--json"]]);
    assert.equal(bb.calls()[0].server, SERVER);
  });
}

// These tests start a real process that carries a thread's id and goes by a harness's name, as bb's harness does.
const HARNESS_NAME = { pi: "pi", "claude-code": "claude" };
/** A process that carries BB_THREAD_ID=<id>, until the test ends. `name`: what it runs as (a
 *  link to node under that name, as `pi` and `claude` are found on a PATH); with none it is a
 *  plain node, as a command the agent started and left running is some other program. */
async function threadProcess(t, id, name = null, cwd = undefined) {
  let command = process.execPath;
  if (name !== null) {
    const bin = mkdtempSync(join(tmpdir(), "oats-bb-harness-"));
    t.after(() => rmSync(bin, { recursive: true, force: true }));
    command = join(bin, name);
    symlinkSync(process.execPath, command);
  }
  const child = spawn(command, ["-e", "setTimeout(() => {}, 600000)"], { env: { BB_THREAD_ID: id }, stdio: "ignore", cwd });
  t.after(() => new Promise((done) => { if (child.exitCode !== null || child.signalCode !== null) return done(); child.once("exit", done); child.kill("SIGKILL"); }));
  await new Promise((done, failed) => { child.once("spawn", done); child.once("error", failed); });
  return child;
}
// An id no other test file's process carries: the files run side by side on one host.
const liveId = (name) => `thr_${name}_${process.pid}`;

test("a thread whose last turn failed, with its harness still loaded, is there and at rest: for pi and for Claude alike", { skip: NO_PROC }, async (t) => {
  for (const providerId of ["pi", "claude-code"]) {
    const { dir, home } = scratch(t);
    const id = liveId(`failed_${providerId.replace("-", "_")}`);
    const open = { label: "Open in bb", url: `${SERVER}/projects/proj_a/threads/${id}` };
    const bb = fakeBbIn(dir, { "thread list": { stdout: [threadRow(id, "proj_a", "error", { providerId })] }, "--version": { stdout: "0.50.1\n" } });
    const read = async () => (await call("inspect", { home, endpoint: { ...endpoint, threadId: id } }, { settings, bb })).result;
    // No process of the thread: lost.
    assert.deepEqual(await read(), { present: false, state: "stopped", running: false, open }, providerId);
    // Its harness is still loaded, at work somewhere else than the home: the thread is
    // there (an input recovers it, and the kernel must not resume beside it), and it does
    // not run in this home.
    const away = await threadProcess(t, id, HARNESS_NAME[providerId], dir);
    assert.deepEqual(await read(), { present: true, state: "unknown", running: false, open }, providerId);
    await new Promise((done) => { away.once("exit", done); away.kill("SIGKILL"); });
    // Its harness is still loaded in the home, as bb leaves it after a failed turn: there,
    // and it runs (`running` is read as for any thread at rest: a stopped home a person
    // started again in bb, whose turn then failed, still runs).
    const child = await bbHarness(t, { id, name: HARNESS_NAME[providerId], cwd: home, provider: providerId });
    assert.deepEqual(await read(), { present: true, state: "unknown", running: true, open }, providerId);
    assert.deepEqual(bb.calls().at(-1).argv, ["thread", "list", "--include-hidden", "--json"]);
    assert.equal(bb.calls().length, 3, "bb is asked nothing more than its thread list, once a call");
    // Decided at every call: once the process is gone, so is the session.
    await child.end();
    assert.deepEqual(await read(), { present: false, state: "stopped", running: false, open }, providerId);
    // A harness in the home that bb did not start (one the agent left running): the thread
    // is there, as before (the kernel must not resume beside it), and at the pinned bb it
    // does not run.
    await threadProcess(t, id, HARNESS_NAME[providerId], home);
    assert.deepEqual(await read(), { present: true, state: "unknown", running: false, open }, providerId);
    assert.deepEqual(bb.calls().at(-1).argv, ["--version"], "decided by bb's version, read after the thread list");
  }
});

// `running` of a thread at rest (contract r25, A16): bb says `idle` of a thread whose agent is
// loaded and of one `bb thread stop` released, so it is read from the processes. A false
// "it runs" would make the kernel take a home stopped with the host for one that came back:
// only the home's own harness counts, the process named pi or claude that carries the
// thread's id AND works in the home, AND only one bb itself started for the thread: a child
// of bb's runner for the thread's provider (test/fixtures/bb-provider-bridge-worker.mjs
// stands for it here; the real tree is pinned by test/contract).
test("an idle thread reads running true only with the harness bb started for it at work in the home, and false without: for pi and for Claude alike", { skip: NO_PROC }, async (t) => {
  for (const providerId of ["pi", "claude-code"]) {
    const { dir, home } = scratch(t);
    const id = liveId(`idle_${providerId.replace("-", "_")}`);
    // bb at the version the provider is pinned to (settings.version), unless a step says otherwise.
    const rows = { "thread list": { stdout: [threadRow(id, "proj_a", "idle", { providerId })] } };
    const bb = fakeBbIn(dir, { ...rows, "--version": { stdout: "0.50.1\n" } });
    const running = async () => {
      const { result } = await call("inspect", { home, endpoint: { ...endpoint, threadId: id } }, { settings, bb });
      assert.deepEqual([result.present, result.state], [true, "unknown"]);
      return result.running;
    };
    const versionReads = () => bb.calls().filter((c) => c.argv[0] === "--version").length;
    // Nothing of the thread on this host (a thread `bb thread stop` released reads so): it does not run.
    assert.equal(await running(), false, `${providerId}: no process`);
    // A process that merely carries the thread's id, at work in the home (a command the agent left running): not the harness.
    await threadProcess(t, id, null, home);
    assert.equal(await running(), false, `${providerId}: a process that only carries the id`);
    // The other harness's name, with the id, in the home: not this thread's harness.
    await threadProcess(t, id, HARNESS_NAME[providerId === "pi" ? "claude-code" : "pi"], home);
    assert.equal(await running(), false, `${providerId}: a process named as the other harness`);
    // The harness's own name and the id, at work somewhere else (a directory inside the home too): not this home's harness.
    await threadProcess(t, id, HARNESS_NAME[providerId], dir);
    await threadProcess(t, id, HARNESS_NAME[providerId], join(home, "work"));
    assert.equal(await running(), false, `${providerId}: a harness whose working directory is not the home`);
    // The harness's name, in the home, for another thread: not this thread's.
    await threadProcess(t, `${id}_other`, HARNESS_NAME[providerId], home);
    assert.equal(await running(), false, `${providerId}: another thread's harness in the home`);
    assert.equal(versionReads(), 0, "none of these is a harness of the thread in the home: bb's version decides nothing, and is not read");
    // The harness's own name, the id and the home, started by something that is not bb's
    // runner: what an agent leaves behind when it starts a pi or a claude of its own,
    // detached, in its home. It outlives a stop of the thread, and is not the thread's.
    // At the pinned bb, whose runner's command line the contract tests pin, that is what
    // it is, and it does not run. At another bb, or one whose version cannot be read, bb
    // may have moved its runner: it cannot be told, and the answer is null, never false.
    await threadProcess(t, id, HARNESS_NAME[providerId], home);
    assert.equal(await running(), false, `${providerId}: a harness in the home that bb did not start, at the pinned bb`);
    assert.equal(versionReads(), 1, "bb's version is read once for it");
    bb.setScript({ ...rows, "--version": { stdout: "0.51.0\n" } });
    assert.equal(await running(), null, `${providerId}: the same process, at another bb than the pin`);
    bb.setScript({ ...rows, "--version": { exit: 1, stderr: "bb: broken\n" } });
    assert.equal(await running(), null, `${providerId}: the same process, where bb's version cannot be read`);
    bb.setScript({ ...rows, "--version": { stdout: "0.50.1\n" } });
    // A child of bb's runner for the other provider, or of bb's runner at work elsewhere: not it either.
    await bbHarness(t, { id, name: HARNESS_NAME[providerId], cwd: home, provider: providerId === "pi" ? "claude-code" : "pi" });
    await bbHarness(t, { id, name: HARNESS_NAME[providerId], cwd: dir, provider: providerId });
    assert.equal(await running(), false, `${providerId}: a child of another provider's runner, and one at work elsewhere`);
    // The harness bb started for the thread, in the home: it runs.
    const own = await bbHarness(t, { id, name: HARNESS_NAME[providerId], cwd: home, provider: providerId });
    const before = versionReads();
    assert.equal(await running(), true, `${providerId}: bb's own harness in the home`);
    assert.equal(versionReads(), before, "bb's own harness is there: nothing is left to decide, and the version is not read");
    // Decided at every call: once it is gone, the thread does not run (what the agent left is still there).
    await own.end();
    assert.equal(await running(), false, `${providerId}: its harness gone`);
  }
});

test("a pending thread with nothing in line reads by the same rule, and a turn bb holds in line reads running whatever is loaded", { skip: NO_PROC }, async (t) => {
  const { dir, home } = scratch(t);
  const id = liveId("pending");
  const read = async (extra) => (await call("inspect", { home, endpoint: { ...endpoint, threadId: id } }, { settings, bb: fakeBbIn(dir, { "thread list": { stdout: [threadRow(id, "proj_a", "pending", extra)] } }) })).result.running;
  assert.equal(await read({}), false);
  assert.equal(await read({ queuedWork: "waiting" }), true, "held in line: it will run");
  await bbHarness(t, { id, name: "claude", cwd: home, provider: "claude-code" });
  assert.equal(await read({}), true);
});

test("where the processes cannot be looked at, a thread at rest reads running null: never true, never false", (t) => {
  const { dir, home } = scratch(t);
  for (const proc of [join(dir, "no-such-proc"), dir]) {
    const look = processLook({ proc });
    for (const status of ["idle", "pending"]) assert.deepEqual(inspectAnswer(threadRow("thr_a", "proj_a", status), look, home), { present: true, state: "unknown", running: null }, `${status} ${proc}`);
    // And the look is not made again for the next home of the same call.
    assert.throws(() => look.runsIn({ id: "thr_a" }, home), (error) => error.code === "E_SESSION_UNAVAILABLE");
  }
});

test("inspectMany looks at the host's processes once for all its homes, and each idle thread reads by its own home's harness", { skip: NO_PROC }, async (t) => {
  const { dir, home } = scratch(t);
  const [here, elsewhere, none] = [liveId("many_here"), liveId("many_elsewhere"), liveId("many_none")];
  const homes = { a: join(home, "a"), b: join(home, "b"), c: join(home, "c") };
  for (const path of Object.values(homes)) mkdirSync(path);
  await bbHarness(t, { id: here, name: "pi", cwd: homes.a, provider: "pi" });
  // The second home's thread has a harness, at work in the first home: not in its own.
  await bbHarness(t, { id: elsewhere, name: "pi", cwd: homes.a, provider: "pi" });
  const bb = fakeBbIn(dir, { "thread list": { stdout: [threadRow(here, "proj_a", "idle", { providerId: "pi" }), threadRow(elsewhere, "proj_b", "idle", { providerId: "pi" }), threadRow(none, "proj_c", "idle", { providerId: "pi" })] } });
  const at = (path, projectId, threadId) => ({ home: path, endpoint: { server: SERVER, projectId, threadId } });
  const { results } = (await call("inspectMany", { homes: [at(homes.a, "proj_a", here), at(homes.b, "proj_b", elsewhere), at(homes.c, "proj_c", none)] }, { settings, bb })).result;
  assert.deepEqual(results.map((result) => [result.present, result.running]), [[true, true], [true, false], [true, false]]);
  assert.equal(bb.calls().length, 1, "one thread list for the three homes");
});

test("bb's version is read once for an inspectMany, whatever the number of homes that need it, and not at all when none does", { skip: NO_PROC }, async (t) => {
  const { dir, home } = scratch(t);
  const ids = [liveId("ver_a"), liveId("ver_b"), liveId("ver_c")];
  const homes = ids.map((id, index) => join(home, `h${index}`));
  for (const path of homes) mkdirSync(path);
  const rows = { "thread list": { stdout: ids.map((id, index) => threadRow(id, `proj_${index}`, "idle", { providerId: "pi" })) } };
  const input = { homes: homes.map((path, index) => ({ home: path, endpoint: { server: SERVER, projectId: `proj_${index}`, threadId: ids[index] } })) };
  const bb = fakeBbIn(dir, rows);
  /** One inspectMany against a bb of that version. → [each home's running, the bb commands the call made]. */
  const many = async (version, pin = settings) => {
    bb.setScript({ ...rows, "--version": { stdout: `${version}\n` } });
    const before = bb.calls().length;
    const running = (await call("inspectMany", input, { settings: pin, bb })).result.results.map((result) => result.running);
    return [running, bb.calls().slice(before).map((c) => c.argv[0]).sort()];
  };
  // No harness of any of the threads in its home: nothing to decide, bb's version is not read.
  assert.deepEqual(await many("0.50.1"), [[false, false, false], ["thread"]]);
  // Each home's agent left a pi of its own running there: one read of the version settles all three.
  for (const [index, id] of ids.entries()) await threadProcess(t, id, "pi", homes[index]);
  assert.deepEqual(await many("0.50.1"), [[false, false, false], ["--version", "thread"]], "at the pinned bb: processes the agents left running; one thread list, one version read");
  assert.deepEqual(await many("0.60.0"), [[null, null, null], ["--version", "thread"]], "at another bb: it cannot be told, for any of them, and the call still answers every home");
  // No pin at all (a kernel that merged no manifest default): nothing to compare with, and no read.
  assert.deepEqual(await many("0.50.1", { trust: "single-user" }), [[null, null, null], ["thread"]]);
});

// One scan for all the homes of a call, made only when a thread needs it: every home's
// answer is read from the same look (lib/inspect.mjs makes one per inspect or inspectMany).
test("one look at the processes serves every home it is handed to, and none is made while no thread needs it", (t) => {
  const { dir } = scratch(t);
  const proc = join(dir, "proc");
  const homes = ["a", "b", "c"].map((name) => join(dir, name));
  for (const [index, home] of homes.entries()) {
    mkdirSync(join(proc, String(101 + index)), { recursive: true });
    mkdirSync(home);
    writeFileSync(join(proc, String(101 + index), "environ"), `BB_THREAD_ID=thr_${index}\0`);
    writeFileSync(join(proc, String(101 + index), "comm"), "pi\n");
    writeFileSync(join(proc, String(101 + index), "cmdline"), "pi\0");
    writeFileSync(join(proc, String(101 + index), "stat"), `${101 + index} (pi) S 900 1 1 0\n`);
    // The third thread's pi works in the first home, not in its own.
    symlinkSync(index === 2 ? homes[0] : home, join(proc, String(101 + index), "cwd"));
  }
  // bb's runner for pi threads, their parent.
  mkdirSync(join(proc, "900"));
  writeFileSync(join(proc, "900", "comm"), "node\n");
  writeFileSync(join(proc, "900", "cmdline"), "/usr/local/bin/node\0/opt/bb-app/host-daemon/dist/bb-provider-bridge-worker.mjs\0/data/host.mjs\0provider-pi\0/data/bridge-data\0");
  const opened = [];
  const look = processLook({ proc, read: (path, encoding) => { opened.push(path.slice(proc.length + 1)); return readFileSync(path, encoding); } });
  const subject = (index) => ({ home: homes[index], endpoint: { server: SERVER, projectId: `proj_${index}`, threadId: `thr_${index}` } });
  const rows = (status) => homes.map((home, index) => threadRow(`thr_${index}`, `proj_${index}`, status, { providerId: "pi" }));
  // Threads in a turn ask nothing of the processes.
  assert.deepEqual(homes.map((home, index) => inspectHome(subject(index), rows("active"), look).running), [true, true, true]);
  assert.deepEqual(opened, [], "no look for threads that are in a turn");
  // Three idle threads, one look: each process's files are read once, whatever the number of homes.
  assert.deepEqual(homes.map((home, index) => inspectHome(subject(index), rows("idle"), look).running), [true, true, false]);
  assert.deepEqual(opened.filter((path) => path.endsWith("/comm")).sort(), ["101/comm", "102/comm", "103/comm", "900/comm"]);
  assert.deepEqual(opened.filter((path) => path.endsWith("/environ")).sort(), ["101/environ", "102/environ", "103/environ"], "the runner's environment is never opened");
  assert.deepEqual(opened.filter((path) => path.endsWith("/stat")).sort(), ["101/stat", "102/stat", "103/stat"]);
  const read = opened.length;
  // And again for threads in error: still the same look.
  assert.deepEqual(homes.map((home, index) => { const answer = inspectHome(subject(index), rows("error"), look); return [answer.present, answer.running]; }), [[true, true], [true, true], [true, false]]);
  assert.equal(opened.length, read, "nothing was read a second time");
});

test("a command the agent left running carries the thread's id and is not its harness: alone, it leaves a thread in error lost", { skip: NO_PROC }, async (t) => {
  for (const providerId of ["pi", "claude-code"]) {
    const id = liveId(`stray_${providerId.replace("-", "_")}`);
    const input = { endpoint: { ...endpoint, threadId: id } };
    const read = async () => (await inspectWith(t, [threadRow(id, "proj_a", "error", { providerId })], input)).answer.result.present;
    // A dev server, a watcher, a sleep: some other program, with the variable it inherited.
    await threadProcess(t, id);
    assert.equal(await read(), false, `${providerId}: a stray child alone`);
    // The other harness's name is not this thread's harness either.
    await threadProcess(t, id, HARNESS_NAME[providerId === "pi" ? "claude-code" : "pi"]);
    assert.equal(await read(), false, `${providerId}: a process named as the other harness`);
    // Beside them, the harness itself: present.
    await threadProcess(t, id, HARNESS_NAME[providerId]);
    assert.equal(await read(), true, `${providerId}: its own harness`);
  }
});

test("a harness of another thread, or one whose BB_THREAD_ID only begins with the id, is not this thread's", { skip: NO_PROC }, async (t) => {
  const id = liveId("exact");
  await threadProcess(t, `${id}_other`, "claude");
  const { answer } = await inspectWith(t, [threadRow(id, "proj_a", "error")], { endpoint: { ...endpoint, threadId: id } });
  assert.equal(answer.result.present, false);
});

test("inspectMany looks at the host's processes once, and each home's thread in error reads by its own harness", { skip: NO_PROC }, async (t) => {
  const { dir, home } = scratch(t);
  const [alive, lost] = [liveId("many_alive"), liveId("many_lost")];
  await threadProcess(t, alive, "claude");
  const bb = fakeBbIn(dir, { "thread list": { stdout: [threadRow(alive, "proj_a", "error"), threadRow(lost, "proj_b", "error")] } });
  const at = (projectId, threadId) => ({ home: `${home}/${projectId}`, endpoint: { server: SERVER, projectId, threadId } });
  const { results } = (await call("inspectMany", { homes: [at("proj_a", alive), at("proj_b", lost)] }, { settings, bb })).result;
  assert.deepEqual(results.map((result) => result.present), [true, false]);
});

test("where the processes cannot be looked at, a thread in error is an error: never there, never lost", (t) => {
  const { dir } = scratch(t);
  const row = threadRow("thr_a", "proj_a", "error");
  for (const proc of [join(dir, "no-such-proc"), dir]) {
    assert.throws(() => inspectAnswer(row, processLook({ proc })), (error) => error.code === "E_SESSION_UNAVAILABLE" && /cannot be read on this host/.test(error.message) && /To get a thread in error back, send it a message in bb itself \(bb thread tell <thread id> <text>\).*Until then oats session start and oats session input refuse for this home/.test(error.message), proc);
  }
  // A thread at rest is no error there: whether it runs cannot be told, and it reads so.
  assert.deepEqual(inspectAnswer(threadRow("thr_a", "proj_a", "idle"), processLook({ proc: join(dir, "no-such-proc") }), dir), { present: true, state: "unknown", running: null });
  // And neither does one in error with a turn bb holds in line: bb starts it by itself.
  assert.deepEqual(inspectAnswer(threadRow("thr_a", "proj_a", "error", { queuedWork: "waiting" }), processLook({ proc: join(dir, "no-such-proc") })), { present: true, state: "unknown", running: true });
});

test("the process look reads each process's thread id and names, as bb-app 0.50.1's harnesses show them, and passes over what it cannot read", (t) => {
  const { dir } = scratch(t);
  const proc = join(dir, "proc");
  const entry = (pid, environ, comm = null, cmdline = null, cwd = null, parent = null) => {
    mkdirSync(join(proc, pid), { recursive: true });
    if (cwd !== null) symlinkSync(cwd, join(proc, pid, "cwd"));
    // As Linux writes it: the name in parentheses (it may hold spaces and parentheses), the state, the parent.
    if (parent !== null) writeFileSync(join(proc, pid, "stat"), `${pid} (${comm} (x) y) S ${parent} ${pid} ${pid} 0 -1\n`);
    if (environ !== null) writeFileSync(join(proc, pid, "environ"), environ);
    if (comm !== null) writeFileSync(join(proc, pid, "comm"), `${comm}\n`);
    if (cmdline !== null) writeFileSync(join(proc, pid, "cmdline"), cmdline);
  };
  // pi sets its own title: its name and its whole command line are that one word.
  const home = join(dir, "home"), elsewhere = join(dir, "elsewhere");
  mkdirSync(elsewhere);
  // bb's runners (bb-app 0.50.1: its host daemon runs one per thread, and the thread's harness is its child), and init.
  const runner = (provider) => `/usr/local/bin/node\0--use-system-ca\0/opt/bb-app/host-daemon/dist/bb-provider-bridge-worker.mjs\0/data/plugin-host-artifacts/provider-${provider}/8f09/host.mjs\0provider-${provider}\0/data/plugins/provider-${provider}/bridge-data\0`;
  entry("900", "", "node", runner("pi"));
  entry("901", "", "node", runner("claude-code"));
  entry("1", "", "init", "/sbin/init\0");
  entry("101", "PATH=/bin\0BB_THREAD_ID=thr_pi\0HOME=/x\0", "pi", "pi\0", home, "900");
  // Claude Code: argv[0] is the path of the claude on bb's PATH.
  entry("102", "BB_THREAD_ID=thr_claude\0", "claude", "/home/node/.npm-global/bin/claude\0--output-format\0stream-json\0", elsewhere, "901");
  // A script run by an interpreter: the name is the second word.
  entry("103", "BB_THREAD_ID=thr_script\0", "node", "/usr/local/bin/node\0/opt/pi/bin/pi\0--mode\0rpc\0");
  // What an agent leaves running: the variable, and another name. A later word named pi is not looked at.
  entry("104", "BB_THREAD_ID=thr_pi\0", "sleep", "sleep\x00900\x00", home);
  entry("105", "BB_THREAD_ID=thr_stray\0", "node", "node\0server.js\0pi\0", home);
  entry("111", "BB_THREAD_ID=thr_stray\0", "tail", "tail\0pi\0"); // an argument named pi, of a program that runs no script
  entry("106", "NOT_BB_THREAD_ID=thr_no\0XBB_THREAD_ID=thr_no2\0", "pi", "pi\0");
  entry("107", "", "pi", "pi\0"); // a zombie
  entry("108", null, "pi", "pi\0"); // ended meanwhile
  entry("109", "BB_THREAD_ID=\0", "pi", "pi\0"); // names none
  entry("110", "BB_THREAD_ID=thr_bare"); // its name cannot be read
  entry("self", "BB_THREAD_ID=thr_not_a_pid\0", "pi", "pi\0");
  // In the home, by the harness's name, with a thread's id, and not bb's: one the agent
  // started detached (its parent is whatever adopted it), one under the other provider's
  // runner, one under a program that only mentions the runner's file, one whose parent
  // cannot be read (it ended meanwhile), one whose own stat cannot be read.
  entry("112", "BB_THREAD_ID=thr_detached\0", "pi", "pi\0", home, "1");
  entry("113", "BB_THREAD_ID=thr_wrong_runner\0", "pi", "pi\0", home, "901");
  entry("902", "", "tail", "tail\0-f\0provider-pi\0bb-provider-bridge-worker.mjs.log\0");
  entry("114", "BB_THREAD_ID=thr_mention\0", "pi", "pi\0", home, "902");
  entry("115", "BB_THREAD_ID=thr_orphan\0", "pi", "pi\0", home, "999");
  entry("116", "BB_THREAD_ID=thr_nostat\0", "pi", "pi\0", home);
  // Beside bb's own for the same thread, what the agent left does not hide it; and beside one that cannot be told, bb's own still counts.
  entry("117", "BB_THREAD_ID=thr_pi\0", "pi", "pi\0", home, "1");
  entry("118", "BB_THREAD_ID=thr_orphan_and_own\0", "pi", "pi\0", home, "999");
  entry("119", "BB_THREAD_ID=thr_orphan_and_own\0", "pi", "pi\0", home, "900");
  // A thread of a bb provider this module does not know the harness of, under another provider's runner.
  entry("120", "BB_THREAD_ID=thr_codex\0", "claude", "claude\0", home, "901");
  // Which files the look opens: a process that is no harness by its name has its name and
  // command line read, and its environment never (it may hold another program's secret).
  const opened = [];
  const read = (path, encoding) => { opened.push(path.slice(proc.length + 1)); return readFileSync(path, encoding); };
  const threads = threadProcesses({ proc, read });
  assert.deepEqual([...threads.keys()].sort(), ["thr_claude", "thr_codex", "thr_detached", "thr_mention", "thr_nostat", "thr_orphan", "thr_orphan_and_own", "thr_pi", "thr_script", "thr_wrong_runner"], "only threads with a harness-named process");
  assert.deepEqual(threads.get("thr_pi").map((process) => ({ names: [...process.names], cwd: process.cwd, runner: process.runner })), [{ names: ["pi"], cwd: home, runner: ["pi"] }, { names: ["pi"], cwd: home, runner: [] }], "bb's own and the one the agent left: the stray sleep of the same thread adds nothing");
  assert.deepEqual(threads.get("thr_script").map((process) => process.cwd), [null], "a working directory that cannot be read is null, and the process is still the thread's harness");
  assert.deepEqual(opened.filter((path) => path.endsWith("/environ")).sort(), ["101/environ", "102/environ", "103/environ", "106/environ", "107/environ", "108/environ", "109/environ", "112/environ", "113/environ", "114/environ", "115/environ", "116/environ", "117/environ", "118/environ", "119/environ", "120/environ"],
    "the environment of the sleep (104), the server (105), the tail (111) and the process with no readable name (110) is never opened");
  for (const pid of ["104", "105", "110", "111"]) assert.ok(!opened.includes(`${pid}/environ`), pid);
  assert.ok(opened.includes("104/comm") && opened.includes("104/cmdline"), "its name and command line are what is read");
  const look = processLook({ proc });
  const has = (id, providerId) => look.has({ id, providerId });
  assert.equal(has("thr_pi", "pi"), true);
  assert.equal(has("thr_pi", "claude-code"), false, "pi is not a Claude thread's harness");
  assert.equal(has("thr_claude", "claude-code"), true);
  assert.equal(has("thr_script", "pi"), true);
  assert.equal(has("thr_stray", "pi"), false);
  assert.equal(has("thr_bare", "pi"), false, "a process whose name cannot be read is not taken for the harness");
  assert.equal(has("thr_none", "pi"), false);
  // A provider of bb's whose harness this module does not know: either name.
  assert.equal(has("thr_claude", "codex"), true);
  assert.equal(has("thr_stray", undefined), false);
  // Whether a thread's harness works in a home: the harness itself, by its name, with the
  // thread's id, whose working directory is exactly that home.
  const runsIn = (id, providerId, where) => look.runsIn({ id, providerId }, where);
  assert.equal(runsIn("thr_pi", "pi", home), true, "the thread's pi, a child of bb's runner for pi, at work in the home");
  // Only a harness bb itself started: by its parent, bb's runner for the thread's provider.
  // A harness in the home whose parent is readable and is not bb's runner for the provider:
  // left open by the look (the caller settles it by bb's version, lib/inspect.mjs).
  assert.equal(runsIn("thr_detached", "pi", home), UNRECOGNISED, "a pi the agent started detached in its home, adopted by init");
  assert.equal(runsIn("thr_wrong_runner", "pi", home), UNRECOGNISED, "a child of bb's runner for another provider");
  assert.equal(runsIn("thr_mention", "pi", home), UNRECOGNISED, "a parent that only mentions the runner's file and a provider is not bb's runner");
  assert.equal(runsIn("thr_detached", "pi", elsewhere), false, "and where no harness of the thread is in the home at all: false, with nothing to settle");
  assert.equal(runsIn("thr_orphan", "pi", home), null, "its parent cannot be read: it cannot be told, never a guess");
  assert.equal(runsIn("thr_nostat", "pi", home), null, "nor where its own parent cannot be read");
  assert.equal(runsIn("thr_orphan", "pi", elsewhere), false, "a harness that is not in the home decides nothing for it");
  assert.equal(runsIn("thr_orphan_and_own", "pi", home), true, "bb's own harness counts, whatever else is there");
  assert.equal(runsIn("thr_codex", "codex", home), UNRECOGNISED, "bb's runner for the thread's own provider, and no other's: a provider this module does not know is no exception");
  assert.equal(has("thr_detached", "pi"), true, "whether a harness lives (a thread in error) is asked of the name and the id alone, as before");
  assert.equal(runsIn("thr_pi", "pi", elsewhere), false, "not in another directory");
  assert.equal(runsIn("thr_pi", "pi", dir), false, "nor in the home's parent");
  assert.equal(runsIn("thr_pi", "claude-code", home), false, "pi is not a Claude thread's harness");
  assert.equal(runsIn("thr_claude", "claude-code", home), false, "a harness at work somewhere else does not run in the home");
  assert.equal(runsIn("thr_claude", "claude-code", elsewhere), true);
  assert.equal(runsIn("thr_claude", "pi", elsewhere), false);
  assert.equal(runsIn("thr_script", "pi", home), false, "a harness whose working directory cannot be read is not counted");
  assert.equal(runsIn("thr_stray", "pi", home), false, "what the agent left running in the home, with the id, is not the harness");
  assert.equal(runsIn("thr_none", "pi", home), false);
  // The working directory is read only of a harness that carries a thread's id: never of another program.
  const links = [];
  processLook({ proc, link: (path) => { links.push(path.slice(proc.length + 1)); return elsewhere; } }).runsIn({ id: "thr_pi", providerId: "pi" }, home);
  assert.deepEqual(links.sort(), ["101/cwd", "102/cwd", "103/cwd", "112/cwd", "113/cwd", "114/cwd", "115/cwd", "116/cwd", "117/cwd", "118/cwd", "119/cwd", "120/cwd"]);
  // And its parent only of such a process: no other program's stat is read.
  assert.deepEqual(opened.filter((path) => path.endsWith("/stat")).sort(), ["101/stat", "102/stat", "103/stat", "112/stat", "113/stat", "114/stat", "115/stat", "116/stat", "117/stat", "118/stat", "119/stat", "120/stat"]);
});

// A turn bb's concurrency limit holds in line starts by itself when a slot frees: a thread
// that is settled with work in line is busy, not at rest. (bb's list row says so in
// `queuedWork`: "none" when nothing waits.)
for (const [status, queuedWork, running] of [["pending", "waiting", true], ["idle", "waiting", true], ["idle", "scheduled", true], ["pending", "none", NO_HARNESS], ["idle", undefined, NO_HARNESS], ["idle", null, NO_HARNESS], ["active", "waiting", true], ["error", "waiting", true]]) {
  test(`a bb thread that is ${status} with queuedWork ${JSON.stringify(queuedWork)} reads running ${running}`, async (t) => {
    const { answer } = await inspectWith(t, [threadRow("thr_a", "proj_a", status, { queuedWork })]);
    assert.deepEqual(answer.result, { present: true, state: "unknown", running, open: OPEN });
  });
}

test("a thread whose queuedWork is no word cannot be read: E_SESSION_UNAVAILABLE, never at rest", async (t) => {
  const { answer } = await inspectWith(t, [threadRow("thr_a", "proj_a", "pending", { queuedWork: 3 })]);
  assert.equal(answer.error.code, "E_SESSION_UNAVAILABLE");
});

// A mark that is no time must not read as "archived" or "deleted": the thread would look
// gone, and a live session would read stopped.
for (const [name, extra] of [["an archive mark that is a word", { archivedAt: "not-a-timestamp" }], ["a delete mark that is a word", { deletedAt: "yes" }], ["an archive mark that is true", { archivedAt: true }], ["a negative archive mark", { archivedAt: -1 }]]) {
  test(`a thread row with ${name} cannot be read: E_SESSION_UNAVAILABLE, never stopped`, async (t) => {
    const { answer } = await inspectWith(t, [threadRow("thr_a", "proj_a", "idle", extra)]);
    assert.equal(answer.error.code, "E_SESSION_UNAVAILABLE");
  });
}

// The kernel relays 500 characters of a message: every message is cut to fit, and one that
// may be long says its remedy and its count before its list.
test("with sixty other live threads in the home, the refusal still fits and says what to do first", async (t) => {
  const others = Array.from({ length: 60 }, (_, i) => threadRow(`thr_other_${String(i).padStart(2, "0")}_${"x".repeat(8)}`, "proj_a", "idle"));
  const { answer, bb, home } = await inspectWith(t, [threadRow("thr_a", "proj_a", "idle"), ...others]);
  assert.equal(answer.error.code, "E_SESSION_UNAVAILABLE");
  assert.ok(answer.error.message.length <= 480, String(answer.error.message.length));
  assert.match(answer.error.message, /One home is one thread: archive the 60 others in bb\. The recorded thread is thr_a; the others: thr_other_00_x+, .* and 54 more$/);
  const many = await call("inspectMany", { homes: [{ home, endpoint }] }, { settings, bb });
  assert.ok(many.result.results[0].error.message.length <= 480);
});

test("a thread bb no longer has reads stopped, and offers nothing to open", async (t) => {
  const { answer } = await inspectWith(t, [threadRow("thr_other", "proj_other", "idle")]);
  assert.deepEqual(answer.result, { present: false, state: "stopped", running: false });
});

test("a deleted thread reads stopped", async (t) => {
  const { answer } = await inspectWith(t, [threadRow("thr_a", "proj_a", "idle", { deletedAt: 5 })]);
  assert.deepEqual(answer.result, { present: false, state: "stopped", running: false });
});

test("an archived thread is no longer the home's session, whatever its status: bb refuses every tell to it", async (t) => {
  for (const status of ["active", "idle"]) {
    const { answer } = await inspectWith(t, [threadRow("thr_a", "proj_a", status, { archivedAt: 5 })]);
    assert.deepEqual(answer.result, { present: false, state: "stopped", running: false });
  }
});

test("a status word the provider does not know is an error, never a guess", async (t) => {
  const { answer } = await inspectWith(t, [threadRow("thr_a", "proj_a", "hibernating")]);
  assert.equal(answer.ok, false);
  assert.equal(answer.error.code, "E_SESSION_UNAVAILABLE");
  assert.match(answer.error.message, /a row this provider cannot read/);
});

test("a second live thread in the home's project is E_SESSION_UNAVAILABLE naming both ids", async (t) => {
  const { answer } = await inspectWith(t, [threadRow("thr_a", "proj_a", "idle"), threadRow("thr_b", "proj_a", "active")]);
  assert.equal(answer.ok, false);
  assert.equal(answer.error.code, "E_SESSION_UNAVAILABLE");
  assert.match(answer.error.message, /thr_a/);
  assert.match(answer.error.message, /thr_b/);
});

test("a live thread of another project whose environment is the home counts as a second thread", async (t) => {
  const { answer } = await inspectWith(t, (home) => [threadRow("thr_a", "proj_a", "idle"), threadRow("thr_c", "proj_z", "idle", { environmentPath: home })]);
  assert.equal(answer.error.code, "E_SESSION_UNAVAILABLE");
  assert.match(answer.error.message, /thr_c/);
});

test("archived and deleted threads of the project are not second threads", async (t) => {
  const { answer } = await inspectWith(t, [threadRow("thr_a", "proj_a", "idle"), threadRow("thr_old", "proj_a", "idle", { archivedAt: 3 }), threadRow("thr_gone", "proj_a", "idle", { deletedAt: 3 })]);
  assert.equal(answer.ok, true);
  assert.equal(answer.result.present, true);
});

test("a bb that does not answer is E_SESSION_UNAVAILABLE, not stopped", async (t) => {
  const { dir, home } = scratch(t);
  const bb = fakeBbIn(dir, { "thread list": UNREACHABLE });
  const answer = await call("inspect", { home, endpoint }, { settings, bb });
  assert.equal(answer.ok, false);
  assert.equal(answer.error.code, "E_SESSION_UNAVAILABLE");
  assert.match(answer.error.message, /does not answer/);
  assert.equal(answer.result, undefined);
});

for (const [name, script] of [
  ["answers something that is not JSON", { "thread list": { stdout: "not json\n" } }],
  ["answers an object where a list belongs", { "thread list": { stdout: { threads: [] } } }],
  ["fails with a code of its own", { "thread list": NOT_FOUND }],
  ["exits nonzero with no envelope", { "thread list": { exit: 3, stderr: "boom\n" } }],
]) {
  test(`a bb that ${name} is E_SESSION_UNAVAILABLE`, async (t) => {
    const { dir, home } = scratch(t);
    const answer = await call("inspect", { home, endpoint }, { settings, bb: fakeBbIn(dir, script) });
    assert.equal(answer.ok, false);
    assert.equal(answer.error.code, "E_SESSION_UNAVAILABLE");
  });
}

test("a bb CLI that is not installed is E_SESSION_UNAVAILABLE", async (t) => {
  const { dir, home } = scratch(t);
  const bb = { cli: `${dir}/no-such-bb`, env: {} };
  const answer = await call("inspect", { home, endpoint }, { settings, bb });
  assert.equal(answer.error.code, "E_SESSION_UNAVAILABLE");
  assert.match(answer.error.message, /cannot run/);
});

for (const [name, bad, pattern] of [
  ["no endpoint", undefined, /not an object/],
  ["an endpoint with no thread id", { server: SERVER, projectId: "proj_a" }, /no threadId/],
  ["a thread id that reads as an option", { server: SERVER, projectId: "proj_a", threadId: "--archived" }, /not a bb id/],
  ["a server off loopback", { server: "http://203.0.113.9:38886", projectId: "proj_a", threadId: "thr_a" }, /not loopback/],
]) {
  test(`${name} is E_SESSION_UNAVAILABLE, and bb is not called`, async (t) => {
    const { dir, home } = scratch(t);
    const bb = fakeBbIn(dir, { "thread list": { stdout: [] } });
    const answer = await call("inspect", { home, endpoint: bad }, { settings, bb });
    assert.equal(answer.error.code, "E_SESSION_UNAVAILABLE");
    assert.match(answer.error.message, pattern);
    assert.deepEqual(bb.calls(), []);
  });
}

test("inspectMany reads bb once for many homes and answers in their order, each home on its own", async (t) => {
  const { dir, home } = scratch(t);
  const bb = fakeBbIn(dir, { "thread list": { stdout: [
    threadRow("thr_a", "proj_a", "active"), threadRow("thr_b", "proj_b", "error"),
    threadRow("thr_d", "proj_d", "idle"), threadRow("thr_d2", "proj_d", "idle"),
  ] } });
  const at = (projectId, threadId) => ({ home: `${home}/${projectId}`, instance: projectId, endpoint: { server: SERVER, projectId, threadId } });
  const answer = await call("inspectMany", { homes: [at("proj_a", "thr_a"), at("proj_b", "thr_b"), at("proj_c", "thr_c"), at("proj_d", "thr_d"), { home, endpoint: null }] }, { settings, bb });
  assert.equal(answer.ok, true);
  const { results } = answer.result;
  assert.deepEqual(results[0], { present: true, state: "unknown", running: true, open: { label: "Open in bb", url: `${SERVER}/projects/proj_a/threads/thr_a` } });
  // A thread in error with no process of its own here: lost.
  assert.deepEqual(results[1], { present: false, state: "stopped", running: false, open: { label: "Open in bb", url: `${SERVER}/projects/proj_b/threads/thr_b` } });
  assert.deepEqual(results[2], { present: false, state: "stopped", running: false });
  assert.equal(results[3].error.code, "E_SESSION_UNAVAILABLE");
  assert.match(results[3].error.message, /thr_d2/);
  assert.equal(results[4].error.code, "E_SESSION_UNAVAILABLE");
  assert.equal(results.length, 5);
  assert.equal(bb.calls().length, 1, "one bb thread list for the whole status");
});

// Only a list this provider can read row by row establishes that a thread is absent.
for (const [name, rows] of [
  ["a row that is no object", [null]],
  ["a row with no id", [{ projectId: "proj_a", status: "idle" }]],
  ["a row with no status", [{ id: "thr_a", projectId: "proj_a" }]],
  ["a row whose project is no string", [{ id: "thr_a", projectId: 7, status: "idle" }]],
  ["a row whose archive mark is an object", [{ id: "thr_a", projectId: "proj_a", status: "idle", archivedAt: {} }]],
]) {
  test(`a thread list holding ${name} is E_SESSION_UNAVAILABLE, never stopped: inspect and inspectMany`, async (t) => {
    const { dir, home } = scratch(t);
    const bb = fakeBbIn(dir, { "thread list": { stdout: rows } });
    const one = await call("inspect", { home, endpoint }, { settings, bb });
    assert.equal(one.error.code, "E_SESSION_UNAVAILABLE");
    assert.match(one.error.message, /a row this provider cannot read \(row 1 of 1\)/);
    const many = await call("inspectMany", { homes: [{ home, endpoint }, { home, endpoint: null }] }, { settings, bb });
    assert.deepEqual(many.result.results.map((r) => r.error?.code ?? r), ["E_SESSION_UNAVAILABLE", "E_SESSION_UNAVAILABLE"], "also the home with no endpoint: the list says nothing");
  });
}

test("inspectMany: a bb that does not answer is an error for each of its homes, never stopped", async (t) => {
  const { dir, home } = scratch(t);
  const bb = fakeBbIn(dir, { "thread list": UNREACHABLE });
  const answer = await call("inspectMany", { homes: [{ home, endpoint }, { home, endpoint }] }, { settings, bb });
  assert.equal(answer.ok, true);
  assert.deepEqual(answer.result.results.map((r) => r.error?.code), ["E_SESSION_UNAVAILABLE", "E_SESSION_UNAVAILABLE"]);
  assert.equal(bb.calls().length, 1);
});

test("inspectMany with no homes list is refused", async (t) => {
  const { dir } = scratch(t);
  const answer = await call("inspectMany", {}, { settings, bb: fakeBbIn(dir, {}) });
  assert.equal(answer.error.code, "E_SESSION_UNAVAILABLE");
});
