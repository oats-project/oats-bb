// A5: the spawn argv has no shell and carries `--backend bb` and `--yolo` (bb's full mode, on
// every spawn: the preview and the apply alike); a soul not in the list, and names
// with a space, a slash, an upper-case letter or a leading dash, are refused before any process
// starts; the task file is 0600 and gone after the call, on success and on failure.
import { existsSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { codes, createOats, Processes, type Oats } from "../../kernel/index.js";
import { installFakeOats, type FakeOats } from "../support/fake-oats.js";

let fake: FakeOats;
let processes: Processes;
let oats: Oats;
const SOULS = ["oats-developer", "oats.okf/knowledge-harvester"];
const context = () => ({ knownSouls: SOULS, tempDir: fake.tempDir });
const leftInTemp = async () => (existsSync(fake.tempDir) ? readdir(fake.tempDir) : []);

beforeEach(async () => {
  fake = await installFakeOats();
  processes = new Processes();
  oats = createOats({ bin: fake.bin, cwd: fake.deployment, processes });
});
afterEach(async () => {
  await processes.killAll();
  await fake.remove();
});

describe("A5 spawn", () => {
  it("previews with an argv array that carries --backend bb and --yolo, the name as one element and the task as a file", async () => {
    const task = "Fix the flaky CI job.\n$(touch /tmp/should-not-exist) ; rm -rf ~ `id` \"quoted\" --yolo\n";
    const preview = await oats.spawnPreview({ soul: "oats-developer", name: "flaky-ci-2-developer", task }, context());
    expect(preview.ok).toBe(true);
    const [call] = await fake.calls();
    expect(call?.argv).toEqual(["spawn", "oats-developer", "--backend", "bb", "--yolo", "--name", "flaky-ci-2-developer", "--task-file", call?.taskFile?.path, "--preview", "--json"]);
    // No shell read the task: it arrived byte for byte, in the file.
    expect(call?.taskFile?.text).toBe(task);
    expect(call?.taskFile?.mode).toBe("600");
    expect(call?.taskFile?.path.startsWith(fake.tempDir)).toBe(true);
    expect(existsSync(call!.taskFile!.path)).toBe(false);
    if (!preview.ok) return;
    expect(preview.value.revision).toMatch(/^[0-9a-f]{24}$/);
    // What will be created, in the form's words (model/spawn.ts), for the name that was asked: never the kernel's preview whole.
    expect(preview.value.facts.identity[0]).toEqual({ label: "Name", text: "flaky-ci-2-developer" });
    expect(preview.value.facts.resolved).toEqual({ harness: "pi", model: "github-copilot/claude-fable-5.1" });
    expect(preview.value.problem).toBeNull();
  });

  it("applies a previewed decision with the idempotency key", async () => {
    const preview = await oats.spawnPreview({ soul: "oats-developer", name: "flaky-ci-2-developer", task: "Fix it." }, context());
    expect(preview.ok).toBe(true);
    if (!preview.ok) return;
    const spawned = await oats.spawn({ soul: "oats-developer", name: "flaky-ci-2-developer", task: "Fix it.", key: "spawn-1f0c9a7e", revision: preview.value.revision }, context());
    expect(spawned).toEqual({ ok: true, value: { instance: "flaky-ci-2-developer", threadId: "thr_ad488edeab" } });
    const calls = await fake.calls();
    expect(calls.map((call) => call.verb)).toEqual(["spawn --preview", "spawn"]);
    const apply = calls[1]!;
    expect(apply.argv).toEqual([
      "spawn", "oats-developer", "--backend", "bb", "--yolo", "--name", "flaky-ci-2-developer", "--task-file", apply.taskFile?.path,
      "--expect-decision", preview.value.revision, "--idempotency-key", "spawn-1f0c9a7e", "--json",
    ]);
    expect(apply.argv).not.toContain("--preview");
    // The kernel binds the apply to the preview's decision: both ask for full mode, in the same place.
    expect(apply.argv.slice(0, 7)).toEqual(calls[0]!.argv.slice(0, 7));
    // A file of its own for each process, 0600, gone afterwards.
    expect(apply.taskFile).toMatchObject({ mode: "600", text: "Fix it." });
    expect(apply.taskFile?.path.startsWith(fake.tempDir)).toBe(true);
    expect(await leftInTemp()).toEqual([]);
  });

  it("refuses a soul that is not in the list before any process starts", async () => {
    for (const soul of ["no-such-soul", "--help", "oats-developer --yolo", ""]) {
      const preview = await oats.spawnPreview({ soul, name: "x-developer", task: "t" }, context());
      expect(preview.ok === false && preview.error.code, soul).toBe(codes.invalidInput);
      const spawned = await oats.spawn({ soul, name: "x-developer", task: "t", key: "spawn-1f0c9a7e", revision: "c557d8ec9a272ba1c1739dc3" }, context());
      expect(spawned.ok === false && spawned.error.code, soul).toBe(codes.invalidInput);
    }
    expect(await fake.calls()).toEqual([]);
    expect(await leftInTemp()).toEqual([]);
  });

  it("refuses a name with a space, a slash, an upper-case letter or a leading dash before any process starts", async () => {
    for (const name of ["two words", "a/b", "../escape", "Upper", "-leading", "--preview", "", "a".repeat(64), "name\nnewline", "x;id"]) {
      const preview = await oats.spawnPreview({ soul: "oats-developer", name, task: "t" }, context());
      expect(preview.ok === false && preview.error.code, name).toBe(codes.invalidInput);
      const spawned = await oats.spawn({ soul: "oats-developer", name, task: "t", key: "spawn-1f0c9a7e", revision: "c557d8ec9a272ba1c1739dc3" }, context());
      expect(spawned.ok === false && spawned.error.code, name).toBe(codes.invalidInput);
    }
    expect(await fake.calls()).toEqual([]);
    expect(await leftInTemp()).toEqual([]);
  });

  it("refuses a key or a revision that is not the kernel's shape before any process starts", async () => {
    const bad = await oats.spawn({ soul: "oats-developer", name: "x-developer", task: "t", key: "--force", revision: "c557d8ec9a272ba1c1739dc3" }, context());
    expect(bad.ok === false && bad.error.code).toBe(codes.invalidInput);
    const worse = await oats.spawn({ soul: "oats-developer", name: "x-developer", task: "t", key: "spawn-1f0c9a7e", revision: "--no-launch" }, context());
    expect(worse.ok === false && worse.error.code).toBe(codes.invalidInput);
    expect(await fake.calls()).toEqual([]);
  });

  it("removes the task file when the kernel refuses the spawn, and answers the kernel's code and message", async () => {
    const refused = { schemaVersion: 1, ok: false, error: { code: "E_INSTANCE_NAME_TAKEN", message: 'instance name "flaky-ci-developer" is taken', details: { instance: "flaky-ci-developer" } } };
    await fake.behave({ spawn: { stdout: JSON.stringify(refused) } });
    const spawned = await oats.spawn({ soul: "oats-developer", name: "flaky-ci-developer", task: "again", key: "spawn-1f0c9a7e", revision: "c557d8ec9a272ba1c1739dc3" }, context());
    expect(spawned).toEqual({ ok: false, error: { code: "E_INSTANCE_NAME_TAKEN", message: 'instance name "flaky-ci-developer" is taken' } });
    const calls = await fake.calls();
    expect(calls.map((call) => call.verb)).toEqual(["spawn"]);
    expect(calls[0]?.taskFile).toMatchObject({ mode: "600", text: "again" });
    expect(existsSync(calls[0]!.taskFile!.path)).toBe(false);
    expect(await leftInTemp()).toEqual([]);
  });

  it("answers the kernel's marker of an unconfirmed spawn with the refusal, only where it is the literal true", async () => {
    // SHAPED from the kernel's source, not recorded (a rollback that fails cannot be made in the real
    // run): awebai/oats lib/core.mjs at v0.70.5, `unconfirmedSpawn` (3863-3865: `error.details =
    // { ...error.details, unconfirmed: true }`) and the note of line 5235.
    const message = "x-developer was not launched: oats.bb's session provider bb is not ready — rollback INCOMPLETE, clean up manually: instance home /abs/home: still present";
    const refuse = (details: unknown) => fake.behave({ spawn: { stdout: JSON.stringify({ schemaVersion: 1, ok: false, error: { code: "E_BACKEND_NOT_READY", message, details } }), exit: 1 } });
    const spawn = () => oats.spawn({ soul: "oats-developer", name: "x-developer", task: "t", key: "spawn-1f0c9a7e", revision: "c557d8ec9a272ba1c1739dc3" }, context());
    await refuse({ unconfirmed: true });
    expect(await spawn()).toEqual({ ok: false, error: { code: "E_BACKEND_NOT_READY", message, unconfirmed: true } });
    await refuse({});
    expect(await spawn()).toEqual({ ok: false, error: { code: "E_BACKEND_NOT_READY", message } });
    await refuse({ unconfirmed: [{ key: "oats", reason: "unreachable", detail: "d" }] });
    expect(await spawn()).toEqual({ ok: false, error: { code: "E_BACKEND_NOT_READY", message } });
    expect(await leftInTemp()).toEqual([]);
  });

  it("removes the task file when oats fails with no answer", async () => {
    await fake.behave({ spawn: { stdout: "", stderr: "oats: crashed\n", exit: 2 } });
    const spawned = await oats.spawn({ soul: "oats-developer", name: "x-developer", task: "t", key: "spawn-1f0c9a7e", revision: "c557d8ec9a272ba1c1739dc3" }, context());
    expect(spawned.ok === false && spawned.error.code).toBe(codes.failed);
    expect((await fake.calls()).map((call) => call.verb)).toEqual(["spawn"]);
    expect(await leftInTemp()).toEqual([]);
  });

  it("removes the task file when the spawn is cut off by its time limit", async () => {
    await fake.behave({ "spawn --preview": { sleepMs: 60_000 } });
    const slow = createOats({ bin: fake.bin, cwd: fake.deployment, processes, timeouts: { preview: 300 } });
    const preview = await slow.spawnPreview({ soul: "oats-developer", name: "x-developer", task: "t" }, context());
    expect(preview.ok === false && preview.error.code).toBe(codes.timeout);
    expect(await leftInTemp()).toEqual([]);
  });
});

describe("the choices of the New agent form, as arguments", () => {
  const argvOf = async () => (await fake.calls()).map((call) => call.argv);

  it("passes nothing a person did not choose: no --name, no task file for an empty instruction, no --harness, no --model, no relation", async () => {
    const preview = await oats.spawnPreview({ soul: "oats-developer", task: "  \n" }, context());
    expect(preview.ok).toBe(true);
    if (!preview.ok) return;
    // With no name the facts say who names it.
    expect(preview.value.facts.identity[0]).toEqual({ label: "Name", text: "numbered by the kernel", muted: true });
    const spawned = await oats.spawn({ soul: "oats-developer", task: "", key: "spawn-1f0c9a7e", revision: preview.value.revision }, context());
    expect(spawned.ok).toBe(true);
    expect(await argvOf()).toEqual([
      ["spawn", "oats-developer", "--backend", "bb", "--yolo", "--preview", "--json"],
      ["spawn", "oats-developer", "--backend", "bb", "--yolo", "--expect-decision", preview.value.revision, "--idempotency-key", "spawn-1f0c9a7e", "--json"],
    ]);
    expect((await fake.calls()).every((call) => call.taskFile === undefined || call.taskFile === null)).toBe(true);
    expect(await leftInTemp()).toEqual([]);
  });

  it("passes a harness, a model and a relation, each as its own elements, the same on the preview and the apply", async () => {
    const choices = { soul: "oats-developer", name: "x-developer", task: "t", harness: "claude", model: "anthropic/claude-opus-5-5", relation: { kind: "child" as const, to: "flaky-ci-developer", root: "/abs/deployment/agents" } };
    await oats.spawnPreview(choices, context());
    await oats.spawn({ ...choices, key: "spawn-1f0c9a7e", revision: "c557d8ec9a272ba1c1739dc3" }, context());
    const [preview, apply] = await fake.calls();
    const shared = ["spawn", "oats-developer", "--backend", "bb", "--yolo", "--name", "x-developer", "--task-file"];
    const chosen = ["--harness", "claude", "--model", "anthropic/claude-opus-5-5", "--relation", "child", "--relative-to", "flaky-ci-developer", "--relative-root", "/abs/deployment/agents"];
    expect(preview!.argv).toEqual([...shared, preview!.taskFile!.path, ...chosen, "--preview", "--json"]);
    expect(apply!.argv).toEqual([...shared, apply!.taskFile!.path, ...chosen, "--expect-decision", "c557d8ec9a272ba1c1739dc3", "--idempotency-key", "spawn-1f0c9a7e", "--json"]);
  });

  it("refuses a harness, a model or a relation that could be read as anything else, before any process starts", async () => {
    const base = { soul: "oats-developer", name: "x-developer", task: "t" };
    const bad = [
      { ...base, harness: "--yolo" },
      { ...base, harness: "Claude" },
      { ...base, harness: "" },
      { ...base, model: "--no-launch" },
      { ...base, model: "" },
      { ...base, model: "a\nb" },
      { ...base, relation: { kind: "child" as const, to: "--help" } },
      { ...base, relation: { kind: "child" as const, to: "Two Words" } },
      { ...base, relation: { kind: "owner" as never, to: "flaky-ci-developer" } },
      { ...base, relation: { kind: "child" as const, to: "flaky-ci-developer", root: "--dir" } },
      { ...base, relation: { kind: "child" as const, to: "flaky-ci-developer", root: "relative/agents" } },
    ];
    for (const choices of bad) {
      const preview = await oats.spawnPreview(choices, context());
      expect(preview.ok === false && preview.error.code, JSON.stringify(choices)).toBe(codes.invalidInput);
      const spawned = await oats.spawn({ ...choices, key: "spawn-1f0c9a7e", revision: "c557d8ec9a272ba1c1739dc3" }, context());
      expect(spawned.ok === false && spawned.error.code, JSON.stringify(choices)).toBe(codes.invalidInput);
    }
    expect(await fake.calls()).toEqual([]);
    expect(await leftInTemp()).toEqual([]);
  });
});

describe("a preview that is no decision a spawn could apply says why, with the code the Desktop's client gives it", () => {
  const answer = async (change: (result: Record<string, unknown>) => void) => {
    const { readFile } = await import("node:fs/promises");
    const { join } = await import("node:path");
    const document = JSON.parse(await readFile(join(process.cwd(), "test/fixtures/spawn/spawn-preview.json"), "utf8")) as { result: Record<string, unknown> };
    change(document.result);
    await fake.behave({ "spawn --preview": { stdout: JSON.stringify(document) } });
    const preview = await oats.spawnPreview({ soul: "oats-developer", name: "x-developer", task: "t" }, context());
    return preview.ok ? { problem: preview.value.problem } : null;
  };

  it("a launch the kernel found a problem with: the problem's own code and message", async () => {
    const preview = await answer((result) => {
      (result.launch as Record<string, unknown>).problem = { code: "E_LAUNCH_EXECUTABLE", message: "pi is not on PATH" };
    });
    expect(preview).toEqual({ problem: { code: "E_LAUNCH_EXECUTABLE", message: "pi is not on PATH" } });
  });

  it("checks that did not finish in the kernel's budget, and a backend that is not installed", async () => {
    const slow = await answer((result) => {
      result.preflight = { status: "timeout", budgetMs: 20000, elapsedMs: 20000 };
    });
    expect(slow).toEqual({ problem: { code: "E_PREFLIGHT_INCOMPLETE", message: "the kernel's checks did not finish within 20 s" } });
    const missing = await answer((result) => {
      result.backendStatus = { name: "bb", installed: false, started: false };
    });
    expect(missing).toEqual({ problem: { code: "E_BACKEND_UNAVAILABLE", message: "the bb backend is not installed on this machine" } });
  });
});
