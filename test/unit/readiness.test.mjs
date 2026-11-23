// Readiness (contract items 6a, 7, 8): the provider's `check` verb, whose result the kernel
// relays as a readiness providers item, and the same checks a launch runs first.
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { createServer } from "node:http";
import { homedir, networkInterfaces } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { accepts, exposedListeners, nonLoopbackAddresses } from "../../oats-package/capabilities/oats-bb/lib/exposure.mjs";
import { sandboxCanStart } from "../../oats-package/capabilities/oats-bb/lib/readiness.mjs";
import { isLoopbackHost, loopbackOrigin, readSettings } from "../../oats-package/capabilities/oats-bb/lib/settings.mjs";
import { PATH_WITHOUT_BWRAP, UNREACHABLE, VERSION, call, deadPort, fakeBackend, fakeBbIn, projectRow, requestFor, runBin, scratch, threadRow } from "../fixtures/harness.mjs";


async function setup(t, script = {}, backendOverrides = {}) {
  const { dir, home } = scratch(t);
  const backend = await fakeBackend(t, backendOverrides);
  const bb = fakeBbIn(dir, { "--version": { stdout: `${VERSION}\n` }, "project list": { stdout: [projectRow("proj_a", home)] }, "thread list": { stdout: [threadRow("thr_a", "proj_a", "idle")] }, ...(typeof script === "function" ? script(home, dir) : script) });
  // For a home, the settings are the recorded ones (OATS_SETTINGS), as for every verb.
  const check = (settings = {}) => call("check", { home, soul: null }, { settings: backend.settings(settings), bb });
  return { dir, home, backend, bb, check };
}
const codes = (answer) => answer.result.problems.map((problem) => problem.code);

test("a bb that is fit answers ready: {status, problems, warnings}, the shape oats readiness relays", async (t) => {
  const { check, bb, backend } = await setup(t);
  const answer = await check();
  // Ready, with the one thing a plain readiness read always says: which mode the command launches in.
  assert.deepEqual({ ...answer, result: { ...answer.result, warnings: answer.result.warnings.map((w) => w.code) } }, { schemaVersion: 1, phase: "session", capability: "oats.bb", provider: "bb", verb: "check", ok: true, result: { status: "ready", problems: [], warnings: ["session-provider-full-mode-only"] } });
  assert.match(answer.result.warnings[0].message, /full mode only \(sandboxed modes are not offered\): a spawn or start that does not choose it \(--yolo, or a launch configuration.s --permission-mode bypassPermissions\) .* is refused before anything starts \(E_BACKEND_SANDBOXED_MODE\)/);
  assert.ok(answer.result.warnings[0].message.length < 500);
  assert.equal(bb.calls().every((c) => c.server === backend.server), true);
  assert.deepEqual(backend.requests, ["/health", "/api/v1/system/providers/state?providerId=claude-code", "/api/v1/system/providers/state?providerId=pi"], "a read with no planned launch asks of both harnesses");
  assert.deepEqual(backend.daemonRequests, ["/status"]);
});

test("for a soul (no home) the check takes the settings from its input", async (t) => {
  const { backend, bb } = await setup(t);
  const run = await runBin(["session", "check"], { stdin: JSON.stringify(requestFor("check", { home: null, soul: "dev", settings: { ...backend.settings({ trust: "everyone" }), cli: bb.cli } })), env: bb.env });
  assert.equal(run.status, 0);
  assert.deepEqual(run.doc.result.problems.map((p) => p.code), ["E_BACKEND_TRUST"]);
});

