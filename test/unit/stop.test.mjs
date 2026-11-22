// stop, which archives the thread it stopped (contract r24, A15(1)), and the retire hook
// that archives the home's threads (contract item 3).
import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { NOT_FOUND, QUEUE_GONE, UNREACHABLE, call, callSeen, fakeBbIn, projectRow, runBin, scratch, threadRow } from "../fixtures/harness.mjs";

const SERVER = "http://127.0.0.1:38886";
const settings = { version: "0.50.1", trust: "single-user" };
const endpoint = { server: SERVER, projectId: "proj_a", threadId: "thr_a" };
const show = (status, extra) => ({ stdout: { thread: threadRow("thr_a", "proj_a", status, extra), environment: null, pendingTodos: null } });
// The calls by name; the two reads beside the plain ones are named apart.
const verbs = (calls) => calls.map((c) => {
  const words = c.argv.filter((a) => !a.startsWith("-"));
  if (words[1] === "queue") return words.slice(0, 3).join(" ");
  return words[1] === "list" && c.argv.includes("--archived") ? "thread list --archived" : words.slice(0, 2).join(" ");
});

// bb's answer to an archive (bb-app 0.50.1's shape).
const archived = (id, extra) => ({ stdout: { ok: true, threadId: id, alreadyArchived: false, archivedAt: 9, archivedThreadIds: [id], ...extra } });
const archives = (calls) => calls.filter((c) => c.argv[1] === "archive").map((c) => c.argv);

// A stop by its endpoint, of a bb that archives when asked unless the test says otherwise.
// `stderr`: what the command wrote beside its answer (a warning; the kernel does not read it).
async function stopWith(t, script, input = {}) {
  const { dir, home } = scratch(t);
  const bb = fakeBbIn(dir, { "thread archive": archived("thr_a"), ...script });
  const { doc: answer, stderr } = await callSeen("stop", { home, endpoint, graceSeconds: 5, ...input }, { settings, bb });
  return { answer, calls: bb.calls(), stderr };
}

test("stop asks bb, then waits until the thread is idle", async (t) => {
  const { answer, calls } = await stopWith(t, { "thread stop": { stdout: { ok: true, threadId: "thr_a" } }, "thread show": [show("stopping"), show("stopping"), show("idle")] });
  assert.deepEqual(answer.result, { stopped: true });
  assert.deepEqual(calls[1].argv, ["thread", "stop", "thr_a", "--json"]);
  assert.deepEqual(verbs(calls), ["thread queue list", "thread stop", "thread show", "thread show", "thread show", "thread queue list", "thread show", "thread archive", "thread show", "thread queue list"], "what bb holds in line is read before the stop and again once the thread is settled; then the archive, and one look after it");
});

// Contract r24, A15(1): bb starts a stopped thread's agent again at the next message to it
// (its composer, `bb thread tell`), and refuses every message to an archived thread. So a
// stop archives what it stopped: an instance OATS stopped stays stopped from bb's side too.
test("a stop with an endpoint archives the thread, once it is seen stopped and never before: stopped stays stopped", async (t) => {
  const { answer, calls, stderr } = await stopWith(t, { "thread stop": { stdout: { ok: true, threadId: "thr_a" } }, "thread show": [show("stopping"), show("idle")] });
  assert.deepEqual(answer.result, { stopped: true });
  assert.deepEqual(archives(calls), [["thread", "archive", "thr_a", "--json"]], "that thread, by its id, once");
  assert.deepEqual(verbs(calls).slice(-4), ["thread show", "thread archive", "thread show", "thread queue list"], "after the last look that showed it settled with nothing in line; then it is looked at once more");
  assert.equal(stderr, "", "an archive bb made is not warned about");
});

// The race the archive must not lose: a message typed in bb between the stop's last look
// and the archive starts a turn, and nothing reads an archived thread afterwards. So the
// thread is looked at once after its archive, and one found in a turn, or with work in
// line, is stopped again by the whole rule.
test("a turn that started between the last look and the archive is stopped again: the stop answers only once the archived thread is at rest", async (t) => {
  const { answer, calls, stderr } = await stopWith(t, {
    "thread stop": { stdout: { ok: true, threadId: "thr_a" } },
    "thread show": [show("idle"), show("idle"), show("active", { archivedAt: 9 }), show("stopping", { archivedAt: 9 }), show("idle", { archivedAt: 9 })],
  });
  assert.deepEqual(answer.result, { stopped: true });
  assert.deepEqual(verbs(calls), ["thread queue list", "thread stop", "thread show", "thread queue list", "thread show", "thread archive", "thread show",
    "thread queue list", "thread stop", "thread show", "thread show", "thread queue list", "thread show"], "found in a turn after the archive: withdrawn, stopped and confirmed again");
  assert.equal(archives(calls).length, 1);
  assert.equal(stderr, "");
});

test("a message bb holds in line for the thread after its archive is withdrawn, and the thread stopped again", async (t) => {
  const { answer, calls } = await stopWith(t, {
    "thread stop": { stdout: { ok: true, threadId: "thr_a" } }, "thread show": show("idle"),
    "thread queue list": [{ stdout: [] }, { stdout: [] }, { stdout: [{ id: "qmsg_late", state: "waiting" }] }, { stdout: [{ id: "qmsg_late", state: "waiting" }] }, { stdout: [] }],
    "thread queue delete": { stdout: { ok: true } },
  });
  assert.deepEqual(answer.result, { stopped: true });
  assert.deepEqual(calls.filter((c) => c.argv[2] === "delete").map((c) => c.argv.slice(3, 5)), [["thr_a", "qmsg_late"]]);
  assert.equal(calls.filter((c) => c.argv[1] === "stop").length, 2);
});

test("a turn that started before the archive and does not stop: E_SESSION_STOP_FAILED, never stopped over an agent that runs in an archived thread", async (t) => {
  const { answer } = await stopWith(t, {
    "thread stop": { stdout: { ok: true, threadId: "thr_a" } },
    "thread show": [show("idle"), show("idle"), show("active", { archivedAt: 9 })],
  }, { graceSeconds: 1 });
  assert.equal(answer.error.code, "E_SESSION_STOP_FAILED");
  assert.match(answer.error.message, /thr_a is still active 1 s after bb thread stop/);
});

test("a thread bb had archived already, or lost between the stop and the archive, is stopped with no warning", async (t) => {
  for (const answered of [archived("thr_a", { alreadyArchived: true, archivedThreadIds: [] }), NOT_FOUND]) {
    const { answer, calls, stderr } = await stopWith(t, { "thread stop": { stdout: { ok: true, threadId: "thr_a" } }, "thread show": show("idle"), "thread archive": answered });
    assert.deepEqual(answer.result, { stopped: true });
    assert.equal(archives(calls).length, 1);
    assert.equal(stderr, "");
  }
});

