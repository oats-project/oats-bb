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
// bb takes ANY value at the spawn and answers a thread, which runs, and nothing says what
// became of the choice (seen at bb-app 0.50.1, pinned by test/contract/contract.test.mjs):
// with a level its model does not have, or the word `default`, Claude Code is started with
// no effort at all, neither the one asked for nor the one bb gives a thread spawned with no
// level; with the tier `fast` for a model it lists no tier for, Claude Code is started in
// its fast mode all the same. A choice is carried or refused, never dropped, and what is
// carried is what bb itself offers for the model (what a person can pick in bb's composer):
// so the value is held here against what bb lists for the launch's model (`bb provider
// models <provider> --json`: `supportedReasoningEfforts[].reasoningEffort`, and
// `supportedServiceTiers[].id` where the model has tiers) before anything is started.
// Where that list cannot settle it (bb does not answer, the model is not in it, the launch
// names no model and bb starts on a default of its own), nothing is refused: the launch
// goes on with a warning, as for the pi model check (lib/pi-model.mjs).
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

/** The ids of one of a model's lists (its reasoning levels, its service tiers), or null
 *  where the list is not one this provider can read. */
function idsOf(list, key) {
  if (!Array.isArray(list)) return null;
  const ids = [];
  for (const entry of list) {
    if (!isObject(entry) || typeof entry[key] !== "string" || entry[key] === "") return null;
    ids.push(entry[key]);
  }
  return ids;
}

/** What bb's list says of the choices for this model.
 *  → { ok: true } | { refused: <sentence> } | { unchecked: <short why> }. */
export function choicesVerdict(choices, model, harness, value) {
  if (!Array.isArray(value) || value.some((row) => !isObject(row) || typeof row.id !== "string" || row.id === "")) return { unchecked: "the list is not one this provider can read" };
  const row = rowOf(value, model, harness);
  if (row === null) return { unchecked: `bb's list does not hold the model ${JSON.stringify(model)}, or holds it more than once` };
  const level = choices["reasoning-level"];
  if (level !== undefined) {
    const levels = idsOf(row.supportedReasoningEfforts, "reasoningEffort");
    if (levels === null) return { unchecked: `bb's list does not say which reasoning levels ${row.id} has` };
    if (!levels.includes(level)) return { refused: `the model ${row.id} has no reasoning level ${JSON.stringify(level)} in bb: it has ${levels.length > 0 ? listed(levels) : "none"}. Choose one of them (--launch-choice reasoning-level=<level>), or clear the choice (${clear("reasoning-level")})` };
  }
  const tier = choices["service-tier"];
  if (tier !== undefined) {
    // A model with no tiers has no such list at all (bb's own shape: `supportedServiceTiers?`).
    const tiers = row.supportedServiceTiers === undefined || row.supportedServiceTiers === null ? [] : idsOf(row.supportedServiceTiers, "id");
    if (tiers === null) return { unchecked: `bb's list does not say which service tiers ${row.id} has` };
    if (!tiers.includes(tier)) return { refused: `the model ${row.id} has no service tier ${JSON.stringify(tier)} in bb: it has ${tiers.length > 0 ? listed(tiers) : "none"}. ${tiers.length > 0 ? "Choose one of them (--launch-choice service-tier=<tier>), or clear" : "Clear"} the choice (${clear("service-tier")})` };
  }
  return { ok: true };
}

/** The check of one launch's choices: one read of bb's list of its provider's models.
 *  `choices`: as readChoices returns them. `bb`: a client (lib/bb.mjs). → null (nothing
 *  chosen, or every choice is one the model has), { problem: {code, message, status} }
 *  (refused: nothing may be started), or { warning: {code, message} } (it could not be
 *  checked: the launch goes on). Never throws for anything bb did or did not answer. */
export async function choicesFinding(choices, model, harness, bb) {
  const names = Object.keys(choices);
  if (names.length === 0) return null;
  const unchecked = (why) => ({ warning: { code: CHOICE_UNCHECKED, message: `could not check the launch ${names.length > 1 ? "choices" : "choice"} ${listed(names)} against bb's model list: ${brief(why)}` } });
  if (typeof model !== "string" || model === "") return unchecked("the launch names no model, and bb then starts on a default of its own");
  const answer = await bb.models(BB_PROVIDER[harness], model);
  if (!answer.ok) return unchecked(answer.timedOut ? "no answer in time" : answer.message);
  const notLoaded = (answer.said ?? "").split("\n").find((line) => /could not load models/i.test(line));
  if (notLoaded !== undefined) return unchecked(notLoaded);
  const verdict = choicesVerdict(choices, model, harness, answer.value);
  if (verdict.ok) return null;
  if (verdict.unchecked !== undefined) return unchecked(verdict.unchecked);
  return { problem: { code: CHOICE_REFUSED, message: verdict.refused, status: "needs-configuration" } };
}
