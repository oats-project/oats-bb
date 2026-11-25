// What the lifecycle dialogs say: a Stop or a Retire plan as ONE consequence line (and at most one
// more: who else it stops, or what a tick deletes), the facts that are a reason not to confirm, and
// everything else under the dialog's one "Details"; an apply's answer as a result, a start's
// outcome, and every refusal in a person's words, with the kernel's code and text under Details.
// (The text audit of 23 Nov 2026, ruled by the lead: plugin/WORDS.md, "The lifecycle dialogs" and
// "Not kept".) The longer sentences they were cut from are the OATS Desktop's, copied from awebai/oats at 5be291249:
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
import { messageResumes, rest } from "../../model/rest";
import type { Agent } from "../../model/types";
import { agentName, FULL_MODE } from "../ui/words";

export type PlanVerb = "stop" | "retire";
export type RunVerb = "start" | "restart";
export type Verb = PlanVerb | RunVerb;

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const names = (instances: readonly string[]) => instances.map(agentName).join(", ");

// ---- a plan, for review ----

export type PlanView = {
  /**
   * What the dialog says before the act, in view: the act's ONE consequence line, then, second
   * and last, who else is stopped (a safety fact: it stays in view). A stop of an agent with no
   * bb thread has no consequence line: the title says what it does.
   */
  says: string[];
  /** `says[0]` is a warning (a stop on a provider that leaves the thread open): drawn in the warning tone. */
  warns: boolean;
  /** The facts that are a reason not to confirm, set apart: for a stop, an agent in a turn (what the stop cuts); for a retire, a work tree on another branch. Only what is true. */
  attention: string[];
  /** Under Details: everything else the dialog says before the act, as sentences. */
  details: string[];
  /** Under Details: the current state, plain values by label. */
  state: { label: string; value: string }[];
  /** The plan's one tick, when it has one to offer. `deletes`: what it deletes, drawn at the tick, under its label, only while it is ticked. */
  choice: { label: string; checked: boolean; deletes: string | null } | null;
  /** Why the plan cannot be confirmed, naming what mends it; null when it can. */
  blocked: string | null;
  /** The primary button, named for the act. */
  confirm: string;
};

const SESSION = { there: "Running", none: "Not running", unknown: "Unknown (couldn't be checked)" } as const;
/** The same, in a row labelled with an agent's name and not with "Session". */
const SESSION_OF = { there: "Session running", none: "Session not running", unknown: "Session unknown (couldn't be checked)" } as const;
const ambiguous = (instance: string) => `Not included: ${agentName(instance)}.`;

/**
 * What a stop means for the agent's bb thread: ONE function of ONE fact, whether the bb session
 * provider archives the thread of a home it stops. Where it does (the pilot's provider), the
 * dialog's one consequence line says so, and the result says nothing more ("<Name> stopped.").
 * Where it does not, bb's composer stays live under a stopped agent: the warning is the dialog's
 * one line and the result's one line.
 */
export const STOP_ARCHIVES = "Archives its thread.";
export const STOP_LEAVES_THREAD = "A message in its thread starts it outside OATS.";
export const stopThreadLine = (archives: boolean): string => (archives ? STOP_ARCHIVES : STOP_LEAVES_THREAD);
/**
 * The fact, read from the provider's VERSION (the `version` of `oats capabilities show oats.bb
 * --json`, the read the harness list makes): the bb session provider archives the thread at stop
 * from oats-bb v0.4.0 on (fixed by the release lane). The compare is numeric, part by part.
 * Everything that is not known to archive answers false, so that the dialog keeps the sentence
 * that warns ("a message in its thread starts it outside OATS"):
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

/**
 * The Stop dialog's one choice: its children, by name, ONCE: the choice itself says who else is
 * stopped ("Also stop Desktop mockups developer, Harvest knowledge helper", On or Off), and no
 * line beside it says them again. Agents, in the plugin's one word for them.
 */
export const stopChoice = (children: readonly string[]): string => `Also stop ${names(children)}`;
export const RETIRE_CHOICE = "Also delete the worktree";
/** The reason beside Retire when the tick is set for a tree that is not the agent's own (the Desktop's E_OPTION_UNAVAILABLE, naming the tick). */
export const DISCARD_NOT_OWN = `Only an agent with its own worktree can delete it. Untick “${RETIRE_CHOICE}”.`;

/**
 * The ONE fact that is a reason not to stop an agent, as a word after its name, one line per agent:
 * "Redesign ui lead · mid-turn": its thread runs a turn now (bb's own word on the thread: the
 * model's `threadWorks`), which a stop cuts. An agent that is not in a turn has no line (null).
 * Uncommitted work is NOT said of a stop: a stop deletes nothing and the work stays where it is
 * (the lead's read: the box says only what the act affects). A RETIRE says it, at its tick.
 */
