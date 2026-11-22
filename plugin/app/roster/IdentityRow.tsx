// Where this agent is and who it is (experimental_threadHeaderRow): one block under the thread's
// header. First the status line: the state in words, since when, the question or the reason, and
// the act that applies. Then its facts, each with its label. The block wraps: nothing in it is
// cut or scrolls out of sight, at any width.
import { usePanelEvents } from "../panel/read";
import { agentName } from "../ui/words";
import {
  experimental_useAppPanel as useAppPanel,
  experimental_usePluginId as usePluginId,
  useBbNavigate,
  useRpc,
} from "@get-bb/plugin-sdk/app";
import type { ExperimentalThreadHeaderRowProps } from "@get-bb/plugin-sdk/app";
import type { ReactNode } from "react";
import { openAgentPage } from "../home/agent-tab";
import { run } from "../lifecycle/acts";
import { useOats } from "../oats";
import type { Contract } from "../store";
import { Button, Disclosure, LINK, plainClick, StatusLine, TARGET } from "../ui";
import { shown } from "../ui/text";
import { openSoul, usePageShown } from "../workspace/pages";
import { useNow } from "./now";
import { agentStatus, rowState, stoppedSince } from "./status";
import { failureWords, HELD_REASON, Unreadable } from "./unreadable";

/** The fixed thread tab that shows the OATS home, or the agent's view, on desktop. */
export const HOME_TAB = { id: "home", context: { kind: "thread" }, availability: "fixed" } as const;

/** bb's own breakpoint for its compact (phone) layout. */
export const COMPACT_VIEWPORT_QUERY = "(max-width: 767px)";
export function isCompactViewport(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function"
    ? window.matchMedia(COMPACT_VIEWPORT_QUERY).matches
    : false;
}

const FRAME = "flex flex-col gap-1.5 border-b border-border px-3 py-2 text-sm text-foreground";

/** One fact of the row: its label, muted, then its value. */
function RowFact({ label, testId, children }: { label: string; testId: string; children: ReactNode }) {
  return (
    <span data-testid={testId} className="inline-flex min-w-0 items-baseline gap-1">
      <span className="shrink-0 text-muted-foreground">{label}</span>
      <span className="min-w-0 break-words">{children}</span>
    </span>
  );
}

