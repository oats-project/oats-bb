// What the lifecycle dialogs say: a Stop or a Retire plan as "what will happen" and "what is kept",
// an apply's answer as a result, a start's outcome, and every refusal in a person's words with the
// kernel's code after. The sentences are the OATS Desktop's, copied from awebai/oats at 5be291249:
//   packages/client/lifecycle-confirmation.mjs (`happening`, `current`, `discardWarning`, `retired`,
//     `outcomeView`, `unavailableView`), packages/client/lifecycle-contract.mjs (`messages`, `BUSY`,
//     `stoppedRowText`, `stopResultWords`, `childrenRefusedMessage`),
//   packages/client/session-start.mjs (`STARTED_NOTHING`, `claimRefusalSentence`),
//   packages/client/start-gate.mjs, packages/client/launch-prompt-outcome.mjs (`retainedStartMessage`),
//     packages/desktop/renderer/start-instance.mjs,
//     start-unconfirmed.mjs and leader-dispatch.mjs (`actAvailability`).
// Where bb's nature or the plugin's patterns change a word, plugin/WORDS.md holds the pair ("The
// lifecycle dialogs"). An agent is named by its name as words (`agentName`), as everywhere.
// Pure: no bb, no React, never throws. Text of the kernel's is returned raw: the components that
// draw it put it through the display filter.
import type { RetirePlan, RetireReceipt, Started, StopPlan, StopReceipt, StoppedRow } from "../../kernel/lifecycle";
import { agentName, FULL_MODE } from "../ui/words";

export type PlanVerb = "stop" | "retire";
export type RunVerb = "start" | "restart";
export type Verb = PlanVerb | RunVerb;

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const names = (instances: readonly string[]) => instances.map(agentName).join(", ");

// ---- a plan, for review ----

export type PlanView = {
  /** What the act does, as sentences about the named agent. */
  happens: string[];
  /** What it leaves as it is. */
  kept: string[];
  /** What a person should see before confirming: an agent in the middle of a task, a work tree on another branch. */
  attention: string[];
  /** Current state: plain values by label. */
  state: { label: string; value: string }[];
  /** What is not included, and why. */
  notes: string[];
  /** The plan's one tick, when it has one to offer. `warning` stands under it while it is ticked. */
  choice: { label: string; checked: boolean; warning: string | null } | null;
  /** Why the plan cannot be confirmed, naming the control that mends it; null when it can. */
  blocked: string | null;
  /** The primary button, named for the act. */
  confirm: string;
};

const SESSION = { there: "Running", none: "Not running", unknown: "Unknown (couldn't be checked)" } as const;
/** The same, in a row labelled with an agent's name and not with "Session". */
const SESSION_OF = { there: "Session running", none: "Session not running", unknown: "Session unknown (couldn't be checked)" } as const;
const ambiguous = (instance: string) => `Not included: ${agentName(instance)} (another instance has the same parent name, so OATS can't tell whose child it is).`;

/**
 * What a stop means for the agent's bb thread, in the confirmation and in the result: ONE
 * function of ONE fact, whether the bb session provider archives the thread of a home it stops.
 * Today it does not: bb's composer stays live under a stopped agent, and a message typed there
 * starts it again without OATS knowing.
 */
export const stopThreadSentence = (archives: boolean): string =>
  archives ? "Its thread is archived. To talk to it again, start it." : "A message sent in its thread starts it again without OATS. To talk to it again, use Start.";
/**
 * The fact, read from the provider's VERSION (the `version` of `oats capabilities show oats.bb
 * --json`, the read the harness list makes): the bb session provider archives the thread at stop
 * from oats-bb v0.4.0 on (fixed by the release lane). The compare is numeric, part by part.
 * Everything that is not known to archive answers false, so that the dialog keeps the sentence
 * that warns ("a message sent in its thread starts it again without OATS"):
 * - a version below it;
 * - a version that is not a release's `major.minor.patch` (a commit, for a provider taken from a
 *   repository; an empty or partial one), and none at all;
 * - a PRE-RELEASE of the threshold itself (`0.4.0-rc.1`): by semver it comes before 0.4.0, and
 *   nothing says that a candidate already archives. A pre-release of a later version is later.
 */
export const ARCHIVES_AT_STOP_FROM: string | null = "0.4.0";
const RELEASE = /^(\d+)\.(\d+)\.(\d+)(-[0-9A-Za-z.-]+)?(\+[0-9A-Za-z.-]+)?$/;
export function stopArchivesThread(providerVersion: string | null, from: string | null = ARCHIVES_AT_STOP_FROM): boolean {
  const [have, need] = [providerVersion === null ? null : RELEASE.exec(providerVersion), from === null ? null : RELEASE.exec(from)];
  if (have === null || need === null) return false;
  for (const part of [1, 2, 3]) {
    const [mine, theirs] = [Number(have[part]), Number(need[part])];
    if (mine !== theirs) return mine > theirs;
  }
  // The same release: a pre-release of it comes before it.
  return have[4] === undefined;
}

export const STOP_CHOICE = "Include child instances";
export const RETIRE_CHOICE = "Also delete the worktree";
/** The reason beside Retire when the tick is set for a tree that is not the agent's own (the Desktop's E_OPTION_UNAVAILABLE, naming the tick). */
export const DISCARD_NOT_OWN = `Only an instance with its own worktree can delete it. Untick “${RETIRE_CHOICE}”.`;

