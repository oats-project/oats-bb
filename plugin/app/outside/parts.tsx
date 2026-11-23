// What the places draw of this feature: the acts of a line, the kernel's report as a notice, and
// the thread's own row of an agent whose thread bb has archived. Drawn with the patterns of
// app/ui.tsx; the acts go through OATS (app/lifecycle/acts.tsx).
import { useBbNavigate } from "@get-bb/plugin-sdk/app";
import type { ExperimentalThreadHeaderRowProps } from "@get-bb/plugin-sdk/app";
import type { ReactNode } from "react";
import { hasAgentPage, openAgentPage } from "../home/agent-tab";
import { AgentActs, actsFor, openAct } from "../lifecycle";
import { useOats } from "../oats";
import type { Oats } from "../oats";
import { useNow } from "../roster/now";
import { agentStatus } from "../roster/status";
import { Unreadable } from "../roster/unreadable";
import { Button, Notice, StatusLine } from "../ui";
import { shown } from "../ui/text";
import { agentName } from "../ui/words";
import type { Agent, AgentState, ThreadWhere } from "../../model/types";
import { said as sayOf } from "./say";
import type { Act, Said } from "./say";
import type { Outside } from "./use";
import { OUTSIDE_START, OUTSIDE_STOP, OUTSIDE_WHAT, OUTSIDE_WHAT_STOP, outsideTitle, STOPPED_OPEN_ASKING } from "./words";

const LABEL: Record<Act, string> = { stop: "Stop", start: "Start", retire: "Retire" };
/** On a button: with the dots, since each opens its dialog and nothing runs on the press. */
const BUTTON: Record<Act, string> = { stop: "Stop…", start: "Start…", retire: "Retire…" };

/**
 * The acts this feature itself offers for an agent, as buttons, in order. Each opens the
 * lifecycle's own dialog for that act (`openAct`, app/lifecycle): the kernel is asked first and
 * nothing runs on one press. Never a second path to `oats`. `held`: the roster is the last one
 * read, and the acts stay in their place, off (the Desktop's rule); the notice on the same screen says why.
 */
export function OutsideActs({ instance, acts, held }: { instance: string; acts: readonly Act[]; held: boolean }) {
  return (
    <>
      {acts.map((act) => (
        <Button key={act} data-testid="oats-status-act" data-act={act} disabled={held} onClick={() => openAct(act, instance)}>
          {BUTTON[act]}
        </Button>
      ))}
    </>
  );
}

/** The state each reason is said after: `said()` reads the agent's state without bb's own question on its thread. */
const AFTER: Partial<Record<Said["kind"], AgentState>> = { "stopped-open": "stopped", "stopped-host": "stopped", "stopped-archived": "stopped", "lost-archived": "stopped", deleted: "stopped", "idle-unloaded": "idle", "failed-open": "error", outside: "outside" };

/**
 * Whether a reason belongs on a line or a row that draws `state`: the reason follows ONE state,
 * and `said()` reads the agent's state without bb's own question on its thread. Where bb holds one,
 * the place says "Needs you", and a reason made for "Stopped" or "Idle" has no place after it. One
 * reason holds there too: a stop that warns, whose warning is about a message typed in that thread.
 */
const follows = (said: Said, state: AgentState): boolean => AFTER[said.kind] === undefined || AFTER[said.kind] === state || said.kind === "stopped-open";

/**
 * The acts of a status line where this feature has something to say of the agent: the buttons;
 * null where what is said carries its own acts (the kernel's report: they are in its notice);
 * undefined where the line keeps the roster's own act for the state: this feature has no acts for
 * it, or the line's state is not the one the reason follows (the sentence that names the act is
 * then not on the line).
 */
export function lineActs(said: Said | null, instance: string, held: boolean, state: AgentState): ReactNode | null | undefined {
  if (said === null || said.acts === null || !follows(said, state)) return undefined;
  if (said.warning !== null) return null;
  return <OutsideActs instance={instance} acts={said.acts} held={held} />;
}

/**
 * What a sidebar's row says after the state's word, in the soul's place, and whether its mark is in
 * the warning tone: the reason, where the row's state is the one it follows; null (the soul, the
 * state's own mark) where it is not ("Needs you · with the machine" is no sentence), and where this
 * feature has nothing to say.
 */
export function rowParts(said: Said | null, state: AgentState): { note: string | null; tone: "warning" | undefined } {
  if (said === null || !follows(said, state)) return { note: null, tone: undefined };
  return { note: said.note, tone: said.rowTone === "warning" ? "warning" : undefined };
}

