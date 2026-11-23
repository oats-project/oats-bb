// The display filter for free text that OATS or an agent supplies and the plugin draws, as pure
// functions below the app: the kernel adapters make a source's own words display lines on the
// machine, before they leave it, and the app draws through the same functions (app/ui/text.ts
// re-exports every name here, and says where the filter comes from). Moved from app/ui/text.ts
// with no line changed. It is the OATS Desktop's filter (packages/client/display-text.mjs of
// awebai/oats; app/ui/text.ts names the commit it was read at). This file is the shared UI's,
// like app/ui/text.ts (the roster's developer's): a change of the filter goes through its owner.
// Pure: no bb, no React, no DOM, no import from kernel/ or app/; never throws.
/**
 * Not text a one-line note may hold, an exact set (the kernel's rule for a waiting message):
 * control characters (Cc: C0, DEL, C1), the line and paragraph separators, the bidi embeddings and
 * overrides (U+202A–202E) and isolates (U+2066–2069), the zero-width space, the word joiner, the
 * BOM and the tag characters (U+E0000–E007F). Every other format character is text: ZWJ (emoji
 * sequences), ZWNJ (Persian, Urdu), LRM, RLM and ALM (Hebrew, Arabic), the soft hyphen.
 */
export const NOT_NOTE_TEXT = /[\p{Cc}\u2028\u2029\u202A-\u202E\u2066-\u2069\u200B\u2060\uFEFF\u{E0000}-\u{E007F}]/u;
const EVERY_NOT_NOTE_TEXT = new RegExp(NOT_NOTE_TEXT.source, "gu");

/**
 * Text withheld whole: secrets, credentialed URLs, C0 controls other than tab and line feed, DEL.
 * Its time grows with the length of the text, which is tested as given and may be long. So the URL
 * alternative finds `://` first and looks behind it for the scheme: written scheme first, it would
 * read a run of letters to its end from each letter of the run, and its time would grow with the
 * square of the run.
 */
export const UNSAFE =
  /[\x00-\x08\x0b-\x1f\x7f]|:\/\/(?<=[a-z][a-z0-9+.-]*:\/\/)[^\s/]*@|(?:token|authorization|password|secret|api[_ -]?key)\s*[:=]\s*\S+|(?:gh[pousr]_|github_pat_)[A-Za-z0-9_]{16,}/i;
/** What stands in for a withheld text. */
export const DETAIL_WITHHELD = "[withheld]";
export const MAX_DISPLAY_LINE = 2048;

/**
 * One line: tab, line feed and the line and paragraph separators each become a space, runs of
 * spaces collapse and the ends are trimmed. Every character of NOT_NOTE_TEXT still present becomes
 * U+FFFD: replaced, never dropped, so the reader sees that something was there. Bounded to
 * MAX_DISPLAY_LINE UTF-16 units, without splitting a surrogate pair or ending on a space.
 */
function oneLine(text: string): string {
  const line = text
    .replace(/[\t\n\u2028\u2029]/g, " ")
    .replace(/ {2,}/g, " ")
    .replace(/^ | $/g, "")
    .replace(EVERY_NOT_NOTE_TEXT, "\uFFFD");
  if (line.length <= MAX_DISPLAY_LINE) return line;
  const last = line.charCodeAt(MAX_DISPLAY_LINE - 1);
  return line.slice(0, last >= 0xd800 && last <= 0xdbff ? MAX_DISPLAY_LINE - 1 : MAX_DISPLAY_LINE).replace(/ $/, "");
}

/**
 * Text from OATS or an agent as one display line, DETAIL_WITHHELD when it is UNSAFE, or null when
 * there is nothing to show (not a string, empty, or only line breaks and spaces). UNSAFE is tested
 * on the text as given, before any folding, replacement or cut: what is withheld is withheld
 * whole. The line is what is shown, so it is held to UNSAFE as well; filtering twice therefore
 * equals filtering once.
 */
export function displayLine(text: unknown): string | null {
  if (typeof text !== "string" || !text) return null;
  if (UNSAFE.test(text)) return DETAIL_WITHHELD;
  const line = oneLine(text);
  return !line ? null : UNSAFE.test(line) ? DETAIL_WITHHELD : line;
}

/** Already a display line: what a relayed text must be before it is shown again. */
export const cleanLine = (text: unknown): boolean => typeof text === "string" && displayLine(text) === text;

/** The display line of a text, as a slot prints it: the empty string where there is nothing to show. */
export function shown(text: unknown): string {
  return displayLine(text) ?? "";
}

// Every character of NOT_NOTE_TEXT but the line feed and the tab.
const NOT_BLOCK_TEXT = /(?![\n\t])[\p{Cc}\u2028\u2029\u202A-\u202E\u2066-\u2069\u200B\u2060\uFEFF\u{E0000}-\u{E007F}]/gu;

/**
 * A person's own definition text shown back to them WHOLE, in one block that keeps its line breaks,
 * blank lines and indentation (`whitespace-pre-wrap`): a schedule's or a trigger's Prompt and Wake
 * message, as the Desktop draws them, and nothing else. It is the one named exception to the
 * one-line filter (the spec's author's decision of 2026-11-21): no cut at MAX_DISPLAY_LINE, and
 * nothing is withheld, since the text is the prompt the person wrote and must be read as written.
 * Never for a kernel's message or an agent's note: those are `shown()` and `refusalLines()`.
 * What stays of the filter: a line break is a line feed however it was written (\r\n, \r, the
 * line and paragraph separators), and every other character of NOT_NOTE_TEXT (controls, bidi
 * overrides and isolates, the zero-width space, the word joiner, the BOM, tags) is drawn as U+FFFD,
 * so a definition from a shared repository cannot reorder or hide what the page shows. '' for what
 * is not a string.
 */
export function shownBlock(text: unknown): string {
  if (typeof text !== "string") return "";
  return text.replace(/\r\n?|[\u2028\u2029]/g, "\n").replace(NOT_BLOCK_TEXT, "\uFFFD");
}
