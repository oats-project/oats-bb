// The display filter (app/ui/text.ts): pure, no DOM. Its first part is the OATS Desktop's filter and
// these are the Desktop's tests of it (packages/desktop/test/display-text.test.mjs of awebai/oats at
// 95c7b43b3), so the two stay one filter; then what the plugin adds. Characters of the set are code
// points or escapes here, never literal characters.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { cleanLine, DETAIL_WITHHELD, displayLine, MAX_DISPLAY_LINE, NOT_NOTE_TEXT, refusalCode, refusalLines, shown, shownBlock, UNSAFE } from "../../app/ui/text";
import { FIXTURES } from "../support/fake-oats.js";

const at = (codePoint: number) => String.fromCodePoint(codePoint);
const REPLACEMENT = at(0xfffd);
// The set, each range at both ends, by what the filter does with it.
const FOLDED = [0x0009, 0x000a, 0x2028, 0x2029]; // become a space
const WITHHELD = [0x0000, 0x0008, 0x000b, 0x000d, 0x001f, 0x007f]; // UNSAFE: the whole text is withheld
const REPLACED = [0x0080, 0x009f, 0x202a, 0x202e, 0x2066, 0x2069, 0x200b, 0x2060, 0xfeff, 0xe0000, 0xe007f];
// Text outside the set: Japanese, Arabic, Persian with ZWNJ, an emoji ZWJ sequence, LRM, RLM, ALM, the
// soft hyphen, and the neighbours of the set's ranges.
const TEXT = [
  "\u65E5\u672C\u8A9E\u306E\u30D5\u30A1\u30A4\u30EB",
  "\u0645\u0644\u0641 \u0627\u0644\u0639\u0645\u0644",
  "\u0645\u06CC\u200C\u062E\u0648\u0627\u0647\u0645",
  "\u{1F469}\u200D\u{1F4BB}",
  "a\u200Eb",
  "\u05D0\u200Fb",
  "\u0627\u061Cb",
  "co\u00ADop",
  "a\u00A0b",
  "a\u2027b",
  "a\u202Fb",
  "a\u2065b",
  "a\u206Ab",
  "a\u200Ab",
  "a\u2061b",
  "a\uFEFEb",
  "a\u{E0080}b",
  "r\u00E9sum\u00E9 /srv/agents/dev/instances/dev-1/work: fatal: not a git repository",
];
const SECRETS = ["token=abc123", "password: hunter2", "api key: abc", "https://user:pw@host.example/repo.git", `gh${"p"}_${"a".repeat(20)}`];