/** `archives`: whether the provider archives the thread of a home it stops (`stopArchivesThread`). */
export function stopPlanView(plan: StopPlan, archives = false): PlanView {
  const targets = plan.targets;
  const happens = [
    plan.recursive && targets.length > 1 ? `Stops ${targets.length} sessions, children first: ${names(targets.map((target) => target.instance))}.` : `Stops the session of ${plan.instance === null ? "this agent" : agentName(plan.instance)}.`,
    "A session that refuses to stop is left running; nothing is forced.",
  ];
  if (plan.skipped.length > 0) happens.push(`Not stopped: ${names(plan.skipped)} (children not included).`);
  // An agent on bb has a thread, and a stop leaves something to know about it.
  if (targets.some((target) => target.backend === "bb")) happens.push(stopThreadSentence(archives));
  // The tick is offered when the agent has children to include or to leave: a plan with neither has nothing to choose.
  const hasChildren = targets.length > 1 || plan.skipped.length > 0;
  return {
    happens,
    kept: ["Nothing is deleted. Its home, worktree, transcript and launch settings are kept; you can start it again."],
    attention: targets.filter((target) => target.midTask === true).map((target) => `${agentName(target.instance)} reports it is in the middle of a task.`),
    // The word is the SESSION's (the Desktop's "Running / Not running"), and says so: the roster's word for the
    // same agent is its state (Working, Idle), and the two side by side read as a contradiction otherwise.
    state: targets.map((target) => ({ label: agentName(target.instance), value: SESSION_OF[target.session] })),
    notes: plan.ambiguous.map(ambiguous),
    choice: hasChildren ? { label: STOP_CHOICE, checked: plan.recursive, warning: null } : null,
    blocked: null,
    confirm: "Stop",
  };
}

/**
 * What the Desktop's sheet leaves unsaid, and a person must know before confirming, said after what
 * goes and what stays. Every retire of an agent on bb archives its thread (the kernel side's probe,
 * bb-app 0.50.1): its conversation stays readable there. The plugin never asks to keep the home.
 */
export const RETIRE_FOR_GOOD = "This cannot be undone.";
export const RETIRE_FOR_GOOD_ON_BB = "This cannot be undone. Its conversation stays readable in bb, archived.";
/** In a retire's result, of the thread the provider archived. */
export const RETIRE_ARCHIVED = "Its conversation stays readable in bb, archived.";
/**
 * In the result of a retire that KEPT the home (its cleanup did not finish): the agent can come
 * back with no OATS around it. The line, and under Details the release lane's own words (decided
 * by the release lane, 22 Nov).
 */
export const HOME_KEPT = "Its home was kept. Its thread can be unarchived in bb, and a message then starts it again with no OATS around it.";
export const HOME_KEPT_DETAILS =
  "No status row, no hooks OATS runs for it, no stop by OATS. Where its aweb identity was not released (a team leave waiting for its controller, a retained seat, an alias held), it can send mail as the retired agent.";

/** Whether `work/` is the agent's own tree: the kernel's fact, else (a kernel that does not say) the record's work mode. */
const treeOf = (plan: RetirePlan) => {
  const fact = plan.ownWorktree !== null;
  const own = fact ? plan.ownWorktree === true : plan.workMode === "worktree";
  return { own, unchecked: fact && own && !plan.work.observed, notOwn: fact && !own };
};
/** The worktree's branch as observed, else the one recorded at spawn; null when detached or unknown. */
const branchOf = (plan: RetirePlan) => (plan.work.observed ? plan.work.branch : plan.recordedBranch);
const stays = (branch: string | null) => (branch ? ` Branch ${branch} stays in the repository.` : "");
const workText = (plan: RetirePlan) => {
  const { observed, changed, untracked } = plan.work;
  if (!observed) return SESSION.unknown;
  if (changed === 0 && untracked === 0) return "None";
  return [changed > 0 ? `${changed} changed` : null, untracked > 0 ? `${untracked} untracked` : null].filter((part) => part !== null).join(", ");
};

export function retirePlanView(plan: RetirePlan, discardWorktree: boolean): PlanView {
  const tree = treeOf(plan);
  const branch = branchOf(plan);
  const happens: string[] = [];
  const kept: string[] = [];
  const attention: string[] = [];
  if (plan.session === "there") happens.push("Stops its session.");
  else if (plan.session === "unknown") happens.push("Stops its session, if one is running (its state couldn't be checked).");
  if (plan.children.length > 0) happens.push(`Stops its ${plural(plan.children.length, "child instance")} first: ${names(plan.children)}. They are kept, with their homes.`);
  happens.push("Saves a recovery copy of any uncommitted work, then deletes its home folder.");
  if (tree.notOwn) kept.push("It has no worktree of its own, so no worktree is kept or deleted. A tree it links to is not touched.");
  else if (tree.unchecked) (discardWorktree ? happens : kept).push(discardWorktree ? "Deletes its worktree, if there is one. It couldn't be checked." : "Keeps its worktree, moved aside, if there is one. It couldn't be checked.");
  else if (tree.own) {
    if (discardWorktree) happens.push(`Deletes its worktree.${stays(branch)}`);
    else kept.push(`Keeps its worktree, moved aside${branch ? `, on branch ${branch}` : ""}.`);
  }
  // The agent's extra trees (`oats worktree add`): the kernel says of each what the retire does
  // with it. The Desktop does not draw them; the words are the plugin's (WORDS.md).
  let refused: string | null = null;
  for (const extra of plan.extraTrees) {
    const which = `its extra worktree${extra.branch ? ` on branch ${extra.branch}` : ""}`;
    if (extra.disposition === "retain") kept.push(`Keeps ${which}, moved aside.`);
    else if (extra.disposition === "remove") happens.push(`Deletes ${which}: it holds no uncommitted work.${stays(extra.branch)}`);
    else if (extra.disposition === "refuse") refused = which;
    else attention.push(`OATS does not say what happens to ${which}.`);
  }
  kept.push("Branches and pull requests are not changed.");
  if (plan.children.length > 0) happens.push("If a child won't stop, nothing is retired.");
  // After what goes and what stays: there is no way back from it.
  attention.unshift(plan.backend === "bb" ? RETIRE_FOR_GOOD_ON_BB : RETIRE_FOR_GOOD);
  if (!tree.notOwn && plan.work.observed && plan.work.drift) {
    attention.push(`The worktree is on ${plan.work.detached ? "a detached commit" : (plan.work.branch ?? "another branch")}, not the branch it was spawned on${plan.recordedBranch ? ` (${plan.recordedBranch})` : ""}.`);
  }
  const state: { label: string; value: string }[] = [{ label: "Session", value: SESSION[plan.session] }];
  if (!tree.notOwn) {
    if (plan.work.observed || tree.own) state.push({ label: "Uncommitted work", value: workText(plan) });
    if (plan.work.observed) state.push({ label: "Branch", value: plan.work.detached ? "Detached" : (plan.work.branch ?? "Unknown") });
  }
  let warning: string | null = null;
  if (discardWorktree && !tree.notOwn) {
    if (tree.unchecked) warning = "Deletes the worktree folder, if there is one, with any uncommitted changes (a recovery copy is saved first). It couldn't be checked.";
    else {
      const n = plan.work.observed ? plan.work.changed + plan.work.untracked : null;
      const including = n === null ? ", including uncommitted changes, if any (a recovery copy is saved first)" : n > 0 ? `, including ${plural(n, "uncommitted change")} (a recovery copy is saved first)` : "";
      warning = `Deletes the worktree folder${including}.${stays(branch)}`;
    }
  }
  const blocked =
    refused !== null
      ? `OATS would refuse: ${refused} cannot be moved aside. Remove it with OATS on the machine that holds it, then press Check again.`
      : discardWorktree && !tree.own
        ? DISCARD_NOT_OWN
        : null;
  return {
    happens,
    kept,
    attention,
    state,
    notes: plan.ambiguous.map(ambiguous),
    // Offered for the agent's own tree; it stays while it is ticked, so that it can be undone.
    choice: tree.own || discardWorktree ? { label: RETIRE_CHOICE, checked: discardWorktree, warning } : null,
    blocked,
    confirm: "Retire",
  };
}

