// What the New agent form says of a spawn: the facts of the kernel's preview ("What will be
// created") and a refusal in a person's words with the act that follows. Both are the Desktop's,
// shared by its clients (awebai/oats at a4a43220: packages/client/spawn-preview-facts.mjs
// `previewFacts`, packages/client/spawn-messages.mjs `spawnProblem`, and the Desktop's own words
// for the act that follows in packages/desktop/renderer/spawn-words.mjs), ported as they are; where
// a sentence names one of the Desktop's controls, the plugin names its own. Pure: no bb, no React.
import { DETAIL_WITHHELD, displayLine } from "../app/ui/text.js";

type Json = Record<string, unknown>;
const record = (value: unknown): value is Json => typeof value === "object" && value !== null && !Array.isArray(value);
const text = (value: unknown): string | null => (typeof value === "string" && value !== "" ? value : null);
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

// ---- the harness and where a launch came from ----
/** A harness as the form names it (the harness interface, point 4); one the map does not know is its id. */
const HARNESS_LABELS: Record<string, string> = { claude: "Claude Code", pi: "pi" };
export const harnessLabel = (harness: string): string => (Object.hasOwn(HARNESS_LABELS, harness) ? HARNESS_LABELS[harness]! : harness);
/** Where the effective launch came from (the kernel's `launch.from`), in words. */
const LAUNCH_FROM: Record<string, string> = {
  flag: "chosen for this spawn",
  local: "set for this soul on this computer",
  "local-default": "this computer's default for every soul",
  soul: "the soul's preference",
  host: "no preference set: the host default",
  recorded: "recorded when it was spawned",
};
export const launchFromText = (from: string): string => (Object.hasOwn(LAUNCH_FROM, from) ? LAUNCH_FROM[from]! : `from: ${from}`);

// ---- what will be created ----
/** A part of a fact's value: plain text, `mono` (a branch), `muted`, or `sub` (a second line: where it came from, what else). */
export type FactPart = { text: string; mono?: boolean; muted?: boolean; sub?: boolean };
export type PreviewModule = { name: string; source: string; why: string };
export type PreviewFacts = {
  /** The name (the form's own, or what stands for none) and the home, relative to the deployment with the whole path as its title. */
  identity: { label: string; text: string; title?: string; muted?: boolean }[];
  /** Works in, Harness, Team, Relationship, Setup, in that order, each only when the preview says it. */
  facts: { label: string; parts: FactPart[] }[];
  /** The launch-prompt note, in the kernel contract's words; null when the preview carries none. */
  prompts: { label: string; text: string; mono?: boolean }[] | null;
  /** Each capability warning's lines. */
  warnings: string[][];
  /** The core slots in their order (a module, or null for an empty slot) and the other capabilities by name; null from a kernel that reports none. */
  modules: { core: { layer: string; label: string; module: PreviewModule | null }[]; caps: PreviewModule[] } | null;
  /** The harness and the model the kernel resolved, for the form to show beside "The soul's default" and "Default". */
  resolved: { harness: string | null; model: string | null };
};

