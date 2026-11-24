// The one reading of "may this restart be sent with the model the person changed": the table.
// A restart whose model the provider refuses leaves a running agent stopped (the kernel stops the
// session first), so a changed model is armed only when bb's list, READ, serves it exactly once.
// WHICH listed models serve an id is the plugin's one function (model/served.ts), held against the
// provider's own check by test/model/served.contract.test.ts; this table is what the RESTART makes
// of its answer, and its own strictness: where the list cannot say, it holds.
import { describe, expect, test } from "vitest";
import { restartModel, type ListedModel } from "../../model/restart-model";

/** pi's models as bb lists them: `<provider>/<id>`, routed by that provider. */
const routed = (...ids: string[]): ListedModel[] => ids.map((id) => ({ id, provider: id.slice(0, id.indexOf("/")) }));
/** Models bb lists with no provider: Claude Code's bare ids; for pi, a model a person added to bb's own list. */
const unrouted = (...ids: string[]): ListedModel[] => ids.map((id) => ({ id, provider: null }));
const ready = (models: ListedModel[]) => ({ status: "ready" as const, models });
const loading = { status: "loading" as const };
const PI = routed("anthropic/claude-opus-5-5", "openrouter/claude-opus-5-5", "anthropic/claude-haiku-5", "openai/gpt-6", "openrouter/openai/gpt-6", "openrouter/meta/llama-9");
const CLAUDE = unrouted("claude-opus-5-5", "claude-haiku-5", "opus");
const held = (why: "required" | "not-found" | "pick-provider", by: string[] = []) => ({ kind: "held", why, serving: by });
/** A restart of an agent on pi, the harness unchanged. */
const pi = (typed: string, models: ListedModel[] | "loading" = PI) => restartModel({ typed, harnessChanged: false, byProvider: true, listed: models === "loading" ? loading : ready(models) });
const claude = (typed: string, models: ListedModel[] = CLAUDE) => restartModel({ typed, harnessChanged: false, byProvider: false, listed: ready(models) });

describe("a restart with the model unchanged is sent as today, whatever bb lists", () => {
  test.each([["a list", PI], ["an empty list", []], ["a list not read yet", "loading" as const]])("the field blank, the harness the agent's own, %s", (_, models) => {
    expect(pi("", models)).toEqual({ kind: "armed", model: null });
  });
});

