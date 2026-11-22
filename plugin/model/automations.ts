// What the Automations kernel adapter and the app both say of a trigger's event: its source's
// name, its label and its kind in words. Pure, like everything in model/: no bb, no React.
import { DETAIL_WITHHELD, displayLine } from "../app/ui/text.js";

export const PULL_REQUEST = "github.pull_request";

const record = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * A trigger event's name for display: its `subject`, else its `number`, as `#42` only for a
 * pull-request source (`source`: the list row's `on.source`; a status row carries no `on`); else
 * its `key`; else null. Never "#null".
 */
export function eventLabel(entry: unknown, source: string | null): string | null {
  if (!record(entry)) return null;
  const name = displayLine(entry.subject) ?? (Number.isSafeInteger(entry.number) && (entry.number as number) > 0 ? String(entry.number) : null);
  if (name !== null) return source === PULL_REQUEST && name !== DETAIL_WITHHELD ? `#${name}` : name;
  return displayLine(entry.key);
}
/** An event kind in words ("ready for review"). */
export const eventWords = (value: unknown): string | null => displayLine(value)?.replace(/_/g, " ") ?? null;

/** The kernel's rule for a summary: one line of up to 200 characters (code points), no control character. Empty removes it. */
export const DESCRIPTION_MAX = 200;
export const descriptionValid = (value: string): boolean => [...value].length <= DESCRIPTION_MAX && !/[\p{Cc}\u2028\u2029]/u.test(value);
export const DESCRIPTION_RULE = `A summary is one line of up to ${DESCRIPTION_MAX} characters, without control characters.`;

// ---- the schedule form ----
/** The harnesses a schedule may name, as the Desktop's form lists them. */
export const HARNESSES: readonly string[] = ["pi", "claude", "codex"];
/** The form's Repeat presets, in the Desktop's order (views/schedules.mjs); any other cron is "Custom cron". */
export const REPEATS: readonly (readonly [string, string])[] = [
  ["*/15 * * * *", "Every 15 minutes"],
  ["*/5 * * * *", "Every 5 minutes"],
  ["*/30 * * * *", "Every 30 minutes"],
  ["0 * * * *", "Every hour"],
  ["0 9 * * *", "Daily at 09:00"],
  ["0 9 * * 1-5", "Weekdays at 09:00"],
];
/** The Repeat presets of a recurring wake-up (wake-schedule-fields.mjs). */
export const WAKE_REPEATS: readonly (readonly [string, string])[] = [
  ["*/5 * * * *", "Every 5 minutes"],
  ["*/15 * * * *", "Every 15 minutes"],
  ["*/30 * * * *", "Every 30 minutes"],
  ["0 * * * *", "Every hour"],
];
export const CUSTOM = "custom";
export const DEFAULT_CRON = "*/15 * * * *";
/** The Repeat choice that stands for a cron: its preset, else Custom cron. */
export const repeatOf = (cron: string, presets: readonly (readonly [string, string])[]): string => (presets.some(([value]) => value === cron) ? cron : CUSTOM);

// ---- a recurring wake-up, as a form holds it ----
/** The wake-up group's fields: off until asked for. */
export type WakeDraft = { enabled: boolean; cron: string; tz: string; message: string };
export const newWake = (tz: string): WakeDraft => ({ enabled: false, cron: DEFAULT_CRON, tz, message: "" });
/** The Desktop's refusal of a wake-up that lacks one of its three parts. */
export const WAKE_INCOMPLETE = "Specify the wake schedule, time zone, and message";
/**
 * What the group asks for: nothing when it is off, the wake (cron and time zone trimmed, the
 * message as typed) when it is whole, else the Desktop's sentence.
 */
export function wakeOf(draft: WakeDraft): { ok: true; wake: { cron: string; tz: string; message: string; enabled: true } | undefined } | { ok: false; error: string } {
  if (!draft.enabled) return { ok: true, wake: undefined };
  const cron = draft.cron.trim();
  const tz = draft.tz.trim();
  if (draft.message.trim() === "" || cron === "" || tz === "") return { ok: false, error: WAKE_INCOMPLETE };
  return { ok: true, wake: { cron, tz, message: draft.message, enabled: true } };
}
