// model/spawn.ts: the facts of a spawn's preview against what the real kernel printed
// (test/fixtures/spawn/spawn-preview.json), and a refusal in a person's words. The Desktop's own
// tests of the same functions are in awebai/oats packages/client/test and
// packages/desktop/test/spawn-words.test.mjs.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { harnessLabel, homeText, launchFromText, moduleSourceText, previewFacts, relationText, spawnProblem, worksInText } from "../../model/spawn";

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
    expect(spawnProblem({ code: "E_INSTANCE_NAME_TAKEN", message: "instance flaky-ci-2-developer exists" })).toEqual({ sentence: "An instance with this name already exists. Choose another name.", next: null, code: "E_INSTANCE_NAME_TAKEN", detail: "instance flaky-ci-2-developer exists" });
    expect(spawnProblem({ code: "E_BRANCH_EXISTS", message: null }).sentence).toBe("That branch already exists. Choose another branch in Developer settings.");
    expect(spawnProblem({ code: "E_BAD_ARGS", message: "x" }).sentence).toBe("Some of these values can’t be used. Check the name and Developer settings.");
    expect(spawnProblem({ code: "E_CLONE_MISSING", message: "git clone …" }).sentence).toBe("This soul’s repository isn’t cloned on this machine yet. Clone it, then try again — Details shows how.");
    expect(spawnProblem({ code: "E_PACKAGE_MISSING", message: null }).sentence).toBe("A package this soul uses isn’t installed yet. Run oats sync in the deployment, then try again.");
    expect(spawnProblem({ code: "OATS_TIMEOUT", message: null }).sentence).toBe("OATS took too long to work out this soul’s defaults. Try again.");
    expect(spawnProblem({ code: "E_SOMETHING_NEW", message: "what the kernel said" })).toEqual({ sentence: "OATS couldn’t work out this soul’s defaults. Try again, or see Details.", next: "details", code: "E_SOMETHING_NEW", detail: "what the kernel said" });
  });

  it("a harness that is not installed is said as the kernel words it", () => {
    expect(spawnProblem({ code: "E_HARNESS_UNAVAILABLE", message: "pi is not installed: npm i -g @mariozechner/pi" }).sentence).toBe("pi is not installed: npm i -g @mariozechner/pi Install it, or pick another harness above.");
    expect(spawnProblem({ code: "E_HARNESS_UNAVAILABLE", message: null }).sentence).toBe("The harness this soul would run isn’t installed on this machine. Install it, or pick another harness above.");
  });

  it("after the press: nothing was created is said, and what to look at before spawning again", () => {
    expect(spawnProblem({ code: "E_DECISION_STALE", message: null }, "spawn").sentence).toBe("Something changed before the spawn went through. Nothing was created — check the updated values and press Spawn again.");
    expect(spawnProblem({ code: "E_PLACEMENT_TAKEN", message: null }, "spawn").sentence).toBe("Another spawn just took this name. Nothing was created — check the new name and press Spawn again.");
    expect(spawnProblem({ code: "E_OUTCOME_UNKNOWN", message: null }, "spawn").sentence).toBe("We couldn’t confirm whether the instance was created. Check the agents in the sidebar before spawning again.");
    expect(spawnProblem({ code: "OATS_TIMEOUT", message: null }, "spawn")).toMatchObject({ sentence: "OATS took too long to answer. The instance may already exist. Check the agents in the sidebar before spawning again.", next: "check-result" });
    expect(spawnProblem({ code: "E_INTERRUPTED", message: "hook oats.build" }, "spawn").sentence).toBe("The spawn was interrupted while its worktree was being set up, and was rolled back. Nothing was created.");
    expect(spawnProblem({ code: null, message: "boom" }, "spawn")).toEqual({ sentence: "OATS couldn’t complete the spawn. Try again, or see Details.", next: "details", code: "OATS_FAILED", detail: "boom" });
    // A code the preview's table holds reads the same after the press.
    expect(spawnProblem({ code: "E_INSTANCE_NAME_INVALID", message: null }, "spawn").sentence).toBe("Use lowercase letters, numbers and dashes, at most 64 characters, and don’t reuse a soul’s name.");
  });
});
