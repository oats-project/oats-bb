// One agent's panel as a page of its own, `/plugins/oats/agent/<instance>`: where the panel is on
// a phone (bb's compact layout has no side panel to show the thread's tab in), and for an agent
// that has no bb thread at all. The page shows one agent and a way back.
import { useBbNavigate } from "@get-bb/plugin-sdk/app";
import type { BbNavigate, PluginNavPanelProps } from "@get-bb/plugin-sdk/app";
import { failureLine, useOats } from "../oats";
import { Button, ErrorLine, Note } from "../ui";
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
  const agent = oats.phase === "ready" && instance !== null ? oats.agents.find((candidate) => candidate.instance === instance) : undefined;
  const thread = oats.phase === "ready" && agent !== undefined ? oats.nodeByInstance.get(agent.instance)?.thread : undefined;
  return (
    <div data-testid="oats-agent-page" className="flex h-full min-h-0 flex-col text-sm text-foreground">
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border p-2">
        {thread === undefined ? (
          <Button data-testid="oats-agent-back" className="min-h-11 md:min-h-8" onClick={() => navigate.toPluginPanel("home")}>
            Back to Home
          </Button>
        ) : (
          <Button data-testid="oats-agent-back" className="min-h-11 md:min-h-8" onClick={() => navigate.toThread(thread.id)}>
            Back to the thread
          </Button>
        )}
      </div>
      {agent !== undefined ? (
        <div className="min-h-0 flex-1">
          <InstancePanel instance={agent.instance} />
        </div>
      ) : (
        <div className="p-3">
          {oats.phase === "loading" ? (
            <Note>Reading OATS…</Note>
          ) : oats.phase === "failed" ? (
            <ErrorLine onRetry={oats.retry}>{failureLine(oats)}</ErrorLine>
          ) : (
            <Note>{instance === null ? "No agent is named here." : `OATS lists no agent named ${shown(instance)} in this deployment: it may have been retired.`}</Note>
          )}
        </div>
      )}
    </div>
  );
}
