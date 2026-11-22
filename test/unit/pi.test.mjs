// pi as a harness: the same launch with bb's pi provider, and nothing of Claude's.
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { PATH_WITHOUT_BWRAP, VERSION, call, fakeBackend, fakeBbIn, projectRow, scratch, threadRow } from "../fixtures/harness.mjs";

const PI_MODEL = "github-copilot/claude-fable-5.2";
// bb-app 0.50.1's answer to every `bb machine env` command: the names, never a value.
const envList = (names) => ({ builtInGit: { status: "not logged in" }, variables: names.map((name) => ({ name, value: null, secret: true, note: null })), inheritedVariables: [] });
const entry = (name, value, extra = {}) => ({ name, value, source: "kernel", ...extra });
const verbs = (bb) => bb.calls().map((c) => (c.argv[0] === "--version" ? "--version" : c.argv[1] === "list" && c.argv.includes("--archived") ? "thread list --archived" : c.argv.slice(0, c.argv[0] === "machine" ? 3 : 2).join(" ")));

async function setup(t, script = {}, backendOverrides = {}) {
  const { dir, home } = scratch(t);
  const backend = await fakeBackend(t, backendOverrides);
  const bb = fakeBbIn(dir, {
    "--version": { stdout: `${VERSION}\n` },
    "project list": { stdout: [projectRow("proj_a", home)] },
    "thread list": { stdout: [] },
    "thread stop": { stdout: { ok: true } },
    "thread show": { stdout: { thread: threadRow("thr_prev", "proj_a", "idle", { providerId: "pi" }), environment: null, pendingTodos: null } },
    "thread spawn": { stdout: { id: "thr_new", projectId: "proj_a", environmentId: null, providerId: "pi", status: "starting" } },
    "machine env list": { stdout: envList([]) },
    "machine env set": { stdout: envList([]) },
    "machine env unset": { stdout: envList([]) },
    ...(typeof script === "function" ? script(home) : script),
  });
  const input = (extra = {}) => ({ home, instance: "dev-a", harness: "pi", model: PI_MODEL, yolo: true, env: [entry("OATS_INSTANCE", "dev-a"), entry("OATS_INSTANCE_HOME", home)], unset: [], args: [], promptFile: join(home, "TASK.md"), previous: null, ...extra });
  const run = (extra, options = {}) => call("launch", input(extra), { settings: backend.settings(), bb, ...options });
  const check = (launch) => call("check", { home, soul: null, ...(launch ? { launch } : {}) }, { settings: backend.settings(), bb });
  return { dir, home, backend, bb, run, check, input };
}

test("a pi launch spawns bb's pi provider with the launch's model as it is, in the home's project", async (t) => {
  const { home, backend, bb, run } = await setup(t);
  const answer = await run();
  assert.deepEqual(answer.result, { endpoint: { server: backend.server, projectId: "proj_a", threadId: "thr_new" } });
  const spawn = bb.calls().find((c) => c.argv[1] === "spawn");
  assert.deepEqual(spawn.argv, ["thread", "spawn", "--project", "proj_a", "--provider", "pi", "--model", PI_MODEL,
    "--environment", home, "--prompt-file", join(home, "TASK.md"), "--permission-mode", "full", "--title", "dev-a", "--json"]);
});

test("a pi launch asks bb for its pi provider's state, not Claude's", async (t) => {
  // bb's Claude is signed out: that holds up no pi launch.
  const { backend, run } = await setup(t, {}, { provider: { providerId: "claude-code", status: "unauthenticated", loginCommand: "claude auth login" } });
  assert.equal((await run()).ok, true);
  assert.deepEqual(backend.requests, ["/health", "/api/v1/system/providers/state?providerId=pi"]);
});

for (const [status, word] of [["not_installed", "not_installed"], ["unauthenticated", "unauthenticated"], ["unsupported_version", "unsupported_version"]]) {
  test(`bb's pi provider ${status} refuses a pi launch before any effect: E_BACKEND_NOT_READY with bb's word`, async (t) => {
    const { bb, run } = await setup(t, {}, { piProvider: { providerId: "pi", status, statusMessage: null, loginCommand: "pi" } });
    const answer = await run();
    assert.equal(answer.error.code, "E_BACKEND_NOT_READY");
    assert.match(answer.error.message, new RegExp(`bb reports its pi provider as ${word}`));
    assert.deepEqual(verbs(bb), ["--version"]);
  });
}

test("a pi launch writes nothing of Claude's: no .claude is made, and one that is there is left byte for byte", async (t) => {
  const { home, run } = await setup(t);
  assert.equal((await run()).ok, true);
  assert.equal(existsSync(join(home, ".claude")), false);
  // A home that ran Claude on bb before: the provider's own keys there are not rewritten, and not removed.
  mkdirSync(join(home, ".claude"));
  const before = JSON.stringify({ env: { OATS_INSTANCE: "stale" }, permissions: { allow: ["Bash(ls)"] } });
  writeFileSync(join(home, ".claude/settings.local.json"), before, { mode: 0o644 });
  assert.equal((await run()).ok, true);
  assert.equal(readFileSync(join(home, ".claude/settings.local.json"), "utf8"), before);
});

