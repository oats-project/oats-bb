// The pi model check: a pi launch whose model bb's pi would not resolve is refused before
// anything is started, at the launch and at the check of a planned launch that names its
// model; where bb's list of pi's models cannot settle it, the launch goes on with a warning.
import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "node:test";
import { piModelVerdict } from "../../oats-package/capabilities/oats-bb/lib/pi-model.mjs";
import { VERSION, call, callSeen, fakeBackend, fakeBbIn, piModelRow, projectRow, scratch } from "../fixtures/harness.mjs";

const envList = (names) => ({ builtInGit: { status: "not logged in" }, variables: names.map((name) => ({ name, value: null, secret: true, note: null })), inheritedVariables: [] });
// What a deployment's pi serves here: one model twice, one with a date in its id (bb lists
// it only where it is named exactly), one whose own id holds a slash.
const LIST = [
  piModelRow("github-copilot", "claude-fable-5.1"), piModelRow("github-copilot", "gpt-6-astra"), piModelRow("openai", "gpt-6-astra"),
  piModelRow("openrouter", "anthropic/claude-opus-5-5"),
];
const UNCHECKED = "session-provider-pi-model-unchecked";
const listReads = (bb) => bb.calls().filter((c) => c.argv[0] === "provider");

async function setup(t, { models = { stdout: LIST }, script = {}, piSettings } = {}) {
  const { dir, home } = scratch(t);
  const backend = await fakeBackend(t);
  if (piSettings !== undefined) backend.piSettings(piSettings);
  const bb = fakeBbIn(dir, {
    "--version": { stdout: `${VERSION}\n` },
    "project list": { stdout: [projectRow("proj_a", home)] },
    "thread list": { stdout: [] },
    "thread spawn": { stdout: { id: "thr_new", projectId: "proj_a", environmentId: null, providerId: "pi", status: "starting" } },
    "machine env list": { stdout: envList([]) },
    "machine env set": { stdout: envList([]) },
    "machine env unset": { stdout: envList([]) },
    ...(models === null ? {} : { "provider models pi": models }),
    ...script,
  });
  const input = (extra = {}) => ({ home, instance: "dev-a", harness: "pi", yolo: true, env: [{ name: "OATS_INSTANCE", value: "dev-a", source: "kernel" }, { name: "OATS_INSTANCE_HOME", value: home, source: "kernel" }], unset: [], args: [], promptFile: join(home, "TASK.md"), previous: null, ...extra });
  const options = { settings: backend.settings(), bb };
  /** The launch with this model. → { doc, stderr }. */
  const launch = (model, extra = {}) => callSeen("launch", input({ ...(model === undefined ? {} : { model }), ...extra }), options);
  /** The check of the planned launch with this model, as a kernel that names it hands it. → the result. */
  const check = async (model, planned = {}) => (await call("check", { home, soul: null, launch: { harness: "pi", yolo: true, args: [], ...(model === undefined ? {} : { model }), ...planned } }, options)).result;
  /** The thread spawns among bb's calls from call number `since` on. */
  const spawns = (since = 0) => bb.calls().slice(since).filter((c) => c.argv[1] === "spawn");
  const spawned = () => spawns().length > 0;
  /** Refused at the launch and at the check, with this sentence and nothing started. */
  const refusedBoth = async (model, sentence) => {
    const before = bb.calls().length;
    const { doc, stderr } = await launch(model);
    assert.deepEqual(doc.error, { code: "E_BACKEND_LAUNCH_ARG", message: sentence });
    assert.equal(stderr, "");
    assert.deepEqual(bb.calls().slice(before).filter((c) => !["--version", "host", "provider"].includes(c.argv[0])), [], "nothing was started, and bb was only read: its version, its hosts, its pi models");
    const planned = await check(model);
    assert.equal(planned.status, "needs-configuration");
    assert.deepEqual(planned.problems, [{ code: "E_BACKEND_LAUNCH_ARG", message: sentence }]);
    assert.deepEqual(planned.warnings, []);
  };
  /** Taken at the launch and at the check, with nothing said. */
  const passesBoth = async (model) => {
    const before = bb.calls().length;
    const { doc, stderr } = await launch(model);
    assert.equal(doc.ok, true, JSON.stringify(doc));
    assert.equal(stderr, "");
    assert.deepEqual(spawns(before).map((c) => c.argv.slice(6, 8)), [["--model", model]], "the model goes to bb as it is");
    const planned = await check(model);
    assert.equal(planned.status, "ready");
    assert.deepEqual(planned.warnings, []);
  };
  /** Not refused, and warned of once: on the launch's stderr, and among the check's warnings. */
  const warnsBoth = async (model, why) => {
    const message = `could not check the model ${JSON.stringify(model)} against pi's model list: ${why}`;
    const before = bb.calls().length;
    const { doc, stderr } = await launch(model);
    assert.equal(doc.ok, true, JSON.stringify(doc));
    assert.equal(stderr, `oats bb: warning: ${message}\n`);
    assert.equal(spawns(before).length, 1, "the launch went on");
    const planned = await check(model);
    assert.equal(planned.status, "ready");
    assert.deepEqual(planned.warnings, [{ code: UNCHECKED, message }]);
  };
  return { home, backend, bb, launch, check, spawned, refusedBoth, passesBoth, warnsBoth };
}

