/**
 * A thing asked back of bb when a stage leaves, until bb SAYS it is back: the loop of the busy stage's "bb's own
 * concurrency limit is back", on its own so that a unit test holds its three cases (test/container-ask-back.test.ts).
 *
 * `ask()` → `{ outcome, said }` asks once and KEEPS ITS OUTCOME: "accepted" (bb did it), "no-answer" (bb did not
 * answer in time) or "refused" (bb answered with an error). `read()` → what bb says of the thing now. Then:
 *   accepted, and the read equals `before`: done;
 *   accepted and not yet so, or no answer: NOT YET: asked again after `everyMs`, until `withinMs` have passed;
 *   refused: over AT ONCE: bb said no, and a wait covers "not yet", never "no". It is asked once, never again.
 * → `{ back, refused, after, answers }`: `back` is true only where bb's read said `before`; `refused` is bb's answer
 * where it said no, else null; `answers` is every asking, in order, as "<outcome>: <what bb said>".
 *
 * THE BOUND is on when the last asking STARTS: no asking starts once `withinMs` have passed since the first; the
 * last asking and its read are still waited for (an asking takes `ASK_MS` at most; a read has bb's own limits).
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
    if (now() >= until) return { back: false, refused: null, after, answers };
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
