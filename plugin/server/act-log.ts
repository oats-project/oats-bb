// THE ACT LOG (P-51): one line in bb's log of the plugin when an act is asked of the kernel, and one
// when it ends; and one for an act that was HELD before the kernel was asked. An ACT is a host verb
// that changes something (`ACTS`, below; and a test that RUNS a command: `ACTS_BY_ARGUMENT`); a read or a preview is not logged (the roster's read every
// few seconds would bury the acts).
//
// THE LINE, a contract for whoever reads the log (README.md, "The act log"): one act, one line,
// `key=value` separated by one space, in this order:
//   oats act <verb> asked <subject> caller=<c> host=<h> at=<iso> n=<k>
//   oats act <verb> ended <subject> caller=<c> host=<h> at=<iso> n=<k> result=ok ms=<n> [homes=<ok>/<all>] [made=<instance>]
//   oats act <verb> ended <subject> caller=<c> host=<h> at=<iso> n=<k> result=INCOMPLETE ms=<n> [homes=<ok>/<all>] [code=<CODE>]
//   oats act <verb> ended <subject> caller=<c> host=<h> at=<iso> n=<k> result=DEFERRED ms=<n> homes=<ok>/<all>
//   oats act <verb> ended <subject> caller=<c> host=<h> at=<iso> n=<k> result=<CODE> ms=<n>
//   oats act <verb> held  <subject> caller=<c> host=<h> at=<iso> n=<k> result=HELD:<code> why=<words>
// <subject>: `instance=<name>`; for a spawn `soul=<soul> name=<name asked, or ->`; for an automation
// `automation=<kind>:<id>`; for the scheduler `scheduler=-`.
// <c>: what bb says of who asked: `plugin:<id>` (another plugin), or `client`: everything else: the
// app's window, the `bb` CLI, an agent that calls bb, bb itself: bb tells them apart no further, and
// has no person to name (a bb is one person's).  <h>: bb's id of the machine the kernel was asked on:
// the SAME on an act's "asked" and "ended" (the one it was sent to); `-` on a hold (no machine was asked).
// <k>: the act's number in this run of the plugin's server: the lines of ONE act carry the same, so
// two acts on one agent at once can be told apart. It starts again with each run of the server; an
// "asked" with no "ended" under its number means the server ended while the act ran.
// "asked" means SENT to the machine that runs `oats`.
// `result`, of an act that was sent: `ok`: the kernel did what was asked; `INCOMPLETE`: the kernel
// answered, and its answer says that what was asked was not achieved, or not wholly (`outcomeOf`,
// below: the table, act by act); `DEFERRED`: a retire the kernel accepted and finishes in the
// background: not done yet; or a CODE: one that starts `E_` is the kernel's refusal (never its
// sentence); any other is the plugin's own (kernel/result.ts): `INVALID_INPUT`, `OATS_NOT_FOUND`:
// no `oats` ran (the host entry refused what was asked; the binary is not there); every other
// (`OATS_TIMEOUT`, `OATS_ABORTED`, `OATS_FAILED`, `OATS_NOT_JSON`, `OATS_BAD_ANSWER`, …,
// `HOST_UNREACHABLE`): sent, and the act's outcome is NOT KNOWN (the command may have run);
// `FAILED`: it ended with no code. `homes`: of a stop, the homes its receipt says do not run after it (stopped
// by it, or idle already), of those it names; of a retire, the children the same way and the
// retired agent with them (counted as done only once its home is gone). `made`: the instance a
// spawn made, or a schedule's run launched. `code`: the kernel's code on a run that did not launch.
// `ms`: from the moment the act was sent.
// `HELD:<code>`: the kernel was NOT asked: the plugin's own guard refused (`invalid`: what was asked
// names nothing the roster or the provider holds; a kernel CODE: a read the act rests on was
// refused; `error`: the guard itself failed), or the act could not be sent (its code). `why` is ONE
// word of a closed list (`HOLD_REASONS`, below), never a message.
//
// WHAT NEVER GOES IN: a spawn's opening instruction, a description's text, a message, a path, the
// kernel's sentence, the plugin's own refusal's message, a secret. Every value is one word: whatever is not a letter, a digit or one of
// `._:/@-` becomes `_`, and it is cut at 120 characters.
import { hostContract } from "../contract/index.js";

/** The host verbs that are ACTS: they change something in the deployment. Every other verb is a read (or a preview, a plan, a test). */
export const ACTS = ["start", "restart", "stopApply", "retireApply", "spawn", "automationEnable", "scheduleRun", "automationDescribe", "scheduleRemove", "scheduleReconcile", "schedulerEnable"] as const satisfies readonly (keyof typeof hostContract)[];
export type Act = (typeof ACTS)[number];
/**
 * The verbs the contract does NOT mark as reads (`experimental_retryable`) and that are no act, each with why: a new
 * verb that is not a read is an act (it goes into `ACTS`, and through `core.act`) or is named here with its reason
 * (test/server/act-log.test.ts holds the three lists against the contract).
 */
