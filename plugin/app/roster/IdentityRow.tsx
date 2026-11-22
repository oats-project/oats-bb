// Where this agent is and who it is (experimental_threadHeaderRow): one block under the thread's
// header. First the status line: the state in words, since when, the question or the reason, and
// the act that applies. Then its facts, each with its label. The block wraps: nothing in it is
// cut or scrolls out of sight, at any width.
import {
  experimental_useAppPanel as useAppPanel,
  experimental_usePluginId as usePluginId,
  useBbNavigate,
  useRpc,
} from "@get-bb/plugin-sdk/app";
import type { ExperimentalThreadHeaderRowProps } from "@get-bb/plugin-sdk/app";
import type { ReactNode } from "react";
import { count } from "../format";
import { openAgentPage } from "../home/agent-tab";
import { run } from "../lifecycle/acts";
import { useOats } from "../oats";
import type { Contract } from "../store";
import { Button, LINK, plainClick, StatusLine, TARGET } from "../ui";
import { shown } from "../ui/text";
import { asOf } from "../ui/words";
import { openSoul } from "../workspace/pages";
import { useNow } from "./now";
import { agentStatus, drawnState } from "./status";
import { failureWords } from "./unreadable";

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
  const now = useNow();
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
  const status = agentStatus(agent, node.thread, now);
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
  // The act that applies to the state, through OATS: a stopped agent is started, one whose session
  // ended is restarted, one the kernel cannot reach is read again.
  const act =
    status.state === "stopped" ? (
      <Button data-testid="oats-status-act" onClick={() => void run("start", agent.instance, rpc, navigate)}>
        Start
      </Button>
    ) : status.state === "error" ? (
      <Button data-testid="oats-status-act" onClick={() => void run("restart", agent.instance, rpc, navigate)}>
        Restart
      </Button>
    ) : status.state === "unreachable" ? (
      <Button data-testid="oats-status-act" onClick={oats.retry}>
        Retry
      </Button>
    ) : undefined;
  // The kernel has since refused this agent as one it does not know: the row says that, with no act,
  // as its row in the sidebar does, until the next roster is read.
  const gone = oats.gone.has(agent.instance);
  // What is shown is the last roster read while OATS cannot be read: the line says how old it is.
  const stale = oats.stale === null ? null : asOf(oats.stale.at, now);

  return (
    <div data-testid="oats-identity-row" className={FRAME}>
      {gone ? (
        <StatusLine {...drawnState(status, true)} detail={["OATS has no agent of this name now", stale].filter((part) => part !== null).join(" · ")} />
      ) : (
        <StatusLine state={status.state} since={status.since} detail={[status.detail, stale].filter((part) => part !== null).join(" · ") || null} action={act} />
      )}
      <div data-testid="oats-identity-facts" className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1 text-xs">
        <RowFact label="Soul" testId="oats-fact-soul">
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
        </RowFact>
        {agent.parent !== null ? (
          <RowFact label="Under" testId="oats-fact-parent">
            {parentThread === undefined ? (
              shown(agent.parent)
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
                {shown(agent.parent)}
              </a>
            )}
          </RowFact>
        ) : agent.human !== null ? (
          <RowFact label="Started by" testId="oats-fact-parent">
            {shown(agent.human)}
          </RowFact>
        ) : null}
        {children > 0 ? (
          <span data-testid="oats-fact-children" className="text-muted-foreground">
            {count(children, "child", "children")}
          </span>
        ) : null}
        {identity === null ? null : (
          <RowFact label={agent.team === null ? "Identity" : `Identity in ${shown(agent.team)}`} testId="oats-fact-identity">
            {shown(identity)}
          </RowFact>
        )}
        <button
          type="button"
          data-testid="oats-open-panel"
          title="Open this agent's panel"
          className={`${TARGET} ml-auto inline-flex shrink-0 items-center rounded-md border border-border bg-card px-3 text-xs font-semibold text-foreground hover:bg-accent`}
          onClick={openPanel}
        >
          OATS
        </button>
      </div>
    </div>
  );
}
