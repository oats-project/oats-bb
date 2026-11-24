// @vitest-environment jsdom
// The New agent form (app/spawn/Page.tsx), a page of its own: the fields in the Desktop's order
// and words, the standing "What will be created" column from the kernel's preview, Spawn with its
// reason when it is off, a refusal in a person's words, the held state, the keys.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, expect, test, vi } from "vitest";
import { act, fireEvent, waitFor } from "@testing-library/react";
import { renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { notified } from "../../app/ui";
import { UNCONFIRMED_ISSUE } from "../../contract/shared";
import { openNewAgent } from "../../app/workspace/pages";
import { formFacts } from "../../model/spawn";
import { agentName } from "../../app/ui/words";
import { fixtureAgents } from "../helpers/fixtures";
import { handlers, loadApp, resetApp, sidebarThreads } from "../helpers/render";
import type { Contract, Handlers } from "../helpers/render";

afterEach(resetApp);

const recorded = (JSON.parse(readFileSync(join(process.cwd(), "test/fixtures/spawn/spawn-preview.json"), "utf8")) as { result: Record<string, unknown> }).result;
const REVISION = "f48a98cea8a3a34508aab024";
type Choices = { soul: string; name?: string; task: string; harness?: string; model?: string; relation?: { kind: string; to: string } };
/** The server's answer for a preview: the recorded preview's facts, for the name asked. */
const answer = (input: Choices) => ({ facts: formFacts(recorded, { name: input.name ?? null }), revision: REVISION });
const previews = (over: Partial<Handlers> = {}): Partial<Handlers> => ({ spawnPlan: (input) => answer(input), ...over });

type Options = { settings?: Record<string, string>; models?: () => unknown; /** bb's own state of its providers; with none given bb does not say */ states?: () => unknown };
async function form(subPath: string, over: Partial<Handlers> = previews(), options: Options = {}) {
  const app = await loadApp();
  const panel = app.navPanels.find((candidate) => candidate.id === "new-agent")!;
  return renderSlot<{ subPath: string }, Contract>(panel, { subPath }, {
    rpc: handlers(over),
    sidebarThreads: sidebarThreads(),
    ...(options.settings === undefined ? {} : { settings: options.settings }),
    sdk: {
      providers: { models: (async () => (options.models ?? (() => ({ modelLoadError: null, models: [] })))()) as never },
      system: { providerStates: (async () => (options.states === undefined ? Promise.reject(new Error("bb did not say")) : options.states())) as never } as never,
    },
  });
}
type Slot = Awaited<ReturnType<typeof form>>;
const calls = (slot: Slot, method: string) => slot.inspection.rpcCalls.filter((call) => call.method === method).map((call) => call.input as Record<string, unknown>);
const set = (slot: Slot, testId: string, value: string) => fireEvent.change(slot.getByTestId(testId), { target: { value } });
/** Opens a choice and answers its options as a person reads them: [label, detail]. */
function options(slot: Slot, testId: string): (string | null)[][] {
  fireEvent.click(slot.getByTestId(testId));
  const read = slot.getAllByTestId(`${testId}-option`).map((option) => [option.querySelector("span")!.textContent, option.querySelectorAll("span")[1]?.textContent ?? null]);
  fireEvent.keyDown(slot.getByTestId(`${testId}-options`), { key: "Escape" });
  return read;
}
/** Picks an option of a choice by its value, with a click, as a person does. */
function choose(slot: Slot, testId: string, value: string) {
  fireEvent.click(slot.getByTestId(testId));
  fireEvent.click(slot.getAllByTestId(`${testId}-option`).find((option) => option.getAttribute("data-value") === value)!);
}
const valueOf = (slot: Slot, testId: string) => slot.getByTestId(testId).getAttribute("data-value");
const submit = (slot: Slot) => slot.getByTestId("oats-spawn-submit") as HTMLButtonElement;
const fieldset = (slot: Slot) => slot.getByTestId("oats-spawn-form").querySelector("fieldset") as HTMLFieldSetElement;
const reason = (slot: Slot) => slot.queryByTestId("oats-disabled-reason")?.textContent ?? null;
const column = (slot: Slot) => slot.getByTestId("oats-spawn-preview");
/** The form with a soul chosen, once its first preview is on screen. */
async function ready(over: Partial<Handlers> = previews(), options: Options = {}, settled = true) {
  const slot = await form("oats-developer", over, options);
  await waitFor(() => expect(column(slot).textContent).toContain("numbered by the kernel"));
  // And bb's list of models for the harness has answered: until then Spawn is off ("Reading defaults…").
  if (settled) await waitFor(() => expect(reason(slot)).not.toBe("Reading defaults…"));
  return slot;
}

test("the page is registered whatever pages are shown, out of bb's own navigation, and New agent opens it, with a soul or with none", async () => {
  const app = await loadApp();
  const panel = app.navPanels.find((candidate) => candidate.id === "new-agent")!;
  expect([panel.path, panel.title, panel.experimental_hideFromNavigation]).toEqual(["new-agent", "New agent", true]);
  // Under the release's default pages (home alone) the form is still there: it is not a page a release leaves out.
  const slot = await form("", previews(), { settings: { pages: "home" } });
  expect(await slot.findByTestId("oats-spawn-form")).toBeTruthy();
  expect(slot.queryByTestId("oats-page-not-shown")).toBeNull();
  // What the sidebar, the home and a soul's page call (app/workspace/pages.ts), with the Souls page not shown.
  const went: unknown[] = [];
  const navigate = { toPluginPanel: (path: string, options?: unknown) => went.push([path, options]) } as never;
  expect([openNewAgent(navigate, false), openNewAgent(navigate, false, { soul: "oats.okf/knowledge-harvester" })]).toEqual([true, true]);
  expect(went).toEqual([["new-agent", undefined], ["new-agent", { subPath: "oats.okf/knowledge-harvester" }]]);
});

test("opened with no soul: the soul is the first field and holds the focus, nothing is asked of the kernel, and Spawn says why it is off", async () => {
  const slot = await form("");
  const soul = await slot.findByTestId("oats-spawn-soul");
  await waitFor(() => expect((soul as HTMLButtonElement).disabled).toBe(false));
  expect(soul.textContent).toBe("Choose a soul…▾");
  // The souls OATS lists, each with its description; one that cannot be spawned says so.
  expect(options(slot, "oats-spawn-soul")).toEqual([["oats-developer", "Builds and proves one spec."], ["broken-soul", "This soul can’t be spawned."]]);
  expect(slot.getByTestId("oats-spawn-title").textContent).toBe("New agent");
  // The fields, in the Desktop's order after the soul, by their labels.
  expect(Array.from(slot.getByTestId("oats-spawn-form").querySelectorAll("label, #oats-spawn-relation-label")).map((label) => label.textContent)).toEqual(["Soul", "Opening instruction · optional", "Harness", "Model", "Relationship", "Name · optional"]);
  expect(slot.getByTestId("oats-spawn-form").querySelector("button, select, textarea, input")).toBe(soul);
  await waitFor(() => expect(document.activeElement).toBe(soul));
  expect(submit(slot).disabled).toBe(true);
  expect(submit(slot).textContent).toBe("Spawn");
  expect(reason(slot)).toBe("Choose a soul first.");
  expect(column(slot).textContent).toBe("What will be createdChoose a soul to see what will be created.");
  expect(calls(slot, "spawnPlan")).toEqual([]);
  // Choosing one names the page as the Desktop names its dialog, says the soul's description, and reads the preview.
  choose(slot, "oats-spawn-soul", "oats-developer");
  expect(document.activeElement).toBe(soul); // the focus is back on the field
  expect(slot.getByTestId("oats-spawn-title").textContent).toBe("Spawn oats-developer in oats");
  expect(slot.getByTestId("oats-spawn-form").textContent).toContain("Builds and proves one spec.");
  await waitFor(() => expect(calls(slot, "spawnPlan")).toEqual([{ soul: "oats-developer", task: "" }]));
});

test("opened from a soul: that soul is chosen, the focus is on the instruction, and an empty form can be spawned: no name, no instruction", async () => {
  const slot = await ready();
  expect(valueOf(slot, "oats-spawn-soul")).toBe("oats-developer");
  expect(document.activeElement).toBe(slot.getByTestId("oats-spawn-task"));
  expect((slot.getByTestId("oats-spawn-task") as HTMLTextAreaElement).placeholder).toBe("What should this instance do? Empty starts it waiting for you.");
  expect(calls(slot, "spawnPlan")).toEqual([{ soul: "oats-developer", task: "" }]);
  expect(slot.getByTestId("oats-spawn-form").textContent).toContain("Left empty, the kernel numbers it.");
  // The one line about the mode: words, no control.
  const mode = slot.getByTestId("oats-spawn-mode");
  expect(mode.textContent).toBe("Runs in bb's full mode: no sandbox.");
  expect(mode.querySelector("input, button, select, textarea, a")).toBeNull();
  expect(submit(slot).disabled).toBe(false);
  expect(reason(slot)).toBeNull();
});

test("What will be created: the name and the home, where it works, the harness and the model with where they came from, the team, the capabilities; no warning the kernel did not give", async () => {
  const quiet = { ...recorded, warnings: [] };
  const slot = await ready({ spawnPlan: (input) => ({ facts: formFacts(quiet, { name: input.name ?? null }), revision: REVISION }) });
  const facts = Array.from(column(slot).querySelectorAll('[data-testid="oats-fact"]')).map((fact) => [fact.querySelector("dt")!.textContent, fact.querySelector("dd")!.textContent]);
  expect(facts).toEqual([
    ["Name", "numbered by the kernel"],
    ["Home", "agents/oats-developer/instances/flaky-ci-2-developer"],
    ["Soul", "oats-developer"],
    ["Works in", "worktree · branch agents/flaky-ci-2-developer from github.com/awebai/oats"],
    ["Runs on", "falcon"],
    ["Harness", "pi · github-copilot/claude-fable-5.1this computer's default for every soul"],
    ["Session", "bb thread"],
    ["Access", "full mode: no sandbox"],
    ["Team", "oats · default"],
    ["Knowledge", "none"],
    ["Messaging", "oats.awebpackage oats.aweb 1.43.0 · Workspace default"],
    ["Tasks", "none"],
  ]);
  expect(Array.from(column(slot).querySelectorAll('[data-testid="oats-spawn-caps"] li > span:first-child')).map((item) => item.textContent)).toEqual(["oats.build", "oats.core", "oats.developer", "oats.landing-rules"]);
  expect(column(slot).textContent).toContain("Resolved by the installed CLI. Spawn refuses if this changes before you confirm.");
  expect(column(slot).querySelector('[data-testid="oats-notice"]')).toBeNull();
  // A typed name is the name it shows, and is what the preview is asked with.
  set(slot, "oats-spawn-name", "Ranker-V4-probe");
  expect(slot.getByTestId("oats-spawn-form").textContent).toContain("Instance name: ranker-v4-probe");
  await waitFor(() => expect(column(slot).querySelector("dd")!.textContent).toBe("ranker-v4-probe"));
  expect(calls(slot, "spawnPlan").at(-1)).toEqual({ soul: "oats-developer", task: "", name: "ranker-v4-probe" });
});

test("a warning of the kernel's is drawn as a warning, through the display filter", async () => {
  const warned = { ...recorded, warnings: ["the bb server runs bb-app 0.60.0; the capability was tested up to 0.50.1", "the hook printed token: abc123"] };
  const slot = await form("oats-developer", { spawnPlan: () => ({ facts: formFacts(warned), revision: REVISION }) });
  await waitFor(() => expect(column(slot).querySelectorAll('[data-testid="oats-notice"][data-tone="warning"]')).toHaveLength(2));
  const notices = Array.from(column(slot).querySelectorAll('[data-testid="oats-notice"]')).map((notice) => notice.textContent);
  expect(notices).toEqual(["OATS warnsthe bb server runs bb-app 0.60.0; the capability was tested up to 0.50.1", "OATS warns[withheld]"]);
});

test("the harness: the soul's default passes nothing and says what the kernel resolved; a listed one is passed; with one harness there is no field", async () => {
  const slot = await ready();
  expect(slot.getByTestId("oats-spawn-harness").textContent).toBe("The soul's default: pi▾");
  expect(options(slot, "oats-spawn-harness")).toEqual([["The soul's default: pi", "What this soul launches with unless you choose"], ["Claude Code", null], ["pi", null]]);
  choose(slot, "oats-spawn-harness", "claude");
  expect(slot.getByTestId("oats-spawn-harness").textContent).toBe("Claude Code▾");
  await waitFor(() => expect(calls(slot, "spawnPlan").at(-1)).toEqual({ soul: "oats-developer", task: "", harness: "claude" }));
  slot.unmount();
  resetApp();
  const one = await ready(previews({ spawnHarnesses: () => ({ harnesses: ["claude"], hostId: "host_falcon" }) }));
  expect(one.queryByTestId("oats-spawn-harness")).toBeNull();
  expect(calls(one, "spawnPlan")).toEqual([{ soul: "oats-developer", task: "" }]);
});

test("while the provider's harnesses are read the field is in its place, off and saying so: nothing jumps when the list arrives", async () => {
  let arrive: (value: { harnesses: string[]; hostId: string | null }) => void = () => undefined;
  const slot = await form("oats-developer", previews({ spawnHarnesses: () => new Promise((resolve) => (arrive = resolve)) }));
  const harness = (await slot.findByTestId("oats-spawn-harness")) as HTMLButtonElement;
  expect([harness.disabled, harness.textContent]).toEqual([true, "Reading the harnesses…▾"]);
  await act(async () => arrive({ harnesses: ["claude", "pi"], hostId: "host_falcon" }));
  await waitFor(() => expect((slot.getByTestId("oats-spawn-harness") as HTMLButtonElement).disabled).toBe(false));
  expect(slot.getByTestId("oats-spawn-harness").textContent).toMatch(/^The soul's default/);
});

test("the model: Default says what the kernel resolved and passes nothing; a suggestion of bb's or a typed id is passed", async () => {
  const bbModel = (model: string, displayName = model) => ({ id: model, model, displayName, description: "", isDefault: false, defaultReasoningEffort: "medium" });
  // (bb serves the soul's own model and the one typed below: a model bb does not serve is held, in the tests after this one.)
  const slot = await ready(previews(), { models: () => ({ modelLoadError: null, models: [bbModel("anthropic/claude-sonnet-5", "Claude Sonnet 5"), bbModel("github-copilot/claude-fable-5.1"), bbModel("openai/o3")] }) });
  await waitFor(() => expect(options(slot, "oats-spawn-model")).toEqual([["Default · github-copilot/claude-fable-5.1", null], ["Claude Sonnet 5 · anthropic/claude-sonnet-5", null], ["github-copilot/claude-fable-5.1", null], ["openai/o3", null], ["Custom…", "Type a model ID"]]));
  choose(slot, "oats-spawn-model", "anthropic/claude-sonnet-5");
  await waitFor(() => expect(calls(slot, "spawnPlan").at(-1)).toEqual({ soul: "oats-developer", task: "", model: "anthropic/claude-sonnet-5" }));
  // Custom…: a field for the id; until one is typed Spawn is off and says why.
  choose(slot, "oats-spawn-model", "__custom__");
  const typed = slot.getByTestId("oats-spawn-model-id") as HTMLInputElement;
  expect(typed.placeholder).toBe("Type a model ID");
  expect([submit(slot).disabled, reason(slot)]).toEqual([true, "Type the model ID, or choose Default."]);
  fireEvent.change(typed, { target: { value: " openai/o3 " } });
  await waitFor(() => expect(calls(slot, "spawnPlan").at(-1)).toEqual({ soul: "oats-developer", task: "", model: "openai/o3" }));
  expect(submit(slot).disabled).toBe(false);
});

test("a harness the kernel resolved no model for: the preview and the model field say bb starts it on its own default, and to choose one; Spawn is not held", async () => {
  const unset = { ...recorded, harness: "pi", model: null, modelSource: null };
  const slot = await ready({ spawnPlan: (input) => ({ facts: formFacts(input.model === undefined ? unset : { ...recorded, model: input.model }, { name: input.name ?? null }), revision: REVISION }) });
  const harnessRow = () => Array.from(column(slot).querySelectorAll('[data-testid="oats-fact"]')).find((fact) => fact.querySelector("dt")!.textContent === "Harness")!.querySelector("dd")!.textContent;
  expect(harnessRow()).toMatch(/^pi · bb’s default for pi/);
  expect(slot.getByTestId("oats-spawn-model").textContent).toBe("Default · bb’s default for pi▾");
  expect(slot.getByTestId("oats-spawn-form").textContent).toContain("No model is set for pi here, so bb starts it on its own default. Choose one to decide it.");
  expect([submit(slot).disabled, reason(slot)]).toEqual([false, null]);
  // A model chosen is the model said, and the line goes.
  choose(slot, "oats-spawn-model", "__custom__");
  set(slot, "oats-spawn-model-id", "anthropic/claude-sonnet-5");
  await waitFor(() => expect(harnessRow()).toMatch(/^pi · anthropic\/claude-sonnet-5/));
  expect(slot.getByTestId("oats-spawn-form").textContent).not.toContain("No model is set for pi here");
});

test("a harness the person chose, for which the kernel resolves no model: Spawn is held until one is picked, the field marked with one word, and no default promised", async () => {
  const unset = { ...recorded, harness: "claude", model: null, modelSource: null };
  // The preview of the values on screen: the soul's own launch (pi, its model) until a harness is chosen; then that harness, with the model picked or none.
  const slot = await ready({ spawnPlan: (input) => ({ facts: formFacts(input.harness === undefined ? recorded : input.model === undefined ? unset : { ...unset, model: input.model }, { name: input.name ?? null }), revision: REVISION }) });
  const harnessRow = () => Array.from(column(slot).querySelectorAll('[data-testid="oats-fact"]')).find((fact) => fact.querySelector("dt")!.textContent === "Harness")!.querySelector("dd")!.textContent;
  const modelError = () => slot.getByTestId("oats-spawn-model").closest('[data-testid="oats-field"]')!.querySelector('[role="alert"]')?.textContent ?? null;
  expect([submit(slot).disabled, reason(slot), modelError()]).toEqual([false, null, null]);
  choose(slot, "oats-spawn-harness", "claude");
  await waitFor(() => expect(harnessRow()).toMatch(/^Claude Code(?! ·)/));
  // Held, with the one word, on the field and beside the button; nothing says bb's default, in the column, the field or its list.
  await waitFor(() => expect([submit(slot).disabled, reason(slot), modelError()]).toEqual([true, "Required", "Required"]));
  expect(slot.getByTestId("oats-spawn-model").getAttribute("aria-invalid")).toBe("true");
  expect(slot.getByTestId("oats-spawn-form").textContent).not.toMatch(/bb’s default|No model is set|harness’s own|harness's own/);
  // The field itself promises nothing: its first entry is "Default" alone.
  expect(slot.getByTestId("oats-spawn-model").textContent).toBe("Default▾");
  fireEvent.click(submit(slot));
  expect(calls(slot, "spawn")).toHaveLength(0);
  // Another field changed: while its preview is read, the mark stays and the column still promises no default.
  set(slot, "oats-spawn-task", "do it");
  expect([submit(slot).disabled, reason(slot), modelError()]).toEqual([true, "Reading defaults…", "Required"]);
  expect(harnessRow()).toMatch(/^Claude Code(?! ·)/);
  expect(slot.getByTestId("oats-spawn-form").textContent).not.toMatch(/bb’s default/);
  await waitFor(() => expect(calls(slot, "spawnPlan").at(-1)).toEqual({ soul: "oats-developer", task: "do it", harness: "claude" }));
  await waitFor(() => expect([submit(slot).disabled, reason(slot), modelError()]).toEqual([true, "Required", "Required"]));
  // A model picked: armed, and the mark goes.
  choose(slot, "oats-spawn-model", "__custom__");
  set(slot, "oats-spawn-model-id", "claude-opus-5-5");
  await waitFor(() => expect(harnessRow()).toMatch(/^Claude Code · claude-opus-5-5/));
  await waitFor(() => expect([submit(slot).disabled, reason(slot), modelError()]).toEqual([false, null, null]));
});

test("the soul's own harness picked in the form, with no model declared, is still the soul's decision: not held, on bb's default", async () => {
  // The soul's own harness is pi and it declares no model: the same preview with pi chosen or not.
  const unset = { ...recorded, harness: "pi", model: null, modelSource: null };
  const slot = await ready({ spawnPlan: (input) => ({ facts: formFacts(input.model === undefined ? unset : { ...unset, model: input.model }, { name: input.name ?? null }), revision: REVISION }) });
  const harnessRow = () => Array.from(column(slot).querySelectorAll('[data-testid="oats-fact"]')).find((fact) => fact.querySelector("dt")!.textContent === "Harness")!.querySelector("dd")!.textContent;
  await waitFor(() => expect([submit(slot).disabled, reason(slot)]).toEqual([false, null]));
  choose(slot, "oats-spawn-harness", "pi");
  await waitFor(() => expect(calls(slot, "spawnPlan").at(-1)).toEqual({ soul: "oats-developer", task: "", harness: "pi" }));
  await waitFor(() => expect([submit(slot).disabled, reason(slot)]).toEqual([false, null]));
  expect(harnessRow()).toMatch(/^pi · bb’s default for pi/);
});

test("the same values arm or hold Spawn whatever the order of the clicks: a harness picked before the soul is read against the soul's own, asked once", async () => {
  // The soul's own harness is pi and it declares no model.
  const unset = { ...recorded, harness: "pi", model: null, modelSource: null };
  const claude = { ...recorded, harness: "claude", model: null, modelSource: null };
  const slot = await form("", { spawnPlan: (input) => ({ facts: formFacts(input.harness === "claude" ? claude : unset, { name: input.name ?? null }), revision: REVISION }) });
  await waitFor(() => expect((slot.getByTestId("oats-spawn-soul") as HTMLButtonElement).disabled).toBe(false));
  const modelError = () => slot.getByTestId("oats-spawn-model").closest('[data-testid="oats-field"]')!.querySelector('[role="alert"]')?.textContent ?? null;
  // The soul's own harness, picked first: no preview without a harness is ever asked for the values on screen.
  choose(slot, "oats-spawn-harness", "pi");
  choose(slot, "oats-spawn-soul", "oats-developer");
  await waitFor(() => expect([submit(slot).disabled, reason(slot), modelError()]).toEqual([false, null, null]));
  // The form asked the kernel for the soul's own harness once, beside the preview of the values on screen.
  expect(calls(slot, "spawnPlan").filter((call) => call.harness === undefined)).toEqual([{ soul: "oats-developer", task: "" }]);
  // Another harness, not the soul's own: held, and "Required" is said only once the answer is there.
  choose(slot, "oats-spawn-harness", "claude");
  await waitFor(() => expect([submit(slot).disabled, reason(slot), modelError()]).toEqual([true, "Required", "Required"]));
  expect(calls(slot, "spawnPlan").filter((call) => call.harness === undefined)).toHaveLength(1);
});

test("a list of models bb never gives does not hold the form: after 10 seconds it reads as not read and Spawn goes on the kernel's answer; a list that answers later is read by the rule", async () => {
  const bbModel = (model: string) => ({ id: model, model, displayName: model, description: "", isDefault: false, defaultReasoningEffort: "medium" });
  let answer: (list: unknown) => void = () => undefined;
  const pending = new Promise((resolve) => {
    answer = resolve;
  });
  vi.useFakeTimers({ shouldAdvanceTime: true });
  try {
    const slot = await ready({ spawnPlan: (input) => ({ facts: formFacts({ ...recorded, model: input.model ?? "claude-fable-5.1" }, { name: input.name ?? null }), revision: REVISION }) }, { models: () => pending }, false);
    await waitFor(() => expect([submit(slot).disabled, reason(slot)]).toEqual([true, "Reading defaults…"]));
    // Short of the ten seconds: still read.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(8_000);
    });
    expect([submit(slot).disabled, reason(slot)]).toEqual([true, "Reading defaults…"]);
    // Past them: not read, and the kernel's answer stands.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_100);
    });
    expect([submit(slot).disabled, reason(slot)]).toEqual([false, null]);
    // The list answers after all, and two providers serve the soul's bare model: held by the rule.
    await act(async () => {
      answer({ modelLoadError: null, models: ["github-copilot/claude-fable-5.1", "anthropic/claude-fable-5.1"].map((model) => ({ ...bbModel(model), routeProviderId: model.slice(0, model.indexOf("/")) })) });
    });
    await waitFor(() => expect([submit(slot).disabled, reason(slot)]).toEqual([true, "Pick provider"]));
  } finally {
    vi.useRealTimers();
  }
});

