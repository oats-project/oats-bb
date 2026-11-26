// What a place with tabs asks of an agent's board before it draws one: whether the agent has a
// board to show at all (the tab "Board" is drawn only then, as "Mail" is drawn only for an agent
// with a messaging id), and whether a question is open on it (the place then OPENS on the board:
// a question is what needs the person). The row's board, from the roster the server holds: no
// command of its own.
import { useBoard } from "./read";

/**
 * `asks` implies `shown` (both read the one board that was read: a board with an open question has something to show): a
 * place may open on a tab it draws. A board that CANNOT BE SHOWN (no board at all in its place, or entries left out as
 * out of the contract) has something to say too: its tab is drawn, so that what could not be read is said where a
 * person looks for the board, never by the board's silence.
 */
export function useBoardTab(instance: string): { /** the board's first read has landed (whatever it said): a place decides where it opens then, once */ read: boolean; /** at least one fact or one question, or a board that could not be read or shown whole */ shown: boolean; /** at least one open question */ asks: boolean } {
  const read = useBoard(instance);
  const board = read.status === "ready" ? read.board : null;
  return { read: read.status !== "loading", shown: board !== null && (board.facts.length > 0 || board.questions.length > 0 || board.malformed || board.dropped > 0), asks: board !== null && board.questions.length > 0 };
}
