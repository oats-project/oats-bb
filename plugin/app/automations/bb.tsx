// The parts of the Automations page that bb has no component for a plugin to use (the list's row,
// its pill tabs, its search field, its switch, its buttons), drawn with bb's OWN classes: each was
// read from bb's own Automations page (bb-app 0.50.1, `/plugins/automations/automations`, the
// classes and the computed styles of its row, its tabs, its search, its switch and its buttons),
// so that the type, the sizes and the spacing are bb's, token for token. A live check compares
// the two pages' computed type and fails on a difference (container/scenes/automations.mjs).
// Where the plugin's own standard asks for more than bb gives (a control at least 32 px high, 44
// at a phone's width), the control's box is the plugin's and what is drawn inside it is bb's.
import { useRef } from "react";
import type { KeyboardEvent, ReactNode } from "react";
import { experimental_Icon as Icon } from "@get-bb/plugin-sdk/app";
import { TARGET } from "../ui";

/** bb's names for the icons the page draws, each one bb's own page draws too (seen in its DOM), but the two kinds bb has none of. */
export const ICONS = {
  /** bb's own Automations icon: its navigation's, and its page header's */
  page: "Repeat",
  /** a row of bb's own list */
  schedule: "Calendar",
  /** bb's row of an automation whose last run failed */
  failing: "CircleX",
  trigger: "GitPullRequest",
  wake: "AlarmClock",
  open: "ChevronRight",
  menu: "MoreHorizontal",
  search: "Search",
} as const;

/** bb's card of rows, and a row of it: an icon's fixed column, what takes the room, the controls' column. */
export const CARD = "rounded-lg border border-border bg-card px-4 py-1";
export const ROWS = "divide-y divide-border";
export const ROW = "grid min-w-0 items-center gap-3 py-3 grid-cols-[1.5rem_minmax(0,1fr)_auto]";
export const ROW_ICON = "flex size-6 shrink-0 items-center justify-center";
/** bb's row name, but whole: bb cuts a name with an ellipsis (`truncate`); ours wraps (WORDS.md). */
export const NAME = "min-w-0 break-words text-sm font-medium";
/** bb's small line under a name. */
export const SMALL = "mt-0.5 text-xs leading-snug text-muted-foreground";
/** bb's buttons: its dark primary one ("New automation"), and its outlined one ("Next"). */
const BUTTON = "inline-flex cursor-pointer items-center justify-center gap-2 whitespace-nowrap rounded-md px-3 text-xs font-medium transition-colors disabled:pointer-events-none disabled:opacity-50";
export const BUTTON_PRIMARY = `${BUTTON} ${TARGET} bg-foreground text-background hover:bg-foreground/90`;
export const BUTTON_OUTLINE = `${BUTTON} ${TARGET} border border-input bg-transparent text-foreground hover:bg-accent`;
/** bb's icon button of a row ("…"): 28 px drawn, in a box as high as the plugin's controls. */
export const ICON_BUTTON = "inline-flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground";

const ACROSS: Record<string, -1 | 1> = { ArrowLeft: -1, ArrowRight: 1 };

export type PillTab<Id extends string> = { id: Id; label: string; count?: number };
/**
 * bb's pill tabs ("Installed 42 · Browse"): one is selected, Left and Right (Home, End) move the
 * selection with the focus, and Tab leaves the strip for the panel. `panelId` is the id of the
 * element the tabs show; a tab's id is `<panelId>-tab-<id>`.
 */
export function PillTabs<Id extends string>({ label, tabs, value, onChange, panelId }: { label: string; tabs: readonly PillTab<Id>[]; value: Id; onChange: (id: Id) => void; panelId: string }) {
  const strip = useRef<HTMLDivElement>(null);
  const select = (index: number) => {
    const tab = tabs[index];
    if (tab === undefined) return;
    onChange(tab.id);
    strip.current?.querySelectorAll<HTMLElement>('[role="tab"]')[index]?.focus();
  };
  const onKey = (event: KeyboardEvent, index: number) => {
    const next = event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : event.key in ACROSS ? (index + ACROSS[event.key]! + tabs.length) % tabs.length : null;
    if (next === null) return;
    event.preventDefault();
    select(next);
  };
  return (
    <div ref={strip} role="tablist" aria-label={label} data-testid="oats-tabs" className="flex min-w-0 items-center gap-1">
      {tabs.map((tab, index) => {
        const selected = tab.id === value;
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            id={`${panelId}-tab-${tab.id}`}
            aria-selected={selected}
            aria-controls={panelId}
            tabIndex={selected ? 0 : -1}
            data-testid={`oats-tab-${tab.id}`}
            className={`${TARGET} inline-flex cursor-pointer items-center gap-1.5 rounded-md px-3 py-1 text-sm font-medium ${selected ? "bg-accent text-foreground" : "text-muted-foreground hover:text-foreground"}`}
            onClick={() => onChange(tab.id)}
            onKeyDown={(event) => onKey(event, index)}
          >
            {tab.label}
            {tab.count === undefined ? null : <span className="text-2xs text-muted-foreground">{tab.count}</span>}
          </button>
        );
      })}
    </div>
  );
}

