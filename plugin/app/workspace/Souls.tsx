// Souls (`oats souls --json`): the deployment's souls, grouped by where they come from, and a
// soul's own page: what it does, what its agents start with, its teams, its capabilities and why
// it has each, its agents here, and New agent, which opens the form with that soul chosen.
// (The audit of the hidden pages and its ruling, 25 Nov 2026: S1 to S8, P1 to P16.)
import { useState } from "react";
import { useBbNavigate } from "@get-bb/plugin-sdk/app";
import type { BbNavigate, PluginNavPanelProps } from "@get-bb/plugin-sdk/app";
import { rest } from "../../model/rest";
import { harnessLabel } from "../../model/spawn";
import type { Agent } from "../../model/types";
import { openAgentPage } from "../home/agent-tab";
import { useCli } from "../home/cli";
import { useOats } from "../oats";
import type { Oats } from "../oats";
import { DetachedActs, outsideOf, rowParts, rowWords } from "../outside";
import { agentStatus, rowState } from "../roster/status";
import { useNow } from "../roster/now";
import { useRead } from "../store";
import type { Result } from "../store";
import { Button, DisabledReason, Disclosure, Fact, Facts, Heading, Lines, Loading, Note, Page, plainClick, SearchField, State, TmuxMark, Toned } from "../ui";
import { shown } from "../ui/text";
import { agentName } from "../ui/words";
import { newAgentHeld, openNewAgent, openSoul } from "./pages";
import { Before, FILTER_FROM, Frame, matches, OneLine } from "./Workspace";

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

/** A soul's agents are the roster rows under its agent name (`soul.agent`), not under its key. */
const agentsOf = (soul: Soul, oats: Ready): Agent[] => oats.agents.filter((agent) => agent.soul === soul.agent);
const ROW = "flex w-full min-w-0 flex-col gap-0.5 rounded-md px-2 py-1.5 text-left hover:bg-accent";

// ---- the list ----

/** The souls a search leaves: by a soul's key and what it does. */
const foundSouls = (souls: readonly Soul[], query: string): Soul[] => souls.filter((soul) => matches(query, soul.name, soul.description));

/** The souls in groups, by where each comes from, in the order the kernel lists them; one group with no heading where the kernel names no source. */
function grouped(souls: readonly Soul[]): { label: string | null; souls: Soul[] }[] {
  const groups: { label: string | null; souls: Soul[] }[] = [];
  for (const soul of souls) {
    const label = soul.source?.label ?? null;
    const group = groups.find((each) => each.label === label);
    if (group === undefined) groups.push({ label, souls: [soul] });
    else group.souls.push(soul);
  }
  return groups;
}

