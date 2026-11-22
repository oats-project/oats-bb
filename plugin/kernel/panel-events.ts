// `oats instance events <instance> --home <abs> --limit 100 --json`: an instance's recorded
// lifecycle events (docs/desktop-cli-api.md "Events", `eventsApi: 2`), read into what the panel's
// activity list draws. The facts read per kind are the ones the OATS Desktop reads
// (packages/desktop/renderer/instance-events-data.mjs at awebai/oats 95c7b43b). Nothing is inferred:
// this is the address's history as the kernel recorded it, never the current runtime state.
//
// The frame (counts, integrity, each row's time, kind and producer) must have its shape; a fact of
// another type is dropped by itself. Process lists (`stillRunning`) are answered as a count only.
import { z } from "zod";
import { shaped } from "./envelope.js";
import { checkHome, checkInstance } from "./input.js";
import { record, type Row } from "./panel-read.js";
import { ok, type Result } from "./result.js";

/** The rows asked for: the Desktop's window. */
export const EVENTS_LIMIT = 100;

const factValue = z.union([z.string(), z.number(), z.boolean(), z.null()]);
export const panelEvent = z.object({
  at: z.string(),
  kind: z.string(),
  producer: z.string(),
  /** whether the row belongs to the instance now at this address, to an earlier one, or cannot be told */
  incarnation: z.enum(["current", "earlier", "unknown"]),
  /** the row's recorded facts, by the kernel's key, in the order they are shown; null: recorded as not reported */
  facts: z.array(z.object({ key: z.string(), value: factValue })),
  /** a `worktree` hooks' receipt: one entry per hook, with its log file when it is kept */
  setup: z.array(z.object({ capability: z.string(), ok: z.boolean(), log: z.string().nullable() })).nullable(),
  /** a refused child spawn's policy */
  policy: z.object({ allowed: z.boolean(), origin: z.string() }).nullable(),
  /**
   * on a blocked `launch-prompt` row: what the launch's screen differed in from the confirmation the
   * kernel answers. `nearest` is the entry it was compared with, `index` the first differing
   * position, `expected` the kernel's own text from there and `found` what the terminal showed
   * (each at most 40 characters; "" when that text ended).
   */
  differed: z.object({ nearest: z.string(), index: z.number().int(), expected: z.string(), found: z.string() }).nullable(),
});
export const panelEvents = z.object({
  count: z.number().int(),
  returned: z.number().int(),
  truncated: z.boolean(),
  integrity: z.object({
    unreadableRows: z.number().int(),
    foreignRows: z.number().int(),
    sources: z.array(z.object({ path: z.string(), status: z.string(), bytes: z.number().int() })),
  }),
  /** oldest first, as the kernel answers them */
  events: z.array(panelEvent),
  waitingOnYou: z.object({ producer: z.string(), since: z.string(), message: z.string().nullable() }).nullable(),
  waitingClaims: z.array(z.object({ producer: z.string(), waiting: z.boolean(), since: z.string(), reason: z.string().nullable() })),
});
export type PanelEvents = z.output<typeof panelEvents>;
export type PanelEvent = z.output<typeof panelEvent>;

export function panelEventsArgv(instance: string, home: string): Result<string[]> {
  const name = checkInstance(instance);
  if (!name.ok) return name;
  const at = checkHome(home);
  return at.ok ? ok(["instance", "events", name.value, "--home", at.value, "--limit", String(EVENTS_LIMIT), "--json"]) : at;
}

const count = z.number().int().min(0);
const stamp = z.string().min(1);
const claim = z.looseObject({ producer: z.string().min(1), waiting: z.boolean(), since: stamp, reason: z.string().nullish() });
const answer = z.looseObject({
  eventsApi: z.literal(2),
  incarnation: z.string().nullable(),
  count,
  returned: count,
  truncated: z.boolean(),
  integrity: z.looseObject({
    unreadableRows: count,
    foreignRows: count,
    sources: z.array(z.looseObject({ path: z.string(), status: z.string(), bytes: count })),
  }),
  events: z.array(z.looseObject({ at: stamp, kind: z.string().min(1), producer: z.string().min(1), incarnation: z.string().nullish(), data: z.unknown() })),
  waitingOnYou: z.looseObject({ producer: z.string().min(1), since: stamp, message: z.string().nullish() }).nullish(),
  waitingClaims: z.array(claim).nullish(),
});

// The facts each kind records, by type, in the order they are shown.
const STRINGS: Record<string, string[]> = {
  spawned: ["agent", "work", "branch", "model", "parentInstance", "relation"],
  launched: ["backend", "launchConfig"],
  restarted: ["phase", "signal"],
  stopped: ["signal", "state"],
  "stop-refused": ["phase", "signal", "state"],
  "retire-planned": ["planRevision"],
  retired: ["agent", "workRecovery"],
  "worktree-retained": ["movedTo", "branch", "recordedBranch"],
  "worktree-removed": ["branch"],
  "branch-deleted": ["branch"],
  "child-spawn-refused": ["child", "agent"],
  recomposed: ["previous", "soulDir"],
  "launch-prompt": ["status", "class", "action", "consentSource"],
};
const NUMBERS: Record<string, string[]> = { restarted: ["waitedMs"], stopped: ["waitedMs"], "stop-refused": ["waitedMs"], "retire-planned": ["children", "dirty"], recomposed: ["blocks"] };
const BOOLEANS: Record<string, string[]> = { spawned: ["launched"], retired: ["keepDir", "self", "quarantine"] };
/** Facts that are absent, never "not reported", when they are no text. */
const TEXTS: Record<string, string[]> = { "worktree-added": ["purpose", "path", "branch", "base", "member"], "launch-prompt": ["claudeVersion", "signatureId"], "upgrade-refused": ["step"] };
const keysOf = (table: Record<string, string[]>, kind: string): string[] => (Object.hasOwn(table, kind) ? (table[kind] ?? []) : []);