// ---- the dialog's own lines ----

const ACT = { stop: "Stop", retire: "Retire", start: "Start", restart: "Restart" } as const;
/** The dialog's title: the act and the agent as the KERNEL names it; no agent is named before the kernel has. */
export function titleOf(verb: Verb, instance: string | null, named: boolean, settled = false): string {
  // A plan is a question until it is answered: once the act has a result, the title asks nothing.
  const ask = (verb === "stop" || verb === "retire") && !settled ? "?" : "";
  if (instance !== null) return `${ACT[verb]} ${agentName(instance)}${ask}`;
  return named ? `${ACT[verb]} this agent${ask}` : `${ACT[verb]} an agent`;
}
/** While the plan is read. The name is the one asked for: it says what is being checked, and titles nothing. */
export const checking = (verb: PlanVerb, instance: string) => `Checking what ${verb === "retire" ? "retiring" : "stopping"} ${agentName(instance)} will do…`;
export const UPDATING = "Updating for this choice…";
export const CHECKING_AGAIN = "Checking again…";
export const applying = (verb: PlanVerb, instance: string) =>
  verb === "retire" ? `Retiring ${agentName(instance)}. This can take up to a minute while sessions stop.` : `Stopping ${agentName(instance)}. This can take up to a minute.`;
/**
 * Under the line that says the act runs: a person need not wait in the dialog (the Desktop's "You
 * can close this window; stopping continues."). The result then reaches them through bb's toaster.
 */
export const LEAVE = {
  stop: "You can close this; stopping continues.",
  retire: "You can close this; retiring continues.",
  start: "You can close this; starting continues.",
  restart: "You can close this; restarting continues.",
} as const;
export const PLAN_STALE = "Something changed since you opened this. Review it and confirm again.";
/**
 * What differs between the plan a person confirmed and the plan as it is now, as sentences: who is
 * in it, whether each session runs, who is in the middle of a task; for a retire also its work and
 * its children. Whether anything differs is decided from what the dialog DRAWS (the two views),
 * never from this list of facts: where the views differ and no sentence here says how, one line
 * says that what this would do has changed. Empty only when the two views are equal (the kernel's
 * revision moved for a fact the plan does not draw): the notice then says so.
 */
export function planChanges(before: StopPlan | RetirePlan, after: StopPlan | RetirePlan, archives = false, archivedBefore = archives): string[] {
  const lines: string[] = [];
  const was = (value: keyof typeof SESSION) => SESSION[value].toLowerCase();
  if (before.action === "stop" && after.action === "stop") {
    const earlier = new Map(before.targets.map((target) => [target.instance, target]));
    const later = new Map(after.targets.map((target) => [target.instance, target]));
    for (const [instance, target] of later) {
      const old = earlier.get(instance);
      if (old === undefined) lines.push(`${agentName(instance)} is now in this plan.`);
      else {
        if (old.session !== target.session) lines.push(`${agentName(instance)}: its session was ${was(old.session)}, and is now ${was(target.session)}.`);
        if (old.midTask !== true && target.midTask === true) lines.push(`${agentName(instance)} now reports it is in the middle of a task.`);
        if (old.midTask === true && target.midTask !== true) lines.push(`${agentName(instance)} no longer reports it is in the middle of a task.`);
      }
    }
    for (const instance of earlier.keys()) if (!later.has(instance)) lines.push(`${agentName(instance)} is no longer in this plan.`);
  } else if (before.action === "retire" && after.action === "retire") {
    if (before.session !== after.session) lines.push(`Its session was ${was(before.session)}, and is now ${was(after.session)}.`);
    if (workText(before) !== workText(after)) lines.push(`Its uncommitted work was: ${workText(before).toLowerCase()}. It is now: ${workText(after).toLowerCase()}.`);
    if (branchOf(before) !== branchOf(after)) lines.push(`Its worktree is now on ${branchOf(after) ?? "no branch"}.`);
    for (const child of after.children) if (!before.children.includes(child)) lines.push(`${agentName(child)} is now one of its children.`);
    for (const child of before.children) if (!after.children.includes(child)) lines.push(`${agentName(child)} is no longer one of its children.`);
  }
  // Each plan is drawn with its own answer on whether a stop archives the thread (`archivedBefore`: the earlier plan's).
  if (lines.length === 0 && drawn(before, archivedBefore) !== drawn(after, archives)) lines.push(PLAN_CHANGED);
  return lines;
}
/** Everything the dialog draws of a plan: its title's agent and its view (a retire's with its tick off and on). */
const drawn = (plan: StopPlan | RetirePlan, archives: boolean): string =>
  JSON.stringify([plan.action, plan.instance, plan.action === "stop" ? [stopPlanView(plan, archives)] : [retirePlanView(plan, false), retirePlanView(plan, true)]]);