export const TURN_FACT = "mid-turn";
export const stopFacts = (instance: string, { turn }: { turn: boolean }): string | null => (turn ? `${agentName(instance)} · ${TURN_FACT}` : null);
/**
 * `archives`: whether the provider archives the thread of a home it stops (`stopArchivesThread`).
 * `working`: the plan's agents whose bb thread runs a turn now. What a person should see before
 * confirming is said from that FACT, never from the plan's `midTask` (reported activity: true
 * for every session that runs, an idle one too): an agent that is not in a turn gets no line,
 * and the state under Details says "Session running" of it already.
 */
export const alsoStops = (instances: readonly string[]): string => `Also stops: ${names(instances)}.`;
export const NOTHING_DELETED = "Nothing is deleted.";
export function stopPlanView(plan: StopPlan, archives = false, working: ReadonlySet<string> = new Set()): PlanView {
  const targets = plan.targets;
  // Who else it stops: the plan's sessions but the agent's own (the title names that one); with the children left
  // out, the ones the plan skipped: they are named ONCE, by the choice.
  const others = targets.filter((target) => target.instance !== plan.instance).map((target) => target.instance);
  const children = others.length > 0 ? others : plan.skipped;
  // An agent on bb has a thread, and a stop does something to it; one with none (tmux) has no line: the title says what Stop does.
  const onBb = targets.some((target) => target.backend === "bb");
  // The tick is offered when the agent has children to include or to leave: a plan with neither has nothing to choose.
  const hasChildren = targets.length > 1 || plan.skipped.length > 0;
  return {
    says: onBb ? [stopThreadLine(archives)] : [],
    warns: onBb && !archives,
    attention: targets.flatMap((target) => stopFacts(target.instance, { turn: working.has(target.instance) }) ?? []),
    details: [NOTHING_DELETED, ...plan.ambiguous.map(ambiguous)],
    // The word is the SESSION's (the Desktop's "Running / Not running"), and says so: the roster's word for the
    // same agent is its state (Working, Idle), and the two side by side read as a contradiction otherwise.
    state: targets.map((target) => ({ label: agentName(target.instance), value: SESSION_OF[target.session] })),
    choice: hasChildren ? { label: stopChoice(children), checked: plan.recursive, deletes: null } : null,
    blocked: null,
    confirm: "Stop",
  };
}

/** A retire's ONE consequence line: there is no way back from it. (That its conversation stays in bb, archived, is the result's to say.) */
export const RETIRE_FOR_GOOD = "This cannot be undone.";
/** In a retire's result, of the thread the provider archived. */
export const RETIRE_ARCHIVED = "Conversation archived in bb.";
/**
 * In the result of a retire that KEPT the home (its cleanup did not finish): the agent can come
 * back with no OATS around it. The line, and under Details the release lane's own words (decided
 * by the release lane, 22 Nov).
 */
export const HOME_KEPT = "Its home was kept: a message in its thread would start it outside OATS.";
export const HOME_KEPT_DETAILS =
  "No status row, no hooks OATS runs for it, no stop by OATS. Where its aweb identity was not released (a team leave waiting for its controller, a retained seat, an alias held), it can send mail as the retired agent.";
export const DELETES_HOME = "Deletes its home.";

/** Whether `work/` is the agent's own tree: the kernel's fact, else (a kernel that does not say) the record's work mode. */
const treeOf = (plan: RetirePlan) => {
  const fact = plan.ownWorktree !== null;
  const own = fact ? plan.ownWorktree === true : plan.workMode === "worktree";
  return { own, unchecked: fact && own && !plan.work.observed, notOwn: fact && !own };
};
/** The worktree's branch as observed, else the one recorded at spawn; null when detached or unknown. */
const branchOf = (plan: RetirePlan) => (plan.work.observed ? plan.work.branch : plan.recordedBranch);
const workText = (plan: RetirePlan) => {
  const { observed, changed, untracked } = plan.work;
  if (!observed) return SESSION.unknown;
  if (changed === 0 && untracked === 0) return "None";
  return [changed > 0 ? `${changed} changed` : null, untracked > 0 ? `${untracked} untracked` : null].filter((part) => part !== null).join(", ");
};

