// The plugin's few drawing primitives, on bb's theme tokens only (light and dark follow bb).
import { useEffect, useId, useRef } from "react";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import type { AgentState } from "../model/types";
import { STATE_WORD } from "./format";
import { FILL, TARGET } from "./ui/patterns";
import { refusalLines } from "./ui/text";

// The patterns and the controls every screen is drawn with (the UX standard, section 3): one each.
export { Confirm } from "./ui/confirm";
export type { ConfirmProps } from "./ui/confirm";
export { CopyButton, Menu, SearchField, Segmented, Switch, Tabs } from "./ui/controls";
export type { MenuItem, TabItem } from "./ui/controls";
export { Card, Code, DisabledReason, Disclosure, Empty, Fact, Facts, Field, INPUT, LINK, Loading, Notice, Result, Section, Stale, State, StateMark, StatusLine, TARGET, Toned } from "./ui/patterns";

// bb's tokens for coloured text on a surface: as a dot's fill they keep 3:1 against it in both
// themes, on a row that is open or hovered too, which bb's fill tokens do not (`attention` and
// `success` in the light theme, `destructive` in the dark one: 2.87:1 on an open row). As text they
// hold 4.5:1 on the page's own surfaces, not on an open row (`warning-text`: 4.35:1 there in the
// light theme): a text in a row is `text-foreground` or `text-muted-foreground`. A refusal's text,
// on a page or in a dialog, is `text-destructive-text`, never `text-destructive`.
const DOT: Record<AgentState, string> = { ...FILL, "needs-you": "bg-warning-text" };

/**
 * A click the plugin should handle itself. A modified click (new tab, new window) is left to the
 * anchor's own behaviour.
 */
export function plainClick(event: { metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean; button: number }): boolean {
  return !(event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0);
}

/** The status dot. Its accessible name is the state's word. */
export function Dot({ state }: { state: AgentState }) {
  return (
    <span
      role="img"
      aria-label={STATE_WORD[state]}
      title={STATE_WORD[state]}
      data-state={state}
      className={`inline-block size-2 shrink-0 rounded-full ${DOT[state]}`}
    />
  );
}

/**
 * A mark that something of a row needs a look (a failed run): a dot in the colour of a refusal,
 * which holds 3:1 on a row in both themes. Its accessible name is the label.
 */
export function Mark({ label }: { label: string }) {
  return <span role="img" aria-label={label} title={label} data-testid="oats-mark" className="inline-block size-2 shrink-0 rounded-full bg-destructive-text" />;
}

/** A tag: one word about a thing ("default", "workspace"). `tone` mutes it, or frames one that needs a look. Never a fact: a fact has its label (`Fact`). */
export function Chip({ children, title, tone = "plain" }: { children: ReactNode; title?: string; tone?: "plain" | "muted" | "warn" }) {
  return (
    <span
      title={title}
      data-tone={tone}
      className={`inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-md border bg-card px-2 py-0.5 text-xs ${tone === "warn" ? "border-warning-text text-foreground" : tone === "muted" ? "border-border text-muted-foreground" : "border-border text-foreground"}`}
    >
      {children}
    </span>
  );
}

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "default" | "primary" | "destructive" | "ghost";
};
const BUTTON: Record<NonNullable<ButtonProps["variant"]>, string> = {
  default: "border border-border bg-card text-foreground hover:bg-accent",
  primary: "border border-transparent bg-primary text-primary-foreground hover:opacity-90",
  destructive: "border border-transparent bg-destructive text-destructive-foreground hover:opacity-90",
  ghost: "border border-transparent text-foreground hover:bg-accent",
};
export function Button({ variant = "default", className = "", type = "button", ...rest }: ButtonProps) {
  return (
    <button
      type={type}
      className={`inline-flex ${TARGET} shrink-0 items-center justify-center gap-1 rounded-md px-3 py-1 text-sm disabled:cursor-not-allowed disabled:opacity-50 ${BUTTON[variant]} ${className}`}
      {...rest}
    />
  );
}

/** A section heading with its count. */
export function Heading({ children, n }: { children: ReactNode; n?: number }) {
  return (
    <h2 className="flex items-baseline gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
      <span>{children}</span>
      {n === undefined ? null : <span className="font-normal normal-case">{n}</span>}
    </h2>
  );
}

/** One muted line: an empty section, a loading state. */
export function Note({ children }: { children: ReactNode }) {
  return <p className="text-sm text-muted-foreground">{children}</p>;
}

/**
 * A refusal or a failure as text, through the display filter (ui/text.ts): its code, then its
 * message, each line of the kernel's on a line of its own.
 */
