// The four read verbs behind the pages: `oats souls`, `oats capabilities`, `oats teams` and
// `oats server list`, each read into the rows the pages draw (docs/desktop-cli-api.md).
import { z } from "zod";
import type { Capability, Machine, Soul, Source, Team, TeamProblem } from "../model/types.js";
import { shaped } from "./envelope.js";
import { ok, type Result } from "./result.js";
import type { Runner } from "./runner.js";

const text = z.string().nullish();

/** The workspace an answer is of: its own repository's key tells its souls and capabilities from a member's. */
const workspace = z.looseObject({ key: text }).nullish();
/**
 * Where a row comes from, as its group's heading: a package with its version ("oats.okf 6.2.0"),
 * "workspace" for the workspace's own repository, else the member repository's name (the last part
 * of its key). Undefined where the kernel names no kind.
 */
function sourceOf(row: { kind?: string | null | undefined; package?: string | null | undefined; version?: string | null | undefined; repoKey?: string | null | undefined }, own: string | null, versioned = true): Source | undefined {
  if (!row.kind) return undefined;
  if (row.kind === "package") return { kind: "package", label: [row.package ?? "package", versioned ? row.version : null].filter(Boolean).join(" ") };
  if (row.repoKey && own !== null && row.repoKey === own) return { kind: row.kind, label: "workspace" };
  return { kind: row.kind, label: row.repoKey?.split("/").filter(Boolean).pop() ?? row.kind };
}

// ---- oats souls --json ----
export const soulsArgv = (): string[] => ["souls", "--json"];

const soulRow = z.looseObject({
  name: z.string().min(1),
  key: text,
  qualifiedName: text,
  package: text,
  origin: text,
  description: text,
  spawnable: z.boolean().nullish(),
  problem: z.looseObject({ code: text, message: text }).nullish(),
  capabilities: z.array(z.looseObject({ name: z.string(), from: text })).nullish(),
  kind: text,
  version: text,
  repoKey: text,
  harness: text,
  model: text,
  teams: z.array(z.looseObject({ label: z.string(), default: z.boolean().nullish() })).nullish(),
  file: z.looseObject({ path: text }).nullish(),
  harnessFrom: text,
  launch: z.looseObject({ at: text }).nullish(),
});
const soulsDocument = z.looseObject({ souls: z.array(soulRow), workspace });

export function parseSouls(document: unknown): Result<{ souls: Soul[] }> {
  const parsed = shaped(soulsDocument, document, "oats souls");
  if (!parsed.ok) return parsed;
  const own = parsed.value.workspace?.key ?? null;
  return ok({
    souls: parsed.value.souls.map((row) => {
      const problem = row.problem ? [row.problem.code, row.problem.message].filter(Boolean).join(": ") : null;
      const source = sourceOf(row, own);
      const why = Object.fromEntries((row.capabilities ?? []).flatMap((capability) => (capability.from ? [[capability.name, capability.from] as const] : [])));
      return {
        // Soul.name is the soul's `key`: what `oats spawn` takes, `<package>/<soul>` for a package soul.
        name: row.key ?? row.qualifiedName ?? row.name,
        // Soul.agent is the name the roster gives this soul's instances, which is Agent.soul
        // (status.ts): the bare name, or for a package soul `<package>--<soul>` with "." written
        // "-" (docs/desktop-cli-api.md, "oats capabilities and oats souls"). The pages match by it.
        agent: row.package ? `${row.package.replaceAll(".", "-")}--${row.name}` : row.name,
        description: row.description ?? "",
        origin: row.origin ?? "",
        capabilities: (row.capabilities ?? []).map((capability) => capability.name),
        // A kernel that does not say is taken at its word for the rest: a spawn it refuses says why.
        spawnable: row.spawnable ?? problem === null,
        problem,
        // The kernel answers `capabilities: null` for a soul it could not resolve (one that cannot be spawned): what it
        // is composed of is then NOT KNOWN, which is not "none".
        ...(row.capabilities === null ? { unresolved: true as const } : {}),
        shortName: row.name,
        ...(row.file?.path ? { file: row.file.path } : {}),
        ...(source === undefined ? {} : { source }),
        ...(row.harness === undefined ? {} : { harness: row.harness }),
        ...(row.model === undefined ? {} : { model: row.model }),
        // Where the choice of harness came from (the kernel's word for it), and the file that makes it.
        ...(row.harnessFrom ? { launchFrom: row.harnessFrom } : {}),
        ...(row.launch?.at ? { launchAt: row.launch.at } : {}),
        // The default first, then the kernel's order.
        ...(row.teams == null ? {} : { teams: [...row.teams].sort((a, b) => Number(b.default === true) - Number(a.default === true)).map((team) => ({ label: team.label, isDefault: team.default === true })) }),
        ...(Object.keys(why).length === 0 ? {} : { why }),
      };
    }),
  });
}

// ---- oats capabilities --json ----
export const capabilitiesArgv = (): string[] => ["capabilities", "--json"];

