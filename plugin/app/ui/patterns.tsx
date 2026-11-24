// The plugin's patterns (the UX standard, section 3): one component each for a state, a status
// line, a labelled fact, a notice, the empty, loading and stale states, a result and a form's field.
// Every screen of every feature draws these; none draws another of its own. bb's tokens only.
import { cloneElement, useId } from "react";
import type { ReactElement, ReactNode } from "react";
import type { AgentState } from "../../model/types";
import { refusalLines, shown } from "./text";
import { showingRead, STATE } from "./words";

/** A control's height: 32 px, and 44 px at bb's compact (phone) width, where a finger presses it. */
export const TARGET = "min-h-11 md:min-h-8";

// bb's tokens for coloured text on a surface hold 3:1 as a mark's fill on a row, open or hovered,
// in both themes; its fill tokens do not (ui.tsx says which).
export const FILL: Record<Exclude<AgentState, "needs-you">, string> = {
  working: "bg-success-foreground",
  idle: "border border-muted-foreground",
  stopped: "bg-muted-foreground",
  error: "bg-destructive-text",
  unreachable: "bg-destructive-text",
  // It runs where OATS does not see it: the warning tone (bb's token for coloured text holds 3:1 as a mark's fill on a row).
  outside: "bg-warning-text",
};

/**
 * A state's mark: a dot, or for an agent that waits on a person the Desktop's "!" in the dot's
 * place. Beside its word (`State`) it is hidden from assistive technology; alone it carries the
 * accessible name: the state's, or `name` where the caller says more ("Needs input: <reason>, since 14:03").
 */
export function StateMark({ state, name, hidden = false, tone }: { state: AgentState; name?: string; hidden?: boolean; /** "warning": the state needs a remedy (a stopped agent whose process may still run): the mark is drawn in the warning tone, the word stays the state's */ tone?: "warning" }) {
  const label = name ?? STATE[state].name;
  const says = hidden ? ({ "aria-hidden": true } as const) : ({ role: "img", "aria-label": label, title: label } as const);
  if (state === "needs-you") {
    return (
      <span {...says} data-mark="" data-state={state} className="inline-flex size-3 shrink-0 items-center justify-center rounded-full bg-warning-text text-[10px] font-bold leading-none text-background">
        !
      </span>
    );
  }
  return <span {...says} data-mark="" data-state={state} data-tone={tone} className={`inline-block size-2 shrink-0 rounded-full ${tone === "warning" ? "bg-warning-text" : FILL[state]}`} />;
}

/**
 * A state: its mark AND its word, always both. `word` is for a place whose words for the same
 * state are the Desktop's own ("Running", where the tree says "Working"): the mark stays the state's.
 */
export function State({ state, word, tone }: { state: AgentState; word?: string; tone?: "warning" }) {
  return (
    <span data-testid="oats-state" data-state={state} data-tone={tone} className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap">
      <StateMark state={state} hidden tone={tone} />
      <span>{word ?? STATE[state].word}</span>
    </span>
  );
}

const TONED = { ok: "bg-success-foreground", warn: "bg-warning-text", bad: "bg-destructive-text", muted: "bg-muted-foreground" } as const;

/**
 * A state that is not an agent's (where a schedule runs, whether a machine answers): a dot AND its
 * words, like `State`. The dot is hidden from assistive technology: the words say it.
 */
export function Toned({ tone, children }: { tone: keyof typeof TONED; children: ReactNode }) {
  return (
    <span data-testid="oats-toned" data-tone={tone} className="inline-flex min-w-0 items-center gap-1.5">
      <span aria-hidden="true" data-mark="" className={`inline-block size-2 shrink-0 rounded-full ${TONED[tone]}`} />
      <span className="min-w-0 break-words">{children}</span>
    </span>
  );
}

/** A titled block of a page: its heading (with a count, where it lists things) and what is under it. */
export function Section({ title, n, children, testId = "oats-section" }: { title: string; n?: number; children: ReactNode; testId?: string }) {
  return (
    <section data-testid={testId} className="flex min-w-0 flex-col gap-2">
      <h2 className="flex items-baseline gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        <span>{title}</span>
        {n === undefined ? null : <span className="font-normal normal-case">{n}</span>}
      </h2>
      {children}
    </section>
  );
}

/**
 * Where an agent is, in one line: the state's word, since when, for an agent that needs a person
 * the question or the reason, and the act that applies, as a button. The thread's identity row,
 * the panel's header and the home's rows draw this one. `since` and `detail` are text from OATS or
 * an agent and go through the display filter here; the line wraps, and nothing in it is cut.
 * `action` holds buttons only: the line's frame clips what hangs out of it (so that no line starts
 * with a separator), and a list that opens from the line would be cut.
 */
