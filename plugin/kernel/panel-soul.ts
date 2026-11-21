// `oats inspect --home <abs> --json`, read into what the instance panel's Soul tab draws: the soul
// as THIS instance was spawned from it (docs/desktop-cli-api.md "oats inspect"). Its core
// capabilities with why each is there, then every other capability with its source and why, as
// the OATS Desktop reads them (packages/desktop/renderer/instance-soul.mjs and capability-page.mjs
// `coreEntries`, `compositionEntries` at awebai/oats 95c7b43b).
//
// The reasons come from what the kernel reports: `layers.<slot>.from` (feature layers-from) and
// `capabilities[].composedFrom` / `capabilitiesOff[]` (feature desktop-facts). Every kernel the bb
// session provider admits (OATS 0.70.0 and later) has both. A home's `composedFrom` is null, so
// there the reason is read from the soul's own declarations, as the Desktop does.
import { z } from "zod";
import { shaped } from "./envelope.js";
import { checkHome } from "./input.js";
import { ok, type Result } from "./result.js";

/** The three core capabilities (a soul's `layers`), in the order every surface shows them. */
export const CORE_SLOTS = ["knowledge", "messaging", "tasks"] as const;

/** Where a capability comes from: a package at a version, or a member repository at its latest commit. */
export const panelSource = z.object({
  /** `package`, `repo` (a member repository) or `home` (owned by the soul's own repository) */
  kind: z.enum(["package", "repo", "home"]),
  name: z.string(),
  /** a package's version; `latest` for a member repository; null when the kernel says neither */
  version: z.string().nullable(),
});
export const panelCore = z.object({
  slot: z.enum(CORE_SLOTS),
  /** false: the kernel reports no `layers.<slot>` */
  reported: z.boolean(),
  /** the capability that fills the slot; null for an empty one */
  id: z.string().nullable(),
  /** null for an empty slot, and for a provider that is not among the resolved capabilities */
  source: panelSource.nullable(),
  /** why it fills the slot, when the kernel says */
  why: z.enum(["workspace", "soul", "team"]).nullable(),
  team: z.string().nullable(),
});
export const panelCapability = z.object({
  name: z.string(),
  /** `off`: the soul turned a default off; then there is no source */
  why: z.enum(["default", "workspace", "team", "soul", "off"]),
  team: z.string().nullable(),
  /** for `off`: whether the soul emptied a slot (`slot-none`) or turned the capability off, and whose default it was */
  reason: z.enum(["off", "slot-none"]).nullable(),
  overrides: z.string().nullable(),
  source: panelSource.nullable(),
});
export const panelWarning = z.object({
  code: z.string().nullable(),
  capability: z.string().nullable(),
  path: z.string().nullable(),
  message: z.string(),
});
export const panelSoul = z.object({
  /** the soul's name, and the commit the instance was spawned from */
  name: z.string(),
  commit: z.string().nullable(),
  /** the soul's repository, by its label (the last segment of its key) */
  repo: z.string().nullable(),
  /** the labels of the teams the soul may join that are mapped to a provider's team, the default first */
  teams: z.array(z.string()),
  core: z.array(panelCore),
  capabilities: z.array(panelCapability),
  /** every capability the kernel resolved: the count "Modules as spawned" names */
  modules: z.number().int(),
  warnings: z.array(panelWarning),
});
export type PanelSoul = z.output<typeof panelSoul>;
export type PanelSource = z.output<typeof panelSource>;
export type PanelCore = z.output<typeof panelCore>;
export type PanelCapability = z.output<typeof panelCapability>;

export function panelSoulArgv(home: string): Result<string[]> {
  const checked = checkHome(home);
  return checked.ok ? ok(["inspect", "--home", checked.value, "--json"]) : checked;
}

type Row = Record<string, unknown>;
const record = (value: unknown): Row | null => (typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Row) : null);
const text = (value: unknown): string | null => (typeof value === "string" && value !== "" ? value : null);
const rows = (value: unknown): Row[] => (Array.isArray(value) ? value.map(record).filter((row): row is Row => row !== null) : []);
const isSlot = (value: unknown): value is (typeof CORE_SLOTS)[number] => CORE_SLOTS.includes(value as (typeof CORE_SLOTS)[number]);

/** A member's display label from its repository key: its last segment, without `.git`. */
export const memberLabel = (key: string): string =>
  key
    .split("/")
    .filter(Boolean)
    .pop()
    ?.replace(/\.git$/, "") || key;

/** The kernel's capability-name grammar: a warning names its capability only when it is one. */
const CAPABILITY_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

const inspection = z.looseObject({ souls: z.array(z.unknown()) });

