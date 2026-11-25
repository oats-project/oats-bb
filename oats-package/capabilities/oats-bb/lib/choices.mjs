// The launch choices the provider declares (`sessionProviders.bb.launchChoices` in
// oats.json; OATS's `--launch-choice <name>=<value>`, the feature `launch-choices`): bb's
// reasoning level and service tier, the two a person picks in bb's own composer.
//
// The kernel knows no choice's meaning. It hands a launch, and the check of a planned
// launch, `choices: { "<name>": "<value>" }` (only names this manifest declares, only when
// one is chosen; the reserved value `default` clears a recorded choice in the kernel and
// is never passed on). The provider passes each to `bb thread spawn` as an argument of its
// own, `--reasoning-level <value>` and `--service-tier <value>`: data, never a shell word.
//
// What bb does with a value, which is why each is held against bb's own lists before
// anything is started (seen at bb-app 0.50.1, pinned by test/contract/):
// - A reasoning level is the model's: `bb provider models <provider> --json` lists each
//   model's (`supportedReasoningEfforts[].reasoningEffort`). bb takes ANY level at the
//   spawn and answers a thread, which runs, and nothing says what became of the level:
//   with one its model does not have, or the word `default`, Claude Code is started with
//   no effort at all, neither the one asked for nor the one bb gives a thread spawned with
//   no level. A choice is carried or refused, never dropped: so it is refused here.
// - A service tier is the provider's: `bb provider list --json` lists each provider's
//   (`serviceTiers[].id`; Claude Code's are `default` and `fast`, pi has none). A model may
//   narrow them (`supportedServiceTiers[].id` in its row); a row with no such list takes
//   every tier of its provider (`bb guide providers`). bb itself refuses a tier its
//   provider does not list, at the spawn ("Provider claude-code does not support the …
//   service tier"): by then a launch has stopped the home's earlier thread and made its
//   project, so it is refused here first, with nothing started.
// Where those lists cannot settle it (bb does not answer, the model is not in its list),
// nothing is refused: the launch goes on with a warning, as for the pi model check
// (lib/pi-model.mjs). Where the launch names no model, bb picks one by a rule of its own
// that its list does not show (the project's remembered model, then its provider's
// default: `bb thread spawn --help`), so there is no one row to hold the choice against:
// a value NO model of the provider has is refused, one EVERY model has is carried, and one
// only some have is left open, with the warning.
import { fail, isObject } from "./errors.mjs";
import { BB_PROVIDER } from "./mode.mjs";

