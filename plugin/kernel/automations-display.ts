// The Desktop's one display filter (awebai/oats packages/client/display-text.mjs at a4a43220),
// ported unchanged in behaviour: free text the kernel, a trigger source or a workspace file
// supplies, as one line that is safe to show. The result is lossy and for display only: never
// evidence of identity, never authority for an action, never a name that addresses something.
// Pure: no DOM, no IO, never throws.

/**
 * Not text a one-line note may hold: control characters (C0, DEL, C1), the line and paragraph
 * separators, the bidi embeddings, overrides and isolates, the zero-width space, the word joiner,
 * the BOM and the tag characters. Every other format character is text (ZWJ, ZWNJ, LRM, RLM, ALM,
 * the soft hyphen).
 */
export const NOT_NOTE_TEXT = /[\p{Cc}\u2028\u2029\u202A-\u202E\u2066-\u2069\u200B\u2060\uFEFF\u{E0000}-\u{E007F}]/u;
const EVERY_NOT_NOTE_TEXT = new RegExp(NOT_NOTE_TEXT.source, "gu");

/**
 * Text withheld whole: secrets, credentialed URLs, C0 controls other than tab and line feed, DEL.
 * The URL alternative finds `://` first and looks behind it for the scheme, so its time grows with
 * the length of the text and not with its square (awebai/oats#976).
 */
export const UNSAFE = /[\x00-\x08\x0b-\x1f\x7f]|:\/\/(?<=[a-z][a-z0-9+.-]*:\/\/)[^\s/]*@|(?:token|authorization|password|secret|api[_ -]?key)\s*[:=]\s*\S+|(?:gh[pousr]_|github_pat_)[A-Za-z0-9_]{16,}/i;
/** What stands in for a withheld text. */
export const DETAIL_WITHHELD = "[withheld]";
export const MAX_DISPLAY_LINE = 2048;

/**
 * One line: tab, line feed and the separators each become a space, runs of spaces collapse and the
 * ends are trimmed. Every character of NOT_NOTE_TEXT still present becomes U+FFFD: replaced, never
 * dropped, so the reader sees something was withheld. Bounded to MAX_DISPLAY_LINE UTF-16 units,
 * without splitting a surrogate pair or ending on a space.
 */
function oneLine(text: string): string {
  const line = text.replace(/[\t\n\u2028\u2029]/g, " ").replace(/ {2,}/g, " ").replace(/^ | $/g, "").replace(EVERY_NOT_NOTE_TEXT, "\uFFFD");
  if (line.length <= MAX_DISPLAY_LINE) return line;
  const last = line.charCodeAt(MAX_DISPLAY_LINE - 1);
  return line.slice(0, last >= 0xd800 && last <= 0xdbff ? MAX_DISPLAY_LINE - 1 : MAX_DISPLAY_LINE).replace(/ $/, "");
}

/**
 * Text as one display line, DETAIL_WITHHELD when it is UNSAFE, or null when there is nothing to
 * show (not a string, empty, or only line breaks and spaces). UNSAFE is tested on the text as
 * given and on the line that is shown, so filtering twice equals filtering once.
 */
export function displayLine(text: unknown): string | null {
  if (typeof text !== "string" || !text) return null;
  if (UNSAFE.test(text)) return DETAIL_WITHHELD;
  const line = oneLine(text);
  return !line ? null : UNSAFE.test(line) ? DETAIL_WITHHELD : line;
}
