// The Automations page: one page with two tabs, Schedules and Triggers, each a list whose rows
// open their own page. What it draws is handed to it (the lists, a trigger's recorded state):
// Page.tsx reads them through the plugin's server. At a narrow width, as at any other, the list
// and a row's page show one at a time, with Back.
import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { AutomationKind, AutomationList, AutomationRow, TriggerStatus } from "../../contract/automations";
import { Button, ErrorLine, Note } from "../ui";
import { shown } from "../ui/text";
import { Detail } from "./Detail";
import type { DetailProps } from "./Detail";
import { List } from "./List";
import { Tabs, ToneDot } from "./parts";
import { schedulerLine, schedulerOn, TITLES } from "./words";
import type { OriginFilter } from "./words";

export const KINDS: readonly AutomationKind[] = ["schedule", "trigger"];

/** One list as the page has it: being read, read, or failed (with what an earlier read answered, if any). */
export type ListRead = { list: AutomationList | undefined; loading: boolean; error: string | null };
/** Why a list cannot be shown at all, in place of it: what is missing, and what to do about it. */
export type Gate = { title: string; detail: string | null };

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
  /** What the page adds for a row: its acts, and the cards they bring. */
  rowParts?: (row: AutomationRow) => Pick<DetailProps, "actions" | "runStateAction" | "sideStart" | "sideEnd" | "identityAction" | "summaryAction">;
  /** Beside Refresh (New schedule), and in the banner of a scheduler that is off (Enable scheduler). */
  headerActions?: ReactNode;
  schedulerAction?: ReactNode;
  /** A line above the list: what an act just did. */
  notice?: string | null;
} & Pick<DetailProps, "onOpenFile" | "canOpenCapability" | "onOpenCapability">;

const PANEL = "oats-automations-panel";

export function View({ kind, onKind, reads, gate, now, onRefresh, openId, onOpen, status, rowParts, headerActions, schedulerAction, notice, onOpenFile, canOpenCapability, onOpenCapability }: ViewProps) {
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
    <div data-testid="oats-automations" data-kind={kind} className="flex flex-col gap-4">
      {row !== null && list !== undefined ? null : (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-border">
          <Tabs label="Automations" tabs={KINDS.map((id) => ({ id, title: TITLES[id], count: reads[id].list?.rows.length ?? null }))} chosen={kind} onChoose={onKind} panelId={PANEL} />
          <span className="min-w-0 flex-1" />
          {scheduler === null || gate !== null ? null : (
            <span data-testid="oats-automations-scheduler" className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
              <ToneDot tone={schedulerOn(scheduler) ? "ok" : "warn"} />
              <span className="min-w-0 break-words">{schedulerLine(scheduler, now)}</span>
            </span>
          )}
          <span className="flex items-center gap-2 pb-1">
            {headerActions}
            <Button data-testid="oats-automations-refresh" aria-label={`Refresh ${title.toLowerCase()}`} title="Refresh" disabled={read.loading} onClick={onRefresh}>
              Refresh
            </Button>
          </span>
        </div>
      )}
      <div ref={panel} id={PANEL} role="tabpanel" aria-labelledby={`${PANEL}-tab-${kind}`} className="flex flex-col gap-4">
        {gate !== null ? (
          <div data-testid="oats-automations-gate" className="mx-auto flex max-w-md flex-col gap-1 py-8 text-center text-sm">
            <strong className="text-base font-semibold text-foreground">{gate.title}</strong>
            {gate.detail === null ? null : <span className="break-words text-muted-foreground">{shown(gate.detail)}</span>}
          </div>
        ) : (
          <>
            {read.error === null ? null : <ErrorLine onRetry={onRefresh}>{read.error}</ErrorLine>}
            {notice ? (
              <p role="status" data-testid="oats-automations-notice" className="break-words text-sm text-foreground">
                {shown(notice)}
              </p>
            ) : null}
            {list === undefined ? (
              read.loading ? (
                <Note>{`Reading ${title.toLowerCase()}…`}</Note>
              ) : null
            ) : row !== null ? (
              <Detail
                row={row}
                host={list.host}
                now={now}
                status={row.kind === "trigger" ? status : null}
                onBack={() => onOpen(null)}
                onOpenFile={onOpenFile}
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
