// model/spawn.ts: the facts of a spawn's preview against what the real kernel printed
// (test/fixtures/spawn/spawn-preview.json), and a refusal in a person's words. The Desktop's own
// tests of the same functions are in awebai/oats packages/client/test and
// packages/desktop/test/spawn-words.test.mjs.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { formFacts, harnessLabel, homeText, launchFromText, modelCheck, MODEL_HELD, moduleSourceText, withoutDefault, previewFacts, relationText, spawnProblem, worksInText } from "../../model/spawn";

const recorded = (name: string): Record<string, unknown> => (JSON.parse(readFileSync(join(process.cwd(), "test/fixtures/spawn", name), "utf8")) as { result: Record<string, unknown> }).result;
const preview = recorded("spawn-preview.json");

describe("what will be created, from the kernel's preview", () => {
  it("says the name and the home, where it works, the harness and model with where they came from, and the team", () => {
    const facts = previewFacts(preview, { name: "flaky-ci-2-developer" });
    expect(facts.identity).toEqual([
      { label: "Name", text: "flaky-ci-2-developer" },
      { label: "Home", text: "agents/oats-developer/instances/flaky-ci-2-developer", title: "/abs/deployment/agents/oats-developer/instances/flaky-ci-2-developer" },
    ]);
    expect(facts.facts).toEqual([
      { label: "Works in", parts: [{ text: "worktree · branch " }, { text: "agents/flaky-ci-2-developer", mono: true }, { text: " from github.com/awebai/oats" }] },
      { label: "Harness", parts: [{ text: "pi · github-copilot/claude-fable-5.1" }, { text: "this computer's default for every soul", sub: true }] },
      { label: "Team", parts: [{ text: "oats" }, { text: " · default", muted: true }] },
    ]);
    expect(facts.resolved).toEqual({ harness: "pi", model: "github-copilot/claude-fable-5.1" });
    expect(facts.prompts).toBeNull();
  });

  it("the capabilities: the core slots in their order, an empty one said as empty, then the others by name with where each is from", () => {
    const { modules } = previewFacts(preview);
    expect(modules!.core.map((slot) => [slot.label, slot.module?.name ?? null])).toEqual([["Knowledge", null], ["Messaging", "oats.aweb"], ["Tasks", null]]);
    expect(modules!.caps.map((module) => module.name)).toEqual(["oats.build", "oats.core", "oats.developer", "oats.landing-rules"]);
    expect(modules!.caps.every((module) => module.source !== "")).toBe(true);
    expect(previewFacts({}).modules).toBeNull();
  });

  it("with no name the kernel numbers it; where the kernel will be asked for one, what derives from the name is left out", () => {
    expect(previewFacts(preview).identity[0]).toEqual({ label: "Name", text: "numbered by the kernel", muted: true });
    const pending = previewFacts(preview, { unnamed: "named from its task" });
    expect(pending.identity).toEqual([{ label: "Name", text: "named from its task", muted: true }]);
    expect(pending.facts[0]).toEqual({ label: "Works in", parts: [{ text: "own worktree" }] });
  });

  it("a relationship with its anchor, the setup a worktree needs, the launch prompts and the teams it may also join", () => {
    const facts = previewFacts({
      ...preview,
      relation: "child",
      decision: { effective: { relation: { anchor: { instance: "api-2" } } } },
      worktreeHooks: [{ capability: "oats.build", required: true }, { capability: "acme.cache" }],
      launchPromptAnswers: { awebDevelopmentChannel: true, consentSource: "oats-local.yaml" },
      teams: [{ label: "oats" }, { label: "ops" }, { label: "docs" }],
      warnings: ["first line\nsecond line"],
    });
    expect(facts.facts.slice(2)).toEqual([
      { label: "Team", parts: [{ text: "oats" }, { text: " · default", muted: true }, { text: "may also join ops, docs", sub: true }] },
      { label: "Relationship", parts: [{ text: "child of api-2" }] },
      { label: "Setup", parts: [{ text: "oats.build (required), acme.cache" }, { text: "Runs after the worktree is made. Can take several minutes.", sub: true }] },
    ]);
    expect(facts.prompts).toEqual([
      { label: "Launch prompts", text: "The launcher will answer the aweb development-channel confirmation for this home. This policy does not confirm readiness. A harness update can block the launch until its prompt fixtures are refreshed; no fallback key is sent." },
      { label: "Prompt consent source", text: "oats-local.yaml", mono: true },
    ]);
    expect(facts.warnings).toEqual([["first line", "second line"]]);
    expect(previewFacts({ launchPromptAnswers: {} }).prompts).toEqual([{ label: "Launch prompts", text: "None. The launcher will not answer prompts for this home. This policy does not confirm readiness." }]);
  });

  it("the words of each part", () => {
    expect(["worktree", "checkout", "attached", "directory", "workspace", "newer"].map(worksInText)).toEqual(["own worktree", "shared checkout", "a parent's worktree", "own folder · free to work across repos", "all member repos", "newer"]);
    expect(homeText("/elsewhere/a/b/c/d", "/abs/deployment")).toEqual({ text: "…/b/c/d", title: "/elsewhere/a/b/c/d" });
    expect(homeText("", "/x")).toBeNull();
    expect([harnessLabel("claude"), harnessLabel("pi"), harnessLabel("codex")]).toEqual(["Claude Code", "pi", "codex"]);
    expect([launchFromText("flag"), launchFromText("soul"), launchFromText("later")]).toEqual(["chosen for this spawn", "the soul's preference", "from: later"]);
    expect([relationText({ relation: "sibling" }), relationText({ relation: null }), relationText({ relation: "newer" })]).toEqual(["sibling of", null, "newer"]);
    expect([moduleSourceText({ kind: "package", package: "oats.aweb", version: "1.2.0" }), moduleSourceText({ kind: "member", repoKey: "github.com/acme/agents.git" }), moduleSourceText({ kind: "local" }), moduleSourceText(null)]).toEqual(["package oats.aweb 1.2.0", "agents · latest", "local", ""]);
  });

  it("a team said by a kernel from before the default, and none at all", () => {
    expect(previewFacts({ team: "oats" }).facts).toEqual([{ label: "Team", parts: [{ text: "oats" }] }]);
    expect(previewFacts({ defaultTeam: null, teams: [] }).facts).toEqual([{ label: "Team", parts: [{ text: "none", muted: true }] }]);
  });
});

