// One agent's panel as a page of its own, `/plugins/oats/agent/<instance>`: where the panel is on
// a phone (bb's compact layout has no side panel to show the thread's tab in), and for an agent
// that has no bb thread at all. The page shows one agent and a way back.
import { RosterNotice, Unreadable } from "../roster/unreadable";
import { useState } from "react";
import { useBbNavigate } from "@get-bb/plugin-sdk/app";
import type { BbNavigate, PluginNavPanelProps } from "@get-bb/plugin-sdk/app";
import { useOats } from "../oats";
import { Button, Empty, Loading } from "../ui";
import { useSayOpenAgent } from "../roster/open-agent";
import { InstancePanel } from "./Panel";

/** The page's route under the plugin. */
export const AGENT_PAGE = "agent";

/** Opens one agent's page: `instance` is the kernel's name for it. */
export function openAgentPage(navigate: Pick<BbNavigate, "toPluginPanel">, instance: string): void {
  navigate.toPluginPanel(AGENT_PAGE, { subPath: instance });
}

/** The instance a sub-path names: its first segment, decoded; null when it is none. */
function instanceOf(subPath: string): string | null {
  const first = subPath.split("/").find((segment) => segment !== "");
  if (first === undefined) return null;
  try {
    return decodeURIComponent(first);
  } catch {
    return null; // not an encoded segment: no instance is named
  }
}

export function AgentPage({ subPath }: PluginNavPanelProps) {
  const oats = useOats();
  const navigate = useBbNavigate();
  const instance = instanceOf(subPath);
  // The sidebar is told whose page this is: its row's parents stay open while the page is on screen (app/roster/open-agent.ts).
  useSayOpenAgent(instance);
  // The agent as the roster last named it: kept while the roster is read again or cannot be read,
  // as the panel keeps what it showed.
  const [last, setLast] = useState<{ instance: string; threadId: string | null } | null>(null);
  let held = last;
  if (oats.phase === "ready") {
    const agent = instance === null ? undefined : oats.agents.find((candidate) => candidate.instance === instance);
    const threadOf = agent === undefined ? null : (oats.nodeByInstance.get(agent.instance)?.thread.id ?? null);
    held = agent === undefined ? null : last !== null && last.instance === agent.instance && last.threadId === threadOf ? last : { instance: agent.instance, threadId: threadOf };
    if (held !== last) setLast(held);
  }
  const known = held !== null && held.instance === instance ? held : null;
  const threadId = known?.threadId ?? null;
  return (
    <div data-testid="oats-agent-page" className="flex h-full min-h-0 flex-col text-sm text-foreground">
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border p-2">
        {threadId === null ? (
          <Button data-testid="oats-agent-back" onClick={() => navigate.toPluginPanel("home")}>
            ‹ Home
          </Button>
        ) : (
          <Button data-testid="oats-agent-back" onClick={() => navigate.toThread(threadId)}>
            ‹ Thread
          </Button>
        )}
      </div>
      {known !== null ? (
        <div className="min-h-0 flex-1">
          <InstancePanel instance={known.instance} />
        </div>
      ) : (
        <div className="flex flex-col gap-3 p-3">
          {oats.phase === "loading" ? (
            <Loading />
          ) : oats.phase === "failed" ? (
            // The notice every place shows when OATS cannot be read: what is missing in a person's words, on which machine, the code, Retry.
            <Unreadable failure={oats} machine={oats.machine} onRetry={oats.retry} />
          ) : (
            // The page says why it is empty, in its title; the way on is the button over it. Where the roster is the
            // last one read, its notice stands over that (with the Retry: reading again can change the answer).
            <>
              <RosterNotice oats={oats} />
              <Empty title={instance === null ? "No agent to show" : "This agent is not in OATS"} />
            </>
          )}
        </div>
      )}
    </div>
  );
}
