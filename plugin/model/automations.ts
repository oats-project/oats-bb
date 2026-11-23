// What the Automations kernel adapter and the app both say of a trigger's event: its source's
// name, its label and its kind in words. Pure, like everything in model/: no bb, no React.
import { DETAIL_WITHHELD, displayLine } from "./text.js";

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
