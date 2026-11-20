// launch: one home, one bb project, one bb thread; every refusal before the first effect.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { launch } from "../../oats-package/capabilities/oats-bb/lib/launch.mjs";
import { readSettings } from "../../oats-package/capabilities/oats-bb/lib/settings.mjs";
import { PATH_WITH_BWRAP, UNREACHABLE, VERSION, call, fakeBackend, fakeBbIn, projectRow, requestFor, runBin, scratch, threadRow } from "../fixtures/harness.mjs";

// A thread bb made after the launch asked for it: the fake's rows are written before the
// launch runs, so "after" is a time well ahead.
const MADE = { createdAt: Date.now() + 3_600_000 };
const spawned = (id = "thr_new") => ({ stdout: { id, projectId: "proj_a", environmentId: null, providerId: "claude-code", status: "starting" } });
const entry = (name, value, extra = {}) => ({ name, value, source: "kernel", ...extra });
const EFFECTS = new Set(["project create", "thread spawn", "thread archive", "thread stop", "thread tell"]);
// The calls by name; the read of a project's archived threads is named apart from the plain list.
const verbs = (bb) => bb.calls().map((c) => (c.argv[0] === "--version" ? "--version" : c.argv[1] === "list" && c.argv.includes("--archived") ? "thread list --archived" : c.argv.slice(0, 2).join(" ")));
const effects = (bb) => verbs(bb).filter((verb) => EFFECTS.has(verb));

async function setup(t, script = {}, backendOverrides = {}) {
  const { dir, home } = scratch(t);
  const backend = await fakeBackend(t, backendOverrides);
  const bb = fakeBbIn(dir, {
    "--version": { stdout: `${VERSION}\n` },
    "project list": { stdout: [projectRow("proj_a", home)] },
    "thread list": { stdout: [] },
    "thread stop": { stdout: { ok: true } },
    // A thread at rest, for the launch's stop of the home's previous thread.
    "thread show": { stdout: { thread: threadRow("thr_prev", "proj_a", "idle"), environment: null, pendingTodos: null } },
    "thread spawn": spawned(),
    ...(typeof script === "function" ? script(home) : script),
  });
  const input = (extra = {}) => ({ home, instance: "dev-a", harness: "claude", model: "claude-opus-5-5", yolo: true, env: [entry("OATS_INSTANCE", "dev-a"), entry("OATS_INSTANCE_HOME", home)], args: [], promptFile: join(home, "TASK.md"), previous: null, ...extra });
  const run = (extra, settings = {}) => call("launch", input(extra), { settings: backend.settings(settings), bb });
  // The same launch with bb's sandboxed modes taken, which the command refuses for now.
  const runSandboxed = (extra) => call("launch", input(extra), { settings: backend.settings(), bb, sandboxedModes: true });
  return { dir, home, backend, bb, run, runSandboxed, input };
}
const localSettings = (home) => JSON.parse(readFileSync(join(home, ".claude/settings.local.json"), "utf8"));

test("launch spawns one thread in the home's project and answers its endpoint", async (t) => {
  const { home, backend, bb, run } = await setup(t);
  const answer = await run();
  assert.deepEqual(answer, { schemaVersion: 1, phase: "session", capability: "oats.bb", provider: "bb", verb: "launch", ok: true,
    result: { endpoint: { server: backend.server, projectId: "proj_a", threadId: "thr_new" } } });
  const spawn = bb.calls().find((c) => c.argv[1] === "spawn");
  assert.deepEqual(spawn.argv, ["thread", "spawn", "--project", "proj_a", "--provider", "claude-code", "--model", "claude-opus-5-5",
    "--environment", home, "--prompt-file", join(home, "TASK.md"), "--permission-mode", "full", "--title", "dev-a", "--json"]);
  assert.equal(spawn.server, backend.server);
  assert.deepEqual(effects(bb), ["thread spawn"], "the home's existing project is reused");
  assert.ok(Buffer.byteLength(JSON.stringify(answer.result.endpoint)) < 4096);
});

test("launch runs the readiness checks before it reads or changes anything in bb", async (t) => {
  const { backend, bb, run } = await setup(t);
  await run();
  assert.deepEqual(verbs(bb), ["--version", "project list", "thread list", "thread list --archived", "thread spawn"]);
  assert.deepEqual(backend.requests, ["/health", "/api/v1/system/providers/state?providerId=claude-code"]);
  assert.deepEqual(backend.daemonRequests, ["/status"]);
});

test("launch writes the env into .claude/settings.local.json, 0600, before the spawn", async (t) => {
  const { home, run } = await setup(t);
  await run();
  assert.deepEqual(localSettings(home), { env: { OATS_INSTANCE: "dev-a", OATS_INSTANCE_HOME: home } });
  assert.equal(statSync(join(home, ".claude/settings.local.json")).mode & 0o777, 0o600);
  assert.equal(statSync(join(home, ".oats-bb/launch-env.json")).mode & 0o777, 0o600);
});

test("launch keeps a person's settings and env entries, and removes what an earlier launch wrote and this one does not carry", async (t) => {
  const { home, run } = await setup(t);
  mkdirSync(join(home, ".claude"));
  writeFileSync(join(home, ".claude/settings.local.json"), JSON.stringify({ permissions: { allow: ["Bash(ls)"] }, env: { MINE: "kept" } }), { mode: 0o644 });
  await run({ env: [entry("OATS_INSTANCE", "dev-a"), { name: "AWEB_DELIVERY", value: "session", source: "capability", capability: "oats.aweb" }, { name: "EDITOR", value: "vi", source: "launch-config" }] });
  assert.deepEqual(localSettings(home), { permissions: { allow: ["Bash(ls)"] }, env: { MINE: "kept", OATS_INSTANCE: "dev-a", AWEB_DELIVERY: "session", EDITOR: "vi" } });
  assert.equal(statSync(join(home, ".claude/settings.local.json")).mode & 0o777, 0o600, "a wider file is narrowed");
  await run({ env: [entry("OATS_INSTANCE", "dev-a")] });
  assert.deepEqual(localSettings(home), { permissions: { allow: ["Bash(ls)"] }, env: { MINE: "kept", OATS_INSTANCE: "dev-a" } });
  await run({ env: [] });
  assert.deepEqual(localSettings(home), { permissions: { allow: ["Bash(ls)"] }, env: { MINE: "kept" } });
});

for (const [name, write, pattern] of [
  ["that is not JSON", (home) => writeFileSync(join(home, ".claude/settings.local.json"), "{ nope"), /is not JSON/],
  ["that is not an object", (home) => writeFileSync(join(home, ".claude/settings.local.json"), "[]"), /not a JSON object/],
  ["whose env is not a map", (home) => writeFileSync(join(home, ".claude/settings.local.json"), '{"env":"x"}'), /"env" that is not a map/],
]) {
  test(`a settings.local.json ${name} refuses the launch and is left as it is`, async (t) => {
    const { home, bb, run } = await setup(t);
    mkdirSync(join(home, ".claude"));
    write(home);
    const before = readFileSync(join(home, ".claude/settings.local.json"), "utf8");
    const answer = await run();
    assert.equal(answer.error.code, "E_SESSION_START_FAILED");
    assert.match(answer.error.message, pattern);
    assert.equal(readFileSync(join(home, ".claude/settings.local.json"), "utf8"), before);
    assert.deepEqual(bb.calls(), [], "found before bb is asked or changed at all");
  });
}

