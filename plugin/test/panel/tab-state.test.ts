// The panel's shown tab: ONE state, four transitions (app/panel/tab-state.ts), as a table. Each
// row is one event and what the state becomes; the paths three review rounds of the board found
// are rows of it, named by their round. The same paths through the panel itself, as a person
// meets them, are test/board/round1-panel, round2-panel, round3-panel and panel-tabs-together.
import { describe, expect, it } from "vitest";
import { mountedOn, moved, type Drawn, type Now, type TabId, type TabState, type Window } from "../../app/panel/tab-state";

const ALL: Drawn = { board: true, mail: true };
const NO_BOARD: Drawn = { board: false, mail: true };
const NO_MAIL: Drawn = { board: true, mail: false };
const window = (over: Partial<Window> = {}): Window => ({ memory: "instance", mailOf: null, presses: 0, pressedFor: false, ...over });
const state = (tab: TabId, over: Partial<TabState> = {}): TabState => ({ tab, presses: 0, pressed: false, answered: false, ...over });
const now = (over: Partial<Now> = {}): Now => ({ presses: 0, pressedTab: "instance", board: { answered: false, asks: false }, drawn: ALL, ...over });

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

  it("a press made FOR this agent just before its panel opened is the memory it reads, and counts as a press on this panel (round 2: Answer for a claim that is not the board's)", () => {
    const mounted = mountedOn(window({ memory: "instance", presses: 7, pressedFor: true }), "a", ALL);
    expect(mounted).toEqual({ tab: "instance", presses: 7, pressed: true, answered: false });
    // so the board's first answer, with a question open, does not take the panel to Board
    expect(moved(mounted, now({ presses: 7, board: { answered: true, asks: true } })).tab).toBe("instance");
  });

  it("presses made before the mount are not this panel's (round 2: the memory left on Soul, then a panel whose board asks)", () => {
    const mounted = mountedOn(window({ memory: "soul", presses: 3 }), "a", ALL);
    expect([mounted.pressed, moved(mounted, now({ presses: 3, pressedTab: "soul", board: { answered: true, asks: true } })).tab]).toEqual([false, "board"]);
  });
});

describe("2. THE BOARD's FIRST READ ANSWERS, once per panel", () => {
  it("Board, where a question is open then and no press came since the mount", () => {
    expect(moved(state("instance"), now({ board: { answered: true, asks: true } }))).toEqual(state("board", { answered: true }));
  });
  it("nothing, where no question is open then (facts alone): the memory's tab stays", () => {
    expect(moved(state("soul"), now({ board: { answered: true, asks: false } }))).toEqual(state("soul", { answered: true }));
  });
  it("nothing, where a press came since the mount", () => {
    expect(moved(state("soul", { pressed: true }), now({ board: { answered: true, asks: true } })).tab).toBe("soul");
  });
  it("a read that FAILED is not an answer: nothing moves, and the answer that comes later is the first (round 3, minor)", () => {
    const held = state("instance");
    const failed = moved(held, now({ board: { answered: false, asks: false } }));
    expect(failed).toBe(held); // the same object back: no event
    expect(failed.answered).toBe(false);
    expect(moved(failed, now({ board: { answered: true, asks: true } })).tab).toBe("board");
  });
  it("an answer bb HOLDS from before the mount is not this panel's first answer (round 4, major): it is not `answered`, so nothing moves; the read that ends since the mount decides, both ways", () => {
    // (What is held is shown by the board itself; to the state it is `answered: false`, whatever it says.)
    const mounted = mountedOn(window({ memory: "instance" }), "a", ALL);
    expect(moved(mounted, now({ board: { answered: false, asks: true } }))).toBe(mounted); // held: "a question is open": not Board yet
    expect(moved(mounted, now({ board: { answered: true, asks: false } })).tab).toBe("instance"); // this mount's read: cleared meanwhile: not Board
    expect(moved(mounted, now({ board: { answered: false, asks: false } }))).toBe(mounted); // held: "no question"
    expect(moved(mounted, now({ board: { answered: true, asks: true } })).tab).toBe("board"); // this mount's read: asked meanwhile: Board
  });
  it("a press made FOR this agent holds at every mount of its panel within its time (round 4, major: bb mounts a panel twice a moment apart)", () => {
    for (const mount of [1, 2]) {
      const mounted = mountedOn(window({ memory: "instance", presses: 5, pressedFor: true }), "a", ALL);
      expect(moved(mounted, now({ presses: 5, board: { answered: true, asks: true } })).tab, `mount ${mount}`).toBe("instance");
    }
  });
  it("ONCE: a question asked AFTER the first answer does not move an open panel (round 1: the agent asks under a reader)", () => {
    const answered = moved(state("instance"), now({ board: { answered: true, asks: false } }));
    expect(moved(answered, now({ board: { answered: true, asks: true } }))).toBe(answered);
  });
  it("ONCE: a question CLEARED after the panel opened on Board leaves it there while the tab is drawn (round 1: the agent clears its question under a person reading its facts)", () => {
    const onBoard = moved(state("instance"), now({ board: { answered: true, asks: true } }));
    expect(moved(onBoard, now({ board: { answered: true, asks: false } }))).toBe(onBoard);
  });
});

