// The Workspace page's four tabs: souls, capabilities, teams and machines.
// The rows carry what the tabs draw, filled from the kernel's real answers; and three facts that a
// later change draws (a capability's `version` on its own page; `localTeams`, for the teams' acts).
import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { answer, hostRead } from "./shared.js";

const source = z.object({ kind: z.string(), label: z.string() });
export const soul = z.object({
  /** the soul key: what `oats spawn` takes (`<package>/<soul>` for a package soul) */
  name: z.string(),
  /** the roster agent name of this soul's instances: equal to their `Agent.soul` */
  agent: z.string(),
  description: z.string(),
  origin: z.string(),
  capabilities: z.array(z.string()),
  spawnable: z.boolean(),
  problem: z.string().nullable(),
  // (What the kernel says beside: model/types.ts `Soul`. Absent where its answer has none.)
  unresolved: z.literal(true).optional(),
  shortName: z.string().optional(),
  file: z.string().optional(),
  launchFrom: z.string().optional(),
  launchAt: z.string().optional(),
  source: source.optional(),
  harness: z.string().nullable().optional(),
  model: z.string().nullable().optional(),
  teams: z.array(z.object({ label: z.string(), isDefault: z.boolean() })).optional(),
  why: z.record(z.string(), z.string()).optional(),
});
export const capability = z.object({
  id: z.string(),
  description: z.string(),
  origin: z.string(),
  souls: z.number().int(),
  source: source.optional(),
  version: z.string().nullable().optional(),
  layer: z.string().nullable().optional(),
  repoOnly: z.boolean().optional(),
});
/** `team` is null for a shared team no provider id is committed for yet ("not mapped"). */
export const team = z.object({
  label: z.string(),
  team: z.string().nullable(),
  isDefault: z.boolean(),
  description: z.string().nullable().optional(),
  local: z.boolean().optional(),
  at: z.string().nullable().optional(),
});
/** `oats teams` beside its rows: who may join what, whether this computer may declare teams, and what is not right. */
const teamsAnswer = z.object({
  teams: z.array(team),
  localTeams: z.boolean().optional(),
  problems: z.array(z.object({ code: z.string().nullable(), label: z.string().nullable(), isDefault: z.boolean(), message: z.string(), fix: z.string().nullable() })).optional(),
});
export const machine = z.object({
  id: z.string(),
  route: z.string().nullable(),
  isThisMachine: z.boolean(),
  label: z.string().nullable(),
  folder: z.string().nullable(),
});

export const rpc = defineRpcContract({
  souls: { input: z.null(), output: z.object({ souls: z.array(soul) }) },
  capabilities: { input: z.null(), output: z.object({ capabilities: z.array(capability) }) },
  teams: { input: z.null(), output: teamsAnswer },
  machines: { input: z.null(), output: z.object({ machines: z.array(machine) }) },
});

/** `oats capabilities` rows; the server adds the number of souls from `oats souls`. */
export const hostCapability = capability.omit({ souls: true });

export const host = defineRpcContract({
  souls: { experimental_retryable: true, input: hostRead, output: answer(z.object({ souls: z.array(soul) })) },
  capabilities: {
    experimental_retryable: true,
    input: hostRead,
    output: answer(z.object({ capabilities: z.array(hostCapability) })),
  },
  teams: { experimental_retryable: true, input: hostRead, output: answer(teamsAnswer) },
  servers: { experimental_retryable: true, input: hostRead, output: answer(z.object({ machines: z.array(machine) })) },
});
