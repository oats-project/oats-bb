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
