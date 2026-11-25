// @vitest-environment jsdom
// A row's one line (app/ui/row-facts.tsx; the lead's L16, 24 Nov 2026): STATE · SOUL · REASON · where,
// and what gives way when it does not fit: the reason shortens, then LEAVES the row, and only then
// the soul shortens; a reason that warns stays, and the soul gives way first. The state's word and
// the glyph never shrink. Step 2 is a measured fit: here the DOM has no layout, so the widths are given.
import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
// bb's icon set, for a test: it holds no terminal glyph, so "tmux" is drawn as the word (test/app/tmux.test.tsx is the glyph's own).
vi.mock("@get-bb/plugin-sdk/app", async (original) => ({
  ...(await original<typeof import("@get-bb/plugin-sdk/app")>()),
  experimental_Icon: ({ name, className }: { name: string; className?: string }) => (
    <svg className={className} data-icon={name}>
      <path d="M-generic" />
    </svg>
  ),
}));
import { REASON_MIN_EM, RowFacts, reasonStays } from "../../app/ui/row-facts";
import { forgetTmuxGlyph, TMUX } from "../../app/ui/tmux";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  forgetTmuxGlyph();
});

describe("whether the reason stays on the line (pure)", () => {
  // least = 48: four em of a 12 px line.
  test.each<[string, { line: number; others: number; reason: number }, boolean]>([
    ["everything fits whole", { line: 300, others: 180, reason: 70 }, true],
    ["it fits exactly", { line: 250, others: 180, reason: 70 }, true],
    ["short of its whole width, with room for a shortened one: it stays, shortened", { line: 240, others: 180, reason: 70 }, true],
    ["exactly the least room", { line: 228, others: 180, reason: 70 }, true],
    ["one pixel under the least room: it leaves", { line: 227, others: 180, reason: 70 }, false],
    ["no room at all, or less than none: it leaves", { line: 170, others: 180, reason: 70 }, false],
    ["a reason shorter than the least room stays while it fits whole", { line: 210, others: 180, reason: 30 }, true],
    ["and leaves when it does not (a reason that short is never shortened)", { line: 209, others: 180, reason: 30 }, false],
  ])("%s", (_name, widths, stays) => {
    expect(reasonStays({ ...widths, least: 48 })).toBe(stays);
  });
});

/** Gives the DOM the widths a layout would: the line's, and each part's full width by what it is. (jsdom lays nothing out.) */
function laidOut(line: number, widths: { state: number; soul: number; reason: number; where: number; sep: number }) {
  const of = (element: Element): number => {
    const phrase = element.getAttribute("data-phrase");
    if (phrase === "state" || phrase === "soul" || phrase === "reason" || phrase === "where") return widths[phrase];
    if (element.hasAttribute("data-sep")) return widths.sep;
    return 0;
  };
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(function (this: HTMLElement) {
    return this.getAttribute("data-testid") === "facts" ? line : of(this);
  });
  vi.spyOn(HTMLElement.prototype, "scrollWidth", "get").mockImplementation(function (this: HTMLElement) {
    return of(this);
  });
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    const width = of(this);
    return { width, height: 16, top: 0, left: 0, right: width, bottom: 16, x: 0, y: 0, toJSON: () => ({}) };
  });
}
// "Stopped" 50, "oats-developer" 90, "session lost" 70, the glyph 14, a separator 12: whole, 50+12+90+12+70+12+14 = 260;
// without the reason's words, 190 (OTHERS). The least room a shortened reason is worth is four em of the line's own
// font size, whatever this DOM says that is (LEAST: under 70, so that a shortened reason is a case).
const W = { state: 50, soul: 90, reason: 70, where: 14, sep: 12 };
const OTHERS = 190;
const LEAST = REASON_MIN_EM * (parseFloat(getComputedStyle(document.body).fontSize) || 12);
const draw = (props: Partial<Parameters<typeof RowFacts>[0]> = {}) => render(<RowFacts testId="facts" state="Stopped" soul="oats-developer" reason="session lost" where={TMUX} {...props} />).getByTestId("facts");
const parts = (line: HTMLElement) => Array.from(line.querySelectorAll("[data-phrase]")).map((part) => part.getAttribute("data-phrase"));
const shrinks = (line: HTMLElement) => Object.fromEntries(Array.from(line.querySelectorAll("[data-phrase]")).map((part) => [part.getAttribute("data-phrase"), !part.className.split(/\s+/).includes("shrink-0")]));

