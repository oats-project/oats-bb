// THE PANEL's SHOWN TAB, as its truth table (app/panel/tab-state.ts): ONE pure function of the
// window (the memory: the tab of the last press; Mail's marker: the agent whose Mail tab was last
// pressed) and of whose panel it is. The panel holds no state of its own: a mount and a draw are
// this function. The same through the panel itself, as a person meets it:
// test/board/panel-tabs.test.tsx.
import { describe, expect, it } from "vitest";
import { tabOf } from "../../app/panel/tab-state";
import type { TabId, Window } from "../../app/panel/tab-state";

const TABS: readonly TabId[] = ["board", "instance", "soul", "mail"];
// The panel is agent "a"'s; the marker: nobody's, its own, another agent's.
const MARKERS: readonly (string | null)[] = [null, "a", "b"];

describe("what the panel of an agent shows: the memory's tab; but where the memory is Mail and the marker is not this agent: Instance", () => {
  it.each<[TabId, string | null, TabId]>([
    ["board", null, "board"],
    ["board", "a", "board"],
    ["board", "b", "board"],
    ["instance", null, "instance"],
    ["instance", "a", "instance"],
    ["instance", "b", "instance"],
    ["soul", null, "soul"],
    ["soul", "a", "soul"],
    ["soul", "b", "soul"],
    ["mail", null, "instance"], // (a window with no marker: Mail was pressed for nobody)
    ["mail", "a", "mail"], // pressed for THIS agent: Mail, as a person left it, whatever was shown between
    ["mail", "b", "instance"], // pressed for another: no agent's mail is read without a press on its own tab
  ])("memory %s, marker %s: %s", (memory, mailOf, shown) => {
    expect(tabOf({ memory, mailOf }, "a")).toBe(shown);
  });
  it("the table is the whole of it: every memory with every marker is a row above, and Mail is shown for ONE agent at most", () => {
    for (const memory of TABS)
      for (const mailOf of MARKERS) {
        const window: Window = { memory, mailOf };
        const shown = ["a", "b"].map((instance) => tabOf(window, instance));
        expect(shown.filter((tab) => tab === "mail").length, `${memory} ${mailOf}`).toBeLessThanOrEqual(1);
        if (memory !== "mail") expect(shown).toEqual([memory, memory]); // the other three: every panel, the same
      }
  });
  it("it is given nothing of what was read, and nothing of the panel's past: the window and the agent's name", () => {
    expect(tabOf.length).toBe(2);
    const window: Window = { memory: "mail", mailOf: "a" };
    expect([tabOf(window, "a"), tabOf(window, "a")]).toEqual(["mail", "mail"]); // two mounts, the same tab twice: by construction
  });
});
