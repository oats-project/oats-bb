// One press is one send (app/board/sent.ts): the guard itself, without a draw between two presses.
// The options are drawn off while an answer is on its way, so a test that clicks through the page
// never reaches the guard twice: removing the guard left every such test green (found by running
// each test of this change against its fix removed). This one asks the guard directly.
import { afterEach, describe, expect, it } from "vitest";
import { dropSend, noteSent, takeSend } from "../../app/board/sent";
import { resetWindow } from "../../app/store";

afterEach(() => resetWindow());

describe("the one send of a question's occurrence", () => {
  it("is taken once: a second press, before anything was drawn again, is refused while the first is on its way", () => {
    expect(takeSend("agent", "q3 2026-11-23T18:01:45.724Z")).toBe(true);
    expect(takeSend("agent", "q3 2026-11-23T18:01:45.724Z")).toBe(false);
  });
  it("is by the agent and the occurrence: another question, the same question asked again, another agent's, are their own", () => {
    expect(takeSend("agent", "q3 A")).toBe(true);
    expect([takeSend("agent", "q4 A"), takeSend("agent", "q3 B"), takeSend("other", "q3 A")]).toEqual([true, true, true]);
  });
  it("comes back after a refusal (nothing was sent: it may be pressed again), and never after it was sent", () => {
    expect(takeSend("agent", "q3 A")).toBe(true);
    dropSend("agent", "q3 A", "No longer asked. Nothing sent.");
    expect(takeSend("agent", "q3 A")).toBe(true);
    noteSent("agent", "q3 A", 0);
    expect(takeSend("agent", "q3 A")).toBe(false);
  });
});
