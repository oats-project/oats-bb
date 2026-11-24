// Nothing in bb's pi may hold the agent's mail stream (contract r23, A12(3)): a pi launch is
// refused unless the pi configuration bb's server runs with lists @awebai/oats-pi and not
// @awebai/pi. The provider reads that configuration, and never changes it.
//
// One host-only flake, seen once under load: a test here answered E_BACKEND_EXPOSED. The
// provider's exposure check connects to the fake bb's port on every address of this host
// that is not loopback, and another process of the machine happened to listen there on
// the same port number. It is the check working, on a busy host; the tests run alone, or
// on a runner with nothing else listening, do not meet it.
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { readPiPackages } from "../../oats-package/capabilities/oats-bb/lib/pi-config.mjs";
import { UNREACHABLE, VERSION, call, fakeBackend, fakeBbIn, piModelRow, projectRow, runBin, scratch } from "../fixtures/harness.mjs";

const envList = (names) => ({ builtInGit: { status: "not logged in" }, variables: names.map((name) => ({ name, value: null, secret: true, note: null })), inheritedVariables: [] });
const PI_LAUNCH = { harness: "pi", yolo: true, args: [] };
const BRIDGE = "npm:@awebai/oats-pi@0.70.0";
const machineEnvReads = (bb) => bb.calls().filter((c) => c.argv.slice(0, 3).join(" ") === "machine env list" && !c.argv.includes("--project")).length;

async function setup(t, script = {}, backendOverrides = {}) {
  const { dir, home } = scratch(t);
  const backend = await fakeBackend(t, backendOverrides);
  const bb = fakeBbIn(dir, {
    "--version": { stdout: `${VERSION}\n` },
    "project list": { stdout: [projectRow("proj_a", home)] },
    "thread list": { stdout: [] },
    "thread spawn": { stdout: { id: "thr_new", projectId: "proj_a", providerId: "pi", status: "starting" } },
    "machine env list": { stdout: envList([]) },
    "machine env set": { stdout: envList([]) },
    "machine env unset": { stdout: envList([]) },
    "provider models pi": { stdout: [piModelRow("mock", "echo")] },
    ...script,
  });
  const launch = (extra = {}, settings = {}) => call("launch", { home, instance: "dev-a", harness: "pi", model: "mock/echo", yolo: true, env: [{ name: "OATS_INSTANCE", value: "dev-a", source: "kernel" }, { name: "OATS_INSTANCE_HOME", value: home, source: "kernel" }], unset: [], args: [], promptFile: join(home, "TASK.md"), previous: null, ...extra }, { settings: backend.settings(settings), bb });
  const check = (planned, settings = {}) => call("check", { home, soul: null, ...(planned ? { launch: planned } : {}) }, { settings: backend.settings(settings), bb });
  return { dir, home, backend, bb, launch, check };
}
const spawned = (bb) => bb.calls().some((c) => c.argv[1] === "spawn");