function sourceOf(capability: Row, repoOwned: boolean): PanelSource {
  const from = record(capability.from) ?? {};
  const id = text(capability.id) ?? "";
  if (from.kind === "package") return { kind: "package", name: text(from.package) ?? id, version: text(from.version) ?? text(capability.version) };
  const repoKey = text(from.repoKey);
  return { kind: repoOwned ? "home" : "repo", name: repoKey === null ? id : memberLabel(repoKey), version: from.kind === "member" ? "latest" : null };
}

/** `workspace`, `soul` or `team:<label>` as a reason; any other word is no reason. */
function reasonOf(from: unknown): { why: "workspace" | "soul" | "team" | null; team: string | null } {
  if (from === "workspace" || from === "soul") return { why: from, team: null };
  const team = typeof from === "string" ? /^team:(.+)$/.exec(from) : null;
  return team ? { why: "team", team: team[1] ?? null } : { why: null, team: null };
}

const ORDER: Record<PanelCapability["why"], number> = { workspace: 0, default: 0, team: 1, soul: 2, off: 3 };

/**
 * The soul as the instance was spawned from it, or null when the inspection names no soul (the
 * Desktop then shows nothing under the tab's header).
 */
export function parsePanelSoul(document: unknown): Result<PanelSoul | null> {
  const parsed = shaped(inspection, document, "oats inspect");
  if (!parsed.ok) return parsed;
  const inspected = parsed.value as Row;
  const soul = record(parsed.value.souls[0]);
  const name = soul === null ? null : text(soul.name);
  if (soul === null || name === null) return ok(null);

  const capabilities = rows(inspected.capabilities).filter((capability) => text(capability.id) !== null);
  const layers = record(inspected.layers) ?? {};
  const off = Array.isArray(inspected.capabilitiesOff) ? rows(inspected.capabilitiesOff).filter((entry) => text(entry.id) !== null) : null;

  const core: PanelSoul["core"] = CORE_SLOTS.map((slot) => {
    const layer = record(layers[slot]);
    if (layer === null) return { slot, reported: false, id: null, source: null, why: null, team: null };
    const id = text(layer.id);
    if (id === null) return { slot, reported: true, id: null, source: null, why: null, team: null };
    const provider = capabilities.find((capability) => capability.id === id);
    return { slot, reported: true, id, source: provider === undefined ? null : sourceOf(provider, false), ...reasonOf(layer.from) };
  });

  // A core capability is the Core section's: a slot's provider, or a module of a core layer whose
  // slot the kernel reports. A soul emptying a core slot is Core's too.
  const isCore = (capability: Row): boolean =>
    CORE_SLOTS.some((slot) => text(record(layers[slot])?.id) === capability.id) || (isSlot(capability.layer) && record(layers[capability.layer]) !== null);
  const choices = record(record(soul.declarations)?.capabilities) ?? {};
  const kernelSays = capabilities.some((capability) => typeof capability.composedFrom === "string");
  const others: PanelCapability[] = capabilities
    .filter((capability) => !isCore(capability))
    .map((capability) => {
      const id = capability.id as string;
      const own = record(choices[id]);
      const source = sourceOf(capability, own !== null && own.from === "here");
      if (!kernelSays) return { name: id, why: own === null ? "default" : "soul", team: null, reason: null, overrides: null, source };
      const { why, team } = reasonOf(capability.composedFrom);
      return { name: id, why: why ?? "default", team, reason: null, overrides: null, source };
    });
  if (off !== null) {
    for (const entry of off) {
      if (isSlot(entry.slot)) continue;
      others.push({ name: entry.id as string, why: "off", team: null, reason: entry.reason === "slot-none" ? "slot-none" : "off", overrides: text(entry.overrides), source: null });
    }
  } else {
    for (const [id, choice] of Object.entries(choices)) {
      if (choice === "off" && !capabilities.some((capability) => capability.id === id)) others.push({ name: id, why: "off", team: null, reason: "off", overrides: null, source: null });
    }
  }
  const ordered = others
    .map((entry, at) => ({ entry, at }))
    .sort((a, b) => ORDER[a.entry.why] - ORDER[b.entry.why] || a.at - b.at)
    .map(({ entry }) => entry);

  const repoKey = text(soul.repoKey);
  return ok({
    name,
    commit: text(soul.commit),
    repo: repoKey === null ? null : memberLabel(repoKey),
    teams: rows(inspected.teams)
      .filter((team) => text(team.label) !== null && text(team.team) !== null)
      .map((team) => team.label as string),
    core,
    capabilities: ordered,
    modules: capabilities.length,
    warnings: rows(inspected.warnings)
      .filter((warning) => text(warning.message) !== null)
      .map((warning) => ({
        code: text(warning.code),
        capability: typeof warning.capability === "string" && CAPABILITY_NAME.test(warning.capability) ? warning.capability : null,
        path: text(warning.path),
        message: warning.message as string,
      })),
  });
}
