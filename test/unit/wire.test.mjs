// The wire: one JSON document in, exactly one out, exit 0, whatever goes wrong; and bb's
// CLI run without a shell, against one server, bounded in time.
import assert from "node:assert/strict";
import { test } from "node:test";
import { runBb } from "../../oats-package/capabilities/oats-bb/lib/bb.mjs";
import { fakeBbIn, runBin, scratch, threadRow } from "../fixtures/harness.mjs";

const SERVER = "http://127.0.0.1:38886";
const request = (phase, input, extra = {}) => JSON.stringify({ schemaVersion: 1, phase, provider: "bb", capability: "oats.bb", settings: {}, input, ...extra });

for (const [phase, code] of [["launch", "E_SESSION_START_FAILED"], ["inspect", "E_SESSION_UNAVAILABLE"], ["inspectMany", "E_SESSION_UNAVAILABLE"], ["input", "E_SESSION_INPUT_FAILED"], ["stop", "E_SESSION_STOP_FAILED"]]) {
  test(`${phase}: a request that is not JSON is refused with ${code}, one document, exit 0`, async () => {
    const run = await runBin(["session", phase], { stdin: "{ nope", env: { OATS_CAPABILITY: "oats.bb" } });
    assert.equal(run.status, 0);
    assert.deepEqual({ ...run.doc, error: { code: run.doc.error.code } }, { schemaVersion: 1, phase, provider: "bb", capability: "oats.bb", ok: false, error: { code } });
    assert.equal(run.stdout.trim().split("\n").length, 1);
  });

  test(`${phase}: an input that is not an object is refused with ${code}`, async () => {
    const run = await runBin(["session", phase], { stdin: request(phase, null) });
    assert.equal(run.status, 0);
    assert.equal(run.doc.ok, false);
    assert.ok([code, "E_BACKEND_HARNESS"].includes(run.doc.error.code), run.doc.error.code);
  });
}

for (const [name, stdin, pattern] of [
  ["another schema version", request("inspect", {}, { schemaVersion: 2 }), /schemaVersion is 2/],
  ["another phase than the command", request("stop", {}), /phase is "stop"/],
  ["another provider's name", request("inspect", {}, { provider: "herdr" }), /"herdr"/],
  ["an array", "[]", /not a JSON object/],
]) {
  test(`a request with ${name} is refused`, async () => {
    const run = await runBin(["session", "inspect"], { stdin });
    assert.equal(run.status, 0);
    assert.equal(run.doc.error.code, "E_SESSION_UNAVAILABLE");
    assert.match(run.doc.error.message, pattern);
  });
}

test("with no settings in the request the provider reads OATS_SETTINGS", async (t) => {
  const { dir, home } = scratch(t);
  const bb = fakeBbIn(dir, { "thread list": { stdout: [threadRow("thr_a", "proj_a", "idle")] } });
  const doc = { schemaVersion: 1, phase: "inspect", provider: "bb", capability: "oats.bb", input: { home, endpoint: { server: SERVER, projectId: "proj_a", threadId: "thr_a" } } };
  const run = await runBin(["session", "inspect"], { stdin: JSON.stringify(doc), env: { ...bb.env, OATS_SETTINGS: JSON.stringify({ cli: bb.cli }) } });
  assert.equal(run.doc.ok, true);
  assert.equal(bb.calls().length, 1);
  const broken = await runBin(["session", "inspect"], { stdin: JSON.stringify(doc), env: { OATS_SETTINGS: "{ nope" } });
  assert.equal(broken.doc.error.code, "E_BACKEND_SETTINGS");
});

test("settings of the wrong shape are refused with E_BACKEND_SETTINGS", async () => {
  const run = await runBin(["session", "inspect"], { stdin: request("inspect", {}, { settings: { cli: "relative/bb" } }) });
  assert.equal(run.doc.error.code, "E_BACKEND_SETTINGS");
});

test("an unknown command is a usage error, not a wire answer", async () => {
  const run = await runBin(["session", "retire"]);
  assert.equal(run.status, 2);
  assert.match(run.stderr, /unknown command/);
  assert.equal((await runBin(["--help"])).status, 0);
});

test("bb runs against the server given, without the caller's own bb thread context", async (t) => {
  const { dir } = scratch(t);
  const bb = fakeBbIn(dir, { "thread list": { stdout: [] } });
  const env = { ...process.env, ...bb.env, BB_SERVER_URL: "http://127.0.0.1:1", BB_THREAD_ID: "thr_caller", BB_PROJECT_ID: "proj_caller" };
  const answer = await runBb(bb.cli, ["thread", "list", "--json"], { server: SERVER, env });
  assert.deepEqual(answer, { ok: true, value: [] });
  assert.deepEqual(bb.calls()[0], { argv: ["thread", "list", "--json"], stdin: "", server: SERVER, context: null });
});

test("a bb call that outlives its time is killed and reported as a timeout", async (t) => {
  const { dir } = scratch(t);
  const bb = fakeBbIn(dir, { "thread list": { delayMs: 10_000, stdout: [] } });
  const started = Date.now();
  const answer = await runBb(bb.cli, ["thread", "list", "--json"], { server: SERVER, env: { ...process.env, ...bb.env }, timeoutMs: 400 });
  assert.equal(answer.ok, false);
  assert.equal(answer.timedOut, true);
  assert.ok(Date.now() - started < 5_000);
});

test("bb's failure envelope is read from stdout; its code and message are bb's own", async (t) => {
  const { dir } = scratch(t);
  const bb = fakeBbIn(dir, { "thread show": { error: { code: "thread_not_found", message: "HTTP 404: Thread not found" } } });
  const answer = await runBb(bb.cli, ["thread", "show", "thr_x", "--json"], { server: SERVER, env: { ...process.env, ...bb.env } });
  assert.deepEqual(answer, { ok: false, code: "thread_not_found", message: "HTTP 404: Thread not found" });
});