export const PLAN_CHANGED = "What this would do has changed: read it again below.";
export const NOTHING_SHOWN_CHANGED = "Nothing shown here differs: OATS read the plan again, and it is the one below.";
export const REVIEW_FIRST = "Read what changed, then press Review again.";
export const REPLAYED = "This is the result already recorded for this confirmation; nothing ran again.";

// ---- an outcome: a result, a refusal, or neither known ----

export type Outcome = {
  /** `unknown`: the result is not confirmed; never read as done, and never as nothing happened. */
  tone: "done" | "failed" | "unknown";
  title: string;
  /** A person's sentences under the title. */
  lines: string[];
  /** The kernel's or the plugin's code, after the words. */
  code: string | null;
  /** The kernel's own text, one press away under Details. */
  details: string | null;
  /**
   * What a person must read first, apart from the result and in the warning tone: a sentence, and
   * more of it one press away. (A retire that kept the home of an agent on bb.)
   */
  warning?: { title: string; details: string };
  /**
   * A result that is DONE and whose title is a warning (a resume that started fresh): drawn in the
   * warning tone, and told by the toaster as one that is opened again, never as a plain success.
   */
  attention?: true;
  /** What the dialog offers beside Close: read a new plan (Review again), ask for the answer to what was sent (Check again), read the agent's status again (Refresh status). */
  offers: readonly ("review" | "check" | "refresh")[];
  /**
   * The start SUCCEEDED and the harness waits for its person in its terminal before it loads the
   * conversation (the kernel's `waiting: "resume-confirmation"`): said on a line of its own, in
   * the attention tone, with the command that attaches to it.
   */
  waiting?: true;
};

/** One row of a stop's results, or of a retire's stopped children: its line, after its name. */
export function stoppedRowText(row: StoppedRow): string {
  if (row.ok) return row.alreadyIdle ? "Was already stopped" : "Stopped";
  if (row.code === "E_INSTANCE_RETIRING") return "Not stopped: it is being retired";
  if (row.code === "E_LIFECYCLE_BUSY") return "Not stopped: OATS couldn't lock its home";
  return row.stillRunning !== null ? `Didn't stop (still running: ${row.stillRunning.join(", ")})` : "Didn't stop";
}
const rowLines = (rows: readonly StoppedRow[]) => rows.map((row) => `${agentName(row.instance)}: ${stoppedRowText(row)}`);
const quotes = (rows: readonly StoppedRow[]) => rows.flatMap((row) => (row.detail === null ? [] : [`${row.instance}: ${row.detail}`]));

/**
 * `onBb`: some session of the plan runs on bb, so the result says what the stop means for its
 * thread. `archived`: whether bb shows the thread archived after the stop, where bb answered;
 * else what the confirmation said of it (`stopArchivesThread`).
 */
export function stopOutcome(receipt: StopReceipt, instance: string, onBb = false, archives = false): Outcome {
  const replay = receipt.replayed ? [REPLAYED] : [];
  const details = quotes(receipt.results).join("\n") || null;
  if (receipt.ok) {
    const title = receipt.results.length > 1 ? `${receipt.results.length} sessions stopped` : `${agentName(instance)} stopped`;
    return { tone: "done", title: `${title}.`, lines: [...rowLines(receipt.results), ...(onBb ? [stopThreadSentence(archives)] : []), ...replay], code: null, details, offers: [] };
  }
  return { tone: "failed", title: "Not every session stopped", lines: [...rowLines(receipt.results), "Nothing was forced.", ...replay], code: "E_SESSION_STOP_FAILED", details, offers: ["review"] };
}

export function retireOutcome(receipt: RetireReceipt, plan: RetirePlan): Outcome {
  const name = agentName(receipt.instance);
  const replay = receipt.replayed ? [REPLAYED] : [];
  if (receipt.deferred) {
    return { tone: "unknown", title: "Retirement accepted", lines: ["Retirement was accepted and will finish in the background.", "Its row in the sidebar shows the result.", ...replay], code: null, details: null, offers: ["check"] };
  }
  const complete = receipt.removedDir && receipt.incomplete.length === 0;
  const lines: string[] = [];
  if (complete && plan.session === "there") lines.push("Session stopped.");
  if (receipt.children.length > 0) lines.push(`${plural(receipt.children.length, "child instance")} stopped and kept.`);
  // A path stands on a line of its own, as the Desktop sets it apart: no full stop is glued to it, and it can be selected whole.
  const at = (sentence: string, path: string | null) => (path ? [`${sentence}, at:`, path] : [`${sentence}.`]);
  lines.push(...(receipt.removedDir ? ["Home folder deleted."] : at("Home folder kept", receipt.retainedHome)));
  if (receipt.worktree === "retained") lines.push(...at("Worktree kept", receipt.movedTo));
  if (receipt.worktree === "removed") lines.push("Worktree deleted.");
  if (receipt.recoveryPath !== null) lines.push("Recovery copy saved at:", receipt.recoveryPath);
  // The home is gone: nothing can start the agent again, and its conversation is where it was, archived.
  if (receipt.removedDir && receipt.threadsArchived > 0) lines.push(RETIRE_ARCHIVED);
  // The home was kept (the kernel's answer says so: `removedDir` false): on bb its thread can be unarchived, and a message there starts it.
  // Said apart from the steps, first and in the warning tone (`warning`), with the release lane's words one press away.
  const keptOnBb = !receipt.removedDir && plan.backend === "bb";
  if (receipt.compensation !== null) {
    const { branch, deleted, reason } = receipt.compensation;
    lines.push(deleted ? `Branch ${branch} deleted: an interrupted spawn left it, and it held no work.` : `Branch ${branch} kept: ${reason ?? "no reason given"}`);
  }
  if (receipt.incomplete.length > 0) lines.push("Cleanup didn't finish.");
  // What the kernel, or a capability's retire hook, warns of (why a retire could only archive, a
  // tree that was not the agent's own): each under its name, its first line; all of it under Details.
  const warned = receipt.warnings.flatMap(oatsSays);
  const warnings = receipt.warnings.join("\n");
  if (complete) return { tone: "done", title: `${name} retired.`, lines: [...lines, ...warned, ...replay], code: null, details: warnings || null, offers: [] };
  return {
    tone: "failed",
    title: "Retirement didn't finish",
    lines: ["Retirement didn't finish. Some steps ran:", ...lines, ...warned, "Check what was kept before trying again.", ...replay],
    code: "RETIRE_INCOMPLETE",
    details: [...receipt.incomplete, ...receipt.warnings].join("\n") || null,
    offers: ["review"],
    ...(keptOnBb ? { warning: { title: HOME_KEPT, details: HOME_KEPT_DETAILS } } : {}),
  };
}