// Until the release that brings the deny rules, the command launches in bb's full mode
// only: the check says so of a planned launch that would be sandboxed, for a soul and for
// a home, and says nothing of one in full mode.
test("the check of a planned launch that is not in full mode: E_BACKEND_SANDBOXED_MODE, needs-configuration; yolo is ready", async (t) => {
  const { home, backend, bb } = await setup(t);
  const check = (target, launch) => call("check", { ...target, launch }, { settings: backend.settings(), bb });
  for (const target of [{ home, soul: null }, { home: null, soul: "dev", settings: { ...backend.settings(), cli: bb.cli } }]) {
    for (const launch of [{ harness: "claude", yolo: false, args: [] }, { harness: "claude", yolo: null, args: [] }, { harness: "claude", args: ["--permission-mode", "auto"] },
      { harness: "claude", yolo: false, args: [], sandbox: { domains: [], write: [], missing: [{ capability: "oats.aweb", setting: "services", team: "ops:acme.aweb.ai" }] } }]) {
      const answer = await check(target, launch);
      assert.equal(answer.result.status, "needs-configuration");
      assert.deepEqual(answer.result.problems.map((p) => p.code), ["E_BACKEND_SANDBOXED_MODE"], "the launch's own first refusal, alone");
      assert.match(answer.result.problems[0].message, /a sandboxed mode.*launches in bb.s full mode only: sandboxed modes are not offered.*--yolo.*Nothing was started$/);
      assert.ok(answer.result.problems[0].message.length < 500);
    }
    for (const launch of [{ harness: "claude", yolo: true, args: [] }, { harness: "claude", yolo: null, args: ["--permission-mode", "bypassPermissions"] }]) {
      assert.deepEqual((await check(target, launch)).result, { status: "ready", problems: [], warnings: [] });
    }
    // A launch the provider would refuse for its argument or its harness says that, as before.
    assert.deepEqual((await check(target, { harness: "claude", yolo: true, args: ["--permission-mode", "auto"] })).result.problems.map((p) => p.code), ["E_BACKEND_LAUNCH_ARG"]);
    assert.deepEqual((await check(target, { harness: "codex", yolo: false, args: [] })).result.problems.map((p) => p.code), ["E_BACKEND_HARNESS"]);
  }
});

// A spawn's preview asks the check before anything of the home exists (OATS 0.70.1: the kernel
// hands the home's PLANNED path, its one planned tree and the kernel's directory by name, none
// of them made). An absent home is absent, never an error: the answer is the one a home that
// exists gets, whole (status, problems and warnings), so a preview says what the spawn will.
test("the check of a planned launch for a home that does not exist yet answers as for a home that exists: refused by its mode, or ready, with no problem and no warning from the missing home", async (t) => {
  const { dir, home, backend, bb } = await setup(t);
  const planned = join(dir, "agents", "dev", "instances", "not-spawned-yet");
  const kept = [join(dir, "agents", "dev", "instances", ".oats-retirement")];
  const absent = [planned, join(planned, "work"), ...kept];
  for (const path of absent) assert.equal(existsSync(path), false, `${path} is not there`);
  const sandbox = { domains: [{ host: "app.example.org", capability: "oats.aweb", setting: "server" }], write: [{ path: join(dir, ".agents", "events"), reason: "the deployment's events" }], missing: [] };
  // The input as the kernel hands it: the settings in it too (and in OATS_SETTINGS, as the harness sets them).
  const check = (target, launch) => call("check", { home: target, soul: null, settings: { ...backend.settings(), cli: bb.cli }, launch: { ...launch, sandbox, trees: [join(target, "work")], protected: kept } }, { settings: backend.settings(), bb });
  const expected = [
    // Full mode: ready.
    [{ harness: "claude", yolo: true, args: [] }, "ready", []],
    [{ harness: "claude", yolo: null, args: ["--permission-mode", "bypassPermissions"] }, "ready", []],
    // A sandboxed mode: the launch's own first refusal, alone.
    [{ harness: "claude", yolo: false, args: [] }, "needs-configuration", ["E_BACKEND_SANDBOXED_MODE"]],
    [{ harness: "claude", yolo: null, args: [] }, "needs-configuration", ["E_BACKEND_SANDBOXED_MODE"]],
    [{ harness: "claude", yolo: null, args: ["--permission-mode", "auto"] }, "needs-configuration", ["E_BACKEND_SANDBOXED_MODE"]],
    // Every other refusal of a planned launch.
    [{ harness: "codex", yolo: true, args: [] }, "needs-configuration", ["E_BACKEND_HARNESS"]],
    [{ harness: "claude", yolo: true, args: ["--permission-mode", "auto"] }, "needs-configuration", ["E_BACKEND_LAUNCH_ARG"]],
  ];
  for (const [launch, status, problems] of expected) {
    const answer = (await check(planned, launch)).result;
    assert.deepEqual([answer.status, codes({ result: answer })], [status, problems], JSON.stringify(launch));
    // No warning at all: none for the missing home, its tree or the kernel's directory (which
    // is absent for the home that exists too, so the comparison below would not show it).
    assert.deepEqual(answer.warnings, [], JSON.stringify(launch));
    // Whole, it is the answer of a home that exists.
    assert.deepEqual(answer, (await check(home, launch)).result, JSON.stringify(launch));
  }
  // Nothing was made where the home will be.
  for (const path of absent) assert.equal(existsSync(path), false, `${path} was not made`);
});

