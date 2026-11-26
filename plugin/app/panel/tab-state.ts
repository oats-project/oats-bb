// THE PANEL's SHOWN TAB IS ONE STATE of the panel of one agent, and it changes on exactly TWO
// events, and on no other:
//   1. THE MOUNT: the memory's tab. Mail only where it was pressed for THIS agent, else Instance.
//   2. A PRESS (an event, also where it names the tab already remembered): the tab pressed. A
//      press on MAIL moves only the panel of the agent it was pressed for: every other mounted
//      panel keeps its tab (bb may hold two agents' panels mounted at once: an agent's mail is
//      read only by a press on THAT agent's tab). A press on Board, Instance or Soul moves every
//      mounted panel: the window's one memory, and it reads nothing.
// EVERY AGENT's PANEL HAS THE FOUR TABS, ALWAYS (Board, Instance, Soul, Mail): nothing about a
// tab depends on what has been read, so no tab ever goes away, and a tab with nothing behind it
// says so. THE PANEL NEVER CHOOSES A TAB BY ITSELF: it opens where it was left.
// THE MEMORY (one for the window) is what a press writes and what a mount reads. MAIL's MARKER
// (whose press Mail's was) is written by a press on Mail, for the agent it was pressed on, and
// by nothing else: no mount drops it; the next press on Mail replaces it. So whatever bb mounts
// twice reads the same memory and the same marker twice: the same tab twice; and an agent's
// panel left on Mail, another agent's shown, the first shown again: Mail, as a person left it.
// THE ONE WAY TO A QUESTION is a person's press: the thread's own "Needs you … Answer" line and
// the palette's Board write the memory and open the panel (the home's card draws the question
// itself). A screen never moves under a reader.
// No count of mounted panels, no clock: the memory, the marker and the count of presses.
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

/** What is true at a draw: the presses counted, the tab the last press named, and whose press Mail's was. */
export type Now = { presses: number; pressedTab: TabId; mailOf: string | null };

/** 2: a press, for the panel of `instance`. THE SAME STATE BACK where none came. */
export function moved(state: TabState, now: Now, instance: string): TabState {
  if (now.presses === state.presses) return state;
  // A press on Mail is the press of ONE agent's panel: another agent's panel keeps its tab, and takes the count.
  return { presses: now.presses, tab: now.pressedTab === "mail" && now.mailOf !== instance ? state.tab : now.pressedTab };
}
