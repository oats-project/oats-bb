// The launch choices the provider declares (reasoning-level, service-tier): a choice is
// carried to `bb thread spawn` as an argument of its own, or refused before anything is
// started, never dropped. bb itself takes any value at the spawn and runs the thread without
// one its model does not have (seen at bb-app 0.50.1; test/contract/contract.test.mjs).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { LAUNCH_CHOICES, choiceArgs, choicesVerdict, providerTiers, readChoices } from "../../oats-package/capabilities/oats-bb/lib/choices.mjs";
import { piModelVerdict } from "../../oats-package/capabilities/oats-bb/lib/pi-model.mjs";
import { VERSION, call, callSeen, capabilityDir, fakeBackend, fakeBbIn, laterBin, piModelRow, projectRow, scratch } from "../fixtures/harness.mjs";

const envList = (names) => ({ builtInGit: { status: "not logged in" }, variables: names.map((name) => ({ name, value: null, secret: true, note: null })), inheritedVariables: [] });
const levels = (...ids) => ids.map((id) => ({ reasoningEffort: id, description: `${id} reasoning effort` }));
// One of bb's Claude models, as bb-app 0.50.1 lists one (copied from a real server's answer,
// trimmed): no provider prefix, no service tiers.
const claudeRow = (id, extra = {}) => ({ id, model: id, displayName: id, description: "a model", reasoningDiscovery: "known", supportedReasoningEfforts: levels("low", "medium", "high", "xhigh", "ultracode", "max"), defaultReasoningEffort: "high", isDefault: false, ...extra });
// A service tier is the provider's (`bb provider list --json`, copied from a real server's answer, trimmed): Claude
// Code's are default and fast, pi has none. A model's row may narrow them (`supportedServiceTiers`, which no model of
// the contract image has: bb's own shape, `bb guide json`); a row with none takes every tier of its provider.
const tiers = (...ids) => ids.map((id) => ({ id, label: id }));
const PROVIDERS = [
  { id: "codex", displayName: "Codex", available: true, capabilities: { supportsServiceTier: true }, reasoningLevels: [], serviceTiers: tiers("default", "fast", "ultrafast") },
  { id: "claude-code", displayName: "Claude Code", available: true, capabilities: { supportsServiceTier: true }, reasoningLevels: [], serviceTiers: tiers("default", "fast") },
  { id: "pi", displayName: "Pi", available: true, capabilities: { supportsServiceTier: false }, reasoningLevels: [] },
];
const CLAUDE = [claudeRow("claude-opus-5-5"), claudeRow("claude-standard-5", { supportedServiceTiers: tiers("default"), supportedReasoningEfforts: levels("low", "medium", "high") })];
const PI = [
  piModelRow("anthropic", "claude-opus-5-5", { supportedReasoningEfforts: levels("low", "medium", "high"), defaultReasoningEffort: "medium" }),
  piModelRow("mock", "echo"), piModelRow("mock", "twin"), piModelRow("mock-b", "twin"),
];
const UNCHECKED = "session-provider-launch-choice-unchecked";
const spawnOf = (bb) => bb.calls().find((c) => c.argv[0] === "thread" && c.argv[1] === "spawn")?.argv ?? null;
const modelReads = (bb) => bb.calls().filter((c) => c.argv[0] === "provider").map((c) => c.argv.join(" "));