/** bb's search field: its glyph inside, at the left; what is typed filters at once; Escape clears it. */
export function SearchBox({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <div role="search" aria-label={label} className="relative min-w-0 flex-1">
      <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 left-2.5 flex items-center text-muted-foreground">
        <Icon name={ICONS.search} className="size-4" />
      </span>
      <input
        type="search"
        aria-label={label}
        data-testid="oats-search"
        className={`${TARGET} flex w-full rounded-md border border-input bg-transparent py-1 pl-8 pr-3 text-sm text-foreground placeholder:text-muted-foreground`}
        value={value}
        placeholder={label}
        autoComplete="off"
        spellCheck={false}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key !== "Escape" || value === "") return;
          event.stopPropagation();
          onChange("");
        }}
      />
    </div>
  );
}

/** bb's switch of a row: the track and its thumb alone, no word beside it. `name` is its accessible name; whether it is on is its state. */
export function RowSwitch({ name, title, checked, onChange, disabled = false }: { name: string; title?: string; checked: boolean; onChange: (checked: boolean) => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={name}
      title={title}
      disabled={disabled}
      data-testid="oats-switch"
      className={`${TARGET} inline-flex shrink-0 cursor-pointer items-center rounded-md px-1 disabled:cursor-not-allowed disabled:opacity-50`}
      onClick={() => onChange(!checked)}
    >
      <span aria-hidden="true" className={`inline-flex h-4 w-7 shrink-0 items-center rounded-full border ${checked ? "border-transparent bg-foreground" : "border-input bg-muted"}`}>
        <span className={`block size-3 rounded-full transition-transform ${checked ? "translate-x-3 bg-background" : "translate-x-0 bg-foreground"}`} />
      </span>
    </button>
  );
}

/** bb's page of one thing: its width, its sections' rhythm, a section's heading, its bordered box, a box's foot. */
export const DETAIL = "mx-auto flex w-full max-w-3xl flex-col gap-6";
export const SECTION = "flex min-w-0 flex-col gap-3";
export const SECTION_HEAD = "flex min-h-6 items-center text-sm font-medium text-foreground";
/** What an automation does, as plain text between bb's separators: no box around it, and none filled (bb's own is a bordered box with a filled foot: WORDS.md). Its foot: the soul, the harness, the model. */
export const PLAIN = "flex min-w-0 flex-col gap-2";
export const PLAIN_FOOT = "flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground";
/** A section that follows another: bb's separator over it. */
export const SEPARATED = "border-t border-border pt-5";
/** bb's Runs table, without its box: rows between bb's separators. */
export const RUNS_BOX = "divide-y divide-border border-y border-border";
export const RUN_ROW = "flex w-full min-w-0 flex-wrap items-center gap-x-2.5 gap-y-0.5 px-2 py-1.5 text-left";
/** A failed run's own words: bb's type for them, but plain text on the page's ground, where bb's own is a filled box (WORDS.md). */
export const RUN_ERROR = "mb-2 ml-[2.125rem] mr-2 flex min-w-0 flex-col gap-1 whitespace-pre-wrap break-words font-mono text-xs leading-relaxed text-foreground";

/** A filter of a few choices, in bb's pills' look and small enough that four with their counts stand on a phone's line: a radio group (the arrows move the choice). */
export function FilterPills<Id extends string>({ label, options, value, onChange }: { label: string; options: readonly { id: Id; label: string; count?: number }[]; value: Id; onChange: (id: Id) => void }) {
  const group = useRef<HTMLDivElement>(null);
  return (
    <div ref={group} role="radiogroup" aria-label={label} data-testid="oats-filter" className="flex min-w-0 flex-wrap items-center gap-1">
      {options.map((option, index) => {
        const checked = option.id === value;
        return (
          <button
            key={option.id}
            type="button"
            role="radio"
            aria-checked={checked}
            tabIndex={checked ? 0 : -1}
            className={`${TARGET} inline-flex cursor-pointer items-center gap-1 whitespace-nowrap rounded-md px-2 py-1 text-xs font-medium ${checked ? "bg-accent text-foreground" : "text-muted-foreground hover:text-foreground"}`}
            onClick={() => onChange(option.id)}
            onKeyDown={(event) => {
              const step = { ArrowLeft: -1, ArrowUp: -1, ArrowRight: 1, ArrowDown: 1 }[event.key];
              if (step === undefined) return;
              event.preventDefault();
              const next = (index + step + options.length) % options.length;
              onChange(options[next]!.id);
              group.current?.querySelectorAll<HTMLElement>('[role="radio"]')[next]?.focus();
            }}
          >
            {option.label}
            {option.count === undefined ? null : <span className="text-2xs text-muted-foreground">{option.count}</span>}
          </button>
        );
      })}
    </div>
  );
}

/** The mark that a row opens, as bb draws it at a row's end. */
export function Chevron(): ReactNode {
  return <Icon name={ICONS.open} className="size-3.5" />;
}
