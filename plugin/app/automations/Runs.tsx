// The Runs table, in the manner of bb's own: one row per run: a mark (with its word: never a glyph
// or a colour alone), when, what happened in a person's word, and the agent the run made, as a
// link to it while the roster lists it. A run with the kernel's own words on it (a failure's code
// and message) opens to them. A long history is bounded: the first rows, then "Older"; and where
// the automation keeps less than it ran, the table says so under itself.
// It is one table for both places: an automation's own page, and the page's Runs tab (every
// automation's runs, newest first, each led by its automation's name; filtered by automation and
// by result).
import { useState } from "react";
import { experimental_Icon as Icon } from "@get-bb/plugin-sdk/app";
import type { RunEntry, RunOwner } from "../../model/automation-runs";
import { LINK, TARGET } from "../ui";
import { BUTTON_OUTLINE, FilterPills, RUN_ERROR, RUN_ROW, RUNS_BOX } from "./bb";
import { shown } from "../ui/text";
import { earlierNotKept, NO_RUNS, OLDER, runFailed, runLine, runWhen, RUNS_SHOWN } from "./words";
import type { RunLine, RunMark } from "./words";

/** The marks, by bb's own names for their icons (each seen to resolve on bb-app 0.50.1 by the live check), their accessible names and their tones. */
export const MARKS: Record<RunMark, { icon: string; name: string; tone: string }> = {
  done: { icon: "CircleCheck", name: "Done", tone: "text-muted-foreground" },
  failed: { icon: "CircleX", name: "Failed", tone: "text-destructive-text" },
  unknown: { icon: "CircleHelp", name: "Not known", tone: "text-warning-text" },
  running: { icon: "LoaderCircle", name: "Running", tone: "text-muted-foreground" },
  waiting: { icon: "Clock", name: "Waiting", tone: "text-muted-foreground" },
};

/** How an agent's name opens the agent: null where the roster no longer lists it, and its name is then plain text. */
export type AgentLink = (instance: string) => (() => void) | null;

const keyOf = (entry: RunEntry, at: number): string =>
  `${entry.owner.kind}:${entry.owner.id}:${entry.of}:${entry.of === "run" ? (entry.run.runId ?? at) : entry.of === "fired" ? (entry.fired.key ?? at) : entry.of === "failure" ? `${entry.failure.key ?? ""}#${entry.failure.attempt ?? at}` : at}:${entry.at ?? ""}`;

function Agent({ name, agentLink }: { name: string; agentLink?: AgentLink }) {
  const open = agentLink?.(name) ?? null;
  // An agent the roster no longer lists: its name, plain, and no word after it.
  if (open === null)
    return (
      <span data-testid="oats-run-agent" data-listed="false" className="min-w-0 break-words text-xs text-muted-foreground">
        {shown(name)}
      </span>
    );
  return (
    <button type="button" data-testid="oats-run-agent" data-listed="true" className={`${LINK} min-w-0 break-words rounded text-left text-xs text-foreground`} onClick={open}>
      {shown(name)}
    </button>
  );
}

