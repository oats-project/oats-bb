// THE PACING of the status reads (server/core.ts `reread`), on a clock a test moves by hand: each pause is the wait
// the server ASKED its clock for, held EXACTLY. Nothing here is a length of real time: a read is held in flight by a
// GATE the test opens (a file the fake `oats` waits on), never by how long the fake sleeps; a test that is scheduled
// late does the same things in the same order. (The same rules run once on the system's clock in
// test/server.test.ts, with lower bounds only.)
import { rmSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { createCore, FOLLOW_UP_WITHIN_MS, MIN_INTERVAL_MS, SYSTEM_CLOCK, type Clock, type Core } from "../../server/core.js";
import { startBackend, type Backend } from "../support/backend.js";
import type { Behaviour } from "../support/fake-oats.js";

// A pacing test starts a fake `oats` and a core: its truth is not in how long that takes. Its own limit stands far
// above the runner's default (5 s), so that a stalled host fails none of them.
const PACING_TEST_MS = 60_000;

/** A clock that stands still until it is moved: `advance` by the test, or a wait the server asks for (recorded with its signal, and over at once). */
function manualClock() {
  let time = Date.UTC(2026, 10, 26, 9, 0, 0);
  const waits: number[] = [];
  const signals: AbortSignal[] = [];
  const clock: Clock = {
    now: () => time,
    sleep: async (ms, signal) => {
      waits.push(ms);
      signals.push(signal);
      time += ms;
    },
  };
  return { clock, waits, signals, advance: (ms: number) => void (time += ms) };
}

let backend: Backend | null = null;
let core: Core;
let hand: ReturnType<typeof manualClock>;
const start = async () => {
  hand = manualClock();
  backend = await startBackend({ load: (bb) => void (core = createCore(bb, hand.clock)) });
  return backend;
};
afterEach(async () => {
  await backend?.dispose();
  backend = null;
});

const statuses = async () => (await backend!.fake.calls()).filter((call) => call.verb === "status").length;
/** Resolves once the fake `oats` has been started for the `nth` status read: that read is in flight (its start has been read from the clock), and it STAYS in flight until its gate is opened. */
const inFlight = (nth: number) => expect.poll(statuses, { timeout: 30_000, interval: 5 }).toBe(nth);
/**
 * THE GATE of the status reads that start from now on: each waits, in flight, until `open()`. A gate has a name: a
 * read that is already in flight keeps the gate it started with, and the next read takes the one set since.
 */
async function gate(name: string, behaviour: Behaviour = {}) {
  const file = join(backend!.fake.deployment, `gate-${name}`);
  writeFileSync(file, "");
  await backend!.fake.behave({ status: { ...behaviour, whileFile: file } });
  return { open: () => rmSync(file, { force: true }) };
}
const said = () => backend!.server.harness.logEntries.filter((entry) => entry.level === "debug" && entry.message.startsWith("oats status is read again")).map((entry) => entry.message);

describe("the pause between two status reads, exactly", () => {
  it("the first read waits nothing; the next waits the FLOOR, less what has passed since the last one ended; never more than the floor", async () => {
    await start();
    await core.reread();
    expect(hand.waits).toEqual([0]); // nothing was read before: no pause
    await core.reread(); // asked at once after it
    expect(hand.waits).toEqual([0, MIN_INTERVAL_MS]);
    hand.advance(400);
    await core.reread(); // asked 400 ms after the last one ended
    expect(hand.waits).toEqual([0, MIN_INTERVAL_MS, MIN_INTERVAL_MS - 400]);
    hand.advance(60_000);
    await core.reread(); // asked long after: no pause is left
    expect(hand.waits.at(-1)).toBe(0);
    // The clock set BACK (an hour): the last read's end lies ahead of it. The pause is the floor, never the whole step.
    hand.advance(-3_600_000);
    await core.reread();
    expect(hand.waits.at(-1)).toBe(MIN_INTERVAL_MS);
    expect(await statuses()).toBe(5);
  }, PACING_TEST_MS);

  it("after a read that took longer than the floor, the pause is THAT read's own time: a slow kernel is not read without pause; after a quick read it is the floor again", async () => {
    await start();
    const first = await gate("first");
    const reading = core.reread();
    await inFlight(1);
    hand.advance(2_500); // read 1 takes 2.5 s on the server's clock
    first.open();
    await reading;
    await backend!.fake.behave({});
    await core.reread(); // read 2, asked at once: it waits read 1's own time
    expect(hand.waits.at(-1)).toBe(2_500);
    await core.reread(); // read 3: read 2 took no time
    expect(hand.waits.at(-1)).toBe(MIN_INTERVAL_MS);
  }, PACING_TEST_MS);

  it("after a read that FAILED the pause is the floor, whatever the failed read's length: Retry is not held back by a timeout's own time", async () => {
    await start();
    const first = await gate("first", { exit: 1, stdout: "", stderr: "boom" });
    const reading = core.reread();
    await inFlight(1);
    hand.advance(2_500);
    first.open();
    expect(((await reading) as { ok: boolean }).ok).toBe(false);
    await backend!.fake.behave({});
    const next = (await core.reread()) as { ok: boolean };
    expect(hand.waits.at(-1)).toBe(MIN_INTERVAL_MS); // not 2.5 s
    expect(next.ok).toBe(true);
  }, PACING_TEST_MS);

  it("the pause is asked with the SERVER's own life: the wait's signal is the core's (`core.signal`, aborted when the plugin ends), so the wait ends with the server", async () => {
    await start();
    await core.reread();
    await core.reread();
    expect(hand.signals).toHaveLength(2);
    expect(hand.signals.every((signal) => signal === core.signal)).toBe(true);
  }, PACING_TEST_MS);
});

describe("the read asked for WHILE a read is in flight", () => {
  it("is read AT ONCE when the read in flight answered within the limit: no wait is asked for it; and the read asked for during THAT one waits the pause: one read at once, never two", async () => {
    await start();
    await core.reread(); // read 1, ended
    const second = await gate("second");
    const waitsBefore = hand.waits.length;
    const reading = core.reread(); // read 2: after the floor, then in flight
    await inFlight(2);
    hand.advance(700); // read 2 takes 700 ms
    core.rereadSoon(); // a change, mid-read: read 3 is asked for
    const third = await gate("third"); // (read 3 will be held by a gate of its own)
    second.open();
    await reading;
    await inFlight(3); // read 3 started…
    expect(hand.waits.slice(waitsBefore)).toEqual([MIN_INTERVAL_MS]); // …with NO wait asked since read 2's own
    expect(said()).toEqual([`oats status is read again at once: asked for while a read was in flight, which answered in 700 ms`]);
    hand.advance(900); // read 3 takes 900 ms
    core.rereadSoon(); // a change during read 3: read 4 is asked for
    await backend!.fake.behave({});
    third.open();
    await inFlight(4);
    // Read 4 waited: the floor (read 3's 900 ms are under it), counted from read 3's end.
    expect(hand.waits.slice(waitsBefore)).toEqual([MIN_INTERVAL_MS, MIN_INTERVAL_MS]);
    expect(said()[1]).toBe("oats status is read again after the pause: asked for while a read was in flight, which was itself read at once");
    await core.reread(); // (the queue runs dry before the backend is disposed)
  }, PACING_TEST_MS);

  it("waits the pause when the read in flight took LONGER than the limit: the pause is that read's own time", async () => {
    await start();
    await core.reread();
    const second = await gate("second");
    const reading = core.reread();
    await inFlight(2);
    const took = FOLLOW_UP_WITHIN_MS + 1_500;
    hand.advance(took);
    core.rereadSoon();
    await backend!.fake.behave({});
    second.open();
    await reading;
    await inFlight(3);
    expect(hand.waits.at(-1)).toBe(took);
    expect(said()).toEqual([`oats status is read again after the pause: asked for while a read was in flight, which answered in ${took} ms, over ${FOLLOW_UP_WITHIN_MS} ms`]);
    await core.reread();
  }, PACING_TEST_MS);

  it("waits the floor when the read in flight FAILED: a failed read is not followed at once", async () => {
    await start();
    const first = await gate("first", { exit: 1, stdout: "", stderr: "boom" });
    const reading = core.reread();
    await inFlight(1);
    hand.advance(400);
    core.rereadSoon();
    await backend!.fake.behave({});
    first.open();
    expect(((await reading) as { ok: boolean }).ok).toBe(false);
    await inFlight(2);
    expect(hand.waits.at(-1)).toBe(MIN_INTERVAL_MS);
    expect(said()).toEqual(["oats status is read again after the pause: asked for while a read was in flight, which gave no answer to count (it failed, or the settings changed under it)"]);
    await core.reread();
  }, PACING_TEST_MS);
});

describe("the clock's seam", () => {
  it("every reading of the time and every wait in server/core.ts goes through the core's clock: none is a bare one", async () => {
    const source = await readFile(fileURLToPath(new URL("../../server/core.ts", import.meta.url)), "utf8");
    // The system's clock itself: the body of the one `sleep` (its timer), to its closing brace, and the one line that names `Date.now`.
    const from = source.indexOf("function sleep(");
    const system = source.slice(from, source.indexOf("\n}\n", from) + 3);
    expect(system).toMatch(/setTimeout\(done, ms\)/);
    expect(system.split("\n").length).toBeLessThan(15);
    // THE SCAN IS BY NAME, not by spelling: outside the system's own clock a line of code may not hold the NAME of
    // anything that reads the time or waits, however it is called, taken as a value or reached:
    //   - `Date`, but to make a date of a GIVEN time (`new Date(<an argument>)`) or to read one (`Date.parse(`);
    //   - the system's `sleep` and `SYSTEM_CLOCK` (the core's own `clock.sleep(` is the seam);
    //   - the platform's timers and clocks: `setTimeout`, `setInterval`, `setImmediate`, `AbortSignal.timeout`,
    //     `performance`, `process.hrtime`, `process.uptime`, `scheduler`, and any module of `timers`.
    const bare = (line: string) => {
      const code = line.replace(/new Date\((?=\s*[^)\s])/g, "").replace(/\bDate\.parse\(/g, "");
      return /\bDate\b|(?<!\bclock\.)\bsleep\b|\bSYSTEM_CLOCK\b|\bsetTimeout\b|\bsetInterval\b|\bsetImmediate\b|AbortSignal\.timeout|\bperformance\b|\bprocess\s*\.\s*(hrtime|uptime)\b|\bscheduler\b|\btimers\b/.test(code);
    };
    // The lines of code: a comment that STARTS a line is taken off it (what follows a closed block comment is code); a
    // line that is only a comment is none. The three lines that ARE the seam are named, whole, and held below.
    const SEAM = ["export const SYSTEM_CLOCK: Clock = { now: () => Date.now(), sleep };", "export type Clock = { now(): number; sleep(ms: number, signal: AbortSignal): Promise<void> };"];
    const lines = source
      .replace(system, "")
      .split("\n")
      .map((line) => line.replace(/^\s*\/\*.*?\*\//, ""))
      .filter((line) => !/^\s*(\*|\/\/|\/\*)/.test(line) && !SEAM.includes(line));
    const core = lines.filter((line) => /\bclock: Clock = SYSTEM_CLOCK\b/.test(line));
    expect(core.length).toBe(1); // `createCore`'s own default, and nowhere else
    expect(lines.filter((line) => !core.includes(line) && bare(line))).toEqual([]);
    for (const line of SEAM) expect([line, source.split("\n").filter((candidate) => candidate === line).length]).toEqual([line, 1]); // (`now` asked anew at each reading: a test that mocks `Date.now` is seen)
    // Inside the system's `sleep` the one timer is its own, and it reads no time.
    expect(/\bDate\b|\bperformance\b|\bprocess\b|\bsetInterval\b|\bsetImmediate\b/.test(system)).toBe(false);
    // (And the scan's own words are not idle: each is a spelling it catches.)
    for (const spelling of [
      "const when = Date.now();",
      "const d = +new Date;",
      "const d = new Date();",
      "const d = new Date( );",
      "const { now } = Date; clientSeenAt = now();",
      'const at = Date["now"]();',
      "const d = new globalThis.Date();",
      "const at = Date.parse(Date());",
      "let from = SYSTEM_CLOCK.now();",
      "await SYSTEM_CLOCK.sleep(POLL_MS, signal);",
      "const wait = sleep; await wait(POLL_MS, signal);",
      "await sleep(5, signal);",
      "const s = AbortSignal.timeout(5_000);",
      'import { setTimeout as wait } from "node:timers/promises";',
      'await (await import("timers/promises")).scheduler.wait(5);',
      "const at = process.hrtime.bigint();",
      "performance.now()",
      "setTimeout(done, 5);",
    ]) {
      expect([spelling, bare(spelling)]).toEqual([spelling, true]);
    }
    for (const fine of ["const at = new Date(stamp()).toISOString();", "await clock.sleep(5, signal);", "lastStart = clock.now();", "const ms = Date.parse(first.at);", "at: new Date(clock.now()).toISOString(),"]) {
      expect([fine, bare(fine)]).toEqual([fine, false]);
    }
    // A comment that starts a line does not hide the code after it.
    expect("/* when */ const startedAt = Date.now();".replace(/^\s*\/\*.*?\*\//, "")).toBe(" const startedAt = Date.now();");
  });

  it("the server's own clock is the system's: its `now` is the time now, and its wait ends when the server does", async () => {
    const before = Date.now();
    const now = SYSTEM_CLOCK.now();
    expect(now).toBeGreaterThanOrEqual(before);
    const ended = new AbortController();
    const waiting = SYSTEM_CLOCK.sleep(3_600_000, ended.signal); // an hour, which no test waits: the server's end ends it
    ended.abort();
    await waiting;
    await SYSTEM_CLOCK.sleep(0, new AbortController().signal);
  });
});
