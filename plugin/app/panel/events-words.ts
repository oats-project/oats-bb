// The words of an instance's recorded lifecycle activity. The OATS Desktop's
// (packages/desktop/renderer/instance-events-view.mjs and instance-events-data.mjs `EVENT_TITLES` at
// awebai/oats 95c7b43b). No bb and no React import.
import type { PanelEvent, PanelEvents } from "../../kernel/panel-events";

export const ACTIVITY = "Reported lifecycle activity";
export const LOAD = "Load activity";
export const REFRESH = "Refresh activity";
export const READING = "Reading reported lifecycle activity…";
export const LOADED = "Reported observation loaded. Runtime state is shown separately.";
export const RECENT = "Recent lifecycle events";
export const NO_EVENTS = "No recorded lifecycle events in this observed window.";
export const PROVENANCE = "Null waiting means unknown, not “not waiting”. Paths and past plans are provenance only; no action is authorized by these events.";

const TITLES: Record<string, string> = {
  spawned: "Spawned", launched: "Launched", restarted: "Restarted", stopped: "Stopped", "stop-refused": "Stop refused", "retire-planned": "Retirement planned", retired: "Retired",
  "worktree-retained": "Worktree retained", "worktree-removed": "Worktree removed", "branch-deleted": "Branch deleted", "child-spawn-refused": "Child spawn refused",
  "launch-prompt": "Launch prompt", recomposed: "Instructions recomposed", waiting: "Waiting claim", "worktree-added": "Worktree added", "modules-upgraded": "Modules upgraded",
  "upgrade-refused": "Module upgrade refused",
};
/** An event's title; a kind this plugin has no title for is named as the kernel names it. */
export const eventTitle = (kind: string): string => (Object.hasOwn(TITLES, kind) ? (TITLES[kind] ?? kind) : `Other reported event (${kind})`);

const INCARNATION: Record<PanelEvent["incarnation"], string> = { current: "Current recorded incarnation", earlier: "Earlier instance at this address", unknown: "Incarnation not reported" };
/** "Producer: kernel · Current recorded incarnation". */
export const producerLine = (event: Pick<PanelEvent, "producer" | "incarnation">): string => `Producer: ${event.producer} · ${INCARNATION[event.incarnation]}`;

const LABELS: Record<string, string> = {
  agent: "Soul", work: "Work mode", branch: "Branch", harness: "Harness", model: "Model", parentInstance: "Parent", relation: "Relation", launched: "Launch reported", backend: "Backend",
  launchConfig: "Launch configuration", phase: "Phase", signal: "Signal", state: "State reported", waitedMs: "Waited (ms)", stillRunningCount: "Targets still running", planRevision: "Plan revision",
  children: "Children", dirty: "Changed work count", keepDir: "Home retained", self: "Self retirement", quarantine: "Quarantine", workRecovery: "Recovery path", movedTo: "Retained path",
  recordedBranch: "Recorded branch", child: "Child", previous: "Previous composition path", soulDir: "Soul path", blocks: "Blocks", waitingOnYou: "Waiting claim", reason: "Reported reason",
  message: "Note", status: "Reported outcome", class: "Prompt class", action: "Launch action", consentSource: "Consent source", claudeVersion: "Claude version", signatureId: "Recognised screen",
  purpose: "Purpose", path: "Path", base: "Base", member: "Member", step: "Failed step",
};

/** An event's facts as label and text, in the kernel's order; a fact with no label of the Desktop's is left out. */
export function eventFacts(event: PanelEvent): { label: string; value: string }[] {
  const facts: { label: string; value: string }[] = [];
  for (const { key, value } of event.facts) {
    if (!Object.hasOwn(LABELS, key)) continue;
    // A waiting claim set (true) or cleared (false), in words.
    facts.push({ label: LABELS[key] ?? key, value: value === null ? "not reported" : key === "waitingOnYou" ? (value ? "claimed" : "cleared") : String(value) });
  }
  if (event.policy !== null) facts.push({ label: "Reported child policy", value: `${event.policy.allowed ? "allowed" : "not allowed"} · ${event.policy.origin}` });
  return facts;
}
/** A `worktree` hook's line in an event's Setup. */
export const setupLine = (hook: { capability: string; ok: boolean }): string => `${hook.capability}: ${hook.ok ? "done" : "failed (continuing)"}`;

/** "8 displayed / 8 observed rows. This is address history, not current runtime state." */
export const windowLine = (events: Pick<PanelEvents, "returned" | "count" | "truncated">): string =>
  `${events.returned} displayed / ${events.count} observed rows${events.truncated ? " · truncated" : ""}. This is address history, not current runtime state.`;

/** Whether what was read is not the whole history. */
export const incomplete = (events: Pick<PanelEvents, "truncated" | "integrity">): boolean =>
  events.truncated || events.integrity.unreadableRows > 0 || events.integrity.foreignRows > 0 || events.integrity.sources.some((source) => source.status === "tail" || source.status === "refused");
/** "Incomplete evidence: 1 unreadable rows · 0 foreign rows · window or source truncated · source refused." */
export const incompleteLine = (events: Pick<PanelEvents, "truncated" | "integrity">): string =>
  `Incomplete evidence: ${events.integrity.unreadableRows} unreadable rows · ${events.integrity.foreignRows} foreign rows${events.truncated ? " · window or source truncated" : ""}${events.integrity.sources.some((source) => source.status === "refused") ? " · source refused" : ""}.`;
/** "home: ok (834 bytes reported) · workspace: ok (834 bytes reported)". */
export const sourcesLine = (events: Pick<PanelEvents, "integrity">): string => events.integrity.sources.map((source) => `${source.path}: ${source.status} (${source.bytes} bytes reported)`).join(" · ");
/** "oats.board: reported waiting · 2026-11-21T18:23:39.829Z · attention". */
export const claimLine = (claim: PanelEvents["waitingClaims"][number]): string => `${claim.producer}: ${claim.waiting ? "reported waiting" : "claim cleared"} · ${claim.since}${claim.reason === null ? "" : ` · ${claim.reason}`}`;

/** The one line over the list: the last event, and what a producer reports of waiting. */
export function summaryLine(events: PanelEvents): string {
  const last = events.events[events.events.length - 1];
  const waiting = events.waitingOnYou;
  const lastPart = last === undefined ? NO_EVENTS : `${eventTitle(last.kind)} · ${last.at} · ${INCARNATION[last.incarnation]}`;
  const waitingPart = waiting === null ? "Waiting on you: unknown" : `Reported waiting: ${waiting.producer} since ${waiting.since}${waiting.message === null ? "" : ` — ${waiting.message}`}`;
  return `${lastPart} · ${waitingPart}`;
}