for (const [name, packages] of [
  ["as pi install writes it", [BRIDGE, "npm:@awebai/pi"]],
  ["with a version", [BRIDGE, "npm:@awebai/pi@0.5.0"]],
  ["as an object with a skills filter", [BRIDGE, { source: "npm:@awebai/pi@0.4.1", skills: [] }]],
]) {
  test(`@awebai/pi in bb's pi configuration, ${name}: the pi launch is refused E_BACKEND_PI_LISTENER before anything is changed, and the check of that launch says so`, async (t) => {
    const { backend, bb, launch, check } = await setup(t);
    backend.piSettings({ packages });
    const before = readFileSync(join(backend.piAgentDir, "settings.json"), "utf8");
    const answer = await launch();
    assert.equal(answer.error.code, "E_BACKEND_PI_LISTENER");
    assert.match(answer.error.message, /^bb's pi would take this agent's mail: @awebai\/pi is in bb's pi configuration, and every pi bb starts \(a hidden one too\) connects to aweb as the agent/);
    assert.match(answer.error.message, /Give bb's server a pi configuration without it \(PI_CODING_AGENT_DIR, and settings\.oats\.bb\.piAgentDir\)/);
    assert.match(answer.error.message, /or silence it in bb's processes only: printf session \| bb machine env set AWEB_DELIVERY\./);
    assert.ok(answer.error.message.includes(backend.piAgentDir), "the directory read is named");
    assert.ok(answer.error.message.length <= 480, String(answer.error.message.length));
    assert.equal(spawned(bb), false);
    assert.deepEqual(bb.calls().map((c) => c.argv.slice(0, 3).join(" ")), ["--version", "host list --json", "machine env list"], "bb was only read");
    const planned = (await check(PI_LAUNCH)).result;
    assert.equal(planned.status, "needs-configuration");
    assert.deepEqual(planned.problems.map((problem) => problem.code), ["E_BACKEND_PI_LISTENER"]);
    assert.equal(readFileSync(join(backend.piAgentDir, "settings.json"), "utf8"), before, "the provider only reads the configuration");
  });
}

test("with a long piAgentDir the remedy is still whole, in the refusal and in the warning of a read with no planned launch: what a cut takes is the path", async (t) => {
  const { dir, launch, check } = await setup(t);
  const long = join(dir, "a-pi-configuration-directory-with-a-long-name".repeat(4), "agent");
  mkdirSync(long, { recursive: true });
  writeFileSync(join(long, "settings.json"), JSON.stringify({ packages: [BRIDGE, "npm:@awebai/pi"] }));
  const REMEDY = /Give bb's server a pi configuration without it \(PI_CODING_AGENT_DIR, and settings\.oats\.bb\.piAgentDir\), or silence it in bb's processes only: printf session \| bb machine env set AWEB_DELIVERY\. Read: /;
  const refused = await launch({}, { piAgentDir: long });
  assert.equal(refused.error.code, "E_BACKEND_PI_LISTENER");
  assert.match(refused.error.message, REMEDY);
  assert.ok(refused.error.message.length <= 480);
  const warning = (await check(null, { piAgentDir: long })).result.warnings.find((entry) => entry.code === "session-provider-pi-not-ready");
  assert.match(warning.message, /^a pi launch would be refused here \(E_BACKEND_PI_LISTENER\); Claude launches are not held up\. /);
  assert.match(warning.message, REMEDY);
  assert.ok(warning.message.length <= 480, String(warning.message.length));
  // And with the team image's own directory the whole warning fits, the file it read included.
  const beforeThePath = warning.message.indexOf("Read: ") + "Read: ".length;
  assert.ok(beforeThePath + "/state/home/.bb-pi/settings.json".length <= 480, String(beforeThePath));
  // The other two findings of that directory are written the same way: the remedy whole, the path last.
  writeFileSync(join(long, "settings.json"), JSON.stringify({ packages: [] }));
  const noBridge = await launch({}, { piAgentDir: long });
  assert.equal(noBridge.error.code, "E_BACKEND_NOT_READY");
  assert.match(noBridge.error.message, /Install it there \(PI_CODING_AGENT_DIR=<that directory> pi install npm:@awebai\/oats-pi\), or point settings\.oats\.bb\.piAgentDir at the directory bb's server uses \(in the team image for bb: \/state\/home\/\.bb-pi\)\. Read: /);
  writeFileSync(join(long, "settings.json"), "{ not json");
  const unreadable = await launch({}, { piAgentDir: long });
  assert.equal(unreadable.error.code, "E_BACKEND_NOT_READY");
  assert.match(unreadable.error.message, /fix the file, or point settings\.oats\.bb\.piAgentDir at the directory bb's server uses\. Read: /);
  for (const answer of [noBridge, unreadable]) assert.ok(answer.error.message.length <= 480);
});

test("nothing of Claude's sandbox is read for pi: a pi launch and its check take whatever `sandbox` holds, and say nothing of it", async (t) => {
  const { launch, check } = await setup(t);
  const garbage = { domains: "not a list", write: 7, missing: [{ capability: "oats.aweb", setting: "services" }], somethingNew: true };
  const planned = (await check({ ...PI_LAUNCH, sandbox: garbage })).result;
  assert.equal(planned.status, "ready");
  assert.deepEqual(planned.warnings, []);
  assert.equal((await launch({ sandbox: garbage, trees: "nor this", protected: 7 })).ok, true);
  // The same planned launch for Claude is told of the gap, as before.
  assert.deepEqual((await check({ harness: "claude", yolo: true, args: [], sandbox: { domains: [], write: [], missing: [{ capability: "oats.aweb", setting: "services" }] } })).result.warnings.map((warning) => warning.code), ["session-provider-sandbox-host-missing"]);
});

test("AWEB_DELIVERY in bb's machine env stands for an @awebai/pi that is listed: it silences the extension in the processes bb runs", async (t) => {
  // The first read is bb's machine env (readiness); the second the home's project env (the launch).
  const { backend, bb, launch, check } = await setup(t, { "machine env list": [{ stdout: envList(["SOMETHING", "AWEB_DELIVERY"]) }, { stdout: envList([]) }] });
  backend.piSettings({ packages: [BRIDGE, "npm:@awebai/pi"] });
  const answer = await launch();
  assert.equal(answer.ok, true, JSON.stringify(answer));
  assert.equal(machineEnvReads(bb), 1);
  // Nothing was set in bb's machine env: that is the operator's.
  assert.deepEqual(bb.calls().filter((c) => c.argv[2] === "set" && !c.argv.includes("--project")), []);
  bb.setScript({ "--version": { stdout: `${VERSION}\n` }, "project list": { stdout: [] }, "thread list": { stdout: [] }, "machine env list": { stdout: envList(["AWEB_DELIVERY"]) } });
  assert.equal((await check(PI_LAUNCH)).result.status, "ready");
});

test("bb's machine env is not asked where @awebai/pi is not listed", async (t) => {
  const { bb, launch } = await setup(t);
  assert.equal((await launch()).ok, true);
  assert.equal(machineEnvReads(bb), 0);
});

test("@awebai/pi is listed and bb's machine env cannot be read: refused, since nothing says the extension is silenced", async (t) => {
  const { backend, bb, launch } = await setup(t, { "machine env list": UNREACHABLE });
  backend.piSettings({ packages: [BRIDGE, "npm:@awebai/pi"] });
  const answer = await launch();
  assert.equal(answer.error.code, "E_BACKEND_PI_LISTENER");
  assert.match(answer.error.message, /bb's machine env could not be read to see whether AWEB_DELIVERY silences it/);
  assert.equal(spawned(bb), false);
});

for (const [name, write] of [
  ["a configuration that lists other packages only", (backend) => backend.piSettings({ packages: ["npm:pi-extensible-workflows", "git:github.com/someone/pi-theme"] })],
  ["a settings.json with no packages", (backend) => backend.piSettings({ theme: "dark" })],
  ["a directory with no settings.json", (backend) => rmSync(join(backend.piAgentDir, "settings.json"))],
  ["a directory that does not exist", (backend) => rmSync(backend.piAgentDir, { recursive: true })],
]) {
  test(`${name}: @awebai/oats-pi is not there, so the home's skills would not load: the pi launch is refused E_BACKEND_NOT_READY naming the install`, async (t) => {
    const { backend, bb, launch, check } = await setup(t);
    write(backend);
    const answer = await launch();
    assert.equal(answer.error.code, "E_BACKEND_NOT_READY");
    assert.match(answer.error.message, /^bb's pi would load none of the home's skills, and nothing would say so: @awebai\/oats-pi is not in bb's pi configuration\. Install it there \(PI_CODING_AGENT_DIR=<that directory> pi install npm:@awebai\/oats-pi\), or point settings\.oats\.bb\.piAgentDir at the directory bb's server uses \(in the team image for bb: \/state\/home\/\.bb-pi\)\. Read: /);
    assert.ok(answer.error.message.endsWith(`Read: ${join(backend.piAgentDir, "settings.json")}`), "the file read is named, last");
    assert.ok(answer.error.message.length <= 480, String(answer.error.message.length));
    assert.equal(spawned(bb), false);
    assert.deepEqual((await check(PI_LAUNCH)).result.problems.map((problem) => problem.code), ["E_BACKEND_NOT_READY"]);
  });
}

test("both wrong: the bridge missing is named first, the listener counted, and the check lists both", async (t) => {
  const { backend, launch, check } = await setup(t);
  backend.piSettings({ packages: ["npm:@awebai/pi"] });
  const answer = await launch();
  assert.equal(answer.error.code, "E_BACKEND_NOT_READY");
  assert.match(answer.error.message, /\(and 1 more: E_BACKEND_PI_LISTENER; see oats readiness\)$/);
  assert.deepEqual((await check(PI_LAUNCH)).result.problems.map((problem) => problem.code), ["E_BACKEND_NOT_READY", "E_BACKEND_PI_LISTENER"]);
});

for (const [name, write, why] of [
  ["that is not JSON", (backend) => backend.piSettings("{ not json"), /it is not JSON/],
  ["that is a JSON list", (backend) => backend.piSettings([]), /it is not a JSON object/],
  ["whose packages is not a list", (backend) => backend.piSettings({ packages: { "npm:@awebai/oats-pi": true } }), /its packages is not a list/],
  ["that is a directory", (backend) => { rmSync(join(backend.piAgentDir, "settings.json")); mkdirSync(join(backend.piAgentDir, "settings.json")); }, /it is not a regular file/],
  ["larger than 1 MiB", (backend) => backend.piSettings(JSON.stringify({ packages: [BRIDGE], pad: "x".repeat(1024 * 1024) })), /it is larger than 1048576 bytes/],
]) {
  test(`a settings.json ${name} cannot be checked: the pi launch is refused, and the file's content is never quoted`, async (t) => {
    const { backend, bb, launch } = await setup(t);
    write(backend);
    const answer = await launch();
    assert.equal(answer.error.code, "E_BACKEND_NOT_READY");
    assert.match(answer.error.message, /^bb's pi configuration cannot be checked: its settings\.json is there and/);
    assert.match(answer.error.message, /fix the file, or point settings\.oats\.bb\.piAgentDir at the directory bb's server uses\. Read: /);
    assert.match(answer.error.message, why);
    assert.doesNotMatch(answer.error.message, /not json|xxxx/);
    assert.equal(spawned(bb), false);
  });
}

test("piAgentDir is refused unless it is an absolute path, as a setting of the wrong shape: by every launch and every readiness read, whatever the harness", async (t) => {
  const { bb, launch, check } = await setup(t);
  const answer = await launch({}, { piAgentDir: "relative/pi-agent" });
  assert.equal(answer.error.code, "E_BACKEND_SETTINGS");
  assert.match(answer.error.message, /settings\.oats\.bb\.piAgentDir must be an absolute path/);
  assert.equal(spawned(bb), false);
  assert.doesNotMatch(answer.error.message, /relative\/pi-agent/, "the value is not shown");
  assert.equal((await launch({ harness: "claude", model: "claude-opus-5-5" }, { piAgentDir: "relative/pi-agent" })).error.code, "E_BACKEND_SETTINGS");
  assert.equal(spawned(bb), false);
  for (const planned of [PI_LAUNCH, { harness: "claude", yolo: true, args: [] }, null]) {
    const result = (await check(planned, { piAgentDir: "relative/pi-agent" })).result;
    assert.equal(result.status, "needs-configuration");
    assert.deepEqual(result.problems.map((problem) => problem.code), ["E_BACKEND_SETTINGS"], JSON.stringify(planned));
  }
  // A value that is not a string is the settings' own refusal, as for every other key.
  assert.equal((await launch({}, { piAgentDir: 7 })).error.code, "E_BACKEND_SETTINGS");
});

test("which entries name the two packages: npm sources by their exact name, with or without a version; nothing else", (t) => {
  const { dir } = scratch(t);
  const read = (packages) => { writeFileSync(join(dir, "settings.json"), JSON.stringify({ packages })); return readPiPackages(dir); };
  assert.deepEqual(read(["npm:@awebai/oats-pi"]), { bridge: true, listener: false });
  assert.deepEqual(read([{ source: "npm:@awebai/oats-pi@0.70.0" }, { source: "npm:@awebai/pi", skills: [] }]), { bridge: true, listener: true });
  // Other packages whose names begin alike are not these.
  assert.deepEqual(read(["npm:@awebai/pi-tools", "npm:@awebai/oats-pi-extra", "npm:@someone/pi", "npm:pi"]), { bridge: false, listener: false });
  // The stated limit: a package installed from a path or a git URL is not recognised by name.
  assert.deepEqual(read(["/src/oats/packages/pi", "git:github.com/awebai/pi", "https://github.com/awebai/aweb", { source: "../pi" }, 7, null, { skills: [] }]), { bridge: false, listener: false });
});

test("a read with no planned launch says, as one warning, what a pi launch would be refused for; a Claude launch is not held up", async (t) => {
  const { backend, check } = await setup(t);
  assert.ok(!(await check()).result.warnings.some((warning) => warning.code === "session-provider-pi-not-ready"), "a bb whose pi is fit: nothing is said");
  backend.piSettings({ packages: ["npm:@awebai/pi"] });
  const plain = (await check()).result;
  assert.equal(plain.status, "ready", "a deployment that runs Claude alone is ready");
  const warning = plain.warnings.find((entry) => entry.code === "session-provider-pi-not-ready");
  assert.match(warning.message, /^a pi launch would be refused here \(E_BACKEND_NOT_READY, E_BACKEND_PI_LISTENER\); Claude launches are not held up\. /);
  assert.ok(warning.message.length <= 480);
  assert.equal(plain.warnings.filter((entry) => entry.code === "session-provider-pi-not-ready").length, 1);
  // The check of a planned Claude launch says nothing of pi, and reads nothing of it.
  const claude = (await check({ harness: "claude", yolo: true, args: [] })).result;
  assert.equal(claude.status, "ready");
  assert.deepEqual(claude.warnings, []);
  // bb's own word on its pi provider is part of it.
  backend.piSettings({ packages: [BRIDGE] });
  backend.state.piProvider = { providerId: "pi", status: "unauthenticated", statusMessage: null, loginCommand: "pi" };
  assert.match((await check()).result.warnings.find((entry) => entry.code === "session-provider-pi-not-ready").message, /bb reports its pi provider as unauthenticated/);
});

test("a bb with no pi installed is told nothing of pi on a plain read, whatever a pi configuration on this host holds", async (t) => {
  const { backend, check } = await setup(t, {}, { piProvider: { providerId: "pi", status: "not_installed", statusMessage: null } });
  backend.piSettings({ packages: ["npm:@awebai/pi"] });
  const plain = (await check()).result;
  assert.equal(plain.status, "ready");
  assert.ok(!plain.warnings.some((warning) => warning.code === "session-provider-pi-not-ready"));
  // And one that does not report a pi provider at all (an older bb).
  backend.state.piProvider = null;
  assert.ok(!(await check()).result.warnings.some((warning) => warning.code === "session-provider-pi-not-ready"));
});

test("oats bb doctor carries the same warning", async (t) => {
  const { backend, bb } = await setup(t);
  backend.piSettings({ packages: [BRIDGE, "npm:@awebai/pi"] });
  const run = await runBin(["doctor", "--json"], { env: { ...bb.env, OATS_SETTINGS: JSON.stringify(backend.settings({ cli: bb.cli })) } });
  assert.equal(run.status, 0);
  assert.match(run.doc.warnings.find((warning) => warning.code === "session-provider-pi-not-ready").message, /E_BACKEND_PI_LISTENER/);
});
