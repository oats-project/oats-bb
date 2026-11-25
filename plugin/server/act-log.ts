// THE ACT LOG (P-51): one line in bb's log of the plugin when an act is asked of the kernel, and one
// when it ends; and one for an act that was HELD before the kernel was asked. An ACT is a host verb
// that changes something (`ACTS`, below); a read or a preview is not logged (the roster's read every
// few seconds would bury the acts).
//
// THE LINE, a contract for whoever reads the log (README.md, "The act log"): one act, one line,
// `key=value` separated by one space, in this order:
//   oats act <verb> asked <subject> caller=<c> host=<h> at=<iso>
//   oats act <verb> ended <subject> caller=<c> host=<h> at=<iso> result=ok ms=<n> [homes=<ok>/<all>] [made=<instance>]
//   oats act <verb> ended <subject> caller=<c> host=<h> at=<iso> result=<CODE> ms=<n>
//   oats act <verb> held  <subject> caller=<c> host=<h> at=<iso> result=HELD:<code> why=<words>
// <subject>: `instance=<name>`; for a spawn `soul=<soul> name=<name asked, or ->`; for an automation
// `automation=<kind>:<id>`; for the scheduler `scheduler=-`.
// <c>: what bb says of who asked: `client` (a window of bb) or `plugin:<id>` (another plugin). bb
// has no person to name: it is one person's.  <h>: bb's id of the machine `oats` ran on.
// `result`: `ok`; or the kernel's CODE for a refusal (never its sentence); or `FAILED` for an act
// that ended with no code. `HELD:<code>`: the plugin's own guard refused before the kernel was asked
// (the roster could not be read: its code; `invalid`: what was asked names nothing the roster or the
// provider holds), and `why` says which guard, in the plugin's own words.
//
// WHAT NEVER GOES IN: a spawn's opening instruction, a description's text, a message, a path, the
// kernel's sentence, a secret. Every value is one word: whatever is not a letter, a digit or one of
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
  retirePlan: "a plan: it changes nothing (not retryable because its revision must be the one the person saw)",
  automationTest: "a test: it changes nothing in the deployment (it may run a capability's source command, only on a confirmed press)",
};
export const isAct = (verb: string): verb is Act => (ACTS as readonly string[]).includes(verb);

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

export type Ending = { result: "ok"; ms: number; homes?: string; made?: string } | { result: string; ms: number };
/** The line of one moment of an act. */
export function actLine(verb: Act, phase: "asked" | "ended" | "held", subject: Subject, who: { caller: string; host: string | null; at: string }, more: Ending | { held: string; why: string } | null = null): string {
  const head = `oats act ${verb} ${phase} ${subjectOf(subject)} caller=${who.caller} host=${who.host === null ? "-" : word(who.host)} at=${who.at}`;
  if (more === null) return head;
  if ("held" in more) return `${head} result=HELD:${word(more.held)} why=${word(more.why)}`;
  const extra = "homes" in more && more.homes !== undefined ? ` homes=${word(more.homes)}` : "";
  const made = "made" in more && more.made !== undefined ? ` made=${word(more.made)}` : "";
  return `${head} result=${more.result === "ok" ? "ok" : word(more.result)} ms=${Math.max(0, Math.round(more.ms))}${extra}${made}`;
}
