// The loop that asks a thing back of bb when a stage leaves (container/ask-back.mjs): a wait covers "not yet", never
// "no". On a manual clock: no test here waits real time.
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { expect, test } from "vitest";

type Answer = { outcome: "accepted" | "no-answer" | "refused"; said: string };
interface Result {
  back: boolean;
  refused: string | null;
  after: string;
  answers: string[];
}
interface Failure {
  code?: string;
  status?: number | null;
  signal?: string | null;
  stderr?: string;
}
interface AskBack {
  outcomeOfFailure(error: Failure): "no-answer" | "refused";
  wordsOfFailure(error: Failure & { message?: string }): string;
  outcomeOfMaking(error: Failure): "no-answer" | "refused";
  madeOnce(options: { make: () => Answer; isThere: () => boolean; settle?: () => Promise<void>; times?: number }): Promise<{ made: boolean; refused: string | null; attempts: string[] }>;
  untilQuickAgain(options: { read: () => void; underMs?: number; withinMs?: number; everyMs?: number; now: () => number; sleep: (ms: number) => Promise<void> }): Promise<{ quick: boolean; reads: number; waitedMs: number; slowestMs: number }>;
  askedBack(options: { ask: () => Answer; read: () => string; before: string; withinMs?: number; everyMs?: number; now: () => number; sleep: (ms: number) => Promise<void> }): Promise<Result>;
}
const module = (): Promise<AskBack> => import(pathToFileURL(join(__dirname, "..", "container", "ask-back.mjs")).href) as Promise<AskBack>;

/** A clock that moves only when the loop sleeps, and the answers and reads given in order (the last one stays). */
function scene(answers: Answer[], reads: string[], askTakesMs = 0) {
  let at = 0;
  const slept: number[] = [];
  const count = { asked: 0, read: 0 };
  return {
    slept,
    count,
    options: {
      ask: () => {
        // (A loop that never ends must FAIL here, not hang: its fakes never yield to a timer, so no time limit could end it.)
        if (count.asked >= 50) throw new Error(`asked ${count.asked} times: the loop does not end`);
        at += askTakesMs;
        return answers[Math.min(count.asked++, answers.length - 1)]!;
      },
      read: () => reads[Math.min(count.read++, reads.length - 1)]!,
      before: "auto, 2",
      now: () => at,
      sleep: async (ms: number) => {
        slept.push(ms);
        at += ms;
      },
    },
  };
}
const ACCEPTED: Answer = { outcome: "accepted", said: "falcon: auto" };

test("accepted, and bb says the old value at once: back, asked once, no wait", async () => {
  const { askedBack } = await module();
  const { options, slept, count } = scene([ACCEPTED], ["auto, 2"]);
  expect(await askedBack(options)).toEqual({ back: true, refused: null, after: "auto, 2", answers: ["accepted: falcon: auto"] });
  expect([count.asked, count.read, slept]).toEqual([1, 1, []]);
});

test("accepted, and bb still says the raised value twice, then the old one: back, asked three times", async () => {
  const { askedBack } = await module();
  const { options, slept, count } = scene([ACCEPTED], ["60", "60", "auto, 2"]);
  const result = await askedBack(options);
  expect([result.back, result.refused, result.after, result.answers.length]).toEqual([true, null, "auto, 2", 3]);
  expect([count.asked, count.read, slept]).toEqual([3, 3, [2000, 2000]]);
});

test("no answer in time is 'not yet': asked again, and back once bb accepts and says so", async () => {
  const { askedBack } = await module();
  const { options, count } = scene([{ outcome: "no-answer", said: "no answer in 20 s" }, ACCEPTED], ["60", "auto, 2"]);
  const result = await askedBack(options);
  expect([result.back, result.refused, count.asked]).toEqual([true, null, 2]);
  expect(result.answers).toEqual(["no-answer: no answer in 20 s", "accepted: falcon: auto"]);
});

test("no answer twice, then accepted: back, asked three times", async () => {
  const { askedBack } = await module();
  const silent: Answer = { outcome: "no-answer", said: "no answer in 20.0 s" };
  const { options, slept, count } = scene([silent, silent, ACCEPTED], ["60", "60", "auto, 2"]);
  const result = await askedBack(options);
  expect([result.back, result.refused, count.asked, slept]).toEqual([true, null, 3, [2000, 2000]]);
  expect(result.answers.map((answer) => answer.split(":")[0])).toEqual(["no-answer", "no-answer", "accepted"]);
});

