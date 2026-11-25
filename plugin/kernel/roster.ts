// `oats status --json`: the roster, read into the plugin's Agent rows (the interface agreed with the
// kernel side, v3). Unknown fields are ignored; a row with no `instance` fails the whole read.
import { z } from "zod";
import type { Agent } from "../model/types.js";
import { shaped } from "./envelope.js";
import { OUTSIDE_FEATURE, readOutsideOats } from "./outside.js";
import { parseRosterEvents, ROSTER_EVENTS_TIMEOUT_MS, rosterEventsArgv, type RosterEvents } from "./roster-events.js";
import { ok, type Result } from "./result.js";
import type { Runner } from "./runner.js";

export const statusArgv = (): string[] => ["status", "--json"];

const text = z.string().nullish();
const row = z.looseObject({
  instance: z.string().min(1),
  agent: text,
  home: z.string().min(1),
  parentInstance: text,
  attributedHuman: text,
  identity: z.looseObject({ alias: text, team: text, address: text }).nullish(),
  identityAddress: text,
  capabilityMeta: z.record(z.string(), z.unknown()).nullish(),
  backend: text,
  session: z.looseObject({ threadId: text }).nullish(),
  running: z.boolean().nullish(),
  runtimeState: text,
  runtimeError: text,
  startedAt: text,
  waitingOnYou: z.looseObject({ since: text, reason: text, message: text }).nullish(),
  sessionEnd: text,
  // Read with its own schema, only where the kernel lists the feature (kernel/outside.ts): a key of another shape is no report, never a failed read.
  outsideOats: z.unknown().optional(),
});
const roster = z.looseObject({
  root: z.string(),
  agents: z.array(z.looseObject({ name: z.string().min(1), instances: z.array(row) })),
  workspace: z.looseObject({ key: text }).nullish(),
  // This kernel's own list, as `oats version --json` answers it (docs/desktop-cli-api.md: feature `server-probe-features`, OATS 0.49.0).
  features: z.array(z.string()).nullish(),
});

/**
 * The bb thread a status row is joined by: `session.threadId`. The one place that reads it, since
 * the kernel side may still move it.
 */
function threadIdOf(source: z.output<typeof row>): string | null {
  return source.session?.threadId ?? null;
}

const identityMeta = z.looseObject({ alias: text, team: text });

/**
 * `rows[n]` is what the kernel printed for `agents[n]`, whole, as `oats status --json` printed it:
 * its own `row`, and the row of its `agent` group (the soul's: name, key, description) without the
 * group's instances. A feature that draws more than `Agent` holds reads it there with a schema of
 * its own (the server keeps the rows beside the snapshot), so nobody runs a second `oats status`.
 */
export type RawRow = { row: Record<string, unknown>; agent: Record<string, unknown> };
export type Status = { root: string; workspace: string | null; agents: Agent[]; rows: RawRow[] };

function toAgent(group: { name: string }, source: z.output<typeof row>, features: readonly string[]): Agent {
  // The messaging identity: the row's own `identity`, else what a messaging capability recorded.
  let alias = source.identity?.alias ?? null;
  let team = source.identity?.team ?? null;
  if (alias === null) {
    for (const meta of Object.values(source.capabilityMeta ?? {})) {
      const parsed = identityMeta.safeParse(meta);
      if (parsed.success && parsed.data.alias) {
        alias = parsed.data.alias;
        team = parsed.data.team ?? team;
        break;
      }
    }
  }
  const waiting = source.waitingOnYou ?? null;
  return {
    instance: source.instance,
    // Agent.soul is the row's `agent`, the roster's name for the soul (the group's name for a row
    // that has none). Soul.agent (pages.ts) is the same name, computed from the soul's row.
    soul: source.agent ?? group.name,
    home: source.home,
    parent: source.parentInstance ?? null,
    human: source.attributedHuman ?? null,
    alias,
    team,
    address: source.identityAddress ?? source.identity?.address ?? null,
    // A row of a kernel that names no backend is a tmux home: tmux was the only one.
    backend: source.backend ?? "tmux",
    // A status row carries the thread id alone (interface v3): the server and the project are on
    // `oats session inspect` and on a launched spawn's answer, which nothing here draws.
    server: null,
    projectId: null,
    threadId: threadIdOf(source),
    running: source.running ?? null,
    runtimeState: source.runtimeState ?? null,
    runtimeError: source.runtimeError ?? null,
    // The last start OATS made, where the kernel's row says it (a row of a kernel that does not is left without).
    ...(source.startedAt ? { startedAt: source.startedAt } : {}),
    // How the session ended, and the kernel's report of a harness that runs in a home it recorded
    // stopped: each only where the row has it. The report is read only where the document's own
    // `features` lists `provider-outside-oats`: on a kernel without it nothing is said of it.
    ...(source.sessionEnd ? { sessionEnd: source.sessionEnd } : {}),
    ...outsideOf(source, features),
    waiting: waiting
      ? { reason: waiting.reason ?? "attention", message: waiting.message ?? null, since: waiting.since ?? null }
      : null,
  };
}

