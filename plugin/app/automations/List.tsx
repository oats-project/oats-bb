// The Automations list, in the manner of bb's own Automations page: ONE card of rows, schedules
// and triggers together. A row is an icon of its kind (the needs-you mark while an agent it made
// asks, bb's red mark while it is failing), its name, one short sentence of what it does, and one
// small line (when · the machine it runs on · its owner · its last run · what is wrong, in red),
// then its switch, its "…" menu and a chevron; "Answer" where an agent of it asks. What needs a
// person comes first, then what is failing.
// Over the card, from twelve rows, a search; and one filter of four with counts. The card scrolls
// alone: the search and the filter stay. Every part has a fixed place, so a name of sixty
// characters runs into nothing: it is never cut, and wraps whole where it must (bb's own row cuts
// a name with an ellipsis; names that differ only in their last word must be told apart: WORDS.md).
import type { ReactNode } from "react";
import { experimental_Icon as Icon } from "@get-bb/plugin-sdk/app";
import type { AutomationList, AutomationRow, TriggerStatuses } from "../../contract/automations";
import { Empty, Menu, Notice, StateMark, TARGET } from "../ui";
import type { MenuItem } from "../ui";
import { shown } from "../ui/text";
import { BUTTON_OUTLINE, CARD, Chevron, FilterPills, ICON_BUTTON, ICONS, NAME, ROW, ROW_ICON, ROWS, SearchBox, SMALL } from "./bb";
import { useHere } from "./here";
import { attention, EMPTY, filterList, inOrder, hostNameHow, hostUnnamed, LIST_FILTERS, listBanners, NO_MATCH, oneList, lineText, rowLine, schedulerOffLine, SEARCH_FROM, searchRows, statusFor } from "./words";
import type { Asking, Attention, LinePart, ListFilter } from "./words";

/** The least height of the card of rows: room for a busy row or two at a phone's width. Under it the card is not squeezed: the page scrolls whole. */
export const CARD_FLOOR = "min-h-[22rem]";

/** What a row's acts add to it, where the page has them: its switch and its menu, at the row's end. */
export type RowActs = { switchOf: (row: AutomationRow) => ReactNode; menuOf: (row: AutomationRow) => MenuItem[] };

/** A row's icon: bb's red mark while it is failing, else its kind's (a wake has its own). */
export const iconOf = (row: AutomationRow, bad: boolean): string => (bad ? ICONS.failing : row.kind === "trigger" ? ICONS.trigger : row.run === "wake" ? ICONS.wake : ICONS.schedule);
const KIND_NAME = { schedule: "Schedule", trigger: "Trigger" } as const;

const TONE = { bad: "text-destructive-text", warn: "text-warning-text", ask: "text-warning-text" } as const;

/**
 * The small line: its parts with "·" between them where there is room for one line, and each
 * part on a line of its own where there is not (bb's own row does the same at a phone's width).
 * A part is never cut: one longer than its line wraps.
 */
export function SmallLine({ parts }: { parts: readonly LinePart[] }) {
  return (
    <span data-testid="oats-automation-line" className={`${SMALL} flex min-w-0 flex-col gap-y-0.5 @2xl:min-h-5 @2xl:flex-row @2xl:flex-wrap @2xl:items-center`}>
      {parts.map((part, at) => (
        <span key={at} data-part="" data-tone={part.tone ?? undefined} title={part.title} className="min-w-0 break-words">
          {at === 0 ? null : (
            <span aria-hidden="true" className="mx-1.5 hidden shrink-0 text-muted-foreground @2xl:inline">
              ·
            </span>
          )}
          {part.lead === undefined ? null : `${shown(part.lead)} `}
          {/* What is wrong, or that it asks, is a short word or two of the page's own: never broken in two (a kernel's own word, which may be long, wraps). */}
          {part.tone === undefined ? shown(part.text) : <span className={`${part.text.length <= 24 ? "whitespace-nowrap" : ""} ${TONE[part.tone]}`}>{shown(part.text)}</span>}
        </span>
      ))}
    </span>
  );
}

