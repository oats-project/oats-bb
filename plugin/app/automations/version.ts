// What this OATS can do for Automations, from the features `oats version --json` lists. The
// Desktop gates the page on the same feature (views/automations.mjs: automationsSupported).
export type OatsVersion = { version: string | null; features: readonly string[]; automationsApi: number | null };

/** The lists and their verbs: feature `automations` (OATS 0.29), automationsApi 1. */
export const automationsSupported = (oats: OatsVersion): boolean => oats.features.includes("automations") && oats.automationsApi === 1;
