// @vitest-environment jsdom
// The New agent form (app/spawn/Page.tsx), a page of its own: the fields in the Desktop's order
// and words, the standing "What will be created" column from the kernel's preview, Spawn with its
// reason when it is off, a refusal in a person's words, the held state, the keys.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { act, fireEvent, waitFor } from "@testing-library/react";
import { renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { openNewAgent } from "../../app/workspace/pages";
import { previewFacts } from "../../model/spawn";
import { fixtureAgents } from "../helpers/fixtures";
import { handlers, loadApp, resetApp, sidebarThreads } from "../helpers/render";
import type { Contract, Handlers } from "../helpers/render";

afterEach(resetApp);

const recorded = (JSON.parse(readFileSync(join(process.cwd(), "test/fixtures/spawn/spawn-preview.json"), "utf8")) as { result: Record<string, unknown> }).result;
const REVISION = "f48a98cea8a3a34508aab024";
type Choices = { soul: string; name?: string; task: string; harness?: string; model?: string; relation?: { kind: string; to: string } };
/** The server's answer for a preview: the recorded preview's facts, for the name asked. */
const answer = (input: Choices) => ({ facts: previewFacts(recorded, { name: input.name ?? null }), revision: REVISION });
const previews = (over: Partial<Handlers> = {}): Partial<Handlers> => ({ spawnPreview: (input) => answer(input), ...over });

type Options = { settings?: Record<string, string>; models?: () => unknown };
async function form(subPath: string, over: Partial<Handlers> = previews(), options: Options = {}) {
  const app = await loadApp();
  const panel = app.navPanels.find((candidate) => candidate.id === "new-agent")!;
  return renderSlot<{ subPath: string }, Contract>(panel, { subPath }, {
    rpc: handlers(over),
    sidebarThreads: sidebarThreads(),
    ...(options.settings === undefined ? {} : { settings: options.settings }),
    sdk: { providers: { models: (async () => (options.models ?? (() => ({ modelLoadError: null, models: [] })))()) as never } },
  });
}
type Slot = Awaited<ReturnType<typeof form>>;
const calls = (slot: Slot, method: string) => slot.inspection.rpcCalls.filter((call) => call.method === method).map((call) => call.input as Record<string, unknown>);
const set = (slot: Slot, testId: string, value: string) => fireEvent.change(slot.getByTestId(testId), { target: { value } });
const submit = (slot: Slot) => slot.getByTestId("oats-spawn-submit") as HTMLButtonElement;
const reason = (slot: Slot) => slot.queryByTestId("oats-disabled-reason")?.textContent ?? null;
const column = (slot: Slot) => slot.getByTestId("oats-spawn-preview");
/** The form with a soul chosen, once its first preview is on screen. */
async function ready(over: Partial<Handlers> = previews(), options: Options = {}) {
  const slot = await form("oats-developer", over, options);
  await waitFor(() => expect(column(slot).textContent).toContain("numbered by the kernel"));
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
  const soul = (await slot.findByTestId("oats-spawn-soul")) as HTMLSelectElement;
  await waitFor(() => expect(Array.from(soul.options).map((option) => option.textContent)).toEqual(["Choose a soul…", "oats-developer", "broken-soul"]));
  expect(slot.getByTestId("oats-spawn-title").textContent).toBe("New agent");
  // The fields, in the Desktop's order after the soul, by their labels.
  expect(Array.from(slot.getByTestId("oats-spawn-form").querySelectorAll("label, #oats-spawn-relation-label")).map((label) => label.textContent)).toEqual(["Soul", "Opening instruction · optional", "Harness", "Model", "Relationship", "Name · optional"]);
  expect(slot.getByTestId("oats-spawn-form").querySelector("select, textarea, input")).toBe(soul);
  await waitFor(() => expect(document.activeElement).toBe(soul));
  expect(submit(slot).disabled).toBe(true);
  expect(submit(slot).textContent).toBe("Spawn");
  expect(reason(slot)).toBe("Choose a soul first.");
  expect(column(slot).textContent).toBe("What will be createdChoose a soul to see what will be created.");
  expect(calls(slot, "spawnPreview")).toEqual([]);
  // Choosing one names the page as the Desktop names its dialog, says the soul's description, and reads the preview.
  set(slot, "oats-spawn-soul", "oats-developer");
  expect(slot.getByTestId("oats-spawn-title").textContent).toBe("Spawn oats-developer in oats");
  expect(slot.getByTestId("oats-spawn-form").textContent).toContain("Builds and proves one spec.");
  await waitFor(() => expect(calls(slot, "spawnPreview")).toEqual([{ soul: "oats-developer", task: "" }]));
});

