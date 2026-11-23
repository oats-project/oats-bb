// Where this agent is and who it is (experimental_threadHeaderRow): one block under the thread's
// header: the status line (the state in words, how long it has waited, the question or the
// reason, the act that applies) and the way to the instance panel, which holds who the agent is
// (its soul, its parent and children, its messaging ID). The block wraps: nothing in it is cut or
// scrolls out of sight, at any width.
import { showPanelTab } from "../panel/Panel";
import {
  experimental_useAppPanel as useAppPanel,
  useBbNavigate,
  useRpc,
} from "@get-bb/plugin-sdk/app";
import type { ExperimentalThreadHeaderRowProps } from "@get-bb/plugin-sdk/app";
import { openAgentPage } from "../home/agent-tab";
import { askPlan, run } from "../lifecycle/acts";
import { claimOf } from "../../model/view";
import { lineActs, lineParts, outsideOf, OutsideThreadRow, OutsideWarning } from "../outside";
import { useOats } from "../oats";
import type { Contract } from "../store";
import { Button } from "../ui";
import { useNow } from "./now";
import { AgentStatusLine } from "./AgentStatusLine";
import { agentStatus } from "./status";
import { failureWords, Unreadable } from "./unreadable";

/** The fixed thread tab that shows the OATS home, or the agent's view, on desktop. */
export const HOME_TAB = { id: "home", context: { kind: "thread" }, availability: "fixed" } as const;

/** bb's own breakpoint for its compact (phone) layout. */
export const COMPACT_VIEWPORT_QUERY = "(max-width: 767px)";
export function isCompactViewport(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function"
    ? window.matchMedia(COMPACT_VIEWPORT_QUERY).matches
    : false;
}

/**
 * Moves the focus to the instance panel's "Needs input" (its reply where it has one, else the
 * section itself), once it is drawn: the panel may be opening. Tried for about a second, then left.
 */
export function focusNeedsInput(tries = 10): void {
  const section = document.querySelector<HTMLElement>('[data-testid="oats-panel-waiting"]');
  if (section !== null) {
    const target = section.querySelector<HTMLElement>("textarea, input, select, button, a[href]") ?? section;
    if (target === section && !section.hasAttribute("tabindex")) section.setAttribute("tabindex", "-1");
    section.scrollIntoView?.({ block: "nearest" });
    target.focus();
    return;
  }
  if (tries > 0) window.setTimeout(() => focusNeedsInput(tries - 1), 100);
}

const FRAME = "flex flex-col gap-1.5 border-b border-border px-3 py-2 text-sm text-foreground";

export function IdentityRow({ threadId }: ExperimentalThreadHeaderRowProps) {
  const oats = useOats();
  const navigate = useBbNavigate();
  const panel = useAppPanel();
  const rpc = useRpc<Contract>();
  const now = useNow();
  const outside = outsideOf(oats);
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
  // Not an agent the roster draws on this thread: nothing, unless it is the archived thread of one (the outside feature's row).
  if (node === undefined) return <OutsideThreadRow threadId={threadId} oats={oats} outside={outside} />;

  const { agent } = node;
  // (The state, for the act that applies; the line itself is AgentStatusLine's.)
  const status = agentStatus(agent, node.thread, now);

  const openPanel = () => {
    // On desktop it is the thread's fixed tab. On a phone bb has no side panel: the agent's own
    // page, where a feature has one, else the home, which is a full page. Where bb declines to
    // open the tab, the home's page is the same view.
    if (isCompactViewport()) {
      if (!openAgentPage(navigate, agent.instance)) navigate.toPluginPanel("home");
    } else if (!panel.openTab({ tab: HOME_TAB })) navigate.toPluginPanel("home");
  };
  // While the roster is the last one read the OATS acts are held (the Desktop's rule): the act
  // stays in its place, off; the notice under the line says that the acts are off, and has Retry.
  const held = oats.stale !== null;
  // The act that applies to the state, through OATS: a stopped agent is started, one whose session
  // ended is restarted, one the kernel cannot reach is read again.
  const verb = status.state === "stopped" ? (["start", "Start…"] as const) : status.state === "error" ? (["restart", "Restart…"] as const) : null; // (the dots: each opens its dialog, and nothing runs on the press)
  const act =
    verb !== null ? (
      <Button data-testid="oats-status-act" disabled={held} onClick={() => void run(verb[0], agent.instance, rpc, navigate)}>
        {verb[1]}
      </Button>
    ) : status.state === "needs-you" && claimOf(agent) !== null ? (
      // The agent asked through OATS: what it asks is on the line; "Answer" is the way to reply. It
      // opens the instance panel at "Needs input", and with the panel already open it moves the focus
      // there (never a dead press). A question bb itself shows is answered in the thread: no act.
      <Button
        data-testid="oats-status-act"
        title="Answer in the instance panel"
        onClick={() => {
          // "Needs input" is on the panel's Instance tab, and the panel keeps the tab a person left it
          // on: turn it there first, whether the panel is open or opens now.
          showPanelTab("instance");
          openPanel();
          focusNeedsInput();
        }}
      >
        Answer
      </Button>
    ) : status.state === "working" || status.state === "idle" ? (
      // An agent that runs is stopped from its own thread, through OATS: the plan first (what stops
      // with it), then the confirmation. bb's own stop of a turn is not this.
      <Button data-testid="oats-status-act" disabled={held} title={held ? undefined : "Stop this agent through OATS"} onClick={() => askPlan("stop", agent.instance)}>
        Stop
      </Button>
    ) : held ? undefined : status.state === "unreachable" ? (
      <Button data-testid="oats-status-act" onClick={oats.retry}>
        Retry
      </Button>
    ) : undefined;
  // The kernel has since refused this agent as one it does not know: the row says that, with no act,
  // as its row in the sidebar does, until the next roster is read.
  const gone = oats.gone.has(agent.instance);
  // What happened to it outside OATS, if anything (app/outside): its sentence and its acts take the line's, and the kernel's report stands under it.
  const said = gone ? null : outside.of(agent);
  const saidActs = lineActs(said, agent.instance, held, status.state);

  // The way to the agent's panel says what it opens, and sits in the one row of buttons, beside
  // the act that applies (B2): the line's height does not change with the state.
  const panelButton = (
    <Button data-testid="oats-open-panel" title="Open this agent's instance panel" onClick={openPanel}>
      Instance panel
    </Button>
  );

  return (
    <div data-testid="oats-identity-row" className={FRAME}>
      {/* The one status line of an agent (the panel's header is to draw the same). The age of a roster kept as
          last read is said by the one-line notice under it, so the line itself says no "as of". What happened to
          the agent outside OATS (app/outside) takes the line's words where it has a reason for them. */}
      <AgentStatusLine
        agent={agent}
        thread={node.thread}
        now={now}
        gone={gone}
        parts={(own) => lineParts(said, own)}
        action={
          gone ? (
            panelButton
          ) : (
            <>
              {saidActs === undefined ? act : saidActs}
              {panelButton}
            </>
          )
        }
      />
      <OutsideWarning said={said} instance={agent.instance} held={held} />
      {/* The row is from the last roster read: the one drawing of that, on one line (its age, that the acts are held, Retry). */}
      {oats.stale === null ? null : <Unreadable compact failure={oats.stale} machine={oats.deployment.machine} at={oats.stale.at} now={now} onRetry={oats.retry} />}
    </div>
  );
}
