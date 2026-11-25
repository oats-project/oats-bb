// THE BOARD: what an agent tells its person outside its conversation: the QUESTIONS it needs
// answered (first: they are what needs the person) and the FACTS it keeps in view. A view of its
// own: it takes the agent's name and nothing of the place that mounts it, and reads the board
// itself (read.ts). Nothing is drawn for an agent with neither.
//
// Drawn with bb's own info parts where one fits (a section, its list with bb's own "N more");
// where bb has none, or its part cannot carry what a person must read (a question with its
// options, a fact's two lines, the small line of its history), with ours, in bb's look.
//
// EVERY WORD OF A BOARD IS THE AGENT'S: plain text through the display filter (`shown`), never
// markup; an address is text until a person presses it, and opens outside bb only on a second
// press.
import { useBbNavigate, useRpc, useSdk, experimental_InfoList as InfoList, experimental_InfoSection as InfoSection } from "@get-bb/plugin-sdk/app";
import { useEffect, useRef, useState } from "react";
import type { rpcContract } from "../../contract";
import { answerText, boardData, dialogOpen, factsView, FACTS_SHOWN, questionOccurrence, sparkValues, turnQuestion, type Board as BoardData, type BoardClaim, type BoardFact, type BoardQuestion } from "../../model/board";
import { SENT } from "../home/home-words";
import { guarded, mayWrite, sendText, type Target } from "../home/send";
import { useOats } from "../oats";
import { readingNow, useActed } from "../roster/reading";
import { errorMessage } from "../store";
import { noteSent, useSent } from "./sent";
import { shown, shownBlock } from "../../model/text";
import { useNow } from "../roster/now";
import { Button } from "../ui";
import { Disclosure, TARGET } from "../ui/patterns";
import { agentName, readAge } from "../ui/words";
import { useHiddenFacts } from "./hidden";
import { useBoard, useBoardDetail, type DetailRead } from "./read";
import { BOARD, droppedSaid, hiddenSaid, placeSaid, saysSaid } from "./words";

/** A quiet line: what cannot be shown, in its place. `failed`: a read FAILED (the warning tone); else muted. */
function Quiet({ children, failed = false, testId }: { children: string; failed?: boolean; testId: string }) {
  return (
    <p data-testid={testId} data-tone={failed ? "warning" : undefined} className={`m-0 text-xs ${failed ? "text-warning-text" : "text-muted-foreground"}`}>
      {children}
    </p>
  );
}

/** An age as the page's other ages say them: the age alone, its instant in the title. */
function Age({ at, now }: { at: string; now: number }) {
  return (
    <span data-testid="oats-board-age" title={at} className="shrink-0 whitespace-nowrap text-xs text-muted-foreground">
      {readAge(at, now) ?? ""}
    </span>
  );
}