test("the soul's own harness asked and not answered is not an answer: held meanwhile, and asked again when the form's values change", async () => {
  // The soul's own harness is pi and it declares no model; the kernel fails once on the soul asked alone.
  const unset = { ...recorded, harness: "pi", model: null, modelSource: null };
  let fail = true;
  const slot = await form("", {
    spawnPlan: (input) => {
      if (input.harness === undefined && fail) throw new Error("OATS_TIMEOUT: oats did not answer in time");
      return { facts: formFacts(unset, { name: input.name ?? null }), revision: REVISION };
    },
  });
  await waitFor(() => expect((slot.getByTestId("oats-spawn-soul") as HTMLButtonElement).disabled).toBe(false));
  choose(slot, "oats-spawn-harness", "pi");
  choose(slot, "oats-spawn-soul", "oats-developer");
  // Not known: a chosen harness is held for a model.
  await waitFor(() => expect([submit(slot).disabled, reason(slot)]).toEqual([true, "Required"]));
  expect(calls(slot, "spawnPlan").filter((call) => call.harness === undefined)).toHaveLength(1);
  // The values change: asked again, answered, and the soul's own harness is not held.
  fail = false;
  set(slot, "oats-spawn-task", "do it");
  await waitFor(() => expect([submit(slot).disabled, reason(slot)]).toEqual([false, null]));
  expect(calls(slot, "spawnPlan").filter((call) => call.harness === undefined)).toHaveLength(2);
});