export const NOT_ACTS: Readonly<Record<string, string>> = {
  watch: "it starts the watch on the deployment's files: it runs no `oats`",
  retirePlan: "a plan: it retires nothing; it is not retryable because each retire plan appends one `retire-planned` event to the workspace log (contract/lifecycle.ts): a record of a read, which the kernel keeps itself",
};
/**
 * The verbs that are an act BY THEIR ARGUMENT, and which argument: `automationTest` with `runSource: true` RUNS a
 * capability's source command on the machine, on a person's confirmed press: that is an act (logged, through
 * `core.act`); without it a test reads and changes nothing: a read (`core.call`).
 */
export const ACTS_BY_ARGUMENT = { automationTest: (input: unknown): boolean => (input as { runSource?: unknown } | null)?.runSource === true } as const satisfies Partial<Record<keyof typeof hostContract, (input: unknown) => boolean>>;
/** A verb `core.act` carries: an act, or one that is an act by its argument. */
export type ActVerb = Act | keyof typeof ACTS_BY_ARGUMENT;
/** Whether asking `verb` with this input is an act. */
export const isAct = (verb: string, input?: unknown): boolean => (ACTS as readonly string[]).includes(verb) || (Object.hasOwn(ACTS_BY_ARGUMENT, verb) && ACTS_BY_ARGUMENT[verb as keyof typeof ACTS_BY_ARGUMENT](input));

/**
 * WHY an act was held: ONE word of this closed list, never a message: a refusal's message quotes what a caller sent
 * (a name, a harness) and may hold a path, and the line's rule is that neither reaches the log. A guard of an act
 * names its word where it refuses (`invalid(message, reason)` in server/core.ts: the message is the window's, the
 * word the log's); the last five are the act's own (server/core.ts `act`). A new guard adds its word here and to the
 * README's list; a word no guard uses is taken out (test/server/act-log.test.ts holds both).
 */
export const HOLD_REASONS = [
  "agent-not-in-roster", // the agent, or a spawn's relative, is not one the roster names now
  "harness-not-declared", // a harness the bb session provider does not declare
  "resume-not-tmux", // a resume asked of a home that is not on tmux, or with a harness or a model
  "choice-not-bb", // a harness or a model chosen for a home that is not on bb
  "soul-not-listed", // a spawn's soul that `oats souls` does not list
  "spawn-input", // what a spawn names (its model) that is refused before any process
  "key-reused", // a spawn's key that belongs to another spawn
  "row-gone", // an automation's row that the list does not hold
  "no-source", // a test asked to run a source the trigger has none of
  "read-refused", // a read the act rests on was refused (the roster, a row's list, the provider, a spawn's decision): `result=HELD:<its code>` says which
  "machine-not-reached", // the act could not be sent: no machine, no deployment
  "cancelled-before-sent", // the act's call was cancelled before it left
  "fault", // the guard itself failed, with no refusal
  "refused", // a refusal of the plugin's that names no word
] as const;
export type HoldReason = (typeof HOLD_REASONS)[number];

/** Who an act is about. */
export type Subject = { instance: string } | { soul: string; name: string | null } | { automation: string } | { scheduler: true };
/** What bb says of who asked (the second argument of every handler). */
export type Asker = { readonly experimental_caller?: { readonly kind: "client" } | { readonly kind: "plugin"; readonly pluginId: string } | undefined };

/** One word of a line: nothing that could end the value, break the line or carry a sentence whole. */
export const word = (value: string): string => value.replace(/[^A-Za-z0-9._:/@-]+/g, "_").slice(0, 120) || "-";

const subjectOf = (subject: Subject): string =>
  "instance" in subject ? `instance=${word(subject.instance)}` : "soul" in subject ? `soul=${word(subject.soul)} name=${subject.name === null ? "-" : word(subject.name)}` : "automation" in subject ? `automation=${word(subject.automation)}` : "scheduler=-";
export const callerOf = (asker: Asker | undefined): string => {
  const caller = asker?.experimental_caller;
  return caller === undefined ? "unknown" : caller.kind === "plugin" ? `plugin:${word(caller.pluginId)}` : "client";
};

/** The outcomes of a schedule's run that say an agent was launched, or its wake delivered: what "Run now" asks for. */
const RAN = new Set(["launched", "active", "running", "delivered"]);

