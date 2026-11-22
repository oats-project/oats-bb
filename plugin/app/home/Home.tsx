// The OATS home: what needs you, and what you have, on one screen. As the OATS Desktop's Home
// (packages/desktop/renderer/views/home.mjs): the agents that wait on the person, a summary line,
// the workspace's tiles, the agents at work, and Home › Agents, every agent OATS has. A full page
// (navPanel `home`, the phone's page and the target of "N need you") and, on desktop, the same view
// in a thread's fixed tab. Drawn with the patterns of app/ui.tsx.
//
// Answering is the person's act through bb's SDK: a choice bb offers, or a message sent as the
// person at the screen (bb's own send). The plugin never types into a session. While the roster
// shown is not a current one, those acts are held and the card says why.
import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { experimental_useTabVisible as useTabVisible, useBbNavigate, useSdk } from "@get-bb/plugin-sdk/app";
import type { BbNavigate, ExperimentalBadge, ExperimentalThreadTabProps, PluginNavPanelProps } from "@get-bb/plugin-sdk/app";
import { needsYouLabel } from "../format";
import { useOats } from "../oats";
import type { Oats } from "../oats";
import { useNow } from "../roster/now";
import { Unreadable } from "../roster/unreadable";
import { attempt, errorMessage, onWindowReset, useRead } from "../store";
import { Button, Card, DisabledReason, Empty, Field, INPUT, LINK, Loading, Notice, Page, Section, State, StatusLine, TARGET, plainClick } from "../ui";
import { refusalCode, shown } from "../ui/text";
import { instanceDisplayName, waitingLabel } from "../ui/words";
import { pageLinks } from "../workspace/pages";
import { forgetAgent, forgetAgents, getAgentTab, openAgentPage, rememberAgent, rememberedAgent } from "./agent-tab";
import { board } from "./board";
import type { Board, Entry } from "./board";
import {
  BACK_TO_HOME, EVERY_AGENT, FINISHED, FIRST_RUN, HELD, HOME, NEEDS_YOU, NEEDS_YOU_SHOWN, NOTHING_NEEDS_YOU, NOT_SENT, READING, SEND, SENDING, SHOW_FEWER, WORKING, WORKING_SHOWN,
  replyLabel, replyPlaceholder, sentTo, showAll, showAllWorking, soulAndMachine, startedBy, summaryLine, tileCount, tmuxNote,
} from "./home-words";
import { question } from "./interactions";
import type { Choice, Interaction, Question } from "./interactions";

/** The home's navigation badge: how many agents need the person. */
export function useHomeBadge(): ExperimentalBadge | null {
  const oats = useOats();
  const n = oats.phase === "ready" ? oats.view.needsYou.length : 0;
  return n === 0 ? null : { count: n, tone: "warning", label: needsYouLabel(n) };
}

onWindowReset(forgetAgents);

type Ready = Extract<Oats, { phase: "ready" }>;

/** Where an agent opens: its bb thread, or, for an agent with none (on tmux, or its thread gone), its own page. */
function useOpen(): (entry: Entry) => { href?: string; onClick(event: React.MouseEvent): void } {
  const navigate = useBbNavigate();
  const oats = useOats();
  return (entry) => {
    const thread = entry.thread === null || oats.phase === "failed" || oats.phase === "loading" ? undefined : oats.threadById.get(entry.thread.id);
    if (thread === undefined) return { onClick: () => void openAgentPage(navigate as BbNavigate, entry.agent.instance) };
    return {
      href: thread.href,
      onClick: (event) => {
        if (!plainClick(event)) return;
        event.preventDefault();
        navigate.toThread(thread.id);
      },
    };
  };
}

/** An agent's name as words, opening it: a link to its thread, or a button to its page. */
function AgentName({ entry, testId }: { entry: Entry; testId: string }) {
  const open = useOpen()(entry);
  const name = instanceDisplayName(shown(entry.agent.instance));
  const look = `${TARGET} ${LINK} inline-flex min-w-0 items-center break-words text-left font-semibold text-foreground`;
  return open.href === undefined ? (
    <button type="button" data-testid={testId} title={shown(entry.agent.instance)} className={look} onClick={open.onClick}>
      {name}
    </button>
  ) : (
    <a data-testid={testId} title={shown(entry.agent.instance)} className={look} href={open.href} onClick={open.onClick}>
      {name}
    </a>
  );
}

