// THE PANEL's SHOWN TAB IS ONE STATE of the panel of one agent. THE PANEL NEVER CHOOSES A TAB BY
// ITSELF: it opens where it was left, and it changes on exactly THREE events, and on no other
// (the rule of the panel: nothing is derived at a draw):
//   1. MOUNT: the memory's tab. Mail only where it was pressed for THIS agent; a tab that is not
//      drawn for this agent (or not yet known to be): Instance.
//   2. A PRESS (an event, also where it names the tab already remembered): the tab pressed.
//   3. THE TAB SHOWN STOPS BEING DRAWN: Instance, and it STAYS there: a tab that is drawn again
//      later does not take the panel back.
// The memory (one for the window) is only what a press writes and what a mount reads: the
// panel's own move (3, and not opening on another agent's Mail) writes nothing to it. So
// whatever bb mounts twice reads the same memory twice, and an answer bb holds from before a
// mount decides nothing about the tab.
// THE ONE WAY TO A QUESTION is a person's press: the thread's own "Needs you … Answer" line, the
// home's card, the palette's Board: each writes the memory and opens the panel. A screen never
// moves under a reader: a question asked while the panel is open on another tab is said by the
// thread's line. (The panel once opened on Board by itself where the agent's board asked: four
// review rounds showed that it could not be made sure on what bb does, and it was cut.)
// Pure: Panel.tsx holds the state and feeds it what is true at each draw
// (test/panel/tab-state.test.ts is the three events as a table).

/** The panel's tabs. */
export type TabId = "board" | "instance" | "soul" | "mail";

/**
 * Which tabs are drawn for one agent. Board: where its board has a fact, a question, or could not
 * be read or shown; and, until this mount's own read of the board has ended and where that read
 * FAILED, where the agent's row says it has a board (so that the tab is there at once, and "could
 * not be read" with Retry can be reached). Mail: where the row gives a messaging id. Instance and
 * Soul: always.
 */
export type Drawn = { board: boolean; mail: boolean };
export const isDrawn = (tab: TabId, drawn: Drawn): boolean => (tab === "board" ? drawn.board : tab === "mail" ? drawn.mail : true);

export type TabState = {
  tab: TabId;
  /** the presses counted when this state was last moved by one */
  presses: number;
};

/** What the window holds when a panel mounts: its one memory, whose press Mail's was, and the presses counted so far. */
export type Window = { memory: TabId; mailOf: string | null; presses: number };

/** 1: the mount. */
export function mountedOn(window: Window, instance: string, drawn: Drawn): TabState {
  const memory = window.memory === "mail" && window.mailOf !== instance ? "instance" : window.memory;
  return { tab: isDrawn(memory, drawn) ? memory : "instance", presses: window.presses };
}

/** What is true at a draw: the presses counted, the tab the last press named, the tabs drawn. */
export type Now = { presses: number; pressedTab: TabId; drawn: Drawn };

/** 2 and 3: what the state becomes, given what is true now. THE SAME STATE BACK where no event came. */
export function moved(state: TabState, now: Now): TabState {
  let next = state;
  if (now.presses !== next.presses) next = { presses: now.presses, tab: now.pressedTab };
  if (!isDrawn(next.tab, now.drawn)) next = { ...next, tab: "instance" };
  return next;
}
