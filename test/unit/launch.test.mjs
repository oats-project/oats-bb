// launch: one home, one bb project, one bb thread; every refusal before the first effect.
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { launch } from "../../oats-package/capabilities/oats-bb/lib/launch.mjs";
import { readSettings } from "../../oats-package/capabilities/oats-bb/lib/settings.mjs";
import { UNREACHABLE, VERSION, call, fakeBackend, fakeBbIn, projectRow, scratch, threadRow } from "../fixtures/harness.mjs";

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
    assert.deepEqual(effects(bb), [], "no thread was spawned");
  });
}

test("a .claude that is a link out of the home refuses the launch: the env file is never written through it", async (t) => {
  const { dir, home, bb, run } = await setup(t);
  mkdirSync(join(dir, "elsewhere"));
  symlinkSync(join(dir, "elsewhere"), join(home, ".claude"));
  const answer = await run();
  assert.equal(answer.error.code, "E_SESSION_START_FAILED");
  assert.equal(existsSync(join(dir, "elsewhere/settings.local.json")), false);
  assert.deepEqual(effects(bb), []);
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

test("unset names are removed from the env file, a person's own entry of that name included", async (t) => {
  const { home, run } = await setup(t);
  mkdirSync(join(home, ".claude"));
  writeFileSync(join(home, ".claude/settings.local.json"), JSON.stringify({ env: { AWEB_DELIVERY: "channel", MINE: "kept" } }));
  assert.equal((await run({ env: [entry("OATS_INSTANCE", "dev-a")], unset: ["AWEB_DELIVERY", "AWID_REGISTRY_URL"] })).ok, true);
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
  const { home, bb, run } = await setup(t, { "project list": { stdout: [projectRow("proj_other", "/another/home")] }, "project create": { stdout: projectRow("proj_made", "/replaced-below") } });
  const answer = await run();
  assert.equal(answer.result.endpoint.projectId, "proj_made");
  assert.deepEqual(bb.calls().find((c) => c.argv[1] === "create").argv, ["project", "create", "--name", "dev-a", "--root", home, "--json"]);
  assert.deepEqual(effects(bb), ["project create", "thread spawn"]);
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
  ["bb refuses the spawn", { "thread spawn": { error: { code: "invalid_request", message: "HTTP 400: Unknown model" } } }, /Unknown model/],
  ["bb cannot list its projects", { "project list": UNREACHABLE }, /does not answer/],
  ["bb cannot list its threads", { "thread list": { stdout: "garbage" } }, /not JSON/],
  ["bb cannot create the project", { "project list": { stdout: [] }, "project create": { error: { code: "error", message: "HTTP 500: no" } } }, /project create/],
  ["bb's spawn answers no thread id", { "thread spawn": { stdout: { status: "starting" } } }, /no thread id/],
]) {
  test(`${name}: the launch fails and says why`, async (t) => {
    const { run } = await setup(t, script);
    const answer = await run();
    assert.equal(answer.ok, false);
    assert.ok(["E_SESSION_START_FAILED", "E_BACKEND_UNREACHABLE"].includes(answer.error.code), answer.error.code);
    assert.match(answer.error.message, pattern);
  });
}

test("a spawn cut off by time may have made the thread: E_SESSION_START_FAILED, saying so", async (t) => {
  const { home, backend, bb, input } = await setup(t, { "thread spawn": { delayMs: 8_000, ...spawned() } });
  // In process, so the deadline can be near: the provider's own launch budget is 100 s.
  await assert.rejects(
    launch(input(), readSettings(backend.settings({ cli: bb.cli })), { deadline: Date.now() + 3_000, env: { ...process.env, ...bb.env } }),
    (error) => error.code === "E_SESSION_START_FAILED" && /may have been created/.test(error.message),
  );
  assert.equal(existsSync(join(home, ".claude/settings.local.json")), true);
});