test("while bb's list of models for the harness is being read, Spawn is off with the form's own \"Reading defaults…\": whether bb serves the model is not known yet", async () => {
  let answer: (list: unknown) => void = () => undefined;
  const pending = new Promise((resolve) => {
    answer = resolve;
  });
  const slot = await ready(previews(), { models: () => pending }, false);
  await waitFor(() => expect([submit(slot).disabled, reason(slot)]).toEqual([true, "Reading defaults…"]));
  fireEvent.click(submit(slot));
  expect(calls(slot, "spawn")).toHaveLength(0);
  await act(async () => {
    answer({ modelLoadError: null, models: [] });
  });
  await waitFor(() => expect([submit(slot).disabled, reason(slot)]).toEqual([false, null]));
});

test("a bare model that several of bb's listed models serve: pick the provider, in two words, with exactly those offered; a model nobody lists is armed: the provider judges it", async () => {
  const bbModel = (model: string) => ({ id: model, model, displayName: model, description: "", isDefault: false, defaultReasoningEffort: "medium", routeProviderId: model.slice(0, model.indexOf("/")) });
  const LISTED = ["github-copilot/claude-fable-5.1", "anthropic/claude-fable-5.1", "openai/sol-5"];
  // The soul's own model as the preview resolves it; a model picked replaces it.
  const slot = await ready({ spawnPlan: (input) => ({ facts: formFacts({ ...recorded, model: input.model ?? "claude-fable-5.1" }, { name: input.name ?? null }), revision: REVISION }) }, { models: () => ({ modelLoadError: null, models: LISTED.map(bbModel) }) });
  const modelError = () => slot.getByTestId("oats-spawn-model").closest('[data-testid="oats-field"]')!.querySelector('[role="alert"]')?.textContent ?? null;
  // The soul's bare model is served by two providers: held, and the two are what is offered.
  await waitFor(() => expect([submit(slot).disabled, reason(slot), modelError()]).toEqual([true, "Pick provider", "Pick provider"]));
  expect(options(slot, "oats-spawn-model").map(([label]) => label)).toEqual(["Default · claude-fable-5.1", "github-copilot/claude-fable-5.1", "anthropic/claude-fable-5.1", "Custom…"]);
  fireEvent.click(submit(slot));
  expect(calls(slot, "spawn")).toHaveLength(0);
  // Another field changed, on the soul's default harness: the mark stays while its preview is read.
  set(slot, "oats-spawn-task", "do it");
  expect([submit(slot).disabled, reason(slot), modelError()]).toEqual([true, "Reading defaults…", "Pick provider"]);
  await waitFor(() => expect([submit(slot).disabled, reason(slot), modelError()]).toEqual([true, "Pick provider", "Pick provider"]));
  // One of them picked: armed.
  choose(slot, "oats-spawn-model", "anthropic/claude-fable-5.1");
  await waitFor(() => expect([submit(slot).disabled, reason(slot), modelError()]).toEqual([false, null, null]));
  // An id no listed model serves, typed: ARMED. Whether pi has it is the provider's to say, at the launch.
  choose(slot, "oats-spawn-model", "__custom__");
  set(slot, "oats-spawn-model-id", "mistral-large");
  await waitFor(() => expect(calls(slot, "spawnPlan").at(-1)).toEqual({ soul: "oats-developer", task: "do it", model: "mistral-large" }));
  await waitFor(() => expect([submit(slot).disabled, reason(slot), modelError()]).toEqual([false, null, null]));
  expect(slot.getByTestId("oats-spawn-form").textContent).not.toMatch(/Not found/);
  // A bare id one provider serves: it goes.
  set(slot, "oats-spawn-model-id", "sol-5");
  await waitFor(() => expect(calls(slot, "spawnPlan").at(-1)).toEqual({ soul: "oats-developer", task: "do it", model: "sol-5" }));
  await waitFor(() => expect([submit(slot).disabled, reason(slot), modelError()]).toEqual([false, null, null]));
});

test("a model bb's pi does not have is refused by the provider at the press: the kernel's whole message once under the result's title, the Model field not marked, nothing held, the form editable again", async () => {
  // The real kernel's answer to that spawn (test/fixtures/spawn/README.md): refused, rolled back, nothing left.
  const refused = (JSON.parse(readFileSync(join(process.cwd(), "test/fixtures/spawn/spawn-pi-model-refused.json"), "utf8")) as { error: { code: string; message: string } }).error;
  const bbModel = (model: string) => ({ id: model, model, displayName: model, description: "", isDefault: false, defaultReasoningEffort: "medium", routeProviderId: model.slice(0, model.indexOf("/")) });
  const slot = await ready(
    {
      // The preview passes for a model nobody serves: a planned launch carries no model at this kernel.
      spawnPlan: (input) => ({ facts: formFacts({ ...recorded, model: input.model ?? "claude-fable-5.2" }, { name: input.name ?? null }), revision: REVISION }),
      spawn: () => {
        throw new Error(`${refused.code}: ${refused.message}`);
      },
    },
    { models: () => ({ modelLoadError: null, models: ["github-copilot/claude-fable-5.2", "openai/sol-5"].map(bbModel) }) },
  );
  const modelError = () => slot.getByTestId("oats-spawn-model").closest('[data-testid="oats-field"]')!.querySelector('[role="alert"]')?.textContent ?? null;
  choose(slot, "oats-spawn-model", "__custom__");
  set(slot, "oats-spawn-model-id", "claude-fable-9");
  await waitFor(() => expect(calls(slot, "spawnPlan").at(-1)).toEqual({ soul: "oats-developer", task: "", model: "claude-fable-9" }));
  await waitFor(() => expect([submit(slot).disabled, reason(slot), modelError()]).toEqual([false, null, null]));
  fireEvent.click(submit(slot));
  const result = await slot.findByTestId("oats-result");
  expect(result.getAttribute("role")).toBe("alert");
  expect(result.querySelector("h3")!.textContent).toBe("The agent was not spawned");
  // The kernel's message, whole, once: the result's sentence, and no Details repeating it.
  const MESSAGE = "session backend bb refused to launch shape-refused: pi has no model \"claude-fable-9\" (if you just added it to pi, try again in a minute) — spawn rolled back";
  expect(result.querySelector("p")!.textContent).toBe(MESSAGE);
  expect(Array.from(result.querySelectorAll(":scope > p")).at(-1)!.textContent).toBe("E_BACKEND_LAUNCH_ARG");
  expect(slot.queryByTestId("oats-spawn-details")).toBeNull();
  expect(slot.getByTestId("oats-spawn-form").textContent!.split(MESSAGE)).toHaveLength(2);
  // Nothing says an instance exists, nothing is held, no field is marked, and nothing was opened.
  expect(result.textContent).not.toMatch(/was created|Check result|Open /);
  expect([modelError(), slot.getByTestId("oats-spawn-model").getAttribute("aria-invalid")]).toEqual([null, null]);
  expect(fieldset(slot).disabled).toBe(false);
  expect(slot.inspection.navigateCalls).toEqual([]);
  expect([submit(slot).disabled, submit(slot).textContent]).toEqual([false, "Spawn"]);
  // Another model typed: the refusal about the old one goes, and the spawn can be asked again.
  set(slot, "oats-spawn-model-id", "sol-5");
  expect(slot.queryByTestId("oats-result")).toBeNull();
});

