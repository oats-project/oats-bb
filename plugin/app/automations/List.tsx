// One Automations list (Schedules or Triggers): the rows grouped by where they run, because the
// first question is what THIS computer does. Workspace (Git) and local items sit together, each
// marked with where it comes from. A row opens its page. In the Desktop's words and order
// (awebai/oats packages/desktop/renderer/views/automations.mjs at a4a43220).
import type { ReactNode } from "react";
import type { AutomationList, AutomationRow } from "../../contract/automations";
import { Chip, Empty, Menu, Notice, SearchField, Segmented, TARGET, Toned } from "../ui";
import type { MenuItem } from "../ui";
import { shown } from "../ui/text";
import {
  actsAs,
  capabilitySource,
  cronInWords,
  filterRows,
  groupRows,
  HOST_UNNAMED,
  hostUnnamedDetail,
  lastNext,
  listBanners,
  NOUNS,
  onSummary,
  ORIGIN_FILTERS,
  placementText,
  SCHEDULER_OFF,
  snapshotLine,
  soulOriginText,
  summaryLine,
  templateLabel,
  TITLES,
} from "./words";
import type { OriginFilter } from "./words";

const HEADS = ["Automation", "Soul", "When", "Runs on", "Last · next"] as const;
/** What a row's acts add to it, where the page has them: its switch before its name, its menu after its facts. */
export type RowActs = { switchOf: (row: AutomationRow) => ReactNode; menuOf: (row: AutomationRow) => MenuItem[] };
// One row is a grid of five cells from bb's wide layout up, and a stack below it.
const GRID = "@4xl:grid @4xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)_minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1fr)_auto] @4xl:gap-3";
const CELL = "flex min-w-0 flex-col gap-0.5";
const SUB = "min-w-0 break-words text-xs text-muted-foreground";

/** Where a row comes from: "local", or the member whose repository holds it. */
export function OriginTag({ row }: { row: AutomationRow }) {
  const local = row.origin.kind === "local";
  return <Chip title={local ? "Local to this computer" : shown([row.origin.repoKey, row.origin.path].filter(Boolean).join(" · "))}>{local ? "local" : shown(row.origin.member ?? "workspace")}</Chip>;
}

/** What is to be said of a row's state: off here, a failed source check, invalid, unreadable, its package template. */
export function StateTags({ row }: { row: AutomationRow }) {
  const bad = row.unreadable ?? row.invalid;
  // A capability source's check that failed at a poll (`invalid` with a time) is a state of its
  // own: the definition is as written, its source no longer answers to it.
  const check = row.unreadable === null && row.kind === "trigger" && capabilitySource(row.on) !== null && row.invalid !== null && row.invalid.at !== null;
  const template = templateLabel(row.template);
  return (
    <>
      {!row.enabledHere && row.group !== "elsewhere" ? <Chip tone="muted">Off here</Chip> : null}
      {check ? (
        <Chip tone="warn" title={shown(row.invalid?.message ?? row.invalid?.code ?? "")}>
          Source check failed
        </Chip>
      ) : bad !== null ? (
        <Chip tone="warn" title={shown(bad.message ?? bad.code ?? "")}>
          {row.unreadable !== null ? "Unreadable" : "Invalid"}
        </Chip>
      ) : null}
      {template === null ? null : <Chip tone="muted" title={shown(`From the package template ${template}${row.template?.version ? ` ${row.template.version}` : ""}`)}>{shown(template)}</Chip>}
    </>
  );
}

/** The summary line: authored, derived from the prompt's first line (in italics, its title says so), or "No summary". */
export function Summary({ row }: { row: AutomationRow }) {
  const summary = summaryLine(row);
  if (summary === null) return <span className={SUB}>No summary</span>;
  return (
    <span title={shown(summary.title)} data-derived={summary.derived} className={`${SUB} ${summary.derived ? "italic" : ""}`}>
      {shown(summary.text)}
    </span>
  );
}

