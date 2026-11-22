// The lifecycle dialogs' words: a plan as what will happen and what is kept, a receipt as a result,
// a refusal in a person's words. The plans and receipts are the recorded answers of the real
// kernel, read by kernel/lifecycle.ts; the sentences are the OATS Desktop's.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseRetireApply, parseRetirePlan, parseSessionStart, parseStopApply, parseStopPlan } from "../../kernel/lifecycle.js";
import type { RetirePlan, StopPlan } from "../../kernel/lifecycle.js";
import { applyRefused, cannotAct, planRefused, retireOutcome, retirePlanView, startOutcome, startRefused, stopOutcome, stopPlanView, titleOf } from "../../app/lifecycle/words";
import { FIXTURES } from "../support/fake-oats.js";

const fixture = (name: string) => JSON.parse(readFileSync(join(FIXTURES, "lifecycle", name), "utf8"));
const value = <Value>(result: { ok: true; value: Value } | { ok: false; error: { message: string } }): Value => {
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
};
const stopPlan = (): StopPlan => value(parseStopPlan(fixture("stop-plan.json").result));
const retirePlan = (change: Partial<RetirePlan> = {}): RetirePlan => ({ ...value(parseRetirePlan(fixture("retire-plan.json").result)), ...change });

describe("a dialog's title", () => {
  it("names the act and the agent as the kernel names it, as words; no agent before the kernel has named one", () => {
    expect(titleOf("retire", "weekly-digest-helper", true)).toBe("Retire Weekly digest helper?");
    expect(titleOf("stop", "redesign-ui-lead", true)).toBe("Stop Redesign ui lead?");
    expect(titleOf("start", "weekly-digest-helper", true)).toBe("Start Weekly digest helper");
    expect(titleOf("restart", "weekly-digest-helper", true)).toBe("Restart Weekly digest helper");
    expect(titleOf("stop", null, false)).toBe("Stop an agent");
    expect(titleOf("stop", null, true)).toBe("Stop this agent?");
    // Once the act has a result the title asks nothing.
    expect(titleOf("retire", "weekly-digest-helper", true, true)).toBe("Retire Weekly digest helper");
  });
});

describe("a stop plan", () => {
  it("says what will happen and what is kept in the Desktop's sentences, with the agents by their names as words", () => {
    expect(stopPlanView(stopPlan())).toEqual({
      happens: ["Stops 3 sessions, children first: Redesign ui lead, Desktop mockups developer, Harvest knowledge helper.", "A session that refuses to stop is left running; nothing is forced."],
      kept: ["Nothing is deleted. Its home, worktree, transcript and launch settings are kept; you can start it again."],
      attention: ["Redesign ui lead reports it is in the middle of a task.", "Desktop mockups developer reports it is in the middle of a task."],
      state: [
        { label: "Redesign ui lead", value: "Running" },
        { label: "Desktop mockups developer", value: "Running" },
        { label: "Harvest knowledge helper", value: "Running" },
      ],
      notes: [],
      choice: { label: "Include child instances", checked: true, warning: null },
      blocked: null,
      confirm: "Stop",
    });
  });

  it("without the children: one session, who is not stopped, and the tick stays to be set again", () => {
    const plan = stopPlan();
    const view = stopPlanView({ ...plan, recursive: false, targets: plan.targets.slice(0, 1), skipped: plan.targets.slice(1).map((target) => target.instance) });
    expect(view.happens).toEqual(["Stops the session of Redesign ui lead.", "A session that refuses to stop is left running; nothing is forced.", "Not stopped: Desktop mockups developer, Harvest knowledge helper (children not included)."]);
    expect(view.choice).toEqual({ label: "Include child instances", checked: false, warning: null });
  });

  it("an agent with no child has no tick; a session that could not be checked is said so, never as not running", () => {
    const plan = stopPlan();
    const view = stopPlanView({ ...plan, targets: [{ ...plan.targets[0]!, session: "unknown", midTask: "unknown" }], ambiguous: ["lost-child"] });
    expect(view.choice).toBeNull();
    expect(view.state).toEqual([{ label: "Redesign ui lead", value: "Unknown (couldn't be checked)" }]);
    expect(view.attention).toEqual([]);
    expect(view.notes).toEqual(["Not included: Lost child (another instance has the same parent name, so OATS can't tell whose child it is)."]);
  });
});