describe("the row's line", () => {
  test("the order is STATE · SOUL · REASON · where, and the title says all of it", () => {
    const line = draw();
    expect(parts(line)).toEqual(["state", "soul", "reason", "where"]);
    expect(line.textContent).toBe("Stopped · oats-developer · session lost · tmux");
    expect(line.getAttribute("title")).toBe("Stopped · oats-developer · session lost · tmux");
    expect(line.className.split(/\s+/)).toEqual(expect.arrayContaining(["whitespace-nowrap", "overflow-hidden"])); // one line, and nothing past its edge
  });

  test("with no state (a home row under a heading that says it), no reason, or no glyph, the parts that are there keep the order", () => {
    expect(draw({ state: undefined }).textContent).toBe("oats-developer · session lost · tmux");
    cleanup();
    expect(draw({ reason: null, where: undefined }).textContent).toBe("Stopped · oats-developer");
    cleanup();
    const none = draw({ reason: "" }); // a reason that is no words
    expect([none.textContent, none.getAttribute("title"), none.getAttribute("data-reason")]).toEqual(["Stopped · oats-developer · tmux", "Stopped · oats-developer · tmux", null]);
  });

  test.each([
    ["whole", 260],
    ["shortened", OTHERS + LEAST + 1],
    ["shortened to the least room", OTHERS + LEAST],
  ])("step 1: while the reason has room (%s), it is the ONE part that shrinks: the state, the soul and the glyph do not", (_name, width) => {
    expect(LEAST).toBeLessThan(W.reason);
    laidOut(width, W);
    const line = draw();
    expect([parts(line), line.getAttribute("data-reason")]).toEqual([["state", "soul", "reason", "where"], "shown"]);
    expect(shrinks(line)).toEqual({ state: false, soul: false, reason: true, where: false });
    expect(line.querySelector('[data-phrase="reason"]')!.className.split(/\s+/)).toContain("truncate"); // shortened with "…"
  });

  test("step 2: with less than the least room for it the reason LEAVES the row; the title still says all of it; step 3: only then is the soul the part that shortens", () => {
    laidOut(OTHERS + LEAST - 1, W);
    const line = draw();
    expect(parts(line)).toEqual(["state", "soul", "where"]);
    expect(line.textContent).toBe("Stopped · oats-developer · tmux"); // no separator left behind
    expect(line.getAttribute("title")).toBe("Stopped · oats-developer · session lost · tmux");
    expect(line.getAttribute("data-reason")).toBe("left");
    expect(shrinks(line)).toEqual({ state: false, soul: true, where: false });
    expect(line.querySelector('[data-phrase="soul"]')!.className.split(/\s+/)).toEqual(expect.arrayContaining(["truncate", "min-w-[1.5em]"]));
  });

  test("the fit is measured against the soul at its FULL width, so a reason that left comes back when the line is wide again, and does not flap", () => {
    laidOut(OTHERS + 5, W);
    const view = render(<RowFacts testId="facts" state="Stopped" soul="oats-developer" reason="session lost" where={TMUX} />);
    expect(view.getByTestId("facts").getAttribute("data-reason")).toBe("left");
    vi.restoreAllMocks();
    laidOut(260, W);
    view.rerender(<RowFacts testId="facts" state="Working" soul="oats-developer" reason="session lost" where={TMUX} />);
    expect([view.getByTestId("facts").getAttribute("data-reason"), parts(view.getByTestId("facts"))]).toEqual(["shown", ["state", "soul", "reason", "where"]]);
  });

  test("the line carries no mark of what a closed parent hides (that is its chevron's: the lead's T1): the line's room is its own words'", () => {
    // A line that holds a shortened reason by ten pixels keeps it: nothing else stands on the line to take the room.
    laidOut(OTHERS + LEAST + 10, W);
    const line = draw();
    expect(line.getAttribute("data-reason")).toBe("shown");
    expect([line.querySelector('[data-testid="oats-row-inside"]'), line.querySelectorAll("[data-mark]").length]).toEqual([null, 0]);
  });

  test("THE GUARD: a reason in the warning tone is never the one to go: it stays whole however narrow the line, and the soul gives way first", () => {
    laidOut(120, W);
    const line = draw({ reason: "archived in bb", reasonTone: "warning" });
    expect(parts(line)).toEqual(["state", "soul", "reason", "where"]);
    expect(line.getAttribute("data-reason")).toBe("shown");
    expect(shrinks(line)).toEqual({ state: false, soul: true, reason: false, where: false });
    expect(line.querySelector('[data-phrase="reason"]')!.getAttribute("data-tone")).toBe("warning");
  });

  // A place can ask for the same guard for ANY reason (the home's card: for an agent whose thread is gone the reason is
  // the card's only word on why it has no reply; "deleted in bb" does not warn on an agent that runs). The tone is not
  // touched: a plain reason stays plain.
  test("a reason a place KEEPS is held like one that warns, whatever its tone: it stays whole however narrow the line, the soul gives way first, and its tone is not changed", () => {
    laidOut(120, W);
    const line = draw({ reason: "deleted in bb", reasonKept: true });
    expect(parts(line)).toEqual(["state", "soul", "reason", "where"]);
    expect(line.getAttribute("data-reason")).toBe("shown");
    expect(shrinks(line)).toEqual({ state: false, soul: true, reason: false, where: false });
    expect(line.querySelector('[data-phrase="reason"]')!.getAttribute("data-tone")).toBeNull();
    // Without it, on the same line, that reason leaves (the row's rule).
    cleanup();
    expect(draw({ reason: "deleted in bb" }).getAttribute("data-reason")).toBe("left");
  });

  test("with no layout to measure (nothing drawn yet) the reason stays", () => {
    expect(draw().getAttribute("data-reason")).toBe("shown");
    expect(REASON_MIN_EM).toBe(4);
  });
});