export function Lines({ text }: { text: string }) {
  const lines = refusalLines(text);
  if (lines.length <= 1) return <>{lines[0] ?? ""}</>;
  return (
    <>
      {lines.map((line, index) => (
        <span key={index} className="block">
          {line}
        </span>
      ))}
    </>
  );
}

/** A kernel refusal or a failed call: the kernel's code and message, through the display filter. */
export function ErrorLine({ children, onRetry }: { children: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="flex flex-wrap items-center gap-2 text-sm text-destructive-text">
      <span className="min-w-0 break-words">
        <Lines text={children} />
      </span>
      {onRetry === undefined ? null : <Button onClick={onRetry}>Retry</Button>}
    </div>
  );
}

/** The frame of a full page (a navPanel): scrolls by itself, padded, readable width. */
export function Page({ children, testId }: { children: ReactNode; testId: string }) {
  return (
    <div data-testid={testId} className="h-full min-h-0 overflow-y-auto">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-4 p-4 text-sm text-foreground">{children}</div>
    </div>
  );
}

/** What Tab stops on inside a dialog, in the page's order: every control that is not off, a disclosure's summary, and what a tabindex puts in the order. */
const TABBABLE = 'button:not([disabled]), a[href], input:not([disabled]), textarea:not([disabled]), select:not([disabled]), summary, [tabindex]:not([tabindex="-1"])';

/**
 * A modal dialog drawn by the plugin: a centred card on a dimmed page, a sheet at the bottom of a
 * phone. Escape and a click on the dimmed page cancel; focus moves into it and stays in it.
 */
export function Modal({
  title,
  children,
  footer,
  onCancel,
  returnFocus,
}: {
  title: string;
  children: ReactNode;
  footer: ReactNode;
  onCancel: () => void;
  /** Where the focus goes when the dialog closes and the control that opened it is gone (a retired agent's row): its neighbour. */
  returnFocus?: () => HTMLElement | null;
}) {
  const titleId = useId();
  const card = useRef<HTMLDivElement>(null);
  const after = useRef(returnFocus);
  after.current = returnFocus;
  useEffect(() => {
    const previous = document.activeElement;
    // The focus starts on the control the dialog marks (`data-autofocus`: Cancel for a destructive
    // act, a form's first field), else on the dialog itself.
    (card.current?.querySelector<HTMLElement>("[data-autofocus]") ?? card.current)?.focus();
    return () => {
      // What opened it, when it is still there and held the focus (a click focuses no button in some browsers).
      const opener = previous instanceof HTMLElement && previous.isConnected && previous !== document.body ? previous : null;
      const back = opener ?? after.current?.() ?? null;
      back?.focus();
    };
  }, []);
  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4"
      data-testid="oats-modal"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onCancel();
      }}
    >
      <div
        ref={card}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="flex max-h-[85vh] w-full flex-col gap-3 rounded-t-lg border border-border bg-background p-4 text-sm text-foreground shadow-lg outline-none sm:max-w-lg sm:rounded-lg"
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.stopPropagation();
            onCancel();
            return;
          }
          if (event.key !== "Tab") return;
          // keep Tab inside the dialog
          // What Tab really stops on: not a control a roving tabindex took out of the order (the
          // unselected tabs, the unchecked choices), and nothing inside a disclosure that is closed
          // but its summary.
          const stops = Array.from(card.current?.querySelectorAll<HTMLElement>(TABBABLE) ?? []).filter((stop) => {
            if (stop.tabIndex < 0) return false;
            // A summary is its own disclosure's stop whether that is open or not: look from outside it.
            const from = stop.tagName === "SUMMARY" && stop.parentElement?.tagName === "DETAILS" ? stop.parentElement.parentElement : stop;
            return from === null || from.closest("details:not([open])") === null;
          });
          if (stops.length === 0) {
            // Nothing to stop on (an act in progress: its buttons are off): the focus stays on the dialog.
            event.preventDefault();
            card.current?.focus();
            return;
          }
          const first = stops[0]!;
          const last = stops[stops.length - 1]!;
          if (event.shiftKey && (document.activeElement === first || document.activeElement === card.current)) {
            event.preventDefault();
            last.focus();
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first.focus();
          }
        }}
      >
        <h2 id={titleId} className="text-base font-semibold">
          {title}
        </h2>
        <div className="min-h-0 overflow-y-auto">{children}</div>
        <div className="flex flex-wrap justify-end gap-2">{footer}</div>
      </div>
    </div>
  );
}
