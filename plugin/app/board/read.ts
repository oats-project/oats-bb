// The board's own reads of one agent (app/store.ts says how the plugin's reads work):
// - the row's board, from the roster the server holds: live (read again when the server publishes
//   `oats/changed`), at no command's cost;
// - its detail (each fact's history, each question's context): `oats inspect --home --board`, a
//   command of its own, so read ONCE when the board is in view and has something to read it for,
//   and again only when what it was read for changed (`detailSignature`: a fact changed, a
//   question with context was asked). Never on a timer.
import { useState, useEffect, useMemo, useRef } from "react";
import { experimental_useRpcQuery as useRpcQuery, useRealtime } from "@get-bb/plugin-sdk/app";
import { REALTIME_CHANGED, rpcContract } from "../../contract";
import { boardData, boardDetailData, detailSignature, type Board, type BoardClaim, type BoardDetail } from "../../model/board";
import { errorMessage, onWindowReset, reread } from "../store";

export type BoardRead =
  | { status: "loading" }
  /** the read failed and nothing is held */
  | { status: "error"; error: string; retry(): void }
  /** this kernel says nothing of boards (an older OATS): nothing is drawn */
  | { status: "unsupported" }
  /** (A later read that fails leaves what was read: the roster's own notice says that OATS cannot be read, and holds every act.) */
  | { status: "ready"; board: Board | null; claim: BoardClaim; retry(): void };

/** The row's board of `instance`, kept fresh. */
export function useBoard(instance: string): BoardRead {
  const query = useRpcQuery({ contract: rpcContract, method: "board", input: { instance } });
  const refetch = useRef(query.refetch);
  useEffect(() => {
    refetch.current = query.refetch;
  });
  const first = useRef(false);
  first.current = query.isFetching && query.data === undefined;
  useRealtime(REALTIME_CHANGED, () => reread(`board ${instance}`, first.current, () => refetch.current()));
  const data = query.data;
  // Read once per answer: the same object for the same answer, so that what depends on it does not run again.
  const board = useMemo(() => (data === undefined ? null : boardData(data.board)), [data]);
  const retry = () => void refetch.current();
  if (data === undefined) return query.error === null ? { status: "loading" } : { status: "error", error: errorMessage(query.error), retry };
  if (!data.supported) return { status: "unsupported" };
  return { status: "ready", board, claim: data.claim, retry };
}

/** What each agent's held detail was read for (the board's signature), in this app window. */
const detailReadFor = new Map<string, string>();
onWindowReset(() => detailReadFor.clear());

export type DetailRead =
  /** nothing to read it for (no fact, and no question with context) */
  | { status: "idle" }
  | { status: "loading" }
  | { status: "failed" }
  | { status: "read"; detail: BoardDetail };

/**
 * The board's detail (a command: `oats inspect`), read ONCE when it is first `wanted` (the board is in view) for the
 * agent in this window, and again only when the board it was read for changed. A board shown again (a tab turned back
 * to) shows what was read: bb's query client would read a mounted query again once its answer is 2 s old, so the
 * query is on only while it holds no answer (the panel's own reads do the same: app/panel/read.ts).
 */
export function useBoardDetail(instance: string, board: Board | null, wanted: boolean, { questionsOnly = false }: { /** the place draws the questions alone (the home's card): a detail is needed only for a context */ questionsOnly?: boolean } = {}): DetailRead {
  const needed = board !== null && ((!questionsOnly && board.facts.length > 0) || board.questions.some((each) => each.hasContext));
  // (Of the WHOLE board, whichever place reads: the one answer bb holds for the agent is read for one thing.)
  const signature = detailSignature(board);
  const [on, setOn] = useState(false);
  const query = useRpcQuery({ contract: rpcContract, method: "boardDetail", input: { instance }, enabled: wanted && needed && on });
  const held = query.data !== undefined;
  useEffect(() => setOn(!held), [held]);
  const refetch = useRef(query.refetch);
  useEffect(() => {
    refetch.current = query.refetch;
  });
  // What the held answer was read for: a change of it is the one reason to read again. Kept by agent, OUTSIDE this
  // part: the board may change while no part that shows it is mounted (the panel on another tab; the agent asks), and
  // the part that mounts then holds an answer read for the board as it was: it reads again.
  useEffect(() => {
    if (!(wanted && needed)) return;
    const readFor = detailReadFor.get(instance);
    detailReadFor.set(instance, signature);
    if (readFor !== undefined && readFor !== signature) void refetch.current();
  }, [instance, signature, wanted, needed]);
  const data = query.data;
  const detail = useMemo(() => (data === undefined ? null : boardDetailData(data.inspection)), [data]);
  if (!needed) return { status: "idle" };
  if (detail !== null) return { status: "read", detail };
  return query.error !== null ? { status: "failed" } : { status: "loading" };
}
