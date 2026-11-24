// The sidebar's thread list (experimental_threadList): the workspace's name, the roster (every agent
// OATS has, as a tree), at its foot who waits (when someone does) and New agent, the plugin's pages under "Workspace",
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
import { useOats } from "../oats";
import { outsideOf, rowParts } from "../outside";
import type { Said } from "../outside";
import { Button, Loading, Mark, plainClick, StateMark, TARGET, TMUX, TmuxMark } from "../ui";
import { openAgentPage } from "../home/agent-tab";
import { agentStatus, rowState } from "./status";
import { hasNewAgent, openNewAgent, pageLinks, openSoul, useOpenPage, usePagesShown } from "../workspace/pages";
import type { PageLink } from "../workspace/pages";
import { shown } from "../ui/text";
import { agentName } from "../ui/words";
import { LastObservation, Unreadable, usePageShowsNotice } from "./unreadable";
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
  const outside = outsideOf(oats);
  const navigate = useBbNavigate();
  const gone: ReadonlySet<string> = oats.phase === "ready" ? oats.gone : NO_ONE;
  const openPath = useOpenPage();
  const pageShowsNotice = usePageShowsNotice();
  // The pages this release shows (the plugin's setting `pages`): a page that is not shown has no
  // link here, and no mark.
  const pagesNow = usePagesShown();
  const links = pageLinks().filter((page) => pagesNow.has(page.path));
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

  /**
   * A row's two blocks, at most three lines in all (the lead's ruling on the long names):
   * - the NAME wraps to at most two lines and is cut with "…" only after the second; the whole
   *   name (`full`: the instance as the kernel names it) is the name's title on every row;
   * - the second block is ONE line, never wrapped: the state's word, and where there is one a
   *   reason: what happened to the agent outside OATS (`reason`, app/outside `rowParts`:
   *   "archived in bb", "session lost"), and for an agent on tmux where it is (`where`:
   *   bb's terminal glyph, named "tmux"; the word on a bb with no such glyph). The state's word and `where` are never cut; a reason fits the line beside the
   *   state's word (should one ever not fit, it is cut with "…" and whole in the title: never
   *   drawn past the row). The soul is not on the row: the name tells agents apart, and the
   *   instance panel says the soul. Nothing is drawn past the row (the block clips), and the
   *   whole line is its title.
   */
  const lines = (name: ReactNode, strong: boolean, phrases: { state: string; reason?: string | null; where?: string }, full: string) => {
    const all: { kind: "state" | "reason" | "where"; text: string; className: string }[] = [
      { kind: "state", text: phrases.state, className: "shrink-0" },
      ...(phrases.reason == null ? [] : [{ kind: "reason" as const, text: phrases.reason, className: "min-w-0 truncate" }]),
      ...(phrases.where === undefined ? [] : [{ kind: "where" as const, text: phrases.where, className: "shrink-0" }]),
    ];
    // (A reason that is no words, "": the state says it all, "Running outside OATS", alone on the line.)
    const parts = all.filter((part) => part.text !== "");
    return (
      <span className="flex min-w-0 flex-1 flex-col">
        <span data-testid="oats-row-name" title={full} className={`line-clamp-2 break-words ${strong ? "font-semibold" : ""}`}>{name}</span>
        <span data-testid="oats-row-facts" title={parts.map((part) => part.text).join(" · ")} className="flex min-w-0 overflow-hidden whitespace-nowrap text-xs text-muted-foreground">
          {parts.map((part, index) => (
            <Fragment key={part.kind}>
              {index === 0 ? null : (
                <span data-sep="" className="shrink-0 whitespace-pre">
                  {" · "}
                </span>
              )}
              <span data-phrase={part.kind} className={part.className}>
                {part.kind === "where" && part.text === TMUX ? <TmuxMark /> : part.text}
              </span>
            </Fragment>
          ))}
        </span>
      </span>
    );
  };

  const agentRows = (nodes: readonly Node[]): ReactNode[] =>
    nodes.flatMap((node) => {
      const thread = oats.threadById.get(node.thread.id);
      if (thread === undefined) return [];
      const status = agentStatus(node.agent, node.thread, now);
      const drawn = rowState(status, gone.has(node.agent.instance));
      // What happened to it outside OATS (app/outside): the reason follows the state's word on the
      // row (a row is never three lines), and a stopped agent that needs a remedy has its mark in the warning tone.
      const said = gone.has(node.agent.instance) ? null : outside.of(node.agent);
      // The reason only after the state it follows (bb's own question on the thread makes the row "Needs you": no reason then).
      const reason = rowParts(said, status.state);
      return [
        threadRow(
          thread,
          INDENT[node.depth],
          "oats-agent-row",
          <>
            <StateMark state={drawn.state} hidden tone={reason.tone} />
            {/* The name is bold while it waits on a person, and while bb has it unread, as bb's own rows are. */}
            {lines(agentName(node.agent.instance), status.state === "needs-you" || thread.isUnread, { state: drawn.word, reason: reason.note }, shown(node.agent.instance))}
          </>,
        ),
        ...agentRows(node.children),
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
  const threadlessRow = (agent: Agent, where: string | undefined, said: Said | null = null) => {
    const status = agentStatus(agent, null, now);
    const drawn = rowState(status, gone.has(agent.instance));
    const name = agentName(agent.instance);
    // The reason only after the state it follows, as on a thread's row.
    const reason = rowParts(said, status.state);
    return (
      <li key={agent.instance}>
        <button
          type="button"
          data-testid="oats-agent-row-threadless"
          data-instance={agent.instance}
          data-opens={said?.archived === true && agent.threadId !== null ? "thread" : "page"}
          title={shown(agent.instance)}
          className={`${ROW} w-full pl-2 text-left`}
          onClick={() => {
            // Its archived conversation, where bb keeps one: the thread's own row there says what happened, with the acts.
            if (said?.archived === true && agent.threadId !== null) navigate.toThread(agent.threadId);
            // With no page for one agent (no feature names one): its soul's page, where that page is shown.
            else if (!openAgentPage(navigate, agent.instance) && pagesNow.has("souls")) openSoul(navigate, oats.soulOf(agent));
            onNavigate();
          }}
        >
          <StateMark state={drawn.state} hidden tone={gone.has(agent.instance) ? undefined : reason.tone} />
          {lines(name, status.state === "needs-you", { state: drawn.word, reason: reason.note, where }, shown(agent.instance))}
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
            <Loading>Reading…</Loading>
          </div>
        ) : (
          <Unreadable failure={oats} machine={oats.machine} onRetry={oats.retry} />
        )}
        <ul className="flex flex-col">{listed.map(plainRow)}</ul>
      </div>
    );
  }

  const { view, deployment } = oats;
  // Every agent that waits, the ones with no bb thread included (`view.needing`: the home's badge and list count the same).
  // Every agent OATS has is a row.
  const shownAgents = flatten(view.roots).length + view.detached.length + view.elsewhere.length;
  return (
    // `data-pages`: whether bb has given the settings that say which pages are shown. With nobody
    // waiting the foot has no line, so nothing drawn says it: a live check that asserts an absence
    // (no page link, no needs line) waits on this first.
    <div data-testid="oats-sidebar" data-pages={pagesNow.known ? "known" : "reading"} className="flex flex-col p-1">
      {/* OATS cannot be read now: the roster stays as last read, with why and how old it is. */}
      {/* Where a page beside it shows the full notice, one line here: how old the roster is, and Retry. */}
      {oats.stale === null ? null : pageShowsNotice ? (
        <LastObservation failure={oats.stale} machine={deployment.machine} at={oats.stale.at} now={now} onRetry={oats.retry} />
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
          {agentRows(view.roots)}
          {/* Where its thread is, by bb's own answer, after the state's word; nothing until bb has answered. */}
          {view.detached.map((agent) => threadlessRow(agent, undefined, outside.of(agent)))}
          {/* An agent on tmux whose session was lost says so ("Stopped · session lost", then where it is): nobody stopped it. */}
          {view.elsewhere.map((agent) => threadlessRow(agent, TMUX, outside.of(agent)))}
        </ul>
      )}
      {/* No line counts who waits on a person: the rows that wait are marked, and bb's badge on the
          plugin's entry says how many (the lead's ruling L6 on the text audit, 23 Nov 2026). */}
      {newAgentShown ? (
        <div className="px-2 py-1">
          {/* On the last roster read "New agent" is held with the OATS acts: in its place, off. Why is
              said by the notice over the roster (or the page's, beside it), never beside the button. */}
          <Button
            data-testid="oats-new-agent"
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