test("THE READ IS THE TRUTH: an asking that got no answer, and bb's read says the old value: back, asked once", async () => {
  // (An asking we ended may have reached bb all the same: what bb says of the limit decides, not what became of the command.)
  const { askedBack } = await module();
  const { options, slept, count } = scene([{ outcome: "no-answer", said: "ended by our limit in 20.0 s" }], ["auto, 2"]);
  expect(await askedBack(options)).toEqual({ back: true, refused: null, after: "auto, 2", answers: ["no-answer: ended by our limit in 20.0 s"] });
  expect([count.asked, count.read, slept]).toEqual([1, 1, []]);
});

test("REFUSED is 'no': over at once with bb's answer, asked ONCE, never read, never waited on", async () => {
  const { askedBack } = await module();
  const { options, slept, count } = scene([{ outcome: "refused", said: "Unknown host:\n  host_x" }, ACCEPTED], ["auto, 2"]);
  expect(await askedBack(options)).toEqual({ back: false, refused: "Unknown host:\n  host_x", after: "", answers: ["refused: Unknown host: host_x"] });
  expect([count.asked, count.read, slept]).toEqual([1, 0, []]);
});

test("a refusal after a 'not yet' is still over at once: not asked a third time", async () => {
  const { askedBack } = await module();
  const { options, count } = scene([ACCEPTED, { outcome: "refused", said: "no" }, ACCEPTED], ["60", "auto, 2"]);
  const result = await askedBack(options);
  expect([result.back, result.refused, result.after, count.asked, count.read]).toEqual([false, "no", "60", 2, 1]);
});

test("the wait is bounded: bb never says the old value: not back when the time is out, every asking said", async () => {
  const { askedBack } = await module();
  const { options, slept, count } = scene([ACCEPTED], ["60"]);
  const result = await askedBack({ ...options, withinMs: 6000 });
  expect([result.back, result.refused, result.after]).toEqual([false, null, "60"]);
  // Asked at 0, 2, 4 and 6 seconds: the asking at the bound is the last.
  expect([count.asked, result.answers.length, slept]).toEqual([4, 4, [2000, 2000, 2000]]);
});

test("the bound is a MINUTE where none is given, and it is on when the last asking starts: asked every two seconds from 0 to 60", async () => {
  const { askedBack } = await module();
  const { options, slept, count } = scene([ACCEPTED], ["60"]);
  const result = await askedBack(options);
  expect([result.back, result.refused, count.asked, result.answers.length]).toEqual([false, null, 31, 31]);
  expect([slept.length, slept.reduce((sum, ms) => sum + ms, 0)]).toEqual([30, 60_000]);
});

test("no asking STARTS once the bound has passed: with askings that take 28.9 s, the third would start at 61.8 s and is not begun", async () => {
  const { askedBack } = await module();
  const { options, slept, count } = scene([ACCEPTED], ["60"], 28_900);
  const result = await askedBack(options);
  // Asked at 0 and at 30.9 s; the second ends at 59.8 s, and a wait of 2 s would end past the minute.
  expect([result.back, result.refused, count.asked, slept]).toEqual([false, null, 2, [2000]]);
});

// WHAT A FAILED bb COMMAND WAS (`outcomeOfFailure`): the error is the one node's execFileSync throws.
const DID_NOT_RESPOND =
  "bb did not respond at http://127.0.0.1:37963 after 3 attempts (last window 4000ms) \u2014 it may be busy or temporarily unreachable. No server response was received and your command did not run; re-run it.";

test("our own time limit ending the command is NO ANSWER", async () => {
  const { outcomeOfFailure } = await module();
  expect(outcomeOfFailure({ code: "ETIMEDOUT", status: null, signal: "SIGTERM", stderr: "" })).toBe("no-answer");
});

test("bb's CLI giving up by ITSELF is NO ANSWER too, though it exits 1: its own words at the pinned version", async () => {
  const { outcomeOfFailure } = await module();
  expect(outcomeOfFailure({ status: 1, signal: null, stderr: `${DID_NOT_RESPOND}\n` })).toBe("no-answer");
  expect(outcomeOfFailure({ status: 1, signal: null, stderr: "BB request timed out after 75s.\n" })).toBe("no-answer");
  // …also under a line of its own above it (a warning bb prints first), each of the two.
  expect(outcomeOfFailure({ status: 1, signal: null, stderr: `(node:1) Warning: something\n${DID_NOT_RESPOND}\n` })).toBe("no-answer");
  expect(outcomeOfFailure({ status: 1, signal: null, stderr: "(node:1) Warning: something\nBB request timed out after 75 seconds.\n" })).toBe("no-answer");
});