describe("the Desktop's display filter", () => {
  test("not a non-empty string, or nothing but breaks and spaces: null", () => {
    for (const value of [undefined, null, 7, 10n, {}, ["a"], "", " ", "\n", " \t\n ", at(0x2028) + at(0x2029)]) expect(displayLine(value), String(value)).toBeNull();
  });

  test("one line: tab, line feed and the line and paragraph separators each become a space; runs collapse; the ends are trimmed", () => {
    expect(displayLine("fatal: not a git repository\n\thint: run git init\n")).toBe("fatal: not a git repository hint: run git init");
    expect(displayLine("  a   b  ")).toBe("a b");
    for (const codePoint of FOLDED) {
      expect(displayLine(`a${at(codePoint)}b`), codePoint.toString(16)).toBe("a b");
      expect(displayLine(`${at(codePoint)}a ${at(codePoint)}${at(codePoint)} b${at(codePoint)}`), codePoint.toString(16)).toBe("a b");
    }
  });

  test("every character of the set still present becomes U+FFFD, one for one, also at the ends", () => {
    for (const codePoint of REPLACED) {
      expect(displayLine(`a${at(codePoint)}b`), codePoint.toString(16)).toBe(`a${REPLACEMENT}b`);
      expect(displayLine(`${at(codePoint)}a${at(codePoint)}${at(codePoint)}b${at(codePoint)}`), codePoint.toString(16)).toBe(
        `${REPLACEMENT}a${REPLACEMENT}${REPLACEMENT}b${REPLACEMENT}`,
      );
    }
    const all = displayLine(REPLACED.map(at).join("x"));
    expect(all).toBe(REPLACED.map(() => REPLACEMENT).join("x"));
    expect(all).not.toMatch(NOT_NOTE_TEXT);
  });

  test("text outside the set is kept unchanged: international text, and ZWJ, ZWNJ, LRM, RLM, ALM and the soft hyphen", () => {
    for (const text of TEXT) {
      expect(displayLine(text), JSON.stringify(text)).toBe(text);
      expect(cleanLine(text), JSON.stringify(text)).toBe(true);
    }
    expect(displayLine("<b>bold</b> & é 日本")).toBe("<b>bold</b> & é 日本"); // markup is text: React draws it as text
  });

  test("what is unsafe is withheld whole, tested on the text as given: before folding, replacement and truncation", () => {
    for (const secret of SECRETS) {
      expect(displayLine(secret), secret).toBe(DETAIL_WITHHELD);
      expect(displayLine(`first line\n${at(0x202e)}${secret}${at(0x200b)}\n\tlast line`), secret).toBe(DETAIL_WITHHELD);
      expect(displayLine(`${"x".repeat(3000)} ${secret}`), "past the length limit").toBe(DETAIL_WITHHELD);
    }
    expect(displayLine("token =\n abc123"), "across a line break").toBe(DETAIL_WITHHELD);
    for (const codePoint of WITHHELD) expect(displayLine(`a${at(codePoint)}b`), codePoint.toString(16)).toBe(DETAIL_WITHHELD);
    // The line that would be shown is held to the same rule.
    expect(displayLine(`token=${at(0xfeff)}`)).toBe(DETAIL_WITHHELD);
    expect(displayLine(DETAIL_WITHHELD)).toBe(DETAIL_WITHHELD);
  });

  test("bounded to 2048 UTF-16 units after filtering, without splitting a pair or ending on a space", () => {
    expect(MAX_DISPLAY_LINE).toBe(2048);
    expect(displayLine("m".repeat(5000))).toHaveLength(2048);
    expect(displayLine("m".repeat(2048))).toBe("m".repeat(2048));
    expect(displayLine(`${"m\n".repeat(1500)}`), "folded first, then bounded: 1024 pairs minus the final space").toHaveLength(2047);
    expect(displayLine(`${"m".repeat(2047)}${at(0x1f600)}tail`), "a pair is never split").toBe("m".repeat(2047));
    expect(displayLine(`${"m".repeat(2047)} tail`), "never ends on a space").toBe("m".repeat(2047));
  });

  test("filtering twice equals filtering once", () => {
    const inputs = [
      ...TEXT,
      ...SECRETS,
      ...[...FOLDED, ...WITHHELD, ...REPLACED].flatMap((codePoint) => [`a${at(codePoint)}b`, `${at(codePoint)}a b${at(codePoint)}`, `token=${at(codePoint)}`, `x://a${at(codePoint)}b@c`]),
      "fatal: not a git repository\n\thint: run git init\n",
      "  a   b  ",
      "m".repeat(5000),
      `${"m".repeat(2047)}${at(0x1f600)}tail`,
      `${"m".repeat(2047)} tail`,
      `${"m ".repeat(1500)}`,
      "",
      " ",
      "\n",
    ];
    for (const input of inputs) {
      const once = displayLine(input);
      expect(displayLine(once), JSON.stringify(input.slice(0, 40))).toBe(once);
      if (once !== null) expect(cleanLine(once), JSON.stringify(input.slice(0, 40))).toBe(true);
    }
  });

  test("cleanLine: a string the filter would return unchanged, and nothing else", () => {
    for (const value of ["fatal: not a git repository", DETAIL_WITHHELD, "m".repeat(2048)]) expect(cleanLine(value), value.slice(0, 40)).toBe(true);
    for (const value of [undefined, null, 7, "", " ", "two\nlines", "a\tb", " leading", "trailing ", "two  spaces", "m".repeat(2049), "token=abc123", ...[...FOLDED, ...WITHHELD, ...REPLACED].map((codePoint) => `a${at(codePoint)}b`)]) {
      expect(cleanLine(value), JSON.stringify(value)).toBe(false);
    }
  });

  test("the withholding pattern is the Desktop's, character for character; both patterns are stateless", () => {
    expect(NOT_NOTE_TEXT.global).toBe(false);
    expect(UNSAFE.global).toBe(false);
    expect(UNSAFE.flags).toBe("i");
    expect(UNSAFE.source).toBe(
      String.raw`[\x00-\x08\x0b-\x1f\x7f]|:\/\/(?<=[a-z][a-z0-9+.-]*:\/\/)[^\s/]*@|(?:token|authorization|password|secret|api[_ -]?key)\s*[:=]\s*\S+|(?:gh[pousr]_|github_pat_)[A-Za-z0-9_]{16,}`,
    );
    expect(NOT_NOTE_TEXT.source).toBe(String.raw`[\p{Cc}\u2028\u2029\u202A-\u202E\u2066-\u2069\u200B\u2060\uFEFF\u{E0000}-\u{E007F}]`);
  });

  test("its time grows with the length of the text, not with its square", () => {
    // A long run of scheme characters before no "://": the scheme-first form of the URL alternative took seconds here.
    const started = performance.now();
    expect(displayLine("a".repeat(200_000))).toHaveLength(2048);
    expect(displayLine(`${"a".repeat(200_000)}://u@h`)).toBe(DETAIL_WITHHELD);
    expect(performance.now() - started).toBeLessThan(1_000);
  });
});

