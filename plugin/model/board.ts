// The agent's board (the kernel's feature `instance-board`, `boardApi: 1`; OATS's
// docs/desktop-cli-api.md, "The agent's board"): the FACTS an agent keeps in a person's view and
// the QUESTIONS it asks them, as the kernel reports them on a row of `oats status --json`
// (`board`) and, with each fact's history and each question's context, on
// `oats inspect --home <h> --board --json`.
//
// One reading for every client: this is the OATS Desktop's own module
// (packages/client/instance-board.mjs), carried over rule for rule, so that what the plugin shows
// of a board, its order, its bounds and the answer it sends are the Desktop's. Pure: no DOM, no
// read, never throws.
//
// EVERY WORD OF A BOARD IS THE AGENT'S. Each text is held to the kernel's own bounds, and a value
// out of the contract drops only itself: a malformed fact or question is left out and the rest of
// the board stays. A text the display filter would withhold (a secret's shape, an address with
// credentials) is never shown, never opened and never sent as an answer.
import { NOT_NOTE_TEXT, UNSAFE } from "./text";

export const BOARD_FEATURE = "instance-board";
/** The kernel's bounds: facts per board, open questions, options per question, values kept per fact, and each text's length in code points. */
export const BOARD_LIMITS = Object.freeze({ facts: 12, questions: 9, optionsMin: 2, optionsMax: 4, history: 20, label: 40, value: 80, unit: 16, option: 60, question: 200, context: 2000, link: 512 });
/** The facts shown before the fold. */
export const FACTS_SHOWN = 3;
/** The producer of the board's own needs-input claim (reason `attention`): its message is the oldest open question. */
export const BOARD_PRODUCER = "oats.board";
/** The claim reasons that say a harness's own dialog is on the agent's screen: a screen an input's Enter answers. */
export const DIALOG_REASONS = Object.freeze(["permission", "question"]);

export type BoardLink = { href: string; host: string };
export type BoardFact = { key: string; label: string; value: string; unit: string | null; link: BoardLink | null; at: string; /** one of its texts is withheld by the display filter: it is drawn as withheld, never as written */ withheld: boolean };
export type BoardQuestion = { id: string; question: string; options: string[]; hasContext: boolean; since: string; withheld: boolean; optionsWithheld: boolean[] };
/** A row's board, read: `malformed`: the value was no board (nothing is shown from it); `dropped`: entries left out as out of the contract. Neither ever reads as "no questions". */
export type Board = { facts: BoardFact[]; questions: BoardQuestion[]; malformed: boolean; dropped: number };

const KEY = /^[a-z0-9][a-z0-9-]{0,15}$/;
const record = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const points = (text: string): number => [...text].length;
/** A one-line text of at most `max` code points: not empty, not only spaces, none of the refused characters. */
const line = (value: unknown, max: number): value is string => typeof value === "string" && value.trim() !== "" && points(value) <= max && !NOT_NOTE_TEXT.test(value);
/** The kernel's time: an ISO-8601 instant that parses. */
const instant = (value: unknown): value is string => typeof value === "string" && value.length <= 40 && /^\d{4}-\d{2}-\d{2}T/.test(value) && Number.isFinite(Date.parse(value));
/** Whether a text the agent wrote may be shown as it is: not one the display filter would withhold whole. */
const shown = (text: string): boolean => !UNSAFE.test(text);

/** An absolute `https:` address of at most 512 printable ASCII characters, with a host and no credentials; null otherwise. */
export function boardLink(value: unknown): BoardLink | null {
  if (typeof value !== "string" || value === "" || value.length > BOARD_LIMITS.link || !/^[\x21-\x7e]+$/.test(value)) return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.hostname === "" || url.username !== "" || url.password !== "") return null;
  return { href: value, host: url.hostname };
}

function fact(value: unknown): BoardFact | null {
  if (!record(value) || typeof value.key !== "string" || !KEY.test(value.key) || !line(value.label, BOARD_LIMITS.label) || !line(value.value, BOARD_LIMITS.value) || !instant(value.at)) return null;
  const unit = value.unit === null || value.unit === undefined ? null : line(value.unit, BOARD_LIMITS.unit) ? value.unit : undefined;
  const link = value.link === null || value.link === undefined ? null : (boardLink(value.link) ?? undefined);
  if (unit === undefined || link === undefined) return null;
  // An address the display filter would withhold (a token in its query, a known secret's shape) is
  // never shown, nor opened: the fact stays, with no link, like any fact the agent gave none.
  return { key: value.key, label: value.label, value: value.value, unit, link: link !== null && shown(link.href) ? link : null, at: value.at, withheld: !shown(value.label) || !shown(value.value) || (unit !== null && !shown(unit)) };
}

