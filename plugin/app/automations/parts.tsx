// The Automations page's own drawing parts, on bb's theme tokens only (light and dark follow bb).
// Text that is coloured uses bb's tokens for coloured text on a surface, and so do the dots
// (app/ui.tsx says why). Everything the kernel, a workspace file or a trigger source supplied is
// drawn as text: no markup, no link and no title is ever made from it.
import { useId, useRef } from "react";
import type { KeyboardEvent, ReactNode } from "react";
import type { Tone } from "./words";

/** Tabs in bb's own page style: the chosen one underlined; Left, Right, Home and End move between them. */
export function Tabs<Id extends string>({
  label,
  tabs,
  chosen,
  onChoose,
  panelId,
}: {
  label: string;
  tabs: readonly { id: Id; title: string; count: number | null }[];
  chosen: Id;
  onChoose: (id: Id) => void;
  panelId: string;
}) {
  const list = useRef<HTMLDivElement>(null);
  const move = (event: KeyboardEvent, at: number) => {
    const n = tabs.length;
    const to = event.key === "Home" ? 0 : event.key === "End" ? n - 1 : event.key === "ArrowRight" ? (at + 1) % n : event.key === "ArrowLeft" ? (at + n - 1) % n : -1;
    if (to < 0) return;
    event.preventDefault();
    onChoose(tabs[to]!.id);
    // Focus follows the choice, as a tab list's does.
    list.current?.querySelectorAll<HTMLElement>('[role="tab"]')[to]?.focus();
  };
  return (
    <div ref={list} role="tablist" aria-label={label} className="flex min-w-0 gap-5">
      {tabs.map((tab, at) => (
        <button
          key={tab.id}
          type="button"
          role="tab"
          id={`${panelId}-tab-${tab.id}`}
          data-testid={`oats-automations-tab-${tab.id}`}
          aria-selected={tab.id === chosen}
          aria-controls={panelId}
          tabIndex={tab.id === chosen ? 0 : -1}
          className={`inline-flex min-h-8 shrink-0 items-baseline gap-1.5 border-b-2 px-0.5 py-1 text-sm ${
            tab.id === chosen ? "border-foreground font-semibold text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
          onClick={() => onChoose(tab.id)}
          onKeyDown={(event) => move(event, at)}
        >
          <span>{tab.title}</span>
          {tab.count === null ? null : <span className="text-xs font-normal text-muted-foreground">{tab.count}</span>}
        </button>
      ))}
    </div>
  );
}

/** A group of choices of which one is pressed: All / Workspace / Local. */
export function Segmented<Id extends string>({
  label,
  options,
  chosen,
  onChoose,
}: {
  label: string;
  options: readonly { id: Id; label: string; count: number }[];
  chosen: Id;
  onChoose: (id: Id) => void;
}) {
  return (
    <div role="group" aria-label={label} className="inline-flex shrink-0 overflow-hidden rounded-md border border-border bg-card">
      {options.map((option) => (
        <button
          key={option.id}
          type="button"
          data-testid={`oats-automations-origin-${option.id}`}
          aria-pressed={option.id === chosen}
          className={`inline-flex min-h-8 items-baseline gap-1.5 border-l border-border px-3 py-1 text-sm first:border-l-0 ${
            option.id === chosen ? "bg-accent font-semibold text-foreground" : "text-muted-foreground hover:text-foreground"
          }`}
          onClick={() => onChoose(option.id)}
        >
          <span>{option.label}</span>
          <span className="text-xs font-normal">{option.count}</span>
        </button>
      ))}
    </div>
  );
}

export function Search({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <input
      type="search"
      data-testid="oats-automations-search"
      aria-label={label}
      placeholder={label}
      autoComplete="off"
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className="min-h-8 w-full min-w-0 rounded-md border border-border bg-background px-3 py-1 text-sm text-foreground placeholder:text-muted-foreground sm:w-60"
    />
  );
}

/** A note above the list that says why nothing here runs, with at most one thing to do about it. */
export function Banner({ children, action, testId }: { children: ReactNode; action?: ReactNode; testId: string }) {
  return (
    <div role="note" data-testid={testId} className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground">
      <span aria-hidden="true" className="inline-block size-2 shrink-0 rounded-full bg-warning-text" />
      <span className="min-w-0 flex-1 break-words">{children}</span>
      {action}
    </div>
  );
}

/** A small label on a row: where it comes from, that it is off here, that something is wrong with it. */
export function Tag({ children, title, tone = "plain" }: { children: ReactNode; title?: string; tone?: "plain" | "muted" | "warn" }) {
  const look = tone === "warn" ? "border-border bg-card font-semibold text-warning-text" : tone === "muted" ? "border-border text-muted-foreground" : "border-border bg-card text-foreground";
  return (
    <span title={title} className={`inline-flex shrink-0 items-center whitespace-nowrap rounded border px-1.5 py-px text-xs ${look}`}>
      {children}
    </span>
  );
}

// A problem's dot is the destructive one: the warning colour means "needs you" in this plugin.
const TONE_DOT: Record<Tone, string> = { ok: "bg-success-foreground", warn: "bg-destructive-text", muted: "border border-muted-foreground" };
/** The dot before where something runs, or before the scheduler's state. The words beside it say which. */
export function ToneDot({ tone }: { tone: Tone }) {
  return <span aria-hidden="true" data-tone={tone} className={`inline-block size-2 shrink-0 rounded-full ${TONE_DOT[tone]}`} />;
}

export type Fact = readonly [label: string, value: string | null | undefined, title?: string | null];
/** Facts as label and value; one with nothing to say is left out, and with none there is no list. */
export function Facts({ facts }: { facts: readonly Fact[] }) {
  const shown = facts.filter((fact): fact is readonly [string, string, (string | null)?] => typeof fact[1] === "string" && fact[1] !== "");
  if (shown.length === 0) return null;
  return (
    <dl className="grid grid-cols-[minmax(5rem,auto)_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-sm">
      {shown.map(([label, value, title]) => (
        <div key={label} className="contents">
          <dt className="text-muted-foreground">{label}</dt>
          <dd title={title ?? undefined} className="min-w-0 whitespace-pre-wrap break-words text-foreground">
            {value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

export function Card({ title, children, testId, warn = false }: { title: string; children: ReactNode; testId?: string; warn?: boolean }) {
  const titleId = useId();
  return (
    <section data-testid={testId} aria-labelledby={titleId} className="flex min-w-0 flex-col gap-2 rounded-md border border-border bg-card p-3">
      <h3 id={titleId} className={`text-sm font-semibold ${warn ? "text-warning-text" : "text-foreground"}`}>
        {title}
      </h3>
      {children}
    </section>
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