/** The Desktop's sentence for each code a stop or a retire can be refused with. */
const LIFECYCLE: Readonly<Record<string, string>> = {
  E_BAD_ARGS: "Invalid lifecycle request.",
  E_USAGE: "Invalid lifecycle request.",
  E_AMBIGUOUS_INSTANCE: "OATS knows more than one agent by this name here, so it cannot say which one this is.",
  // On an apply the code has two meanings (the kernel no longer has the name; a session's state cannot be established): the sentence claims neither.
  E_SESSION_UNKNOWN: "OATS no longer knows this agent, or cannot tell the state of its session. Review again to see which.",
  E_PLAN_STALE: PLAN_STALE,
  E_INSTANCE_RETIRING: "An instance in this plan is already being retired.",
  E_CHILDREN_RUNNING: "A child instance wouldn't stop, so nothing was retired. Other children may already have stopped.",
  E_SESSION_STOP_FAILED: "The session didn't stop in time. Nothing was forced.",
  E_WORK_PRESERVATION_FAILED: "Its work couldn't be saved safely, so the home folder is kept. Earlier retirement steps may have run.",
  E_WORK_INSPECTION_FAILED: "Retirement was refused: OATS couldn't inspect the instance's home or work. The home folder is kept; its session may already have been stopped, and earlier retirement steps may have run.",
  E_RETIRE_INCOMPLETE: "Retirement didn't finish cleaning up. Check what was kept before trying again.",
  E_RUNTIME_QUIESCE_FAILED: "OATS tried to end a session or a process and couldn't confirm that it ended.",
  // The kernel's busy answer with no word of who holds the home (its `details` do not reach the app): the Desktop's weaker claim.
  E_LIFECYCLE_BUSY: "Nothing was done: OATS refused this as busy.",
};
/** The plugin's own codes for an `oats` that did not answer as a command does, in the Desktop's sentences. */
const TRANSPORT: Readonly<Record<string, string>> = {
  OATS_TIMEOUT: "OATS didn't answer in time.",
  OATS_ABORTED: "OATS didn't answer in time.",
  OATS_OUTPUT_TOO_LARGE: "OATS's answer was larger than the plugin reads safely.",
  OATS_NOT_JSON: "OATS answered in a form the plugin can't read.",
  OATS_BAD_ANSWER: "OATS answered in a form the plugin can't read.",
  OATS_FAILED: "OATS couldn't be run for this.",
  INVALID_INPUT: "Invalid lifecycle request.",
};
/** A call that may have reached the kernel and whose answer was lost: what it did is not known. */
const LOST = new Set(["OATS_TIMEOUT", "OATS_ABORTED", "HOST_UNREACHABLE", "PLUGIN_RPC_FAILED", "OATS_NOT_JSON", "OATS_BAD_ANSWER", "OATS_OUTPUT_TOO_LARGE"]);
/** A refusal with no code is the plugin's own server's (an agent the roster no longer names, an input it refused): its message is the details. */
const NO_CODE = "The plugin did not ask OATS for this. Details says why.";
const UNDESCRIBED = "OATS answered with an error that the plugin has no description for.";
const sentenceOf = (code: string | null, table: Readonly<Record<string, string>>): string => (code !== null && (table[code] ?? TRANSPORT[code])) || (code === null ? NO_CODE : /^E_[A-Z0-9_]+$/.test(code) ? UNDESCRIBED : "OATS couldn't be run for this.");
const unidentified = (verb: Verb) =>
  verb === "retire"
    ? "OATS can't tell what this home's capabilities created, or can't run their cleanup, so nothing was removed. Details says what may be left and how to finish."
    : "OATS couldn't find or read what it needs in this instance's home folder, so nothing was done.";

/** `unconfirmed`: the kernel's own marker that it could not confirm what its act left (`error.details.unconfirmed`). */
export type Refusal = { code: string | null; message: string; unconfirmed?: boolean };
/** The kernel's own line under its name, as the Desktop quotes a refusal: the first line of its message (the display filter draws it). Nothing for an empty message. */
export const oatsSays = (message: string): string[] => {
  const line = message.split(/[\n\u2028\u2029]/).find((part) => part.trim() !== "");
  return line === undefined ? [] : [`OATS says: ${line.trim()}`];
};

/** A plan that could not be read. `gone`: the kernel does not know the name (E_SESSION_UNKNOWN on a plan, and nothing else). */
export function planRefused(verb: PlanVerb, instance: string, refusal: Refusal, gone: boolean): Outcome {
  const name = agentName(instance);
  if (gone) {
    return {
      tone: "failed",
      title: `${name} is not in OATS any more`,
      lines: ["OATS has no agent of this name now: it was retired, or removed, after the roster on screen was read. Nothing was changed."],
      code: refusal.code,
      details: refusal.message,
      offers: [],
    };
  }
  const sentence = refusal.code === "E_UNIDENTIFIED_INSTANCE_HOME" ? unidentified(verb) : sentenceOf(refusal.code, LIFECYCLE);
  return { tone: "failed", title: `Couldn't check what ${verb === "retire" ? "retiring" : "stopping"} ${name} will do`, lines: [sentence, ...(sentence === UNDESCRIBED ? oatsSays(refusal.message) : []), "Nothing was changed."], code: refusal.code, details: refusal.message, offers: ["review"] };
}

