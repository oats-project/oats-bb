// A7 and the other lifecycle verbs: stop (plan, apply), start, restart, retire (plan, apply).
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { codes, createOats, Processes, type Oats } from "../../kernel/index.js";
import { FIXTURES, installFakeOats, type FakeOats } from "../support/fake-oats.js";

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

describe("stop", () => {
  it("reads the plan into its revision and the kernel's facts: the agent first, then its children", async () => {
    const plan = await oats.stopPlan("redesign-ui-lead");
    expect(plan).toEqual({
      ok: true,
      value: {
        action: "stop",
        revision: "9c1f2e3d4b5a69788796a5b4",
        instance: "redesign-ui-lead", // the kernel's own target at depth 0
        at: "2026-11-19T12:30:00.000Z",
        recursive: true,
        targets: [
          { instance: "redesign-ui-lead", soul: "oats-product-expert", depth: 0, session: "there", backend: "bb", midTask: true },
          { instance: "desktop-mockups-developer", soul: "oats-desktop-developer", depth: 1, session: "there", backend: "bb", midTask: true },
          { instance: "harvest-knowledge-helper", soul: "knowledge-harvester", depth: 1, session: "there", backend: "bb", midTask: "unknown" },
        ],
        skipped: [],
        ambiguous: [],
      },
    });
    expect((await fake.calls()).map((call) => call.argv)).toEqual([["instance", "stop", "redesign-ui-lead", "--plan", "--json"]]);
  });

  it("asks for a plan without the children with --no-recursive, and reads who is left as they are (recorded: dialogs-1-helper, with one child)", async () => {
    await fake.behave({ "instance stop --plan": { file: "lifecycle/stop-plan-no-recursive.json" } });
    const plan = await oats.stopPlan("dialogs-1-helper", undefined, false);
    expect(plan.ok && plan.value).toEqual({
      action: "stop",
      revision: "935e7b3d5c41a5e1efd4a53a",
      instance: "dialogs-1-helper",
      at: "2026-11-22T17:53:35.622Z",
      recursive: false,
      targets: [{ instance: "dialogs-1-helper", soul: "oats-expert", depth: 0, session: "there", backend: "bb", midTask: "unknown" }],
      skipped: ["dialogs-1-child"],
      ambiguous: [],
    });
    expect((await fake.calls()).map((call) => call.argv)).toEqual([["instance", "stop", "dialogs-1-helper", "--plan", "--no-recursive", "--json"]]);
  });

  it("reads what the plan knows of a session: there, nothing to stop, or not known; and midTask as the kernel's three values", async () => {
    const answer = JSON.parse(await readFile(join(FIXTURES, "lifecycle/stop-plan.json"), "utf8"));
    const target = answer.result.targets.find((row: { instance: string }) => row.instance === "harvest-knowledge-helper");
    const read = async (session: object, midTask: unknown) => {
      Object.assign(target, { session, midTask });
      await fake.behave({ "instance stop --plan": { stdout: JSON.stringify(answer) } });
      const plan = await oats.stopPlan("redesign-ui-lead");
      const row = plan.ok ? plan.value.targets.find((each) => each.instance === "harvest-knowledge-helper") : undefined;
      return row === undefined ? null : [row.session, row.midTask];
    };
    const there = { state: "unknown", present: true, backend: "bb", established: true };
    expect(await read(there, true)).toEqual(["there", true]);
    expect(await read(there, "unknown")).toEqual(["there", "unknown"]);
    expect(await read(there, false)).toEqual(["there", false]);
    // A session that is not there has nothing to stop; the kernel's idle words say the same of one that is present.
    expect(await read({ state: "stopped", present: false, backend: "bb", established: true }, "unknown")).toEqual(["none", "unknown"]);
    expect(await read({ state: "shell", present: true, backend: "tmux", established: true }, false)).toEqual(["none", false]);
    // Not established is unknown, never idle.
    expect(await read({ state: "unestablished", present: null, backend: null, established: false, reason: "E_SESSION_UNAVAILABLE" }, true)).toEqual(["unknown", true]);
    // A value of a newer kernel is not guessed.
    expect(await read(there, "maybe")).toEqual(["there", "unknown"]);
  });

  it("applies with the plan's revision and the idempotency key, and reads the receipt row by row", async () => {
    const applied = await oats.stopApply({ instance: "redesign-ui-lead", revision: "9c1f2e3d4b5a69788796a5b4", key: "stop-7f3a9c2e41b8" });
    const row = (instance: string, alreadyIdle: boolean) => ({ instance, ok: true, alreadyIdle, code: null, stillRunning: null, detail: null });
    expect(applied).toEqual({
      ok: true,
      value: { action: "stop", ok: true, replayed: false, results: [row("harvest-knowledge-helper", true), row("desktop-mockups-developer", false), row("redesign-ui-lead", false)] },
    });
    await oats.stopApply({ instance: "redesign-ui-lead", revision: "9c1f2e3d4b5a69788796a5b4", key: "stop-7f3a9c2e41b8", recursive: false });
    expect((await fake.calls()).map((call) => call.argv)).toEqual([
      ["instance", "stop", "redesign-ui-lead", "--apply", "--plan-revision", "9c1f2e3d4b5a69788796a5b4", "--idempotency-key", "stop-7f3a9c2e41b8", "--json"],
      ["instance", "stop", "redesign-ui-lead", "--apply", "--no-recursive", "--plan-revision", "9c1f2e3d4b5a69788796a5b4", "--idempotency-key", "stop-7f3a9c2e41b8", "--json"],
    ]);
  });

  it("A7: a revision the kernel refuses returns the kernel's code and message unchanged", async () => {
    await fake.behave({ "instance stop --apply": { file: "lifecycle/stop-apply-stale.json" } });
    const kernel = JSON.parse(await readFile(join(FIXTURES, "lifecycle/stop-apply-stale.json"), "utf8"));
    const applied = await oats.stopApply({ instance: "redesign-ui-lead", revision: "9c1f2e3d4b5a69788796a5b4", key: "stop-7f3a9c2e41b8" });
    expect(applied).toEqual({ ok: false, error: { code: "E_PLAN_STALE", message: kernel.error.message } });
    expect(kernel.error.code).toBe("E_PLAN_STALE");
  });

  it("a stop that left a session running is a receipt that is not ok: its rows say which stopped and which did not", async () => {
    const receipt = JSON.parse(await readFile(join(FIXTURES, "lifecycle/stop-apply.json"), "utf8"));
    receipt.result.ok = false;
    receipt.result.results[1] = { instance: "desktop-mockups-developer", home: "/h", ok: false, code: "E_LIFECYCLE_BUSY", message: "its home is held by another command", stillRunning: null };
    receipt.result.results[2] = { instance: "redesign-ui-lead", home: "/h", ok: false, code: "E_SESSION_STOP_FAILED", message: "its harness was signalled (SIGTERM) and still runs", stillRunning: [4242] };
    await fake.behave({ "instance stop --apply": { stdout: JSON.stringify(receipt) } });
    const applied = await oats.stopApply({ instance: "redesign-ui-lead", revision: "9c1f2e3d4b5a69788796a5b4", key: "stop-7f3a9c2e41b8" });
    expect(applied.ok && applied.value.ok).toBe(false);
    expect(applied.ok && applied.value.results.slice(1)).toEqual([
      // The kernel's own sentence is kept for a home that could not be locked, and for no other row.
      { instance: "desktop-mockups-developer", ok: false, alreadyIdle: false, code: "E_LIFECYCLE_BUSY", stillRunning: null, detail: "its home is held by another command" },
      { instance: "redesign-ui-lead", ok: false, alreadyIdle: false, code: "E_SESSION_STOP_FAILED", stillRunning: [4242], detail: null },
    ]);
    // `stillRunning: []` proves nothing without the kernel's feature list: it is read as not said.
    receipt.result.results[2].stillRunning = [];
    await fake.behave({ "instance stop --apply": { stdout: JSON.stringify(receipt) } });
    const again = await oats.stopApply({ instance: "redesign-ui-lead", revision: "9c1f2e3d4b5a69788796a5b4", key: "stop-7f3a9c2e41b8" });
    expect(again.ok && again.value.results[2]?.stillRunning).toBeNull();
  });

  it("refuses an instance, a revision, a key, a harness or a model that is no argv element of its kind before any process starts", async () => {
    for (const instance of ["--plan", "Two Words", "a/b", ""]) {
      const plan = await oats.stopPlan(instance);
      expect(plan.ok === false && plan.error.code, instance).toBe(codes.invalidInput);
      const retire = await oats.retirePlan(instance);
      expect(retire.ok === false && retire.error.code, instance).toBe(codes.invalidInput);
    }
    const revision = await oats.stopApply({ instance: "dev-1", revision: "--no-recursive", key: "stop-7f3a9c2e41b8" });
    expect(revision.ok === false && revision.error.code).toBe(codes.invalidInput);
    const key = await oats.retireApply({ instance: "dev-1", revision: "9c1f2e3d4b5a69788796a5b4", key: "--force" });
    expect(key.ok === false && key.error.code).toBe(codes.invalidInput);
    const home = await oats.start("relative/home");
    expect(home.ok === false && home.error.code).toBe(codes.invalidInput);
    // A harness must be one the bb session provider declares (kernel/spawn.ts): any other, and any with none declared, starts nothing.
    for (const harness of ["--yolo", "Claude", "pi --yolo", "", "codex"]) {
      const started = await oats.start("/abs/home", undefined, { harness }, ["claude", "pi"]);
      expect(started.ok === false && started.error.code, harness).toBe(codes.invalidInput);
    }
    const undeclared = await oats.start("/abs/home", undefined, { harness: "pi" });
    expect(undeclared.ok === false && undeclared.error.code).toBe(codes.invalidInput);
    for (const model of ["--yolo", "-m", "a\u0000b", "two\nlines", "", "x".repeat(257)]) {
      const started = await oats.restart("/abs/home", undefined, { model });
      expect(started.ok === false && started.error.code, model).toBe(codes.invalidInput);
    }
    expect(await fake.calls()).toEqual([]);
  });
});

