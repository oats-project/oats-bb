// WHAT A PANEL SHOWS IS A FUNCTION OF THE WINDOW ALONE, at every draw: the memory's tab; but
// where the memory is Mail and Mail's marker is not this panel's agent: Instance.
// THE WINDOW holds two things, and only a press writes them: THE MEMORY (the tab of the last
// press: a tab of the panel, the thread line's Answer, the palette's Board, the header's soul
// link) and MAIL's MARKER (the agent whose Mail tab was last pressed). So a press on Board,
// Instance or Soul shows that tab in every mounted panel; a press on Mail shows Mail in the panel
// of the agent it was pressed for and Instance in every other (showing an agent's mail reads it,
// over the network, with the agent's own identities: that takes a press on THAT agent's tab).
// THE PANEL HAS NO STATE OF ITS OWN: a mount and a draw are this one function, so whatever bb
// mounts twice shows the same tab twice, however many panels it holds mounted; and an agent's
// panel left on Mail, another agent's shown, the first shown again: Mail, as a person left it.
// EVERY AGENT's PANEL HAS THE FOUR TABS, ALWAYS (Board, Instance, Soul, Mail): nothing about a
// tab depends on what has been read, so no tab ever goes away, and a tab with nothing behind it
// says so. THE PANEL NEVER CHOOSES A TAB BY ITSELF. A screen never moves under a reader.
// (What this once was, each part cut after review rounds showed it could not be made sure on
// what bb does, which mounts a panel twice now and then and holds answers from earlier showings:
// the panel opening on Board by itself where the agent's board asked; tabs drawn only where
// there was something behind them; a tab held by each panel, moved by counted presses.)
// Its truth table: test/panel/tab-state.test.ts.

/** The panel's tabs: the four, for every agent. */
export type TabId = "board" | "instance" | "soul" | "mail";

/** What the window holds: the tab of the last press, and the agent whose Mail tab was last pressed. One value: a press makes a new one. */
export type Window = { readonly memory: TabId; readonly mailOf: string | null };

/** The tab the panel of `instance` shows. */
export function tabOf(window: Window, instance: string): TabId {
  return window.memory === "mail" && window.mailOf !== instance ? "instance" : window.memory;
}