async function setup(t, { harness = "claude", script = {} } = {}) {
  const { dir, home } = scratch(t);
  const backend = await fakeBackend(t);
  const bb = fakeBbIn(dir, {
    "--version": { stdout: `${VERSION}\n` },
    "project list": { stdout: [projectRow("proj_a", home)] },
    "thread list": { stdout: [] },
    "thread spawn": { stdout: { id: "thr_new", projectId: "proj_a", environmentId: null, providerId: harness === "pi" ? "pi" : "claude-code", status: "starting" } },
    "machine env list": { stdout: envList([]) }, "machine env set": { stdout: envList([]) }, "machine env unset": { stdout: envList([]) },
    "provider models claude-code": { stdout: CLAUDE },
    "provider models pi": { stdout: PI },
    "provider list": { stdout: PROVIDERS },
    ...script,
  });
  const model = harness === "pi" ? "anthropic/claude-opus-5-5" : "claude-opus-5-5";
  const input = (extra = {}) => ({ home, instance: "dev-a", harness, model, yolo: true, env: [{ name: "OATS_INSTANCE", value: "dev-a", source: "kernel" }, { name: "OATS_INSTANCE_HOME", value: home, source: "kernel" }], unset: [], args: [], promptFile: join(home, "TASK.md"), previous: null, ...extra });
  // (Two minutes from now, for pi: right after the fixture wrote pi's configuration the pi model check refuses nothing.)
  const options = { settings: backend.settings(), bb, bin: harness === "pi" ? laterBin : undefined };
  /** The launch with these choices. → { doc, stderr }. */
  const launch = (choices, extra = {}) => callSeen("launch", input({ ...(choices === undefined ? {} : { choices }), ...extra }), options);
  /** The check of the planned launch with these choices, as the kernel hands it. → the result. */
  const check = async (choices, planned = {}) => (await call("check", { home, soul: null, launch: { harness, yolo: true, args: [], model, ...(choices === undefined ? {} : { choices }), ...planned } }, options)).result;
  /** Refused at the launch and at the check, with this sentence, and nothing started. */
  const refusedBoth = async (choices, sentence, extra = {}) => {
    const before = bb.calls().length;
    const { doc, stderr } = await launch(choices, extra);
    assert.deepEqual(doc.error, { code: "E_BACKEND_LAUNCH_ARG", message: sentence });
    assert.equal(stderr, "");
    assert.deepEqual(bb.calls().slice(before).filter((c) => !["--version", "host", "provider"].includes(c.argv[0])), [], "nothing was started, and bb was only read");
    const planned = await check(choices, extra);
    assert.equal(planned.status, "needs-configuration");
    assert.deepEqual(planned.problems, [{ code: "E_BACKEND_LAUNCH_ARG", message: sentence }]);
  };
  /** Not checked: the launch goes on with the choices and this warning, and the check warns the same. */
  const warnsBoth = async (choices, why, extra = {}) => {
    const names = Object.keys(choices);
    const message = `could not check the launch ${names.length > 1 ? "choices" : "choice"} ${names.join(" and ")} against bb's lists: ${why}`;
    const { doc, stderr } = await launch(choices, extra);
    assert.equal(doc.ok, true, JSON.stringify(doc));
    assert.ok(stderr.split("\n").includes(`oats bb: warning: ${message}`), stderr);
    const planned = await check(choices, extra);
    assert.equal(planned.status, "ready");
    assert.deepEqual(planned.warnings.filter((warning) => warning.code === UNCHECKED), [{ code: UNCHECKED, message }]);
  };
  return { home, bb, backend, launch, check, refusedBoth, warnsBoth, model };
}

test("the manifest declares the choices the provider takes, each with a description a client can show as text", () => {
  const declared = JSON.parse(readFileSync(join(capabilityDir, "oats.json"), "utf8")).sessionProviders.bb.launchChoices;
  assert.deepEqual(Object.keys(declared).sort(), Object.keys(LAUNCH_CHOICES).sort());
  assert.deepEqual(Object.keys(LAUNCH_CHOICES), ["reasoning-level", "service-tier"]);
  for (const [name, choice] of Object.entries(declared)) {
    assert.deepEqual(Object.keys(choice), ["description"], name);
    assert.ok(choice.description.length > 0 && [...choice.description].length <= 200 && !/[\u0000-\u001f\u007f-\u009f\u2028\u2029\u061c\u200b-\u200f\u202a-\u202e\u2060\u2066-\u2069\ufeff]/.test(choice.description), name);
  }
});

