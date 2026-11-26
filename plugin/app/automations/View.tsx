// The Automations page, in the manner of bb's own: two tabs, "Automations" (ONE list, schedules
// and triggers together) and "Runs" (every automation's runs, newest first), and a row's own page.
// What it draws is handed to it (the lists, every trigger's state, the open trigger's own read):
// Page.tsx reads them through the plugin's server. The list and a row's page show one at a time.
// The list's card scrolls alone, under a head that stays; a row's page and the Runs tab scroll whole.
import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { AutomationKind, AutomationList, AutomationRow, TriggerStatus, TriggerStatuses } from "../../contract/automations";
import { allRuns } from "../../model/automation-runs";
import type { RunOwner } from "../../model/automation-runs";
import { Button, Lines, Loading, Notice, Stale } from "../ui";
import { BUTTON_OUTLINE, PillTabs } from "./bb";
import { readAge } from "../ui/words";
import { Detail } from "./Detail";
import type { DetailProps } from "./Detail";
import { List } from "./List";
import type { RowActs } from "./List";
import { RunsTab } from "./Runs";
import type { AgentLink } from "./Runs";
import { schedulerOn, TITLES } from "./words";
import type { Asking, ListFilter } from "./words";

export const KINDS: readonly AutomationKind[] = ["schedule", "trigger"];
/** The page's two tabs. */
export type Tab = "list" | "runs";
/** The row whose page is open: its kind and its qualified id. */
export type Open = { kind: AutomationKind; id: string };

/** One list as the page has it: being read, read, or failed (with what an earlier read answered, if any). */
export type ListRead = {
  list: AutomationList | undefined;
  loading: boolean;
  /** Why the last read failed: the kernel's code (or the plugin's) and message. */
  error: { code: string | null; message: string } | null;
  /** When what is shown was read. */
  readAt: string | null;
};
/** Why the lists cannot be shown at all, in place of them: what is missing, and what to do about it. */
export type Gate = { title: string; detail: string | null; code: string | null };

export type ViewProps = {
  tab: Tab;
  onTab: (tab: Tab) => void;
  reads: Record<AutomationKind, ListRead>;
  /** Every trigger's state, as last read; null where it could not be: nothing is then said of a trigger's fires and failures. */
  statuses: TriggerStatuses | null;
  gate: Gate | null;
  now: number;
  onRefresh: () => void;
  /** The row whose page is open; null: the tabs. */
  open: Open | null;
  onOpen: (open: Open | null) => void;
  /** The open trigger's recorded state, once read. */
  status: TriggerStatus | null;
  /** Why that state could not be read (again), where it could not. */
  statusFailure?: DetailProps["statusFailure"];
  /** What the page adds for a row: its switch, its menu, and what its acts put on the page. */
  rowParts?: (row: AutomationRow) => Pick<DetailProps, "identityAction" | "menu" | "answers" | "file">;
  /** The act of the notice of a scheduler that is off (Enable scheduler). */
  schedulerAction?: ReactNode;
  /** A row's switch and menu in the list, where the page has acts. */
  rowActs?: RowActs;
  /** Why a kind's acts are held (its list could not be read again), where the page has acts. */
  held?: string | null;
  /** In the lists' place where OATS itself cannot be read and no list is kept: the plugin's one notice for that. */
  gateNotice?: ReactNode;
  /** A re-read is in flight. */
  refreshing?: boolean;
  /** Above the list: what an act just did (a result). */
  result?: ReactNode;
  agentLink?: AgentLink;
  /** The agent of an automation that asks, by its instance (the page answers it from the roster), and how its chat opens. */
  asking?: Asking;
  onAnswer?: (instance: string) => void;
} & Pick<DetailProps, "onOpenFile" | "canOpenCapability" | "onOpenCapability">;

const PANEL = "oats-automations-panel";
/** A list read longer ago than this is marked with its age (the UX standard, freshness). */
export const STALE_MS = 30_000;
// Room is kept under the page's content (pb-16): the dock of every OATS page stands at its bottom right, and must cover no last row.
// bb's own page's frame (its width and its paddings), with that room under it.
const FRAME = "mx-auto box-border flex w-full max-w-5xl flex-col gap-4 px-4 pb-16 pt-3 text-sm text-foreground md:px-5 md:pt-4";

