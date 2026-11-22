// Spawn: the preview of `oats spawn --backend bb --yolo`, and the apply bound to its decision.
import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { answer, hostBase, instanceName, key } from "./shared.js";

const soulName = z.string().min(1).max(128);

export const spawnSummary = z.object({
  modules: z.array(z.string()),
  teams: z.array(z.string()),
  launch: z.string().nullable(),
  warnings: z.array(z.string()),
  problems: z.array(z.string()),
});
/** How the new agent relates to one that exists: its child, its sibling or its parent. Independent is no relation. */
export const spawnRelation = z.object({ kind: z.enum(["child", "sibling", "parent"]), to: instanceName }).strict();
/**
 * What the New agent form asks for. Only the soul and the opening instruction are always there
 * (the instruction may be empty: the agent then starts waiting for its person); every other field
 * is passed only when a person chose it, so the kernel resolves the rest as for any spawn.
 */
const spawnInput = z.object({
  soul: soulName,
  /** The instance's whole name; left out, the kernel numbers it. */
  name: instanceName.optional(),
  task: z.string().max(100_000),
  /** One the bb session provider declares (`spawnHarnesses`). */
  harness: z.string().regex(/^[a-z][a-z0-9-]{0,39}$/).optional(),
  model: z.string().min(1).max(256).optional(),
  relation: spawnRelation.optional(),
  /** Sent only when it differs from the soul's own default. */
  background: z.boolean().optional(),
});
export type SpawnRequest = z.infer<typeof spawnInput>;

const factPart = z.object({ text: z.string(), mono: z.boolean().optional(), muted: z.boolean().optional(), sub: z.boolean().optional() });
const previewModule = z.object({ name: z.string(), source: z.string(), why: z.string() });
/** What will be created, as the kernel's preview says it (model/spawn.ts `previewFacts`). */
export const spawnFacts = z.object({
  identity: z.array(z.object({ label: z.string(), text: z.string(), title: z.string().optional(), muted: z.boolean().optional() })),
  facts: z.array(z.object({ label: z.string(), parts: z.array(factPart) })),
  prompts: z.array(z.object({ label: z.string(), text: z.string(), mono: z.boolean().optional() })).nullable(),
  warnings: z.array(z.array(z.string())),
  modules: z.object({ core: z.array(z.object({ layer: z.string(), label: z.string(), module: previewModule.nullable() })), caps: z.array(previewModule) }).nullable(),
  resolved: z.object({ harness: z.string().nullable(), model: z.string().nullable() }),
});
/** A preview's answer for the form: the facts, the name the kernel would give, and whether the soul runs in the background by itself. */
const previewAnswer = { summary: spawnSummary, facts: spawnFacts, instance: z.string().nullable(), background: z.boolean().nullable() };

/**
 * The harnesses a spawn, a start or a restart on bb may name: what the bb session provider
 * declares, in its order. `hostId` is the bb machine that holds the deployment, where bb's own
 * list of a harness's models is asked (app/spawn/models.ts); null before it is found.
 */
export const harnessList = z.object({ harnesses: z.array(z.string()), hostId: z.string().nullable() });
export type HarnessList = z.infer<typeof harnessList>;

export const rpc = defineRpcContract({
  /** One read for the New agent form and the Start and Restart dialogs. */
  spawnHarnesses: { input: z.null(), output: harnessList },
  /** The preview as the form on a soul's page reads it (until that page opens the New agent form instead). */
  spawnPreview: { input: spawnInput.strict(), output: z.object({ summary: spawnSummary }) },
  /** The preview as the New agent form reads it: what will be created, for exactly these choices. */
  spawnPlan: { input: spawnInput.strict(), output: z.object(previewAnswer) },
  spawn: {
    input: spawnInput.extend({ key }).strict(),
    output: z.object({ instance: z.string(), threadId: z.string() }),
  },
});

const hostSpawn = z.object({ ...hostBase, ...spawnInput.shape });

export const host = defineRpcContract({
  /** `oats capabilities show oats.bb --json`. */
  spawnHarnesses: { experimental_retryable: true, input: z.object(hostBase).strict(), output: answer(z.object({ harnesses: z.array(z.string()) })) },
  /** `revision` is the kernel's decision revision for this soul, name and task. */
  spawnPreview: {
    experimental_retryable: true,
    input: hostSpawn.strict(),
    output: answer(z.object({ ...previewAnswer, revision: z.string() })),
  },
  /**
   * The kernel takes an idempotency key only with the decision it confirms: `revision` is the
   * decision revision a `spawnPreview` of the same soul, name and task answered. Asked again with the
   * same key and revision, the kernel replays that spawn instead of making a second one.
   */
  spawn: {
    input: hostSpawn.extend({ key, revision: z.string() }).strict(),
    output: answer(z.object({ instance: z.string(), threadId: z.string().nullable() })),
  },
});
