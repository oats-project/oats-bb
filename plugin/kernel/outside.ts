// The kernel's report that a harness runs in a provider home OATS recorded stopped: `outsideOats`
// on the home's row of `oats status --json`, on a kernel that lists the feature
// `provider-outside-oats` (OATS 0.70.5; docs/desktop-cli-api.md, anchor `row-outside-oats`, read at
// the tag v0.70.5). A message a person types in the provider's own product (bb's composer) can start
// a stopped session's harness again without OATS: the key says so, and nothing else of the row
// changes. kernel/roster.ts reads it into the plugin's `Agent`.
//
// Nothing is derived from words: the key is a report only in the kernel's exact shape, on a row
// that reads as the kernel documents it (stopped, not running, of that backend), and anything else
// is no report.
import { z } from "zod";

/** The feature of the kernel's `features` under which a row may carry `outsideOats`. */
export const OUTSIDE_FEATURE = "provider-outside-oats";
/** The one code the kernel gives the report. */
export const OUTSIDE_CODE = "running-outside-oats";

/** The kernel's report, as it prints it: the three keys, the one code, a one-line message of at most 500 characters. */
export const outsideOats = z.object({ code: z.literal(OUTSIDE_CODE), backend: z.string().min(1), message: z.string().min(1).max(500) }).strict();
export type OutsideOats = z.output<typeof outsideOats>;

/**
 * The report a row carries, or null. `value` is the row's `outsideOats` as printed; `row` is what
 * the same row says of its session. A report only in the kernel's own shape, with a message of one
 * line, on a provider row OATS recorded stopped (`running: false`, `runtimeState: "stopped"`) whose
 * `backend` is the report's: the rule the kernel itself applies to a relayed row
 * (lib/session-providers.mjs `readOutsideOats`, and the roster's rule for a host's row).
 * The caller reads it only where the kernel lists the feature.
 */
export function readOutsideOats(value: unknown, row: { backend: string | null; running: boolean | null; runtimeState: string | null }): OutsideOats | null {
  if (row.running !== false || row.runtimeState !== "stopped") return null;
  const report = outsideOats.safeParse(value);
  if (!report.success || /[\r\n]/.test(report.data.message) || report.data.backend !== row.backend) return null;
  return report.data;
}