for (const [name, refusal, said] of [
  ["bb refuses", { error: { code: "invalid_request", message: "HTTP 409: Thread cannot be archived" } }, /HTTP 409: Thread cannot be archived/],
  ["bb does not answer for", UNREACHABLE, /ECONNREFUSED/],
  ["bb answers with something unreadable", { stdout: "not json" }, /not JSON/],
  // bb's words may be several lines, or long: the warning is one line all the same, and a cut falls in bb's words, after the remedy.
  ["bb refuses in several lines", { error: { code: "invalid_request", message: "HTTP 409: first\nsecond line\r\n\tthird" } }, /bb said: HTTP 409: first second line third$/],
  ["bb refuses at length", { error: { code: "invalid_request", message: `HTTP 500: ${"x".repeat(600)}` } }, /bb said: HTTP 500: x+…$/],
]) {
  test(`an archive ${name} leaves the stop stopped, with a warning that names the thread and what to do`, async (t) => {
    const { answer, calls, stderr } = await stopWith(t, { "thread stop": { stdout: { ok: true, threadId: "thr_a" } }, "thread show": show("idle"), "thread archive": refusal });
    // The wire's stop result is exactly this, and the kernel reads any other key as a failed
    // stop (callSeen checks the envelope's keys): the warning is beside the answer, on stderr.
    assert.deepEqual(answer.result, { stopped: true });
    assert.deepEqual(archives(calls), [["thread", "archive", "thr_a", "--json"]], "asked once: the stop does not wait on an archive");
    const lines = stderr.split("\n").filter(Boolean);
    assert.equal(lines.length, 1, stderr);
    assert.match(lines[0], /^oats bb: warning: bb thread thr_a is stopped, and bb did not archive it: a message to it in bb starts its agent again\. Archive it in bb \(bb thread archive thr_a\)\. bb said: /, "the thread and the remedy first");
    assert.match(lines[0], said, "bb's own words, last");
    assert.ok(lines[0].length < 520, "one line the length of a message the kernel relays");
    assert.equal(verbs(calls).at(-1), "thread archive", "a thread bb did not archive is not looked at again: it is live, and the warning says so");
  });
}

// A stop with the host (`oats host run`'s shutdown) is a loss the kernel undoes: it resumes
// the home by an input to the same thread, which bb refuses of an archived one. The kernel
// says which stop it is (`reason: "host"`); one that says nothing gets the archive.
test("a stop with the host (reason: host) stops the thread and does not archive it: the kernel resumes it by an input", async (t) => {
  const { answer, calls, stderr } = await stopWith(t, { "thread stop": { stdout: { ok: true, threadId: "thr_a" } }, "thread show": [show("stopping"), show("idle")] }, { reason: "host" });
  assert.deepEqual(answer.result, { stopped: true });
  assert.deepEqual(verbs(calls), ["thread queue list", "thread stop", "thread show", "thread show", "thread queue list", "thread show"], "stopped and confirmed by the same rule");
  assert.deepEqual(archives(calls), []);
  assert.equal(stderr, "", "leaving it unarchived is the rule here, not a warning");
});

test("only the kernel's exact word spares the archive: any other reason, and none, is a stop that stays stopped", async (t) => {
  for (const reason of [undefined, null, "", "operator", "Host", "host ", ["host"], { host: true }, true]) {
    const { answer, calls } = await stopWith(t, { "thread stop": { stdout: { ok: true, threadId: "thr_a" } }, "thread show": show("idle") }, { reason });
    assert.deepEqual(answer.result, { stopped: true });
    assert.equal(archives(calls).length, 1, `archived for reason ${JSON.stringify(reason)}`);
  }
});

test("a thread that was not seen stopped is never archived: an archived thread would hide a turn that still runs", async (t) => {
  for (const script of [
    { "thread stop": { stdout: { ok: true, threadId: "thr_a" } }, "thread show": show("active") },
    { "thread stop": { error: { code: "invalid_request", message: "HTTP 409: no" } } },
    { "thread stop": { stdout: { ok: true, threadId: "thr_a" } }, "thread show": show("pending"), "thread queue list": { stdout: [{ id: "qmsg_1", state: "waiting" }] }, "thread queue delete": { error: { code: "invalid_request", message: "HTTP 409: nope" } } },
  ]) {
    const { answer, calls, stderr } = await stopWith(t, script, { graceSeconds: 1 });
    assert.equal(answer.error.code, "E_SESSION_STOP_FAILED");
    assert.deepEqual(archives(calls), []);
    assert.equal(stderr, "");
  }
});

for (const status of ["idle", "pending", "error"]) {
  test(`a thread that settles as ${status} is stopped`, async (t) => {
    const { answer } = await stopWith(t, { "thread stop": { stdout: { ok: true, threadId: "thr_a" } }, "thread show": show(status) });
    assert.deepEqual(answer.result, { stopped: true });
  });
}

test("a thread bb no longer has is stopped, and there is nothing to archive", async (t) => {
  const { answer, calls, stderr } = await stopWith(t, { "thread stop": NOT_FOUND });
  assert.deepEqual(answer.result, { stopped: true });
  assert.deepEqual(verbs(calls), ["thread queue list", "thread stop"]);
  assert.equal(stderr, "");
});

test("a thread deleted while stopping is stopped, and there is nothing to archive", async (t) => {
  for (const gone of [NOT_FOUND, show("idle", { deletedAt: 7 })]) {
    const { answer, calls, stderr } = await stopWith(t, { "thread stop": { stdout: { ok: true, threadId: "thr_a" } }, "thread show": gone });
    assert.deepEqual(answer.result, { stopped: true });
    assert.deepEqual(archives(calls), []);
    assert.equal(stderr, "");
  }
});

test("stop waits the whole grace the kernel gives, beyond the other verbs' time", async (t) => {
  const slow = Array.from({ length: 45 }, () => show("stopping"));
  const { answer } = await stopWith(t, { "thread stop": { stdout: { ok: true, threadId: "thr_a" } }, "thread show": [...slow, show("idle")] }, { graceSeconds: 30 });
  assert.deepEqual(answer.result, { stopped: true });
});

test("the grace starts when bb has been asked: a slow stop call takes none of it", async (t) => {
  const { answer, calls } = await stopWith(t, { "thread stop": { delayMs: 1100, stdout: { ok: true, threadId: "thr_a" } }, "thread show": [show("stopping"), show("idle")] }, { graceSeconds: 1 });
  assert.deepEqual(answer.result, { stopped: true });
  assert.deepEqual(verbs(calls), ["thread queue list", "thread stop", "thread show", "thread show", "thread queue list", "thread show", "thread archive", "thread show", "thread queue list"]);
});

