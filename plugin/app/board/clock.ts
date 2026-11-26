// The board's clock: now, and "after a moment". One object, so that a test sets it (no test waits
// on the real clock) and the one place that measures a moment reads it.
export const clock = {
  now: (): number => Date.now(),
  /** Runs `run` after `ms`; the answer cancels it. */
  after: (ms: number, run: () => void): (() => void) => {
    const timer = setTimeout(run, ms);
    return () => clearTimeout(timer);
  },
};
/** How long options that took another question's place by themselves stay off: time to see that the question changed. */
export const SETTLE_MS = 1000;
