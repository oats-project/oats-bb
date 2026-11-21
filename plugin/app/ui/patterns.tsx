// The plugin's patterns (the UX standard, section 3): one component each for a state, a status
// line, a labelled fact, a notice, the empty, loading and stale states, a result and a form's field.
// Every screen of every feature draws these; none draws another of its own. bb's tokens only.
import type { ReactNode } from "react";
import type { AgentState } from "../../model/types";
import { shown } from "./text";
import { STATE } from "./words";

/** A control's height: 32 px, and 44 px at bb's compact (phone) width, where a finger presses it. */
export const TARGET = "min-h-11 md:min-h-8";

// bb's tokens for coloured text on a surface hold 3:1 as a mark's fill on a row, open or hovered,
// in both themes; its fill tokens do not (ui.tsx says which).
const FILL: Record<Exclude<AgentState, "needs-you">, string> = {
  working: "bg-success-foreground",
  idle: "border border-muted-foreground",
  stopped: "bg-muted-foreground",
  error: "bg-destructive-text",
  unreachable: "bg-destructive-text",
};

/**
 * A state's mark: a dot, or for an agent that waits on a person the Desktop's "!" in the dot's
 * place. Beside its word (`State`) it is hidden from assistive technology; alone it carries the
 * accessible name: the state's, or `name` where the caller says more ("Needs input: <reason>, since 14:03").
 */
export function StateMark({ state, name, hidden = false }: { state: AgentState; name?: string; hidden?: boolean }) {
  const label = name ?? STATE[state].name;
  const says = hidden ? ({ "aria-hidden": true } as const) : ({ role: "img", "aria-label": label, title: label } as const);
  if (state === "needs-you") {
    return (
      <span {...says} data-state={state} className="inline-flex size-3 shrink-0 items-center justify-center rounded-full bg-warning-text text-[10px] font-bold leading-none text-background">
        !
      </span>
    );
  }
  return <span {...says} data-state={state} className={`inline-block size-2 shrink-0 rounded-full ${FILL[state]}`} />;
}

/** A state: its mark AND its word, always both. */
export function State({ state }: { state: AgentState }) {
  return (
    <span data-testid="oats-state" data-state={state} className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap">
      <StateMark state={state} hidden />
      <span>{STATE[state].word}</span>
    </span>
  );
}

/**
 * Where an agent is, in one line: the state's word, since when, for an agent that needs a person
 * the question or the reason, and the act that applies, as a button. The thread's identity row,
 * the panel's header and the home's rows draw this one. `since` and `detail` are text from OATS or
 * an agent and go through the display filter here; the line wraps, and nothing in it is cut.
 */
export function StatusLine({ state, since, detail, action }: { state: AgentState; since?: string | null; detail?: string | null; action?: ReactNode }) {
  const said = [since, detail].map((part) => shown(part)).filter((part) => part !== "");
  return (
    <div data-testid="oats-status-line" data-state={state} className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-sm text-foreground">
      <span className="font-semibold">
        <State state={state} />
      </span>
      {said.map((part, index) => (
        <span key={index} className="min-w-0 break-words text-muted-foreground">{`· ${part}`}</span>
      ))}
      {action === undefined || action === null ? null : <span className="ml-auto flex shrink-0 items-center gap-2">{action}</span>}
    </div>
  );
}

/**
 * A labelled fact, `label · value`: the label muted, the value whole (it wraps, it is never cut).
 * A value that opens something is given as a link or a button by the caller and looks like one;
 * a bare value does not. Inside `Facts`.
 */
export function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div data-testid="oats-fact" className="flex min-w-0 flex-col gap-0.5 md:flex-row md:gap-3">
      <dt className="shrink-0 text-muted-foreground md:w-40">{label}</dt>
      <dd className="min-w-0 break-words text-foreground">{children}</dd>
    </div>
  );
}
export function Facts({ children }: { children: ReactNode }) {
  return <dl className="flex flex-col gap-2 text-sm">{children}</dl>;
}

/** A link's look, for a fact's value or a notice's text that opens something. */
export const LINK = "underline underline-offset-2 hover:opacity-80";

const TONE = {
  info: { frame: "border-border", title: "text-foreground", role: "status" },
  warning: { frame: "border-warning-text", title: "text-foreground", role: "status" },
  error: { frame: "border-destructive-text", title: "text-destructive-text", role: "alert" },
} as const;

/**
 * A notice in a person's words: a title, one or two sentences, the acts that help (Retry, Open
 * settings, Details), and for a read that failed the age of what is still shown. For the failed,
 * stale, not-configured and cannot-show states of every page. `code` is the kernel's or the
 * plugin's code, drawn after the words in the muted style, never before them.
 */
