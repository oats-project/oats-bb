// Which of the models bb lists for a harness serve a model id: ONE reading, for every place of the
// plugin that judges a model before a launch (the New agent form's Model field reads it; it is
// written for the Restart dialog too). It is the bb session provider's own resolution (oats-package/capabilities/oats-bb/lib/
// pi-model.mjs `piModelVerdict`, which is bb's own rule), and test/model/served.contract.test.ts
// runs one table through both and fails on any difference.
//
// The equality is on the rows the plugin holds (app/spawn/models.ts `modelOptions`): a model's id
// and the provider bb names for it, or none. Two malformed rows of bb's the plugin cannot tell from
// a model with no provider, and the provider can: a `routeProviderId` that is empty or not a
// string, and an id that is empty. The provider then reads no list at all and refuses nothing; the
// plugin drops the row and reads the rest (the contract test names the difference).
//
// It answers what the LIST says, no more. What a caller does with the answer is its own rule: the
// provider knows what bb's list leaves out (a model whose id ends in a date, a list pi's own
// configuration narrows, a list older than pi's configuration) and lets such a launch go; this
// function has the list alone. It imports nothing of app/.

/** A model bb lists: its id, and the provider bb routes it by (bb's `routeProviderId`; null where bb names none). */
export type ListedModel = { id: string; provider: string | null };

/**
 * What the list says of an id:
 * - `whole`: a listed model has exactly this id: that model, alone (`ids`: the id);
 * - `once`: it is the BARE id of exactly one listed model (`ids`: that model's id);
 * - `several`: it is the bare id of more than one ROW of the list (`ids`: each row's id, in the
 *   list's order: the ids the provider's own refusal names; a list that names one model twice
 *   has two rows of it, and the provider, which counts rows, refuses its bare id);
 * - `none`: no listed model has it, whole or bare;
 * - `unlisted`: the list cannot say: it holds no model that counts (`ids`: none).
 */
export type Served = { kind: "whole" | "once" | "several" | "none" | "unlisted"; ids: string[] };

/**
 * The listed models that serve `id`.
 *
 * A model's BARE id is its id minus `<provider>/`, the provider being the one bb routes it by. A
 * bare id may itself hold a slash (`openrouter/openai/gpt-6` is the provider `openrouter` and the
 * bare id `openai/gpt-6`), so nothing is matched by what an id ends in, nor by what follows its
 * first slash. Nothing is matched loosely: no prefix, no suffix, no other case.
 *
 * `byProvider`: the harness's models are resolved by provider (pi). There a model bb lists with NO
 * provider (one a person added to bb's own list) is not one of the harness's models: the
 * provider's check drops it, and it serves nothing here, not even its own id. And a model whose id
 * does not begin with its provider is not a list the provider's check can read: it refuses nothing
 * then, and the answer here is `unlisted`. Without `byProvider` (Claude Code's ids name no
 * provider) a model with no provider serves its own id, whole.
 */
export function served(id: string, models: readonly ListedModel[], byProvider: boolean): Served {
  const rows: [listed: string, bare: string | null][] = []; // each row that counts: its id, and its bare id (null: it has none)
  for (const { id: listed, provider } of models) {
    const prefix = provider === null || provider === "" ? null : `${provider}/`;
    const routed = prefix !== null && listed.startsWith(prefix) && listed.length > prefix.length;
    if (byProvider && prefix !== null && !routed) return { kind: "unlisted", ids: [] };
    if (byProvider && !routed) continue;
    rows.push([listed, routed ? listed.slice(prefix.length) : null]);
  }
  if (rows.length === 0) return { kind: "unlisted", ids: [] };
  if (id === "") return { kind: "none", ids: [] };
  if (rows.some(([listed]) => listed === id)) return { kind: "whole", ids: [id] };
  const ids = rows.filter(([, bare]) => bare === id).map(([listed]) => listed);
  return { kind: ids.length === 0 ? "none" : ids.length === 1 ? "once" : "several", ids };
}
