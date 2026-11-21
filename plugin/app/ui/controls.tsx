// The plugin's controls that bb's SDK does not give a plugin: tabs, a segmented filter, a search
// field, a switch, a row's menu and a copy button. Each is the WAI-ARIA pattern of its name, with
// its keys, on bb's tokens, at the target's height (patterns.tsx).
import { useEffect, useId, useRef, useState } from "react";
import type { KeyboardEvent, ReactNode } from "react";
import { INPUT, TARGET } from "./patterns";

/** Moves among `count` stops with the arrow keys, Home and End; null for any other key. */
function step(event: KeyboardEvent, at: number, count: number, keys: { back: string; forth: string }): number | null {
  if (count === 0) return null;
  if (event.key === keys.forth) return (at + 1) % count;
  if (event.key === keys.back) return (at - 1 + count) % count;
  if (event.key === "Home") return 0;
  if (event.key === "End") return count - 1;
  return null;
}
const ACROSS = { back: "ArrowLeft", forth: "ArrowRight" };
const DOWN = { back: "ArrowUp", forth: "ArrowDown" };

export type TabItem<Id extends string> = { id: Id; label: string; count?: number; mark?: ReactNode };

/**
 * A tab strip: one tab is selected, Left and Right (Home, End) move the selection, and Tab leaves
 * the strip for the panel. `panelId` is the id of the element the tabs show (`role="tabpanel"`,
 * `aria-labelledby` the selected tab's id, which is `<panelId>-tab-<id>`). The strip scrolls
 * sideways rather than cut a tab.
 */
