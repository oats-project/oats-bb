// `oats spawn <soul> --backend bb --yolo …`: the preview, and the apply bound to the previewed decision.
// docs/desktop-cli-api.md "Spawn": the kernel takes `--idempotency-key` only with
// `--expect-decision <revision>`, and the revision is the preview's `decision.revision`.
import { z } from "zod";
import { formFacts, type FormFacts } from "../model/spawn.js";
import type { SpawnSummary } from "../model/types.js";
import { shaped } from "./envelope.js";
import { checkInstance, checkKey, checkRevision, checkSoul } from "./input.js";
import { codes, err, ok, type Result } from "./result.js";
import type { Runner } from "./runner.js";
import { withTaskFile } from "./task-file.js";

/** The relations a spawn can name (`--relation`); with none, the agent is independent. */
export const RELATIONS = ["child", "sibling", "parent"] as const;
/** `root` is the anchor's agents root, as the roster's row of it names it: it tells same-named anchors apart (`--relative-root`). */
export type SpawnRelation = { kind: (typeof RELATIONS)[number]; to: string; root?: string | undefined };
/**
 * What a spawn is asked with, beside its task: the soul, and what a person chose. `name` left out
 * is numbered by the kernel; `harness` and `model` left out are resolved by the kernel; `relation`
 * left out is an independent agent.
 */
export type SpawnInput = { soul: string; name?: string | undefined; harness?: string | undefined; model?: string | undefined; relation?: SpawnRelation | undefined };
type Checked = { soul: string; name: string | null; harness: string | null; model: string | null; relation: SpawnRelation | null };

/** A harness's id as a manifest declares it: never an option, never a path. */
const HARNESS_ID = /^[a-z][a-z0-9-]{0,39}$/;

/**
 * Refuses, before any process: a soul `oats souls` does not list, a name or a relation's instance
 * that is no instance name, a harness that is no harness id, a model that could be read as an
 * option, a relation that is not one of the three. Whether the harness is one the provider
 * declares and the instance one of the roster is the server's to check, which holds both lists.
 */
export function checkSpawn(input: SpawnInput, knownSouls: readonly string[]): Result<Checked> {
  let name: string | null = null;
  if (input.name !== undefined) {
    const checked = checkInstance(input.name);
    if (!checked.ok) return checked;
    name = checked.value;
  }
  const soul = checkSoul(input.soul, knownSouls);
  if (!soul.ok) return soul;
  if (input.harness !== undefined && !HARNESS_ID.test(input.harness)) return err(codes.invalidInput, `"${input.harness}" is not a harness id`);
  let model: string | null = null;
  if (input.model !== undefined) {
    const checked = checkModel(input.model);
    if (!checked.ok) return checked;
    model = checked.value;
  }
  let relation: SpawnRelation | null = null;
  if (input.relation !== undefined) {
    if (!RELATIONS.includes(input.relation.kind)) return err(codes.invalidInput, `"${String(input.relation.kind)}" is not a relation: child, sibling or parent`);
    const to = checkInstance(input.relation.to);
    if (!to.ok) return to;
    const root = input.relation.root;
    if (root !== undefined && (!root.startsWith("/") || root.includes("\0"))) return err(codes.invalidInput, "a relation's agents root must be the absolute path the kernel named");
    relation = { kind: input.relation.kind, to: to.value, ...(root === undefined ? {} : { root }) };
  }
  return ok({ soul: soul.value, name, harness: input.harness ?? null, model, relation });
}

/**
 * What the preview and the apply share. `--yolo` is bb's full mode, with no sandbox between the
 * agent and the account bb runs as: the bb session provider launches in no other mode, so the
 * plugin asks for it on every spawn and depends on no default of the host (README, "Spawn"). The
 * kernel binds the apply to the preview's decision, so both carry the same choices, in the same
 * order. What a person did not choose is not passed: no `--name` (the kernel numbers the agent),
 * no `--task-file` for an empty instruction (the agent starts and waits), no `--harness` and no
 * `--model` (the kernel resolves them), no relation (independent). `input` is a checked one
 * (`checkSpawn`).
 */
