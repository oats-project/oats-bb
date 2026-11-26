// THE PANEL's SHOWN TAB IS ONE STATE of the panel of one agent, and it changes on exactly TWO
// events, and on no other:
//   1. THE MOUNT: the memory's tab. Mail only where it was pressed for THIS agent, else Instance.
//   2. A PRESS (an event, also where it names the tab already remembered): the tab pressed.
// EVERY AGENT's PANEL HAS THE FOUR TABS, ALWAYS (Board, Instance, Soul, Mail): nothing about a
// tab depends on what has been read, so no tab ever goes away, and a tab with nothing behind it
// says so. THE PANEL NEVER CHOOSES A TAB BY ITSELF: it opens where it was left.
// THE MEMORY (one for the window) is what a press writes and what a mount reads. Mail's marker
// (whose press it was) is dropped by another agent's panel that finds the memory on Mail. So
// whatever bb mounts twice reads the same memory and the same marker twice: the same tab twice.
// THE ONE WAY TO A QUESTION is a person's press: the thread's own "Needs you … Answer" line, the
// home's card, the palette's Board: each writes the memory and opens the panel. A screen never
// moves under a reader.
// (Two things this state once did were cut, each after review rounds showed it could not be
// made sure on what bb does, which mounts a panel twice now and then and holds answers from
// earlier showings: the panel opening on Board by itself where the agent's board asked; and
// tabs drawn only where there was something behind them, which made the tab shown depend on
// what a mount had read.)
// Pure: Panel.tsx holds the state and feeds it what is true at each draw
// (test/panel/tab-state.test.ts is the two events as a table).

/** The panel's tabs: the four, for every agent. */
export type TabId = "board" | "instance" | "soul" | "mail";

export type TabState = {
  tab: TabId;
  /** the presses counted when this state was last moved by one */
  presses: number;
};

/** What the window holds when a panel mounts: its one memory, whose press Mail's was, and the presses counted so far. */
export type Window = { memory: TabId; mailOf: string | null; presses: number };

/** 1: the mount. */
export function mountedOn(window: Window, instance: string): TabState {
  return { tab: window.memory === "mail" && window.mailOf !== instance ? "instance" : window.memory, presses: window.presses };
}

/** What is true at a draw: the presses counted, and the tab the last press named. */
export type Now = { presses: number; pressedTab: TabId };

/** 2: a press. THE SAME STATE BACK where none came. */
export function moved(state: TabState, now: Now): TabState {
  return now.presses === state.presses ? state : { presses: now.presses, tab: now.pressedTab };
}
