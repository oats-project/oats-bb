// The sidebar's thread list (experimental_threadList): the workspace's name, the roster (every agent
// OATS has, as a tree whose parents open), under it New agent, the plugin's pages under "Workspace",
// then every other bb thread. With no roster ever read, bb's threads are still all listed and usable.
import type { AnchorHTMLAttributes, KeyboardEvent, MouseEvent, ReactNode } from "react";
import {
  ThreadTitle,
  experimental_ThreadActionsContextMenu as ThreadActionsContextMenu,
  experimental_ThreadStatusGlyph as ThreadStatusGlyph,
  experimental_resolveThreadStatus as resolveThreadStatus,
  useBbNavigate,
  useSidebarThreadDraftIds,
  useSidebarThreadRowStatuses,
  useSidebarThreadShortcut,
} from "@get-bb/plugin-sdk/app";
import type {
  PluginSidebarThread,
  PluginThreadActionTarget,
  PluginThreadListProps,
} from "@get-bb/plugin-sdk/app";
import type { Agent, AgentState, Row } from "../../model/types";
import { flatten, isListed, treeRows } from "../../model/view";
import type { TreeRow } from "../../model/view";
import { useOats } from "../oats";
import { outsideOf, rowParts, rowWarns, rowWords } from "../outside";
import type { Said } from "../outside";
import { Button, Loading, Mark, plainClick, StateMark, TARGET, TMUX } from "../ui";
import { openAgentPage } from "../home/agent-tab";
import { useCli } from "../home/cli";
import { GONE_MARK } from "./gone";
import { agentStatus, rowState } from "./status";
import { hasNewAgent, newAgentHeld, openNewAgent, pageLinks, openSoul, useOpenPage, usePagesShown, WORKSPACE } from "../workspace/pages";
import type { PageLink } from "../workspace/pages";
import { RowFacts } from "../ui/row-facts";
import { shown } from "../ui/text";
import { agentName, STATE } from "../ui/words";
import { useOpenAgent } from "./open-agent";
import { ReadingFacts, ReadingMark, readingNow, useActed } from "./reading";
import { LastObservation, Unreadable, usePageShowsNotice } from "./unreadable";
import { useNow } from "./now";
import { FoldToggle, foldKeys, GUTTERED, useOpened } from "./fold";

/**
 * A thread row's anchor, as bb's own rows are: it carries the two attributes bb's own keys go by
 * (previous / next thread walk these rows in the order drawn; "Open thread 1..9" jumps to them), and
 * WHILE bb's modifier is held it shows the jump key bb gave this row, as bb's rows do, and says it
 * in `aria-keyshortcuts`. (bb numbers the rows that carry `data-sidebar-thread-shortcut-target`,
 * in the order drawn: a row with no thread carries none and has no key.) The key is bb's own word.
 */
function ThreadAnchor({ threadId, children, ...rest }: AnchorHTMLAttributes<HTMLAnchorElement> & { threadId: string; "data-testid": string }) {
  const shortcut = useSidebarThreadShortcut(threadId);
  return (
    <a {...rest} data-sidebar-thread-shortcut-target="" data-sidebar-thread-id={threadId} aria-keyshortcuts={shortcut?.ariaKeyshortcuts}>
      {children}
      {shortcut === null ? null : (
        <kbd data-testid="oats-jump-key" aria-hidden="true" className="pointer-events-none absolute right-1 top-1 rounded border border-border bg-background px-1 font-sans text-xs text-foreground">
          {shortcut.label}
        </kbd>
      )}
    </a>
  );
}

function target(thread: PluginSidebarThread): PluginThreadActionTarget {
  return {
    id: thread.id,
    projectId: thread.projectId,
    parentThreadId: thread.parentThreadId,
    parentNotifications: thread.parentNotifications,
    archivedAt: thread.archivedAt,
    pinnedAt: thread.pinnedAt,
    sectionId: thread.sectionId,
    isUnread: thread.isUnread,
    status: thread.status,
    environment:
      thread.environment !== null && thread.environment.id !== null
        ? { id: thread.environment.id, path: thread.environment.path }
        : null,
  };
}

