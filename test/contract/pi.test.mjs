// The contract test of pi as a harness (spec P2, items 1 to 6): the provider against the
// pinned bb-app and pi, in a container, with a mock OpenAI-compatible model endpoint. No
// credential, no OATS kernel run: the provider's commands are called on their wire, as the
// kernel calls them. (The image holds the kernel's package only because @awebai/oats-pi,
// the bridge that loads a home's skills into pi, loads it.)
//
// Run: npm run test:contract (needs docker; builds test/contract/pi/Dockerfile at the
// bb-app version in the repository's bb-version file). Again on every bump of bb-app or pi.
import assert from "node:assert/strict";
import { after, afterEach, before, test } from "node:test";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { BB_SERVER, BB_SETTINGS, BB_VERSION, rig, sleep, waitFor } from "./rig.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const PROVIDER = "/repo/oats-package/capabilities/oats-bb/bin/oats-bb.mjs";
const MODEL = "mock/echo";
const SETTINGS = { ...BB_SETTINGS, version: BB_VERSION, trust: "container", dataDir: "/home/node/bbdata" };
// A check as the kernel makes it before a pi launch: with the launch it plans.
const PLANNED = { harness: "pi", yolo: true, args: [] };

const box = rig({
  name: `oats-bb-contract-pi-${process.pid}`,
  image: `oats-bb-contract-pi:${BB_VERSION}`,
  dockerfileDir: resolve(here, "pi"),
  settings: SETTINGS,
  // Both model endpoints: pi's (OpenAI-compatible, 9998) and Claude's (9999), for the test
  // that moves a home between the two harnesses.
  mock: ["mock-openai.mjs", "mock-anthropic.mjs"],
  // CONTRACT_AMBIENT stands for a variable bb's server happens to carry: bb's pi inherits it.
  bbEnv: { CONTRACT_AMBIENT: "from-the-bb-server", ANTHROPIC_BASE_URL: "http://127.0.0.1:9999", ANTHROPIC_API_KEY: "dummy-not-a-real-key" },
  ready: async () => (await box.provider("check", { home: null, soul: null, launch: PLANNED })).result?.status === "ready",
});
const { sh, bbJson, provider, threadStatus, pending } = box;

/** The pi mock's log of model requests, and its next scripted reply: a shell command (a
 *  bash call), or a tool call as JSON. (The rig's own `requests` and `arm` are the
 *  Anthropic mock's, for the Claude threads of the harness-switch test.) */
async function piRequests() {
  const text = await sh("cat pi-mock-requests.jsonl 2>/dev/null || true");
  return text.split("\n").filter(Boolean).map((line) => JSON.parse(line));
}
const arm = (call) => sh("cat > pi-mock-next-cmd", { input: call });

/** The model requests of threads' turns (each offers the agent's tools). */
const turns = async () => (await piRequests()).filter((request) => request.url.includes("chat/completions") && request.tools.length > 0);
/** How many turns a person's message opened: it is the request's last message. */
const landed = async (marker) => (await turns()).filter((request) => request.lastRole === "user" && request.lastText.includes(marker)).length;
/** Whether the turn that `marker` opened was sent with `earlier` among its conversation's
 *  earlier messages: the same conversation, not only the same thread id. */
const carried = async (marker, earlier) => (await turns()).some((request) => request.lastRole === "user" && request.lastText.includes(marker) && request.users.some((text) => text.includes(earlier)));
const idle = (id, timeoutMs = 120_000) => waitFor(`${id} to be idle`, async () => (await threadStatus(id)) === "idle", { timeoutMs });

/** A fresh home in the container, as the kernel leaves one for a pi agent: TASK.md, its
 *  record, a skill composed into it, and its kernel shim directory. */
async function makeHome(name) {
  const home = `/home/node/homes/${name}`;
  await sh([
    `mkdir -p ${home}/.oats/bin ${home}/.agents/skills/contract-skill ${home}/work`,
    `chmod 700 ${home}`,
    `printf 'TASK-${name} say hi.\\n' > ${home}/TASK.md`,
    `echo '{"name":"${name}"}' > ${home}/instance.json`,
    `printf -- '---\\nname: contract-skill\\ndescription: The skill the contract test composed into this home.\\n---\\n# Contract skill\\n' > ${home}/.agents/skills/contract-skill/SKILL.md`,
    // Found by its bare name only if the launch's pathPrepend reached the thread's PATH.
    `printf '#!/bin/sh\\necho shim-on-path\\n' > ${home}/.oats/bin/contract-shim && chmod 755 ${home}/.oats/bin/contract-shim`,
  ].join(" && "));
  return home;
}
const launchInput = (home, name, extra = {}) => ({
  home, instance: name, harness: "pi", model: MODEL, yolo: true,
  env: [{ name: "OATS_INSTANCE", value: name, source: "kernel" }, { name: "OATS_INSTANCE_HOME", value: home, source: "kernel" }],
  unset: [], pathPrepend: [`${home}/.oats/bin`], args: [], promptFile: `${home}/TASK.md`, previous: null, ...extra,
});
/** Launch a pi thread in a fresh home and wait for its first turn to be over. */
async function launched(name, extra) {
  const home = await makeHome(name);
  const since = (await turns()).length;
  const answer = await provider("launch", launchInput(home, name, extra));
  assert.equal(answer.ok, true, JSON.stringify(answer));
  const { endpoint } = answer.result;
  started.push(endpoint.threadId);
  await waitFor(`the first turn of ${endpoint.threadId}`, async () => (await turns()).length > since, { timeoutMs: 120_000 });
  await idle(endpoint.threadId);
  return { home, endpoint, since };
}
const hook = async (which, home, env = {}) => {
  const out = await sh(`${Object.entries({ OATS_INSTANCE_HOME: home, ...env }).map(([key, value]) => `${key}=${value}`).join(" ")} OATS_SETTINGS='${JSON.stringify(SETTINGS)}' node ${PROVIDER} ${which}`);
  const lines = out.trim().split("\n").filter(Boolean);
  return lines.length ? JSON.parse(lines[lines.length - 1]) : null;
};
/** The bb environment a thread is on: one per home, shared by every thread that runs there. */
const environmentOf = async (id) => (await bbJson(`thread show ${id}`)).thread.environmentId;
/** Every file of a home with its type, mode, size, times and content hash: what "byte for byte untouched" is read from. */
const treeOf = (home) => sh(`cd ${home} && find . -printf '%p %y %m %s %T@ %C@\\n' | sort && find . -type f -exec sha256sum {} + | sort`);
const projectEnv = async (projectId) => (await bbJson(`machine env list --project ${projectId}`)).variables.map((variable) => variable.name).sort();

/** The pi processes that work in the home (pi names its process `pi`), and every process. */
const pisIn = async (home) => Number((await sh(`for p in $(pgrep -x pi); do readlink /proc/$p/cwd 2>/dev/null; done | grep -c '^${home}$' || true`)).trim());
const processesIn = async (home) => Number((await sh(`for p in /proc/[0-9]*; do readlink $p/cwd 2>/dev/null; done | grep -c '^${home}' || true`)).trim());
const nothingIn = (home, why) => waitFor(`no process to work in ${home} (${why})`, async () => (await processesIn(home)) === 0, { timeoutMs: 20_000 });
/** The names of the processes that carry the thread's id (bb's BB_THREAD_ID). */
const carriers = async (threadId) => (await sh(`for p in /proc/[0-9]*; do if tr '\\0' '\\n' < $p/environ 2>/dev/null | grep -qx 'BB_THREAD_ID=${threadId}'; then cat $p/comm; fi; done 2>/dev/null || true`)).split("\n").filter(Boolean);

/** One turn of the thread in which the agent runs one shell command. → what the command
 *  printed, as the model saw it. */
async function bash(threadId, command) {
  const before = (await piRequests()).length;
  await arm(command);
  await sh(`bb thread tell ${threadId} 'contract: next tool call' >/dev/null`);
  const result = await waitFor(`the tool call of ${threadId}`, async () => (await piRequests()).slice(before).find((request) => request.lastRole === "tool") ?? null, { timeoutMs: 120_000, everyMs: 500 });
  await idle(threadId);
  return result.lastText;
}

/** The parents of the processes named `name` that carry the thread's id: each one's
 *  command line, word by word. (bb's process tree, which the provider reads to tell the
 *  harness bb started for a thread from one its agent left running: lib/processes.mjs.) */
const harnessParents = async (threadId, name) => (await sh(`for p in /proc/[0-9]*; do if [ "$(cat $p/comm 2>/dev/null)" = "${name}" ] && tr '\\0' '\\n' < $p/environ 2>/dev/null | grep -qx 'BB_THREAD_ID=${threadId}'; then tr '\\0' ' ' < /proc/$(awk '{print $4}' $p/stat)/cmdline; echo; fi; done`)).split("\n").filter(Boolean).map((line) => line.trim().split(" "));

// The threads the tests launched, stopped after each test: an idle thread keeps its pi.
const started = [];
afterEach(async () => {
  await sh("rm -f pi-mock-error pi-mock-next-cmd mock-error mock-next-cmd; pkill -f 'sleep 90[0]' || true");
  for (const id of started.splice(0)) await sh(`bb thread stop ${id} --json >/dev/null 2>&1 || true`);
});
before(() => box.start(), { timeout: 900_000 });
after(() => box.stop());

test("the image runs the pinned bb-app with pi, and the check of a planned pi launch reads it ready", async () => {
  assert.equal((await sh("bb --version")).trim(), BB_VERSION);
  const state = JSON.parse(await sh(`curl -s '${BB_SERVER}/api/v1/system/providers/state?providerId=pi'`));
  assert.equal(state.providers.length, 1);
  assert.equal(state.providers[0].providerId, "pi");
  assert.equal(state.providers[0].status, "ready", "what the provider reads: bb's own word for its pi provider");
  const ready = (await provider("check", { home: null, soul: null, launch: PLANNED })).result;
  assert.equal(ready.status, "ready");
  assert.deepEqual(ready.problems, []);
});

