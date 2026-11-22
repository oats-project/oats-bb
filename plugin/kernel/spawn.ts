// `oats spawn <soul> --backend bb --yolo …`: the preview, and the apply bound to the previewed decision.
// docs/desktop-cli-api.md "Spawn": the kernel takes `--idempotency-key` only with
// `--expect-decision <revision>`, and the revision is the preview's `decision.revision`.
import { z } from "zod";
import { previewFacts, type PreviewFacts } from "../model/spawn.js";
import type { SpawnSummary } from "../model/types.js";
import { shaped } from "./envelope.js";
import { checkInstance, checkKey, checkRevision, checkSoul } from "./input.js";
import { codes, err, ok, type Result } from "./result.js";
import type { Runner } from "./runner.js";
import { withTaskFile } from "./task-file.js";

export type SpawnRelation = { kind: "child" | "sibling" | "parent"; to: string };
/** A spawn as the form asks for it: the soul, and each choice only where a person made one. */
export type SpawnInput = { soul: string; name?: string; harness?: string; model?: string; relation?: SpawnRelation; background?: boolean };
const RELATIONS: readonly string[] = ["child", "sibling", "parent"];
/**
 * Refuses a soul `oats souls` does not list, a name that is not an instance name, a harness the
 * provider does not declare (`harnesses`: its list, read only when one is named), a model that
 * could be read as an option and a relation to a name that is no instance's. → the same choices, checked.
 */
export function checkSpawn(input: SpawnInput, knownSouls: readonly string[], harnesses: readonly string[] = []): Result<SpawnInput> {
  const soul = checkSoul(input.soul, knownSouls);
  if (!soul.ok) return soul;
  const checked: SpawnInput = { soul: soul.value };
  if (input.name !== undefined) {
    const name = checkInstance(input.name);
    if (!name.ok) return name;
    checked.name = name.value;
  }
  if (input.harness !== undefined) {
    const harness = checkHarness(input.harness, harnesses);
    if (!harness.ok) return harness;
    checked.harness = harness.value;
  }
  if (input.model !== undefined) {
    const model = checkModel(input.model);
    if (!model.ok) return model;
    checked.model = model.value;
  }
  if (input.relation !== undefined) {
    const to = checkInstance(input.relation.to);
    if (!to.ok) return to;
    if (!RELATIONS.includes(input.relation.kind)) return err(codes.invalidInput, `"${String(input.relation.kind)}" is not a relationship: child, sibling or parent`);
    checked.relation = { kind: input.relation.kind, to: to.value };
  }
  if (input.background !== undefined) checked.background = input.background === true;
  return ok(checked);
}

/**
 * What the preview and the apply share. `--yolo` is bb's full mode, with no sandbox between the
 * agent and the account bb runs as: the bb session provider launches in no other mode, so the
 * plugin asks for it on every spawn and depends on no default of the host (README, "Spawn"). The
 * kernel binds the apply to the preview's decision, so both carry every choice. A choice nobody
 * made adds no flag: the kernel then resolves it as for any spawn (the harness interface, 2 and 3).
 */
const common = (input: SpawnInput, taskFile: string): string[] => [
  "spawn",
  input.soul,
  "--backend",
  "bb",
  "--yolo",
  ...(input.name === undefined ? [] : ["--name", input.name]),
  "--task-file",
  taskFile,
  ...(input.harness === undefined ? [] : ["--harness", input.harness]),
  ...(input.model === undefined ? [] : ["--model", input.model]),
  ...(input.relation === undefined ? [] : ["--relation", input.relation.kind, "--relative-to", input.relation.to]),
  ...(input.background === undefined ? [] : [input.background ? "--background" : "--no-background"]),
];

export const spawnPreviewArgv = (input: SpawnInput, taskFile: string): string[] => [...common(input, taskFile), "--preview", "--json"];

export type SpawnApply = { revision: string; key: string };