describe("a refusal, in a person's words, with what to do", () => {
  it("at the preview: the Desktop's sentence, then the form's own words for what follows; the kernel's message for Details", () => {
    expect(spawnProblem({ code: "E_INSTANCE_NAME_TAKEN", message: "instance flaky-ci-2-developer exists" })).toEqual({ sentence: "An instance with this name already exists. Choose another name.", next: null, code: "E_INSTANCE_NAME_TAKEN", detail: "instance flaky-ci-2-developer exists", outcome: "refused" });
    // The form has no Developer settings yet: no sentence names a control that is not there.
    expect(spawnProblem({ code: "E_BRANCH_EXISTS", message: null }).sentence).toBe("That branch already exists. Its name comes from the agent’s: choose another name.");
    expect(spawnProblem({ code: "E_BAD_ARGS", message: "x" }).sentence).toBe("Some of these values can’t be used. Check the values above.");
    expect(spawnProblem({ code: "E_LAUNCH_EXECUTABLE", message: "pi is not on PATH" }).sentence).toBe("The chosen launch configuration can’t start on this machine. Pick a harness above, or see Details.");
    for (const code of ["E_BAD_ARGS", "E_BRANCH_EXISTS", "E_BASE_UNKNOWN", "E_LAUNCH_ENV_MISSING", "E_LAUNCH_EXECUTABLE", "E_LAUNCH_PROBE_UNSUPPORTED", "E_LAUNCH_CONFIG_UNKNOWN", "E_LAUNCH_CONFIG_AMBIGUOUS", "E_LAUNCH_PREFERENCE_UNMATCHED"]) {
      for (const stage of ["preview", "spawn"] as const) expect(spawnProblem({ code, message: null }, stage).sentence, code).not.toMatch(/Developer settings/);
    }
    // The bb session provider's own refusals, in the plugin's words.
    expect(spawnProblem({ code: "E_BACKEND_HARNESS", message: "the bb session provider cannot launch codex" })).toEqual({ sentence: "bb can’t run the harness this soul would use. Pick one of the harnesses above.", next: "change-options", code: "E_BACKEND_HARNESS", detail: "the bb session provider cannot launch codex", outcome: "refused" });
    expect(spawnProblem({ code: "E_BACKEND_NOT_READY", message: "bb reports its pi provider as not_installed" }, "spawn").sentence).toBe("bb isn’t ready to launch this agent, so the spawn was rolled back. Nothing was created. Details says what bb needs.");
    // As the real kernel printed it for a spawn on pi where bb has no pi provider: rolled back, and its words are the detail.
    const refused = (JSON.parse(readFileSync(join(process.cwd(), "test/fixtures/spawn/spawn-pi-refused.json"), "utf8")) as { error: { code: string; message: string } }).error;
    const problem = spawnProblem(refused, "spawn");
    expect([problem.code, problem.sentence]).toEqual(["E_BACKEND_NOT_READY", "bb isn’t ready to launch this agent, so the spawn was rolled back. Nothing was created. Details says what bb needs."]);
    expect(problem.detail).toMatch(/bb reports its pi provider as not_installed.*spawn rolled back$/);
    // The provider's refusal of a pi model at the launch, as the real kernel printed it (oats-bb #65's provider): rolled back,
    // nothing made; the kernel's whole message is the sentence, once (no Details beside it), and the outcome is a refusal.
    const model = (JSON.parse(readFileSync(join(process.cwd(), "test/fixtures/spawn/spawn-pi-model-refused.json"), "utf8")) as { error: { code: string; message: string } }).error;
    expect(spawnProblem(model, "spawn")).toEqual({
      sentence: "session backend bb refused to launch shape-refused: pi has no model \"claude-fable-9\" (if you just added it to pi, try again in a minute) — spawn rolled back",
      next: null,
      code: "E_BACKEND_LAUNCH_ARG",
      detail: null,
      outcome: "refused",
    });
    // The message goes through the display filter: a control character of direction is not drawn as it came.
    expect(spawnProblem({ code: "E_BACKEND_LAUNCH_ARG", message: "pi has no model \u202Ex" }, "spawn").sentence).toBe("pi has no model \uFFFDx");
    // And one the filter withholds (a credential) is never drawn as the sentence: the stage's general one, and Details (which withholds it too).
    const hidden = spawnProblem({ code: "E_BACKEND_LAUNCH_ARG", message: "pi has no model x: token=abcdef" }, "spawn");
    expect([hidden.sentence, hidden.outcome, hidden.detail]).toEqual(["OATS couldn’t complete the spawn. Try again, or see Details.", "refused", "pi has no model x: token=abcdef"]);
    // From OATS 0.70.1 the PREVIEW refuses with the same code (the provider's own check): a refusal in a person's words, not a failed read.
    // As the real kernel (0.70.5) printed it at the preview: nothing was started.
    const atPreview = (JSON.parse(readFileSync(join(process.cwd(), "test/fixtures/spawn/spawn-preview-pi-refused.json"), "utf8")) as { error: { code: string; message: string } }).error;
    expect(atPreview.message).toMatch(/would not be launched.*nothing was created$/);
    expect(spawnProblem(atPreview, "preview")).toMatchObject({ code: "E_BACKEND_NOT_READY", outcome: "refused", sentence: "bb isn’t ready to launch this agent as chosen. Details says what bb needs; or pick another harness above.", detail: atPreview.message });
    expect(spawnProblem(refused, "preview")).toMatchObject({ code: "E_BACKEND_NOT_READY", next: "change-options", sentence: "bb isn’t ready to launch this agent as chosen. Details says what bb needs; or pick another harness above." });
    expect(spawnProblem(refused, "preview", { harnessField: false }).sentence).toBe("bb isn’t ready to launch this agent as chosen. Details says what bb needs.");
    expect(spawnProblem({ code: "E_CLONE_MISSING", message: "git clone …" }).sentence).toBe("This soul’s repository isn’t cloned on this machine yet. Clone it, then try again — Details shows how.");
    expect(spawnProblem({ code: "E_PACKAGE_MISSING", message: null }).sentence).toBe("A package this soul uses isn’t installed yet. Run oats sync in the deployment, then try again.");
    expect(spawnProblem({ code: "OATS_TIMEOUT", message: null }).sentence).toBe("OATS took too long to work out this soul’s defaults. Try again.");
    expect(spawnProblem({ code: "E_SOMETHING_NEW", message: "what the kernel said" })).toEqual({ sentence: "OATS couldn’t work out this soul’s defaults. Try again, or see Details.", next: "details", code: "E_SOMETHING_NEW", detail: "what the kernel said", outcome: "refused" });
  });

  it("a harness that is not installed is said as the kernel words it", () => {
    expect(spawnProblem({ code: "E_HARNESS_UNAVAILABLE", message: "pi is not installed: npm i -g @mariozechner/pi" }).sentence).toBe("pi is not installed: npm i -g @mariozechner/pi Install it, or pick another harness above.");
    expect(spawnProblem({ code: "E_HARNESS_UNAVAILABLE", message: null }).sentence).toBe("The harness this soul would run isn’t installed on this machine. Install it, or pick another harness above.");
  });

  it("after the press: nothing was created is said, and what to look at before spawning again", () => {
    expect(spawnProblem({ code: "E_DECISION_STALE", message: null }, "spawn").sentence).toBe("Something changed before the spawn went through. Nothing was created — check the updated values and press Spawn again.");
    expect(spawnProblem({ code: "E_PLACEMENT_TAKEN", message: null }, "spawn").sentence).toBe("Another spawn just took this name. Nothing was created — check the new name and press Spawn again.");
    expect(spawnProblem({ code: "E_OUTCOME_UNKNOWN", message: null }, "spawn").sentence).toBe("We couldn’t confirm whether the instance was created. Press Check result: it asks OATS again, and starts nothing twice.");
    expect(spawnProblem({ code: "OATS_TIMEOUT", message: null }, "spawn")).toMatchObject({ sentence: "OATS took too long to answer. The instance may already exist. Press Check result: it asks OATS again, and starts nothing twice.", next: "check-result" });
    // A spawn whose oats, machine or server ended with no answer: whether the instance was made is not known either.
    for (const code of ["OATS_FAILED", "OATS_NOT_JSON", "HOST_UNREACHABLE", "PLUGIN_RPC_FAILED"]) expect(spawnProblem({ code, message: "x" }, "spawn").next, code).toBe("check-result");
    expect(spawnProblem({ code: "OATS_FAILED", message: "oats: crashed" }, "spawn").sentence).toBe("OATS ended without saying whether the instance was created. Press Check result: it asks OATS again, and starts nothing twice.");
    // The same codes at the preview started nothing: the preview's general sentence.
    expect(spawnProblem({ code: "OATS_FAILED", message: "x" }, "preview").next).toBe("details");
    expect(spawnProblem({ code: "E_INTERRUPTED", message: "hook oats.build" }, "spawn").sentence).toBe("The spawn was interrupted while its worktree was being set up, and was rolled back. Nothing was created.");
    // A failure with no code at all says nothing of what the kernel did: not known.
    expect(spawnProblem({ code: null, message: "boom" }, "spawn")).toEqual({ sentence: "OATS didn’t say whether the instance was created. Press Check result: it asks OATS again, and starts nothing twice.", next: "check-result", code: "OATS_FAILED", detail: "boom", outcome: "unknown" });
    // A code the preview's table holds reads the same after the press.
    expect(spawnProblem({ code: "E_INSTANCE_NAME_INVALID", message: null }, "spawn").sentence).toBe("Use lowercase letters, numbers and dashes, at most 63 characters, and don’t reuse a soul’s name.");
  });

  it("sends a person to the Harness field only where the form has one", () => {
    const one = { harnessField: false };
    expect(spawnProblem({ code: "E_BACKEND_HARNESS", message: "x" }, "preview", one).sentence).toBe("bb can’t run the harness this soul would use. See Details.");
    expect(spawnProblem({ code: "E_LAUNCH_EXECUTABLE", message: "x" }, "preview", one).sentence).toBe("The chosen launch configuration can’t start on this machine. See Details.");
    expect(spawnProblem({ code: "E_LAUNCH_CONFIG_AMBIGUOUS", message: "x" }, "preview", one).sentence).toBe("This machine has more than one launch configuration for this soul’s harness, and none is the default. Make one of them the default with oats launch-config on that machine.");
    expect(spawnProblem({ code: "E_LAUNCH_PREFERENCE_UNMATCHED", message: "x" }, "preview", one).sentence).toMatch(/Correct the preference \(Details\)\.$/);
    expect(spawnProblem({ code: "E_HARNESS_UNAVAILABLE", message: "pi is not installed" }, "preview", one).sentence).toBe("pi is not installed Install it on that machine.");
    for (const code of ["E_BACKEND_HARNESS", "E_HARNESS_UNAVAILABLE", "E_LAUNCH_EXECUTABLE", "E_LAUNCH_ENV_MISSING", "E_LAUNCH_PROBE_UNSUPPORTED", "E_LAUNCH_CONFIG_UNKNOWN", "E_LAUNCH_CONFIG_AMBIGUOUS", "E_LAUNCH_PREFERENCE_UNMATCHED"]) {
      expect(spawnProblem({ code, message: null }, "preview", one).sentence, code).not.toMatch(/harness above|harnesses above/);
      expect(spawnProblem({ code, message: null }, "preview").sentence, code).toMatch(/harness above|harnesses above/);
    }
    // A tail that names another control is the same with or without the field.
    expect(spawnProblem({ code: "E_BAD_ARGS", message: "x" }, "preview", one).sentence).toBe("Some of these values can’t be used. Check the values above.");
  });

  it("the kernel's words for a harness that is not installed go through the display filter; where it leaves nothing, the table's sentence stands", () => {
    const unsafe = "harness pi not found\u202E at /opt/x; set token=abc123 in env\nsecond line";
    const said = spawnProblem({ code: "E_HARNESS_UNAVAILABLE", message: unsafe });
    expect(said.sentence).toBe("The harness this soul would run isn’t installed on this machine. Install it, or pick another harness above.");
    expect(said.sentence).not.toMatch(/token|\u202E|\n/);
    expect(spawnProblem({ code: "E_HARNESS_UNAVAILABLE", message: "pi is\nnot on PATH" }).sentence).toBe("pi is not on PATH Install it, or pick another harness above.");
    expect(spawnProblem({ code: "E_HARNESS_UNAVAILABLE", message: "" }).sentence).toBe("The harness this soul would run isn’t installed on this machine. Install it, or pick another harness above.");
  });
});