test("P1 launch: a pi thread in a project rooted at the home, with the launch's model, and nothing of Claude's written", async () => {
  const { home, endpoint, since } = await launched("p1");
  const { thread, environment } = await bbJson(`thread show ${endpoint.threadId}`);
  assert.equal(thread.providerId, "pi");
  assert.equal(thread.projectId, endpoint.projectId);
  assert.equal(thread.title, "P1", "the instance's name as words, still so after pi's first turn");
  assert.equal(environment.path, home);
  const project = (await bbJson("project list")).find((candidate) => candidate.id === endpoint.projectId);
  assert.deepEqual(project.sources.map((source) => source.path), [home]);
  // The prompt file's text is the first turn, on the mock model: bb split provider/id itself.
  const first = (await turns())[since];
  assert.match(first.lastText, /TASK-p1 say hi\./);
  assert.equal((await sh(`ls -a ${home}`)).split("\n").includes(".claude"), false, "a pi launch writes nothing of Claude's");
  // bb's process tree, which `running` rests on (seen at bb-app 0.50.1; a bb that moves it
  // fails here, and the provider would then read every thread at rest as not running): the
  // thread's pi is a direct child of bb-app's bridge worker, run by node under this file
  // name, with the provider it runs as a word of its own. Nothing of it names the thread.
  const parents = await harnessParents(endpoint.threadId, "pi");
  assert.equal(parents.length, 1, JSON.stringify(parents));
  assert.ok(parents[0].some((word) => word.endsWith("/bb-app/host-daemon/dist/bb-provider-bridge-worker.mjs")), parents[0].join(" "));
  assert.ok(parents[0].includes("provider-pi"), parents[0].join(" "));
  assert.ok(!parents[0].join(" ").includes(endpoint.threadId), "bb's runner names the thread now: the provider could ask for this thread's runner");
  // Idle after its turn, its pi still loaded in the home: it runs. (bb says `idle` of a
  // stopped thread too: `running` is read from the home's own harness process.)
  const inspected = (await provider("inspect", { home, endpoint })).result;
  assert.deepEqual(inspected, { present: true, state: "unknown", running: true, open: { label: "Open in bb", url: `${BB_SERVER}/projects/${endpoint.projectId}/threads/${endpoint.threadId}` } });
});

test("P1 bb itself runs pi in full mode only, and the provider refuses the same launch before bb is asked", async () => {
  const home = await makeHome("p1-mode");
  const project = await bbJson(`project create --name p1-mode --root ${home}`);
  const raw = await sh(`bb thread spawn --project ${project.id} --provider pi --model ${MODEL} --environment ${home} --prompt-file ${home}/TASK.md --permission-mode accept-edits --json 2>&1`, { ok: false });
  assert.match(raw, /Provider pi only supports full permission mode/);
  for (const yolo of [false, null]) {
    const answer = await provider("launch", launchInput(home, "p1-mode", { yolo }));
    assert.equal(answer.error.code, "E_BACKEND_SANDBOXED_MODE");
  }
  const withArgs = await provider("launch", launchInput(home, "p1-mode", { args: ["--thinking", "high"] }));
  assert.equal(withArgs.error.code, "E_BACKEND_LAUNCH_ARG");
  assert.deepEqual((await bbJson("thread list --include-hidden")).filter((thread) => thread.projectId === project.id), [], "no thread was started");
});

// The pi model check (lib/pi-model.mjs). The image's pi serves, beside mock/echo: the bare
// id a soul names, from one provider (mock/claude-fable-5.1); one id from two providers
// (mock/twin, mock-b/twin); and one whose id ends in a date (mock-b/dated-20250101), which
// bb holds back from its list (test/contract/pi/models.json).
/** The check of a planned pi launch that names its model, as a kernel that hands the check the model makes it. */
const checkModel = async (model) => (await provider("check", { home: null, soul: null, launch: { ...PLANNED, model } })).result;
const NO_FABLE_9 = 'pi has no model "claude-fable-9" (if you just added it to pi, try again in a minute)';
/** Right after pi's configuration changed, the check refuses nothing (bb serves a list it
 *  fetched for a minute as it is): wait until it refuses a model pi does not have again.
 *  The image's own files are that young where the image was built for this run. */
const refusesAgain = () => waitFor("the model check to refuse again, pi's configuration being older than bb's list can be", async () => JSON.stringify((await checkModel("claude-fable-9")).problems) === JSON.stringify([{ code: "E_BACKEND_LAUNCH_ARG", message: NO_FABLE_9 }]), { timeoutMs: 180_000, everyMs: 3_000 });
/** What bb holds: its projects, and its threads, hidden and archived ones included; and
 *  what the provider holds of its homes' threads (its records: lib/record.mjs). */
const bbHolds = async () => {
  const records = await sh("find ~/.local/state/oats-bb -type f -exec sha256sum {} + 2>/dev/null | sort || true");
  const projects = await bbJson("project list");
  const archived = (await Promise.all(projects.map((project) => bbJson(`thread list --project ${project.id} --archived --include-hidden`)))).flat();
  return { projects: projects.map((project) => project.id).sort(), threads: [...await bbJson("thread list --include-hidden"), ...archived].map((thread) => thread.id).sort(), records };
};
/** bb's own spawn of a pi thread on `model` in a fresh home, with no provider between. → the status the thread settles in. */
async function bbSpawn(name, model) {
  const home = await makeHome(name);
  const project = await bbJson(`project create --name ${name} --root ${home}`);
  const thread = await bbJson(`thread spawn --project ${project.id} --provider pi --model ${model} --environment ${home} --prompt-file ${home}/TASK.md --permission-mode full`);
  started.push(thread.id);
  return waitFor(`${thread.id} to settle`, async () => { const status = await threadStatus(thread.id); return status === "idle" || status === "error" ? status : null; }, { timeoutMs: 120_000 });
}

test("bb's list of pi's models, as the model check reads it: every id is its provider, a slash and the model's own id", async () => {
  const models = await bbJson("provider models pi");
  // (pi's own Anthropic models are listed too: bb's server carries a key for the Claude threads.)
  for (const model of models) {
    assert.equal(model.model, model.id);
    assert.ok(typeof model.routeProviderId === "string" && model.id.startsWith(`${model.routeProviderId}/`) && model.id.length > model.routeProviderId.length + 1, JSON.stringify(model));
  }
  assert.deepEqual(models.filter((model) => model.routeProviderId.startsWith("mock")).map((model) => model.id).sort(),
    ["mock-b/twin", "mock/claude-fable-5.1", "mock/echo", "mock/twin"], "the image's models, the dated one held back");
  // Named exactly, the dated one is listed too: what every read of the check does. Named by its bare id, it is not.
  assert.ok((await bbJson("provider models pi --selected-model mock-b/dated-20250101")).some((model) => model.id === "mock-b/dated-20250101"));
  assert.ok(!(await bbJson("provider models pi --selected-model dated-20250101")).some((model) => model.id === "mock-b/dated-20250101"));
});

// What the check's rule reads beside bb's list, all of it bb-app's and pi's own layout and
// not their CLI (seen at bb-app 0.50.1, pi 1.5.2): a bb or a pi that moves one fails here,
// and the check would then only warn (what it cannot read never refuses).
test("what the model check reads of bb and pi beside the list: bb-app's record of its start in its data directory, and the files that give pi its models in its configuration directory", async () => {
  // bb-app's record: this server, and when it started (after the image's pi settings were written).
  const record = JSON.parse(await sh("cat ~/bbdata/bb-app-runtime.json"));
  assert.equal(record.serverUrl, BB_SERVER);
  assert.match(record.startedAt, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/);
  const [now, settingsChanged] = (await sh("date +%s; stat -c %Z ~/.pi/agent/settings.json")).trim().split("\n").map(Number);
  const started = Date.parse(record.startedAt) / 1000;
  assert.ok(started <= now && started > now - 3600, `${record.startedAt} is this run's start`);
  assert.ok(started > settingsChanged, "bb started after pi's settings were last changed");
  // pi's models come from models.json in that directory (the image's mock models are listed from it), its
  // packages and enabledModels from settings.json there (the last test narrows the list by it).
  assert.match(await sh("cat ~/.pi/agent/models.json"), /"claude-fable-5\.1"/);
  assert.match(await sh("cat ~/.pi/agent/settings.json"), /"packages"/);
  // A pi that runs, bb's own included, leaves those files alone, and auth.json once it has
  // made it (bb's first pi did, when this bb started): otherwise the check would read every
  // list as older than pi's configuration. (It does move the directory's own time, which
  // is why the check does not read that.)
  const times = () => sh("stat -c '%n %Y %Z' ~/.pi/agent/settings.json ~/.pi/agent/models.json ~/.pi/agent/auth.json");
  const before = await times();
  await bbJson("provider models pi --selected-model mock/echo");
  const { endpoint } = await launched("model-times");
  assert.equal(await threadStatus(endpoint.threadId), "idle");
  assert.equal(await times(), before, "a listing and a thread's turn changed none of them");
});

test("a model pi does not have is refused at the check of the planned launch and at the launch, and nothing is created in bb; bb itself would answer a thread that ends in error", async () => {
  await refusesAgain();
  const home = await makeHome("model-unknown");
  const before = await bbHolds();
  for (const model of ["claude-fable-9", "mock/claude-fable-9", "nobody/echo"]) {
    const sentence = `pi has no model ${JSON.stringify(model)} (if you just added it to pi, try again in a minute)`;
    const planned = await checkModel(model);
    assert.equal(planned.status, "needs-configuration");
    assert.deepEqual(planned.problems, [{ code: "E_BACKEND_LAUNCH_ARG", message: sentence }]);
    const answer = await provider("launch", launchInput(home, "model-unknown", { model }));
    assert.deepEqual(answer.error, { code: "E_BACKEND_LAUNCH_ARG", message: sentence });
  }
  assert.deepEqual(await bbHolds(), before, "no project, no thread, and no line in a home's thread record");
  // What the refusal spares: bb takes the id, answers a thread, and the thread fails as it starts.
  assert.equal(await bbSpawn("model-unknown-bb", "claude-fable-9"), "error");
});

test("a bare model id one pi provider serves passes, as a soul declares it (claude-fable-5.1): the check is ready and the thread runs its first turn", async () => {
  const planned = await checkModel("claude-fable-5.1");
  assert.equal(planned.status, "ready");
  assert.deepEqual(planned.problems, []);
  assert.deepEqual(planned.warnings, []);
  const { endpoint, since } = await launched("model-bare", { model: "claude-fable-5.1" });
  assert.match((await turns())[since].lastText, /TASK-model-bare say hi\./, "its first turn reached the model");
  assert.equal(await threadStatus(endpoint.threadId), "idle");
  // And by its full id.
  assert.equal((await checkModel("mock/claude-fable-5.1")).status, "ready");
});

