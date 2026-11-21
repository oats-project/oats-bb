// One instance's row of `oats status --json`, read into the facts the instance panel's Instance tab
// and the Soul tab's header draw. They are the roster row's own (docs/desktop-cli-api.md "The
// roster"), the ones the OATS Desktop's instance panel reads
// (packages/desktop/renderer/context-panel.mjs at awebai/oats 95c7b43b): nothing is inferred, and a
// fact the row does not report is null.
//
// No process of its own: the plugin runs one `oats status` for everyone, and this reads the row
// that read kept, as the kernel printed it. The read is tolerant where the Desktop's is: only the
// row's `instance` and `home` and the roster's `root` must be there; a fact of another type is
// unreported.
import { z } from "zod";
import { shaped } from "./envelope.js";
import type { Result } from "./result.js";

/** One capability of the instance that is no longer what it was spawned with, as the kernel reports it. */
export const panelModuleDrift = z.object({
  /** null: the row names no capability ("A capability") */
  name: z.string().nullable(),
  /** the kernel's word other than `current`: `moved`, `missing`, or one this plugin does not know */
  status: z.string(),
  /** the version it was spawned with, and the version now */
  was: z.string().nullable(),
  now: z.string().nullable(),
  reason: z.string().nullable(),
});

export const panelInstance = z.object({
  instance: z.string(),
  /** the roster's name for the soul: the row's `agent`, else its group's name */
  soul: z.string(),
  /** the soul's description, from the roster's agent row */
  description: z.string().nullable(),
  /** the roster's `root`: `<deployment>/agents` */
  agentsRoot: z.string(),
  home: z.string(),
  running: z.boolean().nullable(),
  runtimeState: z.string().nullable(),
  runtimeError: z.string().nullable(),
  /** the last session start, and the spawn */
  startedAt: z.string().nullable(),
  createdAt: z.string().nullable(),
  /** the soul's status when it is not `current`, and each module whose status is not `current` */
  drift: z.object({ soul: z.string().nullable(), modules: z.array(panelModuleDrift) }),
  /** the work mode: `worktree`, `checkout`, `attached`, `directory`, `workspace`, or another word */
  work: z.string().nullable(),
  /** the last segment of the row's `repo`, else of the deployment directory */
  repo: z.string().nullable(),
  branch: z.string().nullable(),
  parent: z.string().nullable(),
  sibling: z.string().nullable(),
  /** attributedHuman */
  human: z.string().nullable(),
  harness: z.string().nullable(),
  model: z.string().nullable(),
  modelFrom: z.string().nullable(),
  /** null: the row names none, which reads as tmux */
  backend: z.string().nullable(),
  /** the row's `session.threadId` (a session provider's row) and `tmux.session` (a tmux row) */
  threadId: z.string().nullable(),
  tmuxSession: z.string().nullable(),
  /** the messaging address, else the served identity in the Desktop's words; null without either */
  messagingId: z.string().nullable(),
});
export type PanelInstance = z.output<typeof panelInstance>;
export type PanelModuleDrift = z.output<typeof panelModuleDrift>;

/** What the shared status read keeps for one instance, each as the kernel printed it. */
export type RawRow = {
  /** the roster's `root` */
  root: unknown;
  /** the instance's agent row (its soul), without its instances */
  agent: unknown;
  /** the instance's own row */
  row: unknown;
};
const frame = z.looseObject({
  root: z.string().min(1),
  agent: z.looseObject({ name: z.string().min(1) }),
  row: z.looseObject({ instance: z.string().min(1), home: z.string().min(1) }),
});

type Row = Record<string, unknown>;
const record = (value: unknown): Row | null => (typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Row) : null);
/** A fact that is text and not empty; anything else is unreported. */
const text = (value: unknown): string | null => (typeof value === "string" && value !== "" ? value : null);
const lastSegment = (path: string): string | null => text(path.replace(/\/+$/, "").split("/").pop());
const parentOf = (path: string): string => path.replace(/\/+$/, "").replace(/\/[^/]*$/, "");

/**
 * The served identity in one line, as the Desktop writes it (packages/client/deployment-facts.mjs
 * `servedIdentityText`): a resident acting through a grant, else an alias on a team.
 */
function servedIdentity(value: unknown): string | null {
  const identity = record(value);
  if (identity === null) return null;
  const grant = record(identity.grant);
  if (identity.mode === "global" && grant !== null) {
    const who = text(identity.address) ?? text(identity.alias) ?? text(identity.resident) ?? "?";
    const expires = text(grant.expiresAt);
    return `acts as ${who} via grant${expires === null ? "" : `, expires ${expires}`}`;
  }
  return `alias ${text(identity.alias) ?? "?"} on ${text(identity.team) ?? "?"}`;
}

/** The modules whose status is a word other than `current`. A recorded map (drift not observed) says nothing. */
function moduleDrift(value: unknown): PanelModuleDrift[] {
  if (!Array.isArray(value)) return [];
  const drifted: PanelModuleDrift[] = [];
  for (const entry of value) {
    const row = record(entry);
    const status = row === null ? null : text(row.status);
    if (row === null || status === null || status === "current") continue;
    drifted.push({
      name: text(row.name),
      status,
      was: text(record(row.from)?.version),
      now: text(record(row.current)?.version),
      reason: text(row.reason),
    });
  }
  return drifted;
}

function toPanelInstance(root: string, group: Row, row: Row & { instance: string; home: string }): PanelInstance {
  const soulStatus = text(record(row.soul)?.status);
  const repo = text(row.repo);
  return {
    instance: row.instance,
    soul: text(row.agent) ?? (group.name as string),
    description: text(group.description),
    agentsRoot: root,
    home: row.home,
    running: typeof row.running === "boolean" ? row.running : null,
    runtimeState: text(row.runtimeState),
    runtimeError: text(row.runtimeError),
    startedAt: text(row.startedAt),
    createdAt: text(row.createdAt),
    drift: { soul: soulStatus === null || soulStatus === "current" ? null : soulStatus, modules: moduleDrift(row.modules) },
    work: text(row.work),
    repo: lastSegment(repo ?? parentOf(root)),
    branch: text(row.branch),
    parent: text(row.parentInstance),
    sibling: text(row.siblingInstance),
    human: text(row.attributedHuman),
    harness: text(row.harness),
    model: text(row.model),
    modelFrom: text(row.modelFrom),
    backend: text(row.backend),
    threadId: text(record(row.session)?.threadId),
    tmuxSession: text(record(row.tmux)?.session),
    messagingId: text(row.identityAddress) ?? servedIdentity(row.identity),
  };
}

/** The row as the panel draws it. */
export function parsePanelInstance(raw: RawRow): Result<PanelInstance> {
  const parsed = shaped(frame, raw, "oats status");
  return parsed.ok ? { ok: true, value: toPanelInstance(parsed.value.root, parsed.value.agent, parsed.value.row) } : parsed;
}