describe("the form's own rows of the preview", () => {
  it("adds the soul, that the session is a bb thread and the access the kernel decided, each read from the answer; the launch-prompt note is not the form's yet", () => {
    const facts = formFacts(preview, { name: "flaky-ci-2-developer" });
    expect(facts.facts.map((fact) => [fact.label, fact.parts.filter((part) => part.sub !== true).map((part) => part.text).join("")])).toEqual([
      ["Soul", "oats-developer"],
      ["Works in", "worktree · branch agents/flaky-ci-2-developer from github.com/awebai/oats"],
      ["Harness", "pi · github-copilot/claude-fable-5.1"],
      ["Session", "bb thread"],
      ["Access", "full mode: no sandbox"],
      ["Team", "oats · default"],
    ]);
    expect("prompts" in facts).toBe(false);
    expect(facts.identity).toEqual(previewFacts(preview, { name: "flaky-ci-2-developer" }).identity);
    // What the answer does not say is not said: no row is made up.
    expect(formFacts({}).facts).toEqual([]);
    expect(formFacts({ ...preview, backend: "tmux", decision: { effective: { yolo: false } } }).facts.filter((fact) => ["Session", "Access"].includes(fact.label)).map((fact) => fact.parts[0]!.text)).toEqual(["tmux", "the harness asks before it acts"]);
  });

  it("a harness with no model resolved, on bb: the row says bb's default for it, never an empty value nor another harness's model", () => {
    const unset = { ...preview, harness: "pi", model: null, modelSource: null };
    expect(formFacts(unset).facts.find((fact) => fact.label === "Harness")!.parts[0]).toEqual({ text: "pi · bb’s default for pi" });
    expect(formFacts(unset).resolved).toEqual({ harness: "pi", model: null });
    // Where the kernel resolved one, it is the one said; and off bb nothing is said of bb.
    expect(formFacts(preview).facts.find((fact) => fact.label === "Harness")!.parts[0]).toEqual({ text: "pi · github-copilot/claude-fable-5.1" });
    expect(formFacts({ ...unset, backend: "tmux" }).facts.find((fact) => fact.label === "Harness")!.parts[0]).toEqual({ text: "pi · default model" });
  });

  it("says the relationship the kernel bound, with its anchor", () => {
    const related = { ...preview, relation: "child", decision: { effective: { relation: { anchor: { instance: "flaky-ci-developer" } }, yolo: true } } };
    expect(formFacts(related).facts.find((fact) => fact.label === "Relationship")).toEqual({ label: "Relationship", parts: [{ text: "child of flaky-ci-developer" }] });
  });
});

