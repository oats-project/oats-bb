// Whether a RESTART may be sent with the model a person changed: ONE reading for the Restart
// dialog. Why it exists: the kernel's `session restart` stops the running session BEFORE the
// provider judges the model, so a restart whose model the provider then refuses leaves the agent
// stopped with nothing started. A refused start or spawn harms nothing; a refused restart does.
// So a changed model is sent only when bb's own list for the harness has been READ and serves
// that id exactly once. Everything else is held here, before any call.
// The same harm has a second door, held by the same reading: a harness that was CHANGED to one
// whose bb provider is not ready on this machine (not installed, not signed in): the provider
// refuses that launch too, after the stop.
// Pure: the field's text, whether the harness was changed, bb's list as it was read, and what bb
// says of the changed harness's provider.

/** bb's models for the harness the restart would run on: not read yet, or the ids it listed (none: bb gave no list, or an empty one). */
export type ListedModels = { status: "loading" } | { status: "ready"; ids: readonly string[] };

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
 * The listed ids that serve `id`: the id listed whole, and, for a BARE id (no "/"), every listed
 * `<provider>/<id>` that ends in it. An id that names a provider is served only whole: nothing is
 * guessed about a provider it did not name. A list of bare ids (a harness whose bb provider names
 * no providers) therefore serves an id only when it lists it whole.
 */
export function serving(id: string, ids: readonly string[]): string[] {
  if (id === "") return [];
  const bare = !id.includes("/");
  return [...new Set(ids)].filter((listed) => listed === id || (bare && listed.endsWith(`/${id}`)));
}

/**
 * `typed`: the Model field's text, trimmed ("" is the field as the dialog opens it: the agent's
 * own model, unchanged). `harnessChanged`: another harness than the agent's own was picked.
 * `listed`: bb's models for the harness the restart would run on. `harnessReady`: false when bb
 * says the provider of the harness that was picked is not ready; read only for a CHANGED harness
 * (the agent runs on its own), and anything bb did not say is not held.
 */
export function restartModel({ typed, harnessChanged, listed, harnessReady = true }: { typed: string; harnessChanged: boolean; listed: ListedModels; harnessReady?: boolean }): RestartModel {
  if (harnessChanged && !harnessReady) return { kind: "held", why: "harness-not-ready", serving: [] };
  if (typed === "") return harnessChanged ? { kind: "held", why: "required", serving: [] } : { kind: "armed", model: null };
  if (listed.status === "loading") return { kind: "reading" };
  const by = serving(typed, listed.ids);
  if (by.length === 1) return { kind: "armed", model: typed };
  return by.length === 0 ? { kind: "held", why: "not-found", serving: [] } : { kind: "held", why: "pick-provider", serving: by };
}
