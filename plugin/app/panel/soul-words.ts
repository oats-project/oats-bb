// The Soul tab's words: the soul as an instance was spawned from it. The OATS Desktop's
// (packages/desktop/renderer/instance-soul.mjs, capability-page.mjs `coreNote`, `whyTag`,
// packages/client/capability-rows.mjs `layerLabel`, soul-inspector.mjs at awebai/oats 95c7b43b).
// No bb and no React import.
import type { PanelCapability, PanelCore, PanelSource } from "../../kernel/panel-soul";

/** The line over an instance's snapshot. */
export const AS_SPAWNED = "As spawned: an instance never changes under itself. A newer soul or module needs a new instance.";
export const NO_OTHER_CAPABILITIES = "No other capabilities: only the core ones.";
export const NO_CAPABILITIES = "No capabilities resolved.";

const LAYERS: Record<PanelCore["slot"], string> = { knowledge: "Knowledge", messaging: "Messaging", tasks: "Tasks" };
/** A core capability's name: Knowledge, Messaging, Tasks. */
export const layerLabel = (slot: PanelCore["slot"]): string => LAYERS[slot];

/** What fills a core slot, when nothing does: "None" for an empty slot, "Not reported" for one the kernel does not report. */
export const emptySlot = (core: PanelCore): string => (core.reported ? "None" : "Not reported");

/** Why a core capability fills its slot, in an instance's words; null when the kernel does not say. */
export function coreNote(core: Pick<PanelCore, "why" | "team">): string | null {
  if (core.why === "workspace") return "Resolved the workspace default at spawn";
  if (core.why === "team" && core.team !== null) return `Resolved the ${core.team} team's default at spawn`;
  if (core.why === "soul") return "Chosen by the soul at spawn";
  return null;
}

/** A version as it is drawn: a commit id (40 hex characters) by its first seven, anything else whole. */
export const shortVersion = (version: string): string => (/^[0-9a-f]{40}$/.test(version) ? version.slice(0, 7) : version);
/** A source in one line: its name, then its version (a commit id short: the whole is the line's title). */
export const sourceText = (source: PanelSource): string => (source.version === null ? source.name : `${source.name} ${shortVersion(source.version)}`);
/** The same with the version whole, for the line's title. */
export const sourceWhole = (source: PanelSource): string => (source.version === null ? source.name : `${source.name} ${source.version}`);
/** What kind of source it is, in a word, for the line's accessible reading. */
export const sourceKind = (source: PanelSource): string => (source.kind === "package" ? "package" : source.kind === "home" ? "the soul's own repository" : "repository");

const overridden = (layer: string | null): string => {
  const team = layer === null ? null : /^team:(.+)$/.exec(layer);
  return team ? `the ${team[1]} team's default` : layer === "workspace" ? "the workspace default" : "a default";
};
/** Why a capability is there: the tag's word and its sentence. */
export function whyTag(capability: PanelCapability): { label: string; title: string } {
  if (capability.why === "team" && capability.team !== null) return { label: `team · ${capability.team}`, title: `A default of the ${capability.team} team` };
  if (capability.why === "off") {
    return capability.reason === "slot-none"
      ? { label: "turned off by soul", title: `This soul empties a core slot, which ${overridden(capability.overrides)} filled with ${capability.name}` }
      : { label: "turned off by soul", title: `This soul turns off ${overridden(capability.overrides)}` };
  }
  if (capability.why === "workspace") return { label: "workspace", title: "A workspace default" };
  if (capability.why === "soul") return { label: "soul", title: "Declared by this soul" };
  return { label: "default", title: "Not declared by this soul: a workspace or team default (the kernel does not say which)" };
}

/** "Spawned from <soul> @ <commit>", the commit by its first seven characters. */
export const spawnedFrom = (soul: { name: string; commit: string | null }): string => `Spawned from ${soul.name}${soul.commit === null ? "" : ` @ ${soul.commit.slice(0, 7)}`}`;
/** The label of the count of modules the instance was spawned with (the Desktop's "Modules as spawned · N", as a labelled fact). */
export const MODULES_AS_SPAWNED = "Modules as spawned";
