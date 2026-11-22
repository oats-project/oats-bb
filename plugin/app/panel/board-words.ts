// The agent's board in a person's words, and what the view shows of it: the OATS Desktop's
// (packages/client/instance-board.mjs and packages/desktop/renderer/agent-board.mjs at awebai/oats
// 95c7b43b), and the plugin's own where bb's nature changes one (plugin/WORDS.md holds each pair:
// in bb an answer is sent as the agent's next input, where the Desktop types it on a terminal's
// input line). No bb and no React import.
import type { PanelBoard, PanelFact, PanelQuestion } from "../../kernel/panel-board";
import { shown } from "../ui/text";
import { waitedText } from "../ui/words";

export const FACTS = "Facts";
export const QUESTIONS = "Questions";
/** How many facts show before "N more". */
export const FACTS_SHOWN = 3;

// ---- facts

/** "updated just now", "updated 4 min ago", "updated 3 h ago", "updated 2 d ago", then the date; a future time reads "just now". */
export function updatedText(at: string, now: number): string {
  const ms = now - Date.parse(at);
  if (!Number.isFinite(ms)) return "";
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return "updated just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `updated ${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `updated ${h} h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `updated ${d} d ago`;
  return `updated ${new Date(Date.parse(at)).toISOString().slice(0, 10)}`;
}

/** A sparkline's points from a fact's history: the first number of each value, oldest first; null under two numbers. */
export function sparkValues(history: PanelFact["history"] | undefined): number[] | null {
  if (history === null || history === undefined) return null;
  const values: number[] = [];
  for (const entry of history) {
    const number = /-?\d+(?:[.,]\d+)?/.exec(entry.value);
    if (number !== null) values.push(Number(number[0].replace(",", ".")));
  }
  return values.length >= 2 && values.every(Number.isFinite) ? values : null;
}
/** " last 5": how many values the sparkline draws. */
export const sparkNote = (values: readonly number[]): string => `last ${values.length}`;

/**
 * The facts the list shows, in the kernel's order: `shown` (FACTS_SHOWN at most, unless unfolded),
 * `folded` (the rest) and `hidden` (those the person hid on this computer). `hiddenAt` is, by key,
 * the value a fact was hidden at: a fact whose value changed since shows again.
 */
export function factsView(facts: readonly PanelFact[], hiddenAt: ReadonlyMap<string, string>, unfolded: boolean): { shown: PanelFact[]; folded: PanelFact[]; hidden: PanelFact[] } {
  const visible: PanelFact[] = [];
  const hidden: PanelFact[] = [];
  for (const fact of facts) (hiddenAt.get(fact.key) === fact.value ? hidden : visible).push(fact);
  const cut = unfolded ? visible.length : FACTS_SHOWN;
  return { shown: visible.slice(0, cut), folded: visible.slice(cut), hidden };
}
export const moreFacts = (n: number): string => `${n} more`;
export const FOLD = "Fold";
export const hiddenFacts = (n: number): string => `${n} hidden · show`;
/** A fact as a screen reader says it: "Tests: 3 failing, updated 4 min ago". */
export const factName = (fact: PanelFact, now: number): string => `${shown(fact.label)}: ${shown(fact.value)}${fact.unit === null ? "" : ` ${shown(fact.unit)}`}, ${updatedText(fact.at, now)}`;
export const hideName = (fact: PanelFact): string => `Hide ${shown(fact.label)} on this computer`;
export const HIDE_TITLE = "Hide on this computer (u)";
/** "<agent> says:": what follows is the agent's own text. */
export const says = (name: string): string => `${name} says:`;
export const linkName = (name: string, host: string): string => `The address ${name} gives, on ${host}: show it`;
export const addressName = (name: string): string => `The address ${name} gives`;
export const OPEN_IN_BROWSER = "Open in browser";

// ---- what the board cannot show
export const BOARD_MALFORMED = "This agent's board could not be read.";
export const boardDropped = (n: number): string => `${n} ${n === 1 ? "entry" : "entries"} of this agent's board could not be shown.`;
/** What the view says for each outcome of the detail read that is no board with its history and contexts. */
export const DETAIL_NOTES = {
  failed: { history: "History could not be read.", context: "The context could not be read." },
  malformed: { history: "History came in a shape this plugin can't read.", context: "The context came in a shape this plugin can't read." },
  unsupported: { history: "This OATS sends no history.", context: "This OATS sends no context: ask the agent." },
  none: { history: "The agent has no board now.", context: "The agent has no board now." },
} as const;
export type DetailState = PanelBoard["state"] | "failed" | "reading";
export const READING_CONTEXT = "Reading the context…";
export const NO_CONTEXT = "The agent sent no context for this question.";
export const CONTEXT = "Context";

// ---- questions

