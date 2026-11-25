// The words of an agent's mail, each ruled by the plugin's specialist (2026-11-25) under "little
// text": WORDS.md has the pairs with the OATS Desktop's (packages/desktop/renderer/mail-sheet.mjs
// `MAIL_WORDS`). A refusal's face is ONE line; the kernel's code and sentence are under Details.
import { codes } from "../../kernel/result";
import type { MailUnread } from "../../kernel/mail";
import { count } from "../format";

export const MAIL = {
  /** the control: the tab of the agent's panel */
  tab: "Mail",
  reading: "Reading…",
  empty: "No mail.",
  refresh: "Refresh",
  retry: "Retry",
  older: "Older",
  back: "Back",
  noSubject: "(no subject)",
  unverified: "Unverified sender",
  failed: "Signature failed",
  shortened: "Shortened.",
  /** the list's accessible name */
  list: "Mail, newest first",
} as const;

/** What a message's sender is known to be, where it is a safety fact. */
export const senderWord = (sender: "unverified" | "failed" | null): string | null => (sender === null ? null : sender === "failed" ? MAIL.failed : MAIL.unverified);

const REFUSALS: Record<string, string> = {
  E_OPERATION_UNKNOWN: "Its messaging is too old for mail.",
  E_OPERATION_UNAVAILABLE: "No messaging.",
  E_AW_TOO_OLD: "aw is too old to read mail.",
  E_MAIL_UNREADABLE: "Its mail can't be read.",
  E_MAIL_TOO_LARGE: "Too much mail to read.",
  [codes.timeout]: "Reading took too long.",
};
/** Why the mail could not be read, in one line, by the refusal's code: each claims only what its code shows. */
export const refusalLine = (code: string | null): string => (code === null ? undefined : REFUSALS[code]) ?? "Mail can't be read.";

/** The code that leads a refusal as the server words it (`<code>: <message>`); null where it names none. */
export const codeOf = (error: string): string | null => /^([A-Z][A-Z0-9_]*): /.exec(error)?.[1] ?? null;

/** A team whose mail, or some of it, could not be read: one line. The provider's word for why is not drawn. */
export const unreadLine = (unread: MailUnread): string =>
  unread.conversations === null ? `${unread.team}: can't be read` : `${unread.team}: ${count(unread.conversations, "conversation")} can't be read`;