export function StatusLine({ state, word, markOnly = false, since, detail, tone, asOf, action }: { state: AgentState; word?: string; /** the mark alone, with the state as its accessible name: for a place whose heading already says the state's word (a card under "Needs you") */ markOnly?: boolean; since?: string | null; detail?: string | null; asOf?: string | null; /** "warning": the line warns (a stopped agent's live composer, a stopped agent whose process may still run): the state's mark and the detail are drawn in bb's warning tone (the text token holds 4.5:1 on a page's surface; the line is never a row of a list). The words carry the meaning; the tone never does alone. */ tone?: "warning"; action?: ReactNode }) {
  const parts = [
    { text: shown(since), tone: undefined },
    { text: shown(detail), tone },
    // `asOf`: the line is drawn from a roster kept as last read; it says so, last ("as of 2 min ago").
    { text: shown(asOf), tone: undefined },
  ].filter((part) => part.text !== "");
  // No line of it starts with a separator. Each part after the word carries its "·" in its own
  // left padding, and the row is pulled left by as much inside a frame that clips: a part that
  // wraps to the start of a line has its separator in the clipped strip, and the line starts
  // with its words. (The frame's own padding keeps a focus ring of the act from being clipped.)
  return (
    <div data-testid="oats-status-line" data-state={state} className="-m-1 min-w-0 overflow-hidden p-1 text-sm text-foreground">
      <div className="-ml-4 flex min-w-0 flex-wrap items-center gap-y-1">
        <span className="pl-4 font-semibold">
          {markOnly ? (
            <span data-testid="oats-state" data-state={state} data-tone={tone} className="inline-flex shrink-0 items-center">
              <StateMark state={state} tone={tone} />
            </span>
          ) : (
            <State state={state} word={word} tone={tone} />
          )}
        </span>
        {parts.map((part, index) => (
          <span key={index} data-testid="oats-status-part" data-tone={part.tone} className={`relative min-w-0 break-words ${markOnly && index === 0 ? "pl-1.5" : "pl-4"} ${part.tone === "warning" ? "text-warning-text" : "text-muted-foreground"}`}>
            {/* (After the mark alone the first part needs no separator: the mark is not a word.) */}
            {markOnly && index === 0 ? null : <span data-sep="" className="absolute left-0 top-0 w-4 text-center text-muted-foreground">{"· "}</span>}
            {part.text}
          </span>
        ))}
        {action === undefined || action === null ? null : <span className="ml-auto flex shrink-0 items-center gap-2 pl-4">{action}</span>}
      </div>
    </div>
  );
}

/**
 * A labelled fact, `label · value`: the label muted, the value whole (it wraps, it is never cut).
 * A value that opens something is given as a link or a button by the caller and looks like one;
 * a bare value does not. A fact with no value (null, undefined, the empty string) is left out, as
 * the Desktop leaves it out. Inside `Facts`.
 */
export function Fact({ label, title, children }: { label: string; /** the whole of a value drawn short (a full commit id behind its seven characters) */ title?: string; children: ReactNode }) {
  if (children === null || children === undefined || children === "") return null;
  return (
    <div data-testid="oats-fact" className="flex min-w-0 flex-col gap-0.5 md:flex-row md:gap-3">
      <dt className="shrink-0 text-muted-foreground md:w-40">{label}</dt>
      <dd title={title} className="min-w-0 break-words text-foreground">
        {children}
      </dd>
    </div>
  );
}
export function Facts({ children }: { children: ReactNode }) {
  return <dl className="flex flex-col gap-2 text-sm">{children}</dl>;
}

/** A link's look, for a fact's value or a notice's text that opens something. */
export const LINK = "underline underline-offset-2 hover:opacity-80";

/**
 * Something a person opens to read more ("Details", "Paths", a row of a list that opens): closed
 * until pressed, its summary as high as a control, with a mark that turns when it is open. Closed,
 * it is one word, or a row behind its mark. Uncontrolled, or controlled with `open` and `onToggle`.
 */