// The home is its agent's to write: what the provider reads there is a regular file of the
// home, of a bounded size, and none of its content reaches a message.
for (const [name, plant] of [
  ["a link to a file outside the home", (home, dir) => { writeFileSync(join(dir, "outside"), "TOP-SECRET-LINE not json"); symlinkSync(join(dir, "outside"), join(home, ".claude/settings.local.json")); }],
  ["a link to nothing", (home, dir) => symlinkSync(join(dir, "nowhere"), join(home, ".claude/settings.local.json"))],
  ["a named pipe nobody writes to", (home) => execFileSync("mkfifo", [join(home, ".claude/settings.local.json")])],
  ["a directory", (home) => mkdirSync(join(home, ".claude/settings.local.json"))],
]) {
  test(`a settings.local.json that is ${name} refuses the launch at once: it is not followed, waited on or quoted`, async (t) => {
    const { dir, home, bb, run } = await setup(t);
    mkdirSync(join(home, ".claude"));
    plant(home, dir);
    const started = Date.now();
    const answer = await run();
    assert.equal(answer.error.code, "E_SESSION_START_FAILED");
    assert.match(answer.error.message, /is not a regular file/);
    assert.doesNotMatch(JSON.stringify(answer), /TOP-SECRET-LINE/);
    assert.ok(Date.now() - started < 8000, "no wait on a pipe");
    assert.deepEqual(bb.calls(), [], "found before bb is asked or changed at all");
  });
}

test("a settings.local.json that is not JSON is named, never quoted; one larger than 1 MiB is not read", async (t) => {
  const { home, bb, run } = await setup(t);
  mkdirSync(join(home, ".claude"));
  writeFileSync(join(home, ".claude/settings.local.json"), "TOP-SECRET-LINE { nope");
  const notJson = await run();
  assert.match(notJson.error.message, /is not JSON/);
  assert.doesNotMatch(JSON.stringify(notJson), /TOP-SECRET-LINE|Unexpected token/);
  writeFileSync(join(home, ".claude/settings.local.json"), `{"pad":"${"x".repeat(1024 * 1024)}"}`);
  const large = await run();
  assert.equal(large.error.code, "E_SESSION_START_FAILED");
  assert.match(large.error.message, /is larger than 1048576 bytes/);
  assert.deepEqual(bb.calls(), []);
});

// Only a list the provider can read row by row says the home is free.
for (const [name, script, pattern] of [
  ["a thread list holding a row that is no object", { "thread list": { stdout: [null] } }, /bb thread list answered a row this provider cannot read/],
  ["a thread list holding a thread with no status", { "thread list": { stdout: [{ id: "thr_x", projectId: "proj_a" }] } }, /bb thread list answered a row this provider cannot read/],
  ["a project list holding a row that is no object", { "project list": { stdout: [null] } }, /bb project list answered a row this provider cannot read/],
  ["a project list holding a project with no sources", { "project list": { stdout: [{ id: "proj_a" }] } }, /bb project list answered a row this provider cannot read/],
]) {
  test(`${name} refuses the launch before any effect: it cannot show the home is free`, async (t) => {
    const { home, bb, run } = await setup(t, script);
    const answer = await run();
    assert.equal(answer.error.code, "E_SESSION_START_FAILED");
    assert.match(answer.error.message, pattern);
    assert.deepEqual(effects(bb), []);
    assert.equal(existsSync(join(home, ".claude")), false);
  });
}

// A project source that does not say what it is cannot show that a project is NOT this
// home's: the list is unreadable, never "the home has no project".
for (const [name, sources] of [["a source that says nothing", [{}]], ["a local source with no path", [{ type: "local_path" }]], ["a local source whose path is empty", [{ type: "local_path", path: "" }]], ["a source with no kind", [{ path: "/srv/x" }]]]) {
  test(`a project list holding ${name} refuses the launch before any effect`, async (t) => {
    const { bb, run } = await setup(t, { "project list": { stdout: [{ id: "proj_a", sources }] } });
    const answer = await run();
    assert.equal(answer.error.code, "E_SESSION_START_FAILED");
    assert.match(answer.error.message, /bb project list answered a row this provider cannot read/);
    assert.deepEqual(effects(bb), []);
  });
}

test("a .claude that is a link out of the home refuses the launch: the env file is never written through it", async (t) => {
  const { dir, home, bb, run } = await setup(t);
  mkdirSync(join(dir, "elsewhere"));
  symlinkSync(join(dir, "elsewhere"), join(home, ".claude"));
  const answer = await run();
  assert.equal(answer.error.code, "E_SESSION_START_FAILED");
  assert.equal(existsSync(join(dir, "elsewhere/settings.local.json")), false);
  assert.deepEqual(bb.calls(), [], "found before bb is asked or changed at all");
});

test("variables that only pick a model are carried", async (t) => {
  const { home, run } = await setup(t);
  const names = ["ANTHROPIC_MODEL", "ANTHROPIC_SMALL_FAST_MODEL", "ANTHROPIC_DEFAULT_OPUS_MODEL", "ANTHROPIC_DEFAULT_HAIKU_MODEL_NAME", "ANTHROPIC_CUSTOM_MODEL_OPTION"];
  assert.equal((await run({ env: names.map((name) => entry(name, "m", { source: "launch-config" })) })).ok, true);
  assert.deepEqual(Object.keys(localSettings(home).env).sort(), [...names].sort());
});

test("a person's own entry under a name the launch carries is the launch's: replaced, and gone with it", async (t) => {
  const { home, run } = await setup(t);
  mkdirSync(join(home, ".claude"));
  writeFileSync(join(home, ".claude/settings.local.json"), JSON.stringify({ env: { MY_VAR: "persons", OTHER: "kept" } }));
  await run({ env: [entry("MY_VAR", "launch")] });
  assert.deepEqual(localSettings(home).env, { MY_VAR: "launch", OTHER: "kept" });
  await run({ env: [] });
  assert.deepEqual(localSettings(home).env, { OTHER: "kept" });
});

test("pathPrepend is carried as the env file's PATH: the shim directory first, then the PATH the provider was called with", async (t) => {
  const { home, run } = await setup(t);
  const shim = join(home, ".oats/bin");
  assert.equal((await run({ pathPrepend: [shim] })).ok, true);
  const dirs = localSettings(home).env.PATH.split(":");
  assert.equal(dirs[0], shim);
  assert.deepEqual(dirs.slice(1), PATH_WITH_BWRAP.split(":").filter((dir) => dir && dir !== shim), "the rest is the caller's PATH, in order");
  // A launch that names its own PATH: the directories go before that one.
  await run({ pathPrepend: [shim], env: [entry("PATH", "/usr/bin:/bin", { source: "launch-config" })] });
  assert.equal(localSettings(home).env.PATH, `${shim}:/usr/bin:/bin`);
  // And a later launch without it removes the PATH the provider wrote.
  await run({ pathPrepend: [] });
  assert.equal(localSettings(home).env.PATH, undefined);
});