describe("a retire plan", () => {
  it("says what goes and what stays, for the recorded plan of an agent on a worktree with a child", () => {
    expect(retirePlanView(retirePlan(), false)).toEqual({
      happens: ["Stops its 1 child instance first: Digest links helper. They are kept, with their homes.", "Saves a recovery copy of any uncommitted work, then deletes its home folder.", "If a child won't stop, nothing is retired."],
      kept: ["Keeps its worktree, moved aside, on branch agents/weekly-digest-helper.", "Branches and pull requests are not changed."],
      attention: [],
      state: [
        { label: "Session", value: "Not running" },
        { label: "Uncommitted work", value: "1 untracked" },
        { label: "Branch", value: "agents/weekly-digest-helper" },
      ],
      notes: [],
      choice: { label: "Also delete the worktree", checked: false, warning: null },
      blocked: null,
      confirm: "Retire",
    });
  });

  it("with the tick: the worktree is deleted, its branch stays, and the warning counts what is lost", () => {
    const view = retirePlanView(retirePlan(), true);
    expect(view.happens).toContain("Deletes its worktree. Branch agents/weekly-digest-helper stays in the repository.");
    expect(view.kept).toEqual(["Branches and pull requests are not changed."]);
    expect(view.choice).toEqual({ label: "Also delete the worktree", checked: true, warning: "Deletes the worktree folder, including 1 uncommitted change (a recovery copy is saved first). Branch agents/weekly-digest-helper stays in the repository." });
  });

  it("a session that runs is stopped; one that could not be checked is said so", () => {
    expect(retirePlanView(retirePlan({ session: "there", children: [] }), false).happens).toEqual(["Stops its session.", "Saves a recovery copy of any uncommitted work, then deletes its home folder."]);
    expect(retirePlanView(retirePlan({ session: "unknown", children: [] }), false).happens[0]).toBe("Stops its session, if one is running (its state couldn't be checked).");
  });

  it("an agent with no worktree of its own has no tick, and nothing of another's tree is shown", () => {
    const view = retirePlanView(retirePlan({ ownWorktree: false, workMode: "attached" }), false);
    expect(view.choice).toBeNull();
    expect(view.kept).toEqual(["It has no worktree of its own, so no worktree is kept or deleted. A tree it links to is not touched.", "Branches and pull requests are not changed."]);
    expect(view.state).toEqual([{ label: "Session", value: "Not running" }]);
    // A tick set before the plan changed stays, to be undone, and the reason beside Retire names it.
    const ticked = retirePlanView(retirePlan({ ownWorktree: false }), true);
    expect(ticked.choice).toEqual({ label: "Also delete the worktree", checked: true, warning: null });
    expect(ticked.blocked).toBe("Only an instance with its own worktree can delete it. Untick “Also delete the worktree”.");
  });

  it("a kernel that does not say whose tree it is: the record's work mode answers", () => {
    expect(retirePlanView(retirePlan({ ownWorktree: null, workMode: "worktree" }), false).choice).not.toBeNull();
    expect(retirePlanView(retirePlan({ ownWorktree: null, workMode: "directory" }), false).choice).toBeNull();
  });

  it("an own tree that could not be checked promises no tree and names no observed branch", () => {
    const unchecked = retirePlan({ work: { observed: false, branch: null, detached: false, drift: false, changed: 0, untracked: 0 } });
    expect(retirePlanView(unchecked, false).kept[0]).toBe("Keeps its worktree, moved aside, if there is one. It couldn't be checked.");
    expect(retirePlanView(unchecked, true).choice?.warning).toBe("Deletes the worktree folder, if there is one, with any uncommitted changes (a recovery copy is saved first). It couldn't be checked.");
    expect(retirePlanView(unchecked, false).state[1]).toEqual({ label: "Uncommitted work", value: "Unknown (couldn't be checked)" });
  });

  it("a worktree on another branch than it was spawned on is brought to attention", () => {
    const plan = retirePlan();
    expect(retirePlanView({ ...plan, work: { ...plan.work, drift: true, branch: "feat/x" } }, false).attention).toEqual(["The worktree is on feat/x, not the branch it was spawned on (agents/weekly-digest-helper)."]);
  });

  it("an extra tree the kernel would refuse blocks the retire, and the reason names a control the dialog has", () => {
    const tree = (disposition: string) => ({ path: "/h/.work-docs", branch: "agents/x-docs", disposition, reason: null });
    const view = retirePlanView(retirePlan({ extraTrees: [tree("retain"), tree("remove"), tree("refuse")] }), false);
    expect(view.kept).toContain("Keeps its extra worktree on branch agents/x-docs, moved aside.");
    expect(view.happens).toContain("Deletes its extra worktree on branch agents/x-docs: it holds no uncommitted work. Branch agents/x-docs stays in the repository.");
    expect(view.blocked).toBe("OATS would refuse: its extra worktree on branch agents/x-docs cannot be moved aside. Remove it with OATS on the machine that holds it, then press Check again.");
  });
});

