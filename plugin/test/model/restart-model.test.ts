// The one reading of "may this restart be sent with the model the person changed": the table.
// A restart whose model the provider refuses leaves a running agent stopped (the kernel stops the
// session first), so a changed model is armed only when bb's list, READ, serves it exactly once.
import { describe, expect, test } from "vitest";
import { restartModel, serving } from "../../model/restart-model";

const ready = (...ids: string[]) => ({ status: "ready" as const, ids });
const loading = { status: "loading" as const };
/** pi's list, as bb gives it: every id under a provider. */
const pi = ready("anthropic/claude-opus-5-5", "openrouter/claude-opus-5-5", "anthropic/claude-haiku-5", "openai/gpt-6", "openrouter/openai/gpt-6");
/** Claude Code's list: bare ids, no providers. */
const claude = ready("claude-opus-5-5", "claude-haiku-5", "opus");
const held = (why: "harness-not-ready" | "required" | "not-found" | "pick-provider", by: string[] = []) => ({ kind: "held", why, serving: by });

describe("a restart with the model unchanged is sent as today, whatever bb lists", () => {
  test.each([["a list", pi], ["an empty list", ready()], ["a list not read yet", loading]])("the field blank, the harness the agent's own, %s", (_, listed) => {
    expect(restartModel({ typed: "", harnessChanged: false, listed })).toEqual({ kind: "armed", model: null });
  });
});

describe("a changed model is armed only when bb's list, read, serves it exactly once", () => {
  test("listed whole", () => {
    expect(restartModel({ typed: "anthropic/claude-opus-5-5", harnessChanged: false, listed: pi })).toEqual({ kind: "armed", model: "anthropic/claude-opus-5-5" });
    expect(restartModel({ typed: "claude-haiku-5", harnessChanged: false, listed: claude })).toEqual({ kind: "armed", model: "claude-haiku-5" });
  });
  test("a bare id that exactly one listed <provider>/<id> ends in: sent as typed", () => {
    expect(restartModel({ typed: "claude-haiku-5", harnessChanged: false, listed: pi })).toEqual({ kind: "armed", model: "claude-haiku-5" });
  });
  test("a bare id that several listed models end in: Pick provider, with those, whole", () => {
    expect(restartModel({ typed: "claude-opus-5-5", harnessChanged: false, listed: pi })).toEqual(held("pick-provider", ["anthropic/claude-opus-5-5", "openrouter/claude-opus-5-5"]));
    // An id listed whole AND under a provider is served twice, too: nothing is guessed about which one the provider would take.
    expect(restartModel({ typed: "opus", harnessChanged: false, listed: ready("opus", "anthropic/opus") })).toEqual(held("pick-provider", ["opus", "anthropic/opus"]));
  });
  test("served by none: Not found", () => {
    expect(restartModel({ typed: "claude-opus-9", harnessChanged: false, listed: pi })).toEqual(held("not-found"));
    // A part of an id is not the id: no prefix, no middle, no other case, no id that merely ends in the same letters.
    for (const near of ["claude", "opus-5-5", "Claude-Opus-5-5", "anthropic", "anthropic/", "/claude-opus-5-5", "5"]) expect(restartModel({ typed: near, harnessChanged: false, listed: pi }), near).toEqual(held("not-found"));
  });
  test("an id that names a provider is served only whole: nothing is guessed about a provider it did not name", () => {
    // "openai/gpt-6" is listed whole (once); "openrouter/openai/gpt-6" ends in it and does not make it two.
    expect(restartModel({ typed: "openai/gpt-6", harnessChanged: false, listed: pi })).toEqual({ kind: "armed", model: "openai/gpt-6" });
    expect(restartModel({ typed: "openai/gpt-7", harnessChanged: false, listed: ready("openrouter/openai/gpt-7") })).toEqual(held("not-found"));
  });
  test("the list not read yet: nothing is sent, and nothing is said to be wrong", () => {
    expect(restartModel({ typed: "anthropic/claude-opus-5-5", harnessChanged: false, listed: loading })).toEqual({ kind: "reading" });
  });
  test("bb gives no list, or an empty one: it cannot be shown to start: Not found", () => {
    expect(restartModel({ typed: "anthropic/claude-opus-5-5", harnessChanged: false, listed: ready() })).toEqual(held("not-found"));
  });
  test("a list without providers (Claude Code's bare ids) cannot place an id by provider: a changed model is armed only if listed whole", () => {
    expect(restartModel({ typed: "opus", harnessChanged: false, listed: claude })).toEqual({ kind: "armed", model: "opus" });
    expect(restartModel({ typed: "anthropic/claude-opus-5-5", harnessChanged: false, listed: claude })).toEqual(held("not-found"));
    expect(restartModel({ typed: "sonnet", harnessChanged: false, listed: claude })).toEqual(held("not-found"));
  });
  test("a list that names an id twice serves it once", () => {
    expect(restartModel({ typed: "opus", harnessChanged: false, listed: ready("opus", "opus") })).toEqual({ kind: "armed", model: "opus" });
  });
});

describe("a harness that was changed", () => {
  test("with no model picked: Required, whatever bb lists", () => {
    for (const listed of [pi, ready(), loading]) expect(restartModel({ typed: "", harnessChanged: true, listed })).toEqual(held("required"));
  });
  test("with a model: the same rule, on the list of the harness the restart would run on", () => {
    expect(restartModel({ typed: "openai/gpt-6", harnessChanged: true, listed: pi })).toEqual({ kind: "armed", model: "openai/gpt-6" });
    expect(restartModel({ typed: "gpt-9", harnessChanged: true, listed: pi })).toEqual(held("not-found"));
    expect(restartModel({ typed: "gpt-6", harnessChanged: true, listed: loading })).toEqual({ kind: "reading" });
  });
});

describe("a harness changed to one whose bb provider is not ready (the same harm by another door)", () => {
  test("held whatever the model and the list: no model makes it start", () => {
    for (const typed of ["", "openai/gpt-6", "gpt-9"]) for (const listed of [pi, ready(), loading]) expect(restartModel({ typed, harnessChanged: true, listed, harnessReady: false }), typed).toEqual(held("harness-not-ready"));
  });
  test("never for the agent's own harness, left unchanged: it runs on it", () => {
    expect(restartModel({ typed: "", harnessChanged: false, listed: pi, harnessReady: false })).toEqual({ kind: "armed", model: null });
    expect(restartModel({ typed: "openai/gpt-6", harnessChanged: false, listed: pi, harnessReady: false })).toEqual({ kind: "armed", model: "openai/gpt-6" });
  });
  test("a changed harness bb says nothing against goes by the model's rule", () => {
    expect(restartModel({ typed: "openai/gpt-6", harnessChanged: true, listed: pi, harnessReady: true })).toEqual({ kind: "armed", model: "openai/gpt-6" });
    expect(restartModel({ typed: "", harnessChanged: true, listed: pi, harnessReady: true })).toEqual(held("required"));
  });
});

test("which listed ids serve an id: whole, or a bare id under a provider; in the list's order, each once", () => {
  expect(serving("gpt-6", ["openai/gpt-6", "x", "openrouter/openai/gpt-6", "openai/gpt-6"])).toEqual(["openai/gpt-6", "openrouter/openai/gpt-6"]);
  expect(serving("openai/gpt-6", ["openai/gpt-6", "openrouter/openai/gpt-6"])).toEqual(["openai/gpt-6"]);
  expect(serving("", ["a/", "b"])).toEqual([]);
});
