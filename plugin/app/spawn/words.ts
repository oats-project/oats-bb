// The New agent form's words. The Desktop's, from its spawn dialog (awebai/oats at 3d834aa3c:
// packages/desktop/renderer/spawn-dialog.mjs), wherever it has them; plugin/WORDS.md holds each
// one that differs, and why. Pure: no bb, no React.
import { INSTANCE_NAME } from "../../kernel/input";
import type { SpawnRelation } from "../../contract/spawn";

/** The page's name, for a screen reader: bb's bar over the page says it in view, and the Soul field says the soul. */
export const TITLE = "New agent";

export const SOUL_LABEL = "Soul";
export const CHOOSE_SOUL = "Choose a soul…";
/** A deployment whose workspace does not have the bb session provider: the form's ONE line (ruled). The kernel's own sentence and code are under its Details. */
export const NO_BB = "bb is not set up for this workspace.";
/** The Model field where a model is required and nothing is its default: what it wants, as the Soul field says it. */
export const CHOOSE_MODEL = "Choose a model…";
export const READING_SOULS = "Reading the souls…";
export const READING_HARNESSES = "Reading the harnesses…";
/** A long list's filter: its placeholder and its name. The field it is in says what it filters. */
export const FILTER = "Filter";
export const NO_MATCH = "No match.";
/** The harness list could not be read: nothing can be chosen, the soul's default still spawns, and Retry reads it again. */
export const HARNESSES_FAILED = "Harnesses could not be read: the soul’s default is used.";
export const RETRY_HARNESSES = "Retry";
export const NO_SOULS = "This workspace lists no soul to spawn.";
export const soulUnknown = (soul: string): string => `OATS lists no soul “${soul}” in this deployment. Choose one of these.`;
export const SOUL_CANNOT = "This soul can’t be spawned.";

export const TASK_LABEL = "Opening instruction";
export const TASK_PLACEHOLDER = "What should it do?";

export const HARNESS_LABEL = "Harness";
export const MODEL_LABEL = "Model";
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
export const CHOOSE_INSTANCE = "Choose an instance…";
/** The accessible name of the instance choice: "Child of which instance?". */
export const whichInstance = (kind: RelationKind): string => (kind === "unrelated" ? "Which instance" : `${kind[0]!.toUpperCase()}${kind.slice(1)} of which instance?`);
export const NO_INSTANCES = "There is no instance to relate it to yet.";

export const NAME_LABEL = "Name";
export const NAME_PLACEHOLDER = "e.g. pricing-page-lead";
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

/** The machine the agent runs on: the Desktop's fact (its "Where to run" is a control; here it is the machine that holds the deployment). */
export const RUNS_ON = "Runs on";
export const COLUMN_TITLE = "What will be created";
/** The column's one fold: the rows a person does not decide on. */
export const COLUMN_DETAILS = "Details";
export const READING = "Reading…";
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
/** The same, as a notification that stays when the thread opens. */
export const createdNotice = (name: string): string => `Created ${name}.`;
/** In the notification of an unknown outcome, for a person who left the form: there is no Check result where they are. */
export const UNKNOWN_AWAY = "Check the sidebar before spawning again.";
export const openAgent = (name: string): string => `Open ${name}`;
/** The agent was made, and its thread failed at its start in bb: the result's title, and the notification's for a person who left the form. Never "Created". */
export const didNotStart = (name: string): string => `${name} did not start`;
/** The one way on from it: the agent's own page (its Start offers the harness and the model). */
export const OPEN = "Open";
/** Cancel's word once the agent is made: there is nothing left to cancel. */
export const CLOSE = "Close";
export const SPAWN_FAILED_TITLE = "The agent was not spawned";
export const SPAWN_UNKNOWN_TITLE = "It is not known whether the agent was spawned";
export const SPAWN_INCOMPLETE_TITLE = "The agent was created, and its start is not complete";
export const SPAWN_UNCONFIRMED_TITLE = "The spawn was refused, and could not be undone completely";
/** The title of what a press came to, by what is known of the instance (model/spawn.ts `SpawnOutcome`). */
export const FAILURE_TITLE = { refused: SPAWN_FAILED_TITLE, unconfirmed: SPAWN_UNCONFIRMED_TITLE, created: SPAWN_INCOMPLETE_TITLE, unknown: SPAWN_UNKNOWN_TITLE } as const;