test("where bb's list cannot decide, nothing is held for the model: no list read, or a list that names no provider (Claude Code's)", async () => {
  const bbModel = (model: string) => ({ id: model, model, displayName: model, description: "", isDefault: false, defaultReasoningEffort: "medium" });
  const unknown = { spawnPlan: (input: { model?: string; name?: string }) => ({ facts: formFacts({ ...recorded, model: input.model ?? "a-model-nobody-lists" }, { name: input.name ?? null }), revision: REVISION }) };
  // bb reports no model for the harness.
  const none = await ready(unknown);
  await waitFor(() => expect(none.getByTestId("oats-spawn-form").textContent).toContain("No model suggestions reported."));
  expect([submit(none).disabled, reason(none)]).toEqual([false, null]);
  none.unmount();
  resetApp();
  // A list of bare ids: no provider to be served by.
  const bare = await ready(unknown, { models: () => ({ modelLoadError: null, models: [bbModel("claude-opus-5-5"), bbModel("claude-sonnet-5")] }) });
  await waitFor(() => expect(options(bare, "oats-spawn-model").map(([label]) => label)).toContain("claude-opus-5-5"));
  expect([submit(bare).disabled, reason(bare)]).toEqual([false, null]);
});

test("a soul that declares its own launch (shaped from a real answer): the column reads its harness and model from the soul, Spawn is armed, and no model is asked for", async () => {
  // SHAPED, every name invented: test/fixtures/spawn/README.md.
  const declared = (JSON.parse(readFileSync(join(process.cwd(), "test/fixtures/spawn/spawn-preview-soul-launch.json"), "utf8")) as { result: Record<string, unknown> }).result;
  const bbModel = (model: string) => ({ id: model, model, displayName: model, description: "", isDefault: false, defaultReasoningEffort: "medium" });
  const slot = await ready({ spawnPlan: (input) => ({ facts: formFacts(declared, { name: input.name ?? null }), revision: REVISION }) }, { models: () => ({ modelLoadError: null, models: [bbModel("github-copilot/claude-fable-5.1"), bbModel("openai/sol-5")] }) });
  const harnessRow = () => Array.from(column(slot).querySelectorAll('[data-testid="oats-fact"]')).find((fact) => fact.querySelector("dt")!.textContent === "Harness")!.querySelector("dd")!.textContent;
  await waitFor(() => expect(harnessRow()).toBe("pi · claude-fable-5.1the soul's preference"));
  await waitFor(() => expect(options(slot, "oats-spawn-model").map(([label]) => label)).toContain("openai/sol-5"));
  expect(slot.getByTestId("oats-spawn-model").textContent).toBe("Default · claude-fable-5.1▾");
  expect([submit(slot).disabled, reason(slot)]).toEqual([false, null]);
  expect(calls(slot, "spawnPlan").every((call) => (call as { model?: string }).model === undefined && (call as { harness?: string }).harness === undefined)).toBe(true);
});

test("with no model bb reports, the field is Default and Custom…, and says any id can be typed", async () => {
  const slot = await ready();
  await waitFor(() => expect(slot.getByTestId("oats-spawn-form").textContent).toContain("No model suggestions reported. Any model ID can be typed."));
  expect(options(slot, "oats-spawn-model").map(([label]) => label)).toEqual(["Default · github-copilot/claude-fable-5.1", "Custom…"]);
});

test("the relationship: Independent at the start; a relation needs its instance, one of the roster, and is passed with it", async () => {
  const slot = await ready();
  const line = () => slot.getByTestId("oats-spawn-relation-line").textContent;
  expect(Array.from(slot.getByTestId("oats-spawn-relation").querySelectorAll('[role="radio"]')).map((radio) => [radio.textContent, radio.getAttribute("aria-checked")])).toEqual([["Independent", "true"], ["Child of", "false"], ["Sibling of", "false"], ["Parent of", "false"]]);
  expect(line()).toBe("Independent — not linked to another instance.");
  expect(slot.queryByTestId("oats-spawn-relative")).toBeNull();
  fireEvent.click(slot.getByRole("radio", { name: "Child of" }));
  const which = slot.getByTestId("oats-spawn-relative");
  expect([which.getAttribute("aria-label"), which.textContent]).toEqual(["Child of which instance?", "Choose an instance…▾"]);
  // Every agent of the roster, by its name as words with its soul; eight of them, so the list has a filter.
  expect(options(slot, "oats-spawn-relative").map(([label]) => label)).toEqual(fixtureAgents().map((agent) => agentName(agent.instance)));
  fireEvent.click(which);
  fireEvent.change(slot.getByTestId("oats-spawn-relative-filter"), { target: { value: "flaky ci" } });
  expect(slot.getAllByTestId("oats-spawn-relative-option").map((option) => option.getAttribute("data-value"))).toEqual(["flaky-ci-developer"]);
  fireEvent.keyDown(slot.getByTestId("oats-spawn-relative-filter"), { key: "Escape" });
  expect(line()).toBe("Pick the instance this one is a child of.");
  expect([submit(slot).disabled, reason(slot)]).toEqual([true, "Pick the instance first, or choose Independent."]);
  choose(slot, "oats-spawn-relative", "flaky-ci-developer");
  expect(line()).toBe("Spawns as a child of Flaky ci developer.");
  await waitFor(() => expect(calls(slot, "spawnPlan").at(-1)).toEqual({ soul: "oats-developer", task: "", relation: { kind: "child", to: "flaky-ci-developer" } }));
  expect(submit(slot).disabled).toBe(false);
});

test("who the agent is started under is a row of What will be created, read from the kernel's answer, with the other agent by its name as words", async () => {
  const related = { ...recorded, relation: "child", decision: { ...(recorded.decision as object), effective: { ...((recorded.decision as { effective: object }).effective), relation: { anchor: { instance: "flaky-ci-developer" } } } } };
  const slot = await ready({ spawnPlan: (input) => ({ facts: formFacts(input.relation === undefined ? recorded : related, { name: input.name ?? null }), revision: REVISION }) });
  const relationship = () => Array.from(column(slot).querySelectorAll('[data-testid="oats-fact"]')).find((fact) => fact.querySelector("dt")!.textContent === "Relationship")?.querySelector("dd")!.textContent ?? null;
  expect(relationship()).toBeNull(); // independent: the kernel's answer has none, and none is drawn
  fireEvent.click(slot.getByRole("radio", { name: "Child of" }));
  choose(slot, "oats-spawn-relative", "flaky-ci-developer");
  await waitFor(() => expect(relationship()).toBe("child of Flaky ci developer"));
});

test("a name the kernel would refuse never leaves the form: the fault is said under it, and beside Spawn", async () => {
  const slot = await ready();
  const asked = calls(slot, "spawnPlan").length;
  const error = () => slot.getByTestId("oats-spawn-form").querySelector('[role="alert"]')?.textContent ?? null;
  set(slot, "oats-spawn-name", "bad name");
  expect(error()).toBe("A space can’t be in a name. Use letters, digits and dashes.");
  expect((slot.getByTestId("oats-spawn-name") as HTMLInputElement).getAttribute("aria-invalid")).toBe("true");
  expect([submit(slot).disabled, reason(slot)]).toEqual([true, "The name can’t be used: its field says why."]);
  expect(column(slot).textContent).toContain("Shown once the values above can be used.");
  set(slot, "oats-spawn-name", "a/b");
  expect(error()).toBe("“/” can’t be in a name. Use letters, digits and dashes.");
  set(slot, "oats-spawn-name", "-lead");
  expect(error()).toBe("A name starts with a letter or a digit, not a dash.");
  set(slot, "oats-spawn-name", "a".repeat(70));
  expect(error()).toBe("This name has 70 characters. A name has 63 at most: shorten it.");
  await new Promise((resolve) => setTimeout(resolve, 500));
  expect(calls(slot, "spawnPlan")).toHaveLength(asked);
  fireEvent.submit(slot.getByTestId("oats-spawn-form"));
  expect(calls(slot, "spawn")).toEqual([]);
});

test("a name the kernel refuses at the preview is said under the name, in a person's words", async () => {
  const slot = await ready({
    spawnPlan: (input) => {
      if (input.name === "flaky-ci-developer") throw new Error('E_INSTANCE_NAME_TAKEN: instance name "flaky-ci-developer" is taken');
      return answer(input);
    },
  });
  set(slot, "oats-spawn-name", "flaky-ci-developer");
  await waitFor(() => expect(slot.getByTestId("oats-spawn-form").querySelector('[role="alert"]')?.textContent).toBe("An instance with this name already exists. Choose another name. (E_INSTANCE_NAME_TAKEN)"));
  expect([submit(slot).disabled, reason(slot)]).toEqual([true, "The name can’t be used: its field says why."]);
  expect(column(slot).querySelector('[data-testid="oats-notice"]')).toBeNull();
});

test("Spawn applies the decision the preview showed, once: the form says Created, stays held, and opens the new agent's thread", async () => {
  const slot = await ready(previews({ spawn: () => ({ instance: "ranker-v4-probe", threadId: "thr_new" }) }));
  set(slot, "oats-spawn-task", "Try depth 7.");
  set(slot, "oats-spawn-name", "ranker-v4-probe");
  await waitFor(() => expect(column(slot).querySelector("dd")!.textContent).toBe("ranker-v4-probe"));
  await waitFor(() => expect(submit(slot).disabled).toBe(false));
  fireEvent.click(submit(slot));
  await waitFor(() => expect(slot.inspection.navigateCalls).toEqual([{ method: "toThread", threadId: "thr_new" }]));
  const [spawned] = calls(slot, "spawn");
  expect(spawned).toEqual({ soul: "oats-developer", task: "Try depth 7.", name: "ranker-v4-probe", revision: REVISION, key: expect.stringMatching(/^[0-9a-f]{32}$/) });
  // Created: never the filled form with Spawn live. The button says so and is off, the fields are held, the result names the agent.
  expect([submit(slot).textContent, submit(slot).disabled]).toEqual(["Created", true]);
  expect(fieldset(slot).disabled).toBe(true);
  const result = slot.getByTestId("oats-result");
  expect([result.getAttribute("data-tone"), result.querySelector("h3")!.textContent, result.querySelector("p")!.textContent]).toEqual(["done", "Created Ranker v4 probe", "Opening its thread…"]);
  expect(slot.getByTestId("oats-spawn-status").textContent).toBe("Created Ranker v4 probe");
  expect(slot.getByTestId("oats-spawn-cancel").textContent).toBe("Close");
  // And through bb's own toaster, which stays when the thread opens: what was made, with the way to it.
  expect(notified().map((note) => [note.tone, note.title, note.open?.label])).toEqual([["done", "Created Ranker v4 probe.", "Open Ranker v4 probe"]]);
  // A second press, by the button or by the key, starts nothing.
  fireEvent.click(submit(slot));
  fireEvent.keyDown(slot.getByTestId("oats-spawn-task"), { key: "Enter", ctrlKey: true });
  expect(calls(slot, "spawn")).toHaveLength(1);
  fireEvent.click(slot.getByTestId("oats-spawn-open"));
  expect(slot.inspection.navigateCalls).toHaveLength(2);
});

