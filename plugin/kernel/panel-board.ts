// The agent's board (feature `instance-board`, `boardApi: 1`; docs/desktop-cli-api.md "The agent's
// board"): the facts an agent keeps in a person's view and the questions it asks them.
//   row:    the instance's row of `oats status --json` holds the board as it is now (`board`), with
//           no history and no context: read at no command's cost;
//   detail: `oats inspect --home <abs> --board --json`, the board with each fact's history and each
//           question's context;
//   answer: `oats session input --home <abs> --text-file <f> --json`, one input and one turn, the
//           text `<id>: <option>` (interface v4, section 3b). Nothing else of the plugin calls it.
// The bounds and the rules for what may be shown are the kernel's contract, as the OATS Desktop
// reads it (packages/client/instance-board.mjs at awebai/oats 95c7b43b): a value out of the contract
// drops only itself, and what was left out is counted, so a board never reads as "no questions"
// because one entry was malformed.
import { z } from "zod";
import { NOT_NOTE_TEXT, UNSAFE } from "../app/ui/text.js";
import { shaped } from "./envelope.js";
import { checkHome } from "./input.js";
import { record, type Row } from "./panel-read.js";
import { codes, err, ok, type Result } from "./result.js";

/** The producer of the waiting claim an open board question sets. */
export const BOARD_PRODUCER = "oats.board";

/** The kernel's bounds: facts per board, open questions, options per question, history per fact, and each text. */
export const BOARD_LIMITS = { facts: 12, questions: 9, optionsMin: 2, optionsMax: 4, history: 20, label: 40, value: 80, unit: 16, option: 60, question: 200, context: 2000, link: 512 } as const;

export const panelFact = z.object({
  key: z.string(),
  label: z.string(),
  value: z.string(),
  unit: z.string().nullable(),
  /** an absolute https address with no credentials in it, and its host; null when the agent gave none, or one that may hold a secret */
  link: z.object({ href: z.string(), host: z.string() }).nullable(),
  at: z.string(),
  /** the label, the value or the unit may hold a secret: it is not shown */
  withheld: z.boolean(),
  /** oldest first; null when the kernel answered no history for this fact */
  history: z.array(z.object({ value: z.string(), at: z.string() })).nullable(),
});
export const panelQuestion = z.object({
  id: z.string(),
  question: z.string(),
  options: z.array(z.string()),
  /** the question, or an option, may hold a secret: it is neither shown nor sent */
  withheld: z.boolean(),
  optionsWithheld: z.array(z.boolean()),
  since: z.string(),
  hasContext: z.boolean(),
  /** the agent's context, as it wrote it; null when it sent none or it cannot be shown */
  context: z.string().nullable(),
});
export const panelBoard = z.object({
  /**
   * `ok`: a board; `none`: the home has no board; `unsupported`: this OATS answers no board;
   * `malformed`: the answer's board is not one.
   */
  state: z.enum(["ok", "none", "unsupported", "malformed"]),
  facts: z.array(panelFact),
  questions: z.array(panelQuestion),
  /** how many entries were left out as out of the contract */
  dropped: z.number().int(),
});
export type PanelBoard = z.output<typeof panelBoard>;
export type PanelFact = z.output<typeof panelFact>;
export type PanelQuestion = z.output<typeof panelQuestion>;

export function panelBoardArgv(home: string): Result<string[]> {
  const checked = checkHome(home);
  return checked.ok ? ok(["inspect", "--home", checked.value, "--board", "--json"]) : checked;
}

const KEY = /^[a-z0-9][a-z0-9-]{0,15}$/;
const points = (value: string): number => [...value].length;
/** A one-line text of at most `max` code points: not empty, not only spaces, none of the refused characters. */
const line = (value: unknown, max: number): value is string => typeof value === "string" && value.trim() !== "" && points(value) <= max && !NOT_NOTE_TEXT.test(value);
const instant = (value: unknown): value is string => typeof value === "string" && value.length <= 40 && /^\d{4}-\d{2}-\d{2}T/.test(value) && Number.isFinite(Date.parse(value));
const shown = (value: string): boolean => !UNSAFE.test(value);

