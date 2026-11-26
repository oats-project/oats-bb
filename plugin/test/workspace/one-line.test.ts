// The lists' one rule for a one-line text (app/workspace/Workspace.tsx `cutAtWord`): as much as fits,
// cut at a WORD with "…", never mid-word. Pure: the width of a text is given (here: one unit a character).
import { describe, expect, it } from "vitest";
import { cutAtWord } from "../../app/workspace/Workspace";

const wide = (text: string) => text.length;

describe("a one-line text", () => {
  it("is whole where it fits", () => {
    expect(cutAtWord("Runs research questions.", 24, wide)).toBe("Runs research questions.");
  });
  it("is cut at the last word that fits with its \"…\", never inside a word", () => {
    const text = "Adversarial code reviewer. It is attached to a worktree";
    expect(cutAtWord(text, 30, wide)).toBe("Adversarial code reviewer. It…");
    expect(cutAtWord(text, 29, wide)).toBe("Adversarial code reviewer…"); // "…reviewer. It…" is 30 wide: one word less, and no full stop before the "…"
    for (let room = 12; room < text.length; room += 1) {
      const cut = cutAtWord(text, room, wide)!;
      expect(cut.length).toBeLessThanOrEqual(room);
      const kept = cut.slice(0, -1);
      expect(text.startsWith(kept) && /^[\s.,]/.test(text.slice(kept.length))).toBe(true);
    }
  });
  it("leaves no mark dangling before the \"…\": a comma, an opening bracket, a dash, a slash, a dot between facts", () => {
    expect(cutAtWord("builds it, proves it", 11, wide)).toBe("builds it…");
    expect(cutAtWord("the kernel (lib/, bin/oats.mjs) and more", 13, wide)).toBe("the kernel…");
    expect(cutAtWord("one lane - the direction", 11, wide)).toBe("one lane…");
    expect(cutAtWord("pi · model and more", 5, wide)).toBe("pi…");
  });
  it("is given whole to the page (null) where not even its first word fits", () => {
    expect(cutAtWord("supercalifragilistic word", 6, wide)).toBeNull();
    expect(cutAtWord("nospaceatallinthistext", 6, wide)).toBeNull();
  });
});
