// What this OATS can do for Automations, from the features `oats version --json` lists. The
// Desktop gates the same things on the same features (views/automations.mjs: automationsSupported,
// automationDescriptionsSupported; automation-rows.mjs: triggerSourcesSupported).
export type OatsVersion = { version: string | null; features: readonly string[]; automationsApi: number | null };

/** The lists and their verbs: feature `automations` (OATS 0.29), automationsApi 1. */
export const automationsSupported = (oats: OatsVersion): boolean => oats.features.includes("automations") && oats.automationsApi === 1;
/** A summary can be written: feature `automation-descriptions` (OATS 0.43). */
export const descriptionsSupported = (oats: OatsVersion): boolean => automationsSupported(oats) && oats.features.includes("automation-descriptions");
/** A trigger may watch a capability's source: feature `trigger-sources` (OATS 0.50). */
export const triggerSourcesSupported = (oats: OatsVersion): boolean => automationsSupported(oats) && oats.features.includes("trigger-sources");
