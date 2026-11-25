// @vitest-environment jsdom
// "tmux" on a row: bb's own terminal glyph with the accessible name "tmux"; the word on a bb whose
// icon set has no such glyph (bb draws its generic glyph for a name it does not hold, and says nothing).
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

/** What bb's set holds, for a test: a name in it draws its own glyph, any other the generic one. */
let held: string[] = [];
vi.mock("@get-bb/plugin-sdk/app", async (original) => ({
  ...(await original<typeof import("@get-bb/plugin-sdk/app")>()),
  experimental_Icon: ({ name, className }: { name: string; className?: string }) => (
    <svg className={className} data-icon={name}>
      <path d={held.includes(name) ? `M-${name}` : "M-generic"} />
    </svg>
  ),
}));

beforeEach(async () => {
  (await import("../../app/ui/tmux")).forgetTmuxGlyph();
});
afterEach(cleanup);

test("where bb's set has the glyph: the glyph, named \"tmux\" for a screen reader and on hover, and no word", async () => {
  held = ["Terminal"];
  const { TmuxMark } = await import("../../app/ui/tmux");
  render(<TmuxMark />);
  const mark = await screen.findByTestId("oats-tmux");
  expect([mark.getAttribute("data-tmux"), mark.getAttribute("role"), mark.getAttribute("aria-label"), mark.getAttribute("title")]).toEqual(["glyph", "img", "tmux", "tmux"]);
  expect(mark.textContent).toBe("");
  expect(mark.querySelector('svg[data-icon="Terminal"] path')!.getAttribute("d")).toBe("M-Terminal");
  // The look at what bb draws for a name it does not hold is made once, and then leaves the page.
  expect(screen.queryByTestId("oats-tmux-probe")).toBeNull();
});

test("where bb's set has no such glyph (it draws its generic one): the word \"tmux\", and no glyph that would mean nothing", async () => {
  held = [];
  const { TmuxMark } = await import("../../app/ui/tmux");
  render(<TmuxMark />);
  await vi.waitFor(() => expect(screen.getByTestId("oats-tmux").getAttribute("data-tmux")).toBe("word"));
  const mark = screen.getByTestId("oats-tmux");
  expect(mark.textContent).toBe("tmux");
  expect(mark.querySelector("svg")).toBeNull();
  expect(mark.getAttribute("role")).toBeNull();
});

test("the answer is one for the window: a second mark draws what the first found, with no second look", async () => {
  held = ["Terminal"];
  const { TmuxMark } = await import("../../app/ui/tmux");
  render(
    <>
      <TmuxMark />
      <TmuxMark />
    </>,
  );
  await vi.waitFor(() => expect(screen.queryByTestId("oats-tmux-probe")).toBeNull());
  expect(screen.getAllByTestId("oats-tmux").map((mark) => mark.getAttribute("data-tmux"))).toEqual(["glyph", "glyph"]);
});