/** Refuses a revision or a key that is not the kernel's shape. */
export function checkApply(apply: SpawnApply): Result<SpawnApply> {
  const revision = checkRevision(apply.revision);
  if (!revision.ok) return revision;
  const key = checkKey(apply.key);
  if (!key.ok) return key;
  return ok({ revision: revision.value, key: key.value });
}

/** `apply` is a checked one (`checkApply`). */
export const spawnArgv = (input: SpawnInput, taskFile: string, apply: SpawnApply): string[] => [
  ...common(input, taskFile),
  "--expect-decision",
  apply.revision,
  "--idempotency-key",
  apply.key,
  "--json",
];

const text = z.string().nullish();
const preview = z.looseObject({
  decision: z.looseObject({ revision: z.string().min(1) }),
  modules: z
    .array(z.looseObject({ name: z.string(), from: z.looseObject({ kind: text, version: text }).nullish() }))
    .nullish(),
  teams: z.array(z.looseObject({ label: z.string(), team: text, default: z.boolean().nullish() })).nullish(),
  instance: text,
  background: z.boolean().nullish(),
  harness: text,
  model: text,
  modelSource: text,
  launchConfig: text,
  warnings: z.array(z.string()).nullish(),
  preflight: z.looseObject({ status: text, budgetMs: z.number().nullish() }).nullish(),
  backendStatus: z.looseObject({ name: text, installed: z.boolean().nullish() }).nullish(),
  launch: z.looseObject({ problem: z.looseObject({ code: text, message: text }).nullish() }).nullish(),
});

export type SpawnPreview = { summary: SpawnSummary; facts: PreviewFacts; instance: string | null; background: boolean | null; revision: string };
export function parseSpawnPreview(document: unknown): Result<SpawnPreview> {
  const parsed = shaped(preview, document, "oats spawn --preview");
  if (!parsed.ok) return parsed;
  const value = parsed.value;
  const problems: string[] = [];
  if (value.backendStatus && value.backendStatus.installed === false) {
    problems.push(`the ${value.backendStatus.name ?? "session"} backend is not installed on this machine`);
  }
  if (value.preflight?.status === "timeout") {
    problems.push(`the kernel's checks did not finish within ${Math.round((value.preflight.budgetMs ?? 0) / 1000)} s`);
  }
  if (value.launch?.problem) {
    problems.push([value.launch.problem.code, value.launch.problem.message].filter(Boolean).join(": "));
  }
  const model = value.model ?? "the harness's default model";
  const launch = value.harness
    ? [
        value.harness,
        value.modelSource ? `${model} (${value.modelSource})` : model,
        value.launchConfig ? `launch configuration ${value.launchConfig}` : null,
      ]
        .filter((part): part is string => part !== null)
        .join(" · ")
    : null;
  return ok({
    revision: value.decision.revision,
    // What will be created, for the form's standing column; the name is the form's own (it knows whether one was typed).
    facts: previewFacts(document),
    instance: value.instance ?? null,
    background: value.background ?? null,
    summary: {
      modules: (value.modules ?? []).map((module) => (module.from?.version ? `${module.name} ${module.from.version}` : module.name)),
      teams: (value.teams ?? []).map((team) =>
        [team.label, team.default ? "(default)" : null, team.team ? null : "(not mapped)"].filter((part) => part !== null).join(" "),
      ),
      launch,
      warnings: value.warnings ?? [],
      problems,
    },
  });
}

const spawned = z.looseObject({
  instance: z.string().min(1),
  session: z.looseObject({ endpoint: z.looseObject({ threadId: text }).nullish() }).nullish(),
});

/** The spawned instance and, when the kernel named it, the bb thread it runs in. */
export function parseSpawn(document: unknown): Result<{ instance: string; threadId: string | null }> {
  const parsed = shaped(spawned, document, "oats spawn");
  if (!parsed.ok) return parsed;
  return ok({ instance: parsed.value.instance, threadId: parsed.value.session?.endpoint?.threadId ?? null });
}

// ---- the harnesses the bb session provider launches ----
/**
 * The ONE read of the list (the harness interface, point 1): the bb capability as the deployment
 * resolves it, whose manifest declares the harnesses its session provider can launch.
 */
