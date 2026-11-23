// The one display filter for free text that OATS or an agent supplies and the plugin draws: a
// message, a description, a name inside one of the plugin's sentences. It is the OATS Desktop's
// filter (packages/client/display-text.mjs of awebai/oats, read at 95c7b43b3), kept character for
// character where it is the same thing: control characters and line breaks never reach the screen,
// a long line is cut, and a text that looks like a secret or a credentialed URL is not shown.
// The result is lossy and for display only: it is never evidence of identity, never authority for
// an action, and never what is sent back to OATS (an instance, a soul or a revision is sent as the
// kernel gave it). Pure: no bb, no React, no DOM; never throws.
import { codes, isKernelCode } from "../../kernel/result";
import { DETAIL_WITHHELD, displayLine, UNSAFE } from "../../model/text";

// The filter itself is in model/text.ts, where the kernel adapters can reach it; every name this
// file exported before is exported still.
export { cleanLine, DETAIL_WITHHELD, displayLine, MAX_DISPLAY_LINE, NOT_NOTE_TEXT, shown, shownBlock, UNSAFE } from "../../model/text";

/**
 * A code that leads a refusal as the plugin's server words it, `<code>: <message>`: the kernel's
 * (`E_…`) or one of the plugin's own (kernel/result.ts). Any other leading word is part of the
 * message, so a text that only looks like one ("TOKEN: …") is filtered whole.
 */
const OWN_CODES: ReadonlySet<string> = new Set(Object.values(codes));
const LEADING_CODE = /^([A-Z][A-Z0-9_]*): /;

/**
 * The code that leads a refusal (`<code>: <message>`), the kernel's or one of the plugin's own; null
 * when the text leads with none. It is for a place to choose its words by a code it knows, and to
 * draw it: text that leads with a code is not proof that the kernel said it.
 */
export function refusalCode(text: unknown): string | null {
  if (typeof text !== "string") return null;
  const lead = LEADING_CODE.exec(text);
  return lead !== null && (isKernelCode(lead[1]!) || OWN_CODES.has(lead[1]!)) ? lead[1]! : null;
}

/**
 * A refusal or a failure, as the lines to draw. The server words a refusal `<code>: <message>`
 * and a few messages hold several lines of the kernel's (what a retire left). The code is always
 * shown; the message goes through the filter by itself, as the Desktop filters a refusal's code
 * and its message apart: withheld whole when any of it is unsafe, else one display line per line
 * of the kernel's, so no line break reaches the screen and no line is lost.
 */
export function refusalLines(text: unknown): string[] {
  if (typeof text !== "string") return [];
  const code = refusalCode(text);
  const message = code === null ? text : text.slice(code.length + 2);
  const lines = UNSAFE.test(message)
    ? [DETAIL_WITHHELD]
    : message
        .split(/[\n\u2028\u2029]/)
        .map(displayLine)
        .filter((line): line is string => line !== null);
  if (code === null) return lines;
  const [first, ...rest] = lines;
  return first === undefined ? [code] : [`${code}: ${first}`, ...rest];
}