const common = (input: Checked, taskFile: string | null): string[] => [
  "spawn",
  input.soul,
  "--backend",
  "bb",
  "--yolo",
  ...(input.name === null ? [] : ["--name", input.name]),
  ...(taskFile === null ? [] : ["--task-file", taskFile]),
  ...(input.harness === null ? [] : ["--harness", input.harness]),
  ...(input.model === null ? [] : ["--model", input.model]),
  ...(input.relation === null ? [] : ["--relation", input.relation.kind, "--relative-to", input.relation.to, ...(input.relation.root === undefined ? [] : ["--relative-root", input.relation.root])]),
];

export const spawnPreviewArgv = (input: Checked, taskFile: string | null): string[] => [...common(input, taskFile), "--preview", "--json"];

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
export const spawnArgv = (input: Checked, taskFile: string | null, apply: SpawnApply): string[] => [
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
  harness: text,
  model: text,
  modelSource: text,
  launchConfig: text,
  warnings: z.array(z.string()).nullish(),
  preflight: z.looseObject({ status: text, budgetMs: z.number().nullish() }).nullish(),
  backendStatus: z.looseObject({ name: text, installed: z.boolean().nullish() }).nullish(),
  launch: z.looseObject({ problem: z.looseObject({ code: text, message: text }).nullish() }).nullish(),
});

export type SpawnPreview = {
  /** The preview as short lines, for a soul's page. */
  summary: SpawnSummary;
  /** What will be created, in the form's words (model/spawn.ts), for exactly the name asked. */
  facts: FormFacts;
  revision: string;
  /**
   * Why this preview is no decision a spawn could apply, with the code the Desktop's client gives
   * it (packages/client/spawn-apply.mjs): a launch the kernel found a problem with (the problem's
   * own code), checks that did not finish in the kernel's budget (`E_PREFLIGHT_INCOMPLETE`), a
   * session backend that is not installed (`E_BACKEND_UNAVAILABLE`). Null for one a spawn can apply.
   */
  problem: { code: string; message: string } | null;
};