export function Disclosure({ summary, children, open, onToggle, row = false, testId = "oats-disclosure" }: { summary: ReactNode; children: ReactNode; open?: boolean; onToggle?: (open: boolean) => void; /** the summary is a row of a list that opens (its own words, in its own look, behind the mark), not a word that names a fold */ row?: boolean; testId?: string }) {
  return (
    <details data-testid={testId} className="min-w-0 text-sm" {...(open === undefined ? {} : { open })} onToggle={(event) => onToggle?.(event.currentTarget.open)}>
      <summary className={`${TARGET} cursor-pointer list-none items-center ${row ? "flex min-w-0 gap-2 text-foreground" : "inline-flex gap-1 text-xs text-muted-foreground hover:text-foreground"}`}>
        {/* The mark that says it opens, turned when THIS fold is open (the summary's own triangle is
            lost with its flex layout). By its own details alone: a fold inside an open fold is closed
            until it is opened, and a rule on any open ancestor would turn its mark too. */}
        <span aria-hidden="true" data-testid="oats-disclosure-mark" className="inline-block transition-transform [details[open]>summary>&]:rotate-90">
          ▸
        </span>
        {summary}
      </summary>
      <div className="flex min-w-0 flex-col gap-1 break-words pt-1">{children}</div>
    </details>
  );
}

/**
 * What the kernel itself says behind a status line's words (of a session it cannot reach: often a
 * raw URL or an errno): one press away, under Details, never the line's words. The one drawing, for
 * the thread's row and the instance panel's header. Nothing for no text.
 * ONE text is drawn: the kernel's, or, where there is none, bb's own reason for a thread that
 * failed at its start (`bb`). A row never has both (`agentStatus`, app/roster/status.ts: the
 * kernel's text is of an agent it cannot reach, bb's reason of one that is failed); were both
 * given, the kernel's is the one drawn.
 */
export function KernelSays({ text, bb }: { text: string | null; /** bb's own reason for a thread that failed at its start, in the kernel's text's place. */ bb?: string | undefined }) {
  const said = text === null ? "" : shown(text);
  const bbSaid = bb === undefined ? "" : shown(bb);
  if (said === "" && bbSaid === "") return null;
  return (
    <Disclosure summary="Details" testId={said === "" ? "oats-status-bb" : "oats-status-kernel"}>
      <p className="text-xs text-muted-foreground">{said === "" ? `bb says: ${bbSaid}` : `OATS says: ${said}`}</p>
    </Disclosure>
  );
}

/** A kernel's own word inside a sentence (a code, a flag, a file's name): drawn as that, through the display filter. */
export function Code({ children }: { children: string }) {
  return <code className="break-all rounded bg-muted px-1 py-0.5 text-xs text-foreground">{shown(children)}</code>;
}


const TONE = {
  info: { frame: "border-border", title: "text-foreground", role: "status" },
  warning: { frame: "border-warning-text", title: "text-foreground", role: "status" },
  error: { frame: "border-destructive-text", title: "text-destructive-text", role: "alert" },
} as const;

/**
 * A notice in a person's words: a title, one or two sentences, the acts that help (Retry, Open
 * settings, Details), and for a read that failed the age of what is still shown. For the failed,
 * stale, not-configured and cannot-show states of every page. `code` is the kernel's or the
 * plugin's code, drawn after the words in the muted style, never before them; `details` is what is
 * one press away under "Details": the kernel's own message (a refusal as the server words it), or
 * several texts in order (a sentence of what to do, then the code and the kernel's message), each
 * through the filter by itself.
 */