export function retirePlanView(plan: RetirePlan, discardWorktree: boolean): PlanView {
  const tree = treeOf(plan);
  const branch = branchOf(plan);
  const details: string[] = [DELETES_HOME];
  const attention: string[] = [];
  if (tree.notOwn) details.push("It has no worktree of its own, so no worktree is kept or deleted. A tree it links to is not touched.");
  else if (tree.unchecked) {
    if (!discardWorktree) details.push("Keeps its worktree, moved aside, if there is one. It couldn't be checked.");
  } else if (tree.own && !discardWorktree) details.push(`Keeps its worktree, moved aside${branch ? `, on branch ${branch}` : ""}.`);
  // The agent's extra trees (`oats worktree add`): the kernel says of each what the retire does
  // with it. The Desktop does not draw them; the words are the plugin's (WORDS.md).
  let refused: string | null = null;
  for (const extra of plan.extraTrees) {
    const which = `its extra worktree${extra.branch ? ` on ${extra.branch}` : ""}`;
    if (extra.disposition === "retain") details.push(`Keeps its extra worktree${extra.branch ? ` on branch ${extra.branch}` : ""}, moved aside.`);
    else if (extra.disposition === "remove") details.push(`Deletes ${which}.`);
    else if (extra.disposition === "refuse") refused = which;
    else attention.push(`OATS does not say what happens to its extra worktree${extra.branch ? ` on branch ${extra.branch}` : ""}.`);
  }
  if (!tree.notOwn && plan.work.observed && plan.work.drift) {
    attention.push(`The worktree is on ${plan.work.detached ? "a detached commit" : (plan.work.branch ?? "another branch")}, not the branch it was spawned on${plan.recordedBranch ? ` (${plan.recordedBranch})` : ""}.`);
  }
  const state: { label: string; value: string }[] = [{ label: "Session", value: SESSION[plan.session] }];
  if (!tree.notOwn) {
    if (plan.work.observed || tree.own) state.push({ label: "Uncommitted work", value: workText(plan) });
    if (plan.work.observed) state.push({ label: "Branch", value: plan.work.detached ? "Detached" : (plan.work.branch ?? "Unknown") });
  }
  // What the tick deletes, said ONCE, at the tick while it is on: the work a person may not know is there.
  let deletes: string | null = null;
  if (discardWorktree && !tree.notOwn) {
    const n = tree.unchecked || !plan.work.observed ? null : plan.work.changed + plan.work.untracked;
    deletes = n === null ? `Deletes any uncommitted changes too (a copy is saved).${tree.unchecked ? " It couldn't be checked." : ""}` : n > 0 ? `Deletes ${plural(n, "uncommitted change")} too (a copy is saved).` : "Deletes its worktree.";
  }
  const blocked = refused !== null ? `OATS would refuse: remove ${refused} first.` : discardWorktree && !tree.own ? DISCARD_NOT_OWN : null;
  return {
    says: [RETIRE_FOR_GOOD, ...(plan.children.length > 0 ? [alsoStops(plan.children)] : [])],
    warns: false,
    attention,
    details: [...details, ...plan.ambiguous.map(ambiguous)],
    state,
    // Offered for the agent's own tree; it stays while it is ticked, so that it can be undone.
    choice: tree.own || discardWorktree ? { label: RETIRE_CHOICE, checked: discardWorktree, deletes } : null,
    blocked,
    confirm: "Retire",
  };
}

// ---- the dialog's own lines ----

const ACT = { stop: "Stop", retire: "Retire", start: "Start", restart: "Restart" } as const;
/**
 * The dialog's title: the act and the agent, in EVERY state of the dialog: while its plan is read,
 * where it cannot be read, where the agent is gone, and over its result. The agent is the one that
 * was ASKED for (the place that was pressed): a person always sees whom the dialog is about. What
 * guards against another agent's plan is not the title: a plan the kernel answers for another
 * instance, or for none, is REFUSED and never drawn under this name (the Confirm pattern's
 * `about` against `shownFor`).
 */
export function titleOf(verb: Verb, instance: string, settled = false): string {
  // A plan is a question until it is answered: once the dialog has settled (a result, a refusal), the title asks nothing.
  const ask = (verb === "stop" || verb === "retire") && !settled ? "?" : "";
  return `${ACT[verb]} ${agentName(instance)}${ask}`;
}
/** While the plan is read, for the first time, for a choice, or again: the title names the act and the agent. */
export const CHECKING = "Checking…";
/** While the act runs. A person need not wait in the dialog: Close is on, and the result then reaches them through bb's toaster. */
export const applying = (verb: PlanVerb) => (verb === "retire" ? "Retiring…" : "Stopping…");
export const PLAN_STALE = "Something changed since you opened this. Review it and confirm again.";
/**
 * What differs between the plan a person confirmed and the plan as it is now, as sentences: who is
 * in it, whether each session runs; for a retire also its work and
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
        // (Uncommitted work that came or went is no change of a stop: a stop says nothing of it, and deletes nothing.)
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
export const PLAN_CHANGED = "It has changed: read it again.";
export const NOTHING_SHOWN_CHANGED = "Nothing shown differs.";
/** Under a result's Details, of one read a second time. */
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
  /** One press away under Details, with the code: the kernel's own text, and what the result need not say on its face. */
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
  /** The result's first line is a warning (a stop that left the agent's thread open): that line is drawn in the warning tone; the result stays done. */
  warns?: true;
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
  return "Didn't stop";
}
/** A result's rows: only the sessions that did NOT stop (the title says the rest). */
const rowLines = (rows: readonly StoppedRow[]) => rows.filter((row) => !row.ok).map((row) => `${agentName(row.instance)}: ${stoppedRowText(row)}`);
/** Under Details: the kernel's own word on each row, and what still runs in a session that did not stop. */
const quotes = (rows: readonly StoppedRow[]) =>
  rows.flatMap((row) => [...(row.detail === null ? [] : [`${row.instance}: ${row.detail}`]), ...(!row.ok && row.stillRunning !== null ? [`${row.instance}: still running: ${row.stillRunning.join(", ")}`] : [])]);
