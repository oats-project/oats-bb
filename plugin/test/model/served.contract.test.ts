// "Which listed models serve this id" is ONE function of the plugin (model/served.ts), and it is
// the bb session provider's own resolution: this test runs one table through the provider's
// `piModelVerdict` (oats-package/capabilities/oats-bb/lib/pi-model.mjs, the file the provider
// launches with, beside plugin/ in the repository; container/ci.sh copies it beside the plugin in
// the test container) and through the plugin's function, and fails on any difference.
//
// What the two may NOT differ in: a model the provider passes, the plugin says is served (whole or
// once); one the provider refuses as served by several, the plugin says several, with exactly the
// ids the provider's sentence names; one the provider refuses as none, the plugin says none. The
// one place they are not the same word: where the provider cannot refuse (a list it cannot read,
// an empty one, an id that ends in a date, which bb holds back from its list) it lets the launch
// go unchecked; the plugin's function, which has the list alone, answers `unlisted` or `none`,
// and each caller decides what it does with that (the form arms both).
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { beforeAll, describe, expect, test } from "vitest";
import { served } from "../../model/served";
import type { Served } from "../../model/served";
import { modelCheck } from "../../model/spawn";

type BbRow = { id: string; routeProviderId?: string };
type Verdict = { ok?: true; refused?: string; unchecked?: string };
let piModelVerdict: (model: string, value: unknown, options?: { partial?: string | null; old?: string | null }) => Verdict;
beforeAll(async () => {
  const file = join(__dirname, "..", "..", "..", "oats-package", "capabilities", "oats-bb", "lib", "pi-model.mjs");
  ({ piModelVerdict } = (await import(pathToFileURL(file).href)) as { piModelVerdict: typeof piModelVerdict });
});

const by = (...ids: string[]): BbRow[] => ids.map((id) => ({ id, routeProviderId: id.slice(0, id.indexOf("/")) }));
/** bb's rows as the plugin holds them (app/spawn/models.ts `modelOptions`: `provider` from `routeProviderId`). */
const listed = (rows: BbRow[]) => rows.map((row) => ({ id: row.id, provider: row.routeProviderId ?? null }));

// ---- the cases, each with what the list says of the id
const TWO = by("anthropic/claude-opus-5-5", "openrouter/claude-opus-5-5", "anthropic/claude-haiku-5");
const THROUGH = by("openrouter/openai/gpt-6", "anthropic/claude-haiku-5");
const CASES: [what: string, id: string, rows: BbRow[], answer: Served][] = [
  ["listed whole", "anthropic/claude-haiku-5", TWO, { kind: "whole", ids: ["anthropic/claude-haiku-5"] }],
  ["a bare id one listed model serves", "claude-haiku-5", TWO, { kind: "once", ids: ["anthropic/claude-haiku-5"] }],
  ["a bare id two listed models serve", "claude-opus-5-5", TWO, { kind: "several", ids: ["anthropic/claude-opus-5-5", "openrouter/claude-opus-5-5"] }],
  ["served by none", "nosuchmodel", TWO, { kind: "none", ids: [] }],
  ["a part of an id is not the id", "haiku-5", TWO, { kind: "none", ids: [] }],
  ["a provider's name is not a model", "openrouter", TWO, { kind: "none", ids: [] }],
  ["a model routed through a second provider: what its id ENDS in serves nothing", "gpt-6", THROUGH, { kind: "none", ids: [] }],
  ["the same model by its bare id, which holds a slash: once", "openai/gpt-6", THROUGH, { kind: "once", ids: ["openrouter/openai/gpt-6"] }],
  ["a model listed whole is that model, alone, though another's bare id is the same", "openai/gpt-6", by("openai/gpt-6", "openrouter/openai/gpt-6"), { kind: "whole", ids: ["openai/gpt-6"] }],
  ["one provider's bare id, though another's id ends in it", "gpt-6", by("openai/gpt-6", "openrouter/openai/gpt-6"), { kind: "once", ids: ["openai/gpt-6"] }],
  ["a bare id with a slash that two serve", "openai/gpt-7", by("openrouter/openai/gpt-7", "requesty/openai/gpt-7"), { kind: "several", ids: ["openrouter/openai/gpt-7", "requesty/openai/gpt-7"] }],
  ["a listed pi model with NO provider serves nothing, not even its own id", "my-model", [{ id: "my-model" }, ...by("mock/echo")], { kind: "none", ids: [] }],
  ["and does not make a second of another's bare id", "echo", [{ id: "echo" }, ...by("mock/echo")], { kind: "once", ids: ["mock/echo"] }],
  ["an id that ends in a date and is not listed (bb holds such a model back)", "claude-fable-5-20261101", TWO, { kind: "none", ids: [] }],
  ["an id that ends in a date and is listed, whole", "anthropic/claude-fable-5-20261101", by("anthropic/claude-fable-5-20261101"), { kind: "whole", ids: ["anthropic/claude-fable-5-20261101"] }],
  ["a list that names one model twice has two rows of it: the provider counts rows, and refuses its bare id (app/spawn/models.ts drops a repeated id before any rule reads the list: bb is not known to list a model twice)", "gpt-6", [...by("openai/gpt-6"), ...by("openai/gpt-6")], { kind: "several", ids: ["openai/gpt-6", "openai/gpt-6"] }],
  ["and the model named whole is still that model", "openai/gpt-6", [...by("openai/gpt-6"), ...by("openai/gpt-6")], { kind: "whole", ids: ["openai/gpt-6"] }],
  ["a list without providers: nothing in it counts", "claude-opus-5-5", [{ id: "claude-opus-5-5" }, { id: "claude-sonnet-5" }], { kind: "unlisted", ids: [] }],
  ["an empty list", "anything", [], { kind: "unlisted", ids: [] }],
  ["a list the provider cannot read (a model that does not begin with its provider)", "claude-haiku-5", [{ id: "claude-haiku-5", routeProviderId: "anthropic" }, ...by("openai/gpt-6")], { kind: "unlisted", ids: [] }],
];
// And every id against every list, both ways (the lists and ids on which a first rule of the plugin and the provider's differed).
const LISTS: BbRow[][] = [by("openai/gpt-6", "openai/gpt-6", "mock/echo"), THROUGH, by("openai/gpt-6", "openrouter/openai/gpt-6"), [{ id: "my-model" }, ...by("mock/echo")], TWO, [], [{ id: "claude-opus-5-5" }], by("openrouter/openai/gpt-7", "requesty/openai/gpt-7", "openai/gpt-7-20261101")];
const IDS = ["gpt-6", "openai/gpt-6", "openrouter/openai/gpt-6", "my-model", "echo", "mock/echo", "claude-opus-5-5", "claude-haiku-5", "haiku-5", "nosuchmodel", "openrouter", "openai", "openai/gpt-7", "gpt-7-20261101", "gpt-9-20261101"];
const DATED = /-\d{8}$/;

