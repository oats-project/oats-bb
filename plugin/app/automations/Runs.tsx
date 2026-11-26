// The Runs table, in the manner of bb's own: one row per run: a mark (with its word: never a glyph
// or a colour alone), when, what came of it in a person's word, and the agent the run made:
// nothing else. The WHOLE row opens that agent's chat while the roster lists it (then it has a
// chevron); an agent that asks has "Answer", a stopped one "Start…" in its menu. A run with the
// kernel's own words on it (a failure's code and message) opens to them, as plain text. A long history is bounded: the first rows, then "Older"; and where
// the automation keeps less than it ran, the table says so under itself.
// It is one table for both places: an automation's own page, and the page's Runs tab (every
// automation's runs, newest first, each led by its automation's name; filtered by automation and
// by result).
import { useState } from "react";
import { experimental_Icon as Icon } from "@get-bb/plugin-sdk/app";
import type { RunEntry, RunOwner } from "../../model/automation-runs";
import { Menu, StateMark, TARGET } from "../ui";
import { BUTTON_OUTLINE, Chevron, FilterPills, ICON_BUTTON, ICONS, RUN_ERROR, RUN_ROW, RUNS_BOX } from "./bb";
import { shown } from "../ui/text";
import { earlierNotKept, NO_RUNS, OLDER, runFailed, runLine, runWhen, RUNS_SHOWN } from "./words";
import type { RunLine, RunMark } from "./words";

/**
 * The marks, by bb's own names for their icons, their accessible names and their tones. A name bb's set does not hold is drawn as bb's
 * generic glyph, silently: the live check holds every icon's DRAWING against that glyph's (bb.tsx IconProbe), on bb-app 0.50.1.
 * `asks` has no icon of its own: it is drawn with the plugin's needs-you mark (`StateMark`), as the tree's row is.
 */
export const MARKS: Record<RunMark | "asks", { icon: string; name: string; tone: string }> = {
  asks: { icon: "AlertCircle", name: "Needs you", tone: "text-warning-text" },
  done: { icon: "CircleCheck", name: "Done", tone: "text-muted-foreground" },
  failed: { icon: "CircleX", name: "Failed", tone: "text-destructive-text" },
  unknown: { icon: "CircleQuestion", name: "Not known", tone: "text-warning-text" },
  running: { icon: "Spinner", name: "Running", tone: "text-muted-foreground" },
  waiting: { icon: "Clock", name: "Waiting", tone: "text-muted-foreground" },
};

/**
 * The agent a run made, as the roster has it NOW: how its chat opens (bb's thread; its own page
 * for an agent with none), whether it asks, and, where it is stopped, how it is started (the
 * lifecycle's own dialog). Null where the roster no longer lists it: its row then opens nothing.
 */
export type RunAgent = { open: () => void; asks: boolean; start: (() => void) | null };
export type AgentLink = (instance: string) => RunAgent | null;

const keyOf = (entry: RunEntry, at: number): string =>
  `${entry.owner.kind}:${entry.owner.id}:${entry.of}:${entry.of === "run" ? (entry.run.runId ?? at) : entry.of === "fired" ? (entry.fired.key ?? at) : entry.of === "failure" ? `${entry.failure.key ?? ""}#${entry.failure.attempt ?? at}` : at}:${entry.at ?? ""}`;