describe("3. A PRESS: the tab pressed", () => {
  it("a press names another tab", () => {
    expect(moved(state("instance", { answered: true }), now({ presses: 1, pressedTab: "soul", board: { answered: true, asks: false } }))).toEqual(state("soul", { presses: 1, pressed: true, answered: true }));
  });
  it("a press that names the tab the MEMORY already holds moves a panel that opened on Board by itself (round 2, major: the soul link, Answer for a claim that is not the board's)", () => {
    const onBoard = moved(mountedOn(window({ memory: "soul", presses: 2 }), "a", ALL), now({ presses: 2, pressedTab: "soul", board: { answered: true, asks: true } }));
    expect(onBoard.tab).toBe("board");
    expect(moved(onBoard, now({ presses: 3, pressedTab: "soul", board: { answered: true, asks: true } })).tab).toBe("soul");
  });
  it("a chosen tab is kept: a board that starts to ask does not take a reader from Mail, nor from any tab they pressed (round 1)", () => {
    const onMail = moved(state("instance", { answered: true }), now({ presses: 1, pressedTab: "mail", board: { answered: true, asks: false } }));
    expect(moved(onMail, now({ presses: 1, pressedTab: "mail", board: { answered: true, asks: true } }))).toBe(onMail);
  });
  it("a press that names a tab not drawn for this agent lands on Instance", () => {
    expect(moved(state("soul", { answered: true }), now({ presses: 1, pressedTab: "board", board: { answered: true, asks: false }, drawn: NO_BOARD })).tab).toBe("instance");
  });
  it("a press and the board's first answer seen in one draw: the press is the person's, and it wins", () => {
    expect(moved(state("instance"), now({ presses: 1, pressedTab: "soul", board: { answered: true, asks: true } })).tab).toBe("soul");
  });
});

describe("4. THE TAB SHOWN STOPS BEING DRAWN: Instance, and it stays", () => {
  it("the Board tab goes (its last fact and question gone): Instance", () => {
    const onBoard = state("board", { answered: true });
    expect(moved(onBoard, now({ board: { answered: true, asks: false }, drawn: NO_BOARD })).tab).toBe("instance");
  });
  it("and a Board tab that is drawn AGAIN does not take the panel back, whatever the memory holds (round 3, major: Answer, the question cleared, the next question asked)", () => {
    // (The memory holds Board: the panel mounted on it, or a press named it. It is read at a mount and at a press only.)
    const fell = moved(state("board", { answered: true, pressed: true, presses: 1 }), now({ presses: 1, pressedTab: "board", board: { answered: true, asks: false }, drawn: NO_BOARD }));
    expect(fell.tab).toBe("instance");
    expect(moved(fell, now({ presses: 1, pressedTab: "board", board: { answered: true, asks: true }, drawn: ALL }))).toBe(fell);
  });
  it("the same for a panel that opened on Board by itself (round 1)", () => {
    const fell = moved(state("board", { answered: true }), now({ board: { answered: true, asks: false }, drawn: NO_BOARD }));
    expect(moved(fell, now({ board: { answered: true, asks: true }, drawn: ALL }))).toBe(fell);
  });
  it("the Mail tab goes (the row no longer gives a messaging id): Instance, and it stays", () => {
    const fell = moved(state("mail", { answered: true, pressed: true }), now({ pressedTab: "mail", board: { answered: true, asks: false }, drawn: NO_MAIL }));
    expect(fell.tab).toBe("instance");
    expect(moved(fell, now({ pressedTab: "mail", board: { answered: true, asks: false }, drawn: ALL }))).toBe(fell);
  });
});

describe("no event, no move", () => {
  it("the same state back, the same object, for every tab", () => {
    for (const tab of ["board", "instance", "soul", "mail"] as const) {
      const held = state(tab, { answered: true, pressed: tab !== "board", presses: 4 });
      expect(moved(held, now({ presses: 4, pressedTab: "soul", board: { answered: true, asks: true } }))).toBe(held);
    }
  });
});
