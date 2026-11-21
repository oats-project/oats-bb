// The workspace's four pages: souls, capabilities, teams and machines.
// The page rows carry only what the pages draw, filled from the kernel's real answers.
import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { answer, hostRead } from "./shared.js";

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
});
export const capability = z.object({
  id: z.string(),
  description: z.string(),
  origin: z.string(),
  souls: z.number().int(),
});
/** `team` is null for a shared team no provider id is committed for yet ("not mapped"). */
export const team = z.object({ label: z.string(), team: z.string().nullable(), isDefault: z.boolean() });
export const machine = z.object({
  id: z.string(),
  route: z.string().nullable(),
  isThisMachine: z.boolean(),
  note: z.string().nullable(),
});

export const rpc = defineRpcContract({
  souls: { input: z.null(), output: z.object({ souls: z.array(soul) }) },
  capabilities: { input: z.null(), output: z.object({ capabilities: z.array(capability) }) },
  teams: { input: z.null(), output: z.object({ teams: z.array(team) }) },
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
  teams: { experimental_retryable: true, input: hostRead, output: answer(z.object({ teams: z.array(team) })) },
  servers: { experimental_retryable: true, input: hostRead, output: answer(z.object({ machines: z.array(machine) })) },
});