/** Where an agent with no bb thread is, in words. */
const elsewhere = (entry: Entry): string => (entry.agent.backend === "tmux" ? "Runs in tmux" : "Its bb thread is gone");

/**
 * One agent that needs the person: who, since when, what it asks; where bb lists choices, the
 * answer in place; and the reply to it, on its own card, named for the agent it goes to.
 */
function NeedsYouCard({ entry, oats, held }: { entry: Entry; oats: Ready; held: boolean }) {
  const sdk = useSdk();
  const open = useOpen()(entry);
  const thread = entry.thread === null ? undefined : oats.threadById.get(entry.thread.id);
  const name = instanceDisplayName(shown(entry.agent.instance));
  const [asked, setAsked] = useState<Question | null>(null);
  const [busy, setBusy] = useState<"answer" | "send" | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [said, setSaid] = useState<string | null>(null);
  const [text, setText] = useState("");
  const pending = thread?.hasPendingInteraction === true;
  const threadId = thread?.id;
  const updatedAt = thread?.updatedAt;

  useEffect(() => {
    if (!pending || threadId === undefined) {
      setAsked(null);
      return;
    }
    const controller = new AbortController();
    attempt(() => sdk.threads.interactions.list({ threadId, signal: controller.signal })).then(
      (list) => {
        if (!controller.signal.aborted) setAsked(question(list as readonly Interaction[]));
      },
      () => {
        // bb could not list them: the card keeps the claim's text and Open.
        if (!controller.signal.aborted) setAsked(null);
      },
    );
    return () => controller.abort();
  }, [sdk, threadId, pending, updatedAt]);

  const act = (kind: "answer" | "send", run: () => Promise<unknown>, done: () => void) => {
    if (busy !== null || held) return;
    setBusy(kind);
    setFailure(null);
    setSaid(null);
    attempt(run).then(
      () => {
        setBusy(null);
        done();
      },
      (cause: unknown) => {
        setBusy(null);
        setFailure(errorMessage(cause));
      },
    );
  };
  const answer = (choice: Choice) => {
    if (asked === null || threadId === undefined) return;
    const target = { threadId, interactionId: asked.interactionId };
    const { answer: how } = choice;
    act("answer", () => (how.via === "respond" ? sdk.threads.interactions.respond({ ...target, value: how.value }) : sdk.threads.interactions.resolve({ ...target, resolution: how.resolution })), () => setAsked(null));
  };
  const send = () => {
    const body = text.trim();
    if (body === "" || threadId === undefined) return;
    act("send", () => sdk.threads.send({ threadId, mode: "auto", input: [{ type: "text", text: body, mentions: [] }] }), () => {
      setText("");
      setSaid(sentTo(name));
    });
  };

  const claim = entry.agent.waiting;
  // What it asks: the agent's own message, else bb's title for its question, else the reason in words.
  const message = claim?.message ?? asked?.title ?? null;
  // What an in-place answer is about, when the line above is the kernel's claim and not bb's title.
  const detail = asked !== null && asked.choices.length > 0 && asked.title !== null && asked.title !== message ? asked.title : null;
  return (
    <li data-testid="oats-needs-card" data-instance={entry.agent.instance}>
      <Card testId="oats-needs-card-body">
        <div className="flex min-w-0 flex-col gap-0.5">
          <AgentName entry={entry} testId="oats-needs-name" />
          <span className="break-words text-xs text-muted-foreground">{soulAndMachine(oats.soulOf(entry.agent), oats.deployment.machine)}</span>
        </div>
        <StatusLine state={entry.status.state} since={entry.status.since} detail={message === null ? (claim === null ? entry.status.detail : waitingLabel(claim)) : null} />
        {message === null ? null : (
          <p data-testid="oats-needs-question" dir="auto" className="m-0 break-words text-foreground">
            {shown(message)}
          </p>
        )}
        {detail === null ? null : (
          <p data-testid="oats-needs-detail" dir="auto" className="m-0 break-words text-xs text-muted-foreground">
            {shown(detail)}
          </p>
        )}
        <div className="flex flex-wrap items-center gap-2">
          {(asked?.choices ?? []).map((choice, index) => (
            <Button key={index} data-testid="oats-needs-choice" disabled={busy !== null || held} onClick={() => answer(choice)}>
              {shown(choice.label)}
            </Button>
          ))}
          <Button data-testid="oats-needs-open" onClick={(event) => open.onClick(event)}>
            Open
          </Button>
        </div>
        {thread === undefined ? (
          // Nothing can be sent from bb to an agent that has no thread in it.
          <p data-testid="oats-needs-elsewhere" className="m-0 text-xs text-muted-foreground">
            {tmuxNote(elsewhere(entry))}
          </p>
        ) : (
          <form
            data-testid="oats-reply"
            className="flex min-w-0 flex-col gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              send();
            }}
          >
            <Field label={replyLabel(name)}>
              <textarea data-testid="oats-reply-text" rows={2} className={`${INPUT} py-2`} placeholder={replyPlaceholder(name)} value={text} disabled={busy !== null || held} onChange={(event) => setText(event.target.value)} />
            </Field>
            <div className="flex flex-wrap items-center gap-2">
              <Button type="submit" variant="primary" data-testid="oats-reply-send" disabled={busy !== null || held || text.trim() === ""}>
                {busy === "send" ? SENDING : SEND}
              </Button>
              {held ? <DisabledReason>{HELD}</DisabledReason> : null}
              {said === null ? null : (
                <span role="status" data-testid="oats-reply-sent" className="text-xs text-muted-foreground">
                  {said}
                </span>
              )}
            </div>
          </form>
        )}
        {failure === null ? null : <Notice title={NOT_SENT} tone="error" code={refusalCode(failure)} details={failure} />}
      </Card>
    </li>
  );
}