const WORK_PHRASES: Record<string, string> = { worktree: "own worktree", checkout: "shared checkout", attached: "a parent's worktree", directory: "own folder · free to work across repos", workspace: "all member repos" };
/** The preview's work mode in words; a mode this does not know is said as the kernel names it. */
export const worksInText = (work: string): string => (Object.hasOwn(WORK_PHRASES, work) ? WORK_PHRASES[work]! : work);
/** The home, short enough to read: relative to the deployment when it lies in it, else its last three segments behind "…/". */
export function homeText(home: unknown, dir: unknown): { text: string; title: string } | null {
  if (typeof home !== "string" || home === "") return null;
  const base = typeof dir === "string" && dir !== "" ? dir.replace(/\/+$/, "") : "";
  if (base !== "" && home.startsWith(`${base}/`) && home.length > base.length + 1) return { text: home.slice(base.length + 1), title: home };
  const parts = home.split("/").filter(Boolean);
  return { text: parts.length > 3 ? `…/${parts.slice(-3).join("/")}` : home, title: home };
}
const RELATION_WORDS: Record<string, string> = { child: "child of", sibling: "sibling of", parent: "parent of" };
/** The relation the preview binds, with its anchor ("child of api-2"); null when independent. */
export function relationText(preview: Json): string | null {
  const kind = text(preview.relation);
  if (kind === null) return null;
  if (!Object.hasOwn(RELATION_WORDS, kind)) return kind;
  const decision = record(preview.decision) ? preview.decision : {};
  const effective = record(decision.effective) ? decision.effective : {};
  const relation = record(effective.relation) ? effective.relation : {};
  const anchor = record(relation.anchor) ? text(relation.anchor.instance) : null;
  return anchor === null ? RELATION_WORDS[kind]! : `${RELATION_WORDS[kind]} ${anchor}`;
}
/** A module's source as the Capabilities tag says it: the package and its version, the member's repository, or the kind as given. */
export function moduleSourceText(from: unknown): string {
  if (!record(from)) return "";
  if (from.kind === "package") return `package ${text(from.package) ?? ""}${text(from.version) !== null ? ` ${from.version as string}` : ""}`.trimEnd();
  if (from.kind === "member") return `${(text(from.repoKey) ?? "").split("/").pop()!.replace(/\.git$/, "") || "member"} · latest`;
  return text(from.kind) ?? "";
}
/** Why a module is there, where the preview says: the soul asks for it, or the workspace gives it to every soul. */
export const moduleWhyText = (module: Json): string => (module.composedFrom === "soul" ? "Soul" : module.composedFrom === "workspace" ? "Workspace default" : "");
const CORE_SLOTS = [["knowledge", "Knowledge"], ["messaging", "Messaging"], ["tasks", "Tasks"]] as const;
function previewModules(modules: unknown): PreviewFacts["modules"] {
  if (!Array.isArray(modules)) return null;
  const rows = modules.filter((module): module is Json => record(module) && text(module.name) !== null);
  const described = (module: Json): PreviewModule => ({ name: module.name as string, source: moduleSourceText(module.from), why: moduleWhyText(module) });
  const core = CORE_SLOTS.map(([layer, label]) => {
    const module = rows.find((row) => row.layer === layer);
    return { layer, label, module: module === undefined ? null : described(module) };
  });
  const caps = rows
    .filter((module) => !CORE_SLOTS.some(([layer]) => layer === module.layer))
    .sort((a, b) => (a.name as string).localeCompare(b.name as string))
    .map(described);
  return { core, caps };
}

/**
 * The facts a preview shows. `name` is the form's own name; `unnamed` is what the Name says with
 * none ("named from its task", where the kernel will be asked for one): the preview's numbered
 * name is then not the one a spawn creates, so the home and the new branch, which derive from it,
 * are left out until there is a name.
 */