/** The small line of a fact's numbers, oldest first: ours (bb has no part for it), in the text's own colour. Decorative: the value says it. */
function Spark({ values }: { values: readonly number[] }) {
  const low = Math.min(...values);
  const span = Math.max(...values) - low || 1;
  const points = values.map((value, index) => `${((index / (values.length - 1)) * 38 + 1).toFixed(1)},${(11 - ((value - low) / span) * 10).toFixed(1)}`).join(" ");
  return (
    <svg data-testid="oats-board-spark" aria-hidden="true" width="40" height="12" viewBox="0 0 40 12" className="shrink-0 text-muted-foreground">
      <polyline points={points} fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/**
 * ONE FACT, the same two lines for every one (ours, in bb's type and spacing: bb's own row keeps
 * one line, and a list a person can read comes first). LINE 1: the VALUE, whole (a long one wraps
 * here; a value is never cut), the small line of its history right after it, and at the row's end
 * its age and the ×. LINE 2, small and muted: the LABEL and, where the fact has an address, its
 * HOST: one line, and the label is what gives way (its whole text is its title).
 * The address is the agent's: its host alone, as text (who says it is said once, on the heading's
 * line); a press shows the whole address as text; only then "Open in browser".
 */
function FactRow({ fact, values, now, hide }: { fact: BoardFact; values: readonly number[] | null; now: number; hide: () => void }) {
  const navigate = useBbNavigate();
  const [whole, setWhole] = useState(false);
  const link = fact.link;
  return (
    <div data-testid="oats-board-fact" data-key={fact.key} className="flex min-w-0 flex-col gap-0.5 py-1">
      <div className="flex min-w-0 items-start gap-2">
        <span className="min-w-0 flex-1 break-words text-sm">
          <span data-testid="oats-board-fact-value" className="font-medium text-foreground">
            {shown(fact.value)}
            {fact.unit === null ? "" : ` ${shown(fact.unit)}`}
          </span>
          {values === null ? null : (
            <span className="ml-1.5 inline-block align-middle">
              <Spark values={values} />
            </span>
          )}
        </span>
        <span className="flex shrink-0 items-center gap-1">
          <Age at={fact.at} now={now} />
          <button type="button" data-testid="oats-board-fact-hide" aria-label={`${BOARD.hide}: ${shown(fact.label)}`} className={`${TARGET} inline-flex min-w-8 items-center justify-center text-muted-foreground hover:text-foreground`} onClick={hide} onKeyDown={(event) => event.stopPropagation()}>
            ×
          </button>
        </span>
      </div>
      <div className="flex min-w-0 items-baseline gap-1 text-xs text-muted-foreground">
        <span data-testid="oats-board-fact-label" title={shown(fact.label)} className="min-w-0 truncate">
          {shown(fact.label)}
        </span>
        {link === null ? null : (
          <span data-testid="oats-board-link" className="shrink-0 whitespace-nowrap">
            {" · "}
            <button type="button" data-testid="oats-board-link-show" aria-expanded={whole} className="inline text-xs text-muted-foreground hover:text-foreground" onClick={() => setWhole((was) => !was)}>
              {shown(link.host)}
            </button>
          </span>
        )}
      </div>
      {link !== null && whole ? (
        <span className="flex min-w-0 flex-wrap items-center gap-2">
          <span data-testid="oats-board-link-address" className="min-w-0 break-all font-mono text-xs text-foreground">
            {shown(link.href)}
          </span>
          <Button data-testid="oats-board-link-open" onClick={() => navigate.openUrl(link.href)}>
            {BOARD.open}
          </Button>
        </span>
      ) : null}
    </div>
  );
}

function Facts({ instance, board, detail, now }: { instance: string; board: BoardData; detail: DetailRead; now: number }) {
  const name = agentName(instance);
  const { hidden, hide, showAll } = useHiddenFacts(instance);
  // Every visible fact goes to bb's list, which shows three and folds the rest behind its own "N more".
  const view = factsView(board.facts, hidden, { unfolded: true });
  if (board.facts.length === 0) return null;
  const history = detail.status === "read" && detail.detail.state === "ok" ? detail.detail.facts : null;
  return (
    <div data-testid="oats-board-facts" className="flex min-w-0 flex-col gap-1">
      {/* Who says the addresses below: once, on the heading's line, and only where a fact in view has one. */}
      <InfoSection label={BOARD.facts} count={view.shown.length} trailing={view.shown.some((fact) => fact.link !== null) ? <span data-testid="oats-board-says" className="min-w-0 break-words text-xs text-muted-foreground">{saysSaid(name)}</span> : undefined}>
        <InfoList
          items={view.shown}
          getKey={(fact) => fact.key}
          limit={FACTS_SHOWN}
          renderItem={(fact) => <FactRow fact={fact} values={sparkValues(history?.get(fact.key)?.history)} now={now} hide={() => hide(fact.key, fact.value)} />}
        />
      </InfoSection>
      {view.hidden.length === 0 ? null : (
        <button type="button" data-testid="oats-board-hidden" className={`${TARGET} inline-flex items-center self-start text-xs text-muted-foreground underline hover:text-foreground`} onClick={showAll}>
          {hiddenSaid(view.hidden.length)}
        </button>
      )}
      {/* The history is the small lines' alone: where it could not be had, one quiet line says which. */}
      {detail.status === "failed" ? (
        <Quiet testId="oats-board-history-failed" failed>
          {BOARD.historyFailed}
        </Quiet>
      ) : detail.status === "read" && detail.detail.state === "unsupported" ? (
        <Quiet testId="oats-board-no-history">{BOARD.noHistory}</Quiet>
      ) : detail.status === "read" && detail.detail.state === "malformed" ? (
        <Quiet testId="oats-board-history-failed" failed>
          {BOARD.historyFailed}
        </Quiet>
      ) : null}
    </div>
  );
}

/** The context of one question, for the occurrence it was read for: the agent's own text, plain, line breaks kept. */
function Context({ asked, detail }: { asked: BoardQuestion; detail: DetailRead }) {
  const read = detail.status === "read" && detail.detail.state === "ok" ? detail.detail.questions.get(asked.id) : undefined;
  const text = read !== undefined && read.since === asked.since ? read.context : null;
  return (
    <Disclosure summary={BOARD.context} testId="oats-board-context">
      {detail.status === "loading" ? (
        <Quiet testId="oats-board-context-reading">{BOARD.reading}</Quiet>
      ) : text === null ? (
        <Quiet testId="oats-board-context-failed" failed>
          {BOARD.contextFailed}
        </Quiet>
      ) : (
        <p data-testid="oats-board-context-text" tabIndex={0} className="m-0 max-h-[33vh] overflow-y-auto whitespace-pre-wrap break-words text-sm text-foreground">
          {shownBlock(text)}
        </p>
      )}
    </Disclosure>
  );
}

/**
 * How an option of a question is ANSWERED, for an agent on a bb thread: the press sends
 * `<id>: <option>` to its thread, as a person's own message (the kernel's form: "answers arrive
 * typed as `<id>: <text>`"), through the plugin's one guarded send. Null where it is not offered:
 * an agent that is not on a listed bb thread (one on tmux: its options stay text), one that may
 * not be written to now (it does not run; the roster is the last one read, or reads "Reading…"),
 * a thread on which bb holds a request of its own (answer that first, in its card), and an agent
 * that waits on an approval of its harness (a message then would answer that).
 */
type Answering = { target: Target; threadId: string } | null;

function useAnswering(instance: string, claim: BoardClaim): Answering {
  const oats = useOats();
  useActed();
  if (oats.phase !== "ready") return null;
  const node = oats.nodeByInstance.get(instance);
  if (node === undefined || node.agent.backend !== "bb") return null;
  const target = { agent: node.agent, thread: node.thread, held: oats.stale !== null || readingNow(oats, instance) };
  if (!mayWrite(target) || node.thread.hasPendingInteraction || dialogOpen(claim)) return null;
  return { target, threadId: node.thread.id };
}

/** One question's options: buttons where an answer may be sent, text where not; "Sent." beside the one sent, and then all off for that occurrence. */
function Options({ instance, asked, answering }: { instance: string; asked: BoardQuestion; answering: Answering }) {
  const sdk = useSdk();
  const rpc = useRpc<typeof rpcContract>();
  const occurrence = questionOccurrence(asked);
  const sent = useSent(instance, occurrence);
  const [busy, setBusy] = useState(false);
  const [refused, setRefused] = useState<string | null>(null);
  const going = useRef(false);
  // What was refused was said of the question it was pressed on.
  useEffect(() => setRefused(null), [occurrence]);
  const press = (index: number) => {
    const text = answerText(asked, index);
    if (answering === null || text === null || sent !== null || going.current) return;
    going.current = true;
    setBusy(true);
    setRefused(null);
    guarded(rpc, answering.target, async () => {
      // What is sent is built from the ROW AT THE PRESS, not from what this window holds: the
      // question must still be open on the server's roster, the same occurrence, with that option.
      const row = await rpc.call("board", { instance });
      if (dialogOpen(row.claim)) throw new Error(BOARD.approvalFirst);
      const now = boardData(row.board)?.questions.find((each) => questionOccurrence(each) === occurrence);
      const said = now === undefined ? null : answerText(now, index);
      if (said === null || said !== text) throw new Error(BOARD.noLongerAsked);
      return sendText(sdk, answering.threadId, said);
    }).then(
      () => {
        going.current = false;
        noteSent(instance, occurrence, index);
        setBusy(false);
      },
      (cause: unknown) => {
        going.current = false;
        setBusy(false);
        setRefused(errorMessage(cause));
      },
    );
  };
  return (
    <>
      <ol data-testid="oats-board-options" className="m-0 flex min-w-0 list-none flex-col gap-1 p-0">
        {asked.options.map((option, number) => {
          // An option the display filter withholds, or that is not one line, is never sent: it stays text.
          const sendable = answering !== null && answerText(asked, number) !== null;
          return (
            <li key={number} data-testid="oats-board-option" className="flex min-w-0 flex-wrap items-center gap-2">
              {sendable ? (
                <Button data-testid="oats-board-answer" disabled={busy || sent !== null} className="min-w-0 max-w-full justify-start gap-2 text-left" onClick={() => press(number)}>
                  <span className="shrink-0 tabular-nums text-muted-foreground">{number + 1}</span>
                  <span className="min-w-0 whitespace-normal break-words">{shown(option)}</span>
                </Button>
              ) : (
                <>
                  <span className="shrink-0 tabular-nums text-muted-foreground">{number + 1}</span>
                  <span className="min-w-0 break-words">{shown(option)}</span>
                </>
              )}
              {sent === number ? (
                <span data-testid="oats-board-sent" role="status" className="shrink-0 text-xs text-muted-foreground">
                  {SENT}
                </span>
              ) : null}
            </li>
          );
        })}
      </ol>
      {refused === null ? null : (
        <p data-testid="oats-board-refused" role="alert" data-tone="warning" className="m-0 text-xs text-warning-text">
          {shown(refused)}
        </p>
      )}
    </>
  );
}

/** `inCard`: drawn inside a card that has a border and says the age already (the home's): no border and no age of its own. */
function Questions({ instance, board, claim, detail, now, inCard = false }: { instance: string; board: BoardData; claim: BoardClaim; detail: DetailRead; now: number; inCard?: boolean }) {
  const answering = useAnswering(instance, claim);
  const [at, setAt] = useState<string | null>(null);
  const zone = useRef<HTMLElement>(null);
  const total = board.questions.length;
  if (total === 0) return null;
  // The question shown is held by its occurrence: when it goes (the agent cleared it), the first one is shown.
  const found = board.questions.findIndex((each) => questionOccurrence(each) === at);
  const index = found === -1 ? 0 : found;
  const asked = board.questions[index]!;
  const turn = (step: number) => setAt(questionOccurrence(board.questions[turnQuestion(index, step, total)]!));
  const place = placeSaid(index, total);
  return (
    <section
      ref={zone}
      data-testid="oats-board-questions"
      aria-label={BOARD.questions}
      tabIndex={-1}
      data-in-card={inCard ? "" : undefined}
      className={`flex min-w-0 flex-col gap-2 text-sm text-foreground ${inCard ? "" : "rounded-md border border-border p-3"}`}
      onKeyDown={(event) => {
        if (total < 2 || event.target !== zone.current) return;
        if (event.key === "ArrowLeft") turn(-1);
        else if (event.key === "ArrowRight") turn(1);
        else return;
        event.preventDefault();
      }}
    >
      <div className="flex min-w-0 flex-wrap items-center gap-2 text-xs text-muted-foreground">
        {place === null ? null : <span data-testid="oats-board-place">{place}</span>}
        {inCard ? null : <Age at={asked.since} now={now} />}
        {total < 2 ? null : (
          <span className="ml-auto flex shrink-0 items-center gap-1">
            <button type="button" data-testid="oats-board-previous" aria-label={BOARD.previous} className={`${TARGET} inline-flex min-w-8 items-center justify-center hover:text-foreground`} onClick={() => turn(-1)}>
              ‹
            </button>
            <span aria-hidden="true" data-testid="oats-board-dots" className="flex items-center gap-1">
              {board.questions.map((each, dot) => (
                <span key={questionOccurrence(each)} data-current={dot === index ? "" : undefined} className={`inline-block size-1.5 rounded-full ${dot === index ? "bg-foreground" : "bg-muted-foreground/40"}`} />
              ))}
            </span>
            <button type="button" data-testid="oats-board-next" aria-label={BOARD.next} className={`${TARGET} inline-flex min-w-8 items-center justify-center hover:text-foreground`} onClick={() => turn(1)}>
              ›
            </button>
          </span>
        )}
      </div>
      <p data-testid="oats-board-question" className="m-0 min-w-0 break-words font-medium">
        {shown(asked.question)}
      </p>
      <Options key={questionOccurrence(asked)} instance={instance} asked={asked} answering={answering} />
      {asked.hasContext ? <Context asked={asked} detail={detail} /> : null}
    </section>
  );
}

/**
 * The agent's open QUESTIONS alone, by the board's own reads and its own answer path: for a place
 * that says an agent needs a person (the home's card), so that a question of the board is ONE
 * thing wherever it is drawn: the same options, the same send, the same "Sent." mark. Nothing
 * where the board has no open question.
 */
export function BoardAsk({ instance }: { instance: string }) {
  const read = useBoard(instance);
  const now = useNow();
  const board = read.status === "ready" ? read.board : null;
  const detail = useBoardDetail(instance, board === null ? null : { ...board, facts: [] }, true);
  if (read.status !== "ready" || board === null || board.questions.length === 0) return null;
  return <Questions instance={instance} board={board} claim={read.claim} detail={detail} now={now} inCard />;
}

/** The agent's board, read and drawn. `instance`: the agent's name; nothing else is asked of the place. */
export function Board({ instance }: { instance: string }) {
  const read = useBoard(instance);
  const now = useNow();
  const board = read.status === "ready" ? read.board : null;
  // The board is in view whenever this is mounted (a tab that is shown): its detail is read then.
  const detail = useBoardDetail(instance, board, true);
  // The place the palette command focuses (index.ts).
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = root.current;
    if (element === null) return;
    element.setAttribute("data-instance", instance);
  }, [instance]);
  if (read.status === "loading") {
    return (
      <div ref={root} data-testid="oats-board" data-state="reading">
        <Quiet testId="oats-board-reading">{BOARD.reading}</Quiet>
      </div>
    );
  }
  if (read.status === "unsupported") return <div ref={root} data-testid="oats-board" data-state="unsupported" />;
  if (read.status === "error") {
    return (
      <div ref={root} data-testid="oats-board" data-state="failed" className="flex min-w-0 flex-wrap items-center gap-2">
        <Quiet testId="oats-board-unreadable" failed>
          {BOARD.unreadable}
        </Quiet>
        <Button data-testid="oats-board-retry" onClick={read.retry}>
          Retry
        </Button>
      </div>
    );
  }
  const empty = board === null || (board.facts.length === 0 && board.questions.length === 0 && !board.malformed && board.dropped === 0);
  return (
    <div ref={root} data-testid="oats-board" data-state={empty ? "empty" : "shown"} className="flex min-w-0 flex-col gap-4">
      {board === null ? null : (
        <>
          {board.malformed ? (
            <Quiet testId="oats-board-unreadable" failed>
              {BOARD.unreadable}
            </Quiet>
          ) : null}
          <Questions instance={instance} board={board} claim={read.status === "ready" ? read.claim : null} detail={detail} now={now} />
          <Facts instance={instance} board={board} detail={detail} now={now} />
          {board.dropped > 0 ? <Quiet testId="oats-board-dropped">{droppedSaid(board.dropped)}</Quiet> : null}
        </>
      )}
      {empty ? <Quiet testId="oats-board-nothing">{BOARD.nothing}</Quiet> : null}
    </div>
  );
}
