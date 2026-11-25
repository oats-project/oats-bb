// The Automations list, in the manner of bb's own Automations page: ONE card of rows, schedules
// and triggers together. A row is an icon of its kind (bb's red mark while it is failing), its
// name, and under it one small line (who it starts · when · the next run or the last fire · what
// is wrong, in red), then its switch, its "…" menu and a chevron. What is failing comes first.
// Over the card, from twelve rows, a search; and one filter of four with counts. The card scrolls
// alone: the search and the filter stay. Every part has a fixed place, so a name of sixty
// characters runs into nothing: it is never cut, and wraps whole where it must (bb's own row cuts
// a name with an ellipsis; names that differ only in their last word must be told apart: WORDS.md).
import type { ReactNode } from "react";
import { experimental_Icon as Icon } from "@get-bb/plugin-sdk/app";
import type { AutomationList, AutomationRow, TriggerStatuses } from "../../contract/automations";
import { Empty, Menu, Notice, TARGET } from "../ui";
import type { MenuItem } from "../ui";
import { shown } from "../ui/text";
import { CARD, Chevron, FilterPills, ICON_BUTTON, ICONS, NAME, ROW, ROW_ICON, ROWS, SearchBox, SMALL } from "./bb";
import { useHere } from "./here";
import { EMPTY, failing, failingFirst, filterList, hostNameHow, hostUnnamed, LIST_FILTERS, listBanners, NO_MATCH, oneList, rowLine, schedulerOffLine, schedulerOn, SEARCH_FROM, searchRows, statusFor } from "./words";
import type { LinePart, ListFilter } from "./words";

/** What a row's acts add to it, where the page has them: its switch and its menu, at the row's end. */
export type RowActs = { switchOf: (row: AutomationRow) => ReactNode; menuOf: (row: AutomationRow) => MenuItem[] };

/** A row's icon: bb's red mark while it is failing, else its kind's (a wake has its own). */
export const iconOf = (row: AutomationRow, bad: boolean): string => (bad ? ICONS.failing : row.kind === "trigger" ? ICONS.trigger : row.run === "wake" ? ICONS.wake : ICONS.schedule);
const KIND_NAME = { schedule: "Schedule", trigger: "Trigger" } as const;

const TONE = { bad: "text-destructive-text", warn: "text-warning-text" } as const;

/**
 * The small line: its parts with "·" between them where there is room for one line, and each
 * part on a line of its own where there is not (bb's own row does the same at a phone's width).
 * A part is never cut: one longer than its line wraps.
 */
export function SmallLine({ parts }: { parts: readonly LinePart[] }) {
  return (
    <span data-testid="oats-automation-line" className={`${SMALL} flex min-w-0 flex-col gap-y-0.5 @2xl:min-h-5 @2xl:flex-row @2xl:flex-wrap @2xl:items-center`}>
      {parts.map((part, at) => (
        <span key={at} data-part="" data-tone={part.tone ?? undefined} title={part.title} className={`min-w-0 break-words ${part.tone === undefined ? "" : TONE[part.tone]}`}>
          {at === 0 ? null : (
            <span aria-hidden="true" className="mx-1.5 hidden shrink-0 text-muted-foreground @2xl:inline">
              ·
            </span>
          )}
          {shown(part.text)}
        </span>
      ))}
    </span>
  );
}

function Row({ row, parts, bad, onOpen, acts }: { row: AutomationRow; parts: readonly LinePart[]; bad: boolean; onOpen: (row: AutomationRow) => void; acts?: RowActs }) {
  const off = !row.enabledHere && row.group !== "elsewhere";
  return (
    <div role="listitem" data-testid="oats-automation-row" data-id={row.id} data-kind={row.kind} data-failing={bad} className={ROW}>
      {/* The icon's fixed place. Its name is said: a kind is never told by a glyph alone. */}
      <span role="img" aria-label={bad ? "Failing" : KIND_NAME[row.kind]} data-testid="oats-automation-icon" className={`${ROW_ICON} ${bad ? TONE.bad : "text-muted-foreground"}`}>
        <Icon name={iconOf(row, bad)} className="size-4 shrink-0" />
      </span>
      {/* The name and its line take the room that is left, and only that. */}
      <button type="button" data-testid="oats-automation-open" aria-label={`Open ${shown(row.name)}`} className={`${TARGET} flex min-w-0 flex-col items-start justify-center rounded-sm text-left`} onClick={() => onOpen(row)}>
        <span data-testid="oats-automation-name" title={shown(row.id)} className={`${NAME} max-w-full ${off ? "text-muted-foreground" : "text-foreground"}`}>
          {shown(row.name)}
        </span>
        <SmallLine parts={parts} />
      </button>
      {/* The controls' fixed block: it never moves for a long name. */}
      <div className="flex shrink-0 items-center gap-1">
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
};

export function List({ schedules, triggers, statuses, now, filter, onFilter, query, onQuery, onOpen, schedulerAction, acts }: ListProps) {
  const here = useHere();
  const all = oneList(schedules?.rows ?? [], triggers?.rows ?? []);
  // The host's facts are the same in both lists: whichever was read says them.
  const host = schedules ?? triggers;
  const both = [schedules, triggers].filter((list): list is AutomationList => list !== undefined).map(listBanners);
  const banners = { hostUnnamed: both.some((banner) => banner.hostUnnamed), schedulerOff: both.some((banner) => banner.schedulerOff) };
  // Nothing runs while the host scheduler is off: no row has a next run.
  const running = host === undefined || host.scheduler === null || schedulerOn(host.scheduler);
  const drawn = failingFirst(searchRows(filterList(all, filter, statuses), query), statuses);
  const count = (id: ListFilter): number => filterList(all, id, statuses).length;
  return (
    // The notices, the search and the filter keep their place; the card of rows takes what is left and scrolls alone.
    <div data-testid="oats-automations-list" className="flex min-h-0 flex-1 flex-col gap-3">
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
            <div role="list" aria-label="Automations" data-testid="oats-automations-rows" className={`${CARD} ${ROWS} min-h-0 flex-1 overflow-y-auto`}>
              {drawn.map((row) => {
                const status = statusFor(row, statuses);
                return <Row key={`${row.kind}:${row.id}`} row={row} parts={rowLine(row, status, now, running)} bad={failing(row, status)} onOpen={onOpen} acts={acts} />;
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}