describe("the copy follows the Desktop's file", () => {
  // test/fixtures/desktop/display-text.json is what packages/client/display-text.mjs of awebai/oats
  // exports at the revision it names, recorded by importing that file. The plugin's copy must equal
  // it: a change on either side (the Desktop's file moves and this recording is made again, or the
  // copy is edited) shows here.
  const recorded = JSON.parse(readFileSync(join(FIXTURES, "desktop", "display-text.json"), "utf8")) as {
    from: string;
    revision: string;
    NOT_NOTE_TEXT: { source: string; flags: string };
    UNSAFE: { source: string; flags: string };
    DETAIL_WITHHELD: string;
    MAX_DISPLAY_LINE: number;
  };

  test("the two expressions, the withheld marker and the line's limit are the Desktop's at the recorded revision", () => {
    expect([recorded.from, recorded.revision]).toEqual(["awebai/oats, packages/client/display-text.mjs", "95c7b43b3"]);
    expect({ source: NOT_NOTE_TEXT.source, flags: NOT_NOTE_TEXT.flags }).toEqual(recorded.NOT_NOTE_TEXT);
    expect({ source: UNSAFE.source, flags: UNSAFE.flags }).toEqual(recorded.UNSAFE);
    expect(DETAIL_WITHHELD).toBe(recorded.DETAIL_WITHHELD);
    expect(MAX_DISPLAY_LINE).toBe(recorded.MAX_DISPLAY_LINE);
  });

  test("the file that holds the copy names the same revision", () => {
    expect(readFileSync(join(FIXTURES, "..", "..", "app", "ui", "text.ts"), "utf8")).toContain(`read at ${recorded.revision}`);
  });
});

