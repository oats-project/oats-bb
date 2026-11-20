// stop, and the retire hook that archives the home's threads (contract item 3).
import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { NOT_FOUND, UNREACHABLE, call, fakeBbIn, projectRow, runBin, scratch, threadRow } from "../fixtures/harness.mjs";

const SERVER = "http://127.0.0.1:38886";
const settings = { version: "0.50.1", trust: "single-user" };
const endpoint = { server: SERVER, projectId: "proj_a", threadId: "thr_a" };
const show = (status, extra) => ({ stdout: { thread: threadRow("thr_a", "proj_a", status, extra), environment: null, pendingTodos: null } });
const verbs = (calls) => calls.map((c) => c.argv.filter((a) => !a.startsWith("-")).slice(0, 2).join(" "));

async function stopWith(t, script, input = {}) {
  const { dir, home } = scratch(t);
  const bb = fakeBbIn(dir, script);
  const answer = await call("stop", { home, endpoint, graceSeconds: 5, ...input }, { settings, bb });
  return { answer, calls: bb.calls() };
}

test("stop asks bb, then waits until the thread is idle", async (t) => {
  const { answer, calls } = await stopWith(t, { "thread stop": { stdout: { ok: true, threadId: "thr_a" } }, "thread show": [show("stopping"), show("stopping"), show("idle")] });
  assert.deepEqual(answer.result, { stopped: true });
  assert.deepEqual(calls[0].argv, ["thread", "stop", "thr_a", "--json"]);
  assert.deepEqual(verbs(calls), ["thread stop", "thread show", "thread show", "thread show"]);
});

for (const status of ["idle", "pending", "error"]) {
  test(`a thread that settles as ${status} is stopped`, async (t) => {
    const { answer } = await stopWith(t, { "thread stop": { stdout: { ok: true, threadId: "thr_a" } }, "thread show": show(status) });
    assert.deepEqual(answer.result, { stopped: true });
  });
}

test("a thread bb no longer has is stopped", async (t) => {
  const { answer, calls } = await stopWith(t, { "thread stop": NOT_FOUND });
  assert.deepEqual(answer.result, { stopped: true });
  assert.deepEqual(verbs(calls), ["thread stop"]);
});

test("a thread deleted while stopping is stopped", async (t) => {
  const { answer } = await stopWith(t, { "thread stop": { stdout: { ok: true, threadId: "thr_a" } }, "thread show": NOT_FOUND });
  assert.deepEqual(answer.result, { stopped: true });
});

test("stop waits the whole grace the kernel gives, beyond the other verbs' time", async (t) => {
  const slow = Array.from({ length: 45 }, () => show("stopping"));
  const { answer } = await stopWith(t, { "thread stop": { stdout: { ok: true, threadId: "thr_a" } }, "thread show": [...slow, show("idle")] }, { graceSeconds: 30 });
  assert.deepEqual(answer.result, { stopped: true });
});