/** The choices this provider declares, each with the option of `bb thread spawn` that carries it. */
export const LAUNCH_CHOICES = Object.freeze({ "reasoning-level": "--reasoning-level", "service-tier": "--service-tier" });
export const CHOICE_REFUSED = "E_BACKEND_LAUNCH_ARG";
export const CHOICE_UNCHECKED = "session-provider-launch-choice-unchecked";
// A value as the kernel passes one; it becomes an argument of bb's CLI, never an option.
const VALUE = /^[a-z0-9][a-z0-9_-]{0,39}$/;
const WHY_MAX = 200;
const brief = (text) => { const line = String(text).split("\n")[0].trim(); return line.length > WHY_MAX ? `${line.slice(0, WHY_MAX - 1)}…` : line; };
const listed = (names) => (names.length <= 1 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`);
/** The values bb lists, each in quotes (a level may be called `none`), or what to say of a list that names none. */
const has = (ids, what) => (ids.length > 0 ? `it has ${listed(ids.map((id) => JSON.stringify(id)))}` : `bb lists no ${what} for it`);
const clear = (name) => `--launch-choice ${name}=default`;

/** The launch's choices, from the launch input's or the planned launch's `choices`. → {}
 *  where none is chosen, else { "<name>": "<value>" } of declared names only. Refused
 *  (E_BACKEND_LAUNCH_ARG), never dropped: a `choices` that is no map, a name this provider
 *  does not declare, a value that is not one the kernel passes, and the value `default`,
 *  which is the kernel's word for "none" and is never a level or a tier to ask bb for. */
export function readChoices(raw) {
  if (raw === undefined || raw === null) return {};
  if (!isObject(raw)) throw fail(CHOICE_REFUSED, "the launch's choices must be a map of choice names to values");
  const out = {};
  for (const [name, value] of Object.entries(raw)) {
    if (!Object.hasOwn(LAUNCH_CHOICES, name)) throw fail(CHOICE_REFUSED, `the bb backend takes no launch choice ${JSON.stringify(name)}: it takes ${listed(Object.keys(LAUNCH_CHOICES))}`);
    if (typeof value !== "string" || !VALUE.test(value)) throw fail(CHOICE_REFUSED, `the launch choice ${name} must be a value of 1 to 40 lowercase letters, digits, dashes and underscores, starting with a letter or a digit`);
    if (value === "default") throw fail(CHOICE_REFUSED, `the launch choice ${name} is "default", which is no value to ask bb for: it is how a recorded choice is cleared (${clear(name)}), and the launch then carries none`);
    out[name] = value;
  }
  return out;
}

/** The arguments of `bb thread spawn` that carry the choices, each value an argument of its own. */
export const choiceArgs = (choices) => Object.entries(LAUNCH_CHOICES).flatMap(([name, option]) => (Object.hasOwn(choices, name) ? [option, choices[name]] : []));

/** bb's row for the launch's model, or null where the list has none, or more than one, for
 *  it. Claude's models are listed by their id. pi's are `<provider>/<id>`, and a launch may
 *  name the bare id where one provider serves it (lib/pi-model.mjs has bb's own rule). */
function rowOf(rows, model, harness) {
  const exact = rows.filter((row) => row.id === model || row.model === model);
  if (exact.length === 1) return exact[0];
  if (exact.length > 1 || harness !== "pi") return null;
  const bare = rows.filter((row) => typeof row.routeProviderId === "string" && row.routeProviderId !== "" && row.id === `${row.routeProviderId}/${model}`);
  return bare.length === 1 ? bare[0] : null;
}

/** The ids of one of bb's lists (a model's reasoning levels, its service tiers, a
 *  provider's service tiers), or null where the list is not one this provider can read. */
function idsOf(list, key) {
  if (!Array.isArray(list)) return null;
  const ids = [];
  for (const entry of list) {
    if (!isObject(entry) || typeof entry[key] !== "string" || entry[key] === "") return null;
    ids.push(entry[key]);
  }
  return ids;
}

/** The reasoning levels a model has in bb, or null where its row does not say. */
const levelsOf = (row) => idsOf(row.supportedReasoningEfforts, "reasoningEffort");
/** The service tiers a model takes: its own list where its row has one, else every tier of
 *  its provider (`providerTiers`: ids, or null where bb's providers could not be read). */
const tiersOf = (row, providerTiers) => (row.supportedServiceTiers === undefined || row.supportedServiceTiers === null ? providerTiers : idsOf(row.supportedServiceTiers, "id"));

/** The service tiers bb's provider has, from `bb provider list --json`: [] for a provider
 *  that lists none (pi), null where the answer is not one this provider can read. `default`
 *  is left out: it is the provider's standard tier, what a launch with no choice runs on,
 *  and never a value a launch is handed. */
export function providerTiers(value, bbProvider) {
  if (!Array.isArray(value)) return null;
  const provider = value.find((entry) => isObject(entry) && entry.id === bbProvider);
  if (provider === undefined) return null;
  if (provider.serviceTiers === undefined || provider.serviceTiers === null) return [];
  return idsOf(provider.serviceTiers, "id")?.filter((id) => id !== "default") ?? null;
}

const CHOOSE = { "reasoning-level": "--launch-choice reasoning-level=<level>", "service-tier": "--launch-choice service-tier=<tier>" };
const KIND = { "reasoning-level": "reasoning level", "service-tier": "service tier" };
/** What to do about a value that is refused: choose one of those there are, or clear the choice. */
const remedy = (name, ids) => `${ids.length > 0 ? `Choose one of them (${CHOOSE[name]}), or clear` : "Clear"} the choice (${clear(name)})`;

/** What bb's lists say of the choices for the launch's model. `value`: bb's list of the
 *  provider's models. `tiers`: the provider's own service tiers (providerTiers), read only
 *  where a tier is chosen. `bbProvider`: bb's name for the provider, for a sentence.
 *  → { ok: true } | { refused: <sentence> } | { unchecked: <short why> }. */
export function choicesVerdict(choices, model, harness, value, { tiers = null, bbProvider = BB_PROVIDER[harness] } = {}) {
  if (!Array.isArray(value) || value.some((row) => !isObject(row) || typeof row.id !== "string" || row.id === "")) return { unchecked: "the list is not one this provider can read" };
  const level = choices["reasoning-level"], tier = choices["service-tier"];
  // A tier the provider does not have is refused whatever the model: bb refuses it too.
  if (tier !== undefined && tiers !== null && !tiers.includes(tier)) {
    return { refused: `bb's ${bbProvider} has no service tier ${JSON.stringify(tier)}: ${tiers.length > 0 ? `it has ${listed(tiers.map((id) => JSON.stringify(id)))}` : "it has no service tiers"}. ${remedy("service-tier", tiers)}` };
  }
  if (typeof model !== "string" || model === "") return noModelVerdict(choices, value, tiers, bbProvider);
  const row = rowOf(value, model, harness);
  if (row === null) return { unchecked: `bb's list does not hold the model ${JSON.stringify(model)}, or holds it more than once` };
  if (level !== undefined) {
    const levels = levelsOf(row);
    if (levels === null) return { unchecked: `bb's list does not say which reasoning levels ${row.id} has` };
    if (!levels.includes(level)) return { refused: `the model ${row.id} has no reasoning level ${JSON.stringify(level)} in bb: ${has(levels, "reasoning level")}. ${remedy("reasoning-level", levels)}` };
  }
  if (tier !== undefined) {
    const own = tiersOf(row, tiers);
    if (own === null) return { unchecked: row.supportedServiceTiers === undefined || row.supportedServiceTiers === null ? `bb's list of its providers does not say which service tiers ${bbProvider} has` : `bb's list does not say which service tiers ${row.id} has` };
    const offered = own.filter((id) => id !== "default");
    if (!offered.includes(tier)) return { refused: `the model ${row.id} has no service tier ${JSON.stringify(tier)} in bb: ${has(offered, "service tier")}. ${remedy("service-tier", offered)}` };
  }
  return { ok: true };
}