test("no trust setting: E_BACKEND_TRUST, needs-configuration", async (t) => {
  const { check } = await setup(t);
  const answer = await check({ trust: undefined });
  assert.equal(answer.result.status, "needs-configuration");
  assert.deepEqual(codes(answer), ["E_BACKEND_TRUST"]);
  assert.match(answer.result.problems[0].message, /single-user.*container/);
});

test("a trust value that is neither word: E_BACKEND_TRUST", async (t) => {
  const { check } = await setup(t);
  assert.deepEqual(codes(await check({ trust: "everyone" })), ["E_BACKEND_TRUST"]);
});

test("no version pin (a kernel that merged no manifest default): E_BACKEND_VERSION", async (t) => {
  const { check } = await setup(t);
  const answer = await check({ version: undefined });
  assert.deepEqual(codes(answer), ["E_BACKEND_VERSION"]);
  assert.equal(answer.result.status, "needs-configuration");
});

test("bb is another version than the pin: E_BACKEND_VERSION naming both", async (t) => {
  const { check } = await setup(t, { "--version": { stdout: "0.50.2\n" } });
  const answer = await check();
  assert.deepEqual(codes(answer), ["E_BACKEND_VERSION"]);
  assert.match(answer.result.problems[0].message, /bb is 0\.50\.2.*pins 0\.50\.1/);
});

test("a version that only starts like the pin is another version", async (t) => {
  const { check } = await setup(t, { "--version": { stdout: "0.50.10\n" } });
  assert.deepEqual(codes(await check()), ["E_BACKEND_VERSION"]);
});

test("no bb CLI: E_BACKEND_VERSION says the version could not be read", async (t) => {
  const { dir, backend, bb } = await setup(t);
  const answer = await call("check", { home: null, soul: "dev" }, { settings: backend.settings(), bb: { cli: join(dir, "no-such-bb"), env: bb.env } });
  assert.ok(codes(answer).includes("E_BACKEND_VERSION"));
  assert.match(answer.result.problems.find((p) => p.code === "E_BACKEND_VERSION").message, /could not be read/);
});

test("a server setting off loopback: E_BACKEND_EXPOSED, and bb's server is never asked", async (t) => {
  const { check, backend } = await setup(t);
  const answer = await check({ server: "http://192.0.2.10:38886" });
  assert.ok(codes(answer).includes("E_BACKEND_EXPOSED"));
  assert.match(answer.result.problems.find((p) => p.code === "E_BACKEND_EXPOSED").message, /192\.0\.2\.10.*not loopback/);
  assert.deepEqual(backend.requests, []);
});

test("a daemon setting off loopback: E_BACKEND_EXPOSED", async (t) => {
  const { check } = await setup(t);
  assert.ok(codes(await check({ daemon: "http://bb.example.net:38887" })).includes("E_BACKEND_EXPOSED"));
});

for (const bad of ["not a url", "ftp://127.0.0.1:38886", "http://user:pw@127.0.0.1:38886", "http://127.0.0.1:38886/api"]) {
  test(`a server setting ${JSON.stringify(bad)}: E_BACKEND_SETTINGS`, async (t) => {
    const { check } = await setup(t);
    assert.ok(codes(await check({ server: bad })).includes("E_BACKEND_SETTINGS"));
  });
}

// A URL may carry a user and a password: a refused one is described, never repeated.
for (const bad of ["http://dummy-user:dummy-pass-71@127.0.0.1:38886", "ftp://dummy-user:dummy-pass-71@127.0.0.1:38886", "dummy-user:dummy-pass-71@ 127.0.0.1", "http://127.0.0.1:38886/?token=dummy-pass-71"]) {
  test(`a refused server or daemon setting is never repeated in the check's answer or in doctor's output: ${JSON.stringify(bad)}`, async (t) => {
    const { backend, bb, check } = await setup(t);
    for (const key of ["server", "daemon"]) {
      const answer = await check({ [key]: bad });
      assert.ok(codes(answer).includes("E_BACKEND_SETTINGS"));
      assert.doesNotMatch(JSON.stringify(answer), /dummy-user|dummy-pass-71/);
      for (const args of [["doctor"], ["doctor", "--json"]]) {
        const run = await runBin(args, { env: { ...bb.env, OATS_SETTINGS: JSON.stringify({ ...backend.settings({ [key]: bad }), cli: bb.cli }) } });
        assert.equal(run.status, 1);
        assert.match(run.stdout, /E_BACKEND_SETTINGS/);
        assert.doesNotMatch(run.stdout + run.stderr, /dummy-user|dummy-pass-71/);
      }
    }
  });
}

