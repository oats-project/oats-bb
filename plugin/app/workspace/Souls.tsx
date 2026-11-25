// Souls (`oats souls --json`): the deployment's souls, each with its agents here, and the New
// agent form (app/spawn/) on a soul that can be spawned.
import { useBbNavigate, useRpc } from "@get-bb/plugin-sdk/app";
import type { PluginNavPanelProps } from "@get-bb/plugin-sdk/app";
import { askPlan, run } from "../lifecycle/acts";
import { count } from "../format";
import { hasAgentPage, openAgentPage } from "../home/agent-tab";
import { useOats } from "../oats";
import { RosterNotice } from "../roster/unreadable";
import type { Oats } from "../oats";
import { NewAgent } from "../spawn/NewAgent";
import { openSoul } from "./pages";
import { useRead } from "../store";
import type { Contract, Result } from "../store";
import { Button, Chip, Dot, ErrorLine, Heading, Lines, Loading, Note, plainClick } from "../ui";
import { Frame } from "./Workspace";
import { shown } from "../ui/text";
import { agentName } from "../ui/words";

type Soul = Result<"souls">["souls"][number];
type Ready = Extract<Oats, { phase: "ready" }>;

/**
 * The soul the URL names: the whole remainder of the route. A package soul's key is
 * `<package>/<soul>`, which bb carries as two segments, each percent-encoded.
 */
function decode(subPath: string): string | null {
  if (subPath === "") return null;
  return subPath
    .split("/")
    .map((segment) => {
      try {
        return decodeURIComponent(segment);
      } catch {
        return segment; // not a valid escape: no soul has that name, and the page says so
      }
    })
    .join("/");
}