describe("a result", () => {
  it("a stop: how many sessions stopped, and each agent's own line", () => {
    expect(stopOutcome(value(parseStopApply(fixture("stop-apply.json").result)), "redesign-ui-lead")).toEqual({
      tone: "done",
      title: "3 sessions stopped.",
      lines: ["Harvest knowledge helper: Was already stopped", "Desktop mockups developer: Stopped", "Redesign ui lead: Stopped"],
      code: null,
      details: null,
      offers: [],
    });
  });

  it("a stop that left a session running is no success: which did not stop, nothing forced, Review again", () => {
    const receipt = value(parseStopApply(fixture("stop-apply.json").result));
    receipt.ok = false;
    receipt.results[2] = { instance: "redesign-ui-lead", ok: false, alreadyIdle: false, code: "E_SESSION_STOP_FAILED", stillRunning: [4242], detail: null };
    receipt.results[1] = { instance: "desktop-mockups-developer", ok: false, alreadyIdle: false, code: "E_LIFECYCLE_BUSY", stillRunning: null, detail: "its home is held" };
    const outcome = stopOutcome(receipt, "redesign-ui-lead");
    expect(outcome).toMatchObject({ tone: "failed", title: "Not every session stopped", code: "E_SESSION_STOP_FAILED", offers: ["review"], details: "desktop-mockups-developer: its home is held" });
    expect(outcome.lines).toEqual(["Harvest knowledge helper: Was already stopped", "Desktop mockups developer: Not stopped: OATS couldn't lock its home", "Redesign ui lead: Didn't stop (still running: 4242)", "Nothing was forced."]);
  });

  it("a retire: the Desktop's result lines, each fact on its own line", () => {
    expect(retireOutcome(value(parseRetireApply(fixture("retire-apply.json"))), retirePlan())).toEqual({
      tone: "done",
      title: "Weekly digest helper retired.",
      lines: [
        "1 child instance stopped and kept.",
        "Home folder deleted.",
        "Worktree kept at /abs/deployment/.agents/worktrees/oats-real/agents-weekly-digest-helper.",
        "Recovery copy saved at /abs/deployment/agents/oats-expert/instances/.oats-retirement/recovery/weekly-digest-helper-mVOWdW",
      ],
      code: null,
      details: null,
      offers: [],
    });
    const replayed = retireOutcome({ ...value(parseRetireApply(fixture("retire-apply.json"))), replayed: true }, retirePlan({ session: "there" }));
    expect(replayed.lines[0]).toBe("Session stopped.");
    expect(replayed.lines.at(-1)).toBe("This is the result already recorded for this confirmation; nothing ran again.");
  });

  it("a retire whose cleanup did not finish: what ran, that the home is kept, the kernel's lines under Details", () => {
    const outcome = retireOutcome(value(parseRetireApply(fixture("retire-incomplete.json"))), retirePlan());
    expect(outcome).toMatchObject({ tone: "failed", title: "Retirement didn't finish", code: "RETIRE_INCOMPLETE", offers: ["review"] });
    expect(outcome.lines).toContain("Home folder kept at /abs/deployment/agents/oats-expert/instances/weekly-digest-helper.");
    expect(outcome.lines).toContain("Cleanup didn't finish.");
    expect(outcome.details).toBe("retire hook oats.aweb: the team certificate of weekly-digest-helper could not be removed (exit 1)");
  });

  it("a retire accepted for the background is neither done nor failed", () => {
    const receipt = { ...value(parseRetireApply(fixture("retire-apply.json"))), deferred: true };
    expect(retireOutcome(receipt, retirePlan())).toMatchObject({ tone: "unknown", title: "Retirement accepted", offers: ["check"] });
  });
});