test("opened from a soul: that soul is chosen, the focus is on the instruction, and an empty form can be spawned: no name, no instruction", async () => {
  const slot = await ready();
  expect((slot.getByTestId("oats-spawn-soul") as HTMLSelectElement).value).toBe("oats-developer");
  expect(document.activeElement).toBe(slot.getByTestId("oats-spawn-task"));
  expect((slot.getByTestId("oats-spawn-task") as HTMLTextAreaElement).placeholder).toBe("What should this instance do? Empty starts it waiting for you.");
  expect(calls(slot, "spawnPreview")).toEqual([{ soul: "oats-developer", task: "" }]);
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
  const slot = await ready({ spawnPreview: (input) => ({ facts: previewFacts(quiet, { name: input.name ?? null }), revision: REVISION }) });
  const facts = Array.from(column(slot).querySelectorAll('[data-testid="oats-fact"]')).map((fact) => [fact.querySelector("dt")!.textContent, fact.querySelector("dd")!.textContent]);
  expect(facts).toEqual([
    ["Name", "numbered by the kernel"],
    ["Home", "agents/oats-developer/instances/flaky-ci-2-developer"],
    ["Works in", "worktree · branch agents/flaky-ci-2-developer from github.com/awebai/oats"],
    ["Harness", "pi · github-copilot/claude-fable-5.1this computer's default for every soul"],
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
  expect(calls(slot, "spawnPreview").at(-1)).toEqual({ soul: "oats-developer", task: "", name: "ranker-v4-probe" });
});

test("a warning of the kernel's is drawn as a warning, through the display filter", async () => {
  const warned = { ...recorded, warnings: ["the bb server runs bb-app 0.60.0; the capability was tested up to 0.50.1", "the hook printed token: abc123"] };
  const slot = await form("oats-developer", { spawnPreview: () => ({ facts: previewFacts(warned), revision: REVISION }) });
  await waitFor(() => expect(column(slot).querySelectorAll('[data-testid="oats-notice"][data-tone="warning"]')).toHaveLength(2));
  const notices = Array.from(column(slot).querySelectorAll('[data-testid="oats-notice"]')).map((notice) => notice.textContent);
  expect(notices).toEqual(["OATS warnsthe bb server runs bb-app 0.60.0; the capability was tested up to 0.50.1", "OATS warns[withheld]"]);
});

test("the harness: the soul's default passes nothing and says what the kernel resolved; a listed one is passed; with one harness there is no field", async () => {
  const slot = await ready();
  const harness = slot.getByTestId("oats-spawn-harness") as HTMLSelectElement;
  expect(Array.from(harness.options).map((option) => option.textContent)).toEqual(["The soul's default: pi", "Claude Code", "pi"]);
  set(slot, "oats-spawn-harness", "claude");
  await waitFor(() => expect(calls(slot, "spawnPreview").at(-1)).toEqual({ soul: "oats-developer", task: "", harness: "claude" }));
  slot.unmount();
  resetApp();
  const one = await ready(previews({ spawnHarnesses: () => ({ harnesses: ["claude"], hostId: "host_falcon" }) }));
  expect(one.queryByTestId("oats-spawn-harness")).toBeNull();
  expect(calls(one, "spawnPreview")).toEqual([{ soul: "oats-developer", task: "" }]);
});

test("the model: Default says what the kernel resolved and passes nothing; a suggestion of bb's or a typed id is passed", async () => {
  const bbModel = (model: string, displayName = model) => ({ id: model, model, displayName, description: "", isDefault: false, defaultReasoningEffort: "medium" });
  const slot = await ready(previews(), { models: () => ({ modelLoadError: null, models: [bbModel("anthropic/claude-sonnet-5", "Claude Sonnet 5")] }) });
  const model = slot.getByTestId("oats-spawn-model") as HTMLSelectElement;
  await waitFor(() => expect(Array.from(model.options).map((option) => option.textContent)).toEqual(["Default · github-copilot/claude-fable-5.1", "Claude Sonnet 5 · anthropic/claude-sonnet-5", "Custom…"]));
  set(slot, "oats-spawn-model", "anthropic/claude-sonnet-5");
  await waitFor(() => expect(calls(slot, "spawnPreview").at(-1)).toEqual({ soul: "oats-developer", task: "", model: "anthropic/claude-sonnet-5" }));
  // Custom…: a field for the id; until one is typed Spawn is off and says why.
  fireEvent.change(model, { target: { value: model.options[2]!.value } });
  const typed = slot.getByTestId("oats-spawn-model-id") as HTMLInputElement;
  expect(typed.placeholder).toBe("Type a model ID");
  expect([submit(slot).disabled, reason(slot)]).toEqual([true, "Type the model ID, or choose Default."]);
  fireEvent.change(typed, { target: { value: " openai/o3 " } });
  await waitFor(() => expect(calls(slot, "spawnPreview").at(-1)).toEqual({ soul: "oats-developer", task: "", model: "openai/o3" }));
  expect(submit(slot).disabled).toBe(false);
});

test("with no model bb reports, the field is Default and Custom…, and says any id can be typed", async () => {
  const slot = await ready();
  await waitFor(() => expect(slot.getByTestId("oats-spawn-form").textContent).toContain("No model suggestions reported. Any model ID can be typed."));
  expect(Array.from((slot.getByTestId("oats-spawn-model") as HTMLSelectElement).options).map((option) => option.textContent)).toEqual(["Default · github-copilot/claude-fable-5.1", "Custom…"]);
});

test("the relationship: Independent at the start; a relation needs its instance, one of the roster, and is passed with it", async () => {
  const slot = await ready();
  const line = () => slot.getByTestId("oats-spawn-relation-line").textContent;
  expect(Array.from(slot.getByTestId("oats-spawn-relation").querySelectorAll('[role="radio"]')).map((radio) => [radio.textContent, radio.getAttribute("aria-checked")])).toEqual([["Independent", "true"], ["Child of", "false"], ["Sibling of", "false"], ["Parent of", "false"]]);
  expect(line()).toBe("Independent — not linked to another instance.");
  expect(slot.queryByTestId("oats-spawn-relative")).toBeNull();
  fireEvent.click(slot.getByRole("radio", { name: "Child of" }));
  const which = slot.getByTestId("oats-spawn-relative") as HTMLSelectElement;
  expect(which.getAttribute("aria-label")).toBe("Child of which instance?");
  expect(Array.from(which.options).slice(1).map((option) => option.value)).toEqual(fixtureAgents().map((agent) => agent.instance));
  expect(line()).toBe("Pick the instance this one is a child of.");
  expect([submit(slot).disabled, reason(slot)]).toEqual([true, "Pick the instance first, or choose Independent."]);
  set(slot, "oats-spawn-relative", "flaky-ci-developer");
  expect(line()).toBe("Spawns as a child of Flaky ci developer.");
  await waitFor(() => expect(calls(slot, "spawnPreview").at(-1)).toEqual({ soul: "oats-developer", task: "", relation: { kind: "child", to: "flaky-ci-developer" } }));
  expect(submit(slot).disabled).toBe(false);
});

test("a name the kernel would refuse never leaves the form: the fault is said under it, and beside Spawn", async () => {
  const slot = await ready();
  const asked = calls(slot, "spawnPreview").length;
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
  expect(calls(slot, "spawnPreview")).toHaveLength(asked);
  fireEvent.submit(slot.getByTestId("oats-spawn-form"));
  expect(calls(slot, "spawn")).toEqual([]);
});

test("a name the kernel refuses at the preview is said under the name, in a person's words", async () => {
  const slot = await ready({
    spawnPreview: (input) => {
      if (input.name === "flaky-ci-developer") throw new Error('E_INSTANCE_NAME_TAKEN: instance name "flaky-ci-developer" is taken');
      return answer(input);
    },
  });
  set(slot, "oats-spawn-name", "flaky-ci-developer");
  await waitFor(() => expect(slot.getByTestId("oats-spawn-form").querySelector('[role="alert"]')?.textContent).toBe("An instance with this name already exists. Choose another name."));
  expect([submit(slot).disabled, reason(slot)]).toEqual([true, "The name can’t be used: its field says why."]);
  expect(column(slot).querySelector('[data-testid="oats-notice"]')).toBeNull();
});

test("Spawn applies the decision the preview showed, once, and opens the new agent's thread", async () => {
  const slot = await ready(previews({ spawn: () => ({ instance: "ranker-v4-probe", threadId: "thr_new" }) }));
  set(slot, "oats-spawn-task", "Try depth 7.");
  set(slot, "oats-spawn-name", "ranker-v4-probe");
  await waitFor(() => expect(column(slot).querySelector("dd")!.textContent).toBe("ranker-v4-probe"));
  await waitFor(() => expect(slot.queryByTestId("oats-spawn-updating")).toBeNull());
  fireEvent.click(submit(slot));
  await waitFor(() => expect(slot.inspection.navigateCalls).toEqual([{ method: "toThread", threadId: "thr_new" }]));
  const [spawned] = calls(slot, "spawn");
  expect(spawned).toEqual({ soul: "oats-developer", task: "Try depth 7.", name: "ranker-v4-probe", revision: REVISION, key: expect.stringMatching(/^[0-9a-f]{32}$/) });
  expect(calls(slot, "spawn")).toHaveLength(1);
  expect(slot.getByTestId("oats-spawn-status").textContent).toBe("Created Ranker v4 probe. Opening its thread…");
});

test("while it spawns the button says so and the fields are held", async () => {
  let finish: (value: { instance: string; threadId: string }) => void = () => undefined;
  const slot = await ready(previews({ spawn: () => new Promise((resolve) => (finish = resolve)) }));
  fireEvent.click(submit(slot));
  await waitFor(() => expect(submit(slot).textContent).toBe("Spawning…"));
  expect([submit(slot).disabled, submit(slot).getAttribute("aria-busy")]).toEqual([true, "true"]);
  expect((slot.getByTestId("oats-spawn-form").querySelector("fieldset") as HTMLFieldSetElement).disabled).toBe(true);
  // Left, and opened again meanwhile: the form says a spawn of this soul is in progress and starts no second one.
  slot.unmount();
  const again = await form("oats-developer");
  await waitFor(() => expect(again.getByTestId("oats-disabled-reason").textContent).toBe("A spawn of oats-developer is in progress."));
  expect((again.getByTestId("oats-spawn-submit") as HTMLButtonElement).disabled).toBe(true);
  await act(async () => finish({ instance: "oats-developer-2", threadId: "thr_new" }));
  await waitFor(() => expect(again.queryByTestId("oats-disabled-reason")).toBeNull());
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
  const details = slot.getByTestId("oats-spawn-details");
  expect(details.hasAttribute("open")).toBe(false);
  expect(details.querySelector("p")!.textContent).toBe("oats.build: the worktree hook exited 2 npm ci failed");
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
  await waitFor(() => expect(calls(slot, "spawnPreview").at(-1)).toEqual({ soul: "oats-developer", task: "Another." }));
  await waitFor(() => expect(slot.queryByTestId("oats-spawn-updating")).toBeNull());
  fireEvent.click(submit(slot));
  await waitFor(() => expect(calls(slot, "spawn")).toHaveLength(3));
  expect(calls(slot, "spawn")[2]!.key).not.toBe(calls(slot, "spawn")[0]!.key);
});

test("a decision that moved before the spawn: nothing was created, the words say so, and what will be created is read again", async () => {
  const slot = await ready(
    previews({
      spawn: () => {
        throw new Error("E_DECISION_STALE: the decision moved");
      },
    }),
  );
  const before = calls(slot, "spawnPreview").length;
  fireEvent.click(submit(slot));
  expect((await slot.findByTestId("oats-result")).querySelector("p")!.textContent).toBe("Something changed before the spawn went through. Nothing was created — check the updated values and press Spawn again.");
  await waitFor(() => expect(calls(slot, "spawnPreview")).toHaveLength(before + 1));
});

test("an outcome that is not known: the button becomes Check result and asks again with the same key", async () => {
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
  expect(result.querySelector("h3")!.textContent).toBe("It is not known whether the agent was spawned");
  expect(result.querySelector("p")!.textContent).toBe("OATS took too long to answer. The instance may already exist. Check the agents in the sidebar before spawning again.");
  expect(submit(slot).textContent).toBe("Check result");
  fireEvent.click(submit(slot));
  await waitFor(() => expect(slot.inspection.navigateCalls).toEqual([{ method: "toThread", threadId: "thr_new" }]));
  expect(calls(slot, "spawn")[1]!.key).toBe(calls(slot, "spawn")[0]!.key);
});

test("a press before the preview of these values answered is kept: it spawns when the preview does, and not when the values changed meanwhile", async () => {
  const waiting: ((value: ReturnType<typeof answer>) => void)[] = [];
  const slot = await form("oats-developer", {
    spawnPreview: (input) => new Promise((resolve) => waiting.push(() => resolve(answer(input)))),
    spawn: () => ({ instance: "oats-developer-2", threadId: "thr_new" }),
  });
  await slot.findByTestId("oats-spawn-form");
  await waitFor(() => expect(waiting).toHaveLength(1));
  expect(slot.getByTestId("oats-spawn-status").textContent).toBe("Reading defaults…");
  expect(column(slot).textContent).toContain("Reading defaults…");
  fireEvent.click(submit(slot));
  expect(submit(slot).textContent).toBe("Checking…");
  // The values change while it waits: the press is not for them.
  set(slot, "oats-spawn-task", "Changed.");
  await waitFor(() => expect(slot.getByTestId("oats-spawn-status").textContent).toBe("Changed: press Spawn again"));
  expect(submit(slot).textContent).toBe("Spawn");
  await waitFor(() => expect(waiting).toHaveLength(2));
  await act(async () => waiting[0]!(answer({ soul: "oats-developer", task: "" })));
  expect(calls(slot, "spawn")).toEqual([]);
  // Pressed again, for the values on screen: it goes when their preview answers.
  fireEvent.click(submit(slot));
  await act(async () => waiting[1]!(answer({ soul: "oats-developer", task: "Changed." })));
  await waitFor(() => expect(calls(slot, "spawn")).toHaveLength(1));
  expect(calls(slot, "spawn")[0]).toMatchObject({ task: "Changed.", revision: REVISION });
});

test("while the values on screen are being read again the last facts stay, marked Updating…; an answer for values that are gone is never drawn", async () => {
  const waiting = new Map<string, (value: ReturnType<typeof answer>) => void>();
  let hold = false;
  const slot = await ready({
    spawnPreview: (input) => (hold ? new Promise((resolve) => waiting.set(input.name ?? "", resolve)) : answer(input)),
  });
  hold = true;
  set(slot, "oats-spawn-name", "first-probe");
  await waitFor(() => expect(waiting.has("first-probe")).toBe(true));
  expect(slot.getByTestId("oats-spawn-updating").textContent).toBe("Updating…");
  expect(column(slot).textContent).toContain("numbered by the kernel");
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
    spawnPreview: (input) => {
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
  expect(submit(slot).disabled).toBe(false);
});

test("a soul that cannot be spawned says why under the soul, and Spawn is off; a soul the deployment does not list says so", async () => {
  const slot = await form("broken-soul");
  await waitFor(() => expect(slot.getByTestId("oats-spawn-form").querySelector('[role="alert"]')?.textContent).toBe("E_SOUL_INVALID: soul.yaml names a capability that is not installed: oats.missing"));
  expect([submit(slot).disabled, reason(slot)]).toEqual([true, "This soul can’t be spawned: its field says why."]);
  expect(calls(slot, "spawnPreview")).toEqual([]);
  slot.unmount();
  resetApp();
  const unknown = await form("no-such-soul");
  await waitFor(() => expect(unknown.getByTestId("oats-spawn-form").querySelector('[role="alert"]')?.textContent).toBe("OATS lists no soul “no-such-soul” in this deployment. Choose one of these."));
  expect((unknown.getByTestId("oats-spawn-soul") as HTMLSelectElement).value).toBe("");
  expect(reason(unknown)).toBe("Choose a soul first.");
});

test("while OATS cannot be read the form is held like the acts: the roster's own notice, the fields and Spawn off with the acts' reason, and nothing asked of the kernel", async () => {
  const last = { at: new Date(Date.now() - 40 * 60_000).toISOString(), deployment: { root: "/abs/deployment", workspace: "oats", machine: "falcon" }, agents: fixtureAgents() };
  const slot = await form("oats-developer", previews({ snapshot: () => ({ ok: false as const, at: new Date().toISOString(), code: "OATS_NOT_FOUND", message: "oats was not found on falcon: install OATS there", machine: "falcon", last }) }));
  const notice = await slot.findByTestId("oats-unreadable");
  expect(notice.querySelector("h3")!.textContent).toBe("OATS is not installed on falcon");
  expect(notice.textContent).toContain("Showing what was read 40 min ago.");
  expect(slot.getAllByTestId("oats-held")).toHaveLength(1);
  expect((slot.getByTestId("oats-spawn-form").querySelector("fieldset") as HTMLFieldSetElement).disabled).toBe(true);
  expect([submit(slot).disabled, reason(slot)]).toEqual([true, "Comes back when OATS is read again"]);
  await new Promise((resolve) => setTimeout(resolve, 500));
  expect(calls(slot, "spawnPreview")).toEqual([]);
  fireEvent.submit(slot.getByTestId("oats-spawn-form"));
  expect(calls(slot, "spawn")).toEqual([]);
});

test("the form's keys: Mod+Enter spawns, Mod+1, 2, 3, 4 and 6 go to the instruction, the harness, the model, the relationship and the name", async () => {
  const slot = await ready(previews({ spawn: () => ({ instance: "oats-developer-2", threadId: "thr_new" }) }));
  const key = (name: string, on: Element = slot.getByTestId("oats-spawn-soul")) => fireEvent.keyDown(on, { key: name, ctrlKey: true });
  for (const [digit, field] of [["6", "oats-spawn-name"], ["2", "oats-spawn-harness"], ["3", "oats-spawn-model"], ["1", "oats-spawn-task"]] as const) {
    key(digit);
    expect(document.activeElement, digit).toBe(slot.getByTestId(field));
    expect(slot.getByTestId(field).getAttribute("aria-keyshortcuts")).toBe(`Control+${digit}`);
  }
  key("4");
  expect(document.activeElement).toBe(slot.getByRole("radio", { name: "Independent" }));
  // Without the modifier a digit is a digit, and 5 and 7 (Teams, Developer settings) are not this form's yet.
  fireEvent.keyDown(slot.getByTestId("oats-spawn-task"), { key: "6" });
  key("5");
  key("7");
  expect(document.activeElement).toBe(slot.getByRole("radio", { name: "Independent" }));
  expect(slot.getByTestId("oats-spawn-keys").textContent).toBe("Keys: Ctrl+Enter spawns · Ctrl+1 Opening instruction · Ctrl+2 Harness · Ctrl+3 Model · Ctrl+4 Relationship · Ctrl+6 Name");
  key("Enter", slot.getByTestId("oats-spawn-task"));
  await waitFor(() => expect(calls(slot, "spawn")).toHaveLength(1));
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
