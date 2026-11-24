// @vitest-environment jsdom
// app/spawn/models.ts: the harness choice and bb's model suggestions, as the New agent form and
// the Start and Restart dialogs read them.
import { afterEach, describe, expect, it } from "vitest";
import { waitFor } from "@testing-library/react";
import { renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { harnessLabel, KEEP_HARNESS, MODEL_DEFAULT, modelOptions, NO_SUGGESTIONS, resolvedLabel, SOUL_DEFAULT, useHarnesses, useModelSuggestions } from "../../app/spawn/models";
import { handlers, resetApp } from "../helpers/render";
import type { Contract, Handlers } from "../helpers/render";

afterEach(resetApp);

type Asked = { hostId?: string; providerId?: string; projectId?: string; preferCached?: boolean };
/** A place that offers the choice: it says what it read. */
function Probe({ harness }: { harness: string | null }) {
  const harnesses = useHarnesses();
  const models = useModelSuggestions(harness);
  return <output data-testid="read">{JSON.stringify({ harnesses: { status: harnesses.status, options: harnesses.options, choice: harnesses.choice, hostId: harnesses.hostId }, models })}</output>;
}
function probe(harness: string | null, over: Partial<Handlers> = {}, models: (asked: Asked) => unknown = () => ({ modelLoadError: null, models: [] })) {
  const asked: Asked[] = [];
  const slot = renderSlot<{ harness: string | null }, Contract>({ component: Probe }, { harness }, {
    rpc: handlers(over),
    sdk: { providers: { models: (async (args: Asked = {}) => (asked.push(args), models(args))) as never } },
  });
  const read = () => JSON.parse(slot.getByTestId("read").textContent!) as { harnesses: { status: string; options: { id: string; label: string }[]; choice: boolean; hostId: string | null }; models: { status: string; models: { id: string; label: string }[]; note: string | null } };
  return { slot, asked, read };
}
const bbModel = (model: string, displayName = model) => ({ id: model, model, displayName, description: "", isDefault: false, defaultReasoningEffort: "medium" });

describe("the harness choice", () => {
  it("offers what the provider declares, by the names a person knows", async () => {
    const { read } = probe(null);
    await waitFor(() => expect(read().harnesses.status).toBe("ready"));
    expect(read().harnesses).toEqual({ status: "ready", options: [{ id: "claude", label: "Claude Code" }, { id: "pi", label: "pi" }], choice: true, hostId: "host_falcon" });
  });

  it("with one harness, or none declared, there is nothing to choose", async () => {
    const one = probe(null, { spawnHarnesses: () => ({ harnesses: ["claude"], hostId: "host_falcon" }) });
    await waitFor(() => expect(one.read().harnesses.status).toBe("ready"));
    expect(one.read().harnesses.choice).toBe(false);
    resetApp();
    const none = probe(null, { spawnHarnesses: () => ({ harnesses: [], hostId: null }) });
    await waitFor(() => expect(none.read().harnesses.status).toBe("ready"));
    expect([none.read().harnesses.choice, none.read().harnesses.options]).toEqual([false, []]);
  });

  it("the words of the first entry, and of a harness", () => {
    expect([SOUL_DEFAULT, KEEP_HARNESS, MODEL_DEFAULT]).toEqual(["The soul's default", "Keep the recorded harness", "Default"]);
    expect([resolvedLabel(SOUL_DEFAULT, null), resolvedLabel(SOUL_DEFAULT, "pi"), resolvedLabel(SOUL_DEFAULT, "claude")]).toEqual(["The soul's default", "The soul's default: pi", "The soul's default: Claude Code"]);
    expect([harnessLabel("claude"), harnessLabel("pi"), harnessLabel("later")]).toEqual(["Claude Code", "pi", "later"]);
  });
});

describe("a harness's model suggestions", () => {
  it("are bb's own list for that harness's bb provider, on the machine that holds the deployment, asked without a project", async () => {
    const { read, asked } = probe("pi", {}, () => ({ modelLoadError: null, models: [bbModel("anthropic/claude-sonnet-5", "Claude Sonnet 5"), bbModel("openai/o3")] }));
    await waitFor(() => expect(read().models.status).toBe("ready"));
    expect(read().models).toEqual({ status: "ready", models: [{ id: "anthropic/claude-sonnet-5", label: "Claude Sonnet 5 · anthropic/claude-sonnet-5", provider: null }, { id: "openai/o3", label: "openai/o3", provider: null }], note: null });
    expect(asked).toEqual([{ hostId: "host_falcon", providerId: "pi", preferCached: true }]);
    expect(asked.every((args) => !("projectId" in args))).toBe(true);
  });

  it("Claude Code's are asked of bb's claude-code provider", async () => {
    const { read, asked } = probe("claude", {}, () => ({ modelLoadError: null, models: [bbModel("claude-opus-5")] }));
    await waitFor(() => expect(read().models.models).toHaveLength(1));
    expect(asked[0]).toMatchObject({ providerId: "claude-code" });
  });

  it("with none reported, a list bb could not give, a harness bb has no provider for, or no harness chosen: Default plus free text, and the page says so", async () => {
    const empty = probe("pi");
    await waitFor(() => expect(empty.read().models.status).toBe("ready"));
    expect(empty.read().models).toEqual({ status: "ready", models: [], note: NO_SUGGESTIONS });
    resetApp();
    const failed = probe("pi", {}, () => {
      throw new Error("bb could not list the models");
    });
    await waitFor(() => expect(failed.read().models.status).toBe("ready"));
    expect(failed.read().models.note).toBe("No model suggestions reported. Any model ID can be typed.");
    resetApp();
    const unknown = probe("codex");
    await waitFor(() => expect(unknown.read().harnesses.status).toBe("ready"));
    expect(unknown.read().models).toEqual({ status: "ready", models: [], note: NO_SUGGESTIONS });
    expect(unknown.asked).toEqual([]);
    resetApp();
    const nothing = probe(null);
    await waitFor(() => expect(nothing.read().harnesses.status).toBe("ready"));
    expect(nothing.read().models.models).toEqual([]);
    expect(nothing.asked).toEqual([]);
  });

  it("bb's answer as suggestions: each model once, none that could be read as an option, nothing from a shape that is not the list", () => {
    expect(modelOptions({ models: [bbModel("a"), bbModel("a", "Again"), bbModel("--model"), bbModel(""), { displayName: "no id" }, null, bbModel("b", "B")] })).toEqual([{ id: "a", label: "a", provider: null }, { id: "b", label: "B · b", provider: null }]);
    // Each model carries the provider bb routes it by, where bb names one (pi's `<provider>/<id>`).
    expect(modelOptions({ models: [{ model: "openrouter/openai/gpt-6", displayName: "GPT 6", routeProviderId: "openrouter" }, { model: "mine", routeProviderId: "" }, { model: "odd", routeProviderId: 7 }] })).toEqual([
      { id: "openrouter/openai/gpt-6", label: "GPT 6 · openrouter/openai/gpt-6", provider: "openrouter" },
      { id: "mine", label: "mine", provider: null },
      { id: "odd", label: "odd", provider: null },
    ]);
    expect(modelOptions(null)).toEqual([]);
    expect(modelOptions({ models: "x" })).toEqual([]);
  });
});