describe("a refusal", () => {
  const gone = fixture("gone.json");
  it("a plan refused for a name the kernel does not know: the agent is not in OATS any more, and there is nothing to try again", () => {
    const outcome = planRefused("retire", "flaky-ci-2-developer", gone.retirePlan.error, true);
    expect(outcome).toMatchObject({ title: "Flaky ci 2 developer is not in OATS any more", code: "E_SESSION_UNKNOWN", gone: true, offers: [], details: gone.retirePlan.error.message });
  });

  it("a plan that could not be read leads with a person's words; the kernel's are the details", () => {
    expect(planRefused("stop", "dev-1", { code: "OATS_TIMEOUT", message: "`oats` did not answer within 20 s and was stopped" }, false)).toEqual({
      tone: "failed",
      title: "Couldn't check what stopping Dev 1 will do",
      lines: ["OATS didn't answer in time.", "Nothing was changed."],
      code: "OATS_TIMEOUT",
      details: "`oats` did not answer within 20 s and was stopped",
      offers: ["review"],
    });
    expect(planRefused("retire", "dev-1", { code: "E_UNIDENTIFIED_INSTANCE_HOME", message: "m" }, false).lines[0]).toMatch(/^OATS can't tell what this home's capabilities created/);
    expect(planRefused("retire", "dev-1", { code: "E_SOMETHING_NEW", message: "m" }, false).lines[0]).toBe("OATS answered with an error that the plugin has no description for.");
  });

  it("an apply the kernel refused says what was not done, in the Desktop's sentence for the code", () => {
    expect(applyRefused("retire", "weekly-digest-helper", { code: "E_CHILDREN_RUNNING", message: "1 child still runs" })).toEqual({
      tone: "failed",
      title: "Weekly digest helper wasn't retired",
      lines: ["A child instance wouldn't stop, so nothing was retired. Other children may already have stopped."],
      code: "E_CHILDREN_RUNNING",
      details: "1 child still runs",
      offers: ["review"],
    });
    expect(applyRefused("stop", "dev-1", { code: "E_LIFECYCLE_BUSY", message: "held by pid 4" }).lines).toEqual(["Nothing was done: OATS refused this as busy.", "Details has what OATS says to check."]);
  });

  it("an apply whose answer was lost is not confirmed: never done, never nothing happened, and Check again asks for it", () => {
    for (const code of ["OATS_TIMEOUT", "HOST_UNREACHABLE", "PLUGIN_RPC_FAILED"]) {
      expect(applyRefused("retire", "dev-1", { code, message: "m" }), code).toMatchObject({ tone: "unknown", title: "Result not confirmed", offers: ["check"], lines: ["OATS didn't confirm the result. Check again before assuming nothing happened."] });
    }
  });
});

describe("a start", () => {
  const started = () => ({ ...value(parseSessionStart(fixture("start.json").result)) });
  it("says that the agent started, or restarted", () => {
    expect(startOutcome("start", "weekly-digest-helper", started())).toMatchObject({ tone: "done", title: "Weekly digest helper started.", lines: [] });
    expect(startOutcome("restart", "weekly-digest-helper", { ...started(), warnings: ["w"] })).toMatchObject({ tone: "done", title: "Weekly digest helper restarted.", lines: ["w"] });
  });

  it("a refusal says in words what was not started; a start that stopped at a prompt, or whose answer was lost, is not called failed", () => {
    expect(startRefused("start", "dev-1", { code: "E_SESSION_RUNNING", message: "m" })).toMatchObject({ tone: "failed", title: "Dev 1 wasn't started", lines: ["This instance is already running. Nothing was started."], offers: ["refresh"] });
    expect(startRefused("restart", "dev-1", { code: "E_INSTANCE_RETIRING", message: "m" }).lines).toEqual(["This instance is being retired, or has cleanup to finish. Nothing was stopped or started."]);
    expect(startRefused("start", "dev-1", { code: "E_SPAWN_INCOMPLETE", message: "m" })).toMatchObject({ tone: "unknown", title: "OATS could not confirm that Dev 1 finished starting" });
    expect(startRefused("start", "dev-1", { code: "OATS_TIMEOUT", message: "m" })).toMatchObject({ tone: "unknown", title: "OATS didn't confirm the start" });
    expect(startRefused("start", "dev-1", { code: "NO_THREAD_NAMED", message: "m" })).toMatchObject({ tone: "unknown", title: "Dev 1 was started, but its thread isn't ready yet", lines: ["Open it from its row when it is."] });
    expect(startRefused("restart", "dev-1", { code: "E_BACKEND_HARNESS", message: "m" })).toMatchObject({ title: "OATS refused to restart Dev 1 on this harness", lines: ["Choose another under Harness, or keep the recorded one."] });
    expect(startRefused("start", "dev-1", { code: "E_BACKEND_SANDBOXED_MODE", message: "the kernel's own" })).toMatchObject({ tone: "failed", title: "OATS refused to start Dev 1", code: "E_BACKEND_SANDBOXED_MODE", details: "the kernel's own" });
    // The retired home of the recording: a code shared with other failures, shown as a refusal, never as "gone".
    const gone = fixture("gone.json");
    expect(startRefused("start", "flaky-ci-2-developer", gone.start.error).gone).toBeUndefined();
  });
});

describe("a key that cannot act says why", () => {
  it("in the Desktop's sentences", () => {
    expect(cannotAct("restart", "dev-1", { running: false, known: true })).toBe("Dev 1 is stopped: Start it instead.");
    expect(cannotAct("start", "dev-1", { running: true, known: true })).toBe("Dev 1 is already running.");
    expect(cannotAct("start", "dev-1", { running: false, known: false })).toBe("Dev 1's state is not known, so it can't be started.");
    expect(cannotAct("start", "dev-1", { running: false, known: true })).toBeNull();
    expect(cannotAct("restart", "dev-1", { running: true, known: true })).toBeNull();
    expect(cannotAct("retire", "dev-1", { running: false, known: false })).toBeNull();
  });
});