test("while it spawns the button says so and the fields are held", async () => {
  let finish: (value: { instance: string; threadId: string }) => void = () => undefined;
  const slot = await ready(previews({ spawn: () => new Promise((resolve) => (finish = resolve)) }));
  fireEvent.click(submit(slot));
  await waitFor(() => expect(submit(slot).textContent).toBe("Spawning…"));
  expect([submit(slot).disabled, submit(slot).getAttribute("aria-busy")]).toEqual([true, "true"]);
  expect(fieldset(slot).disabled).toBe(true);
  expect(slot.getByTestId("oats-spawn-status").textContent).toBe("Spawning…");
  // One press makes one agent: a second press, Ctrl+Enter and Enter while it is in flight start nothing.
  fireEvent.click(submit(slot));
  fireEvent.keyDown(slot.getByTestId("oats-spawn-task"), { key: "Enter", ctrlKey: true });
  fireEvent.submit(slot.getByTestId("oats-spawn-form"));
  expect(calls(slot, "spawn")).toHaveLength(1);
  // Left, and opened again meanwhile: the form says a spawn of this soul is in progress and starts no second one.
  slot.unmount();
  const again = await form("oats-developer");
  await waitFor(() => expect(again.getByTestId("oats-disabled-reason").textContent).toBe("A spawn of oats-developer is in progress."));
  expect((again.getByTestId("oats-spawn-submit") as HTMLButtonElement).disabled).toBe(true);
  await act(async () => finish({ instance: "oats-developer-2", threadId: "thr_new" }));
  await waitFor(() => expect(again.queryByTestId("oats-disabled-reason")).toBeNull());
  // The form that made it was left: the person is told where they are, with the way to the agent; nothing navigates under them.
  expect(notified().map((note) => [note.tone, note.title, note.open?.label])).toEqual([["done", "Created Oats developer 2.", "Open Oats developer 2"]]);
  expect(again.inspection.navigateCalls).toEqual([]);
  notified()[0]!.open!.run();
  expect(slot.inspection.navigateCalls.concat(again.inspection.navigateCalls)).toContainEqual({ method: "toThread", threadId: "thr_new" });
});

test("a refused spawn leads with a person's words, the kernel's code after and its message under Details; a retry of the same values reuses the key, changed values get a new one", async () => {
  let refuse = true;
  const slot = await ready(
    previews({
      spawn: () => {
        if (refuse) throw new Error("E_REQUIRED_HOOK_FAILED: oats.build: the worktree hook exited 2\nnpm ci failed");
        return { instance: "oats-developer-2", threadId: "thr_new" };
      },
    }),
  );
  fireEvent.click(submit(slot));
  const result = await slot.findByTestId("oats-result");
  expect(result.getAttribute("role")).toBe("alert");
  expect(result.querySelector("h3")!.textContent).toBe("The agent was not spawned");
  expect(result.querySelector("p")!.textContent).toBe("A capability couldn’t set up the worktree, so the spawn was rolled back. Nothing was created. Try again, or see Details.");
  expect(Array.from(result.querySelectorAll(":scope > p")).at(-1)!.textContent).toBe("E_REQUIRED_HOOK_FAILED");
  // Details: closed until pressed, drawn as the plugin's disclosure, the kernel's message line by line.
  const details = slot.getByTestId("oats-spawn-details");
  expect(details.hasAttribute("open")).toBe(false);
  expect(details.querySelector("summary")!.textContent).toBe("▸Details");
  expect(Array.from(details.querySelectorAll("p")).map((line) => line.textContent)).toEqual(["oats.build: the worktree hook exited 2", "npm ci failed"]);
  // The instruction and the other values are kept.
  expect(fieldset(slot).disabled).toBe(false);
  expect(slot.inspection.navigateCalls).toEqual([]);
  expect(submit(slot).disabled).toBe(false);
  fireEvent.click(submit(slot));
  await waitFor(() => expect(calls(slot, "spawn")).toHaveLength(2));
  expect(calls(slot, "spawn")[1]!.key).toBe(calls(slot, "spawn")[0]!.key);
  // Changed values are another intent; the refusal about the old ones goes.
  await slot.findByTestId("oats-result");
  set(slot, "oats-spawn-task", "Another.");
  expect(slot.queryByTestId("oats-result")).toBeNull();
  refuse = false;
  await waitFor(() => expect(calls(slot, "spawnPlan").at(-1)).toEqual({ soul: "oats-developer", task: "Another." }));
  await waitFor(() => expect(submit(slot).disabled).toBe(false));
  fireEvent.click(submit(slot));
  await waitFor(() => expect(calls(slot, "spawn")).toHaveLength(3));
  expect(calls(slot, "spawn")[2]!.key).not.toBe(calls(slot, "spawn")[0]!.key);
});

test("a decision that moved before the spawn: nothing was created, the words say so, the old preview cannot be pressed again, and what will be created is read again and says so", async () => {
  const waiting: (() => void)[] = [];
  let hold = false;
  const slot = await ready({
    spawnPlan: (input) => (hold ? new Promise((resolve) => waiting.push(() => resolve({ ...answer(input), revision: "aaaaaaaaaaaaaaaaaaaaaaaa" }))) : answer(input)),
    spawn: () => {
      throw new Error("E_DECISION_STALE: the decision moved");
    },
  });
  hold = true;
  fireEvent.click(submit(slot));
  const result = await slot.findByTestId("oats-result");
  expect(result.querySelector("p")!.textContent).toBe("Something changed before the spawn went through. Nothing was created — check the updated values and press Spawn again.");
  // Until the preview is read again there is nothing to press: the one that was on screen is the one the kernel refused.
  await waitFor(() => expect(waiting).toHaveLength(1));
  expect([submit(slot).disabled, reason(slot)]).toEqual([true, "Reading defaults…"]);
  expect(slot.queryByTestId("oats-spawn-reread")).toBeNull();
  fireEvent.click(submit(slot));
  expect(calls(slot, "spawn")).toHaveLength(1);
  await act(async () => waiting[0]!());
  await waitFor(() => expect(submit(slot).disabled).toBe(false));
  expect(slot.getByTestId("oats-spawn-reread").textContent).toBe("“What will be created” was read again: it shows the values as they are now.");
  // The next press is for the new decision, under a new key.
  fireEvent.click(submit(slot));
  await waitFor(() => expect(calls(slot, "spawn")).toHaveLength(2));
  expect(calls(slot, "spawn")[1]).toMatchObject({ revision: "aaaaaaaaaaaaaaaaaaaaaaaa" });
  expect(calls(slot, "spawn")[1]!.key).not.toBe(calls(slot, "spawn")[0]!.key);
});

test("an outcome that is not known: the fields and Spawn are held, and the one act is Check result, which asks again under the same key", async () => {
  let first = true;
  const slot = await ready(
    previews({
      spawn: () => {
        if (first) {
          first = false;
          throw new Error("OATS_TIMEOUT: oats spawn did not answer");
        }
        return { instance: "oats-developer-2", threadId: "thr_new" };
      },
    }),
  );
  fireEvent.click(submit(slot));
  const result = await slot.findByTestId("oats-result");
  expect([result.getAttribute("data-tone"), result.querySelector("h3")!.textContent]).toEqual(["unknown", "It is not known whether the agent was spawned"]);
  expect(result.querySelector("p")!.textContent).toBe("OATS took too long to answer. The instance may already exist. Press Check result: it asks OATS again, and starts nothing twice.");
  // Nothing of the form can be changed into another spawn: with no name the kernel would number a second agent.
  expect(fieldset(slot).disabled).toBe(true);
  expect([submit(slot).textContent, submit(slot).disabled, reason(slot)]).toEqual(["Check result", false, null]);
  fireEvent.keyDown(slot.getByTestId("oats-spawn-cancel"), { key: "Enter", ctrlKey: true });
  await waitFor(() => expect(slot.inspection.navigateCalls).toEqual([{ method: "toThread", threadId: "thr_new" }]));
  expect(calls(slot, "spawn")).toHaveLength(2);
  expect(calls(slot, "spawn")[1]).toEqual(calls(slot, "spawn")[0]);
  expect(submit(slot).textContent).toBe("Created");
});

test("a spawn that made an instance and did not finish (the kernel says so, or it named no thread) is said as created: the form stays held, with nothing to press but Close", async () => {
  for (const [thrown, sentence, code] of [
    ["E_SPAWN_INCOMPLETE: launched, not confirmed", "The instance was created but didn’t finish starting. Open it from the sidebar instead of spawning again.", "E_SPAWN_INCOMPLETE"],
    ["NO_THREAD_NAMED: Spawned oats-developer-2, but the kernel named no bb thread for it", "The instance was created, but OATS named no bb thread for it. Open it from the sidebar instead of spawning again.", "NO_THREAD_NAMED"],
  ] as const) {
    const slot = await ready(
      previews({
        spawn: () => {
          throw new Error(thrown);
        },
      }),
    );
    fireEvent.click(submit(slot));
    const result = await slot.findByTestId("oats-result");
    expect([result.getAttribute("data-tone"), result.querySelector("h3")!.textContent, result.querySelector("p")!.textContent], code).toEqual(["unknown", "The agent was created, and its start is not complete", sentence]);
    expect(Array.from(result.querySelectorAll(":scope > p")).at(-1)!.textContent).toBe(code);
    // Never "not spawned" with the form free: with no name the kernel would number a second agent.
    expect([fieldset(slot).disabled, submit(slot).textContent, submit(slot).disabled, slot.getByTestId("oats-spawn-cancel").textContent], code).toEqual([true, "Spawn incomplete", true, "Close"]);
    fireEvent.click(submit(slot));
    fireEvent.keyDown(slot.getByTestId("oats-spawn-cancel"), { key: "Enter", ctrlKey: true });
    expect(calls(slot, "spawn"), code).toHaveLength(1);
    slot.unmount();
    resetApp();
  }
});