/** An absolute https address of at most 512 ASCII characters, with a host and no credentials; else null. */
export function boardLink(value: unknown): { href: string; host: string } | null {
  if (typeof value !== "string" || value === "" || value.length > BOARD_LIMITS.link || !/^[\x21-\x7e]+$/.test(value)) return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null; // not an address
  }
  if (url.protocol !== "https:" || url.hostname === "" || url.username !== "" || url.password !== "") return null;
  return { href: value, host: url.hostname };
}

/** A question's context: lines of text, at most 2000 code points, nothing refused but the line feed, nothing that may hold a secret. */
function contextOf(value: unknown): string | null {
  if (typeof value !== "string" || value.trim() === "" || points(value) > BOARD_LIMITS.context) return null;
  return value.split("\n").some((part) => NOT_NOTE_TEXT.test(part)) || UNSAFE.test(value) ? null : value;
}

function factOf(value: unknown): PanelFact | null {
  const row = record(value);
  if (row === null || typeof row.key !== "string" || !KEY.test(row.key) || !line(row.label, BOARD_LIMITS.label) || !line(row.value, BOARD_LIMITS.value) || !instant(row.at)) return null;
  if (row.unit != null && !line(row.unit, BOARD_LIMITS.unit)) return null;
  const unit = row.unit == null ? null : (row.unit as string);
  const link = row.link == null ? null : boardLink(row.link);
  if (row.link != null && link === null) return null;
  const history = Array.isArray(row.history)
    ? row.history
        .map(record)
        .filter((entry): entry is Row => entry !== null && line(entry.value, BOARD_LIMITS.value) && instant(entry.at))
        .slice(-BOARD_LIMITS.history)
        .map((entry) => ({ value: entry.value as string, at: entry.at as string }))
    : null;
  return {
    key: row.key,
    label: row.label,
    value: row.value,
    unit,
    // An address that may hold a secret is never shown, nor opened: the fact stays, with no link.
    link: link !== null && shown(link.href) ? link : null,
    at: row.at,
    withheld: !shown(row.label) || !shown(row.value) || (unit !== null && !shown(unit)),
    history,
  };
}

function questionOf(value: unknown): PanelQuestion | null {
  const row = record(value);
  if (row === null || typeof row.id !== "string" || !KEY.test(row.id) || !line(row.question, BOARD_LIMITS.question) || !instant(row.since)) return null;
  const options = row.options;
  if (!Array.isArray(options) || options.length < BOARD_LIMITS.optionsMin || options.length > BOARD_LIMITS.optionsMax || !options.every((option) => line(option, BOARD_LIMITS.option))) return null;
  return {
    id: row.id,
    question: row.question,
    options: [...(options as string[])],
    withheld: !shown(row.question),
    optionsWithheld: (options as string[]).map((option) => !shown(option)),
    since: row.since,
    hasContext: row.hasContext === true,
    context: contextOf(row.context),
  };
}

/** The first of each key or id, in the kernel's order, up to `max`. */
function unique<Item>(list: unknown[], make: (value: unknown) => Item | null, by: (item: Item) => string, max: number): Item[] {
  const out: Item[] = [];
  const seen = new Set<string>();
  for (const value of list) {
    if (out.length >= max) break;
    const made = make(value);
    if (made !== null && !seen.has(by(made))) {
      seen.add(by(made));
      out.push(made);
    }
  }
  return out;
}

const empty = (state: PanelBoard["state"]): PanelBoard => ({ state, facts: [], questions: [], dropped: 0 });

const inspection = z.looseObject({ instance: z.looseObject({}).nullish() });

/** The board of `oats inspect --board`'s answer: its `board`, or its `instance.board`. */
export function parsePanelBoard(document: unknown): Result<PanelBoard> {
  const parsed = shaped(inspection, document, "oats inspect --board");
  if (!parsed.ok) return parsed;
  const answered = parsed.value as Row;
  const instance = record(answered.instance);
  const holder = Object.hasOwn(answered, "board") ? answered : instance !== null && Object.hasOwn(instance, "board") ? instance : null;
  return ok(boardOf(holder));
}