describe("what the plugin adds", () => {
  test("shown: the display line, or the empty string where there is nothing to show", () => {
    expect(shown("redesign-ui-lead")).toBe("redesign-ui-lead");
    expect(shown("a\u001b[31mred")).toBe(DETAIL_WITHHELD); // an escape sequence: withheld whole, never drawn in part
    expect(shown("line 1\n\tline 2")).toBe("line 1 line 2");
    expect(shown("\u202egnp.exe")).toBe(`${REPLACEMENT}gnp.exe`);
    for (const nothing of [null, undefined, "", " \n"]) expect(shown(nothing)).toBe("");
  });

  test("shownBlock: a prompt is drawn whole, with its lines, its blank lines and its indentation; only what is no text is replaced", () => {
    expect(shownBlock("Check that password=hunter2 never appears")).toBe("Check that password=hunter2 never appears"); // nothing is withheld
    expect(shownBlock("a\u202eb")).toBe(`a${REPLACEMENT}b`);
    expect(shownBlock("one\r\n\ttwo\n\nthree")).toBe("one\n\ttwo\n\nthree");
    expect(shownBlock("a\rb\u2028c\u2029d")).toBe("a\nb\nc\nd"); // a line break, however it was written
    expect(shownBlock("m".repeat(5000))).toHaveLength(5000); // no cut
    // Every character of the set but the line feed and the tab is replaced, one for one.
    for (const codePoint of [...WITHHELD.filter((cp) => cp !== 0x000d), ...REPLACED.filter((cp) => cp !== 0x2028 && cp !== 0x2029)]) {
      expect(shownBlock(`a${at(codePoint)}b`), codePoint.toString(16)).toBe(`a${REPLACEMENT}b`);
    }
    for (const text of TEXT) expect(shownBlock(text), JSON.stringify(text)).toBe(text); // international text, ZWJ, ZWNJ and the marks stay
    for (const nothing of [undefined, null, 7, {}]) expect(shownBlock(nothing)).toBe("");
    expect(shownBlock("")).toBe("");
  });

  test("refusalLines: a refusal's code is kept, and its message is one display line", () => {
    expect(refusalLines("E_PLAN_STALE: the plan moved since it was read")).toEqual(["E_PLAN_STALE: the plan moved since it was read"]);
    expect(refusalLines("oats was not found on falcon")).toEqual(["oats was not found on falcon"]);
    expect(refusalLines("")).toEqual([]);
    expect(refusalLines(undefined)).toEqual([]);
  });

  test("refusalCode: the code that leads a refusal, the kernel's or the plugin's own, and nothing else", () => {
    expect(refusalCode("E_PLAN_STALE: the plan moved since it was read")).toBe("E_PLAN_STALE");
    expect(refusalCode("OATS_TIMEOUT: `oats` did not answer within 20 s and was stopped")).toBe("OATS_TIMEOUT");
    for (const none of ["TOKEN: abc123", "NOTE: nothing to do", "oats was not found on falcon", "E_SOUL_INVALID:", "E_: m", " E_X: m", "e_x: m", "the E_X: m", "E_X:\nm", "E_X:\tm", "", undefined, 7]) expect(refusalCode(none), String(none)).toBeNull();
  });

  test("refusalLines: each line of the kernel's is a line of its own, and no line break is left in one", () => {
    const incomplete = "RETIRE_INCOMPLETE: the retire of dev-1 is incomplete and its home is kept at /abs/home:\nworktree: kept\n\n\tbranch: kept\n";
    expect(refusalLines(incomplete)).toEqual(["RETIRE_INCOMPLETE: the retire of dev-1 is incomplete and its home is kept at /abs/home:", "worktree: kept", "branch: kept"]);
    for (const line of refusalLines(incomplete)) expect(line).not.toMatch(/[\n\t\u2028\u2029]/);
  });

  test("refusalLines: an unsafe message is withheld whole, and the code that leads it is still shown", () => {
    expect(refusalLines("E_HOOK_FAILED: the hook printed token=abc123\nand more")).toEqual([`E_HOOK_FAILED: ${DETAIL_WITHHELD}`]);
    expect(refusalLines("OATS_FAILED: `oats` exited 1: https://user:pw@host.example/repo.git")).toEqual([`OATS_FAILED: ${DETAIL_WITHHELD}`]);
    // A kernel code is shown as the Desktop shows it, apart from its message, whatever word it ends in.
    expect(refusalLines("E_BAD_TOKEN: the invite is not one this team made")).toEqual(["E_BAD_TOKEN: the invite is not one this team made"]);
    expect(refusalLines("E_SOUL_INVALID:")).toEqual(["E_SOUL_INVALID:"]);
    expect(refusalLines("E_SOUL_INVALID: ")).toEqual(["E_SOUL_INVALID"]);
  });

  test("refusalLines: a leading word that is neither a kernel code nor one of the plugin's own is part of the message", () => {
    expect(refusalLines("TOKEN: abc123")).toEqual([DETAIL_WITHHELD]);
    expect(refusalLines("PASSWORD: hunter2\nsecond line")).toEqual([DETAIL_WITHHELD]);
    expect(refusalLines("NOTE: nothing to do")).toEqual(["NOTE: nothing to do"]);
  });

  test("the fixtures the live scenes of the roster, the pages, spawn and the lifecycle draw from hold no text the filter changes, but the task a spawn preview echoes", () => {
    const changed: string[] = [];
    const walk = (value: unknown, where: string) => {
      if (typeof value === "string") {
        if (value !== "" && displayLine(value) !== value) changed.push(where);
      } else if (typeof value === "object" && value !== null) {
        for (const [key, inner] of Object.entries(value)) walk(inner, `${where}.${key}`);
      }
    };
    // Another feature's recordings may hold text the filter is meant to change (a prompt of several lines): its own tests say which.
    for (const feature of ["roster", "workspace", "spawn", "lifecycle"]) {
      for (const file of readdirSync(join(FIXTURES, feature))) {
        if (file.endsWith(".json")) walk(JSON.parse(readFileSync(join(FIXTURES, feature, file), "utf8")), `${feature}/${file}`);
      }
    }
    // The task ends in a line feed, as the form sent it; nothing draws it.
    expect(changed).toEqual(["spawn/spawn-preview.json.result.task"]);
  });
});