for (const harness of ["claude", "pi"]) {
  test(`a ${harness} launch with a reasoning level its model has in bb: the level reaches bb's thread, as an argument of the spawn of its own; the check reads ready and says nothing`, async (t) => {
    const { bb, launch, check, model } = await setup(t, { harness });
    const { doc, stderr } = await launch({ "reasoning-level": "high" });
    assert.equal(doc.ok, true, JSON.stringify(doc));
    assert.equal(stderr, "");
    const argv = spawnOf(bb);
    assert.deepEqual(argv.slice(argv.indexOf("--reasoning-level"), argv.indexOf("--reasoning-level") + 2), ["--reasoning-level", "high"]);
    assert.equal(argv.includes("--service-tier"), false, "a choice that was not made is not passed");
    // Held against bb's list for the launch's model, read with the model named, and read once: for pi it is the
    // list the pi model check reads too.
    assert.deepEqual(modelReads(bb), [`provider models ${harness === "pi" ? "pi" : "claude-code"} --selected-model ${model} --json`]);
    const planned = await check({ "reasoning-level": "high" });
    assert.deepEqual([planned.status, planned.problems, planned.warnings.filter((warning) => warning.code === UNCHECKED)], ["ready", [], []]);
  });
}

test("a launch with no choice passes none, and reads nothing of bb for it: as before the choices", async (t) => {
  for (const choices of [undefined, null, {}]) {
    const { bb, launch, check } = await setup(t);
    const { doc, stderr } = await launch(choices);
    assert.equal(doc.ok, true, JSON.stringify(doc));
    assert.equal(stderr, "");
    const argv = spawnOf(bb);
    assert.ok(!argv.includes("--reasoning-level") && !argv.includes("--service-tier"), argv.join(" "));
    assert.deepEqual(modelReads(bb), []);
    assert.equal((await check(choices)).status, "ready");
    assert.deepEqual(modelReads(bb), []);
  }
});

test("both choices are carried, each as an option and a value of its own: a tier of the provider's, for a model whose row narrows none; the check reads ready", async (t) => {
  const { bb, launch, check } = await setup(t);
  const { doc, stderr } = await launch({ "service-tier": "fast", "reasoning-level": "low" });
  assert.equal(doc.ok, true, JSON.stringify(doc));
  assert.equal(stderr, "");
  const argv = spawnOf(bb);
  assert.deepEqual(argv.slice(argv.indexOf("--reasoning-level")), ["--reasoning-level", "low", "--service-tier", "fast", "--json"]);
  // The provider's tiers are read only where a tier is chosen: one more read of bb.
  assert.deepEqual(modelReads(bb), ["provider list --json", "provider models claude-code --selected-model claude-opus-5-5 --json"]);
  const planned = await check({ "service-tier": "fast", "reasoning-level": "low" });
  assert.deepEqual([planned.status, planned.problems, planned.warnings.filter((warning) => warning.code === UNCHECKED)], ["ready", [], []]);
});

test("a reasoning level the model does not have in bb is refused, at the launch and at the check, naming the levels it has: bb would run the thread without it", async (t) => {
  const { refusedBoth } = await setup(t);
  await refusedBoth({ "reasoning-level": "bogus" }, 'the model claude-opus-5-5 has no reasoning level "bogus" in bb: it has "low", "medium", "high", "xhigh", "ultracode" and "max". Choose one of them (--launch-choice reasoning-level=<level>), or clear the choice (--launch-choice reasoning-level=default)');
  // A level another model has is not this model's.
  const pi = await setup(t, { harness: "pi" });
  await pi.refusedBoth({ "reasoning-level": "xhigh" }, 'the model anthropic/claude-opus-5-5 has no reasoning level "xhigh" in bb: it has "low", "medium" and "high". Choose one of them (--launch-choice reasoning-level=<level>), or clear the choice (--launch-choice reasoning-level=default)');
});

