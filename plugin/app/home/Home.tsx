// The OATS home: what needs you, and what you have, on one screen. As the OATS Desktop's Home
// (packages/desktop/renderer/views/home.mjs): the agents that wait on the person, a summary line,
// the workspace's tiles, the agents at work, and Home › Agents, every agent OATS has. A full page
// (navPanel `home`, the phone's page and the target of "N need you") and, on desktop, the same view
// in a thread's fixed tab. Drawn with the patterns of app/ui.tsx.
//
// Answering is the person's act through bb's SDK: a choice bb offers, or a message sent as the
// person at the screen (bb's own send). The plugin never types into a session. While the roster
// shown is not a current one, those acts are held and the card says why.
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { experimental_useTabVisible as useTabVisible, useBbNavigate, useRpc, useSdk } from "@get-bb/plugin-sdk/app";
import type { BbNavigate, ExperimentalBadge, ExperimentalThreadTabProps, PluginNavPanelProps } from "@get-bb/plugin-sdk/app";
import { needsYouLabel } from "../format";
import type { rpcContract } from "../../contract";
import { claimOf } from "../../model/view";
import { ACTS, openAct } from "../lifecycle";
import { firstLine, useOats } from "../oats";
import type { Oats } from "../oats";
import { DESKTOP_API, OATS_FLOOR, OATS_TESTED_MINOR } from "../../kernel/compat";
import { lineParts, outsideOf, OutsideWarning } from "../outside";
import { useNow } from "../roster/now";
import { RosterNotice } from "../roster/unreadable";
import { attempt, errorMessage, onWindowReset, useRead } from "../store";
import { Button, Card, Code, CopyButton, DisabledReason, Disclosure, Empty, Fact, Facts, INPUT, LINK, Loading, Mark, Notice, Page, Section, State, StatusLine, TARGET, plainClick } from "../ui";
import { refusalCode, shown } from "../ui/text";
import { agentName, waitingLabel } from "../ui/words";
import { CommandText } from "../panel/parts";
import { attachCommand } from "../panel/words";
import { hasNewAgent, openNewAgent, pageLinks, usePagesShown } from "../workspace/pages";
import type { PageLink } from "../workspace/pages";
import { forgetAgent, forgetAgents, getAgentTab, openAgentPage, rememberAgent, rememberedAgent } from "./agent-tab";
import { board, mayAnswer, notRunning } from "./board";
import { useCli } from "./cli";
import type { Cli } from "./cli";
import type { Board, Entry } from "./board";
import {
  BACK_TO_HOME, CHECKING, CHECK_AGAIN, CHECK_FAILED, CLI_NEWER_API, CLI_REQUIRED, CLI_UNCHECKED, CLI_REQUIRED_WHY, DETECTED, EVERY_AGENT, FINISHED, FIRST_RUN, HELD, HOME, IN_THREAD, MESSAGE_INSTEAD, MESSAGE_NOT_ANSWER, NEEDS_YOU, NEEDS_YOU_SHOWN, NEW_AGENT_HELD,
  NOTHING_NEEDS_YOU, NOT_ANSWERED, NOT_NOW_GONE, NOT_NOW_STOPPED, NOT_NOW_UNREAD, NOT_SENT, OPEN_PAGE, OPEN_THREAD, PAGE_LEADS, PERMISSION_IN_THREAD, READING, REQUIRED, SEND, SENDING, SHOW_FEWER, STOPPED_WAITS, THREAD_GONE, WORKING, WORKING_SHOWN,
  answeredWith, detected, installCommand, newerApiWhy, replyLabel, replyPlaceholder, required, sentTo, showAll, showAllWorking, soulAndMachine, startedBy, summaryLine, testedWhy, tileCount, tmuxWhere,
} from "./home-words";
import { question } from "./interactions";
import type { Choice, Interaction, Question } from "./interactions";