export function View({ tab, onTab, reads, statuses, gate, now, onRefresh, open, onOpen, status, statusFailure, rowParts, schedulerAction, refreshing = false, result, rowActs, held, gateNotice, onOpenFile, canOpenCapability, onOpenCapability, agentLink, asking, onAnswer }: ViewProps) {
  // The filter and the search are the list's own, kept while a row's page or the other tab is shown.
  const [filter, setFilter] = useState<ListFilter>("all");
  const [query, setQuery] = useState("");
  const schedules = reads.schedule.list;
  const triggers = reads.trigger.list;
  const listOfOpen = open === null ? undefined : reads[open.kind].list;
  const row = open === null ? null : (listOfOpen?.rows.find((entry) => entry.id === open.id) ?? null);
  // A row that left its list (removed) has no page: back to the list.
  useEffect(() => {
    if (open !== null && listOfOpen !== undefined && row === null) onOpen(null);
  }, [open, listOfOpen, row, onOpen]);
  // Closing a row's page puts focus back on the row it was opened from.
  const panel = useRef<HTMLDivElement>(null);
  const closed = useRef<string | null>(null);
  const openId = open?.id ?? null;
  useEffect(() => {
    if (openId !== null) {
      closed.current = openId;
      return;
    }
    const id = closed.current;
    closed.current = null;
    if (id === null) return;
    const rows = Array.from(panel.current?.querySelectorAll<HTMLElement>('[data-testid="oats-automation-row"]') ?? []);
    rows.find((candidate) => candidate.dataset.id === id)?.querySelector<HTMLElement>('[data-testid="oats-automation-open"]')?.focus();
  }, [openId]);

  // What stands in the lists' place: the page's own gate, or the plugin's one notice for an OATS that cannot be read.
  const unreadable = gateNotice ?? null;
  const gated = gate !== null || unreadable !== null;
  const onRowPage = row !== null && listOfOpen !== undefined && !gated;
  const any = schedules !== undefined || triggers !== undefined;
  const loading = reads.schedule.loading || reads.trigger.loading;
  // What is shown was read a while ago, or is being read again: it says so, with its age (the older of the two).
  const readAts = KINDS.map((kind) => reads[kind].readAt).filter((at): at is string => at !== null);
  const oldest = readAts.length === 0 ? null : readAts.reduce((a, b) => (Date.parse(a) <= Date.parse(b) ? a : b));
  const failed = KINDS.filter((kind) => reads[kind].error !== null);
  // One fault that failed both reads (the server did not answer, OATS itself refused) is said once, of the automations; a list that failed alone by its own name.
  const both = failed.length === 2 && reads.schedule.error?.code === reads.trigger.error?.code && reads.schedule.error?.message === reads.trigger.error?.message;
  const said: { kind: AutomationKind; title: string; noun: string }[] = both ? [{ kind: "schedule", title: "Automations", noun: "automations" }] : failed.map((kind) => ({ kind, title: TITLES[kind], noun: TITLES[kind].toLowerCase() }));
  const total = (schedules?.rows.length ?? 0) + (triggers?.rows.length ?? 0);
  const runs = allRuns(schedules?.rows ?? [], triggers?.rows ?? [], statuses ?? []);
  const host = schedules ?? triggers;
  const running = host === undefined || host.scheduler === null || schedulerOn(host.scheduler);
  const openOwner = (owner: RunOwner) => onOpen({ kind: owner.kind, id: owner.id });
  // The list's tab takes the page's height, and its card of rows scrolls alone under a head that stays, while the head, the notices
  // and a floor of rows fit (List.tsx: the card's least height); when they do not (a notice or two over the list at a phone's width),
  // the page scrolls whole, so that the rows are never squeezed to nothing behind a notice. Everything else scrolls whole.
  const fixed = !onRowPage && !gated && tab === "list";

  const notices = (
    <>
      {failed.length === 0 ? (
        any && oldest !== null && (refreshing || now - Date.parse(oldest) > STALE_MS) ? <Stale age={readAge(oldest, now)} refreshing={refreshing} /> : null
      ) : (
        said.map(({ kind, title, noun }) => {
          const read = reads[kind];
          const kept = both ? any : read.list !== undefined;
          return (
            <div key={kind} data-testid="oats-automations-failed" data-kind={both ? "both" : kind}>
              <Notice
                tone="error"
                title={`${title} could not be read`}
                code={read.error?.code}
                details={read.error?.message}
                {...(kept && read.readAt !== null ? { age: readAge(read.readAt, now) } : {})}
                actions={
                  <Button data-testid="oats-automations-retry" disabled={refreshing} onClick={onRefresh}>
                    Retry
                  </Button>
                }
              >
                {/* A person's words; what OATS or the plugin's server said is one press away, under Details. */}
                <p>{kept ? `What is below is the last list that was read.` : `Nothing can be shown of this deployment's ${noun} until they are read.`}</p>
                {/* The rows are still shown, and the page has acts: they are held, and that is said here. */}
                {kept && held !== undefined && held !== null ? <p data-testid="oats-automations-held">{held}</p> : null}
                {refreshing ? (
                  <p role="status" data-testid="oats-automations-rereading">
                    Refreshing…
                  </p>
                ) : null}
              </Notice>
            </div>
          );
        })
      )}
      {result}
    </>
  );

  return (
    <div data-testid="oats-automations-page" data-fixed={fixed} className="h-full min-h-0 overflow-y-auto">
      <div data-testid="oats-automations" data-tab={tab} className={`@container ${FRAME} ${fixed ? "h-full" : ""}`}>
        {onRowPage ? null : (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <PillTabs
              label="Automations"
              tabs={[
                { id: "list", label: "Automations", count: any ? total : undefined },
                { id: "runs", label: "Runs" },
              ]}
              value={tab}
              onChange={onTab}
              panelId={PANEL}
            />
            <button type="button" data-testid="oats-automations-refresh" aria-label="Refresh automations" title="Refresh" className={BUTTON_OUTLINE} disabled={loading || refreshing} onClick={onRefresh}>
              Refresh
            </button>
          </div>
        )}
        {/* A row's page draws no tabs, so no tab is there to name the panel: it is named in words. */}
        <div ref={panel} id={PANEL} role="tabpanel" aria-labelledby={onRowPage ? undefined : `${PANEL}-tab-${tab}`} aria-label={onRowPage ? "Automation" : undefined} className={`flex flex-col gap-4 ${fixed ? "flex-1" : ""}`}>
          {unreadable !== null ? (
            // OATS itself cannot be read (no `oats`, no deployment, no machine): the one notice every place of the plugin shows for it.
            <div data-testid="oats-automations-gate">{unreadable}</div>
          ) : gate !== null ? (
            <div data-testid="oats-automations-gate">
              <Notice title={gate.title} code={gate.code}>
                {gate.detail === null ? null : (
                  <p>
                    <Lines text={gate.detail} />
                  </p>
                )}
              </Notice>
            </div>
          ) : (
            <>
              {notices}
              {!any ? (
                loading ? (
                  <Loading>Reading automations…</Loading>
                ) : null
              ) : row !== null && listOfOpen !== undefined ? (
                <Detail
                  row={row}
                  host={listOfOpen.host}
                  now={now}
                  running={running}
                  status={row.kind === "trigger" ? status : null}
                  statusFailure={row.kind === "trigger" ? statusFailure : null}
                  onBack={() => onOpen(null)}
                  onOpenFile={onOpenFile}
                  canOpenCapability={canOpenCapability}
                  onOpenCapability={onOpenCapability}
                  agentLink={agentLink}
                  asks={asking?.(row) ?? null}
                  onAnswer={onAnswer}
                  {...rowParts?.(row)}
                />
              ) : tab === "runs" ? (
                <RunsTab entries={runs.entries} cut={runs.cut} now={now} onOpenOwner={openOwner} agentLink={agentLink} />
              ) : (
                <List
                  schedules={schedules}
                  triggers={triggers}
                  statuses={statuses}
                  now={now}
                  filter={filter}
                  onFilter={setFilter}
                  query={query}
                  onQuery={setQuery}
                  onOpen={(opened) => onOpen({ kind: opened.kind, id: opened.id })}
                  schedulerAction={schedulerAction}
                  acts={rowActs}
                  asking={asking}
                  onAnswer={onAnswer}
                />
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
