// inspect and inspectMany: contract item 4's table, one thread per home, and a bb that
// does not answer is an error, never "stopped".
import assert from "node:assert/strict";
import { test } from "node:test";
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
  // A thread in error is a lost session, as the kernel reads one: eligible for a resume.
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

// A turn bb's concurrency limit holds in line starts by itself when a slot frees: a thread
// that is settled with work in line is busy, not at rest. (bb's list row says so in
// `queuedWork`: "none" when nothing waits.)
for (const [status, queuedWork, running] of [["pending", "waiting", true], ["idle", "waiting", true], ["idle", "scheduled", true], ["pending", "none", null], ["idle", undefined, null], ["idle", null, null], ["active", "waiting", true]]) {
  test(`a bb thread that is ${status} with queuedWork ${JSON.stringify(queuedWork)} reads running ${running}`, async (t) => {
    const { answer } = await inspectWith(t, [threadRow("thr_a", "proj_a", status, { queuedWork })]);
    assert.deepEqual(answer.result, { present: true, state: "unknown", running, open: OPEN });
  });
}

test("a thread whose queuedWork is no word cannot be read: E_SESSION_UNAVAILABLE, never at rest", async (t) => {
  const { answer } = await inspectWith(t, [threadRow("thr_a", "proj_a", "pending", { queuedWork: 3 })]);
  assert.equal(answer.error.code, "E_SESSION_UNAVAILABLE");
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
  assert.match(answer.error.message, /"hibernating"/);
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
