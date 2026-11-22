// The table of the spec, row by row: what the plugin says of an agent that something happened to
// outside OATS, from the kernel's row as recorded and bb's answer for its thread.
import { describe, expect, it } from "vitest";
import { said, type ThreadFact } from "../../app/outside/say";
import { outside, recorded, sample } from "./rows";

const THREADS: ThreadFact[] = ["open", "archived", "missing", "none", "unknown"];

describe("stopped (an operator's stop: sessionEnd \"stopped\")", () => {
  const { agent, facts } = recorded("stoppedByOats");
  it("is the recorded row of a home OATS stopped", () => {
    expect([agent.running, agent.runtimeState, facts.sessionEnd, facts.outsideOats]).toEqual([false, "stopped", "stopped", null]);
  });
  it("with its thread archived in bb: the fact after \"Stopped\", the way to it, and Start", () => {
    expect(said(agent, "archived", facts, false)).toEqual({
      kind: "stopped-archived", state: null, sentence: "Its conversation is archived in bb", note: "its conversation is archived in bb", warning: null, acts: ["start"], archived: true,
    });
  });
  it("with its thread open: nothing of this feature's, the roster's own line says it", () => {
    expect(said(agent, "open", facts, true)).toBeNull();
  });
  it("with its thread deleted in bb: that it was deleted, and Start for a new one; never \"its bb thread is gone\"", () => {
    const row = said(agent, "missing", facts, false)!;
    expect([row.kind, row.state, row.sentence, row.note, row.acts, row.archived]).toEqual(["stopped-deleted", null, "Its conversation was deleted in bb. Start it from OATS for a new one.", "its conversation was deleted in bb", ["start"], false]);
  });
  it("before bb has answered, nothing is claimed of its thread", () => {
    expect(said(agent, "unknown", facts, false)).toBeNull();
  });
});

describe("any state, with the kernel's outsideOats", () => {
  const { agent, facts } = outside();
  it("is a row OATS recorded stopped, with the report", () => {
    expect([agent.running, agent.runtimeState, facts.sessionEnd]).toEqual([false, "stopped", "stopped"]);
    expect(facts.outsideOats).toEqual({
      code: "running-outside-oats", backend: "bb",
      message: "a harness runs in flaky-ci-2-developer on bb, and OATS recorded this instance stopped: stop it with `oats instance stop flaky-ci-2-developer`, or start it from OATS",
    });
  });
  it("says the kernel's message, with Stop and Start, whatever bb says of the thread; the state's word stays the one OATS recorded", () => {
    for (const thread of THREADS) {
      for (const attached of [true, false]) {
        const row = said(agent, thread, facts, attached)!;
        expect([row.kind, row.state, row.sentence, row.note, row.acts]).toEqual(["outside", null, null, "running outside OATS", ["stop", "start"]]);
        expect(row.warning).toBe(facts.outsideOats);
        expect(row.archived).toBe(thread === "archived");
      }
    }
  });
  it("on a kernel that does not list the feature nothing is said of it: the row is an ordinary stopped one", () => {
    const old = outside(false);
    expect(old.facts.outsideOats).toBeNull();
    expect(said(old.agent, "open", old.facts, true)).toBeNull();
    expect(said(old.agent, "archived", old.facts, false)?.kind).toBe("stopped-archived");
  });
});

describe("a session OATS lost (sessionEnd \"lost\")", () => {
  const { agent, facts } = recorded("threadDeleted");
  it("is the recorded row of an agent whose thread was deleted in bb", () => {
    expect([agent.running, agent.runtimeState, facts.sessionEnd]).toEqual([false, "stopped", "lost"]);
  });
  it("archived in bb: its process still runs; Stop (then Start)", () => {
    expect(said(agent, "archived", facts, false)).toEqual({
      kind: "lost-archived", state: { mark: "error", word: "Archived in bb" }, sentence: "OATS lost its session, and its process still runs. Stop it, then start it from OATS.",
      note: "OATS lost its session", warning: null, acts: ["stop"], archived: true,
    });
  });
  it("deleted in bb: its conversation is gone; Start for a new one", () => {
    expect(said(agent, "missing", facts, false)).toEqual({
      kind: "lost-deleted", state: { mark: "error", word: "Deleted in bb" }, sentence: "Its conversation is gone. Start it from OATS for a new one.",
      note: "its conversation is gone", warning: null, acts: ["start"], archived: false,
    });
  });
  it("archived is told from deleted by bb's answer alone: the same row, two answers, two sentences", () => {
    expect(said(agent, "archived", facts, false)!.kind).not.toBe(said(agent, "missing", facts, false)!.kind);
  });
  it("on a thread that is open (a session lost with the host): nothing of this feature's", () => {
    expect(said(agent, "open", facts, true)).toBeNull();
    expect(said(agent, "unknown", facts, false)).toBeNull();
  });
});

describe("failed (its session ended in a shell)", () => {
  // No recording holds this state: the sample's row with the fields the live scenes give it.
  const { agent, facts } = sample("harvest-knowledge-helper", { running: false, runtimeState: "shell" });
  it("on an open thread: a message there starts it again; Restart, and no warning", () => {
    expect(said(agent, "open", facts, true)).toEqual({ kind: "failed-open", state: null, sentence: "Its session ended. Restart it, or send a message here.", note: null, warning: null, acts: ["restart"], archived: false });
  });
  it("where its thread is not open, only where the thread is", () => {
    expect(said(agent, "archived", facts, false)).toMatchObject({ kind: "threadless", sentence: null, acts: null, note: "its conversation is archived in bb", archived: true });
    expect(said(agent, "unknown", facts, false)).toBeNull();
  });
});

describe("unreachable", () => {
  const { agent, facts } = sample("desktop-mockups-developer", { running: null, runtimeState: "unreachable", sessionEnd: null });
  it("says nothing about a message: what status says and its reason are the roster's line", () => {
    expect(said(agent, "open", facts, true)).toBeNull();
    expect(said(agent, "missing", facts, false)).toMatchObject({ kind: "threadless", sentence: null, acts: null, warning: null });
  });
});

describe("what is not this feature's", () => {
  it("an agent that works or is idle on its thread", () => {
    for (const state of ["working", "idle"] as const) {
      const { agent, facts } = recorded(state);
      expect(said(agent, "open", facts, true)).toBeNull();
    }
  });
  it("an agent on tmux, whatever its row says", () => {
    const { agent, facts } = sample("kernel-fix-developer");
    expect(agent.backend).toBe("tmux");
    for (const thread of THREADS) expect(said(agent, thread, facts, false)).toBeNull();
  });
  it("a row the tree does not draw on its thread says where the thread is, once bb has answered; \"its bb thread is gone\" is said of none", () => {
    const { agent, facts } = recorded("working");
    const notes = THREADS.map((thread) => said(agent, thread, facts, false)?.note ?? null);
    expect(notes).toEqual(["its bb thread is not shown", "its conversation is archived in bb", "its conversation was deleted in bb", "it has no bb thread", null]);
  });
  it("with no facts read (the read failed), a stopped row is still told by bb's answer", () => {
    const { agent } = recorded("threadDeleted");
    expect(said(agent, "archived", null, false)?.kind).toBe("stopped-archived");
  });
});
