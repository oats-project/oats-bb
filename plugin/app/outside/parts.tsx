// What the places draw of this feature: the acts of a line, the kernel's report as a notice, and
// the thread's own row of an agent whose thread bb has archived. Drawn with the patterns of
// app/ui.tsx; the acts go through OATS (app/lifecycle/acts.tsx).
import { useBbNavigate, useRpc } from "@get-bb/plugin-sdk/app";
import type { ExperimentalThreadHeaderRowProps } from "@get-bb/plugin-sdk/app";
import type { ReactNode } from "react";
import { hasAgentPage, openAgentPage } from "../home/agent-tab";
import { askPlan, run } from "../lifecycle/acts";
import type { Oats } from "../oats";
import { useNow } from "../roster/now";
import { agentStatus, stoppedSince } from "../roster/status";
import { HELD_REASON, Unreadable } from "../roster/unreadable";
import { usePanelEvents } from "../panel/read";
import type { Contract } from "../store";
import { Button, Notice, StatusLine } from "../ui";
import { shown } from "../ui/text";
import { agentName } from "../ui/words";
import type { Agent, ThreadWhere } from "../../model/types";
import { said as sayOf } from "./say";
import type { Act, Said } from "./say";
import type { Outside } from "./use";
import { OUTSIDE_TITLE } from "./words";

const LABEL: Record<Act, string> = { stop: "Stop", start: "Start", restart: "Restart", retire: "Retire" };

/**
 * The acts this feature offers for an agent, as buttons, in order: the lifecycle's own
 * (app/lifecycle/acts.tsx), never a second path to `oats`. Stop and Retire ask the kernel's plan
 * and confirm once, Start and Restart run through OATS. `held`: the roster is the last one read, and
 * the acts stay in their place, off, with the reason (the Desktop's rule).
 */
export function OutsideActs({ instance, acts, held }: { instance: string; acts: readonly Act[]; held: boolean }) {
  const rpc = useRpc<Contract>();
  const navigate = useBbNavigate();
  return (
    <>
      {acts.map((act) => (
        <Button
          key={act}
          data-testid="oats-status-act"
          data-act={act}
          disabled={held}
          title={held ? HELD_REASON : undefined}
          onClick={() => (act === "stop" || act === "retire" ? askPlan(act, instance) : void run(act, instance, rpc, navigate))}
        >
          {LABEL[act]}
        </Button>
      ))}
    </>
  );
}

/**
 * The acts of a status line where this feature has something to say of the agent: the buttons;
 * null where what is said carries its own acts (the kernel's report: they are in its notice);
 * undefined where the line keeps the roster's own act for the state.
 */
export function lineActs(said: Said | null, instance: string, held: boolean): ReactNode | null | undefined {
  if (said === null || said.acts === null) return undefined;
  if (said.warning !== null) return null;
  return <OutsideActs instance={instance} acts={said.acts} held={held} />;
}

/**
 * The acts of an agent the roster draws on no thread (its thread archived or deleted in bb), for
 * the place that shows that agent (its archived thread's row, its own page): what mends its state,
 * then Retire. The acts of the kernel's report are in its notice, not here.
 */
export function detachedActs(said: Said | null): readonly Act[] {
  return [...(said === null || said.acts === null || said.warning !== null ? [] : said.acts), "retire"];
}

/**
 * The kernel's report that a harness runs in a home OATS recorded stopped, said loudly: a notice
 * in the warning tone, titled in a person's words, with the kernel's own message as its sentence
 * (through the display filter), its code after, and the two acts that mend it, Stop and Start.
 * Nothing where the kernel reports nothing.
 */
export function OutsideWarning({ said, instance, held }: { said: Said | null; instance: string; held: boolean }) {
  if (said === null || said.warning === null) return null;
  return (
    <div data-testid="oats-outside-warning" data-instance={instance}>
      <Notice title={OUTSIDE_TITLE} tone="warning" code={said.warning.code} actions={<OutsideActs instance={instance} acts={said.acts ?? ["stop", "start"]} held={held} />}>
        <p>{shown(said.warning.message)}</p>
      </Notice>
    </div>
  );
}

/**
 * The mark of the kernel's report on a row of the sidebar, where a notice has no room: a dot in the
 * warning tone (bb's token for coloured text, which holds 3:1 on a row, open or hovered, in both
 * themes), named by the notice's title. The row's words say it too.
 */
export function OutsideMark() {
  return <span role="img" aria-label={OUTSIDE_TITLE} title={OUTSIDE_TITLE} data-testid="oats-outside-mark" data-mark="" className="inline-block size-2 shrink-0 rounded-full bg-warning-text" />;
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
  const status = agent === undefined || oats.phase !== "ready" ? null : agentStatus(agent, null, now, oats.whereOf(agent));
  const said = agent === undefined ? null : outside.of(agent);
  // A stopped agent's time is its last recorded stop, as on the roster's own row: one read, for this
  // agent, and only where its state is "stopped" (a lost session's state is what happened to it).
  const timed = status?.state === "stopped";
  const events = usePanelEvents(agent?.instance ?? "", timed);
  if (oats.phase !== "ready" || agent === undefined || status === null) return null;
  const held = oats.stale !== null;
  // The thread's menu is bb's, and the roster's entries in it are for a thread it draws an agent
  // on: this thread is none, so the agent's acts are here, Retire among them.
  const acts = <OutsideActs instance={agent.instance} acts={detachedActs(said)} held={held} />;
  const since = timed ? stoppedSince(events.data?.events, agent.startedAt ?? null, now) : null;
  return (
    <div data-testid="oats-identity-row" data-outside={said?.kind ?? ""} className={FRAME}>
      <span data-testid="oats-outside-agent" className="min-w-0 break-words font-semibold">
        {agentName(agent.instance)}
      </span>
      <StatusLine
        state={status.state}
        since={since}
        detail={said?.sentence ?? status.detail}
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
 * For the place that shows ONE agent and is not its thread (the instance panel's header, on the
 * agent's own page and in the thread's tab), under its state:
 * - of an agent the roster draws on no thread (its thread archived or deleted in bb): what
 *   happened in one sentence, and its acts, since it has no thread's line to carry them;
 * - of any agent: the kernel's report, with its acts.
 * Nothing for an agent this feature has nothing to say of. `roster` is what the place holds of the
 * roster (`Oats`' own `nodeByInstance` and `whereOf`); `held`: the roster is the last one read.
 */
export function OutsideAgent({ agent, roster, held }: { agent: Agent; roster: { nodeByInstance: ReadonlyMap<string, { agent: Agent }>; whereOf(agent: Agent): ThreadWhere | undefined }; held: boolean }) {
  const attached = roster.nodeByInstance.get(agent.instance)?.agent === agent;
  const where = roster.whereOf(agent);
  const said = where === undefined ? null : sayOf(agent, where, attached);
  if (said === null || (attached && said.warning === null)) return null;
  return (
    <div data-testid="oats-outside-agent-block" data-outside={said.kind} className="flex min-w-0 flex-col gap-2 text-sm text-foreground">
      {attached || said.sentence === null ? null : <p className="m-0 min-w-0 break-words text-muted-foreground">{said.sentence}</p>}
      {attached ? null : (
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <OutsideActs instance={agent.instance} acts={detachedActs(said)} held={held} />
        </div>
      )}
      <OutsideWarning said={said} instance={agent.instance} held={held} />
    </div>
  );
}