test("the grace starts when bb has been asked: a slow stop call takes none of it", async (t) => {
  const { answer, calls } = await stopWith(t, { "thread stop": { delayMs: 1100, stdout: { ok: true, threadId: "thr_a" } }, "thread show": [show("stopping"), show("idle")] }, { graceSeconds: 1 });
  assert.deepEqual(answer.result, { stopped: true });
  assert.deepEqual(verbs(calls), ["thread stop", "thread show", "thread show"]);
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

test("a bb stop cut off by time has still been asked: what bb shows next decides", async (t) => {
  const { dir, home } = scratch(t);
  const bb = fakeBbIn(dir, { "thread stop": { delayMs: 30_000, stdout: { ok: true, threadId: "thr_a" } }, "thread show": [show("stopping"), show("idle")] });
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
    const answer = await call("stop", { home, endpoint: null, graceSeconds: 5, ...extra }, { settings, bb });
    assert.deepEqual(answer.result, { stopped: true });
    assert.equal(bb.calls().filter((c) => c.argv[1] === "stop").length, 4, "every live thread is stopped");
    return bb.calls().filter((c) => c.argv[1] === "archive").map((c) => c.argv[2]);
  };
  assert.deepEqual(await archivedBy({ launchSent: SENT }), ["thr_at", "thr_after"]);
  assert.deepEqual(await archivedBy({ launchSent: "2026-11-20T10:00:00Z" }), ["thr_at", "thr_after"], "the same time without its fraction");
  for (const launchSent of [undefined, null, "", "yesterday", at, { at }, "1", "0", "thread 5", "May 5", "2026", "2026-11-20", "2026-11-20T10:00:00", "2026-11-20T10:00:00+01:00", "2026-13-45T10:00:00Z", ` ${SENT}`]) {
    assert.deepEqual(await archivedBy({ launchSent }), [], `nothing is archived for launchSent ${JSON.stringify(launchSent)}`);
  }
});

test("a stop with no endpoint whose archive bb refuses is still stopped; a stop with an endpoint never archives", async (t) => {
  const { dir, home } = scratch(t);
  const bb = fakeBbIn(dir, {
    "project list": { stdout: [projectRow("proj_a", home)] }, "thread list": { stdout: [threadRow("thr_a", "proj_a", "idle", { createdAt: 2 })] },
    "thread stop": { stdout: { ok: true } }, "thread show": show("idle"), "thread archive": UNREACHABLE,
  });
  assert.deepEqual((await call("stop", { home, endpoint: null, graceSeconds: 5, launchSent: "1970-01-01T00:00:00.001Z" }, { settings, bb })).result, { stopped: true });
  assert.equal(bb.calls().filter((c) => c.argv[1] === "archive").length, 1);
  const withEndpoint = await stopWith(t, { "thread stop": { stdout: { ok: true } }, "thread show": show("idle"), "thread archive": { stdout: { ok: true } } }, { launchSent: "1970-01-01T00:00:00.001Z" });
  assert.deepEqual(verbs(withEndpoint.calls), ["thread stop", "thread show"]);
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
  if (launched) mkdirSync(join(home, ".oats-bb")); // the provider's state directory: its first launch makes it
  const bb = fakeBbIn(dir, typeof script === "function" ? script(home) : script);
  const run = await runBin(["retire-hook"], { env: { ...bb.env, OATS_INSTANCE_HOME: home, OATS_SETTINGS: JSON.stringify({ cli: bb.cli }) } });
  const lines = run.stdout.trim().split("\n");
  return { run, last: JSON.parse(lines[lines.length - 1]), calls: bb.calls(), home };
}
const archived = (id) => ({ stdout: { ok: true, threadId: id, alreadyArchived: false, archivedAt: 9, archivedThreadIds: [id] } });

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
  assert.deepEqual(verbs(calls), ["project list", "thread list", "thread stop", "thread archive"]);
});

test("retire with nothing to archive is a complete cleanup (a home that never launched, or a second run)", async (t) => {
  const { last } = await retireWith(t, { "project list": { stdout: [] }, "thread list": { stdout: [threadRow("thr_z", "proj_z", "idle")] } });
  assert.deepEqual(last, { meta: { retired: false, reason: "nothing-to-delete" } });
});

test("retire of a home with no state directory still asks bb: a home's agent can remove the directory, its threads stay", async (t) => {
  const { last, calls } = await retireWith(t, (home) => ({
    "project list": { stdout: [projectRow("proj_a", home)] },
    "thread list": { stdout: [threadRow("thr_a", "proj_a", "idle")] },
    "thread archive": archived("thr_a"),
  }), { launched: false });
  assert.deepEqual(last, { meta: { retired: true, archived: ["thr_a"] } });
  assert.deepEqual(verbs(calls), ["project list", "thread list", "thread archive"]);
});

test("retire of a home the provider shows no sign of having launched (a tmux home): a bb that cannot be asked is no warning", async (t) => {
  const { run, last } = await retireWith(t, { "project list": UNREACHABLE }, { launched: false });
  assert.equal(run.status, 0);
  assert.deepEqual(last, { meta: { retired: false, reason: "nothing-to-delete", unchecked: true } });
  const none = await retireWith(t, (home) => ({ "project list": { stdout: [projectRow("proj_z", `${home}-other`)] }, "thread list": { stdout: [] } }), { launched: false });
  assert.deepEqual(none.last, { meta: { retired: false, reason: "nothing-to-delete" } });
});

test("a malformed setting does not fail a retire: a tmux home says nothing, a bb home gets the warning", async (t) => {
  const { dir, home } = scratch(t);
  const env = { OATS_INSTANCE_HOME: home, OATS_SETTINGS: JSON.stringify({ cli: "bin/bb" }) };
  const tmuxHome = await runBin(["retire-hook"], { env });
  assert.equal(tmuxHome.status, 0);
  assert.deepEqual(JSON.parse(tmuxHome.stdout), { meta: { retired: false, reason: "nothing-to-delete", unchecked: true } });
  mkdirSync(join(home, ".oats-bb"));
  const bbHome = await runBin(["retire-hook"], { env });
  assert.equal(bbHome.status, 0);
  assert.match(JSON.parse(bbHome.stdout).warning, /settings\.oats\.bb\.cli/);
  assert.equal(dir.length > 0, true);
});

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