/** The board of an instance's row of `oats status --json`, as it is now: its facts carry no history and its questions no context. */
export const rowBoard = (row: Row): PanelBoard => boardOf(Object.hasOwn(row, "board") ? row : null);

/** `holder` is the object whose `board` is the board; null when the answer has none at all. */
function boardOf(holder: Row | null): PanelBoard {
  if (holder === null) return empty("unsupported");
  if (holder.board === null) return empty("none");
  const board = record(holder.board);
  if (board === null || !Array.isArray(board.facts ?? []) || !Array.isArray(board.questions ?? [])) return empty("malformed");
  const rawFacts = (board.facts ?? []) as unknown[];
  const rawQuestions = (board.questions ?? []) as unknown[];
  const facts = unique(rawFacts, factOf, (fact) => fact.key, BOARD_LIMITS.facts);
  const questions = unique(rawQuestions, questionOf, (question) => question.id, BOARD_LIMITS.questions);
  return {
    state: "ok",
    facts,
    questions,
    dropped: Math.min(rawFacts.length, BOARD_LIMITS.facts) - facts.length + Math.min(rawQuestions.length, BOARD_LIMITS.questions) - questions.length,
  };
}

// ---- answering a question ----

/**
 * What answering option `index` (0-based) of `question` sends: `<id>: <option>`, one line. A typed
 * error when there is nothing a person can see to send: no such option, or one that is withheld.
 */
export function answerText(question: PanelQuestion, index: number): Result<string> {
  const option = Number.isInteger(index) ? question.options[index] : undefined;
  if (option === undefined) return err(codes.invalidInput, `question ${question.id} has no option ${index + 1}`);
  if (question.optionsWithheld[index] === true || !shown(option)) return err(codes.invalidInput, `option ${index + 1} of question ${question.id} is withheld: it may hold a secret, so it is not sent`);
  return ok(`${question.id}: ${option}`);
}

/**
 * An answer's text, checked again where it is written to a file: `<id>: <option>`, one line within
 * the board's bounds, nothing that may hold a secret. The server derives it from the kernel's own
 * board; this is the host's own check of what it is handed.
 */
export function checkAnswerText(text: string): Result<string> {
  const parts = /^([a-z0-9][a-z0-9-]{0,15}): (.+)$/su.exec(text);
  // The option alone is tested for a secret's shape, as where the line is made: an id is the agent's
  // own short name ("api-key", "reset-token"), and with the ": " after it would read as one.
  if (parts === null || !line(parts[2], BOARD_LIMITS.option) || !shown(parts[2] ?? "")) return err(codes.invalidInput, "a board answer is one line, `<question id>: <option>`, within the board's bounds");
  return ok(text);
}

/** `inputFile` holds the answer's text, written by the host entry for the length of the call. */
export function boardAnswerArgv(home: string, inputFile: string): Result<string[]> {
  const checked = checkHome(home);
  return checked.ok ? ok(["session", "input", "--home", checked.value, "--text-file", inputFile, "--json"]) : checked;
}

export const panelBoardAnswer = z.object({
  /** the kernel's words: the paste and the Enter went through; never that the model took the input in */
  submitted: z.boolean(),
  /** a change was seen on the session afterwards; false is no proof that nothing happened, and no reason to send again */
  verified: z.boolean().nullable(),
});
export type PanelBoardAnswer = z.output<typeof panelBoardAnswer>;

const sent = z.looseObject({ submitted: z.boolean(), verified: z.boolean().nullish() });
export function parseBoardAnswer(document: unknown): Result<PanelBoardAnswer> {
  const parsed = shaped(sent, document, "oats session input");
  return parsed.ok ? ok({ submitted: parsed.value.submitted, verified: parsed.value.verified ?? null }) : parsed;
}
