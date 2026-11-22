// inspect and inspectMany: contract item 4's table, one thread per home, and a bb that
// does not answer is an error, never "stopped".
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { inspectAnswer } from "../../oats-package/capabilities/oats-bb/lib/threads.mjs";
import { processLook, threadProcesses } from "../../oats-package/capabilities/oats-bb/lib/processes.mjs";
import { NOT_FOUND, UNREACHABLE, call, fakeBbIn, scratch, threadRow } from "../fixtures/harness.mjs";

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

for (const [status, expected] of [
  ["starting", { present: true, state: "unknown", running: true }],
  ["active", { present: true, state: "unknown", running: true }],
  ["stopping", { present: true, state: "unknown", running: true }],
  ["pending", { present: true, state: "unknown", running: null }],
  ["idle", { present: true, state: "unknown", running: null }],
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

// The provider reads a process's environment and name from Linux's /proc: these tests start a
// real process that carries a thread's id and goes by a harness's name, as bb's harness does.
const NO_PROC = existsSync("/proc/self/environ") ? false : "no /proc on this host";
const HARNESS_NAME = { pi: "pi", "claude-code": "claude" };
/** A process that carries BB_THREAD_ID=<id>, until the test ends. `name`: what it runs as (a
 *  link to node under that name, as `pi` and `claude` are found on a PATH); with none it is a
 *  plain node, as a command the agent started and left running is some other program. */
async function threadProcess(t, id, name = null) {
  let command = process.execPath;
  if (name !== null) {
    const bin = mkdtempSync(join(tmpdir(), "oats-bb-harness-"));
    t.after(() => rmSync(bin, { recursive: true, force: true }));
    command = join(bin, name);
    symlinkSync(process.execPath, command);
  }
  const child = spawn(command, ["-e", "setTimeout(() => {}, 600000)"], { env: { BB_THREAD_ID: id }, stdio: "ignore" });
  t.after(() => new Promise((done) => { if (child.exitCode !== null || child.signalCode !== null) return done(); child.once("exit", done); child.kill("SIGKILL"); }));
  await new Promise((done, failed) => { child.once("spawn", done); child.once("error", failed); });
  return child;
}
// An id no other test file's process carries: the files run side by side on one host.
const liveId = (name) => `thr_${name}_${process.pid}`;

test("a thread whose last turn failed, with its harness still loaded, is there and at rest: for pi and for Claude alike", { skip: NO_PROC }, async (t) => {
  for (const providerId of ["pi", "claude-code"]) {
    const id = liveId(`failed_${providerId.replace("-", "_")}`);
    const open = { label: "Open in bb", url: `${SERVER}/projects/proj_a/threads/${id}` };
    const input = { endpoint: { ...endpoint, threadId: id } };
    // No process of the thread: lost.
    const lost = await inspectWith(t, [threadRow(id, "proj_a", "error", { providerId })], input);
    assert.deepEqual(lost.answer.result, { present: false, state: "stopped", running: false, open }, providerId);
    // Its harness is still loaded: an input recovers it, and the kernel must not resume beside it.
    const child = await threadProcess(t, id, HARNESS_NAME[providerId]);
    const there = await inspectWith(t, [threadRow(id, "proj_a", "error", { providerId })], input);
    assert.deepEqual(there.answer.result, { present: true, state: "unknown", running: null, open }, providerId);
    assert.deepEqual(there.bb.calls().map((c) => c.argv), [["thread", "list", "--include-hidden", "--json"]], "bb is asked nothing more");
    // Decided at every call: once the process is gone, so is the session.
    await new Promise((done) => { child.once("exit", done); child.kill("SIGKILL"); });
    const gone = await inspectWith(t, [threadRow(id, "proj_a", "error", { providerId })], input);
    assert.deepEqual(gone.answer.result, { present: false, state: "stopped", running: false, open }, providerId);
  }
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
  // A thread that is not in error asks nothing of the processes.
  assert.deepEqual(inspectAnswer(threadRow("thr_a", "proj_a", "idle"), processLook({ proc: join(dir, "no-such-proc") })), { present: true, state: "unknown", running: null });
  // And neither does one in error with a turn bb holds in line: bb starts it by itself.
  assert.deepEqual(inspectAnswer(threadRow("thr_a", "proj_a", "error", { queuedWork: "waiting" }), processLook({ proc: join(dir, "no-such-proc") })), { present: true, state: "unknown", running: true });
});

test("the process look reads each process's thread id and names, as bb-app 0.50.1's harnesses show them, and passes over what it cannot read", (t) => {
  const { dir } = scratch(t);
  const proc = join(dir, "proc");
  const entry = (pid, environ, comm = null, cmdline = null) => {
    mkdirSync(join(proc, pid), { recursive: true });
    if (environ !== null) writeFileSync(join(proc, pid, "environ"), environ);
    if (comm !== null) writeFileSync(join(proc, pid, "comm"), `${comm}\n`);
    if (cmdline !== null) writeFileSync(join(proc, pid, "cmdline"), cmdline);
  };
  // pi sets its own title: its name and its whole command line are that one word.
  entry("101", "PATH=/bin\0BB_THREAD_ID=thr_pi\0HOME=/x\0", "pi", "pi\0");
  // Claude Code: argv[0] is the path of the claude on bb's PATH.
  entry("102", "BB_THREAD_ID=thr_claude\0", "claude", "/home/node/.npm-global/bin/claude\0--output-format\0stream-json\0");
  // A script run by an interpreter: the name is the second word.
  entry("103", "BB_THREAD_ID=thr_script\0", "node", "/usr/local/bin/node\0/opt/pi/bin/pi\0--mode\0rpc\0");
  // What an agent leaves running: the variable, and another name. A later word named pi is not looked at.
  entry("104", "BB_THREAD_ID=thr_pi\0", "sleep", "sleep\x00900\x00");
  entry("105", "BB_THREAD_ID=thr_stray\0", "node", "node\0server.js\0pi\0");
  entry("111", "BB_THREAD_ID=thr_stray\0", "tail", "tail\0pi\0"); // an argument named pi, of a program that runs no script
  entry("106", "NOT_BB_THREAD_ID=thr_no\0XBB_THREAD_ID=thr_no2\0", "pi", "pi\0");
  entry("107", "", "pi", "pi\0"); // a zombie
  entry("108", null, "pi", "pi\0"); // ended meanwhile
  entry("109", "BB_THREAD_ID=\0", "pi", "pi\0"); // names none
  entry("110", "BB_THREAD_ID=thr_bare"); // its name cannot be read
  entry("self", "BB_THREAD_ID=thr_not_a_pid\0", "pi", "pi\0");
  // Which files the look opens: a process that is no harness by its name has its name and
  // command line read, and its environment never (it may hold another program's secret).
  const opened = [];
  const read = (path, encoding) => { opened.push(path.slice(proc.length + 1)); return readFileSync(path, encoding); };
  const threads = threadProcesses({ proc, read });
  assert.deepEqual([...threads.keys()].sort(), ["thr_claude", "thr_pi", "thr_script"], "only threads with a harness-named process");
  assert.deepEqual([...threads.get("thr_pi")].sort(), ["pi"], "the stray sleep of the same thread adds nothing");
  assert.deepEqual(opened.filter((path) => path.endsWith("/environ")).sort(), ["101/environ", "102/environ", "103/environ", "106/environ", "107/environ", "108/environ", "109/environ"],
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
});

// A turn bb's concurrency limit holds in line starts by itself when a slot frees: a thread
// that is settled with work in line is busy, not at rest. (bb's list row says so in
// `queuedWork`: "none" when nothing waits.)
for (const [status, queuedWork, running] of [["pending", "waiting", true], ["idle", "waiting", true], ["idle", "scheduled", true], ["pending", "none", null], ["idle", undefined, null], ["idle", null, null], ["active", "waiting", true], ["error", "waiting", true]]) {
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