/**
 * What the kernel's ANSWER to an act says, for its "ended" line. THE RULE: the line never says more than the window
 * says of the same answer (app/lifecycle/words.ts, app/automations/acts.tsx and words.ts): an answer the window words
 * as not done, not yet, failed or unknown is never `ok` (test/server/act-log.test.ts holds the two together). The
 * table, one case per act (README, "The act log"):
 * - start, restart: the kernel started it: `ok` (a start that resumed nothing started fresh: done).
 * - stopApply: every home its receipt names does not run after it (stopped, or idle already) and the receipt says ok:
 *   `ok`; a row that did not stop, a receipt that is not ok, or one that names NO home: INCOMPLETE. `homes`.
 * - retireApply: DEFERRED where the kernel only accepted it (it finishes in the background); INCOMPLETE where the home
 *   is still there, something is left undone, or a child did not stop; else `ok`. `homes`: the children, and the
 *   retired agent once its home is gone.
 * - spawn: a new agent: `ok`, `made`.
 * - automationEnable, automationDescribe, scheduleRemove: the kernel did it: `ok`.
 * - scheduleRun: a run that launched an agent or delivered its wake: `ok` (`made`: the run's instance); no run, or any
 *   other outcome (launch failed, unknown, skipped, stopped, ended, …): INCOMPLETE, with the run's own `code`.
 * - scheduleReconcile: a run's state that is still unknown: INCOMPLETE; else `ok` (a state, or none said: the window
 *   says "checked").
 * - schedulerEnable: the timer is installed, active and not said to be unregistered for this deployment (the
 *   window's `schedulerOn`: a kernel that does not say `registered` is not held against it): `ok`; else INCOMPLETE.
 * - automationTest (one that runs its source): the test, or its source's poll, says not ok: INCOMPLETE; else `ok`
 *   (a test that names no source says nothing against it).
 * A new act has no case here until it is given one: the switch is exhaustive (typecheck), and a test asks every act.
 */
export function outcomeOf(verb: ActVerb, value: unknown): { result: "ok" | "INCOMPLETE" | "DEFERRED"; homes?: string; made?: string; code?: string } {
  const answer = (typeof value === "object" && value !== null ? value : {}) as Record<string, unknown>;
  const stopped = (rows: unknown[]) => rows.filter((row) => (row as { ok?: unknown } | null)?.ok === true).length;
  const done = (ok: boolean): { result: "ok" | "INCOMPLETE" } => ({ result: ok ? "ok" : "INCOMPLETE" });
  switch (verb) {
    case "start":
    case "restart":
    case "automationEnable":
    case "automationDescribe":
    case "scheduleRemove":
      return { result: "ok" };
    case "spawn":
      return { result: "ok", ...(typeof answer.instance === "string" ? { made: answer.instance } : {}) };
    case "stopApply": {
      const rows = Array.isArray(answer.results) ? answer.results : [];
      const ok = stopped(rows);
      return { ...done(answer.ok !== false && rows.length > 0 && ok === rows.length), homes: `${ok}/${rows.length}` };
    }
    case "retireApply": {
      const children = Array.isArray(answer.children) ? answer.children : [];
      const ok = stopped(children);
      const gone = answer.removedDir === true && answer.deferred !== true;
      const left = !gone || (Array.isArray(answer.incomplete) && answer.incomplete.length > 0) || ok < children.length;
      return { result: answer.deferred === true ? "DEFERRED" : left ? "INCOMPLETE" : "ok", homes: `${ok + (gone ? 1 : 0)}/${children.length + 1}` };
    }
    case "scheduleRun": {
      const run = (typeof answer.run === "object" && answer.run !== null ? answer.run : null) as { outcome?: unknown; errorCode?: unknown; instance?: unknown } | null;
      const ran = run !== null && typeof run.outcome === "string" && RAN.has(run.outcome);
      return { ...done(ran), ...(ran && typeof run?.instance === "string" ? { made: run.instance } : {}), ...(!ran && typeof run?.errorCode === "string" ? { code: run.errorCode } : {}) };
    }
    case "scheduleReconcile":
      return done(answer.reconciled !== "unknown");
    case "schedulerEnable": {
      const scheduler = (typeof answer.scheduler === "object" && answer.scheduler !== null ? answer.scheduler : {}) as { installed?: unknown; active?: unknown; registered?: unknown };
      return done(scheduler.installed === true && scheduler.active === true && scheduler.registered !== false);
    }
    case "automationTest":
      return done(answer.ok !== false && (answer.source as { ok?: unknown } | null | undefined)?.ok !== false);
    default: {
      const never: never = verb;
      return never;
    }
  }
}

export type Ending = { result: string; ms: number; homes?: string; made?: string; code?: string };
/** The line of one moment of an act. */
export function actLine(verb: ActVerb, phase: "asked" | "ended" | "held", subject: Subject, who: { caller: string; host: string | null; at: string; n: number }, more: Ending | { held: string; why: HoldReason } | null = null): string {
  const head = `oats act ${verb} ${phase} ${subjectOf(subject)} caller=${who.caller} host=${who.host === null ? "-" : word(who.host)} at=${who.at} n=${who.n}`;
  if (more === null) return head;
  // (`why` is a word of the closed list: one that is not, whatever handed it, is written as the list's fallback.)
  if ("held" in more) return `${head} result=HELD:${word(more.held)} why=${(HOLD_REASONS as readonly string[]).includes(more.why) ? more.why : "refused"}`;
  const extra = more.homes !== undefined ? ` homes=${word(more.homes)}` : "";
  const made = more.made !== undefined ? ` made=${word(more.made)}` : "";
  const code = more.code !== undefined ? ` code=${word(more.code)}` : "";
  return `${head} result=${word(more.result)} ms=${Math.max(0, Math.round(more.ms))}${extra}${made}${code}`;
}
