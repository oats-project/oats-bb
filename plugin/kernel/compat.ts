// The OATS versions this plugin is built for, in one place: every feature that says whether the
// installed `oats` is one the plugin knows (the home's CLI check; a notice that OATS is older than
// the plugin needs) reads these two, next to the version the kernel answers (`oats version --json`,
// kernel/roster.ts `parseVersion`; `core.versionOf()` on the server).

/**
 * The oldest OATS the plugin works with: its verbs and JSON answers exist from here on. It is the
 * floor of the bb session provider it ships beside (`compatibility.oats` of oats-package/'s two
 * manifests), and never above the minor of the kernel the real run pins: a test holds both.
 */
export const OATS_FLOOR = "0.70.5";

/**
 * The newest OATS minor the plugin was tested against: the minor of the kernel the real run pins
 * (container/real/run.sh, KERNEL_NPM). A newer minor may work; it has not been run. A test holds
 * that this is the pinned kernel's minor, so that moving the pin moves it.
 */
export const OATS_TESTED_MINOR = "0.70";

/** The version of the kernel's JSON answers (`desktopApi`) the plugin reads: a kernel that prints a higher one may answer in a shape the plugin does not know. */
export const DESKTOP_API = 1;

/** `major.minor.patch` of a version text as numbers; null for one that is not three numbers (a pre-release suffix is ignored). */
export function versionParts(version: string): [number, number, number] | null {
  const match = /^(\d+)\.(\d+)\.(\d+)/.exec(version.trim());
  return match === null ? null : [Number(match[1]), Number(match[2]), Number(match[3])];
}

/** Whether version `a` is below version `b`, each as `versionParts` gives it. */
export const below = (a: readonly number[], b: readonly number[]): boolean => a[0]! < b[0]! || (a[0] === b[0] && (a[1]! < b[1]! || (a[1] === b[1] && a[2]! < b[2]!)));

/**
 * Where an installed OATS stands: "older" than the floor, "tested" (from the floor up to the tested
 * minor), "newer" than what was tested, or "unknown" for a version that cannot be read.
 */
export function compatibility(version: string | null | undefined): "older" | "tested" | "newer" | "unknown" {
  const have = typeof version === "string" ? versionParts(version) : null;
  const floor = versionParts(OATS_FLOOR)!;
  const tested = versionParts(`${OATS_TESTED_MINOR}.0`)!;
  if (have === null) return "unknown";
  if (below(have, floor)) return "older";
  return have[0]! > tested[0] || (have[0] === tested[0] && have[1]! > tested[1]) ? "newer" : "tested";
}

/**
 * Where the kernel on the machine stands, from what `oats version --json` answered (`Version`,
 * kernel/roster.ts): as `compatibility` says of its release, but "newer-api" first when its JSON
 * answers are of a later version than the plugin reads (`desktopApi` above DESKTOP_API): that is
 * the one a place must say most plainly.
 */
export function compat(version: { version: string; desktopApi: number | null } | null | undefined): "older" | "tested" | "newer" | "newer-api" | "unknown" {
  if (version === null || version === undefined) return "unknown";
  if (version.desktopApi !== null && version.desktopApi > DESKTOP_API) return "newer-api";
  return compatibility(version.version);
}
