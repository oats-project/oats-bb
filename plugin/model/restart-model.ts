// Whether a RESTART may be sent with the model a person changed: ONE reading for the Restart
// dialog. Why it exists: the kernel's `session restart` stops the running session BEFORE the
// provider judges the model, so a restart whose model the provider then refuses leaves the agent
// stopped with nothing started. A refused start or spawn harms nothing; a refused restart does.
// So a changed model is sent only when bb's own list for the harness has been READ and serves
// that id exactly once, BY THE PROVIDER'S OWN RULE (below). Everything else is held here, before
// any call.
// The same harm has a second door, held by the same reading: a harness that was CHANGED to one
// whose bb provider is not ready on this machine (not installed, not signed in): the provider
// refuses that launch too, after the stop.
// Pure: the field's text, whether the harness was changed, bb's list as it was read, and what bb
// says of the changed harness's provider.

/**
 * One model of bb's list: its id as bb lists it, and the provider bb routes it by
 * (`routeProviderId`; null: bb names none). For pi the id is `<provider>/<id>`.
 */
export type ListedModel = { id: string; provider: string | null };
/** bb's models for the harness the restart would run on: not read yet, or what it listed (none: bb gave no list, or an empty one). */
export type ListedModels = { status: "loading" } | { status: "ready"; models: readonly ListedModel[] };

export type RestartModel =
  /** Send it: with the typed model, or with none (the field is blank and the harness is the agent's own: nothing was changed). */
  | { kind: "armed"; model: string | null }
  /** A model was typed and bb's list is not read yet: nothing is sent, and nothing is said to be wrong. */
  | { kind: "reading" }
  /**
   * Held. `harness-not-ready`: the harness was changed to one bb cannot run here (said first: no
   * model makes it start). `required`: the harness was changed and no model picked. `not-found`:
   * no listed model serves the id (and where bb lists none, it cannot be shown to start).
   * `pick-provider`: several listed models serve the bare id; `serving` holds them, whole, for the
   * field to offer.
   */
  | { kind: "held"; why: "harness-not-ready" | "required" | "not-found" | "pick-provider"; serving: string[] };

/**
 * The listed models that serve `id`, as the bb session provider's own check resolves one
 * (oats-package/capabilities/oats-bb/lib/pi-model.mjs `piModelVerdict`, which is bb's own rule):
 * - the model listed under exactly that id is that model, alone;
 * - else every model whose BARE id is `id`: its id minus `<provider>/`, the provider being the one
 *   bb routes it by. A bare id may itself hold a slash (`openrouter/openai/gpt-6` is the provider
 *   `openrouter` and the bare id `openai/gpt-6`), so nothing is matched by what an id ends in.
 * Nothing is matched loosely: no prefix, no suffix, no other case. What is returned is one id per
 * ROW that serves it (a list that repeats a row repeats it here: two rows are two, for a bare id).
 * A model bb lists with NO provider (one a person added to bb's own list) has no bare id. For a
 * harness whose models are resolved by provider (`byProvider`: pi) the provider's check does not
 * count it at all, so it serves nothing here either; for any other harness (Claude Code's bare
 * ids) it serves its own id, whole.
 */
export function serving(id: string, models: readonly ListedModel[], byProvider: boolean): string[] {
  if (id === "") return [];
  const rows: { id: string; bare: string | null }[] = [];
  for (const { id: listed, provider } of models) {
    const prefix = provider === null || provider === "" ? null : `${provider}/`;
    const routed = prefix !== null && listed.startsWith(prefix) && listed.length > prefix.length;
    if (byProvider && !routed) continue;
    rows.push({ id: listed, bare: routed ? listed.slice(prefix.length) : null });
  }
  if (rows.some((row) => row.id === id)) return [id];
  // ROWS are counted, as the provider counts them (and bb's own resolution: "Ambiguous"): a list that names one
  // `<provider>/<id>` twice serves its bare id twice. (bb is not known to list one twice, and the app's reading of
  // the list, app/spawn/models.ts `modelOptions`, keeps each id once before this is asked: said in the table.)
  return rows.filter((row) => row.bare === id).map((row) => row.id);
}

/**
 * `typed`: the Model field's text, trimmed ("" is the field as the dialog opens it: the agent's
 * own model, unchanged). `harnessChanged`: another harness than the agent's own was picked.
 * `listed`: bb's models for the harness the restart would run on. `byProvider`: that harness's
 * models are resolved by provider (pi). `harnessReady`: false when bb says the provider of the
 * harness that was picked is not ready; read only for a CHANGED harness (the agent runs on its
 * own), and anything bb did not say is not held.
 */
export function restartModel({ typed, harnessChanged, listed, byProvider, harnessReady = true }: { typed: string; harnessChanged: boolean; listed: ListedModels; byProvider: boolean; harnessReady?: boolean }): RestartModel {
  if (harnessChanged && !harnessReady) return { kind: "held", why: "harness-not-ready", serving: [] };
  if (typed === "") return harnessChanged ? { kind: "held", why: "required", serving: [] } : { kind: "armed", model: null };
  if (listed.status === "loading") return { kind: "reading" };
  const by = serving(typed, listed.models, byProvider);
  if (by.length === 1) return { kind: "armed", model: typed };
  return by.length === 0 ? { kind: "held", why: "not-found", serving: [] } : { kind: "held", why: "pick-provider", serving: by };
}