test("a refusal whose rollback the kernel could not finish is never 'nothing was created': the form stays held, with what to clean up under Details and nothing to press but Close", async () => {
  // Shaped from the kernel's source, not recorded (test/spawn/model.test.ts says from which lines, and why).
  const left = "oats-developer-2 was not launched: oats.bb's session provider bb is not ready — rollback INCOMPLETE, clean up manually: instance home /abs/deployment/agents/oats-developer/instances/oats-developer-2: still present";
  const slot = await ready(
    previews({
      spawn: () => {
        // The refusal as the plugin's server words it (server/core.ts `refusal`): the code and the message, and the kernel's marker as its one issue.
        throw Object.assign(new Error(`E_BACKEND_NOT_READY: ${left}`), { code: "conflict", issues: [{ message: UNCONFIRMED_ISSUE.message, path: [...UNCONFIRMED_ISSUE.path] }] });
      },
    }),
  );
  fireEvent.click(submit(slot));
  const result = await slot.findByTestId("oats-result");
  expect([result.getAttribute("data-tone"), result.querySelector("h3")!.textContent, result.querySelector("p")!.textContent]).toEqual([
    "failed",
    "The spawn was refused, and could not be undone completely",
    "OATS refused the spawn and could not undo all of it: part of the instance may still be there. Details says what to clean up; don’t spawn again before it is.",
  ]);
  expect(slot.getByTestId("oats-spawn-details").textContent).toContain("rollback INCOMPLETE, clean up manually");
  expect([fieldset(slot).disabled, submit(slot).textContent, submit(slot).disabled, slot.getByTestId("oats-spawn-cancel").textContent]).toEqual([true, "Spawn incomplete", true, "Close"]);
  fireEvent.click(submit(slot));
  fireEvent.keyDown(slot.getByTestId("oats-spawn-cancel"), { key: "Enter", ctrlKey: true });
  expect(calls(slot, "spawn")).toHaveLength(1);
});

test("the marker holds the form whatever the refusal's text leads with: a marked refusal with no code the plugin knows is not 'unknown' with Check result", async () => {
  // The server words a refusal `<code>: <message>`; one whose text leads with no known code (a kernel code of another shape) still carries the marker as its issue.
  const left = "oats-developer-2 was not launched — rollback INCOMPLETE, clean up manually: instance home /abs/deployment/agents/oats-developer/instances/oats-developer-2: still present";
  const slot = await ready(
    previews({
      spawn: () => {
        throw Object.assign(new Error(left), { code: "conflict", issues: [{ message: UNCONFIRMED_ISSUE.message, path: [...UNCONFIRMED_ISSUE.path] }] });
      },
    }),
  );
  fireEvent.click(submit(slot));
  const result = await slot.findByTestId("oats-result");
  expect([result.getAttribute("data-tone"), result.querySelector("h3")!.textContent]).toEqual(["failed", "The spawn was refused, and could not be undone completely"]);
  expect([fieldset(slot).disabled, submit(slot).textContent, submit(slot).disabled, slot.getByTestId("oats-spawn-cancel").textContent]).toEqual([true, "Spawn incomplete", true, "Close"]);
});

test("the same refusal without the kernel's marker is what its code says, whatever its words: refused, the values free again", async () => {
  // The words alone decide nothing (test/spawn/model.test.ts says why): only the marker holds the form.
  const left = "oats-developer-2 was not launched: oats.bb's session provider bb is not ready — rollback INCOMPLETE, clean up manually: instance home /abs/deployment/agents/oats-developer/instances/oats-developer-2: still present";
  const slot = await ready(
    previews({
      spawn: () => {
        throw Object.assign(new Error(`E_BACKEND_NOT_READY: ${left}`), { code: "conflict" });
      },
    }),
  );
  fireEvent.click(submit(slot));
  const result = await slot.findByTestId("oats-result");
  expect([result.getAttribute("data-tone"), result.querySelector("h3")!.textContent]).toEqual(["failed", "The agent was not spawned"]);
  expect(result.querySelector("p")!.textContent).toMatch(/^bb isn’t ready to launch this agent, so the spawn was rolled back\. Nothing was created\./);
  await waitFor(() => expect([fieldset(slot).disabled, submit(slot).textContent]).toEqual([false, "Spawn"]));
});

test("held as it is, the form keeps saying why: the word of an unknown outcome stays when the roster is read again, and Check result is held like the acts while OATS cannot be read", async () => {
  const last = { at: new Date(Date.now() - 40 * 60_000).toISOString(), deployment: { root: "/abs/deployment", workspace: "oats", machine: "falcon" }, agents: fixtureAgents() };
  let stale = false;
  const live = handlers().snapshot;
  const slot = await ready(
    previews({
      snapshot: (input) => (stale ? { ok: false as const, at: new Date().toISOString(), code: "OATS_NOT_FOUND", message: "oats was not found on falcon: install OATS there", machine: "falcon", last } : live(input)),
      spawn: () => {
        throw new Error("OATS_TIMEOUT: oats spawn did not answer");
      },
    }),
  );
  // A relation: its instance is known only while the roster is.
  fireEvent.click(slot.getByRole("radio", { name: "Child of" }));
  choose(slot, "oats-spawn-relative", "flaky-ci-developer");
  await waitFor(() => expect(submit(slot).disabled).toBe(false));
  fireEvent.click(submit(slot));
  await waitFor(() => expect(submit(slot).textContent).toBe("Check result"));
  expect(slot.getByTestId("oats-result").querySelector("h3")!.textContent).toBe("It is not known whether the agent was spawned");
  // OATS cannot be read: the roster's notice, and Check result off with the acts' reason; a press and the key ask nothing.
  stale = true;
  await slot.behavior.emitRealtime("oats/changed", { at: new Date().toISOString() });
  await waitFor(() => expect(slot.queryByTestId("oats-unreadable")).not.toBeNull());
  expect([submit(slot).textContent, submit(slot).disabled, reason(slot)]).toEqual(["Check result", true, "Comes back when OATS is read again"]);
  fireEvent.click(submit(slot));
  fireEvent.keyDown(slot.getByTestId("oats-spawn-cancel"), { key: "Enter", ctrlKey: true });
  expect(calls(slot, "spawn")).toHaveLength(1);
  // And what the form is held for is still said.
  expect(slot.getByTestId("oats-result").querySelector("h3")!.textContent).toBe("It is not known whether the agent was spawned");
});

test("a failure nobody classed is of unknown outcome, never 'not spawned': an answer the plugin cannot read, a hook's own code; and a Check result the plugin refuses before asking stays unknown", async () => {
  for (const thrown of ["OATS_BAD_ANSWER: `oats spawn` answered a document the plugin cannot read", "OATS_OUTPUT_TOO_LARGE: more than 8 MB", "OATS_ABORTED: the call was ended", "E_HOOK_ENVIRONMENT_CONTRACT: oats.build set a variable it does not declare"]) {
    const slot = await ready(
      previews({
        spawn: () => {
          throw new Error(thrown);
        },
      }),
    );
    fireEvent.click(submit(slot));
    const result = await slot.findByTestId("oats-result");
    expect([result.querySelector("h3")!.textContent, result.querySelector("p")!.textContent], thrown).toEqual(["It is not known whether the agent was spawned", "OATS didn’t say whether the instance was created. Press Check result: it asks OATS again, and starts nothing twice."]);
    expect([fieldset(slot).disabled, submit(slot).textContent, submit(slot).disabled], thrown).toEqual([true, "Check result", false]);
    slot.unmount();
    resetApp();
  }
  // The replay is refused by the plugin's own check (the relation's anchor left the roster meanwhile): nothing was learned.
  let asked = 0;
  const slot = await ready(
    previews({
      spawn: () => {
        asked += 1;
        if (asked === 1) throw new Error("OATS_TIMEOUT: oats spawn did not answer");
        throw Object.assign(new Error('"flaky-ci-developer" is not an agent of this OATS deployment\'s current snapshot'), { code: "invalid" });
      },
    }),
  );
  fireEvent.click(submit(slot));
  await waitFor(() => expect(submit(slot).textContent).toBe("Check result"));
  fireEvent.click(submit(slot));
  await waitFor(() => expect(asked).toBe(2));
  await waitFor(() => expect(submit(slot).textContent).toBe("Check result"));
  expect((await slot.findByTestId("oats-result")).querySelector("h3")!.textContent).toBe("It is not known whether the agent was spawned");
  expect(fieldset(slot).disabled).toBe(true);
});

test("a spawn that fails after its form was left is told where the person is, and stays until dismissed", async () => {
  let fail: (cause: Error) => void = () => undefined;
  const slot = await ready(previews({ spawn: () => new Promise((_resolve, reject) => (fail = reject)) }));
  fireEvent.click(submit(slot));
  await waitFor(() => expect(submit(slot).textContent).toBe("Spawning…"));
  slot.unmount();
  await act(async () => fail(new Error("OATS_TIMEOUT: oats spawn did not answer")));
  await waitFor(() => expect(notified()).toHaveLength(1));
  expect(notified()[0]).toMatchObject({ tone: "unknown", title: "It is not known whether the agent was spawned", lines: ["OATS didn’t say whether the instance was created. Check the agents in the sidebar before spawning again.", "OATS_TIMEOUT"] });
});

test("a spawn that ends with no answer at all is of unknown outcome too; one the plugin refused before asking the kernel is not", async () => {
  const slot = await ready(
    previews({
      spawn: () => {
        throw new Error("The OATS plugin's server did not answer.");
      },
    }),
  );
  fireEvent.click(submit(slot));
  const result = await slot.findByTestId("oats-result");
  expect(result.querySelector("h3")!.textContent).toBe("It is not known whether the agent was spawned");
  expect(submit(slot).textContent).toBe("Check result");
  slot.unmount();
  resetApp();
  const refused = await ready(
    previews({
      spawn: () => {
        throw Object.assign(new Error("this key already belongs to another spawn: a new spawn needs a new key"), { code: "invalid" });
      },
    }),
  );
  fireEvent.click(submit(refused));
  expect((await refused.findByTestId("oats-result")).querySelector("h3")!.textContent).toBe("The agent was not spawned");
  expect([submit(refused).textContent, fieldset(refused).disabled]).toEqual(["Spawn", false]);
});