describe("after the press, what is known decides what the form may offer", () => {
  const outcome = (code: string | null, options: { replay?: boolean } = {}) => spawnProblem({ code, message: "m" }, "spawn", options).outcome;

  it("refused: only where something says nothing was created: the kernel's refusals the tables name, and a call that never reached the kernel", () => {
    for (const code of ["E_DECISION_STALE", "E_PLACEMENT_TAKEN", "E_INSTANCE_NAME_TAKEN", "E_REQUIRED_HOOK_FAILED", "E_INTERRUPTED", "E_BACKEND_NOT_READY", "E_MODEL_UNKNOWN", "E_BUSY", "INVALID_INPUT", "OATS_NOT_FOUND", "NO_DEPLOYMENT", "CHOOSE_HOST", "HOST_NOT_FOUND", "NO_HOST"]) expect(outcome(code), code).toBe("refused");
  });

  it("created: the kernel says an instance exists, or the spawn went through and named no thread: said as created, with where to open it", () => {
    for (const code of ["E_SPAWN_INCOMPLETE", "NO_THREAD_NAMED", "E_INSTANCE_GONE"]) expect(outcome(code), code).toBe("created");
    expect(spawnProblem({ code: "E_SPAWN_INCOMPLETE", message: "launched, not confirmed" }, "spawn").sentence).toBe("The instance was created but didn’t finish starting. Open it from the sidebar instead of spawning again.");
    expect(spawnProblem({ code: "NO_THREAD_NAMED", message: "Spawned x, but the kernel named no bb thread for it" }, "spawn").sentence).toBe("The instance was created, but OATS named no bb thread for it. Open it from the sidebar instead of spawning again.");
  });

  it("unknown: everything else. Rollback is never inferred from a failure nobody classed", () => {
    for (const code of ["E_OUTCOME_UNKNOWN", "E_INTENT_EXPIRED", "OATS_TIMEOUT", "OATS_FAILED", "OATS_NOT_JSON", "OATS_BAD_ANSWER", "OATS_OUTPUT_TOO_LARGE", "OATS_ABORTED", "HOST_UNREACHABLE", "PLUGIN_RPC_FAILED", "E_HOOK_ENVIRONMENT_CONTRACT", "E_SOMETHING_NEW", null]) {
      const problem = spawnProblem({ code, message: "m" }, "spawn");
      expect([problem.outcome, problem.next], String(code)).toEqual(["unknown", "check-result"]);
      expect(problem.sentence, String(code)).toMatch(/Press Check result: it asks OATS again, and starts nothing twice\.$/);
    }
    expect(spawnProblem({ code: "E_HOOK_ENVIRONMENT_CONTRACT", message: "m" }, "spawn")).toMatchObject({ sentence: "OATS didn’t say whether the instance was created. Press Check result: it asks OATS again, and starts nothing twice.", code: "E_HOOK_ENVIRONMENT_CONTRACT", detail: "m" });
  });

  it("unconfirmed: the kernel refused and marks that it could not confirm what is left: never 'nothing was created', whatever the code", () => {
    // SHAPED, not recorded: a rollback that fails cannot be made in the real run (the kernel's own
    // removal of the home would have to fail). The marker and the words are the kernel's, from
    // awebai/oats lib/core.mjs at v0.70.5 (e5e7a2a4): `unconfirmedSpawn` (3863-3865) sets
    // error.details.unconfirmed = true; the message is the note of line 5235, `note =
    // incomplete.length ? " — rollback INCOMPLETE, clean up manually: " + incomplete.join("; ") :
    // " — spawn rolled back"`, with the entry of line 5234 ("instance home <home>: still present"),
    // and 5237 with 5675 sets the marker on that path. The lead of the message is the recorded one
    // of test/fixtures/spawn/spawn-pi-refused.json.
    const left = "form-pi-developer was not launched: oats.bb's session provider bb is not ready — rollback INCOMPLETE, clean up manually: instance home /abs/deployment/agents/oats-developer/instances/form-pi-developer: still present";
    // The marker, with any code that does not say an instance exists: one the tables name as a refusal, one they name as unknown, one nobody classed, the plugin's own.
    for (const code of ["E_BACKEND_NOT_READY", "E_REQUIRED_HOOK_FAILED", "E_INTERRUPTED", "E_MODEL_UNKNOWN", "E_OUTCOME_UNKNOWN", "E_SPAWN_FAILED", "E_SOMETHING_NEW", "OATS_FAILED", "PLUGIN_RPC_FAILED"]) {
      const problem = spawnProblem({ code, message: left, unconfirmed: true }, "spawn");
      expect([problem.outcome, problem.next, problem.code, problem.detail], code).toEqual(["unconfirmed", null, code, left]);
      expect(problem.sentence, code).toBe("OATS refused the spawn and could not undo all of it: part of the instance may still be there. Details says what to clean up; don’t spawn again before it is.");
      expect(problem.sentence, code).not.toMatch(/Nothing was created|rolled back/);
    }
    // The marker alone says it: the message need not hold the kernel's words.
    expect(spawnProblem({ code: "E_BACKEND_NOT_READY", message: "m", unconfirmed: true }, "spawn").outcome).toBe("unconfirmed");
    // The same codes without the marker are what the tables say: a rollback the kernel finished is a refusal ("spawn rolled back").
    expect(outcome("E_BACKEND_NOT_READY")).toBe("refused");
    expect(spawnProblem({ code: "E_REQUIRED_HOOK_FAILED", message: "the hook exited 2 — spawn rolled back" }, "spawn").outcome).toBe("refused");
    expect(spawnProblem({ code: "E_BACKEND_NOT_READY", message: "m", unconfirmed: false }, "spawn").outcome).toBe("refused");
    expect(outcome("E_SOMETHING_NEW")).toBe("unknown");
    // A preview starts nothing, whatever it carries.
    expect(spawnProblem({ code: "E_BACKEND_NOT_READY", message: left, unconfirmed: true }, "preview").outcome).toBe("refused");
  });

  it("the kernel's words 'rollback INCOMPLETE' without its marker decide nothing: the code is read as the tables say", () => {
    // The form read these words while the plugin's envelope dropped the marker. It no longer does:
    // at the plugin's floor (OATS 0.70.5, lib/core.mjs at e5e7a2a4) every path of a spawn that
    // writes them sets details.unconfirmed (4630; 4802-4804; 4821-4823; 4861-4863; 5668-5669;
    // 5235-5237 with 5675, and the homes kept by 5095, 5124 and 5152; 5678-5679), and the CLI
    // prints the marker with them: lib/errors.mjs `spawnRefusalDetails` (54-90) drops an error's
    // details only for seven codes of its table (E_CHILD_SPAWNS_DISABLED, E_BRANCH_EXISTS,
    // E_BASE_UNKNOWN, E_DECISION_STALE, E_IDEMPOTENCY_CONFLICT, E_PLACEMENT_TAKEN,
    // E_INSTANCE_NAME_TAKEN), each raised before any rollback that writes the words (core.mjs: the
    // last at 4603, the first such rollback at 4630). So a
    // message with the words and no marker is no answer of a kernel the plugin runs on.
    const words = "x was not launched — rollback INCOMPLETE, clean up manually: instance home /abs/home: still present";
    expect(spawnProblem({ code: "E_BACKEND_NOT_READY", message: words }, "spawn").outcome).toBe("refused");
    expect(spawnProblem({ code: "E_SOMETHING_NEW", message: words }, "spawn").outcome).toBe("unknown");
    expect(spawnProblem({ code: "E_SOMETHING_NEW", message: words }, "spawn").next).toBe("check-result");
  });

  it("an instance that exists is said as created, with the marker too: the kernel marks E_SPAWN_INCOMPLETE unconfirmed, and nothing of it was rolled back", () => {
    // lib/core.mjs at v0.70.5: 512 (`retainedPromptError`: "home and pane retained", details
    // { retained: true, unconfirmed: true, … }) and 4016 (the replay of a key whose spawn did not
    // complete, through `unconfirmedSpawn`). The Desktop reads the code first too
    // (packages/client/spawn-apply.mjs `interpret`, 135-146).
    for (const code of ["E_SPAWN_INCOMPLETE", "E_INSTANCE_GONE", "NO_THREAD_NAMED"]) expect(spawnProblem({ code, message: "m", unconfirmed: true }, "spawn").outcome, code).toBe("created");
    expect(spawnProblem({ code: "E_SPAWN_INCOMPLETE", message: "the screen never settled; home and pane retained: inspect /abs/home", unconfirmed: true }, "spawn").sentence).toBe("The instance was created but didn’t finish starting. Open it from the sidebar instead of spawning again.");
  });

  it("a Check result that the plugin refused before asking the kernel learned nothing: still unknown; one the kernel refuses by name is refused", () => {
    expect(outcome("INVALID_INPUT", { replay: true })).toBe("unknown");
    expect(outcome("OATS_NOT_FOUND", { replay: true })).toBe("unknown");
    expect(outcome("E_DECISION_STALE", { replay: true })).toBe("refused");
    expect(outcome("E_SPAWN_INCOMPLETE", { replay: true })).toBe("created");
  });

  it("a preview starts nothing: whatever its failure, nothing was created", () => {
    for (const code of ["OATS_FAILED", "E_SOMETHING_NEW", "NO_THREAD_NAMED", null]) expect(spawnProblem({ code, message: "m" }, "preview").outcome, String(code)).toBe("refused");
  });
});

