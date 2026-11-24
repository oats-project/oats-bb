// Whether a RESTART may be sent with the model a person changed: ONE reading for the Restart
// dialog. Why it exists: the kernel's `session restart` stops the running session BEFORE the
// provider judges the model, so a restart whose model the provider then refuses leaves the agent
// stopped with nothing started. A refused start or spawn harms nothing; a refused restart does.
// So a changed model is sent only when bb's own list for the harness has been READ and serves
// that id exactly once, BY THE PROVIDER'S OWN RULE: the plugin's one reading of "which listed
// models serve this id" (`served`, model/served.ts, held against the provider's own check by
// test/model/served.contract.test.ts), which the New agent form reads too. What is the Restart's
// own is the STRICTNESS: the form may let a launch go where the list cannot say; a restart may
// not. Everything that is not shown to start is held here, before any call.
// (A harness changed to one whose bb provider is not ready is NOT held here: the kernel runs the
// provider's readiness check BEFORE the stop and refuses with nothing stopped; recorded on OATS
// 0.70.5. The check is handed no model, which is why a bad model still stops first.)
// Pure: the field's text, whether the harness was changed, and bb's list as it was read.

import { served, type ListedModel } from "./served";

export type { ListedModel };
/** bb's models for the harness the restart would run on: not read yet, or what it listed (none: bb gave no list, or an empty one). */
export type ListedModels = { status: "loading" } | { status: "ready"; models: readonly ListedModel[] };

export type RestartModel =
  /** Send it: with the typed model, or with none (the field is blank and the harness is the agent's own: nothing was changed). */
  | { kind: "armed"; model: string | null }
  /** A model was typed and bb's list is not read yet: nothing is sent, and nothing is said to be wrong. */
  | { kind: "reading" }
  /**
   * Held. `required`: the harness was changed and no model picked (a start on bb's default for a
   * harness the soul never named can die at its start, after the stop). `not-found`: no listed
   * model serves the id (and where bb lists none, it cannot be shown to start). `pick-provider`:
   * several listed models serve the bare id; `serving` holds them, whole, for the field to offer.
   */
  | { kind: "held"; why: "required" | "not-found" | "pick-provider"; serving: string[] };

/**
 * `typed`: the Model field's text, trimmed ("" is the field as the dialog opens it: the agent's
 * own model, unchanged). `harnessChanged`: another harness than the agent's own was picked.
 * `listed`: bb's models for the harness the restart would run on. `byProvider`: that harness's
 * models are resolved by provider (pi).
 */
export function restartModel({ typed, harnessChanged, listed, byProvider }: { typed: string; harnessChanged: boolean; listed: ListedModels; byProvider: boolean }): RestartModel {
  if (typed === "") return harnessChanged ? { kind: "held", why: "required", serving: [] } : { kind: "armed", model: null };
  if (listed.status === "loading") return { kind: "reading" };
  const by = served(typed, listed.models, byProvider);
  // Shown to start: the model listed under exactly that id, or the one model whose bare id it is.
  if (by.kind === "whole" || by.kind === "once") return { kind: "armed", model: typed };
  if (by.kind === "several") return { kind: "held", why: "pick-provider", serving: by.ids };
  // No listed model serves it; or the list cannot say (it holds no model that counts: an empty list, or one the
  // provider's own check could not read): a restart does not go without the list.
  return { kind: "held", why: "not-found", serving: [] };
}
