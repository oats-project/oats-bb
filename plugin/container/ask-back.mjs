/**
 * A thing asked back of bb when a stage leaves, until bb SAYS it is back: the loop of the busy stage's "bb's own
 * concurrency limit is back", on its own so that a unit test holds its three cases (test/container-ask-back.test.ts).
 *
 * `ask()` → `{ outcome, said }` asks once and KEEPS ITS OUTCOME: "accepted" (bb did it), "no-answer" (bb did not
 * answer in time) or "refused" (bb answered with an error). `read()` → what bb says of the thing now. Then:
 *   refused: over AT ONCE: bb said no, and a wait covers "not yet", never "no". It is asked once, never again, and
 *   bb is not read;
 *   otherwise bb is READ, and THE READ IS THE TRUTH: where it equals `before`, the thing is back: done. Also after
 *   an asking that got no answer: an asking we ended may have reached bb all the same;
 *   the read does not say so (after an accepted asking, or one with no answer): NOT YET: asked again after
 *   `everyMs`.
 * → `{ back, refused, after, answers }`: `back` is true only where bb's read said `before`; `refused` is bb's answer
 * where it said no, else null; `answers` is every asking, in order, as "<outcome>: <what bb said>".
 *
 * THE BOUND: no asking STARTS once `withinMs` have passed since the first: a wait that would end past the bound is
 * not begun. An asking that started in time, and its read, are still waited for (an asking takes the caller's own
 * limit at most; a read has bb's).
 */
export async function askedBack({ ask, read, before, withinMs = 60_000, everyMs = 2_000, now = () => Date.now(), sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)) }) {
  const answers = [];
  const until = now() + withinMs;
  let after = "";
  for (;;) {
    const answer = await ask();
    answers.push(`${answer.outcome}: ${String(answer.said).replace(/\s+/g, " ").slice(0, 140)}`);
    if (answer.outcome === "refused") return { back: false, refused: String(answer.said), after, answers };
    after = await read();
    if (after === before) return { back: true, refused: null, after, answers };
    if (now() + everyMs > until) return { back: false, refused: null, after, answers };
    await sleep(everyMs);
  }
}

/**
 * What a FAILED `bb` command was, from the error node's `execFileSync` throws (`code`, `status`, `signal`,
 * `stderr`): "no-answer" or "refused". Two things are NO ANSWER, and both end the command non-zero:
 *   - our own time limit ended the command: node says `code: "ETIMEDOUT"`;
 *   - bb's CLI gave up by ITSELF before that: it tries a server that does not answer three times, in about eleven
 *     seconds, and exits 1 saying "bb did not respond at <url> after 3 attempts … No server response was received and
 *     your command did not run; re-run it."; or a request of its own ran out: "BB request timed out after …". These
 *     are bb-app's words at the pinned version (0.50.1): `NO_ANSWER` holds them, and a test holds the whole sentence.
 * EVERYTHING ELSE is "refused": an exit with any other message (bb answered no), a signal, a `bb` that is not there.
 * Words bb changes in a later version fall here too: the check then fails at once, with them, and says so.
 */
export const NO_ANSWER = [/^bb did not respond at \S+ after \d+ attempts\b/m, /^BB request timed out after\b/m];
export function outcomeOfFailure(error) {
  if (error?.code === "ETIMEDOUT") return "no-answer";
  const said = String(error?.stderr ?? "");
  if (typeof error?.status === "number" && error.status !== 0 && NO_ANSWER.some((words) => words.test(said))) return "no-answer";
  return "refused";
}

/**
 * The ONE line of a failed command's error that says what happened, for the check's detail: bb's own words for
 * giving up where the failure is one (the line `NO_ANSWER` matched), else the LAST line that is not empty (bb prints
 * its error last; a warning of node's may stand above it), else the error's own message.
 */
export function wordsOfFailure(error) {
  const lines = String(error?.stderr ?? "").split("\n").map((line) => line.trim()).filter((line) => line !== "");
  return lines.find((line) => NO_ANSWER.some((words) => words.test(line))) ?? lines.at(-1) ?? String(error?.message ?? "").trim().split("\n")[0];
}

/**
 * A thing MADE in bb exactly once, where bb may not answer the making: the busy stage's held spawns.
 * `make()` → `{ outcome, said }` (as `ask` above); `isThere()` → whether bb now lists the thing; `settle()` waits
 * until bb answers again (the caller's pacing). Then:
 *   accepted: made;
 *   no answer: bb is asked whether the thing is there: it is: made (the making reached bb all the same; it is
 *   NEVER made twice); it is not: made again, `times` times at most in all;
 *   refused: over at once: `{ made: false, refused }`.
 * → `{ made, refused, attempts }`: `attempts` is every making, in order, as "<outcome>: <what bb said>", with
 * "; bb lists it all the same" where a making with no answer had happened.
 */
export async function madeOnce({ make, isThere, settle = async () => {}, times = 3 }) {
  const attempts = [];
  for (let attempt = 1; attempt <= times; attempt += 1) {
    const answer = await make();
    const said = `${answer.outcome}: ${String(answer.said).replace(/\s+/g, " ").slice(0, 200)}`;
    if (answer.outcome === "accepted") return { made: true, refused: null, attempts: [...attempts, said] };
    if (answer.outcome === "refused") return { made: false, refused: String(answer.said), attempts: [...attempts, said] };
    await settle();
    if (await isThere()) return { made: true, refused: null, attempts: [...attempts, `${said}; bb lists it all the same`] };
    attempts.push(said);
  }
  return { made: false, refused: null, attempts };
}

/**
 * A wait until bb ANSWERS QUICKLY AGAIN, on bb's state and with a bound: `read()` is a cheap read of bb's (its list);
 * it is read until one read takes under `underMs`, or `withinMs` have passed. → `{ quick, reads, waitedMs, slowestMs }`.
 * (The busy stage paces its held spawns with it: fourteen back to back stalled bb's event loop for 22 s in one run.)
 */
export async function untilQuickAgain({ read, underMs = 1_000, withinMs = 30_000, everyMs = 500, now = () => Date.now(), sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)) }) {
  const from = now();
  let reads = 0;
  let slowestMs = 0;
  for (;;) {
    const before = now();
    await read();
    const took = now() - before;
    reads += 1;
    slowestMs = Math.max(slowestMs, took);
    if (took < underMs) return { quick: true, reads, waitedMs: now() - from, slowestMs };
    if (now() - from >= withinMs) return { quick: false, reads, waitedMs: now() - from, slowestMs };
    await sleep(everyMs);
  }
}

/**
 * bb's own 5xx for a request it could not serve because a fetch INSIDE bb failed while it was stalled ("HTTP 502: …
 * failed to validate the request: fetch failed"): no answer on the thing asked, not a "no". Read with
 * `outcomeOfFailure` for a making: `outcomeOfMaking`.
 */
export const STALLED = /\bHTTP 50[234]: .*\bfetch failed\b/;
export function outcomeOfMaking(error) {
  if (outcomeOfFailure(error) === "no-answer") return "no-answer";
  return typeof error?.status === "number" && error.status !== 0 && STALLED.test(String(error?.stderr ?? "")) ? "no-answer" : "refused";
}