test("with no endpoint, finding the home's thread and a slow stop take none of the grace", async (t) => {
  const { dir, home } = scratch(t);
  const bb = fakeBbIn(dir, {
    "project list": { delayMs: 700, stdout: [projectRow("proj_a", home)] },
    "thread list": { delayMs: 700, stdout: [threadRow("thr_a", "proj_a", "active")] },
    "thread stop": { delayMs: 700, stdout: { ok: true, threadId: "thr_a" } },
    "thread show": [show("stopping"), show("idle")],
  });
  const answer = await call("stop", { home, endpoint: null, graceSeconds: 1 }, { settings, bb });
  assert.deepEqual(answer.result, { stopped: true });
});

for (const [name, rows] of [["a row that is no object", [null]], ["a thread with no status", [{ id: "thr_a", projectId: "proj_a" }]]]) {
  test(`a stop with no endpoint and a thread list holding ${name}: E_SESSION_STOP_FAILED, never stopped`, async (t) => {
    const { dir, home } = scratch(t);
    const bb = fakeBbIn(dir, { "project list": { stdout: [projectRow("proj_a", home)] }, "thread list": { stdout: rows } });
    const answer = await call("stop", { home, endpoint: null, graceSeconds: 5 }, { settings, bb });
    assert.equal(answer.error.code, "E_SESSION_STOP_FAILED");
    assert.match(answer.error.message, /a row this provider cannot read/);
    assert.deepEqual(verbs(bb.calls()), ["project list", "thread list"]);
  });
}

// What bb holds in line for a thread (a turn its concurrency limit has not started) is
// not stopped by `bb thread stop`: bb starts it by itself when a slot frees. So a stop
// withdraws it, and answers stopped only when the thread is settled AND its queue is empty.
test("stop withdraws what bb holds in line for the thread, before it stops it, and checks again once it is settled", async (t) => {
  const { answer, calls } = await stopWith(t, {
    "thread queue list": [{ stdout: [{ id: "qmsg_1", state: "waiting", waitingOn: { kind: "plugin", pluginId: "concurrency-limit" } }, { id: "qmsg_2", state: "waiting" }] }, { stdout: [] }],
    "thread queue delete": { stdout: { ok: true } },
    "thread stop": { stdout: { ok: true, threadId: "thr_a" } }, "thread show": show("pending"),
  });
  assert.deepEqual(answer.result, { stopped: true });
  assert.deepEqual(verbs(calls), ["thread queue list", "thread queue delete", "thread queue delete", "thread stop", "thread show", "thread queue list", "thread show", "thread archive", "thread show", "thread queue list"], "withdrawn first; and after the thread is seen settled, the queue is read and the thread is looked at once more; only then the archive");
  assert.deepEqual(calls.filter((c) => c.argv[2] === "delete").map((c) => c.argv.slice(3, 5)), [["thr_a", "qmsg_1"], ["thr_a", "qmsg_2"]]);
});

test("a message that reaches the line while the thread is being stopped is withdrawn, and the thread is stopped and looked at again", async (t) => {
  const late = { stdout: [{ id: "qmsg_late", state: "waiting" }] };
  const { answer, calls } = await stopWith(t, {
    "thread queue list": [{ stdout: [] }, late, late, { stdout: [] }],
    "thread queue delete": { stdout: { ok: true } },
    "thread stop": { stdout: { ok: true, threadId: "thr_a" } }, "thread show": show("idle"),
  });
  assert.deepEqual(answer.result, { stopped: true });
  assert.deepEqual(verbs(calls), ["thread queue list", "thread stop", "thread show", "thread queue list", "thread queue list", "thread queue delete", "thread stop", "thread show", "thread queue list", "thread show", "thread archive", "thread show", "thread queue list"]);
});

// The race a stop must not lose: the thread is seen idle, a held message is found, and bb
// starts it as a turn before the delete arrives (the delete says "not found", the queue
// then reads empty). "Stopped" is never taken from the look that came before the queue's.
test("a held turn bb starts just as it is withdrawn: the stop sees the thread active again, stops it again, and answers only once it is at rest", async (t) => {
  const { answer, calls } = await stopWith(t, {
    "thread queue list": [{ stdout: [] }, { stdout: [{ id: "qmsg_late", state: "waiting" }] }, { stdout: [{ id: "qmsg_late", state: "waiting" }] }, { stdout: [] }],
    "thread queue delete": QUEUE_GONE,
    "thread stop": { stdout: { ok: true, threadId: "thr_a" } },
    "thread show": [show("idle"), show("active"), show("stopping"), show("idle"), show("idle")],
  });
  assert.deepEqual(answer.result, { stopped: true });
  assert.equal(calls.filter((c) => c.argv[1] === "stop").length, 2, "stopped again after the withdrawal");
  assert.deepEqual(verbs(calls).slice(-6), ["thread show", "thread queue list", "thread show", "thread archive", "thread show", "thread queue list"], "the last looks: settled, nothing in line, settled; the archive after them; and one look after it");
});

test("a thread that turns active between the queue's look and the last one is not stopped yet: the stop goes on waiting", async (t) => {
  const { answer } = await stopWith(t, {
    "thread stop": { stdout: { ok: true, threadId: "thr_a" } },
    "thread show": [show("idle"), show("active")],
  }, { graceSeconds: 1 });
  assert.equal(answer.error.code, "E_SESSION_STOP_FAILED");
  assert.match(answer.error.message, /thr_a is still active 1 s after bb thread stop/);
});

for (const [name, script, pattern] of [
  ["a held message bb will not withdraw", { "thread queue list": { stdout: [{ id: "qmsg_1", state: "waiting" }] }, "thread queue delete": { error: { code: "invalid_request", message: "HTTP 409: nope" } } }, /with 1 message bb still holds in line.*starts by itself when bb has a free slot.*bb thread queue list thr_a/],
  ["a queue bb does not answer for", { "thread queue list": UNREACHABLE }, /does not answer/],
  ["a queue that cannot be read", { "thread queue list": { stdout: [null] } }, /a row this provider cannot read/],
  ["a queue that is no list", { "thread queue list": { stdout: { messages: [] } } }, /not a list/],
]) {
  test(`${name}: E_SESSION_STOP_FAILED, never stopped: a settled thread with a turn in line is not stopped`, async (t) => {
    const { answer } = await stopWith(t, { "thread stop": { stdout: { ok: true, threadId: "thr_a" } }, "thread show": show("pending"), ...script });
    assert.equal(answer.error.code, "E_SESSION_STOP_FAILED");
    assert.match(answer.error.message, pattern);
    assert.ok(answer.error.message.length < 500);
  });
}

