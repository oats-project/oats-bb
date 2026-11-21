// The panel's own small parts, on bb's theme tokens only: what the patterns of app/ui.tsx (the UX
// standard, section 3) have no component for. Everything else the panel draws is one of those.
import type { ReactNode } from "react";
import { CopyButton, TARGET } from "../ui";
import { shown } from "../ui/text";

/** A labelled section of a tab: its label in the small upper-case face, then its content. */
export function Section({ label, children, testId }: { label: string; children: ReactNode; testId: string }) {
  return (
    <section data-testid={testId} className="flex min-w-0 flex-col gap-2">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</h3>
      {children}
    </section>
  );
}

/** A fact of the kernel's inside a sentence: the code face, breaking inside only where it cannot fit a line. */
export function Code({ children }: { children: string }) {
  return (
    <span title={children} className="break-words font-mono text-xs text-foreground">
      {shown(children)}
    </span>
  );
}

/** A small neutral tag with what it means in its title and its accessible name. */
export function Tag({ children, title }: { children: string; title: string }) {
  return (
    <span role="note" title={title} aria-label={`${children}: ${title}`} className="w-fit shrink-0 rounded border border-border px-1.5 text-xs text-muted-foreground">
      {children}
    </span>
  );
}

/** A path, whole (it breaks rather than hide its end), then its Copy, named for what it copies. */
export function PathLine({ path, copyLabel, tag, testId }: { path: string; copyLabel: string; tag?: ReactNode; testId: string }) {
  return (
    <span className="flex min-w-0 flex-col items-start gap-1.5">
      <span data-testid={testId} className="min-w-0 break-all font-mono text-xs text-foreground">
        {path}
      </span>
      {tag}
      <CopyButton text={path} label={copyLabel} />
    </span>
  );
}

/** A fold: its summary is as high as any control, and what it holds shows when it is open. */
export function Fold({ summary, children, testId, className = "" }: { summary: ReactNode; children: ReactNode; testId: string; className?: string }) {
  return (
    <details data-testid={testId} className={`group min-w-0 ${className}`}>
      <summary className={`${TARGET} flex w-fit cursor-pointer list-none items-center gap-1.5 text-sm font-semibold text-foreground`}>
        <span aria-hidden="true" className="inline-block text-muted-foreground group-open:rotate-90">
          ▸
        </span>
        {summary}
      </summary>
      {children}
    </details>
  );
}