export function previewFacts(preview: unknown, { name = null, unnamed }: { name?: string | null; unnamed?: string } = {}): PreviewFacts {
  const data: Json = record(preview) ? preview : {};
  const pending = (name === null || name === "") && unnamed !== undefined;
  const identity: PreviewFacts["identity"] = [name !== null && name !== "" ? { label: "Name", text: name } : { label: "Name", text: unnamed ?? "numbered by the kernel", muted: true }];
  const subject = record(data.subject) ? data.subject : {};
  const home = pending ? null : homeText(data.home, subject.dir);
  if (home !== null) identity.push({ label: "Home", text: home.text, title: home.title });
  const facts: PreviewFacts["facts"] = [];
  const work = text(data.work);
  const branch = text(data.branch);
  const base = record(data.base) ? text(data.base.ref) : null;
  if (work === "worktree" && branch !== null && !pending) facts.push({ label: "Works in", parts: [{ text: "worktree · branch " }, { text: branch, mono: true }, ...(base === null ? [] : [{ text: ` from ${base}` }])] });
  else if (work !== null) facts.push({ label: "Works in", parts: [{ text: worksInText(work) }] });
  const harness = text(data.harness);
  const model = text(data.model);
  if (harness !== null) {
    // Where the harness came from: the launch's `from` in words, else the kernel's own word for where the model came from.
    const launch = record(data.launch) && record(data.launch.effective) ? data.launch : null;
    const from = launch !== null && text(launch.from) !== null ? launchFromText(launch.from as string) : text(data.modelSource);
    facts.push({ label: "Harness", parts: [{ text: `${harnessLabel(harness)} · ${model ?? "default model"}` }, ...(from === null ? [] : [{ text: from, sub: true }])] });
  }
  // The default team the kernel resolved (or none), then the other teams it may join.
  const defaultTeam = record(data.defaultTeam) ? text(data.defaultTeam.label) : null;
  const teams = list(data.teams).map((team) => (record(team) ? text(team.label) : null)).filter((label): label is string => label !== null);
  const others = teams.filter((label) => label !== defaultTeam);
  if (defaultTeam !== null) facts.push({ label: "Team", parts: [{ text: defaultTeam }, { text: " · default", muted: true }, ...(others.length > 0 ? [{ text: `may also join ${others.join(", ")}`, sub: true }] : [])] });
  else if (data.defaultTeam === null && teams.length === 0) facts.push({ label: "Team", parts: [{ text: "none", muted: true }] });
  else if (data.defaultTeam === undefined && text(data.team) !== null) facts.push({ label: "Team", parts: [{ text: data.team as string }] });
  const relation = relationText(data);
  if (relation !== null) facts.push({ label: "Relationship", parts: [{ text: relation }] });
  // The capabilities whose `worktree` hook sets up ./work, in the order they run.
  const hooks = list(data.worktreeHooks)
    .filter(record)
    .map((hook) => `${displayLine(hook.capability) ?? ""}${hook.required === true ? " (required)" : ""}`);
  if (hooks.length > 0) facts.push({ label: "Setup", parts: [{ text: hooks.join(", ") }, { text: "Runs after the worktree is made. Can take several minutes.", sub: true }] });
  let prompts: PreviewFacts["prompts"] = null;
  if (record(data.launchPromptAnswers)) {
    // The launch-prompt policy is a note, not a fact: its words are the kernel contract's.
    const policy = data.launchPromptAnswers;
    prompts = [
      {
        label: "Launch prompts",
        text:
          policy.awebDevelopmentChannel === true
            ? "The launcher will answer the aweb development-channel confirmation for this home. This policy does not confirm readiness. A harness update can block the launch until its prompt fixtures are refreshed; no fallback key is sent."
            : "None. The launcher will not answer prompts for this home. This policy does not confirm readiness.",
      },
    ];
    if (text(policy.consentSource) !== null) prompts.push({ label: "Prompt consent source", text: policy.consentSource as string, mono: true });
  }
  const warnings = list(data.warnings).map((warning) => String(warning).split("\n"));
  return { identity, facts, prompts, warnings, modules: previewModules(data.modules), resolved: { harness, model } };
}
/**
 * The preview's facts as the form's column lists them: the Desktop's (`previewFacts`), and three
 * of the plugin's own, each read from the same answer and never assumed: the soul (the Desktop's
 * dialog names it in its title alone), that the session is a bb thread (the Desktop's Session
 * backend is a control; here it is always bb, and said), and the access the agent runs with (the
 * plugin asks for bb's full mode on every spawn: the row says what the kernel decided). The
 * launch-prompt note (`prompts`) is not the form's yet, and is left out.
 */
export type FormFacts = Omit<PreviewFacts, "prompts">;
export function formFacts(preview: unknown, options: { name?: string | null } = {}): FormFacts {
  const { prompts: _later, ...facts } = previewFacts(preview, options);
  const data: Json = record(preview) ? preview : {};
  const rows = [...facts.facts];
  const after = (label: string, row: PreviewFacts["facts"][number]) => {
    const at = rows.findIndex((fact) => fact.label === label);
    rows.splice(at === -1 ? rows.length : at + 1, 0, row);
  };
  const soul = text(data.agent);
  if (soul !== null) rows.unshift({ label: "Soul", parts: [{ text: soul }] });
  const decision = record(data.decision) && record(data.decision.effective) ? data.decision.effective : {};
  const backend = text(data.backend);
  const access = decision.yolo === true ? "full mode: no sandbox" : decision.yolo === false ? "the harness asks before it acts" : null;
  // After the harness: where its session is, then what it may do.
  if (access !== null) after("Harness", { label: "Access", parts: [{ text: access }] });
  if (backend !== null) after("Harness", { label: "Session", parts: [{ text: backend === "bb" ? "bb thread" : backend }] });
  return { ...facts, facts: rows };
}

/** Under the column: who resolved it, and what the spawn does if it moves (the Desktop's sentence). */
export const PREVIEW_FOOT = "Resolved by the installed CLI. Spawn refuses if this changes before you confirm.";

