// THE PANEL's SHOWN TAB IS ONE STATE of the panel of one agent, and it changes on exactly FOUR
// events, and on no other (the rule of the panel: nothing is derived at a draw):
//   1. MOUNT: the memory's tab. Mail only where it was pressed for THIS agent; a tab that is not
//      drawn for this agent (or not yet known to be): Instance. A press made FOR this agent just
//      before its panel opened (the thread line's Answer) is the memory it reads, once, and
//      counts as a press on this panel.
//   2. THE BOARD's FIRST READ ANSWERS (once per panel; a failed read is not an answer): Board, if
//      a question is open then and no press came since the mount. Otherwise nothing.
//   3. A PRESS (an event, also where it names the tab already remembered): the tab pressed.
//   4. THE TAB SHOWN STOPS BEING DRAWN: Instance, and it STAYS there: a tab that is drawn again
//      later does not take the panel back.
// The memory (one for the window) is only what a press writes and what a mount reads: the
// panel's own moves (2 and 4, and not opening on another agent's Mail) write nothing to it.
// A screen never moves under a reader: a new question on a panel that stays where it is is said
// by the thread's own "Needs you … Answer" line.
// Pure: Panel.tsx holds the state and feeds it what is true at each draw
// (test/panel/tab-state.test.ts is the four transitions as a table).

/** The panel's tabs. */
export type TabId = "board" | "instance" | "soul" | "mail";

/**
 * Which tabs are drawn for one agent. Board: where its board has a fact, a question, or could not
 * be read or shown; and, until the board's own read has answered and where that read FAILED,
 * where the agent's row says it has a board (so that the tab is there at once, and "could not be
 * read" with Retry can be reached). Mail: where the row gives a messaging id. Instance and Soul:
 * always.
 */
export type Drawn = { board: boolean; mail: boolean };
export const isDrawn = (tab: TabId, drawn: Drawn): boolean => (tab === "board" ? drawn.board : tab === "mail" ? drawn.mail : true);

export type TabState = {
  tab: TabId;
  /** the presses counted when this state was last moved by one */
  presses: number;
  /** a press came since the mount (or was made for this agent just before it) */
  pressed: boolean;
  /** the board's first read has answered */
  answered: boolean;
};

/** What the window holds when a panel mounts: its one memory, whose press Mail's was, the presses counted so far, and whether the last press was made for this agent's panel. */
export type Window = { memory: TabId; mailOf: string | null; presses: number; pressedFor: boolean };

/** 1: the mount. */
export function mountedOn(window: Window, instance: string, drawn: Drawn): TabState {
  const memory = window.memory === "mail" && window.mailOf !== instance ? "instance" : window.memory;
  return { tab: isDrawn(memory, drawn) ? memory : "instance", presses: window.presses, pressed: window.pressedFor, answered: false };
}

/** What is true at a draw: the presses counted, the tab the last press named, the board's read, the tabs drawn. */
export type Now = { presses: number; pressedTab: TabId; board: { answered: boolean; asks: boolean }; drawn: Drawn };

/** 3, 2 and 4: what the state becomes, given what is true now. THE SAME STATE BACK where no event came. */
export function moved(state: TabState, now: Now): TabState {
  let next = state;
  if (now.presses !== next.presses) next = { ...next, presses: now.presses, pressed: true, tab: now.pressedTab };
  if (!next.answered && now.board.answered) next = { ...next, answered: true, tab: now.board.asks && !next.pressed ? "board" : next.tab };
  if (!isDrawn(next.tab, now.drawn)) next = { ...next, tab: "instance" };
  return next;
}
