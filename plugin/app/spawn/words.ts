// The New agent form's words. The Desktop's, from its spawn dialog (awebai/oats at 3d834aa3c:
// packages/desktop/renderer/spawn-dialog.mjs), wherever it has them; plugin/WORDS.md holds each
// one that differs, and why. Pure: no bb, no React.
import { INSTANCE_NAME } from "../../kernel/input";
import type { SpawnRelation } from "../../contract/spawn";

export const TITLE = "New agent";
/** The Desktop's dialog title, once a soul is chosen. */
export const titleFor = (soul: string, workspace: string | null): string => (workspace === null || workspace === "" ? `Spawn ${soul}` : `Spawn ${soul} in ${workspace}`);

export const SOUL_LABEL = "Soul";
export const CHOOSE_SOUL = "Choose a soul…";
export const READING_SOULS = "Reading the souls…";
export const READING_HARNESSES = "Reading the harnesses…";
export const FILTER_SOULS = "Filter souls";
export const FILTER_HARNESSES = "Filter harnesses";
export const FILTER_INSTANCES = "Filter instances";
export const FILTER_MODELS = "Filter models";
/** The harness list could not be read: nothing can be chosen, the soul's default still spawns, and Retry reads it again. */
export const harnessesFailed = (code: string | null): string => `The harnesses bb can run could not be read${code === null ? "" : ` (${code})`}. A spawn uses the soul’s default until they are.`;
export const RETRY_HARNESSES = "Read the harnesses again";
/** Under the harness's first entry (the Desktop's detail). */
export const HARNESS_DEFAULT_DETAIL = "What this soul launches with unless you choose";
export const NO_SOULS = "This workspace lists no soul to spawn.";
export const soulUnknown = (soul: string): string => `OATS lists no soul “${soul}” in this deployment. Choose one of these.`;
export const SOUL_CANNOT = "This soul can’t be spawned.";

export const TASK_LABEL = "Opening instruction";
export const TASK_PLACEHOLDER = "What should this instance do? Empty starts it waiting for you.";

export const HARNESS_LABEL = "Harness";
export const MODEL_LABEL = "Model";
/** Under the model, when the kernel resolved none for the harness: bb decides, unless a person does. */
export const modelUnset = (harness: string): string => `No model is set for ${harness} here, so bb starts it on its own default. Choose one to decide it.`;
export const MODEL_CUSTOM = "Custom…";
export const MODEL_CUSTOM_LABEL = "Model ID";
export const MODEL_CUSTOM_PLACEHOLDER = "Type a model ID";
/** The first entry said with what the kernel resolved: "Default · claude-opus-5-5". */
export const modelDefaultLabel = (first: string, model: string | null | undefined): string => (model === undefined ? first : `${first} · ${model ?? "harness's own"}`);

export const RELATION_LABEL = "Relationship";
export type RelationKind = "unrelated" | SpawnRelation["kind"];
export const RELATIONS: readonly { id: RelationKind; label: string }[] = [
  { id: "unrelated", label: "Independent" },
  { id: "child", label: "Child of" },
  { id: "sibling", label: "Sibling of" },
  { id: "parent", label: "Parent of" },
];
export const WHICH_INSTANCE = "Which instance";
export const CHOOSE_INSTANCE = "Choose an instance…";
/** The accessible name of the instance choice: "Child of which instance?". */
export const whichInstance = (kind: RelationKind): string => (kind === "unrelated" ? "Which instance" : `${kind[0]!.toUpperCase()}${kind.slice(1)} of which instance?`);
/** The line under the relationship: what it is now. */
export function relationLine(kind: RelationKind, to: string): string {
  if (kind === "unrelated") return "Independent — not linked to another instance.";
  return to === "" ? `Pick the instance this one is a ${kind} of.` : `Spawns as a ${kind} of ${to}.`;
}
export const NO_INSTANCES = "There is no instance to relate it to yet.";

export const NAME_LABEL = "Name";
export const NAME_PLACEHOLDER = "e.g. pricing-page-lead";
export const NAME_EMPTY = "Left empty, the kernel numbers it.";
export const NAME_MAX = 63;
/**
 * What is wrong with a typed name, said as the fault (the second UX read, B25: "the refusal states
 * the rule, not the fault"); null for a name the kernel's rule takes. `name` is as it will be
 * sent: trimmed and in lower case.
 */
export function nameFault(name: string): string | null {
  if (name === "" || INSTANCE_NAME.test(name)) return null;
  if (name.length > NAME_MAX) return `This name has ${name.length} characters. A name has ${NAME_MAX} at most: shorten it.`;
  const bad = /[^a-z0-9-]/u.exec(name)?.[0];
  if (bad !== undefined) return `${/\s/u.test(bad) ? "A space" : `“${bad}”`} can’t be in a name. Use letters, digits and dashes.`;
  return "A name starts with a letter or a digit, not a dash.";
}
/** What is typed, as it is sent as `--name`: exactly as typed, in lower case (the Desktop's rule). */
export const nameSent = (typed: string): string => typed.trim().toLowerCase();

export const MODE_LINE = "Runs in bb's full mode: no sandbox.";

/** The machine the agent runs on: the Desktop's fact (its "Where to run" is a control; here it is the machine that holds the deployment). */
export const RUNS_ON = "Runs on";
export const COLUMN_TITLE = "What will be created";
export const COLUMN_NO_SOUL = "Choose a soul to see what will be created.";
export const COLUMN_FIX_FIRST = "Shown once the values above can be used.";
export const READING = "Reading defaults…";
export const UPDATING = "Updating…";
export const WARNING_TITLE = "OATS warns";
export const REFUSED_TITLE = "This can’t be spawned as it is";

export const SPAWN = "Spawn";
export const SPAWNING = "Spawning…";
export const CHECK_RESULT = "Check result";
export const CANCEL = "Cancel";
/** The button once the agent is made (the Desktop's). */
export const CREATED = "Created";
export const createdTitle = (name: string): string => `Created ${name}`;
export const OPENING = "Opening its thread…";
export const openAgent = (name: string): string => `Open ${name}`;
/** Cancel's word once the agent is made: there is nothing left to cancel. */
export const CLOSE = "Close";
/** In a refusal that says the values moved, once the preview was read again. */
export const READ_AGAIN = "“What will be created” was read again: it shows the values as they are now.";
export const inProgress = (soul: string): string => `A spawn of ${soul} is in progress.`;
export const SPAWN_FAILED_TITLE = "The agent was not spawned";
export const SPAWN_UNKNOWN_TITLE = "It is not known whether the agent was spawned";
export const SPAWN_INCOMPLETE_TITLE = "The agent was created, and its start is not complete";
/** The button once an instance exists whose start did not finish (the Desktop's). */
export const INCOMPLETE = "Spawn incomplete";

/** Why Spawn is off, beside it (the standard: a disabled button says why). */
export const OFF = {
  soul: "Choose a soul first.",
  cannot: "This soul can’t be spawned: its field says why.",
  name: "The name can’t be used: its field says why.",
  model: "Type the model ID, or choose Default.",
  relation: "Pick the instance first, or choose Independent.",
  refused: "OATS refused these values: “What will be created” says why.",
} as const;
