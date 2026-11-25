// Spawn: the preview of `oats spawn --backend bb --yolo`, and the apply bound to its decision.
import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { answer, hostBase, instanceName, key } from "./shared.js";

const soulName = z.string().min(1).max(128);

/**
 * Whom the new agent is started under, or beside (`--relation <kind> --relative-to <instance>`):
 * `to` is an agent of the current roster. Left out, the agent is independent.
 */
export const spawnRelation = z.object({ kind: z.enum(["child", "sibling", "parent"]), to: instanceName }).strict();
export type SpawnRelation = z.infer<typeof spawnRelation>;

/**
 * What a person chose in the New agent form. Only the soul and the task are always there:
 *   - `name` left out: the kernel numbers the agent (`<soul>-<n>`);
 *   - `task` may be empty: the agent starts and waits for its person;
 *   - `harness` left out: the kernel resolves it as for any spawn (the harness interface, point 2);
 *     named, it is one the bb session provider declares;
 *   - `model` left out: the kernel resolves it for the harness; named, any id as one argument;
 *   - `relation` left out: independent.
 */
const spawnInput = z.object({
  soul: soulName,
  name: instanceName.optional(),
  task: z.string().max(100_000),
  harness: z.string().min(1).max(40).optional(),
  model: z.string().min(1).max(256).optional(),
  relation: spawnRelation.optional(),
});

// ---- what will be created: the facts of the kernel's preview, as model/spawn.ts `previewFacts` words them ----
const factPart = z.object({ text: z.string(), mono: z.boolean().optional(), muted: z.boolean().optional(), sub: z.boolean().optional() });
const previewModule = z.object({ name: z.string(), source: z.string(), why: z.string() });
/**
 * The preview as the form's "What will be created" column draws it. Never the kernel's preview
 * whole: that holds settings of capabilities and paths (bb's API has no login), so the host entry
 * answers these facts and nothing else of it.
 */
export const spawnFacts = z.object({
  identity: z.array(z.object({ label: z.string(), text: z.string(), title: z.string().optional(), muted: z.boolean().optional() })),
  facts: z.array(z.object({ label: z.string(), parts: z.array(factPart) })),
  warnings: z.array(z.array(z.string())),
  modules: z.object({ core: z.array(z.object({ layer: z.string(), label: z.string(), module: previewModule.nullable() })), caps: z.array(previewModule) }).nullable(),
  resolved: z.object({ harness: z.string().nullable(), model: z.string().nullable() }),
});
export type SpawnFacts = z.infer<typeof spawnFacts>;
/** The form's preview: its facts, and the kernel's decision revision for exactly these choices. */
const plan = z.object({ facts: spawnFacts, revision: z.string() });

/**
 * The harnesses a spawn, a start or a restart on bb may name: what the bb session provider
 * declares, in its order. `hostId` is the bb machine that holds the deployment, where bb's own
 * list of a harness's models is asked (app/spawn/models.ts); null before it is found.
 */
/** The kernel's own code and sentence where the deployment has no bb session provider (`oats capabilities show oats.bb`: `E_CAPABILITY_UNKNOWN`). */
const absentProvider = z.object({ code: z.string(), message: z.string() });
export const harnessList = z.object({
  harnesses: z.array(z.string()),
  hostId: z.string().nullable(),
  /** There only where the deployment has NO bb session provider: nothing can be spawned on bb there, and the New agent form says so. */
  absent: absentProvider.optional(),
});
export type HarnessList = z.infer<typeof harnessList>;

export const rpc = defineRpcContract({
  /** One read for the New agent form and the Start and Restart dialogs. */
  spawnHarnesses: { input: z.null(), output: harnessList },
  /**
   * The New agent form's preview, for what a person chose: what will be created, as facts (never
   * the kernel's preview whole), and the revision of the decision. A preview that is no decision a
   * spawn could apply (a launch with a problem, checks that did not finish, a backend that is not
   * installed) is refused, with the kernel's code.
   */
  spawnPlan: { input: spawnInput.strict(), output: plan },
  /**
   * `revision` is the decision a person saw: the revision a `spawnPlan` of the same choices
   * answered. The kernel then refuses a spawn whose decision moved since (`E_DECISION_STALE`), and
   * nothing is created. Left out, the server reads the decision itself, right before the apply.
   */
  spawn: {
    input: spawnInput.extend({ key, revision: z.string().min(1).max(128).optional() }).strict(),
    output: z.object({ instance: z.string(), threadId: z.string() }),
  },
});

/** As the server hands a relation to the host entry: with the anchor's agents root (`--relative-root`), from the home the roster's own row of it names; left out when that home names none. */
const hostRelation = spawnRelation.extend({ root: z.string().min(1).optional() }).strict();
const hostSpawn = z.object({ ...hostBase, ...spawnInput.shape, relation: hostRelation.optional() });

export const host = defineRpcContract({
  /** `oats capabilities show oats.bb --json`: the harnesses the provider declares, and the provider's own version as the kernel prints it (null when it prints none that can be read). */
  spawnHarnesses: { experimental_retryable: true, input: z.object(hostBase).strict(), output: answer(z.object({ harnesses: z.array(z.string()), version: z.string().nullable(), absent: absentProvider.optional() })) },
  /**
   * `revision` is the kernel's decision revision for these choices; `facts` is what the form
   * draws; `problem` is why this preview is no decision a spawn could apply (the kernel's code and
   * words), or null.
   */
  spawnPreview: {
    experimental_retryable: true,
    input: hostSpawn.strict(),
    output: answer(z.object({ facts: spawnFacts, revision: z.string(), problem: z.object({ code: z.string(), message: z.string() }).nullable() })),
  },
  /**
   * The kernel takes an idempotency key only with the decision it confirms: `revision` is the
   * decision revision a `spawnPreview` of the same choices answered. Asked again with the same key
   * and revision, the kernel replays that spawn instead of making a second one.
   */
  spawn: {
    input: hostSpawn.extend({ key, revision: z.string() }).strict(),
    output: answer(z.object({ instance: z.string(), threadId: z.string().nullable() })),
  },
});
