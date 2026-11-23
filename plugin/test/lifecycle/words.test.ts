// The lifecycle dialogs' words: a plan as what will happen and what is kept, a receipt as a result,
// a refusal in a person's words. The plans and receipts are the recorded answers of the real
// kernel, read by kernel/lifecycle.ts; the sentences are the OATS Desktop's.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseRetireApply, parseRetirePlan, parseSessionStart, parseStopApply, parseStopPlan } from "../../kernel/lifecycle.js";
import type { RetirePlan, StopPlan } from "../../kernel/lifecycle.js";
import { applyRefused, cannotAct, carriesOn, checkAgainRefused, piOnBb, resumable, toasted, planChanges, planRefused, retireOutcome, retirePlanView, startOutcome, startRefused, ARCHIVES_AT_STOP_FROM, stopArchivesThread, stopOutcome, stopPlanView, stopThreadSentence, titleOf } from "../../app/lifecycle/words";
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
      happens: [
        "Stops 3 sessions, children first: Redesign ui lead, Desktop mockups developer, Harvest knowledge helper.",
        "A session that refuses to stop is left running; nothing is forced.",
        // What a stop means for the thread, as the provider is today: bb's composer stays live under a stopped agent.
        "A message sent in its thread starts it again without OATS. To talk to it again, use Start.",
      ],
      kept: ["Nothing is deleted. Its home, worktree, transcript and launch settings are kept; you can start it again."],
      attention: ["Redesign ui lead reports it is in the middle of a task.", "Desktop mockups developer reports it is in the middle of a task."],
      state: [
        { label: "Redesign ui lead", value: "Session running" },
        { label: "Desktop mockups developer", value: "Session running" },
        { label: "Harvest knowledge helper", value: "Session running" },
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
    expect(view.happens).toEqual([
      "Stops the session of Redesign ui lead.",
      "A session that refuses to stop is left running; nothing is forced.",
      "Not stopped: Desktop mockups developer, Harvest knowledge helper (children not included).",
      "A message sent in its thread starts it again without OATS. To talk to it again, use Start.",
    ]);
    expect(view.choice).toEqual({ label: "Include child instances", checked: false, warning: null });
  });

  it("an agent with no child has no tick; a session that could not be checked is said so, never as not running", () => {
    const plan = stopPlan();
    const view = stopPlanView({ ...plan, targets: [{ ...plan.targets[0]!, session: "unknown", midTask: "unknown" }], ambiguous: ["lost-child"] });
    expect(view.choice).toBeNull();
    expect(view.state).toEqual([{ label: "Redesign ui lead", value: "Session unknown (couldn't be checked)" }]);
    expect(view.attention).toEqual([]);
    expect(view.notes).toEqual(["Not included: Lost child (another instance has the same parent name, so OATS can't tell whose child it is)."]);
  });
});