/**
 * What a status line says after the state's word, where this feature has a reason for it: the
 * reason, or the sentence that keeps a person from harm, and whether the line warns. `status` is
 * the roster's own (`agentStatus`). When OATS recorded a stop is a fact of the instance panel.
 * - the kernel's report: "recorded stopped";
 * - any other reason, on a line whose state is the one the reason follows: the reason;
 * - a line whose state is another (bb holds a question on the thread, so it says "Needs you"): the
 *   roster's own words, which say what the agent asks. But for a stop that warns, where an answer
 *   typed in the thread is the message that starts the agent without OATS: the warning, saying
 *   first what OATS recorded;
 * - none: the roster's own.
 */
export function lineParts(said: Said | null, status: { state: AgentState; since: string | null; detail: string | null }): { since: string | null; detail: string | null; tone: "warning" | undefined } {
  const own = { since: status.since, detail: status.detail, tone: undefined };
  if (said === null || said.sentence === null) return own;
  const tone = said.tone === "warning" ? "warning" : undefined;
  if (said.kind === "stopped-open" && status.state !== "stopped") return { since: null, detail: STOPPED_OPEN_ASKING, tone };
  if (!follows(said, status.state)) return own;
  return { since: status.since, detail: said.sentence, tone };
}

/**
 * The acts of an agent the roster draws on no thread (its thread archived in bb), for the place
 * that shows that agent and has no acts of its own (its archived thread's row): the lifecycle's own
 * buttons for its state (`AgentActs`: Start and Retire for a stopped agent). Where a process runs,
 * or may, with no thread a person can see, the acts are this feature's: a session lost to bb's
 * Archive and an agent archived while its row still says it runs (Stop, then Retire; Start comes
 * once it is stopped), and the kernel's report, whose Stop and Start are in its notice (Retire
 * alone is here).
 */
export function DetachedActs({ said, instance, held }: { said: Said | null; instance: string; held: boolean }) {
  if (said !== null && said.warning !== null) return <OutsideActs instance={instance} acts={["retire"]} held={held} />;
  if (said !== null && (said.kind === "lost-archived" || said.kind === "running-archived")) return <OutsideActs instance={instance} acts={["stop", "retire"]} held={held} />;
  return <AgentActs instance={instance} />;
}

/** The two acts the kernel's report names. */
const BOTH = ["stop", "start"] as const;

/**
 * The kernel's report that a harness runs in a home OATS recorded stopped, as a notice in the
 * warning tone, in a person's words: what is so (its title), what happened and what to do, and the
 * two acts that mend it, each with what it does here. The kernel's own sentence and its code are
 * one press away, under Details, through the display filter: no command is on screen where the two
 * buttons do the same. Nothing where the kernel reports nothing.
 * The lifecycle starts an agent on bb only: for an agent of another session provider the notice
 * names Stop alone (no Start line, and its sentence does not say to start it), so that nothing is
 * named that cannot be pressed.
 */
export function OutsideWarning({ said, instance, held, own = BOTH }: { said: Said | null; instance: string; held: boolean; /** the acts the notice draws a button of its own for (both, by default); for another act it names, it says what the act does, and the place has that act's button over the notice (the panel's header). It names Start only for an agent on bb. */ own?: readonly ("stop" | "start")[] }) {
  if (said === null || said.warning === null) return null;
  const startable = said.warning.backend === "bb";
  return (
    <div data-testid="oats-outside-warning" data-instance={instance}>
      <Notice title={outsideTitle(instance)} tone="warning" details={`${said.warning.code}: ${said.warning.message}`}>
        <p>{startable ? OUTSIDE_WHAT : OUTSIDE_WHAT_STOP}</p>
        <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
          {(
            [
              ["stop", OUTSIDE_STOP],
              ["start", OUTSIDE_START],
            ] as const
          )
            .filter(([act]) => act === "stop" || startable)
            .map(([act, does]) => (
            <li key={act} data-testid="oats-outside-act" className="flex min-w-0 flex-wrap items-center gap-2">
              {own.includes(act) ? <OutsideActs instance={instance} acts={[act]} held={held} /> : <span className="font-semibold text-foreground">{LABEL[act]}</span>}
              <span className="min-w-0 break-words text-muted-foreground">{does}</span>
            </li>
          ))}
        </ul>
      </Notice>
    </div>
  );
}

const FRAME = "flex flex-col gap-1.5 border-b border-border px-3 py-2 text-sm text-foreground";

/**
 * The thread's own row on a thread bb has ARCHIVED and that is the recorded thread of an agent of
 * the roster: who the agent is, where it is in words, and the act that applies. The roster draws
 * an agent's row on the thread it lists; an archived thread is none of them, and without this its
 * header would say nothing. Nothing for any other thread.
 */