function question(value: unknown): BoardQuestion | null {
  if (!record(value) || typeof value.id !== "string" || !KEY.test(value.id) || !line(value.question, BOARD_LIMITS.question) || !instant(value.since)) return null;
  const options = value.options;
  if (!Array.isArray(options) || options.length < BOARD_LIMITS.optionsMin || options.length > BOARD_LIMITS.optionsMax || !options.every((option) => line(option, BOARD_LIMITS.option))) return null;
  // A text the display filter withholds is never shown, so it is never sent either (`answerText`).
  return { id: value.id, question: value.question, options: [...(options as string[])], hasContext: value.hasContext === true, since: value.since, withheld: !shown(value.question), optionsWithheld: (options as string[]).map((option) => !shown(option)) };
}

/** The first of each key (facts) or id (questions), in the kernel's order, up to `max`. */
function unique<Made>(list: readonly unknown[], make: (item: unknown) => Made | null, by: (made: Made) => string, max: number): Made[] {
  const out: Made[] = [];
  const seen = new Set<string>();
  for (const item of list) {
    if (out.length >= max) break;
    const made = make(item);
    if (made !== null && !seen.has(by(made))) {
      seen.add(by(made));
      out.push(made);
    }
  }
  return out;
}

/**
 * A row's `board`, read: facts in the order first set, questions in the order asked. Null when
 * the row has none (absent, or `null`: the home has no board file).
 */
export function boardData(value: unknown): Board | null {
  if (value === null || value === undefined) return null;
  if (!record(value)) return { facts: [], questions: [], malformed: true, dropped: 0 };
  const lists = Array.isArray(value.facts ?? []) && Array.isArray(value.questions ?? []);
  const rawFacts = Array.isArray(value.facts) ? value.facts : [];
  const rawQuestions = Array.isArray(value.questions) ? value.questions : [];
  const facts = unique(rawFacts, fact, (made) => made.key, BOARD_LIMITS.facts);
  const questions = unique(rawQuestions, question, (made) => made.id, BOARD_LIMITS.questions);
  return { facts, questions, malformed: !lists, dropped: Math.min(rawFacts.length, BOARD_LIMITS.facts) - facts.length + Math.min(rawQuestions.length, BOARD_LIMITS.questions) - questions.length };
}

export type BoardDetail =
  | { state: "ok"; facts: Map<string, { history: { value: string; at: string }[] }>; questions: Map<string, { context: string | null; since: string | null }> }
  /** the answer's board is `null`: the home has no board file */
  | { state: "none" }
  /** the answer has no board at all: an OATS without the feature */
  | { state: "unsupported" }
  /** the answer is not an inspection, or its board is not one */
  | { state: "malformed" };

/**
 * `oats inspect --home <h> --board --json`'s board, read, as one of four outcomes a view tells
 * apart (a fifth, the read refused or failed, is the caller's). The board is the answer's `board`,
 * or its `instance.board`. Each fact's `history` is oldest first, its current value last.
 */
export function boardDetailData(value: unknown): BoardDetail {
  if (!record(value)) return { state: "malformed" };
  const has = Object.hasOwn(value, "board") ? "board" : record(value.instance) && Object.hasOwn(value.instance, "board") ? "instance" : null;
  if (has === null) return { state: "unsupported" };
  const board = has === "board" ? value.board : (value.instance as Record<string, unknown>).board;
  if (board === null) return { state: "none" };
  if (!record(board) || !Array.isArray(board.facts ?? []) || !Array.isArray(board.questions ?? [])) return { state: "malformed" };
  const facts = new Map<string, { history: { value: string; at: string }[] }>();
  const questions = new Map<string, { context: string | null; since: string | null }>();
  for (const each of Array.isArray(board.facts) ? board.facts : []) {
    if (!record(each) || typeof each.key !== "string" || !KEY.test(each.key) || facts.has(each.key)) continue;
    const history = (Array.isArray(each.history) ? each.history : [])
      .filter((held): held is { value: string; at: string } => record(held) && line(held.value, BOARD_LIMITS.value) && instant(held.at))
      .slice(-BOARD_LIMITS.history)
      .map((held) => ({ value: held.value, at: held.at }));
    facts.set(each.key, { history });
    if (facts.size >= BOARD_LIMITS.facts) break;
  }
  for (const each of Array.isArray(board.questions) ? board.questions : []) {
    if (!record(each) || typeof each.id !== "string" || !KEY.test(each.id) || questions.has(each.id)) continue;
    // Its `since` too: a context is shown only under the occurrence it was read for.
    questions.set(each.id, { context: boardContext(each.context), since: instant(each.since) ? each.since : null });
    if (questions.size >= BOARD_LIMITS.questions) break;
  }
  return { state: "ok", facts, questions };
}

