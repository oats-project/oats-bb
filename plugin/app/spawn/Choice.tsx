// One choice among options that each have a name and may have a line of detail (a soul and its
// description, an agent and its soul): a button that shows what is chosen and opens a list, with a
// filter over it when the list is long. The WAI-ARIA combobox that only selects: Enter, Space or
// an arrow opens it; the arrows, Home and End move; Enter chooses; Escape and Tab close it, and
// the focus is back on the button. In the shared look of a field (INPUT), on bb's tokens.
// The form's own for now (the pilot path); offered to app/ui as the shared one afterwards.
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import { INPUT, TARGET } from "../ui";
import { NO_MATCH } from "./words";

/** `unavailable`: an option a person can still choose, to read why it will not do (a soul that cannot be spawned, a harness bb has not installed): drawn muted. */
export type ChoiceOption = { id: string; label: string; detail?: string | undefined; disabled?: boolean | undefined; unavailable?: boolean | undefined };

/** From this many options on, the list has a filter. */
export const FILTER_FROM = 8;

export function Choice({
  value,
  options,
  onChange,
  placeholder,
  filterLabel,
  disabled = false,
  testId,
  field,
  ...described
}: {
  /** The chosen option's id; an id no option has shows the placeholder. */
  value: string;
  options: readonly ChoiceOption[];
  onChange: (id: string) => void;
  placeholder: string;
  /** The filter's accessible name and placeholder: "Filter". */
  filterLabel: string;
  disabled?: boolean;
  testId: string;
  /** The form's name for the field, for the form to find it. */
  field?: string;
  /** What `Field` gives its control. */
  id?: string;
  "aria-label"?: string;
  "aria-describedby"?: string;
  "aria-invalid"?: boolean | "true" | "false";
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const popup = useRef<HTMLDivElement>(null);
  const filter = useRef<HTMLInputElement>(null);
  const listId = useId();
  const chosen = options.find((option) => option.id === value);
  const filtered = options.length >= FILTER_FROM;
  const shown = useMemo(() => {
    const words = query.trim().toLowerCase().split(/\s+/).filter((word) => word !== "");
    return words.length === 0 ? options : options.filter((option) => words.every((word) => `${option.label}\n${option.detail ?? ""}`.toLowerCase().includes(word)));
  }, [options, query]);
  const firstEnabled = (from: number, step: 1 | -1): number => {
    for (let i = from; i >= 0 && i < shown.length; i += step) if (shown[i]!.disabled !== true) return i;
    return -1;
  };

  const close = useCallback((refocus: boolean) => {
    setOpen(false);
    setQuery("");
    if (refocus) button.current?.focus();
  }, []);
  const show = () => {
    if (disabled) return;
    const at = options.findIndex((option) => option.id === value && option.disabled !== true);
    setActive(at === -1 ? options.findIndex((option) => option.disabled !== true) : at);
    setOpen(true);
  };
  const pick = (option: ChoiceOption | undefined) => {
    if (option === undefined || option.disabled === true) return;
    close(true);
    if (option.id !== value) onChange(option.id);
  };

  // Open: the focus goes to the filter, or to the list; a press outside closes it.
  useEffect(() => {
    if (!open) return;
    (filter.current ?? list.current)?.focus({ preventScroll: true });
    const outside = (event: MouseEvent) => {
      if (root.current !== null && event.target instanceof Node && !root.current.contains(event.target)) close(false);
    };
    document.addEventListener("mousedown", outside);
    return () => document.removeEventListener("mousedown", outside);
  }, [open, close]);
  // Once per opening: the whole list in view, by the smallest move of the page (none when it already is).
  useLayoutEffect(() => {
    if (open) popup.current?.scrollIntoView?.({ block: "nearest" });
  }, [open]);
  // The option the keys are on is in view, by scrolling the LIST alone: the page stays where it is.
  useLayoutEffect(() => {
    const box = list.current;
    const on = box?.querySelector<HTMLElement>('[data-active="true"]');
    if (!open || box === null || on === null || on === undefined) return;
    // Where it is not whole in the list's window it goes to the window's top: no option is left cut above it.
    if (on.offsetTop < box.scrollTop || on.offsetTop + on.offsetHeight > box.scrollTop + box.clientHeight) box.scrollTop = on.offsetTop;
  }, [open, active, shown]);

  const onKeys = (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      close(true);
      return;
    }
    if (event.key === "Tab") {
      close(true); // the Tab then moves from the button, in the page's order
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      event.stopPropagation(); // not the form's Enter
      pick(shown[active]);
      return;
    }
    const inFilter = event.target === filter.current;
    const next =
      event.key === "ArrowDown" ? firstEnabled(active + 1, 1) : event.key === "ArrowUp" ? firstEnabled(active - 1, -1) : event.key === "Home" && !inFilter ? firstEnabled(0, 1) : event.key === "End" && !inFilter ? firstEnabled(shown.length - 1, -1) : null;
    if (next === null) return;
    event.preventDefault();
    if (next !== -1) setActive(next);
  };

  const optionId = (index: number) => `${listId}-${index}`;
  return (
    <div ref={root} className="relative min-w-0" data-testid={`${testId}-choice`}>
      <button
        ref={button}
        type="button"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        disabled={disabled}
        data-testid={testId}
        data-field={field}
        data-value={chosen === undefined ? "" : value}
        {...described}
        className={`${INPUT} flex items-center justify-between gap-2 text-left`}
        onClick={() => (open ? close(false) : show())}
        onKeyDown={(event) => {
          if (open || !["ArrowDown", "ArrowUp"].includes(event.key)) return;
          event.preventDefault();
          show();
        }}
      >
        <span className={`min-w-0 flex-1 break-words ${chosen === undefined ? "text-subtle-foreground" : chosen.unavailable === true ? "text-muted-foreground" : ""}`}>{chosen === undefined ? placeholder : chosen.label}</span>
        <span aria-hidden="true" className="shrink-0 text-muted-foreground">
          ▾
        </span>
      </button>
      {open ? (
        <div ref={popup} role="presentation" className="absolute left-0 right-0 top-full z-40 mt-1 flex max-h-72 flex-col rounded-md border border-border bg-background text-sm text-foreground shadow-lg" onKeyDown={onKeys}>
          {filtered ? (
            <div className="border-b border-border p-1">
              <input
                ref={filter}
                type="search"
                role="searchbox"
                aria-label={filterLabel}
                aria-controls={listId}
                aria-activedescendant={shown[active] === undefined ? undefined : optionId(active)}
                data-testid={`${testId}-filter`}
                className={INPUT}
                value={query}
                placeholder={filterLabel}
                autoComplete="off"
                spellCheck={false}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setActive(0);
                }}
              />
            </div>
          ) : null}
          <ul
            ref={list}
            id={listId}
            role="listbox"
            tabIndex={-1}
            aria-label={described["aria-label"] ?? filterLabel}
            aria-activedescendant={shown[active] === undefined ? undefined : optionId(active)}
            data-testid={`${testId}-options`}
            className="relative m-0 min-h-0 flex-1 list-none overflow-y-auto p-1 outline-none"
          >
            {shown.length === 0 ? (
              <li role="presentation" className="px-3 py-2 text-muted-foreground">
                {NO_MATCH}
              </li>
            ) : null}
            {shown.map((option, index) => (
              <li
                key={option.id}
                id={optionId(index)}
                role="option"
                aria-selected={option.id === value}
                aria-disabled={option.disabled === true}
                data-testid={`${testId}-option`}
                data-value={option.id}
                data-active={index === active}
                className={`${TARGET} flex cursor-pointer flex-col justify-center rounded px-3 py-1 ${index === active ? "bg-accent" : ""} ${option.disabled === true ? "cursor-not-allowed text-muted-foreground" : option.unavailable === true ? "text-muted-foreground" : ""}`}
                data-unavailable={option.unavailable === true ? "" : undefined}
                onMouseEnter={() => {
                  if (option.disabled !== true) setActive(index);
                }}
                onClick={() => pick(option)}
              >
                <span className={`break-words ${option.id === value ? "font-semibold" : ""}`}>{option.label}</span>
                {option.detail === undefined || option.detail === "" ? null : <span className="break-words text-xs text-muted-foreground">{option.detail}</span>}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