function Row({ entry, line, now, withOwner, onOpenOwner, agentLink, newest, open, onToggle }: { entry: RunEntry; line: RunLine; now: number; withOwner: boolean; onOpenOwner?: (owner: RunOwner) => void; agentLink?: AgentLink; /** this is the newest entry of the table that names its agent */ newest: boolean; open: boolean; onToggle: () => void }) {
  const when = runWhen(line.at, now);
  const said = line.error !== null && (line.error.code !== null || line.error.message !== null) ? line.error : null;
  const known = line.agent === null ? null : (agentLink?.(line.agent) ?? null);
  // What an agent is NOW (it asks; it is stopped) is said once, on the newest run that names it: an agent that many runs name (a wake's:
  // every run wakes the one agent) does not turn each of them into "Needs you". Every run of it still opens its chat, and says what came of that run.
  const agent = known === null ? null : newest ? known : { ...known, asks: false, start: null };
  // An agent that asks is the first thing its newest run says.
  const mark = MARKS[agent?.asks ? "asks" : line.mark];
  const word = agent?.asks ? "Needs you" : [line.what, line.word].filter(Boolean).map((text) => shown(text as string)).join(" · ");
  const tone = agent?.asks || line.mark === "unknown" ? "text-warning-text" : line.mark === "failed" ? "text-destructive-text" : "text-muted-foreground";
  // What is drawn over the row's own button lets a press through to it; a control of its own (the automation's name, Answer, the menu) takes its press.
  const THROUGH = "pointer-events-none relative";
  return (
    <div role="listitem" data-testid="oats-run" data-of={entry.of} data-outcome={agent?.asks ? "asks" : line.mark}>
      {/* The row: the mark, when, (in the Runs tab: its automation), what came of it, the agent. Nothing else. */}
      <div className={`${RUN_ROW} ${TARGET} relative`}>
        {/* The WHOLE row is the way into the chat of the agent the run made: one button under the row's content. A run whose agent is gone, or that made none, has none, and no chevron. */}
        {agent === null ? null : <button type="button" data-testid="oats-run-row" aria-label={`Open ${shown(line.agent ?? "")}`} title={when?.title} className="absolute inset-0 cursor-pointer rounded-sm hover:bg-accent" onClick={agent.open} />}
        <span role="img" aria-label={mark.name} className={`${THROUGH} inline-flex shrink-0 ${mark.tone}`}>
          {agent?.asks ? <StateMark state="needs-you" hidden /> : <Icon name={mark.icon} className="size-4" />}
        </span>
        {/* The whole time is one hover away: on the row's own button where it has one (what lies over the button lets the pointer through), else on the time. */}
        <time dateTime={line.at ?? undefined} title={agent === null ? when?.title : undefined} className={`${agent === null ? "relative" : THROUGH} min-w-[16ch] shrink-0 whitespace-nowrap text-sm tabular-nums text-foreground`}>
          {when?.label ?? "—"}
        </time>
        {withOwner ? (
          <button type="button" data-testid="oats-run-owner" className={`${TARGET} relative order-last inline-flex min-w-0 basis-full items-center break-words rounded-sm pl-[1.625rem] text-left text-sm text-foreground hover:underline @2xl:order-none @2xl:flex-1 @2xl:basis-0 @2xl:pl-0`} onClick={() => onOpenOwner?.(entry.owner)}>
            {shown(entry.owner.name)}
          </button>
        ) : null}
        {/* At a phone's width what came of it takes the line's room, so that the row's controls stay on the run's own line and the agent goes under. */}
        <span data-testid="oats-run-said" className={`${THROUGH} min-w-0 flex-1 text-xs @2xl:flex-none ${agent?.asks ? "whitespace-nowrap" : "break-words"} ${tone}`}>
          {word}
        </span>
        {line.agent === null ? null : (
          <span data-testid="oats-run-agent" data-listed={agent !== null} className={`${THROUGH} order-last min-w-0 basis-full break-words pl-[1.625rem] text-xs text-muted-foreground @2xl:order-none @2xl:basis-auto @2xl:pl-0 @2xl:text-right ${withOwner ? "" : "@2xl:ml-auto"}`}>
            {shown(line.agent)}
          </span>
        )}
        {agent?.asks ? (
          <button type="button" data-testid="oats-run-answer" aria-label={`Answer ${shown(line.agent ?? "")}`} className={`${BUTTON_OUTLINE} relative ${line.agent === null ? "ml-auto" : ""}`} onClick={agent.open}>
            Answer
          </button>
        ) : null}
        {agent !== null && agent.start !== null ? (
          <div data-testid="oats-run-menu" className="relative">
            <Menu label={`Actions for ${shown(line.agent ?? "")}`} items={[{ id: "start", label: "Start…", onSelect: agent.start }]}>
              <span className={ICON_BUTTON}>
                <Icon name={ICONS.menu} className="size-4" />
              </span>
            </Menu>
          </div>
        ) : null}
        {agent === null ? null : (
          <span aria-hidden="true" data-testid="oats-run-chevron" className={`${THROUGH} flex shrink-0 items-center text-muted-foreground`}>
            <Chevron />
          </span>
        )}
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
            // The kernel's own words, as plain text on the page's ground (no filled box): what it was about, its code, then its message.
            <div data-testid="oats-run-error" className={RUN_ERROR}>
              {line.notes.length === 0 ? null : <span>{line.notes.map((note) => shown(note)).join(" · ")}</span>}
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
  /** The whole table these entries are drawn from, where a filter cut it: which run is the newest of its agent is said of the whole. */
  all?: readonly RunEntry[];
};

export function Runs({ entries, now, withOwner = false, onOpenOwner, agentLink, step, cut = null, openFirst = false, all = entries }: RunsProps) {
  const [shownCount, setShownCount] = useState(step);
  // Which rows a person opened or closed; the first, where it failed and nobody touched it, is open.
  const [toggled, setToggled] = useState<ReadonlyMap<string, boolean>>(new Map());
  const drawn = entries.slice(0, shownCount);
  // The newest entry that names each agent (the table is newest first): the one that says what the agent is now.
  const newestOf = new Map<string, RunEntry>();
  for (const entry of all) {
    const name = runLine(entry).agent;
    if (name !== null && !newestOf.has(name)) newestOf.set(name, entry);
  }
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
          return <Row key={key} entry={entry} line={line} now={now} withOwner={withOwner} onOpenOwner={onOpenOwner} agentLink={agentLink} newest={line.agent !== null && newestOf.get(line.agent) === entry} open={open} onToggle={() => setToggled((before) => new Map(before).set(key, !open))} />;
        })}
        {entries.length > shownCount ? (
          <div role="listitem" className="p-1">
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

export function RunsTab({ entries, cut, cuts, now, onOpenOwner, agentLink }: { entries: readonly RunEntry[]; cut: boolean; /** the automations that keep less than they ran, by `kind:id`, each with the kernel's count where it gives one */ cuts: ReadonlyMap<string, number | null>; now: number; onOpenOwner: (owner: RunOwner) => void; agentLink?: AgentLink }) {
  const [filter, setFilter] = useState<RunsFilter>({ owner: null, failed: false });
  // The automations that have a run, in the order their newest run comes: the ones a person can filter by.
  const owners = [...new Map(entries.map((entry) => [ownerKey(entry.owner), entry.owner])).values()];
  // An automation that left the list is no filter: back to all of them.
  const owner = filter.owner !== null && owners.some((candidate) => ownerKey(candidate) === filter.owner) ? filter.owner : null;
  // What is not kept is said of what the table holds: every automation's runs, or the chosen one's alone.
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
      <Runs key={`${owner ?? ""}:${filter.failed}`} entries={kept} all={entries} now={now} withOwner onOpenOwner={onOpenOwner} agentLink={agentLink} step={RUNS_SHOWN.tab} cut={owner === null ? (cut ? { count: null } : null) : cuts.has(owner) ? { count: cuts.get(owner) ?? null } : null} />
    </div>
  );
}
