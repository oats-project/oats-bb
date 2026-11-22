// The harness list and the checks of a named harness and model: kernel/spawn.ts against what the
// real kernel printed for `oats capabilities show oats.bb --json`, and server/spawn.ts through the
// whole backend.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { host } from "../../contract/spawn";
import { checkHarness, checkModel, harnessListArgv, parseHarnessList } from "../../kernel/spawn";
import { startBackend, type Backend } from "../support/backend";

const recorded = JSON.parse(readFileSync(join(process.cwd(), "test/fixtures/spawn/capabilities-show-bb.json"), "utf8")) as { result: unknown };

let backend: Backend | undefined;
afterEach(async () => {
  await backend?.dispose();
  backend = undefined;
});

describe("the harnesses the bb session provider declares", () => {
  it("are read with one command, from the capability as the deployment resolves it", () => {
    expect(harnessListArgv()).toEqual(["capabilities", "show", "oats.bb", "--json"]);
    expect(parseHarnessList(recorded.result)).toEqual({ ok: true, value: { harnesses: ["claude", "pi"] } });
  });

  it("a provider from before the list declares none; an id that is no harness's is left out, each is listed once", () => {
    expect(parseHarnessList({ sessionProviders: { bb: {} } })).toEqual({ ok: true, value: { harnesses: [] } });
    expect(parseHarnessList({ sessionProviders: {} })).toEqual({ ok: true, value: { harnesses: [] } });
    expect(parseHarnessList({})).toEqual({ ok: true, value: { harnesses: [] } });
    expect(parseHarnessList({ sessionProviders: { bb: { harnesses: ["claude", "claude", "--yolo", "../x", 3, "Pi", "pi"] } } })).toEqual({ ok: true, value: { harnesses: ["claude", "pi"] } });
    expect(parseHarnessList({ sessionProviders: { bb: { harnesses: "claude" } } })).toEqual({ ok: true, value: { harnesses: [] } });
    expect(parseHarnessList([])).toMatchObject({ ok: false, error: { code: "OATS_BAD_ANSWER" } });
  });

  it("the server reads it once for every client and names the machine bb's models are asked of", async () => {
    backend = await startBackend();
    const [first, second] = await Promise.all([backend.rpc<{ harnesses: string[]; hostId: string | null }>("spawnHarnesses"), backend.rpc<{ harnesses: string[]; hostId: string | null }>("spawnHarnesses")]);
    expect(first).toEqual({ harnesses: ["claude", "pi"], hostId: "host_falcon" });
    expect(second).toEqual(first);
    const calls = (await backend.fake.calls()).filter((call) => call.verb === "capabilities show");
    expect(calls.map((call) => call.argv)).toEqual([["capabilities", "show", "oats.bb", "--json"]]);
    expect(calls[0]!.cwd).toBe(backend.fake.deployment);
  });

  it("the kernel's refusal is shown with its code and message; bb may retry the read", async () => {
    const refusal = JSON.stringify({ schemaVersion: 1, ok: false, error: { code: "E_CAPABILITY_UNKNOWN", message: 'no capability "oats.bb" in this workspace' } });
    backend = await startBackend({ verbs: { "capabilities show": { stdout: refusal } } });
    await expect(backend.rpc("spawnHarnesses")).rejects.toThrow('E_CAPABILITY_UNKNOWN: no capability "oats.bb" in this workspace');
    expect("experimental_retryable" in host.spawnHarnesses && host.spawnHarnesses.experimental_retryable).toBe(true);
  });
});

describe("a harness and a model named for a spawn, a start or a restart", () => {
  it("a harness is one the provider declares: anything else starts no process", () => {
    expect(checkHarness("pi", ["claude", "pi"])).toEqual({ ok: true, value: "pi" });
    for (const harness of ["codex", "", "--harness", "Pi", "pi ", "../pi"]) expect(checkHarness(harness, ["claude", "pi"])).toMatchObject({ ok: false, error: { code: "INVALID_INPUT" } });
    expect(checkHarness("claude", [])).toMatchObject({ ok: false, error: { message: expect.stringContaining("(none)") } });
    // Listed, and still no id: a list is never trusted for the shape.
    expect(checkHarness("--yolo", ["--yolo"])).toMatchObject({ ok: false });
  });

  it("a model is one argv element that cannot be read as an option", () => {
    for (const model of ["claude-opus-5", "anthropic/claude-sonnet-5", "github-copilot/claude-fable-5.1", "o3:high", "a model with spaces"]) expect(checkModel(model)).toEqual({ ok: true, value: model });
    for (const model of ["", "--model", "-x", "two\nlines", "nul\0", "x".repeat(257)]) expect(checkModel(model)).toMatchObject({ ok: false, error: { code: "INVALID_INPUT" } });
  });
});
