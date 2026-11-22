// The contract test (spec P1, pinned T1-T9): the provider against the pinned bb-app, in a
// container, with a mock Anthropic endpoint. No credential, no OATS kernel: the provider's
// commands are called on their wire, as the kernel calls them.
//
// Run: npm run test:contract   (needs docker; builds test/contract/Dockerfile at the
// bb-app version in the repository's bb-version file). bb's API has no login and runs commands,
// so bb runs only inside the container: no port is published and only this repository is
// mounted, read-only.
import assert from "node:assert/strict";
import { execFile, execFileSync, spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { after, afterEach, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const run = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "../..");
const BB_VERSION = readFileSync(resolve(repo, "bb-version"), "utf8").trim();
const IMAGE = `oats-bb-contract:${BB_VERSION}`;
const NAME = `oats-bb-contract-${process.pid}`;
const PROVIDER = "/repo/oats-package/capabilities/oats-bb/bin/oats-bb.mjs";
const SANDBOXED_ENTRY = "/repo/test/fixtures/sandboxed-bin.mjs";
const SERVER = "http://127.0.0.1:38886";
const MODEL = "claude-opus-5-5";
const SETTINGS = { version: BB_VERSION, trust: "container", dataDir: "/home/node/bbdata" };
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

/** Run a shell line in the container. → stdout. `ok: false` tolerates a nonzero exit. */
async function sh(line, { input, ok = true } = {}) {
  return new Promise((done, reject) => {
    const child = spawn("docker", ["exec", "-i", NAME, "sh", "-c", `cd ~ && ${line}`], { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "", stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (status) => (status === 0 || !ok ? done(stdout) : reject(new Error(`in the container, \`${line}\` exited ${status}: ${stderr || stdout}`))));
    child.stdin.end(input ?? "");
  });
}
const bbJson = async (args, options) => JSON.parse(await sh(`bb ${args} --json`, options));

/** One call on the provider's wire, inside the container, as the kernel makes it: the
 *  request on stdin, the settings in OATS_SETTINGS. → the answer envelope. */
async function provider(verb, input, settings = SETTINGS, { sandboxedModes = false } = {}) {
  const request = { schemaVersion: 1, wire: "1.3", phase: "session", capability: "oats.bb", provider: "bb", verb, input };
  // The provider's own command launches in bb's full mode only (sandboxed modes are not offered). The tests that
  // need a thread waiting on a person's permission launch in accept-edits through the
  // test entry that takes the sandboxed modes (test/fixtures/sandboxed-bin.mjs).
  const stdout = await sh(`OATS_CAPABILITY=oats.bb OATS_BACKEND=bb OATS_SETTINGS='${JSON.stringify(settings)}' node ${sandboxedModes ? SANDBOXED_ENTRY : PROVIDER} session ${verb}`, { input: JSON.stringify(request) });
  const answer = JSON.parse(stdout);
  assert.deepEqual(Object.keys(answer), ["schemaVersion", "phase", "capability", "provider", "verb", "ok", answer.ok ? "result" : "error"]);
  assert.equal(answer.verb, verb);
  return answer;
}
const check = (settings = SETTINGS) => provider("check", { home: null, soul: null }, settings);

async function waitFor(what, read, { timeoutMs = 60_000, everyMs = 400 } = {}) {
  const until = Date.now() + timeoutMs;
  let last;
  for (;;) {
    last = await read();
    if (last) return last;
    if (Date.now() > until) throw new Error(`timed out waiting for ${what}`);
    await sleep(everyMs);
  }
}
const threadStatus = async (id) => (await bbJson(`thread show ${id}`)).thread.status;
const waitStatus = (id, ...statuses) => waitFor(`thread ${id} to be ${statuses.join(" or ")}`, async () => { const s = await threadStatus(id); return statuses.includes(s) ? s : null; });

/** The mock's log: the model requests of threads' turns (bb's title requests, which offer
 *  no tools, and token counts are not turns). */
async function modelRequests() {
  const text = await sh("cat mock-requests.jsonl 2>/dev/null || true");
  return text.split("\n").filter(Boolean).map((line) => JSON.parse(line))
    .filter((r) => r.url.startsWith("/v1/messages") && !r.url.includes("count_tokens") && r.tools.length > 0);
}
/** How many model requests introduced the text: it is in the request's last message. */
const landed = async (marker) => (await modelRequests()).filter((r) => r.lastText.includes(marker)).length;
const armTool = (command) => sh("cat > mock-next-cmd", { input: command });

/** A fresh home in the container, as the kernel leaves one: TASK.md, and Claude's project
 *  settings with one hook that records the environment it runs in. */
async function makeHome(name) {
  const home = `/home/node/homes/${name}`;
  // The hook also runs `contract-shim` by its bare name: it is found only if the launch's
  // pathPrepend (the home's shim directory) reached Claude's PATH.
  const hook = { hooks: { UserPromptSubmit: [{ hooks: [{ type: "command", command: `printf '%s|%s|%s|%s\\n' "$OATS_INSTANCE" "$CONTRACT_PROBE" "$(contract-shim 2>/dev/null)" "\${CONTRACT_AMBIENT-unset}" >> ${home}/hook-env.log` }] }] } };
  await sh(`mkdir -p ${home}/.claude ${home}/.oats/bin ${home}/work && printf '#!/bin/sh\\necho shim-on-path\\n' > ${home}/.oats/bin/contract-shim && chmod 755 ${home}/.oats/bin/contract-shim && chmod 700 ${home} && printf 'TASK-${name} say hi.\\n' > ${home}/TASK.md && cat > ${home}/.claude/settings.json`, { input: JSON.stringify(hook) });
  return home;
}
const launchInput = (home, name, extra = {}) => ({
  home, instance: name, harness: "claude", model: MODEL, yolo: true,
  env: [{ name: "OATS_INSTANCE", value: name, source: "kernel" }, { name: "OATS_INSTANCE_HOME", value: home, source: "kernel" }],
  unset: [], pathPrepend: [`${home}/.oats/bin`], args: [], promptFile: `${home}/TASK.md`, previous: null, ...extra,
});
async function launched(name, extra, options) {
  const home = await makeHome(name);
  const answer = await provider("launch", launchInput(home, name, extra), SETTINGS, options);
  if (answer.ok) started.push(answer.result.endpoint.threadId);
  assert.equal(answer.ok, true, JSON.stringify(answer));
  return { home, endpoint: answer.result.endpoint };
}

/** How many processes work in the home (their cwd is in it), and how many of them are Claude. */
const processesIn = async (home) => Number((await sh(`for p in /proc/[0-9]*; do readlink $p/cwd 2>/dev/null; done | grep -c '^${home}' || true`)).trim());
const claudesIn = async (home) => Number((await sh(`for p in /proc/[0-9]*; do case "$(readlink $p/cwd 2>/dev/null)" in ${home}*) tr '\\0' ' ' < $p/cmdline | grep -c 'bin/claude ' ;; esac; done | grep -c 1 || true`)).trim());
/** The names of the processes that carry the thread's id (bb's BB_THREAD_ID). */
const carriers = async (threadId) => (await sh(`for p in /proc/[0-9]*; do if tr '\\0' '\\n' < $p/environ 2>/dev/null | grep -qx 'BB_THREAD_ID=${threadId}'; then cat $p/comm; fi; done 2>/dev/null || true`)).split("\n").filter(Boolean);

// The threads the tests launched, stopped after each test: bb keeps a thread's Claude
// loaded while it is idle, and a dozen of them starve the bb servers that later tests
// start in this container (two CPUs, 4 GB).
const started = [];
afterEach(async () => {
  for (const id of started.splice(0)) await sh(`bb thread stop ${id} --json >/dev/null 2>&1 || true`);
});

before(async () => {
  execFileSync("docker", ["build", "-q", "--build-arg", `BB_APP_VERSION=${BB_VERSION}`, "-t", IMAGE, here], { stdio: ["ignore", "ignore", "inherit"] });
  execFileSync("docker", ["run", "-d", "--name", NAME, "--init", "--cpus", "2", "--memory", "4g", "-v", `${repo}:/repo:ro`, IMAGE], { stdio: ["ignore", "ignore", "inherit"] });
  await run("docker", ["exec", "-d", NAME, "sh", "-c", "cd ~ && node /repo/test/contract/mock-anthropic.mjs > mock.out 2>&1"]);
  await run("docker", ["exec", "-d", "-e", "ANTHROPIC_BASE_URL=http://127.0.0.1:9999", "-e", "ANTHROPIC_API_KEY=dummy-not-a-real-key", NAME, "sh", "-c",
    // CONTRACT_AMBIENT stands for a variable bb's server happens to carry: bb's Claude inherits it.
    "cd ~ && CONTRACT_AMBIENT=from-the-bb-server bb-app --data-dir ~/bbdata --server-bind-host 127.0.0.1 --no-in-app-updates > bb-app.out 2>&1"]);
  await waitFor("bb to be ready", async () => (await check()).result?.status === "ready", { timeoutMs: 180_000, everyMs: 1_000 });
}, { timeout: 900_000 });

after(async () => {
  if (process.env.OATS_BB_CONTRACT_KEEP) { console.log(`kept container ${NAME}`); return; }
  await run("docker", ["rm", "-f", NAME]).catch(() => {});
});

/** Stop the extra bb server whose data directory is ~/<dir>: its launcher, which shuts its server, daemon and their
 *  children down before it exits (the pinned bb-app's own SIGTERM handling, seen at 0.50.1).
 *  By the start of its command line (`node …/bb-app --data-dir …/<dir>`), which this shell's own does not have.
 *  The container has two CPUs: a bb a test is done with is stopped, so the next test's bb starts at full speed. */
async function stopExtraBb(dir) {
  const each = (act) => `for p in /proc/[0-9]*; do case "$(tr '\\0' ' ' 2>/dev/null < $p/cmdline)" in "node "*"/bb-app --data-dir "*"/${dir} "*) ${act} ;; esac; done`;
  await sh(each("kill ${p#/proc/}")); // a plain string: the shell expands ${p#/proc/}
  await waitFor(`the bb of ~/${dir} to stop`, async () => !(await sh(each("echo alive"))).includes("alive"), { timeoutMs: 60_000, everyMs: 500 });
}
/** Every bb process in the container, with how long it has run, its state and what it waits on in the kernel: when a
 *  second bb prints nothing, whether it started at all, and where it is stuck. */
const BB_PROCESSES = "ps -eo pid,ppid,etime,stat,wchan:24,args | grep -E '[b]b-app|[s]erver/dist|[d]aemon' | cut -c1-200 | grep . || echo none";
/** What a container read says, for a failure's message: never a second error that hides the first. */
const said = (command) => sh(command).catch((error) => `(not read: ${error.message})`);

test("the image runs the pinned bb-app, and readiness reads it ready", async () => {
  assert.equal((await sh("bb --version")).trim(), BB_VERSION);
  // Ready, with one thing said: this image, like the hardened team image, has no
  // bubblewrap, so Claude's sandbox cannot start (a warning; it refuses nothing).
  const ready = (await check()).result;
  assert.equal(ready.status, "ready");
  assert.deepEqual(ready.problems, []);
  assert.deepEqual(ready.warnings.map((w) => w.code), ["session-provider-sandbox-unsupported", "session-provider-full-mode-only"]);
  assert.match(ready.warnings[0].message, /every command waits for a person in bb\. In a team container, spawn bb agents with --yolo/);
  assert.equal((await sh("command -v bwrap || echo none")).trim(), "none");
  // The provider's default version is this pin: with no version setting it is ready too.
  const manifest = JSON.parse(await sh("cat /repo/oats-package/capabilities/oats-bb/oats.json"));
  assert.equal(manifest.settings.version.default, BB_VERSION);
});

test("the two HTTP reads the provider makes answer what it decodes, at the pinned version", async () => {
  // The host daemon's /status: "connected" is a boolean, and its serverUrl is the server.
  const status = JSON.parse(await sh("curl -s -m 5 http://127.0.0.1:38887/status"));
  assert.equal(status.connected, true);
  assert.equal(status.serverUrl, SERVER);
  // bb's provider state (its CLI has no command for it): one entry per provider, with a
  // status word. With the mock endpoint's API key, bb reports claude-code ready.
  const state = JSON.parse(await sh("curl -s -m 30 'http://127.0.0.1:38886/api/v1/system/providers/state?providerId=claude-code'"));
  assert.equal(Array.isArray(state.providers), true);
  const claude = state.providers.find((p) => p.providerId === "claude-code");
  assert.equal(claude.status, "ready");
  assert.ok("accountEmail" in claude && "loginCommand" in claude);
  assert.equal(JSON.parse(await sh("curl -s -m 5 http://127.0.0.1:38886/health")).ok, true);
  // And the person's report names where the credential comes from, never a value.
  const doctor = await sh(`OATS_SETTINGS='${JSON.stringify(SETTINGS)}' node ${PROVIDER} doctor`);
  assert.match(doctor, /^bb session provider: ready\n  warning session-provider-sandbox-unsupported: .*\n  warning session-provider-full-mode-only: .*\n  claude-code credential: no Claude login/);
  assert.doesNotMatch(doctor, /dummy-not-a-real-key/);
});

test("the launch's refusals reach no bb: a secret-sourced env entry, an argument bb cannot carry, a mode that is not full", async () => {
  const home = await makeHome("refused");
  const secret = launchInput(home, "refused");
  secret.env.push({ name: "ANTHROPIC_API_KEY", value: "dummy-not-a-real-key", source: "launch-config-reference", secret: true });
  const envAnswer = await provider("launch", secret);
  assert.equal(envAnswer.error.code, "E_BACKEND_LAUNCH_ENV");
  assert.match(envAnswer.error.message, /ANTHROPIC_API_KEY/);
  const argAnswer = await provider("launch", launchInput(home, "refused", { args: ["--channels", "plugin:aweb-channel@awebai-marketplace"] }));
  assert.equal(argAnswer.error.code, "E_BACKEND_LAUNCH_ARG");
  // A launch that is not in bb's full mode (no yolo, or a sandboxed --permission-mode): the
  // command launches in full mode only until the release that brings the deny rules.
  for (const extra of [{ yolo: false }, { yolo: null }, { yolo: null, args: ["--permission-mode", "auto"] }, { yolo: false, args: ["--permission-mode", "acceptEdits"] }]) {
    const modeAnswer = await provider("launch", launchInput(home, "refused", extra));
    assert.equal(modeAnswer.error.code, "E_BACKEND_SANDBOXED_MODE", JSON.stringify(extra));
    assert.match(modeAnswer.error.message, /a sandboxed mode.*--yolo.*Nothing was started/);
  }
  assert.equal((await bbJson("project list")).some((p) => p.sources.some((s) => s.path === home)), false);
  assert.equal((await sh(`test -e ${home}/.claude/settings.local.json && echo yes || echo no`)).trim(), "no");
});

test("a spawn bb's server refuses: the CLI's envelope carries the server's 4xx, which the provider reads as bb's no", async () => {
  // bb 0.50.1 wraps a refused spawn in a plain error; the status in its message is what
  // tells the server's no (a refusal) from an outcome in doubt.
  const refused = JSON.parse(await sh(`bb thread spawn --project proj_nosuchproject --provider claude-code --model ${MODEL} --environment /home/node --prompt x --json 2>/dev/null`, { ok: false }));
  assert.equal(refused.ok, false);
  assert.equal(refused.error.code, "error");
  assert.match(refused.error.message, /\bHTTP 4\d\d:/);
  const gone = JSON.parse(await sh("bb thread tell thr_nosuchthread --message-file - --mode auto --json 2>/dev/null", { input: "x", ok: false }));
  assert.equal(gone.error.code, "thread_not_found");
});

test("T1 launch: the thread exists in a project rooted at the home, and a hook sees the settings.local.json env", async () => {
  const home = await makeHome("t1");
  const input = launchInput(home, "t1");
  input.env.push({ name: "CONTRACT_PROBE", value: "seen-by-the-hook", source: "launch-config" });
  input.unset = ["CONTRACT_AMBIENT"];
  const answer = await provider("launch", input);
  assert.equal(answer.ok, true, JSON.stringify(answer));
  const { endpoint } = answer.result;
  assert.equal(endpoint.server, SERVER);

  const { thread, environment } = await bbJson(`thread show ${endpoint.threadId}`);
  assert.equal(thread.projectId, endpoint.projectId);
  assert.equal(thread.providerId, "claude-code");
  assert.equal(thread.archivedAt, null);
  const project = (await bbJson("project list")).find((p) => p.id === endpoint.projectId);
  assert.deepEqual(project.sources.map((s) => s.path), [home]);
  await waitStatus(endpoint.threadId, "idle");
  assert.equal((await bbJson(`thread show ${endpoint.threadId}`)).environment?.path ?? environment?.path, home);
  // --yolo is bb's full mode: the thread was started in it (bb's own record of the turn),
  // and the launch wrote no sandbox entry, since full mode has no sandbox.
  const started = (await bbJson(`thread log ${endpoint.threadId} --limit 5`)).find((event) => event.type === "client/turn/requested");
  assert.ok(started, "bb's log of the thread begins with the turn the spawn requested");
  assert.equal(started.data.execution.permissionMode, "full");

  // The env file: only what the launch carried, owner-only.
  const written = JSON.parse(await sh(`cat ${home}/.claude/settings.local.json`));
  assert.deepEqual(Object.keys(written), ["env"]);
  const { PATH, ...rest } = written.env;
  assert.deepEqual(rest, { OATS_INSTANCE: "t1", OATS_INSTANCE_HOME: home, CONTRACT_PROBE: "seen-by-the-hook", CONTRACT_AMBIENT: "" });
  assert.equal(PATH.split(":")[0], `${home}/.oats/bin`);
  assert.equal((await sh(`stat -c %a ${home}/.claude/settings.local.json`)).trim(), "600");
  // Claude ran the home's hook with that env, though bb passed none of it.
  const seen = await waitFor("the hook to run", async () => (await sh(`cat ${home}/hook-env.log 2>/dev/null || true`)).trim());
  // The env and the PATH prepend reached Claude's hook, and the name the launch unsets is
  // empty there, not the value bb's server carries.
  assert.equal(seen.split("\n")[0], "t1|seen-by-the-hook|shim-on-path|");
  // The rows of bb thread list carry what the one-thread-per-home rule reads.
  const row = (await bbJson("thread list --include-hidden")).find((r) => r.id === endpoint.threadId);
  assert.equal(row.environmentPath, home);
  assert.equal(row.archivedAt, null);
  assert.equal(row.deletedAt, null);
  assert.equal((await bbJson(`machine env list --project ${endpoint.projectId}`)).variables.length, 0, "nothing of the launch env is in bb's database");
  // TASK.md was the thread's prompt: the model was sent its text (the mock keeps each
  // request's body).
  assert.notEqual((await sh("grep -l 'TASK-t1 say hi' mock-req-*.json | head -1")).trim(), "");

  const inspect = await provider("inspect", { home, endpoint });
  assert.deepEqual(inspect.result, { present: true, state: "unknown", running: null, open: { label: "Open in bb", url: `${SERVER}/projects/${endpoint.projectId}/threads/${endpoint.threadId}` } });
});

test("T2 input to an idle, a stopped, a mid-tool and an errored thread answers sent and lands once", async () => {
  const { home, endpoint } = await launched("t2");
  const id = endpoint.threadId;
  await waitStatus(id, "idle");
  const tell = async (text) => {
    const answer = await provider("input", { home, endpoint, text });
    assert.deepEqual(answer.result, { submitted: true, verified: true }, `${text}: ${JSON.stringify(answer)}`);
  };
  const once = (marker) => waitFor(`${marker} to land`, async () => (await landed(marker)) >= 1).then(async () => {
    await waitStatus(id, "idle");
    assert.equal(await landed(marker), 1, `${marker} landed exactly once`);
  });

  // Without `unset`, bb's Claude does inherit what bb's server carries: T1's empty value is
  // the launch's doing.
  assert.match((await sh(`cat ${home}/hook-env.log`)).split("\n")[0], /\|from-the-bb-server$/);

  // idle
  await tell("T2-IDLE marker");
  await once("T2-IDLE");

  // stopped by the provider: bb shows idle again, and a tell restarts the thread
  assert.deepEqual((await provider("stop", { home, endpoint, graceSeconds: 10 })).result, { stopped: true });
  assert.equal(await threadStatus(id), "idle");
  await tell("T2-STOPPED marker");
  await once("T2-STOPPED");

  // mid-tool: a turn that runs an 8 s tool; the tell is steered into the turn
  await armTool("node -e \"setTimeout(()=>console.log('T2-SLEPT'),8000)\"");
  await tell("T2-TOOLSTART run the tool");
  await waitFor("the tool to be running", async () => (await threadStatus(id)) === "active" && (await sh("cat mock-next-cmd 2>/dev/null || true")) === "");
  await sleep(1_000);
  assert.deepEqual((await provider("inspect", { home, endpoint })).result.running, true);
  await tell("T2-MIDTOOL marker");
  await once("T2-MIDTOOL");
  assert.equal(await landed("T2-TOOLSTART"), 1);

  // a command the agent starts and leaves running: it inherits bb's BB_THREAD_ID, and is not
  // the thread's harness
  await armTool("cd / && setsid nohup sleep 900 >/dev/null 2>&1 & echo started");
  await tell("T2-STRAY marker");
  await once("T2-STRAY");
  assert.ok((await carriers(id)).includes("sleep"), "the stray command carries the thread's id");

  // error: the model endpoint refuses a turn; bb shows error, and keeps the thread's Claude
  // loaded: a process that carries the thread's id is still there, so the thread reads as
  // there and at rest (never a lost session, which the kernel would resume beside that
  // process); the next tell recovers the thread
  await sh("touch mock-error");
  await tell("T2-FAILS marker");
  await waitStatus(id, "error");
  assert.ok((await claudesIn(home)) >= 1, "bb released the Claude of a thread whose turn failed: the error rule may no longer be needed for Claude");
  assert.ok((await carriers(id)).includes("claude"), "the thread's Claude carries BB_THREAD_ID, under the name the provider looks for");
  const errored = await provider("inspect", { home, endpoint });
  assert.deepEqual({ present: errored.result.present, state: errored.result.state, running: errored.result.running }, { present: true, state: "unknown", running: null });
  await sh("rm mock-error");
  await tell("T2-ERROR marker");
  await once("T2-ERROR");

  // the other error: the turn failed and the thread's Claude is gone (stopped in bb): bb
  // still says error, no process carries the thread's id, and that is a lost session
  await sh("touch mock-error");
  await tell("T2-FAILS-AGAIN marker");
  await waitStatus(id, "error");
  await sh(`bb thread stop ${id} --json >/dev/null`);
  await waitFor("no Claude of the thread", async () => !(await carriers(id)).includes("claude"), { timeoutMs: 20_000 });
  // what the agent left running outlives it, and still carries the thread's id: it does not
  // make the thread present
  assert.ok((await carriers(id)).includes("sleep"), "the stray command is still there");
  assert.equal(await threadStatus(id), "error");
  const lost = await provider("inspect", { home, endpoint });
  assert.deepEqual({ present: lost.result.present, state: lost.result.state, running: lost.result.running }, { present: false, state: "stopped", running: false });
  await sh("rm mock-error");
  // an input to it is told: bb answers sent, starts Claude again in the same thread and
  // runs the turn, once (under the kernel, its counted resume of the lost session). A bb
  // that stops doing this fails here: the rule rests on it (contract r23, A14(3))
  await tell("T2-RESUMED marker");
  await once("T2-RESUMED");
  assert.ok((await carriers(id)).includes("claude"), "the thread's Claude runs again");
  await sh("pkill -f 'sleep 90[0]' || true");
});

const SANDBOX = {
  domains: [{ host: "app.aweb.ai", capability: "oats.aweb", setting: "server" }],
  write: [{ path: "/home/node/deployment/.agents/events", reason: "instance events" }],
};

/** A home whose first turn asks for a permission: accept-edits (a sandboxed mode, so the
 *  launch carries the sandbox allowances), and a scripted Bash call. */
async function waitingOnPermission(name, ranFile) {
  await armTool(`echo RAN > ${ranFile}`);
  const { home, endpoint } = await launched(name, { yolo: false, sandbox: SANDBOX, trees: [`/home/node/homes/${name}/work`], protected: [] }, { sandboxedModes: true });
  const pending = await waitFor("a pending interaction", async () => (await bbJson(`thread interactions list ${endpoint.threadId}`)).find((i) => i.status === "pending"));
  return { home, endpoint, pending };
}

test("T3 while an interaction is pending the provider refuses PROMPT_OPEN, and a raw tell leaves the interaction pending", async () => {
  const { home, endpoint, pending } = await waitingOnPermission("t3", "/tmp/t3-ran.txt");
  const id = endpoint.threadId;
  // The sandboxed launch wrote exactly the allowances it was handed, beside the env, and
  // Claude Code at the pinned bb started with them.
  assert.deepEqual(JSON.parse(await sh(`cat ${home}/.claude/settings.local.json`)).sandbox,
    { network: { allowedDomains: ["app.aweb.ai"] }, filesystem: { allowWrite: ["/home/node/deployment/.agents/events"] } });
  const sandboxedCheck = (input) => provider("check", input, SETTINGS, { sandboxedModes: true });
  // The provider keeps no record of a launch in the home: a plain check says what the
  // home's settings hold now (the sandbox block and both additions that keep Claude's
  // file tools in), and the check of the launch the kernel plans lists what that launch adds.
  assert.deepEqual((await sandboxedCheck({ home, soul: null })).result.warnings.map((w) => w.code), ["session-provider-sandbox-unsupported", "session-provider-sandboxed"]);
  assert.deepEqual((await sandboxedCheck({ home, soul: null, launch: { harness: "claude", yolo: false, args: [], sandbox: SANDBOX } })).result.warnings.map((w) => w.code), ["session-provider-sandbox-unsupported", "session-provider-sandbox", "session-provider-sandboxed"]);
  assert.equal((await sh(`ls -A ${home} | grep -c '^\\.oats-bb' || true`)).trim(), "0", "nothing of the provider's own in the home");
  // The check the kernel runs before a launch, with the launch it plans: a host the
  // deployment does not record refuses a sandboxed launch there, before anything starts.
  const planned = { home, soul: null, launch: { harness: "claude", yolo: false, args: [], sandbox: { ...SANDBOX, missing: [{ capability: "oats.aweb", setting: "services", team: "ops:acme.aweb.ai" }] } } };
  const plannedCheck = await sandboxedCheck(planned);
  assert.deepEqual(plannedCheck.result.problems.map((p) => p.code), ["E_BACKEND_SANDBOX_HOST"]);
  assert.equal(plannedCheck.result.status, "needs-configuration");
  // The provider's own command says, of that same planned launch, that it takes none in a sandboxed mode.
  assert.deepEqual((await provider("check", planned)).result.problems.map((p) => p.code), ["E_BACKEND_SANDBOXED_MODE"]);

  const answer = await provider("input", { home, endpoint, text: "T3-PROVIDER marker" });
  assert.equal(answer.ok, false);
  assert.equal(answer.error.code, "E_SESSION_PROMPT_OPEN");
  assert.match(answer.error.message, new RegExp(pending.id));
  assert.deepEqual(await bbJson(`thread queue list ${id}`), [], "the provider sent nothing");

  // The pin: a tell never answers or cancels a pending interaction (bb queues behind it).
  const raw = await bbJson(`thread tell ${id} --message-file - --mode auto`, { input: "T3-RAW marker" });
  assert.equal(raw.delivery, "queued");
  assert.equal(raw.queuedMessage.waitingOn.kind, "interaction");
  await sleep(2_000);
  const still = (await bbJson(`thread interactions list ${id}`)).find((i) => i.id === pending.id);
  assert.equal(still.status, "pending");
  assert.equal(still.resolvedAt, null);
  assert.equal((await sh("test -e /tmp/t3-ran.txt && echo ran || echo not-run")).trim(), "not-run", "the command that waits for approval did not run");
  assert.equal(await landed("T3-RAW"), 0);
  assert.equal(await landed("T3-PROVIDER"), 0);
  await provider("stop", { home, endpoint, graceSeconds: 10 });
});

test("T4 a queued tell is withdrawn: INPUT_QUEUED, and nothing lands later", async () => {
  const { home, endpoint, pending } = await waitingOnPermission("t4", "/tmp/t4-ran.txt");
  const id = endpoint.threadId;

  // The interaction opens between the provider's read and its tell (the shim hides it from
  // the read): bb queues the tell.
  const answer = await provider("input", { home, endpoint, text: "T4-QUEUED marker" }, { ...SETTINGS, cli: "/repo/test/contract/bb-hide-interactions.sh" });
  assert.equal(answer.ok, false, JSON.stringify(answer));
  assert.equal(answer.error.code, "E_SESSION_INPUT_QUEUED");
  assert.match(answer.error.message, /waiting on interaction.*withdrawn, so nothing was delivered/);
  assert.deepEqual(await bbJson(`thread queue list ${id}`), [], "the queued copy was deleted");

  // A person approves; the turn goes on and ends; the withdrawn message never arrives.
  await sh(`bb thread interactions approve ${pending.id} ${id} --json`);
  await waitFor("the approved command to run", async () => (await sh("test -e /tmp/t4-ran.txt && echo ran || true")).trim() === "ran");
  await waitStatus(id, "idle");
  await sleep(2_000);
  assert.equal(await landed("T4-QUEUED"), 0);
  // The thread still takes input: the same text, told again, lands once.
  assert.deepEqual((await provider("input", { home, endpoint, text: "T4-AGAIN marker" })).result, { submitted: true, verified: true });
  await waitFor("T4-AGAIN to land", async () => (await landed("T4-AGAIN")) === 1);
});

test("T5 stop, then inspect and input: bb has no stopped state, so the kernel's stoppedAt is what refuses (provider half)", async () => {
  const { home, endpoint } = await launched("t5");
  await waitStatus(endpoint.threadId, "idle");
  await armTool("node -e \"setTimeout(()=>console.log('T5-SLEPT'),30000)\"");
  assert.equal((await provider("input", { home, endpoint, text: "T5-BUSY run the tool" })).ok, true);
  await waitStatus(endpoint.threadId, "active");
  await waitFor("the tool to be running", async () => (await sh("cat mock-next-cmd 2>/dev/null || true")) === "");

  const stopped = await provider("stop", { home, endpoint, graceSeconds: 10 });
  assert.deepEqual(stopped.result, { stopped: true });
  // After the stop no process works in the home: bb released the thread's Claude and the
  // tool it ran (the kernel scans the home for such processes before it retires it).
  const working = async () => (await sh(`for p in /proc/[0-9]*; do readlink $p/cwd 2>/dev/null; done | grep -c '^${home}' || true`)).trim();
  await waitFor("no process to work in the home", async () => (await working()) === "0", { timeoutMs: 20_000 });
  // What the provider can say of a stopped thread is bb's word: settled, running unknown.
  // "stopped, input refused" is the kernel's answer from its own stoppedAt, without calling
  // the provider (contract item 1; spec K1 T4).
  const inspect = await provider("inspect", { home, endpoint });
  assert.deepEqual({ present: inspect.result.present, state: inspect.result.state, running: inspect.result.running }, { present: true, state: "unknown", running: null });
  // The retire hook then archives the thread; after that nothing live runs in the home.
  // A stop with no endpoint (the kernel after a launch whose answer was lost) finds the
  // home's thread by itself, and has nothing left to stop.
  assert.deepEqual((await provider("stop", { home, endpoint: null, graceSeconds: 10 })).result, { stopped: true });
  const retired = JSON.parse((await sh(`OATS_INSTANCE_HOME=${home} OATS_SETTINGS='${JSON.stringify(SETTINGS)}' node ${PROVIDER} retire-hook`)).trim().split("\n").pop());
  assert.deepEqual(retired, { meta: { retired: true, archived: [endpoint.threadId] } });
  assert.notEqual((await bbJson(`thread show ${endpoint.threadId}`)).thread.archivedAt, null);
  // An archived thread is no longer the home's session: bb refuses a tell to it, so the
  // provider reads it as missing (a person archiving it in bb's UI gives the same).
  assert.deepEqual((await provider("inspect", { home, endpoint })).result, { present: false, state: "stopped", running: false });
  const told = await provider("input", { home, endpoint, text: "T5-ARCHIVED marker" });
  assert.equal(told.ok, false);
  assert.equal(told.error.code, "E_SESSION_INPUT_FAILED");
  assert.match(told.error.message, /archived/i);
  assert.equal(await landed("T5-ARCHIVED"), 0);
});

// What the kernel relies on after a spawn that died while the launch ran: its receipt says
// a launch was sent and holds no endpoint, so its stop, start and retire first call stop
// with `endpoint: null`: "stop whatever live session is rooted at this home".
test("a launch whose caller is killed mid-launch: stop with no endpoint finds the home's thread, stops it, and archives it when told when the launch was sent", async () => {
  const home = await makeHome("killed");
  const request = { schemaVersion: 1, wire: "1.3", phase: "session", capability: "oats.bb", provider: "bb", verb: "launch", input: launchInput(home, "killed") };
  await sh("rm -f slow-spawn-made killed-launch.out && cat > killed-launch.json", { input: JSON.stringify(request) });
  // What the kernel's receipt holds: the time the launch was sent, taken just before it.
  const launchSent = new Date().toISOString();
  // The kill takes the provider and the bb call it was waiting on (the shim, holding bb's
  // answer): the provider keeps its bb calls in its own process group, the one the kernel
  // kills. bb's server has made the thread by then, and nothing of OATS knows its id.
  const settings = { ...SETTINGS, cli: "/repo/test/contract/bb-slow-spawn.sh" };
  await sh(`OATS_CAPABILITY=oats.bb OATS_BACKEND=bb OATS_SETTINGS='${JSON.stringify(settings)}' setsid sh -c 'echo $$ > killed-launch.pid; exec node ${PROVIDER} session launch < killed-launch.json > killed-launch.out 2>&1' < /dev/null > /dev/null 2>&1 &`);
  await waitFor("bb to have made the thread", async () => (await sh("test -e slow-spawn-made && echo made || true")).trim() === "made", { timeoutMs: 120_000 });
  await sh("kill -KILL -$(cat killed-launch.pid)");
  await waitFor("the killed launch to be gone", async () => (await sh("kill -0 $(cat killed-launch.pid) 2>/dev/null && echo alive || echo gone")).trim() === "gone");
  assert.equal(await sh("cat killed-launch.out"), "", "the launch answered nothing: the kernel has no endpoint");

  // bb did start a thread in the home, and nothing of OATS knows its id.
  const project = (await bbJson("project list")).find((p) => p.sources.some((s) => s.path === home));
  assert.ok(project, "the killed launch made the home's project");
  const live = async () => (await bbJson("thread list --include-hidden")).filter((thread) => thread.projectId === project.id && !thread.archivedAt && !thread.deletedAt);
  const [thread] = await live();
  assert.ok(thread, "and a live thread in it");

  assert.deepEqual((await provider("stop", { home, endpoint: null, graceSeconds: 30 })).result, { stopped: true });
  assert.ok(["idle", "pending", "error"].includes(await threadStatus(thread.id)), "the thread the stop found is settled");
  const working = async () => (await sh(`for p in /proc/[0-9]*; do readlink $p/cwd 2>/dev/null; done | grep -c '^${home}' || true`)).trim();
  await waitFor("no process to work in the home", async () => (await working()) === "0", { timeoutMs: 20_000 });
  // The same call again, and for a home bb never saw: stopped, with nothing to stop.
  assert.deepEqual((await provider("stop", { home, endpoint: null, graceSeconds: 10 })).result, { stopped: true });
  assert.deepEqual((await provider("stop", { home: "/home/node/homes/never-launched", endpoint: null, graceSeconds: 10 })).result, { stopped: true });
  // With no time of the failed launch (a kernel that sends none), the thread is stopped and
  // stays: it may be a person's. A start then says it is in the way (one home, one thread).
  const again = await provider("launch", launchInput(home, "killed"));
  assert.equal(again.error.code, "E_SESSION_START_FAILED");
  assert.match(again.error.message, new RegExp(thread.id));
  // With that time, a thread made at or after it is the failed launch's: stopped and
  // archived. bb's createdAt is a number of milliseconds, which is what is compared.
  assert.equal(typeof thread.createdAt, "number");
  assert.ok(thread.createdAt >= Date.parse(launchSent) && thread.createdAt < Date.now(), `bb's createdAt ${thread.createdAt} is a time in milliseconds since ${launchSent}`);
  assert.deepEqual((await provider("stop", { home, endpoint: null, graceSeconds: 10, launchSent: new Date().toISOString() })).result, { stopped: true });
  assert.equal((await live()).length, 1, "a thread older than the time given is not archived");
  assert.deepEqual((await provider("stop", { home, endpoint: null, graceSeconds: 10, launchSent })).result, { stopped: true });
  assert.deepEqual(await live(), []);
  assert.notEqual((await bbJson(`thread show ${thread.id}`)).thread.archivedAt, null);
  // So the start that follows launches, and the home has its one thread.
  const started = await provider("launch", launchInput(home, "killed"));
  assert.equal(started.ok, true, JSON.stringify(started));
  await waitStatus(started.result.endpoint.threadId, "idle");
  const retired = JSON.parse((await sh(`OATS_INSTANCE_HOME=${home} OATS_SETTINGS='${JSON.stringify(SETTINGS)}' node ${PROVIDER} retire-hook`)).trim().split("\n").pop());
  assert.deepEqual(retired, { meta: { retired: true, archived: [started.result.endpoint.threadId] } });
  assert.deepEqual(await live(), []);
});

// Owner of this half: the kernel's suite (spec K1, its T4: after an OATS stop the kernel
// answers stopped and refuses input from its own stoppedAt, without calling the provider).
// This repository adds the joint run, kernel and provider together, to this contract
// test once the kernel's session-provider contract is merged; until then this stays a
// todo, so the gap is visible in every run.
test("T5 via the kernel: after oats instance stop, session inspect answers stopped and session input is refused", { todo: "owned by the kernel's suite (K1 T4); the joint kernel-and-provider run is added here once K1 merges. The provider half is the test above" }, () => {});

// What bb's concurrency limit holds in line is not stopped by `bb thread stop`: bb starts
// the held turn by itself when a slot frees. Found in a real run: an agent OATS had
// stopped ran its task afterwards.
test("a turn bb holds in line: inspect reads the thread running, and a stop or a retire withdraws the turn so it never runs", async () => {
  await sh("bb concurrency-limit global 1 --json");
  try {
    // One home busy in its only slot.
    const busy = await launched("queue-busy");
    await waitStatus(busy.endpoint.threadId, "idle");
    await armTool("node -e \"setTimeout(()=>console.log('QUEUE-SLEPT'),60000)\"");
    assert.equal((await provider("input", { home: busy.home, endpoint: busy.endpoint, text: "QUEUE-BUSY run the tool" })).ok, true);
    await waitStatus(busy.endpoint.threadId, "active");
    await waitFor("the tool to be running", async () => (await sh("cat mock-next-cmd 2>/dev/null || true")) === "");

    // A second home is launched behind it: bb makes the thread and holds its first turn.
    const held = await launched("queue-held");
    const row = async () => (await bbJson("thread list --include-hidden")).find((thread) => thread.id === held.endpoint.threadId);
    await waitFor("bb to hold the second home's turn in line", async () => (await row()).queuedWork === "waiting");
    assert.equal((await row()).status, "pending");
    const queue = await bbJson(`thread queue list ${held.endpoint.threadId}`);
    assert.equal(queue.length, 1);
    assert.equal(queue[0].waitingOn.pluginId, "concurrency-limit");
    const inspect = (await provider("inspect", { home: held.home, endpoint: held.endpoint })).result;
    assert.deepEqual({ present: inspect.present, state: inspect.state, running: inspect.running }, { present: true, state: "unknown", running: true }, "a held turn is work that will run: not a thread at rest");

    // OATS stops it: nothing of it is left to run.
    assert.deepEqual((await provider("stop", { home: held.home, endpoint: held.endpoint, graceSeconds: 10 })).result, { stopped: true });
    assert.deepEqual(await bbJson(`thread queue list ${held.endpoint.threadId}`), [], "the held turn was withdrawn");
    assert.equal((await row()).queuedWork, "none");

    // A third home, held the same way, is retired instead of stopped: the retire hook
    // withdraws its held turn before it archives the thread.
    const retiring = await launched("queue-retired");
    const retiringRow = async () => (await bbJson("thread list --include-hidden --include-archived")).find((thread) => thread.id === retiring.endpoint.threadId);
    await waitFor("bb to hold the third home's turn in line", async () => (await retiringRow()).queuedWork === "waiting");
    const retired = JSON.parse((await sh(`OATS_INSTANCE_HOME=${retiring.home} OATS_SETTINGS='${JSON.stringify(SETTINGS)}' node ${PROVIDER} retire-hook`)).trim().split("\n").pop());
    assert.deepEqual(retired, { meta: { retired: true, archived: [retiring.endpoint.threadId] } });
    assert.deepEqual(await bbJson(`thread queue list ${retiring.endpoint.threadId}`), [], "the held turn was withdrawn before the archive");
    assert.notEqual((await retiringRow()).archivedAt, null);

    // The slot frees, and the limit goes: neither home's task ever reaches the model.
    assert.deepEqual((await provider("stop", { home: busy.home, endpoint: busy.endpoint, graceSeconds: 10 })).result, { stopped: true });
    await sh("bb concurrency-limit global unlimited --json");
    await sleep(8_000);
    assert.equal(await landed("TASK-queue-held"), 0, "a stopped agent ran its task");
    assert.equal(await landed("TASK-queue-retired"), 0, "a retired agent ran its task");
    assert.equal(await processesIn(held.home), 0);
    assert.equal(await processesIn(retiring.home), 0);
  } finally {
    await sh("bb concurrency-limit global unlimited --json");
  }
});

// A thread archived in bb keeps its Claude process, in the home, and bb shows nothing that
// says so. Found in a real run: a start then made a second Claude in the home, and a
// retire was refused for the process that worked there.
test("a thread archived in bb keeps its Claude: a start, a stop and a retire each leave none of it in the home", async () => {
  const first = await launched("archived");
  const home = first.home;
  await waitStatus(first.endpoint.threadId, "idle");
  // A person archives it in bb. The process stays (this is bb's behaviour, pinned here).
  await sh(`bb thread archive ${first.endpoint.threadId} --json`);
  await sleep(2_000);
  assert.equal(await claudesIn(home), 1, "bb released an archived thread's Claude by itself: the sweep may no longer be needed");
  assert.deepEqual((await provider("inspect", { home, endpoint: first.endpoint })).result, { present: false, state: "stopped", running: false });

  // A start: the archived thread is stopped before the new one is made. One Claude, not two.
  const second = await provider("launch", launchInput(home, "archived", { previous: first.endpoint }));
  assert.equal(second.ok, true, JSON.stringify(second));
  started.push(second.result.endpoint.threadId);
  await waitStatus(second.result.endpoint.threadId, "idle");
  // The old thread's process ends a moment after bb is asked: then one Claude, not two.
  await waitFor("one Claude in the home, not two", async () => (await claudesIn(home)) === 1, { timeoutMs: 20_000 });

  // A stop of a thread that was archived in bb, by its endpoint: its process goes.
  await sh(`bb thread archive ${second.result.endpoint.threadId} --json`);
  await waitFor("one Claude in the home", async () => (await claudesIn(home)) === 1, { timeoutMs: 20_000 });
  assert.deepEqual((await provider("stop", { home, endpoint: second.result.endpoint, graceSeconds: 10 })).result, { stopped: true });
  await waitFor("no process to work in the home", async () => (await processesIn(home)) === 0, { timeoutMs: 20_000 });

  // And a stop with no endpoint, and the retire hook, find the home's archived threads themselves.
  const third = await provider("launch", launchInput(home, "archived", { previous: second.result.endpoint }));
  assert.equal(third.ok, true, JSON.stringify(third));
  started.push(third.result.endpoint.threadId);
  await waitStatus(third.result.endpoint.threadId, "idle");
  await sh(`bb thread archive ${third.result.endpoint.threadId} --json`);
  await waitFor("one Claude in the home", async () => (await claudesIn(home)) === 1, { timeoutMs: 20_000 });
  assert.deepEqual((await provider("stop", { home, endpoint: null, graceSeconds: 10 })).result, { stopped: true });
  await waitFor("no process to work in the home", async () => (await processesIn(home)) === 0, { timeoutMs: 20_000 });
  const fourth = await provider("launch", launchInput(home, "archived", { previous: third.result.endpoint }));
  assert.equal(fourth.ok, true, JSON.stringify(fourth));
  await waitStatus(fourth.result.endpoint.threadId, "idle");
  await sh(`bb thread archive ${fourth.result.endpoint.threadId} --json`);
  await waitFor("one Claude in the home", async () => (await claudesIn(home)) === 1, { timeoutMs: 20_000 });
  const retired = JSON.parse((await sh(`OATS_INSTANCE_HOME=${home} OATS_SETTINGS='${JSON.stringify(SETTINGS)}' node ${PROVIDER} retire-hook`)).trim().split("\n").pop());
  assert.deepEqual(retired, { meta: { retired: false, reason: "nothing-to-delete" } }, "nothing live to archive");
  await waitFor("no process to work in the home", async () => (await processesIn(home)) === 0, { timeoutMs: 20_000 });
});

test("T6 a second live thread in the home's project is reported by inspect, and refuses a launch", async () => {
  const { home, endpoint } = await launched("t6");
  await waitStatus(endpoint.threadId, "idle");
  const second = await bbJson(`thread spawn --project ${endpoint.projectId} --provider claude-code --model ${MODEL} --environment ${home} --prompt second --permission-mode full`);

  const inspect = await provider("inspect", { home, endpoint });
  assert.equal(inspect.ok, false);
  assert.equal(inspect.error.code, "E_SESSION_UNAVAILABLE");
  assert.match(inspect.error.message, new RegExp(`${endpoint.threadId}.*${second.id}`));
  const many = await provider("inspectMany", { homes: [{ home, endpoint }] });
  assert.equal(many.result.results[0].error.code, "E_SESSION_UNAVAILABLE");

  const again = await provider("launch", launchInput(home, "t6", { previous: endpoint }));
  assert.equal(again.ok, false);
  assert.equal(again.error.code, "E_SESSION_START_FAILED");
  assert.match(again.error.message, new RegExp(second.id));

  // With the stray thread archived, the home reads normally again and a start replaces
  // the previous thread.
  await waitStatus(second.id, "idle");
  await sh(`bb thread archive ${second.id} --json`);
  assert.equal((await provider("inspect", { home, endpoint })).result.present, true);
  const restarted = await provider("launch", launchInput(home, "t6", { previous: endpoint }));
  assert.equal(restarted.ok, true, JSON.stringify(restarted));
  assert.equal(restarted.result.endpoint.projectId, endpoint.projectId);
  assert.notEqual(restarted.result.endpoint.threadId, endpoint.threadId);
  assert.notEqual((await bbJson(`thread show ${endpoint.threadId}`)).thread.archivedAt, null, "the previous thread was archived");
});

test("T8 a bb of another version than the pin: E_BACKEND_VERSION at readiness and at launch", async () => {
  const pinned = { ...SETTINGS, version: "0.49.0" };
  const result = (await check(pinned)).result;
  assert.equal(result.status, "needs-configuration");
  assert.deepEqual(result.problems.map((p) => p.code), ["E_BACKEND_VERSION"]);
  assert.match(result.problems[0].message, new RegExp(`bb is ${BB_VERSION.replaceAll(".", "\\.")}.*pins 0\\.49\\.0`));

  const home = await makeHome("t8");
  const answer = await provider("launch", launchInput(home, "t8"), pinned);
  assert.equal(answer.ok, false);
  assert.equal(answer.error.code, "E_BACKEND_VERSION");
  assert.equal((await bbJson("project list")).some((p) => p.sources.some((s) => s.path === home)), false, "nothing was created");
  assert.equal((await sh(`test -e ${home}/.claude/settings.local.json && echo yes || echo no`)).trim(), "no");
});

test("T9 a live thread whose project root is gone is reported by readiness as orphaned", async () => {
  const { home, endpoint } = await launched("t9");
  await waitStatus(endpoint.threadId, "idle");
  assert.deepEqual((await check()).result.warnings.filter((w) => w.message.includes(endpoint.threadId)), []);
  // What an older kernel's retire leaves: the home removed, the thread never archived.
  await sh(`rm -rf ${home}`);
  const result = (await check()).result;
  const orphan = result.warnings.find((w) => w.message.includes(endpoint.threadId));
  assert.equal(orphan.code, "session-provider-orphaned");
  assert.match(orphan.message, new RegExp(home));
  assert.equal(result.status, "ready");
  await sh(`bb thread archive ${endpoint.threadId} --json`);
  assert.equal((await check()).result.warnings.some((w) => w.message.includes(endpoint.threadId)), false, "archived, it is no longer reported");
});

test("launch runs the provider's readiness first: a bb whose Claude is not signed in refuses with E_BACKEND_NOT_READY, bb's word in it", async () => {
  // A second bb server with no credential for Claude at all (no mock key in its environment).
  await run("docker", ["exec", "-d", NAME, "sh", "-c",
    "cd ~ && env -u ANTHROPIC_API_KEY -u ANTHROPIC_BASE_URL bb-app --data-dir ~/bbdata-signed-out --server-bind-host 127.0.0.1 --server-port 58886 --host-daemon-port 58887 --no-in-app-updates > bb-app-signed-out.out 2>&1"]);
  const signedOut = { ...SETTINGS, server: "http://127.0.0.1:58886", daemon: "http://127.0.0.1:58887" };
  try {
  // This wait has timed out twice in some ten runs with no cause found: when it does, say
  // what that bb printed and what its daemon answered, so the next one is read, not rerun.
  await waitFor("the signed-out bb's daemon to connect", async () => (await sh("curl -s -m 2 http://127.0.0.1:58887/status || true")).includes('"connected":true'), { timeoutMs: 180_000, everyMs: 1_000 })
    .catch(async (error) => { throw new Error(`${error.message}. Its daemon answered: ${(await said("curl -s -m 2 http://127.0.0.1:58887/status || echo nothing")).slice(0, 300)}. bb-app printed: ${(await said("tail -c 1500 bb-app-signed-out.out 2>&1 || true"))}. Its processes: ${await said(BB_PROCESSES)}`, { cause: error }); });

  const result = (await check(signedOut)).result;
  assert.deepEqual(result.problems.map((p) => p.code), ["E_BACKEND_NOT_READY"]);
  assert.match(result.problems[0].message, /claude-code provider as unauthenticated/);
  assert.equal(result.status, "authorization-required");

  const home = await makeHome("signed-out");
  const answer = await provider("launch", launchInput(home, "signed-out"), signedOut);
  assert.equal(answer.ok, false);
  assert.equal(answer.error.code, "E_BACKEND_NOT_READY");
  assert.match(answer.error.message, /unauthenticated/);
  assert.deepEqual(JSON.parse(await sh("BB_SERVER_URL=http://127.0.0.1:58886 bb thread list --json")), [], "nothing was started");
  assert.deepEqual(JSON.parse(await sh("BB_SERVER_URL=http://127.0.0.1:58886 bb project list --json")), [], "nothing was created");
  assert.equal((await sh(`test -e ${home}/.claude/settings.local.json && echo yes || echo no`)).trim(), "no");
  } finally {
    // A stop that fails says so, and never replaces the error the test body threw.
    await stopExtraBb("bbdata-signed-out").catch((error) => console.error(`the signed-out bb did not stop: ${error.message}`));
  }
});

// Last: it starts another bb server, bound to every address, beside the first.
test("T7 a bb bound to 0.0.0.0: E_BACKEND_EXPOSED at readiness and at launch", async () => {
  await run("docker", ["exec", "-d", "-e", "ANTHROPIC_BASE_URL=http://127.0.0.1:9999", "-e", "ANTHROPIC_API_KEY=dummy-not-a-real-key", NAME, "sh", "-c",
    "cd ~ && bb-app --data-dir ~/bbdata-exposed --server-bind-host 0.0.0.0 --server-port 48886 --host-daemon-port 48887 --no-in-app-updates > bb-app-exposed.out 2>&1"]);
  const exposed = { ...SETTINGS, server: "http://127.0.0.1:48886", daemon: "http://127.0.0.1:48887" };
  // It has timed out on a CI runner with no cause seen: when it does, say what that bb printed, what it answered and
  // what its processes wait on, so the next one is read, not rerun.
  await waitFor("the second bb to answer", async () => (await sh("curl -s -m 2 http://127.0.0.1:48886/health || true")).includes('"ok":true'), { timeoutMs: 240_000, everyMs: 1_000 })
    .catch(async (error) => { throw new Error(`${error.message}. It answered: ${(await said("curl -s -m 2 http://127.0.0.1:48886/health || echo nothing")).slice(0, 300)}. bb-app printed: ${(await said("tail -c 1500 bb-app-exposed.out 2>&1 || true"))}. Its processes: ${await said(BB_PROCESSES)}`, { cause: error }); });

  const result = (await check(exposed)).result;
  assert.ok(result.problems.some((p) => p.code === "E_BACKEND_EXPOSED"), JSON.stringify(result));
  assert.match(result.problems.find((p) => p.code === "E_BACKEND_EXPOSED").message, /:48886/);
  assert.equal(result.status, "needs-configuration");

  const home = await makeHome("t7");
  const answer = await provider("launch", launchInput(home, "t7"), exposed);
  assert.equal(answer.ok, false);
  assert.equal(answer.error.code, "E_BACKEND_EXPOSED");
  assert.deepEqual(JSON.parse(await sh("BB_SERVER_URL=http://127.0.0.1:48886 bb thread list --json")), [], "no thread was started on the exposed server");
  // The first server, on loopback, still reads ready.
  assert.equal((await check()).result.status, "ready");
});