/**
 * A question's context: lines of text (line feed only), at most 2000 code points, none of the
 * refused characters but the line feed, and not withheld; null otherwise. Kept as the agent wrote
 * it, line breaks included: it is shown as the agent's own words, plain.
 */
export function boardContext(value: unknown): string | null {
  if (typeof value !== "string" || value.trim() === "" || points(value) > BOARD_LIMITS.context) return null;
  if (value.split("\n").some((each) => NOT_NOTE_TEXT.test(each)) || UNSAFE.test(value)) return null;
  return value;
}

/**
 * The points of a fact's small line, from its history: the numeric values (the first number in
 * each value, so "0.4312" and "41 %" both read), oldest first. Null under two numbers: a line
 * needs two points.
 */
export function sparkValues(history: readonly { value: string }[] | null | undefined): number[] | null {
  if (!Array.isArray(history)) return null;
  const values: number[] = [];
  for (const held of history) {
    const found = typeof held?.value === "string" ? held.value.match(/-?\d+(?:[.,]\d+)?/) : null;
    if (found) values.push(Number(found[0].replace(",", ".")));
  }
  return values.length >= 2 && values.every(Number.isFinite) ? values : null;
}

/**
 * The facts a place shows, in the kernel's order: `shown` (at most `limit`, unless `unfolded`),
 * `folded` (the rest of the visible ones) and `hidden` (those the person hid on this computer).
 * `hiddenKeys`: from a fact's key to the value it was hidden at: a fact whose value has changed
 * since shows again (the agent said something new).
 */
export function factsView(facts: readonly BoardFact[], hiddenKeys: ReadonlyMap<string, string> = new Map(), { unfolded = false, limit = FACTS_SHOWN }: { unfolded?: boolean; limit?: number } = {}): { shown: BoardFact[]; folded: BoardFact[]; hidden: BoardFact[] } {
  const visible: BoardFact[] = [];
  const hidden: BoardFact[] = [];
  for (const each of facts) (hiddenKeys.has(each.key) && hiddenKeys.get(each.key) === each.value ? hidden : visible).push(each);
  const cut = unfolded ? visible.length : limit;
  return { shown: visible.slice(0, cut), folded: visible.slice(cut), hidden };
}

/** A needs-input claim, as far as the board asks it. */
export type BoardClaim = { producer?: string | null; reason?: string | null } | null | undefined;
/** Whether a live claim says the agent's screen shows a harness dialog: a claim whose reason is `permission` or `question`. Unknown is not a dialog. */
export const dialogOpen = (claim: BoardClaim): boolean => record(claim) && typeof claim.reason === "string" && DIALOG_REASONS.includes(claim.reason);
/** Whether a claim is the board's own: its question is shown as a question of the board, with its options, not as a line of text. */
export const boardClaim = (claim: BoardClaim): boolean => record(claim) && claim.producer === BOARD_PRODUCER;

/**
 * What answering option `index` (0-based) of a question says to the agent: `<id>: <option>`, one
 * line, never a bare digit and never a line end (the kernel's own form: "answers arrive typed as
 * `<id>: <text>`"). Null when there is nothing a person can see to send: no such option, or an
 * option the display filter withholds.
 */
export function answerText(asked: Pick<BoardQuestion, "id" | "options" | "optionsWithheld">, index: number): string | null {
  if (!KEY.test(asked.id)) return null;
  const option = asked.options[index];
  if (!line(option, BOARD_LIMITS.option) || asked.optionsWithheld[index] === true || !shown(option)) return null;
  return `${asked.id}: ${option}`;
}

/** The index after turning by `step` (±1) among `total` questions, wrapping at the ends. */
export const turnQuestion = (index: number, step: number, total: number): number => (total > 0 ? (((index + step) % total) + total) % total : 0);

/**
 * A question's occurrence: its id and when it was asked. An id the agent clears and asks again (a
 * new `since`) is another question, with its own answer and its own context, also when no read
 * saw it cleared in between.
 */
export const questionOccurrence = (asked: Pick<BoardQuestion, "id" | "since">): string => `${asked.id}@${asked.since}`;

/**
 * What the detail (history and context) was read for: it is read again when a fact's `at` changed
 * (or a fact came or went), or a question with context was asked. Never on an unchanged read.
 */
export const detailSignature = (board: Board | null): string =>
  board === null ? "none" : JSON.stringify([board.facts.map((each) => [each.key, each.at]), board.questions.filter((each) => each.hasContext).map(questionOccurrence)]);
