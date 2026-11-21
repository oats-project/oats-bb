// The launch env of a pi thread: three variables, in the env of the home's bb project
// (contract r23, A13(1) and A14). Written whole at every pi launch, removed at retire and when the
// home leaves bb.
import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { piPathRefusal } from "../../oats-package/capabilities/oats-bb/lib/project-env.mjs";
import { PATH_WITHOUT_BWRAP, UNREACHABLE, VERSION, call, fakeBackend, fakeBbIn, projectRow, runBin, scratch, threadRow } from "../fixtures/harness.mjs";

// bb-app 0.50.1's answer to every `bb machine env` command: the names, never a value.
const envList = (names) => ({ builtInGit: { status: "not logged in" }, variables: names.map((name) => ({ name, value: null, secret: true, note: null })), inheritedVariables: [] });
const entry = (name, value, extra = {}) => ({ name, value, source: "kernel", ...extra });
const envCalls = (bb) => bb.calls().filter((c) => c.argv[0] === "machine").map((c) => [c.argv.slice(2).join(" "), c.stdin]);
const names = (bb) => bb.calls().map((c) => c.argv.slice(0, c.argv[0] === "machine" ? 3 : 2).join(" "));

async function setup(t, script = {}) {
  const { dir, home } = scratch(t);
  const backend = await fakeBackend(t);
  const bb = fakeBbIn(dir, {
    "--version": { stdout: `${VERSION}\n` },
    "project list": { stdout: [projectRow("proj_a", home)] },
    "thread list": { stdout: [] },
    "thread stop": { stdout: { ok: true } },
    "thread show": { stdout: { thread: threadRow("thr_a", "proj_a", "idle", { providerId: "pi" }), environment: null, pendingTodos: null } },
    "thread spawn": { stdout: { id: "thr_new", projectId: "proj_a", environmentId: null, providerId: "pi", status: "starting" } },
    "machine env list": { stdout: envList([]) },
    "machine env set": { stdout: envList([]) },
    "machine env unset": { stdout: envList([]) },
    ...(typeof script === "function" ? script(home) : script),
  });
  // A directory that holds a `pi`, and one that holds none: the PATH a launch names.
  const withPi = join(dir, "pi-bin"), withoutPi = join(dir, "no-pi-bin");
  mkdirSync(withPi); mkdirSync(withoutPi);
  writeFileSync(join(withPi, "pi"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
  const input = (extra = {}) => ({ home, instance: "dev-a", harness: "pi", model: "mock/echo", yolo: true, env: [entry("OATS_INSTANCE", "dev-a"), entry("OATS_INSTANCE_HOME", home)], unset: [], args: [], promptFile: join(home, "TASK.md"), previous: null, ...extra });
  // `path`: the PATH oats (and so the provider) runs with, for the tests of what a pi
  // thread's PATH is composed of. It always needs a node: the fake bb is a node script.
  const run = (extra, { path } = {}) => call("launch", input(extra), { settings: backend.settings(), bb, ...(path ? { env: { PATH: path } } : {}) });
  return { dir, home, backend, bb, run, withPi, withoutPi };
}

test("a pi launch writes its env into the home's bb project, each value on stdin, before the spawn", async (t) => {
  const { home, bb, run } = await setup(t);
  assert.equal((await run()).ok, true);
  assert.deepEqual(envCalls(bb), [
    ["list --project proj_a --json", ""],
    ["set OATS_INSTANCE --project proj_a --json", "dev-a"],
    ["set OATS_INSTANCE_HOME --project proj_a --json", home],
  ]);
  const order = names(bb);
  assert.ok(order.lastIndexOf("machine env set") < order.indexOf("thread spawn"), order.join(", "));
  // A value is never an argument: bb's process list would show it.
  for (const c of bb.calls()) assert.ok(!c.argv.includes(home) || c.argv[0] !== "machine", JSON.stringify(c.argv));
});

test("the project's env is the provider's, whole: a name the launch does not carry is removed, whoever set it", async (t) => {
  const { home, bb, run } = await setup(t, { "machine env list": { stdout: envList(["OATS_INSTANCE", "STALE_FROM_AN_EARLIER_LAUNCH", "A_PERSONS_OWN"]) } });
  assert.equal((await run({ env: [entry("OATS_INSTANCE", "dev-a"), entry("OATS_INSTANCE_HOME", home)] })).ok, true);
  assert.deepEqual(envCalls(bb), [
    ["list --project proj_a --json", ""],
    ["unset STALE_FROM_AN_EARLIER_LAUNCH --project proj_a --json", ""],
    ["unset A_PERSONS_OWN --project proj_a --json", ""],
    ["set OATS_INSTANCE --project proj_a --json", "dev-a"],
    ["set OATS_INSTANCE_HOME --project proj_a --json", home],
  ]);
});

for (const [name, env] of [
  ["no OATS_INSTANCE_HOME at all", () => [entry("OATS_INSTANCE", "dev-a")]],
  ["one that a capability set, which is not carried", (home) => [entry("OATS_INSTANCE", "dev-a"), entry("OATS_INSTANCE_HOME", home, { source: "capability", capability: "some.capability" })]],
  ["one marked secret, which is not carried", (home) => [entry("OATS_INSTANCE_HOME", home, { secret: true })]],
  ["one that names another directory than the launch's home", () => [entry("OATS_INSTANCE_HOME", "/another/home")]],
]) {
  test(`a pi launch with ${name} is refused before bb is asked: the thread would load none of the home's skills, and nothing would say so`, async (t) => {
    const { home, bb, run } = await setup(t);
    const answer = await run({ env: env(home) });
    assert.equal(answer.error.code, "E_BACKEND_LAUNCH_ENV");
    assert.match(answer.error.message, /a pi launch must carry OATS_INSTANCE_HOME, from the kernel, naming the launch's home/);
    assert.ok(!answer.error.message.includes("/another/home"), "a value is never part of a message");
    assert.deepEqual(bb.calls(), []);
  });
}

test("only OATS_INSTANCE, OATS_INSTANCE_HOME and PATH ever go into bb's project env: what a capability or the kernel adds beside them is left out", async (t) => {
  const { home, bb, run, withPi } = await setup(t);
  const shim = join(home, ".oats/bin");
  // A launch as the kernel hands one for a pi home with messaging: oats.aweb's three, and more.
  const answer = await run({
    pathPrepend: [shim],
    env: [
      entry("OATS_INSTANCE", "dev-a"), entry("OATS_INSTANCE_HOME", home),
      // A PATH the kernel or a capability names is not what the thread gets: PATH holds paths only,
      // the launch's directories and then the PATH oats runs with.
      entry("PATH", "/a/capability/chose/this", { source: "capability", capability: "some.capability" }),
      entry("AWEB_DELIVERY", "session", { source: "capability", capability: "oats.aweb" }),
      entry("AWEB_IDENTITY_HOME", join(home, ".aw"), { source: "capability", capability: "oats.aweb" }),
      entry("AWID_REGISTRY_URL", "https://registry.example", { source: "capability", capability: "oats.aweb" }),
      entry("A_CAPABILITY_TOKEN", "s3cret-value", { source: "capability", capability: "some.capability", secret: true }),
      entry("OATS_SOMETHING_NEW", "x"),
    ],
    unset: ["AWEB_CHANNEL", "ANTHROPIC_API_KEY"],
  }, { path: `${withPi}:${PATH_WITHOUT_BWRAP}` });
  assert.equal(answer.ok, true, JSON.stringify(answer));
  assert.deepEqual(envCalls(bb), [
    ["list --project proj_a --json", ""],
    ["set OATS_INSTANCE --project proj_a --json", "dev-a"],
    ["set OATS_INSTANCE_HOME --project proj_a --json", home],
    ["set PATH --project proj_a --json", `${shim}:${withPi}:${PATH_WITHOUT_BWRAP}`],
  ]);
  // Nothing else reached bb in any form: not as an argument, not on stdin.
  for (const c of bb.calls()) assert.ok(!JSON.stringify(c).includes("s3cret-value") && !JSON.stringify(c).includes("registry.example"), JSON.stringify(c.argv));
});

for (const [name, extra, pattern] of [
  ["a launch configuration's variable", entry("EDITOR", "vi", { source: "launch-config" }), /the launch sets EDITOR \(source launch-config\)/],
  ["a launch configuration's secret", entry("API_TOKEN", "s3cret-value", { source: "launch-config-reference" }), /the launch sets API_TOKEN \(source launch-config-reference\)/],
  ["an entry of a source the provider does not know", entry("FROM_NOWHERE", "x", { source: "operator" }), /the launch sets FROM_NOWHERE \(source operator\)/],
  ["an entry with no source", { name: "NO_SOURCE", value: "x" }, /the launch sets NO_SOURCE,/],
  ["pi's own configuration directory, from a launch configuration", entry("PI_CODING_AGENT_DIR", "/elsewhere", { source: "launch-config" }), /the launch sets PI_CODING_AGENT_DIR/],
  ["the kernel's own name from a launch configuration", entry("OATS_INSTANCE_HOME", "/elsewhere", { source: "launch-config" }), /the launch sets OATS_INSTANCE_HOME \(source launch-config\)/],
  ["a PATH from a launch configuration: PATH holds paths only, never a value out of a launch's env", entry("PATH", "/elsewhere", { source: "launch-config" }), /the launch sets PATH \(source launch-config\)/],
  ["a PATH from a secret source", entry("PATH", "/elsewhere", { source: "launch-config-reference" }), /the launch sets PATH/],
]) {
  test(`${name} is refused for pi, by name: a person asked for it, and it cannot reach the thread`, async (t) => {
    const { bb, run } = await setup(t);
    const answer = await run({ env: [entry("OATS_INSTANCE", "dev-a"), extra] });
    assert.equal(answer.error.code, "E_BACKEND_LAUNCH_ENV");
    assert.match(answer.error.message, pattern);
    assert.match(answer.error.message, /carries nothing of a launch's environment to a pi thread but OATS_INSTANCE, OATS_INSTANCE_HOME and PATH: bb would keep it in its database, where a credential must never land/);
    assert.ok(!answer.error.message.includes("s3cret-value") && !answer.error.message.includes("/elsewhere"), "a value is never part of a message");
    assert.deepEqual(bb.calls(), []);
  });
}

for (const [name, env, pattern] of [
  ["an env that is not a list", { OATS_INSTANCE: "dev-a" }, /must be a list/],
  ["an entry with no name", [{ value: "x", source: "kernel" }], /has no name/],
  ["a name that is no variable name", [entry("--project", "x")], /is not a variable name/],
  ["a name twice", [entry("OATS_INSTANCE", "a"), entry("OATS_INSTANCE", "b", { source: "capability" })], /names OATS_INSTANCE twice/],
  ["a value of more than one line", [entry("OATS_INSTANCE", "a\nb")], /OATS_INSTANCE \(source kernel\) is not a one-line string/],
]) {
  test(`a pi launch's env with ${name}: E_BACKEND_LAUNCH_ENV, bb never called`, async (t) => {
    const { bb, run } = await setup(t);
    const answer = await run({ env });
    assert.equal(answer.error.code, "E_BACKEND_LAUNCH_ENV");
    assert.match(answer.error.message, pattern);
    assert.deepEqual(bb.calls(), []);
  });
}

test("a new home's project gets the env once bb has made it", async (t) => {
  const { home, bb, run } = await setup(t, (h) => ({ "project list": { stdout: [] }, "project create": { stdout: projectRow("proj_new", h) }, "thread spawn": { stdout: { id: "thr_new", projectId: "proj_new", status: "starting" } } }));
  assert.equal((await run({ env: [entry("OATS_INSTANCE_HOME", home)] })).ok, true);
  assert.deepEqual(envCalls(bb), [["list --project proj_new --json", ""], ["set OATS_INSTANCE_HOME --project proj_new --json", home]]);
});

test("pathPrepend is carried as the project's PATH: the shim directory first, then the PATH oats runs with, which must hold pi", async (t) => {
  const { home, bb, run, withPi } = await setup(t);
  const shim = join(home, ".oats/bin");
  assert.equal((await run({ pathPrepend: [shim] }, { path: `${PATH_WITHOUT_BWRAP}:${withPi}` })).ok, true);
  assert.deepEqual(envCalls(bb).slice(1).filter(([what]) => what.includes("PATH")), [["set PATH --project proj_a --json", `${shim}:${PATH_WITHOUT_BWRAP}:${withPi}`]]);
});

test("a PATH with no pi on it refuses the pi launch before bb is asked, naming what is missing: the thread would end as it started", async (t) => {
  const { home, bb, run, withoutPi } = await setup(t);
  const answer = await run({ pathPrepend: [join(home, ".oats/bin")] }, { path: `${withoutPi}:${PATH_WITHOUT_BWRAP}:/nonexistent-dir` });
  assert.equal(answer.error.code, "E_BACKEND_LAUNCH_ENV");
  assert.match(answer.error.message, /holds no pi/);
  assert.match(answer.error.message, /Put pi's directory on the PATH/);
  assert.doesNotMatch(answer.error.message, /nonexistent-dir/, "the PATH itself is not quoted");
  assert.deepEqual(bb.calls(), []);
});

test("a PATH that holds pi and not the program pi is run with refuses the pi launch too, naming it: pi is a script that asks env for node", async (t) => {
  const { dir, home, bb, run } = await setup(t);
  const bin = join(dir, "script-pi-bin");
  mkdirSync(bin);
  writeFileSync(join(bin, "pi"), "#!/usr/bin/env node\nconsole.log('pi')\n", { mode: 0o755 });
  const launch = (path) => run({ pathPrepend: [join(home, ".oats/bin")] }, { path });
  const answer = await launch(bin);
  assert.equal(answer.error.code, "E_BACKEND_LAUNCH_ENV");
  assert.match(answer.error.message, /holds pi and not node, which pi is run with/);
  assert.match(answer.error.message, /Put node's directory on the PATH/);
  assert.deepEqual(bb.calls(), []);
  assert.equal((await launch(`${bin}:${PATH_WITHOUT_BWRAP}`)).ok, true);
});

test("which file is pi: an executable named pi in an absolute directory of the PATH", (t) => {
  const { dir } = scratch(t);
  const bin = join(dir, "bin");
  mkdirSync(bin);
  assert.notEqual(piPathRefusal(bin), null, "no pi there");
  writeFileSync(join(bin, "pi"), "not executable", { mode: 0o644 });
  assert.notEqual(piPathRefusal(bin), null, "a file that cannot be run is no pi");
  chmodSync(join(bin, "pi"), 0o755);
  assert.equal(piPathRefusal(`/nonexistent::${bin}`), null);
  assert.notEqual(piPathRefusal("bin:."), null, "a relative entry is not looked in: it would be read from the provider's own directory");
  assert.equal(piPathRefusal(undefined), null, "a launch that carries no PATH leaves bb's own, which is not the provider's to judge");
});

test("a launch that carries no PATH sets none, and is not asked where pi is", async (t) => {
  const { home, bb, run } = await setup(t);
  assert.equal((await run({ env: [entry("OATS_INSTANCE", "dev-a"), entry("OATS_INSTANCE_HOME", home)] })).ok, true);
  assert.ok(!envCalls(bb).some(([what]) => what.startsWith("set PATH")));
});

test("bb's no to a variable refuses the launch, naming the variable and never its value; no thread is started", async (t) => {
  const { home, bb, run } = await setup(t, { "machine env set": { error: { code: "invalid_request", message: "HTTP 400: Invalid variable" } } });
  const answer = await run({ env: [entry("OATS_INSTANCE_HOME", home)] });
  assert.equal(answer.error.code, "E_SESSION_START_FAILED");
  assert.match(answer.error.message, /bb machine env set OATS_INSTANCE_HOME failed \(HTTP 400: Invalid variable\)/);
  assert.ok(!answer.error.message.includes(home));
  assert.ok(!names(bb).includes("thread spawn"));
});

test("a project env bb cannot list, or lists with a name that is no variable name, refuses the launch: nothing is removed on a guess", async (t) => {
  for (const list of [{ error: { code: "error", message: "HTTP 500: boom" } }, { stdout: { variables: [{ name: "--project" }] } }, { stdout: [] }]) {
    const { bb, run } = await setup(t, { "machine env list": list });
    const answer = await run();
    assert.equal(answer.error.code, "E_SESSION_START_FAILED", JSON.stringify(answer));
    assert.deepEqual(envCalls(bb).map(([what]) => what.split(" ")[0]), ["list"]);
    assert.ok(!names(bb).includes("thread spawn"));
  }
});

test("one home is one bb project: a project that is also rooted elsewhere refuses a pi launch before anything is changed, and not a Claude one", async (t) => {
  const shared = (home) => ({ ...projectRow("proj_a", home), sources: [{ id: "src_1", projectId: "proj_a", type: "local_path", hostId: "host_1", path: home, isDefault: true }, { id: "src_2", projectId: "proj_a", type: "local_path", hostId: "host_1", path: "/another/home", isDefault: false }] });
  const { bb, run } = await setup(t, (h) => ({ "project list": { stdout: [shared(h)] } }));
  const answer = await run();
  assert.equal(answer.error.code, "E_SESSION_START_FAILED");
  assert.match(answer.error.message, /bb project proj_a is rooted at this home and at another directory: one home is one bb project.*Also rooted at: \/another\/home$/);
  assert.deepEqual(envCalls(bb), []);
  assert.ok(!names(bb).includes("thread spawn"));
  assert.equal((await run({ harness: "claude", model: "claude-opus-5-5" })).ok, true, "a Claude launch writes nothing into the project");
});

test("a Claude launch owns no project env: it only reads it, and where a pi launch of the home left its three names, removes those and nothing else", async (t) => {
  const { home, bb, run } = await setup(t);
  assert.equal((await run({ harness: "claude", model: "claude-opus-5-5" })).ok, true);
  assert.deepEqual(envCalls(bb), [["list --project proj_a --json", ""]], "nothing there: nothing set, nothing removed");
  assert.equal(existsSync(join(home, ".claude/settings.local.json")), true);
  // The home ran pi before: bb gives a project's env to every thread of it, and starts
  // `claude` by a project PATH, which a pi launch composed for pi.
  const after = await setup(t, { "machine env list": { stdout: envList(["A_PERSONS_OWN", "OATS_INSTANCE", "OATS_INSTANCE_HOME", "PATH"]) } });
  assert.equal((await after.run({ harness: "claude", model: "claude-opus-5-5" })).ok, true);
  assert.deepEqual(envCalls(after.bb), [
    ["list --project proj_a --json", ""],
    ["unset OATS_INSTANCE --project proj_a --json", ""],
    ["unset OATS_INSTANCE_HOME --project proj_a --json", ""],
    ["unset PATH --project proj_a --json", ""],
  ]);
  const order = names(after.bb);
  assert.ok(order.lastIndexOf("machine env unset") < order.indexOf("thread spawn"), "before the spawn");
});

test("a Claude launch whose project is made by this launch reads no env, and one bb will not let it clean refuses with nothing started", async (t) => {
  const fresh = await setup(t, (h) => ({ "project list": { stdout: [] }, "project create": { stdout: projectRow("proj_new", h) }, "thread spawn": { stdout: { id: "thr_new", projectId: "proj_new", status: "starting" } } }));
  assert.equal((await fresh.run({ harness: "claude", model: "claude-opus-5-5" })).ok, true);
  assert.deepEqual(envCalls(fresh.bb), []);
  const stuck = await setup(t, { "machine env list": { stdout: envList(["PATH"]) }, "machine env unset": { error: { code: "invalid_request", message: "HTTP 400: no" } } });
  const answer = await stuck.run({ harness: "claude", model: "claude-opus-5-5" });
  assert.equal(answer.error.code, "E_SESSION_START_FAILED");
  assert.match(answer.error.message, /what a pi launch left in the env of bb project proj_a could not be removed: bb machine env unset PATH failed/);
  assert.ok(!names(stuck.bb).includes("thread spawn"));
});

// The retire hook, and the launch hook of a home that leaves bb.
const hookEnv = (home, bb, backend, extra = {}) => ({ ...bb.env, OATS_INSTANCE_HOME: home, OATS_SETTINGS: JSON.stringify(backend.settings({ cli: bb.cli })), ...extra });
const lastLine = (run) => { const lines = run.stdout.trim().split("\n").filter(Boolean); return lines.length ? JSON.parse(lines[lines.length - 1]) : null; };

test("retire removes the env of the home's bb project, after the threads are archived", async (t) => {
  const { home, bb, backend } = await setup(t, (h) => ({
    "thread list": { stdout: [threadRow("thr_a", "proj_a", "idle", { providerId: "pi" })] },
    "thread archive": { stdout: { ok: true, threadId: "thr_a" } },
    "machine env list": { stdout: envList(["OATS_INSTANCE", "OATS_INSTANCE_HOME", "PATH"]) },
    "project list": { stdout: [projectRow("proj_a", h), projectRow("proj_z", "/somewhere/else")] },
  }));
  const run = await runBin(["retire-hook"], { env: hookEnv(home, bb, backend) });
  assert.equal(run.status, 0);
  assert.deepEqual(lastLine(run), { meta: { retired: true, archived: ["thr_a"], env: 3 } });
  assert.deepEqual(envCalls(bb), [
    ["list --project proj_a --json", ""],
    ["unset OATS_INSTANCE --project proj_a --json", ""],
    ["unset OATS_INSTANCE_HOME --project proj_a --json", ""],
    ["unset PATH --project proj_a --json", ""],
  ]);
  const order = names(bb);
  assert.ok(order.indexOf("thread archive") < order.indexOf("machine env list"));
});

test("retire of a home with no live thread still removes the project's env, and says it did something", async (t) => {
  const { home, bb, backend } = await setup(t, { "machine env list": { stdout: envList(["OATS_INSTANCE"]) } });
  const run = await runBin(["retire-hook"], { env: hookEnv(home, bb, backend) });
  assert.deepEqual(lastLine(run), { meta: { retired: true, archived: [], env: 1 } });
});

test("retire with an env bb will not remove warns, with the remedy, and does not fail", async (t) => {
  const { home, bb, backend } = await setup(t, { "machine env list": { stdout: envList(["OATS_INSTANCE", "PATH"]) }, "machine env unset": [{ stdout: envList(["PATH"]) }, UNREACHABLE] });
  const run = await runBin(["retire-hook"], { env: hookEnv(home, bb, backend) });
  assert.equal(run.status, 0);
  const last = lastLine(run);
  assert.match(last.warning, /the env a pi launch wrote into this home's bb project could not be removed \(E_BACKEND_UNREACHABLE\).*bb machine env unset <NAME> --project <id>.*Removed: OATS_INSTANCE$/);
  assert.deepEqual(last.meta, { archived: [], env: 1 });
});

test("a home that leaves bb has its project's env removed by the launch hook, on the kernel's word alone", async (t) => {
  const { home, bb, backend } = await setup(t, { "machine env list": { stdout: envList(["OATS_INSTANCE", "PATH"]) } });
  const hook = (extra) => runBin(["launch-hook"], { env: hookEnv(home, bb, backend, { OATS_BACKEND: "tmux", ...extra }) });
  // No word on the previous backend, another backend before, a preview, or bb itself: bb is not asked.
  for (const extra of [{}, { OATS_PREVIOUS_BACKEND: "tmux" }, { OATS_PREVIOUS_BACKEND: "bb", OATS_LAUNCH_PREVIEW: "1" }, { OATS_PREVIOUS_BACKEND: "bb", OATS_BACKEND: "bb" }]) {
    assert.equal((await hook(extra)).stdout, "");
  }
  assert.deepEqual(bb.calls(), []);
  const moved = await hook({ OATS_PREVIOUS_BACKEND: "bb" });
  assert.equal(moved.status, 0);
  assert.equal(moved.stdout.trim().split("\n").length, 1, "one line: the kernel relays the last one's warning");
  assert.match(lastLine(moved).warning, /this home starts on tmux, no longer on bb: the bb provider removed the launch env it kept in the home's bb project \(2 variables\)/);
  assert.deepEqual(envCalls(bb), [["list --project proj_a --json", ""], ["unset OATS_INSTANCE --project proj_a --json", ""], ["unset PATH --project proj_a --json", ""]]);
});

test("a home that leaves bb with a bb that cannot be asked starts all the same, with one warning for both things left", async (t) => {
  const { home, bb, backend } = await setup(t, { "project list": UNREACHABLE });
  mkdirSync(join(home, ".claude"));
  writeFileSync(join(home, ".claude/settings.local.json"), JSON.stringify({ env: { OATS_INSTANCE: "dev-a" } }));
  const moved = await runBin(["launch-hook"], { env: hookEnv(home, bb, backend, { OATS_BACKEND: "tmux", OATS_PREVIOUS_BACKEND: "bb" }) });
  assert.equal(moved.status, 0);
  assert.equal(moved.stdout.trim().split("\n").length, 1);
  const { warning } = lastLine(moved);
  assert.match(warning, /removed its keys from \.claude\/settings\.local\.json/);
  assert.match(warning, /the env a pi launch wrote into this home's bb project could not be removed \(E_BACKEND_UNREACHABLE\)/);
  assert.ok(warning.length <= 480, String(warning.length));
});
