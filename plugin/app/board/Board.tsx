// THE BOARD: what an agent tells its person outside its conversation: the QUESTIONS it needs
// answered (first: they are what needs the person) and the FACTS it keeps in view. A view of its
// own: it takes the agent's name and nothing of the place that mounts it, and reads the board
// itself (read.ts). Nothing is drawn for an agent with neither.
//
// Drawn with bb's own info parts where one fits (a section, its list with bb's own "N more", a
// row); where bb has none (a question with its options, the small line of a fact's history), with
// ours, in bb's look.
//
// EVERY WORD OF A BOARD IS THE AGENT'S: plain text through the display filter (`shown`), never
// markup; an address is text until a person presses it, and opens outside bb only on a second
// press.
import { useBbNavigate, experimental_InfoList as InfoList, experimental_InfoListRow as InfoListRow, experimental_InfoSection as InfoSection } from "@get-bb/plugin-sdk/app";
import { useEffect, useRef, useState } from "react";
import { factsView, FACTS_SHOWN, questionOccurrence, sparkValues, turnQuestion, type Board as BoardData, type BoardDetail, type BoardFact, type BoardQuestion } from "../../model/board";
import { shown, shownBlock } from "../../model/text";
import { useNow } from "../roster/now";
import { Button } from "../ui";
import { Disclosure } from "../ui/patterns";
import { agentName, readAge } from "../ui/words";
import { useHiddenFacts } from "./hidden";
import { useBoard, useBoardDetail, type DetailRead } from "./read";
import { BOARD, droppedSaid, hiddenSaid, linkSaid, placeSaid } from "./words";

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

/** A fact's address: the agent's words and the host; a press shows the whole address as text; only then "Open in browser". */
function FactLink({ name, link }: { name: string; link: NonNullable<BoardFact["link"]> }) {
  const navigate = useBbNavigate();
  const [whole, setWhole] = useState(false);
  return (
    <span data-testid="oats-board-link" className="flex min-w-0 flex-col gap-1">
      <button type="button" data-testid="oats-board-link-show" aria-expanded={whole} className="min-w-0 break-words text-left text-xs text-muted-foreground underline hover:text-foreground" onClick={() => setWhole((was) => !was)}>
        {linkSaid(name, shown(link.host))}
      </button>
      {whole ? (
        <span className="flex min-w-0 flex-wrap items-center gap-2">
          <span data-testid="oats-board-link-address" className="min-w-0 break-all font-mono text-xs text-foreground">
            {shown(link.href)}
          </span>
          <Button data-testid="oats-board-link-open" onClick={() => navigate.openUrl(link.href)}>
            {BOARD.open}
          </Button>
        </span>
      ) : null}
    </span>
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
      <InfoSection label={BOARD.facts} count={view.shown.length}>
        <InfoList
          items={view.shown}
          getKey={(fact) => fact.key}
          limit={FACTS_SHOWN}
          renderItem={(fact) => {
            const values = sparkValues(history?.get(fact.key)?.history);
            return (
              <div data-testid="oats-board-fact" data-key={fact.key} className="flex min-w-0 flex-col gap-1">
                <InfoListRow
                  leading={values === null ? null : <Spark values={values} />}
                  name={
                    <span className="min-w-0 break-words">
                      <span className="text-muted-foreground">{shown(fact.label)} · </span>
                      <span data-testid="oats-board-fact-value" className="font-medium text-foreground">
                        {shown(fact.value)}
                        {fact.unit === null ? "" : ` ${shown(fact.unit)}`}
                      </span>
                    </span>
                  }
                  trailing={
                    <span className="flex shrink-0 items-center gap-2">
                      <Age at={fact.at} now={now} />
                      <button type="button" data-testid="oats-board-fact-hide" aria-label={`${BOARD.hide}: ${shown(fact.label)}`} className="text-muted-foreground hover:text-foreground" onClick={() => hide(fact.key, fact.value)} onKeyDown={(event) => event.stopPropagation()}>
                        ×
                      </button>
                    </span>
                  }
                />
                {fact.link === null ? null : <FactLink name={name} link={fact.link} />}
              </div>
            );
          }}
        />
      </InfoSection>
      {view.hidden.length === 0 ? null : (
        <button type="button" data-testid="oats-board-hidden" className="self-start text-xs text-muted-foreground underline hover:text-foreground" onClick={showAll}>
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
        <p data-testid="oats-board-context-text" className="m-0 whitespace-pre-wrap break-words text-sm text-foreground">
          {shownBlock(text)}
        </p>
      )}
    </Disclosure>
  );
}

function Questions({ board, detail, now }: { board: BoardData; detail: DetailRead; now: number }) {
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
      className="flex min-w-0 flex-col gap-2 rounded-md border border-border p-3 text-sm text-foreground"
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
        <Age at={asked.since} now={now} />
        {total < 2 ? null : (
          <span className="ml-auto flex shrink-0 items-center gap-1">
            <button type="button" data-testid="oats-board-previous" aria-label={BOARD.previous} className="px-1 hover:text-foreground" onClick={() => turn(-1)}>
              ‹
            </button>
            <span aria-hidden="true" data-testid="oats-board-dots" className="flex items-center gap-1">
              {board.questions.map((each, dot) => (
                <span key={questionOccurrence(each)} data-current={dot === index ? "" : undefined} className={`inline-block size-1.5 rounded-full ${dot === index ? "bg-foreground" : "bg-muted-foreground/40"}`} />
              ))}
            </span>
            <button type="button" data-testid="oats-board-next" aria-label={BOARD.next} className="px-1 hover:text-foreground" onClick={() => turn(1)}>
              ›
            </button>
          </span>
        )}
      </div>
      <p data-testid="oats-board-question" className="m-0 min-w-0 break-words font-medium">
        {shown(asked.question)}
      </p>
      <ol data-testid="oats-board-options" className="m-0 flex min-w-0 list-none flex-col gap-1 p-0">
        {asked.options.map((option, number) => (
          <li key={number} data-testid="oats-board-option" className="flex min-w-0 gap-2">
            <span className="shrink-0 tabular-nums text-muted-foreground">{number + 1}</span>
            <span className="min-w-0 break-words">{shown(option)}</span>
          </li>
        ))}
      </ol>
      {asked.hasContext ? <Context asked={asked} detail={detail} /> : null}
    </section>
  );
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
          <Questions board={board} detail={detail} now={now} />
          <Facts instance={instance} board={board} detail={detail} now={now} />
          {board.dropped > 0 ? <Quiet testId="oats-board-dropped">{droppedSaid(board.dropped)}</Quiet> : null}
        </>
      )}
      {empty ? <Quiet testId="oats-board-nothing">{BOARD.nothing}</Quiet> : null}
    </div>
  );
}