function outsideOf(source: z.output<typeof row>, features: readonly string[]): { outsideOats?: NonNullable<Agent["outsideOats"]> } {
  if (!features.includes(OUTSIDE_FEATURE)) return {};
  const report = readOutsideOats(source.outsideOats, { backend: source.backend ?? null, running: source.running ?? null, runtimeState: source.runtimeState ?? null });
  return report === null ? {} : { outsideOats: report };
}

/** The roster's instances, in the kernel's order. */
export function parseStatus(document: unknown): Result<Status> {
  const parsed = shaped(roster, document, "oats status");
  if (!parsed.ok) return parsed;
  const agents: Agent[] = [];
  const rows: RawRow[] = [];
  for (const group of parsed.value.agents) {
    const { instances, ...agent } = group;
    for (const source of instances) {
      agents.push(toAgent(group, source, parsed.value.features ?? []));
      rows.push({ row: source, agent });
    }
  }
  return ok({ root: parsed.value.root, workspace: parsed.value.workspace?.key ?? null, agents, rows });
}

// ---- oats version --json ----
export const versionArgv = (): string[] => ["version", "--json"];

const versionDocument = z.looseObject({
  version: z.string().min(1),
  desktopApi: z.number().nullish(),
  features: z.array(z.string()).nullish(),
  harnesses: z.array(z.string()).nullish(),
  sessionBackends: z.array(z.string()).nullish(),
});

/**
 * The kernel on this machine: its release, the version of its JSON answers, what it says it can do
 * (`features`), and the version of each of its answers that has one (`apis`: every `<name>Api`
 * number it prints, `desktopApi` and `automationsApi` among them). `harnesses` and `sessionBackends` are the
 * kernel's own lists: the harnesses it launches itself and the session backends it has with no capability (tmux):
 * what a spawn that is not a bb thread may name (kernel/spawn.ts). A kernel that prints neither has none to offer.
 */
export type Version = { version: string; desktopApi: number | null; features: string[]; apis: Record<string, number>; harnesses: string[]; sessionBackends: string[] };

export function parseVersion(document: unknown): Result<Version> {
  const parsed = shaped(versionDocument, document, "oats version");
  if (!parsed.ok) return parsed;
  const apis: Record<string, number> = {};
  for (const [name, value] of Object.entries(parsed.value)) if (name.endsWith("Api") && typeof value === "number") apis[name] = value;
  // A kernel that lists no features has none the plugin may rely on.
  return ok({ version: parsed.value.version, desktopApi: parsed.value.desktopApi ?? null, features: parsed.value.features ?? [], apis, harnesses: parsed.value.harnesses ?? [], sessionBackends: parsed.value.sessionBackends ?? [] });
}

/** The roster's commands, and the one read of the kernel's version that every feature shares. */
export const verbs = (oats: Runner) => ({
  /** `oats instance events <instance> --home <abs> --since <iso> --limit 50 --json`: what one instance's events say since a status read (kernel/roster-events.ts). */
  rosterEvents: async (instance: string, home: string, since: string, signal?: AbortSignal): Promise<Result<RosterEvents>> => {
    const argv = rosterEventsArgv(instance, home, since);
    return argv.ok ? oats.run(argv, parseRosterEvents, ROSTER_EVENTS_TIMEOUT_MS, signal) : argv;
  },
  version: (signal?: AbortSignal): Promise<Result<Version>> => oats.run(versionArgv(), parseVersion, oats.timeouts.read, signal),
  status: (signal?: AbortSignal): Promise<Result<Status>> => oats.run(statusArgv(), parseStatus, oats.timeouts.read, signal),
});
