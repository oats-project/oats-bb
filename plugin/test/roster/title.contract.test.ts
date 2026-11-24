// "The agent's name as the provider writes it" is said in two places that nothing else holds equal: the bb session
// provider titles a thread at every start (`threadTitle`, oats-package/capabilities/oats-bb/lib/title.mjs, the file the
// provider launches with, beside plugin/ in the repository; container/ci.sh copies it beside the plugin in the test
// container), and the plugin compares bb's title with `instanceDisplayName` (app/ui/words.ts) to decide whether the
// thread's line must say whose it is (app/roster/IdentityRow.tsx). If one moved alone, every thread's line would carry
// the name under the same name, or never carry it. This test runs both over the same names and fails on any difference.
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { beforeAll, expect, test } from "vitest";
import { instanceDisplayName } from "../../app/ui/words";

let threadTitle: (name: unknown) => string;
beforeAll(async () => {
  const file = join(__dirname, "..", "..", "..", "oats-package", "capabilities", "oats-bb", "lib", "title.mjs");
  ({ threadTitle } = (await import(pathToFileURL(file).href)) as { threadTitle: typeof threadTitle });
});

const NAMES: unknown[] = [
  "desktop-mockups-developer",
  "redesign-ui-lead",
  "Release-070-maintainer",
  "a",
  "x--y---z",
  "-leading-and-trailing-",
  "  spaced  name  ",
  "already Words",
  "émile-helper",
  "\u{1F680}-rocket-helper", // a first character outside the BMP
  "ǆungla-helper", // a first character whose upper case is another length
  "ßeta",
  "123-numbers",
  "",
  "---",
  "   ",
  null,
  undefined,
  42,
];

test("the provider's title of an agent's thread and the plugin's name of the agent are the same text, for every name", () => {
  expect(NAMES.map((name) => [name, instanceDisplayName(name)])).toEqual(NAMES.map((name) => [name, threadTitle(name)]));
  // And the names that matter are not empty on either side.
  expect(threadTitle("desktop-mockups-developer")).toBe("Desktop mockups developer");
});
