// The thread's title: the instance's name as words (lib/title.mjs), the rule of OATS's
// instanceDisplayName, pinned here with that function's own examples.
import assert from "node:assert/strict";
import test from "node:test";
import { threadTitle } from "../../oats-package/capabilities/oats-bb/lib/title.mjs";

test("a name as words: the examples of OATS's instanceDisplayName", () => {
  assert.equal(threadTitle("oats-expert-maintainer-lanes"), "Oats expert maintainer lanes");
  assert.equal(threadTitle("tui-leader-hint-developer-2"), "Tui leader hint developer 2");
  assert.equal(threadTitle("x"), "X");
  assert.equal(threadTitle("already Words"), "Already Words");
});

test("every run of - is one space, the ends are trimmed, and only the first character changes", () => {
  assert.equal(threadTitle("release-070-maintainer"), "Release 070 maintainer");
  assert.equal(threadTitle("a--b---c"), "A b c");
  assert.equal(threadTitle("-lead--"), "Lead");
  assert.equal(threadTitle("  spaced-name "), "Spaced name");
  assert.equal(threadTitle("fix-API-v2_draft.final"), "Fix API v2_draft.final", "the case, the _ and the . of the rest stay");
  assert.equal(threadTitle("Fix-it"), "Fix it");
  assert.equal(threadTitle("9-lives"), "9 lives");
  assert.equal(threadTitle("élan-vital"), "Élan vital");
  assert.equal(threadTitle("a b"), "A b", "a space that was there stays one space");
  assert.equal(threadTitle("a - b"), "A   b", "only runs of - are folded: the spaces around one stay");
});

test("a first character outside the BMP is not split", () => {
  assert.equal(threadTitle("𝒶-b"), "𝒶 b");
  assert.equal(threadTitle("𐐨-b"), "𐐀 b", "and is upper-cased whole (Deseret small long I)");
});

test("nothing to show is the empty string: not a string, or nothing but - and spaces", () => {
  for (const name of [undefined, null, 7, {}, ["a"], "", "-", "---", " - - ", "   "]) assert.equal(threadTitle(name), "");
});