/** A list that shows its first `shown` and then offers the rest in place. */
function Cropped<Item>({ items, shown: most, more, testId, children }: { items: readonly Item[]; shown: number; more: (n: number) => string; testId: string; children: (item: Item) => ReactNode }) {
  const [all, setAll] = useState(false);
  const visible = all ? items : items.slice(0, most);
  return (
    <>
      <ul className="m-0 flex list-none flex-col gap-2 p-0">{visible.map(children)}</ul>
      {items.length <= most ? null : (
        <div>
          <Button data-testid={testId} aria-expanded={all} onClick={() => setAll(!all)}>
            {all ? SHOW_FEWER : more(items.length)}
          </Button>
        </div>
      )}
    </>
  );
}

/** One agent as a row: its name, its soul and machine, its state in words, and who started it. */
function AgentRow({ entry, oats, testId, startedByToo = false }: { entry: Entry; oats: Ready; testId: string; startedByToo?: boolean }) {
  const started = startedByToo ? startedBy(entry.agent) : null;
  return (
    <li data-testid={testId} data-instance={entry.agent.instance} className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-0.5 border-t border-border py-1 first:border-t-0">
      <span className="flex min-w-0 flex-1 flex-col">
        <AgentName entry={entry} testId="oats-home-agent" />
        <span className="break-words text-xs text-muted-foreground">
          {[soulAndMachine(oats.soulOf(entry.agent), oats.deployment.machine), entry.thread === null ? elsewhere(entry).toLowerCase() : null, started].filter((part) => part !== null).join(" · ")}
        </span>
      </span>
      <span className="shrink-0 text-sm">
        <State state={entry.status.state} />
      </span>
    </li>
  );
}

