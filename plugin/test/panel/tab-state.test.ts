// The panel's shown tab: ONE state, THREE events (app/panel/tab-state.ts), as a table: the mount,
// a press, the tab shown no longer being drawn. THE PANEL NEVER CHOOSES A TAB BY ITSELF: the
// paths four review rounds of the board found, while the panel still opened on Board where the
// agent's board asked, are rows here: the ones that are still possible as they were, and the ones
// about the panel moving by itself as ONE row each of "it does not move". The same paths through
// the panel itself, as a person meets them: test/board/panel-tab, panel-tabs-together and
// round1 to round4 of the panel.
import { describe, expect, it } from "vitest";
import { mountedOn, moved, type Drawn, type Now, type TabId, type TabState, type Window } from "../../app/panel/tab-state";

const ALL: Drawn = { board: true, mail: true };
const NO_BOARD: Drawn = { board: false, mail: true };
const NO_MAIL: Drawn = { board: true, mail: false };
const window = (over: Partial<Window> = {}): Window => ({ memory: "instance", mailOf: null, presses: 0, ...over });
const state = (tab: TabId, presses = 0): TabState => ({ tab, presses });
const now = (over: Partial<Now> = {}): Now => ({ presses: 0, pressedTab: "instance", drawn: ALL, ...over });

describe("1. MOUNT: the memory's tab", () => {
  const cases: [string, Window, string, Drawn, TabId][] = [
    ["the memory's tab, where it is drawn", window({ memory: "soul" }), "a", ALL, "soul"],
    ["the memory on Board, for an agent with a board", window({ memory: "board" }), "a", ALL, "board"],
    ["a tab that is not drawn for this agent: Instance", window({ memory: "board" }), "a", NO_BOARD, "instance"],
    ["Mail, pressed for THIS agent", window({ memory: "mail", mailOf: "a" }), "a", ALL, "mail"],
    ["Mail, pressed for ANOTHER agent: Instance (mail is read only by a press on that agent's tab)", window({ memory: "mail", mailOf: "b" }), "a", ALL, "instance"],
    ["Mail, pressed for nobody any more: Instance", window({ memory: "mail", mailOf: null }), "a", ALL, "instance"],
    ["Mail, pressed for this agent, not (yet known to be) drawn: Instance", window({ memory: "mail", mailOf: "a" }), "a", NO_MAIL, "instance"],
  ];
  for (const [what, held, instance, drawn, tab] of cases) it(what, () => expect(mountedOn(held, instance, drawn).tab).toBe(tab));

  it("whatever bb mounts TWICE reads the same memory twice: the same tab (round 4: bb's second mount of a panel; round 2: the panel opened by Answer for a claim that is not the board's)", () => {
    for (const memory of ["instance", "board", "soul"] as const) {
      const first = mountedOn(window({ memory, presses: 7 }), "a", ALL);
      const second = mountedOn(window({ memory, presses: 7 }), "a", ALL);
      expect([first.tab, second.tab], memory).toEqual([memory, memory]);
    }
  });

  it("the memory on Instance, for an agent whose board asks: Instance. The panel does not open on Board by itself (the cut)", () => {
    expect(mountedOn(window({ memory: "instance" }), "a", ALL).tab).toBe("instance");
  });
});

describe("2. A PRESS: the tab pressed", () => {
  it("a press names another tab", () => {
    expect(moved(state("instance"), now({ presses: 1, pressedTab: "soul" }))).toEqual(state("soul", 1));
  });
  it("a press that names the tab the MEMORY already holds moves a panel that fell to Instance when its tab went (the press is an event, not a change of the memory)", () => {
    const fell = moved(state("board", 1), now({ presses: 1, pressedTab: "board", drawn: NO_BOARD }));
    expect(fell.tab).toBe("instance");
    expect(moved(fell, now({ presses: 2, pressedTab: "board", drawn: ALL })).tab).toBe("board");
  });
  it("the thread line's Answer, the home's card, the palette's Board are presses: Board for the board's own claim, Instance for any other, whatever tab is shown (round 2, major)", () => {
    expect(moved(state("soul", 3), now({ presses: 4, pressedTab: "board" })).tab).toBe("board");
    expect(moved(state("board", 3), now({ presses: 4, pressedTab: "instance" })).tab).toBe("instance");
  });
  it("a press that names a tab not drawn for this agent lands on Instance", () => {
    expect(moved(state("soul"), now({ presses: 1, pressedTab: "board", drawn: NO_BOARD })).tab).toBe("instance");
  });
});

describe("3. THE TAB SHOWN STOPS BEING DRAWN: Instance, and it stays", () => {
  it("the Board tab goes (its last fact and question gone): Instance", () => {
    expect(moved(state("board"), now({ drawn: NO_BOARD })).tab).toBe("instance");
  });
  it("and a Board tab that is drawn AGAIN does not take the panel back, whatever the memory holds (round 3, major: Answer, the question cleared, the next question asked)", () => {
    const fell = moved(state("board", 1), now({ presses: 1, pressedTab: "board", drawn: NO_BOARD }));
    expect(moved(fell, now({ presses: 1, pressedTab: "board", drawn: ALL }))).toBe(fell);
  });
  it("the Mail tab goes (the row no longer gives a messaging id): Instance, and it stays", () => {
    const fell = moved(state("mail"), now({ pressedTab: "mail", drawn: NO_MAIL }));
    expect(fell.tab).toBe("instance");
    expect(moved(fell, now({ pressedTab: "mail", drawn: ALL }))).toBe(fell);
  });
});

describe("IT DOES NOT MOVE: no event, the same state back (the same object), whatever the agent's board does", () => {
  // The state is not given the board at all: only the presses counted, the tab the last press named, the tabs drawn.
  it("the agent ASKS while the panel is open on Instance (rounds 1 and 4): it stays; the thread's own line says it", () => {
    const held = state("instance", 2);
    expect(moved(held, now({ presses: 2, pressedTab: "instance", drawn: ALL }))).toBe(held);
  });
  it("the agent CLEARS its question while a person reads its facts on Board (round 1): it stays while the tab is drawn", () => {
    const held = state("board", 2);
    expect(moved(held, now({ presses: 2, pressedTab: "board", drawn: ALL }))).toBe(held);
  });
  it("the agent asks AGAIN after the panel fell to Instance (round 3): it stays on Instance", () => {
    const fell = moved(state("board", 2), now({ presses: 2, pressedTab: "board", drawn: NO_BOARD }));
    expect(moved(fell, now({ presses: 2, pressedTab: "board", drawn: ALL }))).toBe(fell);
  });
  it("a board that starts to ask does not take a reader from Mail, nor from any tab (round 1)", () => {
    for (const tab of ["board", "instance", "soul", "mail"] as const) {
      const held = state(tab, 4);
      expect(moved(held, now({ presses: 4, pressedTab: "soul", drawn: ALL })), tab).toBe(held);
    }
  });
});