export function Notice({
  title,
  children,
  tone = "info",
  code,
  details,
  age,
  actions,
}: {
  title: string;
  children?: ReactNode;
  tone?: keyof typeof TONE;
  code?: string | null;
  details?: string | null | readonly (string | null)[];
  /** `readAge()` of what is still shown: a string, or null when the instant cannot be read ("Last read."); left out, the notice says nothing of it. */
  age?: string | null;
  actions?: ReactNode;
}) {
  const look = TONE[tone];
  const detailLines = (Array.isArray(details) ? details : [details]).flatMap((text) => refusalLines(text));
  return (
    <section role={look.role} data-testid="oats-notice" data-tone={tone} className={`flex flex-col gap-2 rounded-lg border bg-card p-3 text-sm text-foreground ${look.frame}`}>
      <h3 className={`font-semibold ${look.title}`}>{title}</h3>
      {children === undefined || children === null ? null : <div className="flex min-w-0 flex-col gap-1 break-words">{children}</div>}
      {age === undefined ? null : <p className="text-xs text-muted-foreground">{showingRead(age)}</p>}
      {code === undefined || code === null || shown(code) === "" ? null : <p className="break-words text-xs text-muted-foreground">{shown(code)}</p>}
      {detailLines.length === 0 ? null : (
        <Disclosure summary="Details" testId="oats-notice-details">
          {detailLines.map((line, index) => (
            <p key={index} className="text-xs text-muted-foreground">
              {line}
            </p>
          ))}
        </Disclosure>
      )}
      {actions === undefined || actions === null ? null : <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </section>
  );
}

/**
 * An empty list or page: the Desktop's words for it (a title where the Desktop has two lines, and
 * its sentence), and the act that fills it. In the place the content will be.
 */
export function Empty({ title, children, action }: { title?: string; /** the sentence; left out where the title says it all */ children?: ReactNode; action?: ReactNode }) {
  return (
    <div data-testid="oats-empty" className="flex flex-col items-start gap-2 py-2 text-sm text-muted-foreground">
      {title === undefined ? null : <p className="font-semibold text-foreground">{title}</p>}
      {children === undefined || children === null ? null : <p>{children}</p>}
      {action === undefined || action === null ? null : <div className="flex flex-wrap items-center gap-2">{action}</div>}
    </div>
  );
}

/** A read in flight, in the place the content will be: "Reading…". Polite: it is said once, not at every re-read. */
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
export function Stale({ age, held, refreshing = false, action }: { age: string | null; held?: string | null; refreshing?: boolean; action?: ReactNode }) {
  return (
    <div role="status" data-testid="oats-stale" className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 rounded-md border border-border bg-muted px-3 py-2 text-xs text-foreground">
      <span>{refreshing ? `Refreshing… ${showingRead(age).replace(/^[A-Z]/, (first) => first.toLowerCase())}` : showingRead(age)}</span>
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
      {/* (A part with nothing drawn in it takes no room: a caller's list of no lines, or acts that are all absent, is
          not null, and its empty block kept the gap over it: a result of one title was a line too high.) */}
      {children === undefined || children === null ? null : <div className="flex min-w-0 flex-col gap-1 break-words empty:hidden">{children}</div>}
      {code === undefined || code === null || shown(code) === "" ? null : <p className="break-words text-xs text-muted-foreground">{shown(code)}</p>}
      {actions === undefined || actions === null ? null : <div className="flex flex-wrap items-center gap-2 empty:hidden">{actions}</div>}
    </section>
  );
}

/**
 * A card: one thing of a list that has parts (a team, a schedule, a question). With a `title` it is
 * a section named by it; `tone="warn"` frames one that needs a look. Its acts go last in `children`.
 */
export function Card({ title, tone, footer, children, testId = "oats-card" }: { title?: string; tone?: "warn"; /** a second part, under a rule */ footer?: ReactNode; children: ReactNode; testId?: string }) {
  const frame = `flex min-w-0 flex-col gap-2 rounded-lg border bg-card p-3 text-sm text-foreground ${tone === "warn" ? "border-warning-text" : "border-border"}`;
  const second = footer === undefined || footer === null ? null : <div className="flex min-w-0 flex-col gap-2 border-t border-border pt-2">{footer}</div>;
  if (title === undefined) {
    return (
      <div data-testid={testId} className={frame}>
        {children}
        {second}
      </div>
    );
  }
  return (
    <section data-testid={testId} aria-label={title} className={frame}>
      <h3 className="break-words font-semibold">{title}</h3>
      {children}
      {second}
    </section>
  );
}

/** The look of a text field, a textarea and a select: on the page's background, bb's border, the target's height. */
export const INPUT = `${TARGET} w-full rounded-md border border-border bg-background px-2 text-sm text-foreground placeholder:text-subtle-foreground disabled:cursor-not-allowed disabled:opacity-50`;

/**
 * A form's field: its label (with "· optional" where it is), the control, a hint under it, and its
 * refusal. The label names the control with its own words only; the hint and the refusal describe
 * it (`aria-describedby`), and a refusal marks it invalid and is announced. `children` is the one
 * control (an input, a textarea, a select): the field gives it its id.
 */
export function Field({ label, optional = false, hint, error, children }: { label: string; optional?: boolean; hint?: ReactNode; error?: string | null; children: ReactElement<{ id?: string; "aria-describedby"?: string; "aria-invalid"?: boolean | "true" | "false" }> }) {
  const id = useId();
  const hasHint = hint !== undefined && hint !== null;
  const hasError = error !== undefined && error !== null;
  const describedBy = [hasHint ? `${id}-hint` : null, hasError ? `${id}-error` : null].filter((part) => part !== null).join(" ");
  return (
    <div data-testid="oats-field" className="flex min-w-0 flex-col gap-1 text-xs text-muted-foreground">
      <label htmlFor={id}>
        {label}
        {optional ? " · optional" : ""}
      </label>
      {cloneElement(children, { id, ...(describedBy === "" ? {} : { "aria-describedby": describedBy }), ...(hasError ? { "aria-invalid": true } : {}) })}
      {hasHint ? <span id={`${id}-hint`}>{hint}</span> : null}
      {hasError ? (
        <span id={`${id}-error`} role="alert" className="text-destructive-text">
          {error}
        </span>
      ) : null}
    </div>
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