/** The workspace's tiles: Agents (Home › Agents) and the plugin's pages, each with its count. */
function Tiles({ made, visible, onAgents }: { made: Board; visible: boolean; onAgents: () => void }) {
  const navigate = useBbNavigate();
  const souls = useRead("souls", { enabled: visible });
  const capabilities = useRead("capabilities", { enabled: visible });
  const teams = useRead("teams", { enabled: visible });
  const machines = useRead("machines", { enabled: visible });
  const counted = (read: { status: string }, n: number | undefined): number | "loading" | "failed" => (read.status === "error" ? "failed" : n === undefined ? "loading" : n);
  const counts: Record<string, number | "loading" | "failed" | null> = {
    souls: counted(souls, souls.data?.souls.length),
    capabilities: counted(capabilities, capabilities.data?.capabilities.length),
    teams: counted(teams, teams.data?.teams.length),
    machines: counted(machines, machines.data?.machines.length),
  };
  const tile = "flex w-full min-w-0 flex-col items-start gap-0.5 rounded-md border border-border bg-card px-3 py-2 text-left hover:bg-accent";
  return (
    <ul data-testid="oats-home-tiles" className="m-0 grid list-none grid-cols-2 gap-2 p-0 md:grid-cols-3">
      <li>
        <button type="button" data-testid="oats-tile-agents" className={`${TARGET} ${tile}`} onClick={onAgents}>
          <span className="font-semibold text-foreground">Agents</span>
          <span className="text-xs text-muted-foreground">{tileCount(made.all.length)}</span>
        </button>
      </li>
      {pageLinks().map((page) => {
        const n = counts[page.path] ?? null;
        return (
          <li key={page.path}>
            <button type="button" data-testid={`oats-tile-${page.path}`} className={`${TARGET} ${tile}`} onClick={() => navigate.toPluginPanel(page.path)}>
              <span className="font-semibold text-foreground">{page.title}</span>
              {/* A page with nothing the home counts says no count. */}
              {n === null ? null : <span className="text-xs text-muted-foreground">{tileCount(n)}</span>}
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/** Home › Agents: every agent OATS has, in the sidebar's order. */
function EveryAgent({ made, oats, onBack }: { made: Board; oats: Ready; onBack: () => void }) {
  // Opened by a press that then leaves the screen: the keyboard goes on from the way back.
  const back = useRef<HTMLDivElement>(null);
  useEffect(() => back.current?.querySelector("button")?.focus(), []);
  return (
    <Section title={EVERY_AGENT} n={made.all.length} testId="oats-home-agents">
      <div ref={back}>
        <Button data-testid="oats-home-back" onClick={onBack}>
          {`‹ ${BACK_TO_HOME}`}
        </Button>
      </div>
      <p className="m-0 text-muted-foreground">{summaryLine(made.counts)}</p>
      <ul className="m-0 flex list-none flex-col p-0">
        {made.all.map((entry) => (
          <AgentRow key={entry.agent.instance} entry={entry} oats={oats} testId="oats-home-agent-row" startedByToo />
        ))}
      </ul>
    </Section>
  );
}

function Sections({ oats, visible, agents, onAgents, onBack }: { oats: Oats; visible: boolean; agents: boolean; onAgents: () => void; onBack: () => void }) {
  const now = useNow();
  const navigate = useBbNavigate();
  // The same words as the sidebar's, from the same components: what is read, what cannot be, and
  // (the roster kept as last read) how old what is shown is.
  if (oats.phase === "loading") return <Loading>{READING}</Loading>;
  if (oats.phase === "failed") return <Unreadable failure={oats} machine={oats.machine} onRetry={oats.retry} />;
  const made = board(oats.view, now);
  const held = oats.stale !== null;
  const stale = oats.stale === null ? null : <Unreadable failure={oats.stale} machine={oats.deployment.machine} at={oats.stale.at} now={now} onRetry={oats.retry} />;
  if (agents) {
    return (
      <>
        {stale}
        <EveryAgent made={made} oats={oats} onBack={onBack} />
      </>
    );
  }
  if (made.all.length === 0) {
    return (
      <>
        {stale}
        <Empty title={FIRST_RUN[0]} action={<Button variant="primary" data-testid="oats-home-new-agent" onClick={() => navigate.toPluginPanel("souls")}>New agent</Button>}>
          {FIRST_RUN[1]}
        </Empty>
        <Tiles made={made} visible={visible} onAgents={onAgents} />
      </>
    );
  }
  return (
    <>
      {stale}
      <Section title={NEEDS_YOU} n={made.needsYou.length} testId="oats-home-needs">
        {made.needsYou.length === 0 ? (
          <p data-testid="oats-home-nothing" className="m-0 text-muted-foreground">
            {NOTHING_NEEDS_YOU}
          </p>
        ) : (
          <Cropped items={made.needsYou} shown={NEEDS_YOU_SHOWN} more={showAll} testId="oats-home-needs-all">
            {(entry) => <NeedsYouCard key={entry.agent.instance} entry={entry} oats={oats} held={held} />}
          </Cropped>
        )}
      </Section>
      <p data-testid="oats-home-summary" className="m-0 text-muted-foreground">
        {summaryLine(made.counts)}
      </p>
      <Tiles made={made} visible={visible} onAgents={onAgents} />
      {made.working.length === 0 ? null : (
        <Section title={WORKING} n={made.working.length} testId="oats-home-working">
          <Cropped items={made.working} shown={WORKING_SHOWN} more={showAllWorking} testId="oats-home-working-all">
            {(entry) => <AgentRow key={entry.agent.instance} entry={entry} oats={oats} testId="oats-working-row" />}
          </Cropped>
        </Section>
      )}
      {made.finished.length === 0 ? null : (
        <Section title={FINISHED} n={made.finished.length} testId="oats-home-finished">
          <ul className="m-0 flex list-none flex-col p-0">
            {made.finished.map((entry) => (
              <AgentRow key={entry.agent.instance} entry={entry} oats={oats} testId="oats-finished-row" />
            ))}
          </ul>
        </Section>
      )}
    </>
  );
}

/** The sub-path of Home › Agents on the home's page. */
const AGENTS = "agents";

/** The full page: the phone's home, and where "N need you" leads. `/plugins/oats/home/agents` is Home › Agents. */
export function HomePage({ subPath }: PluginNavPanelProps) {
  const oats = useOats();
  const navigate = useBbNavigate();
  const agents = subPath.split("/").find((segment) => segment !== "") === AGENTS;
  return (
    <Page testId="oats-home-page">
      <h1 data-testid="oats-home-title" className="m-0 text-lg font-semibold text-foreground">
        {HOME}
      </h1>
      <Sections oats={oats} visible agents={agents} onAgents={() => navigate.toPluginPanel("home", { subPath: AGENTS })} onBack={() => navigate.toPluginPanel("home")} />
    </Page>
  );
}

/**
 * The same view in a thread's fixed side-panel tab, on desktop. On an agent's own thread it is that
 * agent's view instead, when a feature named one (agent-tab.ts).
 */
export function HomeTab({ threadId }: ExperimentalThreadTabProps) {
  const oats = useOats();
  const visible = useTabVisible();
  // In the tab, Home › Agents is a view of the tab itself: it has no address of its own.
  const [agents, setAgents] = useState(false);
  const AgentTab = getAgentTab();
  if (AgentTab !== null) {
    if (oats.phase === "ready") {
      const node = oats.nodeByThread.get(threadId);
      if (node !== undefined) {
        rememberAgent(threadId, node.agent);
        return <AgentTab agent={node.agent} threadId={threadId} />;
      }
      // The roster was read and names no agent on this thread (it was retired, or the deployment
      // changed): what the tab remembered of it is forgotten.
      forgetAgent(threadId);
    } else {
      // The roster cannot be read now: the agent this thread was keeps its view (agent-tab.ts).
      const last = rememberedAgent(threadId);
      if (last !== undefined) return <AgentTab agent={last} threadId={threadId} />;
    }
  }
  return (
    <div data-testid="oats-home-tab" className="flex h-full min-h-0 flex-col gap-4 overflow-y-auto p-3 text-sm text-foreground">
      <Sections oats={oats} visible={visible} agents={agents} onAgents={() => setAgents(true)} onBack={() => setAgents(false)} />
    </div>
  );
}
