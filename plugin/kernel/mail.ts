// `oats operation run messaging:mail --home <abs> --arg limit=50 [--arg cursor=…] --json`: an agent's
// own mail, read without acknowledging anything. It is the read the OATS Desktop's mail sheet makes
// (awebai/oats packages/desktop/docs/desktop-mail-sheet.md, "Reading never acknowledges"), answered
// by the agent's messaging layer (oats.aweb: `mailApi: 1`): the provider runs only `aw version`,
// `aw whoami`, `aw mail threads` and `aw mail show`, and says `acknowledges: false`.
//
// The decoder below is the Desktop's (`mailAnswer` of packages/client/mail-contract.mjs, read at
// awebai/oats 7355f353407fb288c4e175e6d3593c1a83268867), rule for rule: the shapes are closed (an
// unknown key, a value outside its set, a list past its bound is the whole answer unreadable), and
// an answer that does not say `acknowledges: false` is refused WHOLE: the plugin never shows mail
// that a read may have marked read.
//
// ONE NAMED DIFFERENCE from the Desktop's decoder (bb-plugin-specialist's ruling, 2026-11-25): a
// body over the contract's 16 KiB is not the whole page unreadable here. The adapter cuts it at
// 16 KiB, at a character's boundary, and marks the message shortened. (oats.aweb cuts such a body
// itself and says `truncated: true`: `test/fixtures/mail/mail.json` holds one. The cut here acts
// only on an answer that breaks the bound.) A message is marked shortened too where the display
// filter cut one of its lines at 2048 characters, or the body had more than MAIL_BODY_LINES lines.
//
// A SECOND DIFFERENCE, found on the recorded answers: the Desktop's decoder wants every identity's
// `alias` and `identity` non-empty, and oats.aweb 1.48.0 answers both as "" for an identity it
// could not read (`identity-missing`, `identity-unreadable`: lib/mail-read.mjs, `s.self?.alias ?? ""`).
// Read by that rule, the very answer that says "this team's mail can't be read" is unreadable
// whole. Here an identity WITH an error may have them empty (the plugin draws neither); one
// without an error may not.
//
// What leaves this module is what the plugin draws, and nothing else of a message but a key the
// app only compares (a hash of the message's team and id, made here: neither crosses): RECEIVED mail
// only, each text through the display filter (model/text.ts) on the machine, before it leaves it:
// a sender's alias, a subject and a team as one display line each, a body LINE BY LINE (a line that
// looks like a credential reads "[withheld]"; the others show). Mail is other people's text: no
// function here logs, throws with, or names a body.
import { z } from "zod";
import { DETAIL_WITHHELD, MAX_DISPLAY_LINE, displayLine, shown } from "../model/text.js";
import { checkHome } from "./input.js";
import { codes, err, ok, type Result } from "./result.js";
import type { Runner } from "./runner.js";

export const MAIL_OPERATION = "messaging:mail";
/** What one read asks for: the contract's default page. */
export const MAIL_PAGE = 50;
/** The most messages one answer may hold (the contract's). */
export const MAIL_MAX_MESSAGES = 200;
/** A body's bound, in UTF-8 bytes. */
export const MAIL_BODY_BYTES = 16 * 1024;
/** The most body lines one message carries to the app: a body of 16 KiB of line breaks is not sixteen thousand rows. */
export const MAIL_BODY_LINES = 2000;
/**
 * How long one read may run. The provider stops starting `aw` calls after 150 s and answers what it
 * has, inside the kernel's own 240 s bound for an operation: the plugin waits a little past the
 * provider's budget, so that a slow read is the provider's answer and not a stopped process.
 * For this limit to be the one that ends a slow read, the host verb is NOT one bb retries
 * (contract/mail.ts says why) and the host call's own limit is longer (server/mail.ts).
 */
export const MAIL_TIMEOUT_MS = 170_000;

const VERIFICATIONS = ["verified", "unverified", "failed", "unknown"];
const PRIORITIES = ["normal", "high", "unknown"];
const DIRECTIONS = ["received", "sent"];
const PARTIAL_OLDEST_FIRST = "oldest-first-only";
const UNREADABLE = "unreadableConversations";