const INDENT = ["pl-2", "pl-6", "pl-10"] as const;
// A row is a control: as high as one (TARGET).
const ROW = `flex ${TARGET} min-w-0 items-center gap-2 rounded-md py-1.5 pr-2 text-sm text-foreground hover:bg-accent`;
const HEADING = "px-2 pt-3 pb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground";

const NO_ONE: ReadonlySet<string> = new Set();

const noMark = () => null;

/** One row of the "oats" block: a page of the plugin, and the mark its feature gives it, if any. */
function PageRow({ page, open, onOpen }: { page: PageLink; open: boolean; onOpen: () => void }) {
  // The same hook at every render of this row: a row is keyed by its page.
  const mark = (page.useMark ?? noMark)();
  return (
    <li>
      {/* The page that is shown is the selected row, as bb marks the open thread's (D-037). */}
      <button type="button" data-testid={`oats-page-link-${page.path}`} aria-current={open ? "page" : undefined} className={`${ROW} w-full pl-2 text-left ${open ? "bg-accent" : ""}`} onClick={onOpen}>
        {page.title}
        {mark === null ? null : <Mark label={mark.label} />}
      </button>
    </li>
  );
}

export function Sidebar({ activeThreadId, onNavigate }: PluginThreadListProps) {
  const oats = useOats();
  const now = useNow();
  const outside = outsideOf(oats);
  const navigate = useBbNavigate();
  const gone: ReadonlySet<string> = oats.phase === "ready" ? oats.gone : NO_ONE;
  const openPath = useOpenPage();
  const openAgent = useOpenAgent();
  const pageShowsNotice = usePageShowsNotice();
  // The pages this release shows (the plugin's setting `pages`): a page that is not shown has no
  // link here, and no mark.
  const pagesNow = usePagesShown();
  const links = pageLinks().filter((page) => pagesNow.has(page.path));
  // The list is the ONE row "Workspace": no visible heading over it.
  const alone = links.length === 1 && links[0]!.path === WORKSPACE.path;
  const newAgentShown = hasNewAgent(pagesNow.has("souls"));
  // Where the installed `oats` stands, read once the sidebar is seen: "New agent" here is held by the rule that holds the home's.
  const { cli } = useCli(newAgentShown, oats.phase === "ready");
  const drafts = useSidebarThreadDraftIds();
  const rowStatuses = useSidebarThreadRowStatuses();
  const opened = useOpened();
  // Behind a result (an act took the agent, and the roster shown is from before the act's end: app/roster/reading.tsx)
  // a row says "Reading…" in its facts' place, as the thread's line and the page do. Asked of the roster the rows are
  // drawn from, never by a read of its own.
  useActed();
  const reads = (instance: string): boolean => oats.phase === "ready" && readingNow(oats, instance);

  const openThread = (event: MouseEvent, threadId: string) => {
    if (!plainClick(event)) return;
    event.preventDefault();
    navigate.toThread(threadId);
    onNavigate();
  };
  const openPage = (path: string) => {
    navigate.toPluginPanel(path);
    onNavigate();
  };

  /**
   * Every thread row: bb's anchor contract, inside bb's own thread menu. `before`: a control of the
   * row's own that is not part of the link (a parent's chevron), drawn over the row's gutter and
   * before the link in the tab order; `onKeyDown`: the row's own keys (a parent's Right and Left).
   * `onPage`: the agent's own page is what is on screen (no thread is): the row is marked as the
   * open thread's row is.
   */
  const threadRow = (thread: PluginSidebarThread, className: string, testId: string, children: ReactNode, before: ReactNode = null, onKeyDown?: (event: KeyboardEvent) => void, onPage = false) => (
    <li key={thread.id} className="relative">
      {before}
      <ThreadActionsContextMenu thread={target(thread)}>
        <ThreadAnchor
          threadId={thread.id}
          href={thread.href}
          data-testid={testId}
          aria-current={thread.id === activeThreadId || onPage ? "page" : undefined}
          className={`${ROW} ${className} ${thread.id === activeThreadId || onPage ? "bg-accent" : ""}`}
          onClick={(event) => openThread(event, thread.id)}
          onKeyDown={onKeyDown}
        >
          {children}
        </ThreadAnchor>
      </ThreadActionsContextMenu>
    </li>
  );

  /**
   * A row's two blocks, at most three lines in all (the lead's ruling on the long names):
   * - the NAME wraps to at most two lines and is cut with "…" only after the second; the whole
   *   name (`full`: the instance as the kernel names it) is the name's title on every row;
   * - the second block is ONE line, never wrapped (ui `RowFacts`): STATE · SOUL · REASON · where,
   *   "·" between. The reason is what happened to the agent outside OATS (app/outside `rowParts`:
   *   "archived in bb", "session lost"); `where` is bb's terminal glyph, named "tmux", for an
   *   agent on tmux. When the line does not fit, the reason shortens with "…", then leaves the
   *   row, and only then the soul shortens; a reason that WARNS stays, and the soul gives way
   *   first. The state's word and the glyph never shrink. The whole line is its title.
   *   (The machine is not on a row: the instance panel says it.)
   */
  const lines = (name: ReactNode, strong: boolean, phrases: { state: string; soul: string; reason?: string | null; where?: string; /** "warning": the reason asks a person to look: it stays, and the soul gives way first */ reasonTone?: "warning" | undefined; /** what the line's title says for the state and the reason, where the row draws another word (app/outside `rowWords`) */ said?: { state: string; reason: string | null } }, full: string, /** the agent is behind a result: "Reading…" in the facts' place */ reading = false) => {
    return (
      <span className="flex min-w-0 flex-1 flex-col">
        <span data-testid="oats-row-name" title={full} className={`line-clamp-2 break-words ${strong ? "font-semibold" : ""}`}>{name}</span>
        {reading ? <ReadingFacts /> : <RowFacts testId="oats-row-facts" state={phrases.state} soul={phrases.soul} reason={phrases.reason} reasonTone={phrases.reasonTone} where={phrases.where} said={phrases.said} />}
      </span>
    );
  };

  /**
   * The rows of the roster's ONE tree (model/view.ts `rows`, drawn through `treeRows`): a parent's
   * children are drawn only while it is open, and it is closed when the page loads. A row on a bb
   * thread is that thread's row; one with no thread (on tmux, or its thread is not listed) is a
   * row of its own that opens the agent's page; either is drawn under its parent, whatever the
   * parent's backend, and either can be a parent. A parent has ONE chevron before its mark, a button
   * of its own (not part of the row's link) that says whose agents it shows or hides; Right on the
   * row opens it and Left closes it, as a tree's keys do. A closed parent's children are not in the
   * page at all: nothing of them takes the focus.
   */
  /** The reason a row says after its state's word (the outside feature's: "may still run", "deleted in bb"); null: none. */
  const reasonOf = (row: Row): string | null => (gone.has(row.agent.instance) ? null : rowParts(outside.of(row.agent), agentStatus(row.agent, row.thread, now).state).note) || null;
  /**
   * What a closed parent's toggle SAYS of the rows it hides, in its name and title: the folded parent hides those rows'
   * WORDS, so the name carries them as a COUNT, in the form of "1 needs you" (the lead's ruling of 25 Nov 2026): how
   * many hidden rows there are of the kind the chevron speaks for (`kin`: the model's `insideOf`):
   * - they ask: "1 needs you", "2 need you";
   * - they failed or cannot be reached: "1 failed", "2 unreachable", and both where both are hidden: "1 failed, 1 unreachable";
   * - they run outside OATS: "1 running outside OATS";
   * - they warn: the count, then the reason's own words: "1 may still run" (those that say the same reason as the row
   *   the chevron speaks for).
   * The states' words are the marks' own names (app/ui/words.ts): nothing is worded here.
   */
  const hiddenSays = (state: AgentState, winner: Row, kin: readonly Row[]): string => {
    const count = (n: number, words: string) => `${n} ${words}`;
    if (state === "needs-you") return count(kin.length, kin.length > 1 ? "need you" : "needs you");
    if (state === "error" || state === "unreachable") {
      const failed = kin.filter((row) => row.state === "error").length;
      const lost = kin.filter((row) => row.state === "unreachable").length;
      return [failed > 0 ? count(failed, STATE.error.name) : null, lost > 0 ? count(lost, STATE.unreachable.name) : null].filter((part): part is string => part !== null).join(", ");
    }
    if (state === "outside") return count(kin.filter((row) => row.state === "outside").length, STATE.outside.name);
    const reason = reasonOf(winner);
    return count(kin.filter((row) => row.state !== "outside" && reasonOf(row) === reason).length, reason ?? STATE[state].name);
  };
  const agentRows = (rows: readonly TreeRow<Row>[], guttered: boolean): ReactNode[] =>
    rows.flatMap(({ node, parent, open, pinned, inside, insideTone, insideNode, insideKin }) => {
      const called = agentName(node.agent.instance);
      const toggle = parent ? <FoldToggle instance={node.agent.instance} name={called} open={open} pinned={pinned} depth={node.depth} inside={inside} insideTone={insideTone} insideSays={inside !== null && insideNode !== null ? hiddenSays(inside, insideNode, insideKin) : null} /> : null;
      const keys = parent ? foldKeys(node.agent.instance, open, pinned) : undefined;
      if (node.thread === null) return [threadlessRow(node.agent, node.where === "tmux" ? TMUX : undefined, outside.of(node.agent), guttered, node.depth, toggle, keys)];
      const thread = oats.threadById.get(node.thread.id);
      if (thread === undefined) return [];
      const status = agentStatus(node.agent, node.thread, now);
      const drawn = rowState(status, gone.has(node.agent.instance));
      // What happened to it outside OATS (app/outside): the reason follows the state's word on the
      // row (a row is never three lines), and a stopped agent that needs a remedy has its mark in the warning tone.
      const said = gone.has(node.agent.instance) ? null : outside.of(node.agent);
      // The reason only after the state it follows (bb's own question on the thread makes the row "Needs you": no reason then).
      const reason = rowParts(said, status.state);
      // (A lost session reads "Lost" in the state's place on a row, with no reason after it: app/outside `rowWords`.)
      const words = rowWords(drawn.word, drawn.state, reason.note);
      return [
        threadRow(
          thread,
          (guttered ? GUTTERED : INDENT)[node.depth],
          "oats-agent-row",
          <>
            {reads(node.agent.instance) ? <ReadingMark /> : <StateMark state={drawn.state} hidden tone={reason.tone} />}
            {/* The name is bold while it waits on a person, and while bb has it unread, as bb's own rows are. */}
            {lines(agentName(node.agent.instance), (status.state === "needs-you" && !reads(node.agent.instance)) || thread.isUnread, { state: words.state, soul: shown(oats.soulOf(node.agent)), reason: words.reason, reasonTone: reason.tone, said: words.title }, shown(node.agent.instance), reads(node.agent.instance))}
          </>,
          toggle,
          keys,
          onScreen(node.agent),
        ),
      ];
    });

  /**
   * An agent OATS has that the tree draws on no bb thread: it runs in tmux, or bb has its thread
   * archived, deleted or hidden. It stays in the roster, with what it is in words, and opens its own
   * page (its soul's, where no feature gives agents a page), where its acts are; one whose
   * conversation bb keeps archived opens that thread, to read it. `where` is the word for an agent
   * on tmux; `said` is what the outside feature says of it (app/outside): where its thread is, and
   * what happened to it.
   */
  const threadlessRow = (
    agent: Agent,
    where: string | undefined,
    said: Said | null,
    guttered: boolean,
    depth: 0 | 1 | 2,
    /** A parent's chevron (which carries the mark of what it hides while it is closed) and keys: as on a thread's row. */
    before: ReactNode = null,
    onKeyDown?: (event: KeyboardEvent) => void,
  ) => {
    const status = agentStatus(agent, null, now);
    const drawn = rowState(status, gone.has(agent.instance));
    const name = agentName(agent.instance);
    // The reason only after the state it follows, as on a thread's row.
    const reason = rowParts(said, status.state);
    const words = rowWords(drawn.word, drawn.state, reason.note);
    return (
      <li key={agent.instance} className="relative">
        {before}
        <button
          type="button"
          data-testid="oats-agent-row-threadless"
          data-instance={agent.instance}
          data-opens={said?.archived === true && agent.threadId !== null ? "thread" : "page"}
          title={shown(agent.instance)}
          // The row of what is on screen is marked, as bb marks the open thread's: this agent's own page, or its archived thread.
          aria-current={onScreen(agent) ? "page" : undefined}
          className={`${ROW} w-full ${(guttered ? GUTTERED : INDENT)[depth]} text-left ${onScreen(agent) ? "bg-accent" : ""}`}
          onKeyDown={onKeyDown}
          onClick={() => {
            // Its archived conversation, where bb keeps one: the thread's own row there says what happened, with the acts.
            if (said?.archived === true && agent.threadId !== null) navigate.toThread(agent.threadId);
            // With no page for one agent (no feature names one): its soul's page, where that page is shown.
            else if (!openAgentPage(navigate, agent.instance) && pagesNow.has("souls")) openSoul(navigate, oats.soulOf(agent));
            onNavigate();
          }}
        >
          {reads(agent.instance) ? <ReadingMark /> : <StateMark state={drawn.state} hidden tone={gone.has(agent.instance) ? undefined : reason.tone} />}
          {lines(name, status.state === "needs-you" && !reads(agent.instance), { state: words.state, soul: shown(oats.soulOf(agent)), reason: words.reason, reasonTone: gone.has(agent.instance) ? undefined : reason.tone, where, said: words.title }, shown(agent.instance), reads(agent.instance))}
        </button>
      </li>
    );
  };

  const plainRow = (thread: PluginSidebarThread) => {
    const status = resolveThreadStatus({
      thread,
      hiddenThreads: [],
      hasUnsubmittedDraft: drafts.has(thread.id),
      rowStatus: rowStatuses.get(thread.id) ?? null,
    });
    return threadRow(
      thread,
      "pl-2",
      "oats-other-row",
      <>
        <span className="flex size-4 shrink-0 items-center justify-center">
          <ThreadStatusGlyph indicator={status.indicator} rowStatus={status.rowStatus} size="compact" />
        </span>
        <span className={`min-w-0 flex-1 truncate ${thread.isUnread ? "font-semibold" : ""}`}>
          <ThreadTitle threadId={thread.id} />
        </span>
      </>,
    );
  };

  if (oats.phase !== "ready") {
    // No roster to draw (none was ever read, or the first read is in flight): bb stays fully
    // usable. What is missing is said in a person's words, and bb's threads are listed as bb has them.
    const listed = oats.threads
      .filter(isListed)
      .sort((a, b) => b.updatedAt - a.updatedAt);
    return (
      <div data-testid="oats-sidebar" className="flex flex-col gap-1 p-1">
        {oats.phase === "loading" ? (
          <div className="px-2">
            <Loading>Reading…</Loading>
          </div>
        ) : pageShowsNotice ? (
          // OATS was never read, and a pane beside this one says so, whole, with the Retry: one line here, the notice's title alone.
          <LastObservation failure={oats} machine={oats.machine} />
        ) : (
          <Unreadable inSidebar failure={oats} machine={oats.machine} onRetry={oats.retry} />
        )}
        <ul className="flex flex-col">{listed.map(plainRow)}</ul>
      </div>
    );
  }

  const { view, deployment } = oats;
  // Every agent that waits, the ones with no bb thread included (`view.needing`: the home's badge and list count the same).
  // Every agent OATS has is a row.
  const shownAgents = flatten(view.roots).length + view.detached.length + view.elsewhere.length;
  // The row that is open on screen, by its agent: it is MARKED (the lead's ruling P1: with or without a thread, at every
  // width), and its parents are open whatever the person left.
  // A thread that is open, by bb's word: the row that is drawn on it; else the row with no thread whose agent NAMES it (its
  // thread is archived in bb: the row itself leads there, and must not be closed away by its parent once a person is on
  // it). The row on the thread first: two agents may name one thread. With no thread open: the agent whose own page is on
  // screen, by that page's word.
  const drawnRows = flatten(view.rows);
  const onThread = activeThreadId === null ? undefined : (drawnRows.find((row) => row.thread?.id === activeThreadId) ?? drawnRows.find((row) => row.thread === null && row.agent.threadId === activeThreadId));
  const selected = activeThreadId === null ? openAgent : (onThread?.agent.instance ?? null);
  // Whether a row is THE one on screen, for its mark: ONE row, never a second row of the same name. With a thread open,
  // the row found for it; with none, the row of the agent whose own page is on screen: the page is asked for by NAME,
  // and of two rows of one name it shows the one on a bb thread, else the first of the name (app/panel/Panel.tsx):
  // the mark is on the row of the agent the page shows.
  const paged = activeThreadId !== null || openAgent === null ? undefined : (oats.nodeByInstance.get(openAgent)?.agent ?? oats.agents.find((candidate) => candidate.instance === openAgent));
  const onPage = paged === undefined ? undefined : (drawnRows.find((row) => row.agent === paged) ?? drawnRows.find((row) => row.agent.instance === openAgent));
  const onScreen = (agent: Agent): boolean => (activeThreadId === null ? onPage?.agent === agent : onThread?.agent === agent);
  const guttered = view.rows.some((row) => row.children.length > 0);
  // A row whose own mark is drawn in the warning tone (the outside feature's `rowWarns`: a process may run with no thread a
  // person can see, or its thread was deleted in bb): a closed parent carries it too. Asked with the row's own state, which is the one its line draws.
  const warns = (row: Row): boolean => !gone.has(row.agent.instance) && !reads(row.agent.instance) && rowWarns(outside.of(row.agent), row.state);
  // A closed parent marks nothing for a hidden row that reads "Reading…": its state in this roster is from before the
  // act, and a mark for it would be the old state's. For the fold alone such a row is a quiet one.
  // Nor for a hidden row that is GONE (the kernel no longer knows it: its row says "Not in OATS any more", with the
  // stopped mark): its state in this roster is the one before it went, and a closed parent would count it among those
  // that need a person, or take a failed one's tone, for an agent that is no more.
  const stale = (instance: string): boolean => reads(instance) || gone.has(instance);
  const quiet = (rows: readonly Row[]): readonly Row[] => rows.map((row) => ({ ...row, state: reads(row.agent.instance) ? ("idle" as const) : gone.has(row.agent.instance) ? GONE_MARK : row.state, children: quiet(row.children) as Row[] }));
  const folded = flatten(view.rows).some((row) => stale(row.agent.instance)) ? quiet(view.rows) : view.rows;
  return (
    // `data-pages`: whether bb has given the settings that say which pages are shown. With nobody
    // waiting the foot has no line, so nothing drawn says it: a live check that asserts an absence
    // (no page link, no needs line) waits on this first.
    <div data-testid="oats-sidebar" data-pages={pagesNow.known ? "known" : "reading"} className="flex flex-col p-1">
      {/* OATS cannot be read now: the roster stays as last read, with why and how old it is. */}
      {/* Where a pane beside it shows the notice (a page's; a thread's own line), one line here: how old the roster is, that the acts are off. The one Retry is the pane's. */}
      {oats.stale === null ? null : pageShowsNotice ? (
        <LastObservation failure={oats.stale} machine={deployment.machine} at={oats.stale.at} now={now} />
      ) : (
        <Unreadable inSidebar failure={oats.stale} machine={deployment.machine} at={oats.stale.at} now={now} onRetry={oats.retry} />
      )}
      <p data-testid="oats-workspace-line" className="truncate px-2 py-1.5 text-xs text-muted-foreground">
        {/* The workspace's name heads the roster; where it runs and how many agents it has are the rows' and the pages'. */}
        <span className="font-semibold text-foreground">{shown(deployment.workspace)}</span>
      </p>
      {shownAgents === 0 ? (
        <p data-testid="oats-no-agents" className="px-2 py-1 text-xs text-muted-foreground">No agents yet.</p>
      ) : (
        <ul data-testid="oats-tree" className="flex flex-col">
          {/* ONE tree and ONE order for every row, whatever its backend (model/view.ts): a row with its children under it;
              an agent with no bb thread is under its parent like any other, and a root where it has none that is drawn.
              - no thread bb lists: where its thread is, by bb's own answer, after the state's word; nothing until bb has answered;
              - on tmux: where it is; one whose session was lost says so first ("Stopped · session lost"): nobody stopped it. */}
          {agentRows(treeRows(folded, opened, selected, warns), guttered)}
        </ul>
      )}
      {/* No line counts who waits on a person: the rows that wait are marked, and bb's badge on the
          plugin's entry says how many (the lead's ruling L6 on the text audit, 23 Nov 2026). */}
      {newAgentShown ? (
        <div className="px-2 py-1">
          {/* "New agent" is held by the ONE rule of every New agent (`newAgentHeld`): on the last roster read,
              with the OATS acts, and behind an `oats` the plugin does not work with, as the home's is. In its
              place, off. Why is said by the notice over the roster (or the page's, beside it) and by the
              home's card, never beside the button. */}
          <Button
            data-testid="oats-new-agent"
            disabled={newAgentHeld(oats.stale !== null, cli)}
            onClick={() => {
              if (openNewAgent(navigate, pagesNow.has("souls"))) onNavigate();
            }}
          >
            New agent
          </Button>
        </div>
      ) : null}

      {links.length === 0 ? null : (
        <>
          {/* Where the list is the ONE row "Workspace" the heading is not drawn (the word would stand twice): it stays
              for a screen reader, and the list keeps the place a heading's block gives it, so the row does not
              stick to New agent. With another page's row under it (Automations) the heading stands. */}
          <h2 data-testid="oats-pages-heading" className={alone ? "sr-only" : HEADING}>Workspace</h2>
          <ul data-testid="oats-pages" className={`flex flex-col ${alone ? "pt-8" : ""}`}>
            {links.map((page) => (
              <PageRow key={page.path} page={page} open={openPath === page.path} onOpen={() => openPage(page.path)} />
            ))}
          </ul>
        </>
      )}

      {view.others.length > 0 ? (
        <>
          <h2 className={HEADING}>Other threads</h2>
          <ul data-testid="oats-others" className="flex flex-col">
            {view.others.flatMap((other) => {
              const thread = oats.threadById.get(other.id);
              return thread === undefined ? [] : [plainRow(thread)];
            })}
          </ul>
        </>
      ) : null}
    </div>
  );
}