test("bb's server down: E_BACKEND_UNREACHABLE, unavailable (not a configuration verdict)", async (t) => {
  const { check } = await setup(t);
  const answer = await check({ server: `http://127.0.0.1:${await deadPort(t)}` });
  assert.deepEqual(codes(answer), ["E_BACKEND_UNREACHABLE"]);
  assert.equal(answer.result.status, "unavailable");
});

test("a /health that is not ok: E_BACKEND_UNREACHABLE", async (t) => {
  const { check } = await setup(t, {}, { health: { ok: false } });
  assert.deepEqual(codes(await check()), ["E_BACKEND_UNREACHABLE"]);
});

test("the server answers but the host daemon is down: E_BACKEND_UNREACHABLE naming the daemon", async (t) => {
  const { check } = await setup(t);
  const answer = await check({ daemon: `http://127.0.0.1:${await deadPort(t)}` });
  assert.deepEqual(codes(answer), ["E_BACKEND_UNREACHABLE"]);
  assert.match(answer.result.problems[0].message, /host daemon/);
});

test("a host daemon not connected yet: E_BACKEND_NOT_READY, unavailable", async (t) => {
  const { check } = await setup(t, {}, { daemonStatus: { hostId: "host_1", connected: false } });
  const answer = await check();
  assert.deepEqual(codes(answer), ["E_BACKEND_NOT_READY"]);
  assert.equal(answer.result.status, "unavailable");
});

test("a server set as localhost is the server the daemon reports as 127.0.0.1: between loopback names the port decides", async (t) => {
  const { check, backend } = await setup(t);
  const answer = await check({ server: `http://localhost:${backend.serverPort}` });
  assert.deepEqual({ ...answer.result, warnings: answer.result.warnings.map((w) => w.code) }, { status: "ready", problems: [], warnings: ["session-provider-full-mode-only"] }, JSON.stringify(answer.result));
});

test("a host daemon that serves another bb server: E_BACKEND_NOT_READY", async (t) => {
  const { check } = await setup(t, {}, { daemonStatus: { hostId: "host_1", connected: true, serverUrl: "http://127.0.0.1:1" } });
  const answer = await check();
  assert.deepEqual(codes(answer), ["E_BACKEND_NOT_READY"]);
  assert.match(answer.result.problems[0].message, /serves http:\/\/127\.0\.0\.1:1/);
});

test("a host daemon that names this server's port under another scheme serves another server: the port alone does not make it the same", async (t) => {
  const { backend, check } = await setup(t);
  backend.state.daemonStatus = { hostId: "host_1", connected: true, serverUrl: `https://localhost:${backend.serverPort}` };
  const answer = await check();
  assert.equal(answer.result.status, "needs-configuration");
  assert.deepEqual(codes(answer), ["E_BACKEND_NOT_READY"]);
  assert.match(answer.result.problems[0].message, new RegExp(`serves https://localhost:${backend.serverPort}, not settings\\.oats\\.bb\\.server http://127`));
  // The same scheme under another loopback name is the same server.
  backend.state.daemonStatus = { hostId: "host_1", connected: true, serverUrl: `http://localhost:${backend.serverPort}/` };
  assert.deepEqual(codes(await check()), []);
});

for (const [word, status] of [["unauthenticated", "authorization-required"], ["expired", "authorization-required"], ["not_installed", "needs-configuration"], ["unsupported_version", "needs-configuration"], ["unknown", "unavailable"], ["a_word_bb_adds_later", "unavailable"]]) {
  test(`bb reports claude-code as ${word}: E_BACKEND_NOT_READY naming bb's word, ${status}`, async (t) => {
    const { check, backend } = await setup(t);
    backend.state.provider.status = word;
    const answer = await check();
    assert.deepEqual(codes(answer), ["E_BACKEND_NOT_READY"]);
    assert.match(answer.result.problems[0].message, new RegExp(`claude-code provider as ${word}`));
    assert.equal(answer.result.status, status);
  });
}