// bb keeps the Claude process of an archived thread loaded, in the home, and shows nothing
// that says so: every stop of a home, and its retire, stops the home's archived threads.
test("a stop with no endpoint also stops the home's archived threads: bb keeps their process until it is asked", async (t) => {
  const { dir, home } = scratch(t);
  const bb = fakeBbIn(dir, {
    "project list": { stdout: [projectRow("proj_a", home), projectRow("proj_z", `${home}-other`)] }, "thread list": { stdout: [] },
    "thread list --archived": { stdout: [threadRow("thr_arch", "proj_a", "idle", { archivedAt: 5 }), threadRow("thr_arch_queued", "proj_a", "pending", { archivedAt: 6, queuedWork: "waiting" }), threadRow("thr_deleted", "proj_a", "idle", { archivedAt: 7, deletedAt: 8 })] },
    "thread queue list": [{ stdout: [{ id: "qmsg_9", state: "waiting" }] }, { stdout: [] }], "thread queue delete": { stdout: { ok: true } },
    "thread stop": { stdout: { ok: true } }, "thread show": show("pending", { archivedAt: 6 }),
  });
  assert.deepEqual((await call("stop", { home, endpoint: null, graceSeconds: 5 }, { settings, bb })).result, { stopped: true });
  assert.deepEqual(verbs(bb.calls()), ["project list", "thread list", "thread list --archived", "thread queue list", "thread queue delete", "thread stop", "thread show", "thread queue list", "thread show", "thread stop", "thread list --archived", "thread list"], "the one with a held turn first, by the whole rule; then the one with nothing in line: bb acknowledges the stop, and the lists read after it must show it at rest");
  const archivedRead = bb.calls().find((c) => c.argv.includes("--archived"));
  assert.deepEqual(archivedRead.argv, ["thread", "list", "--project", "proj_a", "--archived", "--include-hidden", "--json"], "the home's project only");
  assert.deepEqual(bb.calls().filter((c) => c.argv[1] === "stop").map((c) => c.argv[2]).sort(), ["thr_arch", "thr_arch_queued"], "a deleted thread is not stopped");
});

// What confirms a stop is what bb shows after it, never the row a thread was found in.
test("an archived thread that is not at rest after its stop is not taken for stopped: the lists are read again, and it goes through the whole rule", async (t) => {
  const { dir, home } = scratch(t);
  const script = (after) => ({
    "project list": { stdout: [projectRow("proj_a", home)] }, "thread list": { stdout: [] },
    "thread list --archived": [{ stdout: [threadRow("thr_arch", "proj_a", "idle", { archivedAt: 5 })] }, { stdout: [threadRow("thr_arch", "proj_a", after, { archivedAt: 5 })] }],
    "thread stop": { stdout: { ok: true } }, "thread show": show(after, { archivedAt: 5 }),
  });
  const active = fakeBbIn(dir, script("active"));
  const refused = await call("stop", { home, endpoint: null, graceSeconds: 1 }, { settings, bb: active });
  assert.equal(refused.error.code, "E_SESSION_STOP_FAILED");
  assert.match(refused.error.message, /thr_arch is still active/);
  assert.ok(verbs(active.calls()).includes("thread show"), "it was looked at");
  const { dir: dir2, home: home2 } = scratch(t);
  const quiet = fakeBbIn(dir2, { ...script("idle"), "project list": { stdout: [projectRow("proj_a", home2)] } });
  assert.deepEqual((await call("stop", { home: home2, endpoint: null, graceSeconds: 1 }, { settings, bb: quiet })).result, { stopped: true });
  assert.deepEqual(verbs(quiet.calls()), ["project list", "thread list", "thread list --archived", "thread stop", "thread list --archived", "thread list"]);
});

test("an archived thread whose row does not say its queue is empty is not taken for stopped on that row: its queue is read, by the whole rule", async (t) => {
  const { dir, home } = scratch(t);
  const silent = threadRow("thr_arch", "proj_a", "idle", { archivedAt: 5 });
  delete silent.queuedWork;
  const bb = fakeBbIn(dir, {
    "project list": { stdout: [projectRow("proj_a", home)] }, "thread list": { stdout: [] },
    "thread list --archived": { stdout: [silent] },
    "thread queue list": [{ stdout: [{ id: "qmsg_held", state: "waiting" }] }, { stdout: [] }], "thread queue delete": { stdout: { ok: true } },
    "thread stop": { stdout: { ok: true } }, "thread show": show("idle", { archivedAt: 5 }),
  });
  assert.deepEqual((await call("stop", { home, endpoint: null, graceSeconds: 5 }, { settings, bb })).result, { stopped: true });
  assert.deepEqual(verbs(bb.calls()), ["project list", "thread list", "thread list --archived", "thread stop", "thread list --archived", "thread list",
    "thread queue list", "thread queue delete", "thread stop", "thread show", "thread queue list", "thread show"], "the held turn it could not see in the row was found and withdrawn");
});

// A home's archived threads only grow (every start archives one, and a home made again at
// the same path inherits them), and the sweep starts over at every call: its stops run
// several at a time. (The fake's delay is a sleep, so here eight at once is eight times
// as fast; a real bb call is mostly the CLI's own start, and gains two to four times.)
test("the stops of a home's archived threads run several at a time: three hundred, a tenth of a second each, are swept inside a stop's time", async (t) => {
  const { dir, home } = scratch(t);
  const rows = Array.from({ length: 300 }, (_, i) => threadRow(`thr_arch_${String(i).padStart(3, "0")}`, "proj_a", "idle", { archivedAt: 5 + i }));
  const bb = fakeBbIn(dir, { "project list": { stdout: [projectRow("proj_a", home)] }, "thread list": { stdout: [] }, "thread list --archived": { stdout: rows }, "thread stop": { delayMs: 100, stdout: { ok: true } } });
  const started = Date.now();
  assert.deepEqual((await call("stop", { home, endpoint: null, graceSeconds: 5 }, { settings, bb })).result, { stopped: true });
  assert.ok(Date.now() - started < 21_000, `took ${Date.now() - started} ms`);
  assert.equal(new Set(bb.calls().filter((c) => c.argv[1] === "stop").map((c) => c.argv[2])).size, 300, "every one was stopped, once");
});

