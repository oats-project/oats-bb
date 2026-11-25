// The four read verbs behind the pages, against the recorded answers.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createOats, Processes, type Oats } from "../../kernel/index.js";
import { withSoulCounts } from "../../kernel/workspace.js";
import { installFakeOats, type FakeOats } from "../support/fake-oats.js";

let fake: FakeOats;
let processes: Processes;
let oats: Oats;

beforeEach(async () => {
  fake = await installFakeOats();
  processes = new Processes();
  oats = createOats({ bin: fake.bin, cwd: fake.deployment, processes });
});
afterEach(async () => {
  await processes.killAll();
  await fake.remove();
});

describe("the pages' verbs", () => {
  it("souls: the key to spawn by, the capabilities' names, and the kernel's problem", async () => {
    const answer = await oats.souls();
    expect(answer.ok).toBe(true);
    if (!answer.ok) return;
    expect(answer.value.souls.map((soul) => soul.name)).toEqual([
      "code-reviewer",
      "knowledge-harvester",
      "oats.okf/knowledge-harvester",
      "oats.okf/knowledge-maintainer",
      "oats-desktop-developer",
      "oats-developer",
      "oats-expert",
      "oats-maintainer",
      "oats-product-expert",
      "research-expert",
    ]);
    // The roster's name for each soul's agents: the bare name, `<package>--<soul>` for a package soul.
    expect(answer.value.souls.map((soul) => soul.agent)).toEqual([
      "code-reviewer",
      "knowledge-harvester",
      "oats-okf--knowledge-harvester",
      "oats-okf--knowledge-maintainer",
      "oats-desktop-developer",
      "oats-developer",
      "oats-expert",
      "oats-maintainer",
      "oats-product-expert",
      "research-expert",
    ]);
    const developer = answer.value.souls.find((soul) => soul.name === "oats-developer");
    expect(developer).toMatchObject({ origin: "member github.com/awebai/oats @ e5b6c5ac", spawnable: true, problem: null });
    expect(developer?.capabilities).toContain("oats.developer");
    expect(developer?.description.startsWith("OATS developer")).toBe(true);
    const broken = answer.value.souls.find((soul) => soul.name === "oats.okf/knowledge-maintainer");
    expect(broken).toMatchObject({ spawnable: false, capabilities: [] });
    expect(broken?.problem).toBe('E_TEAM_UNKNOWN: team "reviewers" is not declared (oats-local.yaml#/defaultTeam): declare it with `oats teams add reviewers --team <id>`');
    expect((await fake.calls()).map((call) => call.argv)).toEqual([["souls", "--json"]]);
  });

  it("capabilities: id, description, origin; the count of souls comes from the souls", async () => {
    const [capabilities, souls] = [await oats.capabilities(), await oats.souls()];
    expect(capabilities.ok && souls.ok).toBe(true);
    if (!capabilities.ok || !souls.ok) return;
    const rows = withSoulCounts(capabilities.value.capabilities, souls.value.souls);
    const core = rows.find((row) => row.id === "oats.core");
    expect(core?.origin).toMatch(/^package oats\.framework v/);
    expect(core?.souls).toBe(souls.value.souls.filter((soul) => soul.capabilities.includes("oats.core")).length);
    expect(core?.souls).toBeGreaterThan(1);
    expect(Object.keys(rows[0]!).sort()).toEqual(["description", "id", "layer", "origin", "repoOnly", "souls", "source", "version"]);
    // Who made it, the core place it fills, and whether it is kept to its own repository: the kernel's own fields.
    const row = (id: string) => { const { source, version, layer, repoOnly } = rows.find((each) => each.id === id)!; return { source, version, layer, repoOnly }; };
    expect(row("oats.aweb")).toEqual({ source: { kind: "package", label: "oats.aweb" }, version: "1.43.0", layer: "messaging", repoOnly: false });
    expect(row("oats.okf")).toMatchObject({ layer: "knowledge" });
    // A capability of the workspace's own repository is "workspace"'s; a private one is kept to its repository.
    expect(row("oats.build")).toEqual({ source: { kind: "member", label: "workspace" }, version: "4.0.2", layer: null, repoOnly: false });
    expect(row("oats.desktop-ui")).toMatchObject({ repoOnly: true });
  });

  it("souls: beside the page's own fields, where each is defined, what its agents start with, its teams (the default first) and why it has each capability", async () => {
    const answer = await oats.souls();
    expect(answer.ok).toBe(true);
    if (!answer.ok) return;
    const soul = (name: string) => answer.value.souls.find((each) => each.name === name)!;
    expect(soul("code-reviewer")).toMatchObject({ shortName: "code-reviewer", source: { kind: "member", label: "workspace" }, harness: "pi", model: "gpt-6-astra", teams: [{ label: "oats", isDefault: true }] });
    expect(soul("code-reviewer").why).toMatchObject({ "oats.aweb": "workspace", "oats.code-review": "soul" });
    expect(soul("code-reviewer").file).toBe("souls/code-reviewer/soul.yaml");
    expect(soul("code-reviewer").unresolved).toBeUndefined();
    // A soul the kernel could not resolve (it cannot be spawned): the kernel answers no list of capabilities, which is "not known", never "none".
    const broken = answer.value.souls.find((each) => !each.spawnable)!;
    expect([broken.name, broken.capabilities, broken.unresolved, broken.teams]).toEqual(["oats.okf/knowledge-maintainer", [], true, undefined]);
    // A package soul: its group is the package with its version, its own name is the name without the package.
    expect(soul("oats.okf/knowledge-harvester")).toMatchObject({ shortName: "knowledge-harvester", source: { kind: "package", label: "oats.okf 6.2.0" } });
  });

  it("teams: label, id and default; an unmapped team has no id", async () => {
    const answer = await oats.teams();
    expect(answer).toEqual({
      ok: true,
      value: {
        teams: [
          { label: "oats", team: "default:oats.aweb.ai", isDefault: true, description: "The OATS framework team", local: false, at: "github.com/awebai/oats:oats-workspace.yaml#/teams/oats" },
          { label: "docs", team: null, isDefault: false, description: null, local: false, at: "github.com/awebai/oats:oats-workspace.yaml#/teams/docs" },
        ],
        // Who may join what ("*": every soul), whether this computer may declare teams, and what the kernel says is not right, in its words.
        mayJoin: [{ soul: "*", teams: ["oats"] }],
        localTeams: true,
        problems: [{ code: "team-unmapped", label: "docs", isDefault: false, message: "shared team docs has no provider id yet", fix: "its owner runs `oats aweb setup`, then commits the id" }],
      },
    });
  });

  it("machines: the registered servers as the kernel last recorded them", async () => {
    const answer = await oats.servers();
    expect(answer).toEqual({
      ok: true,
      value: {
        machines: [
          // Its name where the registry has one beside its id, and the workspace's folder there.
          { id: "devbox-oats", route: "devbox.invalid", isThisMachine: false, label: "devbox", folder: "/srv/oats" },
          { id: "build", route: "build.invalid", isThisMachine: false, label: null, folder: "/home/ci/oats" },
        ],
      },
    });
    expect((await fake.calls()).map((call) => call.argv)).toEqual([["server", "list", "--json"]]);
  });
});
