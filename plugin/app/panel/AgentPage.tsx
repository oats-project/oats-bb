// One agent's panel as a page of its own, `/plugins/oats/agent/<instance>`: where the panel is on
// a phone (bb's compact layout has no side panel to show the thread's tab in), and for an agent
// that has no bb thread at all. The page shows one agent and a way back.
import { useRef } from "react";
import { useBbNavigate } from "@get-bb/plugin-sdk/app";
import type { BbNavigate, PluginNavPanelProps } from "@get-bb/plugin-sdk/app";
import { failureLine, useOats } from "../oats";
import { isKernelCode } from "../../kernel/result";
import { Button, Empty, Loading, Notice } from "../ui";
import { shown } from "../ui/text";
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
  // The agent as the roster last named it: kept while the roster is read again or cannot be read,
  // as the panel keeps what it showed.
  const last = useRef<{ instance: string; threadId: string | null } | null>(null);
  if (oats.phase === "ready") {
    const agent = instance === null ? undefined : oats.agents.find((candidate) => candidate.instance === instance);
    last.current = agent === undefined ? null : { instance: agent.instance, threadId: oats.nodeByInstance.get(agent.instance)?.thread.id ?? null };
  }
  const known = last.current !== null && last.current.instance === instance ? last.current : null;
  const threadId = known?.threadId ?? null;
  return (
    <div data-testid="oats-agent-page" className="flex h-full min-h-0 flex-col text-sm text-foreground">
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border p-2">
        {threadId === null ? (
          <Button data-testid="oats-agent-back" onClick={() => navigate.toPluginPanel("home")}>
            Back to Home
          </Button>
        ) : (
          <Button data-testid="oats-agent-back" onClick={() => navigate.toThread(threadId)}>
            Back to the thread
          </Button>
        )}
      </div>
      {known !== null ? (
        <div className="min-h-0 flex-1">
          <InstancePanel instance={known.instance} />
        </div>
      ) : (
        <div className="p-3">
          {oats.phase === "loading" ? (
            <Loading />
          ) : oats.phase === "failed" ? (
            <Notice title="OATS could not be read" tone="error" code={isKernelCode(oats.code) ? oats.code : null} details={failureLine(oats)} actions={<Button onClick={oats.retry}>Retry</Button>} />
          ) : (
            <Empty>{instance === null ? "No agent is named here." : `OATS lists no agent named ${shown(instance)} in this deployment: it may have been retired.`}</Empty>
          )}
        </div>
      )}
    </div>
  );
}
