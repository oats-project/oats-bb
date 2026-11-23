// settings.oats.bb.hostDaemonPort (contract A23): bb's CLI finds the host daemon of the
// machine it runs on by BB_HOST_DAEMON_PORT alone, never from BB_SERVER_URL. With a second
// bb on one host, on other ports, every bb command the provider runs must be told that
// bb's daemon port, or `bb project create` goes to another bb's daemon (refused: "Host not
// found") or to nobody's. test/contract pins that against real bb; here, what the provider
// passes, what it refuses, and what it says.
import assert from "node:assert/strict";
import { chmodSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { bbClient, runBb } from "../../oats-package/capabilities/oats-bb/lib/bb.mjs";
import { readSettings } from "../../oats-package/capabilities/oats-bb/lib/settings.mjs";
import { VERSION, call, capabilityDir, deadPort, fakeBackend, fakeBbIn, projectRow, runBin, scratch, threadRow } from "../fixtures/harness.mjs";

const KEY = /settings\.oats\.bb\.hostDaemonPort/;

/** A `bb` that answers its own environment and arguments as JSON: what a call is given. */
function echoBb(dir) {
  const cli = join(dir, "echo-bb");
  writeFileSync(cli, `#!${process.execPath}\nprocess.stdout.write(JSON.stringify({ env: process.env, argv: process.argv.slice(2) }));\n`);
  chmodSync(cli, 0o755);
  return cli;
}

test("unset: the call is told no port, and one the caller's environment carries does not reach bb; everything else is the caller's, and the arguments are the same", async (t) => {
  const { dir } = scratch(t);
  const cli = echoBb(dir);
  const caller = { PATH: process.env.PATH, HOME: "/home/someone", SOME_VARIABLE: "kept", BB_THREAD_ID: "thr_x", BB_PROJECT_ID: "proj_x", BB_ENVIRONMENT_ID: "env_x", BB_SERVER_URL: "http://127.0.0.1:1" };
  const given = async (env, options = {}) => (await runBb(cli, ["thread", "list", "--json"], { server: "http://127.0.0.1:38886", env, ...options })).value;
  // bb's context variables go, the server is set, and everything else is as it was.
  const { BB_THREAD_ID, BB_PROJECT_ID, BB_ENVIRONMENT_ID, ...rest } = caller;
  const plain = await given(caller);
  assert.deepEqual(plain.env, { ...rest, BB_SERVER_URL: "http://127.0.0.1:38886" });
  assert.equal(Object.hasOwn(plain.env, "BB_HOST_DAEMON_PORT"), false, "the provider sets none");
  assert.deepEqual(plain.argv, ["thread", "list", "--json"]);
  for (const unset of [{}, { hostDaemonPort: null }, { hostDaemonPort: undefined }]) assert.deepEqual(await given(caller, unset), plain);
  // A port the caller's own environment carries is stripped, as its BB_SERVER_URL is: which
  // bb a call is for is the settings' to say, and a caller that exported another bb's port
  // must never be paired with this deployment's server.
  for (const exported of ["40123", "38887", "", "not a port"]) {
    const stripped = await given({ ...caller, BB_HOST_DAEMON_PORT: exported });
    assert.deepEqual(stripped, plain, `BB_HOST_DAEMON_PORT=${JSON.stringify(exported)} in the caller's environment`);
  }
  // The same through the client, as every verb makes its calls.
  const client = bbClient({ cli, server: "http://127.0.0.1:38886", hostDaemonPort: readSettings({}).hostDaemonPort, env: { ...caller, BB_HOST_DAEMON_PORT: "40123" } });
  assert.deepEqual((await client.raw(["project", "list", "--json"])).value.env, plain.env);
});

test("set: the call is told the setting's port, whatever the caller's environment carried, and nothing else changes", async (t) => {
  const { dir } = scratch(t);
  const cli = echoBb(dir);
  for (const exported of [undefined, "40123", "39012"]) {
    const caller = { PATH: process.env.PATH, SOME_VARIABLE: "kept", ...(exported === undefined ? {} : { BB_HOST_DAEMON_PORT: exported }) };
    const told = (await runBb(cli, ["project", "create", "--json"], { server: "http://127.0.0.1:39011", hostDaemonPort: 39012, env: caller })).value;
    assert.deepEqual(told.env, { PATH: process.env.PATH, SOME_VARIABLE: "kept", BB_SERVER_URL: "http://127.0.0.1:39011", BB_HOST_DAEMON_PORT: "39012" }, `the setting wins over ${JSON.stringify(exported)}`);
    assert.deepEqual(told.argv, ["project", "create", "--json"]);
    const client = bbClient({ cli, server: "http://127.0.0.1:39011", hostDaemonPort: 39012, env: caller });
    assert.equal((await client.raw(["thread", "list", "--json"])).value.env.BB_HOST_DAEMON_PORT, "39012");
  }
});

/** A fake bb and backend, and a home whose settings name the backend's own daemon port
 *  (`port`: "its own") or none (null: the daemon's address is given instead, as before the key). */
async function deployment(t, port, exported = {}) {
  const { dir, home } = scratch(t);
  const backend = await fakeBackend(t);
  const bb = fakeBbIn(dir, {
    "--version": { stdout: `${VERSION}\n` },
    "project list": { stdout: [projectRow("proj_a", home)] },
    "thread list": { stdout: [threadRow("thr_a", "proj_a", "idle", { createdAt: 1 })] },
    "thread show": { stdout: { thread: threadRow("thr_a", "proj_a", "idle"), environment: null, pendingTodos: null } },
    "thread stop": { stdout: { ok: true } }, "thread archive": { stdout: { ok: true } },
    "thread interactions list": { stdout: [] },
    "thread tell": { stdout: { threadId: "thr_a", ok: true, delivery: "sent", messageSequence: 2, mode: "auto" } },
    "thread spawn": { stdout: { id: "thr_new", projectId: "proj_a", environmentId: null, providerId: "claude-code", status: "starting" } },
  });
  // The daemon's address follows the port where only the port is given: the fake daemon's own, or none.
  const settings = { ...backend.settings({ daemon: undefined }), ...(port === null ? { daemon: backend.daemon } : { hostDaemonPort: backend.daemonPort }) };
  const endpoint = { server: backend.server, projectId: "proj_a", threadId: "thr_a" };
  const hookEnv = { ...bb.env, OATS_INSTANCE_HOME: home, OATS_SETTINGS: JSON.stringify({ ...settings, cli: bb.cli }) };
  const launchInput = { home, instance: "dev-a", harness: "claude", model: "claude-opus-5-5", yolo: true, env: [{ name: "OATS_INSTANCE", value: "dev-a", source: "kernel" }, { name: "OATS_INSTANCE_HOME", value: home, source: "kernel" }], args: [], promptFile: join(home, "TASK.md"), previous: endpoint };
  /** Every verb, both hooks and the doctor, each as the kernel or a person runs it. → the commands that answered a refusal. */
  const everything = async () => {
    const refused = [];
    for (const [verb, input] of [["check", { home, soul: null }], ["launch", launchInput], ["inspect", { home, endpoint }], ["inspectMany", { homes: [{ home, endpoint }] }],
      ["input", { home, endpoint, text: "hello" }], ["stop", { home, endpoint, graceSeconds: 5 }], ["stop", { home, endpoint: null, graceSeconds: 5, launchSent: "1970-01-01T00:00:00.000Z" }]]) {
      const answer = await call(verb, input, { settings, bb, env: exported });
      if (!answer.ok) refused.push(`${verb}: ${answer.error.code} ${answer.error.message}`);
    }
    for (const args of [["retire-hook"], ["launch-hook"], ["doctor"]]) {
      const run = await runBin(args, { env: { ...hookEnv, ...exported, ...(args[0] === "launch-hook" ? { OATS_BACKEND: "tmux", OATS_PREVIOUS_BACKEND: "bb" } : {}) } });
      if (run.status !== 0) refused.push(`${args[0]}: exit ${run.status} ${run.stdout} ${run.stderr}`);
    }
    return refused;
  };
  return { home, backend, bb, settings, endpoint, hookEnv, everything };
}
const commandsOf = (bb) => [...new Set(bb.calls().map((c) => (c.argv[0] === "--version" ? "--version" : c.argv.filter((word) => !word.startsWith("-")).slice(0, c.argv[1] === "queue" || c.argv[0] === "machine" ? 3 : 2).join(" "))))].sort();

test("set: every bb call of every verb, of both hooks and of the doctor carries the setting's port, whatever the provider's own environment carries", async (t) => {
  const own = await deployment(t, "its own", { BB_HOST_DAEMON_PORT: "40123" });
  assert.deepEqual(await own.everything(), []);
  const calls = own.bb.calls();
  assert.ok(calls.length > 25, `${calls.length} bb calls`);
  assert.deepEqual(calls.filter((c) => c.hostDaemonPort !== String(own.backend.daemonPort)).map((c) => c.argv.join(" ")), [], "a call without the port");
  // The commands the provider runs were all among them: what creates and what reads alike.
  for (const command of ["--version", "project list", "thread list", "thread spawn", "thread stop", "thread show", "thread archive", "thread tell", "thread interactions", "thread queue list", "machine env list", "host list"]) {
    assert.ok(commandsOf(own.bb).includes(command), `${command} was not run: ${commandsOf(own.bb).join(", ")}`);
  }
});

test("unset: no bb call of any verb, hook or the doctor is told a port, also where the provider's own environment carries one", async (t) => {
  for (const exported of [{}, { BB_HOST_DAEMON_PORT: "40123" }]) {
    const d = await deployment(t, null, exported);
    assert.deepEqual(await d.everything(), []);
    const calls = d.bb.calls();
    assert.ok(calls.length > 25, `${calls.length} bb calls`);
    assert.deepEqual(calls.filter((c) => c.hostDaemonPort !== null).map((c) => c.argv.join(" ")), [], JSON.stringify(exported));
    assert.equal(commandsOf(d.bb).includes("host list"), false, "and readiness asks bb's server for its hosts only where the port is set");
  }
});

// What every deployment had before the key: no port. Its launch asks bb exactly what it
// asked then, in the same order (the other unit tests run with a port, as the fake
// backend's daemon is not on bb's default one).
test("unset: a launch runs the same bb commands, in the same order, as before the key", async (t) => {
  const d = await deployment(t, null);
  const launched = await call("launch", { home: d.home, instance: "dev-a", harness: "claude", model: "claude-opus-5-5", yolo: true, env: [{ name: "OATS_INSTANCE", value: "dev-a", source: "kernel" }, { name: "OATS_INSTANCE_HOME", value: d.home, source: "kernel" }], args: [], promptFile: join(d.home, "TASK.md"), previous: d.endpoint }, { settings: d.settings, bb: d.bb });
  assert.equal(launched.ok, true, JSON.stringify(launched));
  const verbs = d.bb.calls().map((c) => (c.argv[0] === "--version" ? "--version" : c.argv[1] === "list" && c.argv.includes("--archived") ? "thread list --archived" : c.argv[0] === "thread" && c.argv[1] === "queue" ? "thread queue list" : c.argv.slice(0, 2).join(" ")));
  // (The home's previous thread is live and at rest: the launch stops it, confirms it and archives it before the spawn. lib/launch.mjs is not changed by the key.)
  assert.deepEqual(verbs, ["--version", "project list", "thread list", "thread list --archived", "thread queue list", "thread stop", "thread show", "thread queue list", "thread show", "thread archive", "machine env", "thread spawn"]);
  assert.deepEqual(d.bb.calls().filter((c) => c.hostDaemonPort !== null), []);
});

test("a value that is no port is refused by every command, naming the key and bb-app's flag: never dropped", async (t) => {
  const { dir, home } = scratch(t);
  const backend = await fakeBackend(t);
  const bb = fakeBbIn(dir, { "--version": { stdout: `${VERSION}\n` }, "project list": { stdout: [] }, "thread list": { stdout: [] } });
  const endpoint = { server: backend.server, projectId: "proj_a", threadId: "thr_a" };
  for (const bad of [0, 65536, "38887", 1.5, -1, -38887, true, [38887], { port: 38887 }, "", 4.0e5]) {
    assert.throws(() => readSettings({ hostDaemonPort: bad }), (error) => error.code === "E_BACKEND_SETTINGS" && KEY.test(error.message) && /--host-daemon-port/.test(error.message) && /1 to 65535/.test(error.message), JSON.stringify(bad));
    const settings = backend.settings({ hostDaemonPort: bad });
    for (const [verb, input] of [["check", { home, soul: null }], ["inspect", { home, endpoint }], ["stop", { home, endpoint, graceSeconds: 1 }], ["input", { home, endpoint, text: "x" }]]) {
      const answer = await call(verb, input, { settings, bb });
      assert.equal(answer.ok, false, `${verb} with ${JSON.stringify(bad)}`);
      assert.equal(answer.error.code, "E_BACKEND_SETTINGS", `${verb} with ${JSON.stringify(bad)}: ${JSON.stringify(answer.error)}`);
      assert.match(answer.error.message, KEY);
    }
    const doctor = await runBin(["doctor"], { env: { ...bb.env, OATS_SETTINGS: JSON.stringify({ ...settings, cli: bb.cli }) } });
    assert.equal(doctor.status, 1);
    assert.match(doctor.stderr, KEY);
  }
  assert.deepEqual(bb.calls(), [], "bb was asked nothing with a setting that could not be read");
  // The ports that are ports, and the two ways to leave it unset.
  for (const good of [1, 80, 38887, 39012, 65535]) assert.equal(readSettings({ hostDaemonPort: good }).hostDaemonPort, good);
  for (const unset of [{}, { hostDaemonPort: null }, { hostDaemonPort: undefined }]) assert.equal(readSettings(unset).hostDaemonPort, null);
});

test("the key is host-only, as `server` is: the kernel takes it from oats-local.yaml alone and refuses it in a committed workspace", () => {
  // The mechanism is the kernel's, by the manifest's word (`hostOnly: true`: a committed or
  // per-spawn value of such a key is refused, E_WORKSPACE_SCHEMA). What this repository
  // owns is that word, the same for the two keys.
  const { settings } = JSON.parse(readFileSync(join(capabilityDir, "oats.json"), "utf8"));
  assert.equal(settings.hostDaemonPort.hostOnly, true);
  assert.equal(settings.server.hostOnly, true);
  assert.equal(Object.hasOwn(settings.hostDaemonPort, "default"), false, "no default: unset tells bb's CLI nothing");
  assert.equal(Object.hasOwn(settings.hostDaemonPort, "committedOnly"), false);
  assert.match(settings.hostDaemonPort.description, /--host-daemon-port/);
  assert.match(settings.hostDaemonPort.description, /Set it only in oats-local\.yaml\.$/);
});

test("the daemon's address follows the port where only the port is set; the two together must name one port", () => {
  assert.deepEqual([readSettings({}).daemon, readSettings({}).daemonKey], ["http://127.0.0.1:38887", null], "neither set: bb's default address, decided by no setting");
  assert.deepEqual([readSettings({ hostDaemonPort: 39012 }).daemon, readSettings({ hostDaemonPort: 39012 }).daemonKey], ["http://127.0.0.1:39012", "hostDaemonPort"]);
  assert.deepEqual([readSettings({ daemon: "http://localhost:39012" }).daemon, readSettings({ daemon: "http://localhost:39012" }).hostDaemonPort], ["http://localhost:39012", null], "a daemon address alone tells bb's CLI nothing, as before the key");
  const both = readSettings({ hostDaemonPort: 39012, daemon: "http://localhost:39012" });
  assert.deepEqual([both.daemon, both.daemonKey, both.hostDaemonPort], ["http://localhost:39012", "daemon", 39012]);
  assert.throws(() => readSettings({ hostDaemonPort: 39012, daemon: "http://127.0.0.1:38887" }), (error) => error.code === "E_BACKEND_SETTINGS" && KEY.test(error.message) && /settings\.oats\.bb\.daemon names port 38887/.test(error.message));
  // A daemon address that is no address is refused where it is used, in its own words, with no word of the port.
  assert.equal(readSettings({ hostDaemonPort: 39012, daemon: "not a url" }).daemon, "not a url");
});

test("readiness asks the daemon at the port, and its findings name the key", async (t) => {
  const { dir, home } = scratch(t);
  const backend = await fakeBackend(t);
  const other = await fakeBackend(t); // another bb on this host, with a daemon of its own
  const bb = fakeBbIn(dir, { "--version": { stdout: `${VERSION}\n` }, "project list": { stdout: [] }, "thread list": { stdout: [] } });
  const check = (extra) => call("check", { home, soul: null }, { settings: { ...backend.settings({ daemon: undefined }), ...extra }, bb });
  // This bb's own daemon port: ready, and it is that daemon that was asked.
  const ready = await check({ hostDaemonPort: backend.daemonPort });
  assert.equal(ready.result.status, "ready", JSON.stringify(ready.result));
  assert.deepEqual(backend.daemonRequests, ["/status"]);
  assert.deepEqual(ready.result.warnings.map((warning) => warning.code), ["session-provider-full-mode-only"]);
  // Another bb's daemon port: its daemon serves another server, and the finding names the key and bb-app's flag.
  const PORT_KEY = "settings\\.oats\\.bb\\.hostDaemonPort \\(the port bb-app was started with: its --host-daemon-port\\)";
  const wrong = await check({ hostDaemonPort: other.daemonPort });
  assert.deepEqual(wrong.result.problems.map((problem) => problem.code), ["E_BACKEND_NOT_READY"]);
  assert.match(wrong.result.problems[0].message, new RegExp(`^the host daemon at http://127\\.0\\.0\\.1:${other.daemonPort} serves http://127\\.0\\.0\\.1:${other.serverPort}, not settings\\.oats\\.bb\\.server \\S+: point both at one bb, settings\\.oats\\.bb\\.server and ${PORT_KEY}$`));
  // A port nothing listens on.
  const dead = await check({ hostDaemonPort: await deadPort(t) });
  assert.deepEqual(dead.result.problems.map((problem) => problem.code), ["E_BACKEND_UNREACHABLE"]);
  assert.match(dead.result.problems[0].message, new RegExp(`does not answer .*: start bb-app, or set ${PORT_KEY}$`));
  // With `daemon` given and no port, the words name `daemon`, as before.
  const asBefore = await check({ daemon: `http://127.0.0.1:${other.daemonPort}` });
  assert.match(asBefore.result.problems[0].message, /point both at one bb, settings\.oats\.bb\.server and settings\.oats\.bb\.daemon$/);
  // With both given (and agreeing), both are named: changing one alone would be refused for the other.
  const both = await check({ daemon: `http://127.0.0.1:${other.daemonPort}`, hostDaemonPort: other.daemonPort });
  assert.match(both.result.problems[0].message, new RegExp(`point both at one bb, settings\\.oats\\.bb\\.server and settings\\.oats\\.bb\\.daemon and ${PORT_KEY}, which name one daemon$`));
});

// The likeliest mistake with a second bb: `server` is set to it, and neither `daemon` nor
// `hostDaemonPort`. The daemon then asked is bb's default one: the first bb's, which
// serves another server, or nobody's. What to set is `hostDaemonPort`, which also tells
// bb's CLI (`daemon` would only move this check, and leave the launch refused).
test("a server on other ports with neither daemon nor hostDaemonPort: the finding tells to set hostDaemonPort", async (t) => {
  const { dir } = scratch(t);
  const second = await fakeBackend(t);
  const bb = fakeBbIn(dir, { "--version": { stdout: `${VERSION}\n` }, "project list": { stdout: [] }, "thread list": { stdout: [] } });
  const { server, version, trust, dataDir, piAgentDir } = second.settings();
  // In process, with the provider's own reads: the default daemon address (127.0.0.1:38887) is whatever this host has there, so its answer is given here.
  const { backendProblems } = await import("../../oats-package/capabilities/oats-bb/lib/readiness.mjs");
  const settings = readSettings({ server, version, trust, dataDir, piAgentDir, cli: bb.cli });
  assert.deepEqual([settings.daemon, settings.daemonKey, settings.hostDaemonPort], ["http://127.0.0.1:38887", null, null]);
  const answering = (status) => async (url, timeoutMs) => (url === "http://127.0.0.1:38887/status" ? status
    : fetch(url, { signal: AbortSignal.timeout(timeoutMs) }).then(async (response) => ({ ok: response.ok, value: await response.json() }), (error) => ({ ok: false, message: error.message })));
  const problemsWith = async (status) => (await backendProblems(settings, { env: { ...process.env, ...bb.env }, http: answering(status), exposure: async () => [] })).problems;
  const PORT_KEY = "settings.oats.bb.hostDaemonPort (the port bb-app was started with: its --host-daemon-port) where this bb's host daemon is not on bb's default port";
  // The first bb's daemon is on the default port: it serves the first bb's server.
  const others = await problemsWith({ ok: true, value: { hostId: "host_first", connected: true, serverUrl: "http://127.0.0.1:38886" } });
  assert.deepEqual(others.map((problem) => [problem.code, problem.message]), [["E_BACKEND_NOT_READY", `the host daemon at http://127.0.0.1:38887 serves http://127.0.0.1:38886, not settings.oats.bb.server ${server}: point both at one bb, settings.oats.bb.server and ${PORT_KEY}`]]);
  // Nothing is on the default port.
  const nobody = await problemsWith({ ok: false, message: "connect ECONNREFUSED 127.0.0.1:38887" });
  assert.deepEqual(nobody.map((problem) => [problem.code, problem.message]), [["E_BACKEND_UNREACHABLE", `bb's host daemon at http://127.0.0.1:38887 does not answer (connect ECONNREFUSED 127.0.0.1:38887): start bb-app, or set ${PORT_KEY}`]]);
});

// "The daemon answers at the port" is not "it is this bb's daemon": another bb's daemon
// answers too, and that is the case bb refuses a home's first launch for. The check is
// the one bb itself makes, from both sides: the daemon says which host it is and which
// server it serves; the server says which hosts it has.
test("with the port set, readiness asks bb's server for its hosts: the daemon must be one of them, connected, and the finding names the daemon, the server and the key", async (t) => {
  const { dir, home } = scratch(t);
  const backend = await fakeBackend(t);
  const script = (hosts) => ({ "--version": { stdout: `${VERSION}\n` }, "project list": { stdout: [] }, "thread list": { stdout: [] }, ...(hosts === undefined ? {} : { "host list": hosts }) });
  const bb = fakeBbIn(dir, script());
  const check = () => call("check", { home, soul: null }, { settings: backend.settings(), bb });
  const host = (id, status = "connected") => ({ id, name: "a host", type: "persistent", status, lifecycle: { phase: "active" }, maxPermissionMode: "full", lastSeenAt: 1 });
  const named = new RegExp(`^settings\\.oats\\.bb\\.server \\(${backend.server}\\) and settings\\.oats\\.bb\\.hostDaemonPort \\(${backend.daemonPort}, the port bb-app was started with: its --host-daemon-port\\) must name one bb, and `);
  // The daemon (host_1 by its own /status) is one of the server's hosts, connected: ready, and the server was asked once.
  const ready = await check();
  assert.equal(ready.result.status, "ready", JSON.stringify(ready.result));
  assert.deepEqual(bb.calls().filter((c) => c.argv[0] === "host").map((c) => c.argv), [["host", "list", "--json"]]);
  // The server has other hosts and not this one: it is another bb's daemon.
  bb.setScript(script({ stdout: [host("host_of_another_bb"), host("host_2")] }));
  const foreign = await check();
  assert.deepEqual(foreign.result.problems.map((problem) => problem.code), ["E_BACKEND_NOT_READY"]);
  assert.equal(foreign.result.status, "needs-configuration");
  assert.match(foreign.result.problems[0].message, named);
  assert.match(foreign.result.problems[0].message, new RegExp(`must name one bb, and they do not: the host daemon at ${backend.daemon} is host host_1, which that server does not have \\(its hosts: host_of_another_bb, host_2\\)\\. It is another bb's daemon$`));
  bb.setScript(script({ stdout: [] }));
  assert.match((await check()).result.problems[0].message, /does not have \(its hosts: none\)\. It is another bb's daemon$/);
  // The server has it, and not connected.
  bb.setScript(script({ stdout: [host("host_1", "disconnected")] }));
  const away = await check();
  assert.deepEqual([away.result.status, away.result.problems.map((problem) => problem.code)], ["unavailable", ["E_BACKEND_NOT_READY"]]);
  assert.match(away.result.problems[0].message, named);
  assert.match(away.result.problems[0].message, /is host host_1, which that server shows as "disconnected", not connected$/);
  // The server's hosts cannot be read, or are no list a host can be found in: nothing shows it, so not ready.
  for (const unreadable of [{ error: { code: "error", message: "HTTP 500: boom" } }, { stdout: { hosts: [] } }, { stdout: [{ name: "no id" }] }]) {
    bb.setScript(script(unreadable));
    const unknown = await check();
    assert.deepEqual([unknown.result.status, unknown.result.problems.map((problem) => problem.code)], ["unavailable", ["E_BACKEND_NOT_READY"]], JSON.stringify(unreadable));
    assert.match(unknown.result.problems[0].message, named);
    assert.match(unknown.result.problems[0].message, /must name one bb, and nothing shows they do: the host daemon at \S+ is host host_1, and the hosts of that server could not be read \(.*\)$/);
  }
  // bb's own words may be long: what to change comes first, so the cut the kernel's relay makes falls in them.
  bb.setScript(script({ error: { code: "error", message: `HTTP 500: ${"a long word of bb's ".repeat(30)}` } }));
  const long = (await check()).result.problems[0].message;
  assert.ok(long.length <= 480, String(long.length));
  assert.match(long, named);
  assert.match(long, /…$/);
  // A server with many hosts: the remedy and the daemon's host are before the list.
  bb.setScript(script({ stdout: Array.from({ length: 30 }, (_, index) => host(`host_${"x".repeat(20)}_${index}`)) }));
  const many = (await check()).result.problems[0].message;
  assert.ok(many.length <= 480);
  assert.match(many, named);
  assert.match(many, /is host host_1, which that server does not have \(its hosts: /);
  // A daemon that does not say which host it is.
  bb.setScript(script());
  backend.state.daemonStatus = { connected: true, protocolVersion: 268, serverUrl: backend.server, platform: "linux" };
  const anonymous = await check();
  assert.deepEqual([anonymous.result.status, anonymous.result.problems.map((problem) => problem.code)], ["unavailable", ["E_BACKEND_NOT_READY"]]);
  assert.match(anonymous.result.problems[0].message, named);
  assert.match(anonymous.result.problems[0].message, /nothing shows they do: bb's host daemon at \S+ answered a \/status that does not say which host it is \(no "hostId"\)$/);
  // A bb CLI that cannot be run is said once, by the read of its version: its hosts are not asked for too.
  backend.state.daemonStatus = null;
  bb.setScript(script());
  const missing = await call("check", { home, soul: null }, { settings: backend.settings(), bb: { cli: join(dir, "no-such-bb"), env: bb.env } });
  assert.deepEqual(missing.result.problems.map((problem) => problem.code), ["E_BACKEND_VERSION"], JSON.stringify(missing.result.problems));
  // Without the port (the daemon's address alone, as before the key), the server is not asked for its hosts.
  backend.state.daemonStatus = null;
  const before = bb.calls().length;
  const asBefore = await call("check", { home, soul: null }, { settings: backend.settings({ daemon: backend.daemon }), bb });
  assert.equal(asBefore.result.status, "ready");
  assert.equal(bb.calls().slice(before).some((c) => c.argv[0] === "host"), false);
});

test("a daemon that is not on bb's default port, and no hostDaemonPort: a warning that names the key, and nothing refused", async (t) => {
  const { dir, home } = scratch(t);
  const backend = await fakeBackend(t);
  const bb = fakeBbIn(dir, { "--version": { stdout: `${VERSION}\n` }, "project list": { stdout: [] }, "thread list": { stdout: [] } });
  const check = (settings) => call("check", { home, soul: null }, { settings, bb });
  const trap = await check(backend.settings({ daemon: backend.daemon }));
  assert.equal(trap.result.status, "ready", "unset is what it was before the key: nothing new is refused");
  const warning = trap.result.warnings.find((entry) => entry.code === "session-provider-host-daemon-port");
  assert.ok(warning, JSON.stringify(trap.result.warnings));
  assert.match(warning.message, new RegExp(`settings\\.oats\\.bb\\.daemon names port ${backend.daemonPort}, not bb's default 38887, and settings\\.oats\\.bb\\.hostDaemonPort is not set: .*Set hostDaemonPort: ${backend.daemonPort} in oats-local\\.yaml \\(the port bb-app was started with: its --host-daemon-port\\)$`));
  assert.ok(warning.message.length < 500);
  // With the port set, or a daemon on bb's default port (38887 here names nothing that listens: only the warning is looked at), none.
  const set = await check(backend.settings());
  assert.equal(set.result.warnings.some((entry) => entry.code === "session-provider-host-daemon-port"), false);
  const onDefault = await check(backend.settings({ daemon: "http://127.0.0.1:38887" }));
  assert.equal(onDefault.result.warnings.some((entry) => entry.code === "session-provider-host-daemon-port"), false);
});

test("oats bb doctor says which host daemon port bb's CLI is told, or that it is told none", async (t) => {
  const { dir } = scratch(t);
  const backend = await fakeBackend(t);
  const bb = fakeBbIn(dir, { "--version": { stdout: `${VERSION}\n` }, "project list": { stdout: [] }, "thread list": { stdout: [] } });
  const doctor = (settings, args = []) => runBin(["doctor", ...args], { env: { ...bb.env, OATS_SETTINGS: JSON.stringify({ ...settings, cli: bb.cli }) } });
  const set = await doctor(backend.settings());
  assert.equal(set.status, 0, set.stdout);
  assert.match(set.stdout, new RegExp(`^bb session provider: ready\\n  host daemon port: ${backend.daemonPort} \\(settings\\.oats\\.bb\\.hostDaemonPort\\)\\n`));
  assert.equal((await doctor(backend.settings(), ["--json"])).doc.hostDaemonPort, backend.daemonPort);
  const unset = await doctor(backend.settings({ daemon: backend.daemon }));
  assert.match(unset.stdout, /^bb session provider: ready\n  host daemon port: default 38887\n/);
  assert.match(unset.stdout, /\n  warning session-provider-host-daemon-port: /);
  assert.equal((await doctor(backend.settings({ daemon: backend.daemon }), ["--json"])).doc.hostDaemonPort, null);
});