export function Notice({
  title,
  children,
  tone = "info",
  code,
  age,
  actions,
}: {
  title: string;
  children?: ReactNode;
  tone?: keyof typeof TONE;
  code?: string | null;
  age?: string | null;
  actions?: ReactNode;
}) {
  const look = TONE[tone];
  return (
    <section role={look.role} data-testid="oats-notice" data-tone={tone} className={`flex flex-col gap-2 rounded-lg border bg-card p-3 text-sm text-foreground ${look.frame}`}>
      <h3 className={`font-semibold ${look.title}`}>{title}</h3>
      {children === undefined || children === null ? null : <div className="flex min-w-0 flex-col gap-1 break-words">{children}</div>}
      {age === undefined || age === null ? null : <p className="text-xs text-muted-foreground">{`Showing what was read ${age}.`}</p>}
      {code === undefined || code === null || shown(code) === "" ? null : <p className="break-words text-xs text-muted-foreground">{shown(code)}</p>}
      {actions === undefined || actions === null ? null : <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </section>
  );
}

/** An empty list or page: the Desktop's sentence for it, and the act that fills it. In the place the content will be. */
export function Empty({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div data-testid="oats-empty" className="flex flex-col items-start gap-2 py-2 text-sm text-muted-foreground">
      <p>{children}</p>
      {action === undefined || action === null ? null : <div className="flex flex-wrap items-center gap-2">{action}</div>}
    </div>
  );
}

/** A read in flight, in the place the content will be: "Reading your agents…". Polite: it is said once, not at every re-read. */
export function Loading({ children = "Reading OATS…" }: { children?: ReactNode }) {
  return (
    <p role="status" aria-live="polite" data-testid="oats-loading" className="py-2 text-sm text-muted-foreground">
      {children}
    </p>
  );
}

/**
 * What a place shows above content it read earlier and could not read again, or is reading again:
 * the content stays, marked with its age. `held` says why the acts that are unsafe on stale data
 * are held, where the place has such acts; `refreshing` is a re-read in flight.
 */
export function Stale({ age, held, refreshing = false, action }: { age: string; held?: string | null; refreshing?: boolean; action?: ReactNode }) {
  return (
    <div role="status" data-testid="oats-stale" className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 rounded-md border border-border bg-muted px-3 py-2 text-xs text-foreground">
      <span>{refreshing ? `Refreshing… showing what was read ${age}.` : `Showing what was read ${age}.`}</span>
      {held === undefined || held === null ? null : <span className="text-muted-foreground">{held}</span>}
      {action === undefined || action === null ? null : <span className="ml-auto flex shrink-0 items-center gap-2">{action}</span>}
    </div>
  );
}

/**
 * What happened after an act, in the place the person is looking: a title in a person's words,
 * the lines of what was done or what is left, and the next step. A failure stays until dismissed.
 */
export function Result({ title, tone = "done", children, code, actions }: { title: string; tone?: "done" | "failed" | "unknown"; children?: ReactNode; code?: string | null; actions?: ReactNode }) {
  return (
    <section
      role={tone === "done" ? "status" : "alert"}
      data-testid="oats-result"
      data-tone={tone}
      className={`flex flex-col gap-2 rounded-lg border bg-card p-3 text-sm text-foreground ${tone === "failed" ? "border-destructive-text" : tone === "unknown" ? "border-warning-text" : "border-border"}`}
    >
      <h3 className={`font-semibold ${tone === "failed" ? "text-destructive-text" : ""}`}>{title}</h3>
      {children === undefined || children === null ? null : <div className="flex min-w-0 flex-col gap-1 break-words">{children}</div>}
      {code === undefined || code === null || shown(code) === "" ? null : <p className="break-words text-xs text-muted-foreground">{shown(code)}</p>}
      {actions === undefined || actions === null ? null : <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </section>
  );
}

/** A card: one thing of a list that has parts (a team, a schedule, a question). */
export function Card({ children, testId = "oats-card" }: { children: ReactNode; testId?: string }) {
  return (
    <div data-testid={testId} className="flex min-w-0 flex-col gap-2 rounded-lg border border-border bg-card p-3 text-sm text-foreground">
      {children}
    </div>
  );
}

/** The look of a text field, a textarea and a select: on the page's background, bb's border, the target's height. */
export const INPUT = `${TARGET} w-full rounded-md border border-border bg-background px-2 text-sm text-foreground placeholder:text-subtle-foreground disabled:cursor-not-allowed disabled:opacity-50`;

/**
 * A form's field: its label (with "· optional" where it is), the control, a hint under it, and its
 * refusal. The control is the label's child, so the label names it; `error` is announced.
 */
export function Field({ label, optional = false, hint, error, children }: { label: string; optional?: boolean; hint?: ReactNode; error?: string | null; children: ReactNode }) {
  return (
    <label data-testid="oats-field" className="flex min-w-0 flex-col gap-1 text-xs text-muted-foreground">
      <span>
        {label}
        {optional ? " · optional" : ""}
      </span>
      {children}
      {hint === undefined || hint === null ? null : <span>{hint}</span>}
      {error === undefined || error === null ? null : (
        <span role="alert" className="text-destructive-text">
          {error}
        </span>
      )}
    </label>
  );
}

/** Why a button beside it is off, in words: a disabled button never leaves a person guessing. */
export function DisabledReason({ children }: { children: ReactNode }) {
  return (
    <span data-testid="oats-disabled-reason" className="text-xs text-muted-foreground">
      {children}
    </span>
  );
}