test("where the time runs out on a home's archived threads, the stop says how many were stopped, of how many, and what to do", async (t) => {
  const { dir, home } = scratch(t);
  const rows = Array.from({ length: 40 }, (_, i) => threadRow(`thr_arch_${i}`, "proj_a", "idle", { archivedAt: 5 + i }));
  const bb = fakeBbIn(dir, { "project list": { stdout: [projectRow("proj_a", home)] }, "thread list": { stdout: [] }, "thread list --archived": { stdout: rows }, "thread stop": { delayMs: 30_000, stdout: { ok: true } } });
  const answer = await call("stop", { home, endpoint: null, graceSeconds: 1 }, { settings, bb });
  assert.equal(answer.error.code, "E_SESSION_STOP_FAILED");
  assert.equal(answer.error.message, "this home's bb project holds 40 archived threads, and 40 of them could not be stopped in the time this command has (0 were): an agent process of one may still be loaded in the home. Remove old archived threads of that project in bb (bb thread list --project <id> --archived; for each, bb thread stop <id>, then bb thread delete --yes <id>), and try again");
  assert.ok(answer.error.message.length <= 480);
});

// Two different ends, two different remedies: a bb that did not answer one call, with time
// left, is not "too many threads".
test("one archived thread whose stop bb does not answer in the call's own time is named, with time left: try again, not 'delete old threads'", async (t) => {
  const { dir, home } = scratch(t);
  const rows = [threadRow("thr_slow", "proj_a", "idle", { archivedAt: 5 })];
  const bb = fakeBbIn(dir, { "project list": { stdout: [projectRow("proj_a", home)] }, "thread list": { stdout: [] }, "thread list --archived": { stdout: rows }, "thread stop": [{ delayMs: 30_000, stdout: { ok: true } }, { stdout: { ok: true } }] });
  const started = Date.now();
  const answer = await call("stop", { home, endpoint: null, graceSeconds: 120 }, { settings, bb });
  assert.equal(answer.error.code, "E_SESSION_STOP_FAILED");
  assert.equal(answer.error.message, "bb did not acknowledge the stop of 1 archived thread of this home in time, so its agent process may still be loaded there. Try again; if it repeats, look at it in bb: thr_slow");
  assert.doesNotMatch(answer.error.message, /delete/);
  assert.ok(Date.now() - started < 20_000, "at the call's own limit, not the command's");
});

test("a project list whose source does not say what it is cannot show the home has no thread: a stop with no endpoint is E_SESSION_STOP_FAILED, never stopped", async (t) => {
  const { dir, home } = scratch(t);
  const bb = fakeBbIn(dir, { "project list": { stdout: [{ id: "proj_a", sources: [{}] }] }, "thread list": { stdout: [threadRow("thr_a", "proj_a", "active")] }, "thread stop": { stdout: { ok: true } } });
  const answer = await call("stop", { home, endpoint: null, graceSeconds: 5 }, { settings, bb });
  assert.equal(answer.error.code, "E_SESSION_STOP_FAILED");
  assert.match(answer.error.message, /bb project list answered a row this provider cannot read/);
});

for (const [name, script] of [["cannot be listed", { "thread list --archived": UNREACHABLE }], ["hold a row that cannot be read", { "thread list --archived": { stdout: [{ id: "thr_x" }] } }], ["hold one bb will not stop", { "thread list --archived": { stdout: [threadRow("thr_arch", "proj_a", "idle", { archivedAt: 5 })] }, "thread stop": { error: { code: "error", message: "HTTP 500: boom" } } }]]) {
  test(`a stop with no endpoint whose home's archived threads ${name}: E_SESSION_STOP_FAILED, never stopped`, async (t) => {
    const { dir, home } = scratch(t);
    const bb = fakeBbIn(dir, { "project list": { stdout: [projectRow("proj_a", home)] }, "thread list": { stdout: [] }, ...script });
    assert.equal((await call("stop", { home, endpoint: null, graceSeconds: 5 }, { settings, bb })).error.code, "E_SESSION_STOP_FAILED");
  });
}

test("a bb stop cut off by time has still been asked: what bb shows next decides", async (t) => {
  const { dir, home } = scratch(t);
  const bb = fakeBbIn(dir, { "thread stop": [{ delayMs: 30_000, stdout: { ok: true, threadId: "thr_a" } }, { stdout: { ok: true, threadId: "thr_a" } }], "thread show": [show("stopping"), show("idle")], "thread archive": archived("thr_a") });
  // In process, so the stop call's own time can be short: one bb call gets 10 s otherwise.
  const { stop } = await import("../../oats-package/capabilities/oats-bb/lib/stop.mjs");
  const { readSettings } = await import("../../oats-package/capabilities/oats-bb/lib/settings.mjs");
  const answer = await stop({ home, endpoint, graceSeconds: 30 }, readSettings({ cli: bb.cli }), { env: { ...process.env, ...bb.env }, deadline: Date.now() + 20_000, stopCallTimeoutMs: 500 });
  assert.deepEqual(answer, { stopped: true });
});

test("a thread still in a turn after the grace: E_SESSION_STOP_FAILED", async (t) => {
  const { answer } = await stopWith(t, { "thread stop": { stdout: { ok: true, threadId: "thr_a" } }, "thread show": show("active") }, { graceSeconds: 1 });
  assert.equal(answer.ok, false);
  assert.equal(answer.error.code, "E_SESSION_STOP_FAILED");
  assert.match(answer.error.message, /still active 1 s after/);
});

for (const [name, script] of [
  ["bb does not answer the stop", { "thread stop": UNREACHABLE }],
  ["bb refuses the stop", { "thread stop": { error: { code: "invalid_request", message: "HTTP 409: no" } } }],
  ["bb does not answer while the provider waits", { "thread stop": { stdout: { ok: true, threadId: "thr_a" } }, "thread show": UNREACHABLE }],
  ["bb shows something that is no thread", { "thread stop": { stdout: { ok: true, threadId: "thr_a" } }, "thread show": { stdout: {} } }],
]) {
  test(`${name}: E_SESSION_STOP_FAILED`, async (t) => {
    const { answer } = await stopWith(t, script);
    assert.equal(answer.ok, false);
    assert.equal(answer.error.code, "E_SESSION_STOP_FAILED");
  });
}

test("a malformed endpoint: E_SESSION_STOP_FAILED, and bb is not called", async (t) => {
  const { answer, calls } = await stopWith(t, {}, { endpoint: { server: "http://198.51.100.7:38886", projectId: "p", threadId: "t" } });
  assert.equal(answer.error.code, "E_SESSION_STOP_FAILED");
  assert.deepEqual(calls, []);
});

