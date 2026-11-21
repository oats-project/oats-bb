// The Automations page: one page with two tabs, Schedules and Triggers, each a list whose rows
// open their own page. What it draws is handed to it (the lists, a trigger's recorded state):
// Page.tsx reads them through the plugin's server. At a narrow width, as at any other, the list
// and a row's page show one at a time, with Back.
import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { AutomationKind, AutomationList, AutomationRow, TriggerStatus } from "../../contract/automations";
import { Button, Lines, Loading, Notice, Stale, Tabs, Toned } from "../ui";
import { Detail } from "./Detail";
import type { DetailProps } from "./Detail";
import { List } from "./List";
import { readAge } from "../ui/words";
import { schedulerLine, schedulerOn, TITLES } from "./words";
import type { OriginFilter } from "./words";

export const KINDS: readonly AutomationKind[] = ["schedule", "trigger"];

/** One list as the page has it: being read, read, or failed (with what an earlier read answered, if any). */
export type ListRead = {
  list: AutomationList | undefined;
  loading: boolean;
  /** Why the last read failed: the kernel's code (or the plugin's) and message. */
  error: { code: string | null; message: string } | null;
  /** When what is shown was read. */
  readAt: string | null;
};
/** Why a list cannot be shown at all, in place of it: what is missing, and what to do about it. */
export type Gate = { title: string; detail: string | null; code: string | null };

export type ViewProps = {
  kind: AutomationKind;
  onKind: (kind: AutomationKind) => void;
  reads: Record<AutomationKind, ListRead>;
  gate: Gate | null;
  now: number;
  onRefresh: () => void;
  /** The row whose page is open, by its id; null: the list. */
  openId: string | null;
  onOpen: (id: string | null) => void;
  /** The open trigger's recorded state, once read. */
  status: TriggerStatus | null;
  /** Why that state could not be read (again), where it could not. */
  statusFailure?: DetailProps["statusFailure"];
  /** What the page adds for a row: its acts, and the cards they bring. */
  rowParts?: (row: AutomationRow) => Pick<DetailProps, "actions" | "runStateAction" | "sideStart" | "sideEnd" | "identityAction" | "summaryAction">;
  /** The act of the notice of a scheduler that is off (Enable scheduler). */
  schedulerAction?: ReactNode;
  /** A re-read is in flight. */
  refreshing?: boolean;
  /** Above the list: what an act just did (a result). */
  result?: ReactNode;
} & Pick<DetailProps, "onOpenFile" | "hostId" | "canOpenCapability" | "onOpenCapability">;

const PANEL = "oats-automations-panel";
/** A list read longer ago than this is marked with its age (the UX standard, freshness). */
export const STALE_MS = 30_000;

export function View({ kind, onKind, reads, gate, now, onRefresh, openId, onOpen, status, statusFailure, rowParts, schedulerAction, refreshing = false, result, onOpenFile, hostId, canOpenCapability, onOpenCapability }: ViewProps) {
  const read = reads[kind];
  const list = read.list;
  const title = TITLES[kind];
  // The filter and the search are the list's own: another tab starts with neither.
  const [origin, setOrigin] = useState<OriginFilter>("all");
  const [query, setQuery] = useState("");
  const [filtersOf, setFiltersOf] = useState(kind);
  if (filtersOf !== kind) {
    setFiltersOf(kind);
    setOrigin("all");
    setQuery("");
  }
  const row = openId === null ? null : (list?.rows.find((entry) => entry.id === openId) ?? null);
  // A row that left the list (removed, or another tab's) has no page: back to the list.
  useEffect(() => {
    if (openId !== null && list !== undefined && row === null) onOpen(null);
  }, [openId, list, row, onOpen]);
  // Closing a row's page puts focus back on the row it was opened from.
  const panel = useRef<HTMLDivElement>(null);
  const closed = useRef<string | null>(null);
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

  const scheduler = list?.scheduler ?? null;
  return (
    <div data-testid="oats-automations" data-kind={kind} className="@container flex flex-col gap-4">
      {row !== null && list !== undefined && gate === null ? null : (
        <div className="flex flex-wrap items-end gap-x-4 gap-y-2">
          <Tabs label="Automations" tabs={KINDS.map((id) => ({ id, label: TITLES[id], count: reads[id].list?.rows.length }))} value={kind} onChange={onKind} panelId={PANEL} />
          <span className="min-w-0 flex-1" />
          {scheduler === null || gate !== null ? null : (
            <span data-testid="oats-automations-scheduler" className="min-w-0 text-xs text-muted-foreground">
              <Toned tone={schedulerOn(scheduler) ? "ok" : "bad"}>{schedulerLine(scheduler, now)}</Toned>
            </span>
          )}
          <span className="flex items-center gap-2 pb-1">
            <Button data-testid="oats-automations-refresh" aria-label={`Refresh ${title.toLowerCase()}`} title="Refresh" disabled={read.loading || refreshing} onClick={onRefresh}>
              Refresh
            </Button>
          </span>
        </div>
      )}
      <div ref={panel} id={PANEL} role="tabpanel" aria-labelledby={`${PANEL}-tab-${kind}`} className="flex flex-col gap-4">
        {gate !== null ? (
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
            {read.error === null ? (
              // What is shown was read a while ago, or is being read again: it says so, with its age.
              list !== undefined && read.readAt !== null && (refreshing || now - Date.parse(read.readAt) > STALE_MS) ? (
                <Stale age={readAge(read.readAt, now)} refreshing={refreshing} />
              ) : null
            ) : (
              <div data-testid="oats-automations-failed">
                <Notice
                  tone="error"
                  title={`${title} could not be read`}
                  code={read.error.code}
                  {...(list !== undefined && read.readAt !== null ? { age: readAge(read.readAt, now) } : {})}
                  actions={
                    <Button data-testid="oats-automations-retry" disabled={refreshing} onClick={onRefresh}>
                      Retry
                    </Button>
                  }
                >
                  <p>
                    <Lines text={read.error.message} />
                  </p>
                  {refreshing ? (
                    <p role="status" data-testid="oats-automations-rereading">
                      Refreshing…
                    </p>
                  ) : null}
                </Notice>
              </div>
            )}
            {result}
            {list === undefined ? (
              read.loading ? (
                <Loading>{`Reading ${title.toLowerCase()}…`}</Loading>
              ) : null
            ) : row !== null ? (
              <Detail
                row={row}
                host={list.host}
                now={now}
                status={row.kind === "trigger" ? status : null}
                statusFailure={row.kind === "trigger" ? statusFailure : null}
                onBack={() => onOpen(null)}
                onOpenFile={onOpenFile}
                hostId={hostId}
                canOpenCapability={canOpenCapability}
                onOpenCapability={onOpenCapability}
                {...rowParts?.(row)}
              />
            ) : (
              <List list={list} now={now} origin={origin} onOrigin={setOrigin} query={query} onQuery={setQuery} onOpen={onOpen} schedulerAction={schedulerAction} />
            )}
          </>
        )}
      </div>
    </div>
  );
}