test("a service tier is the provider's: one bb's provider does not list is refused, and so is any tier where the provider has none (pi), and one a model's own list leaves out", async (t) => {
  const { refusedBoth } = await setup(t);
  // bb itself refuses this one, at the spawn: by then a launch has changed bb. Refused here first.
  await refusedBoth({ "service-tier": "ultrafast" }, 'bb\'s claude-code has no service tier "ultrafast": it has "fast". Choose one of them (--launch-choice service-tier=<tier>), or clear the choice (--launch-choice service-tier=default)');
  // A model whose row narrows its provider's tiers to the standard one.
  await refusedBoth({ "service-tier": "fast" }, 'the model claude-standard-5 has no service tier "fast" in bb: bb lists no service tier for it. Clear the choice (--launch-choice service-tier=default)', { model: "claude-standard-5" });
  const pi = await setup(t, { harness: "pi" });
  await pi.refusedBoth({ "service-tier": "fast" }, 'bb\'s pi has no service tier "fast": it has no service tiers. Clear the choice (--launch-choice service-tier=default)');
});

test("the value `default` is refused, for either choice: it is the kernel's word for none, and bb would take it for a level", async (t) => {
  const { refusedBoth, bb } = await setup(t);
  for (const name of ["reasoning-level", "service-tier"]) {
    await refusedBoth({ [name]: "default" }, `the launch choice ${name} is "default", which is no value to ask bb for: it is how a recorded choice is cleared (--launch-choice ${name}=default), and the launch then carries none`);
  }
  // (The check reads bb's own state whatever the launch is: nothing was asked of bb's models, and nothing started.)
  assert.deepEqual([modelReads(bb), spawnOf(bb)], [[], null], "refused before bb is asked anything of the choice");
});

