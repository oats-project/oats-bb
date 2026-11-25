// What a place with tabs asks of an agent's board before it draws one: whether the agent has a
// board to show at all (the tab "Board" is drawn only then, as "Mail" is drawn only for an agent
// with a messaging id), and whether a question is open on it (the place then OPENS on the board:
// a question is what needs the person). The row's board, from the roster the server holds: no
// command of its own.
import { useBoard } from "./read";

export function useBoardTab(instance: string): { /** at least one fact or one question */ shown: boolean; /** at least one open question */ asks: boolean } {
  const read = useBoard(instance);
  const board = read.status === "ready" ? read.board : null;
  return { shown: board !== null && (board.facts.length > 0 || board.questions.length > 0), asks: board !== null && board.questions.length > 0 };
}
