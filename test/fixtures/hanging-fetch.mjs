// Preloaded into the provider by a test (NODE_OPTIONS=--import): a fetch whose connection
// never answers and never fails, which is what Node 20's fetch does when the other side
// drops the connection as it accepts it. Nothing here keeps the process alive.
//   OATS_BB_TEST_FETCH=abortable  it ends only when its signal aborts (as the real one does)
//   OATS_BB_TEST_FETCH=deaf       it never ends at all, whatever the signal does
const mode = process.env.OATS_BB_TEST_FETCH;
globalThis.fetch = (_url, { signal } = {}) => new Promise((_resolve, reject) => {
  if (mode === "abortable" && signal) signal.addEventListener("abort", () => reject(signal.reason), { once: true });
});