const MAIL_KEYS = ["mailApi", "acknowledges", "observedAt", "identities", "messages", "conversations", "hasMore", "nextCursor"];
const IDENTITY_KEYS = ["team", "alias", "identity", "primary", "error"];
const MESSAGE_KEYS = ["id", "conversationId", "threadTitle", "direction", "team", "from", "to", "subject", "body", "truncated", "createdAt", "readByAgent", "encrypted", "verification", "priority"];
const PARTY_KEYS = ["alias", "address", "identity"];
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:\d{2})$/;

type Row = Record<string, unknown>;
const record = (value: unknown): value is Row => !!value && typeof value === "object" && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
const exact = (value: unknown, keys: readonly string[]): value is Row => record(value) && Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
const text = (value: unknown, empty = false): value is string => typeof value === "string" && (empty || value.length > 0);
/** An opaque provider value (an id, a label, an alias): any non-empty string, never parsed. */
const opaque = (value: unknown): value is string => text(value);
const iso = (value: unknown): value is string => typeof value === "string" && value.length <= 40 && ISO.test(value) && !Number.isNaN(Date.parse(value));

const party = (value: unknown): boolean => exact(value, PARTY_KEYS) && opaque(value.alias) && (value.address === null || opaque(value.address)) && opaque(value.identity);
function identity(value: unknown): boolean {
  const listed = record(value) && Object.hasOwn(value, UNREADABLE);
  if (listed) {
    const ids = value[UNREADABLE];
    if (!(value.error === "conversation-unreadable" && Array.isArray(ids) && ids.every(opaque))) return false;
  }
  return (
    exact(value, listed ? [...IDENTITY_KEYS, UNREADABLE] : IDENTITY_KEYS) &&
    opaque(value.team) &&
    // The second named difference: an identity the provider could not read has no alias and no
    // identity to name, and oats.aweb answers both as "" (recorded: mail-identity-missing.json).
    text(value.alias, value.error !== null) &&
    text(value.identity, value.error !== null) &&
    typeof value.primary === "boolean" &&
    (value.error === null || opaque(value.error))
  );
}
/** A message of the contract, but for its body's length: that one bound is the adapter's to cut (the named difference). */
const message = (value: unknown): boolean =>
  exact(value, MESSAGE_KEYS) &&
  opaque(value.id) &&
  (value.conversationId === null || opaque(value.conversationId)) &&
  text(value.threadTitle, true) &&
  DIRECTIONS.includes(value.direction as string) &&
  opaque(value.team) &&
  party(value.from) &&
  party(value.to) &&
  text(value.subject, true) &&
  typeof value.body === "string" &&
  typeof value.truncated === "boolean" &&
  iso(value.createdAt) &&
  typeof value.readByAgent === "boolean" &&
  typeof value.encrypted === "boolean" &&
  VERIFICATIONS.includes(value.verification as string) &&
  PRIORITIES.includes(value.priority as string);

/** A message's identity across pages: its team and its id (ids are the provider's, per identity). */
const messageKey = (row: Row): string => JSON.stringify([row.team, row.id]);