test("a bare model id two pi providers serve is refused, naming both and the full ids; each full id launches; bb itself would answer a thread that ends in error", async () => {
  const home = await makeHome("model-twin");
  const before = await bbHolds();
  const sentence = 'pi model "twin" is served by mock and mock-b: use mock/twin or mock-b/twin (if you just changed that in pi, try again in a minute)';
  assert.deepEqual((await checkModel("twin")).problems, [{ code: "E_BACKEND_LAUNCH_ARG", message: sentence }]);
  assert.deepEqual((await provider("launch", launchInput(home, "model-twin", { model: "twin" }))).error, { code: "E_BACKEND_LAUNCH_ARG", message: sentence });
  assert.deepEqual(await bbHolds(), before, "no project, no thread, and no line in a home's thread record");
  assert.equal(await bbSpawn("model-twin-bb", "twin"), "error");
  for (const model of ["mock/twin", "mock-b/twin"]) assert.deepEqual((await checkModel(model)).problems, [], model);
  const { endpoint } = await launched("model-twin-b", { model: "mock-b/twin" });
  assert.equal(await threadStatus(endpoint.threadId), "idle");
});

test("a model bb holds back from its list is not refused: named by its bare id it only warns, and its thread runs; named exactly it is listed, and nothing is said", async () => {
  const planned = await checkModel("dated-20250101");
  assert.equal(planned.status, "ready");
  assert.deepEqual(planned.warnings.filter((warning) => warning.code === "session-provider-pi-model-unchecked"), [{ code: "session-provider-pi-model-unchecked", message: 'could not check the model "dated-20250101" against pi\'s model list: a model whose id ends in a date is not always listed' }]);
  // bb resolves it: a refusal here would be stricter than bb.
  const { endpoint } = await launched("model-dated", { model: "dated-20250101" });
  assert.equal(await threadStatus(endpoint.threadId), "idle");
  const exact = await checkModel("mock-b/dated-20250101");
  assert.equal(exact.status, "ready");
  assert.deepEqual(exact.warnings, []);
});

// bb's server serves the list of pi's models it fetched for a minute as it is, while a
// thread starts by what pi has now (seen at bb-app 0.50.1, recorded here): a model added
// to pi right after a read of the list is not in the next one. So right after a change of
// pi's configuration the check refuses nothing.
test("a model added to pi a moment ago is not in bb's list yet, and bb starts a thread on it: the check only warns and the launch runs; once bb's list can no longer be older, the check passes it with nothing said", async () => {
  await refusesAgain();
  const sentence = 'pi has no model "late-model" (if you just added it to pi, try again in a minute)';
  assert.deepEqual((await checkModel("late-model")).problems, [{ code: "E_BACKEND_LAUNCH_ARG", message: sentence }], "pi has none yet, and bb has just listed");
  await sh(`node -e 'const fs = require("fs"), file = process.env.HOME + "/.pi/agent/models.json", doc = JSON.parse(fs.readFileSync(file, "utf8")); doc.providers.mock.models.push({ ...doc.providers.mock.models[0], id: "late-model", name: "Added while bb runs (mock)" }); fs.writeFileSync(file, JSON.stringify(doc, null, 2));'`);
  assert.ok(!(await bbJson("provider models pi --selected-model late-model")).some((model) => model.id === "mock/late-model"), "bb still serves the list it fetched");
  const soon = await checkModel("late-model");
  assert.equal(soon.status, "ready");
  assert.deepEqual(soon.warnings.filter((warning) => warning.code === "session-provider-pi-model-unchecked"), [{ code: "session-provider-pi-model-unchecked", message: 'could not check the model "late-model" against pi\'s model list: pi\'s configuration changed a moment ago, and bb\'s list may be older than it' }]);
  // bb resolves it: the launch is taken and the thread runs its first turn.
  const { endpoint } = await launched("model-late", { model: "late-model" });
  assert.equal(await threadStatus(endpoint.threadId), "idle");
  // Later, the list is fetched again and has it: nothing is said. (The model stays in the image's pi for the tests that follow.)
  await waitFor("the check to pass late-model with nothing said", async () => { const later = await checkModel("late-model"); return later.status === "ready" && later.warnings.length === 0; }, { timeoutMs: 180_000, everyMs: 3_000 });
  await refusesAgain();
});

test("P2 the kernel's two variables, the PATH and where the agent's identity is reach the thread's pi and its tools through the project's env, and nothing else of the launch does; the home's skills load", async () => {
  const { home, endpoint, since } = await launched("p2", {
    // As the kernel hands a launch of a home with messaging: oats.aweb's entries beside its own.
    env: [{ name: "OATS_INSTANCE", value: "p2", source: "kernel" }, { name: "OATS_INSTANCE_HOME", value: "/home/node/homes/p2", source: "kernel" },
      { name: "AWEB_DELIVERY", value: "session", source: "capability", capability: "oats.aweb" }, { name: "AWEB_IDENTITY_HOME", value: "/home/node/homes/p2/.aw", source: "capability", capability: "oats.aweb" }],
    unset: ["CONTRACT_AMBIENT"],
  });
  assert.deepEqual(await projectEnv(endpoint.projectId), ["AWEB_IDENTITY_HOME", "OATS_INSTANCE", "OATS_INSTANCE_HOME", "PATH"], "only these four ever go into bb's database");
  // bb shows no value back: nothing of the launch's env can be read out of bb's CLI.
  for (const variable of (await bbJson(`machine env list --project ${endpoint.projectId}`)).variables) assert.equal(variable.value, null, variable.name);
  // The agent's own shell: the kernel's two variables, the home's shim found by its bare
  // name, and where the agent's identity is (a capability's entry, a path inside the home:
  // oats-bb#87). A capability's other entry did not come, and neither did the launch's
  // unset: the thread's pi inherits what the bb server's own environment holds.
  const seen = await bash(endpoint.threadId, `printf '%s|%s|%s|%s|%s|%s|' "$OATS_INSTANCE" "$OATS_INSTANCE_HOME" "$(contract-shim)" "\${AWEB_DELIVERY-unset}" "\${AWEB_IDENTITY_HOME-unset}" "\${CONTRACT_AMBIENT-unset}"`);
  assert.ok(seen.includes(`p2|${home}|shim-on-path|unset|${home}/.aw|from-the-bb-server|`), seen);
  // @awebai/oats-pi loads the home's composed skills only when OATS_INSTANCE_HOME names the home.
  const first = (await turns())[since];
  assert.ok(first.sys.includes("contract-skill"), "the home's skill is in pi's system prompt");
});

// oats-bb#87. `aw` finds an identity in `.aw` of the directory it runs in. A seat with a
// GLOBAL identity through a session grant keeps its identity in `<home>/.aweb-identity`,
// and oats.aweb says so with AWEB_IDENTITY_HOME in the launch's env: left out of a pi
// thread, such a seat received mail and could not send ("current directory is not
// initialized for aw"). The variable now reaches the thread.
// What this shows, with the real aw (the one @awebai/pi brought into the image's second pi
// configuration) run by the agent's own shell: without the variable aw answers the issue's
// very words; with it, aw takes the identity home the launch named, and says so. What it
// does NOT show is a grant seat sending: that needs aweb's server, its registry and a
// resident's custody, none of which this container has, so the identity home here is an
// empty directory and aw stops at reading it.
test("a grant seat's identity home reaches the pi thread: the agent's own aw takes it from the thread's environment (#87); a launch that names none leaves aw where it was", async () => {
  const AW = "/home/node/pi-with-aweb/npm/node_modules/.bin/aw";
  assert.equal((await sh(`test -x ${AW} && echo there || echo none`)).trim(), "there", "the image holds aw, as a dependency of @awebai/pi");
  const ask = `printf '%s|' "\${AWEB_IDENTITY_HOME-unset}"; ${AW} whoami 2>&1 | head -n 1`;
  // A seat as it was before: no identity home named, so aw looks in the directory it runs in.
  const plain = await launched("grant-none");
  assert.deepEqual(await projectEnv(plain.endpoint.projectId), ["OATS_INSTANCE", "OATS_INSTANCE_HOME", "PATH"]);
  const before = await bash(plain.endpoint.threadId, ask);
  assert.ok(before.includes("unset|current directory is not initialized for aw"), before);
  // A grant seat: its identity is in the home's .aweb-identity, and the launch's env says so, as oats.aweb hands it.
  const home = await makeHome("grant-seat");
  await sh(`mkdir -m 700 ${home}/.aweb-identity`);
  const since = (await turns()).length;
  const answer = await provider("launch", launchInput(home, "grant-seat", { env: [{ name: "OATS_INSTANCE", value: "grant-seat", source: "kernel" }, { name: "OATS_INSTANCE_HOME", value: home, source: "kernel" },
    { name: "AWEB_DELIVERY", value: "session", source: "capability", capability: "oats.aweb" }, { name: "AWEB_IDENTITY_HOME", value: `${home}/.aweb-identity`, source: "capability", capability: "oats.aweb" },
    { name: "AWID_REGISTRY_URL", value: "https://registry.invalid", source: "capability", capability: "oats.aweb" }] }));
  assert.equal(answer.ok, true, JSON.stringify(answer));
  const { endpoint } = answer.result;
  started.push(endpoint.threadId);
  await waitFor(`the first turn of ${endpoint.threadId}`, async () => (await turns()).length > since, { timeoutMs: 120_000 });
  await idle(endpoint.threadId);
  assert.deepEqual(await projectEnv(endpoint.projectId), ["AWEB_IDENTITY_HOME", "OATS_INSTANCE", "OATS_INSTANCE_HOME", "PATH"]);
  const after = await bash(endpoint.threadId, ask);
  assert.ok(after.includes(`${home}/.aweb-identity|selected identity home ${home}/.aweb-identity:`), after);
  assert.ok(!after.includes("current directory is not initialized"), after);
  // bb shows no value of it back, as of the others.
  for (const variable of (await bbJson(`machine env list --project ${endpoint.projectId}`)).variables) assert.equal(variable.value, null, variable.name);
  // The retire hook removes it with the rest: the project's env is the provider's, whole.
  assert.equal((await provider("stop", { home, endpoint, graceSeconds: 10 })).ok, true);
  await hook("retire-hook", home);
  assert.deepEqual(await projectEnv(endpoint.projectId), []);
});

test("P2 without the project's env the home's skills do not load: the env is what carries them", async () => {
  const home = await makeHome("p2-bare");
  const project = await bbJson(`project create --name p2-bare --root ${home}`);
  const since = (await turns()).length;
  const thread = await bbJson(`thread spawn --project ${project.id} --provider pi --model ${MODEL} --environment ${home} --prompt-file ${home}/TASK.md --permission-mode full`);
  started.push(thread.id);
  await waitFor("the bare thread's first turn", async () => (await turns()).length > since, { timeoutMs: 120_000 });
  assert.equal((await turns())[since].sys.includes("contract-skill"), false);
});

