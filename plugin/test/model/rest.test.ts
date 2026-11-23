// The one reading of "how an agent that does not run is at rest", and of "a message in its thread
// is the designed way to carry it on": every row the kernel prints, and the ones it does not.
// The three tmux rows are RECORDED (OATS 0.70.5, the real run: test/fixtures/lifecycle/tmux-row-*.json).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { messageResumes, rest } from "../../model/rest";
import { recordedStopped } from "../../model/view";

const row = (running: boolean | null, runtimeState: string | null, sessionEnd?: string | null, backend = "bb") => ({ running, runtimeState, sessionEnd, backend });
const listed = { status: "idle" };
/** A recorded row of `oats status --json`, as the roster's parser reads these fields of it. */
const recorded = (name: string) => {
  const raw = JSON.parse(readFileSync(join(__dirname, "..", "fixtures", "lifecycle", name), "utf8")) as { running?: boolean | null; runtimeState?: string | null; sessionEnd?: string | null; session?: { backend?: string } };
  return { running: raw.running ?? null, runtimeState: raw.runtimeState ?? null, sessionEnd: raw.sessionEnd ?? null, backend: raw.session?.backend ?? "tmux" };
};

describe("the three recorded rows of an agent on tmux", () => {
  test("running: it runs", () => {
    const running = recorded("tmux-row-running.json");
    expect([running.running, running.runtimeState, running.sessionEnd, running.backend]).toEqual([true, null, null, "tmux"]);
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
    for (const running of [true, null]) for (const word of ["running", "unknown", null, "shell", "unreachable"]) expect(rest(row(running, word)), `${running} ${word}`).toBe("runs");
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
  });
  test("a session the kernel cannot reach is never called stopped or lost: nobody can tell", () => {
    for (const end of [undefined, "stopped", "lost"]) expect(recordedStopped(row(false, "unreachable", end)), String(end)).toBe(false);
    expect(rest(row(false, "unreachable", "lost"))).toBe("unloaded");
  });
});

describe("messageResumes(): a message in the thread is the designed way to carry the agent on", () => {
  test("yes for a session that was lost, one that ended by itself, and one with no harness loaded, on a thread bb lists", () => {
    for (const agent of [row(false, "stopped", "lost"), row(false, "unknown"), row(false, "shell"), row(false, "stopped", "exited")]) expect(messageResumes(agent, listed), JSON.stringify(agent)).toBe(true);
  });
  test("never for a stop: an operator's (beside any word), one that does not say how it ended, a row with no word", () => {
    for (const agent of [row(false, "stopped", "stopped"), row(false, "shell", "stopped"), row(false, "unknown", "stopped"), row(false, "stopped"), row(false, null)]) expect(messageResumes(agent, listed), JSON.stringify(agent)).toBe(false);
  });
  test("never where nobody can tell: the kernel cannot reach its session", () => {
    expect(messageResumes(row(false, "unreachable"), listed)).toBe(false);
    expect(messageResumes(row(false, "unreachable", "lost"), listed)).toBe(false);
  });
  test("never for an agent that runs, one on tmux, a thread bb does not list, or one bb calls failed", () => {
    expect(messageResumes(row(true, "unknown"), listed)).toBe(false);
    expect(messageResumes(row(null, "stopped", "lost"), listed)).toBe(false); // the kernel does not say it does not run
    expect(messageResumes(row(false, null, "lost", "tmux"), listed)).toBe(false);
    expect(messageResumes(row(false, "stopped", "lost"), null)).toBe(false);
    expect(messageResumes(row(false, "stopped", "lost"), { status: "error" })).toBe(false);
  });
});
