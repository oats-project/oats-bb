// Readiness (contract items 6a, 7, 8): the provider's `check` verb, whose result the kernel
// relays as a readiness providers item, and the same checks a launch runs first.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { networkInterfaces } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { accepts, exposedListeners, nonLoopbackAddresses } from "../../oats-package/capabilities/oats-bb/lib/exposure.mjs";
import { sandboxCanStart } from "../../oats-package/capabilities/oats-bb/lib/readiness.mjs";
import { isLoopbackHost, loopbackOrigin, readSettings } from "../../oats-package/capabilities/oats-bb/lib/settings.mjs";
import { PATH_WITHOUT_BWRAP, UNREACHABLE, VERSION, call, closedPort, fakeBackend, fakeBbIn, projectRow, requestFor, runBin, scratch, threadRow } from "../fixtures/harness.mjs";


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
  assert.deepEqual(answer, { schemaVersion: 1, phase: "session", capability: "oats.bb", provider: "bb", verb: "check", ok: true, result: { status: "ready", problems: [], warnings: [] } });
  assert.equal(bb.calls().every((c) => c.server === backend.server), true);
  assert.deepEqual(backend.requests, ["/health", "/api/v1/system/providers/state?providerId=claude-code"]);
  assert.deepEqual(backend.daemonRequests, ["/status"]);
});

test("for a soul (no home) the check takes the settings from its input", async (t) => {
  const { backend, bb } = await setup(t);
  const run = await runBin(["session", "check"], { stdin: JSON.stringify(requestFor("check", { home: null, soul: "dev", settings: { ...backend.settings({ trust: "everyone" }), cli: bb.cli } })), env: bb.env });
  assert.equal(run.status, 0);
  assert.deepEqual(run.doc.result.problems.map((p) => p.code), ["E_BACKEND_TRUST"]);
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

test("bb's server down: E_BACKEND_UNREACHABLE, unavailable (not a configuration verdict)", async (t) => {
  const { check } = await setup(t);
  const answer = await check({ server: `http://127.0.0.1:${await closedPort()}` });
  assert.deepEqual(codes(answer), ["E_BACKEND_UNREACHABLE"]);
  assert.equal(answer.result.status, "unavailable");
});

test("a /health that is not ok: E_BACKEND_UNREACHABLE", async (t) => {
  const { check } = await setup(t, {}, { health: { ok: false } });
  assert.deepEqual(codes(await check()), ["E_BACKEND_UNREACHABLE"]);
});

test("the server answers but the host daemon is down: E_BACKEND_UNREACHABLE naming the daemon", async (t) => {
  const { check } = await setup(t);
  const answer = await check({ daemon: `http://127.0.0.1:${await closedPort()}` });
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
  assert.deepEqual(answer.result, { status: "ready", problems: [], warnings: [] }, JSON.stringify(answer.result));
});

test("a host daemon that serves another bb server: E_BACKEND_NOT_READY", async (t) => {
  const { check } = await setup(t, {}, { daemonStatus: { hostId: "host_1", connected: true, serverUrl: "http://127.0.0.1:1" } });
  const answer = await check();
  assert.deepEqual(codes(answer), ["E_BACKEND_NOT_READY"]);
  assert.match(answer.result.problems[0].message, /serves http:\/\/127\.0\.0\.1:1/);
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
  assert.ok(took < 17_000, `answered in ${took} ms`);
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
  assert.equal(answer.result.warnings.length, 1);
  const [warning] = answer.result.warnings;
  assert.equal(warning.code, "session-provider-orphaned");
  assert.match(warning.message, /thr_left, thr_left2/);
  assert.match(warning.message, /retired-home/);
  assert.doesNotMatch(warning.message, /thr_archived|thr_a\b/);
});

test("when bb's threads cannot be listed, the check says orphans were not looked for", async (t) => {
  const { check } = await setup(t, { "thread list": UNREACHABLE });
  const answer = await check();
  assert.deepEqual(answer.result.warnings.map((w) => w.code), ["session-provider-orphans-unchecked"]);
});

for (const [name, daemonStatus] of [["with no connected field", { hostId: "host_1" }], ["whose connected is not a boolean", { connected: "yes" }], ["that is a list", [true]]]) {
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
  assert.deepEqual(container.result.warnings.map((w) => w.code), ["session-provider-sandbox-unsupported"]);
  assert.match(container.result.warnings[0].message, /every command waits for a person in bb\. In a team container, spawn bb agents with --yolo \(bb full mode\): the container is the boundary/);
  const single = await check({ trust: "single-user" });
  assert.match(single.result.warnings[0].message, /Install bubblewrap, or spawn bb agents with --yolo/);
  // With bubblewrap on PATH nothing is said (every other test runs so).
  assert.deepEqual((await call("check", { home: null, soul: "dev" }, { settings: backend.settings(), bb })).result.warnings, []);
  assert.equal(sandboxCanStart({ platform: "darwin", path: "" }), true, "only Linux needs bubblewrap");
  assert.equal(sandboxCanStart({ platform: "linux", path: "" }), false);
});

test("oats bb doctor takes the kernel's own selectors, which change nothing here: --soul and --dir", async (t) => {
  const { backend, bb } = await setup(t);
  const env = { ...bb.env, OATS_SETTINGS: JSON.stringify({ ...backend.settings(), cli: bb.cli }) };
  for (const args of [["--soul", "dev"], ["--soul=acme/dev", "--json"], ["--json", "--dir", "/srv/acme", "--soul", "dev"]]) {
    const run = await runBin(["doctor", ...args], { env });
    assert.equal(run.status, 0, `${args.join(" ")}: ${run.stderr}`);
    assert.match(run.stdout, args.includes("--json") ? /^\{"status":"ready"/ : /^bb session provider: ready/);
  }
  for (const args of [["--soul"], ["--verbose"], ["--soul", "--json"], ["extra"]]) {
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
  assert.equal(ready.stdout, "bb session provider: ready\n  claude-code credential: no Claude login: a credential in bb's own configuration or in the bb server's environment\n");
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
  assert.equal(await accepts("127.0.0.1", await closedPort(), 4), false);
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
  assert.deepEqual(readSettings(undefined), { server: "http://127.0.0.1:38886", daemon: "http://127.0.0.1:38887", version: null, trust: null, cli: "bb" });
  assert.deepEqual(readSettings({ cli: "/opt/bb/bin/bb", version: "0.50.1", trust: "container" }), { server: "http://127.0.0.1:38886", daemon: "http://127.0.0.1:38887", version: "0.50.1", trust: "container", cli: "/opt/bb/bin/bb" });
  assert.throws(() => readSettings([]), { code: "E_BACKEND_SETTINGS" });
  assert.throws(() => readSettings({ cli: "./bb" }), { code: "E_BACKEND_SETTINGS" });
  assert.throws(() => readSettings({ server: 38886 }), { code: "E_BACKEND_SETTINGS" });
});