/** A question's occurrence: its id and when it was asked. An id asked again is another question. */
export const occurrence = (question: Pick<PanelQuestion, "id" | "since">): string => `${question.id}@${question.since}`;
/** "question 2 of 3", or "needs you" for a single one. */
export const questionTag = (index: number, total: number): string => (total > 1 ? `question ${index + 1} of ${total}` : "needs you");
/** The zone's accessible name: "Question 2 of 3 from <name>", "A question from <name>". */
export const zoneName = (index: number, total: number, name: string): string => `${total > 1 ? `Question ${index + 1} of ${total}` : "A question"} from ${name}`;
/** "asked 4 min ago", "asked just now". */
export const askedText = (since: string, now: number): string => `asked ${waitedText(since, now)} ago`.replace("under a minute ago", "just now");
/** The index after turning by `step` among `total` questions, wrapping at the ends. */
export const turnQuestion = (index: number, step: number, total: number): number => (total > 0 ? (((index + step) % total) + total) % total : 0);
export const PREVIOUS = "Previous question";
export const NEXT = "Next question";

/**
 * What answering option `index` sends: `<id>: <option>`, one line; null when there is nothing a
 * person can see to send (no such option, or one the display filter withholds). The server makes
 * the same line from the kernel's board and sends nothing unless they are equal.
 */
export function answerLine(question: PanelQuestion, index: number): string | null {
  const option = question.options[index];
  if (option === undefined || question.withheld || question.optionsWithheld[index] === true) return null;
  return `${question.id}: ${option}`;
}

/** Whether a waiting claim says the agent's thread shows a prompt of its harness: its reason is `permission` or `question`. */
export const dialogOpen = (claim: { reason: string } | null): boolean => claim !== null && (claim.reason === "permission" || claim.reason === "question");
/** What the zone says while a harness prompt is open: the answers are off. */
export const DIALOG_NOTE = "The agent's thread is showing a prompt: answer it there first.";
/**
 * What the zone says for an agent no session provider runs (one on tmux): bb cannot see its pane,
 * so nothing is sent from here. `example` is the shown question's first answer.
 */
export const terminalNote = (example: string): string => `This agent runs in a terminal, not in a bb thread: type the answer in its terminal (for example ${example}).`;
/** The zone's key hint, for the shown question's own number keys. */
export const zoneHint = (options: number, questions: number): string => `1–${options} choose an answer${questions > 1 ? " · ← → the other questions" : ""} · c the context`;

// ---- answering
export const answerTitle = (name: string): string => `Answer ${name}?`;
export const answerHappens = (name: string): string[] => [`OATS sends this line to ${name} as its next input, and ${name} starts a turn with it.`];
export const SEND = "Send answer";
export const SENDING = "Sending the answer…";
export const SENT = "Answer sent";
export const NOT_SENT = "The answer was not sent";
/** A failure that is no refusal (a timeout, a lost answer, an unreachable machine): the input may have gone. */
export const MAYBE_SENT = "It is not known whether the answer was sent";
export const MAYBE_SENT_NEXT = "OATS did not answer, so the answer may have reached the agent. Do not send it again unless the agent asks.";
/** Whether a failure says that nothing was sent: the kernel's own refusal (`E_…`), or the plugin's before any process (no code). */
export const refusedUnsent = (code: string | null): boolean => code === null || code.startsWith("E_") || code === "INVALID_INPUT";
/** The quiet note under a question once its answer went: the question stays until the agent clears it. */
export const SENT_NOTE = "Sent to the agent as its next input. The question stays until the agent clears it.";
/** The kernel's `verified: false`: no change was seen on the session after the input, which proves nothing either way. */
export const UNVERIFIED = "OATS saw no change on the agent's session yet. That is no sign it was lost: do not send it again unless the agent asks.";

/** Why an answer was not sent, by the kernel's code; null for a code with no sentence here. */
const ANSWER_REFUSALS: Readonly<Record<string, string>> = {
  E_SESSION_PROMPT_OPEN: DIALOG_NOTE,
  E_SESSION_INPUT_QUEUED: "The agent is in the middle of a turn, so nothing was sent. Answer again when it is done.",
  E_SESSION_NOT_RUNNING: "The agent is not running, so nothing was sent. Start it, then answer.",
};
export const answerRefusal = (code: string | null): string | null => (code !== null && Object.hasOwn(ANSWER_REFUSALS, code) ? (ANSWER_REFUSALS[code] ?? null) : null);

// ---- when the detail is read again

/**
 * What the detail read (history, contexts) depends on: a fact's instant, or a question with a
 * context being asked. It is read again when this changes, never on an unchanged roster.
 */
export const detailSignature = (board: PanelBoard): string =>
  JSON.stringify([board.facts.map((fact) => [fact.key, fact.at]), board.questions.filter((question) => question.hasContext).map(occurrence)]);
/** Whether there is anything the detail read would add: a fact (its history) or a question with a context. */
export const wantsDetail = (board: PanelBoard): boolean => board.state === "ok" && (board.facts.length > 0 || board.questions.some((question) => question.hasContext));
