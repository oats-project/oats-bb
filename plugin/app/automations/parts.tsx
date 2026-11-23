// What the Automations page adds to the plugin's shared patterns (app/ui.tsx): a list of facts
// from rows of data, built from them, and the quote treatment for text that is neither the
// kernel's nor the plugin's. Everything a workspace file or a trigger source supplied is drawn as
// text: no markup, no link and no title is ever made from it.
import { useId } from "react";
import { Fact, Facts } from "../ui";

/**
 * A text whose words are tokens (an id, a path, a label, a flag, an account), each kept whole: a
 * word moves to the next line as it is, so a line never ends inside one, not even at a hyphen
 * ("oats-product-" / "expert"); only a word longer than the line itself is broken. The text read
 * and copied is the text given, its words a space apart. Each word is marked `data-token`, which
 * is what the live checks look at.
 */
export function Tokens({ text }: { text: string }) {
  const words = text.split(" ");
  return (
    <>
      {words.map((word, at) => (
        <span key={at}>
          <span data-token="" className="inline-block max-w-full break-words align-bottom">
            {word}
          </span>
          {at < words.length - 1 ? " " : null}
        </span>
      ))}
    </>
  );
}

export type FactRow = readonly [label: string, value: string | null | undefined, title?: string | null];
/** Facts from rows of data: one with nothing to say is left out, and with none there is no list. `title` is the whole of a value shown short (a commit id). */
export function FactList({ facts }: { facts: readonly FactRow[] }) {
  const shown = facts.filter((fact): fact is readonly [string, string, (string | null)?] => typeof fact[1] === "string" && fact[1] !== "");
  if (shown.length === 0) return null;
  return (
    <Facts>
      {shown.map(([label, value, title]) => (
        <Fact key={label} label={label} title={title ?? undefined}>
          <Tokens text={value} />
        </Fact>
      ))}
    </Facts>
  );
}

export type QuoteLine = { label?: string | null; text: readonly (string | null)[]; note?: string | null };
/**
 * The quote treatment: text that is neither the kernel's nor the product's is shown as data,
 * never as one of the product's sentences. A lead-in in the product's words names whose text it
 * is, then each text is its own line in a quote style (monospace, a rule at its side). The
 * difference is carried by the typeface, the rule and the lead-in, not by colour. `label` is what
 * a line is about (a kernel-checked identifier) and `note` the product's remark on it: neither is
 * the quoted party's text. Nothing shown here is evidence of identity or authority for an act.
 */
export function Quote({ leadIn, lines, testId }: { leadIn: string; lines: readonly QuoteLine[]; testId?: string }) {
  const leadId = useId();
  const shown = lines
    .map((line) => ({ label: line.label ?? null, texts: line.text.filter((text): text is string => text !== null && text !== ""), note: line.note ?? null }))
    .filter((line) => line.label !== null || line.texts.length > 0 || line.note !== null);
  if (shown.length === 0) return null;
  return (
    <div role="group" aria-labelledby={leadId} data-testid={testId} className="flex min-w-0 flex-col gap-1">
      <p id={leadId} className="text-xs text-muted-foreground">
        {leadIn}
      </p>
      <ul className="flex min-w-0 flex-col gap-1.5">
        {shown.map((line, at) => (
          <li key={at} className="flex min-w-0 flex-col gap-0.5">
            {line.label === null ? null : <span className="break-words font-mono text-xs font-semibold text-foreground">{line.label}</span>}
            {line.texts.map((text, index) => (
              <blockquote key={index} className="break-words border-l-2 border-border pl-2 font-mono text-xs text-foreground">
                {text}
              </blockquote>
            ))}
            {line.note === null ? null : <span className="break-words text-xs text-muted-foreground">{line.note}</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}