test("while the preview of the values on screen is being read, Spawn is off and says so: neither the button nor Ctrl+Enter can start what the screen has not shown", async () => {
  const waiting: (() => void)[] = [];
  const slot = await form("oats-developer", {
    spawnPlan: (input) => new Promise((resolve) => waiting.push(() => resolve(answer(input)))),
    spawn: () => ({ instance: "oats-developer-2", threadId: "thr_new" }),
  });
  await slot.findByTestId("oats-spawn-form");
  await waitFor(() => expect(waiting).toHaveLength(1));
  expect(column(slot).textContent).toBe("What will be createdReading defaults…");
  expect([submit(slot).textContent, submit(slot).disabled, reason(slot)]).toEqual(["Spawn", true, "Reading defaults…"]);
  expect(slot.getByTestId("oats-spawn-status").textContent).toBe("Reading defaults…");
  fireEvent.click(submit(slot));
  fireEvent.keyDown(slot.getByTestId("oats-spawn-task"), { key: "Enter", ctrlKey: true });
  expect(calls(slot, "spawn")).toEqual([]);
  // The values change while it reads: still off, until THEIR preview is on screen; the answer for the old ones enables nothing.
  set(slot, "oats-spawn-task", "Changed.");
  await waitFor(() => expect(waiting).toHaveLength(2));
  await act(async () => waiting[0]!());
  expect([submit(slot).disabled, reason(slot)]).toEqual([true, "Reading defaults…"]);
  fireEvent.keyDown(slot.getByTestId("oats-spawn-task"), { key: "Enter", ctrlKey: true });
  expect(calls(slot, "spawn")).toEqual([]);
  await act(async () => waiting[1]!());
  await waitFor(() => expect(submit(slot).disabled).toBe(false));
  expect(reason(slot)).toBeNull();
  expect(column(slot).textContent).toContain("Resolved by the installed CLI. Spawn refuses if this changes before you confirm.");
  fireEvent.keyDown(slot.getByTestId("oats-spawn-task"), { key: "Enter", ctrlKey: true });
  await waitFor(() => expect(calls(slot, "spawn")).toHaveLength(1));
  expect(calls(slot, "spawn")[0]).toMatchObject({ task: "Changed.", revision: REVISION });
});

test("while the values on screen are being read again the last facts stay, marked Updating…; an answer for values that are gone is never drawn", async () => {
  const waiting = new Map<string, (value: ReturnType<typeof answer>) => void>();
  let hold = false;
  const slot = await ready({
    spawnPlan: (input) => (hold ? new Promise((resolve) => waiting.set(input.name ?? "", resolve)) : answer(input)),
  });
  hold = true;
  set(slot, "oats-spawn-name", "first-probe");
  await waitFor(() => expect(waiting.has("first-probe")).toBe(true));
  expect(slot.getByTestId("oats-spawn-updating").textContent).toBe("Updating…");
  expect(column(slot).textContent).toContain("numbered by the kernel");
  // The facts that stay are the last ones read, not these values': Spawn waits for theirs.
  expect([submit(slot).disabled, reason(slot)]).toEqual([true, "Reading defaults…"]);
  set(slot, "oats-spawn-name", "second-probe");
  await waitFor(() => expect(waiting.has("second-probe")).toBe(true));
  await act(async () => waiting.get("first-probe")!(answer({ soul: "oats-developer", task: "", name: "first-probe" })));
  expect(column(slot).textContent).not.toContain("first-probe");
  await act(async () => waiting.get("second-probe")!(answer({ soul: "oats-developer", task: "", name: "second-probe" })));
  await waitFor(() => expect(column(slot).querySelector("dd")!.textContent).toBe("second-probe"));
  expect(slot.queryByTestId("oats-spawn-updating")).toBeNull();
});

test("a preview the kernel refuses: a person's words first, the code after, the kernel's message under Details, Retry; Spawn is off and says where the reason is", async () => {
  let refuse = true;
  const slot = await form("oats-developer", {
    spawnPlan: (input) => {
      if (refuse) throw new Error("E_BACKEND_HARNESS: the bb session provider cannot launch codex");
      return answer(input);
    },
  });
  const notice = await waitFor(() => {
    const found = column(slot).querySelector('[data-testid="oats-notice"]');
    expect(found).not.toBeNull();
    return found!;
  });
  expect(notice.getAttribute("data-tone")).toBe("error");
  expect(notice.querySelector("h3")!.textContent).toBe("This can’t be spawned as it is");
  expect(notice.querySelector("div p")!.textContent).toBe("bb can’t run the harness this soul would use. Pick one of the harnesses above.");
  expect(notice.querySelector(":scope > p")!.textContent).toBe("E_BACKEND_HARNESS");
  expect(notice.querySelector('[data-testid="oats-notice-details"]')!.textContent).toContain("the bb session provider cannot launch codex");
  expect([submit(slot).disabled, reason(slot)]).toEqual([true, "OATS refused these values: “What will be created” says why."]);
  refuse = false;
  fireEvent.click(slot.getByRole("button", { name: "Retry" }));
  await waitFor(() => expect(column(slot).textContent).toContain("numbered by the kernel"));
  // (Once bb's list of models for the harness the kernel now resolved has answered.)
  await waitFor(() => expect(submit(slot).disabled).toBe(false));
});

test("a preview the provider refuses (from OATS 0.70.1 it refuses as the spawn does) is drawn as a refusal, with Spawn off for that reason: not as a preview still to come, nor as a failed read", async () => {
  // What the real kernel (OATS 0.70.5) printed for a PREVIEW on pi where bb has no pi provider.
  const refused = (JSON.parse(readFileSync(join(process.cwd(), "test/fixtures/spawn/spawn-preview-pi-refused.json"), "utf8")) as { error: { code: string; message: string } }).error;
  const slot = await ready({
    spawnPlan: (input) => {
      if (input.harness === "pi") throw new Error(`${refused.code}: ${refused.message}`);
      return answer(input);
    },
  });
  choose(slot, "oats-spawn-harness", "pi");
  const notice = await waitFor(() => {
    const found = column(slot).querySelector('[data-testid="oats-notice"][data-tone="error"]');
    expect(found).not.toBeNull();
    return found!;
  });
  expect([notice.getAttribute("data-tone"), notice.querySelector("h3")!.textContent, notice.querySelector("div p")!.textContent, notice.querySelector(":scope > p")!.textContent]).toEqual([
    "error",
    "This can’t be spawned as it is",
    "bb isn’t ready to launch this agent as chosen. Details says what bb needs; or pick another harness above.",
    "E_BACKEND_NOT_READY",
  ]);
  expect(notice.querySelector('[data-testid="oats-notice-details"]')!.textContent).toContain("bb reports its pi provider as not_installed");
  // Not "no preview yet": nothing is being read, the facts of the earlier values are gone, and Spawn says why it is off.
  expect(column(slot).textContent).not.toMatch(/Reading defaults…|Updating…|numbered by the kernel/);
  expect([submit(slot).disabled, reason(slot)]).toEqual([true, "OATS refused these values: “What will be created” says why."]);
  fireEvent.click(submit(slot));
  fireEvent.keyDown(slot.getByTestId("oats-spawn-task"), { key: "Enter", ctrlKey: true });
  expect(calls(slot, "spawn")).toEqual([]);
  // Another harness, and the form is back.
  choose(slot, "oats-spawn-harness", "claude");
  await waitFor(() => expect(submit(slot).disabled).toBe(false));
});

test("Retry on a refused preview says it is reading, also where no preview was ever read", async () => {
  const waiting: (() => void)[] = [];
  let refuse = true;
  const slot = await form("oats-developer", {
    spawnPlan: (input) => {
      if (refuse) throw new Error("E_MODEL_UNKNOWN: no entry usable by harness claude");
      return new Promise((resolve) => waiting.push(() => resolve(answer(input))));
    },
  });
  await waitFor(() => expect(column(slot).querySelector('[data-testid="oats-notice"][data-tone="error"]')).not.toBeNull());
  expect(slot.queryByTestId("oats-spawn-updating")).toBeNull();
  refuse = false;
  fireEvent.click(slot.getByRole("button", { name: "Retry" }));
  // The notice stays until the answer; the column's head says it is being read again.
  expect(slot.getByTestId("oats-spawn-updating").textContent).toBe("Updating…");
  expect(column(slot).getAttribute("aria-busy")).toBe("true");
  await waitFor(() => expect(waiting).toHaveLength(1));
  await act(async () => waiting[0]!());
  await waitFor(() => expect(column(slot).textContent).toContain("numbered by the kernel"));
  expect(slot.queryByTestId("oats-spawn-updating")).toBeNull();
});

test("what the kernel resolved goes through the display filter in the choices too: a model is a soul's own text", async () => {
  const unsafe = { ...recorded, harness: "pi", model: "fable\u202E5 token=abc123" };
  const slot = await ready({ spawnPlan: () => ({ facts: formFacts(unsafe), revision: REVISION }) });
  const label = slot.getByTestId("oats-spawn-model").textContent!;
  expect(label).toBe("Default · [withheld]▾");
  expect(slot.getByTestId("oats-spawn-form").textContent).not.toMatch(/token=abc123|\u202E/);
});

test("a soul that cannot be spawned says why under the soul, and Spawn is off; a soul the deployment does not list says so", async () => {
  const slot = await form("broken-soul");
  await waitFor(() => expect(slot.getByTestId("oats-spawn-form").querySelector('[role="alert"]')?.textContent).toBe("E_SOUL_INVALID: soul.yaml names a capability that is not installed: oats.missing"));
  expect([submit(slot).disabled, reason(slot)]).toEqual([true, "This soul can’t be spawned: its field says why."]);
  expect(calls(slot, "spawnPlan")).toEqual([]);
  slot.unmount();
  resetApp();
  const unknown = await form("no-such-soul");
  await waitFor(() => expect(unknown.getByTestId("oats-spawn-form").querySelector('[role="alert"]')?.textContent).toBe("OATS lists no soul “no-such-soul” in this deployment. Choose one of these."));
  expect(valueOf(unknown, "oats-spawn-soul")).toBe("");
  expect(reason(unknown)).toBe("Choose a soul first.");
});

test("while OATS cannot be read the form is held like the acts: the roster's own notice, the fields and Spawn off with the acts' reason, and nothing asked of the kernel", async () => {
  const last = { at: new Date(Date.now() - 40 * 60_000).toISOString(), deployment: { root: "/abs/deployment", workspace: "oats", machine: "falcon" }, agents: fixtureAgents() };
  const slot = await form("oats-developer", previews({ snapshot: () => ({ ok: false as const, at: new Date().toISOString(), code: "OATS_NOT_FOUND", message: "oats was not found on falcon: install OATS there", machine: "falcon", last }) }));
  const notice = await slot.findByTestId("oats-unreadable");
  expect(notice.querySelector("h3")!.textContent).toBe("OATS is not installed on falcon");
  expect(notice.textContent).toContain("Read 40 min ago.");
  expect(slot.getAllByTestId("oats-held")).toHaveLength(1);
  expect(fieldset(slot).disabled).toBe(true);
  expect([submit(slot).disabled, reason(slot)]).toEqual([true, "Comes back when OATS is read again"]);
  await new Promise((resolve) => setTimeout(resolve, 500));
  expect(calls(slot, "spawnPlan")).toEqual([]);
  fireEvent.click(submit(slot));
  fireEvent.keyDown(slot.getByTestId("oats-spawn-form"), { key: "Enter", ctrlKey: true });
  expect(calls(slot, "spawn")).toEqual([]);
});