test("a stop with no endpoint stops every live thread that runs in the home (a launch whose answer was lost)", async (t) => {
  const { dir, home } = scratch(t);
  const bb = fakeBbIn(dir, {
    "project list": { stdout: [projectRow("proj_a", home), projectRow("proj_z", "/somewhere/else")] },
    "thread list": { stdout: [threadRow("thr_new", "proj_a", "active"), threadRow("thr_old", "proj_a", "idle", { archivedAt: 3 }), threadRow("thr_z", "proj_z", "active")] },
    "thread stop": { stdout: { ok: true, threadId: "thr_new" } },
    "thread show": { stdout: { thread: threadRow("thr_new", "proj_a", "idle"), environment: null, pendingTodos: null } },
  });
  const answer = await call("stop", { home, endpoint: null, graceSeconds: 5 }, { settings, bb });
  assert.deepEqual(answer.result, { stopped: true });
  assert.deepEqual(bb.calls().filter((c) => c.argv[1] === "stop").map((c) => c.argv), [["thread", "stop", "thr_new", "--json"]]);
});

// With no endpoint, nothing names the provider's own thread: what tells it from one a
// person opened in the home's bb project for other work is when bb made it (contract r24,
// A15(1): that one is stopped, never archived).
test("a stop with no endpoint archives only the threads made at or after launchSent: the failed launch's, never a person's", async (t) => {
  const SENT = "2026-11-20T10:00:00.000Z", at = Date.parse(SENT);
  const rows = (home) => ({
    "project list": { stdout: [projectRow("proj_a", home)] },
    "thread list": { stdout: [threadRow("thr_before", "proj_a", "idle", { createdAt: at - 1 }), threadRow("thr_at", "proj_a", "active", { createdAt: at }), threadRow("thr_after", "proj_a", "idle", { createdAt: at + 5000 }), threadRow("thr_undated", "proj_a", "idle", { createdAt: "2026-11-20T10:00:01Z" })] },
    "thread stop": { stdout: { ok: true } },
    "thread show": show("idle"),
    "thread archive": { stdout: { ok: true } },
  });
  const archivedBy = async (extra) => {
    const { dir, home } = scratch(t);
    const bb = fakeBbIn(dir, rows(home));
    const { doc: answer, stderr } = await callSeen("stop", { home, endpoint: null, graceSeconds: 5, ...extra }, { settings, bb });
    assert.deepEqual(answer.result, { stopped: true });
    assert.equal(bb.calls().filter((c) => c.argv[1] === "stop").length, 4, "every live thread is stopped");
    assert.equal(stderr, "", "a thread that is left unarchived because it may be a person's is not warned about");
    return bb.calls().filter((c) => c.argv[1] === "archive").map((c) => c.argv[2]);
  };
  assert.deepEqual(await archivedBy({ launchSent: SENT }), ["thr_at", "thr_after"]);
  assert.deepEqual(await archivedBy({ launchSent: "2026-11-20T10:00:00Z" }), ["thr_at", "thr_after"], "the same time without its fraction");
  for (const launchSent of [undefined, null, "", "yesterday", at, { at }, "1", "0", "thread 5", "May 5", "2026", "2026-11-20", "2026-11-20T10:00:00", "2026-11-20T10:00:00+01:00", "2026-13-45T10:00:00Z", ` ${SENT}`]) {
    assert.deepEqual(await archivedBy({ launchSent }), [], `nothing is archived for launchSent ${JSON.stringify(launchSent)}`);
  }
});

// Changed with contract r24, A15(1): this test said "a stop with an endpoint never archives".
// It does now (above); what stays is that an archive bb refuses fails no stop, in either
// form, and that it is said.
test("a stop with no endpoint whose archive bb refuses is still stopped, with a warning for each thread bb did not archive", async (t) => {
  const { dir, home } = scratch(t);
  const bb = fakeBbIn(dir, {
    "project list": { stdout: [projectRow("proj_a", home)] },
    "thread list": { stdout: [threadRow("thr_a", "proj_a", "idle", { createdAt: 2 }), threadRow("thr_b", "proj_a", "idle", { createdAt: 3 }), threadRow("thr_person", "proj_a", "idle", { createdAt: 0 })] },
    "thread stop": { stdout: { ok: true } }, "thread show": show("idle"), "thread archive": UNREACHABLE,
  });
  const { doc, stderr } = await callSeen("stop", { home, endpoint: null, graceSeconds: 5, launchSent: "1970-01-01T00:00:00.001Z" }, { settings, bb });
  assert.deepEqual(doc.result, { stopped: true });
  assert.deepEqual(archives(bb.calls()).map((argv) => argv[2]), ["thr_a", "thr_b"], "each asked once; the thread older than the launch is not asked for");
  const lines = stderr.split("\n").filter(Boolean);
  assert.deepEqual(lines.map((line) => /^oats bb: warning: bb thread (\S+) is stopped, and bb did not archive it/.exec(line)?.[1]), ["thr_a", "thr_b"]);
  for (const line of lines) assert.match(line, /Archive it in bb \(bb thread archive thr_[ab]\)\. bb said: /);
});

test("a stop with no endpoint and nothing live in the home is stopped, and stops nothing", async (t) => {
  const { dir, home } = scratch(t);
  const bb = fakeBbIn(dir, { "project list": { stdout: [] }, "thread list": { stdout: [threadRow("thr_z", "proj_z", "active")] } });
  const answer = await call("stop", { home, endpoint: null, graceSeconds: 5 }, { settings, bb });
  assert.deepEqual(answer.result, { stopped: true });
  assert.deepEqual(verbs(bb.calls()), ["project list", "thread list"]);
});

test("a stop with no endpoint and a bb that does not answer: E_SESSION_STOP_FAILED, never stopped", async (t) => {
  const { dir, home } = scratch(t);
  const answer = await call("stop", { home, endpoint: null, graceSeconds: 5 }, { settings, bb: fakeBbIn(dir, { "project list": UNREACHABLE }) });
  assert.equal(answer.error.code, "E_SESSION_STOP_FAILED");
});

// The retire hook: the kernel runs it after its own stop, with the hook environment.
async function retireWith(t, script, { launched = true } = {}) {
  const { dir, home } = scratch(t);
  if (launched) mkdirSync(join(home, ".oats-bb")); // what an earlier version of the provider kept in the home: it decides nothing now
  // A thread that stops when asked, unless the test says otherwise: a retire archives only what it has seen stopped.
  const bb = fakeBbIn(dir, { "thread stop": { stdout: { ok: true } }, "thread show": show("idle"), ...(typeof script === "function" ? script(home) : script) });
  const run = await runBin(["retire-hook"], { env: { ...bb.env, OATS_INSTANCE_HOME: home, OATS_SETTINGS: JSON.stringify({ cli: bb.cli }) } });
  const lines = run.stdout.trim().split("\n");
  return { run, last: JSON.parse(lines[lines.length - 1]), calls: bb.calls(), home };
}
// The retire's last read: the env bb holds for the home's project (what a pi launch wrote), to remove it.
const ENV_READ = "machine env";
// A stop that is confirmed: what waits in line, the stop, settled, nothing in line, settled.
const CONFIRMED = ["thread queue list", "thread stop", "thread show", "thread queue list", "thread show"];