/** The home's navigation badge: how many agents need the person, the ones with no bb thread among them: the sidebar's own count (`view.needing`). */
export function useHomeBadge(): ExperimentalBadge | null {
  const oats = useOats();
  const n = oats.phase === "ready" ? oats.view.needing.length : 0;
  return n === 0 ? null : { count: n, tone: "warning", label: needsYouLabel(n) };
}

onWindowReset(forgetAgents);

type Ready = Extract<Oats, { phase: "ready" }>;

/**
 * Where an agent opens: its bb thread, or, for an agent with none (on tmux, or its thread gone), its
 * own page. The roster comes from the one `useOats` of the view: a second call would read it again.
 */
function useOpen(oats: Ready): (entry: Entry) => { href?: string; onClick(event: React.MouseEvent): void } {
  const navigate = useBbNavigate();
  return (entry) => {
    const thread = entry.thread === null ? undefined : oats.threadById.get(entry.thread.id);
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
function AgentName({ entry, oats, testId }: { entry: Entry; oats: Ready; testId: string }) {
  const open = useOpen(oats)(entry);
  const name = agentName(entry.agent.instance);
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

/** The lifecycle's own word for the act that starts an agent ("Start…": it opens that act's dialog). */
const START = ACTS.find((each) => each.verb === "start")!.button;

/** How a card is answered: what the agent asks decides what the card offers (`offer`, below). */
type Offer = "stopped" | "choices" | "in-thread" | "reply" | "elsewhere";

/** The reply to one agent: one line that grows with its text, Send beside it, on that agent's card. */
function Reply({ name, text, onText, busy, held, said, onSend }: { name: string; text: string; onText: (text: string) => void; busy: boolean; held: boolean; said: string | null; onSend: () => void }) {
  const box = useRef<HTMLTextAreaElement>(null);
  // The box is as high as what is written in it: every line of what will be sent is in view. It is
  // measured when its text changes, and when its own width does (the window's, or a fold around it
  // that is opened: a box inside a closed fold has no width to be measured by).
  useLayoutEffect(() => {
    const element = box.current;
    if (element === null) return;
    const measure = () => {
      element.style.height = "auto";
      // `height` is of the box with its border: what the text needs, and the border around it.
      if (element.scrollHeight > 0) element.style.height = `${element.scrollHeight + (element.offsetHeight - element.clientHeight)}px`;
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    let width = element.clientWidth;
    const watch = new ResizeObserver(() => {
      if (element.clientWidth === width) return;
      width = element.clientWidth;
      measure();
    });
    watch.observe(element);
    return () => watch.disconnect();
  }, [text]);
  return (
    <form
      data-testid="oats-reply"
      className="flex min-w-0 flex-col gap-1"
      onSubmit={(event) => {
        event.preventDefault();
        onSend();
      }}
    >
      <div className="flex min-w-0 items-end gap-2">
        <textarea
          ref={box}
          data-testid="oats-reply-text"
          aria-label={replyLabel(name)}
          rows={1}
          className={`${INPUT} min-w-0 flex-1 resize-none overflow-hidden py-2`}
          placeholder={replyPlaceholder(name)}
          value={text}
          disabled={busy || held}
          onChange={(event) => onText(event.target.value)}
        />
        <Button type="submit" variant="primary" data-testid="oats-reply-send" disabled={busy || held || text.trim() === ""}>
          {busy ? SENDING : SEND}
        </Button>
      </div>
      {held ? <DisabledReason>{HELD}</DisabledReason> : null}
      {said === null ? null : (
        <span role="status" data-testid="oats-reply-sent" className="text-xs text-muted-foreground">
          {said}
        </span>
      )}
    </form>
  );
}

/**
 * One agent that needs the person: who, since when, what it asks, and the answer its request takes.
 *
 * What it asks decides what the card offers (the lead's ruling on the home's UX read):
 * - bb lists choices for its request (a confirmation, a selection, an approval, a question with
 *   options): the choices are the answer, as buttons;
 * - its request is one the card cannot answer (bb shows it in the thread in a form of its own, or
 *   the kernel says it waits for a tool approval and bb lists none to answer): the answer is in
 *   its thread, and the card says so and opens it;
 * - it asks in its own words (a question, its attention): the reply, on its card, named for it;
 * - it has no thread in bb: where to answer it, to copy;
 * - the kernel says it does not run (and it needs the person by bb's request, or by a claim it still
 *   carries): no answer and no message (either would start it outside OATS): that it is not
 *   running, and Start.
 * Beside choices or a request answered in the thread, a message is not offered as an equal: it is
 * behind "Write a message instead", with what a message does not do.
 */
/**
 * The card of an agent that runs outside OATS (app/outside: OATS recorded it stopped, and the
 * kernel reports its harness running). It needs the person, and not for an answer: the card holds
 * that feature's notice, with its Stop and Start (the lifecycle's own dialogs), and the way to its
 * thread. No choice and no reply: a message is what put it outside OATS.
 */
function OutsideCard({ entry, oats, held }: { entry: Entry; oats: Ready; held: boolean }) {
  const open = useOpen(oats)(entry);
  const name = agentName(entry.agent.instance);
  const said = outsideOf(oats).of(entry.agent);
  const paged = entry.thread === null || !oats.threadById.has(entry.thread.id);
  return (
    <li data-testid="oats-needs-card" data-instance={entry.agent.instance} data-offer="outside">
      <Card testId="oats-needs-card-body">
        <div className="flex min-w-0 items-start justify-between gap-2">
          <div className="flex min-w-0 flex-col gap-0.5">
            <AgentName entry={entry} oats={oats} testId="oats-needs-name" />
            <span className="break-words text-xs text-muted-foreground">{soulAndMachine(oats.soulOf(entry.agent), oats.deployment.machine)}</span>
          </div>
          <Button data-testid="oats-needs-open" aria-label={`${paged ? OPEN_PAGE : OPEN_THREAD}: ${name}`} onClick={(event) => open.onClick(event)}>
            {paged ? OPEN_PAGE : OPEN_THREAD}
          </Button>
        </div>
        <StatusLine state={entry.status.state} {...lineParts(said, entry.status)} />
        <OutsideWarning said={said} instance={entry.agent.instance} held={held} />
      </Card>
    </li>
  );
}

function NeedsYouCard({ entry, oats, held }: { entry: Entry; oats: Ready; held: boolean }) {
  const sdk = useSdk();
  const rpc = useRpc<typeof rpcContract>();
  const open = useOpen(oats)(entry);
  const thread = entry.thread === null ? undefined : oats.threadById.get(entry.thread.id);
  const name = agentName(entry.agent.instance);
  const [asked, setAsked] = useState<Question | null>(null);
  const [busy, setBusy] = useState<"answer" | "send" | null>(null);
  const [failure, setFailure] = useState<{ kind: "answer" | "send"; message: string } | null>(null);
  const [said, setSaid] = useState<string | null>(null);
  /** The choice pressed, once bb took it: said on the card until the agent goes on, or asks again. */
  const [answered, setAnswered] = useState<{ interactionId: string; label: string; under: string } | null>(null);
  const [text, setText] = useState("");
  const pending = thread?.hasPendingInteraction === true;
  const threadId = thread?.id;
  const updatedAt = thread?.updatedAt;
  // The claim through the one gate (`claimOf`): an agent OATS says is stopped may still carry a claim, which is then no question of now.
  const claim = claimOf(entry.agent);
  /** Which claim the card shows: its instant and its text. A change of it is the agent asking again. */
  const claimKey = claim === null ? "" : `${claim.since ?? ""} ${claim.reason} ${claim.message ?? ""}`;
  // It asks again by a claim of its own (no request of bb's): what was answered before is no longer what the card is about.
  useEffect(() => {
    setAnswered((last) => (last !== null && last.under !== claimKey && claimKey !== "" ? null : last));
  }, [claimKey]);

  useEffect(() => {
    if (!pending || threadId === undefined) {
      setAsked(null);
      return;
    }
    const controller = new AbortController();
    attempt(() => sdk.threads.interactions.list({ threadId, signal: controller.signal })).then(
      (list) => {
        if (controller.signal.aborted) return;
        const next = question(list as readonly Interaction[]);
        setAsked(next);
        // It asks again: what was answered before is no longer what the card is about.
        if (next !== null) setAnswered((last) => (last !== null && last.interactionId !== next.interactionId ? null : last));
      },
      () => {
        // bb could not list them: the card keeps the claim's text and Open.
        if (!controller.signal.aborted) setAsked(null);
      },
    );
    return () => controller.abort();
  }, [sdk, threadId, pending, updatedAt]);

  /**
   * Answers a request, or sends a message, to the agent's thread: only to an agent that runs. What
   * is drawn holds that for the roster this card was drawn from (a card of an agent that does not
   * run mounts no choice and no reply); the press asks once more, of the roster the plugin's server
   * holds at that moment, so that an agent OATS stopped since the card was drawn is not started by
   * the press. Nothing goes to bb unless that roster reads and says the agent runs.
   */
  const act = (kind: "answer" | "send", run: () => Promise<unknown>, done: () => void) => {
    if (busy !== null || !mayAnswer(entry.agent, held)) return;
    setBusy(kind);
    setFailure(null);
    setSaid(null);
    attempt(async () => {
      const now = await rpc.call("snapshot", null);
      if (!now.ok) throw new Error(NOT_NOW_UNREAD);
      const agent = now.agents.find((each) => each.instance === entry.agent.instance);
      if (agent === undefined) throw new Error(NOT_NOW_GONE);
      if (notRunning(agent)) throw new Error(NOT_NOW_STOPPED);
      return run();
    }).then(
      () => {
        setBusy(null);
        done();
      },
      (cause: unknown) => {
        setBusy(null);
        setFailure({ kind, message: errorMessage(cause) });
      },
    );
  };
  const answer = (choice: Choice) => {
    if (asked === null || threadId === undefined) return;
    const target = { threadId, interactionId: asked.interactionId };
    const { answer: how } = choice;
    act("answer", () => (how.via === "respond" ? sdk.threads.interactions.respond({ ...target, value: how.value }) : sdk.threads.interactions.resolve({ ...target, resolution: how.resolution })), () => {
      setAnswered({ interactionId: target.interactionId, label: choice.label, under: claimKey });
      setAsked(null);
    });
  };
  const send = () => {
    const body = text.trim();
    if (body === "" || threadId === undefined) return;
    act("send", () => sdk.threads.send({ threadId, mode: "auto", input: [{ type: "text", text: body, mentions: [] }] }), () => {
      setText("");
      setSaid(sentTo(name));
    });
  };

  // What it asks: the agent's own message, else bb's title for its question, else the reason in words.
  const message = claim?.message ?? asked?.title ?? null;
  // What an in-place answer is about, when the line above is the kernel's claim and not bb's title.
  const detail = asked !== null && asked.choices.length > 0 && asked.title !== null && asked.title !== message ? asked.title : null;
  // The kernel says the agent does not run (it is stopped, or its session ended), and it needs the
  // person all the same (bb still holds a request on its thread, or it still carries its claim): an
  // answer or a message to its thread would start its harness again behind OATS's back (a stopped
  // agent stays stopped). The card then offers neither: it says so, and offers Start, the
  // lifecycle's own act, which starts it through OATS.
  const stopped = notRunning(entry.agent);
  const offer: Offer =
    thread === undefined ? "elsewhere" : stopped ? "stopped" : asked !== null && asked.choices.length > 0 ? "choices" : pending || claim?.reason === "permission" ? "in-thread" : "reply";
  const reply = <Reply name={name} text={text} onText={setText} busy={busy !== null} held={held} said={said} onSend={send} />;
  // A message beside a request that has an answer of its own: behind a fold, after what a message does not do.
  const instead = (
    <Disclosure summary={MESSAGE_INSTEAD} testId="oats-needs-message">
      <p className="m-0 text-xs text-muted-foreground">{MESSAGE_NOT_ANSWER}</p>
      {reply}
    </Disclosure>
  );
  const where = entry.thread === null ? elsewhere(entry) : null;
  return (
    <li data-testid="oats-needs-card" data-instance={entry.agent.instance} data-offer={offer === "stopped" || answered === null ? offer : "answered"}>
      <Card testId="oats-needs-card-body">
        <div className="flex min-w-0 items-start justify-between gap-2">
          <div className="flex min-w-0 flex-col gap-0.5">
            <AgentName entry={entry} oats={oats} testId="oats-needs-name" />
            <span className="break-words text-xs text-muted-foreground">{[soulAndMachine(oats.soulOf(entry.agent), oats.deployment.machine), where === null ? null : where.toLowerCase()].filter((part) => part !== null).join(" · ")}</span>
          </div>
          {/* The button says where it leads: the agent's thread, or, for an agent with none, its own page. */}
          <Button data-testid="oats-needs-open" aria-label={`${thread === undefined ? OPEN_PAGE : OPEN_THREAD}: ${name}`} onClick={(event) => open.onClick(event)}>
            {thread === undefined ? OPEN_PAGE : OPEN_THREAD}
          </Button>
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
        {offer === "stopped" ? (
          <div data-testid="oats-needs-stopped" className="flex min-w-0 flex-col gap-2">
            <p className="m-0 text-xs text-muted-foreground">{STOPPED_WAITS}</p>
            <div className="flex flex-wrap items-center gap-2">
              <Button data-testid="oats-needs-start" disabled={held} onClick={() => openAct("start", entry.agent.instance)}>
                {START}
              </Button>
              {held ? <DisabledReason>{HELD}</DisabledReason> : null}
            </div>
          </div>
        ) : answered !== null ? (
          // A choice was pressed and bb took it: said here until the agent goes on (its card then leaves) or asks again.
          <p role="status" data-testid="oats-needs-answered" className="m-0 text-muted-foreground">
            {answeredWith(shown(answered.label))}
          </p>
        ) : offer === "choices" ? (
          <>
            <div className="flex flex-wrap items-center gap-2">
              {(asked?.choices ?? []).map((choice, index) => (
                <Button key={index} data-testid="oats-needs-choice" disabled={busy !== null || held} onClick={() => answer(choice)}>
                  {shown(choice.label)}
                </Button>
              ))}
              {held ? <DisabledReason>{HELD}</DisabledReason> : null}
            </div>
            {instead}
          </>
        ) : offer === "in-thread" ? (
          <>
            <p data-testid="oats-needs-in-thread" className="m-0 text-xs text-muted-foreground">
              {pending ? IN_THREAD : PERMISSION_IN_THREAD}
            </p>
            {instead}
          </>
        ) : offer === "reply" ? (
          reply
        ) : (
          // Nothing can be sent from bb to an agent that has no thread in it: where to answer it, to copy.
          <div data-testid="oats-needs-elsewhere" className="flex min-w-0 flex-col gap-1 text-xs text-muted-foreground">
            {entry.agent.backend === "tmux" ? (
              <>
                <p className="m-0">{tmuxWhere(shown(oats.deployment.machine))}</p>
                <p className="m-0 flex min-w-0 flex-wrap items-center gap-2">
                  <CommandText command={attachCommand(entry.agent.home)} />
                  <CopyButton text={attachCommand(entry.agent.home)} name="Copy the command" />
                </p>
              </>
            ) : (
              <p className="m-0">{THREAD_GONE}</p>
            )}
            <p className="m-0">{PAGE_LEADS}</p>
          </div>
        )}
        {failure === null ? null : <Notice title={failure.kind === "send" ? NOT_SENT : NOT_ANSWERED} tone="error" code={refusalCode(failure.message)} details={failure.message} />}
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
        <AgentName entry={entry} oats={oats} testId="oats-home-agent" />
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

/** The mark a page's feature gives it (Automations, while a run failed). Its own component: the feature's hook reads, so it is drawn only while the home is seen. */
function PageMark({ useMark }: { useMark: NonNullable<PageLink["useMark"]> }) {
  const mark = useMark();
  return mark === null ? null : <Mark label={mark.label} />;
}

/** One page's tile: its title, its feature's mark, and its count where the home counts it. */
function PageTile({ page, n, look, visible, onOpen }: { page: PageLink; n: number | "loading" | "failed" | null; look: string; visible: boolean; onOpen: () => void }) {
  return (
    <li>
      <button type="button" data-testid={`oats-tile-${page.path}`} className={look} onClick={onOpen}>
        <span className="inline-flex items-center gap-1.5 font-semibold text-foreground">
          {page.title}
          {page.useMark === undefined || !visible ? null : <PageMark useMark={page.useMark} />}
        </span>
        {/* A page with nothing the home counts says no count. */}
        {n === null ? null : <span className="text-xs text-muted-foreground">{tileCount(n)}</span>}
      </button>
    </li>
  );
}

/** The workspace's tiles: Agents (Home › Agents) and the plugin's pages, each with its count. */
function Tiles({ made, visible, onAgents }: { made: Board; visible: boolean; onAgents: () => void }) {
  const navigate = useBbNavigate();
  // A tile leads to a page: only the pages this release shows have one, and only their counts are read.
  const pages = usePagesShown();
  const souls = useRead("souls", { enabled: visible && pages.has("souls") });
  const capabilities = useRead("capabilities", { enabled: visible && pages.has("capabilities") });
  const teams = useRead("teams", { enabled: visible && pages.has("teams") });
  const machines = useRead("machines", { enabled: visible && pages.has("machines") });
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
      {pageLinks().filter((page) => pages.has(page.path)).map((page) => (
        <PageTile key={page.path} page={page} n={counts[page.path] ?? null} look={`${TARGET} ${tile}`} visible={visible} onOpen={() => navigate.toPluginPanel(page.path)} />
      ))}
    </ul>
  );
}

/** Home › Agents: every agent OATS has, in the sidebar's order. */
function EveryAgent({ made, oats, onBack }: { made: Board; oats: Ready; onBack: () => void }) {
  // Opened by a press that then leaves the screen: the keyboard goes on from the way back.
  const back = useRef<HTMLDivElement>(null);
  useEffect(() => back.current?.querySelector("button")?.focus(), []);
  // Esc returns, as on the Desktop; a key meant for something else (a dialog of bb's over the page) is left to it.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      if (!(event.target instanceof Node) || !back.current?.closest("section")?.contains(event.target)) return;
      event.preventDefault();
      onBack();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onBack]);
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


/**
 * Where the installed `oats` stands against what the plugin is built for (D-004, D-007, D-008), on
 * the home only: a card while it is older than the plugin works with or its version cannot be
 * read (what was detected, what is required, the command to copy), a card with no command while it
 * speaks a later version of its answers than the plugin reads, one line while it is of a later
 * minor than the plugin was tested with. Nothing for a tested one, and nothing while the read is
 * out. A version that could not be read at all (the read failed, and the home's one more try with
 * it): one muted line that says so, with Check again. OATS that cannot be run at all is the
 * roster's notice.
 */
function CliNotice({ cli, checking, failure, unchecked, onCheck }: { cli: Cli | undefined; checking: boolean; failure: string | null; unchecked: boolean; onCheck: () => void }) {
  // No version was ever read, twice over, while the roster reads: said in one line, with the way to
  // ask again. New agent stays on: the kernel refuses a spawn it cannot make.
  if (cli === undefined && unchecked) {
    return (
      <div data-testid="oats-home-cli-unchecked" className="flex flex-wrap items-center gap-2 text-muted-foreground">
        <span>{CLI_UNCHECKED}</span>
        <Button data-testid="oats-home-cli-retry" disabled={checking} onClick={onCheck}>
          {checking ? CHECKING : CHECK_AGAIN}
        </Button>
      </div>
    );
  }
  if (cli === undefined || cli.state === "tested") return null;
  // A check that failed leaves the notice as it was, and says so: a press is never silent.
  const failed =
    failure === null || checking ? null : (
      <p role="status" data-testid="oats-home-cli-check-failed" className="m-0 text-xs text-muted-foreground">
        {`${CHECK_FAILED} ${shown(firstLine(failure))}`}
      </p>
    );
  // After an install the person asks again: the server reads `oats version` anew, and the notice follows it.
  const again = (
    <Button data-testid="oats-home-cli-retry" disabled={checking} onClick={onCheck}>
      {checking ? CHECKING : CHECK_AGAIN}
    </Button>
  );
  if (cli.state === "newer") {
    return (
      <div data-testid="oats-home-cli-line" className="flex flex-wrap items-center gap-2 text-muted-foreground">
        <span>{testedWhy(OATS_TESTED_MINOR, shown(cli.version ?? ""))}</span>
        {again}
        {failed}
      </div>
    );
  }
  const facts = (
    <Facts>
      <Fact label={DETECTED}>{detected(cli.version === null ? null : shown(cli.version))}</Fact>
      <Fact label={REQUIRED}>{required(OATS_FLOOR, DESKTOP_API)}</Fact>
    </Facts>
  );
  if (cli.state === "newer-api") {
    return (
      <div data-testid="oats-home-cli" data-state={cli.state}>
        <Notice title={CLI_NEWER_API} tone="warning" actions={again}>
          <p className="m-0">{newerApiWhy(cli.version === null ? null : shown(cli.version), cli.desktopApi, DESKTOP_API)}</p>
          {facts}
          {failed}
        </Notice>
      </div>
    );
  }
  const command = installCommand(OATS_TESTED_MINOR);
  return (
    <div data-testid="oats-home-cli" data-state={cli.state}>
      <Notice
        title={CLI_REQUIRED}
        tone="warning"
        actions={
          <>
            <CopyButton text={command} name="Copy install command" />
            {again}
          </>
        }
      >
        <p className="m-0">{CLI_REQUIRED_WHY}</p>
        {facts}
        <p className="m-0">
          <Code>{command}</Code>
        </p>
        {failed}
      </Notice>
    </div>
  );
}

function Sections({ oats, visible, agents, title, onAgents, onBack }: { oats: Oats; visible: boolean; agents: boolean; /** the page's own heading (the tab has bb's) */ title: boolean; onAgents: () => void; onBack: () => void }) {
  const now = useNow();
  const navigate = useBbNavigate();
  const pages = usePagesShown();
  // Read once the home is seen (once more by itself when that failed and the roster reads), and again when the person asks: the installed CLI changes with an install, not with what the agents do.
  const { cli, checking, failure: checkFailure, unchecked, check } = useCli(visible, oats.phase === "ready");
  const notice = <CliNotice cli={cli} checking={checking} failure={checkFailure} unchecked={unchecked} onCheck={check} />;
  // Behind the card New agent is off: a spawn through a CLI the plugin does not work with is not offered.
  const incompatible = cli !== undefined && (cli.state === "older" || cli.state === "unknown" || cli.state === "newer-api");
  // The same words as the sidebar's, from the same components: what is read, what cannot be, and
  // (the roster kept as last read) how old what is shown is.
  const heading = title ? (
    <h1 data-testid="oats-home-title" className="m-0 text-lg font-semibold text-foreground">
      {HOME}
    </h1>
  ) : null;
  if (oats.phase === "loading" || oats.phase === "failed") {
    return (
      <>
        {heading}
        {oats.phase === "loading" ? <Loading>{READING}</Loading> : <RosterNotice oats={oats} />}
      </>
    );
  }
  const made = board(oats.view, now);
  const held = oats.stale !== null;
  // New agent is on every home, in the heading's row (the Desktop's Home has none: its act is the
  // sidebar's, which bb keeps in a drawer at a phone's width). Offered where it has somewhere to
  // open (the sidebar's rule); off, with why beside it, behind the CLI card and while the roster
  // shown is the last one read. On the home of a workspace with no agent it is the one act.
  const offWhy = incompatible ? NEW_AGENT_HELD : held ? HELD : null;
  const head = (
    <div data-testid="oats-home-head" className="flex min-w-0 flex-wrap items-center justify-between gap-2">
      {heading ?? <span />}
      {hasNewAgent(pages.has("souls")) ? (
        <span className="flex min-w-0 flex-wrap items-center justify-end gap-2">
          {offWhy === null ? null : <DisabledReason>{offWhy}</DisabledReason>}
          <Button variant={made.all.length === 0 ? "primary" : "default"} data-testid="oats-home-new-agent" disabled={offWhy !== null} onClick={() => void openNewAgent(navigate as BbNavigate, pages.has("souls"))}>
            New agent
          </Button>
        </span>
      ) : null}
    </div>
  );
  // The one Stale drawing, the roster's: nothing while the roster is the one just read.
  const stale = <RosterNotice oats={oats} />;
  if (agents) {
    return (
      <>
        {head}
        {stale}
        <EveryAgent made={made} oats={oats} onBack={onBack} />
      </>
    );
  }
  if (made.all.length === 0) {
    return (
      <>
        {head}
        {stale}
        {notice}
        <Empty title={FIRST_RUN[0]}>{FIRST_RUN[1]}</Empty>
        <Tiles made={made} visible={visible} onAgents={onAgents} />
      </>
    );
  }
  return (
    <>
      {head}
      {stale}
      {notice}
      <Section title={NEEDS_YOU} n={made.needsYou.length} testId="oats-home-needs">
        {made.needsYou.length === 0 ? (
          <p data-testid="oats-home-nothing" className="m-0 text-muted-foreground">
            {NOTHING_NEEDS_YOU}
          </p>
        ) : (
          <Cropped items={made.needsYou} shown={NEEDS_YOU_SHOWN} more={showAll} testId="oats-home-needs-all">
            {(entry) => (entry.status.state === "outside" ? <OutsideCard key={entry.agent.instance} entry={entry} oats={oats} held={held} /> : <NeedsYouCard key={entry.agent.instance} entry={entry} oats={oats} held={held} />)}
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
      <Sections oats={oats} visible title agents={agents} onAgents={() => navigate.toPluginPanel("home", { subPath: AGENTS })} onBack={() => navigate.toPluginPanel("home")} />
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
  const ready = oats.phase === "ready";
  const node = AgentTab !== null && oats.phase === "ready" ? oats.nodeByThread.get(threadId) : undefined;
  // What the tab remembers of the agent on this thread is noted after the drawing: the agent the
  // roster names there, or, once the roster was read and names none (it was retired, or the
  // deployment changed), nothing.
  useEffect(() => {
    if (AgentTab === null || !ready) return;
    if (node !== undefined) rememberAgent(threadId, node.agent);
    else forgetAgent(threadId);
  }, [AgentTab, ready, node, threadId]);
  if (AgentTab !== null) {
    if (ready) {
      if (node !== undefined) return <AgentTab agent={node.agent} threadId={threadId} />;
    } else {
      // The roster cannot be read now: the agent this thread was keeps its view (agent-tab.ts).
      const last = rememberedAgent(threadId);
      if (last !== undefined) return <AgentTab agent={last} threadId={threadId} />;
    }
  }
  return (
    <div data-testid="oats-home-tab" className="flex h-full min-h-0 flex-col gap-4 overflow-y-auto p-3 text-sm text-foreground">
      <Sections oats={oats} visible={visible} title={false} agents={agents} onAgents={() => setAgents(true)} onBack={() => setAgents(false)} />
    </div>
  );
}