for (const [name, pathPrepend, pattern] of [
  ["a relative directory", ["bin"], /"bin" is not an absolute directory/],
  ["a directory holding the PATH separator", ["/a:/b"], /"\/a:\/b"/],
  ["a pathPrepend that is not a list", "/abs/bin", /must be a list/],
]) {
  test(`${name} in pathPrepend: E_BACKEND_LAUNCH_ENV naming it, never dropped`, async (t) => {
    const { bb, run } = await setup(t);
    const answer = await run({ pathPrepend });
    assert.equal(answer.error.code, "E_BACKEND_LAUNCH_ENV");
    assert.match(answer.error.message, pattern);
    assert.deepEqual(bb.calls(), []);
  });
}

test("a launch that asks to resume is refused: a bb thread is resumed by an input, never relaunched", async (t) => {
  const { bb, run } = await setup(t);
  const answer = await run({ resume: { notice: "continue" } });
  assert.equal(answer.error.code, "E_SESSION_START_FAILED");
  assert.match(answer.error.message, /does not resume by launching/);
  assert.deepEqual(bb.calls(), []);
});

test("a secret-sourced env entry: E_BACKEND_LAUNCH_ENV naming it, nothing written, bb never called", async (t) => {
  const { home, bb, run } = await setup(t);
  const answer = await run({ env: [entry("OATS_INSTANCE", "dev-a"), { name: "GITHUB_TOKEN", value: "sk-not-a-real-key", source: "launch-config-reference", secret: true }] });
  assert.equal(answer.ok, false);
  assert.equal(answer.error.code, "E_BACKEND_LAUNCH_ENV");
  assert.match(answer.error.message, /GITHUB_TOKEN \(source launch-config-reference\) comes from a secret source/);
  assert.doesNotMatch(JSON.stringify(answer), /sk-not-a-real-key/, "the value is never echoed");
  assert.equal(existsSync(join(home, ".claude/settings.local.json")), false);
  assert.deepEqual(bb.calls(), []);
});

test("an unset name is written empty: it reaches Claude neither from an earlier entry nor from bb's server environment", async (t) => {
  const { home, run } = await setup(t);
  mkdirSync(join(home, ".claude"));
  writeFileSync(join(home, ".claude/settings.local.json"), JSON.stringify({ env: { AWEB_DELIVERY: "channel", MINE: "kept" } }));
  assert.equal((await run({ env: [entry("OATS_INSTANCE", "dev-a")], unset: ["AWEB_DELIVERY", "AWID_REGISTRY_URL"] })).ok, true);
  assert.deepEqual(localSettings(home), { env: { AWEB_DELIVERY: "", MINE: "kept", AWID_REGISTRY_URL: "", OATS_INSTANCE: "dev-a" } });
  // A later launch that no longer unsets them takes the empty entries away again.
  await run({ env: [entry("OATS_INSTANCE", "dev-a")], unset: [] });
  assert.deepEqual(localSettings(home), { env: { MINE: "kept", OATS_INSTANCE: "dev-a" } });
});