test("retire archives the live threads of the home's project, and only those", async (t) => {
  const { run, last, calls } = await retireWith(t, (home) => ({
    "project list": { stdout: [projectRow("proj_a", home), projectRow("proj_z", "/somewhere/else")] },
    "thread list": { stdout: [threadRow("thr_a", "proj_a", "idle"), threadRow("thr_old", "proj_a", "idle", { archivedAt: 3 }), threadRow("thr_z", "proj_z", "idle")] },
    "thread archive": archived("thr_a"),
  }));
  assert.equal(run.status, 0);
  assert.deepEqual(last, { meta: { retired: true, archived: ["thr_a"] } });
  assert.deepEqual(calls.filter((c) => c.argv[1] === "archive").map((c) => c.argv), [["thread", "archive", "thr_a", "--json"]]);
});

test("retire stops a thread still in a turn before archiving it", async (t) => {
  const { last, calls } = await retireWith(t, (home) => ({
    "project list": { stdout: [projectRow("proj_a", home)] },
    "thread list": { stdout: [threadRow("thr_a", "proj_a", "active")] },
    "thread stop": { stdout: { ok: true, threadId: "thr_a" } },
    "thread archive": archived("thr_a"),
  }));
  assert.deepEqual(last.meta, { retired: true, archived: ["thr_a"] });
  assert.deepEqual(verbs(calls), ["project list", "thread list", ...CONFIRMED, "thread archive", "thread list --archived", ENV_READ]);
});

test("retire withdraws what bb holds in line for a thread, stops it and archives it; and stops the home's threads archived before", async (t) => {
  const { last, calls } = await retireWith(t, (home) => ({
    "project list": { stdout: [projectRow("proj_a", home)] },
    "thread list": { stdout: [threadRow("thr_a", "proj_a", "pending", { queuedWork: "waiting" })] },
    "thread list --archived": { stdout: [threadRow("thr_arch", "proj_a", "idle", { archivedAt: 5 })] },
    "thread queue list": [{ stdout: [{ id: "qmsg_1", state: "waiting" }] }, { stdout: [] }], "thread queue delete": { stdout: { ok: true } },
    "thread stop": { stdout: { ok: true } }, "thread archive": archived("thr_a"),
  }));
  assert.deepEqual(last, { meta: { retired: true, archived: ["thr_a"] } });
  assert.deepEqual(verbs(calls), ["project list", "thread list", "thread queue list", "thread queue delete", "thread stop", "thread show", "thread queue list", "thread show", "thread archive", "thread list --archived", "thread stop", "thread list --archived", "thread list", ENV_READ]);
  assert.deepEqual(calls.filter((c) => c.argv[1] === "stop").map((c) => c.argv[2]), ["thr_a", "thr_arch"]);
});

test("retire with nothing live still stops the home's archived threads, and is a complete cleanup", async (t) => {
  const { last, calls } = await retireWith(t, (home) => ({
    "project list": { stdout: [projectRow("proj_a", home)] }, "thread list": { stdout: [] },
    "thread list --archived": { stdout: [threadRow("thr_arch", "proj_a", "idle", { archivedAt: 5 })] }, "thread stop": { stdout: { ok: true } },
  }));
  assert.deepEqual(last, { meta: { retired: false, reason: "nothing-to-delete" } });
  assert.deepEqual(verbs(calls), ["project list", "thread list", "thread list --archived", "thread stop", "thread list --archived", "thread list", ENV_READ]);
});

test("retire archives only a thread it has seen stopped: one that will not stop is left, named, and the retire goes on", async (t) => {
  const { run, last, calls } = await retireWith(t, (home) => ({
    "project list": { stdout: [projectRow("proj_a", home)] },
    "thread list": { stdout: [threadRow("thr_a", "proj_a", "active")] },
    "thread show": show("active"), "thread archive": archived("thr_a"),
  }));
  assert.equal(run.status, 0);
  assert.deepEqual(last.meta, { archived: [], left: ["thr_a"] });
  assert.match(last.warning, /^1 bb thread of this home could not be stopped and archived: stop and archive it in bb \(bb thread stop <id>, bb thread archive <id>\)\. It is thr_a$/);
  assert.equal(verbs(calls).includes("thread archive"), false, "an archived thread would keep its Claude: it is not archived unstopped");
});