test("a pi launch does not read Claude's settings: a settings.local.json that is not JSON refuses a Claude launch, not a pi one", async (t) => {
  const { home, run } = await setup(t);
  mkdirSync(join(home, ".claude"));
  writeFileSync(join(home, ".claude/settings.local.json"), "{ not json");
  assert.equal((await run()).ok, true);
  assert.equal((await run({ harness: "claude", model: "claude-opus-5-5" })).ok, false);
});

for (const [name, args] of [
  ["an argument of pi's own", ["--thinking", "high"]],
  ["Claude's --permission-mode, which a Claude launch carries", ["--permission-mode", "bypassPermissions"]],
  ["--permission-mode in one word", ["--permission-mode=bypassPermissions"]],
  ["a session name", ["--name", "dev-a"]],
]) {
  test(`every launch argument is refused for pi, ${name}: E_BACKEND_LAUNCH_ARG naming it, bb never called`, async (t) => {
    const { bb, run, check } = await setup(t);
    const answer = await run({ args });
    assert.equal(answer.error.code, "E_BACKEND_LAUNCH_ARG");
    assert.ok(answer.error.message.includes(JSON.stringify(args[0])), answer.error.message);
    assert.match(answer.error.message, /bb starts pi itself/);
    assert.deepEqual(bb.calls(), []);
    // The check says the same of the planned launch.
    assert.deepEqual((await check({ harness: "pi", yolo: true, args })).result.problems.map((p) => p.code), ["E_BACKEND_LAUNCH_ARG"]);
  });
}

test("a pi launch's args that are not a list: E_BACKEND_LAUNCH_ARG", async (t) => {
  const { run } = await setup(t);
  assert.equal((await run({ args: "--approve" })).error.code, "E_BACKEND_LAUNCH_ARG");
});

for (const [name, yolo] of [["yolo false", false], ["no choice", null]]) {
  test(`a pi launch with ${name} is refused, whatever the command offers Claude: bb's pi has full mode only`, async (t) => {
    const { bb, run, check } = await setup(t);
    for (const sandboxedModes of [false, true]) {
      const answer = await run({ yolo }, { sandboxedModes });
      assert.equal(answer.error.code, "E_BACKEND_SANDBOXED_MODE");
      assert.match(answer.error.message, /bb runs pi in its full mode only/);
      assert.match(answer.error.message, /--yolo/);
      assert.doesNotMatch(answer.error.message, /bypassPermissions/, "a remedy pi cannot take is not named");
    }
    assert.deepEqual(bb.calls(), []);
    const planned = await check({ harness: "pi", yolo, args: [] });
    assert.deepEqual(planned.result.problems.map((p) => p.code), ["E_BACKEND_SANDBOXED_MODE"]);
    assert.equal(planned.result.status, "needs-configuration");
  });
}

test("the check of a planned pi launch reads bb's pi provider: ready with a full-mode launch, a problem when bb's pi is not", async (t) => {
  const { backend, bb, check } = await setup(t, {}, { provider: { providerId: "claude-code", status: "unauthenticated", loginCommand: "claude auth login" } });
  const ready = await check({ harness: "pi", yolo: true, args: [] });
  assert.equal(ready.result.status, "ready", JSON.stringify(ready.result));
  assert.deepEqual(ready.result.problems, []);
  assert.ok(!backend.requests.includes("/api/v1/system/providers/state?providerId=claude-code"));
  // On a host with no bubblewrap, which a planned Claude launch is told of: Claude's sandbox is nothing a pi launch runs in.
  const bare = (launch) => call("check", { home: null, soul: null, launch }, { settings: backend.settings(), bb, env: { PATH: PATH_WITHOUT_BWRAP } });
  assert.deepEqual((await bare({ harness: "pi", yolo: true, args: [] })).result.warnings, []);
  assert.deepEqual((await bare({ harness: "claude", yolo: true, args: [] })).result.warnings.map((warning) => warning.code), ["session-provider-sandbox-unsupported"]);
  backend.state.piProvider = { providerId: "pi", status: "not_installed", statusMessage: null };
  const not = await check({ harness: "pi", yolo: true, args: [] });
  assert.equal(not.result.status, "needs-configuration");
  assert.deepEqual(not.result.problems.map((p) => p.code), ["E_BACKEND_NOT_READY"]);
  // A planned Claude launch is held up by Claude's state, as before, and not by pi's.
  const claude = await check({ harness: "claude", yolo: true, args: [] });
  assert.equal(claude.result.status, "authorization-required");
  assert.match(claude.result.problems[0].message, /claude-code provider as unauthenticated/);
});

test("the manifest offers both harnesses", () => {
  const manifest = JSON.parse(readFileSync(new URL("../../oats-package/capabilities/oats-bb/oats.json", import.meta.url), "utf8"));
  assert.deepEqual(manifest.sessionProviders.bb.harnesses, ["claude", "pi"]);
});