describe("model/spawn.ts stands on nothing of app/", () => {
  it("imports the plugin's one display filter and its one reading of bb's list from model/, and nothing else", () => {
    const source = readFileSync(join(process.cwd(), "model/spawn.ts"), "utf8");
    expect(source.match(/^import .*$/gm) ?? []).toEqual(['import { DETAIL_WITHHELD, displayLine } from "./text.js";', 'import { served } from "./served.js";', 'import type { ListedModel } from "./served.js";']);
    // And the reading of bb's list it stands on imports nothing at all.
    expect(readFileSync(join(process.cwd(), "model/served.ts"), "utf8").match(/^import .*$/gm) ?? []).toEqual([]);
    // A capability's name in the Setup row comes as the kernel printed it; the column draws it through the filter.
    const hooked = { ...preview, worktreeHooks: [{ capability: "oats.build\u202E", required: true }] };
    expect(previewFacts(hooked).facts.find((fact) => fact.label === "Setup")!.parts[0]!.text).toBe("oats.build\u202E (required)");
  });
});

describe("the Model field's one rule: may a spawn go with the model it would send", () => {
  // bb's list for pi: each model with the provider bb routes it by; and Claude Code's, whose ids name no provider.
  const routed = (...ids: string[]) => ids.map((id) => ({ id, provider: id.slice(0, id.indexOf("/")) }));
  const PI = routed("github-copilot/claude-fable-5.1", "github-copilot/claude-fable-5.2", "anthropic/claude-fable-5.1", "openai/sol-5", "openrouter/anthropic/claude-sonnet-5", "openrouter/openai/gpt-6");
  const CLAUDE = ["claude-opus-5-5", "claude-sonnet-5"].map((id) => ({ id, provider: null }));
  const soul = (model: string | null, harness = "pi") => ({ harness, model });
  const ARMED = { held: null };
  const TWO: ReturnType<typeof modelCheck> = { held: "Pick provider", offers: ["github-copilot/claude-fable-5.1", "anthropic/claude-fable-5.1"] };
  type Input = Parameters<typeof modelCheck>[0];
  type Row = [what: string, input: Omit<Input, "byProvider"> & { byProvider?: boolean }, answer: ReturnType<typeof modelCheck>];
  const TABLE: Row[] = [
    // ---- the soul's own harness (none chosen in the form)
    ["the soul's harness and its own model, served once (bare)", { chosenHarness: null, soulHarness: "pi", picked: null, resolved: soul("claude-fable-5.2"), listed: PI }, ARMED],
    ["the soul's harness and its own model, listed as it is", { chosenHarness: null, soulHarness: "pi", picked: null, resolved: soul("openai/sol-5"), listed: PI }, ARMED],
    ["the soul's harness, no model declared: the soul's decision, bb's default", { chosenHarness: null, soulHarness: "pi", picked: null, resolved: soul(null), listed: PI }, ARMED],
    ["the soul's model, which bb serves under two providers", { chosenHarness: null, soulHarness: "pi", picked: null, resolved: soul("claude-fable-5.1"), listed: PI }, TWO],
    ["the soul's model, which no listed model serves: armed, the provider judges it at the launch", { chosenHarness: null, soulHarness: "pi", picked: null, resolved: soul("claude-fable-9"), listed: PI }, ARMED],
    // ---- a harness chosen in the form
    ["a chosen harness the kernel resolves no model for, none picked", { chosenHarness: "pi", soulHarness: "claude", picked: null, resolved: soul(null), listed: PI }, { held: "Required", offers: [] }],
    ["the same, whatever bb lists, or does not", { chosenHarness: "pi", soulHarness: "claude", picked: null, resolved: soul(null), listed: null }, { held: "Required", offers: [] }],
    ["the soul's OWN harness, picked in the form, with no model declared: the soul's decision still, not held", { chosenHarness: "pi", soulHarness: "pi", picked: null, resolved: soul(null), listed: PI }, ARMED],
    ["a chosen harness while the soul's own is not known yet (no preview with none chosen): not known to be the soul's, held", { chosenHarness: "pi", soulHarness: null, picked: null, resolved: soul(null), listed: PI }, { held: "Required", offers: [] }],
    ["a chosen harness whose model the kernel resolves (the soul declares its launch for it)", { chosenHarness: "pi", soulHarness: "claude", picked: null, resolved: soul("openai/sol-5"), listed: PI }, ARMED],
    ["a chosen harness, a model picked from bb's list", { chosenHarness: "pi", soulHarness: "claude", picked: "github-copilot/claude-fable-5.2", resolved: soul(null), listed: PI }, ARMED],
    // ---- a model picked or typed
    ["typed: a bare id one provider serves", { chosenHarness: null, soulHarness: "pi", picked: "sol-5", resolved: soul("openai/sol-5"), listed: PI }, ARMED],
    ["typed: a bare id that holds a slash, served once (openrouter's anthropic/claude-sonnet-5)", { chosenHarness: null, soulHarness: "pi", picked: "anthropic/claude-sonnet-5", resolved: soul(null), listed: PI }, ARMED],
    ["typed: a bare id two providers serve", { chosenHarness: "pi", soulHarness: "claude", picked: "claude-fable-5.1", resolved: soul(null), listed: PI }, TWO],
    ["the picked model is what is sent: the soul's own is not judged", { chosenHarness: null, soulHarness: "pi", picked: "openai/sol-5", resolved: soul("claude-fable-9"), listed: PI }, ARMED],
    // ---- the provider is the one judge of "no listed model serves it": the form arms each
    ["typed: an id nobody serves", { chosenHarness: "pi", soulHarness: "claude", picked: "mistral-large", resolved: soul(null), listed: PI }, ARMED],
    ["typed: what a listed id merely ENDS in (openrouter/openai/gpt-6 is the bare id openai/gpt-6, not gpt-6): served by nothing, the provider judges it", { chosenHarness: null, soulHarness: "pi", picked: "gpt-6", resolved: soul(null), listed: PI }, ARMED],
    ["typed: an id that ends in a date, which bb holds back from its list: the provider lets it go", { chosenHarness: null, soulHarness: "pi", picked: "claude-fable-5-20261101", resolved: soul(null), listed: PI }, ARMED],
    ["a list pi's own configuration narrows: a model pi has and bb does not list: the provider lets it go", { chosenHarness: null, soulHarness: "pi", picked: "sol-5-mini", resolved: soul(null), listed: routed("openai/sol-5") }, ARMED],
    ["a list older than pi's configuration: a model added to pi a moment ago: the provider lets it go", { chosenHarness: null, soulHarness: "pi", picked: "late-model", resolved: soul(null), listed: PI }, ARMED],
    // ---- where two listed models are not shown to be two
    ["an id with a slash that two listed models serve: where the list is not whole it may be a held-back model's exact id, and the provider lets it go: not held", { chosenHarness: null, soulHarness: "pi", picked: "openai/gpt-7", resolved: soul(null), listed: routed("openrouter/openai/gpt-7", "requesty/openai/gpt-7") }, ARMED],
    ["a model bb lists for pi with NO provider (one a person added to bb's own list) serves nothing: one provider's bare id beside it is served once", { chosenHarness: null, soulHarness: "pi", picked: "echo", resolved: soul(null), listed: [{ id: "echo", provider: null }, { id: "mock/echo", provider: "mock" }] }, ARMED],
    ["the same two, were both pi's: two", { chosenHarness: null, soulHarness: "pi", picked: "echo", resolved: soul(null), listed: routed("mock/echo", "other/echo") }, { held: "Pick provider", offers: ["mock/echo", "other/echo"] }],
    // ---- where bb's list does not decide
    ["bb's list was not read, or cannot be: the kernel's answer stands", { chosenHarness: null, soulHarness: "pi", picked: "anything", resolved: soul("x"), listed: null }, ARMED],
    ["a list that names no provider (Claude Code's): whole ids, never two", { chosenHarness: "claude", soulHarness: "pi", picked: "claude-opus-9", resolved: soul(null, "claude"), listed: CLAUDE, byProvider: false }, ARMED],
    ["the same for the soul's own model there", { chosenHarness: null, soulHarness: "pi", picked: null, resolved: soul("claude-opus-9", "claude"), listed: CLAUDE, byProvider: false }, ARMED],
    ["pi's list with no provider in any row: nothing counts, nothing is held", { chosenHarness: null, soulHarness: "pi", picked: "claude-opus-5-5", resolved: soul(null), listed: CLAUDE }, ARMED],
    ["an empty list decides nothing", { chosenHarness: null, soulHarness: "pi", picked: "x", resolved: soul("y"), listed: [] }, ARMED],
    // ---- before the kernel answered
    ["no preview yet: nothing is held for the model (Spawn is off for its own reason)", { chosenHarness: "pi", soulHarness: "claude", picked: null, resolved: null, listed: PI }, ARMED],
  ];
  it.each(TABLE)("%s", (_what, input, answer) => {
    expect(modelCheck({ byProvider: true, ...input })).toEqual(answer);
  });

  it("the form's words for the model are these two: \"Not found\" is not the form's to say", () => {
    expect(Object.values(MODEL_HELD)).toEqual(["Required", "Pick provider"]);
  });

  it("the words are two at most, and no sentence", () => {
    for (const [, , answer] of TABLE) if (answer.held !== null) expect(answer.held.split(" ").length).toBeLessThanOrEqual(2);
  });
});