test("bb ANSWERING NO is a refusal: any other message of a non-zero exit; and so are a signal and a bb that is not there", async () => {
  const { outcomeOfFailure } = await module();
  expect(outcomeOfFailure({ status: 1, signal: null, stderr: "Unknown host: host_x (Run `bb machine list` for the enrolled host ids.)\n" })).toBe("refused");
  expect(outcomeOfFailure({ status: 1, signal: null, stderr: "Cannot reach bb at http://127.0.0.1:1: connect ECONNREFUSED\n" })).toBe("refused");
  expect(outcomeOfFailure({ status: 3, signal: null, stderr: "" })).toBe("refused");
  expect(outcomeOfFailure({ status: null, signal: "SIGKILL", stderr: "" })).toBe("refused");
  expect(outcomeOfFailure({ code: "ENOENT", status: null, signal: null })).toBe("refused");
  // bb's words for "no answer" inside ANOTHER message do not make it one: they are read at a line's start.
  expect(outcomeOfFailure({ status: 1, signal: null, stderr: "Unknown host: bb did not respond at x after 3 attempts\n" })).toBe("refused");
  expect(outcomeOfFailure({ status: 1, signal: null, stderr: "Unknown host: BB request timed out after 75s.\n" })).toBe("refused");
  // …and a signal's death that left those words behind is not bb's own giving up.
  expect(outcomeOfFailure({ status: null, signal: "SIGKILL", stderr: `${DID_NOT_RESPOND}\n` })).toBe("refused");
});

test("the one line said of a failed command: bb's own words for giving up, else its last line, else the error's message", async () => {
  const { wordsOfFailure } = await module();
  expect(wordsOfFailure({ status: 1, stderr: `(node:1) Warning: something\n${DID_NOT_RESPOND}\n\n` })).toBe(DID_NOT_RESPOND);
  expect(wordsOfFailure({ status: 1, stderr: `${DID_NOT_RESPOND}\nat some line after it\n` })).toBe(DID_NOT_RESPOND);
  // A refusal under a warning says bb's error, not the warning.
  expect(wordsOfFailure({ status: 1, stderr: "(node:1) Warning: something\n  Unknown host: host_x  \n" })).toBe("Unknown host: host_x");
  expect(wordsOfFailure({ code: "ENOENT", stderr: "", message: "spawnSync bb ENOENT\nmore" })).toBe("spawnSync bb ENOENT");
  expect(wordsOfFailure({ code: "ETIMEDOUT", message: "spawnSync bb ETIMEDOUT" })).toBe("spawnSync bb ETIMEDOUT");
});

// A THING MADE IN bb EXACTLY ONCE (`madeOnce`): the busy stage's held spawns.
function making(answers: Answer[], there: boolean[]) {
  const count = { made: 0, asked: 0, settled: 0 };
  return {
    count,
    options: {
      make: () => {
        if (count.made >= 20) throw new Error(`made ${count.made} times: the loop does not end`);
        return answers[Math.min(count.made++, answers.length - 1)]!;
      },
      isThere: () => there[Math.min(count.asked++, there.length - 1)]!,
      settle: async () => void (count.settled += 1),
    },
  };
}
const SILENT: Answer = { outcome: "no-answer", said: "exit 1 in 10.9 s: bb did not respond" };

test("a making bb accepted is made, once: bb's list is not even asked", async () => {
  const { madeOnce } = await module();
  const { options, count } = making([ACCEPTED], [false]);
  expect(await madeOnce(options)).toEqual({ made: true, refused: null, attempts: ["accepted: falcon: auto"] });
  expect([count.made, count.asked, count.settled]).toEqual([1, 0, 0]);
});

test("a making with NO ANSWER that bb lists all the same HAPPENED: it is never made twice", async () => {
  const { madeOnce } = await module();
  const { options, count } = making([SILENT, ACCEPTED], [true]);
  const result = await madeOnce(options);
  expect([result.made, result.refused, count.made, count.asked, count.settled]).toEqual([true, null, 1, 1, 1]);
  expect(result.attempts).toEqual(["no-answer: exit 1 in 10.9 s: bb did not respond; bb lists it all the same"]);
});

