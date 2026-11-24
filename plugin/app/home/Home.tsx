// The OATS home: what needs you, and what you have, on one screen. As the OATS Desktop's Home
// (packages/desktop/renderer/views/home.mjs): the agents that wait on the person, the tiles of the
// pages that are shown, the agents at work, and Home › Agents, every agent OATS has, with the one
// count line (reached by its address alone). A full page
// (navPanel `home`, the phone's page, where bb's badge on the plugin's entry leads) and, on desktop, the same view
// in a thread's fixed tab. Drawn with the patterns of app/ui.tsx.
//
// Answering is the person's act through bb's SDK: a choice bb offers, or a message sent as the
// person at the screen (bb's own send). The plugin never types into a session. While the roster
// shown is not a current one, those acts are held (drawn off), and the notice over the page says why.
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
import { OATS_FLOOR, OATS_TESTED_MINOR } from "../../kernel/compat";
import { lineActs, lineParts, LOST_WORD, outsideOf, OutsideWarning, rowParts, rowWords } from "../outside";
import { useNow } from "../roster/now";
import { messageResumes } from "../../model/rest";
import { READING as READING_WORD, useReading } from "../roster/reading";
import { LastObservation, RosterNotice, useLineShowsNotice } from "../roster/unreadable";
import { attempt, errorMessage, onWindowReset, useRead } from "../store";
import { TMUX } from "../ui";
import { RowFacts } from "../ui/row-facts";
import { Button, Card, Code, CopyButton, Disclosure, Empty, Fact, Facts, INPUT, Loading, Mark, Notice, Page, Section, State, StatusLine, TARGET, plainClick } from "../ui";
import { refusalLines, shown } from "../ui/text";
import { agentName, waitingLabel } from "../ui/words";
import { hasNewAgent, openNewAgent, pageLinks, usePagesShown } from "../workspace/pages";
import type { PageLink } from "../workspace/pages";
import { forgetAgent, forgetAgents, getAgentTab, openAgentPage, rememberAgent, rememberedAgent } from "./agent-tab";
import { board, mayAnswer, refusal } from "./board";
import { useCli } from "./cli";
import type { Cli } from "./cli";
import type { Board, Entry } from "./board";
import {
  BACK_TO_HOME, CHECKING, CHECK_AGAIN, CHECK_FAILED, CLI_NEWER_API, CLI_REQUIRED, DETECTED, ANSWER, ANSWER_IN_THREAD, EVERY_AGENT, FINISHED, FIRST_RUN, MESSAGE_INSTEAD, MESSAGE_NOT_ANSWER, NEEDS_YOU, NEEDS_YOU_SHOWN, NEWER_API_WHY,
  NOTHING_NEEDS_YOU, NOT_ANSWERED, NOT_NOW_GONE, NOT_NOW_STOPPED, NOT_NOW_UNREACHABLE, NOT_NOW_UNREAD, UNREACHABLE, UNREACHABLE_WAITS, NOT_SENT, OPEN, OPEN_PAGE, OPEN_THREAD, READING, REQUIRED, SEND, SENDING, SENT, SHOW_FEWER, STOPPED_WAITS, TMUX_ANSWER, WORKING, WORKING_SHOWN,
  answeredWith, detected, installCommand, replyLabel, replyPlaceholder, required, showAll, summaryLine, tileCount,
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
function useOpen(oats: Ready): (entry: Entry) => { href?: string; /** where a press leads: a thread of bb's (the agent's own, or its archived one), or the agent's page */ leads: "thread" | "page"; onClick(event: React.MouseEvent): void } {
  const navigate = useBbNavigate();
  const outside = outsideOf(oats);
  return (entry) => {
    const thread = entry.thread === null ? undefined : oats.threadById.get(entry.thread.id);
    if (thread === undefined) {
      // Its archived conversation, where bb keeps one, as the sidebar's row opens it; else its own page.
      const archived = outside.of(entry.agent)?.archived === true && entry.agent.threadId !== null ? entry.agent.threadId : null;
      return { leads: archived === null ? "page" : "thread", onClick: () => void (archived === null ? openAgentPage(navigate as BbNavigate, entry.agent.instance) : navigate.toThread(archived)) };
    }
    return {
      leads: "thread",
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
  // The name in its weight is the link, as a row's name is in bb's own lists: no underline at rest; it shows on
  // hover and on keyboard focus (the focus ring is bb's own; the link keeps its role and its accessible name).
  const look = `${TARGET} inline-flex min-w-0 items-center break-words text-left font-semibold text-foreground underline-offset-2 hover:underline focus-visible:underline`;
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

/** The lifecycle's own word for the act that starts an agent ("Start…": it opens that act's dialog). */
const START = ACTS.find((each) => each.verb === "start")!.button;

/** How a card is answered: what the agent asks decides what the card offers (`offer`, below). */
type Offer = "stopped" | "unreachable" | "choices" | "in-thread" | "reply" | "elsewhere";

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
  const paged = open.leads === "page"; // (the button says where it leads: an archived thread is a thread)
  return (
    <li data-testid="oats-needs-card" data-instance={entry.agent.instance} data-offer="outside">
      <Card testId="oats-needs-card-body">
        <div className="flex min-w-0 items-start justify-between gap-2">
          <div className="flex min-w-0 flex-col gap-0.5">
            <AgentName entry={entry} oats={oats} testId="oats-needs-name" />
          </div>
          <Button data-testid="oats-needs-open" aria-label={`${paged ? OPEN_PAGE : OPEN_THREAD}: ${name}`} onClick={(event) => open.onClick(event)}>
            {OPEN}
          </Button>
        </div>
        {/* The same drawing as under the thread's line: Stop… and Start… are the line's own acts, and Details is under it. */}
        <StatusLine state={entry.status.state} {...lineParts(said, entry.status)} action={lineActs(said, entry.agent.instance, held, entry.status.state)} />
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
    if (busy !== null || !mayAnswer(entry.agent, entry.thread, held)) return;
    setBusy(kind);
    setFailure(null);
    setSaid(null);
    attempt(async () => {
      const now = await rpc.call("snapshot", null);
      if (!now.ok) throw new Error(NOT_NOW_UNREAD);
      const agent = now.agents.find((each) => each.instance === entry.agent.instance);
      if (agent === undefined) throw new Error(NOT_NOW_GONE);
      // The AGENT is the server's roster's, read now; the THREAD is the card's own (bb's row as it
      // was drawn): the guard is fresh on what OATS says, not on what bb says of the thread.
      const why = refusal(agent, entry.thread);
      if (why !== null) throw new Error(why === "unreachable" ? NOT_NOW_UNREACHABLE : NOT_NOW_STOPPED);
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
      setSaid(SENT);
    });
  };

  // What it asks: the agent's own message, else bb's title for its question, else the reason in words.
  const message = claim?.message ?? asked?.title ?? null;
  // What an in-place answer is about, when the line above is the kernel's claim and not bb's title.
  const detail = asked !== null && asked.choices.length > 0 && asked.title !== null && asked.title !== message ? asked.title : null;
  // The kernel says the agent is STOPPED (an operator's stop, or a stop that does not say how its
  // session ended), and it needs the person all the same (bb still holds a request on its thread,
  // or it still carries its claim): an answer or a message to its thread would start its harness
  // again behind OATS's back (a stopped agent stays stopped). The card then offers neither: it
  // says so, and offers Start, the lifecycle's own act, which starts it through OATS. An agent
  // whose session was LOST, or that has no harness loaded, is answered as any other: a message in
  // its thread is how it comes back (`refusal`, board.ts: the Start dialog's own reading).
  const refused = refusal(entry.agent, entry.thread);
  const offer: Offer =
    thread === undefined ? "elsewhere" : refused !== null ? refused : asked !== null && asked.choices.length > 0 ? "choices" : pending || claim?.reason === "permission" ? "in-thread" : "reply";
  const reply = <Reply name={name} text={text} onText={setText} busy={busy !== null} held={held} said={said} onSend={send} />;
  // A message beside a request that has an answer of its own: behind a fold, after what a message does not do.
  const instead = (
    <Disclosure summary={MESSAGE_INSTEAD} testId="oats-needs-message">
      <p className="m-0 text-xs text-muted-foreground">{MESSAGE_NOT_ANSWER}</p>
      {reply}
    </Disclosure>
  );
  // Why nothing was sent, in one line on the card: the first line of what the press was answered (the rest, if any, under Details).
  const why = failure === null ? [] : refusalLines(failure.message);
  return (
    <li data-testid="oats-needs-card" data-instance={entry.agent.instance} data-offer={offer === "stopped" || offer === "unreachable" || answered === null ? offer : "answered"}>
      <Card testId="oats-needs-card-body">
        <div className="flex min-w-0 items-start justify-between gap-2">
          {/* (The column takes the card's width, so that the line under the name can measure what fits; the name stays as wide as its words.) */}
          <div className="flex min-w-0 flex-1 flex-col items-start gap-0.5">
            <AgentName entry={entry} oats={oats} testId="oats-needs-name" />
            {/* Under its name, one line: its soul, the reason where there is one, and where it is for an agent on tmux. */}
            <AgentFacts entry={entry} oats={oats} testId="oats-needs-where" under />
          </div>
          {/* One word; its accessible name says where it leads: the agent's thread, or, for an agent with none, its own page.
              Where the request can only be answered in its thread the word is "Answer": the same press, the same place. */}
          <Button data-testid="oats-needs-open" aria-label={`${offer === "in-thread" && answered === null ? ANSWER_IN_THREAD : open.leads === "page" ? OPEN_PAGE : OPEN_THREAD}: ${name}`} onClick={(event) => open.onClick(event)}>
            {offer === "in-thread" && answered === null ? ANSWER : OPEN}
          </Button>
        </div>
        {/* Under "Needs you" the heading says the word: the card keeps the mark (named for a screen reader) and the wait. */}
        <StatusLine state={entry.status.state} markOnly={entry.status.state === "needs-you"} since={entry.status.since} detail={message === null ? (claim === null ? entry.status.detail : waitingLabel(claim)) : null} />
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
        {offer === "unreachable" ? (
          // Nobody can tell where an answer or a message would go: none is offered, and no Start (the lifecycle has none for it).
          <p data-testid="oats-needs-unreachable" className="m-0 text-xs text-muted-foreground">
            {entry.status.state === "unreachable" ? UNREACHABLE_WAITS : `${UNREACHABLE} ${UNREACHABLE_WAITS}`}
          </p>
        ) : offer === "stopped" ? (
          <div data-testid="oats-needs-stopped" className="flex min-w-0 flex-col gap-2">
            <p className="m-0 text-xs text-muted-foreground">{STOPPED_WAITS}</p>
            <div className="flex flex-wrap items-center gap-2">
              <Button data-testid="oats-needs-start" disabled={held} onClick={() => openAct("start", entry.agent.instance)}>
                {START}
              </Button>
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
            </div>
            {instead}
          </>
        ) : offer === "in-thread" ? (
          // Answered in its thread: the card's button says "Answer" and leads there; a message is not an answer.
          instead
        ) : offer === "reply" ? (
          reply
        ) : entry.agent.backend === "tmux" ? (
          // Nothing can be sent from bb to an agent on tmux: where to answer it. The command that
          // reaches its terminal is on its page, where Open leads.
          <p data-testid="oats-needs-elsewhere" className="m-0 text-xs text-muted-foreground">
            {TMUX_ANSWER}
          </p>
        ) : null /* no thread to write in: the card's second line says what became of it, and Open leads to its page, or to the archived thread */}
        {failure === null ? null : (
          <Notice title={failure.kind === "send" ? NOT_SENT : NOT_ANSWERED} tone="error" details={why.length > 1 ? why.slice(1).join("\n") : null}>
            {why.length === 0 ? null : <p data-testid="oats-needs-why" className="m-0">{why[0]}</p>}
          </Notice>
        )}
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

/**
 * What a row of the home says of its agent beside its name, on ONE line that never wraps (ui
 * `RowFacts`, as the sidebar's row, without the state: the heading over the list, or the row's own
 * end, says it): its soul, the reason where there is one (an agent with no bb thread: "session
 * lost"; what became of its thread), and for an agent on tmux bb's terminal glyph. When the line
 * does not fit, the reason shortens, then leaves, and only then the soul shortens; a reason that
 * warns stays. Its title says the whole of it. (The machine is not on a row: it is on the agent's page.)
 */
/** What a row of the home says of an agent the roster draws on no thread, after its soul: the reason, its tone, and whether it is on tmux. */
function reasonOf(entry: Entry, oats: Ready): { reason: string | null; tone: "warning" | undefined; onTmux: boolean } {
  const said = entry.thread === null ? outsideOf(oats).of(entry.agent) : null;
  const onTmux = entry.thread === null && entry.agent.backend === "tmux";
  const reason = entry.thread !== null ? null : onTmux ? (said !== null && said.note ? said.note : null) : said === null || said.kind === "stopped-archived" ? null : said.note || null;
  return { reason, tone: said?.rowTone === "warning" ? "warning" : undefined, onTmux };
}

function AgentFacts({ entry, oats, testId, under = false }: { entry: Entry; oats: Ready; testId: string; /** under the name, in a column (a card): as wide as the column, and one line high. Beside the name, in a row: the rest of the row's width */ under?: boolean }) {
  const { reason, tone, onTmux } = reasonOf(entry, oats);
  // A lost session is said in the state's place on a row ("Lost": app/outside `rowWords`), so its line has no reason to hold; its title keeps it.
  const words = rowWords(entry.status.word, entry.status.state, reason);
  const soul = shown(oats.soulOf(entry.agent));
  // The line measures what fits, so it needs a width that is not its own words': beside a name it takes the rest of
  // the ROW's width (it grows, from a base of ten rem: `flex-1 basis-40`); under a name, in a COLUMN, it is as wide as
  // the column and nothing else: there a flex base is a HEIGHT (it made every card's line ten rem tall: an empty gap
  // of about 150 px under the soul; the specialist's finding on the image set of 24 Nov 2026).
  return <RowFacts testId={testId} soul={soul} reason={words.reason} reasonTone={tone} where={onTmux ? TMUX : undefined} said={{ reason: words.title.reason }} className={under ? "w-full" : "max-w-full flex-1 basis-40"} />;
}

/**
 * One agent as a row of a list: its name, then on the same line what `AgentFacts` says of it, and,
 * in the list of every agent, its state in words at the row's end. A list under a heading that
 * says it ("Running") does not repeat it on every row. No rule between rows: bb's own lists
 * draw none between theirs.
 */
function AgentRow({ entry, oats, testId, stateToo = false }: { entry: Entry; oats: Ready; testId: string; stateToo?: boolean }) {
  return (
    <li data-testid={testId} data-instance={entry.agent.instance} className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-0.5 py-0.5">
      <span className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-2">
        <AgentName entry={entry} oats={oats} testId="oats-home-agent" />
        <AgentFacts entry={entry} oats={oats} testId="oats-home-agent-where" />
      </span>
      {stateToo ? (
        <span className="shrink-0 text-sm">
          {/* The state in words; a lost session's word on a row is "Lost" (its mark is the stopped one: the agent is stopped). */}
          <State state={entry.status.state} word={rowWords(entry.status.word, entry.status.state, reasonOf(entry, oats).reason).state} />
        </span>
      ) : null}
    </li>
  );
}

/**
 * Whether the roster's row of this agent says "Lost" (its session was lost: nobody stopped it): the row's own words,
 * asked as the sidebar asks them (`rowParts`, `rowWords`), so the home's list and the roster never disagree on who is in it.
 */
const isLost = (entry: Entry, oats: Ready): boolean => rowWords(entry.status.word, entry.status.state, rowParts(outsideOf(oats).of(entry.agent), entry.status.state).note).state === LOST_WORD;

/**
 * One agent whose session was lost, under the heading that says so: its name, its soul and where it is, and the act
 * that brings it back. The one place where eight lost agents are eight presses in one list, not eight pages (the
 * lead's T2). Start… opens the act's dialog, like every Start…; it is off while the roster shown is the last one read.
 */
function LostRow({ entry, oats, held }: { entry: Entry; oats: Ready; held: boolean }) {
  const onTmux = entry.thread === null && entry.agent.backend === "tmux";
  // Behind a result that says it started, until the roster is read again (the row is still here, from the roster before): its act is off (L13's rule, app/roster/reading.tsx).
  const reading = useReading(entry.agent.instance);
  // ONE rule with the thread's line: where a MESSAGE is the way on (an agent on bb whose thread bb lists: `messageResumes`),
  // the row's act is Open: it opens that thread, whose line says so. Start… there would begin a NEW conversation where
  // a message keeps the old one. Every other row (tmux; a bb agent whose thread is archived or gone) has Start….
  const byMessage = messageResumes(entry.agent, entry.thread);
  const open = useOpen(oats)(entry);
  return (
    <li data-testid="oats-lost-row" data-instance={entry.agent.instance} className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-0.5 py-0.5">
      <span className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-2">
        <AgentName entry={entry} oats={oats} testId="oats-home-agent" />
        {/* (No reason on the line: the heading says it.) Behind a done Start, until the roster is read again, the line says
            "Reading…" in its facts' place: its Start… is then off, and an off control is never alone (the Loading pattern's word, L13's). */}
        {reading ? (
          <span role="status" data-testid="oats-lost-reading" className="text-xs text-muted-foreground">
            {READING_WORD}
          </span>
        ) : (
          <RowFacts testId="oats-home-agent-where" soul={shown(oats.soulOf(entry.agent))} where={onTmux ? TMUX : undefined} className="max-w-full flex-1 basis-40" />
        )}
      </span>
      {byMessage ? (
        <Button data-testid="oats-lost-open" onClick={open.onClick}>
          {OPEN}
        </Button>
      ) : (
        <Button data-testid="oats-lost-start" disabled={held || reading} onClick={() => openAct("start", entry.agent.instance)}>
          {START}
        </Button>
      )}
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

/**
 * The workspace's tiles: the plugin's pages that this release shows, each with its count. With the
 * default (the home alone) there is none, and nothing is drawn. No tile for the agents: the
 * sidebar lists every one (the lead's ruling L1 on the text audit, 23 Nov 2026). Home › Agents
 * stays, reached by its address alone.
 */
function Tiles({ visible }: { visible: boolean }) {
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
  const shown = pageLinks().filter((page) => pages.has(page.path));
  if (shown.length === 0) return null;
  return (
    <ul data-testid="oats-home-tiles" className="m-0 grid list-none grid-cols-2 gap-2 p-0 md:grid-cols-3">
      {shown.map((page) => (
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
      <p data-testid="oats-home-summary" className="m-0 text-muted-foreground">
        {summaryLine(made.counts)}
      </p>
      <ul className="m-0 flex list-none flex-col p-0">
        {made.all.map((entry) => (
          <AgentRow key={entry.agent.instance} entry={entry} oats={oats} testId="oats-home-agent-row" stateToo />
        ))}
      </ul>
    </Section>
  );
}


/**
 * Where the installed `oats` stands against what the plugin is built for (D-004, D-007, D-008), on
 * the home only: a card while it is older than the plugin works with or its version cannot be
 * read (what was detected, what is required, the command to copy), a card with no command while it
 * speaks a later version of its answers than the plugin reads. Nothing for a tested one, nothing
 * while the read is out, and nothing where no act is turned off: a CLI of a later minor than the
 * plugin was tested with, and a version that could not be read at all while the roster reads (the
 * roster proves `oats` runs, and the kernel refuses a spawn it cannot make). OATS that cannot be
 * run at all is the roster's notice.
 */
function CliNotice({ cli, checking, failure, onCheck }: { cli: Cli | undefined; checking: boolean; failure: string | null; onCheck: () => void }) {
  if (cli === undefined || cli.state === "tested" || cli.state === "newer") return null;
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
  const found = <Fact label={DETECTED}>{detected(cli.version === null ? null : shown(cli.version))}</Fact>;
  const facts = (
    <Facts>
      {found}
      <Fact label={REQUIRED}>{required(OATS_FLOOR)}</Fact>
    </Facts>
  );
  if (cli.state === "newer-api") {
    // The CLI is too NEW for the plugin: the floor ("<floor> or newer") is not the bound that is broken, and beside a
    // newer version it reads as a denial of the title. The card says what was found, and what to do; no "Required" row.
    return (
      <div data-testid="oats-home-cli" data-state={cli.state}>
        <Notice title={CLI_NEWER_API} tone="warning" actions={again}>
          <p className="m-0">{NEWER_API_WHY}</p>
          <Facts>{found}</Facts>
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
        {facts}
        <p className="m-0">
          <Code>{command}</Code>
        </p>
        {failed}
      </Notice>
    </div>
  );
}

function Sections({ oats, visible, agents, onBack, says = true }: { oats: Oats; visible: boolean; agents: boolean; onBack: () => void; /** whether this place says the roster's notice: not a tab that is hidden (bb keeps it mounted), nor one beside a thread whose own line says it: the notice stands once on a screen, where a person looks (the lead's T3) */ says?: boolean }) {
  const now = useNow();
  const navigate = useBbNavigate();
  const pages = usePagesShown();
  // Read once the home is seen (once more by itself when that failed and the roster reads), and again when the person asks: the installed CLI changes with an install, not with what the agents do.
  const { cli, checking, failure: checkFailure, check } = useCli(visible, oats.phase === "ready");
  const notice = <CliNotice cli={cli} checking={checking} failure={checkFailure} onCheck={check} />;
  // Behind the card New agent is off: a spawn through a CLI the plugin does not work with is not offered.
  const incompatible = cli !== undefined && (cli.state === "older" || cli.state === "unknown" || cli.state === "newer-api");
  // The same words as the sidebar's, from the same components: what is read, what cannot be, and
  // (the roster kept as last read) how old what is shown is. The page has no heading of its own:
  // bb's bar over it names it.
  if (oats.phase === "loading") return <Loading>{READING}</Loading>;
  // OATS was never read: the notice, whole. Where this place does not say it (a thread's tab, beside that thread's own
  // line, which says it with the one Retry), ONE line, the notice's title alone, with nothing to press: never an empty pane.
  if (oats.phase === "failed") return says ? <RosterNotice oats={oats} /> : <LastObservation failure={oats} machine={oats.machine} />;
  const made = board(oats.view, now);
  const held = oats.stale !== null;
  // The agents whose session was lost (not the ones a person stopped), in the roster's order.
  const lost = made.all.filter((entry) => isLost(entry, oats));
  // New agent is on every home, first on the page (the Desktop's Home has none: its act is the
  // sidebar's, which bb keeps in a drawer at a phone's width). Offered where it has somewhere to
  // open (the sidebar's rule); off behind the CLI card and while the roster shown is the last one
  // read. Why is said by the notice under it, on the same screen (the CLI card, the roster's
  // notice), never beside the button. On the home of a workspace with no agent it is the one act.
  const off = incompatible || held;
  const head = (
    <div data-testid="oats-home-head" className="flex min-w-0 flex-wrap items-center justify-end gap-2">
      {hasNewAgent(pages.has("souls")) ? (
        <Button variant={made.all.length === 0 ? "primary" : "default"} data-testid="oats-home-new-agent" disabled={off} onClick={() => void openNewAgent(navigate as BbNavigate, pages.has("souls"))}>
          New agent
        </Button>
      ) : null}
    </div>
  );
  // The one Stale drawing, the roster's: nothing while the roster is the one just read.
  const stale = <RosterNotice oats={oats} seen={says} />;
  if (agents) {
    return (
      <>
        {head}
        {stale}
        {/* New agent is off behind the CLI card: the card is on this screen too, so the button is never off with nothing saying why. */}
        {incompatible ? notice : null}
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
        <Empty>{FIRST_RUN}</Empty>
        <Tiles visible={visible} />
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
      <Tiles visible={visible} />
      {made.working.length === 0 ? null : (
        <Section title={WORKING} n={made.working.length} testId="oats-home-working">
          <Cropped items={made.working} shown={WORKING_SHOWN} more={showAll} testId="oats-home-working-all">
            {(entry) => <AgentRow key={entry.agent.instance} entry={entry} oats={oats} testId="oats-working-row" />}
          </Cropped>
        </Section>
      )}
      {/* A quiet section, only when it has rows: headed with the roster's own word for them and their count ("Lost 8"). */}
      {lost.length === 0 ? null : (
        <Section title={LOST_WORD} n={lost.length} testId="oats-home-lost">
          <ul className="m-0 flex list-none flex-col p-0">
            {lost.map((entry) => (
              <LostRow key={entry.agent.instance} entry={entry} oats={oats} held={held} />
            ))}
          </ul>
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

/** The full page: the phone's home, and where bb's badge on the plugin's entry leads. `/plugins/oats/home/agents` is Home › Agents. */
export function HomePage({ subPath }: PluginNavPanelProps) {
  const oats = useOats();
  const navigate = useBbNavigate();
  const agents = subPath.split("/").find((segment) => segment !== "") === AGENTS;
  return (
    <Page testId="oats-home-page">
      <Sections oats={oats} visible agents={agents} onBack={() => navigate.toPluginPanel("home")} />
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
  // (A thread's own line on this screen says the roster's notice: an agent's archived thread (the outside feature's row); and, where OATS was never read, every thread's line.)
  const lineSays = useLineShowsNotice();
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
      {/* The tab is the home alone: Home › Agents has an address of the page's, and nothing in the tab leads to it. */}
      <Sections oats={oats} visible={visible} agents={false} onBack={() => undefined} says={visible && !lineSays} />
    </div>
  );
}