function SoulList({ souls, oats, query, onQuery }: { souls: readonly Soul[]; oats: Oats; query: string; onQuery: (query: string) => void }) {
  const navigate = useBbNavigate();
  if (souls.length === 0) return <Note>No souls.</Note>;
  const found = foundSouls(souls, query);
  const groups = grouped(found);
  // A heading only where it tells groups apart: where the souls are of one group it is left out.
  const oneGroup = grouped(souls).length === 1;
  return (
    <>
      {souls.length >= FILTER_FROM ? <SearchField label="Search souls" placeholder="Search souls" value={query} onChange={onQuery} /> : null}
      {found.length === 0 ? <Note>Nothing matches.</Note> : null}
      {groups.map((group) => (
        <section key={group.label ?? ""} data-testid="oats-soul-group" className="flex min-w-0 flex-col gap-1">
          {group.label === null || oneGroup ? null : <Heading n={group.souls.length}>{shown(group.label)}</Heading>}
          <ul className="flex min-w-0 flex-col">
            {group.souls.map((soul) => {
              // How many of its agents RUN: a soul none of whose agents runs says nothing (the soul's page lists them all).
              const running = oats.phase === "ready" ? agentsOf(soul, oats).filter((agent) => rest(agent) === "runs").length : 0;
              return (
                <li key={soul.name}>
                  <button type="button" data-testid="oats-soul-row" title={shown(soul.name)} className={ROW} onClick={() => openSoul(navigate, soul.name)}>
                    <span className="flex min-w-0 items-baseline gap-2">
                      {/* Under its group's heading a soul is its own name; the key is whole in the row's title and on its page. Never cut. */}
                      <span data-testid="oats-soul-name" className="min-w-0 flex-1 break-words font-semibold">{shown(group.label === null ? soul.name : (soul.shortName ?? soul.name))}</span>
                      {soul.spawnable ? null : <span data-testid="oats-soul-cannot" className="shrink-0 text-xs text-warning-text">Can't spawn</span>}
                      {running === 0 ? null : (
                        <span data-testid="oats-soul-running" className="shrink-0 text-xs text-muted-foreground">
                          <Toned tone="ok">{`${running} running`}</Toned>
                        </span>
                      )}
                    </span>
                    {/* What it does, on ONE line; whole on its page (and in this line's title). */}
                    {soul.description === "" ? null : <OneLine testId="oats-soul-does" text={soul.description} />}
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </>
  );
}

// ---- a soul's page ----

/** One agent of the soul, as the roster says it: its state as a dot AND its word, the reason after it, where it runs; the row opens it. */
function SoulAgent({ agent, oats }: { agent: Agent; oats: Ready }) {
  const navigate = useBbNavigate();
  const now = useNow();
  const outside = outsideOf(oats);
  const node = oats.nodeByInstance.get(agent.instance);
  const thread = node === undefined || node.agent !== agent ? undefined : oats.threadById.get(node.thread.id);
  const said = oats.gone.has(agent.instance) ? null : outside.of(agent);
  const status = agentStatus(agent, thread === undefined ? null : (node?.thread ?? null), now);
  const drawn = rowState(status, oats.gone.has(agent.instance));
  const reason = rowParts(said, status.state);
  const words = rowWords(drawn.word, drawn.state, reason.note);
  const open = () => {
    if (thread !== undefined) navigate.toThread(thread.id);
    // An agent with no listed thread: its archived conversation where bb keeps one, else its own page.
    else if (said?.archived === true && agent.threadId !== null) navigate.toThread(agent.threadId);
    else void openAgentPage(navigate as BbNavigate, agent.instance);
  };
  const line = (
    <>
      {/* (The name keeps room of its own: at a phone's width the state goes under it, never the name letter by letter.) */}
      <span className="min-w-[8rem] flex-1 break-words" title={shown(agent.instance)}>{agentName(agent.instance)}</span>
      <span data-testid="oats-soul-agent-state" className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
        <State state={drawn.state} word={words.state} tone={reason.tone} />
        {words.reason === null || words.reason === "" ? null : <span className={reason.tone === "warning" ? "text-warning-text" : ""}>{`· ${words.reason}`}</span>}
        {agent.backend === "tmux" ? <TmuxMark /> : null}
      </span>
    </>
  );
  // An agent bb has no listed thread for and that needs an act (its thread archived or deleted while OATS has it): its acts are here, as on its row elsewhere.
  const detached = thread === undefined && agent.backend !== "tmux";
  return (
    <li data-testid="oats-soul-agent" data-instance={agent.instance} data-where={thread !== undefined ? "thread" : agent.backend === "tmux" ? "tmux" : "detached"} className="flex min-w-0 flex-wrap items-center gap-2">
      {thread !== undefined ? (
        <a
          href={thread.href}
          className="flex min-w-[12rem] flex-1 flex-wrap items-center gap-x-2 gap-y-0.5 rounded-md px-2 py-1.5 hover:bg-accent"
          onClick={(event) => {
            if (!plainClick(event)) return;
            event.preventDefault();
            open();
          }}
        >
          {line}
        </a>
      ) : (
        <button type="button" className="flex min-w-[12rem] flex-1 flex-wrap items-center gap-x-2 gap-y-0.5 rounded-md px-2 py-1.5 text-left hover:bg-accent" onClick={open}>
          {line}
        </button>
      )}
      {detached ? <DetachedActs said={said} instance={agent.instance} held={oats.stale !== null} /> : null}
    </li>
  );
}

function SoulDetail({ soul, oats }: { soul: Soul; oats: Oats }) {
  const navigate = useBbNavigate();
  const stale = oats.phase === "ready" && oats.stale !== null;
  const { cli } = useCli(true, oats.phase === "ready");
  // Which capabilities fill a core place: they stand first, tagged.
  const layers = new Map((useRead("capabilities").data?.capabilities ?? []).map((capability) => [capability.id, capability.layer ?? null]));
  const capabilities = [...soul.capabilities].sort((a, b) => Number(Boolean(layers.get(b))) - Number(Boolean(layers.get(a))));
  const mine = oats.phase === "ready" ? agentsOf(soul, oats) : null;
  // (The harness by the name the New agent form gives it; the model as the kernel has it.)
  const launch = [soul.harness ? harnessLabel(soul.harness) : null, soul.model].filter((part): part is string => typeof part === "string" && part !== "").map((part) => shown(part)).join(" · ");
  const teams = (soul.teams ?? []).map((team) => shown(team.label)).join(", ");
  const under = [soul.origin === "" ? null : `from ${soul.origin}`, soul.file ? `Defined in ${soul.file}` : null, soul.problem].filter((part): part is string => part !== null && part !== "");
  return (
    <article data-testid="oats-soul-detail" className="flex min-w-0 flex-col gap-4">
      <header className="flex min-w-0 flex-col gap-2">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <h2 className="min-w-0 flex-1 break-words text-base font-semibold">{shown(soul.name)}</h2>
          {/* A soul that cannot be spawned keeps the button, off, with the one reason beside it; the kernel's own words are under Details. */}
          {soul.spawnable ? null : <DisabledReason>Can't spawn here</DisabledReason>}
          <Button variant="primary" data-testid="oats-soul-new-agent" disabled={!soul.spawnable || newAgentHeld(stale, cli)} onClick={() => void openNewAgent(navigate as BbNavigate, true, { soul: soul.name })}>
            New agent
          </Button>
        </div>
        {/* Where it comes from, in a word (its group's); the repository, the commit and its file are under Details. */}
        {soul.source === undefined ? null : <p data-testid="oats-soul-source" className="text-xs text-muted-foreground">{shown(soul.source.label)}</p>}
        {soul.description === "" ? null : <p data-testid="oats-soul-does" className="break-words">{shown(soul.description)}</p>}
      </header>
      <Facts>
        <Fact label="Harness · model">{launch}</Fact>
        <Fact label="Teams">{teams}</Fact>
      </Facts>
      {/* A soul the kernel could not resolve (one that cannot be spawned): what it is composed of is not known, so nothing is said of it, never "none". */}
      {soul.unresolved === true ? null : (
      <section data-testid="oats-soul-capabilities" className="flex min-w-0 flex-col gap-1">
        <Heading n={capabilities.length}>Capabilities</Heading>
        {capabilities.length === 0 ? (
          <Note>No capabilities.</Note>
        ) : (
          <ul className="flex min-w-0 flex-col">
            {capabilities.map((id) => {
              const why = soul.why?.[id];
              return (
                <li key={id} data-testid="oats-soul-capability" className="flex min-w-0 flex-wrap items-baseline gap-x-2 px-2 py-1">
                  <span className="min-w-0 break-words font-semibold">{shown(id)}</span>
                  {layers.get(id) ? <span className="text-xs text-muted-foreground">core</span> : null}
                  {/* Why the soul has it, in the kernel's own word ("workspace", "soul"). */}
                  {why === undefined ? null : <span className="text-xs text-muted-foreground">{shown(why)}</span>}
                </li>
              );
            })}
          </ul>
        )}
      </section>
      )}
      <section data-testid="oats-soul-agents" className="flex min-w-0 flex-col gap-1">
        <Heading {...(mine === null ? {} : { n: mine.length })}>Agents</Heading>
        {/* The agents are the roster's, as last read while OATS cannot be read: the page's notice says so. */}
        {mine === null ? (
          oats.phase === "loading" ? <Loading>Reading…</Loading> : null
        ) : mine.length === 0 ? (
          <Note>No agents.</Note>
        ) : (
          <ul className="flex min-w-0 flex-col gap-1">
            {mine.map((agent) => (
              <SoulAgent key={agent.instance} agent={agent} oats={oats as Ready} />
            ))}
          </ul>
        )}
      </section>
      {under.length === 0 ? null : (
        <Disclosure summary="Details" testId="oats-soul-details">
          {under.map((text, index) => (
            <p key={index} className="break-words text-xs text-muted-foreground">
              <Lines text={text} />
            </p>
          ))}
        </Disclosure>
      )}
    </article>
  );
}

export function SoulsPage({ subPath }: PluginNavPanelProps) {
  const oats = useOats();
  const souls = useRead("souls");
  const navigate = useBbNavigate();
  const picked = decode(subPath);
  const [query, setQuery] = useState("");
  // The list: the Souls tab of the Workspace page.
  if (picked === null) {
    return (
      <Frame tab="souls" testId="oats-souls-page" {...(souls.data === undefined || query.trim() === "" ? {} : { found: foundSouls(souls.data.souls, query).length })}>
        <Before oats={oats} read={souls} />
        {souls.data === undefined ? null : <SoulList souls={souls.data.souls} oats={oats} query={query} onQuery={setQuery} />}
      </Frame>
    );
  }
  // A soul's own page opens over the list, at every width, with the way back (the Desktop's).
  const soul = souls.data?.souls.find((candidate) => candidate.name === picked);
  return (
    <Page testId="oats-souls-page">
      <Button data-testid="oats-back" className="self-start" onClick={() => navigate.toPluginPanel("souls")}>
        ← Souls
      </Button>
      <Before oats={oats} read={souls} />
      {souls.data === undefined ? null : soul === undefined ? <Note>{`This deployment has no soul named ${shown(picked)}.`}</Note> : <SoulDetail soul={soul} oats={oats} />}
    </Page>
  );
}