const under = (...parts: readonly (string | null | false)[]): string | null => parts.filter((part): part is string => typeof part === "string" && part !== "").join("\n") || null;

/**
 * `onBb`: some session of the plan runs on bb, so the result says what the stop means for its
 * thread. `archived`: whether bb shows the thread archived after the stop, where bb answered;
 * else what the confirmation said of it (`stopArchivesThread`).
 */
export function stopOutcome(receipt: StopReceipt, instance: string, onBb = false, archives = false): Outcome {
  const details = under(...quotes(receipt.results), receipt.replayed && REPLAYED);
  if (receipt.ok) {
    const title = receipt.results.length > 1 ? `${receipt.results.length} sessions stopped` : `${agentName(instance)} stopped`;
    // The title is the result. One line more only where the thread was NOT archived: a message there would start it
    // outside OATS. That line is a warning and is drawn in the warning tone, as the dialog's one line was (the
    // specialist's ruling 4 on the dialogs: "dialog's and result's one line; warning tone"); the result itself is done.
    const left = onBb && !archives;
    return { tone: "done", title: `${title}.`, lines: left ? [STOP_LEAVES_THREAD] : [], code: null, details, offers: [], ...(left ? { warns: true } : {}) };
  }
  return { tone: "failed", title: "Not every session stopped", lines: rowLines(receipt.results), code: "E_SESSION_STOP_FAILED", details, offers: ["review"] };
}

