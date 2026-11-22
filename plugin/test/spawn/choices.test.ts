// The choices of the New agent form in the kernel's argv, and what its preview answers: each
// choice adds its flag only when it was made, and a choice that is none starts no process.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { checkSpawn, parseSpawnPreview, spawnArgv, spawnPreviewArgv } from "../../kernel/spawn";

const SOULS = ["oats-developer"];
const DECLARED = ["claude", "pi"];
const preview = JSON.parse(readFileSync(join(process.cwd(), "test/fixtures/spawn/spawn-preview.json"), "utf8")) as { result: unknown };

describe("the form's choices", () => {
  it("with none made, the argv is the soul on bb in full mode with its task, and the kernel resolves the rest", () => {
    const checked = checkSpawn({ soul: "oats-developer" }, SOULS);
    expect(checked).toEqual({ ok: true, value: { soul: "oats-developer" } });
    if (!checked.ok) return;
    expect(spawnPreviewArgv(checked.value, "/t/task")).toEqual(["spawn", "oats-developer", "--backend", "bb", "--yolo", "--task-file", "/t/task", "--preview", "--json"]);
  });

  it("each choice is its own flag, on the preview and on the apply alike", () => {
    const checked = checkSpawn({ soul: "oats-developer", name: "flaky-ci-developer", harness: "pi", model: "anthropic/claude-sonnet-5", relation: { kind: "child", to: "redesign-ui-lead" }, background: true }, SOULS, DECLARED);
    if (!checked.ok) throw new Error(JSON.stringify(checked.error));
    const choices = ["--name", "flaky-ci-developer", "--task-file", "/t/task", "--harness", "pi", "--model", "anthropic/claude-sonnet-5", "--relation", "child", "--relative-to", "redesign-ui-lead", "--background"];
    expect(spawnPreviewArgv(checked.value, "/t/task")).toEqual(["spawn", "oats-developer", "--backend", "bb", "--yolo", ...choices, "--preview", "--json"]);
    expect(spawnArgv(checked.value, "/t/task", { revision: "f48a98cea8a3a34508aab024", key: "spawn-1f0c9a7e" })).toEqual(["spawn", "oats-developer", "--backend", "bb", "--yolo", ...choices, "--expect-decision", "f48a98cea8a3a34508aab024", "--idempotency-key", "spawn-1f0c9a7e", "--json"]);
    const off = checkSpawn({ soul: "oats-developer", background: false }, SOULS);
    expect(off.ok && spawnPreviewArgv(off.value, "/t").includes("--no-background")).toBe(true);
  });

  it("a harness the provider does not declare, a model or a name that could be an option, and a relation to no instance start no process", () => {
    const refused = (input: Parameters<typeof checkSpawn>[0]) => expect(checkSpawn(input, SOULS, DECLARED)).toMatchObject({ ok: false, error: { code: "INVALID_INPUT" } });
    refused({ soul: "no-such-soul" });
    refused({ soul: "oats-developer", harness: "codex" });
    refused({ soul: "oats-developer", model: "--model" });
    refused({ soul: "oats-developer", name: "--name" });
    refused({ soul: "oats-developer", relation: { kind: "child", to: "--parent" } });
    refused({ soul: "oats-developer", relation: { kind: "owner" as "child", to: "redesign-ui-lead" } });
    // A harness is named only against the provider's list: with none read, none can be named.
    expect(checkSpawn({ soul: "oats-developer", harness: "pi" }, SOULS)).toMatchObject({ ok: false });
  });

  it("the preview answers what will be created, the name the kernel would give, and the soul's own background", () => {
    const parsed = parseSpawnPreview(preview.result);
    expect(parsed).toMatchObject({ ok: true, value: { revision: "f48a98cea8a3a34508aab024", instance: "flaky-ci-2-developer", background: false, facts: { resolved: { harness: "pi", model: "github-copilot/claude-fable-5.1" } } } });
    if (parsed.ok) expect(parsed.value.facts.identity[0]).toEqual({ label: "Name", text: "numbered by the kernel", muted: true });
  });
});