/**
 * After the kernel's line, when a RETIRE is refused because a process still works in the home
 * (E_RUNTIME_QUIESCE_FAILED) and the agent runs pi on bb: opening a pi thread makes bb list its
 * models with a pi of its own in the agent's home, which leaves by itself within a minute. The
 * line claims nothing about which process the kernel met (its message is not read): it is true
 * whichever it was, and says the one thing "stop it, then retire again" does not, that waiting
 * is the remedy. Decided from read facts only: the code, the plan's backend, the row's harness.
 */
export const PI_LISTING = "If its thread was opened in the last minute, bb may still be listing models in its home. Try again in a minute.";
export const piOnBb = (plan: { backend: string | null; harness: string | null }): boolean => plan.backend === "bb" && plan.harness === "pi";

/** An apply that was refused, or whose answer was lost. */
export function applyRefused(verb: PlanVerb, instance: string, refusal: Refusal, piListing = false): Outcome {
  const name = agentName(instance);
  if (refusal.code !== null && LOST.has(refusal.code)) {
    return { tone: "unknown", title: "Result not confirmed", lines: ["OATS didn't confirm the result. Check again before assuming nothing happened."], code: refusal.code, details: refusal.message, offers: ["check"] };
  }
  // An act the kernel refused AND marked unconfirmed: it says itself that it cannot tell what is left. The marker
  // means the same whichever act carries it: never "wasn't stopped/retired", whatever the code: not confirmed,
  // with OATS's own line and Check again (as the New agent form reads the marker).
  if (refusal.unconfirmed === true) {
    return { tone: "unknown", title: "Result not confirmed", lines: [`OATS could not confirm what the ${verb} left. Check again before assuming nothing happened.`, ...oatsSays(refusal.message)], code: refusal.code, details: refusal.message, offers: ["check"] };
  }
  const sentence = refusal.code === "E_UNIDENTIFIED_INSTANCE_HOME" ? unidentified(verb) : sentenceOf(refusal.code, LIFECYCLE);
  // A busy refusal's own sentence names what to check; a refusal with no sentence of the Desktop's is quoted too.
  const waits = verb === "retire" && refusal.code === "E_RUNTIME_QUIESCE_FAILED" && piListing; // (the function's own guard: a caller may pass the flag for a stop)
  const lines = refusal.code === "E_LIFECYCLE_BUSY" || sentence === UNDESCRIBED || waits ? [sentence, ...oatsSays(refusal.message), ...(waits ? [PI_LISTING] : [])] : [sentence];
  return { tone: "failed", title: `${name} wasn't ${verb === "retire" ? "retired" : "stopped"}`, lines, code: refusal.code, details: refusal.message, offers: ["review"] };
}

/**
 * The answer to "Check again": the same revision and key were sent a second time, to read the
 * result of an apply whose first answer was lost. Only the kernel's own word settles it. A second
 * ask that was not answered by the kernel (the roster cannot be read, the plugin's server refused,
 * the call failed again) leaves what it was: not confirmed, with Check again. And a kernel that
 * answers "busy" to its own key is still doing the first: that is said, not "nothing was done".
 */
export function checkAgainRefused(verb: PlanVerb, instance: string, refusal: Refusal, piListing = false): Outcome {
  const kernels = refusal.code !== null && /^E_[A-Z0-9_]+$/.test(refusal.code);
  if (kernels && refusal.code !== "E_LIFECYCLE_BUSY") return applyRefused(verb, instance, refusal, piListing);
  const still = `The ${verb === "retire" ? "removal" : "stop"} of ${agentName(instance)} is still running. Check again to read its result.`;
  return { tone: "unknown", title: "Result not confirmed", lines: [kernels ? still : "OATS didn't confirm the result. Check again before assuming nothing happened."], code: refusal.code, details: refusal.message, offers: ["check"] };
}

/**
 * An outcome as bb's toaster tells it, when the dialog it belonged to is gone (the person left it
 * while the act ran, or opened another). A toast has no Details, no "Check again", no "Review
 * again", no "Refresh status", and it cannot hold a path a person will need later. So there are
 * two kinds:
 * - `plain`: a stop, a start or a restart that is DONE. The toast says it whole, and leaves by itself.
 * - anything else (a refusal, a result that is not confirmed, an unfinished or a finished RETIRE,
 *   whose lines hold where the worktree and the recovery copy are): the toast says the title, and
 *   first what the dialog sets apart (a home that was kept); it STAYS until dismissed and carries
 *   "Show result", which opens the dialog again on that result, with everything it offers.
 */
export const SHOW_RESULT = "Show result";
export function toasted(verb: Verb, outcome: Outcome, threadless = false): { plain: boolean; tone: Outcome["tone"]; title: string; lines: string[] } {
  // `threadless`: a start or a restart of an agent with no bb thread (on tmux). Its result says where it runs, with
  // a command to copy, which a toast cannot hold: never plain, whatever it came to. And one that started FRESH after
  // a dialog that said it would try to continue is told in the warning tone, as the dialog draws it.
  const plain = outcome.tone === "done" && verb !== "retire" && outcome.warning === undefined && outcome.waiting !== true && outcome.attention !== true && !threadless;
  return { plain, tone: outcome.attention === true && outcome.tone === "done" ? "unknown" : outcome.tone, title: outcome.title, lines: plain ? outcome.lines : outcome.warning === undefined ? [] : [outcome.warning.title] };
}

// ---- Start and Restart ----