/** This deployment's agents of one soul: in the tree, with a missing thread, or on another backend. */
function SoulAgents({ soul, oats }: { soul: Soul; oats: Ready }) {
  const rpc = useRpc<Contract>();
  const navigate = useBbNavigate();
  const mine = oats.agents.filter((agent) => agent.soul === soul.agent);
  if (mine.length === 0) return <Note>No agent of this soul in this deployment.</Note>;
  const detached = new Set(oats.view.detached);
  // On the last roster read the OATS acts are held: each stays in its place, off, with the reason.
  const held = oats.stale !== null;
  return (
    <ul data-testid="oats-soul-agents" className="flex flex-col gap-1">
      {mine.map((agent) => {
        const node = oats.nodeByInstance.get(agent.instance);
        const thread = node === undefined ? undefined : oats.threadById.get(node.thread.id);
        if (node !== undefined && thread !== undefined) {
          return (
            <li key={agent.instance}>
              <a
                data-testid="oats-soul-agent"
                data-instance={agent.instance}
                href={thread.href}
                className="flex min-w-0 items-center gap-2 rounded-md px-2 py-1.5 hover:bg-accent"
                onClick={(event) => {
                  if (!plainClick(event)) return;
                  event.preventDefault();
                  navigate.toThread(thread.id);
                }}
              >
                <Dot state={node.state} />
                <span className="min-w-0 flex-1 break-words" title={shown(agent.instance)}>
                  {agentName(agent.instance)}
                </span>
              </a>
            </li>
          );
        }
        if (detached.has(agent)) {
          return (
            <li key={agent.instance} data-testid="oats-soul-agent-detached" data-instance={agent.instance} className="flex flex-wrap items-center gap-2 px-2 py-1.5">
              <span className="min-w-0 flex-1 break-words" title={shown(agent.instance)}>{agentName(agent.instance)}</span>
              <span className="text-xs text-muted-foreground">thread missing</span>
              {/* (The dots: each opens its dialog, and nothing runs on the press; one rule for every act of the plugin.) */}
              <Button data-testid="oats-detached-start" disabled={held} onClick={() => void run("start", agent.instance, rpc, navigate)}>
                Start…
              </Button>
              <Button data-testid="oats-detached-retire" disabled={held} onClick={() => askPlan("retire", agent.instance)}>
                Retire…
              </Button>
            </li>
          );
        }
        return (
          <li key={agent.instance} data-testid="oats-soul-agent-elsewhere" data-instance={agent.instance} className="flex items-center gap-2 px-2 py-1.5">
            <span className="min-w-0 flex-1 break-words" title={shown(agent.instance)}>{agentName(agent.instance)}</span>
            <span className="text-xs text-muted-foreground">{`on ${shown(agent.backend)}`}</span>
            {/* An agent with no bb thread has its own page, where a feature gives agents one. */}
            {hasAgentPage() ? (
              <Button data-testid="oats-soul-agent-open" onClick={() => void openAgentPage(navigate, agent.instance)}>
                Open
              </Button>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

function SoulDetail({ soul, oats }: { soul: Soul; oats: Oats }) {
  return (
    <article data-testid="oats-soul-detail" className="flex min-w-0 flex-col gap-4">
      <header className="flex flex-col gap-1">
        <h2 className="break-words text-base font-semibold">{shown(soul.name)}</h2>
        {soul.description === "" ? null : <p className="break-words">{shown(soul.description)}</p>}
        <p className="break-words text-xs text-muted-foreground">{`from ${shown(soul.origin)}`}</p>
      </header>
      <section className="flex flex-col gap-2">
        <Heading n={soul.capabilities.length}>Capabilities</Heading>
        {soul.capabilities.length === 0 ? (
          <Note>This soul has no capabilities.</Note>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {soul.capabilities.map((id) => (
              <Chip key={id}>{shown(id)}</Chip>
            ))}
          </div>
        )}
      </section>
      <section className="flex flex-col gap-2">
        <Heading>Agents</Heading>
        {/* The agents are the roster's, as last read while OATS cannot be read: the page's notice says so. */}
        {oats.phase === "ready" ? <SoulAgents soul={soul} oats={oats} /> : oats.phase === "loading" ? <Loading>Reading your agents…</Loading> : null}
      </section>
      <section className="flex flex-col gap-2">
        <Heading>New agent</Heading>
        {soul.spawnable ? (
          <NewAgent key={soul.name} soul={soul} />
        ) : (
          <p data-testid="oats-soul-problem" role="alert" className="break-words text-destructive-text">
            <Lines text={soul.problem ?? "This soul cannot be spawned."} />
          </p>
        )}
      </section>
    </article>
  );
}

export function SoulsPage({ subPath }: PluginNavPanelProps) {
  const oats = useOats();
  const souls = useRead("souls");
  const navigate = useBbNavigate();
  const picked = decode(subPath);

  if (souls.data === undefined) {
    return (
      <Frame tab="souls" testId="oats-souls-page">
        {souls.status === "error" ? <ErrorLine onRetry={souls.retry}>{souls.error}</ErrorLine> : <Note>Reading OATS…</Note>}
      </Frame>
    );
  }
  const list = souls.data.souls;
  const soul = picked === null ? undefined : list.find((candidate) => candidate.name === picked);
  // A soul's agents are the roster rows under its agent name (`soul.agent`), not under its key.
  const agentsOf = (soul: Soul) => (oats.phase === "ready" ? oats.agents.filter((agent) => agent.soul === soul.agent).length : null);

  return (
    <Frame tab="souls" testId="oats-souls-page">
      {souls.status === "error" ? <ErrorLine onRetry={souls.retry}>{souls.error}</ErrorLine> : null}
      {/* Each soul's count of agents, and a soul's agents, are the roster's: while OATS cannot be read the page says so once, above both. */}
      <RosterNotice oats={oats} />
      <div className="flex min-w-0 flex-col gap-4 md:flex-row md:items-start">
        {/* At phone width one of the two shows at a time: the list, or the picked soul with Back. */}
        <nav aria-label="Souls" className={`flex-col gap-1 md:flex md:w-64 md:shrink-0 ${picked === null ? "flex" : "hidden"}`}>
          <Heading n={list.length}>Souls</Heading>
          {list.length === 0 ? <Note>This deployment offers no souls.</Note> : null}
          <ul className="flex flex-col">
            {list.map((candidate) => {
              const n = agentsOf(candidate);
              return (
                <li key={candidate.name}>
                  <button
                    type="button"
                    data-testid="oats-soul-row"
                    aria-current={candidate.name === picked ? "true" : undefined}
                    className={`flex w-full min-w-0 items-baseline gap-2 rounded-md px-2 py-1.5 text-left hover:bg-accent ${candidate.name === picked ? "bg-accent" : ""}`}
                    onClick={() => openSoul(navigate, candidate.name)}
                  >
                    <span className="min-w-0 flex-1 truncate">{shown(candidate.name)}</span>
                    <span className="shrink-0 text-xs text-muted-foreground">{n === null ? "" : count(n, "agent")}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </nav>
        <div className={`min-w-0 flex-1 flex-col gap-3 md:flex ${picked === null ? "hidden" : "flex"}`}>
          {picked === null ? (
            <Note>Pick a soul to see it and to start a new agent.</Note>
          ) : (
            <>
              <Button data-testid="oats-back" className="self-start md:hidden" onClick={() => navigate.toPluginPanel("souls")}>
                ← Souls
              </Button>
              {soul === undefined ? <Note>{`This deployment has no soul named ${shown(picked)}.`}</Note> : <SoulDetail soul={soul} oats={oats} />}
            </>
          )}
        </div>
      </div>
    </Frame>
  );
}