export function retireOutcome(receipt: RetireReceipt, plan: RetirePlan): Outcome {
  const name = agentName(receipt.instance);
  if (receipt.deferred) {
    return { tone: "unknown", title: "Retirement accepted", lines: ["Its row in the sidebar shows the result."], code: null, details: under(receipt.replayed && REPLAYED), offers: ["check"] };
  }
  const complete = receipt.removedDir && receipt.incomplete.length === 0;
  // The children, each by its OWN row: one that says it did not stop is never counted as stopped. (The kernel this
  // was written against refuses the whole retire then, E_CHILDREN_RUNNING, and answers no such receipt: the words
  // hold all the same for an answer that says it, since "stopped" is a claim only a row that is `ok` makes.)
  const stopped = receipt.children.filter((child) => child.ok);
  const running = rowLines(receipt.children);
  // The result's lines are the facts a person needs LATER (where the work that was kept is): a step that only says what was asked is not one.
  const lines: string[] = [];
  if (stopped.length > 0) lines.push(`${plural(stopped.length, "child agent")} stopped and kept.`);
  // In view: WHAT was kept, in a few words each. WHERE it is (a whole path) is under the result's Details: a path
  // on the face is long, and breaks in the middle of a word at a phone's width; under Details it stands on a line
  // of its own, with no full stop glued to it, and can be selected whole.
  const where: string[] = [];
  const kept = (what: string, path: string | null) => {
    lines.push(`${what}.`);
    if (path) where.push(`${what}, at:`, path);
  };
  if (!receipt.removedDir) kept("Home folder kept", receipt.retainedHome);
  if (receipt.worktree === "retained") kept("Worktree kept", receipt.movedTo);
  if (receipt.recoveryPath !== null) kept("Recovery copy saved", receipt.recoveryPath);
  // The home is gone: nothing can start the agent again, and its conversation is where it was, archived.
  if (receipt.removedDir && receipt.threadsArchived > 0) lines.push(RETIRE_ARCHIVED);
  // The home was kept (the kernel's answer says so: `removedDir` false): on bb its thread can be unarchived, and a message there starts it.
  // Said apart from the facts, first and in the warning tone (`warning`), with the release lane's words under Details.
  const keptOnBb = !receipt.removedDir && plan.backend === "bb";
  // Under Details: a branch an interrupted spawn left, and what the kernel, or a capability's retire hook, warns of.
  const compensation = receipt.compensation === null ? null : receipt.compensation.deleted ? `Branch ${receipt.compensation.branch} deleted: an interrupted spawn left it, and it held no work.` : `Branch ${receipt.compensation.branch} kept: ${receipt.compensation.reason ?? "no reason given"}`;
  // The agent is retired and a child of it did not stop: the title stays (it is true), the result is NOT done: in the
  // warning tone, each such child in the Stop result's own words for a session that did not stop, with that result's
  // code; the kernel's word on each row is under Details. (No "Review again": that reads the retire's plan anew, and
  // the agent it would be read for is retired. The child is stopped from its own row.)
  if (complete && running.length > 0) {
    return { tone: "unknown", title: `${name} retired.`, lines: [...running, ...lines], code: "E_SESSION_STOP_FAILED", details: under(...quotes(receipt.children), ...where, compensation, ...receipt.warnings, receipt.replayed && REPLAYED), offers: [], warns: true };
  }
  if (complete) return { tone: "done", title: `${name} retired.`, lines, code: null, details: under(...where, compensation, ...receipt.warnings, receipt.replayed && REPLAYED), offers: [] };
  return {
    tone: "failed",
    title: "Retirement didn't finish",
    lines: [...running, ...lines, "Check what was kept before trying again."],
    code: "RETIRE_INCOMPLETE",
    details: under(...quotes(receipt.children.filter((child) => !child.ok)), ...where, compensation, ...receipt.incomplete, ...receipt.warnings, receipt.replayed && REPLAYED),
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
  E_INSTANCE_RETIRING: "An agent in this plan is already being retired.",
  E_CHILDREN_RUNNING: "A child agent wouldn't stop, so nothing was retired. Other children may already have stopped.",
  E_SESSION_STOP_FAILED: "The session didn't stop in time. Nothing was forced.",
  E_WORK_PRESERVATION_FAILED: "Its work couldn't be saved safely, so the home folder is kept. Earlier retirement steps may have run.",
  E_WORK_INSPECTION_FAILED: "Refused: OATS couldn't inspect its home. The home is kept; its session may have stopped.",
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
    ? "Nothing was removed: OATS can't run this home's cleanup. See Details."
    : "OATS couldn't find or read what it needs in this agent's home folder, so nothing was done.";

/** `unconfirmed`: the kernel's own marker that it could not confirm what its act left (`error.details.unconfirmed`). */
export type Refusal = { code: string | null; message: string; unconfirmed?: boolean };
/** The kernel's own line under its name: the first line of its message (the display filter draws it). Nothing for an empty message. Under Details only: a refusal's face is a person's words. */
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
      lines: ["Nothing was changed."],
      code: refusal.code,
      details: refusal.message,
      offers: [],
    };
  }
  const sentence = refusal.code === "E_UNIDENTIFIED_INSTANCE_HOME" ? unidentified(verb) : sentenceOf(refusal.code, LIFECYCLE);
  return { tone: "failed", title: `Couldn't check ${name}`, lines: [sentence, "Nothing was changed."], code: refusal.code, details: refusal.message, offers: ["review"] };
}

/**
 * After the kernel's line, when a RETIRE is refused because a process still works in the home
 * (E_RUNTIME_QUIESCE_FAILED) and the agent runs pi on bb: opening a pi thread makes bb list its
 * models with a pi of its own in the agent's home, which leaves by itself within a minute. The
 * line claims nothing about which process the kernel met (its message is not read): it is true
 * whichever it was, and says the one thing "stop it, then retire again" does not, that waiting
 * is the remedy. Decided from read facts only: the code, the plan's backend, the row's harness.
 */
export const PI_LISTING = "If its thread was just opened, try again in a minute.";
export const piOnBb = (plan: { backend: string | null; harness: string | null }): boolean => plan.backend === "bb" && plan.harness === "pi";

/** Under "Result not confirmed": the one thing a person must not do. */
export const UNCONFIRMED = "Check again before assuming nothing happened.";
export const STILL_RUNNING = "Still running. Check again.";
/** An apply that was refused, or whose answer was lost. */
export function applyRefused(verb: PlanVerb, instance: string, refusal: Refusal, piListing = false): Outcome {
  const name = agentName(instance);
  if (refusal.code !== null && LOST.has(refusal.code)) {
    return { tone: "unknown", title: "Result not confirmed", lines: [UNCONFIRMED], code: refusal.code, details: refusal.message, offers: ["check"] };
  }
  // An act the kernel refused AND marked unconfirmed: it says itself that it cannot tell what is left. The marker
  // means the same whichever act carries it: never "wasn't stopped/retired", whatever the code: not confirmed,
  // with Check again, and OATS's own text under Details (as the New agent form reads the marker).
  if (refusal.unconfirmed === true) {
    return { tone: "unknown", title: "Result not confirmed", lines: [UNCONFIRMED], code: refusal.code, details: refusal.message, offers: ["check"] };
  }
  const sentence = refusal.code === "E_UNIDENTIFIED_INSTANCE_HOME" ? unidentified(verb) : sentenceOf(refusal.code, LIFECYCLE);
  const waits = verb === "retire" && refusal.code === "E_RUNTIME_QUIESCE_FAILED" && piListing; // (the function's own guard: a caller may pass the flag for a stop)
  const lines = waits ? [sentence, PI_LISTING] : [sentence];
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
  return { tone: "unknown", title: "Result not confirmed", lines: [kernels ? STILL_RUNNING : UNCONFIRMED], code: refusal.code, details: refusal.message, offers: ["check"] };
}

