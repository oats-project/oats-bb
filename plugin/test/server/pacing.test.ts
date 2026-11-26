// THE PACING of the status reads (server/core.ts `reread`), on a clock a test moves by hand: each pause is the wait
// the server ASKED its clock for, held EXACTLY. No test here waits a pause or bounds real time: a loaded host cannot
// fail them. (The same rules run once on the system's clock in test/server.test.ts, with lower bounds only.)
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { createCore, FOLLOW_UP_WITHIN_MS, MIN_INTERVAL_MS, SYSTEM_CLOCK, type Clock, type Core } from "../../server/core.js";
import { startBackend, type Backend } from "../support/backend.js";

/** A clock that stands still until it is moved: `advance` by the test, or a wait the server asks for (which is recorded, and over at once). */
function manualClock() {
  let time = Date.UTC(2026, 10, 26, 9, 0, 0);
  const waits: number[] = [];
  const clock: Clock = {
    now: () => time,
    sleep: async (ms) => {
      waits.push(ms);
      time += ms;
    },
  };
  return { clock, waits, advance: (ms: number) => void (time += ms), now: () => time };
}

let backend: Backend;
let core: Core;
let hand: ReturnType<typeof manualClock>;
const start = async () => {
  hand = manualClock();
  backend = await startBackend({ load: (bb) => void (core = createCore(bb, hand.clock)) });
};
afterEach(() => backend.dispose());

/** How long the fake `oats` really takes where a test must act WHILE a read is in flight: only so that it IS in flight; no test measures it. */
const IN_FLIGHT = { status: { sleepMs: 300 } };
const statuses = async () => (await backend.fake.calls()).filter((call) => call.verb === "status").length;
/** Resolves once the fake `oats` has been started for the `nth` status read: that read is in flight, and its start has been read from the clock. */
const inFlight = (nth: number) => expect.poll(statuses, { timeout: 20_000, interval: 5 }).toBe(nth);
/** A read that TAKES `ms` on the server's clock: the clock is moved while the fake `oats` runs. */
async function readTaking(ms: number, nth: number, read: () => Promise<unknown> = () => core.reread()) {
  const reading = read();
  await inFlight(nth);
  hand.advance(ms);
  return reading;
}
const said = () => backend.server.harness.logEntries.filter((entry) => entry.level === "debug" && entry.message.startsWith("oats status is read again")).map((entry) => entry.message);

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
  });

  it("after a read that took longer than the floor, the pause is THAT read's own time: a slow kernel is not read without pause; after a quick read it is the floor again", async () => {
    await start();
    await backend.fake.behave(IN_FLIGHT);
    await readTaking(2_500, 1); // read 1 took 2.5 s on the server's clock
    await backend.fake.behave({});
    await core.reread(); // read 2, asked at once: it waits read 1's own time
    expect(hand.waits.at(-1)).toBe(2_500);
    await core.reread(); // read 3: read 2 was quick
    expect(hand.waits.at(-1)).toBe(MIN_INTERVAL_MS);
  });

  it("after a read that FAILED the pause is the floor, whatever the failed read's length: Retry is not held back by a timeout's own time", async () => {
    await start();
    await backend.fake.behave({ status: { exit: 1, stdout: "", stderr: "boom", sleepMs: 300 } });
    const failed = (await readTaking(2_500, 1)) as { ok: boolean };
    expect(failed.ok).toBe(false);
    await backend.fake.behave({});
    const next = (await core.reread()) as { ok: boolean };
    expect(hand.waits.at(-1)).toBe(MIN_INTERVAL_MS); // not 2.5 s
    expect(next.ok).toBe(true);
  });
});