/** The two answers, for one id and one list, held against each other. */
function agree(id: string, rows: BbRow[]) {
  const where = `${JSON.stringify(id)} in ${JSON.stringify(rows)}`;
  const verdict = piModelVerdict(id, rows);
  const here = served(id, listed(rows), true);
  if (verdict.ok) expect(["whole", "once"], where).toContain(here.kind);
  else if (verdict.refused !== undefined && /is served by/.test(verdict.refused)) {
    expect(here.kind, where).toBe("several");
    // Exactly the ids the provider's sentence names: "… use A or B (…)".
    const named = /: use (.*) \(if you just changed/.exec(verdict.refused)![1]!.split(/, | or /);
    expect(here.ids, where).toEqual(named);
  } else if (verdict.refused !== undefined) {
    expect(verdict.refused, where).toMatch(/^pi has no model /);
    expect(here.kind, where).toBe("none");
  } else {
    // The provider cannot refuse: nothing in the list counts, or the id ends in a date.
    expect(verdict.unchecked, where).toBeTypeOf("string");
    expect(here.kind === "unlisted" || (here.kind === "none" && DATED.test(id)), `${where}: ${here.kind}, the provider: ${verdict.unchecked}`).toBe(true);
  }
  // The other way: what the plugin says, the provider says.
  if (here.kind === "whole" || here.kind === "once") expect(verdict.ok, where).toBe(true);
  if (here.kind === "unlisted") expect(verdict.unchecked, where).toBeTypeOf("string");
  return { verdict, here };
}

describe("the plugin's reading of bb's list is the provider's own", () => {
  test.each(CASES)("%s", (_what, id, rows, answer) => {
    expect(served(id, listed(rows), true)).toEqual(answer);
    agree(id, rows);
  });
  test.each(LISTS.map((rows, index) => [index, rows] as const))("every id against list %i, both ways", (_index, rows) => {
    for (const id of IDS) agree(id, rows);
  });
});

describe("the one named difference: a malformed row of bb's", () => {
  // The plugin holds a model's provider as a string or none (app/spawn/models.ts `modelOptions`: an empty or a
  // non-string routeProviderId is none). The provider's check reads such a row as a list it cannot read, and refuses
  // nothing; the plugin drops the row and reads the rest, so it can ask for the provider where the provider lets the
  // launch go. bb is not known to give such a row.
  test.each([["an empty routeProviderId", ""], ["a routeProviderId that is not a string", 7]])("%s", (_what, odd) => {
    const rows = [...by("a/x", "b/x"), { id: "weird", routeProviderId: odd as string }];
    expect(piModelVerdict("x", rows).unchecked).toBe("the list is not one this provider can read");
    expect(served("x", [{ id: "a/x", provider: "a" }, { id: "b/x", provider: "b" }, { id: "weird", provider: null }], true)).toEqual({ kind: "several", ids: ["a/x", "b/x"] });
  });
});

describe("and on lists nobody thought of", () => {
  // A fixed seed: the same lists every run (a failure names its list and id).
  let state = 0x5eed1234;
  const next = (n: number) => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state % n;
  };
  const PROVIDERS = ["openai", "openrouter", "anthropic", "mock"];
  const BARE = ["gpt-6", "openai/gpt-6", "echo", "claude-haiku-5", "gpt-7-20261101", "openrouter/openai/gpt-6"];
  const row = (): BbRow => {
    const bare = BARE[next(BARE.length)]!;
    const shape = next(10);
    if (shape === 0) return { id: bare }; // a model with no provider
    const provider = PROVIDERS[next(PROVIDERS.length)]!;
    return { id: `${provider}/${bare}`, routeProviderId: provider };
  };
  test("20 000 random lists of up to five models (repeats, nested ids, models with no provider), every id of each: the same answer, both ways", () => {
    for (let round = 0; round < 20_000; round += 1) {
      const rows = Array.from({ length: next(6) }, row);
      for (const id of [...BARE, ...rows.map((each) => each.id), "nosuchmodel"]) agree(id, rows);
    }
  });
});

