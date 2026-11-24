// Automations' kernel adapter, as the rest of the plugin imports it: the reads
// (kernel/automations-read.ts: the lists, a trigger's status, and the parsers of a row that the
// acts share) and the acts (kernel/automations-acts.ts, which imports the reads). This module
// only joins the two, so neither of them imports the other back.
import { verbs as actVerbs } from "./automations-acts.js";
import { verbs as readVerbs } from "./automations-read.js";
import type { Runner } from "./runner.js";

export * from "./automations-read.js";

/** Automations' commands: the reads and the acts. */
export const verbs = (oats: Runner) => ({ ...actVerbs(oats), ...readVerbs(oats) });
