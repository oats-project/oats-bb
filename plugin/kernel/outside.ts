// What one row of `oats status --json` says of an agent that something happened to outside OATS:
// how its session ended (`sessionEnd`, feature `session-resume`) and, on a kernel that lists the
// feature `provider-outside-oats` (OATS 0.70.5), that a harness runs in a home an operator stopped
// (`outsideOats`; docs/desktop-cli-api.md, anchor `row-outside-oats`, read at the tag v0.70.5).
//
// No process of its own: this reads the row the plugin's one status read kept, as the kernel
// printed it (server/core.ts `rowsOf`). Nothing is derived from words: `outsideOats` is taken only
// in the kernel's exact shape, on a row that reads as the kernel documents it (stopped, not
// running), and anything else is no report.
import { z } from "zod";

/** The feature of `oats version --json` under which a row may carry `outsideOats`. */
export const OUTSIDE_FEATURE = "provider-outside-oats";
/** The one code the kernel gives the report. */
export const OUTSIDE_CODE = "running-outside-oats";

/** The kernel's report, as it prints it: the three keys, the one code, a one-line message. */
export const outsideOats = z.object({ code: z.literal(OUTSIDE_CODE), backend: z.string().min(1), message: z.string().min(1).max(500) }).strict();
export type OutsideOats = z.output<typeof outsideOats>;

export const outsideRow = z.object({
  instance: z.string(),
  /** `stopped` (an operator's stop), `lost` (the session is gone and OATS did not stop it), `exited`; null where the row has none. */
  sessionEnd: z.string().nullable(),
  /** null: no report (or a kernel without the feature, of which the absence says nothing). */
  outsideOats: outsideOats.nullable(),
});
export type OutsideRow = z.output<typeof outsideRow>;

const row = z.looseObject({
  instance: z.string().min(1),
  backend: z.string().nullish(),
  running: z.boolean().nullish(),
  runtimeState: z.string().nullish(),
  sessionEnd: z.string().nullish(),
});

/**
 * One raw row's facts; null for a row with no `instance`. `feature`: whether the kernel lists
 * `provider-outside-oats`. Without it nothing is read of `outsideOats`, whatever the row holds.
 * With it, the key is a report only in the kernel's own shape, on a provider row OATS recorded
 * stopped (`running: false`, `runtimeState: "stopped"`) whose `backend` is the report's: the rule
 * the kernel itself applies to a relayed row.
 */
export function parseOutsideRow(raw: Readonly<Record<string, unknown>>, feature: boolean): OutsideRow | null {
  const read = row.safeParse(raw);
  if (!read.success) return null;
  const { instance, backend, running, runtimeState, sessionEnd } = read.data;
  let outside: OutsideOats | null = null;
  if (feature && running === false && runtimeState === "stopped") {
    const report = outsideOats.safeParse(raw.outsideOats);
    if (report.success && !/[\r\n]/.test(report.data.message) && report.data.backend === backend) outside = report.data;
  }
  return { instance, sessionEnd: sessionEnd ?? null, outsideOats: outside };
}