export { FULL_MODE };
export const START = {
  continues: "Continue in this instance’s existing home, with its identity, work and notes.",
  fresh: "This starts a new conversation using the saved briefing and state.",
  /**
   * For an agent that has a thread in bb: a start, and a restart, ALWAYS make a new bb thread; the
   * launch stops and archives the one it had (the bb session provider's launch:
   * oats-package/capabilities/oats-bb/lib/launch.mjs). Said in place of `fresh`.
   */
  newThread: "Starts a new conversation. The current one stays readable in bb, archived.",
  /**
   * For an agent that was cut off (`carriesOn`): a message in its thread carries its conversation
   * on, which a start does not, and neither does a restart. Said first in both dialogs; the act stays possible.
   */
  carryOn: "To carry on its conversation, send it a message in its thread instead.",
  checking: "Checking instance…",
  ready: "Ready to start.",
  restartWarning: "Restart stops the current harness after checking the new configuration. Save any in-progress work before continuing.",
  harness: "Harness",
  model: "Model for this start",
  badModel: "Enter a model name, not a command-line option.",
  refresh: "Refresh status",
  starting: "Starting…",
  restarting: "Checking configuration and restarting…",
  alreadyRunning: "This instance is already running.",
  unknownState: "Could not verify whether this instance is running. Refresh its status before starting.",
} as const;
/**
 * Whether the Start and the Restart dialog say first that a message in the agent's thread carries its
 * conversation on. Two facts, both read, neither inferred:
 * - the kernel's row says the agent does NOT run and that no operator stopped it: its session was
 *   lost (`running: false`, "stopped", `sessionEnd: "lost"`: with the host, or its harness gone),
 *   or its thread is at rest with no harness loaded (`running: false` with a runtime state that
 *   is not "stopped"; test/fixtures/lifecycle/README.md says which provider prints that row). An operator's stop
 *   (`sessionEnd: "stopped"`) never gets the line, and neither does a stopped row that does not
 *   say how its session ended;
 * - bb has its thread, in the sidebar (not archived, not hidden), and not in error: a thread that
 *   can take a message. `thread` is bb's own row of it, or null when bb shows none.
 */
export function carriesOn(row: { running: boolean | null; runtimeState: string | null; sessionEnd: string | null }, thread: { status: string } | null): boolean {
  if (row.running !== false || row.sessionEnd === "stopped") return false;
  if (row.runtimeState === "stopped" && row.sessionEnd !== "lost") return false;
  return thread !== null && thread.status !== "error";
}

/** Under the model field: what a blank field means, for the harness that will run. */
export const modelHelp = (recorded: string | null): string =>
  `Leave blank to use ${recorded ?? "the selected harness’s default model"}. This choice is saved for later starts of this instance.`;

/**
 * The start of a TMUX agent whose session was LOST (the kernel's row: backend tmux, sessionEnd
 * "lost"): `oats session start --resume` brings it back in the harness's own last conversation,
 * where a plain start begins fresh on its task. The words never promise what the kernel may not
 * give: before the press they are conditional; after it they say what the kernel answered.
 */
export const RESUME = {
  /** Final: the kernel has no preview of a resume for one agent, so nothing more is promised; the result says which happened. */
  tries: "Start tries to continue its last conversation. If it can't, it starts fresh on its task and says so.",
  /** Beside it for an agent whose recorded harness is claude: its resume-cost question, which nothing answers for the person. */
  claudeAsks: "Claude may first ask, in its terminal, how to load a long conversation.",
  /** The dialog's one choice for such an agent, off by default: the plain start, on purpose. */
  freshChoice: "Start fresh on its task instead",
  /** Under the choice while it is on. */
  freshWarning: "This starts a new conversation on its task. Its last conversation is not brought back.",
  /** The result's title when the kernel says it continues the conversation: `<Name> is back in its last conversation.` */
  back: "is back in its last conversation.",
  /** The result's title, in the warning tone, when the kernel says it started fresh instead (`<Name> started fresh: …`); the reason follows. */
  fresh: "started fresh: its last conversation was not brought back.",
  waiting: "It is waiting for you in its terminal: the harness asks how to load a long conversation before it goes on.",
  /** Names the tick that is the remedy: a resume the kernel refuses for its launch settings has no other. */
  envChanged: "Its launch settings changed since it last ran. Tick “Start fresh on its task instead”.",
  notLost: "Its session is no longer lost, so there is no conversation to bring back. Read what Start does now.",
} as const;
/** Why a resume started fresh, in words, for each reason the kernel names (docs/desktop-cli-api.md, "Resume a lost session"). */
const FRESH_BECAUSE: Readonly<Record<string, string>> = {
  "no-conversation": "Its last conversation was not found.",
  "no-receipts": "OATS has no record of where its harness kept it.",
  "resume-unproven": "OATS cannot yet bring a Codex conversation back.",
};
/** Whether a start of this agent is a resume: the kernel's row at the check says tmux and a lost session. Nothing else. */
export const resumable = (row: { backend: string | null; sessionEnd: string | null }): boolean => row.backend === "tmux" && row.sessionEnd === "lost";

/**
 * A start or a restart that the kernel answered: started. Its warnings, when a capability's launch
 * hook gave any, are its lines. For a resume: what the kernel's `resume` object says, never a
 * guess: back in its last conversation, or started fresh with the kernel's reason in words (a
 * reason this does not know is OATS's own word, under its name).
 */
export function startOutcome(verb: RunVerb, instance: string, started: Started): Outcome {
  const name = agentName(instance);
  const done = (title: string, lines: string[]): Outcome => ({ tone: "done", title, lines: [...lines, ...started.warnings], code: null, details: null, offers: [], ...(started.resume?.waiting === "resume-confirmation" ? { waiting: true as const } : {}) });
  if (started.resume === null) return done(`${name} ${verb === "restart" ? "restarted" : "started"}.`, []);
  if (started.resume.resumed) return done(`${name} ${RESUME.back}`, []);
  // It did NOT come back in its conversation: said first and in the warning tone, then the kernel's reason in words
  // (one this has no words for is OATS's own, under its name).
  const reason = started.resume.reason;
  const because = reason === null ? [] : FRESH_BECAUSE[reason] !== undefined ? [FRESH_BECAUSE[reason]!] : oatsSays(reason);
  return { ...done(`${name} ${RESUME.fresh}`, because), attention: true };
}

