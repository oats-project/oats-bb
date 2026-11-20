// launch: one home, one bb project, one bb thread; every refusal before the first effect.
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { launch } from "../../oats-package/capabilities/oats-bb/lib/launch.mjs";
import { readSettings } from "../../oats-package/capabilities/oats-bb/lib/settings.mjs";
import { UNREACHABLE, VERSION, call, fakeBackend, fakeBbIn, projectRow, requestFor, runBin, scratch, threadRow } from "../fixtures/harness.mjs";

const spawned = (id = "thr_new") => ({ stdout: { id, projectId: "proj_a", environmentId: null, providerId: "claude-code", status: "starting" } });
const entry = (name, value, extra = {}) => ({ name, value, source: "kernel", ...extra });
const EFFECTS = new Set(["project create", "thread spawn", "thread archive", "thread stop", "thread tell"]);
const verbs = (bb) => bb.calls().map((c) => (c.argv[0] === "--version" ? "--version" : c.argv.slice(0, 2).join(" ")));
const effects = (bb) => verbs(bb).filter((verb) => EFFECTS.has(verb));

async function setup(t, script = {}, backendOverrides = {}) {
  const { dir, home } = scratch(t);
  const backend = await fakeBackend(t, backendOverrides);
  const bb = fakeBbIn(dir, {
    "--version": { stdout: `${VERSION}\n` },
    "project list": { stdout: [projectRow("proj_a", home)] },
    "thread list": { stdout: [] },
    "thread spawn": spawned(),
    ...(typeof script === "function" ? script(home) : script),
  });
  const input = (extra = {}) => ({ home, instance: "dev-a", harness: "claude", model: "claude-opus-5-5", yolo: null, env: [entry("OATS_INSTANCE", "dev-a"), entry("OATS_INSTANCE_HOME", home)], args: [], promptFile: join(home, "TASK.md"), previous: null, ...extra });
  const run = (extra, settings = {}) => call("launch", input(extra), { settings: backend.settings(settings), bb });
  return { dir, home, backend, bb, run, input };
}
const localSettings = (home) => JSON.parse(readFileSync(join(home, ".claude/settings.local.json"), "utf8"));

test("launch spawns one thread in the home's project and answers its endpoint", async (t) => {
  const { home, backend, bb, run } = await setup(t);
  const answer = await run();
  assert.deepEqual(answer, { schemaVersion: 1, phase: "session", capability: "oats.bb", provider: "bb", verb: "launch", ok: true,
    result: { endpoint: { server: backend.server, projectId: "proj_a", threadId: "thr_new" } } });
  const spawn = bb.calls().find((c) => c.argv[1] === "spawn");
  assert.deepEqual(spawn.argv, ["thread", "spawn", "--project", "proj_a", "--provider", "claude-code", "--model", "claude-opus-5-5",
    "--environment", home, "--prompt-file", join(home, "TASK.md"), "--permission-mode", "accept-edits", "--title", "dev-a", "--json"]);
  assert.equal(spawn.server, backend.server);
  assert.deepEqual(effects(bb), ["thread spawn"], "the home's existing project is reused");
  assert.ok(Buffer.byteLength(JSON.stringify(answer.result.endpoint)) < 4096);
});

