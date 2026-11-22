// The words of an instance's or a soul's readiness. The OATS Desktop's
// (packages/desktop/renderer/readiness-view.mjs, packages/client/launch-view.mjs `declaredIn` at
// awebai/oats 95c7b43b). Every line here is composed from parts of the kernel's that went through
// the display filter one by one: the line itself is not filtered again. No bb and no React import.
import type { PanelReadiness, PanelReadinessItem } from "../../kernel/panel-readiness";
import { shown } from "../ui/text";

export const TITLE = { instance: "Instance readiness", soul: "Soul readiness" } as const;
export const REFRESH = "Refresh readiness";
export const REFRESHING = "Refreshing…";
export const UPDATED = "Readiness updated";
export const LOADING = "Loading readiness…";
export const NOT_PERMISSION = "Independent kernel observations, not launch permission. Unknown is not granted; an empty required set is not Ready.";
export const CHECKS_AND_POLICY = "Checks and policy";
export const NO_ITEMS = "No items reported for this check.";
export const VIEW_POLICY = "View policy";
export const POLICY_NOTE = "Lifecycle authority, not an OS sandbox.";

/** The one line that says whether it is ready. */
export function summaryLine(summary: PanelReadiness["summary"]): string {
  if (summary.ready) return "Ready — every required check passes or is not applicable.";
  if (summary.required === 0) return "Readiness not established — no required checks reported.";
  return `${summary.fail} failing · ${summary.unknown} unknown · ${summary.required} required checks`;
}
/** "Observed: <instant>. Target: instance. This is not an atomic snapshot or a permission lease." */
export const observedLine = (at: string | null, of: "instance" | "soul"): string => `${at === null ? "Observed." : `Observed: ${shown(at)}.`} Target: ${of}. This is not an atomic snapshot or a permission lease.`;
/** What was observed, over the checks: "Instance: <instance> · <agents root>" or "Soul: <soul> · <agents root>". */
export const contextLine = (of: "instance" | "soul", name: string, agentsRoot: string): string => `${of === "soul" ? "Soul" : "Instance"}: ${shown(name)} · ${shown(agentsRoot)}`;

const signIn = (item: PanelReadinessItem): boolean => item.provider?.status === "authorization-required";
/** A check's state as it is drawn: one failing only because providers need a sign-in is its own state, not broken. */
export function checkState(check: PanelReadiness["checks"][number]): string {
  const failing = check.items.filter((item) => item.status === "fail");
  return check.status === "fail" && failing.length > 0 && failing.every(signIn) ? "sign in needed" : shown(check.status);
}
/** "Installed", "Configured", "Member", "Providers". */
export const checkLabel = (key: string): string => key.charAt(0).toUpperCase() + key.slice(1);

/** "oats.core · pass · required · 2 warnings". */
export function itemLine(item: PanelReadinessItem): string {
  const warned = item.provider?.warnings.length ?? 0;
  return `${shown(item.subject)} · ${signIn(item) ? "sign in needed" : shown(item.status)} · ${item.required ? "required" : "optional"}${warned === 0 ? "" : ` · ${warned} warning${warned === 1 ? "" : "s"}`}`;
}

/** Where something is declared (the kernel's `at`), in words: "oats-local.yaml › teams › eng, on this computer". */
export function declaredIn(at: string): string {
  const parts = /^(?:(.+):)?([^:#/][^:#]*)#\/(.+)$/.exec(at);
  if (parts === null) return at;
  const where = `${parts[2]} › ${parts[3]!.split("/").map((part) => part.replace(/~1/g, "/").replace(/~0/g, "~")).join(" › ")}`;
  const pkg = /^package:(.+)$/.exec(parts[1] ?? "");
  return pkg ? `${where}, in the ${pkg[1]} package` : parts[1] ? `${where}, in ${parts[1]}` : `${where}, on this computer`;
}

/** An item's facts as label and text, in the Desktop's order; a fact the kernel does not report is left out. */
export function itemFacts(item: PanelReadinessItem): { label: string; value: string }[] {
  const facts: [string, string | null][] = [
    ["Producer", item.producer],
    ["Reason", item.reason],
    ["Code", item.code],
    ["Declared in", item.at === null ? null : declaredIn(item.at)],
    ["Configuration file", item.file],
    ...item.evidence.map((fact): [string, string] => [fact.name, fact.value]),
    ["Remedy (display only)", item.remedy],
  ];
  const out = facts.filter((fact): fact is [string, string] => fact[1] !== null).map(([label, value]) => ({ label: shown(label), value: shown(value) }));
  // The kernel's reason is the first problem's message: said once, with its code.
  for (const problem of [...(item.provider?.problems ?? []), ...item.problems]) {
    if (problem.message === item.reason && problem.code !== null) out.push({ label: "Problem code", value: shown(problem.code) });
  }
  return out;
}
/** The problems that say more than the item's reason: "<message> (<code>)". */
export const itemProblems = (item: PanelReadinessItem): string[] =>
  [...(item.provider?.problems ?? []), ...item.problems].filter((problem) => problem.message !== item.reason).map((problem) => `${shown(problem.message)}${problem.code === null ? "" : ` (${shown(problem.code)})`}`);

const PROVIDER_SAYS: Record<string, string> = {
  ready: "The provider says: ready.",
  "needs-configuration": "The provider says: needs configuration.",
  "authorization-required": "Sign in needed: the provider is set up but is not signed in.",
  unavailable: "The provider says: unavailable right now.",
};
/** A provider's own answer to its binding check, as it gave it. */
export const providerSays = (status: string): string => (Object.hasOwn(PROVIDER_SAYS, status) ? (PROVIDER_SAYS[status] ?? "") : `The provider answered: ${shown(status)}.`);
/** "Warning: <message> (<code>)". */
export const warningLine = (warning: { code: string | null; message: string }): string => `Warning: ${shown(warning.message)}${warning.code === null ? "" : ` (${shown(warning.code)})`}`;

/** "Child spawns: allowed · enforced · default: no spawn option: children allowed". */
export function policyLine(policy: NonNullable<PanelReadiness["policy"]>[number]): string {
  const what = policy.key === "childSpawns" ? "Child spawns" : policy.key === "worktrees" ? "Worktrees" : shown(policy.key);
  const allowed = policy.allowed === null ? "unknown" : policy.allowed ? "allowed" : "not allowed";
  return `${what}: ${allowed} · ${policy.enforced ? "enforced" : "advisory, not enforced"} · ${shown(policy.origin)}${policy.detail === null ? "" : `: ${shown(policy.detail)}`}${policy.mode === null ? "" : ` · mode ${shown(policy.mode)}`}`;
}
