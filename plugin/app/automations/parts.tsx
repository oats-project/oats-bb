// What the Automations page adds to the plugin's shared patterns (app/ui.tsx), built from them:
// a list of facts from rows of data, a titled card and a titled section of a row's page, the dot
// of a placement or of the scheduler, and the quote treatment for text that is neither the
// kernel's nor the plugin's. Everything a workspace file or a trigger source supplied is drawn as
// text: no markup, no link and no title is ever made from it.
import { useId } from "react";
import type { ReactNode } from "react";
import { Card, Fact, Facts } from "../ui";
import type { Tone } from "./words";

export type FactRow = readonly [label: string, value: string | null | undefined, title?: string | null];
/** Facts from rows of data: one with nothing to say is left out, and with none there is no list. `title` is the whole of a value shown short (a commit id). */
export function FactList({ facts }: { facts: readonly FactRow[] }) {
  const shown = facts.filter((fact): fact is readonly [string, string, (string | null)?] => typeof fact[1] === "string" && fact[1] !== "");
  if (shown.length === 0) return null;
  return (
    <Facts>
      {shown.map(([label, value, title]) => (
        <Fact key={label} label={label}>
          {title ? <span title={title}>{value}</span> : value}
        </Fact>
      ))}
    </Facts>
  );
}

/** A card of a row's page, named by its heading. `warn`: what is wrong with the row. */
export function TitledCard({ title, children, testId, warn = false }: { title: string; children: ReactNode; testId: string; warn?: boolean }) {
  return (
    <Card testId={testId}>
      <h3 className={`font-semibold ${warn ? "text-destructive-text" : "text-foreground"}`}>{title}</h3>
      {children}
    </Card>
  );
}

export function Section({ title, note, children, testId }: { title: string; note?: string; children: ReactNode; testId?: string }) {
  const titleId = useId();
  return (
    <section data-testid={testId} aria-labelledby={titleId} className="flex min-w-0 flex-col gap-2">
      <h3 id={titleId} className="flex flex-wrap items-baseline gap-x-2 text-sm font-semibold text-foreground">
        <span>{title}</span>
        {note ? <span className="text-xs font-normal text-muted-foreground">{note}</span> : null}
      </h3>
      {children}
    </section>
  );
}

// A problem's dot is the refusal's colour: the warning colour means "needs you" in this plugin.
const TONE_DOT: Record<Tone, string> = { ok: "bg-success-foreground", warn: "bg-destructive-text", muted: "border border-muted-foreground" };
/**
 * The dot before where something runs, or before the scheduler's state. It always stands beside
 * its words, which say which it is, so it is hidden from assistive technology.
 */
export function ToneDot({ tone }: { tone: Tone }) {
  return <span aria-hidden="true" data-tone={tone} className={`inline-block size-2 shrink-0 rounded-full ${TONE_DOT[tone]}`} />;
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