/** FNV-1a over a text's UTF-16 units, 32 bits, from a given offset basis: eight hexadecimal digits. */
function fnv(text: string, basis: number): string {
  let hash = basis;
  for (let at = 0; at < text.length; at++) {
    hash ^= text.charCodeAt(at);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}
/**
 * The key the app is given for a message: when it was sent, and 64 bits of hash of its team and
 * id, made on the machine. It is only ever compared (a list's key, the message a person opened,
 * a message already held from another page), so the provider's id and the team's label need not
 * cross, and do not. Pure and with no Node import: the contract's schemas are bundled into the
 * app with this module.
 */
const shownKey = (row: Row): string => {
  const raw = messageKey(row);
  return `${row.createdAt as string}#${fnv(raw, 0x811c9dc5)}${fnv(raw, 0x01234567)}`;
};

/** One message the agent received, as the plugin draws it. */
export const mailMessage = z.object({
  /** the message's identity across pages, opaque and only ever compared: when it was sent and a hash of its team and id */
  key: z.string(),
  /** the sender's alias, one display line */
  from: z.string(),
  /** one display line; null: the message has no subject and its thread no title */
  subject: z.string().nullable(),
  /** when it was sent, as the provider says it (ISO 8601) */
  at: z.string(),
  /** the body as display lines, line breaks kept; trailing blank lines gone */
  lines: z.array(z.string()),
  /** the provider cut the message to fit its bounds, or the adapter cut the body: at 16 KiB, at MAIL_BODY_LINES lines, or one of its lines at the display filter's 2048 characters */
  shortened: z.boolean(),
  /** what the provider says of who sent it, where it is a safety fact; null for a verified sender */
  sender: z.enum(["unverified", "failed"]).nullable(),
});
/** An identity of the agent whose mail could not be read, or not all of it: the rest of the mail still shows. */
export const mailUnread = z.object({
  /** the team's label, one display line */
  team: z.string(),
  /** how many conversations the provider names as unreadable; null where it names none */
  conversations: z.number().int().nullable(),
});
export const mailPage = z.object({
  /** the mail the agent RECEIVED on this page, newest first */
  messages: z.array(mailMessage),
  unread: z.array(mailUnread),
  /** the cursor of the page after this one; null: there is none, or none that can travel as an argument */
  older: z.string().nullable(),
});
export type MailMessage = z.output<typeof mailMessage>;
export type MailUnread = z.output<typeof mailUnread>;
export type MailPage = z.output<typeof mailPage>;

/** Whether a cursor can travel as one operation argument: one line of at most 1024 characters (the Desktop's `cursorUsable`). */
export const cursorUsable = (cursor: unknown): cursor is string => typeof cursor === "string" && cursor.length > 0 && cursor.length <= 1024 && !/[\x00-\x1f\x7f]/.test(cursor);

/**
 * THE ARGV, and the one that marks nothing read: the messaging layer's view operation, of the home
 * the kernel named, one page, with the cursor of an earlier answer or none. Never `aw`, never
 * another operation, never `conversation`. A cursor is one argv element after `--arg`, so it is
 * never read as a flag; the provider refuses one that is not its own (`E_BAD_ARGS`).
 */
export function mailArgv(home: string, cursor: string | null = null): Result<string[]> {
  const checked = checkHome(home);
  if (!checked.ok) return checked;
  if (cursor !== null && !cursorUsable(cursor)) return err(codes.invalidInput, "the cursor must be the one an earlier read of this mail answered");
  return ok(["operation", "run", MAIL_OPERATION, "--home", checked.value, "--arg", `limit=${MAIL_PAGE}`, ...(cursor === null ? [] : ["--arg", `cursor=${cursor}`]), "--json"]);
}

const unreadable = (): Result<never> => err(codes.badAnswer, "`oats operation run messaging:mail` answered mail the plugin cannot read");

/** The first `bytes` UTF-8 bytes of a text, cut at a character's boundary. */
function cutBytes(body: string, bytes: number): { text: string; cut: boolean } {
  let size = 0;
  let at = 0;
  for (const character of body) {
    const code = character.codePointAt(0) as number;
    size += code < 0x80 ? 1 : code < 0x800 ? 2 : code < 0x10000 ? 3 : 4;
    if (size > bytes) return { text: body.slice(0, at), cut: true };
    at += character.length;
  }
  return { text: body, cut: false };
}

/**
 * A body as display lines: line breaks kept (CRLF and a lone CR as one), each line through the
 * display filter by itself, so a line that looks like a credential is withheld and the others
 * show; a line with nothing to show is an empty line. Trailing blank lines go. `cut`: the body had
 * more lines than MAIL_BODY_LINES, or one of its lines was longer than the filter's one line
 * (MAX_DISPLAY_LINE, 2048 characters) and is drawn cut there.
 */
export function bodyLines(body: string): { lines: string[]; cut: boolean } {
  const all = body.replace(/\r\n?/g, "\n").split("\n");
  let cut = all.length > MAIL_BODY_LINES;
  const lines = all.slice(0, MAIL_BODY_LINES).map((line) => {
    const drawn = shown(line);
    // The display filter cuts a line at MAX_DISPLAY_LINE: a line it cut is a message shortened, and said so.
    // (A cut line is MAX_DISPLAY_LINE long, less one where the cut fell inside a surrogate pair and one where it left a space at the end.)
    if (line.length > MAX_DISPLAY_LINE && drawn !== DETAIL_WITHHELD && drawn.length >= MAX_DISPLAY_LINE - 2) cut = true;
    return drawn;
  });
  while (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  return { lines, cut };
}

/** The run's answer, decoded; an answer outside the contract is unreadable whole, and no part of it is shown. */
export function parseMail(document: unknown): Result<MailPage> {
  if (!record(document) || document.operationsApi !== 2 || document.operation !== MAIL_OPERATION) return unreadable();
  const result = document.result;
  if (!exact(result, ["documents", "mail"]) || !Array.isArray(result.documents)) return unreadable();
  const mail = result.mail;
  // `acknowledges` other than false: refused whole. A read that may have marked mail read shows nothing.
  if (!exact(mail, MAIL_KEYS) || mail.mailApi !== 1 || mail.acknowledges !== false || !iso(mail.observedAt)) return unreadable();
  if (!Array.isArray(mail.identities) || !mail.identities.every(identity)) return unreadable();
  if (!Array.isArray(mail.messages) || mail.messages.length > MAIL_MAX_MESSAGES || !mail.messages.every(message)) return unreadable();
  if (!Array.isArray(mail.conversations) || !mail.conversations.every((row) => exact(row, ["id", "partial"]) && opaque(row.id) && (row.partial === null || row.partial === PARTIAL_OLDEST_FIRST))) return unreadable();
  if (typeof mail.hasMore !== "boolean" || !(mail.nextCursor === null || opaque(mail.nextCursor))) return unreadable();
  // More to read needs the cursor that reads it.
  if (mail.hasMore && mail.nextCursor === null) return unreadable();
  const rows = mail.messages as Row[];
  if (new Set(rows.map(messageKey)).size !== rows.length) return unreadable();

  const messages = rows
    .filter((row) => row.direction === "received")
    .map((row): MailMessage => {
      const body = cutBytes(row.body as string, MAIL_BODY_BYTES);
      const { lines, cut } = bodyLines(body.text);
      const verification = row.verification as string;
      return {
        key: shownKey(row),
        from: shown((row.from as Row).alias),
        subject: displayLine(row.subject) ?? displayLine(row.threadTitle),
        at: row.createdAt as string,
        lines,
        shortened: row.truncated === true || body.cut || cut,
        // Unverified, or verification unknown: both are "not known to be who it says" (the Desktop's rule).
        sender: verification === "failed" ? "failed" : verification === "verified" ? null : "unverified",
      };
    });
  const unread = (mail.identities as Row[])
    .filter((row) => row.error !== null)
    // The provider's word for why (`error`) is not drawn, so it does not leave the machine.
    .map((row): MailUnread => ({ team: shown(row.team), conversations: Array.isArray(row[UNREADABLE]) && row[UNREADABLE].length > 0 ? row[UNREADABLE].length : null }));
  return ok({ messages, unread, older: mail.hasMore && cursorUsable(mail.nextCursor) ? mail.nextCursor : null });
}

/**
 * A refusal of the mail read with nothing of what the process PRINTED in it. The plugin's shared
 * reader (kernel/envelope.ts) says what `oats` said when its output is no JSON document: the first
 * lines of its stderr, else the first line of its stdout. For this verb that output is mail: an
 * answer that ended part-way (the process ended by a signal, a pipe closed) is one line of JSON
 * holding bodies, sent mail and addresses, and it would travel in the refusal's message, unfiltered.
 * So of those two refusals only how the process ended is kept ("`oats` exited 1", "`oats` did not
 * answer JSON"). A kernel's own refusal (`E_*`) is the kernel's sentence, which names no mail.
 */
export function withoutOutput<Value>(read: Result<Value>): Result<Value> {
  if (read.ok || (read.error.code !== codes.notJson && read.error.code !== codes.failed)) return read;
  return err(read.error.code, read.error.message.split(":")[0] ?? "");
}

export const verbs = (oats: Runner) => ({
  /** `oats operation run messaging:mail --home <abs> --arg limit=50 [--arg cursor=…] --json`: a read, and one that marks nothing read. */
  mail: async (home: string, cursor: string | null, signal?: AbortSignal): Promise<Result<MailPage>> => withoutOutput(await oats.run(mailArgv(home, cursor), parseMail, MAIL_TIMEOUT_MS, signal)),
});