// ---- a refusal, in a person's words ----
/** The act that follows a refusal, where its sentence names one. */
export type SpawnNext = "change-options" | "review-again" | "check-result" | "update-oats" | "sync-workspace" | "details" | "open-from-list" | null;
type Said = { fact: string; next: SpawnNext };
const said = (fact: string, next: SpawnNext = null): Said => ({ fact, next });
const COMMON_FACTS: Record<string, Said> = {
  E_BAD_ARGS: said("Some of these values can’t be used.", "change-options"),
  E_BUSY: said("Another spawn is in progress. Try again in a moment."),
  E_PREVIEW_UNAVAILABLE: said("Spawning needs a newer OATS.", "update-oats"),
  E_APPLY_UNAVAILABLE: said("Spawning needs a newer OATS.", "update-oats"),
  E_SOUL_UNKNOWN: said("This soul isn’t in the workspace anymore. Sync the workspace and try again."),
  E_SOUL_AMBIGUOUS: said("Two repositories declare a soul with this name, so it can’t be spawned until one is renamed."),
  E_UNSUPPORTED_MODE: said("This soul can’t be started on its own from here."),
  E_UNSUPPORTED_OPTION: said("One of the options you chose isn’t supported here. Set it back to the default and try again."),
  E_RELATIVE_AMBIGUOUS: said("The instance you picked for the relationship can’t be told apart from another one. Pick it again."),
  E_SESSION_UNKNOWN: said("The instance you picked for the relationship isn’t available anymore. Pick another one."),
  E_HOME_MISMATCH: said("The instance you picked for the relationship isn’t available anymore. Pick another one."),
  E_CHILD_SPAWNS_DISABLED: said("The parent you picked doesn’t allow child instances.", "change-options"),
  E_BRANCH_EXISTS: said("That branch already exists.", "change-options"),
  E_BASE_UNKNOWN: said("That base isn’t a branch, tag or commit in this soul’s repository.", "change-options"),
  E_CLONE_MISSING: said("This soul’s repository isn’t cloned on this machine yet. Clone it, then try again.", "details"),
  E_LAUNCH_ENV_MISSING: said("The chosen launch configuration can’t start on this machine.", "change-options"),
  E_LAUNCH_EXECUTABLE: said("The chosen launch configuration can’t start on this machine.", "change-options"),
  E_LAUNCH_PROBE_UNSUPPORTED: said("The chosen launch configuration can’t be checked safely.", "change-options"),
  E_LAUNCH_CONFIG_UNKNOWN: said("That launch configuration no longer exists.", "change-options"),
  E_LAUNCH_CONFIG_AMBIGUOUS: said("This machine has more than one launch configuration for this soul’s harness, and none is the default.", "change-options"),
  E_HARNESS_UNAVAILABLE: said("The harness this soul would run isn’t installed on this machine.", "change-options"),
  E_LAUNCH_PREFERENCE_UNMATCHED: said("This machine’s launch preferences name a soul this workspace doesn’t offer, so OATS won’t choose a launch for this soul.", "change-options"),
  E_MODEL_UNKNOWN: said("That model isn’t available for this harness. Pick another model, or keep the default."),
  E_INSTANCE_NAME_INVALID: said("Use lowercase letters, numbers and dashes, at most 64 characters, and don’t reuse a soul’s name."),
  E_INSTANCE_NAME_TAKEN: said("An instance with this name already exists. Choose another name."),
  E_PACKAGE_MISSING: said("A package this soul uses isn’t installed yet.", "sync-workspace"),
  E_PACKAGE_INTEGRITY: said("A package this soul uses no longer matches the lock.", "sync-workspace"),
  // The bb session provider's own refusal (the harness interface, point 2): the plugin's words, WORDS.md.
  E_BACKEND_HARNESS: said("bb can’t run the harness this soul would use.", "change-options"),
  E_PLAN_CHANGED: said("The workspace changed while this was loading.", "review-again"),
};
const PREVIEW_FACTS: Record<string, Said> = {
  // From OATS 0.70.1 a preview asks the session provider's own check, so it can refuse as the spawn does: bb cannot run this agent as chosen
  // (a harness whose bb provider is not installed). Nothing was started; the provider's own words are the detail.
  E_BACKEND_NOT_READY: said("bb isn’t ready to launch this agent as chosen.", "change-options"),
  OATS_TIMEOUT: said("OATS took too long to work out this soul’s defaults. Try again."),
};
const PREVIEW_FAILED = said("OATS couldn’t work out this soul’s defaults.", "details");
const SPAWN_FACTS: Record<string, Said> = {
  E_DECISION_STALE: said("Something changed before the spawn went through. Nothing was created.", "review-again"),
  E_IDEMPOTENCY_CONFLICT: said("Something changed before the spawn went through. Nothing was created.", "review-again"),
  E_PLACEMENT_TAKEN: said("Another spawn just took this name. Nothing was created.", "review-again"),
  E_INTENT_EXPIRED: said("This spawn request expired. Check the instance list before spawning again."),
  E_PREFLIGHT_INCOMPLETE: said("OATS couldn’t finish checking this spawn. Try again."),
  E_BACKEND_UNAVAILABLE: said("That session backend isn’t installed on this machine.", "change-options"),
  // The bb session provider's own refusal at the launch: bb cannot run this agent yet, and the kernel rolls the spawn back
  // (test/fixtures/spawn/spawn-pi-refused.json, the real kernel's). The plugin's words (WORDS.md).
  E_BACKEND_NOT_READY: said("bb isn’t ready to launch this agent, so the spawn was rolled back. Nothing was created. Details says what bb needs."),
  E_INSTANCE_GONE: said("The instance that was created isn’t there anymore. Check the instance list."),
  E_OUTCOME_UNKNOWN: said("We couldn’t confirm whether the instance was created.", "check-result"),
  E_SPAWN_INCOMPLETE: said("The instance was created but didn’t finish starting. Open it from the instance list instead of spawning again."),
  E_INPUT_PREPARATION: said("The opening instruction couldn’t be prepared, so nothing was started. Try again."),
  OATS_TIMEOUT: said("OATS took too long to answer. The instance may already exist.", "check-result"),
  // A spawn whose `oats` ended with no answer the plugin can read, or whose machine stopped answering: whether it created the instance is not known.
  OATS_FAILED: said("OATS ended without saying whether the instance was created.", "check-result"),
  OATS_NOT_JSON: said("OATS ended without saying whether the instance was created.", "check-result"),
  HOST_UNREACHABLE: said("The machine stopped answering before OATS said whether the instance was created.", "check-result"),
  PLUGIN_RPC_FAILED: said("The plugin’s server stopped answering before OATS said whether the instance was created.", "check-result"),
  E_SANDBOX_PLACEMENT: said("This soul runs in a sandbox, which a confirmed spawn can’t reach yet. Nothing was created. Spawn it with oats spawn in a terminal, or from a schedule.", "details"),
  E_INTERRUPTED: said("The spawn was interrupted while its worktree was being set up, and was rolled back. Nothing was created."),
  E_REQUIRED_HOOK_FAILED: said("A capability couldn’t set up the worktree, so the spawn was rolled back. Nothing was created.", "details"),
};
const SPAWN_FAILED = said("OATS couldn’t complete the spawn.", "details");