/** The same for a launch that names no model: bb picks one by a rule its list does not
 *  show, so each choice is held against every model of the provider. One no model has is
 *  refused (bb would drop it, whichever it picks), one every model has is carried, and one
 *  only some have cannot be settled. */
function noModelVerdict(choices, rows, tiers, bbProvider) {
  let open = null;
  for (const name of Object.keys(LAUNCH_CHOICES)) {
    const chosen = choices[name];
    if (chosen === undefined) continue;
    const lists = rows.map((row) => (name === "reasoning-level" ? levelsOf(row) : tiersOf(row, tiers)));
    if (rows.length === 0 || lists.some((list) => list === null)) { open ??= `the launch names no model, and bb's lists do not say which ${KIND[name]}s every model of ${bbProvider} has`; continue; }
    const having = lists.filter((list) => list.includes(chosen)).length;
    if (having === 0) return { refused: `the launch names no model, and no model bb lists for ${bbProvider} has the ${KIND[name]} ${JSON.stringify(chosen)}: name a model that has it, or clear the choice (${clear(name)})` };
    if (having < rows.length) open ??= `the launch names no model, and only some of the models bb lists for ${bbProvider} have the ${KIND[name]} ${JSON.stringify(chosen)}: bb picks the model by a rule its list does not show`;
  }
  return open === null ? { ok: true } : { unchecked: open };
}

/** The check of one launch's choices: one read of bb's list of its provider's models, and,
 *  where a tier is chosen, one of its providers. `choices`: as readChoices returns them.
 *  `bb`: a client (lib/bb.mjs). → null (nothing chosen, or every choice is one the model
 *  has), { problem: {code, message, status} } (refused: nothing may be started), or
 *  { warning: {code, message} } (it could not be checked: the launch goes on). Never
 *  throws for anything bb did or did not answer. */
export async function choicesFinding(choices, model, harness, bb) {
  const names = Object.keys(choices);
  if (names.length === 0) return null;
  const unchecked = (why) => ({ warning: { code: CHOICE_UNCHECKED, message: `could not check the launch ${names.length > 1 ? "choices" : "choice"} ${listed(names)} against bb's lists: ${brief(why)}` } });
  const named = typeof model === "string" && model !== "" ? model : null;
  const bbProvider = BB_PROVIDER[harness];
  // The provider's own tiers, where one is chosen: null where bb's providers cannot be read.
  let tiers = null;
  if (choices["service-tier"] !== undefined) {
    const providers = await bb.providers();
    tiers = providers.ok ? providerTiers(providers.value, bbProvider) : null;
  }
  const answer = await bb.models(bbProvider, named);
  if (!answer.ok) return unchecked(answer.timedOut ? "no answer in time" : answer.message);
  const notLoaded = (answer.said ?? "").split("\n").find((line) => /could not load models/i.test(line));
  if (notLoaded !== undefined) return unchecked(notLoaded);
  const verdict = choicesVerdict(choices, named, harness, answer.value, { tiers, bbProvider });
  if (verdict.ok) return null;
  if (verdict.unchecked !== undefined) return unchecked(verdict.unchecked);
  return { problem: { code: CHOICE_REFUSED, message: verdict.refused, status: "needs-configuration" } };
}