const capabilitiesDocument = z.looseObject({
  capabilities: z.array(z.looseObject({ name: z.string().min(1), origin: text, description: text, kind: text, package: text, version: text, repoKey: text, layer: text, private: z.boolean().nullish() })),
  workspace,
});

export function parseCapabilities(document: unknown): Result<{ capabilities: Omit<Capability, "souls">[] }> {
  const parsed = shaped(capabilitiesDocument, document, "oats capabilities");
  if (!parsed.ok) return parsed;
  const own = parsed.value.workspace?.key ?? null;
  return ok({
    capabilities: parsed.value.capabilities.map((row) => {
      // (A capability's row says who made it, not at which version: the version is a fact of its own.)
      const source = sourceOf(row, own, false);
      return {
        id: row.name,
        description: row.description ?? "",
        origin: row.origin ?? "",
        ...(source === undefined ? {} : { source }),
        ...(row.version === undefined ? {} : { version: row.version }),
        // Each only where the kernel's answer has the key: an answer with neither says nothing of core places or of who may use it.
        ...(row.layer === undefined ? {} : { layer: row.layer }),
        ...(row.private == null ? {} : { repoOnly: row.private === true }),
      };
    }),
  });
}

/** The number of souls that compose each capability, from the souls' own lists. */
export function withSoulCounts(capabilities: Omit<Capability, "souls">[], souls: Soul[]): Capability[] {
  const counts = new Map<string, number>();
  for (const soul of souls) for (const id of new Set(soul.capabilities)) counts.set(id, (counts.get(id) ?? 0) + 1);
  return capabilities.map((capability) => ({ ...capability, souls: counts.get(capability.id) ?? 0 }));
}

// ---- oats teams --json ----
export const teamsArgv = (): string[] => ["teams", "--json"];

const teamsDocument = z.looseObject({
  teams: z.array(z.looseObject({ label: z.string().min(1), team: text, default: z.boolean().nullish(), description: text, from: text, at: text })),
  // (The answer's `souls` is the workspace's RULES for who joins what, by pattern, as written: `teams` a list or "any",
  // a `default` alone. It is not read: which teams a soul joins is the kernel's to resolve, and `oats souls` answers it
  // per soul, resolved.)
  localTeams: z.boolean().nullish(),
  problems: z.array(z.looseObject({ code: text, label: text, default: z.boolean().nullish(), message: text, fix: text })).nullish(),
});

export type TeamsAnswer = { teams: Team[]; localTeams?: boolean; problems?: TeamProblem[] };

export function parseTeams(document: unknown): Result<TeamsAnswer> {
  const parsed = shaped(teamsDocument, document, "oats teams");
  if (!parsed.ok) return parsed;
  const { localTeams, problems } = parsed.value;
  return ok({
    teams: parsed.value.teams.map((row) => ({
      label: row.label,
      team: row.team ?? null,
      isDefault: row.default === true,
      ...(row.description === undefined ? {} : { description: row.description }),
      ...(row.from == null ? {} : { local: row.from === "local" }),
      ...(row.at === undefined ? {} : { at: row.at }),
    })),
    ...(localTeams == null ? {} : { localTeams }),
    // A problem with no words of the kernel's says nothing a person can read: left out.
    ...(problems == null ? {} : { problems: problems.flatMap((problem) => (problem.message ? [{ code: problem.code ?? null, label: problem.label ?? null, isDefault: problem.default === true, message: problem.message, fix: problem.fix ?? null }] : [])) }),
  });
}

// ---- oats server list --json ----
export const serversArgv = (): string[] => ["server", "list", "--json"];

const serversDocument = z.looseObject({
  servers: z.array(
    z.looseObject({ id: z.string().min(1), sshHost: text, workspace: text, label: text, snapshots: z.number().nullish() }),
  ),
});

/** The registered servers, as the kernel last recorded them. The plugin runs no `oats server check`. */
export function parseServers(document: unknown): Result<{ machines: Machine[] }> {
  const parsed = shaped(serversDocument, document, "oats server list");
  if (!parsed.ok) return parsed;
  return ok({
    machines: parsed.value.servers.map((row) => ({ id: row.id, route: row.sshHost ?? null, isThisMachine: false, label: row.label && row.label !== row.id ? row.label : null, folder: row.workspace ?? null })),
  });
}

/** The four pages' commands. */
export const verbs = (oats: Runner) => ({
  souls: (signal?: AbortSignal): Promise<Result<{ souls: Soul[] }>> => oats.run(soulsArgv(), parseSouls, oats.timeouts.read, signal),
  capabilities: (signal?: AbortSignal): Promise<Result<{ capabilities: Omit<Capability, "souls">[] }>> =>
    oats.run(capabilitiesArgv(), parseCapabilities, oats.timeouts.read, signal),
  teams: (signal?: AbortSignal): Promise<Result<TeamsAnswer>> => oats.run(teamsArgv(), parseTeams, oats.timeouts.read, signal),
  servers: (signal?: AbortSignal): Promise<Result<{ machines: Machine[] }>> => oats.run(serversArgv(), parseServers, oats.timeouts.read, signal),
});