function factsOf(kind: string, data: Row): PanelEvent["facts"] {
  const facts: PanelEvent["facts"] = [];
  const has = (key: string) => Object.hasOwn(data, key);
  for (const key of keysOf(STRINGS, kind)) {
    if (has(key) && (typeof data[key] === "string" || data[key] === null)) facts.push({ key, value: data[key] as string | null });
  }
  if (kind === "spawned" || kind === "launched") {
    // The harness: `harness`, or a released kernel's `runtime`.
    const harness = has("harness") ? data.harness : data.runtime;
    if (typeof harness === "string" || (harness === null && (has("harness") || has("runtime")))) facts.push({ key: "harness", value: harness });
  }
  for (const key of keysOf(NUMBERS, kind)) {
    const value = data[key];
    if (has(key) && ((typeof value === "number" && Number.isSafeInteger(value) && value >= 0) || (key === "dirty" && value === null))) facts.push({ key, value: value as number | null });
  }
  for (const key of [...keysOf(BOOLEANS, kind), "waitingOnYou"]) {
    if (has(key) && typeof data[key] === "boolean") facts.push({ key, value: data[key] as boolean });
  }
  if (has("reason") && (typeof data.reason === "string" || data.reason === null)) facts.push({ key: "reason", value: data.reason });
  for (const key of keysOf(TEXTS, kind)) {
    const value = data[key];
    if (typeof value === "string" && value !== "") facts.push({ key, value });
  }
  if (kind === "waiting" && has("message")) facts.push({ key: "message", value: typeof data.message === "string" && data.message !== "" ? data.message : null });
  if (kind === "stopped" || kind === "stop-refused" || kind === "restarted") {
    // Never the processes themselves: how many were still running.
    if (Array.isArray(data.stillRunning)) facts.push({ key: "stillRunningCount", value: data.stillRunning.length });
  }
  return facts;
}

function setupOf(kind: string, data: Row): PanelEvent["setup"] {
  const hooks = kind === "worktree-added" ? data.hooks : kind === "spawned" ? data.worktreeHooks : undefined;
  if (!Array.isArray(hooks) || hooks.length === 0) return null;
  const out: NonNullable<PanelEvent["setup"]> = [];
  for (const entry of hooks) {
    const hook = record(entry);
    // One malformed entry drops the fact, never the read.
    if (hook === null || typeof hook.ok !== "boolean" || typeof hook.capability !== "string" || hook.capability === "") return null;
    out.push({ capability: hook.capability, ok: hook.ok, log: typeof hook.log === "string" && hook.log !== "" ? hook.log : null });
  }
  return out;
}

function policyOf(kind: string, data: Row): PanelEvent["policy"] {
  const policy = kind === "child-spawn-refused" ? record(data.policy) : null;
  const origin = policy === null ? null : record(policy.origin);
  if (policy === null || origin === null || typeof policy.allowed !== "boolean" || typeof origin.kind !== "string" || origin.kind === "") return null;
  return { allowed: policy.allowed, origin: origin.kind };
}

/** The most of each side of a difference the kernel sends. */
const DIFFERED_UNITS = 40;
/**
 * What a blocked launch's screen differed in (`differed: {nearest, firstDifference: {index,
 * expected, found}}` on the `launch-prompt` row that records the miss). Anything else, in any
 * part, drops this one fact, never the row.
 */
function differedOf(kind: string, data: Row): PanelEvent["differed"] {
  if (kind !== "launch-prompt" || data.status !== "blocked") return null;
  const differed = record(data.differed);
  const first = differed === null ? null : record(differed.firstDifference);
  if (differed === null || first === null || typeof differed.nearest !== "string" || differed.nearest === "" || differed.nearest.length > 256) return null;
  const { index, expected, found } = first;
  if (typeof index !== "number" || !Number.isSafeInteger(index) || index < 0) return null;
  if (typeof expected !== "string" || typeof found !== "string" || expected.length > DIFFERED_UNITS || found.length > DIFFERED_UNITS) return null;
  return { nearest: differed.nearest, index, expected, found };
}

export function parsePanelEvents(document: unknown): Result<PanelEvents> {
  const parsed = shaped(answer, document, "oats instance events");
  if (!parsed.ok) return parsed;
  const value = parsed.value;
  const incarnationOf = (row: string | null | undefined): PanelEvent["incarnation"] =>
    row == null || value.incarnation === null ? "unknown" : row === value.incarnation ? "current" : "earlier";
  return ok({
    count: value.count,
    returned: value.returned,
    truncated: value.truncated,
    integrity: {
      unreadableRows: value.integrity.unreadableRows,
      foreignRows: value.integrity.foreignRows,
      sources: value.integrity.sources.map(({ path, status, bytes }) => ({ path, status, bytes })),
    },
    events: value.events.map((row) => {
      const data = record(row.data) ?? {};
      return { at: row.at, kind: row.kind, producer: row.producer, incarnation: incarnationOf(row.incarnation), facts: factsOf(row.kind, data), setup: setupOf(row.kind, data), policy: policyOf(row.kind, data), differed: differedOf(row.kind, data) };
    }),
    waitingOnYou: value.waitingOnYou ? { producer: value.waitingOnYou.producer, since: value.waitingOnYou.since, message: value.waitingOnYou.message ?? null } : null,
    waitingClaims: (value.waitingClaims ?? []).map(({ producer, waiting, since, reason }) => ({ producer, waiting, since, reason: reason ?? null })),
  });
}