describe("a changed model is armed only when bb's list, read, serves it exactly once", () => {
  test("listed whole", () => {
    expect(pi("anthropic/claude-opus-5-5")).toEqual({ kind: "armed", model: "anthropic/claude-opus-5-5" });
    expect(claude("claude-haiku-5")).toEqual({ kind: "armed", model: "claude-haiku-5" });
  });
  test("a bare id that exactly one listed <provider>/<id> is: sent as typed", () => {
    expect(pi("claude-haiku-5")).toEqual({ kind: "armed", model: "claude-haiku-5" });
  });
  test("a bare id is everything after the PROVIDER, and may itself hold a slash", () => {
    expect(pi("meta/llama-9")).toEqual({ kind: "armed", model: "meta/llama-9" }); // openrouter/meta/llama-9
    expect(pi("llama-9")).toEqual(held("not-found")); // no model's bare id: what an id ENDS in is not its id
    // "openai/gpt-6" is a model listed whole: that one, alone, though openrouter's bare id is the same.
    expect(pi("openai/gpt-6")).toEqual({ kind: "armed", model: "openai/gpt-6" });
    // "gpt-6" is openai's bare id and nobody else's (openrouter's is "openai/gpt-6").
    expect(pi("gpt-6")).toEqual({ kind: "armed", model: "gpt-6" });
  });
  test("a bare id that several providers serve: Pick provider, with those, whole", () => {
    expect(pi("claude-opus-5-5")).toEqual(held("pick-provider", ["anthropic/claude-opus-5-5", "openrouter/claude-opus-5-5"]));
    expect(pi("openai/gpt-7", routed("openrouter/openai/gpt-7", "requesty/openai/gpt-7"))).toEqual(held("pick-provider", ["openrouter/openai/gpt-7", "requesty/openai/gpt-7"]));
  });
  test("served by none: Not found; a part of an id is not the id", () => {
    expect(pi("claude-opus-9")).toEqual(held("not-found"));
    for (const near of ["claude", "opus-5-5", "Claude-Opus-5-5", "anthropic", "anthropic/", "/claude-opus-5-5", "5", "openrouter"]) expect(pi(near), near).toEqual(held("not-found"));
  });
  test("the list not read yet: nothing is sent, and nothing is said to be wrong", () => {
    expect(pi("anthropic/claude-opus-5-5", "loading")).toEqual({ kind: "reading" });
  });
  test("bb gives no list, or an empty one: it cannot be shown to start: Not found", () => {
    expect(pi("anthropic/claude-opus-5-5", [])).toEqual(held("not-found"));
  });
  test("a list without providers (Claude Code's bare ids) cannot place an id by provider: a changed model is armed only if listed whole", () => {
    expect(claude("opus")).toEqual({ kind: "armed", model: "opus" });
    expect(claude("anthropic/claude-opus-5-5")).toEqual(held("not-found"));
    expect(claude("sonnet")).toEqual(held("not-found"));
  });
  test("for pi, a model bb lists with no provider (one a person added to bb's own list) serves nothing: pi resolves among its own models only", () => {
    expect(pi("my-model", [...unrouted("my-model"), ...PI])).toEqual(held("not-found"));
    // A model whose id does not begin with its provider makes a list the provider's own check cannot read (it
    // refuses nothing then): the list cannot say, and a restart does not go without it. Not found, whatever else it lists.
    expect(pi("odd", [{ id: "odd", provider: "openai" }])).toEqual(held("not-found"));
    expect(pi("openai/", [{ id: "openai/", provider: "openai" }])).toEqual(held("not-found"));
    expect(pi("anthropic/claude-opus-5-5", [...PI, { id: "odd", provider: "openai" }])).toEqual(held("not-found"));
  });
  test("a list that names a model twice: its whole id is that model; its BARE id is served twice, as the provider counts rows", () => {
    expect(claude("opus", unrouted("opus", "opus"))).toEqual({ kind: "armed", model: "opus" });
    expect(pi("openai/gpt-6", routed("openai/gpt-6", "openai/gpt-6"))).toEqual({ kind: "armed", model: "openai/gpt-6" });
    // The provider refuses this ("served by openai and openai"), and so does bb's own resolution: held.
    // (KNOWINGLY APART in the app only: its reading of bb's list, app/spawn/models.ts modelOptions, keeps each id
    // once before the rule is asked, so the dialog would arm it. bb is not known to list a model twice.)
    expect(pi("gpt-6", routed("openai/gpt-6", "openai/gpt-6"))).toEqual(held("pick-provider", ["openai/gpt-6", "openai/gpt-6"]));
  });
});

describe("a harness that was changed", () => {
  test("with no model picked: Required, whatever bb lists", () => {
    for (const listed of [ready(PI), ready([]), loading]) expect(restartModel({ typed: "", harnessChanged: true, byProvider: true, listed })).toEqual(held("required"));
  });
  test("with a model: the same rule, on the list of the harness the restart would run on", () => {
    expect(restartModel({ typed: "openai/gpt-6", harnessChanged: true, byProvider: true, listed: ready(PI) })).toEqual({ kind: "armed", model: "openai/gpt-6" });
    expect(restartModel({ typed: "gpt-9", harnessChanged: true, byProvider: true, listed: ready(PI) })).toEqual(held("not-found"));
    expect(restartModel({ typed: "gpt-6", harnessChanged: true, byProvider: true, listed: loading })).toEqual({ kind: "reading" });
  });
});

// The cases on which this dialog's first rule and the provider's check differed (found by review): they are
// held against the provider's REAL check in test/model/served.contract.test.ts; here, what the Restart does.
describe("never armed where the provider's check would refuse", () => {
  test("the three a review ran against the provider's own file", () => {
    // A bare id that a listed id merely ENDS in: pi has no such model.
    expect(pi("gpt-6", routed("openrouter/openai/gpt-6", "anthropic/claude-haiku-5"))).toEqual(held("not-found"));
    // One provider's bare id, though another's id ends in it: that one model.
    expect(pi("gpt-6", routed("openai/gpt-6", "openrouter/openai/gpt-6"))).toEqual({ kind: "armed", model: "gpt-6" });
    // A bare id that holds a slash.
    expect(pi("openai/gpt-6", routed("openrouter/openai/gpt-6"))).toEqual({ kind: "armed", model: "openai/gpt-6" });
  });
});