test("bb reports no claude-code provider at all: E_BACKEND_NOT_READY", async (t) => {
  const { check, backend } = await setup(t);
  backend.state.provider = null;
  assert.deepEqual(codes(await check()), ["E_BACKEND_NOT_READY"]);
});

test("bb's provider state cannot be read: E_BACKEND_NOT_READY, unavailable", async (t) => {
  const { check, backend } = await setup(t);
  backend.state.providerHttpStatus = 500;
  const answer = await check();
  assert.deepEqual(codes(answer), ["E_BACKEND_NOT_READY"]);
  assert.equal(answer.result.status, "unavailable");
});

test("a bb that hangs gets its named problems inside the check's own time, which is inside the kernel's 20 s", async (t) => {
  const { dir } = scratch(t);
  // A server whose /health answers and whose provider state never does; a daemon that never answers.
  const hang = (answerHealth) => new Promise((done) => {
    const server = createServer((req, res) => { if (answerHealth && req.url === "/health") { res.writeHead(200, { "content-type": "application/json" }); res.end('{"ok":true}'); } });
    server.listen(0, "127.0.0.1", () => { t.after(() => new Promise((closed) => { server.closeAllConnections(); server.close(closed); })); done(`http://127.0.0.1:${server.address().port}`); });
  });
  const bb = fakeBbIn(dir, { "--version": { stdout: `${VERSION}\n` }, "project list": { stdout: [] }, "thread list": { stdout: [] } });
  const settings = { server: await hang(true), daemon: await hang(false), version: VERSION, trust: "single-user" };
  const started = Date.now();
  const answer = await call("check", { home: null, soul: "dev" }, { settings, bb });
  const took = Date.now() - started;
  assert.ok(took < 19_500, `answered in ${took} ms, inside the kernel's 20 s`);
  assert.deepEqual(codes(answer), ["E_BACKEND_UNREACHABLE", "E_BACKEND_NOT_READY"]);
  assert.match(answer.result.problems[0].message, /host daemon.*no answer within/);
  assert.equal(answer.result.status, "unavailable");
});

test("configuration problems outrank what cannot be told now", async (t) => {
  const { check, backend } = await setup(t);
  backend.state.provider.status = "unknown";
  const answer = await check({ trust: undefined });
  assert.deepEqual(codes(answer), ["E_BACKEND_TRUST", "E_BACKEND_NOT_READY"]);
  assert.equal(answer.result.status, "needs-configuration");
});

test("a live thread whose project root is gone is reported as session-provider-orphaned, naming ids and root", async (t) => {
  const { check } = await setup(t, (home, dir) => ({
    "project list": { stdout: [projectRow("proj_a", home), projectRow("proj_gone", join(dir, "retired-home"))] },
    "thread list": { stdout: [threadRow("thr_a", "proj_a", "idle"), threadRow("thr_left", "proj_gone", "idle"), threadRow("thr_left2", "proj_gone", "error"), threadRow("thr_archived", "proj_gone", "idle", { archivedAt: 4 })] },
  }));
  const answer = await check();
  assert.equal(answer.result.status, "ready", "a report, not a problem");
  assert.deepEqual(answer.result.warnings.map((w) => w.code), ["session-provider-orphaned", "session-provider-full-mode-only"]);
  const [warning] = answer.result.warnings;
  assert.equal(warning.code, "session-provider-orphaned");
  assert.match(warning.message, /thr_left, thr_left2/);
  assert.match(warning.message, /retired-home/);
  assert.doesNotMatch(warning.message, /thr_archived|thr_a\b/);
});

// A bb whose own lists cannot be read cannot be used (a launch reads them first): not
// ready, whatever else answered. A malformed read is never "ready".
for (const [name, script] of [["cannot be reached for its threads", { "thread list": UNREACHABLE }], ["answers a thread row that cannot be read", { "thread list": { stdout: [{ id: "thr_x" }] } }], ["answers a project row that cannot be read", { "project list": { stdout: [null] } }], ["answers a thread whose archive mark is a word", { "thread list": { stdout: [threadRow("thr_a", "proj_a", "idle", { archivedAt: "not-a-timestamp" })] } }]]) {
  test(`a bb that ${name} is not ready: E_BACKEND_NOT_READY, unavailable`, async (t) => {
    const { check } = await setup(t, script);
    const answer = await check();
    assert.equal(answer.result.status, "unavailable");
    assert.deepEqual(codes(answer), ["E_BACKEND_NOT_READY"]);
    assert.match(answer.result.problems[0].message, /could not be read, so this bb cannot be used/);
  });
}


