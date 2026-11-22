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
import type { Act, Said } from "./say";
import type { Outside } from "./use";
import { OUTSIDE_TITLE } from "./words";

const LABEL: Record<Act, string> = { stop: "Stop", start: "Start", restart: "Restart" };

/**
 * The acts this feature offers for an agent, as buttons, in order: Stop asks the kernel's plan and
 * confirms once, Start and Restart run through OATS. `held`: the roster is the last one read, and
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
          onClick={() => (act === "stop" ? askPlan("stop", instance) : void run(act, instance, rpc, navigate))}
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
export function OutsideThreadRow({ threadId, oats, outside }: Pick<ExperimentalThreadHeaderRowProps, "threadId"> & { /** the caller's own `useOats()` and `useOutside(oats)` */ oats: Oats; outside: Outside }) {
  const navigate = useBbNavigate();
  const now = useNow();
  const agent = outside.agentOn(threadId);
  const status = agent === undefined ? null : agentStatus(agent, null, now);
  // A stopped agent's time is its last recorded stop, as on the roster's own row: one read, for this agent.
  const events = usePanelEvents(agent?.instance ?? "", status?.state === "stopped");
  if (oats.phase !== "ready" || agent === undefined || status === null) return null;
  const said = outside.of(agent);
  const held = oats.stale !== null;
  const acts = lineActs(said, agent.instance, held);
  const since = status.state === "stopped" && said?.state == null ? stoppedSince(events.data?.events, agent.startedAt ?? null, now) : null;
  return (
    <div data-testid="oats-identity-row" data-outside={said?.kind ?? ""} className={FRAME}>
      <span data-testid="oats-outside-agent" className="min-w-0 break-words font-semibold">
        {agentName(agent.instance)}
      </span>
      <StatusLine
        state={said?.state?.mark ?? status.state}
        word={said?.state?.word}
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