/** The one short sentence of what an automation does: its own description, on one line, cut at a word. Nothing where none is written. */
export function Sentence({ row, whole = false }: { row: AutomationRow; /** an automation's own page says it whole */ whole?: boolean }) {
  if (row.description === null) return null;
  return (
    <span data-testid="oats-automation-sentence" title={whole ? undefined : shown(row.description)} className={`mt-0.5 w-full min-w-0 text-xs leading-snug text-foreground ${whole ? "block break-words" : "line-clamp-1 break-words"}`}>
      {shown(row.description)}
    </span>
  );
}

/** "Answer": opens the chat of the agent that asks. */
export function Answer({ name, onAnswer, className = "" }: { name: string; onAnswer: () => void; className?: string }) {
  return (
    <button type="button" data-testid="oats-automation-answer" aria-label={`Answer ${shown(name)}`} className={`${BUTTON_OUTLINE} ${className}`} onClick={onAnswer}>
      Answer
    </button>
  );
}

const MARK_NAME = { needs: "Needs you", failing: "Failing" } as const;

function Row({ row, parts, state, onOpen, onAnswer, acts }: { row: AutomationRow; parts: readonly LinePart[]; state: Attention; onOpen: (row: AutomationRow) => void; /** opens the chat of the agent that asks, where one does */ onAnswer?: () => void; acts?: RowActs }) {
  const off = !row.enabledHere && row.group !== "elsewhere";
  return (
    <div role="listitem" data-testid="oats-automation-row" data-id={row.id} data-kind={row.kind} data-state={state ?? "calm"} data-failing={state === "failing"} className={ROW}>
      {/* The icon's fixed place. Its name is said: a kind or a state is never told by a glyph alone. */}
      <span role="img" aria-label={state === null ? KIND_NAME[row.kind] : MARK_NAME[state]} data-testid="oats-automation-icon" className={`${ROW_ICON} ${state === "failing" ? TONE.bad : "text-muted-foreground"}`}>
        {state === "needs" ? <StateMark state="needs-you" hidden /> : <Icon name={iconOf(row, state === "failing")} className="size-4 shrink-0" />}
      </span>
      {/* The name, its sentence and its line take the room that is left, and only that. */}
      <div className="flex min-w-0 flex-col items-start">
        <button type="button" data-testid="oats-automation-open" aria-label={`Open ${shown(row.name)}`} className={`${TARGET} flex min-w-0 max-w-full flex-col items-start justify-center rounded-sm text-left`} onClick={() => onOpen(row)}>
          <span data-testid="oats-automation-name" title={shown(row.id)} className={`${NAME} max-w-full ${off ? "text-muted-foreground" : "text-foreground"}`}>
            {shown(row.name)}
          </span>
          <Sentence row={row} />
          <SmallLine parts={parts} />
        </button>
        {/* Where there is no room beside the switch (a phone's width), "Answer" is a line of its own under the row's. */}
        {onAnswer === undefined ? null : (
          <span className="mt-1.5 @2xl:hidden">
            <Answer name={row.name} onAnswer={onAnswer} />
          </span>
        )}
      </div>
      {/* The controls' fixed block: it never moves for a long name. */}
      <div className="flex shrink-0 items-center gap-1">
        {onAnswer === undefined ? null : (
          <span className="mr-1 hidden @2xl:inline-flex">
            <Answer name={row.name} onAnswer={onAnswer} />
          </span>
        )}
        {acts === undefined ? null : <div data-testid="oats-automation-switch">{acts.switchOf(row)}</div>}
        {acts === undefined ? null : (
          <div data-testid="oats-automation-menu">
            <Menu label={`Actions for ${shown(row.name)}`} items={acts.menuOf(row)}>
              <span className={ICON_BUTTON}>
                <Icon name={ICONS.menu} className="size-4" />
              </span>
            </Menu>
          </div>
        )}
        {/* The chevron says the row opens; the row's own button is the control. */}
        <span aria-hidden="true" className="flex size-5 items-center justify-center text-muted-foreground" onClick={() => onOpen(row)}>
          <Chevron />
        </span>
      </div>
    </div>
  );
}