describe("the New agent form, against the provider", () => {
  const form = (id: string, rows: BbRow[]) => modelCheck({ chosenHarness: null, soulHarness: "pi", picked: id, resolved: { harness: "pi", model: null }, listed: rows.length === 0 ? null : listed(rows), byProvider: true });
  const every = [...CASES.map(([, id, rows]) => [id, rows] as const), ...LISTS.flatMap((rows) => IDS.map((id) => [id, rows] as const))];

  test("nothing the provider starts is held: an id it passes, or cannot check, is armed, whether bb's list is whole or narrowed", () => {
    for (const [id, rows] of every)
      for (const options of [{}, { partial: "pi's configuration narrows its models" }]) {
        const verdict = piModelVerdict(id, rows, options);
        if (verdict.refused === undefined) expect(form(id, rows).held, `${JSON.stringify(id)} in ${JSON.stringify(rows)} ${JSON.stringify(options)}`).toBeNull();
      }
  });
  test("\"Pick provider\" offers exactly the ids the provider's own sentence names, and only where the provider refuses though the list is not whole", () => {
    let held = 0;
    for (const [id, rows] of every) {
      const answer = form(id, rows);
      if (answer.held === null) continue;
      held += 1;
      expect(answer.held).toBe("Pick provider");
      for (const options of [{}, { partial: "pi's configuration narrows its models" }]) {
        const verdict = piModelVerdict(id, rows, options);
        expect(verdict.refused, `${JSON.stringify(id)} in ${JSON.stringify(rows)}`).toMatch(/is served by/);
        expect(answer.offers).toEqual(/: use (.*) \(if you just changed/.exec(verdict.refused!)![1]!.split(/, | or /));
      }
    }
    expect(held).toBeGreaterThan(0);
  });
  test("the one limit, said: for a minute after pi's configuration changed the provider does not refuse two listed models, and the form, which cannot know, still asks for the provider", () => {
    const old = { old: "pi's configuration changed a moment ago" };
    expect(piModelVerdict("claude-opus-5-5", TWO, old).unchecked).toBe(old.old);
    expect(form("claude-opus-5-5", TWO)).toEqual({ held: "Pick provider", offers: ["anthropic/claude-opus-5-5", "openrouter/claude-opus-5-5"] });
  });
  test("a harness whose models are not resolved by provider is never held for the list: the provider checks a model for pi alone", () => {
    const two = [{ id: "a/x", provider: "a" }, { id: "b/x", provider: "b" }];
    expect(modelCheck({ chosenHarness: null, soulHarness: "claude", picked: "x", resolved: { harness: "claude", model: null }, listed: two, byProvider: false })).toEqual({ held: null });
    expect(modelCheck({ chosenHarness: null, soulHarness: "pi", picked: "x", resolved: { harness: "pi", model: null }, listed: two, byProvider: true })).toEqual({ held: "Pick provider", offers: ["a/x", "b/x"] });
  });
  test("what the form arms and the provider refuses is refused at the launch, never the reverse: the two refusals the form leaves to it", () => {
    // No listed model serves it: the provider's "pi has no model".
    expect(form("nosuchmodel", TWO).held).toBeNull();
    expect(piModelVerdict("nosuchmodel", TWO).refused).toBe('pi has no model "nosuchmodel" (if you just added it to pi, try again in a minute)');
    // An id with a slash that two serve, on a whole list: the provider's second sentence.
    const two = by("openrouter/openai/gpt-7", "requesty/openai/gpt-7");
    expect(form("openai/gpt-7", two).held).toBeNull();
    expect(piModelVerdict("openai/gpt-7", two).refused).toMatch(/^pi model "openai\/gpt-7" is served by openrouter and requesty: use openrouter\/openai\/gpt-7 or requesty\/openai\/gpt-7 /);
  });
});
