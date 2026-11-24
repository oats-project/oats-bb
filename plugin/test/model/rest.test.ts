// The one reading of "how an agent that does not run is at rest", and of "a message in its thread
// is the designed way to carry it on": every row the kernel prints, and the ones it does not.
// The three tmux rows are RECORDED (OATS 0.70.5, the real run: test/fixtures/lifecycle/tmux-row-*.json).
import { describe, expect, test } from "vitest";
import { messageResumes, rest } from "../../model/rest";
import { recordedStopped } from "../../model/view";
import { tmuxRow } from "../outside/rows";

const row = (running: boolean | null, runtimeState: string | null, sessionEnd?: string | null, backend = "bb") => ({ running, runtimeState, sessionEnd, backend });
const listed = { status: "idle" };
/** A recorded row of an agent on tmux, as the roster's parser reads it (test/outside/rows.ts). */
const recorded = (name: Parameters<typeof tmuxRow>[0]) => tmuxRow(name);

describe("the three recorded rows of an agent on tmux", () => {
  test("running: it runs", () => {
    const running = recorded("tmux-row-running.json");
    expect([running.running, running.runtimeState, running.sessionEnd ?? null, running.backend]).toEqual([true, null, null, "tmux"]);
    expect([rest(running), recordedStopped(running)]).toEqual(["runs", false]);
  });
  test("stopped with OATS (its window is left at a shell, and the row says an operator stopped it): STOPPED, never failed", () => {
    const stopped = recorded("tmux-row-stopped.json");
    expect([stopped.running, stopped.runtimeState, stopped.sessionEnd, stopped.backend]).toEqual([false, "shell", "stopped", "tmux"]);
    expect([rest(stopped), recordedStopped(stopped)]).toEqual(["stopped", true]);
  });
  test("its window killed: its session was LOST, with no word of the runtime's state", () => {
    const lost = recorded("tmux-row-lost.json");
    expect([lost.running, lost.runtimeState, lost.sessionEnd, lost.backend]).toEqual([false, null, "lost", "tmux"]);
    expect([rest(lost), recordedStopped(lost)]).toEqual(["lost", true]);
    expect(messageResumes(lost, listed)).toBe(false); // bb cannot write to an agent on tmux
  });
});

describe("rest(): how an agent that does not run is at rest", () => {
  test("an agent the kernel does not call not-running runs, whatever else its row says", () => {
    for (const running of [true, null]) for (const word of ["running", "unknown", null, "shell"]) expect(rest(row(running, word)), `${running} ${word}`).toBe("runs");
  });
  test("where the row says how its session ended, that decides, beside any word", () => {
    for (const word of ["stopped", "shell", "unknown", null, "a-later-word"]) {
      expect([rest(row(false, word, "stopped")), recordedStopped(row(false, word, "stopped"))], `stopped beside ${word}`).toEqual(["stopped", true]);
      expect([rest(row(false, word, "lost")), recordedStopped(row(false, word, "lost"))], `lost beside ${word}`).toEqual(["lost", true]);
      expect([rest(row(false, word, "exited")), recordedStopped(row(false, word, "exited"))], `exited beside ${word}`).toEqual(["ended", false]);
    }
  });
  test("where it does not say: the word \"stopped\" or no word is a stop; a shell ended; another word is not loaded", () => {
    for (const end of [undefined, null, "a-later-word"]) {
      expect([rest(row(false, "stopped", end)), recordedStopped(row(false, "stopped", end))], String(end)).toEqual(["stopped", true]);
      expect([rest(row(false, null, end)), recordedStopped(row(false, null, end))], String(end)).toEqual(["stopped", true]);
      expect([rest(row(false, "shell", end)), recordedStopped(row(false, "shell", end))], String(end)).toEqual(["ended", false]);
      expect([rest(row(false, "unknown", end)), recordedStopped(row(false, "unknown", end))], String(end)).toEqual(["unloaded", false]);
    }
    expect(rest(row(null, "stopped"))).toBe("stopped"); // the word alone
    // The word "stopped" with no word that it does not run is a stop whatever else the row says: the thread's line then warns, as the card refuses.
    for (const running of [null, true]) for (const end of ["lost", "exited", "stopped"]) expect(rest(row(running, "stopped", end)), `${running} ${end}`).toBe("stopped");
  });
  test("a session the kernel cannot reach is its own answer, never stopped, lost or running: nobody can tell", () => {
    // The row the kernel prints is `running: null` beside "unreachable" (awebai/oats lib/instance-listing.mjs at v0.70.5); the others are held too.
    for (const running of [null, false, true]) for (const end of [undefined, "stopped", "lost", "exited"]) expect([rest(row(running, "unreachable", end)), recordedStopped(row(running, "unreachable", end))], `${running} ${end}`).toEqual(["unreachable", false]);
  });
});

describe("messageResumes(): a message in the thread is the designed way to carry the agent on", () => {
  test("yes for a session that was lost and for one with no harness loaded, on a thread bb lists; NOT for a harness that ended by itself (no fact shows a message carrying it on)", () => {
    for (const agent of [row(false, "stopped", "lost"), row(false, "unknown")]) expect(messageResumes(agent, listed), JSON.stringify(agent)).toBe(true);
    for (const agent of [row(false, "shell"), row(false, "stopped", "exited")]) expect([rest(agent), messageResumes(agent, listed)], JSON.stringify(agent)).toEqual(["ended", false]);
  });
  test("never for a stop: an operator's (beside any word), one that does not say how it ended, a row with no word", () => {
    for (const agent of [row(false, "stopped", "stopped"), row(false, "shell", "stopped"), row(false, "unknown", "stopped"), row(false, "stopped"), row(false, null)]) expect(messageResumes(agent, listed), JSON.stringify(agent)).toBe(false);
  });
  test("never where nobody can tell: the kernel cannot reach its session", () => {
    for (const running of [null, false, true]) expect(messageResumes(row(running, "unreachable"), listed), String(running)).toBe(false);
    expect(messageResumes(row(false, "unreachable", "lost"), listed)).toBe(false);
  });
  test("a listed thread whose LATER turn bb calls failed takes a message as any other, once bb has said that a turn started there; before its answer, none (it may never have started)", () => {
    const turnFailed = { status: "error", startFailure: null };
    for (const agent of [row(false, "stopped", "lost"), row(false, "unknown")]) {
      expect(messageResumes(agent, turnFailed), JSON.stringify(agent)).toBe(true);
      // FAIL CLOSED: no answer of bb's on the thread (no `startFailure` at all).
      expect(messageResumes(agent, { status: "error" }), JSON.stringify(agent)).toBe(false);
      // And never where bb answered that it failed at its start.
      expect(messageResumes(agent, { status: "error", startFailure: { message: "Command thread.start failed", detail: null } }), JSON.stringify(agent)).toBe(false);
    }
    expect(messageResumes(row(false, "stopped", "stopped"), turnFailed)).toBe(false);
  });
  test("never for an agent that runs, one on tmux, or a thread bb does not list", () => {
    expect(messageResumes(row(true, "unknown"), listed)).toBe(false);
    expect(messageResumes(row(null, "stopped", "lost"), listed)).toBe(false); // the kernel does not say it does not run
    expect(messageResumes(row(false, null, "lost", "tmux"), listed)).toBe(false);
    expect(messageResumes(row(false, "stopped", "lost"), null)).toBe(false);
  });
});
