// The words of the plugin's patterns: the OATS Desktop's, copied whole where a table of the Desktop
// is the same thing (awebai/oats at 95c7b43b3: packages/client/waiting-on-you.mjs `LABELS`,
// `waitingLabel`, `waitingDetail`, `waitedText`, `waitingClock`; packages/client/
// instance-display-name.mjs; packages/desktop/renderer/loading.mjs `observedAgeText`), and the plugin's own where bb's nature changes one (plugin/WORDS.md
// holds each such pair). Pure: no bb, no React, never throws.
import type { AgentState } from "../../model/types";
import { shown } from "./text";

/**
 * A state, as a person reads it and as a screen reader says it. `word` stands beside the mark,
 * always; `name` is the accessible name of the mark where it stands with no word (the Desktop's:
 * "running", "stopped", "status unknown", and "Needs input" for an agent that waits).
 */
export const STATE: Record<AgentState, { word: string; name: string }> = {
  "needs-you": { word: "Needs you", name: "Needs input" },
  working: { word: "Working", name: "running" },
  idle: { word: "Idle", name: "status unknown" },
  stopped: { word: "Stopped", name: "stopped" },
  error: { word: "Failed", name: "failed" },
  unreachable: { word: "Unreachable", name: "unreachable" },
};

/**
 * An instance name as words, for display only: every `-` is a space, a run of them one space, the
 * ends trimmed, and only the first character upper-cased. `oats-expert-maintainer-lanes` reads
 * "Oats expert maintainer lanes". The real name stays wherever it identifies the instance (a title,
 * an accessible name, a copy, the CLI). '' for a non-string or a name with nothing but `-` and spaces.
 */
export function instanceDisplayName(name: unknown): string {
  if (typeof name !== "string") return "";
  const words = name.replace(/-+/g, " ").trim();
  if (!words) return "";
  // The first character by code point, so a name that starts outside the BMP is not split.
  const first = String.fromCodePoint(words.codePointAt(0)!);
  return first.toUpperCase() + words.slice(first.length);
}

export type Claim = { reason: string | null; message: string | null; since: string | null };

const LABELS: Readonly<Record<string, string>> = Object.freeze({
  permission: "Waiting for a tool approval",
  question: "Asked you a question",
  attention: "Asked for your attention",
});
const labelOf = (claim: Claim | null): string | null => (claim !== null && claim.reason !== null && Object.hasOwn(LABELS, claim.reason) ? LABELS[claim.reason]! : null);

/** The reason in words. The raw reason is never drawn: an unknown one reads "Needs input". */
export const waitingLabel = (claim: Claim | null): string => labelOf(claim) ?? "Needs input";
/** What a place that already says "Needs input" adds after it: the message, else the reason in words, else null. */
export const waitingDetail = (claim: Claim | null): string | null => claim?.message ?? labelOf(claim);

/** How long it has waited (floor): "under a minute", "N min", "N h", "N d". A future instant (clock skew) reads "under a minute". */
export function waitedText(since: string, now: number = Date.now()): string {
  const ms = now - Date.parse(since);
  if (!Number.isFinite(ms) || ms < 60_000) return "under a minute";
  const min = Math.floor(ms / 60_000);
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} h`;
  return `${Math.floor(h / 24)} d`;
}

// English copy; a fixed table keeps the date the same everywhere (no locale lookup).
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const pad = (n: number) => String(n).padStart(2, "0");
/**
 * An instant in local time, as precise as it needs to be next to `now`: "14:03" on now's local
 * day, "Oct 2, 14:03" on another day of the same year, "2025-10-02 14:03" in another year; '' when
 * it cannot be read.
 */
export function waitingClock(since: string, now: number = Date.now()): string {
  const at = new Date(since);
  const today = new Date(now);
  if (!Number.isFinite(at.getTime())) return "";
  const time = `${pad(at.getHours())}:${pad(at.getMinutes())}`;
  if (at.getFullYear() !== today.getFullYear()) return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())} ${time}`;
  return at.getMonth() === today.getMonth() && at.getDate() === today.getDate() ? time : `${MONTHS[at.getMonth()]} ${at.getDate()}, ${time}`;
}

/** "waiting 12 min (since 14:03)"; null when the kernel names no instant that can be read. */
export function waitingSince(since: string | null, now: number = Date.now()): string | null {
  if (since === null) return null;
  const clock = waitingClock(since, now);
  return clock === "" ? null : `waiting ${waitedText(since, now)} (since ${clock})`;
}

/**
 * How old a read is, for a place that shows what it read earlier ("Showing what was read <age>."):
 * always relative, in ONE form everywhere: "less than a minute ago", "12 min ago", "3 h ago",
 * "2 d ago" (minutes to the nearest one, hours and days whole). Never a bare clock time, and never "just now": what is
 * shown is from a read that could not be made again, and must not read as fresh (the lead's ruling
 * on the stale state; the Desktop's `observedAgeText` says "just now" and "at 14:05"). null for an
 * instant that cannot be read, and the place then says "Showing what was last read.".
 */
export function readAge(at: string | number, now: number = Date.now()): string | null {
  const then = typeof at === "number" ? at : Date.parse(at);
  if (!Number.isFinite(then)) return null;
  const elapsed = Math.max(0, now - then);
  if (elapsed < 60_000) return "less than a minute ago";
  const minutes = Math.round(elapsed / 60_000);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  return hours < 24 ? `${hours} h ago` : `${Math.floor(hours / 24)} d ago`;
}

/**
 * The Desktop's sentence for content read earlier, the ONE form the age of a kept roster is said
 * in: with its age (`readAge`), or without one when the age is not known.
 */
export const showingRead = (age: string | null): string => (age === null ? "Showing what was last read." : `Showing what was read ${age}.`);

/**
 * Said wherever an agent is launched from bb (the New agent form, the Start and Restart dialogs): the
 * bb session provider launches in bb's full mode only, with no sandbox between the agent and the
 * account bb runs as. There is no control: one line says it before the act.
 */
export const FULL_MODE = "Runs in bb's full mode: no sandbox.";

/**
 * An agent's NAME, the one every place of the plugin draws (a row, the thread's row, a page, a
 * confirmation): its instance name as words (`instanceDisplayName`, the Desktop's rule), through
 * the display filter; the instance itself where that leaves nothing. bb's title for the agent's
 * thread is bb's, never the name. The instance stays where it identifies the agent (a tooltip, a
 * command, the kernel).
 */
export const agentName = (instance: string): string => instanceDisplayName(shown(instance)) || shown(instance);