export function Tabs<Id extends string>({ label, tabs, value, onChange, panelId }: { label: string; tabs: readonly TabItem<Id>[]; value: Id; onChange: (id: Id) => void; panelId: string }) {
  const strip = useRef<HTMLDivElement>(null);
  const select = (index: number) => {
    const tab = tabs[index];
    if (tab === undefined) return;
    onChange(tab.id);
    strip.current?.querySelectorAll<HTMLElement>('[role="tab"]')[index]?.focus();
  };
  return (
    <div ref={strip} role="tablist" aria-label={label} data-testid="oats-tabs" className="flex min-w-0 gap-1 overflow-x-auto border-b border-border">
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
            className={`${TARGET} inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap border-b-2 px-3 text-sm ${selected ? "border-foreground font-semibold text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}
            onClick={() => onChange(tab.id)}
            onKeyDown={(event) => {
              const next = step(event, index, tabs.length, ACROSS);
              if (next === null) return;
              event.preventDefault();
              select(next);
            }}
          >
            {tab.label}
            {tab.count === undefined ? null : <span className="font-normal text-muted-foreground">{tab.count}</span>}
            {tab.mark ?? null}
          </button>
        );
      })}
    </div>
  );
}

/** A segmented filter: one of a few choices, as a radio group (the arrows move the choice). */
export function Segmented<Id extends string>({ label, options, value, onChange }: { label: string; options: readonly { id: Id; label: string }[]; value: Id; onChange: (id: Id) => void }) {
  const group = useRef<HTMLDivElement>(null);
  return (
    <div ref={group} role="radiogroup" aria-label={label} data-testid="oats-segmented" className="inline-flex shrink-0 rounded-md border border-border bg-card p-0.5">
      {options.map((option, index) => {
        const checked = option.id === value;
        return (
          <button
            key={option.id}
            type="button"
            role="radio"
            aria-checked={checked}
            tabIndex={checked ? 0 : -1}
            className={`${TARGET} rounded px-3 text-sm ${checked ? "bg-accent font-semibold text-foreground" : "text-muted-foreground hover:text-foreground"}`}
            onClick={() => onChange(option.id)}
            onKeyDown={(event) => {
              const next = step(event, index, options.length, ACROSS) ?? step(event, index, options.length, DOWN);
              if (next === null) return;
              event.preventDefault();
              onChange(options[next]!.id);
              group.current?.querySelectorAll<HTMLElement>('[role="radio"]')[next]?.focus();
            }}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

/** A search field: what is typed filters a list at once; Escape clears it. `label` is its accessible name. */
export function SearchField({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (value: string) => void; placeholder?: string }) {
  return (
    <input
      type="search"
      aria-label={label}
      data-testid="oats-search"
      className={INPUT}
      value={value}
      placeholder={placeholder ?? label}
      autoComplete="off"
      spellCheck={false}
      onChange={(event) => onChange(event.target.value)}
      onKeyDown={(event) => {
        if (event.key !== "Escape" || value === "") return;
        event.stopPropagation();
        onChange("");
      }}
    />
  );
}

/** An on/off switch with its label beside it: `checked` is what is, `onChange` asks for the other. Space and Enter press it. */
export function Switch({ label, checked, onChange, disabled = false }: { label: string; checked: boolean; onChange: (checked: boolean) => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      data-testid="oats-switch"
      className={`${TARGET} inline-flex shrink-0 items-center gap-2 rounded-md px-1 text-sm text-foreground disabled:cursor-not-allowed disabled:opacity-50`}
      onClick={() => onChange(!checked)}
    >
      <span aria-hidden="true" className={`inline-flex h-5 w-9 shrink-0 items-center rounded-full border border-border p-0.5 ${checked ? "justify-end bg-primary" : "justify-start bg-muted"}`}>
        <span className={`size-3.5 rounded-full ${checked ? "bg-primary-foreground" : "bg-muted-foreground"}`} />
      </span>
      <span>{label}</span>
      <span className="text-muted-foreground">{checked ? "On" : "Off"}</span>
    </button>
  );
}

export type MenuItem = { id: string; label: string; onSelect: () => void; destructive?: boolean; disabled?: boolean; reason?: string };

/**
 * A row's menu: a button named for what it is the menu of ("Actions for Weekly digest"), and its
 * items. Enter, Space or Down opens it on the first item; the arrows, Home and End move; Escape
 * and Tab close it, and the focus returns to the button. An item that is off says why (`reason`).
 */
export function Menu({ label, items, children = "⋯" }: { label: string; items: readonly MenuItem[]; children?: ReactNode }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const menuId = useId();
  const stops = () => Array.from(root.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);
  const close = (refocus: boolean) => {
    setOpen(false);
    if (refocus) button.current?.focus();
  };
  useEffect(() => {
    if (!open) return;
    stops()[0]?.focus();
    const outside = (event: MouseEvent) => {
      if (root.current !== null && event.target instanceof Node && !root.current.contains(event.target)) setOpen(false);
    };
    document.addEventListener("mousedown", outside);
    return () => document.removeEventListener("mousedown", outside);
  }, [open]);
  return (
    <div ref={root} className="relative inline-flex shrink-0" data-testid="oats-menu">
      <button
        ref={button}
        type="button"
        aria-label={label}
        title={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        className={`${TARGET} inline-flex min-w-8 items-center justify-center rounded-md border border-transparent px-2 text-sm text-foreground hover:bg-accent`}
        onClick={() => setOpen((now) => !now)}
        onKeyDown={(event) => {
          if (event.key !== "ArrowDown" || open) return;
          event.preventDefault();
          setOpen(true);
        }}
      >
        {children}
      </button>
      {open ? (
        <div
          id={menuId}
          role="menu"
          aria-label={label}
          className="absolute right-0 top-full z-40 mt-1 flex min-w-44 flex-col rounded-md border border-border bg-background p-1 text-sm text-foreground shadow-lg"
          onKeyDown={(event) => {
            if (event.key === "Escape" || event.key === "Tab") {
              if (event.key === "Escape") event.preventDefault();
              event.stopPropagation();
              close(true);
              return;
            }
            const all = stops();
            const next = step(event, all.indexOf(document.activeElement as HTMLElement), all.length, DOWN);
            if (next === null) return;
            event.preventDefault();
            all[next]?.focus();
          }}
        >
          {items.map((item) => (
            <button
              key={item.id}
              type="button"
              role="menuitem"
              aria-disabled={item.disabled === true}
              data-testid={`oats-menu-item-${item.id}`}
              className={`${TARGET} flex flex-col items-start justify-center rounded px-3 text-left hover:bg-accent ${item.destructive ? "text-destructive-text" : ""} ${item.disabled ? "cursor-not-allowed text-muted-foreground" : ""}`}
              onClick={() => {
                if (item.disabled) return;
                close(true);
                item.onSelect();
              }}
            >
              <span>{item.label}</span>
              {item.disabled && item.reason !== undefined ? <span className="text-xs text-muted-foreground">{item.reason}</span> : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** Copies `text`: the button says what it copies, then "Copied" (or that it could not) for two seconds, announced. */
export function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [said, setSaid] = useState<"Copied" | "Couldn't copy" | null>(null);
  useEffect(() => {
    if (said === null) return;
    const timer = setTimeout(() => setSaid(null), 2_000);
    return () => clearTimeout(timer);
  }, [said]);
  return (
    <button
      type="button"
      data-testid="oats-copy"
      className={`${TARGET} inline-flex shrink-0 items-center justify-center rounded-md border border-border bg-card px-3 text-sm text-foreground hover:bg-accent`}
      onClick={() => {
        // The clipboard is absent on a plain-http origin (a phone on the LAN): say so, never throw.
        Promise.resolve()
          .then(() => navigator.clipboard.writeText(text))
          .then(
            () => setSaid("Copied"),
            () => setSaid("Couldn't copy"),
          );
      }}
    >
      <span aria-live="polite">{said ?? label}</span>
    </button>
  );
}