/** The kernel's codes for a start that started nothing, each with the Desktop's sentence. */
const STARTED_NOTHING: Readonly<Record<string, string>> = {
  E_SESSION_START_BUSY: "OATS refused this start as busy. Nothing was started.",
  E_SESSION_START_LOCK_STUCK:
    "Something in this instance's home blocks starting, usually a start lock an earlier OATS left; OATS's message names it. Nothing was started. Remove it once no earlier OATS is running: waiting will not clear it.",
  E_SESSION_RUNNING: "This instance is already running. Nothing was started.",
};

/** A start or a restart that was refused, that stopped at a launch prompt, or whose answer was lost. */
export function startRefused(verb: RunVerb, instance: string, refusal: Refusal): Outcome {
  const name = agentName(instance);
  const restart = verb === "restart";
  const nothing = restart ? "Nothing was stopped or started." : "Nothing was started.";
  const act = restart ? "restart" : "start";
  const of = (tone: Outcome["tone"], title: string, lines: string[], offers: Outcome["offers"] = ["refresh"]): Outcome => ({ tone, title, lines, code: refusal.code, details: refusal.message, offers });
  const code = refusal.code;
  // The session is there, and what its start came to is not known: never "failed", never "started".
  if (code === "E_SPAWN_INCOMPLETE") {
    return of("unknown", `OATS could not confirm that ${name} finished starting`, ["Its session was kept. Refresh status, then open its thread to read what it shows. Do not start it again before that."]);
  }
  if (code === "NO_THREAD_NAMED") return of("unknown", `${name} was started, but its thread isn't ready yet`, ["Open it from its row when it is."], []);
  // A start the kernel refused AND marked unconfirmed: it cannot tell what is left, whatever the code. Never
  // "wasn't started": not confirmed, with OATS's own line, and what a result that is not confirmed offers here (Refresh status).
  // ONE code is decided before it, above: E_SPAWN_INCOMPLETE, which the kernel marks too and of which more is
  // known (the session is there). Its sentence is as unsure, says more, and offers the same Refresh status.
  if (refusal.unconfirmed === true) return of("unknown", "Result not confirmed", [`OATS could not confirm what the ${act} left. Refresh its status before another try.`, ...oatsSays(refusal.message)]);
  // A resume the kernel refused: its session is not lost any more (the row changed after the check), or the
  // launch settings changed since it last ran (the remedy is a plain start, fresh: one more press).
  if (code === "E_RESUME_NOT_LOST") return of("failed", `${name} wasn't started`, [RESUME.notLost]);
  if (code === "E_LAUNCH_ENV_CHANGED") return of("failed", `${name} wasn't started`, [RESUME.envChanged, ...oatsSays(refusal.message)]);
  if (code !== null && LOST.has(code)) return of("unknown", "OATS didn't confirm the start", ["It may still be running: check its row in the sidebar before you start it again."]);
  if (code !== null && STARTED_NOTHING[code] !== undefined) return of("failed", `${name} wasn't ${restart ? "restarted" : "started"}`, [STARTED_NOTHING[code]!, ...(code === "E_SESSION_START_LOCK_STUCK" ? oatsSays(refusal.message) : [])]); // the sentence says OATS's message names what blocks: it stands under it
  if (code === "E_INSTANCE_RETIRING") return of("failed", `${name} wasn't ${restart ? "restarted" : "started"}`, [`This instance is being retired, or has cleanup to finish. ${nothing}`]);
  if (code === "E_LIFECYCLE_BUSY") return of("failed", `${name} wasn't ${restart ? "restarted" : "started"}`, [`OATS refused this ${act} as busy. ${nothing}`]);
  if (code === "E_UNIDENTIFIED_INSTANCE_HOME") return of("failed", `${name} wasn't ${restart ? "restarted" : "started"}`, [unidentified(verb)]);
  if (code === "E_BACKEND_HARNESS" || code === "E_UNSUPPORTED_HARNESS") return of("failed", `OATS refused to ${act} ${name} on this harness`, ["Choose another under Harness, or keep the recorded one."]);
  if (code === "E_MODEL_UNKNOWN") return of("failed", `OATS refused to ${act} ${name} with this model`, [`Change it under “${START.model}”, or leave the field blank.`]);
  // Any other answer of the kernel's: a person's words first, then the kernel's own line under its
  // name, as the Desktop quotes it ("OATS says: …"); the whole message and the code stay under Details.
  // What it did is not known for sure (the Desktop reads every other code as uncertain): the status is read again first.
  // A refusal of the plugin's own server (an agent the roster no longer names, a harness the provider does not declare): OATS was not asked.
  if (code === null) return of("failed", `${name} wasn't ${restart ? "restarted" : "started"}`, [NO_CODE]);
  if (TRANSPORT[code] !== undefined) return of("failed", `OATS refused to ${act} ${name}`, [TRANSPORT[code]!]);
  return of("failed", `OATS refused to ${act} ${name}`, [...oatsSays(refusal.message), "Refresh its status before another try."]);
}

// ---- an act that cannot run from where it was asked (a key, a command) ----

export const NO_TARGET = "This thread is not an OATS agent's.";
/** Why `verb` cannot act on an agent in this state, in one line; null when it can. `running`: the agent's session is there (working, idle, waiting); `known`: OATS can say. */
export function cannotAct(verb: Verb, instance: string, state: { running: boolean; known: boolean }): string | null {
  const name = agentName(instance);
  if (verb === "start") return state.running ? `${name} is already running.` : state.known ? null : `${name}'s state is not known, so it can't be started.`;
  if (verb === "restart") return state.running || !state.known ? null : `${name} is stopped: Start it instead.`;
  if (verb === "stop") return state.running ? null : state.known ? `${name} can't be stopped now.` : `${name}'s state is not known, so it can't be stopped.`;
  return null;
}