describe("the read asked for WHILE a read is in flight", () => {
  it("is read AT ONCE when the read in flight answered within the limit: no wait is asked for it; and the read asked for during THAT one waits the pause: one read at once, never two", async () => {
    await start();
    await core.reread(); // read 1, ended
    await backend.fake.behave(IN_FLIGHT);
    const waitsBefore = hand.waits.length;
    const second = core.reread(); // read 2: after the floor, then in flight
    await inFlight(2);
    hand.advance(700); // read 2 will have taken 700 ms
    core.rereadSoon(); // a change, mid-read: read 3 is asked for
    await second;
    await inFlight(3); // read 3 started…
    expect(hand.waits.slice(waitsBefore)).toEqual([MIN_INTERVAL_MS]); // …with NO wait asked since read 2's own
    expect(said()).toEqual([`oats status is read again at once: asked for while a read was in flight, which answered in 700 ms`]);
    hand.advance(900); // read 3 will have taken 900 ms
    core.rereadSoon(); // a change during read 3: read 4 is asked for
    await inFlight(4);
    // Read 4 waited: the floor (read 3's 900 ms are under it), counted from read 3's end.
    expect(hand.waits.slice(waitsBefore)).toEqual([MIN_INTERVAL_MS, MIN_INTERVAL_MS]);
    expect(said()[1]).toBe("oats status is read again after the pause: asked for while a read was in flight, which was itself read at once");
    await core.reread(); // (the queue runs dry before the backend is disposed)
  });

  it("waits the pause when the read in flight took LONGER than the limit: the pause is that read's own time", async () => {
    await start();
    await core.reread();
    await backend.fake.behave(IN_FLIGHT);
    const second = core.reread();
    await inFlight(2);
    const took = FOLLOW_UP_WITHIN_MS + 1_500;
    hand.advance(took);
    core.rereadSoon();
    await second;
    await inFlight(3);
    expect(hand.waits.at(-1)).toBe(took);
    expect(said()).toEqual([`oats status is read again after the pause: asked for while a read was in flight, which answered in ${took} ms, over ${FOLLOW_UP_WITHIN_MS} ms`]);
    await core.reread();
  });

  it("waits the floor when the read in flight FAILED: a failed read is not followed at once", async () => {
    await start();
    await backend.fake.behave({ status: { exit: 1, stdout: "", stderr: "boom", sleepMs: 300 } });
    const first = core.reread();
    await inFlight(1);
    hand.advance(400);
    core.rereadSoon();
    expect(((await first) as { ok: boolean }).ok).toBe(false);
    await inFlight(2);
    expect(hand.waits.at(-1)).toBe(MIN_INTERVAL_MS);
    expect(said()).toEqual(["oats status is read again after the pause: asked for while a read was in flight, which gave no answer to count (it failed, or the settings changed under it)"]);
    await core.reread();
  });
});

describe("the clock's seam", () => {
  it("every reading of the time and every wait in server/core.ts goes through the core's clock: none is a bare one", async () => {
    const source = await readFile(fileURLToPath(new URL("../../server/core.ts", import.meta.url)), "utf8");
    // The system's clock itself: the one `sleep` (its timer) and the one line that names `Date.now`.
    const system = source.slice(source.indexOf("function sleep("), source.indexOf("export type Verb"));
    expect(system).toMatch(/setTimeout\(done, ms\)/);
    const rest = source.replace(system, "").split("\n").filter((line) => !/^\s*(\*|\/\/|\/\*)/.test(line) && !line.includes("export const SYSTEM_CLOCK") && !line.startsWith("export type Clock = "));
    const bare = rest.filter((line) => /\bDate\.now\b|\bnew Date\(\)|\bperformance\.now\b|\bsetTimeout\(|\bsetInterval\(|(?<![.\w])sleep\(/.test(line));
    expect(bare).toEqual([]);
    expect(source.match(/export const SYSTEM_CLOCK: Clock = \{ now: \(\) => Date\.now\(\), sleep \};/)).not.toBeNull(); // asked anew at each reading: a test that mocks `Date.now` is seen
    expect(rest.join("\n").match(/\bclock\.(now|sleep)\(/g)).toHaveLength(20); // 17 readings, 2 waits and the act log's time: a new one is counted here
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