test("P2 every pi launch rewrites the project's env whole; the retire hook and a move to another backend remove it", async () => {
  const { home, endpoint } = await launched("p2-again");
  assert.deepEqual(await projectEnv(endpoint.projectId), ["OATS_INSTANCE", "OATS_INSTANCE_HOME", "PATH"]);
  // A launch configuration's variable is refused for pi, by name, and nothing is started.
  const refused = await provider("launch", launchInput(home, "p2-again", { previous: endpoint, env: [{ name: "OATS_INSTANCE", value: "p2-again", source: "kernel" }, { name: "CONTRACT_PROBE", value: "probe-value", source: "launch-config" }] }));
  assert.equal(refused.error.code, "E_BACKEND_LAUNCH_ENV");
  assert.match(refused.error.message, /the launch sets CONTRACT_PROBE/);
  // A variable set in the home's project by anyone else is not kept: the project is the provider's.
  await sh(`bb machine env set A_PERSONS_OWN --project ${endpoint.projectId} --json >/dev/null`, { input: "theirs" });
  assert.equal((await provider("stop", { home, endpoint, graceSeconds: 10 })).ok, true);
  const again = await provider("launch", launchInput(home, "p2-again", { previous: endpoint }));
  assert.equal(again.ok, true, JSON.stringify(again));
  started.push(again.result.endpoint.threadId);
  assert.equal(again.result.endpoint.projectId, endpoint.projectId);
  assert.deepEqual(await projectEnv(endpoint.projectId), ["OATS_INSTANCE", "OATS_INSTANCE_HOME", "PATH"]);
  await idle(again.result.endpoint.threadId);

  // The home moves to tmux: the launch hook removes it, on the kernel's word.
  assert.equal(await hook("launch-hook", home, { OATS_BACKEND: "tmux" }), null);
  assert.deepEqual(await projectEnv(endpoint.projectId), ["OATS_INSTANCE", "OATS_INSTANCE_HOME", "PATH"], "no word on the previous backend: nothing is removed");
  const moved = await hook("launch-hook", home, { OATS_BACKEND: "tmux", OATS_PREVIOUS_BACKEND: "bb" });
  assert.match(moved.warning, /removed the launch env it kept in the home's bb project \(3 variables\)/);
  assert.deepEqual(await projectEnv(endpoint.projectId), []);

  // And the retire hook: set again by hand, as a launch would have left it.
  await sh(`bb machine env set OATS_INSTANCE --project ${endpoint.projectId} --json >/dev/null`, { input: "p2-again" });
  const environment = await environmentOf(again.result.endpoint.threadId);
  const retired = await hook("retire-hook", home);
  // (Its receipt names the thread it archived, then the home's thread archived before: the first launch's.
  // And the home's bb environment, which it asked bb to delete: both threads on it are this home's launches'.)
  assert.deepEqual(retired.meta, { retired: true, archived: [again.result.endpoint.threadId, endpoint.threadId], env: 1, environments: [environment] });
  assert.deepEqual(await projectEnv(endpoint.projectId), []);
});

test("P4 a failed turn: with its pi alive the thread is there and at rest, and an input recovers it; with its pi gone it is a lost session, and an input makes bb start pi again for one turn", async () => {
  const { home, endpoint } = await launched("p4");
  // A command the agent starts and leaves running: it inherits bb's BB_THREAD_ID, and is not
  // the thread's harness. (Its working directory is not the home: the kernel's own rule keeps
  // a resume off a home in which a process still works.)
  assert.match(await bash(endpoint.threadId, "cd / && setsid nohup sleep 900 >/dev/null 2>&1 & echo started"), /started/);
  const carriersNow = await carriers(endpoint.threadId);
  assert.ok(["pi", "sleep"].every((name) => carriersNow.includes(name)), carriersNow.join(" "));
  await sh("touch pi-mock-error");
  const failing = await provider("input", { home, endpoint, text: "this turn fails MARK-P4-FAIL" });
  assert.deepEqual(failing.result, { submitted: true, verified: true });
  await waitFor("the thread to be in error", async () => (await threadStatus(endpoint.threadId)) === "error", { timeoutMs: 60_000 });
  // bb keeps the thread's pi loaded after a failed turn, and that process carries the
  // thread's id: what the provider looks for. A resume beside it is what the kernel refuses.
  assert.ok((await pisIn(home)) >= 1);
  assert.ok((await carriers(endpoint.threadId)).includes("pi"), "the thread's pi carries BB_THREAD_ID");
  const inspected = (await provider("inspect", { home, endpoint })).result;
  // (`running` is read from the processes, as for an idle thread: its pi works in the home.)
  assert.deepEqual([inspected.present, inspected.state, inspected.running], [true, "unknown", true]);
  assert.deepEqual((await provider("inspectMany", { homes: [{ home, endpoint }] })).result.results.map((result) => result.present), [true]);
  await sh("rm pi-mock-error");
  const recovering = await provider("input", { home, endpoint, text: "this turn works MARK-P4-OK" });
  assert.deepEqual(recovering.result, { submitted: true, verified: true });
  await waitFor("the recovering turn", async () => (await landed("MARK-P4-OK")) === 1, { timeoutMs: 60_000 });
  await idle(endpoint.threadId);
  assert.equal(await landed("MARK-P4-OK"), 1);

  // The other `error`: the turn failed and the thread's pi is gone (stopped in bb, here).
  // bb still says error; no process carries the thread's id: a lost session.
  await sh("touch pi-mock-error");
  assert.equal((await provider("input", { home, endpoint, text: "this turn fails too MARK-P4-FAIL-2" })).ok, true);
  await waitFor("the thread to be in error again", async () => (await threadStatus(endpoint.threadId)) === "error", { timeoutMs: 60_000 });
  await sh(`bb thread stop ${endpoint.threadId} --json >/dev/null`);
  await nothingIn(home, "after bb's stop of the errored thread");
  assert.equal(await threadStatus(endpoint.threadId), "error", "bb's word did not change: only the process did");
  // What the agent left running outlives its harness, and still carries the thread's id:
  // it does not make the thread present.
  const left = await carriers(endpoint.threadId);
  assert.ok(left.includes("sleep") && !left.includes("pi"), left.join(" "));
  const lost = (await provider("inspect", { home, endpoint })).result;
  assert.deepEqual([lost.present, lost.state, lost.running], [false, "stopped", false]);
  await sh("rm pi-mock-error");
  // An input to it is told: bb answers sent, starts pi again in the same thread and runs the
  // turn, once. (Under the kernel that input is its resume of the lost session, which it
  // counts against the home's cap before it calls the provider: test/contract/kernel/pi-run.mjs.)
  // A bb that stops doing this fails here: the rule rests on it (contract r23, A14(3)).
  assert.deepEqual((await provider("input", { home, endpoint, text: "MARK-P4-RESUMED" })).result, { submitted: true, verified: true });
  await waitFor("bb's restart of the errored thread", async () => (await landed("MARK-P4-RESUMED")) === 1, { timeoutMs: 90_000 });
  await idle(endpoint.threadId);
  assert.equal(await landed("MARK-P4-RESUMED"), 1, "one turn");
  assert.ok((await carriers(endpoint.threadId)).includes("pi"), "the thread's pi runs again");
  assert.deepEqual((await provider("inspect", { home, endpoint })).result.present, true);
});

// Changed with contract r24, A15(1). This test ended "and to a stopped thread, which
// restarts": a tell started pi again in a thread OATS had stopped, which is what a message
// in bb's composer did behind OATS's back. The provider's stop now archives the thread: the
// tell is refused and nothing restarts, and bb's restart at a tell (still bb's fact, still
// pinned) is reached by unarchiving first.
test("P6 input is one turn per tell: to an idle thread, and as two steers during a turn; a thread OATS stopped is archived: a tell to it is refused and restarts nothing, until a person unarchives it", async () => {
  const { home, endpoint } = await launched("p6");
  // Idle.
  assert.deepEqual((await provider("input", { home, endpoint, text: "MARK-P6-IDLE" })).result, { submitted: true, verified: true });
  await waitFor("the idle tell's turn", async () => (await landed("MARK-P6-IDLE")) === 1);
  await idle(endpoint.threadId);

  // During a turn (a tool call that runs for a while): each tell is taken (a steer), none
  // is held in line, and each opens a model request of its own once the tool call is over.
  await arm("sleep 12");
  await sh(`bb thread tell ${endpoint.threadId} 'contract: a long tool call' >/dev/null`);
  await waitFor("the thread to be in its turn", async () => (await threadStatus(endpoint.threadId)) === "active", { timeoutMs: 30_000 });
  for (const marker of ["MARK-P6-STEER-ONE", "MARK-P6-STEER-TWO"]) {
    assert.deepEqual((await provider("input", { home, endpoint, text: marker })).result, { submitted: true, verified: true }, marker);
  }
  assert.deepEqual(await bbJson(`thread queue list ${endpoint.threadId}`), [], "nothing is held in line");
  await waitFor("both steers to reach the model", async () => (await landed("MARK-P6-STEER-ONE")) === 1 && (await landed("MARK-P6-STEER-TWO")) === 1, { timeoutMs: 90_000 });
  await idle(endpoint.threadId);
  for (const marker of ["MARK-P6-IDLE", "MARK-P6-STEER-ONE", "MARK-P6-STEER-TWO"]) assert.equal(await landed(marker), 1, `${marker} opened one turn, once`);

  // Stopped by the provider (bb has no stopped state: its pi is gone, the thread reads
  // idle), and archived by it.
  assert.deepEqual((await provider("stop", { home, endpoint, graceSeconds: 10 })).result, { stopped: true });
  await nothingIn(home, "after the stop");
  assert.equal(await threadStatus(endpoint.threadId), "idle");
  assert.notEqual((await bbJson(`thread show ${endpoint.threadId}`)).thread.archivedAt, null, "the stop archived the thread");
  // The conversation is still bb's, readable, among the project's archived threads.
  assert.deepEqual((await bbJson(`thread list --archived --project ${endpoint.projectId}`)).map((thread) => thread.id), [endpoint.threadId]);
  // A message to it, as bb's composer or a person's `bb thread tell` sends one: bb refuses
  // it, in its own words (a bb that takes it again fails here: the stop's archive rests on it).
  const raw = JSON.parse(await sh(`bb thread tell ${endpoint.threadId} 'MARK-P6-STOPPED-RAW' --json`, { ok: false }));
  assert.equal(raw.ok, false, JSON.stringify(raw));
  assert.match(raw.error.message, /archived/i);
  // And through the provider: refused, nothing sent.
  const refused = await provider("input", { home, endpoint, text: "MARK-P6-STOPPED" });
  assert.equal(refused.error?.code, "E_SESSION_INPUT_FAILED", JSON.stringify(refused));
  assert.match(refused.error.message, /archived/i);
  // Nothing restarted: no turn reached the model, no harness process in the home, and the
  // provider reads the home's session as gone.
  await sleep(6_000);
  assert.equal(await landed("MARK-P6-STOPPED"), 0, "a tell to a thread OATS stopped reached the model");
  assert.equal(await processesIn(home), 0, "a tell to a thread OATS stopped started a process in the home");
  assert.deepEqual(await carriers(endpoint.threadId), []);
  assert.deepEqual((await provider("inspect", { home, endpoint })).result, { present: false, state: "stopped", running: false });

  // Unarchived by hand (a person's act in bb, outside OATS): bb's own restart at a tell is
  // still there. The tell answers sent, pi starts again on the same conversation and runs
  // one turn, and the provider reads the thread present.
  await sh(`bb thread unarchive ${endpoint.threadId} --json`);
  assert.equal((await bbJson(`thread show ${endpoint.threadId}`)).thread.archivedAt ?? null, null);
  assert.deepEqual((await provider("input", { home, endpoint, text: "MARK-P6-RESTART" })).result, { submitted: true, verified: true });
  await waitFor("the restarted thread's turn", async () => (await landed("MARK-P6-RESTART")) === 1, { timeoutMs: 90_000 });
  await idle(endpoint.threadId);
  assert.equal(await landed("MARK-P6-RESTART"), 1);
  assert.equal(await carried("MARK-P6-RESTART", "MARK-P6-IDLE"), true, "the restarted turn carries the conversation from before the stop");
  assert.ok((await pisIn(home)) >= 1, "the thread's pi runs again");
  assert.deepEqual((await provider("inspect", { home, endpoint })).result.present, true);
  assert.equal(await landed("MARK-P6-STOPPED"), 0);

  // Stopped with the host (`reason: "host"`, the kernel's word for `oats host run`'s
  // shutdown): a loss the kernel undoes by an input to this same thread. The thread is
  // stopped and NOT archived, and the input starts pi again on the same conversation.
  // Before it, the agent starts a pi of its own in its home and leaves it running detached
  // (here a process that goes by that name): it inherits the thread's id, and outlives
  // every stop of the thread. It is not the harness bb started for the thread.
  assert.match(await bash(endpoint.threadId, "setsid nohup bash -c 'exec -a pi sleep 900' >/dev/null 2>&1 & echo started"), /started/);
  const detached = async () => (await sh(`for p in /proc/[0-9]*; do if tr '\\0' '\\n' < $p/environ 2>/dev/null | grep -qx 'BB_THREAD_ID=${endpoint.threadId}' && [ "$(tr '\\0' ' ' < $p/cmdline)" = "pi 900 " ]; then readlink $p/cwd; fi; done`)).trim();
  assert.equal(await detached(), home, "the detached process carries the thread's id, is named pi and works in the home");
  // (And the thread is idle after a turn, its pi loaded in the home, and reads running.)
  assert.equal(await threadStatus(endpoint.threadId), "idle");
  assert.deepEqual((await provider("inspect", { home, endpoint })).result.running, true, "an idle thread whose harness is loaded in the home runs");
  assert.deepEqual((await provider("inspectMany", { homes: [{ home, endpoint }] })).result.results.map((result) => result.running), [true]);
  assert.deepEqual((await provider("stop", { home, endpoint, graceSeconds: 10, reason: "host" })).result, { stopped: true });
  // At once, with no wait: the stop answered only when the harness had left the home, and
  // what the agent left running there (it is still there) is not taken for it. A home
  // stopped with the host is never read as one that came back.
  assert.deepEqual((await provider("inspect", { home, endpoint })).result.running, false, "right after a stop with the host the home read as running");
  assert.equal(await detached(), home, "the detached process outlived the stop");
  assert.ok(!(await carriers(endpoint.threadId)).includes("pi"), "the thread's own pi is gone");
  // That `false` is said at the bb the provider is pinned to, where bb's runner is known.
  // Against another pin (as after a bb bump, where bb may have moved its runner) the same
  // process cannot be told from a harness, and reads null: never true, and never a refusal.
  const elsewherePinned = await provider("inspect", { home, endpoint }, { version: "0.0.1" });
  assert.equal(elsewherePinned.ok, true, JSON.stringify(elsewherePinned));
  assert.equal(elsewherePinned.result.running, null);
  assert.equal((await bbJson(`thread show ${endpoint.threadId}`)).thread.archivedAt ?? null, null, "a stop with the host archived the thread: the kernel's resume would be refused");
  const hostStopped = (await provider("inspect", { home, endpoint })).result;
  // The same thread, still `idle` for bb and still live: its harness is gone, and it reads
  // so. This is what tells the kernel a home stopped with the host from one that came back.
  assert.deepEqual([hostStopped.present, hostStopped.state, hostStopped.running], [true, "unknown", false]);
  assert.deepEqual((await provider("inspectMany", { homes: [{ home, endpoint }] })).result.results.map((result) => result.running), [false]);
  assert.deepEqual((await provider("input", { home, endpoint, text: "MARK-P6-HOST-RESUMED" })).result, { submitted: true, verified: true });
  await waitFor("the resumed thread's turn", async () => (await landed("MARK-P6-HOST-RESUMED")) === 1, { timeoutMs: 90_000 });
  await idle(endpoint.threadId);
  assert.equal(await landed("MARK-P6-HOST-RESUMED"), 1);
  assert.equal(await carried("MARK-P6-HOST-RESUMED", "MARK-P6-IDLE"), true, "the resumed turn carries the conversation from before the stop");
  assert.ok((await pisIn(home)) >= 1, "the thread's pi runs again");
  assert.deepEqual((await provider("inspect", { home, endpoint })).result.running, true, "and it reads so");
  await sh("pkill -f '^pi 900' || true");
});

test("P6 a dialog a pi extension opens is a pending interaction: input refuses E_SESSION_PROMPT_OPEN and sends nothing", async () => {
  const { home, endpoint } = await launched("p6-dialog");
  await arm(JSON.stringify({ name: "contract_confirm", arguments: {} }));
  await sh(`bb thread tell ${endpoint.threadId} 'contract: open a dialog' >/dev/null`);
  const [waiting] = await waitFor("the dialog to wait on a person", async () => { const open = await pending(endpoint.threadId); return open.length > 0 ? open : null; }, { timeoutMs: 60_000 });
  assert.equal(waiting.payload.kind, "provider-pi/extension-ui");
  const refused = await provider("input", { home, endpoint, text: "MARK-P6-DIALOG must not land" });
  assert.equal(refused.ok, false);
  assert.equal(refused.error.code, "E_SESSION_PROMPT_OPEN");
  assert.match(refused.error.message, /1 pending provider-pi\/extension-ui/);
  assert.ok(refused.error.message.includes(waiting.id));
  assert.equal(await landed("MARK-P6-DIALOG"), 0);
  assert.deepEqual(await bbJson(`thread queue list ${endpoint.threadId}`), [], "nothing was left in line behind the dialog");
  assert.deepEqual((await pending(endpoint.threadId)).map((interaction) => interaction.id), [waiting.id], "the dialog still waits: an input never answers it");
  // A person answers it in bb, and the turn goes on with their answer.
  await sh(`bb thread interactions respond ${waiting.id} ${endpoint.threadId} --value true --json >/dev/null`);
  await waitFor("the answer to reach the model", async () => (await piRequests()).some((request) => request.lastRole === "tool" && request.lastText.includes("confirm answered: true")), { timeoutMs: 60_000 });
  await idle(endpoint.threadId);
  assert.equal(await landed("MARK-P6-DIALOG"), 0);
});

test("P3 nothing in bb's pi may hold the agent's mail: a pi configuration with @awebai/pi, or without @awebai/oats-pi, refuses the pi launch", async () => {
  const home = await makeHome("p3");
  const planned = async (settings) => (await provider("check", { home, soul: null, launch: PLANNED }, settings)).result;
  // The container's own configuration (what bb's server runs with here): as `pi install
  // npm:@awebai/oats-pi` wrote it. Ready.
  assert.match(await sh("cat ~/.pi/agent/settings.json"), /"npm:@awebai\/oats-pi@/);
  assert.equal((await planned({})).status, "ready");
  // A configuration as a host that also runs tmux pi agents has it: `pi install` of both.
  const both = { piAgentDir: "/home/node/pi-with-aweb" };
  assert.match(await sh("cat /home/node/pi-with-aweb/settings.json"), /"npm:@awebai\/pi@/);
  const listening = await planned(both);
  assert.equal(listening.status, "needs-configuration");
  assert.deepEqual(listening.problems.map((problem) => problem.code), ["E_BACKEND_PI_LISTENER"]);
  const refused = await provider("launch", launchInput(home, "p3"), both);
  assert.equal(refused.error.code, "E_BACKEND_PI_LISTENER");
  assert.deepEqual((await bbJson("project list")).filter((project) => project.sources.some((source) => source.path === home)), [], "nothing was made in bb");
  // A read with no planned launch warns of it, and is not held up: Claude is not this image's business.
  const plain = (await provider("check", { home: null, soul: null }, both)).result;
  assert.ok(plain.warnings.some((warning) => warning.code === "session-provider-pi-not-ready" && warning.message.includes("E_BACKEND_PI_LISTENER")), JSON.stringify(plain.warnings));
  // A configuration with neither package: the home's skills would not load.
  await sh("mkdir -p /home/node/pi-empty");
  assert.deepEqual((await planned({ piAgentDir: "/home/node/pi-empty" })).problems.map((problem) => problem.code), ["E_BACKEND_NOT_READY"]);

  // The other accepted state: AWEB_DELIVERY in bb's machine env, set by the operator. bb
  // shows the name and no value, and gives it to every pi it starts, the hidden one too.
  await sh("bb machine env set AWEB_DELIVERY --json >/dev/null", { input: "session" });
  try {
    assert.deepEqual((await bbJson("machine env list")).variables.map((variable) => [variable.name, variable.value]), [["AWEB_DELIVERY", null]]);
    assert.equal((await planned(both)).status, "ready");
    const { home: silenced, endpoint } = await launched("p3-silenced");
    const seen = await sh(`for p in $(pgrep -x pi); do if [ "$(readlink /proc/$p/cwd)" = "${silenced}" ]; then tr '\\0' '\\n' < /proc/$p/environ | grep -c '^AWEB_DELIVERY=session$'; fi; done`);
    const counts = seen.split("\n").filter(Boolean);
    assert.ok(counts.length >= 2, `the thread's pi and its catalog pi both work in the home: ${seen}`);
    assert.ok(counts.every((count) => count === "1"), `every pi bb started in the home has the variable: ${seen}`);
    assert.deepEqual(await projectEnv(endpoint.projectId), ["OATS_INSTANCE", "OATS_INSTANCE_HOME", "PATH"], "and it is not the provider that set it");
    // A pi that bb did not start (a tmux pi home's, on the same host, as the same user,
    // with a pi configuration that lists @awebai/pi) does not get the variable: bb's
    // machine env goes only to the processes bb runs. So that home's aweb extension
    // still decides for channel delivery, and keeps its own mail stream. (The stream
    // itself is not opened here: it needs an aweb identity, and this test has none.)
    const outside = "/home/node/homes/p3-tmux-pi";
    await sh(`mkdir -p ${outside} && cd ${outside} && (sleep 30 | PI_CODING_AGENT_DIR=/home/node/pi-with-aweb pi --mode rpc --no-session >/dev/null 2>&1 &)`);
    const variableIn = (dir) => sh(`for p in $(pgrep -x pi); do if [ "$(readlink /proc/$p/cwd)" = "${dir}" ]; then tr '\\0' '\\n' < /proc/$p/environ | grep -c '^AWEB_DELIVERY=' || true; fi; done`);
    const outsideCount = await waitFor("the pi outside bb", async () => (await variableIn(outside)).trim() || null, { timeoutMs: 20_000 });
    assert.equal(outsideCount, "0", "a pi outside bb has no AWEB_DELIVERY from bb's machine env");
    assert.match(await sh(`PI_CODING_AGENT_DIR=/home/node/pi-with-aweb pi list`), /npm:@awebai\/pi@/, "and its configuration does load the aweb extension");
    await sh(`for p in $(pgrep -x pi); do if [ "$(readlink /proc/$p/cwd)" = "${outside}" ]; then kill $p; fi; done`);
  } finally {
    await sh("bb machine env unset AWEB_DELIVERY --json >/dev/null");
  }
  assert.equal((await planned(both)).status, "needs-configuration");
});

// Contract r24, A15(1), its safety edge: the stop archives the home's own thread, and
// never a thread a person opened in the home's bb project for other work.
test("a person's own thread in the home's bb project is never archived by the provider's stop, with or without an endpoint", async () => {
  const { home, endpoint } = await launched("person");
  // A person's own thread, made with bb's own spawn in that project: nothing of the provider's.
  const own = await bbJson(`thread spawn --project ${endpoint.projectId} --provider pi --model ${MODEL} --permission-mode full --prompt 'MARK-PERSON-OWN say hi' --title 'A person own thread'`);
  started.push(own.id);
  await waitFor("the person's thread's first turn", async () => (await landed("MARK-PERSON-OWN")) === 1, { timeoutMs: 120_000 });
  await idle(own.id);
  const asItIs = async () => {
    const { thread } = await bbJson(`thread show ${own.id}`);
    return { status: thread.status, archivedAt: thread.archivedAt ?? null, deletedAt: thread.deletedAt ?? null, title: thread.title, projectId: thread.projectId };
  };
  const before = await asItIs();
  assert.deepEqual(before, { status: "idle", archivedAt: null, deletedAt: null, title: "A person own thread", projectId: endpoint.projectId });
  const live = async () => (await bbJson(`thread list --project ${endpoint.projectId} --include-hidden`)).map((thread) => thread.id).sort();
  assert.deepEqual(await live(), [endpoint.threadId, own.id].sort());

  // A stop with the home's endpoint: that thread is stopped and archived, and the person's
  // is as it was: not archived, and not stopped either (its agent is still loaded).
  assert.deepEqual((await provider("stop", { home, endpoint, graceSeconds: 10 })).result, { stopped: true });
  assert.notEqual((await bbJson(`thread show ${endpoint.threadId}`)).thread.archivedAt, null);
  assert.deepEqual(await asItIs(), before);
  assert.deepEqual(await live(), [own.id]);
  assert.ok((await carriers(own.id)).includes("pi"), "a stop with an endpoint touched a thread that is not the home's");

  // A stop with no endpoint stops every live thread that runs in the home, as it did
  // before (the kernel sends it when a launch may have started a thread nobody recorded),
  // and archives only one bb made at or after the time that launch was sent: with no time,
  // and with a time after the person's thread was made, theirs is stopped and never archived.
  for (const extra of [{}, { launchSent: new Date().toISOString() }]) {
    assert.deepEqual((await provider("stop", { home, endpoint: null, graceSeconds: 10, ...extra })).result, { stopped: true });
    assert.deepEqual(await asItIs(), before, JSON.stringify(extra));
    assert.deepEqual(await live(), [own.id]);
  }
  await waitFor("the person's thread's agent to be gone", async () => !(await carriers(own.id)).includes("pi"), { timeoutMs: 20_000 });
  // It is still theirs to use: bb takes a message to it, and runs the turn.
  await sh(`bb thread tell ${own.id} 'MARK-PERSON-AGAIN' >/dev/null`);
  await waitFor("the person's next turn", async () => (await landed("MARK-PERSON-AGAIN")) === 1, { timeoutMs: 90_000 });
  await idle(own.id);
});

test("P5 stop ends the thread's pi, its bridge and its catalog pi: no process is left in the home after the stop, nor after the retire", async () => {
  const { home, endpoint } = await launched("p5");
  // bb runs two pi processes for a thread, both in the home: the thread's, and a catalog
  // pi its bridge worker starts to list models.
  assert.ok((await pisIn(home)) >= 1);
  assert.equal((await provider("stop", { home, endpoint, graceSeconds: 10 })).ok, true);
  await nothingIn(home, "after the stop");
  assert.equal(await threadStatus(endpoint.threadId), "idle");
  assert.notEqual((await bbJson(`thread show ${endpoint.threadId}`)).thread.archivedAt, null, "the stop archived the thread (contract r24, A15(1))");
  // The retire of a running agent is this sequence: the stop, then the hook. The hook finds
  // nothing live, and its receipt says what bb holds of the home: retired, the thread the
  // stop archived, and the project's env it removed.
  const environment = await environmentOf(endpoint.threadId);
  const stoppedThenRetired = await hook("retire-hook", home);
  assert.deepEqual(stoppedThenRetired.meta, { retired: true, archived: [endpoint.threadId], env: 3, environments: [environment] });
  assert.equal(stoppedThenRetired.warning, undefined);

  // A thread stopped while it runs a turn.
  const busy = await launched("p5-busy");
  await arm("sleep 60");
  await sh(`bb thread tell ${busy.endpoint.threadId} 'contract: a long tool call' >/dev/null`);
  await waitFor("the thread to be in its turn", async () => (await threadStatus(busy.endpoint.threadId)) === "active", { timeoutMs: 30_000 });
  assert.equal((await provider("stop", { home: busy.home, endpoint: busy.endpoint, graceSeconds: 20 })).ok, true);
  await nothingIn(busy.home, "after the stop of a thread in a turn");

  // The retire hook, on a thread that was never stopped: stopped, archived, nothing left.
  const retiring = await launched("p5-retire");
  assert.ok((await pisIn(retiring.home)) >= 1);
  const retired = await hook("retire-hook", retiring.home);
  assert.deepEqual(retired.meta.archived, [retiring.endpoint.threadId]);
  assert.equal(retired.warning, undefined);
  await nothingIn(retiring.home, "after the retire");
  assert.deepEqual((await bbJson(`thread list --project ${retiring.endpoint.projectId} --archived --include-hidden`)).map((thread) => thread.id), [retiring.endpoint.threadId]);
});

// Contract r32, A17, for pi (test/contract/contract.test.mjs has Claude's, and the door a
// Restore in bb leaves): the retire hook deletes the home's bb environment, so a retired
// agent's thread, unarchived in bb, takes no message and starts no pi in a home that was kept.
test("A17 a retire deletes a pi home's bb environment: the kept home is byte for byte untouched, and an Unarchive plus a message starts no pi; with a person's thread on the environment it archives only", async () => {
  const { home, endpoint } = await launched("a17-pi");
  const id = endpoint.threadId;
  const environment = await environmentOf(id);
  const shown = await bbJson(`environment show ${environment}`);
  assert.deepEqual({ path: shown.path, status: shown.status, environmentProviderId: shown.environmentProviderId, managed: shown.managed }, { path: home, status: "ready", environmentProviderId: "project-checkout", managed: false });
  // `oats retire --keep-dir`: the kernel's stop, then the hook; the home stays.
  assert.equal((await provider("stop", { home, endpoint, graceSeconds: 10 })).ok, true);
  await nothingIn(home, "after the stop");
  const before = await treeOf(home);
  const retired = await hook("retire-hook", home);
  assert.deepEqual(retired, { meta: { retired: true, archived: [id], env: 3, environments: [environment] } });
  await waitFor("bb to have destroyed the environment", async () => (await bbJson(`environment show ${environment}`)).status === "destroyed", { timeoutMs: 60_000, everyMs: 500 });
  assert.equal(await treeOf(home), before, "the kept home is byte for byte what it was");
  // A person unarchives the thread and sends it a message: bb refuses it, and no pi starts.
  const turnsBefore = (await turns()).length;
  await sh(`bb thread unarchive ${id} --json`);
  const told = JSON.parse(await sh(`bb thread tell ${id} 'A17-PI-AFTER a word after the retire' --json`, { ok: false }));
  assert.equal(told.ok, false, JSON.stringify(told));
  assert.equal(told.error.code, "thread_environment_unavailable", JSON.stringify(told));
  assert.equal((await provider("input", { home, endpoint, text: "A17-PI-AFTER by the provider" })).ok, false);
  await sleep(6_000);
  assert.equal(await landed("A17-PI-AFTER"), 0, "a retired agent took a message");
  assert.equal((await turns()).length, turnsBefore);
  assert.equal(await pisIn(home), 0, "a pi started in the kept home");
  assert.equal(await processesIn(home), 0);
  assert.equal((await carriers(id)).length, 0);
  assert.equal(await treeOf(home), before);

  // With a person's thread on the home's environment: archive only, and theirs still runs.
  const shared = await launched("a17-pi-shared");
  const sharedEnvironment = await environmentOf(shared.endpoint.threadId);
  const since = (await turns()).length;
  const person = await bbJson(`thread spawn --project ${shared.endpoint.projectId} --provider pi --model ${MODEL} --environment ${shared.home} --prompt 'A17-PI-PERSON a thread of my own' --permission-mode full`);
  started.push(person.id);
  assert.equal(person.environmentId, sharedEnvironment, "bb keeps one environment per home, shared by every thread there");
  await waitFor("the person's thread's first turn", async () => (await turns()).length > since, { timeoutMs: 120_000 });
  await idle(person.id);
  await sh(`bb thread stop ${person.id} --json && bb thread archive ${person.id} --json`);
  assert.equal((await provider("stop", { home: shared.home, endpoint: shared.endpoint, graceSeconds: 10 })).ok, true);
  await nothingIn(shared.home, "after the stop");
  const archivedOnly = await hook("retire-hook", shared.home);
  assert.deepEqual(archivedOnly.meta, { archived: [shared.endpoint.threadId], env: 3 });
  assert.equal(archivedOnly.warning, `the home's bb environment was not deleted (1 thread on bb environment ${sharedEnvironment} is not in this home's thread record (a person's, one made before oats.bb kept a record, or one the provider could not note): ${person.id}): its threads are archived only: if the home is kept, a person can unarchive one in bb and a message then starts its agent with no OATS around it`);
  await sleep(8_000);
  const kept = await bbJson(`environment show ${sharedEnvironment}`);
  assert.deepEqual({ status: kept.status, phase: kept.lifecycle.phase, path: kept.path }, { status: "ready", phase: "active", path: shared.home }, "the environment of a person's thread was deleted");
});

test("P5 a model listing's catalog pi works in the home with no thread running, no bb command ends it, and it leaves by itself", async () => {
  const { home, endpoint } = await launched("p5-listing");
  assert.equal((await provider("stop", { home, endpoint, graceSeconds: 10 })).ok, true);
  await nothingIn(home, "after the stop");
  // What bb's UI does when a person opens the thread's model picker.
  const models = await bbJson(`provider models pi --project ${endpoint.projectId}`);
  assert.ok(models.some((model) => model.id === MODEL));
  await waitFor("the listing's catalog pi in the home", async () => (await pisIn(home)) >= 1, { timeoutMs: 20_000 });
  assert.deepEqual(await carriers(endpoint.threadId), [], "it is no process of the thread");
  // The provider's stop answers stopped, and that pi is still there: it belongs to a
  // bridge worker of its own, which no stop of a thread ends. The provider signals no
  // process. While it is there, the kernel's retire of the home refuses, naming it.
  assert.equal((await provider("stop", { home, endpoint, graceSeconds: 10 })).ok, true);
  assert.equal((await provider("stop", { home, endpoint: null, graceSeconds: 10 })).ok, true);
  assert.ok((await pisIn(home)) >= 1, "bb ended a listing's catalog pi at a thread's stop: the docs' note on a retire after a model listing may no longer be needed");
  // It leaves by itself (about 70 s at this bb): the retire then goes through.
  await waitFor("the listing's catalog pi to leave", async () => (await processesIn(home)) === 0, { timeoutMs: 120_000, everyMs: 2_000 });
});

test("K-28 a home moves between the harnesses on bb: claude, then pi, then claude again; each start is a new thread of that bb provider, with the previous one archived", async () => {
  const home = await makeHome("k28");
  // As the kernel composes a Claude home: its skills where Claude looks for them.
  await sh(`mkdir -p ${home}/.claude && ln -s ../.agents/skills ${home}/.claude/skills`);
  const CLAUDE_MODEL = "claude-opus-5-5";
  const claudeTurns = async () => (await box.requests()).filter((request) => request.url.startsWith("/v1/messages") && !request.url.includes("count_tokens") && request.tools.length > 0);
  const claudeLanded = async (marker) => (await claudeTurns()).filter((request) => request.lastText.includes(marker)).length;
  /** Whether a model request of Claude's, from the mock's request number `since` on, carried the home's skill. */
  const claudeSawSkill = async (since) => (await sh(`for f in $(ls mock-req-*.json 2>/dev/null); do n=\${f#mock-req-}; n=\${n%.json}; if [ "$n" -gt ${since} ] && grep -q contract-skill "$f"; then echo "$f"; fi; done`)).trim() !== "";
  const claudesIn = async () => Number((await sh(`for p in /proc/[0-9]*; do case "$(readlink $p/cwd 2>/dev/null)" in ${home}*) tr '\\0' ' ' < $p/cmdline | grep -c 'bin/claude ' ;; esac; done | grep -c 1 || true`)).trim());
  const threadsOf = async (projectId, archived) => (await bbJson(`thread list --project ${projectId} ${archived ? "--archived " : ""}--include-hidden`)).map((thread) => thread.id).sort();
  const start = async (harness, previous) => {
    const answer = await provider("launch", launchInput(home, "k28", { harness, model: harness === "pi" ? MODEL : CLAUDE_MODEL, previous }));
    assert.equal(answer.ok, true, `${harness}: ${JSON.stringify(answer)}`);
    started.push(answer.result.endpoint.threadId);
    return answer.result.endpoint;
  };
  const stop = async (endpoint) => assert.equal((await provider("stop", { home, endpoint, graceSeconds: 15 })).ok, true);

  // 1. Claude.
  let since = (await box.requests()).length;
  const first = await start("claude", null);
  await box.firstTurnOver(first.threadId, since);
  assert.equal((await bbJson(`thread show ${first.threadId}`)).thread.providerId, "claude-code");
  assert.equal(await claudeSawSkill(since), true, "Claude was given the home's skill");
  assert.deepEqual((await provider("input", { home, endpoint: first, text: "MARK-K28-CLAUDE-ONE" })).result, { submitted: true, verified: true });
  await waitFor("the first Claude thread's turn", async () => (await claudeLanded("MARK-K28-CLAUDE-ONE")) === 1, { timeoutMs: 90_000 });
  await idle(first.threadId);
  assert.deepEqual(await projectEnv(first.projectId), [], "a Claude launch writes nothing into the project's env");

  // 2. The same home, started with pi: the kernel stops it, then launches with the previous endpoint.
  await stop(first);
  const piSince = (await turns()).length;
  const second = await start("pi", first);
  assert.equal(second.projectId, first.projectId, "the home's one bb project");
  assert.notEqual(second.threadId, first.threadId);
  await waitFor("the pi thread's first turn", async () => (await turns()).length > piSince, { timeoutMs: 120_000 });
  await idle(second.threadId);
  assert.equal((await bbJson(`thread show ${second.threadId}`)).thread.providerId, "pi");
  assert.deepEqual(await threadsOf(first.projectId, true), [first.threadId], "the Claude thread is archived");
  assert.deepEqual(await threadsOf(first.projectId, false), [second.threadId]);
  assert.ok((await turns())[piSince].sys.includes("contract-skill"), "pi was given the home's skill");
  assert.deepEqual((await provider("input", { home, endpoint: second, text: "MARK-K28-PI" })).result, { submitted: true, verified: true });
  await waitFor("the pi thread's turn", async () => (await landed("MARK-K28-PI")) === 1, { timeoutMs: 90_000 });
  await idle(second.threadId);
  assert.equal(await claudesIn(), 0, "no Claude is left in the home");
  assert.ok((await pisIn(home)) >= 1);
  assert.deepEqual(await projectEnv(first.projectId), ["OATS_INSTANCE", "OATS_INSTANCE_HOME", "PATH"]);

  // 3. And back to Claude.
  await stop(second);
  since = (await box.requests()).length;
  const third = await start("claude", second);
  assert.equal(third.projectId, first.projectId);
  await box.firstTurnOver(third.threadId, since);
  assert.equal((await bbJson(`thread show ${third.threadId}`)).thread.providerId, "claude-code");
  assert.deepEqual(await threadsOf(first.projectId, true), [first.threadId, second.threadId].sort(), "the pi thread is archived too");
  assert.deepEqual(await threadsOf(first.projectId, false), [third.threadId]);
  assert.equal(await claudeSawSkill(since), true);
  assert.deepEqual((await provider("input", { home, endpoint: third, text: "MARK-K28-CLAUDE-TWO" })).result, { submitted: true, verified: true });
  await waitFor("the second Claude thread's turn", async () => (await claudeLanded("MARK-K28-CLAUDE-TWO")) === 1, { timeoutMs: 90_000 });
  await idle(third.threadId);
  assert.equal(await pisIn(home), 0, "no pi is left in the home");
  assert.ok((await claudesIn()) >= 1);
  for (const marker of ["MARK-K28-CLAUDE-ONE", "MARK-K28-CLAUDE-TWO"]) assert.equal(await claudeLanded(marker), 1, marker);
  assert.equal(await landed("MARK-K28-PI"), 1);
  // What the pi launch left in the project's env is gone: bb gives a project's env to every
  // thread of it, and starts `claude` by a project PATH. Claude's own launch env is its
  // settings file's, written by this launch.
  assert.deepEqual(await projectEnv(first.projectId), []);
  assert.deepEqual(Object.keys(JSON.parse(await sh(`cat ${home}/.claude/settings.local.json`)).env).sort(), ["OATS_INSTANCE", "OATS_INSTANCE_HOME", "PATH"]);
  // The retire leaves nothing: no thread live, no env, no process.
  const environment = await environmentOf(third.threadId);
  const retired = await hook("retire-hook", home);
  // (Its receipt names the thread it archived, then the home's two threads archived before, in bb's order;
  // and the one bb environment the three were on, Claude's and pi's alike, which it asked bb to delete.)
  assert.deepEqual({ ...retired.meta, archived: [retired.meta.archived[0], ...retired.meta.archived.slice(1).sort()] }, { retired: true, archived: [third.threadId, ...[first.threadId, second.threadId].sort()], environments: [environment] });
  await nothingIn(home, "after the retire");
});

// A restart of bb itself (bb-app, its server and its daemon end, and bb-app starts again on
// the same data directory): the nearest stand-in for a reboot of a host that runs no
// `oats host run`. Seen at bb-app 0.50.1, for pi here and for Claude in a probe: the
// harness is gone, the thread still reads idle, and the provider reads it there and not
// running. The kernel reads that as a session that is there, not a lost one, so no sweep
// resumes it: its next input starts the harness again, on the same conversation.
// Where pi's own settings narrow the models it offers (`enabledModels`), bb lists only
// those and still starts a thread on any model pi has. And bb's pi keeps the narrowing it
// started with: the list stays narrowed after the setting is removed, until bb is
// restarted. (Both seen at bb-app 0.50.1, pi 1.5.2, recorded here.) So a model that is not
// listed is refused only where pi's settings set no enabledModels and have not changed
// since bb started; otherwise it only warns.
// That last case is the check's one silent off-switch (every id passes, for every home, and
// no setting says so): a read with no planned launch, and `oats bb doctor`, say it, as the
// warning session-provider-pi-model-check-off, until bb is restarted.
test("with pi's enabledModels set, bb lists only those models, and goes on doing so after the setting is removed, until it is restarted: the bare id a soul names (claude-fable-5.1), left out of them, only warns at the check, and its launch runs", async () => {
  const settingsFile = "/home/node/.pi/agent/settings.json";
  const original = await sh(`cat ${settingsFile}`);
  const listedIds = async () => (await bbJson("provider models pi")).map((model) => model.id).sort();
  const unchecked = async (model) => (await checkModel(model)).warnings.filter((warning) => warning.code === "session-provider-pi-model-unchecked").map((warning) => warning.message);
  const sentence = (model, why) => `could not check the model ${JSON.stringify(model)} against pi's model list: ${why}`;
  // What a read with no planned launch says of the check itself.
  const CHECK_OFF = { code: "session-provider-pi-model-check-off", message: "the pi model check is off until bb restarts: bb's pi settings changed after it started (restart bb-app to turn it back on)" };
  const checkOff = async () => (await provider("check", { home: null, soul: null })).result.warnings.filter((warning) => warning.code === CHECK_OFF.code);
  assert.deepEqual(await checkOff(), [], "pi's settings are older than this bb's start: nothing is said");
  let restored = false;
  try {
    await sh(`cat > ${settingsFile}`, { input: JSON.stringify({ ...JSON.parse(original), enabledModels: ["mock/echo"] }, null, 2) });
    await box.restartBb();
    // (bb learns the narrowing a moment after its pi starts: until then it lists every model.)
    await waitFor("bb to list only the enabled model", async () => JSON.stringify(await listedIds()) === JSON.stringify(["mock/echo"]), { timeoutMs: 60_000, everyMs: 1_000 });
    const NARROWED = "pi's enabledModels setting narrows the list to the models it names";
    const RECENT = "pi's configuration changed a moment ago, and bb's list may be older than it";
    const planned = await checkModel("claude-fable-5.1");
    assert.equal(planned.status, "ready");
    assert.deepEqual(planned.problems, []);
    const warned = await unchecked("claude-fable-5.1");
    // (Which of the two reasons it gives depends on how long ago the settings were written: the unit tests hold each.)
    assert.ok([[sentence("claude-fable-5.1", NARROWED)], [sentence("claude-fable-5.1", RECENT)]].some((expected) => JSON.stringify(expected) === JSON.stringify(warned)), JSON.stringify(warned));
    // bb resolves it all the same: the launch is taken, and the thread runs its first turn.
    const { endpoint, since } = await launched("model-narrowed", { model: "claude-fable-5.1" });
    assert.match((await turns())[since].lastText, /TASK-model-narrowed say hi\./);
    assert.equal(await threadStatus(endpoint.threadId), "idle");
    // A model pi does not have is not refused here either: the list cannot say so. It ends as before this check.
    assert.deepEqual((await checkModel("claude-fable-9")).problems, []);
    // The listed model passes with nothing said.
    assert.deepEqual((await checkModel("mock/echo")).warnings, []);
    // The check is off by the setting here, which a restart of bb does not end: the warning of that is not given.
    assert.deepEqual(await checkOff(), []);

    // The setting removed, and bb not restarted: bb's list is still the narrowed one, and
    // the settings file no longer says so. Still no refusal: the file is newer than bb.
    await sh(`cat > ${settingsFile}`, { input: original });
    assert.deepEqual(await listedIds(), ["mock/echo"], "bb lists by the settings its pi started with");
    const STALE = "pi's settings changed after bb started, or when bb started cannot be read, and bb lists by the settings its pi started with";
    const after = await checkModel("claude-fable-5.1");
    assert.equal(after.status, "ready");
    assert.deepEqual(after.problems, []);
    const warnedAfter = await unchecked("claude-fable-5.1");
    assert.ok([[sentence("claude-fable-5.1", STALE)], [sentence("claude-fable-5.1", RECENT)]].some((expected) => JSON.stringify(expected) === JSON.stringify(warnedAfter)), JSON.stringify(warnedAfter));
    // And still none once the change is no longer "a moment ago": the settings are newer than bb.
    await waitFor("the warning to be for settings newer than bb", async () => JSON.stringify(await unchecked("claude-fable-5.1")) === JSON.stringify([sentence("claude-fable-5.1", STALE)]), { timeoutMs: 180_000, everyMs: 3_000 });
    assert.deepEqual(await listedIds(), ["mock/echo"], "bb's list is still the narrowed one");
    assert.deepEqual((await checkModel("claude-fable-5.1")).problems, []);
    const again = await launched("model-narrowed-stale", { model: "claude-fable-5.1" });
    assert.equal(await threadStatus(again.endpoint.threadId), "idle");
    // Nothing above said that the check is off for every model and every home: the read with no planned launch does,
    // as a warning beside a ready status, and so does the doctor.
    const plain = (await provider("check", { home: null, soul: null })).result;
    assert.equal(plain.status, "ready", JSON.stringify(plain));
    assert.deepEqual(plain.warnings.filter((warning) => warning.code === CHECK_OFF.code), [CHECK_OFF]);
    const doctor = await sh(`OATS_SETTINGS='${JSON.stringify(SETTINGS)}' node ${PROVIDER} doctor`);
    assert.ok(doctor.split("\n").includes(`  warning ${CHECK_OFF.code}: ${CHECK_OFF.message}`), doctor);

    // bb restarted: it lists by the settings as they are, and the check refuses again what pi does not have.
    await box.restartBb();
    restored = true;
    await waitFor("bb to list every model again", async () => (await listedIds()).includes("mock/claude-fable-5.1"), { timeoutMs: 60_000, everyMs: 1_000 });
    // (Once the change of the settings is older than bb's list can be.)
    await refusesAgain();
    assert.deepEqual((await checkModel("claude-fable-5.1")).warnings, []);
    assert.deepEqual(await checkOff(), [], "bb restarted: the check is on again, and the warning is gone");
  } finally {
    if (!restored) {
      await sh(`cat > ${settingsFile}`, { input: original });
      await box.restartBb();
      await waitFor("bb to list every model again", async () => (await listedIds()).includes("mock/claude-fable-5.1"), { timeoutMs: 60_000, everyMs: 1_000 });
    }
  }
});

test("bb restarted under a loaded pi (the nearest thing to a reboot): the thread reads idle, there and not running, and its next input starts pi again on the same conversation", async () => {
  const { home, endpoint } = await launched("restart");
  assert.deepEqual((await provider("input", { home, endpoint, text: "MARK-RESTART-BEFORE" })).result, { submitted: true, verified: true });
  await waitFor("the turn before the restart", async () => (await landed("MARK-RESTART-BEFORE")) === 1, { timeoutMs: 90_000 });
  await idle(endpoint.threadId);
  await box.restartBb();
  assert.deepEqual(await carriers(endpoint.threadId), [], "no process of the thread outlived bb");
  assert.equal(await threadStatus(endpoint.threadId), "idle", "bb's word is idle, not error: nothing says the harness is gone but the processes");
  const after = (await provider("inspect", { home, endpoint })).result;
  assert.deepEqual([after.present, after.state, after.running], [true, "unknown", false], "there, and not running: not a lost session");
  assert.deepEqual((await provider("inspectMany", { homes: [{ home, endpoint }] })).result.results.map((result) => [result.present, result.running]), [[true, false]]);
  assert.deepEqual((await provider("input", { home, endpoint, text: "MARK-RESTART-AFTER" })).result, { submitted: true, verified: true });
  await waitFor("the turn after the restart", async () => (await landed("MARK-RESTART-AFTER")) === 1, { timeoutMs: 90_000 });
  await idle(endpoint.threadId);
  assert.equal(await carried("MARK-RESTART-AFTER", "MARK-RESTART-BEFORE"), true, "the same conversation");
  assert.deepEqual((await provider("inspect", { home, endpoint })).result.running, true);
});

// What becomes of a thread's harness when bb's host daemon ends under it (seen at bb-app
// 0.50.1, recorded here): bb-app starts the daemon again, the harness is gone with the old
// one (no process is left that carries the thread's id: none reparented, so the provider's
// "a child of bb's runner" has no orphan to miss), the thread still reads idle, and the
// provider reads it as not running. A tell starts a harness under the new daemon's runner.
// Last in the file: it ends bb's daemon.
test("bb's host daemon ended while a thread's pi is loaded: the pi goes with it, the thread reads idle and not running, and a tell starts it again", async () => {
  const { home, endpoint } = await launched("daemon");
  assert.deepEqual((await provider("inspect", { home, endpoint })).result.running, true);
  // The daemon of the thread's bb: the parent of the thread's runner.
  const [daemon] = await sh(`for p in /proc/[0-9]*; do if [ "$(cat $p/comm 2>/dev/null)" = "pi" ] && tr '\\0' '\\n' < $p/environ 2>/dev/null | grep -qx 'BB_THREAD_ID=${endpoint.threadId}'; then runner=$(awk '{print $4}' $p/stat); awk '{print $4}' /proc/$runner/stat; fi; done`).then((out) => out.trim().split("\n"));
  assert.match(await sh(`tr '\\0' ' ' < /proc/${daemon}/cmdline`), /\/host-daemon\/dist\/daemon-bundle\.mjs $/, "the runner's parent is bb's host daemon");
  await sh(`kill -KILL ${daemon}`);
  await waitFor("the thread's pi to be gone", async () => (await carriers(endpoint.threadId)).length === 0, { timeoutMs: 30_000 });
  await waitFor("bb to be ready with a new daemon", async () => (await provider("check", { home: null, soul: null, launch: PLANNED })).result?.status === "ready", { timeoutMs: 120_000, everyMs: 1_000 });
  assert.equal(await threadStatus(endpoint.threadId), "idle", "bb's word did not change");
  assert.deepEqual((await provider("inspect", { home, endpoint })).result.running, false);
  assert.deepEqual((await provider("input", { home, endpoint, text: "MARK-DAEMON-AFTER" })).result, { submitted: true, verified: true });
  await waitFor("the turn after the daemon's restart", async () => (await landed("MARK-DAEMON-AFTER")) === 1, { timeoutMs: 90_000 });
  await idle(endpoint.threadId);
  const parents = await harnessParents(endpoint.threadId, "pi");
  assert.ok(parents.length === 1 && parents[0].includes("provider-pi"), JSON.stringify(parents));
  assert.deepEqual((await provider("inspect", { home, endpoint })).result.running, true);
});