for (const [name, choices, pattern] of [
  ["a choice the provider does not declare", { "thinking-budget": "high" }, /^the bb backend takes no launch choice "thinking-budget": it takes reasoning-level and service-tier$/],
  ["choices that are no map", ["reasoning-level=high"], /^the launch's choices must be a map of choice names to values$/],
  ["a value that is no string", { "reasoning-level": 3 }, /^the launch choice reasoning-level must be a value of 1 to 40 lowercase letters, digits, dashes and underscores, starting with a letter or a digit$/],
  ["a value that would read as an option of bb's", { "reasoning-level": "--model" }, /^the launch choice reasoning-level must be a value of/],
  ["a value with a space", { "service-tier": "fast --plan" }, /^the launch choice service-tier must be a value of/],
  ["an empty value", { "service-tier": "" }, /^the launch choice service-tier must be a value of/],
  ["a value in capitals", { "reasoning-level": "High" }, /^the launch choice reasoning-level must be a value of/],
  ["a value of 41 characters", { "reasoning-level": "a".repeat(41) }, /^the launch choice reasoning-level must be a value of/],
]) {
  test(`${name}: refused at the launch and at the check before bb is asked anything, and the value is never in the message`, async (t) => {
    const { bb, launch, check } = await setup(t);
    const { doc, stderr } = await launch(choices);
    assert.equal(doc.error.code, "E_BACKEND_LAUNCH_ARG");
    assert.match(doc.error.message, pattern);
    assert.equal(stderr, "");
    assert.deepEqual(bb.calls(), []);
    const planned = await check(choices);
    assert.equal(planned.status, "needs-configuration");
    assert.deepEqual(planned.problems.map((problem) => problem.code), ["E_BACKEND_LAUNCH_ARG"]);
    assert.match(planned.problems[0].message, pattern);
    for (const text of [doc.error.message, planned.problems[0].message]) assert.ok(!text.includes("--model") && !text.includes("--plan") && !text.includes("High"), text);
  });
}

test("where bb's list cannot settle it, nothing is refused: the launch goes on with the choice and a warning, and the check warns the same", async (t) => {
  const answers = [
    [{ "provider models claude-code": { error: { code: "error", message: "fetch failed: connect ECONNREFUSED 127.0.0.1:38886" } } }, "fetch failed: connect ECONNREFUSED 127.0.0.1:38886"],
    [{ "provider models claude-code": { stdout: { models: CLAUDE } } }, "the list is not one this provider can read"],
    [{ "provider models claude-code": { stdout: [claudeRow("claude-other-9")] } }, 'bb\'s list does not hold the model "claude-opus-5-5", or holds it more than once'],
    [{ "provider models claude-code": { stdout: [claudeRow("claude-opus-5-5", { supportedReasoningEfforts: "all" })] } }, "bb's list does not say which reasoning levels claude-opus-5-5 has"],
  ];
  for (const [script, why] of answers) {
    const { bb, warnsBoth } = await setup(t, { script });
    await warnsBoth({ "reasoning-level": "high" }, why);
    const argv = spawnOf(bb);
    assert.deepEqual(argv.slice(argv.indexOf("--reasoning-level"), argv.indexOf("--reasoning-level") + 2), ["--reasoning-level", "high"], "the choice is carried, not dropped");
  }
  // A tier list of a shape this provider cannot read, in the model's row and in bb's providers.
  const odd = await setup(t, { script: { "provider models claude-code": { stdout: [claudeRow("claude-opus-5-5", { supportedServiceTiers: ["fast"] })] } } });
  await odd.warnsBoth({ "service-tier": "fast" }, "bb's list does not say which service tiers claude-opus-5-5 has");
  for (const providers of [{ error: { code: "error", message: "boom" } }, { stdout: { providers: PROVIDERS } }, { stdout: [{ id: "codex" }] }, { stdout: [{ id: "claude-code", serviceTiers: ["fast"] }] }]) {
    const blind = await setup(t, { script: { "provider list": providers } });
    await blind.warnsBoth({ "service-tier": "fast" }, "bb's list of its providers does not say which service tiers claude-code has");
  }
});

test("a launch that names no model: bb picks one by a rule its list does not show, so a value no model of the provider has is refused, one every model has is carried, and one only some have is left open with a warning", async (t) => {
  const { refusedBoth, warnsBoth, launch, check, bb } = await setup(t);
  const none = { model: null };
  await refusedBoth({ "reasoning-level": "bogus" }, 'the launch names no model, and no model bb lists for claude-code has the reasoning level "bogus": name a model that has it, or clear the choice (--launch-choice reasoning-level=default)', none);
  await refusedBoth({ "service-tier": "ultrafast" }, 'bb\'s claude-code has no service tier "ultrafast": it has "fast". Choose one of them (--launch-choice service-tier=<tier>), or clear the choice (--launch-choice service-tier=default)', none);
  // Every model has it: carried, and nothing said. The list is read plain, with no model named.
  const before = bb.calls().length;
  const { doc, stderr } = await launch({ "reasoning-level": "high" }, none);
  assert.equal(doc.ok, true, JSON.stringify(doc));
  assert.equal(stderr, "");
  assert.deepEqual(bb.calls().slice(before).filter((c) => c.argv[0] === "provider").map((c) => c.argv.join(" ")), ["provider models claude-code --json"]);
  const argv = spawnOf(bb);
  assert.ok(!argv.includes("--model") && argv.includes("--reasoning-level"), argv.join(" "));
  assert.deepEqual((await check({ "reasoning-level": "high" }, none)).warnings.filter((warning) => warning.code === UNCHECKED), []);
  // Only some models have it (xhigh; and fast, which one model's own list leaves out): left open.
  await warnsBoth({ "reasoning-level": "xhigh" }, 'the launch names no model, and only some of the models bb lists for claude-code have the reasoning level "xhigh": bb picks the model by a rule its list does not show', none);
  await warnsBoth({ "service-tier": "fast" }, 'the launch names no model, and only some of the models bb lists for claude-code have the service tier "fast": bb picks the model by a rule its list does not show', none);
});

test("a pi model written with pi's own `:<level>` is refused, at the launch and at the check, naming the model and the launch choice that carries the level", async (t) => {
  const { refusedBoth, launch, bb } = await setup(t, { harness: "pi" });
  await refusedBoth(undefined, 'pi model "anthropic/claude-opus-5-5:high" names a thinking level in the model id, which bb\'s pi does not take: name the model "anthropic/claude-opus-5-5", and choose the level with --launch-choice reasoning-level=high', { model: "anthropic/claude-opus-5-5:high" });
  // By its bare id too, where one provider serves it; pi's `off` is the level bb calls `none`.
  await refusedBoth(undefined, 'pi model "echo:off" names a thinking level in the model id, which bb\'s pi does not take: name the model "echo", and choose the level with --launch-choice reasoning-level=none', { model: "echo:off" });
  // The model and the level, each in its place, launch.
  const { doc } = await launch({ "reasoning-level": "high" });
  assert.equal(doc.ok, true, JSON.stringify(doc));
  const argv = spawnOf(bb);
  assert.deepEqual([argv[argv.indexOf("--model") + 1], argv[argv.indexOf("--reasoning-level") + 1]], ["anthropic/claude-opus-5-5", "high"]);
});

test("the `:<level>` sentence is given only where what stands before the colon is a model of the list: a model whose own id holds a colon, and an unknown one, are told what they were before", () => {
  const rows = [...PI, piModelRow("openrouter", "vendor/model:free")];
  assert.deepEqual(piModelVerdict("openrouter/vendor/model:free", rows), { ok: true }, "an id that is a model's own, colon and all");
  assert.deepEqual(piModelVerdict("vendor/model:free", rows), { ok: true });
  assert.match(piModelVerdict("nothing-here:high", rows).refused, /^pi has no model "nothing-here:high" /);
  assert.match(piModelVerdict("twin:high", rows).refused, /^pi has no model "twin:high" /, "two providers serve twin: what was meant is not known");
  assert.match(piModelVerdict("mock/twin:high", rows).refused, /names a thinking level in the model id.*name the model "mock\/twin", and choose the level with --launch-choice reasoning-level=high$/);
  assert.match(piModelVerdict("echo:", rows).refused, /^pi has no model "echo:" /);
  assert.match(piModelVerdict("echo:Not A Level", rows).refused, /^pi has no model /);
  // Only pi's own levels are taken for one: any other word after a colon is part of a model's own id (a tag, a variant).
  for (const level of ["off", "minimal", "low", "medium", "high", "xhigh", "max"]) assert.match(piModelVerdict(`echo:${level}`, rows).refused, /names a thinking level in the model id/, level);
  // The value the sentence names is one bb has: pi's own word, but for `off` (bb's `none`) and `minimal`, which bb
  // has for no pi model, so none is named for it.
  for (const [level, named] of [["low", "low"], ["max", "max"], ["off", "none"]]) assert.ok(piModelVerdict(`echo:${level}`, rows).refused.endsWith(`and choose the level with --launch-choice reasoning-level=${named}`), level);
  assert.equal(piModelVerdict("echo:minimal", rows).refused, 'pi model "echo:minimal" names a thinking level in the model id, which bb\'s pi does not take: name the model "echo", and choose a level bb lists for it with --launch-choice reasoning-level=<level> (bb has none called "minimal")');
  for (const tag of ["8b", "free", "latest", "thinking", "none", "ultracode"]) assert.match(piModelVerdict(`echo:${tag}`, rows).refused, /^pi has no model /, tag);
  // It is the refusal's sentence, and no check of its own: where the list cannot settle an id, nothing is refused,
  // as before the choices (a model the list holds back may have such an id of its own).
  const PARTIAL = "pi's enabledModels setting narrows the list to the models it names", OLD = "pi's configuration changed a moment ago, and bb's list may be older than it";
  assert.deepEqual(piModelVerdict("echo:high", rows, { partial: PARTIAL }), { unchecked: PARTIAL });
  assert.deepEqual(piModelVerdict("echo:high", rows, { old: OLD }), { unchecked: OLD });
  assert.deepEqual(piModelVerdict("echo:8b", rows, { partial: PARTIAL }), { unchecked: PARTIAL });
});

test("readChoices, choiceArgs and choicesVerdict, each by itself", () => {
  assert.deepEqual(readChoices(undefined), {});
  assert.deepEqual(readChoices({ "service-tier": "fast", "reasoning-level": "x_high-2" }), { "service-tier": "fast", "reasoning-level": "x_high-2" });
  assert.throws(() => readChoices({ __proto__: null, constructor: "x" }), { code: "E_BACKEND_LAUNCH_ARG" });
  assert.deepEqual(choiceArgs({}), []);
  assert.deepEqual(choiceArgs({ "service-tier": "fast", "reasoning-level": "low" }), ["--reasoning-level", "low", "--service-tier", "fast"], "in the provider's own order, whatever the map's");
  assert.deepEqual(choicesVerdict({ "reasoning-level": "high" }, "claude-opus-5-5", "claude", CLAUDE), { ok: true });
  assert.deepEqual(choicesVerdict({ "reasoning-level": "high" }, "claude-opus-5-5", "pi", PI), { ok: true }, "a bare pi id one provider serves");
  assert.match(choicesVerdict({ "reasoning-level": "high" }, "twin", "pi", PI).unchecked, /does not hold the model "twin", or holds it more than once/);
  assert.match(choicesVerdict({ "reasoning-level": "high" }, "claude-opus-5-5", "claude", [claudeRow("claude-opus-5-5"), claudeRow("claude-opus-5-5")]).unchecked, /more than once/);
  assert.match(choicesVerdict({ "reasoning-level": "high" }, "claude-opus-5-5", "claude", [{ id: 7 }]).unchecked, /not one this provider can read/);
  assert.equal(choicesVerdict({ "reasoning-level": "high" }, "claude-opus-5-5", "claude", [claudeRow("claude-opus-5-5", { supportedReasoningEfforts: [] })]).refused, 'the model claude-opus-5-5 has no reasoning level "high" in bb: bb lists no reasoning level for it. Clear the choice (--launch-choice reasoning-level=default)');
  // A level bb calls `none` is a level like another: said in quotes, so that it does not read as "it has none".
  assert.equal(choicesVerdict({ "reasoning-level": "high" }, "mock/echo", "pi", PI).refused, 'the model mock/echo has no reasoning level "high" in bb: it has "none". Choose one of them (--launch-choice reasoning-level=<level>), or clear the choice (--launch-choice reasoning-level=default)');
  assert.deepEqual(choicesVerdict({ "reasoning-level": "none" }, "mock/echo", "pi", PI), { ok: true });
  // The provider's tiers, as bb lists them: the standard one is no choice; a provider with none; an answer this provider cannot read.
  assert.deepEqual(providerTiers(PROVIDERS, "claude-code"), ["fast"]);
  assert.deepEqual(providerTiers(PROVIDERS, "codex"), ["fast", "ultrafast"]);
  assert.deepEqual(providerTiers(PROVIDERS, "pi"), []);
  for (const answer of [null, { providers: PROVIDERS }, [], [{ id: "claude-code", serviceTiers: "fast" }], [{ id: "claude-code", serviceTiers: [{ label: "Fast" }] }]]) assert.equal(providerTiers(answer, "claude-code"), null, JSON.stringify(answer));
  assert.deepEqual(choicesVerdict({ "service-tier": "fast" }, "claude-opus-5-5", "claude", CLAUDE, { tiers: ["fast"] }), { ok: true });
  assert.match(choicesVerdict({ "service-tier": "fast" }, "claude-opus-5-5", "claude", CLAUDE, { tiers: null }).unchecked, /bb's list of its providers does not say which service tiers claude-code has/);
  // A model whose levels bb has not discovered yet lists none, and that says nothing: not refused, with a model named or with none.
  const undiscovered = [claudeRow("claude-opus-5-5", { reasoningDiscovery: "unknown", supportedReasoningEfforts: [] })];
  assert.deepEqual(choicesVerdict({ "reasoning-level": "high" }, "claude-opus-5-5", "claude", undiscovered), { unchecked: "bb's list does not say which reasoning levels claude-opus-5-5 has" });
  assert.match(choicesVerdict({ "reasoning-level": "high" }, null, "claude", undiscovered).unchecked, /do not say which reasoning levels every model of claude-code has/);
  // With no model and no row at all, nothing can be said.
  assert.match(choicesVerdict({ "reasoning-level": "high" }, null, "claude", []).unchecked, /do not say which reasoning levels every model of claude-code has/);
});
