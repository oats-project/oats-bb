// The panel's small drawing parts, on bb's theme tokens only (app/ui.tsx says which tokens hold
// their contrast where). A control is at least 32 px high, and 44 px in bb's compact layout (under
// 768 px wide), where it is pressed with a finger.
import { useEffect, useRef, useState } from "react";
import type { KeyboardEvent, ReactNode } from "react";
import { shown } from "../ui/text";

/** A labelled section of a tab: its label in the small upper-case face, then its content. */
export function Section({ label, tools, children, testId }: { label: string; tools?: ReactNode; children: ReactNode; testId: string }) {
  return (
    <section data-testid={testId} className="flex min-w-0 flex-col gap-2">
      <div className="flex min-h-6 items-center gap-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</h3>
        {tools === undefined ? null : <span className="ml-auto flex items-center gap-1">{tools}</span>}
      </div>
      {children}
    </section>
  );
}

/** A bordered card: the Work and Session cards. */
export function Card({ children }: { children: ReactNode }) {
  return <div className="min-w-0 overflow-hidden rounded-lg border border-border bg-card text-foreground">{children}</div>;
}

/** A fact of the kernel's inside a sentence, or a path: the code face, breaking only where it must. */
export function Code({ children }: { children: string }) {
  return (
    <span title={children} className="break-words font-mono text-xs text-foreground">
      {children}
    </span>
  );
}

/** A small neutral tag with what it means in its title and its accessible name. */
export function Tag({ children, title }: { children: string; title: string }) {
  return (
    <span role="note" title={title} aria-label={`${children}: ${title}`} className="shrink-0 rounded border border-border px-1.5 text-xs text-muted-foreground">
      {children}
    </span>
  );
}

/**
 * Copies `value` when pressed, and says so: its name is `label`, then "Copied" (or "Copy failed")
 * for a moment. It writes to the clipboard only; where the browser gives none, it says it failed.
 */
export function CopyButton({ value, label, testId }: { value: string; label: string; testId: string }) {
  const [said, setSaid] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current !== null) clearTimeout(timer.current);
    },
    [],
  );
  const say = (text: string) => {
    setSaid(text);
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = setTimeout(() => setSaid(null), 1500);
  };
  const copy = () => {
    const clipboard = typeof navigator === "undefined" ? undefined : navigator.clipboard;
    if (clipboard === undefined) return say("Copy failed");
    clipboard.writeText(value).then(
      () => say("Copied"),
      () => say("Copy failed"),
    );
  };
  return (
    <button
      type="button"
      data-testid={testId}
      aria-label={said ?? label}
      title={said ?? label}
      onClick={copy}
      className="inline-flex min-h-11 shrink-0 items-center rounded-md border border-border bg-card px-2 text-xs text-foreground hover:bg-accent md:min-h-8"
    >
      <span aria-live="polite">{said ?? "Copy"}</span>
    </button>
  );
}

/** A path on one line with its Copy: the whole path is its title, and it breaks rather than hide its end. */
export function PathLine({ path, copyLabel, tag, testId }: { path: string; copyLabel: string; tag?: ReactNode; testId: string }) {
  return (
    <span className="flex min-w-0 items-start gap-2">
      <span data-testid={testId} title={path} className="min-w-0 flex-1 break-all font-mono text-xs text-foreground">
        {path}
      </span>
      {tag}
      <CopyButton value={path} label={copyLabel} testId={`${testId}-copy`} />
    </span>
  );
}

/** Label and value rows: a label column and a value column. A row whose value is null is not drawn. */
export function Facts({ rows }: { rows: { label: string; value: ReactNode | null; testId: string }[] }) {
  const reported = rows.filter((row) => row.value !== null);
  if (reported.length === 0) return null;
  return (
    <dl className="grid min-w-0 grid-cols-[max-content_minmax(0,1fr)] items-center gap-x-3 gap-y-1.5 text-sm">
      {reported.map((row) => (
        <div key={row.testId} className="contents">
          <dt className="text-muted-foreground">{row.label}</dt>
          <dd data-testid={row.testId} className="m-0 min-w-0 break-words text-foreground">
            {row.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/** Text of the kernel's or an agent's as one display line. */
export function Shown({ children }: { children: string }) {
  return <>{shown(children)}</>;
}

export type TabId = "instance" | "soul";
const TABS: { id: TabId; label: string }[] = [
  { id: "instance", label: "Instance" },
  { id: "soul", label: "Soul" },
];

/** The panel's tabs. Left and Right, Home and End move between them, as in a tab list. */
export function Tabs({ selected, onSelect }: { selected: TabId; onSelect: (tab: TabId) => void }) {
  const list = useRef<HTMLDivElement>(null);
  const move = (event: KeyboardEvent, index: number) => {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const next =
      event.key === "ArrowRight" ? (index + 1) % TABS.length : event.key === "ArrowLeft" ? (index + TABS.length - 1) % TABS.length : event.key === "Home" ? 0 : event.key === "End" ? TABS.length - 1 : null;
    if (next === null) return;
    event.preventDefault();
    onSelect(TABS[next]!.id);
    list.current?.querySelectorAll<HTMLElement>('[role="tab"]')[next]?.focus();
  };
  return (
    <div ref={list} role="tablist" aria-label="Instance context" className="flex shrink-0 gap-4 border-b border-border px-3">
      {TABS.map((tab, index) => (
        <button
          key={tab.id}
          type="button"
          role="tab"
          id={`oats-panel-tab-${tab.id}`}
          data-testid={`oats-panel-tab-${tab.id}`}
          aria-selected={selected === tab.id}
          aria-controls={`oats-panel-page-${tab.id}`}
          tabIndex={selected === tab.id ? 0 : -1}
          onClick={() => onSelect(tab.id)}
          onKeyDown={(event) => move(event, index)}
          className={`min-h-11 border-b-2 text-sm md:min-h-9 ${selected === tab.id ? "border-foreground font-semibold text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}
