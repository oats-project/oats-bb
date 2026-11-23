// `oats inspect --home`, read into the Soul tab's rows: against the answer recorded from the real
// kernel, and against that answer changed where the recording's workspace has nothing to show
// (it fills no core slot and its souls declare no capability).
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { memberLabel, panelSoul, panelSoulArgv, parsePanelSoul } from "../../kernel/panel-soul.js";

type Envelope = { result: Record<string, unknown> };
const recorded = (): Record<string, unknown> => structuredClone((JSON.parse(readFileSync(resolve(process.cwd(), "test/fixtures/panel/inspect-home.json"), "utf8")) as Envelope).result);
const HOME = "/abs/deployment/agents/oats-expert/instances/panel-worktree-helper";

const okf = {
  id: "oats.okf", version: "2.1.3", layer: "knowledge",
  from: { kind: "package", package: "oats.okf", version: "2.1.3", commit: "ab897841", integrity: "sha256-bada35", repoKey: "github.com/awebai/oats-okf" },
  composedFrom: null,
};
const reviewer = { id: "nw.review", version: null, layer: null, from: { kind: "member", repoKey: "github.com/nw/agents.git", commit: "66566512" }, composedFrom: null };

describe("the Soul tab's read", () => {
  it("asks the kernel about the home the kernel named, and refuses any other", () => {
    expect(panelSoulArgv(HOME)).toEqual({ ok: true, value: ["inspect", "--home", HOME, "--json"] });
    expect(panelSoulArgv("agents/x").ok).toBe(false);
    expect(panelSoulArgv("--soul").ok).toBe(false);
  });

  it("the recorded home: no core slot is filled, and its two capabilities are defaults from packages", () => {
    const answer = parsePanelSoul(recorded());
    expect(answer).toEqual({
      ok: true,
      value: {
        name: "oats-expert",
        commit: "ca5ff7827c6abb5a1b6a05d19d47a2f7f2ef124d",
        repo: "oats-real",
        teams: [],
        core: [
          { slot: "knowledge", reported: true, id: null, source: null, why: null, team: null },
          { slot: "messaging", reported: true, id: null, source: null, why: null, team: null },
          { slot: "tasks", reported: true, id: null, source: null, why: null, team: null },
        ],
        capabilities: [
          { name: "oats.bb", why: "default", team: null, reason: null, overrides: null, source: { kind: "package", name: "oats.bb", version: "9b95a56f237ff4006a69545963d5130d6eb4ddc5" } },
          { name: "oats.core", why: "default", team: null, reason: null, overrides: null, source: { kind: "package", name: "oats.framework", version: "1.26.0" } },
        ],
        modules: 2,
        warnings: [],
      },
    });
    if (answer.ok) expect(panelSoul.parse(answer.value)).toEqual(answer.value);
  });

  it("a filled core slot names its provider, its source and why; an unreported slot says so", () => {
    const document = recorded();
    document.layers = { knowledge: { id: "oats.okf", from: "workspace" }, messaging: { id: "oats.aweb", from: "team:eng" }, tasks: "none" };
    (document.capabilities as unknown[]).push(okf);
    const answer = parsePanelSoul(document);
    expect(answer.ok && answer.value?.core).toEqual([
      { slot: "knowledge", reported: true, id: "oats.okf", source: { kind: "package", name: "oats.okf", version: "2.1.3" }, why: "workspace", team: null },
      { slot: "messaging", reported: true, id: "oats.aweb", source: null, why: "team", team: "eng" },
      { slot: "tasks", reported: false, id: null, source: null, why: null, team: null },
    ]);
    // The slot's provider is the Core section's, never listed twice.
    expect(answer.ok && answer.value?.capabilities.map((capability) => capability.name)).toEqual(["oats.bb", "oats.core"]);
    expect(answer.ok && answer.value?.modules).toBe(3);
  });

  it("a home's reasons are the soul's own declarations: declared, a default, turned off", () => {
    const document = recorded();
    (document.capabilities as unknown[]).push(reviewer);
    const soul = (document.souls as Record<string, unknown>[])[0]!;
    soul.declarations = { capabilities: { "nw.review": { from: "here" }, "oats.core": { from: "package" }, "oats.jira": "off" } };
    delete document.capabilitiesOff;
    const answer = parsePanelSoul(document);
    expect(answer.ok && answer.value?.capabilities).toEqual([
      { name: "oats.bb", why: "default", team: null, reason: null, overrides: null, source: { kind: "package", name: "oats.bb", version: "9b95a56f237ff4006a69545963d5130d6eb4ddc5" } },
      { name: "oats.core", why: "soul", team: null, reason: null, overrides: null, source: { kind: "package", name: "oats.framework", version: "1.26.0" } },
      { name: "nw.review", why: "soul", team: null, reason: null, overrides: null, source: { kind: "home", name: "agents", version: "latest" } },
      { name: "oats.jira", why: "off", team: null, reason: "off", overrides: null, source: null },
    ]);
  });

  it("where the kernel says why (composedFrom, capabilitiesOff), its word wins", () => {
    const document = recorded();
    const [bb, core] = document.capabilities as Record<string, unknown>[];
    bb!.composedFrom = "soul";
    core!.composedFrom = "team:eng";
    (document.capabilities as unknown[]).push({ ...reviewer, composedFrom: "workspace" });
    document.capabilitiesOff = [
      { id: "oats.jira", off: true, from: "soul", reason: "off", overrides: "workspace" },
      { id: "oats.linear", off: true, from: "soul", reason: "slot-none", slot: "tasks", overrides: "workspace" },
      { id: "oats.x", off: true, from: "soul", reason: "slot-none", overrides: "team:eng" },
    ];
    const answer = parsePanelSoul(document);
    expect(answer.ok && answer.value?.capabilities.map(({ name, why, team, reason, overrides }) => ({ name, why, team, reason, overrides }))).toEqual([
      { name: "nw.review", why: "workspace", team: null, reason: null, overrides: null },
      { name: "oats.core", why: "team", team: "eng", reason: null, overrides: null },
      { name: "oats.bb", why: "soul", team: null, reason: null, overrides: null },
      { name: "oats.jira", why: "off", team: null, reason: "off", overrides: "workspace" },
      { name: "oats.x", why: "off", team: null, reason: "slot-none", overrides: "team:eng" },
    ]);
    expect(answer.ok && answer.value?.capabilities[0]?.source).toEqual({ kind: "repo", name: "agents", version: "latest" });
  });

  it("the teams are the mapped ones, and the warnings the ones with a message", () => {
    const document = recorded();
    document.teams = [{ label: "eng", team: "eng:nw.aweb.ai", default: true, from: "shared" }, { label: "ops", team: null, default: false, from: "shared" }, "x"];
    document.warnings = [
      { code: "hook-event-unsupported", capability: "oats.core", path: ".oats/modules/oats.core/oats.json", message: "oats.core declares a hook this harness never runs" },
      { code: "x", capability: "not a name", message: "kept without its capability" },
      { code: "no-message" },
    ];
    const answer = parsePanelSoul(document);
    expect(answer.ok && answer.value?.teams).toEqual(["eng"]);
    expect(answer.ok && answer.value?.warnings).toEqual([
      { code: "hook-event-unsupported", capability: "oats.core", path: ".oats/modules/oats.core/oats.json", message: "oats.core declares a hook this harness never runs" },
      { code: "x", capability: null, path: null, message: "kept without its capability" },
    ]);
  });

  it("an inspection that names no soul answers nothing to draw; one that is no inspection is an error", () => {
    const document = recorded();
    document.souls = [];
    expect(parsePanelSoul(document)).toEqual({ ok: true, value: null });
    const answer = parsePanelSoul({ operationsApi: 1 });
    expect(!answer.ok && answer.error.code).toBe("OATS_BAD_ANSWER");
  });

  it("a member's label is the last segment of its key", () => {
    expect(["github.com/nw/agents.git", "local//abs/real/src/oats-real", "agents"].map(memberLabel)).toEqual(["agents", "oats-real", "agents"]);
  });
});
