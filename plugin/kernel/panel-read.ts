// What the panel's parsers share: the tolerant readers of a kernel answer's parts, and the
// capability warnings (`{code, capability, path, message}` in `oats inspect` and `oats readiness`,
// docs/desktop-cli-api.md "Capability warnings").
import { z } from "zod";

export type Row = Record<string, unknown>;
/** An object that is no list; anything else is null. */
export const record = (value: unknown): Row | null => (typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Row) : null);
/** A fact that is text and not empty; anything else is unreported. */
export const text = (value: unknown): string | null => (typeof value === "string" && value !== "" ? value : null);
/** The objects of a list; anything else of it, and a value that is no list, is left out. */
export const rows = (value: unknown): Row[] => (Array.isArray(value) ? value.map(record).filter((row): row is Row => row !== null) : []);

export const panelWarning = z.object({
  code: z.string().nullable(),
  /** the capability the warning is about, when the kernel names one by a capability's name */
  capability: z.string().nullable(),
  path: z.string().nullable(),
  message: z.string(),
});
export type PanelWarning = z.output<typeof panelWarning>;

/** The kernel's capability-name grammar: a warning names its capability only when it is one. */
const CAPABILITY_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

/** A document's `warnings`: the entries with a message, in the kernel's order; none when it has no such list. */
export function warningsOf(value: unknown): PanelWarning[] {
  return rows(value)
    .filter((warning) => text(warning.message) !== null)
    .map((warning) => ({
      code: text(warning.code),
      capability: typeof warning.capability === "string" && CAPABILITY_NAME.test(warning.capability) ? warning.capability : null,
      path: text(warning.path),
      message: warning.message as string,
    }));
}