function Row({ entry, line, now, withOwner, onOpenOwner, agentLink, open, onToggle }: { entry: RunEntry; line: RunLine; now: number; withOwner: boolean; onOpenOwner?: (owner: RunOwner) => void; agentLink?: AgentLink; open: boolean; onToggle: () => void }) {
  const mark = MARKS[line.mark];
  const when = runWhen(line.at, now);
  const said = line.error !== null && (line.error.code !== null || line.error.message !== null) ? line.error : null;
  return (
    <div role="listitem" data-testid="oats-run" data-of={entry.of} data-mark={line.mark}>
      {/* bb's run row: the mark, the time, then what takes the room (the automation, the agent), and the outcome's word at the row's end. At a phone's width what takes the room goes under. */}
      <div className={RUN_ROW}>
        <span role="img" aria-label={mark.name} className={`inline-flex shrink-0 ${mark.tone}`}>
          <Icon name={mark.icon} className="size-4" />
        </span>
        <time dateTime={line.at ?? undefined} title={when?.title} className="min-w-[16ch] shrink-0 whitespace-nowrap text-sm tabular-nums text-foreground">
          {when?.label ?? "—"}
        </time>
        <span className="order-last flex min-w-0 basis-full flex-col gap-0.5 pl-[1.625rem] @2xl:order-none @2xl:flex-1 @2xl:basis-0 @2xl:pl-0">
          {withOwner ? (
            <button type="button" data-testid="oats-run-owner" className="min-w-0 break-words rounded-sm text-left text-sm text-foreground hover:underline" onClick={() => onOpenOwner?.(entry.owner)}>
              {shown(entry.owner.name)}
            </button>
          ) : null}
          {line.agent === null ? null : <Agent name={line.agent} agentLink={agentLink} />}
        </span>
        <span data-testid="oats-run-said" className={`ml-auto min-w-0 break-words text-right text-xs ${line.mark === "failed" ? "text-destructive-text" : line.mark === "unknown" ? "text-warning-text" : "text-muted-foreground"}`}>
          {[line.what, line.word, ...line.notes].filter(Boolean).map((text) => shown(text as string)).join(" · ")}
        </span>
      </div>
      {said === null ? null : (
        <>
          <div className="px-2 pb-1">
            <button type="button" data-testid="oats-run-toggle" aria-expanded={open} className={`${TARGET} inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground`} onClick={onToggle}>
              <span aria-hidden="true" className={`inline-block transition-transform ${open ? "rotate-90" : ""}`}>
                ▸
              </span>
              Details
            </button>
          </div>
          {open ? (
            // The kernel's own words, as text, in bb's block for a run's error: its code, then its message.
            <div data-testid="oats-run-error" className={RUN_ERROR}>
              {said.code === null ? null : <span>{shown(said.code)}</span>}
              {said.message === null ? null : <span>{shown(said.message)}</span>}
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}

export type RunsProps = {
  entries: readonly RunEntry[];
  now: number;
  /** The Runs tab: each row is led by its automation's name, which opens the automation. */
  withOwner?: boolean;
  onOpenOwner?: (owner: RunOwner) => void;
  agentLink?: AgentLink;
  /** How many rows before "Older", and how many each press adds. */
  step: number;
  /** Whether less is kept than ran, and by how many where the kernel gives the count: said under the table. */
  cut?: { count: number | null } | null;
  /** An automation's own page: the newest run stands open when it failed, as bb's own does. */
  openFirst?: boolean;
};

export function Runs({ entries, now, withOwner = false, onOpenOwner, agentLink, step, cut = null, openFirst = false }: RunsProps) {
  const [shownCount, setShownCount] = useState(step);
  // Which rows a person opened or closed; the first, where it failed and nobody touched it, is open.
  const [toggled, setToggled] = useState<ReadonlyMap<string, boolean>>(new Map());
  const drawn = entries.slice(0, shownCount);
  if (entries.length === 0)
    return (
      <p data-testid="oats-runs-empty" className="py-1 text-sm text-muted-foreground">
        {NO_RUNS}
      </p>
    );
  return (
    <div data-testid="oats-runs" className="@container flex min-w-0 flex-col gap-2">
      <div role="list" aria-label="Runs" className={RUNS_BOX}>
        {drawn.map((entry, at) => {
          const key = keyOf(entry, at);
          const line = runLine(entry);
          const open = toggled.get(key) ?? (openFirst && at === 0 && line.mark === "failed");
          return <Row key={key} entry={entry} line={line} now={now} withOwner={withOwner} onOpenOwner={onOpenOwner} agentLink={agentLink} open={open} onToggle={() => setToggled((before) => new Map(before).set(key, !open))} />;
        })}
        {entries.length > shownCount ? (
          <div className="p-1">
            <button type="button" data-testid="oats-runs-older" className={`${BUTTON_OUTLINE} w-full border-transparent`} onClick={() => setShownCount((count) => count + step)}>
              {OLDER}
            </button>
          </div>
        ) : null}
      </div>
      {/* Said once the table's end is on screen: what is not kept lies after the last row. */}
      {cut !== null && entries.length <= shownCount ? (
        <p data-testid="oats-runs-cut" className="text-xs text-muted-foreground">
          {earlierNotKept(cut.count)}
        </p>
      ) : null}
    </div>
  );
}

/** The Runs tab's two filters: by automation, and by result. */
export type RunsFilter = { owner: string | null; failed: boolean };
const ownerKey = (owner: RunOwner): string => `${owner.kind}:${owner.id}`;

export function RunsTab({ entries, cut, now, onOpenOwner, agentLink }: { entries: readonly RunEntry[]; cut: boolean; now: number; onOpenOwner: (owner: RunOwner) => void; agentLink?: AgentLink }) {
  const [filter, setFilter] = useState<RunsFilter>({ owner: null, failed: false });
  // The automations that have a run, in the order their newest run comes: the ones a person can filter by.
  const owners = [...new Map(entries.map((entry) => [ownerKey(entry.owner), entry.owner])).values()];
  // An automation that left the list is no filter: back to all of them.
  const owner = filter.owner !== null && owners.some((candidate) => ownerKey(candidate) === filter.owner) ? filter.owner : null;
  const kept = entries.filter((entry) => (owner === null || ownerKey(entry.owner) === owner) && (!filter.failed || runFailed(entry)));
  return (
    <div data-testid="oats-automations-runs" className="flex min-w-0 flex-col gap-3">
      {entries.length === 0 ? null : (
        <div className="flex flex-wrap items-center gap-2">
          <select
            aria-label="Automation"
            data-testid="oats-runs-by-automation"
            className={`${TARGET} min-w-0 max-w-full flex-1 rounded-md border border-input bg-transparent px-2 text-sm text-foreground`}
            value={owner ?? ""}
            onChange={(event) => setFilter((before) => ({ ...before, owner: event.target.value === "" ? null : event.target.value }))}
          >
            <option value="">All automations</option>
            {owners.map((candidate) => (
              <option key={ownerKey(candidate)} value={ownerKey(candidate)}>
                {shown(candidate.name)}
              </option>
            ))}
          </select>
          <FilterPills
            label="Result"
            options={[
              { id: "all", label: "All" },
              { id: "failed", label: "Failed" },
            ]}
            value={filter.failed ? "failed" : "all"}
            onChange={(id) => setFilter((before) => ({ ...before, failed: id === "failed" }))}
          />
        </div>
      )}
      {/* A new filter is a new table: it starts at its first rows again. */}
      <Runs key={`${owner ?? ""}:${filter.failed}`} entries={kept} now={now} withOwner onOpenOwner={onOpenOwner} agentLink={agentLink} step={RUNS_SHOWN.tab} cut={cut ? { count: null } : null} />
    </div>
  );
}
