// What the panel says, in a person's words, when one of its reads is refused or fails: the OATS
// Desktop's own sentence for the same thing, by the kernel's code or the plugin's own
// (awebai/oats at 95c7b43b: packages/client/readiness-contract.mjs `ERRORS`,
// packages/client/instance-events-contract.mjs `errors`, packages/desktop/renderer/instance-soul.mjs).
// The code is drawn after the sentence and the kernel's message stays under Details; a code with
// no sentence here has the notice's title alone. A refusal also says what to do next, and the
// notice offers Retry only where reading again can change the answer. No bb and no React import.
import { codes } from "../../kernel/result";

type Sentences = Readonly<Record<string, string>>;

/** The plugin's own codes for what the Desktop calls a failed, slow, oversized or unreadable CLI answer. */
const cli = (failed: string, timeout: string, tooLarge: string, protocol: string): Sentences => ({
  [codes.failed]: failed,
  [codes.timeout]: timeout,
  [codes.tooLarge]: tooLarge,
  [codes.badAnswer]: protocol,
  [codes.notJson]: protocol,
});

// Where the Desktop's sentence is an instruction a person cannot follow from here ("Choose one exact
// instance home.", "Select one local soul and its exact agents root."), or the kernel's own terms
// ("Captured incarnation: …"), the plugin says what happened in a person's words; plugin/WORDS.md
// holds each pair. The others are the Desktop's.
const READINESS: Sentences = {
  E_SESSION_UNKNOWN: "OATS no longer lists this agent.",
  E_AMBIGUOUS_INSTANCE: "OATS knows more than one agent by this name here, so it cannot say which one this is.",
  E_SOUL_UNKNOWN: "OATS does not list this soul in this deployment.",
  E_HOME_MISMATCH: "This agent's folder is no longer the one OATS recorded for it.",
  E_UNSUPPORTED_MODE: "OATS has no readiness check for this kind of agent.",
  E_USAGE: "The OATS installed here is too old for this. Update OATS.",
  ...cli(
    "The installed CLI could not complete the readiness read.",
    "The readiness read timed out.",
    "The readiness read exceeded its output limit.",
    "The installed CLI returned invalid or contradictory readiness data.",
  ),
};

const ACTIVITY: Sentences = {
  E_SESSION_UNKNOWN: "OATS no longer lists this agent.",
  E_AMBIGUOUS_INSTANCE: "OATS knows more than one agent by this name here, so it cannot say which one this is.",
  E_HOME_MISMATCH: "This agent's folder is no longer the one OATS recorded for it.",
  E_NOT_IN_SCOPE: "This agent is not one of this deployment's.",
  E_UNSUPPORTED_MODE: "OATS keeps no activity for this kind of agent.",
  ...cli("The installed CLI could not complete the activity read.", "The activity read timed out.", "The activity response exceeded its output limit.", "The CLI returned invalid or mismatched activity data."),
};

// The Desktop's sentence names itself ("an inspection this Desktop cannot read"): here it is the plugin that
// reads, the one word changed (WORDS.md, "The instance panel").
const UNREADABLE_INSPECTION = "The installed OATS CLI returned an inspection this plugin cannot read. Update OATS and retry.";
const SOUL: Sentences = {
  E_SESSION_UNKNOWN: "OATS no longer lists this agent.",
  E_HOME_MISMATCH: "This agent's folder is no longer the one OATS recorded for it.",
  E_UNSUPPORTED_MODE: "OATS keeps no record of what this kind of agent was spawned from.",
  [codes.badAnswer]: UNREADABLE_INSPECTION,
  [codes.notJson]: UNREADABLE_INSPECTION,
  [codes.timeout]: "OATS took too long to answer.",
  [codes.failed]: "OATS could not finish reading it.",
};

/** What a refusal of the kernel's with no sentence of its own says: that OATS refused, in words; its code and message follow. */
const REFUSED: Record<"readiness" | "activity" | "soul", string> = { readiness: "OATS refused to read readiness.", activity: "OATS refused to read the activity.", soul: "OATS refused to read what this agent was spawned from." };

const TABLES = { readiness: READINESS, activity: ACTIVITY, soul: SOUL } as const;
/** The server's refusal of an instance its roster no longer holds: it has no code of the kernel's. */
const NOT_IN_ROSTER = /is not an agent of this OATS deployment's (?:current|last) snapshot$/;
const GONE: Record<keyof typeof TABLES, string | null> = { readiness: READINESS.E_SESSION_UNKNOWN ?? null, activity: ACTIVITY.E_SESSION_UNKNOWN ?? null, soul: SOUL.E_SESSION_UNKNOWN ?? null };

/** What to do next, by the kernel's code; a code that is not here has no next step of its own. */
const NEXT: Sentences = {
  E_SESSION_UNKNOWN: "It may have been retired: the sidebar lists the agents OATS has.",
  E_NOT_IN_SCOPE: "It may have been retired or moved: the sidebar lists the agents OATS has here.",
  E_AMBIGUOUS_INSTANCE: "Retire or rename one of them with OATS, on the machine that holds them.",
  E_SOUL_UNKNOWN: "It may have been removed from the workspace: `oats souls` lists the ones there are.",
  E_HOME_MISMATCH: "`oats status`, on the machine that holds it, shows where the agent is now.",
  E_UNSUPPORTED_MODE: "There is nothing to do: OATS has none for it.",
};
/** The refusals that reading again cannot change: the notice offers no Retry for them. */
const FINAL: ReadonlySet<string> = new Set([...Object.keys(NEXT), "E_USAGE"]);

export type RefusalWords = {
  /** what happened, in a person's words; null for a failure with no code at all */
  sentence: string | null;
  /** what to do next, where there is something to say */
  next: string | null;
  /** whether reading again can help: the notice offers Retry only then */
  retry: boolean;
};

/**
 * What a person reads for a refusal of one of the panel's reads: the sentence for its code (for a
 * kernel's code with none, that OATS refused), what to do next, and whether Retry can help.
 */
export function refusalWords(read: keyof typeof TABLES, code: string | null, error: string): RefusalWords {
  const gone = code === null && NOT_IN_ROSTER.test(error);
  const known = gone ? "E_SESSION_UNKNOWN" : code;
  const sentence = gone ? GONE[read] : code !== null && Object.hasOwn(TABLES[read], code) ? (TABLES[read][code] ?? null) : code !== null && code.startsWith("E_") ? REFUSED[read] : null;
  return { sentence, next: known !== null && Object.hasOwn(NEXT, known) ? (NEXT[known] ?? null) : null, retry: known === null || !FINAL.has(known) };
}