function Row({ row, list, now, onOpen, acts }: { row: AutomationRow; list: AutomationList; now: number; onOpen: (id: string) => void; acts?: RowActs }) {
  const off = !row.enabledHere && row.group !== "elsewhere";
  const main = `min-w-0 break-words ${off ? "text-muted-foreground" : "text-foreground"}`;
  const place = placementText(row, list.host);
  const cell = lastNext(row, now);
  const on = row.kind === "trigger" ? onSummary(row.on) : null;
  const words = cronInWords(row.cron);
  const label = (head: string): ReactNode => <span className="sr-only @4xl:hidden">{`${head}: `}</span>;
  return (
    <div role="row" data-testid="oats-automation-row" data-id={row.id} data-group={row.group} className={`${GRID} flex flex-col gap-2 border-t border-border px-3 py-2 text-sm first:border-t-0`}>
      <div role="cell" className={CELL}>
        {acts === undefined ? null : <div data-testid="oats-automation-switch">{acts.switchOf(row)}</div>}
        <button
          type="button"
          data-testid="oats-automation-open"
          aria-label={`Open ${shown(row.id)}`}
          className={`${TARGET} flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 rounded text-left hover:underline`}
          onClick={() => onOpen(row.id)}
        >
          <span title={shown(row.id)} className={`min-w-0 break-all font-mono font-semibold ${off ? "text-muted-foreground" : "text-foreground"}`}>
            {shown(row.name)}
          </span>
          <OriginTag row={row} />
          <StateTags row={row} />
        </button>
        <Summary row={row} />
        {/* Not trusted here: the kernel's words, which name the oats-local.yaml line to add, in the row itself. */}
        {row.reason === "untrusted" && row.reasonDetail !== null ? <span className={SUB}>{shown(row.reasonDetail)}</span> : null}
      </div>
      <div role="cell" className={CELL}>
        {label("Soul")}
        {row.soul === null ? (
          <span className={SUB}>{row.run !== null && row.run !== "spawn" ? shown(row.run) : "Not reported"}</span>
        ) : (
          <>
            <span title={shown(`${row.soul.name} · ${soulOriginText(row.soul.origin).long}`)} className={`${main} font-mono`}>
              {shown(row.soul.name)}
            </span>
            <span className={SUB}>{shown(soulOriginText(row.soul.origin).short)}</span>
          </>
        )}
      </div>
      <div role="cell" className={CELL}>
        {label("When")}
        {row.kind === "schedule" ? (
          <>
            <span title={shown([row.cron, row.tz].filter(Boolean).join(" · "))} className={main}>
              {shown(words ?? row.cron ?? "Not reported")}
            </span>
            {/* The cron itself goes under its words; with no words, the line above is already the cron. */}
            <span className={`${SUB} font-mono`}>{shown([words !== null ? row.cron : null, row.tz].filter(Boolean).join(" · "))}</span>
          </>
        ) : (
          <>
            <span className={main}>{shown(on?.title ?? "Not reported")}</span>
            {on === null ? null : <span className={SUB}>{shown([on.repo, ...on.labels.map((entry) => `#${entry}`)].filter(Boolean).join(" · "))}</span>}
          </>
        )}
      </div>
      <div role="cell" className={CELL}>
        {label("Runs on")}
        <span data-testid="oats-automation-place" title={place.detail === null ? undefined : shown(place.detail)} className={`${place.tone === "bad" ? "font-semibold" : ""} ${main}`}>
          <Toned tone={place.tone}>{shown(place.label)}</Toned>
        </span>
        <span className={SUB}>{shown(actsAs(row))}</span>
      </div>
      <div role="cell" className={CELL}>
        {label("Last and next")}
        {cell === null ? (
          <span className={SUB}>—</span>
        ) : (
          <>
            <span title={cell.nextTitle} className={main}>
              {cell.next}
            </span>
            <span title={cell.lastTitle ?? undefined} className={SUB}>
              {shown(cell.last)}
            </span>
          </>
        )}
      </div>
      {acts === undefined ? null : (
        <div data-testid="oats-automation-menu" className="flex items-start @4xl:justify-end">
          <Menu label={`Actions for ${shown(row.id)}`} items={acts.menuOf(row)} />
        </div>
      )}
    </div>
  );
}

export type ListProps = {
  list: AutomationList;
  now: number;
  origin: OriginFilter;
  onOrigin: (origin: OriginFilter) => void;
  query: string;
  onQuery: (query: string) => void;
  onOpen: (id: string) => void;
  /** The act of the notice of a scheduler that is off (Enable scheduler), where the page offers it. */
  schedulerAction?: ReactNode;
  acts?: RowActs;
};

export function List({ list, now, origin, onOrigin, query, onQuery, onOpen, schedulerAction, acts }: ListProps) {
  const title = TITLES[list.kind];
  const lower = title.toLowerCase();
  const rows = list.rows;
  const banners = listBanners(list);
  const shown_ = filterRows(rows, { origin, query });
  return (
    <div data-testid="oats-automations-list" className="flex flex-col gap-4">
      {banners.hostUnnamed ? (
        <div data-testid="oats-automations-host-unnamed">
          <Notice tone="warning" title={HOST_UNNAMED.title}>
            {hostUnnamedDetail(list.kind)}
          </Notice>
        </div>
      ) : null}
      {banners.schedulerOff ? (
        <div data-testid="oats-automations-scheduler-off">
          <Notice tone="warning" title={SCHEDULER_OFF.title} actions={schedulerAction}>
            {SCHEDULER_OFF.detail}
          </Notice>
        </div>
      ) : null}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Segmented
          label={`Show ${lower} from`}
          options={ORIGIN_FILTERS.map((option) => ({ ...option, count: option.id === "all" ? rows.length : rows.filter((row) => row.origin.kind === option.id).length }))}
          value={origin}
          onChange={onOrigin}
        />
        <div className="w-full @xl:w-60">
          <SearchField label={`Search ${lower}`} value={query} onChange={onQuery} />
        </div>
      </div>
      {rows.length === 0 ? (
        <div data-testid="oats-automations-empty">
          <Empty title={`No ${lower} yet`}>{`Commit one to a member repository's ${NOUNS[list.kind]}s folder to share it with the workspace, or add a local one on this computer.`}</Empty>
        </div>
      ) : shown_.length === 0 ? (
        <Empty>{`No ${lower} match.`}</Empty>
      ) : null}
      {groupRows(shown_).map((group) => {
        const headId = `oats-automations-${list.kind}-${group.id}`;
        return (
          <section key={group.id} data-testid="oats-automations-group" data-group={group.id} className="flex flex-col gap-2">
            <h3 id={headId} className={`flex items-baseline gap-2 text-sm font-semibold ${group.id === "attention" ? "text-warning-text" : "text-foreground"}`}>
              <span>{group.title}</span>
              <span className="text-xs font-normal text-muted-foreground">{group.rows.length}</span>
            </h3>
            <div role="table" aria-labelledby={headId} className="overflow-hidden rounded-md border border-border bg-card">
              <div role="row" className={`${GRID} hidden border-b border-border px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground`}>
                {HEADS.map((head) => (
                  <span key={head} role="columnheader">
                    {head}
                  </span>
                ))}
              </div>
              {group.rows.map((row) => (
                <Row key={row.id} row={row} list={list} now={now} onOpen={onOpen} acts={acts} />
              ))}
            </div>
          </section>
        );
      })}
      <p data-testid="oats-automations-foot" className="text-xs text-muted-foreground">
        {snapshotLine(list, now)}
      </p>
    </div>
  );
}