// The plugin's words for the act that follows, after the fact. They name the form's own controls
// (Spawn, Details, the fields above), as the Desktop's name the Desktop's (spawn-words.mjs).
const NEXT: Record<Exclude<SpawnNext, null | "change-options">, string> = {
  "review-again": "Check the values and press Spawn again.",
  "check-result": "Press Check result: it asks OATS again, and starts nothing twice.",
  "update-oats": "Update OATS, then open this form again.",
  "sync-workspace": "Run oats sync in the deployment, then try again.",
  details: "Try again, or see Details.",
  "open-from-list": "Open it from the sidebar.",
};
// The form has no Developer settings yet (they come in a later change), so no sentence sends a
// person there: where the Desktop says "… in Developer settings", these name what the form has.
const CHOOSE_ANOTHER = "Pick a harness above, or see Details.";
const BY_CODE: Record<string, string> = {
  E_BAD_ARGS: "Check the values above.",
  E_CHILD_SPAWNS_DISABLED: "Pick another one, or choose Independent.",
  E_BRANCH_EXISTS: "Its name comes from the agent’s: choose another name.",
  E_LAUNCH_ENV_MISSING: CHOOSE_ANOTHER,
  E_LAUNCH_EXECUTABLE: CHOOSE_ANOTHER,
  E_LAUNCH_PROBE_UNSUPPORTED: CHOOSE_ANOTHER,
  E_LAUNCH_CONFIG_UNKNOWN: CHOOSE_ANOTHER,
  E_LAUNCH_CONFIG_AMBIGUOUS: "Pick a harness above, or make one of them the default with oats launch-config on that machine.",
  E_HARNESS_UNAVAILABLE: "Install it, or pick another harness above.",
  E_BACKEND_HARNESS: "Pick one of the harnesses above.",
  E_BACKEND_NOT_READY: "Details says what bb needs; or pick another harness above.",
  E_LAUNCH_PREFERENCE_UNMATCHED: "To spawn now, pick a harness above. To fix it for every spawn, correct the preference (Details).",
};
/** The tails that send a person to the Harness field: said only where the form has one (several harnesses to choose from). */
const HARNESS_TAILS: ReadonlySet<string> = new Set(["E_BACKEND_NOT_READY", "E_LAUNCH_ENV_MISSING", "E_LAUNCH_EXECUTABLE", "E_LAUNCH_PROBE_UNSUPPORTED", "E_LAUNCH_CONFIG_UNKNOWN", "E_LAUNCH_CONFIG_AMBIGUOUS", "E_HARNESS_UNAVAILABLE", "E_BACKEND_HARNESS", "E_LAUNCH_PREFERENCE_UNMATCHED"]);
const NO_HARNESS_FIELD: Record<string, string> = {
  E_BACKEND_NOT_READY: "Details says what bb needs.",
  E_HARNESS_UNAVAILABLE: "Install it on that machine.",
  E_LAUNCH_CONFIG_AMBIGUOUS: "Make one of them the default with oats launch-config on that machine.",
  E_LAUNCH_PREFERENCE_UNMATCHED: "Correct the preference (Details).",
};
const SEE_DETAILS = "See Details.";