export const harnessListArgv = (): string[] => ["capabilities", "show", "oats.bb", "--json"];
/** A harness's id as a manifest declares it: never an option, never a path. */
const HARNESS_ID = /^[a-z][a-z0-9-]{0,39}$/;
const shownCapability = z.looseObject({ sessionProviders: z.looseObject({ bb: z.looseObject({ harnesses: z.unknown().optional() }).nullish() }).nullish() });
/**
 * `result.sessionProviders.bb.harnesses`, in the manifest's order, each once. A provider from
 * before the list carries none: the answer is then empty, and a form offers no choice and passes
 * no `--harness`.
 */
export function parseHarnessList(document: unknown): Result<{ harnesses: string[] }> {
  const parsed = shaped(shownCapability, document, "oats capabilities show oats.bb");
  if (!parsed.ok) return parsed;
  const declared = parsed.value.sessionProviders?.bb?.harnesses;
  const harnesses = (Array.isArray(declared) ? declared : []).filter((id): id is string => typeof id === "string" && HARNESS_ID.test(id));
  return ok({ harnesses: [...new Set(harnesses)] });
}

/**
 * A harness named for a spawn, a start or a restart (`--harness <id>`): one the bb session provider
 * declares. Anything else starts no process.
 */
export function checkHarness(harness: string, declared: readonly string[]): Result<string> {
  return HARNESS_ID.test(harness) && declared.includes(harness) ? ok(harness) : err(codes.invalidInput, `"${harness}" is not a harness the bb session provider declares (${declared.join(", ") || "none"})`);
}
/**
 * A model named for a spawn, a start or a restart (`--model <id>`): any id a person typed or picked,
 * as one argv element that cannot be read as an option. The kernel refuses what it cannot launch.
 */
export function checkModel(model: string): Result<string> {
  return model !== "" && model.length <= 256 && !model.startsWith("-") && !/[\0\n\r]/.test(model) ? ok(model) : err(codes.invalidInput, "a model is one line of up to 256 characters that does not start with a dash");
}

/** Spawn's commands. */
export const verbs = (oats: Runner) => ({
  /** The harnesses the bb session provider declares, for the New agent form and the Start and Restart dialogs. */
  spawnHarnesses: (signal?: AbortSignal): Promise<Result<{ harnesses: string[] }>> => oats.run(harnessListArgv(), parseHarnessList, oats.timeouts.read, signal),

  /**
   * `knownSouls` is what `oats souls` lists; `tempDir` holds the task file for the length of the
   * call. A soul not in the list or a name that is no instance name starts no process and writes
   * no file.
   */
  async spawnPreview(
    input: SpawnInput & { task: string },
    context: { knownSouls: readonly string[]; harnesses?: readonly string[]; tempDir: string },
    signal?: AbortSignal,
  ): Promise<Result<SpawnPreview>> {
    const checked = checkSpawn(input, context.knownSouls, context.harnesses);
    if (!checked.ok) return checked;
    return withTaskFile(context.tempDir, input.task, (taskFile) =>
      oats.run(spawnPreviewArgv(checked.value, taskFile), parseSpawnPreview, oats.timeouts.preview, signal),
    );
  },

  /**
   * Applies the decision `revision` (a preview's) with the idempotency key: the kernel refuses a
   * decision that moved since, and replays a spawn it already made under this key.
   */
  async spawn(
    input: SpawnInput & { task: string; key: string; revision: string },
    context: { knownSouls: readonly string[]; harnesses?: readonly string[]; tempDir: string },
    signal?: AbortSignal,
  ): Promise<Result<{ instance: string; threadId: string | null }>> {
    const checked = checkSpawn(input, context.knownSouls, context.harnesses);
    if (!checked.ok) return checked;
    // The key and the revision are checked before the task file is written.
    const apply = checkApply(input);
    if (!apply.ok) return apply;
    return withTaskFile(context.tempDir, input.task, (taskFile) =>
      oats.run(spawnArgv(checked.value, taskFile, apply.value), parseSpawn, oats.timeouts.long, signal),
    );
  },
});
