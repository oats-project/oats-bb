// The sidebar's thread list (experimental_threadList): the workspace line, the roster (every agent
// OATS has, as a tree), at its foot who waits and New agent, the plugin's pages under "Workspace",
// then every other bb thread. With no roster ever read, bb's threads are still all listed and usable.
import { Fragment } from "react";
import type { MouseEvent, ReactNode } from "react";
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
import type { Agent, Node } from "../../model/types";
import { flatten } from "../../model/view";
import { count, needsYouLabel } from "../format";
import { useOats } from "../oats";
import { Button, Loading, Mark, plainClick, StateMark, TARGET } from "../ui";
import { openAgentPage } from "../home/agent-tab";
import { agentStatus, rowState } from "./status";
import { hasNewAgent, openNewAgent, pageLinks, openSoul, useOpenPage, usePagesShown } from "../workspace/pages";
import type { PageLink } from "../workspace/pages";
import { shown } from "../ui/text";
import { agentName } from "../ui/words";
import { HELD_REASON, LastObservation, Unreadable, usePageShowsNotice } from "./unreadable";
import { useNow } from "./now";

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
  const navigate = useBbNavigate();
  const gone: ReadonlySet<string> = oats.phase === "ready" ? oats.gone : NO_ONE;
  const openPath = useOpenPage();
  const pageShowsNotice = usePageShowsNotice();
  // The pages this release shows (the plugin's setting `pages`): a page that is not shown has no
  // link here, and no mark.
  const pagesNow = usePagesShown();
  const links = pageLinks().filter((page) => pagesNow.has(page.path));
  const homeShown = pagesNow.has("home");
  const newAgentShown = hasNewAgent(pagesNow.has("souls"));
  const drafts = useSidebarThreadDraftIds();
  const rowStatuses = useSidebarThreadRowStatuses();

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

  /** Every thread row: bb's anchor contract, inside bb's own thread menu. */
  const threadRow = (thread: PluginSidebarThread, className: string, testId: string, children: ReactNode) => (
    <li key={thread.id}>
      <ThreadActionsContextMenu thread={target(thread)}>
        <a
          href={thread.href}
          data-testid={testId}
          data-sidebar-thread-shortcut-target=""
          data-sidebar-thread-id={thread.id}
          aria-current={thread.id === activeThreadId ? "page" : undefined}
          className={`${ROW} ${className} ${thread.id === activeThreadId ? "bg-accent" : ""}`}
          onClick={(event) => openThread(event, thread.id)}
        >
          {children}
        </a>
      </ThreadActionsContextMenu>
    </li>
  );

  /** A row's two lines (D-063): the name, then where the agent is in a word, and its soul. */
  /**
   * A row's two blocks, at most three lines in all (the lead's ruling on the long names):
   * - the NAME wraps to at most two lines and is cut with "…" only after the second (the whole name
   *   is the row's title);
   * - the second block (the state, the soul, where it runs) is ONE line, never wrapped: where it does
   *   not fit, the SOUL is cut with "…", never the state's word and never where it runs. The whole
   *   line is its title.
   */
  const lines = (name: ReactNode, strong: boolean, word: string, rest: string) => (
    <span className="flex min-w-0 flex-1 flex-col">
      <span data-testid="oats-row-name" className={`line-clamp-2 break-words ${strong ? "font-semibold" : ""}`}>{name}</span>
      <span data-testid="oats-row-facts" title={`${word} · ${rest}`} className="flex min-w-0 whitespace-nowrap text-xs text-muted-foreground">
        {`${word} · ${rest}`.split(" · ").map((phrase, index) => (
          <Fragment key={index}>
            {index === 0 ? null : (
              <span data-sep="" className="shrink-0 whitespace-pre">
                {" · "}
              </span>
            )}
            {/* The second phrase is the soul: the one that gives way. */}
            <span data-phrase={index === 1 ? "soul" : ""} className={index === 1 ? "min-w-0 truncate" : "shrink-0"}>
              {phrase}
            </span>
          </Fragment>
        ))}
      </span>
    </span>
  );

  const agentRows = (nodes: readonly Node[]): ReactNode[] =>
    nodes.flatMap((node) => {
      const thread = oats.threadById.get(node.thread.id);
      if (thread === undefined) return [];
      const status = agentStatus(node.agent, node.thread, now);
      const drawn = rowState(status, gone.has(node.agent.instance));
      return [
        threadRow(
          thread,
          INDENT[node.depth],
          "oats-agent-row",
          <>
            <StateMark state={drawn.state} hidden />
            {/* The name is bold while it waits on a person, and while bb has it unread, as bb's own rows are. */}
            {lines(agentName(node.agent.instance), status.state === "needs-you" || thread.isUnread, drawn.word, shown(oats.soulOf(node.agent)))}
          </>,
        ),
        ...agentRows(node.children),
      ];
    });

  /**
   * An agent OATS has that bb has no thread for: it runs in tmux, or its bb thread is gone. It stays
   * in the roster, with what it is in words, and opens its own page (its soul's, where no feature
   * gives agents a page), where its acts are.
   */
  const threadlessRow = (agent: Agent, where: string) => {
    const status = agentStatus(agent, null, now);
    const drawn = rowState(status, gone.has(agent.instance));
    const name = agentName(agent.instance);
    return (
      <li key={agent.instance}>
        <button
          type="button"
          data-testid="oats-agent-row-threadless"
          data-instance={agent.instance}
          title={shown(agent.instance)}
          className={`${ROW} w-full pl-2 text-left`}
          onClick={() => {
            // With no page for one agent (no feature names one): its soul's page, where that page is shown.
            if (!openAgentPage(navigate, agent.instance) && pagesNow.has("souls")) openSoul(navigate, oats.soulOf(agent));
            onNavigate();
          }}
        >
          <StateMark state={drawn.state} hidden />
          {lines(name, status.state === "needs-you", drawn.word, `${shown(oats.soulOf(agent))} · ${where}`)}
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
      .filter((thread) => !thread.isArchived && !thread.isHidden)
      .sort((a, b) => b.updatedAt - a.updatedAt);
    return (
      <div data-testid="oats-sidebar" className="flex flex-col gap-1 p-1">
        {oats.phase === "loading" ? (
          <div className="px-2">
            <Loading>Reading your agents…</Loading>
          </div>
        ) : (
          <Unreadable failure={oats} machine={oats.machine} onRetry={oats.retry} />
        )}
        <h2 className={HEADING}>Threads</h2>
        <ul className="flex flex-col">{listed.map(plainRow)}</ul>
      </div>
    );
  }

  const { view, deployment } = oats;
  // Every agent that waits, the ones with no bb thread included (`view.needing`: the home follows in its owner's change).
  const needs = view.needing.length;
  // Every agent OATS has is a row: the count in the workspace line is the count of rows.
  const shownAgents = flatten(view.roots).length + view.detached.length + view.elsewhere.length;
  return (
    <div data-testid="oats-sidebar" className="flex flex-col p-1">
      {/* OATS cannot be read now: the roster stays as last read, with why and how old it is. */}
      {/* Where a page beside it shows the full notice, one line here: how old the roster is, and Retry. */}
      {oats.stale === null ? null : pageShowsNotice ? (
        <LastObservation failure={oats.stale} machine={deployment.machine} at={oats.stale.at} now={now} onRetry={oats.retry} />
      ) : (
        <Unreadable inSidebar failure={oats.stale} machine={deployment.machine} at={oats.stale.at} now={now} onRetry={oats.retry} />
      )}
      <p data-testid="oats-workspace-line" className="truncate px-2 py-1.5 text-xs text-muted-foreground">
        <span className="font-semibold text-foreground">{shown(deployment.workspace)}</span>
        {` · ${shown(deployment.machine)} · ${count(shownAgents, "agent")}`}
      </p>
      <h2 className={HEADING}>Agents</h2>
      {shownAgents === 0 ? (
        <p data-testid="oats-no-agents" className="px-2 py-1 text-xs text-muted-foreground">No agents yet.</p>
      ) : (
        <ul data-testid="oats-tree" className="flex flex-col">
          {agentRows(view.roots)}
          {view.detached.map((agent) => threadlessRow(agent, "its bb thread is gone"))}
          {view.elsewhere.map((agent) => threadlessRow(agent, "tmux"))}
        </ul>
      )}
      {/* The roster's foot (D-039): who waits on a person, then the act that makes an agent. */}
      {homeShown ? (
        <button
          type="button"
          data-testid="oats-needs-line"
          title={`${needsYouLabel(needs)}: open the OATS home`}
          className={`${ROW} w-full pl-2 text-left ${needs > 0 ? "font-semibold" : "text-muted-foreground"}`}
          onClick={() => openPage("home")}
        >
          {needs > 0 ? <StateMark state="needs-you" hidden /> : null}
          {needs > 0 ? `${needs} need you` : "Nothing needs you."}
        </button>
      ) : (
        // The home is not shown in this release: the count is said, and opens nothing.
        <p data-testid="oats-needs-line" className={`flex items-center gap-2 px-2 py-1.5 text-sm ${needs > 0 ? "font-semibold text-foreground" : "text-muted-foreground"}`}>
          {needs > 0 ? <StateMark state="needs-you" hidden /> : null}
          {needs > 0 ? `${needs} need you` : "Nothing needs you."}
        </p>
      )}
      {newAgentShown ? (
        <div className="px-2 py-1">
          {/* On the last roster read "New agent" is held with the OATS acts: in its place, off, with the reason. */}
          <Button
            data-testid="oats-new-agent"
            disabled={oats.stale !== null}
            title={oats.stale !== null ? HELD_REASON : undefined}
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
