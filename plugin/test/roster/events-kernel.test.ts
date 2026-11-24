// The roster's narrow reader of `oats instance events` (kernel/roster-events.ts): the one argument
// form it builds, what it refuses to build, and the six fields it reads of an answer.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseRosterEvents, rosterEventsArgv, ROSTER_EVENTS_LIMIT } from "../../kernel/roster-events.js";
import { FIXTURES } from "../support/fake-oats.js";

const HOME = "/abs/deployment/agents/oats-developer/instances/flaky-ci-developer";
const SINCE = "2026-11-23T10:00:00.000Z";

describe("oats instance events, for the roster's event path", () => {
  it("builds one argument form, and only from an instance's name, an absolute home and a time as the server stamps one", () => {
    expect(rosterEventsArgv("flaky-ci-developer", HOME, SINCE)).toEqual({
      ok: true,
      value: ["instance", "events", "flaky-ci-developer", "--home", HOME, "--since", SINCE, "--limit", String(ROSTER_EVENTS_LIMIT), "--json"],
    });
    // `--since` is only ever the server's own stamp: nothing else becomes a word of the command.
    for (const since of ["--limit", "", "2026-11-23", "2026-11-23T10:00:00Z", "2026-13-45T99:99:99.999Z", "2026-11-23T10:00:00.000Z --home /etc", " 2026-11-23T10:00:00.000Z", "yesterday"]) {
      expect(rosterEventsArgv("flaky-ci-developer", HOME, since).ok, JSON.stringify(since)).toBe(false);
    }
    expect(rosterEventsArgv("--limit", HOME, SINCE).ok).toBe(false);
    expect(rosterEventsArgv("Flaky CI", HOME, SINCE).ok).toBe(false);
    expect(rosterEventsArgv("flaky-ci-developer", "relative/home", SINCE).ok).toBe(false);
    expect(rosterEventsArgv("flaky-ci-developer", "--home", SINCE).ok).toBe(false);
  });

  it("reads the answer the kernel printed (the instance panel's recording): its claim, and every row's kind, time, incarnation and producer", () => {
    const recorded = JSON.parse(readFileSync(join(FIXTURES, "panel", "events.json"), "utf8")) as { result: { events: { kind: string }[]; incarnation: string } };
    const read = parseRosterEvents(recorded.result);
    if (!read.ok) throw new Error(`${read.error.code}: ${read.error.message}`);
    expect(read.value.truncated).toBe(false);
    expect(read.value.incarnation).toBe(recorded.result.incarnation);
    expect(read.value.waitingOnYou).toMatchObject({ reason: "attention", message: "Which base branch?" });
    expect(read.value.waitingClaims.some((claim) => claim.waiting)).toBe(true);
    expect(read.value.events.map((event) => event.kind)).toEqual(recorded.result.events.map((event) => event.kind));
    expect(read.value.events.map((event) => event.kind)).toEqual(expect.arrayContaining(["stopped", "launched", "waiting"]));
    expect(read.value.events.every((event) => Number.isFinite(Date.parse(event.at)) && event.incarnation !== null && event.producer !== null)).toBe(true);
  });

  it("reads six fields of the answer, and an event of a kind it has never heard of is no failure", () => {
    const answer = {
      eventsApi: 2,
      instance: "flaky-ci-developer",
      incarnation: "2026-11-23T09:00:00.000Z",
      count: 2,
      returned: 2,
      truncated: false,
      integrity: { anything: true },
      events: [
        { eventsApi: 2, at: "2026-11-23T10:00:01.000Z", kind: "some-kind-of-2027", producer: "oats.something", incarnation: "2026-11-23T09:00:00.000Z", data: { whatever: [1, 2] } },
        { eventsApi: 1, at: "2026-11-23T10:00:02.000Z", kind: "stopped", data: {} },
      ],
      waitingOnYou: { since: "2026-11-23T10:00:03.000Z", producer: "agent", reason: null, message: "Keep the retry?", extra: 1 },
      waitingClaims: [{ producer: "agent", waiting: true, since: "2026-11-23T10:00:03.000Z", reason: null, message: "Keep the retry?" }],
    };
    expect(parseRosterEvents(answer)).toEqual({
      ok: true,
      value: {
        truncated: false,
        incarnation: "2026-11-23T09:00:00.000Z",
        waitingOnYou: { since: "2026-11-23T10:00:03.000Z", reason: null, message: "Keep the retry?" },
        waitingClaims: [{ waiting: true }],
        events: [
          { kind: "some-kind-of-2027", at: "2026-11-23T10:00:01.000Z", incarnation: "2026-11-23T09:00:00.000Z", producer: "oats.something" },
          { kind: "stopped", at: "2026-11-23T10:00:02.000Z", incarnation: null, producer: null },
        ],
      },
    });
    // An answer without those fields in their documented shapes is refused whole: the server then changes nothing.
    for (const broken of [{ ...answer, eventsApi: 3 }, { ...answer, truncated: "no" }, { ...answer, waitingClaims: null }, { ...answer, events: [{ kind: "stopped" }] }, { ...answer, waitingOnYou: "yes" }, null, []]) {
      expect(parseRosterEvents(broken).ok).toBe(false);
    }
  });
});