test("retire's warnings stay inside what the kernel relays, however many threads and whatever bb says", async (t) => {
  const many = Array.from({ length: 40 }, (_, i) => `thr_${String(i).padStart(3, "0")}_${"x".repeat(40)}`);
  const { last } = await retireWith(t, (home) => ({
    "project list": { stdout: [projectRow("proj_a", home)] },
    "thread list": { stdout: many.map((id) => threadRow(id, "proj_a", "idle")) },
    "thread archive": { error: { code: "error", message: `HTTP 500: ${"boom ".repeat(400)}` } },
    "thread list --archived": { exit: 3, stderr: `${"noise ".repeat(400)}\n` },
  }));
  assert.equal(last.meta.left.length, 40);
  assert.equal(last.meta.unswept, true);
  assert.ok(last.warning.length <= 480, String(last.warning.length));
  assert.match(last.warning, /^the home's archived bb threads could not all be stopped: bb could not be asked \(E_[A-Z_]+\).*\. 40 bb threads of this home could not be stopped and archived: stop and archive them in bb \(bb thread stop <id>, bb thread archive <id>\)\. They are thr_000_x+, /);
  assert.doesNotMatch(last.warning, /boom|noise/);
  const unreachable = await retireWith(t, { "project list": { error: { code: "error", message: `fetch failed: ${"very long ".repeat(300)}` } } });
  assert.ok(unreachable.last.warning.length <= 480);
  assert.match(unreachable.last.warning, /^the home's bb threads were not archived: oats readiness reports them as session-provider-orphaned/);
});

test("retire says what the sweep said, first: how many archived threads were stopped, of how many, and to stop then delete old ones; then what it left", async (t) => {
  const rows = Array.from({ length: 40 }, (_, i) => threadRow(`thr_arch_${i}`, "proj_a", "idle", { archivedAt: 5 + i }));
  // The hook has 40 s. Each stop hangs for its own 10 s, eight at a time: the hook's time runs out on them.
  const { run, last } = await retireWith(t, (home) => ({
    "project list": { stdout: [projectRow("proj_a", home)] },
    "thread list": { stdout: [threadRow("thr_live", "proj_a", "active")] }, "thread show": show("active"),
    "thread list --archived": { stdout: rows }, "thread stop": { delayMs: 60_000, stdout: { ok: true } },
  }));
  assert.equal(run.status, 0, "the retire is never failed or held");
  assert.deepEqual(last.meta, { archived: [], left: ["thr_live"], unswept: true });
  assert.ok(last.warning.length <= 480);
  assert.match(last.warning, /^the home's archived bb threads could not all be stopped: this home's bb project holds 40 archived threads, and 40 of them could not be stopped in the time this command has \(0 were\).*bb thread stop <id>, then bb thread delete --yes <id>\), and try again\. 1 bb thread of this home could not be stopped and archived/);
});

test("launchSent is a time only when it is one: an impossible date archives nothing", async () => {
  const { launchSentOf } = await import("../../oats-package/capabilities/oats-bb/lib/stop.mjs");
  assert.equal(launchSentOf("2028-02-29T10:00:00.000Z"), Date.parse("2028-02-29T10:00:00.000Z"));
  assert.equal(launchSentOf("2026-11-20T10:00:00Z"), Date.parse("2026-11-20T10:00:00Z"));
  for (const bad of ["2026-02-29T10:00:00Z", "2026-02-30T10:00:00.000Z", "2026-04-31T00:00:00Z", "2026-11-20T24:00:00Z", "2026-11-20T10:60:00Z", "2026-13-01T00:00:00Z", "2026-11-20T10:00:00", "1", "", null, 5]) {
    assert.ok(Number.isNaN(launchSentOf(bad)), String(bad));
  }
});

test("retire with nothing to archive is a complete cleanup (a home that never launched, or a second run)", async (t) => {
  const { last } = await retireWith(t, { "project list": { stdout: [] }, "thread list": { stdout: [threadRow("thr_z", "proj_z", "idle")] } });
  assert.deepEqual(last, { meta: { retired: false, reason: "nothing-to-delete" } });
});

test("retire asks bb for every home, whatever the home holds: nothing in it says which backend it ran on", async (t) => {
  const { last, calls } = await retireWith(t, (home) => ({
    "project list": { stdout: [projectRow("proj_a", home)] },
    "thread list": { stdout: [threadRow("thr_a", "proj_a", "idle")] },
    "thread archive": archived("thr_a"),
  }), { launched: false });
  assert.deepEqual(last, { meta: { retired: true, archived: ["thr_a"] } });
  assert.deepEqual(verbs(calls), ["project list", "thread list", ...CONFIRMED, "thread archive", "thread list --archived", ENV_READ], "a settled thread is stopped too: bb keeps an archived thread's process otherwise");
});

test("retire of any home (a tmux home too) warns when bb cannot be asked, and says nothing when bb holds nothing of it", async (t) => {
  const { run, last } = await retireWith(t, { "project list": UNREACHABLE }, { launched: false });
  assert.equal(run.status, 0);
  assert.deepEqual(last.meta, { archived: [], unchecked: true });
  assert.match(last.warning, /were not archived: .*session-provider-orphaned/);
  const none = await retireWith(t, (home) => ({ "project list": { stdout: [projectRow("proj_z", `${home}-other`)] }, "thread list": { stdout: [] } }), { launched: false });
  assert.deepEqual(none.last, { meta: { retired: false, reason: "nothing-to-delete" } });
});

test("a malformed setting does not fail a retire: the home gets the warning, whatever it holds", async (t) => {
  const { home } = scratch(t);
  const env = { OATS_INSTANCE_HOME: home, OATS_SETTINGS: JSON.stringify({ cli: "bin/bb" }) };
  for (const old of [false, true]) {
    if (old) mkdirSync(join(home, ".oats-bb"));
    const run = await runBin(["retire-hook"], { env });
    assert.equal(run.status, 0);
    assert.match(JSON.parse(run.stdout).warning, /settings\.oats\.bb\.cli/);
  }
});

// Whatever keeps bb from being asked, the hook exits 0 and never reports an incomplete
// retire (`retired: false` beside a warning or a failure): a home's retire is not held for
// bb. The home gets a warning either way: with or without what an earlier version of the
// provider kept there, which the hook does not look at.
for (const [name, script, cli] of [
  ["no bb CLI on this host", {}, "/nonexistent/oats-bb-test/bb"],
  ["a bb that does not answer", { "project list": UNREACHABLE }, null],
  ["a bb whose thread list cannot be read", (home) => ({ "project list": { stdout: [projectRow("proj_a", home)] }, "thread list": { stdout: [null] } }), null],
  ["a bb that fails with a code of its own", { "project list": { exit: 3, stderr: "boom\n" } }, null],
  ["a bb that hangs", { "project list": { delayMs: 60_000, stdout: [] } }, null],
]) {
  for (const launched of [false, true]) {
    test(`retire with ${name} never fails or holds the retire, and warns: ${launched ? "a home with an old .oats-bb" : "a home with nothing of the provider's"}`, async (t) => {
      const { dir, home } = scratch(t);
      if (launched) mkdirSync(join(home, ".oats-bb"));
      const bb = fakeBbIn(dir, typeof script === "function" ? script(home) : script);
      const run = await runBin(["retire-hook"], { env: { ...bb.env, OATS_INSTANCE_HOME: home, OATS_SETTINGS: JSON.stringify({ cli: cli ?? bb.cli }) } });
      assert.equal(run.status, 0, run.stderr);
      const lines = run.stdout.trim().split("\n");
      assert.equal(lines.length, 1);
      const answer = JSON.parse(lines[0]);
      assert.deepEqual(answer.meta, { archived: [], unchecked: true });
      assert.match(answer.warning, /were not archived: .*session-provider-orphaned/);
    });
  }
}

test("retire with a bb that does not answer warns and does not hold the retire", async (t) => {
  const { run, last } = await retireWith(t, { "project list": UNREACHABLE });
  assert.equal(run.status, 0);
  assert.equal(last.meta.retired, undefined, "not an incomplete cleanup: the home goes, readiness reports the thread");
  assert.match(last.warning, /session-provider-orphaned/);
});

test("retire names a thread it could not archive", async (t) => {
  const { last } = await retireWith(t, (home) => ({
    "project list": { stdout: [projectRow("proj_a", home)] },
    "thread list": { stdout: [threadRow("thr_a", "proj_a", "idle"), threadRow("thr_b", "proj_a", "idle")] },
    "thread archive": [archived("thr_a"), { error: { code: "error", message: "HTTP 500: no" } }],
  }));
  assert.deepEqual(last.meta, { archived: ["thr_a"], left: ["thr_b"] });
  assert.match(last.warning, /thr_b/);
});

test("the retire hook without a home in its environment fails loudly", async () => {
  const run = await runBin(["retire-hook"], { env: { OATS_SETTINGS: "{}" } });
  assert.equal(run.status, 2);
  assert.match(run.stderr, /OATS_INSTANCE_HOME/);
});
