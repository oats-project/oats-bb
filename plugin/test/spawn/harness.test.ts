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
    // With the provider's own version, as the kernel printed it (here a commit: the real run takes the provider from its repository).
    expect(parseHarnessList(recorded.result)).toEqual({ ok: true, value: { harnesses: ["claude", "pi"], version: "9b95a56f237ff4006a69545963d5130d6eb4ddc5" } });
    expect((recorded.result as { version: unknown }).version).toBe("9b95a56f237ff4006a69545963d5130d6eb4ddc5");
    for (const [printed, read] of [["1.4.0", "1.4.0"], ["0.3.0-rc.1+build", "0.3.0-rc.1+build"], ["--yolo", null], ["1.0 beta", null], ["", null], [3, null], [undefined, null]] as const) {
      expect(parseHarnessList({ version: printed, sessionProviders: { bb: { harnesses: ["claude"] } } }), String(printed)).toEqual({ ok: true, value: { harnesses: ["claude"], version: read } });
    }
  });

  it("a provider from before the list declares none; an id that is no harness's is left out, each is listed once", () => {
    expect(parseHarnessList({ sessionProviders: { bb: {} } })).toEqual({ ok: true, value: { harnesses: [], version: null } });
    expect(parseHarnessList({ sessionProviders: {} })).toEqual({ ok: true, value: { harnesses: [], version: null } });
    expect(parseHarnessList({})).toEqual({ ok: true, value: { harnesses: [], version: null } });
    expect(parseHarnessList({ sessionProviders: { bb: { harnesses: ["claude", "claude", "--yolo", "../x", 3, "Pi", "pi"] } } })).toEqual({ ok: true, value: { harnesses: ["claude", "pi"], version: null } });
    expect(parseHarnessList({ sessionProviders: { bb: { harnesses: "claude" } } })).toEqual({ ok: true, value: { harnesses: [], version: null } });
    expect(parseHarnessList([])).toMatchObject({ ok: false, error: { code: "OATS_BAD_ANSWER" } });
  });

  it("the server reads it once for every client and names the machine bb's models are asked of", async () => {
    backend = await startBackend();
    const [first, second] = await Promise.all([backend.rpc<{ harnesses: string[]; hostId: string | null }>("spawnHarnesses"), backend.rpc<{ harnesses: string[]; hostId: string | null }>("spawnHarnesses")]);
    // (And where a spawn may run: a bb thread first, then the kernel's own backends, with the harnesses the kernel launches itself: `oats version --json`, recorded.)
    expect(first).toEqual({ harnesses: ["claude", "pi"], hostId: "host_falcon", provider: true, backends: ["bb", "tmux"], kernelHarnesses: ["pi", "claude", "codex"] });
    expect(second).toEqual(first);
    const calls = (await backend.fake.calls()).filter((call) => call.verb === "capabilities show");
    expect(calls.map((call) => call.argv)).toEqual([["capabilities", "show", "oats.bb", "--json"]]);
    expect(calls[0]!.cwd).toBe(backend.fake.deployment);
  });

  it("the kernel's refusal is shown with its code and message; bb may retry the read", async () => {
    const refusal = JSON.stringify({ schemaVersion: 1, ok: false, error: { code: "E_WORKSPACE_INVALID", message: "oats-workspace.yaml: capabilities must be a list" } });
    backend = await startBackend({ verbs: { "capabilities show": { stdout: refusal } } });
    await expect(backend.rpc("spawnHarnesses")).rejects.toThrow("E_WORKSPACE_INVALID: oats-workspace.yaml: capabilities must be a list");
    expect("experimental_retryable" in host.spawnHarnesses && host.spawnHarnesses.experimental_retryable).toBe(true);
  });

  // A deployment that does not have the bb session provider at all: the kernel knows no capability `oats.bb`.
  // RECORDED: the real kernel's answer on the real run's second deployment (test/fixtures/spawn/README.md).
  const ABSENT = readFileSync(join(process.cwd(), "test/fixtures/spawn/capabilities-show-bb-absent.json"), "utf8");
  it("a deployment with NO bb session provider is an answer, not a failed read: no harness, and `provider: false`", async () => {
    backend = await startBackend({ verbs: { "capabilities show": { stdout: ABSENT } } });
    expect(await backend.rpc("spawnHarnesses")).toEqual({ harnesses: [], hostId: "host_falcon", provider: false, backends: ["tmux"], kernelHarnesses: ["pi", "claude", "codex"] });
  });

  it("the same code for a provider the workspace DOES hold is told by what the refusal names, not by its sentence: pinned and not synced is an answer for the form (the way on) and a refusal for every act; a member with none is a failed read", async () => {
    // SHAPED, from the kernel's source (OATS 0.70.5 lib/capability-show.mjs `capabilitySource`): the two other things
    // it answers E_CAPABILITY_UNKNOWN for, with the `details` it gives each. The sentences are reworded here on
    // purpose: nothing reads them.
    const others = [
      { message: "(a package that is not in the lock yet)", details: { name: "oats.bb", package: "oats.bb" } },
      { message: "(a member with no such capability)", details: { name: "oats.bb", member: "github.com/oats-project/oats-bb" } },
    ];
    for (const error of others) {
      backend = await startBackend({ verbs: { "capabilities show": { stdout: JSON.stringify({ schemaVersion: 1, ok: false, error: { code: "E_CAPABILITY_UNKNOWN", ...error } }), exit: 1 } } });
      const refused = `E_CAPABILITY_UNKNOWN: ${error.message}`;
      // The form's read: pinned and not synced is ANSWERED, with the kernel's code and sentence and nothing offered
      // (the form says the way on); a member with no such capability is a failed read.
      if ("package" in error.details) expect(await backend.rpc("spawnHarnesses"), error.message).toEqual({ harnesses: [], hostId: "host_falcon", unsynced: { code: "E_CAPABILITY_UNKNOWN", message: error.message } });
      else await expect(backend.rpc("spawnHarnesses"), error.message).rejects.toThrow(refused);
      // Every ACT is refused with the kernel's sentence, and no spawn reaches the kernel: the dialogs' read, a preview, a spawn.
      await expect(backend.rpc("startCheck", { instance: "kernel-fix-developer" }), error.message).rejects.toThrow(refused);
      await expect(backend.rpc("spawnPlan", { soul: "oats-developer", task: "" }), error.message).rejects.toThrow(refused);
      await expect(backend.rpc("spawn", { soul: "oats-developer", task: "", key: "spawn-9a8b7c6d" }), error.message).rejects.toThrow(refused);
      expect((await backend.fake.calls()).filter((call) => call.verb.startsWith("spawn"))).toEqual([]);
      await backend.dispose();
    }
    // And the true case with its sentence reworded is still the answer: the code and the structure decide.
    backend = await startBackend({ verbs: { "capabilities show": { stdout: JSON.stringify({ schemaVersion: 1, ok: false, error: { code: "E_CAPABILITY_UNKNOWN", message: "(reworded)", details: { name: "oats.bb" } } }), exit: 1 } } });
    expect(await backend.rpc("spawnHarnesses")).toMatchObject({ harnesses: [], hostId: "host_falcon", provider: false });
    expect(await backend.rpc("startCheck", { instance: "kernel-fix-developer" })).toMatchObject({ harnesses: [] });
  });

  it("there a preview and a spawn name NO backend, no mode and no harness: the kernel decides, as `oats spawn <soul>` does; a harness named is one the KERNEL launches, never bb's", async () => {
    // (The kernel's own preview there, recorded by the real run: on tmux, with NO mode decided.)
    backend = await startBackend({ verbs: { "capabilities show": { stdout: ABSENT }, "spawn --preview": { stdout: readFileSync(join(process.cwd(), "test/fixtures/spawn/spawn-preview-no-provider.json"), "utf8") } } });
    const plan = (await backend.rpc("spawnPlan", { soul: "oats-developer", task: "" })) as { facts: { facts: { label: string; parts: { text: string }[] }[] } };
    // The column follows what was asked: it says where the kernel put it, and nothing of an access nobody asked for.
    expect(plan.facts.facts.filter((fact) => ["Session", "Runs in", "Access"].includes(fact.label)).map((fact) => [fact.label, fact.parts[0]!.text])).toEqual([["Runs in", "tmux session"]]);
    await backend.rpc("spawn", { soul: "oats-developer", task: "", key: "spawn-0a1b2c3d" });
    const calls = (await backend.fake.calls()).filter((call) => call.verb === "spawn --preview" || call.verb === "spawn");
    expect(calls.length).toBeGreaterThanOrEqual(2);
    for (const call of calls) {
      expect(call.argv.slice(0, 2), call.verb).toEqual(["spawn", "oats-developer"]);
      for (const flag of ["--backend", "--yolo", "--harness", "--model"]) expect(call.argv, `${call.verb} ${flag}`).not.toContain(flag);
    }
    // A harness named there: one of the kernel's own list goes to the kernel, still with no backend and no mode;
    // anything else starts no process.
    await backend.rpc("spawnPlan", { soul: "oats-developer", task: "", harness: "codex" });
    const named = (await backend.fake.calls()).filter((call) => call.verb === "spawn --preview").at(-1)!;
    expect(named.argv.slice(named.argv.indexOf("--harness"), named.argv.indexOf("--harness") + 2)).toEqual(["--harness", "codex"]);
    for (const flag of ["--backend", "--yolo"]) expect(named.argv).not.toContain(flag);
    const before = (await backend.fake.calls()).filter((call) => call.verb.startsWith("spawn")).length;
    await expect(backend.rpc("spawnPlan", { soul: "oats-developer", task: "", harness: "gemini" })).rejects.toThrow('"gemini" is not a harness this OATS launches (pi, claude, codex)');
    await expect(backend.rpc("spawnPlan", { soul: "oats-developer", task: "", backend: "bb" })).rejects.toThrow('"bb" is not a session backend a spawn can name here (tmux)');
    expect((await backend.fake.calls()).filter((call) => call.verb.startsWith("spawn")).length).toBe(before);
  });

  // THE ARGV TABLE: what a spawn names, by where it runs. (`--yolo` is what the plugin asks of bb, and of bb alone.)
  it("where the provider is there: a bb thread by default (`--backend bb --yolo`); tmux chosen names `--backend tmux` and NO mode, with a harness of the kernel's own; a place nothing lists starts no process", async () => {
    backend = await startBackend();
    const { rpc, fake } = backend;
    const last = async (verb: string) => (await fake.calls()).filter((call) => call.verb === verb).at(-1)!.argv;
    const flags = (argv: string[]) => argv.filter((part, at) => part.startsWith("--") && !["--json", "--preview", "--name", "--task-file", "--idempotency-key", "--expect-decision"].includes(part) ? true : ["--backend", "--harness"].includes(argv[at - 1] ?? ""));
    // Nothing chosen, and bb chosen: the same spawn.
    await rpc("spawnPlan", { soul: "oats-developer", task: "" });
    expect(flags(await last("spawn --preview"))).toEqual(["--backend", "bb", "--yolo"]);
    await rpc("spawnPlan", { soul: "oats-developer", task: "", backend: "bb", harness: "pi" });
    expect(flags(await last("spawn --preview"))).toEqual(["--backend", "bb", "--yolo", "--harness", "pi"]);
    // tmux chosen: the backend named, no mode; the preview and the apply alike.
    await rpc("spawnPlan", { soul: "oats-developer", task: "", backend: "tmux" });
    expect(flags(await last("spawn --preview"))).toEqual(["--backend", "tmux"]);
    await rpc("spawn", { soul: "oats-developer", task: "", backend: "tmux", key: "spawn-7f3e2d1c" });
    expect(flags(await last("spawn"))).toEqual(["--backend", "tmux"]);
    // Its harness is one the kernel launches: codex is, though the bb provider declares none such; and on bb it is refused.
    await rpc("spawnPlan", { soul: "oats-developer", task: "", backend: "tmux", harness: "codex" });
    expect(flags(await last("spawn --preview"))).toEqual(["--backend", "tmux", "--harness", "codex"]);
    const before = (await fake.calls()).filter((call) => call.verb.startsWith("spawn")).length;
    await expect(rpc("spawnPlan", { soul: "oats-developer", task: "", harness: "codex" })).rejects.toThrow('"codex" is not a harness the bb session provider declares (claude, pi)');
    await expect(rpc("spawnPlan", { soul: "oats-developer", task: "", backend: "tmux", harness: "gemini" })).rejects.toThrow('"gemini" is not a harness this OATS launches (pi, claude, codex)');
    await expect(rpc("spawnPlan", { soul: "oats-developer", task: "", backend: "screen" })).rejects.toThrow('"screen" is not a session backend a spawn can name here (bb, tmux)');
    await expect(rpc("spawn", { soul: "oats-developer", task: "", backend: "--yolo", key: "spawn-00aa11bb" })).rejects.toThrow("is not a session backend a spawn can name here");
    expect((await fake.calls()).filter((call) => call.verb.startsWith("spawn")).length).toBe(before);
  });

  it("a preview the kernel refuses spawns nothing: tmux chosen where the kernel has no such backend is its refusal, and no apply is asked", async () => {
    // SHAPED: the kernel's refusal of a backend it does not have, in the words of OATS 0.70.5 lib/session-providers.mjs
    // (`E_BACKEND_UNKNOWN`); the real run cannot make it (its kernel has tmux).
    const refusal = JSON.stringify({ schemaVersion: 1, ok: false, error: { code: "E_BACKEND_UNKNOWN", message: 'unknown session backend "tmux": no capability of this instance declares it as a session provider' } });
    backend = await startBackend({ verbs: { "spawn --preview": { stdout: refusal, exit: 1 } } });
    await expect(backend.rpc("spawnPlan", { soul: "oats-developer", task: "", backend: "tmux" })).rejects.toThrow("E_BACKEND_UNKNOWN");
    await expect(backend.rpc("spawn", { soul: "oats-developer", task: "", backend: "tmux", key: "spawn-5e4d3c2b" })).rejects.toThrow("E_BACKEND_UNKNOWN");
    expect((await backend.fake.calls()).filter((call) => call.verb === "spawn")).toEqual([]);
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