describe("a soul that declares its own launch: its harness and model are the soul's, and no model is asked for", () => {
  // SHAPED from a real answer of OATS 0.70.4 (2026-11-23), every name invented: test/fixtures/spawn/README.md.
  const declared = JSON.parse(readFileSync(join(process.cwd(), "test/fixtures/spawn/spawn-preview-soul-launch.json"), "utf8")).result;

  it("the column reads Harness pi · claude-fable-5.1, from the soul", () => {
    const facts = formFacts(declared);
    expect(facts.facts.find((fact) => fact.label === "Harness")).toEqual({ label: "Harness", parts: [{ text: "pi · claude-fable-5.1" }, { text: "the soul's preference", sub: true }] });
    expect(facts.resolved).toEqual({ harness: "pi", model: "claude-fable-5.1" });
  });

  it("Spawn is armed with it: one provider of bb's serves that model, and none need be picked", () => {
    expect(modelCheck({ chosenHarness: null, soulHarness: "pi", picked: null, resolved: formFacts(declared).resolved, byProvider: true, listed: [{ id: "github-copilot/claude-fable-5.1", provider: "github-copilot" }, { id: "openai/sol-5", provider: "openai" }] })).toEqual({ held: null });
    expect(modelCheck({ chosenHarness: null, soulHarness: "pi", picked: null, resolved: formFacts(declared).resolved, listed: null, byProvider: true })).toEqual({ held: null });
  });
});

describe("the column of a harness with no model resolved, on bb", () => {
  const preview = JSON.parse(readFileSync(join(process.cwd(), "test/fixtures/spawn/spawn-preview.json"), "utf8")).result;
  const unset = { ...preview, harness: "pi", model: null, modelSource: null };
  const harnessRow = (rows: { label: string; parts: { text: string }[] }[]) => rows.find((fact) => fact.label === "Harness")!.parts[0];
  it("says bb's default for it; where a model is required of the person, the form draws the row with the harness alone, no default promised", () => {
    expect(harnessRow(formFacts(unset).facts)).toEqual({ text: "pi · bb’s default for pi" });
    expect(harnessRow(withoutDefault(formFacts(unset).facts, "pi"))).toEqual({ text: "pi" });
    // Only that promise is taken away: a row with a model resolved, and every other row, stay as they are.
    expect(withoutDefault(formFacts(preview).facts, "pi")).toEqual(formFacts(preview).facts);
    expect(withoutDefault(formFacts(unset).facts, "pi").filter((fact) => fact.label !== "Harness")).toEqual(formFacts(unset).facts.filter((fact) => fact.label !== "Harness"));
  });
});
