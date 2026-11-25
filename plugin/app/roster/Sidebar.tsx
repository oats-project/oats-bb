// The sidebar's thread list (experimental_threadList): the workspace's name, the roster (every agent
// OATS has, as a tree whose parents open), under it New agent, the plugin's pages under "Workspace",
// then every other bb thread. With no roster ever read, bb's threads are still all listed and usable.
import { useAnnounceSidebar, useHomeSaysEmpty } from "./beside";
import { useState } from "react";
import type { KeyboardEvent, MouseEvent, ReactNode } from "react";
import {
  ThreadTitle,
  experimental_ThreadActionsContextMenu as ThreadActionsContextMenu,
  experimental_ThreadStatusGlyph as ThreadStatusGlyph,
  experimental_resolveThreadStatus as resolveThreadStatus,
  useBbNavigate,
  useSidebarThreadDraftIds,
  useSidebarThreadRowStatuses,
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
import { agentStatus, rowState } from "./status";
import { hasNewAgent, openNewAgent, pageLinks, openSoul, useOpenPage, usePagesShown } from "../workspace/pages";
import type { PageLink } from "../workspace/pages";
import { RowFacts } from "../ui/row-facts";
import { shown } from "../ui/text";
import { agentName } from "../ui/words";
import { useOpenAgent } from "./open-agent";
import { LastObservation, Unreadable, usePageShowsNotice } from "./unreadable";
import { useNow } from "./now";
import { FoldToggle, foldKeys, GUTTERED, useOpened } from "./fold";

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

export function Sidebar({ activeThreadId, onNavigate, isCompactViewport }: PluginThreadListProps) {
  // The home beside this sidebar draws no "New agent" of its own, and this sidebar no "No agents yet." while the home says it (app/roster/beside.ts: P13).
  // (Beside: bb says not compact AND this sidebar's own root is drawn in the window: bb's collapsed desktop sidebar stays mounted.)
  const [root, setRoot] = useState<HTMLElement | null>(null);
  const beside = useAnnounceSidebar(root, isCompactViewport);
  // Its own "No agents yet." yields only where it is beside a home that says it: in a drawer (over the home), or collapsed, it keeps its line.
  const homeSaysEmpty = useHomeSaysEmpty() && beside;
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
  const newAgentShown = hasNewAgent(pagesNow.has("souls"));
  const drafts = useSidebarThreadDraftIds();
  const rowStatuses = useSidebarThreadRowStatuses();
  const opened = useOpened();

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
   */
  const threadRow = (thread: PluginSidebarThread, className: string, testId: string, children: ReactNode, before: ReactNode = null, onKeyDown?: (event: KeyboardEvent) => void) => (
    <li key={thread.id} className="relative">
      {before}
      <ThreadActionsContextMenu thread={target(thread)}>
        <a
          href={thread.href}
          data-testid={testId}
          data-sidebar-thread-shortcut-target=""
          data-sidebar-thread-id={thread.id}
          aria-current={thread.id === activeThreadId ? "page" : undefined}
          className={`${ROW} ${className} ${thread.id === activeThreadId ? "bg-accent" : ""}`}
          onClick={(event) => openThread(event, thread.id)}
          onKeyDown={onKeyDown}
        >
          {children}
        </a>
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
  const lines = (name: ReactNode, strong: boolean, phrases: { state: string; soul: string; reason?: string | null; where?: string; /** "warning": the reason asks a person to look: it stays, and the soul gives way first */ reasonTone?: "warning" | undefined; /** what the line's title says for the state and the reason, where the row draws another word (app/outside `rowWords`) */ said?: { state: string; reason: string | null } }, full: string) => {
    return (
      <span className="flex min-w-0 flex-1 flex-col">
        <span data-testid="oats-row-name" title={full} className={`line-clamp-2 break-words ${strong ? "font-semibold" : ""}`}>{name}</span>
        <RowFacts testId="oats-row-facts" state={phrases.state} soul={phrases.soul} reason={phrases.reason} reasonTone={phrases.reasonTone} where={phrases.where} said={phrases.said} />
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
  /** What a row says of its agent after its name, as the row draws it: its state's word, then its reason ("Stopped · may still run"). The chevron of a closed parent is named with it over a row that warns. */
  const saysOf = (row: Row): string => {
    const isGone = gone.has(row.agent.instance);
    const status = agentStatus(row.agent, row.thread, now);
    const drawn = rowState(status, isGone);
    const words = rowWords(drawn.word, drawn.state, rowParts(isGone ? null : outside.of(row.agent), status.state).note);
    return [words.state, words.reason].filter((part): part is string => part !== null && part !== "").join(" · ");
  };
  const agentRows = (rows: readonly TreeRow<Row>[], guttered: boolean): ReactNode[] =>
    rows.flatMap(({ node, parent, open, pinned, inside, insideTone, insideNode }) => {
      const called = agentName(node.agent.instance);
      const toggle = parent ? <FoldToggle instance={node.agent.instance} name={called} open={open} pinned={pinned} depth={node.depth} inside={inside} insideTone={insideTone} insideSays={insideTone === "warning" && insideNode !== null ? saysOf(insideNode) : null} /> : null;
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
            <StateMark state={drawn.state} hidden tone={reason.tone} />
            {/* The name is bold while it waits on a person, and while bb has it unread, as bb's own rows are. */}
            {lines(agentName(node.agent.instance), status.state === "needs-you" || thread.isUnread, { state: words.state, soul: shown(oats.soulOf(node.agent)), reason: words.reason, reasonTone: reason.tone, said: words.title }, shown(node.agent.instance))}
          </>,
          toggle,
          keys,
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
          className={`${ROW} w-full ${(guttered ? GUTTERED : INDENT)[depth]} text-left`}
          onKeyDown={onKeyDown}
          onClick={() => {
            // Its archived conversation, where bb keeps one: the thread's own row there says what happened, with the acts.
            if (said?.archived === true && agent.threadId !== null) navigate.toThread(agent.threadId);
            // With no page for one agent (no feature names one): its soul's page, where that page is shown.
            else if (!openAgentPage(navigate, agent.instance) && pagesNow.has("souls")) openSoul(navigate, oats.soulOf(agent));
            onNavigate();
          }}
        >
          <StateMark state={drawn.state} hidden tone={gone.has(agent.instance) ? undefined : reason.tone} />
          {lines(name, status.state === "needs-you", { state: words.state, soul: shown(oats.soulOf(agent)), reason: words.reason, reasonTone: gone.has(agent.instance) ? undefined : reason.tone, where, said: words.title }, shown(agent.instance))}
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
      <div ref={setRoot} data-testid="oats-sidebar" className="flex flex-col gap-1 p-1">
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
  // The row that is open on screen, by its agent: its parents are open whatever the person left.
  // A thread that is open, by bb's word: the row that is drawn on it; else the row with no thread whose agent NAMES it (its
  // thread is archived in bb: the row itself leads there, and must not be closed away by its parent once a person is on
  // it). The row on the thread first: two agents may name one thread. With no thread open: the agent whose own page is on
  // screen, by that page's word.
  const drawnRows = flatten(view.rows);
  const onThread = activeThreadId === null ? undefined : (drawnRows.find((row) => row.thread?.id === activeThreadId) ?? drawnRows.find((row) => row.thread === null && row.agent.threadId === activeThreadId));
  const selected = activeThreadId === null ? openAgent : (onThread?.agent.instance ?? null);
  const guttered = view.rows.some((row) => row.children.length > 0);
  // A row whose own mark is drawn in the warning tone (the outside feature's `rowWarns`: a process may run with no thread a
  // person can see, or its thread was deleted in bb): a closed parent carries it too. Asked with the row's own state, which is the one its line draws.
  const warns = (row: Row): boolean => !gone.has(row.agent.instance) && rowWarns(outside.of(row.agent), row.state);
  return (
    // `data-pages`: whether bb has given the settings that say which pages are shown. With nobody
    // waiting the foot has no line, so nothing drawn says it: a live check that asserts an absence
    // (no page link, no needs line) waits on this first.
    <div ref={setRoot} data-testid="oats-sidebar" data-pages={pagesNow.known ? "known" : "reading"} className="flex flex-col p-1">
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
        // Once on a screen: the home's pane says it while it is in view (P13), this line beside every other pane.
        homeSaysEmpty ? null : <p data-testid="oats-no-agents" className="px-2 py-1 text-xs text-muted-foreground">No agents yet.</p>
      ) : (
        <ul data-testid="oats-tree" className="flex flex-col">
          {/* ONE tree and ONE order for every row, whatever its backend (model/view.ts): a row with its children under it;
              an agent with no bb thread is under its parent like any other, and a root where it has none that is drawn.
              - no thread bb lists: where its thread is, by bb's own answer, after the state's word; nothing until bb has answered;
              - on tmux: where it is; one whose session was lost says so first ("Stopped · session lost"): nobody stopped it. */}
          {agentRows(treeRows(view.rows, opened, selected, warns), guttered)}
        </ul>
      )}
      {/* No line counts who waits on a person: the rows that wait are marked, and bb's badge on the
          plugin's entry says how many (the lead's ruling L6 on the text audit, 23 Nov 2026). */}
      {newAgentShown ? (
        <div className="px-2 py-1">
          {/* On the last roster read "New agent" is held with the OATS acts: in its place, off. Why is
              said by the notice over the roster (or the page's, beside it), never beside the button. */}
          {/* Beside the home of a workspace with no agent (the home says "No agents yet.") it is the screen's one act, as the
              home's own was: the primary button. Beside any other pane it is not (the New agent form has its own primary). */}
          <Button
            variant={shownAgents === 0 && homeSaysEmpty ? "primary" : "default"}
            data-testid="oats-new-agent"
            {...(shownAgents === 0 && homeSaysEmpty ? { "data-primary": "" } : {})}
            disabled={oats.stale !== null}
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
          <h2 className={HEADING}>Workspace</h2>
          <ul data-testid="oats-pages" className="flex flex-col">
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
