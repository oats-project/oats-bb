// The one reading of "how an agent that does not run is at rest", and of "a message in its thread
// is the designed way to carry it on": every row the kernel prints, and the ones it does not.
import { describe, expect, test } from "vitest";
import { messageResumes, rest } from "../../model/rest";
import { recordedStopped } from "../../model/view";

const row = (running: boolean | null, runtimeState: string | null, sessionEnd?: string | null, backend = "bb") => ({ running, runtimeState, sessionEnd, backend });
const listed = { status: "idle" };

describe("rest(): how an agent that does not run is at rest", () => {
  test("an agent the kernel does not call not-running runs, whatever else its row says", () => {
    for (const running of [true, null]) for (const word of ["running", "unknown", null, "shell", "unreachable"]) expect(rest(row(running, word)), `${running} ${word}`).toBe("runs");
  });
  test("stopped: an operator's stop, a harness that ended by itself, and a row that does not say how its session ended", () => {
    for (const end of ["stopped", "exited", undefined, null, "a-later-word"]) expect(rest(row(false, "stopped", end)), String(end)).toBe("stopped");
    expect(rest(row(false, null))).toBe("stopped"); // no word at all (a tmux row whose window is gone)
    expect(rest(row(null, "stopped", "stopped"))).toBe("stopped"); // the word alone
  });
  test("lost: the kernel calls it stopped and says its session was lost", () => {
    expect(rest(row(false, "stopped", "lost"))).toBe("lost");
    expect(rest(row(false, null, "lost", "tmux"))).toBe("lost"); // the pilot's rows: tmux, no word, lost
  });
  test("unloaded: not running beside a word that is not \"stopped\"", () => {
    for (const word of ["unknown", "shell", "unreachable", "a-later-word"]) expect(rest(row(false, word)), word).toBe("unloaded");
    expect(rest(row(false, "unknown", "lost"))).toBe("unloaded");
  });
  test("the stop wins: not running beside \"unknown\" on a row that still says an operator stopped it is stopped, in the state's predicate too", () => {
    expect(rest(row(false, "unknown", "stopped"))).toBe("stopped");
    expect(recordedStopped(row(false, "unknown", "stopped"))).toBe(true);
    expect(recordedStopped(row(false, "unknown"))).toBe(false);
    // A session that ended in a shell, or that cannot be reached, is told by its own state: the predicate of the state does not call it stopped.
    for (const word of ["shell", "unreachable"]) expect([recordedStopped(row(false, word, "stopped")), rest(row(false, word, "stopped"))], word).toEqual([false, "stopped"]);
  });
});

describe("messageResumes(): a message in the thread is the designed way to carry the agent on", () => {
  test("yes for a session that was lost and for one with no harness loaded, on a thread bb lists", () => {
    expect(messageResumes(row(false, "stopped", "lost"), listed)).toBe(true);
    expect(messageResumes(row(false, "unknown"), listed)).toBe(true);
    expect(messageResumes(row(false, "shell"), listed)).toBe(true);
  });
  test("never for a stop: an operator's, one that does not say how it ended, a row with no word, and the stale stop", () => {
    for (const agent of [row(false, "stopped", "stopped"), row(false, "stopped"), row(false, "stopped", "exited"), row(false, null), row(false, null, "exited"), row(false, "unknown", "stopped")]) expect(messageResumes(agent, listed), JSON.stringify(agent)).toBe(false);
  });
  test("never for an agent that runs, one on tmux, a thread bb does not list, or one bb calls failed", () => {
    expect(messageResumes(row(true, "unknown"), listed)).toBe(false);
    expect(messageResumes(row(null, "stopped", "lost"), listed)).toBe(false); // the kernel does not say it does not run
    expect(messageResumes(row(false, null, "lost", "tmux"), listed)).toBe(false);
    expect(messageResumes(row(false, "stopped", "lost"), null)).toBe(false);
    expect(messageResumes(row(false, "stopped", "lost"), { status: "error" })).toBe(false);
  });
});
