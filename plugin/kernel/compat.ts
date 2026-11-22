// The OATS versions this plugin is built for, in one place: every feature that says whether the
// installed `oats` is one the plugin knows (the home's CLI check; a notice that OATS is older than
// the plugin needs) reads these two, next to the version the kernel answers (`oats version --json`,
// kernel/roster.ts `parseVersion`; `core.versionOf()` on the server).

/** The oldest OATS the plugin works with: its verbs and JSON answers exist from here on. */
export const OATS_FLOOR = "0.70.0";

/**
 * The newest OATS minor the plugin was tested against: the minor of the kernel the real run pins
 * (container/real/run.sh, KERNEL_NPM). A newer minor may work; it has not been run. A test holds
 * that this is the pinned kernel's minor, so that moving the pin moves it.
 */
export const OATS_TESTED_MINOR = "0.70";

/** `major.minor.patch` of a version text as numbers; null for one that is not three numbers (a pre-release suffix is ignored). */
export function versionParts(version: string): [number, number, number] | null {
  const match = /^(\d+)\.(\d+)\.(\d+)/.exec(version.trim());
  return match === null ? null : [Number(match[1]), Number(match[2]), Number(match[3])];
}

/**
 * Where an installed OATS stands: "older" than the floor, "tested" (from the floor up to the tested
 * minor), "newer" than what was tested, or "unknown" for a version that cannot be read.
 */
export function compatibility(version: string | null | undefined): "older" | "tested" | "newer" | "unknown" {
  const have = typeof version === "string" ? versionParts(version) : null;
  const floor = versionParts(OATS_FLOOR)!;
  const tested = versionParts(`${OATS_TESTED_MINOR}.0`)!;
  if (have === null) return "unknown";
  const below = (a: readonly number[], b: readonly number[]) => a[0]! < b[0]! || (a[0] === b[0] && (a[1]! < b[1]! || (a[1] === b[1] && a[2]! < b[2]!)));
  if (below(have, floor)) return "older";
  return have[0]! > tested[0] || (have[0] === tested[0] && have[1]! > tested[1]) ? "newer" : "tested";
}
