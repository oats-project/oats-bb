// The words of an instance's recorded lifecycle activity. The OATS Desktop's
// (packages/desktop/renderer/instance-events-view.mjs and instance-events-data.mjs `EVENT_TITLES` at
// awebai/oats 95c7b43b). Every line here is composed from parts of the kernel's that went through
// the display filter one by one, as the Desktop does: the line itself is not filtered again, so a
// name that ends in "token" before the plugin's own ": " withholds nothing but itself. No bb and
// no React import.
import type { PanelEvent, PanelEvents } from "../../kernel/panel-events";
import { shown } from "../ui/text";
import { whenText } from "./words";

export const ACTIVITY = "Activity";
export const LOAD = "Load";
export const REFRESH = "Refresh";
export const READING = "Reading…";
/** In a person's words, over the kernel's own sentence for the same thing (plugin/WORDS.md). */
export const HISTORY_PLAIN = "What OATS recorded about this agent, newest first. It is history, not what the agent does now.";
export const PROVENANCE_PLAIN = "Reading this starts nothing and allows nothing.";
export const RECENT = "Events";
export const NO_EVENTS = "No events";

const TITLES: Record<string, string> = {
  spawned: "Spawned", launched: "Launched", restarted: "Restarted", stopped: "Stopped", "stop-refused": "Stop refused", "retire-planned": "Retirement planned", retired: "Retired",
  "worktree-retained": "Worktree retained", "worktree-removed": "Worktree removed", "branch-deleted": "Branch deleted", "child-spawn-refused": "Child spawn refused",
  "launch-prompt": "Launch prompt", recomposed: "Instructions recomposed", waiting: "Waiting claim", "worktree-added": "Worktree added", "modules-upgraded": "Modules upgraded",
  "upgrade-refused": "Module upgrade refused",
};
/** An event's title; a kind this plugin has no title for is named as the kernel names it. */
export const eventTitle = (kind: string): string => (Object.hasOwn(TITLES, kind) ? (TITLES[kind] ?? shown(kind)) : `Other reported event (${shown(kind)})`);

const INCARNATION: Record<PanelEvent["incarnation"], string> = { current: "Current recorded incarnation", earlier: "Earlier instance at this address", unknown: "Incarnation not reported" };
/** "Producer: kernel · Current recorded incarnation". */
export const producerLine = (event: Pick<PanelEvent, "producer" | "incarnation">): string => `Producer: ${shown(event.producer)} · ${INCARNATION[event.incarnation]}`;

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
    facts.push({ label: LABELS[key] ?? key, value: value === null ? "not reported" : key === "waitingOnYou" ? (value ? "claimed" : "cleared") : shown(String(value)) });
  }
  if (event.policy !== null) facts.push({ label: "Reported child policy", value: `${event.policy.allowed ? "allowed" : "not allowed"} · ${shown(event.policy.origin)}` });
  return facts;
}
/** A `worktree` hook's line in an event's Setup. */
export const setupLine = (hook: { capability: string; ok: boolean }): string => `${shown(hook.capability)}: ${hook.ok ? "done" : "failed (continuing)"}`;

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
export const sourcesLine = (events: Pick<PanelEvents, "integrity">): string => events.integrity.sources.map((source) => `${shown(source.path)}: ${shown(source.status)} (${source.bytes} bytes reported)`).join(" · ");
/**
 * The one line over the list: the last recorded event. The Desktop's line also says what a
 * producer reported of waiting when the log was read ("Reported waiting: …", "Waiting on you:
 * unknown"); here what an agent waits for has one place, the panel's header and Needs input, read
 * from the roster as it is now, so the summary never says another thing under it (plugin/WORDS.md).
 */
export function summaryLine(events: PanelEvents, now: number): string {
  const last = events.events[events.events.length - 1];
  // What it is, in words: the newest row of the record, not what the agent does now. Which incarnation it is of is the row's to say.
  return last === undefined ? NO_EVENTS : `${eventTitle(last.kind)} · ${whenText(last.at, now)}`;
}

// ---- what a blocked launch's screen differed in
export const DIFFERED_LEAD_IN = "Where the screen first differed from the confirmation OATS answers:";
const NO_TEXT = "(no visible text)";
/**
 * What differed, for the row of a blocked launch: the lead-in, then the kernel's own text and what
 * the terminal showed, each under the words that say whose text it is (a side with nothing to
 * show says so), and the entry it was compared with and the position.
 */
export function differedLines(differed: NonNullable<PanelEvent["differed"]>): { leadIn: string; lines: { leadIn: string; text: string }[]; detail: string } {
  const side = (leadIn: string, text: string) => ({ leadIn, text: shown(text) === "" ? NO_TEXT : shown(text) });
  return {
    leadIn: DIFFERED_LEAD_IN,
    lines: [side("OATS expected:", differed.expected), side("The terminal showed:", differed.found)],
    detail: `Nearest entry ${shown(differed.nearest)}, first difference at ${differed.index}`,
  };
}