/**
 * An outcome as bb's toaster tells it, when the dialog it belonged to is gone (the person left it
 * while the act ran, or opened another). A toast has no Details, no "Check again", no "Review
 * again", no "Refresh status", and it cannot hold a path a person will need later. So there are
 * two kinds:
 * - `plain`: a stop, a start or a restart that is DONE. The toast says its title ("<Name> stopped."),
 *   and its one line where it has one; it leaves by itself.
 * - anything else (a refusal, a result that is not confirmed, an unfinished or a finished RETIRE,
 *   whose lines hold where the worktree and the recovery copy are): the toast says the title, and
 *   first what the dialog sets apart (a home that was kept); it STAYS until dismissed and carries
 *   "Show result", which opens the dialog again on that result, with everything it offers.
 */
export const SHOW_RESULT = "Show result";
/**
 * The notice of an agent whose thread a person archived or deleted in bb while it ran
 * (app/lifecycle/left.ts): bb stopped nothing OATS knows of. Its one button opens the Stop dialog.
 */
export const mayStillRun = (instance: string): string => `${agentName(instance)} may still run.`;
export const MAY_STILL_RUN_ACT = "Stop…";
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
  /** A start's ONE consequence line, on bb and on tmux: a new conversation (on bb in a new thread; the one it had stays in bb, archived). */
  begins: "Starts a new conversation.",
  /** A start of an agent on TMUX that did not finish (the kernel kept its session): it has no thread to open, and the command that attaches is under it. */
  keptOnTmux: "Its session was kept. Refresh status before another try.",
  /**
   * For an agent that was cut off (`carriesOn`): a message in its thread carries its conversation
   * on, which a start does not, and neither does a restart. Said first in both dialogs; the act stays possible.
   */
  carryOn: "To continue its conversation, message it instead.",
  checking: "Checking…",
  /**
   * Beside a restart's line (`begins`), ONLY where the agent is known to work on a turn now (bb's own
   * word on its thread): what a restart cuts. Not said of an idle agent, nor on tmux, where nobody knows.
   */
  restartWarning: "Stops what it is doing now.",
  harness: "Harness",
  model: "Model",
  /** Under Details: the model's choice outlives this start. (Away from the Model field: the line names what is saved.) */
  modelSaved: "The model is saved for later starts too.",
  badModel: "Enter a model name, not a command-line option.",
  refresh: "Refresh status",
  starting: "Starting…",
  restarting: "Restarting…",
  alreadyRunning: "This agent is already running.",
  /**
   * A RESTART is held on a model the person changed unless bb's list for the harness serves it
   * exactly once (model/restart-model.ts: the kernel stops the running session before the provider
   * judges the model). The word, said once: the Model field's mark, which the off button is described by.
   */
  notFound: "Not found",
  pickProvider: "Pick provider",
  required: "Required",
  /** Under the field's Details, only while it says "Not found": the way to a model bb does not list. */
  unlisted: "To use a model bb does not list: stop it, then start it with that model.",
  unknownState: "Could not verify whether this agent is running. Refresh its status before starting.",
} as const;
/**
 * Whether the Start and the Restart dialog say first that a message in the agent's thread carries its
 * conversation on: the plugin's ONE reading of that (`messageResumes`, model/rest.ts), which the
 * home's card and the thread's own line read too. The kernel's row says the agent does not run and
 * that nobody stopped it (its session was lost, or no harness is loaded), and bb has its thread in
 * the sidebar (whatever bb says of its last turn). An operator's stop never gets the line, and neither does a stopped
 * row that does not say how its session ended, or one with no word of the runtime's state.
 * `thread` is bb's own row of it, or null when bb shows none.
 */
export function carriesOn(row: { running: boolean | null; runtimeState: string | null; sessionEnd: string | null }, thread: { status: string } | null): boolean {
  return messageResumes(row, thread);
}

/**
 * The start of a TMUX agent whose session was LOST (the kernel's row: backend tmux, sessionEnd
 * "lost"): `oats session start --resume` brings it back in the harness's own last conversation,
 * where a plain start begins fresh on its task. The words never promise what the kernel may not
 * give: before the press they are conditional; after it they say what the kernel answered.
 */
