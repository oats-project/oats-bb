// The panel's shown tab: ONE state, TWO events (app/panel/tab-state.ts), as a table: the mount and
// a press. Every agent's panel has the four tabs, always: nothing about a tab depends on what has
// been read, so the state is given nothing of it. The paths the board's review rounds found, while
// the panel still opened on Board by itself and drew a tab only where something stood behind it,
// are rows here: those that are still possible as they were, and those about the panel moving by
// itself as ONE row each of "it does not move". The same paths through the panel itself, as a
// person meets them: test/board/panel-tabs.test.tsx.
import { describe, expect, it } from "vitest";
import { mountedOn, moved, type Now, type TabId, type TabState, type Window } from "../../app/panel/tab-state";

const window = (over: Partial<Window> = {}): Window => ({ memory: "instance", mailOf: null, presses: 0, ...over });
const state = (tab: TabId, presses = 0): TabState => ({ tab, presses });
const now = (over: Partial<Now> = {}): Now => ({ presses: 0, pressedTab: "instance", mailOf: null, ...over });

describe("1. THE MOUNT: the memory's tab", () => {
  const cases: [string, Window, string, TabId][] = [
    ["the memory's tab", window({ memory: "soul" }), "a", "soul"],
    ["the memory on Board: Board, for every agent (an agent with no board has the tab too: it says so)", window({ memory: "board" }), "a", "board"],
    ["the memory on Instance, for an agent whose board asks: Instance. The panel does not open on Board by itself", window({ memory: "instance" }), "a", "instance"],
    ["Mail, pressed for THIS agent", window({ memory: "mail", mailOf: "a" }), "a", "mail"],
    ["Mail, pressed for ANOTHER agent: Instance (mail is read only by a press on that agent's tab)", window({ memory: "mail", mailOf: "b" }), "a", "instance"],
    ["Mail, with no marker (a window that was reset): Instance", window({ memory: "mail", mailOf: null }), "a", "instance"],
    ["Mail, pressed for this agent, AFTER another agent's panel was shown: Mail, as a person left it (no mount drops the marker)", window({ memory: "mail", mailOf: "a" }), "a", "mail"],
  ];
  for (const [what, held, instance, tab] of cases) it(what, () => expect(mountedOn(held, instance).tab).toBe(tab));

  it("whatever bb mounts TWICE reads the same memory and the same marker twice: the same tab twice, for every tab (round 2: Answer for a claim that is not the board's; round 4: bb's second mount; the delta read: Mail, and Board)", () => {
    for (const memory of ["instance", "board", "soul", "mail"] as const) {
      const held = window({ memory, mailOf: "a", presses: 7 });
      expect([mountedOn(held, "a"), mountedOn(held, "a")], memory).toEqual([state(memory, 7), state(memory, 7)]);
    }
    // And for another agent's panel: Instance twice (its mounts drop nothing: the marker is the same at both).
    expect([mountedOn(window({ memory: "mail", mailOf: "a" }), "b").tab, mountedOn(window({ memory: "mail", mailOf: "a" }), "b").tab]).toEqual(["instance", "instance"]);
  });

  it("the mount is given NOTHING of what was read (the board, the instance, the mail): only the window's memory, Mail's marker and the count of presses", () => {
    expect(mountedOn.length).toBe(2);
    expect(Object.keys(window()).sort()).toEqual(["mailOf", "memory", "presses"]);
  });
});

describe("2. A PRESS: the tab pressed", () => {
  it("a press names another tab", () => {
    expect(moved(state("instance"), now({ presses: 1, pressedTab: "soul" }), "a")).toEqual(state("soul", 1));
  });
  it("a press that names the tab the MEMORY already holds moves a panel that shows another (the press is an event, not a change of the memory: round 2, major)", () => {
    // The memory holds Mail, pressed for another agent: this panel mounted on Instance. A press here on Mail is obeyed.
    const mounted = mountedOn(window({ memory: "mail", mailOf: "b", presses: 2 }), "a");
    expect(mounted.tab).toBe("instance");
    expect(moved(mounted, now({ presses: 3, pressedTab: "mail", mailOf: "a" }), "a").tab).toBe("mail"); // (the press writes the marker: this agent's)
  });
  it("the thread line's Answer, the home's card, the palette's Board are presses: Board for the board's own claim, Instance for any other, whatever tab is shown", () => {
    expect(moved(state("soul", 3), now({ presses: 4, pressedTab: "board" }), "a").tab).toBe("board");
    expect(moved(state("board", 3), now({ presses: 4, pressedTab: "instance" }), "a").tab).toBe("instance");
  });
  it("A PRESS ON MAIL MOVES ONLY THE PANEL OF THE AGENT IT WAS PRESSED FOR: another agent's mounted panel keeps its tab, whatever it shows, and takes the count (the second delta read: two agents' panels mounted at once; an agent's mail is read only by a press on its own tab)", () => {
    for (const tab of ["board", "instance", "soul"] as const) {
      const other = moved(state(tab, 3), now({ presses: 4, pressedTab: "mail", mailOf: "a" }), "b");
      expect(other, tab).toEqual(state(tab, 4));
      // The count was taken: the same press is not seen again, and the next one is an event for this panel too.
      expect(moved(other, now({ presses: 4, pressedTab: "mail", mailOf: "a" }), "b")).toBe(other);
      expect(moved(other, now({ presses: 5, pressedTab: "soul", mailOf: "a" }), "b").tab).toBe("soul");
    }
    expect(moved(state("instance", 3), now({ presses: 4, pressedTab: "mail", mailOf: "a" }), "a").tab).toBe("mail");
  });
  it("a press on Board, Instance or Soul moves EVERY mounted panel: the window's one memory (it reads nothing)", () => {
    for (const instance of ["a", "b"]) expect(moved(state("mail", 3), now({ presses: 4, pressedTab: "soul", mailOf: "a" }), instance).tab, instance).toBe("soul");
  });
});

describe("IT DOES NOT MOVE: no press, the same state back (the same object), whatever the agent and bb do", () => {
  // The state is not given the board, the instance or the mail at all: only the presses counted and the tab the last press named.
  for (const [what, tab] of [
    ["the agent ASKS while the panel is open on Instance (rounds 1 and 4): it stays; the thread's own line says it", "instance"],
    ["the agent CLEARS its question while a person reads its facts on Board (round 1): it stays", "board"],
    ["the agent clears its LAST fact and question while the panel is on Board (round 3): it stays on Board, which says \"No questions.\"; the tab does not go, so nothing falls and nothing comes back", "board"],
    ["a board that starts to ask does not take a reader from Mail (round 1)", "mail"],
    ["the board's read fails, answers, is held from an earlier showing, or disagrees with the roster's row (round 4 and the delta read): the tab shown reads none of it", "soul"],
  ] as const) {
    it(what, () => {
      const held = state(tab, 4);
      expect(moved(held, now({ presses: 4, pressedTab: "instance" }), "a")).toBe(held);
    });
  }
  it("`moved` is given nothing of what was read either: the presses counted, the tab the last press named, Mail's marker, and whose panel it is", () => {
    expect(Object.keys(now()).sort()).toEqual(["mailOf", "pressedTab", "presses"]);
    expect(moved.length).toBe(3);
  });
});