export type ListProps = {
  /** The two lists, each where it was read. */
  schedules: AutomationList | undefined;
  triggers: AutomationList | undefined;
  /** Every trigger's state; null where it could not be read: then nothing is said of a trigger's fires and failures. */
  statuses: TriggerStatuses | null;
  now: number;
  filter: ListFilter;
  onFilter: (filter: ListFilter) => void;
  query: string;
  onQuery: (query: string) => void;
  onOpen: (row: AutomationRow) => void;
  /** The act of the notice of a scheduler that is off (Enable scheduler), where the page offers it. */
  schedulerAction?: ReactNode;
  acts?: RowActs;
  /** The agent of an automation that asks, by its instance; and how its chat opens. */
  asking?: Asking;
  onAnswer?: (instance: string) => void;
};

export function List({ schedules, triggers, statuses, now, filter, onFilter, query, onQuery, onOpen, schedulerAction, acts, asking, onAnswer }: ListProps) {
  const here = useHere();
  const all = oneList(schedules?.rows ?? [], triggers?.rows ?? []);
  // The host's facts are the same in both lists: whichever was read says them.
  const host = schedules ?? triggers;
  const both = [schedules, triggers].filter((list): list is AutomationList => list !== undefined).map(listBanners);
  const banners = { hostUnnamed: both.some((banner) => banner.hostUnnamed), schedulerOff: both.some((banner) => banner.schedulerOff) };
  // A row's small line, as it is drawn: one place for the row and for the search.
  const lineOf = (row: AutomationRow) => rowLine(row, statusFor(row, statuses), now, { here, asks: (asking?.(row) ?? null) !== null });
  const drawn = inOrder(searchRows(filterList(all, filter, statuses, asking), query, (row) => lineText(lineOf(row))), statuses, asking);
  const count = (id: ListFilter): number => filterList(all, id, statuses, asking).length;
  return (
    // The notices, the search and the filter keep their place; the card of rows takes what is left and scrolls alone.
    <div data-testid="oats-automations-list" className="flex flex-1 flex-col gap-3">
      {banners.hostUnnamed ? (
        <div data-testid="oats-automations-host-unnamed">
          <Notice tone="warning" title={hostUnnamed(here).title} details={hostNameHow(here)} />
        </div>
      ) : null}
      {banners.schedulerOff ? (
        <div data-testid="oats-automations-scheduler-off">
          <Notice tone="warning" title={schedulerOffLine(here)} actions={schedulerAction} />
        </div>
      ) : null}
      {all.length === 0 ? (
        <div data-testid="oats-automations-empty">
          <Empty title={EMPTY} />
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            {all.length < SEARCH_FROM ? null : (
              <div className="flex min-w-40 flex-1">
                <SearchBox label="Search automations" value={query} onChange={onQuery} />
              </div>
            )}
            <FilterPills label="Show" options={LIST_FILTERS.map((option) => ({ ...option, count: count(option.id) }))} value={filter} onChange={onFilter} />
          </div>
          {drawn.length === 0 ? (
            <div data-testid="oats-automations-no-match">
              <Empty title={NO_MATCH} />
            </div>
          ) : (
            <div role="list" aria-label="Automations" data-testid="oats-automations-rows" className={`${CARD} ${ROWS} ${CARD_FLOOR} flex-1 basis-0 overflow-y-auto`}>
              {drawn.map((row) => {
                const status = statusFor(row, statuses);
                const asks = asking?.(row) ?? null;
                return (
                  <Row
                    key={`${row.kind}:${row.id}`}
                    row={row}
                    parts={lineOf(row)}
                    state={attention(row, status, asking)}
                    onOpen={onOpen}
                    onAnswer={asks === null || onAnswer === undefined ? undefined : () => onAnswer(asks)}
                    acts={acts}
                  />
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}