export const RESUME = {
  /** The dialog's ONE consequence line. Final: the kernel has no preview of a resume for one agent, so nothing more is promised; the result says which happened. */
  tries: "Tries to continue its last conversation; else starts fresh.",
  /** The dialog's one choice for such an agent, off by default: the plain start, on purpose. */
  freshChoice: "Start fresh on its task instead",
  /** Under the choice while it is on. */
  freshWarning: "Its last conversation is not brought back.",
  /** The result's title when the kernel says it continues the conversation: `<Name> is back in its last conversation.` */
  back: "is back in its last conversation.",
  /** The result's title, in the warning tone, when the kernel says it started fresh instead (`<Name> started fresh.`); the kernel's reason is its one line. */
  fresh: "started fresh.",
  /** A harness that asks its person, in its terminal, how to load a long conversation before it goes on: said when it happens. */
  waiting: "Waiting for you in its terminal.",
  /** The kernel refuses to resume with launch settings that changed. The dialog comes back, on Refresh status, with the plain start chosen. */
  envChanged: "Its launch settings changed, so it can only start fresh.",
  notLost: "Its session is no longer lost.",
} as const;

/**
 * What the dialog says a start or a restart does, before the press. A start: ONE line: a new
 * conversation; for a tmux agent whose session was lost, that it tries to continue the last one
 * (and no more: the result says which happened). A restart: that it starts a new conversation,
 * ALWAYS (on bb and on tmux a restart never resumes: the conversation's fate is said before the
 * act, in Start's words); and, first and only where the agent WORKS on a turn now, that it stops
 * what it is doing: two short lines at most.
 */
export function startSays(verb: RunVerb, { resumes, working = false }: { resumes: boolean; working?: boolean }): string[] {
  if (verb === "restart") return [...(working ? [START.restartWarning] : []), START.begins];
  return [resumes ? RESUME.tries : START.begins];
}
/**
 * And under the dialog's Details, as a sentence: on bb, the access it runs with (bb's full mode:
 * said in view where an agent is made, the New agent form, and here one press away).
 */
export function startDetails({ onBb }: { onBb: boolean }): string[] {
  // (On bb the dialog has a Model field: that its choice outlives this start is said here, not under the field: the lead's L9.)
  // (That a restart starts a new conversation is said in view, with the dialog's lines: `startSays`.)
  return onBb ? [START.modelSaved, FULL_MODE] : [];
}
/** Why a resume started fresh, in words, for each reason the kernel names (docs/desktop-cli-api.md, "Resume a lost session"). */
const FRESH_BECAUSE: Readonly<Record<string, string>> = {
  "no-conversation": "Its last conversation was not found.",
  "no-receipts": "OATS has no record of where its harness kept it.",
  "resume-unproven": "OATS cannot bring its conversation back yet.",
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
  const because = reason === null ? [] : Object.hasOwn(FRESH_BECAUSE, reason) ? [FRESH_BECAUSE[reason]!] : oatsSays(reason); // (its own keys only: the reason is any string of the kernel's)
  return { ...done(`${name} ${RESUME.fresh}`, because), attention: true }; // (the reason is the result's one line: here OATS's own word is the result, not a refusal's quote)
}

/** The kernel's codes for a start that started nothing, each with the Desktop's sentence. */
const STARTED_NOTHING: Readonly<Record<string, string>> = {
  E_SESSION_START_BUSY: "OATS refused this start as busy. Nothing was started.",
  E_SESSION_START_LOCK_STUCK:
    "A start lock from an earlier OATS blocks this. Remove it (Details names it).",
  E_SESSION_RUNNING: "This agent is already running. Nothing was started.",
};

