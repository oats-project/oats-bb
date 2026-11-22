// What the panel says, in a person's words, when one of its reads is refused or fails: the OATS
// Desktop's own sentence for the same thing, by the kernel's code or the plugin's own
// (awebai/oats at 95c7b43b: packages/client/readiness-contract.mjs `ERRORS`,
// packages/client/instance-events-contract.mjs `errors`, packages/desktop/renderer/instance-soul.mjs).
// The code is drawn after the sentence and the kernel's message stays under Details; a code with
// no sentence here has the notice's title alone. No bb and no React import.
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
const NOT_IN_ROSTER = /is not an agent of this OATS deployment's current snapshot$/;
const GONE: Record<keyof typeof TABLES, string | null> = { readiness: READINESS.E_SESSION_UNKNOWN ?? null, activity: ACTIVITY.E_SESSION_UNKNOWN ?? null, soul: SOUL.E_SESSION_UNKNOWN ?? null };

/**
 * What a person reads for a refusal of one of the panel's reads: the sentence for its code; for a
 * kernel's code with none, that OATS refused; null for a failure with no code at all.
 */
export function refusalSentence(read: keyof typeof TABLES, code: string | null, error: string): string | null {
  if (code !== null && Object.hasOwn(TABLES[read], code)) return TABLES[read][code] ?? null;
  if (NOT_IN_ROSTER.test(error)) return GONE[read];
  return code !== null && code.startsWith("E_") ? REFUSED[read] : null;
}