export function OutsideThreadRow({ threadId, oats, outside }: Pick<ExperimentalThreadHeaderRowProps, "threadId"> & { /** the caller's own `useOats()` and `outsideOf(oats)` */ oats: Oats; outside: Outside }) {
  const navigate = useBbNavigate();
  const now = useNow();
  const agent = outside.agentOn(threadId);
  const status = agent === undefined || oats.phase !== "ready" ? null : agentStatus(agent, null, now);
  const said = agent === undefined ? null : outside.of(agent);
  if (oats.phase !== "ready" || agent === undefined || status === null) return null;
  const held = oats.stale !== null;
  // The thread's menu is bb's, and the lifecycle's entries in it are for a thread the roster draws
  // an agent on: this thread is none, so the agent's acts are here, Retire among them.
  const acts = <DetachedActs said={said} instance={agent.instance} held={held} />;
  const parts = lineParts(said, { state: status.state, since: status.since, detail: status.detail });
  return (
    <div data-testid="oats-identity-row" data-outside={said?.kind ?? ""} className={FRAME}>
      <span data-testid="oats-outside-agent" className="min-w-0 break-words font-semibold">
        {agentName(agent.instance)}
      </span>
      <StatusLine
        state={status.state}
        since={parts.since}
        detail={parts.detail}
        tone={parts.tone}
        action={
          <>
            {acts}
            {hasAgentPage() ? (
              <Button data-testid="oats-open-panel" title="Open this agent's instance panel" onClick={() => void openAgentPage(navigate, agent.instance)}>
                Instance panel
              </Button>
            ) : null}
          </>
        }
      />
      <OutsideWarning said={said} instance={agent.instance} held={held} />
      {oats.stale === null ? null : <Unreadable compact failure={oats.stale} machine={oats.deployment.machine} at={oats.stale.at} now={now} onRetry={oats.retry} />}
    </div>
  );
}

/**
 * For the place that shows ONE agent and is not its thread (the instance panel: first on its
 * Instance tab's page, under the header that says its state):
 * - of an agent the roster draws on no thread (its thread archived or deleted in bb): what
 *   happened in one sentence (its acts are the header's, the lifecycle's own; Stop for a session
 *   OATS lost is here, since the header offers none for an agent that reads stopped);
 * - of any agent: the kernel's report. The acts it names are the header's, act by act: one the
 *   header has, the notice says what it does; one the header lacks (no roster is read just now,
 *   so the lifecycle offers nothing), the notice keeps its own button for: a person never reads
 *   "Stop" or "Start" with nothing to press, and no act is on the page twice. (The notice names
 *   no Start for an agent that is not on bb: `OutsideWarning`.)
 * Nothing for an agent this feature has nothing to say of. `roster` is what the place holds of the
 * roster (`Oats`' own `nodeByInstance` and `whereOf`); `held`: the roster is the last one read.
 */
export function OutsideAgent({ agent, roster, held }: { agent: Agent; roster: { nodeByInstance: ReadonlyMap<string, { agent: Agent }>; whereOf(agent: Agent): ThreadWhere }; held: boolean }) {
  const attached = roster.nodeByInstance.get(agent.instance)?.agent === agent;
  const where = roster.whereOf(agent);
  const said = sayOf(agent, where, attached);
  // The header's own acts for this agent now (`AgentActs` draws exactly these).
  const headed = actsFor(useOats(), agent.instance).map((act) => act.verb);
  // Nothing to draw: an agent on its thread with no report; and one with no sentence and no report
  // (a row that says only where its thread is: that is the sidebar's, and the acts are the header's).
  if (said === null || (attached && said.warning === null) || (said.sentence === null && said.warning === null)) return null;
  return (
    <div data-testid="oats-outside-agent-block" data-outside={said.kind} className="flex min-w-0 flex-col gap-2 text-sm text-foreground">
      {/* (The kernel's report says what happened in its notice; its fact "recorded stopped" is the thread's line's.) */}
      {attached || said.sentence === null || said.warning !== null ? null : (
        <p data-testid="oats-outside-reason" data-tone={said.tone === "warning" ? "warning" : undefined} className={`m-0 min-w-0 break-words ${said.tone === "warning" ? "text-warning-text" : "text-muted-foreground"}`}>
          {said.sentence}
        </p>
      )}
      {/* The panel's header has the lifecycle's acts for the agent's state (`AgentActs`). One act is not among
          them: Stop for a session OATS lost (it reads stopped, and its process may run): it is here, under its sentence. */}
      {attached || said.kind !== "lost-archived" ? null : (
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <OutsideActs instance={agent.instance} acts={["stop"]} held={held} />
        </div>
      )}
      {/* Act by act: one the header has is the header's (the notice says what it does); one it lacks is the notice's own
          button. Start is the lifecycle's for an agent on bb only, so the notice draws none for another provider's. */}
      <OutsideWarning said={said} instance={agent.instance} held={held} own={BOTH.filter((act) => !headed.includes(act) && (act === "stop" || agent.backend === "bb"))} />
    </div>
  );
}
