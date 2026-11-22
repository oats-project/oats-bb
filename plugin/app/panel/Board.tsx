// The agent's board on the Instance tab: the questions it asks a person, one at a time with their
// options, and the facts it keeps in view. As the OATS Desktop's agent view (packages/desktop/
// renderer/agent-board.mjs), with one difference that is bb's nature: the Desktop types an answer
// on the terminal's input line for the person's Enter; bb has no terminal, so the answer is sent
// as the agent's next input (`oats session input`), and only after the person confirmed the exact
// line in a dialog.
//
// The board as it is now comes with the instance's facts (the roster's row: no command). Each
// fact's history and each question's context come from one more read (`oats inspect --board`),
// made when the board has something it would add and again when that changes.
//
// Everything on a board is the agent's text: drawn as text, through the display filter.
import { useEffect, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import { useRpc } from "@get-bb/plugin-sdk/app";
import type { PanelBoard, PanelFact, PanelQuestion } from "../../kernel/panel-board";
import { errorMessage, type Contract } from "../store";
import { Button, Confirm, Disclosure, LINK, Section, TARGET } from "../ui";
import type { ConfirmProps } from "../ui";
import { shown, shownBlock } from "../ui/text";
import {
  BOARD_MALFORMED, CONTEXT, DETAIL_NOTES, DIALOG_NOTE, FACTS, FACTS_SHOWN, FOLD, HIDE_TITLE, MAYBE_SENT, MAYBE_SENT_NEXT, NEXT, NOT_SENT, NO_CONTEXT, OPEN_IN_BROWSER, PREVIOUS, QUESTIONS, READING_CONTEXT, SEND, SENDING, SENT, SENT_NOTE,
  UNVERIFIED, addressName, answerHappens, answerLine, answerRefusal, answerTitle, askedText, boardDropped, detailSignature, factName, factsView, hiddenFacts, hideName, linkName, moreFacts,
  dotName, occurrence, questionTag, refusedUnsent, says, sparkNote, sparkValues, terminalNote, turnQuestion, updatedText, wantsDetail, zoneHint, zoneName, type DetailState,
} from "./board-words";
import { hiddenOf, hideFact, showAllFacts } from "./hidden-facts";
import { usePanelBoard } from "./read";
import { codeOf } from "./state";

/** A fact's history as a line: the values' shape, not their scale. Decoration: the values are in the fact's text. */
function Sparkline({ values }: { values: readonly number[] }) {
  const low = Math.min(...values);
  const span = Math.max(...values) - low || 1;
  const points = values.map((value, index) => `${((index / (values.length - 1)) * 46 + 1).toFixed(1)},${(13 - ((value - low) / span) * 12).toFixed(1)}`).join(" ");
  return (
    <svg aria-hidden="true" data-testid="oats-panel-fact-spark" viewBox="0 0 48 14" width="48" height="14" className="inline-block shrink-0 align-middle text-muted-foreground">
      <polyline points={points} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function Facts({ board, detail, detailState, home, name, now }: { board: PanelBoard; detail: PanelBoard | undefined; detailState: DetailState; home: string; name: string; now: number }) {
  const [unfolded, setUnfolded] = useState(false);
  const [openUrl, setOpenUrl] = useState<string | null>(null);
  // What is hidden lives in the browser's storage: `changed` draws again after a hide or a show.
  const [, setChanged] = useState(0);
  const list = useRef<HTMLUListElement>(null);
  const view = factsView(board.facts, hiddenOf(home), unfolded);
  const notes = [
    board.state === "malformed" ? BOARD_MALFORMED : board.dropped > 0 ? boardDropped(board.dropped) : null,
    board.facts.length > 0 && detailState !== "ok" && detailState !== "reading" ? DETAIL_NOTES[detailState].history : null,
  ].filter((note): note is string => note !== null);
  if (view.shown.length + view.folded.length + view.hidden.length === 0 && notes.length === 0) return null;
  const historyOf = (key: string) => (detailState === "ok" ? detail?.facts.find((fact) => fact.key === key)?.history : undefined);
  const hide = (fact: PanelFact, at: number) => {
    hideFact(home, fact.key, fact.value);
    setChanged((n) => n + 1);
    // The focus stays in the list: on the fact that took the place, or the one before it.
    requestAnimationFrame(() => {
      const rows = list.current?.querySelectorAll<HTMLElement>('[data-testid="oats-panel-fact-hide"]') ?? [];
      (rows[Math.min(at, rows.length - 1)] ?? list.current?.parentElement?.querySelector<HTMLElement>('[data-testid="oats-panel-facts-hidden"]'))?.focus();
    });
  };
  const address = view.shown.find((fact) => fact.key === openUrl)?.link ?? null;
  return (
    <Section title={FACTS} n={board.facts.length} testId="oats-panel-facts">
      {notes.length === 0 ? null : (
        <p role="status" data-testid="oats-panel-facts-note" className="m-0 text-xs text-muted-foreground">
          {notes.join(" ")}
        </p>
      )}
      <ul ref={list} className="m-0 flex list-none flex-col gap-1 p-0">
        {view.shown.map((fact, at) => {
          const values = sparkValues(historyOf(fact.key));
          return (
            <li
              key={fact.key}
              data-testid="oats-panel-fact"
              className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 border-t border-border pt-1 first:border-t-0 first:pt-0"
              onKeyDown={(event) => {
                if (event.key === "u" && !event.metaKey && !event.ctrlKey && !event.altKey) hide(fact, at);
              }}
            >
              {/* The fact keeps most of the row: its link goes under it where the row is narrow. */}
              <span role="group" aria-label={factName(fact, now)} className="flex min-w-[60%] flex-1 flex-wrap items-baseline gap-x-1.5">
                <span className="text-muted-foreground">{shown(fact.label)}</span>
                <b dir="auto" className="break-words font-semibold text-foreground">
                  {shown(fact.value)}
                </b>
                {fact.unit === null ? null : <span className="text-foreground">{shown(fact.unit)}</span>}
                {values === null ? null : (
                  <>
                    <Sparkline values={values} />
                    <span className="text-xs text-muted-foreground">{sparkNote(values)}</span>
                  </>
                )}
                <span title={shown(fact.at)} className="text-xs text-muted-foreground">
                  {updatedText(fact.at, now)}
                </span>
              </span>
              {fact.link === null ? null : (
                // The button names the host; a press shows the whole address, and only Open in browser opens it.
                <button
                  type="button"
                  data-testid="oats-panel-fact-link"
                  aria-expanded={openUrl === fact.key}
                  aria-label={linkName(name, fact.link.host)}
                  className={`${TARGET} ${LINK} inline-flex min-w-0 items-center gap-1 text-xs`}
                  onClick={() => setOpenUrl(openUrl === fact.key ? null : fact.key)}
                >
                  <span className="text-muted-foreground">{says(name)}</span>
                  <strong className="break-all">{fact.link.host}</strong>…
                </button>
              )}
              <button type="button" data-testid="oats-panel-fact-hide" aria-label={hideName(fact)} title={HIDE_TITLE} className={`${TARGET} ml-auto inline-flex items-center justify-center px-2 text-muted-foreground hover:text-foreground`} onClick={() => hide(fact, at)}>
                <span aria-hidden="true">×</span>
              </button>
            </li>
          );
        })}
      </ul>
      {address === null ? null : (
        <div role="group" aria-label={addressName(name)} data-testid="oats-panel-fact-address" className="flex min-w-0 flex-col items-start gap-1 rounded-md border border-border px-3 py-2">
          <span className="text-xs text-muted-foreground">{says(name)}</span>
          {/* Exactly what opens, as written. */}
          <p dir="ltr" className="m-0 break-all font-mono text-xs text-foreground">
            {address.href}
          </p>
          <Button data-testid="oats-panel-fact-open" onClick={() => window.open(address.href, "_blank", "noopener,noreferrer")}>
            {OPEN_IN_BROWSER}
          </Button>
        </div>
      )}
      {view.folded.length === 0 && !(unfolded && view.shown.length > FACTS_SHOWN) && view.hidden.length === 0 ? null : (
        <div className="flex flex-wrap items-center gap-2">
          {view.folded.length === 0 && !(unfolded && view.shown.length > FACTS_SHOWN) ? null : (
            <Button data-testid="oats-panel-facts-more" aria-expanded={unfolded} onClick={() => setUnfolded(!unfolded)}>
              {unfolded ? FOLD : moreFacts(view.folded.length)}
            </Button>
          )}
          {view.hidden.length === 0 ? null : (
            <Button
              data-testid="oats-panel-facts-hidden"
              onClick={() => {
                showAllFacts(home);
                setChanged((n) => n + 1);
              }}
            >
              {hiddenFacts(view.hidden.length)}
            </Button>
          )}
        </div>
      )}
    </Section>
  );
}

type Answer = { question: PanelQuestion; option: number; text: string; phase: ConfirmProps["phase"] };

function Questions({
  instance, board, detail, detailState, detailReading, name, dialog, answerable, now,
}: { instance: string; board: PanelBoard; detail: PanelBoard | undefined; detailState: DetailState; detailReading: boolean; name: string; dialog: boolean; answerable: boolean; now: number }) {
  const rpc = useRpc<Contract>();
  const questions = board.questions;
  // The question shown stays the same one across reads, by id; a closed one gives way to its neighbour.
  const [shownId, setShownId] = useState<string | null>(null);
  const [index, setIndex] = useState(0);
  const [answer, setAnswer] = useState<Answer | null>(null);
  /** The occurrence whose answer went, for the quiet note under it. */
  const [sentFor, setSentFor] = useState<string | null>(null);
  const zone = useRef<HTMLDivElement>(null);
  const live = useRef(true);
  useEffect(() => () => void (live.current = false), []);
  const kept = questions.findIndex((question) => question.id === shownId);
  const at = kept >= 0 ? kept : Math.min(index, Math.max(0, questions.length - 1));
  const question = questions[at];
  const key = question === undefined ? null : occurrence(question);
  if (question === undefined || key === null) return null;

  const turn = (step: number) => {
    const next = turnQuestion(at, step, questions.length);
    setIndex(next);
    setShownId(questions[next]?.id ?? null);
  };
  const choose = (option: number) => {
    const text = answerLine(question, option);
    if (text === null || dialog || !answerable) return;
    setAnswer({ question, option, text, phase: { kind: "ready" } });
  };
  const send = () => {
    if (answer === null || answer.phase.kind !== "ready") return;
    const { question: asked, option, text } = answer;
    setAnswer({ ...answer, phase: { kind: "running", doing: SENDING } });
    rpc.call("panelBoardAnswer", { instance, id: asked.id, since: asked.since, option, text }).then(
      (sent) => {
        if (!live.current) return;
        setSentFor(occurrence(asked));
        setAnswer((now) => (now === null ? null : { ...now, phase: { kind: "done", title: SENT, lines: sent.verified === false ? [sent.text, UNVERIFIED] : [sent.text] } }));
      },
      (cause: unknown) => {
        if (!live.current) return;
        const refusal = errorMessage(cause);
        const code = codeOf(refusal);
        const sentence = refusedUnsent(code) ? answerRefusal(code) : MAYBE_SENT_NEXT;
        setAnswer((now) => (now === null ? null : { ...now, phase: { kind: "failed", title: refusedUnsent(code) ? NOT_SENT : MAYBE_SENT, refusal: sentence === null ? refusal : `${sentence}\n${refusal}` } }));
      },
    );
  };
  const keys = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.metaKey || event.ctrlKey || event.altKey || answer !== null) return;
    // Keys typed into the context's own text are its own.
    if (event.target instanceof HTMLElement && event.target.closest('[data-testid="oats-panel-question-context"] [tabindex]') !== null && event.key.startsWith("Arrow")) return;
    const digit = /^[1-9]$/.test(event.key) ? Number(event.key) - 1 : -1;
    if (digit >= 0 && digit < question.options.length) {
      event.preventDefault();
      choose(digit);
    } else if ((event.key === "ArrowRight" || event.key === "ArrowLeft") && questions.length > 1) {
      event.preventDefault();
      turn(event.key === "ArrowLeft" ? -1 : 1);
      zone.current?.focus();
    } else if (event.key === "c" && question.hasContext) {
      event.preventDefault();
      // The fold is the browser's own: turned as a press on it turns it.
      const fold = zone.current?.querySelector<HTMLDetailsElement>('[data-testid="oats-panel-question-context"]');
      if (fold) fold.open = !fold.open;
    }
  };

  // The context is this occurrence's only when the detail read names the question with the same `since`.
  const read = detailState === "ok" ? detail?.questions.find((each) => each.id === question.id) : undefined;
  const proven = read !== undefined && read.since === question.since;
  const context = proven ? read.context : null;
  // No context to show yet while a read runs: it is still being read, whatever the last read held.
  const contextWords = detailState === "reading" || detailReading || (read !== undefined && !proven) ? READING_CONTEXT : detailState === "ok" ? NO_CONTEXT : DETAIL_NOTES[detailState].context;
  const note = !answerable ? terminalNote(answerLine(question, 0) ?? `${question.id}: …`) : dialog ? DIALOG_NOTE : null;

  return (
    <Section title={QUESTIONS} n={questions.length} testId="oats-panel-questions">
      {/* The zone takes the keys: a number chooses an answer to confirm, the arrows turn the questions, c opens the context. */}
      <div ref={zone} tabIndex={-1} role="group" aria-label={zoneName(at, questions.length, name)} data-testid="oats-panel-question" data-question={question.id} className="flex min-w-0 flex-col gap-2 outline-none" onKeyDown={keys}>
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
          <span data-testid="oats-panel-question-tag">
            {questionTag(at, questions.length)}
            <span title={shown(question.since)}>{` · ${askedText(question.since, now)}`}</span>
          </span>
          {questions.length < 2 ? null : (
            <span className="ml-auto flex items-center gap-1">
              {/* One dot per question, the shown one filled: how many wait, at a glance. Where there is room each is a button that shows its question. */}
              <span data-testid="oats-panel-question-dots" className="hidden items-center md:flex">
                {questions.map((each, dot) => (
                  <button
                    key={occurrence(each)}
                    type="button"
                    data-testid="oats-panel-question-dot"
                    aria-label={dotName(dot)}
                    aria-current={dot === at ? "true" : undefined}
                    className={`${TARGET} inline-flex w-5 items-center justify-center`}
                    onClick={() => {
                      setIndex(dot);
                      setShownId(each.id);
                      zone.current?.focus();
                    }}
                  >
                    <span aria-hidden="true" className={`inline-block size-2 rounded-full border border-foreground ${dot === at ? "bg-foreground" : ""}`} />
                  </button>
                ))}
              </span>
              {/* At a phone's width the dots only show: ‹ and › are the controls there, and nine targets do not fit. */}
              <span aria-hidden="true" data-testid="oats-panel-question-dots-shown" className="flex items-center gap-1.5 md:hidden">
                {questions.map((each, dot) => (
                  <span key={occurrence(each)} className={`inline-block size-2 rounded-full border border-foreground ${dot === at ? "bg-foreground" : ""}`} />
                ))}
              </span>
              <Button data-testid="oats-panel-question-previous" aria-label={PREVIOUS} title={`${PREVIOUS} (←)`} onClick={() => turn(-1)}>
                <span aria-hidden="true">‹</span>
              </Button>
              <Button data-testid="oats-panel-question-next" aria-label={NEXT} title={`${NEXT} (→)`} onClick={() => turn(1)}>
                <span aria-hidden="true">›</span>
              </Button>
            </span>
          )}
        </div>
        <p dir="auto" data-testid="oats-panel-question-text" className="m-0 break-words font-semibold text-foreground">
          {shown(question.question)}
        </p>
        <ol className="m-0 flex list-none flex-col gap-1.5 p-0">
          {question.options.map((option, each) => (
            <li key={each}>
              <button
                type="button"
                data-testid="oats-panel-question-option"
                aria-keyshortcuts={String(each + 1)}
                disabled={dialog || !answerable || answerLine(question, each) === null}
                className={`${TARGET} flex w-full min-w-0 items-center rounded-md border border-border bg-card px-3 py-1.5 text-left text-sm text-foreground hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50`}
                onClick={() => choose(each)}
              >
                <span aria-hidden="true" className="mr-2 tabular-nums text-muted-foreground">
                  {each + 1}
                </span>
                <span dir="auto" className="min-w-0 break-words">
                  {shown(option)}
                </span>
              </button>
            </li>
          ))}
        </ol>
        {note === null ? null : (
          <p role="status" data-testid="oats-panel-question-note" className="m-0 text-xs text-foreground">
            {note}
          </p>
        )}
        {note !== null || sentFor !== key ? null : (
          <p role="status" data-testid="oats-panel-question-sent" className="m-0 text-xs text-muted-foreground">
            {SENT_NOTE}
          </p>
        )}
        {!question.hasContext ? null : (
          // Keyed by the question's occurrence: another question, or the same id asked again, starts with its fold closed.
          <Disclosure key={key} summary={CONTEXT} testId="oats-panel-question-context">
            <p className="m-0 text-xs text-muted-foreground">{says(name)}</p>
            {context === null ? (
              <p className="m-0 text-muted-foreground">{contextWords}</p>
            ) : (
              // A long context scrolls inside its fold, so its text takes the focus for the keys.
              <p dir="auto" tabIndex={0} className="m-0 max-h-56 overflow-y-auto whitespace-pre-wrap break-words border-l-2 border-border pl-2 text-foreground">
                {shownBlock(context)}
              </p>
            )}
          </Disclosure>
        )}
        <p className="m-0 hidden text-xs text-muted-foreground sm:block">{zoneHint(question.options.length, questions.length)}</p>
      </div>
      {answer === null ? null : (
        <Confirm
          title={answerTitle(name)}
          about={instance}
          shownFor={instance}
          happens={answerHappens(name)}
          confirmLabel={SEND}
          phase={answer.phase}
          onConfirm={send}
          onClose={() => setAnswer(null)}
          returnFocus={() => zone.current}
        >
          <div data-testid="oats-panel-answer" className="flex min-w-0 flex-col gap-1">
            <p dir="auto" className="m-0 break-words text-muted-foreground">
              {shown(answer.question.question)}
            </p>
            {/* The line as it is sent, character for character: one line the server makes again from the kernel's board. */}
            <code data-testid="oats-panel-answer-line" className="whitespace-pre-wrap break-all rounded bg-muted px-1 py-0.5 text-xs text-foreground">
              {answer.text}
            </code>
          </div>
        </Confirm>
      )}
    </Section>
  );
}

/**
 * `board` is the board of the instance's row; `dialog` says a harness prompt is open on the
 * agent's thread, and `answerable` that a session provider runs the agent (the answers are off
 * with a prompt open, and for an agent on tmux); `name` is the agent's name as words.
 */
export function Board({ instance, board, home, name, dialog, answerable, now }: { instance: string; board: PanelBoard; home: string; name: string; dialog: boolean; answerable: boolean; now: number }) {
  const signature = detailSignature(board);
  const detail = usePanelBoard(instance, wantsDetail(board), signature);
  // A detail held from before that does not name a question the row asks with a context is behind
  // the row (it was read for an earlier board): read once more for this board, never in a loop.
  const held = detail.data;
  const behind = held !== undefined && held.state === "ok" && board.questions.some((question) => question.hasContext && !held.questions.some((each) => occurrence(each) === occurrence(question)));
  const rereadFor = useRef<string | null>(null);
  // `retry` reads the query as it is when called: it is not what this effect waits on.
  const retry = useRef(detail.retry);
  retry.current = detail.retry;
  useEffect(() => {
    if (!behind || detail.fetching || rereadFor.current === signature) return;
    rereadFor.current = signature;
    retry.current();
  }, [behind, detail.fetching, signature]);
  // A detail being read again stays as it was read until the next one lands: nothing an open
  // context or a sparkline shows goes blank for the length of a read.
  const detailState: DetailState = !wantsDetail(board) ? "ok" : detail.data !== undefined ? (detail.status === "error" ? "failed" : detail.data.state) : detail.status === "error" ? "failed" : "reading";
  if (board.state === "unsupported" || board.state === "none") return null;
  return (
    <>
      <Questions instance={instance} board={board} detail={detail.data} detailState={detailState} detailReading={detail.fetching} name={name} dialog={dialog} answerable={answerable} now={now} />
      <Facts board={board} detail={detail.data} detailState={detailState} home={home} name={name} now={now} />
    </>
  );
}