export function parseSpawnPreview(document: unknown, name: string | null = null): Result<SpawnPreview> {
  const parsed = shaped(preview, document, "oats spawn --preview");
  if (!parsed.ok) return parsed;
  const value = parsed.value;
  const problems: string[] = [];
  let problem: SpawnPreview["problem"] = null;
  if (value.backendStatus && value.backendStatus.installed === false) {
    problems.push(`the ${value.backendStatus.name ?? "session"} backend is not installed on this machine`);
    problem = { code: "E_BACKEND_UNAVAILABLE", message: problems.at(-1)! };
  }
  if (value.preflight?.status === "timeout") {
    problems.push(`the kernel's checks did not finish within ${Math.round((value.preflight.budgetMs ?? 0) / 1000)} s`);
    problem = { code: "E_PREFLIGHT_INCOMPLETE", message: problems.at(-1)! };
  }
  if (value.launch?.problem) {
    problems.push([value.launch.problem.code, value.launch.problem.message].filter(Boolean).join(": "));
    problem = { code: value.launch.problem.code ?? codes.failed, message: value.launch.problem.message ?? "the kernel found a problem with this launch and did not say which" };
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
    summary: {
      modules: (value.modules ?? []).map((module) => (module.from?.version ? `${module.name} ${module.from.version}` : module.name)),
      teams: (value.teams ?? []).map((team) =>
        [team.label, team.default ? "(default)" : null, team.team ? null : "(not mapped)"].filter((part) => part !== null).join(" "),
      ),
      launch,
      warnings: value.warnings ?? [],
      problems,
    },
    facts: formFacts(document, { name }),
    problem,
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
/** A version as the kernel prints one for a capability: a release ("1.4.0") or, for one taken from a repository, a commit. One word, never an option. */
const VERSION = /^[A-Za-z0-9][A-Za-z0-9.+_-]{0,127}$/;
const shownCapability = z.looseObject({ version: z.unknown().optional(), sessionProviders: z.looseObject({ bb: z.looseObject({ harnesses: z.unknown().optional() }).nullish() }).nullish() });
/**
 * `result.sessionProviders.bb.harnesses`, in the manifest's order, each once. A provider from
 * before the list carries none: the answer is then empty, and a form offers no choice and passes
 * no `--harness`.
 */
export function parseHarnessList(document: unknown): Result<{ harnesses: string[]; version: string | null }> {
  const parsed = shaped(shownCapability, document, "oats capabilities show oats.bb");
  if (!parsed.ok) return parsed;
  const declared = parsed.value.sessionProviders?.bb?.harnesses;
  const harnesses = (Array.isArray(declared) ? declared : []).filter((id): id is string => typeof id === "string" && HARNESS_ID.test(id));
  // The provider's own version (`result.version`), for a place that must know what this provider does (the lifecycle dialogs).
  const version = typeof parsed.value.version === "string" && VERSION.test(parsed.value.version) ? parsed.value.version : null;
  return ok({ harnesses: [...new Set(harnesses)], version });
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
  /**
   * `absent`: the deployment does not have the bb session provider at all (the kernel knows no capability `oats.bb`:
   * `E_CAPABILITY_UNKNOWN`), with the kernel's own code and sentence. That is an ANSWER, not a failed read: there is
   * no harness to choose there, and nothing can be spawned on bb (the form says so, once). Any other failure of the
   * read is a failure.
   */
  spawnHarnesses: async (signal?: AbortSignal): Promise<Result<{ harnesses: string[]; version: string | null; absent?: { code: string; message: string } }>> => {
    const read = await oats.run(harnessListArgv(), parseHarnessList, oats.timeouts.read, signal);
    // (By the code alone, as the dialogs read it. KNOWN: the kernel uses the same code for a package that is not in the
    // lock yet and for a capability missing from a member; such a workspace reads as absent too, with the kernel's own
    // sentence under the line's Details.)
    return !read.ok && read.error.code === "E_CAPABILITY_UNKNOWN" ? ok({ harnesses: [], version: null, absent: { code: read.error.code, message: read.error.message } }) : read;
  },

  /**
   * `knownSouls` is what `oats souls` lists; `tempDir` holds the task file for the length of the
   * call. Choices that are refused (`checkSpawn`) start no process and write no file; an empty
   * instruction writes none either.
   */
  async spawnPreview(
    input: SpawnInput & { task: string },
    context: { knownSouls: readonly string[]; tempDir: string },
    signal?: AbortSignal,
  ): Promise<Result<SpawnPreview>> {
    const checked = checkSpawn(input, context.knownSouls);
    if (!checked.ok) return checked;
    const run = (taskFile: string | null) => oats.run(spawnPreviewArgv(checked.value, taskFile), (document) => parseSpawnPreview(document, checked.value.name), oats.timeouts.preview, signal);
    return hasTask(input.task) ? withTaskFile(context.tempDir, input.task, run) : run(null);
  },

  /**
   * Applies the decision `revision` (a preview's) with the idempotency key: the kernel refuses a
   * decision that moved since, and replays a spawn it already made under this key.
   */
  async spawn(
    input: SpawnInput & { task: string; key: string; revision: string },
    context: { knownSouls: readonly string[]; tempDir: string },
    signal?: AbortSignal,
  ): Promise<Result<{ instance: string; threadId: string | null }>> {
    const checked = checkSpawn(input, context.knownSouls);
    if (!checked.ok) return checked;
    // The key and the revision are checked before the task file is written.
    const apply = checkApply(input);
    if (!apply.ok) return apply;
    const run = (taskFile: string | null) => oats.run(spawnArgv(checked.value, taskFile, apply.value), parseSpawn, oats.timeouts.long, signal);
    return hasTask(input.task) ? withTaskFile(context.tempDir, input.task, run) : run(null);
  },
});

/** An instruction with nothing but blanks is none: the agent starts and waits for its person (the Desktop's "Empty starts it waiting for you."). */
export const hasTask = (task: string): boolean => task.trim() !== "";