describe("start and restart", () => {
  it("a resume is `oats session start --resume` with the home and nothing else; it is a start alone, and takes no harness and no model", async () => {
    // The shaped answer of a resume (test/fixtures/lifecycle/README.md): the ordinary start answer plus `resume`.
    const resumed = await oats.start(home, undefined, { resume: true });
    expect((await fake.calls()).at(-1)?.argv).toEqual(["session", "start", "--home", home, "--resume", "--json"]);
    expect(resumed.ok && resumed.value).toMatchObject({ threadId: null, instance: "lost-tmux-developer", resume: { resumed: true, reason: null, waiting: null } }); // the recorded answer names the agent it was recorded on
    // The kernel refuses a harness, a model or a mode beside --resume: none is ever sent, and asking for one is refused before any process.
    const before = (await fake.calls()).length;
    expect(await oats.start(home, undefined, { resume: true, harness: "pi" }, ["claude", "pi"])).toMatchObject({ ok: false, error: { code: "INVALID_INPUT" } });
    expect(await oats.start(home, undefined, { resume: true, model: "opus" })).toMatchObject({ ok: false, error: { code: "INVALID_INPUT" } });
    expect(await oats.restart(home, undefined, { resume: true })).toMatchObject({ ok: false, error: { code: "INVALID_INPUT" } });
    expect((await fake.calls()).length).toBe(before);
  });

  it("reads the answers a real tmux home gave (recorded): a resume that continued, a plain start, a restart, and the two refusals of a resume, by their codes", async () => {
    expect(await oats.start(home, undefined, { resume: true })).toMatchObject({ ok: true, value: { threadId: null, instance: "lost-tmux-developer", harness: "claude", resume: { resumed: true, reason: null, waiting: null } } });
    await fake.behave({ "session start": { file: "lifecycle/tmux-start.json" }, "session restart": { file: "lifecycle/tmux-restart.json" } });
    expect(await oats.start(home)).toMatchObject({ ok: true, value: { threadId: null, instance: "lost-tmux-developer", resume: null } });
    expect(await oats.restart(home)).toMatchObject({ ok: true, value: { threadId: null, instance: "lost-tmux-developer", resume: null } });
    await fake.behave({ "session start --resume": { file: "lifecycle/tmux-resume-not-lost.json", exit: 1 } });
    expect(await oats.start(home, undefined, { resume: true })).toMatchObject({ ok: false, error: { code: "E_RESUME_NOT_LOST" } });
    await fake.behave({ "session start --resume": { file: "lifecycle/tmux-resume-running.json", exit: 1 } });
    expect(await oats.start(home, undefined, { resume: true })).toMatchObject({ ok: false, error: { code: "E_SESSION_RUNNING" } });
  });

  it("reads what a resume answered of the conversation: back in it, started fresh with the kernel's reason, the harness waiting; a start that asked for none has none", async () => {
    await fake.behave({ "session start --resume": { file: "lifecycle/start-resume-fresh.json" } });
    expect((await oats.start(home, undefined, { resume: true })).ok && (await oats.start(home, undefined, { resume: true }))).toMatchObject({ value: { resume: { resumed: false, reason: "no-conversation", waiting: null } } });
    await fake.behave({ "session start --resume": { file: "lifecycle/start-resume-waiting.json" } });
    expect(await oats.start(home, undefined, { resume: true })).toMatchObject({ value: { resume: { resumed: true, reason: null, waiting: "resume-confirmation" } } });
    expect(await oats.start(home)).toMatchObject({ value: { resume: null } });
    // What it says is read, never guessed: a `resume` object that does not say whether it resumed is an answer this cannot read.
    await fake.behave({ "session start --resume": { stdout: JSON.stringify({ schemaVersion: 1, ok: true, result: { instance: "kernel-fix-developer", resume: { harness: "claude" } } }) } });
    expect(await oats.start(home, undefined, { resume: true })).toMatchObject({ ok: false, error: { code: "OATS_BAD_ANSWER" } });
  });

  const home = "/abs/deployment/agents/oats-expert/instances/weekly-digest-helper";
  const answered = (threadId: string | null) => ({ threadId, instance: "weekly-digest-helper", harness: "claude", model: "claude-opus-5-5", warnings: [], resume: null }); // (no resume was asked for)
  it("starts the home the kernel named and answers the new thread, and names no mode (no --yolo), no harness and no model: the home's recorded launch stands", async () => {
    expect(await oats.start(home)).toEqual({ ok: true, value: answered("thr_7nx8uibthg") });
    expect(await oats.restart(home)).toEqual({ ok: true, value: answered("thr_d5zug5fnva") });
    expect((await fake.calls()).map((call) => call.argv)).toEqual([
      ["session", "start", "--home", home, "--json"],
      ["session", "restart", "--home", home, "--json"],
    ]);
    // Only a spawn asks for bb's full mode. A home spawned elsewhere without it is refused here by the kernel.
    expect((await fake.calls()).flatMap((call) => call.argv)).not.toContain("--yolo");
  });

  it("passes a chosen harness and a chosen model, each as one argv element after its flag", async () => {
    await oats.start(home, undefined, { harness: "pi" }, ["claude", "pi"]);
    await oats.restart(home, undefined, { harness: "pi", model: "anthropic/claude-opus-5-5" }, ["claude", "pi"]);
    await oats.start(home, undefined, { model: "opus[1m]" });
    expect((await fake.calls()).map((call) => call.argv)).toEqual([
      ["session", "start", "--home", home, "--harness", "pi", "--json"],
      ["session", "restart", "--home", home, "--harness", "pi", "--model", "anthropic/claude-opus-5-5", "--json"],
      ["session", "start", "--home", home, "--model", "opus[1m]", "--json"],
    ]);
  });

  it("answers no thread when the kernel's answer names none", async () => {
    const answer = JSON.parse(await readFile(join(FIXTURES, "lifecycle/start.json"), "utf8"));
    delete answer.result.session;
    await fake.behave({ "session start": { stdout: JSON.stringify(answer) } });
    expect(await oats.start(home)).toEqual({ ok: true, value: answered(null) });
  });

  it("reads the warnings of the answer, and nothing of a launch prompt: a bb home engages none", async () => {
    const answer = JSON.parse(await readFile(join(FIXTURES, "lifecycle/start.json"), "utf8"));
    expect("launchPrompts" in answer.result).toBe(false); // as recorded from the real kernel
    Object.assign(answer.result, { warnings: ["first", 7, "second"] });
    await fake.behave({ "session start": { stdout: JSON.stringify(answer) } });
    const started = await oats.start(home);
    expect(started.ok && started.value.warnings).toEqual(["first", "second"]);
  });

  it("answers the kernel's refusal unchanged", async () => {
    await fake.behave({ "session start": { stdout: JSON.stringify({ schemaVersion: 1, ok: false, error: { code: "E_SESSION_RUNNING", message: "weekly-digest-helper already runs" } }) } });
    expect(await oats.start(home)).toEqual({ ok: false, error: { code: "E_SESSION_RUNNING", message: "weekly-digest-helper already runs" } });
  });

  it("a home spawned elsewhere without full mode: the provider's refusal of its start and restart is answered unchanged", async () => {
    const error = { code: "E_BACKEND_SANDBOXED_MODE", message: "weekly-digest-helper was not started: this launch would run in bb's accept-edits mode, a sandboxed mode, and the bb backend launches in bb's full mode only" };
    await fake.behave({ "session start": { stdout: JSON.stringify({ schemaVersion: 1, ok: false, error }) }, "session restart": { stdout: JSON.stringify({ schemaVersion: 1, ok: false, error }) } });
    expect(await oats.start(home)).toEqual({ ok: false, error });
    expect(await oats.restart(home)).toEqual({ ok: false, error });
    expect((await fake.calls()).map((call) => call.argv)).toEqual([
      ["session", "start", "--home", home, "--json"],
      ["session", "restart", "--home", home, "--json"],
    ]);
  });
});