for (const [name, env, pattern] of [
  ["a secret reference that is not marked secret", [{ name: "X_TOKEN", value: "v", source: "launch-config-reference" }], /X_TOKEN.*secret source/],
  ["a plain source marked secret", [{ name: "X_TOKEN", value: "v", source: "launch-config", secret: true }], /X_TOKEN.*secret source/],
  ["a source word the provider does not know", [{ name: "X_TOKEN", value: "v", source: "vault" }], /X_TOKEN \(source vault\) has no source this backend knows/],
  ["an entry with no source", [{ name: "X_TOKEN", value: "v" }], /X_TOKEN has no source this backend knows/],
  ["a secret mark that is not a boolean", [{ name: "X_TOKEN", value: "v", source: "kernel", secret: "no" }], /X_TOKEN.*neither true nor false/],
  // bb's Claude runs with bb's own Claude configuration and account: an entry that would
  // choose either is refused, never ignored, whatever its source.
  ["CLAUDE_CONFIG_DIR", [entry("CLAUDE_CONFIG_DIR", "/home/ana/.claude-work", { source: "launch-config" })], /CLAUDE_CONFIG_DIR.*configuration bb's server runs with/],
  ["an API key, even as a plain literal", [entry("ANTHROPIC_API_KEY", "sk-not-a-real-key", { source: "launch-config" })], /ANTHROPIC_API_KEY.*account of bb's own server/],
  ["an OAuth token from a secret reference", [{ name: "CLAUDE_CODE_OAUTH_TOKEN", value: "t", source: "launch-config-reference", secret: true }], /CLAUDE_CODE_OAUTH_TOKEN.*account/],
  ["another model endpoint", [entry("ANTHROPIC_BASE_URL", "https://llm.example.net", { source: "launch-config" })], /ANTHROPIC_BASE_URL.*account or endpoint/],
  ["an unset of the account's credential", { env: [], unset: ["ANTHROPIC_API_KEY"] }, /unsets ANTHROPIC_API_KEY.*neither choose nor remove/],
  ["an unset of Claude's configuration", { env: [], unset: ["CLAUDE_CONFIG_DIR"] }, /unsets CLAUDE_CONFIG_DIR/],
  ...["ANTHROPIC_FOUNDRY_API_KEY", "ANTHROPIC_AWS_API_KEY", "ANTHROPIC_BEDROCK_BASE_URL", "ANTHROPIC_CUSTOM_HEADERS", "ANTHROPIC_UNIX_SOCKET", "ANTHROPIC_IDENTITY_TOKEN_FILE", "CLAUDE_CODE_API_BASE_URL", "CLAUDE_CODE_USE_BEDROCK", "AWS_BEARER_TOKEN_BEDROCK", "ANTHROPIC_SOMETHING_NEW", "CLAUDE_CODE_OAUTH_REFRESH_TOKEN", "CLAUDE_CODE_SKIP_BEDROCK_AUTH", "CLAUDE_CODE_SKIP_VERTEX_AUTH"]
    .map((name) => [`${name}, which would choose the account or endpoint`, [entry(name, "v", { source: "launch-config" })], new RegExp(`${name}.*account or endpoint`)]),
  ["an unset of a cloud's key", { env: [], unset: ["ANTHROPIC_FOUNDRY_API_KEY"] }, /unsets ANTHROPIC_FOUNDRY_API_KEY/],
  ["__proto__ as a name: refused, never dropped", [entry("__proto__", "x"), entry("A", "1")], /"__proto__".*cannot|"__proto__".*can carry/],
  ["__proto__ in unset", { env: [], unset: ["__proto__"] }, /unset must be a list of variable names/],
  ["a name both set and unset", { env: [entry("BOTH", "v")], unset: ["BOTH"] }, /both sets and unsets BOTH/],
  ["an unset that is not a list of names", { env: [], unset: ["not a name"] }, /unset must be a list/],
  ["a name that is not a variable name", [entry("BAD-NAME", "v")], /BAD-NAME/],
  ["a value with a newline", [entry("MULTI", "a\nb")], /MULTI.*one-line/],
  ["a value that is not a string", [entry("NUM", 7)], /NUM/],
  ["one name twice", [entry("TWICE", "a"), entry("TWICE", "b")], /TWICE twice/],
  ["an entry with no name", [{ value: "v", source: "kernel" }], /no name/],
  ["an env that is not a list", { OATS_INSTANCE: "dev-a" }, /must be a list/],
]) {
  test(`${name}: E_BACKEND_LAUNCH_ENV, bb never called`, async (t) => {
    const { bb, run } = await setup(t);
    const answer = await run(Array.isArray(env) || !("unset" in env) ? { env } : env);
    assert.equal(answer.error.code, "E_BACKEND_LAUNCH_ENV");
    assert.match(answer.error.message, pattern);
    assert.deepEqual(bb.calls(), []);
  });
}

for (const [name, args, pattern] of [
  ["a channel argument", ["--channels", "plugin:aweb-channel@awebai-marketplace"], /--channels/],
  ["an argument after a carried one", ["--permission-mode", "auto", "--verbose"], /--verbose/],
  ["a permission mode bb does not have", ["--permission-mode", "plan"], /"plan"/],
  ["--permission-mode with no value", ["--permission-mode"], /--permission-mode/],
  ["two different permission modes", ["--permission-mode=auto", "--permission-mode", "acceptEdits"], /twice/],
  ["an argument that is not a string", [7], /7/],
  ["args that are not a list", "--verbose", /must be a list/],
  // Where yolo and the argument disagree the provider refuses rather than picks one.
  ["yolo with --permission-mode auto", { yolo: true, args: ["--permission-mode", "auto"] }, /yolo and for --permission-mode auto, which disagree/],
  ["yolo with --permission-mode acceptEdits", { yolo: true, args: ["--permission-mode=acceptEdits"] }, /acceptEdits, which disagree/],
  ["no yolo with --permission-mode bypassPermissions", { yolo: false, args: ["--permission-mode", "bypassPermissions"] }, /no yolo and for --permission-mode bypassPermissions, which disagree/],
]) {
  test(`${name}: E_BACKEND_LAUNCH_ARG naming it, bb never called`, async (t) => {
    const { home, bb, run } = await setup(t);
    const answer = await run(Array.isArray(args) || typeof args === "string" ? { args } : args);
    assert.equal(answer.error.code, "E_BACKEND_LAUNCH_ARG");
    assert.match(answer.error.message, pattern);
    assert.deepEqual(bb.calls(), []);
    assert.equal(existsSync(join(home, ".claude")), false);
  });
}

for (const [name, extra, mode] of [
  ["yolo true", { yolo: true }, "full"],
  ["yolo false", { yolo: false }, "accept-edits"],
  ["no yolo choice", { yolo: null }, "accept-edits"],
  ["a launch configuration's --permission-mode auto", { yolo: null, args: ["--permission-mode", "auto"] }, "auto"],
  ["--permission-mode=auto with no yolo", { yolo: false, args: ["--permission-mode=auto"] }, "auto"],
  ["--permission-mode acceptEdits", { yolo: null, args: ["--permission-mode", "acceptEdits"] }, "accept-edits"],
  ["--permission-mode bypassPermissions with no choice", { yolo: null, args: ["--permission-mode", "bypassPermissions"] }, "full"],
  ["yolo and --permission-mode bypassPermissions, which agree", { yolo: true, args: ["--permission-mode", "bypassPermissions"] }, "full"],
  ["the same mode named twice", { yolo: null, args: ["--permission-mode", "auto", "--permission-mode=auto"] }, "auto"],
]) {
  test(`${name} is bb's ${mode} mode${mode === "full" ? ": the launch spawns with --permission-mode full" : ", a sandboxed mode: the command refuses it before anything starts"}`, async (t) => {
    const { home, bb, run, runSandboxed } = await setup(t);
    const answer = await run(extra);
    if (mode === "full") {
      assert.equal(answer.ok, true);
    } else {
      // Until the release that brings the deny rules, the command launches in full mode only.
      assert.equal(answer.error.code, "E_BACKEND_SANDBOXED_MODE");
      assert.match(answer.error.message, new RegExp(`bb's ${mode} mode, a sandboxed mode.*--yolo.*Nothing was started`));
      assert.ok(answer.error.message.length < 500);
      assert.deepEqual(bb.calls(), [], "bb is not asked or changed at all");
      assert.equal(existsSync(join(home, ".claude")), false);
      assert.equal(existsSync(join(home, ".oats-bb")), false);
      // The mode itself is read as bb names it: with the sandboxed modes taken, that is the spawn's.
      assert.equal((await runSandboxed(extra)).ok, true);
    }
    const argv = bb.calls().find((c) => c.argv[1] === "spawn").argv;
    assert.equal(argv[argv.indexOf("--permission-mode") + 1], mode);
  });
}

test("a harness the provider does not run: E_BACKEND_HARNESS, bb never called", async (t) => {
  const { bb, run } = await setup(t);
  const answer = await run({ harness: "codex" });
  assert.equal(answer.error.code, "E_BACKEND_HARNESS");
  assert.match(answer.error.message, /claude only, not "codex"/);
  assert.deepEqual(bb.calls(), []);
});

for (const [name, extra, pattern] of [
  ["a home that is not absolute", { home: "relative/home" }, /home must be an absolute path/],
  ["no instance name", { instance: "" }, /no instance name/],
  ["an instance name that reads as an option", { instance: "--archived" }, /no instance name/],
  ["a model that reads as an option", { model: "--archived" }, /model must be a model id/],
  ["a prompt file that does not exist", { promptFile: "/nonexistent/TASK.md" }, /does not exist/],
  ["a yolo that is not a boolean", { yolo: "yes" }, /yolo must be/],
]) {
  test(`${name}: E_SESSION_START_FAILED, bb never called`, async (t) => {
    const { bb, run } = await setup(t);
    const answer = await run(extra);
    assert.equal(answer.error.code, "E_SESSION_START_FAILED");
    assert.match(answer.error.message, pattern);
    assert.deepEqual(bb.calls(), []);
  });
}

test("with no model the spawn names none (bb's own default)", async (t) => {
  const { bb, run } = await setup(t);
  assert.equal((await run({ model: null })).ok, true);
  assert.equal(bb.calls().find((c) => c.argv[1] === "spawn").argv.includes("--model"), false);
});

test("a home with no bb project gets one, rooted at the home and named after the instance", async (t) => {
  const { home, bb, run } = await setup(t, (h) => ({ "project list": { stdout: [projectRow("proj_other", "/another/home")] }, "project create": { stdout: projectRow("proj_made", h) } }));
  const answer = await run();
  assert.equal(answer.result.endpoint.projectId, "proj_made");
  assert.deepEqual(bb.calls().find((c) => c.argv[1] === "create").argv, ["project", "create", "--name", "dev-a", "--root", home, "--json"]);
  assert.deepEqual(effects(bb), ["project create", "thread spawn"]);
});

test("a project bb roots elsewhere than the home: no thread is started, and the launch says a project was made (not a refusal: bb was changed)", async (t) => {
  const { home, backend, bb, input } = await setup(t, (h) => ({ "project list": { stdout: [projectRow("proj_parent", join(h, "..")), projectRow("proj_work", join(h, "work"))] }, "project create": { stdout: projectRow("proj_made", join(h, "work")) } }));
  const run = await rawLaunch(bb, backend, input());
  assert.equal(run.status, 1);
  assert.equal(run.stdout, "", "the kernel reads a refusal as 'nothing happened', and a project was created");
  assert.match(run.stderr, /another root than the home.*bb project proj_made was created.*not a refusal/);
  assert.deepEqual(effects(bb), ["project create"], "the parent's and work/'s projects were not reused, and no thread was spawned");
  assert.equal(existsSync(join(home, ".claude")), false);
});

// A refusal says "nothing happened". Every read and every stop of a thread at rest comes
// before the first change (the previous thread archived, a project made); after it, what
// cannot be completed ends with no answer.
test("what a launch must read is read before it changes anything: a list that cannot be read refuses with the previous thread untouched", async (t) => {
  const { backend, bb, run } = await setup(t, {
    "thread list": { stdout: [threadRow("thr_prev", "proj_a", "idle", { createdAt: 4_000 })] }, "thread list --archived": { stdout: [null] },
    "thread archive": { stdout: { ok: true } },
  });
  const answer = await run({ previous: { server: backend.server, projectId: "proj_a", threadId: "thr_prev" } });
  assert.equal(answer.error.code, "E_SESSION_START_FAILED");
  assert.deepEqual(effects(bb), [], "nothing was stopped, archived or started");
});

for (const [name, script, pattern] of [
  ["bb refuses the spawn", { "thread spawn": { error: { code: "error", message: "Failed to create thread: HTTP 404: Project not found" } } }, /bb thread spawn failed.*previous thread thr_prev is archived.*not a refusal/],
  ["whether bb archived it is not known", { "thread archive": { error: { code: "error", message: "HTTP 500: boom" } } }, /could not be archived.*may already have changed bb or the home.*not a refusal/],
  ["the archive call is cut off", { "thread archive": { exit: 3, stderr: "killed\n" } }, /could not be archived.*may already have changed bb or the home.*not a refusal/],
]) {
  test(`after the previous thread is archived, a launch that cannot go on is in doubt, never a refusal: ${name}`, async (t) => {
    const { backend, bb, input } = await setup(t, { "thread list": { stdout: [threadRow("thr_prev", "proj_a", "idle")] }, "thread archive": { stdout: { ok: true } }, ...script });
    const run = await rawLaunch(bb, backend, input({ previous: { server: backend.server, projectId: "proj_a", threadId: "thr_prev" } }));
    assert.equal(run.status, 1);
    assert.equal(run.stdout, "");
    assert.match(run.stderr, pattern);
  });
}

test("a project bb answers for with no id (an answer that cannot be read) leaves the launch in doubt: bb may have made it", async (t) => {
  const { backend, bb, input } = await setup(t, { "project list": { stdout: [] }, "project create": { stdout: {} } });
  const run = await rawLaunch(bb, backend, input());
  assert.equal(run.status, 1);
  assert.equal(run.stdout, "");
  assert.match(run.stderr, /it asked bb to create the home's project.*not a refusal/);
});

// A spawn bb refuses in its own words made no thread. Where nothing else was changed, the
// launch's own files in the home are put back exactly as they were, and it is a refusal.
test("bb's own no to the spawn, with nothing else changed, is a refusal that leaves the home as it was: no settings file, no directory of the provider", async (t) => {
  const { home, bb, run } = await setup(t, { "thread spawn": { error: { code: "error", message: "Failed to create thread: HTTP 404: Project not found" } } });
  const answer = await run();
  assert.equal(answer.error.code, "E_SESSION_START_FAILED");
  assert.match(answer.error.message, /Project not found/);
  assert.deepEqual(readdirSync(home).sort(), ["TASK.md"], "nothing the launch wrote is left");
  assert.deepEqual(effects(bb), ["thread spawn"]);
});

test("bb's own no to the spawn puts a settings file that was there back byte for byte, with its mode", async (t) => {
  const { home, run } = await setup(t, { "thread spawn": { error: { code: "error", message: "Failed to create thread: HTTP 404: Project not found" } } });
  mkdirSync(join(home, ".claude"));
  const before = '{ "permissions": {"allow": ["Bash(ls)"]},\n  "env": {"MINE": "1"} }\n';
  writeFileSync(join(home, ".claude/settings.local.json"), before, { mode: 0o640 });
  assert.equal((await run()).error.code, "E_SESSION_START_FAILED");
  assert.equal(readFileSync(join(home, ".claude/settings.local.json"), "utf8"), before);
  assert.equal(statSync(join(home, ".claude/settings.local.json")).mode & 0o777, 0o640);
  assert.deepEqual(readdirSync(home).sort(), [".claude", "TASK.md"]);
});

test("a project bb may or may not have created (a server error) leaves the launch in doubt; bb's own no is a refusal", async (t) => {
  const unknown = await setup(t, { "project list": { stdout: [] }, "project create": { error: { code: "error", message: "HTTP 500: no" } } });
  const run = await rawLaunch(unknown.bb, unknown.backend, unknown.input());
  assert.equal(run.status, 1);
  assert.equal(run.stdout, "");
  assert.match(run.stderr, /bb project create failed.*may already have changed bb or the home \(it asked bb to create the home.s project\).*not a refusal/);
  const refused = await setup(t, { "project list": { stdout: [] }, "project create": { error: { code: "invalid_request", message: "HTTP 400: bad root" } } });
  const answer = await refused.run();
  assert.equal(answer.error.code, "E_SESSION_START_FAILED");
  assert.match(answer.error.message, /project create/);
});

test("a home reached through a link is the same home: its project is reused", async (t) => {
  const { dir, home, bb, run } = await setup(t);
  symlinkSync(home, join(dir, "linked-home"));
  const answer = await run({ home: join(dir, "linked-home"), promptFile: join(dir, "linked-home/TASK.md") });
  assert.equal(answer.ok, true, JSON.stringify(answer));
  assert.equal(answer.result.endpoint.projectId, "proj_a");
  assert.deepEqual(effects(bb), ["thread spawn"]);
});

test("a host daemon that does not say which server it serves refuses the launch before any effect: it is not known to serve this one", async (t) => {
  const { home, bb, run } = await setup(t, {}, { daemonStatus: { connected: true, serverUrl: 42 } });
  const answer = await run();
  assert.equal(answer.error.code, "E_BACKEND_NOT_READY");
  assert.match(answer.error.message, /no "serverUrl" that is an http or https address/);
  assert.deepEqual(effects(bb), []);
  assert.equal(existsSync(join(home, ".claude")), false);
});

test("a readiness problem refuses the launch with its own code, before any effect", async (t) => {
  const { home, bb, run } = await setup(t, { "--version": { stdout: "0.51.0\n" } });
  const answer = await run();
  assert.equal(answer.error.code, "E_BACKEND_VERSION");
  assert.match(answer.error.message, /bb is 0\.51\.0.*pins 0\.50\.1/);
  assert.deepEqual(effects(bb), []);
  assert.equal(existsSync(join(home, ".claude")), false);
});

test("several readiness problems: the first one's code, the others named", async (t) => {
  const { run } = await setup(t, { "--version": { stdout: "0.51.0\n" } });
  const answer = await run({}, { trust: undefined });
  assert.equal(answer.error.code, "E_BACKEND_TRUST");
  assert.match(answer.error.message, /and 1 more: E_BACKEND_VERSION/);
});

test("bb's claude-code provider not signed in refuses the launch: E_BACKEND_NOT_READY with bb's word", async (t) => {
  const { bb, run, backend } = await setup(t);
  backend.state.provider.status = "unauthenticated";
  const answer = await run();
  assert.equal(answer.error.code, "E_BACKEND_NOT_READY");
  assert.match(answer.error.message, /unauthenticated/);
  assert.deepEqual(effects(bb), []);
});

test("another live thread in the home's project refuses the launch, naming it", async (t) => {
  const { home, bb, run } = await setup(t, { "thread list": { stdout: [threadRow("thr_squatter", "proj_a", "idle")] } });
  const answer = await run();
  assert.equal(answer.error.code, "E_SESSION_START_FAILED");
  assert.match(answer.error.message, /thr_squatter \(idle\)/);
  assert.deepEqual(effects(bb), []);
  assert.equal(existsSync(join(home, ".claude")), false);
});

test("a live thread of another project that runs in the home refuses the launch too", async (t) => {
  const { bb, run } = await setup(t, (home) => ({ "thread list": { stdout: [threadRow("thr_elsewhere", "proj_z", "active", { environmentPath: home })] } }));
  const answer = await run();
  assert.equal(answer.error.code, "E_SESSION_START_FAILED");
  assert.match(answer.error.message, /thr_elsewhere/);
  assert.deepEqual(effects(bb), []);
});

test("a start after an OATS stop archives the previous thread, then spawns in the same project", async (t) => {
  const { backend, bb, run } = await setup(t, {
    "thread list": { stdout: [threadRow("thr_prev", "proj_a", "idle"), threadRow("thr_older", "proj_a", "idle", { archivedAt: 2 })] },
    "thread archive": { stdout: { ok: true, threadId: "thr_prev", alreadyArchived: false, archivedAt: 9, archivedThreadIds: ["thr_prev"] } },
  });
  const answer = await run({ previous: { server: backend.server, projectId: "proj_a", threadId: "thr_prev" } });
  assert.equal(answer.result.endpoint.threadId, "thr_new");
  assert.deepEqual(effects(bb), ["thread stop", "thread archive", "thread spawn"], "stopped before it is archived: bb keeps an archived thread's process otherwise");
  assert.deepEqual(bb.calls().find((c) => c.argv[1] === "archive").argv, ["thread", "archive", "thr_prev", "--json"]);
});

test("a previous thread still in a turn refuses the launch; it is not archived under a running agent", async (t) => {
  const { backend, bb, run } = await setup(t, { "thread list": { stdout: [threadRow("thr_prev", "proj_a", "active")] } });
  const answer = await run({ previous: { server: backend.server, projectId: "proj_a", threadId: "thr_prev" } });
  assert.equal(answer.error.code, "E_SESSION_START_FAILED");
  assert.match(answer.error.message, /thr_prev is still active/);
  assert.deepEqual(effects(bb), []);
});

test("a previous thread with a turn bb holds in line refuses the launch: the turn would start beside the new thread", async (t) => {
  const { backend, bb, run } = await setup(t, { "thread list": { stdout: [threadRow("thr_prev", "proj_a", "pending", { queuedWork: "waiting" })] } });
  const answer = await run({ previous: { server: backend.server, projectId: "proj_a", threadId: "thr_prev" } });
  assert.equal(answer.error.code, "E_SESSION_START_FAILED");
  assert.match(answer.error.message, /thr_prev is still pending with a turn bb holds in line: stop it \(oats instance stop dev-a\)/);
  assert.deepEqual(effects(bb), []);
});

// Two Claudes in one home: bb keeps the process of an archived thread loaded and shows
// nothing that says so. So a launch stops the home's archived threads before it spawns:
// those archived since the previous thread was made, or all where that is not known.
const ARCHIVED = [threadRow("thr_long_ago", "proj_a", "idle", { archivedAt: 1_000 }), threadRow("thr_in_ui", "proj_a", "idle", { archivedAt: 5_000 }), threadRow("thr_gone", "proj_a", "idle", { archivedAt: 6_000, deletedAt: 7_000 })];
const stops = (bb) => bb.calls().filter((c) => c.argv[1] === "stop").map((c) => c.argv[2]);

test("a launch stops the home's threads archived since its previous thread was made, then spawns: the previous one live", async (t) => {
  const { backend, bb, run } = await setup(t, {
    "thread list": { stdout: [threadRow("thr_prev", "proj_a", "idle", { createdAt: 4_000 })] }, "thread list --archived": { stdout: ARCHIVED },
    "thread archive": { stdout: { ok: true } },
  });
  const answer = await run({ previous: { server: backend.server, projectId: "proj_a", threadId: "thr_prev" } });
  assert.equal(answer.ok, true, JSON.stringify(answer));
  assert.deepEqual(stops(bb), ["thr_prev", "thr_in_ui"], "the previous thread before its archive, and the one archived after it was made; an older one was stopped by the launch that made the previous thread");
  assert.deepEqual(verbs(bb).slice(0, 4), ["--version", "project list", "thread list", "thread list --archived"], "every read first");
  assert.deepEqual(effects(bb), ["thread stop", "thread stop", "thread archive", "thread spawn"], "then the stops, the archive, and the spawn last");
});

test("the previous thread already archived (in bb's UI): its creation time is read, and it is stopped with what was archived since", async (t) => {
  const { backend, bb, run } = await setup(t, {
    "thread list --archived": { stdout: [...ARCHIVED, threadRow("thr_prev", "proj_a", "idle", { createdAt: 4_000, archivedAt: 5_500 })] },
    "thread show": { stdout: { thread: threadRow("thr_prev", "proj_a", "idle", { createdAt: 4_000, archivedAt: 5_500 }), environment: null, pendingTodos: null } },
  });
  assert.equal((await run({ previous: { server: backend.server, projectId: "proj_a", threadId: "thr_prev" } })).ok, true);
  assert.deepEqual(stops(bb), ["thr_in_ui", "thr_prev"]);
});

for (const [name, extra, script] of [
  ["no previous thread", {}, {}],
  ["a previous thread bb no longer shows", { previous: { server: "http://127.0.0.1:38886", projectId: "proj_a", threadId: "thr_prev" } }, { "thread show": { error: { code: "thread_not_found", message: "HTTP 404: Thread not found" } } }],
  ["a previous thread bb cannot be asked about", { previous: { server: "http://127.0.0.1:38886", projectId: "proj_a", threadId: "thr_prev" } }, { "thread show": { exit: 3, stderr: "boom\n" } }],
  ["a previous thread that does not say when it was made", { previous: { server: "http://127.0.0.1:38886", projectId: "proj_a", threadId: "thr_prev" } }, { "thread show": { stdout: { thread: threadRow("thr_prev", "proj_a", "idle", { createdAt: "yesterday", archivedAt: 9 }), environment: null, pendingTodos: null } } }],
]) {
  test(`with ${name}, a launch stops every archived thread of the home's project`, async (t) => {
    const { bb, run } = await setup(t, { "thread list --archived": { stdout: ARCHIVED }, ...script });
    assert.equal((await run(extra)).ok, true);
    assert.deepEqual(stops(bb), ["thr_long_ago", "thr_in_ui"], "a deleted thread is not stopped");
  });
}

for (const [name, script, pattern, code = "E_SESSION_START_FAILED"] of [
  ["cannot be listed", { "thread list --archived": UNREACHABLE }, /does not answer/, "E_BACKEND_UNREACHABLE"],
  ["hold a row that cannot be read", { "thread list --archived": { stdout: [null] } }, /a row this provider cannot read/],
]) {
  test(`a launch whose home's archived threads ${name} is refused before the spawn: a Claude may be left in the home`, async (t) => {
    const { home, bb, run } = await setup(t, script);
    const answer = await run();
    assert.equal(answer.error.code, code);
    assert.match(answer.error.message, pattern);
    assert.equal(effects(bb).includes("thread spawn"), false);
    assert.equal(existsSync(join(home, ".claude")), false);
  });
}

test("a home with no bb project yet has no archived thread to stop: none is asked for", async (t) => {
  const { bb, run } = await setup(t, (home) => ({ "project list": { stdout: [] }, "project create": { stdout: projectRow("proj_new", home) } }));
  assert.equal((await run()).ok, true);
  assert.equal(verbs(bb).includes("thread list --archived"), false);
});

// A stop of a thread at rest may already have released its process or withdrawn a held
// message: from the first stop the launch asks for, a failure is in doubt, not a refusal.
for (const [name, script, pattern] of [
  ["bb says it will not archive the previous thread", { "thread list": { stdout: [threadRow("thr_prev", "proj_a", "error")] }, "thread archive": { error: { code: "invalid_request", message: "HTTP 409: no" } } }, /could not be archived.*it asked bb to stop earlier threads of this home.*not a refusal/],
  ["the stop of the previous thread loses its answer", { "thread list": { stdout: [threadRow("thr_prev", "proj_a", "idle")] }, "thread stop": { exit: 3, stderr: "killed\n" } }, /bb thread stop.*not a refusal/],
  ["an archived thread of the home will not stop", { "thread list --archived": { stdout: ARCHIVED }, "thread stop": { error: { code: "error", message: "HTTP 500: boom" } } }, /bb thread stop failed.*not a refusal/],
  ["a look at the previous thread fails after its stop", { "thread list": { stdout: [threadRow("thr_prev", "proj_a", "idle")] }, "thread show": { exit: 3, stderr: "boom\n" } }, /not a refusal/],
]) {
  test(`once a launch has asked bb to stop an earlier thread of the home, it never answers a refusal: ${name}`, async (t) => {
    const { backend, bb, input } = await setup(t, script);
    const run = await rawLaunch(bb, backend, input({ previous: { server: backend.server, projectId: "proj_a", threadId: "thr_prev" } }));
    assert.equal(run.status, 1);
    assert.equal(run.stdout, "", "no envelope: the kernel keeps its record that a launch was sent");
    assert.match(run.stderr, pattern);
    assert.equal(effects(bb).includes("thread spawn"), false);
  });
}

test("a previous thread bb no longer has is no obstacle", async (t) => {
  const { backend, bb, run } = await setup(t);
  const answer = await run({ previous: { server: backend.server, projectId: "proj_a", threadId: "thr_gone" } });
  assert.equal(answer.ok, true);
  assert.deepEqual(effects(bb), ["thread spawn"]);
});

for (const [name, script, pattern] of [
  // bb 0.50.1 wraps a refused spawn in a plain error that carries the server's status.
  ["bb refuses the spawn", { "thread spawn": { error: { code: "error", message: "Failed to create thread: HTTP 404: Project not found" } } }, /Project not found/],
  ["bb cannot list its projects", { "project list": UNREACHABLE }, /does not answer/],
  ["bb cannot list its threads", { "thread list": { stdout: "garbage" } }, /not JSON/],
  ["bb cannot create the project", { "project list": { stdout: [] }, "project create": { error: { code: "invalid_request", message: "HTTP 409: a project is rooted there" } } }, /project create/],
]) {
  test(`${name}: the launch fails and says why`, async (t) => {
    const { run } = await setup(t, script);
    const answer = await run();
    assert.equal(answer.ok, false);
    assert.ok(["E_SESSION_START_FAILED", "E_BACKEND_UNREACHABLE"].includes(answer.error.code), answer.error.code);
    assert.match(answer.error.message, pattern);
  });
}

// A spawn whose fate is unknown is never refused ("nothing was started"): the provider
// looks for the thread it may have made.
const rawLaunch = (bb, backend, input) => runBin(["session", "launch"], { stdin: JSON.stringify(requestFor("launch", input)), env: { ...bb.env, OATS_SETTINGS: JSON.stringify({ ...backend.settings(), cli: bb.cli }) } });

test("a spawn that answers no thread id, and one new thread runs in the home: that thread is the launch's", async (t) => {
  const { backend, bb, run } = await setup(t, { "thread spawn": { stdout: { status: "starting" } }, "thread list": [{ stdout: [threadRow("thr_old", "proj_a", "idle", { archivedAt: 2 })] }, { stdout: [threadRow("thr_old", "proj_a", "idle", { archivedAt: 2 }), threadRow("thr_made", "proj_a", "starting", MADE)] }] });
  const answer = await run();
  assert.deepEqual(answer.result, { endpoint: { server: backend.server, projectId: "proj_a", threadId: "thr_made" } });
});

test("a launch never answers the previous thread again: not from bb's own answer, not as a thread that newly shows", async (t) => {
  const previous = { server: "http://127.0.0.1:38886", projectId: "proj_a", threadId: "thr_old" };
  // bb answers the old id (it never does: every spawn makes a new one), and the old
  // thread, archived before the launch, shows live again after it (a person unarchived it).
  const { backend, bb, input } = await setup(t, { "thread spawn": { stdout: { id: "thr_old", projectId: "proj_a", status: "starting" } },
    "thread list": [{ stdout: [threadRow("thr_old", "proj_a", "idle", { archivedAt: 2 })] }, { stdout: [threadRow("thr_old", "proj_a", "idle")] }] });
  const run = await rawLaunch(bb, backend, input({ previous }));
  assert.equal(run.status, 1);
  assert.equal(run.stdout, "", "in doubt, never the old endpoint");
  assert.match(run.stderr, /answered the previous thread again, and no new thread shows/);
});

test("a launch in doubt takes only a thread bb made after it asked: an older thread of the home that shows again, or one that does not say when it was made, is not this launch's", async (t) => {
  const previous = { server: "http://127.0.0.1:38886", projectId: "proj_a", threadId: "thr_prev" };
  for (const shown of [threadRow("thr_older", "proj_a", "idle", { createdAt: Date.now() - 86_400_000 }), threadRow("thr_undated", "proj_a", "idle", { createdAt: undefined }), threadRow("thr_text", "proj_a", "idle", { createdAt: "2099-01-01T00:00:00Z" })]) {
    const { backend, bb, input } = await setup(t, { "thread spawn": { stdout: { status: "starting" } }, "thread list": [{ stdout: [] }, { stdout: [shown] }] });
    const run = await rawLaunch(bb, backend, input({ previous }));
    assert.equal(run.status, 1, shown.id);
    assert.equal(run.stdout, "", "in doubt: an endpoint of an earlier launch is never answered");
    assert.match(run.stderr, /no new thread shows/);
  }
});

test("a spawn that answers no thread id, and no new thread shows: in doubt, no answer and a nonzero exit", async (t) => {
  const { backend, bb, input } = await setup(t, { "thread spawn": { stdout: { status: "starting" } } });
  const run = await rawLaunch(bb, backend, input());
  assert.equal(run.status, 1);
  assert.equal(run.stdout, "", "no envelope: the kernel reads a failed call, and stops whatever runs in the home");
  assert.match(run.stderr, /answered no thread id, and no new thread shows/);
  assert.equal(verbs(bb).filter((verb) => verb === "thread list").length, 4, "the list before the spawn, and three looks after it");
});

test("a spawn in doubt, and the home's threads come back as a list that cannot be read: in doubt, never 'nothing started'", async (t) => {
  const { backend, bb, input } = await setup(t, { "thread spawn": { stdout: { status: "starting" } }, "thread list": [{ stdout: [] }, { stdout: [null] }] });
  const run = await rawLaunch(bb, backend, input());
  assert.equal(run.status, 1);
  assert.equal(run.stdout, "");
  assert.match(run.stderr, /could not be read/);
});

test("a spawn in doubt, and the home's threads cannot be read: in doubt", async (t) => {
  const { backend, bb, input } = await setup(t, { "thread spawn": { stdout: { status: "starting" } }, "thread list": [{ stdout: [] }, UNREACHABLE] });
  const run = await rawLaunch(bb, backend, input());
  assert.equal(run.status, 1);
  assert.equal(run.stdout, "");
  assert.match(run.stderr, /could not be read/);
});

test("a spawn in doubt, and a new thread of another project runs in the home: in doubt, not adopted", async (t) => {
  const { home, backend, bb, input } = await setup(t, (h) => ({ "thread spawn": { stdout: { status: "starting" } }, "thread list": [{ stdout: [] }, { stdout: [threadRow("thr_stray", "proj_z", "active", { environmentPath: h, ...MADE })] }] }));
  const run = await rawLaunch(bb, backend, input());
  assert.equal(run.status, 1);
  assert.match(run.stderr, /thr_stray newly runs in/);
  assert.equal(existsSync(join(home, ".claude/settings.local.json")), true);
});

for (const [name, spawnAnswer] of [
  ["exits 0 with something that is not JSON", { stdout: "Spawned thr_made\n" }],
  ["loses its connection after the request went out", { error: { code: "error", message: "fetch failed: socket hang up" } }],
  ["dies with no answer", { exit: 137 }],
  ["meets a server error", { error: { code: "http_500", message: "HTTP 500: Internal Server Error" } }],
  ["meets a server error bb wraps", { error: { code: "error", message: "Failed to create thread: HTTP 503: Service Unavailable" } }],
]) {
  test(`a spawn that ${name} is in doubt: the thread it made is found and answered`, async (t) => {
    const { backend, bb, run } = await setup(t, { "thread spawn": spawnAnswer, "thread list": [{ stdout: [] }, { stdout: [threadRow("thr_made", "proj_a", "active", MADE)] }] });
    const answer = await run();
    assert.deepEqual(answer.result, { endpoint: { server: backend.server, projectId: "proj_a", threadId: "thr_made" } });
  });

  test(`a spawn that ${name}, with no thread to show: no answer and a nonzero exit, never "nothing was started"`, async (t) => {
    const { backend, bb, input } = await setup(t, { "thread spawn": spawnAnswer });
    const run = await rawLaunch(bb, backend, input());
    assert.equal(run.status, 1);
    assert.equal(run.stdout, "");
    assert.match(run.stderr, /ended without bb's answer.*one may still appear/);
  });
}

test("a spawn bb's server never got (connection refused) is a refusal: nothing was started, and no look is needed", async (t) => {
  const { bb, run } = await setup(t, { "thread spawn": UNREACHABLE });
  const answer = await run();
  assert.equal(answer.error.code, "E_SESSION_START_FAILED");
  assert.equal(verbs(bb).filter((verb) => verb === "thread list").length, 1);
});

test("a spawn cut off by time that did make the thread: the launch finds it and answers its endpoint", async (t) => {
  const { backend, bb, input } = await setup(t, { "thread spawn": { delayMs: 8_000, ...spawned() }, "thread list": [{ stdout: [] }, { stdout: [] }, { stdout: [threadRow("thr_late", "proj_a", "starting", MADE)] }] });
  // In process, so the spawn's own time can be short: the provider's cap per bb call is 10 s.
  const answer = await launch(input(), readSettings(backend.settings({ cli: bb.cli })), { deadline: Date.now() + 20_000, env: { ...process.env, ...bb.env }, spawnTimeoutMs: 500 });
  assert.deepEqual(answer, { endpoint: { server: backend.server, projectId: "proj_a", threadId: "thr_late" } });
});

test("a spawn cut off by time with no thread to show: in doubt, never a refusal", async (t) => {
  const { backend, bb, input } = await setup(t, { "thread spawn": { delayMs: 8_000, ...spawned() } });
  await assert.rejects(
    launch(input(), readSettings(backend.settings({ cli: bb.cli })), { deadline: Date.now() + 20_000, env: { ...process.env, ...bb.env }, spawnTimeoutMs: 500 }),
    (error) => error.name === "InDoubt" && error.code === undefined && /did not answer in time.*one may still appear/.test(error.message),
  );
});