// Sentences that go on after a dash, in lower case: the fact's full stop gives way to " — ".
const DASHED: Record<string, readonly [SpawnNext, string]> = {
  E_DECISION_STALE: ["review-again", "check the updated values and press Spawn again."],
  E_IDEMPOTENCY_CONFLICT: ["review-again", "check the updated values and press Spawn again."],
  E_PLACEMENT_TAKEN: ["review-again", "check the new name and press Spawn again."],
  E_CLONE_MISSING: ["details", "Details shows how."],
  E_SANDBOX_PLACEMENT: ["details", "Details says what to do instead."],
};

/** A refusal as the form says it: the sentence (what happened, then what to do), its code, and the kernel's own message for Details. */
export type SpawnProblem = { sentence: string; next: SpawnNext; code: string; detail: string | null };
/**
 * `stage`: "preview" (working out what would be created) or "spawn" (after the press). A code the
 * tables do not know reads the stage's general sentence, with its own code. A harness that is not
 * installed is said as the kernel words it, through the display filter (the table's sentence when
 * the filter leaves nothing of it, or withholds it). `harnessField`: whether the form shows a
 * Harness field (the provider declares several): a sentence sends a person there only when it does.
 */
export function spawnProblem(reason: { code: string | null; message: string | null }, stage: "preview" | "spawn" = "preview", { harnessField = true }: { harnessField?: boolean } = {}): SpawnProblem {
  const code = reason.code ?? "OATS_FAILED";
  const message = reason.message === null ? "" : reason.message.trim();
  const kernelLine = code === "E_HARNESS_UNAVAILABLE" ? displayLine(message) : null;
  const kernelWords = kernelLine !== null && kernelLine !== "" && kernelLine !== DETAIL_WITHHELD ? said(kernelLine, "change-options") : null;
  const facts = stage === "spawn" ? SPAWN_FACTS : PREVIEW_FACTS;
  // A failure with no code at all reads the stage's general sentence: only a code says what happened.
  const general = stage === "spawn" ? SPAWN_FAILED : PREVIEW_FAILED;
  const words = reason.code === null ? general : (kernelWords ?? facts[code] ?? COMMON_FACTS[code] ?? general);
  const dashed = Object.hasOwn(DASHED, code) && DASHED[code]![0] === words.next ? DASHED[code]![1] : null;
  const tail = BY_CODE[code] ?? null;
  const after = words.next === null ? null : words.next !== "change-options" ? NEXT[words.next] : tail !== null && !harnessField && HARNESS_TAILS.has(code) ? (NO_HARNESS_FIELD[code] ?? SEE_DETAILS) : tail;
  const sentence = dashed !== null ? `${words.fact.replace(/\.$/, "")} — ${dashed}` : after === null ? words.fact : `${words.fact} ${after}`;
  return { sentence, next: words.next, code, detail: message === "" ? null : message };
}