for (const [name, daemonStatus] of [["with no connected field", { hostId: "host_1" }], ["whose connected is not a boolean", { connected: "yes" }], ["that is a list", [true]],
  ["that is connected and names no server", { hostId: "host_1", connected: true }], ["whose serverUrl is a number", { connected: true, serverUrl: 42 }], ["whose serverUrl is no URL", { connected: true, serverUrl: "over there" }], ["whose serverUrl is no http address", { connected: true, serverUrl: "ftp://127.0.0.1:38886" }]]) {
  test(`a host daemon /status ${name} is not ready, never ready`, async (t) => {
    const { check } = await setup(t, {}, { daemonStatus });
    const answer = await check();
    assert.deepEqual(codes(answer), ["E_BACKEND_NOT_READY"]);
    assert.equal(answer.result.status, "unavailable");
  });
}

for (const [name, raw] of [["that is not JSON", "<html>bb</html>"], ["larger than the provider reads", `{"providers":[{"providerId":"claude-code","status":"ready","pad":"${"x".repeat(300_000)}"}]}`], ["whose providers is not a list", '{"providers":{"claude-code":"ready"}}'], ["whose status is not a word", '{"providers":[{"providerId":"claude-code","status":true}]}']]) {
  test(`a provider state ${name} is not ready, never ready`, async (t) => {
    const { check, backend } = await setup(t);
    backend.state.providerRaw = raw;
    const answer = await check();
    assert.deepEqual(codes(answer), ["E_BACKEND_NOT_READY"]);
    assert.equal(answer.result.status, "unavailable");
  });
}

test("settings that are not a map are refused on the wire", async (t) => {
  const { bb } = await setup(t);
  const answer = await call("check", { home: null, soul: "dev" }, { settings: { version: 50 }, bb });
  assert.equal(answer.ok, false);
  assert.equal(answer.error.code, "E_BACKEND_SETTINGS");
});

test("where bubblewrap is missing readiness warns that bb's sandboxed modes wait for a person: a warning, never a refusal", async (t) => {
  const { backend, bb } = await setup(t);
  const check = (settings) => call("check", { home: null, soul: "dev" }, { settings: backend.settings(settings), bb, env: { PATH: PATH_WITHOUT_BWRAP } });
  const container = await check({ trust: "container" });
  assert.equal(container.result.status, "ready");
  assert.deepEqual(container.result.problems, []);
  assert.deepEqual(container.result.warnings.map((w) => w.code), ["session-provider-sandbox-unsupported", "session-provider-full-mode-only"]);
  assert.match(container.result.warnings[0].message, /every command waits for a person in bb\. In a team container, spawn bb agents with --yolo \(bb full mode\): the container is the boundary/);
  const single = await check({ trust: "single-user" });
  assert.match(single.result.warnings[0].message, /Install bubblewrap, or spawn bb agents with --yolo/);
  // With bubblewrap on PATH nothing is said (every other test runs so).
  assert.deepEqual((await call("check", { home: null, soul: "dev" }, { settings: backend.settings(), bb })).result.warnings.map((w) => w.code), ["session-provider-full-mode-only"]);
  assert.equal(sandboxCanStart({ platform: "darwin", path: "" }), true, "only Linux needs bubblewrap");
  assert.equal(sandboxCanStart({ platform: "linux", path: "" }), false);
});

// Node 20's fetch never settles when the other side drops the connection as it accepts it, and a wait that
// nothing keeps alive ends the process with status 0 and no answer, which the kernel would
// read as a failed call with no reason. The fetch here is replaced by one that does the
// same on every Node (test/fixtures/hanging-fetch.mjs).
const withFetch = (mode) => ({ NODE_OPTIONS: `--import=${new URL("../fixtures/hanging-fetch.mjs", import.meta.url).href}`, OATS_BB_TEST_FETCH: mode });

