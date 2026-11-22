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

const READINESS: Sentences = {
  E_SESSION_UNKNOWN: "The selected instance is no longer reported.",
  E_AMBIGUOUS_INSTANCE: "The selected instance is ambiguous.",
  E_SOUL_UNKNOWN: "Select one local soul and its exact agents root.",
  E_HOME_MISMATCH: "The instance home no longer matches its admitted identity.",
  E_UNSUPPORTED_MODE: "Captured incarnation: readiness comes from its resolution, not current configuration.",
  E_USAGE: "The installed CLI does not support this read.",
  ...cli(
    "The installed CLI could not complete the readiness read.",
    "The readiness read timed out.",
    "The readiness read exceeded its output limit.",
    "The installed CLI returned invalid or contradictory readiness data.",
  ),
};

const ACTIVITY: Sentences = {
  E_SESSION_UNKNOWN: "The selected instance is no longer in the current roster.",
  E_AMBIGUOUS_INSTANCE: "Choose one exact instance home.",
  E_HOME_MISMATCH: "The instance home no longer matches the selected address.",
  E_NOT_IN_SCOPE: "The selected instance is outside this workspace scope.",
  E_UNSUPPORTED_MODE: "Activity is unavailable for this execution mode; no classic fallback.",
  ...cli("The installed CLI could not complete the activity read.", "The activity read timed out.", "The activity response exceeded its output limit.", "The CLI returned invalid or mismatched activity data."),
};

// The Desktop's sentence names itself ("an inspection this Desktop cannot read"): here it is the plugin that
// reads, the one word changed (WORDS.md, "The instance panel").
const UNREADABLE_INSPECTION = "The installed OATS CLI returned an inspection this plugin cannot read. Update OATS and retry.";
const SOUL: Sentences = { [codes.badAnswer]: UNREADABLE_INSPECTION, [codes.notJson]: UNREADABLE_INSPECTION };

const TABLES = { readiness: READINESS, activity: ACTIVITY, soul: SOUL } as const;
/** The server's refusal of an instance its roster no longer holds: it has no code of the kernel's. */
const NOT_IN_ROSTER = /is not an agent of this OATS deployment's current snapshot$/;
const GONE: Record<keyof typeof TABLES, string | null> = { readiness: READINESS.E_SESSION_UNKNOWN ?? null, activity: ACTIVITY.E_SESSION_UNKNOWN ?? null, soul: null };

/** The Desktop's sentence for a refusal of one of the panel's reads; null when it has none for it. */
export function refusalSentence(read: keyof typeof TABLES, code: string | null, error: string): string | null {
  if (code !== null && Object.hasOwn(TABLES[read], code)) return TABLES[read][code] ?? null;
  return NOT_IN_ROSTER.test(error) ? GONE[read] : null;
}