/** A start or a restart that was refused, that stopped at a launch prompt, or whose answer was lost. */
export function startRefused(verb: RunVerb, instance: string, refusal: Refusal, tmux = false): Outcome {
  const name = agentName(instance);
  const restart = verb === "restart";
  const nothing = restart ? "Nothing was stopped or started." : "Nothing was started.";
  const act = restart ? "restart" : "start";
  const of = (tone: Outcome["tone"], title: string, lines: string[], offers: Outcome["offers"] = ["refresh"]): Outcome => ({ tone, title, lines, code: refusal.code, details: refusal.message, offers });
  const code = refusal.code;
  // The session is there, and what its start came to is not known: never "failed", never "started".
  // An agent on tmux has no thread to open: the command that attaches to it is under the result.
  if (code === "E_SPAWN_INCOMPLETE") {
    return of("unknown", `OATS could not confirm that ${name} finished starting`, [tmux ? START.keptOnTmux : "Open its thread to read what it shows before starting again."]);
  }
  if (code === "NO_THREAD_NAMED") return of("unknown", `${name} was started, but its thread isn't ready yet`, ["Open it from its row when it is."], []);
  // A start the kernel refused AND marked unconfirmed: it cannot tell what is left, whatever the code. Never
  // "wasn't started": not confirmed, with OATS's own line, and what a result that is not confirmed offers here (Refresh status).
  // ONE code is decided before it, above: E_SPAWN_INCOMPLETE, which the kernel marks too and of which more is
  // known (the session is there). Its sentence is as unsure, says more, and offers the same Refresh status.
  if (refusal.unconfirmed === true) return of("unknown", "Result not confirmed", ["Refresh its status before another try."]);
  // A resume the kernel refused: its session is not lost any more (the row changed after the check), or the
  // launch settings changed since it last ran (the one remedy is a plain start, fresh: the dialog comes back with it chosen).
  if (code === "E_RESUME_NOT_LOST") return of("failed", `${name} wasn't started`, [RESUME.notLost]);
  if (code === "E_LAUNCH_ENV_CHANGED") return of("failed", `${name} wasn't started`, [RESUME.envChanged]); // (OATS's own line is under Details)
  if (code !== null && LOST.has(code)) return of("unknown", "OATS didn't confirm the start", ["It may be running: check its row first."]);
  if (code !== null && STARTED_NOTHING[code] !== undefined) return of("failed", `${name} wasn't ${restart ? "restarted" : "started"}`, [STARTED_NOTHING[code]!]); // (what blocks is named by OATS's message, under Details)
  if (code === "E_INSTANCE_RETIRING") return of("failed", `${name} wasn't ${restart ? "restarted" : "started"}`, [`This agent is being retired, or has cleanup to finish. ${nothing}`]);
  if (code === "E_LIFECYCLE_BUSY") return of("failed", `${name} wasn't ${restart ? "restarted" : "started"}`, [`OATS refused this ${act} as busy. ${nothing}`]);
  if (code === "E_UNIDENTIFIED_INSTANCE_HOME") return of("failed", `${name} wasn't ${restart ? "restarted" : "started"}`, [unidentified(verb)]);
  if (code === "E_BACKEND_HARNESS" || code === "E_UNSUPPORTED_HARNESS") return of("failed", `OATS refused to ${act} ${name} on this harness`, ["Choose another under Harness, or keep the recorded one."]);
  if (code === "E_MODEL_UNKNOWN") return of("failed", `OATS refused to ${act} ${name} with this model`, [`Change it under “${START.model}”, or leave the field blank.`]);
  // Any other answer of the kernel's: a person's words; the kernel's whole message and the code are under Details.
  // What it did is not known for sure (the Desktop reads every other code as uncertain): the status is read again first.
  // A refusal of the plugin's own server (an agent the roster no longer names, a harness the provider does not declare): OATS was not asked.
  if (code === null) return of("failed", `${name} wasn't ${restart ? "restarted" : "started"}`, [NO_CODE]);
  if (TRANSPORT[code] !== undefined) return of("failed", `OATS refused to ${act} ${name}`, [TRANSPORT[code]!]);
  return of("failed", `OATS refused to ${act} ${name}`, ["Refresh its status before another try."]);
}

// ---- an act that cannot run from where it was asked (a key, a command) ----

/**
 * The ONE act for an agent that FAILED, in every place that offers one (the acts, the panel, the
 * thread's menu and line, the keys): never two acts for one need. It ASKS the plugin's one reading
 * of how an agent is at rest (`rest`, model/rest.ts: what the home's card and the dialogs read too),
 * and reads no row of its own:
 * - START where nothing runs: its thread failed at its start ("never-started": it never ran), or
 *   its session ended, was lost, or is stopped. A restart there is a start with a warning about
 *   stopping what is not there; and the Start dialog's own gate takes exactly such a row.
 * - RESTART where it runs, or where nobody can tell ("runs", "unreachable"): the Start dialog's
 *   gate refuses such a row ("already running", or not known).
 * `thread`: bb's own row of the agent's thread where the place has it (it carries bb's word that
 * the thread failed at its start); null where it has none.
 * (Here, in the lifecycle's file with no component: the thread's line reads it without loading the dialogs.)
 */
export function failedAct(agent: Agent, thread: object | null): "start" | "restart" {
  const how = rest(agent, thread);
  return how === "runs" || how === "unreachable" ? "restart" : "start";
}

export const NO_TARGET = "This thread is not an OATS agent's.";
/** Why `verb` cannot act on an agent in this state, in one line; null when it can. `running`: the agent's session is there (working, idle, waiting); `known`: OATS can say. */
export function cannotAct(verb: Verb, instance: string, state: { running: boolean; known: boolean }): string | null {
  const name = agentName(instance);
  if (verb === "start") return state.running ? `${name} is already running.` : state.known ? null : `${name}'s state is not known, so it can't be started.`;
  if (verb === "restart") return state.running || !state.known ? null : `${name} is stopped: Start it instead.`;
  if (verb === "stop") return state.running ? null : state.known ? `${name} can't be stopped now.` : `${name}'s state is not known, so it can't be stopped.`;
  return null;
}