test("a read of bb that never settles is ended by the provider's own time limit: a named problem, never an exit with no answer", async (t) => {
  const { backend, bb } = await setup(t);
  const answer = await call("check", { home: null, soul: null }, { settings: backend.settings(), bb, env: withFetch("abortable") });
  assert.deepEqual(codes(answer), ["E_BACKEND_UNREACHABLE"]);
  assert.match(answer.result.problems[0].message, /no answer within 4 s/);
  assert.equal(answer.result.status, "unavailable");
});

test("a provider that runs out of work before it has an answer exits nonzero and says so: never status 0 with nothing", async (t) => {
  const { backend, bb } = await setup(t);
  const env = { ...bb.env, OATS_CAPABILITY: "oats.bb", OATS_BACKEND: "bb", OATS_SETTINGS: JSON.stringify({ ...backend.settings(), cli: bb.cli }), ...withFetch("deaf") };
  const run = await runBin(["session", "check"], { stdin: JSON.stringify(requestFor("check", { home: null, soul: null })), env });
  assert.equal(run.status, 1);
  assert.equal(run.stdout, "");
  assert.match(run.stderr, /ended before it had an answer/);
  const doctor = await runBin(["doctor"], { env });
  assert.equal(doctor.status, 1);
  assert.match(doctor.stderr, /ended before it had an answer/);
});