test("launch runs the readiness checks before it reads or changes anything in bb", async (t) => {
  const { backend, bb, run } = await setup(t);
  await run();
  assert.deepEqual(verbs(bb), ["--version", "project list", "thread list", "thread spawn"]);
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

test("a .claude that is a link out of the home refuses the launch: the env file is never written through it", async (t) => {
  const { dir, home, bb, run } = await setup(t);
  mkdirSync(join(dir, "elsewhere"));
  symlinkSync(join(dir, "elsewhere"), join(home, ".claude"));
  const answer = await run();
  assert.equal(answer.error.code, "E_SESSION_START_FAILED");
  assert.equal(existsSync(join(dir, "elsewhere/settings.local.json")), false);
  assert.deepEqual(bb.calls(), [], "found before bb is asked or changed at all");
});

test("pathPrepend is carried as the env file's PATH: the shim directory first, then the PATH the provider was called with", async (t) => {
  const { home, run } = await setup(t);
  const shim = join(home, ".oats/bin");
  assert.equal((await run({ pathPrepend: [shim] })).ok, true);
  const dirs = localSettings(home).env.PATH.split(":");
  assert.equal(dirs[0], shim);
  assert.deepEqual(dirs.slice(1), process.env.PATH.split(":").filter((dir) => dir && dir !== shim), "the rest is the caller's PATH, in order");
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
  test(`${name} spawns with --permission-mode ${mode}`, async (t) => {
    const { bb, run } = await setup(t);
    const answer = await run(extra);
    assert.equal(answer.ok, true);
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

test("a project bb roots elsewhere than the home is refused: the root is exactly the home, never a parent or work/", async (t) => {
  const { home, bb, run } = await setup(t, (h) => ({ "project list": { stdout: [projectRow("proj_parent", join(h, "..")), projectRow("proj_work", join(h, "work"))] }, "project create": { stdout: projectRow("proj_made", join(h, "work")) } }));
  const answer = await run();
  assert.equal(answer.error.code, "E_SESSION_START_FAILED");
  assert.match(answer.error.message, /another root than the home/);
  assert.deepEqual(effects(bb), ["project create"], "the parent's and work/'s projects were not reused, and no thread was spawned");
  assert.equal(existsSync(join(home, ".claude")), false);
});

test("a home reached through a link is the same home: its project is reused", async (t) => {
  const { dir, home, bb, run } = await setup(t);
  symlinkSync(home, join(dir, "linked-home"));
  const answer = await run({ home: join(dir, "linked-home"), promptFile: join(dir, "linked-home/TASK.md") });
  assert.equal(answer.ok, true, JSON.stringify(answer));
  assert.equal(answer.result.endpoint.projectId, "proj_a");
  assert.deepEqual(effects(bb), ["thread spawn"]);
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
  assert.deepEqual(effects(bb), ["thread archive", "thread spawn"]);
  assert.deepEqual(bb.calls().find((c) => c.argv[1] === "archive").argv, ["thread", "archive", "thr_prev", "--json"]);
});

test("a previous thread still in a turn refuses the launch; it is not archived under a running agent", async (t) => {
  const { backend, bb, run } = await setup(t, { "thread list": { stdout: [threadRow("thr_prev", "proj_a", "active")] } });
  const answer = await run({ previous: { server: backend.server, projectId: "proj_a", threadId: "thr_prev" } });
  assert.equal(answer.error.code, "E_SESSION_START_FAILED");
  assert.match(answer.error.message, /thr_prev is still active/);
  assert.deepEqual(effects(bb), []);
});

test("a previous thread that cannot be archived refuses the launch before the spawn", async (t) => {
  const { backend, bb, run } = await setup(t, { "thread list": { stdout: [threadRow("thr_prev", "proj_a", "error")] }, "thread archive": { error: { code: "error", message: "HTTP 500: no" } } });
  const answer = await run({ previous: { server: backend.server, projectId: "proj_a", threadId: "thr_prev" } });
  assert.equal(answer.error.code, "E_SESSION_START_FAILED");
  assert.deepEqual(effects(bb), ["thread archive"]);
});

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
  ["bb cannot create the project", { "project list": { stdout: [] }, "project create": { error: { code: "error", message: "HTTP 500: no" } } }, /project create/],
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
  const { backend, bb, run } = await setup(t, { "thread spawn": { stdout: { status: "starting" } }, "thread list": [{ stdout: [threadRow("thr_old", "proj_a", "idle", { archivedAt: 2 })] }, { stdout: [threadRow("thr_old", "proj_a", "idle", { archivedAt: 2 }), threadRow("thr_made", "proj_a", "starting")] }] });
  const answer = await run();
  assert.deepEqual(answer.result, { endpoint: { server: backend.server, projectId: "proj_a", threadId: "thr_made" } });
});

test("a spawn that answers no thread id, and no new thread shows: in doubt, no answer and a nonzero exit", async (t) => {
  const { backend, bb, input } = await setup(t, { "thread spawn": { stdout: { status: "starting" } } });
  const run = await rawLaunch(bb, backend, input());
  assert.equal(run.status, 1);
  assert.equal(run.stdout, "", "no envelope: the kernel reads a failed call, and stops whatever runs in the home");
  assert.match(run.stderr, /answered no thread id, and no new thread shows/);
  assert.equal(verbs(bb).filter((verb) => verb === "thread list").length, 4, "the list before the spawn, and three looks after it");
});

test("a spawn in doubt, and the home's threads cannot be read: in doubt", async (t) => {
  const { backend, bb, input } = await setup(t, { "thread spawn": { stdout: { status: "starting" } }, "thread list": [{ stdout: [] }, UNREACHABLE] });
  const run = await rawLaunch(bb, backend, input());
  assert.equal(run.status, 1);
  assert.equal(run.stdout, "");
  assert.match(run.stderr, /could not be read/);
});

test("a spawn in doubt, and a new thread of another project runs in the home: in doubt, not adopted", async (t) => {
  const { home, backend, bb, input } = await setup(t, (h) => ({ "thread spawn": { stdout: { status: "starting" } }, "thread list": [{ stdout: [] }, { stdout: [threadRow("thr_stray", "proj_z", "active", { environmentPath: h })] }] }));
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
    const { backend, bb, run } = await setup(t, { "thread spawn": spawnAnswer, "thread list": [{ stdout: [] }, { stdout: [threadRow("thr_made", "proj_a", "active")] }] });
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
  const { backend, bb, input } = await setup(t, { "thread spawn": { delayMs: 8_000, ...spawned() }, "thread list": [{ stdout: [] }, { stdout: [] }, { stdout: [threadRow("thr_late", "proj_a", "starting")] }] });
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