test("a bare model id no pi provider serves is refused, at the launch and at the check: pi has no model", async (t) => {
  const { refusedBoth } = await setup(t);
  await refusedBoth("claude-fable-9", 'pi has no model "claude-fable-9"');
});

test("a bare model id two pi providers serve is refused, naming both and the full ids to choose from", async (t) => {
  const { refusedBoth } = await setup(t);
  await refusedBoth("gpt-6-astra", 'pi model "gpt-6-astra" is served by github-copilot and openai: use github-copilot/gpt-6-astra or openai/gpt-6-astra');
});

test("a bare model id three pi providers serve: every one is named", async (t) => {
  const { refusedBoth } = await setup(t, { models: { stdout: [...LIST, piModelRow("azure", "gpt-6-astra")] } });
  await refusedBoth("gpt-6-astra", 'pi model "gpt-6-astra" is served by github-copilot, openai and azure: use github-copilot/gpt-6-astra, openai/gpt-6-astra or azure/gpt-6-astra');
});

test("a provider/id that is not in pi's list is refused: pi has no model", async (t) => {
  const { refusedBoth } = await setup(t);
  // A provider pi has, with a model it does not serve; and a provider pi does not have.
  await refusedBoth("openai/claude-fable-5.1", 'pi has no model "openai/claude-fable-5.1"');
  await refusedBoth("anthropic/claude-fable-5.1", 'pi has no model "anthropic/claude-fable-5.1"');
});

test("the id is matched exactly, as bb's pi matches it: no other case, no prefix", async (t) => {
  const { refusedBoth } = await setup(t);
  await refusedBoth("Claude-Fable-5.1", 'pi has no model "Claude-Fable-5.1"');
  await refusedBoth("claude-fable", 'pi has no model "claude-fable"');
});

test("a bare model id exactly one pi provider serves passes: claude-fable-5.1, as a soul declares it", async (t) => {
  const { passesBoth } = await setup(t);
  await passesBoth("claude-fable-5.1");
});

test("an exact provider/id passes, one of a model two providers serve included", async (t) => {
  const { passesBoth } = await setup(t);
  await passesBoth("github-copilot/claude-fable-5.1");
  await passesBoth("openai/gpt-6-astra");
});

test("a model whose own id holds a slash passes by its bare id and by its full one", async (t) => {
  const { passesBoth } = await setup(t);
  await passesBoth("anthropic/claude-opus-5-5");
  await passesBoth("openrouter/anthropic/claude-opus-5-5");
});