describe("a retire plan", () => {
  it("says what goes and what stays, for the recorded plan of an agent on a worktree with a child", () => {
    expect(retirePlanView(retirePlan(), false)).toEqual({
      happens: [
        "Stops its 1 child instance first: Digest links helper. They are kept, with their homes.",
        "Saves a recovery copy of any uncommitted work, then deletes its home folder.",
        "If a child won't stop, nothing is retired.",
      ],
      kept: ["Keeps its worktree, moved aside, on branch agents/weekly-digest-helper.", "Branches and pull requests are not changed."],
      // After what goes and what stays: what the Desktop's sheet leaves unsaid.
      attention: ["This cannot be undone. Its conversation stays readable in bb, archived."],
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
    // An agent that is not on bb has no thread to speak of; that it cannot be undone is said of every retire.
    expect(retirePlanView(retirePlan({ backend: "tmux", children: [] }), false).attention).toEqual(["This cannot be undone."]);
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
    expect(retirePlanView({ ...plan, work: { ...plan.work, drift: true, branch: "feat/x" } }, false).attention).toEqual([
      "This cannot be undone. Its conversation stays readable in bb, archived.",
      "The worktree is on feat/x, not the branch it was spawned on (agents/weekly-digest-helper).",
    ]);
  });

  it("an extra tree the kernel would refuse blocks the retire, and the reason names a control the dialog has", () => {
    const tree = (disposition: string) => ({ path: "/h/.work-docs", branch: "agents/x-docs", disposition, reason: null });
    const view = retirePlanView(retirePlan({ extraTrees: [tree("retain"), tree("remove"), tree("refuse")] }), false);
    expect(view.kept).toContain("Keeps its extra worktree on branch agents/x-docs, moved aside.");
    expect(view.happens).toContain("Deletes its extra worktree on branch agents/x-docs: it holds no uncommitted work. Branch agents/x-docs stays in the repository.");
    expect(view.blocked).toBe("OATS would refuse: its extra worktree on branch agents/x-docs cannot be moved aside. Remove it with OATS on the machine that holds it, then press Check again.");
  });
});

describe("a stop and the agent's thread", () => {
  it("is said by one function of one fact: whether the provider archives the thread of a home it stops", () => {
    expect(stopThreadSentence(false)).toBe("A message sent in its thread starts it again without OATS. To talk to it again, use Start.");
    expect(stopThreadSentence(true)).toBe("Its thread is archived. To talk to it again, start it.");
  });

  it("the fact is read from the provider's version against the release that archives at stop, oats-bb 0.4.0", () => {
    // The provider archives the thread at stop from oats-bb v0.4.0 on (the release lane's number).
    expect(ARCHIVES_AT_STOP_FROM).toBe("0.4.0");
    expect(stopArchivesThread("0.3.0")).toBe(false);
    expect(stopArchivesThread("0.4.0")).toBe(true);
    expect(stopArchivesThread("0.4.1")).toBe(true);
    // Numeric, part by part: 0.10.0 is after 0.4.0 (a compare of strings would put it before), and 0.3.10 before.
    expect(stopArchivesThread("0.10.0")).toBe(true);
    expect(stopArchivesThread("0.3.10")).toBe(false);
    expect(stopArchivesThread("1.0.0")).toBe(true);
    // A pre-release of 0.4.0 comes BEFORE it (semver), and nothing says a candidate archives: not known, so false,
    // and the dialog keeps the sentence that warns. A pre-release of a later version is later.
    expect(stopArchivesThread("0.4.0-rc.1")).toBe(false);
    expect(stopArchivesThread("0.4.1-rc.1")).toBe(true);
    expect(stopArchivesThread("0.4.0+build.7")).toBe(true); // build metadata is not a pre-release
    // A version that cannot be read as a release: none, a commit (a provider taken from a repository), a partial or a foreign one.
    for (const version of [null, "9b95a56f237ff4006a69545963d5130d6eb4ddc5", "", "next", "0.4", "v0.4.0", "0.4.0.1", "4abc.0.0", " 0.4.0"]) expect(stopArchivesThread(version), String(version)).toBe(false);
    // Another threshold, and none: the function is of the fact, the constant is the release lane's.
    expect(["0.4.0", "0.5.0", "0.5.1"].map((version) => stopArchivesThread(version, "0.5.0"))).toEqual([false, true, true]);
    expect(stopArchivesThread("99.0.0", null)).toBe(false);
    expect(stopPlanView(stopPlan(), true).happens).toContain("Its thread is archived. To talk to it again, start it.");
  });

  it("is said of an agent on bb, in the plan and in the result, and not of one with no thread", () => {
    const plan = stopPlan();
    const tmux = { ...plan, targets: plan.targets.map((target) => ({ ...target, backend: "tmux" })) };
    expect(stopPlanView(tmux).happens.some((line) => line.includes("thread"))).toBe(false);
    const receipt = value(parseStopApply(fixture("stop-apply.json").result));
    expect(stopOutcome(receipt, "redesign-ui-lead", true).lines.at(-1)).toBe("A message sent in its thread starts it again without OATS. To talk to it again, use Start.");
    expect(stopOutcome(receipt, "redesign-ui-lead", false).lines.some((line) => line.includes("thread"))).toBe(false);
  });
});

describe("a plan that changed under the confirmation", () => {
  it("says what differs, in sentences: who is in it, whose session runs, who is in the middle of a task", () => {
    const before = stopPlan();
    // The recorded case: one child stopped by itself between the plan and its apply.
    const after = { ...before, targets: before.targets.map((target) => (target.instance === "harvest-knowledge-helper" ? { ...target, session: "none" as const } : target.instance === "desktop-mockups-developer" ? { ...target, midTask: false } : target)) };
    expect(planChanges(before, after)).toEqual(["Desktop mockups developer no longer reports it is in the middle of a task.", "Harvest knowledge helper: its session was running, and is now not running."]);
    expect(planChanges(before, { ...before, targets: before.targets.slice(0, 2) })).toEqual(["Harvest knowledge helper is no longer in this plan."]);
    expect(planChanges({ ...before, targets: before.targets.slice(0, 2) }, before)).toEqual(["Harvest knowledge helper is now in this plan."]);
    expect(planChanges(before, before)).toEqual([]);
  });

  // Whether anything differs is decided from what the dialog draws. A fact with no sentence of
  // its own here is never "nothing differs": one line says the plan changed.
  const CHANGED = ["What this would do has changed: read it again below."];
  it.each([
    ["a child that is now left out", (plan: StopPlan): StopPlan => ({ ...plan, skipped: ["another-helper"] })],
    ["a child the kernel cannot attribute", (plan: StopPlan): StopPlan => ({ ...plan, ambiguous: ["another-helper"] })],
    ["children no longer included", (plan: StopPlan): StopPlan => ({ ...plan, recursive: false })],
  ])("a stop whose plan differs by %s says the plan changed", (_, change) => {
    const before = stopPlan();
    const after = change(before);
    expect(JSON.stringify(stopPlanView(after))).not.toBe(JSON.stringify(stopPlanView(before)));
    expect(planChanges(before, after)).toEqual(CHANGED);
  });
  it.each([
    ["an extra worktree OATS would now refuse (kept before)", (plan: RetirePlan): RetirePlan => ({ ...plan, extraTrees: [{ path: "/abs/x", branch: "feature/x", disposition: "refuse", reason: null }] })],
    ["a worktree that drifted from its branch", (plan: RetirePlan): RetirePlan => ({ ...plan, work: { ...plan.work, drift: true } })],
    ["a worktree that is now detached", (plan: RetirePlan): RetirePlan => ({ ...plan, work: { ...plan.work, detached: true } })],
    ["a worktree that is no longer its own", (plan: RetirePlan): RetirePlan => ({ ...plan, ownWorktree: false })],
    ["a work mode that changed", (plan: RetirePlan): RetirePlan => ({ ...plan, ownWorktree: null, workMode: "attached" })],
    ["a child the kernel cannot attribute", (plan: RetirePlan): RetirePlan => ({ ...plan, ambiguous: ["another-helper"] })],
  ])("a retire whose plan differs by %s says the plan changed", (_, change) => {
    const before: RetirePlan = { ...retirePlan(), extraTrees: [{ path: "/abs/x", branch: "feature/x", disposition: "retain", reason: null }] };
    const after = change(before);
    const drawn = (plan: RetirePlan) => JSON.stringify([retirePlanView(plan, false), retirePlanView(plan, true)]);
    // The case is one the dialog draws differently; a fact it does not draw would be no case.
    expect(drawn(after)).not.toBe(drawn(before));
    expect(planChanges(before, after)).toEqual(CHANGED);
  });
  it("draws each plan with its own answer on whether a stop archives the thread: a sentence that changed is a change", () => {
    const stop = stopPlan();
    // The earlier plan was drawn with "a message starts it again", the plan as it is now says "its thread is archived".
    expect(planChanges(stop, { ...stop, revision: "another-revision" }, true, false)).toEqual(CHANGED);
    expect(planChanges(stop, { ...stop, revision: "another-revision" }, true, true)).toEqual([]);
    expect(planChanges(stop, { ...stop, revision: "another-revision" }, false)).toEqual([]);
  });
  it("says nothing differs only when the dialog draws the two plans alike", () => {
    const before = retirePlan();
    expect(planChanges(before, { ...before, revision: "another-revision" })).toEqual([]);
    const stop = stopPlan();
    expect(planChanges(stop, { ...stop, revision: "another-revision" })).toEqual([]);
  });

  it("for a retire: its session, its uncommitted work, its children", () => {
    const before = retirePlan();
    expect(planChanges(before, { ...before, session: "there", work: { ...before.work, changed: 2 }, children: [] })).toEqual([
      "Its session was not running, and is now running.",
      "Its uncommitted work was: 1 untracked. It is now: 2 changed, 1 untracked.",
      "Digest links helper is no longer one of its children.",
    ]);
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
        "Worktree kept, at:",
        "/abs/deployment/.agents/worktrees/oats-real/agents-weekly-digest-helper",
        "Recovery copy saved at:",
        "/abs/deployment/agents/oats-expert/instances/.oats-retirement/recovery/weekly-digest-helper-mVOWdW",
        "Its conversation stays readable in bb, archived.",
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
    // A path stands on its own line: no full stop glued to it.
    expect(outcome.lines.slice(outcome.lines.indexOf("Home folder kept, at:"), outcome.lines.indexOf("Home folder kept, at:") + 2)).toEqual(["Home folder kept, at:", "/abs/deployment/agents/oats-expert/instances/weekly-digest-helper"]);
    expect(outcome.lines).toContain("Cleanup didn't finish.");
    expect(outcome.details).toBe("retire hook oats.aweb: the team certificate of weekly-digest-helper could not be removed (exit 1)");
    // The home was kept: on bb the agent can come back with no OATS around it. That is a warning of its own,
    // apart from the steps: a person's sentence, and the release lane's words one press away.
    expect(outcome.warning).toEqual({
      title: "Its home was kept. Its thread can be unarchived in bb, and a message then starts it again with no OATS around it.",
      details: "No status row, no hooks OATS runs for it, no stop by OATS. Where its aweb identity was not released (a team leave waiting for its controller, a retained seat, an alias held), it can send mail as the retired agent.",
    });
    expect(outcome.lines.some((line) => line.includes("stays readable") || line.includes("unarchived"))).toBe(false);
    // An agent that is not on bb has no thread to unarchive, and a retire that removed the home leaves nothing to start: no warning.
    expect(retireOutcome(value(parseRetireApply(fixture("retire-incomplete.json"))), retirePlan({ backend: "tmux" })).warning).toBeUndefined();
    expect(retireOutcome(value(parseRetireApply(fixture("retire-apply.json"))), retirePlan()).warning).toBeUndefined();
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
    expect(outcome).toMatchObject({ title: "Flaky ci 2 developer is not in OATS any more", code: "E_SESSION_UNKNOWN", offers: [], details: gone.retirePlan.error.message });
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
    // A busy refusal's own line names what to check: it is quoted under the kernel's name, as the Desktop quotes it.
    expect(applyRefused("stop", "dev-1", { code: "E_LIFECYCLE_BUSY", message: "held by pid 4\nremove the claim" }).lines).toEqual(["Nothing was done: OATS refused this as busy.", "OATS says: held by pid 4"]);
    expect(applyRefused("stop", "dev-1", { code: "E_SOMETHING_NEW", message: "a new refusal" }).lines).toEqual(["OATS answered with an error that the plugin has no description for.", "OATS says: a new refusal"]);
  });

  it("a second ask for a result that was not confirmed settles only on the kernel's own word", () => {
    // Not answered by the kernel (the roster cannot be read, the plugin's server refused, the call failed again): still not confirmed.
    for (const refusal of [{ code: "OATS_NOT_FOUND", message: "m" }, { code: "NO_DEPLOYMENT", message: "m" }, { code: null, message: '"dev-1" is not an agent of this snapshot' }, { code: "PLUGIN_RPC_FAILED", message: "Failed to fetch" }]) {
      expect(checkAgainRefused("stop", "dev-1", refusal), String(refusal.code)).toMatchObject({ tone: "unknown", title: "Result not confirmed", offers: ["check"], lines: ["OATS didn't confirm the result. Check again before assuming nothing happened."] });
    }
    // The kernel answers "busy" to its own key while the first apply still runs: that is said, in the Desktop's sentence.
    expect(checkAgainRefused("retire", "dev-1", { code: "E_LIFECYCLE_BUSY", message: "a retire holds dev-1" })).toMatchObject({ tone: "unknown", title: "Result not confirmed", lines: ["The removal of Dev 1 is still running. Check again to read its result."], offers: ["check"] });
    expect(checkAgainRefused("stop", "dev-1", { code: "E_LIFECYCLE_BUSY", message: "m" }).lines).toEqual(["The stop of Dev 1 is still running. Check again to read its result."]);
    // Any other code of the kernel's is its answer.
    expect(checkAgainRefused("retire", "dev-1", { code: "E_CHILDREN_RUNNING", message: "m" })).toMatchObject({ tone: "failed", title: "Dev 1 wasn't retired", offers: ["review"] });
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
    // A call that failed (nobody answered: the app's own code) is not confirmed either; a refusal of the plugin's own server names no OATS.
    expect(startRefused("start", "dev-1", { code: "PLUGIN_RPC_FAILED", message: "Failed to fetch" })).toMatchObject({ tone: "unknown", title: "OATS didn't confirm the start" });
    expect(startRefused("restart", "dev-1", { code: null, message: '"codex" is not a harness the bb session provider declares' })).toMatchObject({ tone: "failed", title: "Dev 1 wasn't restarted", lines: ["The plugin did not ask OATS for this. Details says why."] });
    expect(startRefused("start", "dev-1", { code: "NO_THREAD_NAMED", message: "m" })).toMatchObject({ tone: "unknown", title: "Dev 1 was started, but its thread isn't ready yet", lines: ["Open it from its row when it is."] });
    expect(startRefused("restart", "dev-1", { code: "E_BACKEND_HARNESS", message: "m" })).toMatchObject({ title: "OATS refused to restart Dev 1 on this harness", lines: ["Choose another under Harness, or keep the recorded one."] });
    // A refusal with no sentence of the Desktop's says why in the kernel's own line, under its name; the whole message stays under Details.
    expect(startRefused("start", "dev-1", { code: "E_BACKEND_SANDBOXED_MODE", message: "the kernel's own\nand its second line" })).toMatchObject({
      tone: "failed",
      title: "OATS refused to start Dev 1",
      lines: ["OATS says: the kernel's own", "Refresh its status before another try."],
      code: "E_BACKEND_SANDBOXED_MODE",
      details: "the kernel's own\nand its second line",
    });
    // The retired home of the recording: a code shared with other failures, shown as a refusal, never as "gone".
    const gone = fixture("gone.json");
    expect(startRefused("start", "flaky-ci-2-developer", gone.start.error).title).toBe("OATS refused to start Flaky ci 2 developer");
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

describe("whether a start says that a message in the thread carries the conversation on", () => {
  const thread = { status: "idle" };
  it("says it of an agent OATS says does not run and no operator stopped, whose thread bb has and can take a message", () => {
    expect(carriesOn({ running: false, runtimeState: "stopped", sessionEnd: "lost" }, thread)).toBe(true);
    expect(carriesOn({ running: false, runtimeState: "unknown", sessionEnd: null }, thread)).toBe(true);
    expect(carriesOn({ running: false, runtimeState: "unknown", sessionEnd: "lost" }, thread)).toBe(true);
  });
  it("never after an operator's stop, and never of a stopped row that does not say how its session ended", () => {
    expect(carriesOn({ running: false, runtimeState: "stopped", sessionEnd: "stopped" }, thread)).toBe(false);
    expect(carriesOn({ running: false, runtimeState: "unknown", sessionEnd: "stopped" }, thread)).toBe(false);
    expect(carriesOn({ running: false, runtimeState: "stopped", sessionEnd: null }, thread)).toBe(false);
  });
  it("never of an agent that runs, or whose state is not known", () => {
    expect(carriesOn({ running: true, runtimeState: "unknown", sessionEnd: null }, thread)).toBe(false);
    expect(carriesOn({ running: null, runtimeState: "unknown", sessionEnd: null }, thread)).toBe(false);
    expect(carriesOn({ running: null, runtimeState: "unreachable", sessionEnd: "lost" }, thread)).toBe(false);
  });
  it("never when the thread cannot take a message: bb shows none, or says it is in error", () => {
    const lost = { running: false, runtimeState: "stopped", sessionEnd: "lost" };
    expect(carriesOn(lost, null)).toBe(false);
    expect(carriesOn(lost, { status: "error" })).toBe(false);
    expect(carriesOn(lost, { status: "active" })).toBe(true);
  });
});

describe("a retire's warnings", () => {
  const warnings = ["the bb thread of weekly-digest-helper could only be archived: its harness did not stop\nsecond line of the same warning", "retire hook oats.aweb: the alias is held"];
  it("stand in the result of a retire that finished, each under OATS's name, with all of it under Details", () => {
    const outcome = retireOutcome({ ...value(parseRetireApply(fixture("retire-apply.json"))), warnings }, retirePlan());
    expect(outcome.tone).toBe("done");
    expect(outcome.lines).toContain("OATS says: the bb thread of weekly-digest-helper could only be archived: its harness did not stop");
    expect(outcome.lines).toContain("OATS says: retire hook oats.aweb: the alias is held");
    expect(outcome.details).toBe(warnings.join("\n"));
  });
  it("stand in the result of a retire that did not finish, after its steps, and under Details after what the cleanup left", () => {
    const incomplete = value(parseRetireApply(fixture("retire-incomplete.json")));
    const outcome = retireOutcome({ ...incomplete, warnings: [warnings[1]!] }, retirePlan());
    expect(outcome.tone).toBe("failed");
    expect(outcome.lines.indexOf("OATS says: retire hook oats.aweb: the alias is held")).toBeGreaterThan(outcome.lines.indexOf("Cleanup didn't finish."));
    expect(outcome.details).toBe([...incomplete.incomplete, warnings[1]].join("\n"));
  });
  it("a receipt with none says nothing of them, and a finished retire has no Details", () => {
    const outcome = retireOutcome(value(parseRetireApply(fixture("retire-apply.json"))), retirePlan());
    expect(outcome.lines.some((line) => line.startsWith("OATS says:"))).toBe(false);
    expect(outcome.details).toBeNull();
  });
});

describe("a retire refused because a process still works in the home", () => {
  // RECORDED by the pi run (OATS 0.70.5): what the kernel printed for a retire asked within a minute of opening
  // the agent's pi thread, with exit 1 (test/fixtures/lifecycle/README.md).
  const refusal: { code: string; message: string } = (fixture("retire-pi-refused.json") as { error: { code: string; message: string } }).error;
  const WAIT = "If its thread was opened in the last minute, bb may still be listing models in its home. Try again in a minute.";
  it("for an agent that runs pi on bb says, after OATS's own line, that bb may still be listing models and to try again in a minute", () => {
    const outcome = applyRefused("retire", "dev-1", refusal, piOnBb({ backend: "bb", harness: "pi" }));
    expect(outcome).toMatchObject({ tone: "failed", title: "Dev 1 wasn't retired", code: "E_RUNTIME_QUIESCE_FAILED", offers: ["review"] });
    expect(refusal.code).toBe("E_RUNTIME_QUIESCE_FAILED");
    expect(refusal.message).toMatch(/^the bb session of pi-form-developer stopped, and a process works in its home \(pid \d+ pi\); stop it, then retire again\./);
    expect(outcome.lines).toEqual(["OATS tried to end a session or a process and couldn't confirm that it ended.", `OATS says: ${refusal.message}`, WAIT]);
  });
  it("is decided from read facts alone: the code, the plan's backend, the row's harness; never from what the message names", () => {
    expect(piOnBb({ backend: "bb", harness: "pi" })).toBe(true);
    expect(piOnBb({ backend: "bb", harness: "claude" })).toBe(false);
    expect(piOnBb({ backend: "tmux", harness: "pi" })).toBe(false);
    expect(piOnBb({ backend: "bb", harness: null })).toBe(false);
    expect(piOnBb({ backend: null, harness: "pi" })).toBe(false);
    // The same message for an agent on another harness: the Desktop's sentence alone, as before.
    expect(applyRefused("retire", "dev-1", refusal, false).lines).toEqual(["OATS tried to end a session or a process and couldn't confirm that it ended."]);
    // A message that names no pi, for an agent that runs pi on bb: the line still stands (the message is not read).
    expect(applyRefused("retire", "dev-1", { code: "E_RUNTIME_QUIESCE_FAILED", message: "could not establish that the bb session of dev-1 stopped" }, true).lines).toContain(WAIT);
  });
  it("only for that code, and only for a retire", () => {
    expect(applyRefused("retire", "dev-1", { code: "E_CHILDREN_RUNNING", message: "m" }, true).lines).not.toContain(WAIT);
    expect(applyRefused("stop", "dev-1", refusal, true).lines).not.toContain(WAIT);
    // Asked again with the same key: the kernel's own answer settles it, with the same line.
    expect(checkAgainRefused("retire", "dev-1", refusal, true).lines).toContain(WAIT);
  });
});

describe("an outcome as the toaster tells it, when its dialog is gone", () => {
  it("a stop, a start or a restart that is done is told whole, and may leave by itself", () => {
    const done = stopOutcome(value(parseStopApply(fixture("stop-apply.json").result)), "redesign-ui-lead");
    expect(toasted("stop", done)).toEqual({ plain: true, tone: "done", title: done.title, lines: done.lines });
    const started = startOutcome("start", "dev-1", value(parseSessionStart(fixture("start.json"))));
    expect(toasted("start", started).plain).toBe(true);
  });
  it("anything else is told by its title alone, for the dialog to be opened again on: a toast names no button and holds no path", () => {
    const outcomes: [Parameters<typeof toasted>[0], ReturnType<typeof applyRefused>][] = [
      ["retire", applyRefused("retire", "dev-1", { code: "E_UNIDENTIFIED_INSTANCE_HOME", message: "what is left, and how to finish" })], // "Details says …"
      ["stop", applyRefused("stop", "dev-1", { code: null, message: "m" })], // "Details says why."
      ["stop", applyRefused("stop", "dev-1", { code: "E_SESSION_UNKNOWN", message: "m" })], // "Review again …"
      ["stop", applyRefused("stop", "dev-1", { code: "E_PLAN_STALE", message: "m" })],
      ["stop", applyRefused("stop", "dev-1", { code: "OATS_TIMEOUT", message: "m" })], // "Check again …"
      ["retire", checkAgainRefused("retire", "dev-1", { code: "E_LIFECYCLE_BUSY", message: "m" })],
      ["start", startRefused("start", "dev-1", { code: "E_SPAWN_INCOMPLETE", message: "m" })], // "Refresh status, …"
      ["restart", startRefused("restart", "dev-1", { code: "E_SOMETHING_ELSE", message: "m" })],
      // A retire that finished: its lines hold where the worktree and the recovery copy are, and its warnings.
      ["retire", retireOutcome({ ...value(parseRetireApply(fixture("retire-apply.json"))), warnings: ["the bb thread could only be archived"] }, retirePlan())],
    ];
    for (const [verb, outcome] of outcomes) {
      const toast = toasted(verb, outcome);
      expect(toast, outcome.title).toEqual({ plain: false, tone: outcome.tone, title: outcome.title, lines: [] });
      expect(JSON.stringify(toast)).not.toMatch(/Details|Check again|Review again|Refresh status|\/abs\//);
    }
  });
  it("says first what the dialog sets apart: a home that was kept", () => {
    const kept = retireOutcome(value(parseRetireApply(fixture("retire-incomplete.json"))), retirePlan());
    expect(kept.warning).toBeDefined();
    expect(toasted("retire", kept)).toEqual({ plain: false, tone: "failed", title: kept.title, lines: [kept.warning!.title] });
  });
});

describe("an act the kernel refused and marked unconfirmed", () => {
  // SHAPED, from the envelope's form (the kernel's `error.details.unconfirmed: true`, which the plugin's server
  // hands on beside the refusal's text; #52's fixtures hold the form): no run of ours has met one for these acts.
  const marked = { code: "E_RETIRE_INCOMPLETE", message: "the home was moved aside and the retire hooks did not answer\nmore of it", unconfirmed: true };
  it("one code keeps its own sentence though the kernel marks it too: a start that did not finish (its session is there), with the same Refresh status", () => {
    const own = { tone: "unknown", title: "OATS could not confirm that Dev 1 finished starting", lines: ["Its session was kept. Refresh status, then open its thread to read what it shows. Do not start it again before that."], offers: ["refresh"] };
    expect(startRefused("start", "dev-1", { code: "E_SPAWN_INCOMPLETE", message: "m", unconfirmed: true })).toMatchObject(own);
    expect(startRefused("start", "dev-1", { code: "E_SPAWN_INCOMPLETE", message: "m" })).toMatchObject(own);
  });
  it("a retire: not confirmed, OATS's own line, the code, Check again; never \"wasn't retired\"", () => {
    expect(applyRefused("retire", "dev-1", marked)).toEqual({
      tone: "unknown",
      title: "Result not confirmed",
      lines: ["OATS could not confirm what the retire left. Check again before assuming nothing happened.", "OATS says: the home was moved aside and the retire hooks did not answer"],
      code: "E_RETIRE_INCOMPLETE",
      details: marked.message,
      offers: ["check"],
    });
  });
  it("a stop: the same, with Check again for the same apply", () => {
    const outcome = applyRefused("stop", "dev-1", { code: "E_SESSION_STOP_FAILED", message: "its harness was signalled; whether it ended is not known", unconfirmed: true });
    expect(outcome).toMatchObject({ tone: "unknown", title: "Result not confirmed", code: "E_SESSION_STOP_FAILED", offers: ["check"] });
    expect(outcome.lines).toEqual(["OATS could not confirm what the stop left. Check again before assuming nothing happened.", "OATS says: its harness was signalled; whether it ended is not known"]);
  });
  it.each([["start", "E_SESSION_START_BUSY"], ["restart", "E_BACKEND_NOT_READY"]] as const)("a %s: not confirmed, with what its dialog offers for that (Refresh status), never \"wasn't started\"", (verb, code) => {
    const outcome = startRefused(verb, "dev-1", { code, message: "the launch was sent and its session was not seen", unconfirmed: true });
    expect(outcome).toMatchObject({ tone: "unknown", title: "Result not confirmed", code, offers: ["refresh"] });
    expect(outcome.lines).toEqual([`OATS could not confirm what the ${verb} left. Refresh its status before another try.`, "OATS says: the launch was sent and its session was not seen"]);
    // The same code without the marker is the kernel's plain refusal.
    expect(startRefused(verb, "dev-1", { code, message: "m" }).tone).toBe("failed");
  });
  it("only with the marker", () => {
    expect(applyRefused("retire", "dev-1", { ...marked, unconfirmed: false })).toMatchObject({ tone: "failed", title: "Dev 1 wasn't retired" });
    expect(applyRefused("retire", "dev-1", { code: marked.code, message: marked.message })).toMatchObject({ tone: "failed" });
    expect(applyRefused("stop", "dev-1", { code: "E_SESSION_STOP_FAILED", message: "m" })).toMatchObject({ tone: "failed", title: "Dev 1 wasn't stopped" });
  });
  it("asked again, the kernel's same marked answer stays not confirmed, and the toaster tells it by its title, to be shown again", () => {
    expect(checkAgainRefused("retire", "dev-1", marked)).toMatchObject({ tone: "unknown", title: "Result not confirmed", offers: ["check"] });
    expect(toasted("retire", applyRefused("retire", "dev-1", marked))).toEqual({ plain: false, tone: "unknown", title: "Result not confirmed", lines: [] });
  });
});

describe("the start of a tmux agent whose session was lost (a resume)", () => {
  // The answers are SHAPED from the kernel's doc (test/fixtures/lifecycle/README.md).
  const answered = (file: string) => value(parseSessionStart(fixture(file).result)); // (the envelope's result, as the runner hands it to the parser)
  it("is decided from the rows a real tmux home gave (recorded): lost resumes; stopped with OATS and running do not", () => {
    expect(resumable(fixture("tmux-row-lost.json"))).toBe(true);
    expect(resumable(fixture("tmux-row-stopped.json"))).toBe(false); // runtimeState "shell", sessionEnd "stopped"
    expect(resumable(fixture("tmux-row-running.json"))).toBe(false);
  });
  it("the recorded plain start and restart of a tmux home say nothing of a conversation; the two recorded refusals of a resume have their words", () => {
    expect(startOutcome("start", "lost-tmux-developer", answered("tmux-start.json"))).toMatchObject({ tone: "done", title: "Lost tmux developer started.", lines: [] });
    expect(startOutcome("restart", "lost-tmux-developer", value(parseSessionStart(fixture("tmux-restart.json").result, "restart")))).toMatchObject({ tone: "done", title: "Lost tmux developer restarted.", lines: [] });
    // Stopped, not lost: back to the check. Running: told as already running, with the way to refresh.
    expect(startRefused("start", "lost-tmux-developer", fixture("tmux-resume-not-lost.json").error)).toMatchObject({ tone: "failed", lines: ["Its session is no longer lost, so there is no conversation to bring back. Read what Start does now."] });
    expect(startRefused("start", "lost-tmux-developer", fixture("tmux-resume-running.json").error)).toMatchObject({ tone: "failed", title: "Lost tmux developer wasn't started", lines: ["This instance is already running. Nothing was started."], offers: ["refresh"] });
  });
  it("is decided from the kernel's row: tmux, and a session that was lost; nothing else", () => {
    expect(resumable({ backend: "tmux", sessionEnd: "lost" })).toBe(true);
    expect(resumable({ backend: "tmux", sessionEnd: "stopped" })).toBe(false);
    expect(resumable({ backend: "tmux", sessionEnd: "exited" })).toBe(false);
    expect(resumable({ backend: "tmux", sessionEnd: null })).toBe(false);
    expect(resumable({ backend: "bb", sessionEnd: "lost" })).toBe(false);
    expect(resumable({ backend: null, sessionEnd: "lost" })).toBe(false);
  });
  it("says after the press what the kernel answered: back in its last conversation", () => {
    expect(startOutcome("start", "kernel-fix-developer", answered("tmux-start-resume.json"))).toEqual({ tone: "done", title: "Kernel fix developer is back in its last conversation.", lines: [], code: null, details: null, offers: [] });
  });
  it("says that it started FRESH, first and as a warning, then the kernel's reason in words; a reason it does not know is OATS's own word", () => {
    const fresh = answered("start-resume-fresh.json");
    expect(startOutcome("start", "kernel-fix-developer", fresh)).toMatchObject({ tone: "done", attention: true, title: "Kernel fix developer started fresh: its last conversation was not brought back.", lines: ["Its last conversation was not found."] });
    const because = (reason: string | null) => startOutcome("start", "kernel-fix-developer", { ...fresh, resume: { resumed: false, reason, waiting: null } }).lines;
    expect(because("no-receipts")).toEqual(["OATS has no record of where its harness kept it."]);
    expect(because("resume-unproven")).toEqual(["OATS cannot yet bring a Codex conversation back."]);
    expect(because("a-later-reason")).toEqual(["OATS says: a-later-reason"]);
    expect(because(null)).toEqual([]);
    // Never told by the toaster as a plain success: it is opened again, and in the warning tone, as the dialog draws it.
    expect(toasted("start", startOutcome("start", "kernel-fix-developer", fresh), true)).toEqual({ plain: false, tone: "unknown", title: "Kernel fix developer started fresh: its last conversation was not brought back.", lines: [] });
  });
  it("no start or restart of an agent with no bb thread is told whole by a toast: its result holds where it runs and a command to copy", () => {
    const back = startOutcome("start", "kernel-fix-developer", answered("tmux-start-resume.json"));
    const plainStart = startOutcome("start", "lost-tmux-developer", answered("tmux-start.json"));
    const restarted = startOutcome("restart", "lost-tmux-developer", value(parseSessionStart(fixture("tmux-restart.json").result, "restart")));
    for (const [verb, outcome] of [["start", back], ["start", plainStart], ["restart", restarted]] as const) {
      expect(toasted(verb, outcome, true)).toEqual({ plain: false, tone: "done", title: outcome.title, lines: [] });
      // The same result of an agent on bb, which has a thread to open, is told whole.
      expect(toasted(verb, outcome).plain).toBe(true);
    }
  });
  it("marks a start whose harness waits for its person in its terminal, which a toast cannot tell whole", () => {
    const waiting = startOutcome("start", "kernel-fix-developer", answered("start-resume-waiting.json"));
    expect(waiting).toMatchObject({ tone: "done", title: "Kernel fix developer is back in its last conversation.", lines: [], waiting: true });
    expect(toasted("start", waiting)).toEqual({ plain: false, tone: "done", title: "Kernel fix developer is back in its last conversation.", lines: [] });
    expect(startOutcome("start", "kernel-fix-developer", answered("tmux-start-resume.json")).waiting).toBeUndefined();
  });
  it("a start that asked for no resume says nothing of a conversation", () => {
    expect(startOutcome("start", "weekly-digest-helper", value(parseSessionStart(fixture("start.json")))).lines).toEqual([]);
  });
  it("a resume the kernel refused: its session is not lost any more; or its launch settings changed, with the tick that is the remedy named", () => {
    expect(startRefused("start", "kernel-fix-developer", { code: "E_RESUME_NOT_LOST", message: "kernel-fix-developer did not lose its session (stopped)" })).toMatchObject({
      tone: "failed",
      title: "Kernel fix developer wasn't started",
      lines: ["Its session is no longer lost, so there is no conversation to bring back. Read what Start does now."],
      offers: ["refresh"],
    });
    expect(startRefused("start", "kernel-fix-developer", { code: "E_LAUNCH_ENV_CHANGED", message: "a launch value differs from the one it last ran with: ANTHROPIC_BASE_URL, file:/abs/key" })).toMatchObject({
      tone: "failed",
      title: "Kernel fix developer wasn't started",
      lines: ["Its launch settings changed since it last ran. Tick “Start fresh on its task instead”.", "OATS says: a launch value differs from the one it last ran with: ANTHROPIC_BASE_URL, file:/abs/key"],
      offers: ["refresh"],
    });
  });
});