test("held, the column keeps only the facts of the values on screen: those read for other values are not drawn as theirs, nor is the foot", async () => {
  const last = { at: new Date(Date.now() - 40 * 60_000).toISOString(), deployment: { root: "/abs/deployment", workspace: "oats", machine: "falcon" }, agents: fixtureAgents() };
  let stale = false;
  const live = handlers().snapshot;
  const slot = await ready({
    snapshot: (input) => (stale ? { ok: false as const, at: new Date().toISOString(), code: "OATS_NOT_FOUND", message: "oats was not found on falcon: install OATS there", machine: "falcon", last } : live(input)),
    spawnPlan: (input) => (input.name === undefined ? answer(input) : new Promise(() => undefined)),
  });
  // Held with the preview of the values on screen: its facts and its foot stay.
  stale = true;
  await slot.behavior.emitRealtime("oats/changed", { at: new Date().toISOString() });
  await waitFor(() => expect(slot.queryByTestId("oats-unreadable")).not.toBeNull());
  expect(column(slot).textContent).toContain("numbered by the kernel");
  expect(column(slot).textContent).toContain("Resolved by the installed CLI.");
  slot.unmount();
  resetApp();
  // Held while the values on screen have no preview of their own: nothing of another's is drawn.
  stale = false;
  const other = await ready({
    snapshot: (input) => (stale ? { ok: false as const, at: new Date().toISOString(), code: "OATS_NOT_FOUND", message: "oats was not found on falcon: install OATS there", machine: "falcon", last } : live(input)),
    spawnPlan: (input) => (input.name === undefined ? answer(input) : new Promise(() => undefined)),
  });
  set(other, "oats-spawn-name", "ranker-v4-probe");
  await waitFor(() => expect(other.queryByTestId("oats-spawn-updating")).not.toBeNull());
  stale = true;
  await other.behavior.emitRealtime("oats/changed", { at: new Date().toISOString() });
  await waitFor(() => expect(other.queryByTestId("oats-unreadable")).not.toBeNull());
  expect(column(other).textContent).toBe("What will be created");
});

test("Mod+Enter spawns from any field; Enter alone spawns nothing; the Desktop's Mod+digit chords are not the form's, and nothing on screen offers them", async () => {
  const slot = await ready(previews({ spawn: () => ({ instance: "oats-developer-2", threadId: "thr_new" }) }));
  const task = slot.getByTestId("oats-spawn-task");
  task.focus();
  for (const digit of ["1", "2", "3", "4", "6"]) fireEvent.keyDown(task, { key: digit, ctrlKey: true });
  expect(document.activeElement).toBe(task);
  expect(slot.getByTestId("oats-spawn-form").querySelectorAll("fieldset [aria-keyshortcuts]")).toHaveLength(0);
  // The one key the form has is said beside its button.
  expect([submit(slot).getAttribute("aria-keyshortcuts"), submit(slot).getAttribute("type"), slot.getByTestId("oats-spawn-key").textContent]).toEqual(["Control+Enter", "button", "Ctrl+Enter"]);
  // Enter alone: a new line in the instruction, and nothing in a one-line field (the form submits nothing).
  fireEvent.keyDown(task, { key: "Enter" });
  fireEvent.keyDown(slot.getByTestId("oats-spawn-name"), { key: "Enter" });
  expect(fireEvent.submit(slot.getByTestId("oats-spawn-form"))).toBe(false); // the form's own submission is prevented
  expect(calls(slot, "spawn")).toEqual([]);
  fireEvent.keyDown(slot.getByTestId("oats-spawn-name"), { key: "Enter", ctrlKey: true });
  await waitFor(() => expect(calls(slot, "spawn")).toHaveLength(1));
});

test("when the provider's harness list cannot be read the field says so with the code and offers to read it again; a spawn then uses the soul's default", async () => {
  let fail = true;
  const slot = await ready(
    previews({
      spawnHarnesses: () => {
        if (fail) throw new Error('E_CAPABILITY_UNKNOWN: no capability "oats.bb" in this workspace');
        return { harnesses: ["claude", "pi"], hostId: "host_falcon" };
      },
    }),
  );
  const harness = slot.getByTestId("oats-spawn-harness") as HTMLButtonElement;
  expect([harness.disabled, harness.textContent]).toEqual([true, "The soul's default▾"]);
  expect(slot.getByTestId("oats-spawn-form").querySelector('[role="alert"]')!.textContent).toBe("The harnesses bb can run could not be read (E_CAPABILITY_UNKNOWN). A spawn uses the soul’s default until they are.");
  expect(calls(slot, "spawnPlan")).toEqual([{ soul: "oats-developer", task: "" }]);
  fail = false;
  fireEvent.click(slot.getByTestId("oats-spawn-harness-retry"));
  await waitFor(() => expect((slot.getByTestId("oats-spawn-harness") as HTMLButtonElement).disabled).toBe(false));
  expect(slot.queryByTestId("oats-spawn-harness-retry")).toBeNull();
  expect(options(slot, "oats-spawn-harness").map(([label]) => label)).toEqual(["The soul's default: pi", "Claude Code", "pi"]);
});

test("a harness bb cannot run here is marked at the choice and said under the field, from bb's own state; it can still be chosen", async () => {
  const states = () => ({ providers: [{ providerId: "claude-code", status: "ready" }, { providerId: "pi", status: "not_installed" }] });
  const slot = await ready(previews(), { states });
  // The soul's default resolved to pi (the recorded preview): what bb says of pi is under the field before any press.
  const said = "bb has not installed pi on this machine, so a spawn on it is refused. Install it in bb’s settings, or pick another harness.";
  await waitFor(() => expect(slot.getByTestId("oats-spawn-form").textContent).toContain(said));
  expect(options(slot, "oats-spawn-harness").map(([label]) => label)).toEqual(["The soul's default: pi", "Claude Code", "pi · not installed in bb"]);
  fireEvent.click(slot.getByTestId("oats-spawn-harness"));
  expect(slot.getAllByTestId("oats-spawn-harness-option").map((option) => option.hasAttribute("data-unavailable"))).toEqual([false, false, true]);
  fireEvent.keyDown(slot.getByTestId("oats-spawn-harness-options"), { key: "Escape" });
  choose(slot, "oats-spawn-harness", "claude");
  await waitFor(() => expect(slot.getByTestId("oats-spawn-form").textContent).not.toContain(said));
  choose(slot, "oats-spawn-harness", "pi");
  expect(slot.getByTestId("oats-spawn-harness").textContent).toBe("pi · not installed in bb▾");
  expect(slot.getByTestId("oats-spawn-form").textContent).toContain(said);
  await waitFor(() => expect(calls(slot, "spawnPlan").at(-1)).toEqual({ soul: "oats-developer", task: "", harness: "pi" }));
});

test("with one harness declared there is no Harness field: what bb says of that harness is still said, and names no field to pick another in", async () => {
  const slot = await ready(previews({ spawnHarnesses: () => ({ harnesses: ["pi"], hostId: "host_falcon" }) }), { states: () => ({ providers: [{ providerId: "pi", status: "not_installed" }] }) });
  expect(slot.queryByTestId("oats-spawn-harness")).toBeNull();
  await waitFor(() => expect(slot.queryByTestId("oats-spawn-harness-state")).not.toBeNull());
  expect(slot.getByTestId("oats-spawn-harness-state").textContent).toBe("bb has not installed pi on this machine, so a spawn on it is refused. Install it in bb’s settings.");
  expect(slot.getByTestId("oats-spawn-form").textContent).not.toMatch(/pick another harness/);
});

test("while bb has not said what it can run, or says a state the plugin does not know, nothing is marked", async () => {
  const slot = await ready(previews(), { states: () => ({ providers: [{ providerId: "pi", status: "unknown" }, { providerId: "claude-code", status: "something-new" }] }) });
  expect(options(slot, "oats-spawn-harness").map(([label]) => label)).toEqual(["The soul's default: pi", "Claude Code", "pi"]);
  expect(slot.getByTestId("oats-spawn-form").textContent).not.toMatch(/so a spawn on it is refused/);
});

test("a refusal sends a person to the Harness field only where the form has one", async () => {
  const refuse = { spawnPlan: () => { throw new Error("E_BACKEND_HARNESS: the bb session provider cannot launch codex"); } };
  const one = await form("oats-developer", { ...refuse, spawnHarnesses: () => ({ harnesses: ["claude"], hostId: "host_falcon" }) });
  await waitFor(() => expect(column(one).querySelector('[data-testid="oats-notice"] div p')?.textContent).toBe("bb can’t run the harness this soul would use. See Details."));
  expect(one.queryByTestId("oats-spawn-harness")).toBeNull();
});

test("a choice by the keys: an arrow opens it, the arrows move past what cannot be chosen, Enter chooses, Escape closes; the focus is back on the field", async () => {
  const slot = await form("");
  const soul = await slot.findByTestId("oats-spawn-soul");
  await waitFor(() => expect((soul as HTMLButtonElement).disabled).toBe(false));
  expect([soul.getAttribute("role"), soul.getAttribute("aria-haspopup"), soul.getAttribute("aria-expanded")]).toEqual(["combobox", "listbox", "false"]);
  fireEvent.keyDown(soul, { key: "ArrowDown" });
  const list = slot.getByTestId("oats-spawn-soul-options");
  expect([soul.getAttribute("aria-expanded"), list.getAttribute("role"), document.activeElement]).toEqual(["true", "listbox", list]);
  const active = () => slot.getAllByTestId("oats-spawn-soul-option").filter((option) => option.getAttribute("data-active") === "true").map((option) => option.getAttribute("data-value"));
  expect(active()).toEqual(["oats-developer"]);
  expect(list.getAttribute("aria-activedescendant")).toBe(slot.getAllByTestId("oats-spawn-soul-option")[0]!.id);
  // The soul that cannot be spawned can still be chosen, to read why: it is not skipped.
  fireEvent.keyDown(list, { key: "ArrowDown" });
  expect(active()).toEqual(["broken-soul"]);
  fireEvent.keyDown(list, { key: "Escape" });
  expect([slot.queryByTestId("oats-spawn-soul-options"), document.activeElement, valueOf(slot, "oats-spawn-soul")]).toEqual([null, soul, ""]);
  fireEvent.keyDown(soul, { key: "ArrowDown" });
  fireEvent.keyDown(slot.getByTestId("oats-spawn-soul-options"), { key: "Enter" });
  expect([valueOf(slot, "oats-spawn-soul"), document.activeElement]).toEqual(["oats-developer", soul]);
  expect(calls(slot, "spawn")).toEqual([]); // the list's Enter is not the form's
});

test("Cancel goes back to where the person was", async () => {
  const slot = await ready();
  let back = 0;
  const original = window.history.back;
  window.history.back = () => void back++;
  try {
    fireEvent.click(slot.getByTestId("oats-spawn-cancel"));
  } finally {
    window.history.back = original;
  }
  expect(back).toBe(1);
});