for (const [name, models, why] of [
  ["bb refuses the read", { error: { code: "error", message: "fetch failed: connect ECONNREFUSED 127.0.0.1:38886" } }, "fetch failed: connect ECONNREFUSED 127.0.0.1:38886"],
  ["bb's CLI ends without an answer", { exit: 3, stderr: "bb: internal error\n" }, "bb: internal error"],
  ["no answer is scripted (a bb with no such command)", null, 'fake bb: no scripted answer for ["provider","models","pi","--selected-model","claude-fable-9","--json"]'],
  ["bb says beside its list that it could not load pi's models", { stdout: [piModelRow("github-copilot", "claude-fable-5.1")], stderr: "Could not load models for pi (provider_unavailable)\n  pi did not answer\n" }, "Could not load models for pi (provider_unavailable)"],
]) {
  test(`a list that cannot be read only warns, ${name}: the launch goes on, and the check is ready`, async (t) => {
    const { warnsBoth } = await setup(t, { models });
    await warnsBoth("claude-fable-9", why);
  });
}

test("a list that does not answer in time only warns, and the launch goes on", async (t) => {
  const { launch, spawned } = await setup(t, { models: { delayMs: 12_000, stdout: LIST } });
  const { doc, stderr } = await launch("claude-fable-9");
  assert.equal(doc.ok, true, JSON.stringify(doc));
  assert.equal(stderr, 'oats bb: warning: could not check the model "claude-fable-9" against pi\'s model list: no answer in time\n');
  assert.equal(spawned(), true);
});

for (const [name, stdout] of [
  ["an object, not a list", { models: LIST }],
  ["a row that is no object", [...LIST, "openai/gpt-7"]],
  ["a row with no id", [...LIST, { routeProviderId: "openai", displayName: "gpt-7" }]],
  ["a row that does not name its provider", [...LIST, { id: "openai/gpt-7", model: "openai/gpt-7" }]],
  ["a row whose id does not begin with its provider", [...LIST, { id: "gpt-7", routeProviderId: "openai" }]],
]) {
  test(`an answer of the wrong shape only warns, ${name}: nothing is refused on a list this provider cannot read`, async (t) => {
    const { warnsBoth } = await setup(t, { models: { stdout } });
    await warnsBoth("claude-fable-9", "the list is not one this provider can read");
  });
}

test("an empty list only warns: it names no model to hold an id against", async (t) => {
  const { warnsBoth } = await setup(t, { models: { stdout: [] } });
  await warnsBoth("claude-fable-9", "the list is empty");
});

test("where pi's enabledModels narrows bb's list, a model that is not listed only warns; one listed twice is still refused, and one listed passes", async (t) => {
  const { warnsBoth, refusedBoth, passesBoth } = await setup(t, { piSettings: { packages: ["npm:@awebai/oats-pi@0.70.0"], enabledModels: ["github-copilot/*"] } });
  await warnsBoth("claude-fable-9", "pi's enabledModels setting narrows the list to the models it names");
  await refusedBoth("gpt-6-astra", 'pi model "gpt-6-astra" is served by github-copilot and openai: use github-copilot/gpt-6-astra or openai/gpt-6-astra');
  await passesBoth("claude-fable-5.1");
});

test("an empty enabledModels narrows nothing: a model that is not listed is refused", async (t) => {
  const { refusedBoth } = await setup(t, { piSettings: { packages: ["npm:@awebai/oats-pi@0.70.0"], enabledModels: [] } });
  await refusedBoth("claude-fable-9", 'pi has no model "claude-fable-9"');
});

test("a model id that ends in a date and is not listed only warns: bb holds such a model back from its list", async (t) => {
  const { warnsBoth, passesBoth } = await setup(t, { models: { stdout: [...LIST, piModelRow("anthropic", "claude-sonnet-4-20250514")] } });
  await warnsBoth("claude-opus-4-20250101", "a model whose id ends in a date is not always listed");
  await warnsBoth("anthropic/claude-opus-4-20250101", "a model whose id ends in a date is not always listed");
  // Listed (bb lists it where the read names it exactly), it passes like any other.
  await passesBoth("anthropic/claude-sonnet-4-20250514");
});

