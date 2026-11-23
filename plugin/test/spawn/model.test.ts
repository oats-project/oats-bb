// model/spawn.ts: the facts of a spawn's preview against what the real kernel printed
// (test/fixtures/spawn/spawn-preview.json), and a refusal in a person's words. The Desktop's own
// tests of the same functions are in awebai/oats packages/client/test and
// packages/desktop/test/spawn-words.test.mjs.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { formFacts, harnessLabel, homeText, launchFromText, moduleSourceText, previewFacts, relationText, spawnProblem, worksInText } from "../../model/spawn";

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
    // From OATS 0.70.1 the PREVIEW refuses with the same code (the provider's own check): a refusal in a person's words, not a failed read.
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
    expect(spawnProblem({ code: "E_INSTANCE_NAME_INVALID", message: null }, "spawn").sentence).toBe("Use lowercase letters, numbers and dashes, at most 64 characters, and don’t reuse a soul’s name.");
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