export function IdentityRow({ threadId }: ExperimentalThreadHeaderRowProps) {
  const oats = useOats();
  const navigate = useBbNavigate();
  const panel = useAppPanel();
  const rpc = useRpc<Contract>();
  const pluginId = usePluginId();
  const soulsShown = usePageShown("souls");
  const now = useNow();
  // A stopped agent: since when is in the instance's recorded events (its last "stopped"), which
  // the instance panel reads too. Asked for this thread's agent alone, and only while it is
  // stopped; a hook, so it is called at every render, before any early return.
  const mine = oats.phase === "ready" ? oats.nodeByThread.get(threadId) : undefined;
  const stopped = mine !== undefined && agentStatus(mine.agent, mine.thread, now).state === "stopped";
  const events = usePanelEvents(mine?.agent.instance ?? "", stopped);
  if (oats.phase === "loading") return null; // nothing is known yet; the sidebar says that OATS is being read
  if (oats.phase === "failed") {
    // Whether this thread is an agent's is not known: say that OATS cannot be read, never nothing.
    return (
      <div data-testid="oats-identity-row" data-unreadable="" role="status" className={`${FRAME} flex-row flex-wrap items-center gap-2`}>
        <span className="min-w-0 break-words text-muted-foreground">{failureWords(oats, oats.machine).title}</span>
        <Button onClick={oats.retry}>Retry</Button>
      </div>
    );
  }
  const node = oats.nodeByThread.get(threadId);
  if (node === undefined) return null; // not an OATS agent: take no space

  const { agent } = node;
  const read = agentStatus(agent, node.thread, now);
  const status = read.state === "stopped" ? { ...read, since: stoppedSince(events.data?.events, now) } : read;
  const parent = agent.parent === null ? undefined : oats.nodeByInstance.get(agent.parent);
  const parentThread = parent === undefined ? undefined : oats.threadById.get(parent.thread.id);
  const children = oats.agents.filter((other) => other.parent === agent.instance).length;
  const identity = agent.address ?? agent.alias;
  const soul = oats.soulOf(agent);

  const openPanel = () => {
    // On desktop it is the thread's fixed tab. On a phone bb has no side panel: the agent's own
    // page, where a feature has one, else the home, which is a full page. Where bb declines to
    // open the tab, the home's page is the same view.
    if (isCompactViewport()) {
      if (!openAgentPage(navigate, agent.instance)) navigate.toPluginPanel("home");
    } else if (!panel.openTab({ tab: HOME_TAB })) navigate.toPluginPanel("home");
  };
  // While the roster is the last one read the OATS acts are held (the Desktop's rule): the act
  // stays in its place, off, with the reason; the notice under the line has Retry.
  const held = oats.stale !== null;
  // The act that applies to the state, through OATS: a stopped agent is started, one whose session
  // ended is restarted, one the kernel cannot reach is read again.
  const act =
    status.state === "stopped" ? (
      <Button data-testid="oats-status-act" disabled={held} title={held ? HELD_REASON : undefined} onClick={() => void run("start", agent.instance, rpc, navigate)}>
        Start
      </Button>
    ) : status.state === "error" ? (
      <Button data-testid="oats-status-act" disabled={held} title={held ? HELD_REASON : undefined} onClick={() => void run("restart", agent.instance, rpc, navigate)}>
        Restart
      </Button>
    ) : held ? undefined : status.state === "unreachable" ? (
      <Button data-testid="oats-status-act" onClick={oats.retry}>
        Retry
      </Button>
    ) : undefined;
  // The kernel has since refused this agent as one it does not know: the row says that, with no act,
  // as its row in the sidebar does, until the next roster is read.
  const gone = oats.gone.has(agent.instance);

  // The way to the agent's panel says what it opens, and sits in the one row of buttons, beside
  // the act that applies (B2): the line's height does not change with the state.
  const panelButton = (
    <Button data-testid="oats-open-panel" title="Open this agent's instance panel" onClick={openPanel}>
      Instance panel
    </Button>
  );

  return (
    <div data-testid="oats-identity-row" className={FRAME}>
      {gone ? (
        <StatusLine {...rowState(status, true)} detail="OATS has no agent of this name now" action={panelButton} />
      ) : (
        <StatusLine
          state={status.state}
          since={status.since}
          detail={status.detail}
          action={
            <>
              {act}
              {panelButton}
            </>
          }
        />
      )}
      {/* The kernel's own text for a session it cannot reach: one press away, never the line's words. */}
      {gone || status.kernel === null || shown(status.kernel) === "" ? null : (
        <Disclosure summary="Details" testId="oats-status-kernel">
          <p className="text-xs text-muted-foreground">{`OATS says: ${shown(status.kernel)}`}</p>
        </Disclosure>
      )}
      {/* The row is from the last roster read: the one drawing of that, on one line (its age, that the acts are held, Retry). */}
      {oats.stale === null ? null : <Unreadable compact failure={oats.stale} machine={oats.deployment.machine} at={oats.stale.at} now={now} onRetry={oats.retry} />}
      <div data-testid="oats-identity-facts" className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1 text-xs">
        <RowFact label="instance of" testId="oats-fact-soul">
          {/* A link to the soul's page where that page is shown in this release; else its name alone: no link leads nowhere. */}
          {soulsShown ? (
            <a
              href={`/plugins/${encodeURIComponent(pluginId)}/souls/${soul.split("/").map(encodeURIComponent).join("/")}`}
              className={LINK}
              onClick={(event) => {
                if (!plainClick(event)) return;
                event.preventDefault();
                openSoul(navigate, soul);
              }}
            >
              {shown(soul)}
            </a>
          ) : (
            shown(soul)
          )}
        </RowFact>
        {agent.parent !== null ? (
          <RowFact label="Parent" testId="oats-fact-parent">
            {parentThread === undefined ? (
              agentName(agent.parent)
            ) : (
              <a
                href={parentThread.href}
                className={LINK}
                onClick={(event) => {
                  if (!plainClick(event)) return;
                  event.preventDefault();
                  navigate.toThread(parentThread.id);
                }}
              >
                {agentName(agent.parent)}
              </a>
            )}
          </RowFact>
        ) : agent.human !== null ? (
          <RowFact label="Owning human" testId="oats-fact-parent">
            {shown(agent.human)}
          </RowFact>
        ) : null}
        {children > 0 ? (
          <RowFact label="Children" testId="oats-fact-children">
            {String(children)}
          </RowFact>
        ) : null}
        {identity === null ? null : (
          <RowFact label="Messaging ID" testId="oats-fact-identity">
            {shown(identity)}
          </RowFact>
        )}
      </div>
    </div>
  );
}