describe("retire", () => {
  const facts = {
    action: "retire",
    revision: "ef5028f1e6cb517560247307",
    instance: "weekly-digest-helper", // the instance the kernel's plan names
    home: "/abs/deployment/agents/oats-expert/instances/weekly-digest-helper",
    at: "2026-11-21T15:52:01.652Z",
    session: "none",
    backend: "bb",
    work: { observed: true, branch: "agents/weekly-digest-helper", detached: false, drift: false, changed: 0, untracked: 1 },
    ownWorktree: true,
    workMode: "worktree",
    recordedBranch: "agents/weekly-digest-helper",
    children: ["digest-links-helper"],
    ambiguous: [],
    extraTrees: [],
  };
  it("reads the plan into the kernel's facts, and none of its notes: the dialog's sentences are made from the facts", async () => {
    expect(await oats.retirePlan("weekly-digest-helper")).toEqual({ ok: true, value: facts });
    expect((await fake.calls()).map((call) => call.argv)).toEqual([["retire", "weekly-digest-helper", "--plan", "--json"]]);
  });

  it("reads whether the session runs, whose tree work/ is, and work that was not observed", async () => {
    const answer = JSON.parse(await readFile(join(FIXTURES, "lifecycle/retire-plan.json"), "utf8"));
    const read = async (change: (result: Record<string, any>) => void) => {
      const copy = structuredClone(answer);
      change(copy.result);
      await fake.behave({ "retire --plan": { stdout: JSON.stringify(copy) } });
      const plan = await oats.retirePlan("weekly-digest-helper");
      if (!plan.ok) throw new Error(plan.error.message);
      return plan.value;
    };
    expect((await read((r) => (r.facts.session = { state: "unestablished", present: null, backend: null, established: false, reason: "E_SESSION_UNAVAILABLE" }))).session).toBe("unknown");
    expect((await read((r) => (r.facts.session = { state: "unknown", present: true, backend: "bb", established: true }))).session).toBe("there");
    expect((await read((r) => (r.facts.session = { state: "absent", present: false, backend: "bb", established: true }))).session).toBe("none");
    // A kernel from before the fact does not say whose tree it is: null, and the record's work mode answers.
    expect((await read((r) => delete r.facts.ownWorktree)).ownWorktree).toBeNull();
    expect((await read((r) => (r.facts.ownWorktree = false))).ownWorktree).toBe(false);
    expect((await read((r) => (r.facts.work = { observed: false, reason: "no-worktree" }))).work).toEqual({ observed: false, branch: null, detached: false, drift: false, changed: 0, untracked: 0 });
  });

  it("reads each extra tree with what the kernel would do with it, as the kernel words it", async () => {
    const answer = JSON.parse(await readFile(join(FIXTURES, "lifecycle/retire-plan.json"), "utf8"));
    const tree = (name: string, disposition: string, reason: string | null) => ({
      path: `/h/.work-${name}`, repo: "/w/docs", branch: `agents/x-${name}`, detachedAt: null, disposition, movedTo: disposition === "retain" ? "/w/.agents/worktrees/docs/x" : null, reason,
    });
    answer.result.facts.extraWorktrees = [tree("a", "retain", "2 changed files"), tree("c", "refuse", "its target exists"), tree("d", "quarantine", null)];
    await fake.behave({ "retire --plan": { stdout: JSON.stringify(answer) } });
    const plan = await oats.retirePlan("weekly-digest-helper");
    expect(plan.ok && plan.value.extraTrees).toEqual([
      { path: "/h/.work-a", branch: "agents/x-a", disposition: "retain", reason: "2 changed files" },
      { path: "/h/.work-c", branch: "agents/x-c", disposition: "refuse", reason: "its target exists" },
      { path: "/h/.work-d", branch: "agents/x-d", disposition: "quarantine", reason: null },
    ]);
  });

  const receipt = {
    action: "retire",
    instance: "weekly-digest-helper",
    replayed: false,
    deferred: false,
    removedDir: true,
    retainedHome: null,
    worktree: "retained",
    movedTo: "/abs/deployment/.agents/worktrees/oats-real/agents-weekly-digest-helper",
    recoveryPath: "/abs/deployment/agents/oats-expert/instances/.oats-retirement/recovery/weekly-digest-helper-mVOWdW",
    threadsArchived: 1, // the home's thread is archived in bb when the retire ends (capabilityMeta["oats.bb"].archived: the hook's own, or one the stop archived)
    children: [{ instance: "digest-links-helper", ok: true, alreadyIdle: true, code: null, stillRunning: null, detail: null }],
    incomplete: [],
    compensation: null,
    warnings: [], // the recorded receipt has none
  };
  it("applies the plan and reads the receipt: the first answer is the receipt itself, a replay is an envelope", async () => {
    const apply = { instance: "weekly-digest-helper", revision: "ef5028f1e6cb517560247307", key: "retire-2b9d4e6f8a1c" };
    expect(await oats.retireApply(apply)).toEqual({ ok: true, value: receipt });
    const printed = JSON.parse(await readFile(join(FIXTURES, "lifecycle/retire-apply.json"), "utf8"));
    await fake.behave({ retire: { stdout: JSON.stringify({ schemaVersion: 1, ok: true, result: { ...printed, replayed: true } }) } });
    expect(await oats.retireApply(apply)).toEqual({ ok: true, value: { ...receipt, replayed: true } });
    expect((await fake.calls())[0]?.argv).toEqual(["retire", "weekly-digest-helper", "--plan-revision", "ef5028f1e6cb517560247307", "--idempotency-key", "retire-2b9d4e6f8a1c", "--json"]);
  });

  it("deletes the agent's own work tree only when asked: --discard-worktree", async () => {
    await oats.retireApply({ instance: "weekly-digest-helper", revision: "ef5028f1e6cb517560247307", key: "retire-2b9d4e6f8a1c", discardWorktree: true });
    expect((await fake.calls())[0]?.argv).toEqual(["retire", "weekly-digest-helper", "--discard-worktree", "--plan-revision", "ef5028f1e6cb517560247307", "--idempotency-key", "retire-2b9d4e6f8a1c", "--json"]);
  });

  it("reads the receipt of a retire that deleted the worktree (recorded: dialogs-2-helper, with --discard-worktree)", async () => {
    await fake.behave({ retire: { file: "lifecycle/retire-apply-discard.json" } });
    const applied = await oats.retireApply({ instance: "dialogs-2-helper", revision: "ef5028f1e6cb517560247307", key: "retire-2b9d4e6f8a1c", discardWorktree: true });
    expect(applied.ok && applied.value).toMatchObject({ instance: "dialogs-2-helper", removedDir: true, worktree: "removed", movedTo: null, incomplete: [], children: [] });
  });

  it("reads a retire that was accepted and finishes in the background, and the branch an interrupted spawn left", async () => {
    const printed = JSON.parse(await readFile(join(FIXTURES, "lifecycle/retire-apply.json"), "utf8"));
    await fake.behave({ retire: { stdout: JSON.stringify({ retired: "weekly-digest-helper", deferred: true, planRevision: "r", idempotencyKey: "k", replayed: false }) } });
    const deferred = await oats.retireApply({ instance: "weekly-digest-helper", revision: "ef5028f1e6cb517560247307", key: "retire-2b9d4e6f8a1c" });
    expect(deferred.ok && deferred.value).toMatchObject({ deferred: true, removedDir: false, worktree: null });
    await fake.behave({ retire: { stdout: JSON.stringify({ ...printed, spawnCompensation: { branch: "agents/x", branchDeleted: false, reason: "it holds work" } }) } });
    const compensated = await oats.retireApply({ instance: "weekly-digest-helper", revision: "ef5028f1e6cb517560247307", key: "retire-2b9d4e6f8a1c" });
    expect(compensated.ok && compensated.value.compensation).toEqual({ branch: "agents/x", deleted: false, reason: "it holds work" });
  });

  it("a retire whose cleanup is incomplete (the receipt, with exit 1) is a receipt that says what the kernel left, and where the home is kept", async () => {
    const printed = JSON.parse(await readFile(join(FIXTURES, "lifecycle/retire-incomplete.json"), "utf8"));
    await fake.behave({ retire: { file: "lifecycle/retire-incomplete.json", exit: 1 } });
    const applied = await oats.retireApply({ instance: "weekly-digest-helper", revision: "ef5028f1e6cb517560247307", key: "retire-2b9d4e6f8a1c" });
    expect(applied.ok && applied.value).toMatchObject({ removedDir: false, retainedHome: printed.retainedHome, incomplete: printed.rollbackIncomplete, recoveryPath: null, worktree: "retained" });
    expect(printed.rollbackIncomplete.length).toBeGreaterThan(0);
    // Asked again with the same key, the kernel replays that receipt in an envelope, with exit 0.
    await fake.behave({ retire: { stdout: JSON.stringify({ schemaVersion: 1, ok: true, result: { ...printed, replayed: true } }) } });
    const replayed = await oats.retireApply({ instance: "weekly-digest-helper", revision: "ef5028f1e6cb517560247307", key: "retire-2b9d4e6f8a1c" });
    expect(replayed.ok && applied.ok && replayed.value).toEqual(applied.ok && { ...applied.value, replayed: true });
  });

  it("reads the receipt's warnings, the kernel's and its hooks' own lines; a receipt with none has none", async () => {
    // The recorded receipts carry no `warnings` (the kernel prints the key only with something to say).
    const printed = JSON.parse(await readFile(join(FIXTURES, "lifecycle/retire-apply.json"), "utf8"));
    expect("warnings" in printed).toBe(false);
    expect(receipt.warnings).toEqual([]);
    // Shaped from the kernel's source (lib/core.mjs: `warnings` of the retire's result): strings, in its order.
    const warnings = ["the bb thread of weekly-digest-helper could only be archived: its harness did not stop", "retire hook oats.aweb: the alias is held"];
    await fake.behave({ retire: { stdout: JSON.stringify({ ...printed, warnings: [...warnings, "", 7, null] }) } });
    const applied = await oats.retireApply({ instance: "weekly-digest-helper", revision: "ef5028f1e6cb517560247307", key: "retire-2b9d4e6f8a1c" });
    expect(applied.ok && applied.value.warnings).toEqual(warnings);
  });

  it("does not read a home as kept from a receipt that does not say: a retire that ran answers `removedDir`, or the answer cannot be read", async () => {
    await fake.behave({ retire: { stdout: JSON.stringify({ retired: "weekly-digest-helper", retention: { worktree: "retained", movedTo: "/abs/aside" } }) } });
    const applied = await oats.retireApply({ instance: "weekly-digest-helper", revision: "ef5028f1e6cb517560247307", key: "retire-2b9d4e6f8a1c" });
    expect(applied).toMatchObject({ ok: false, error: { code: "OATS_BAD_ANSWER" } });
    expect(!applied.ok && applied.error.message).toContain("removedDir");
  });

  it("does not take a retire that exits nonzero for done, whatever it printed", async () => {
    await fake.behave({ retire: { file: "lifecycle/retire-apply.json", exit: 1, stderr: "TypeError: boom\n" } });
    const applied = await oats.retireApply({ instance: "weekly-digest-helper", revision: "ef5028f1e6cb517560247307", key: "retire-2b9d4e6f8a1c" });
    expect(applied).toEqual({ ok: false, error: { code: codes.failed, message: "`oats` exited 1: TypeError: boom" } });
  });

  it("still says that oats failed when another verb exits nonzero with a document that is no refusal", async () => {
    await fake.behave({ "instance stop --apply": { file: "lifecycle/stop-apply.json", exit: 1 } });
    const applied = await oats.stopApply({ instance: "redesign-ui-lead", revision: "9c1f2e3d4b5a69788796a5b4", key: "stop-7f3a9c2e41b8" });
    expect(applied.ok === false && applied.error.code).toBe(codes.failed);
  });

  it("answers the refusal of a retire asked while a process works in the home, as the pi run recorded it (exit 1), unchanged", async () => {
    const printed = JSON.parse(await readFile(join(FIXTURES, "lifecycle/retire-pi-refused.json"), "utf8"));
    await fake.behave({ retire: { file: "lifecycle/retire-pi-refused.json", exit: 1 } });
    const applied = await oats.retireApply({ instance: "pi-form-developer", revision: "c87783b6406fc307bf5353b9", key: "retire-1f2e3d4c5b6a" });
    expect(applied).toEqual({ ok: false, error: { code: "E_RUNTIME_QUIESCE_FAILED", message: printed.error.message } });
  });

  it("answers the kernel's refusal unchanged", async () => {
    await fake.behave({ retire: { stdout: JSON.stringify({ schemaVersion: 1, ok: false, error: { code: "E_CHILDREN_RUNNING", message: "1 child still runs: digest-links-helper", details: {} } }) } });
    const applied = await oats.retireApply({ instance: "weekly-digest-helper", revision: "ef5028f1e6cb517560247307", key: "retire-2b9d4e6f8a1c" });
    expect(applied).toEqual({ ok: false, error: { code: "E_CHILDREN_RUNNING", message: "1 child still runs: digest-links-helper" } });
  });
});