test("a making with no answer that bb does not list is made again, after bb has settled; then accepted", async () => {
  const { madeOnce } = await module();
  const { options, count } = making([SILENT, ACCEPTED], [false]);
  const result = await madeOnce(options);
  expect([result.made, count.made, count.asked, count.settled, result.attempts.length]).toEqual([true, 2, 1, 1, 2]);
});

test("THREE times at most: no answer and never listed: not made, every making said", async () => {
  const { madeOnce } = await module();
  const { options, count } = making([SILENT], [false]);
  const result = await madeOnce(options);
  expect([result.made, result.refused, count.made, count.asked, result.attempts.length]).toEqual([false, null, 3, 3, 3]);
});

test("a making bb REFUSED is over at once: not made again, bb's list not asked", async () => {
  const { madeOnce } = await module();
  const { options, count } = making([{ outcome: "refused", said: "HTTP 503: no model" }, ACCEPTED], [true]);
  expect(await madeOnce(options)).toEqual({ made: false, refused: "HTTP 503: no model", attempts: ["refused: HTTP 503: no model"] });
  expect([count.made, count.asked, count.settled]).toEqual([1, 0, 0]);
});

// bb ANSWERS QUICKLY AGAIN (`untilQuickAgain`): a wait on bb's state, with a bound, on a manual clock.
function reading(tookMs: number[]) {
  let at = 0;
  let read = 0;
  const slept: number[] = [];
  return {
    slept,
    reads: () => read,
    options: {
      read: () => {
        if (read >= 200) throw new Error(`read ${read} times: the wait does not end`);
        at += tookMs[Math.min(read++, tookMs.length - 1)]!;
      },
      now: () => at,
      sleep: async (ms: number) => {
        slept.push(ms);
        at += ms;
      },
    },
  };
}

test("bb's read is quick at once: no wait", async () => {
  const { untilQuickAgain } = await module();
  const { options, slept } = reading([120]);
  expect(await untilQuickAgain(options)).toEqual({ quick: true, reads: 1, waitedMs: 120, slowestMs: 120 });
  expect(slept).toEqual([]);
});

test("bb's read is slow twice, then quick: waited until it is; exactly a second is not under a second", async () => {
  const { untilQuickAgain } = await module();
  const { options, slept } = reading([4000, 1000, 300]);
  expect(await untilQuickAgain(options)).toEqual({ quick: true, reads: 3, waitedMs: 4000 + 500 + 1000 + 500 + 300, slowestMs: 4000 });
  expect(slept).toEqual([500, 500]);
});

test("the wait is BOUNDED: bb stays slow: not quick, after thirty seconds, and it says its slowest read", async () => {
  const { untilQuickAgain } = await module();
  const { options, reads } = reading([2500]);
  const result = await untilQuickAgain(options);
  // Reads of 2.5 s with half a second between: ten reads end at 29.5 s, the eleventh at 32.5 s: past the bound.
  expect([result.quick, result.reads, reads(), result.waitedMs, result.slowestMs]).toEqual([false, 11, 11, 32_500, 2500]);
});

// WHAT A FAILED MAKING WAS (`outcomeOfMaking`): as a failed asking, and bb's own 5xx of a fetch that failed inside it.
test("bb's 502 for a fetch that failed inside it is NO ANSWER on the making; another 5xx, or a 502 of another kind, is a refusal", async () => {
  const { outcomeOfMaking } = await module();
  const stalled = 'Error: Failed to create thread: HTTP 502: The "project-checkout" environment provider (plugin "environment-project-checkout") failed to validate the request: fetch failed\n';
  expect(outcomeOfMaking({ status: 1, signal: null, stderr: stalled })).toBe("no-answer");
  expect(outcomeOfMaking({ status: 1, signal: null, stderr: `${DID_NOT_RESPOND}\n` })).toBe("no-answer");
  expect(outcomeOfMaking({ code: "ETIMEDOUT", status: null, signal: "SIGTERM", stderr: "" })).toBe("no-answer");
  expect(outcomeOfMaking({ status: 1, signal: null, stderr: "Error: Failed to create thread: HTTP 503: the harness gave no default model\n" })).toBe("refused");
  expect(outcomeOfMaking({ status: 1, signal: null, stderr: "Error: Failed to create thread: HTTP 502: Terminal failed to open: ENOENT\n" })).toBe("refused");
  expect(outcomeOfMaking({ status: 1, signal: null, stderr: "Error: Failed to create thread: HTTP 400: fetch failed\n" })).toBe("refused");
  expect(outcomeOfMaking({ status: null, signal: "SIGKILL", stderr: stalled })).toBe("refused");
});
