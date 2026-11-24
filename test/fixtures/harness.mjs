// What the unit tests share: a fake bb on disk, a fake bb server and host daemon on
// loopback, and the provider run as the kernel runs it (a process, JSON in, JSON out).
import { spawn } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync, existsSync } from "node:fs";
import { createServer } from "node:http";
import { createServer as createTcpServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
export const repoRoot = resolve(here, "../..");
export const capabilityDir = join(repoRoot, "oats-package/capabilities/oats-bb");
export const providerBin = join(capabilityDir, "bin/oats-bb.mjs");
// The same session commands with bb's sandboxed modes taken, which the provider's own
// command refuses, as they are not offered (test/fixtures/sandboxed-bin.mjs).
export const sandboxedBin = join(repoRoot, "test/fixtures/sandboxed-bin.mjs");
const fakeBb = join(here, "fake-bb.mjs");

// The PATH the provider runs with in the tests: a directory holding a `bwrap` (so the
// answer does not depend on whether this machine has bubblewrap), then the machine's own.
// `PATH_WITHOUT_BWRAP` holds node alone, for the tests of a host without it.
const toolDirs = mkdtempSync(join(tmpdir(), "oats-bb-path-"));
process.on("exit", () => rmSync(toolDirs, { recursive: true, force: true }));
mkdirSync(join(toolDirs, "with"));
mkdirSync(join(toolDirs, "without"));
writeFileSync(join(toolDirs, "with/bwrap"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
symlinkSync(process.execPath, join(toolDirs, "without/node"));
export const PATH_WITH_BWRAP = `${join(toolDirs, "with")}:${process.env.PATH}`;
export const PATH_WITHOUT_BWRAP = join(toolDirs, "without");
// Where the provider keeps its own state in the tests (XDG_STATE_HOME): never the state
// directory of the user who runs them. A test that reads a home's thread record looks here.
export const STATE_HOME = join(toolDirs, "state");

export const VERSION = "0.50.1";

// bb-app 0.50.1's shapes, trimmed to the fields a script reads (bb guide json).
export const threadRow = (id, projectId, status, extra = {}) => ({
  id, projectId, environmentId: `env_${id}`, providerId: "claude-code", title: id, status,
  visibility: "visible", archivedAt: null, pinnedAt: null, deletedAt: null, createdAt: 1, updatedAt: 1,
  queuedWork: "none", environmentPath: null, hasPendingInteraction: false, runtime: { displayStatus: status }, ...extra,
});
export const projectRow = (id, root) => ({
  id, kind: "standard", name: id, gitRemoteUrl: null, createdAt: 1, updatedAt: 1,
  sources: [{ id: `src_${id}`, projectId: id, type: "local_path", hostId: "host_1", path: root, isDefault: true }],
});
export const environmentRow = (id, path, extra = {}) => ({
  id, name: null, projectId: "proj_a", hostId: "host_1", path, isGitRepo: false, isWorktree: false, branchName: null, status: "ready",
  environmentProviderId: "project-checkout", lifecycle: { phase: "active", retireAt: null, teardown: null }, hostLifecycle: "active",
  environmentProviderSelection: { machine: { type: "existing", hostId: "host_1" }, inputs: { path } }, managed: false, workspaceProvisionType: "unmanaged", createdAt: 1, updatedAt: 1, ...extra,
});
export const tellSent = (threadId) => ({ threadId, ok: true, delivery: "sent", messageSequence: 24, mode: "auto" });
export const tellQueued = (threadId, waitingOn = "interaction", id = "qmsg_3sgztxjk4j") => ({
  threadId, ok: true, delivery: "queued", mode: "auto",
  queuedMessage: { id, threadId, state: "waiting", waitingOn: { kind: waitingOn }, editable: true },
});
export const pendingInteraction = (threadId, id = "pint_m5byy7u9ux") => ({
  id, threadId, status: "pending", resolvedAt: null, providerId: "claude-code",
  payload: { kind: "approval", subject: { kind: "command", command: "echo SECRET-LOOKING-COMMAND" }, availableDecisions: ["allow_once", "deny"] },
});
export const NOT_FOUND = { error: { code: "thread_not_found", message: "HTTP 404: Thread not found" } };
export const QUEUE_GONE = { error: { code: "invalid_request", message: "HTTP 404: Queued message not found" } };
export const UNREACHABLE = { error: { code: "error", message: "fetch failed: connect ECONNREFUSED 127.0.0.1:38886" } };

/** A scratch directory with a home in it, removed by `t.after`. */
export function scratch(t) {
  const dir = mkdtempSync(join(tmpdir(), "oats-bb-test-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const home = join(dir, "home");
  mkdirSync(join(home, "work"), { recursive: true, mode: 0o700 });
  chmodSync(home, 0o700);
  writeFileSync(join(home, "TASK.md"), "Say hi.\n");
  return { dir, home };
}

/** Install a script for the fake bb. → { cli, env, calls() }. */
export function fakeBbIn(dir, script) {
  const scriptFile = join(dir, "bb-script.json"), log = join(dir, "bb-calls.jsonl");
  writeFileSync(scriptFile, JSON.stringify(script));
  const entries = () => (existsSync(log) ? readFileSync(log, "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line)) : []);
  return {
    cli: fakeBb,
    env: { FAKE_BB_SCRIPT: scriptFile, FAKE_BB_LOG: log },
    calls: () => entries().filter((entry) => entry.argv),
    childPids: () => entries().filter((entry) => entry.childPid).map((entry) => entry.childPid),
    setScript: (next) => writeFileSync(scriptFile, JSON.stringify(next)),
  };
}

/** A fake bb server and host daemon, each on its own loopback port.
 *  `state` is mutable: { health, daemonStatus, provider, down: {server, daemon} }. */
export async function fakeBackend(t, overrides = {}) {
  const state = {
    health: { ok: true, launchId: "51fd3670" },
    daemonStatus: null,
    provider: { providerId: "claude-code", displayName: "Claude Code", status: "ready", statusMessage: null, loginCommand: "claude auth login" },
    providerHttpStatus: 200,
    // bb's pi provider, as bb-app 0.50.1 reports one that is installed (no account: pi keeps its own logins).
    piProvider: { providerId: "pi", displayName: "Pi", status: "ready", statusMessage: null, accountEmail: null, installedVersion: "1.5.2", loginCommand: "pi" },
    ...overrides,
  };
  const listen = (handler, host = "127.0.0.1") => new Promise((resolveListen, reject) => {
    const server = createServer(handler);
    server.once("error", reject);
    server.listen(0, host, () => { t.after(() => new Promise((done) => { server.closeAllConnections?.(); server.close(done); })); resolveListen(server); });
  });
  const json = (res, status, doc) => { res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify(doc)); };
  const requests = [], daemonRequests = [];
  const server = await listen((req, res) => {
    requests.push(req.url);
    if (req.url === "/health") return json(res, 200, state.health);
    if (req.url === "/api/v1/system/providers/state?providerId=claude-code") {
      if (state.providerRaw !== undefined) { res.writeHead(200, { "content-type": "application/json" }); return res.end(state.providerRaw); }
      return json(res, state.providerHttpStatus, state.providerHttpStatus === 200 ? { providers: state.provider ? [state.provider] : [] } : { code: "error" });
    }
    if (req.url === "/api/v1/system/providers/state?providerId=pi") return json(res, 200, { providers: state.piProvider ? [state.piProvider] : [] });
    return json(res, 404, { code: "not_found", message: "Not found" });
  }, overrides.bindHost);
  const serverUrl = `http://127.0.0.1:${server.address().port}`;
  const daemon = await listen((req, res) => {
    daemonRequests.push(req.url);
    if (req.url === "/status") return json(res, 200, state.daemonStatus ?? { hostId: "host_1", connected: true, protocolVersion: 268, serverUrl, platform: "linux" });
    return json(res, 404, {});
  });
  const daemonUrl = `http://127.0.0.1:${daemon.address().port}`;
  // bb's data directory, as bb-app makes it: the provider looks for its thread-storage.
  const dataDir = mkdtempSync(join(tmpdir(), "oats-bb-test-data-"));
  t.after(() => rmSync(dataDir, { recursive: true, force: true }));
  mkdirSync(join(dataDir, "thread-storage"));
  // The pi configuration bb's server runs with, as `pi install npm:@awebai/oats-pi` leaves
  // one: the bridge, and no aweb extension. `piSettings(doc)` rewrites its settings.json.
  const piAgentDir = join(dataDir, "pi-agent");
  mkdirSync(piAgentDir);
  const piSettings = (doc) => writeFileSync(join(piAgentDir, "settings.json"), typeof doc === "string" ? doc : JSON.stringify(doc, null, 2));
  piSettings({ packages: ["npm:@awebai/oats-pi@0.70.0"] });
  return { state, requests, daemonRequests, server: serverUrl, daemon: daemonUrl, serverPort: server.address().port, dataDir, piAgentDir, piSettings, daemonPort: daemon.address().port,
    // As a deployment whose bb is not on bb's default ports sets them: the server, and the
    // host daemon's port (the daemon's address is given too, and agrees with it). A test
    // that gives a daemon address of its own gives no port with it, unless it says one.
    settings: (extra = {}) => ({ server: serverUrl, daemon: daemonUrl, ...(Object.hasOwn(extra, "daemon") ? {} : { hostDaemonPort: daemon.address().port }), version: VERSION, trust: "single-user", dataDir, piAgentDir, ...extra }) };
}

/** A loopback port where nothing answers, held for the whole test: a listener that drops
 *  every connection at once. (Picking a free port and closing it would leave a window in
 *  which another process, a second run of this suite for one, takes the port and answers.) */
export async function deadPort(t) {
  const server = createTcpServer((socket) => socket.destroy());
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  t.after(() => new Promise((done) => server.close(done)));
  return server.address().port;
}

/** Run the provider's bin as the kernel does. → { status, stdout, stderr, doc }. */
export function runBin(args, { stdin = "", env = {}, bin = providerBin } = {}) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(process.execPath, [bin, ...args], { cwd: capabilityDir, env: { PATH: PATH_WITH_BWRAP, HOME: process.env.HOME, XDG_STATE_HOME: STATE_HOME, ...env }, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "", stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (status) => {
      let doc = null;
      try { doc = JSON.parse(stdout); } catch { /* a test that expects JSON asserts on doc */ }
      resolveRun({ status, stdout, stderr, doc });
    });
    child.stdin.end(stdin);
  });
}

/** A harness as bb starts one: a process named `name` (a link to node under that name)
 *  that carries BB_THREAD_ID=<id>, works in `cwd`, and is a child of a stand-in for bb's
 *  runner of `provider` (test/fixtures/bb-provider-bridge-worker.mjs, under bb's own file
 *  name). Ended with the test. → { pid, end() }: `end()` ends the harness and its runner. */
export async function bbHarness(t, { id, name, cwd, provider }) {
  const bin = mkdtempSync(join(tmpdir(), "oats-bb-harness-"));
  t.after(() => rmSync(bin, { recursive: true, force: true }));
  symlinkSync(process.execPath, join(bin, name));
  const worker = spawn(process.execPath, [join(here, "bb-provider-bridge-worker.mjs"), "/data/plugin-host-artifacts/host.mjs", `provider-${provider}`, "/data/bridge-data", join(bin, name), id, cwd], { stdio: ["ignore", "pipe", "inherit"] });
  const exited = new Promise((done) => worker.once("exit", done));
  const end = async () => { if (worker.exitCode === null && worker.signalCode === null) worker.kill("SIGTERM"); await exited; };
  t.after(end);
  const pid = await new Promise((done, failed) => {
    let out = "";
    worker.stdout.on("data", (chunk) => { out += chunk; if (out.includes("\n")) done(Number(out)); });
    worker.once("error", failed);
    worker.once("exit", () => failed(new Error("the stand-in for bb's runner ended before it started the harness")));
  });
  return { pid, end };
}

export const requestFor = (verb, input, extra = {}) => ({ schemaVersion: 1, wire: "1.3", phase: "session", capability: "oats.bb", provider: "bb", verb, input, ...extra });

/** One call on the kernel's wire: the request on stdin, the home's settings in
 *  OATS_SETTINGS. → the answer envelope, asserted to be the wire's: exactly one JSON
 *  document on stdout, exit 0, the five header keys echoed, then a result or a refusal of
 *  {code, message} and nothing else. */
export async function call(verb, input, options) {
  return (await callSeen(verb, input, options)).doc;
}

/** The same call, with what the command wrote beside its answer. → { doc, stderr }:
 *  the kernel does not read a provider's stderr, and a person running the command does. */
export async function callSeen(verb, input, { settings = {}, bb, env = {}, sandboxedModes = false }) {
  const request = requestFor(verb, input);
  const run = await runBin(["session", verb], { bin: sandboxedModes ? sandboxedBin : providerBin, stdin: JSON.stringify(request), env: { ...bb.env, OATS_CAPABILITY: "oats.bb", OATS_BACKEND: "bb", OATS_SETTINGS: JSON.stringify({ ...settings, cli: bb.cli }), ...env } });
  if (run.status !== 0 || run.doc === null) throw new Error(`the provider did not answer one JSON document (exit ${run.status}): ${run.stdout}\n${run.stderr}`);
  if (run.stdout.trim().split("\n").length !== 1) throw new Error(`more than one line on stdout: ${run.stdout}`);
  const expected = ["schemaVersion", "phase", "capability", "provider", "verb", "ok", run.doc.ok === true ? "result" : "error"];
  if (JSON.stringify(Object.keys(run.doc)) !== JSON.stringify(expected)) throw new Error(`the answer's keys are not the wire's: ${run.stdout}`);
  for (const key of ["schemaVersion", "phase", "capability", "provider", "verb"]) {
    if (run.doc[key] !== request[key]) throw new Error(`the answer does not echo ${key}: ${run.stdout}`);
  }
  if (run.doc.ok === false && (JSON.stringify(Object.keys(run.doc.error)) !== '["code","message"]' || !/^E_[A-Z0-9_]{1,60}$/.test(run.doc.error.code))) throw new Error(`a refusal is {code, message}: ${run.stdout}`);
  return { doc: run.doc, stderr: run.stderr };
}

export const endpointOf = (backend, projectId = "proj_a", threadId = "thr_a") => ({ server: backend.server, projectId, threadId });