test("oats bb doctor takes --soul, which the kernel reads and forwards; nothing else", async (t) => {
  const { backend, bb } = await setup(t);
  const env = { ...bb.env, OATS_SETTINGS: JSON.stringify({ ...backend.settings(), cli: bb.cli }) };
  for (const args of [["--soul", "dev"], ["--soul=acme/dev", "--json"], ["--json", "--soul", "dev"]]) {
    const run = await runBin(["doctor", ...args], { env });
    assert.equal(run.status, 0, `${args.join(" ")}: ${run.stderr}`);
    assert.match(run.stdout, args.includes("--json") ? /^\{"status":"ready"/ : /^bb session provider: ready/);
  }
  // --dir is not one of them: the kernel does not read it for a capability's command, so
  // accepting it would report another deployment's bb than the one asked for.
  for (const args of [["--soul"], ["--verbose"], ["--soul", "--json"], ["extra"], ["--dir", "/srv/acme"], ["--dir=/srv/acme"]]) {
    const run = await runBin(["doctor", ...args], { env });
    assert.equal(run.status, 2, args.join(" "));
    assert.match(run.stderr, /unknown command/);
  }
});

test("oats bb doctor prints the same findings for a person, names where the credential comes from, never a value", async (t) => {
  const { backend, bb } = await setup(t);
  const env = (settings) => ({ ...bb.env, OATS_SETTINGS: JSON.stringify({ ...backend.settings(settings), cli: bb.cli }) });
  const ready = await runBin(["doctor"], { env: env() });
  assert.equal(ready.status, 0);
  assert.match(ready.stdout, /^bb session provider: ready\n  host daemon port: \d+ \(settings\.oats\.bb\.hostDaemonPort\)\n  warning session-provider-full-mode-only: the bb backend launches in bb's full mode only \(sandboxed modes are not offered\): .*\n  claude-code credential: no Claude login: a credential in bb's own configuration or in the bb server's environment\n$/);
  backend.state.provider.accountEmail = "person@example.com";
  const login = await runBin(["doctor", "--json"], { env: env() });
  assert.equal(login.doc.credential, "a Claude login of bb's user");
  assert.doesNotMatch(login.stdout, /person@example\.com/);
  const not = await runBin(["doctor", "--json"], { env: env({ trust: undefined }) });
  assert.equal(not.status, 1);
  assert.deepEqual(not.doc.problems.map((p) => p.code), ["E_BACKEND_TRUST"]);
});

// Exposure: the provider asks the network whether bb's port answers off loopback.
test("loopback hosts are 127.0.0.0/8, ::1 and localhost, and nothing else", () => {
  for (const host of ["127.0.0.1", "127.9.8.7", "localhost", "LOCALHOST", "[::1]"]) assert.equal(isLoopbackHost(host), true, host);
  for (const host of ["0.0.0.0", "192.168.1.5", "127.0.0.1.example.com", "1270.0.0.1", "127.0.0.256", "[::]", "example.com", "100.64.0.1"]) assert.equal(isLoopbackHost(host), false, host);
  assert.equal(loopbackOrigin("http://localhost:38886/", "server"), "http://localhost:38886");
});

test("the addresses probed are every one that is not loopback, link-local IPv6 with its interface", () => {
  const addresses = nonLoopbackAddresses({
    lo: [{ address: "127.0.0.1", family: "IPv4", internal: true }, { address: "::1", family: "IPv6", internal: true }],
    eth0: [{ address: "192.0.2.4", family: "IPv4", internal: false }, { address: "fe80::1", family: "IPv6", internal: false }, { address: "2001:db8::4", family: 6, internal: false }],
  });
  assert.deepEqual(addresses.map((a) => a.host), ["192.0.2.4", "fe80::1%eth0", "2001:db8::4"]);
});

test("a port that answers on an address off loopback is named; one that does not is not", async () => {
  const interfaces = { eth0: [{ address: "192.0.2.4", family: "IPv4", internal: false }, { address: "2001:db8::4", family: "IPv6", internal: false }] };
  const probed = [];
  const probe = async (host, port) => { probed.push(`${host}:${port}`); return host === "2001:db8::4" && port === 38886; };
  assert.deepEqual(await exposedListeners([38886, 38887, 38886], { interfaces, probe }), ["[2001:db8::4]:38886"]);
  assert.equal(probed.length, 4, "each address and port once");
  assert.deepEqual(await exposedListeners([38886], { interfaces: { lo: [{ address: "127.0.0.1", family: "IPv4", internal: true }] }, probe }), []);
});

test("a real listener: accepts() is true where something listens, false where nothing does", async (t) => {
  const server = createServer();
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  t.after(() => new Promise((done) => server.close(done)));
  assert.equal(await accepts("127.0.0.1", server.address().port, 4), true);
  // Port 1 (tcpmux) needs root to listen on and nothing does: a connection there is refused.
  assert.equal(await accepts("127.0.0.1", 1, 4), false);
});

const offLoopback = nonLoopbackAddresses(networkInterfaces()).find((a) => a.family === 4);
test("a bb server bound to every address is E_BACKEND_EXPOSED, naming where it answers", { skip: offLoopback ? false : "this machine has no IPv4 address off loopback; test/contract T7 proves it against the real bb" }, async (t) => {
  const { check, backend } = await setup(t, {}, { bindHost: "0.0.0.0" });
  const answer = await check();
  assert.deepEqual(codes(answer), ["E_BACKEND_EXPOSED"]);
  assert.match(answer.result.problems[0].message, new RegExp(`${offLoopback.address.replaceAll(".", "\\.")}:${backend.serverPort}`));
  assert.equal(answer.result.status, "needs-configuration");
});

test("settings: defaults, and shapes that are refused", () => {
  assert.deepEqual(readSettings(undefined), { server: "http://127.0.0.1:38886", daemon: "http://127.0.0.1:38887", daemonKey: "daemon", hostDaemonPort: null, version: null, trust: null, cli: "bb", dataDir: join(homedir(), ".bb"), piAgentDir: join(homedir(), ".pi", "agent") });
  assert.deepEqual(readSettings({ cli: "/opt/bb/bin/bb", version: "0.50.1", trust: "container", dataDir: "/srv/bb/", piAgentDir: "/srv/pi-agent/" }), { server: "http://127.0.0.1:38886", daemon: "http://127.0.0.1:38887", daemonKey: "daemon", hostDaemonPort: null, version: "0.50.1", trust: "container", cli: "/opt/bb/bin/bb", dataDir: "/srv/bb", piAgentDir: "/srv/pi-agent" });
  assert.throws(() => readSettings([]), { code: "E_BACKEND_SETTINGS" });
  assert.throws(() => readSettings({ cli: "./bb" }), { code: "E_BACKEND_SETTINGS" });
  assert.throws(() => readSettings({ server: 38886 }), { code: "E_BACKEND_SETTINGS" });
  // bb's data directory is read only by a launch in a sandboxed mode, which checks its
  // shape there: a wrong value holds up no other verb. A value that is no string is a shape.
  assert.equal(readSettings({ dataDir: "bbdata" }).dataDir, "bbdata");
  assert.throws(() => readSettings({ dataDir: 7 }), { code: "E_BACKEND_SETTINGS" });
});