test("one read of bb's list per launch and per check, naming the launch's model, told the deployment's host daemon port", async (t) => {
  const { backend, bb, launch, check } = await setup(t);
  assert.equal((await launch("claude-fable-5.1")).doc.ok, true);
  assert.equal((await check("claude-fable-5.1")).status, "ready");
  const reads = listReads(bb);
  assert.deepEqual(reads.map((c) => c.argv), Array(2).fill(["provider", "models", "pi", "--selected-model", "claude-fable-5.1", "--json"]));
  for (const read of reads) {
    assert.equal(read.server, backend.server);
    assert.equal(read.hostDaemonPort, String(backend.daemonPort));
  }
  // Before the first change: the launch's read comes before the home's env is written and the thread spawned.
  const order = bb.calls().map((c) => c.argv.slice(0, 2).join(" "));
  assert.ok(order.indexOf("provider models") < order.indexOf("machine env"), order.join(", "));
  assert.ok(order.indexOf("provider models") < order.indexOf("thread spawn"), order.join(", "));
});

test("a launch with no model, and a Claude launch, never read pi's models: nothing new is asked of bb", async (t) => {
  const { bb, launch, check } = await setup(t, { script: { "thread spawn": { stdout: { id: "thr_new", projectId: "proj_a", environmentId: null, status: "starting" } } } });
  assert.equal((await launch(undefined)).doc.ok, true);
  assert.equal((await launch(null)).doc.ok, true);
  assert.equal((await launch("claude-opus-5-5", { harness: "claude" })).doc.ok, true);
  // The checks of the same planned launches; a plain readiness read; a kernel that hands the check no model.
  assert.equal((await check(undefined)).status, "ready");
  assert.equal((await check(null)).status, "ready");
  assert.equal((await check("claude-opus-5-5", { harness: "claude" })).status, "ready");
  assert.equal((await call("check", { home: null, soul: null }, { settings: (await fakeBackend(t)).settings(), bb })).result.status, "ready");
  assert.deepEqual(listReads(bb), []);
});

test("a planned launch that is refused for something else is not asked about its model", async (t) => {
  const { backend, bb, launch, check } = await setup(t);
  assert.deepEqual((await check("claude-fable-9", { args: ["--thinking", "high"] })).problems.map((p) => p.code), ["E_BACKEND_LAUNCH_ARG"]);
  assert.deepEqual((await check("claude-fable-9", { yolo: false })).problems.map((p) => p.code), ["E_BACKEND_SANDBOXED_MODE"]);
  backend.state.piProvider = { providerId: "pi", status: "unauthenticated", statusMessage: null, loginCommand: "pi" };
  assert.deepEqual((await check("claude-fable-9")).problems.map((p) => p.code), ["E_BACKEND_NOT_READY"]);
  assert.equal((await launch("claude-fable-9")).doc.error.code, "E_BACKEND_NOT_READY");
  assert.deepEqual(listReads(bb), []);
});

test("a check whose planned launch carries a model that is no model id says nothing of it: the launch refuses that itself", async (t) => {
  const { bb, check, launch } = await setup(t);
  for (const model of ["", "--selected-model", 7, ["claude-fable-9"]]) assert.equal((await check(model)).status, "ready", JSON.stringify(model));
  assert.deepEqual(listReads(bb), []);
  assert.equal((await launch("--selected-model")).doc.error.code, "E_SESSION_START_FAILED");
});

test("the rule on bb's list, by itself: the full id first, then the bare id; one listed model with the id is that model", () => {
  assert.deepEqual(piModelVerdict("openai/gpt-6-astra", LIST), { ok: true });
  assert.deepEqual(piModelVerdict("claude-fable-5.1", LIST), { ok: true });
  // A full id that is also another provider's bare id is the full one: nothing is ambiguous.
  const both = [piModelRow("openrouter", "anthropic/claude-opus-5-5"), piModelRow("anthropic", "claude-opus-5-5"), piModelRow("other", "anthropic/claude-opus-5-5")];
  assert.deepEqual(piModelVerdict("anthropic/claude-opus-5-5", both), { ok: true });
  assert.deepEqual(piModelVerdict("claude-opus-5-5", both), { ok: true });
  // Whether pi's settings narrow the list could not be read: nothing is refused for a model that is not listed.
  assert.deepEqual(piModelVerdict("claude-fable-9", LIST, { narrowed: null }), { unchecked: "pi's settings could not be read, and they may narrow the list" });
  assert.deepEqual(piModelVerdict("claude-fable-9", LIST, { narrowed: false }), { refused: 'pi has no model "claude-fable-9"' });
});
