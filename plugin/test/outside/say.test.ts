// The table of the spec, row by row: the state of an agent that something happened to outside OATS
// (the one state function, model/view.ts) and what the plugin says of it (app/outside/say.ts), from
// the kernel's row as recorded and bb's answer for its thread.
import { describe, expect, it } from "vitest";
import { said } from "../../app/outside/say";
import { agentStatus } from "../../app/roster/status";
import { STATE } from "../../app/ui/words";
import type { BbThread, ThreadWhere } from "../../model/types";
import { state, view } from "../../model/view";
import { outside, recorded, sample } from "./rows";

const WHERES: ThreadWhere[] = ["open", "archived", "missing", "none", "unknown"];
const NOW = Date.parse("2026-11-21T16:00:00.000Z");

describe("stopped (an operator's stop: sessionEnd \"stopped\")", () => {
  const agent = recorded("stoppedByOats");
  it("is the recorded row of a home OATS stopped", () => {
    expect([agent.running, agent.runtimeState, agent.sessionEnd, agent.outsideOats]).toEqual([false, "stopped", "stopped", undefined]);
  });
  it("is \"stopped\" wherever bb says its thread is", () => {
    for (const where of WHERES) expect(state(agent, null, where)).toBe("stopped");
  });
  it("with its thread archived in bb: the fact after \"Stopped\", the way to it, and Start", () => {
    expect(said(agent, "archived", false)).toEqual({ kind: "stopped-archived", sentence: "Its conversation is archived in bb", note: "its conversation is archived in bb", warning: null, acts: ["start"], archived: true });
  });
  it("with its thread open: nothing of this feature's, the roster's own line says it", () => {
    expect(said(agent, "open", true)).toBeNull();
  });
  it("with its thread deleted in bb: that it was deleted, and Start for a new one; never \"its bb thread is gone\"", () => {
    expect(said(agent, "missing", false)).toEqual({ kind: "stopped-deleted", sentence: "Its conversation was deleted in bb. Start it from OATS for a new one.", note: "its conversation was deleted in bb", warning: null, acts: ["start"], archived: false });
  });
  it("before bb has answered, nothing is claimed of its thread", () => {
    expect(said(agent, "unknown", false)).toBeNull();
  });
});

describe("any state, with the kernel's outsideOats", () => {
  const agent = outside();
  const REPORT = {
    code: "running-outside-oats", backend: "bb",
    message: "a harness runs in flaky-ci-2-developer on bb, and OATS recorded this instance stopped: stop it with `oats instance stop flaky-ci-2-developer`, or start it from OATS",
  };
  it("is a row OATS recorded stopped, with the report", () => {
    expect([agent.running, agent.runtimeState, agent.sessionEnd, agent.outsideOats]).toEqual([false, "stopped", "stopped", REPORT]);
  });
  it("its state stays the one OATS recorded, \"Stopped\", wherever its thread is", () => {
    for (const where of WHERES) expect(agentStatus(agent, null, NOW, where).word).toBe("Stopped");
  });
  it("says the kernel's message, with Stop and Start, whatever bb says of the thread", () => {
    for (const where of WHERES) {
      for (const attached of [true, false]) {
        expect(said(agent, where, attached)).toEqual({ kind: "outside", sentence: null, note: "running outside OATS", warning: REPORT, acts: ["stop", "start"], archived: where === "archived" });
      }
    }
  });
  it("is counted among the agents that need a person, whether bb has its thread or not", () => {
    const thread = { id: agent.threadId!, projectId: null, displayTitle: "t", updatedAt: 1, isUnread: false, isArchived: false, isHidden: false, hasPendingInteraction: false } satisfies BbThread;
    expect(view([agent], [thread]).needing).toEqual([agent]);
    expect(view([agent], []).needing).toEqual([agent]);
    // Its row is not "needs-you": bb has no question of it, and OATS recorded no claim.
    expect(view([agent], [thread]).needsYou).toEqual([]);
    expect(view([recorded("stoppedByOats")], []).needing).toEqual([]);
  });
  it("on a kernel that does not list the feature nothing is said of it: the row is an ordinary stopped one", () => {
    const old = outside(false);
    expect(old.outsideOats).toBeUndefined();
    expect(said(old, "open", true)).toBeNull();
    expect(said(old, "archived", false)?.kind).toBe("stopped-archived");
    expect(view([old], []).needing).toEqual([]);
  });
});

describe("a session OATS lost (sessionEnd \"lost\")", () => {
  const agent = recorded("threadDeleted");
  it("is the recorded row of an agent whose thread was deleted in bb", () => {
    expect([agent.running, agent.runtimeState, agent.sessionEnd]).toEqual([false, "stopped", "lost"]);
  });
  it("archived in bb is a state of its own, \"Archived in bb\": its process still runs; Stop (then Start)", () => {
    expect(state(agent, null, "archived")).toBe("archived");
    expect(agentStatus(agent, null, NOW, "archived")).toMatchObject({ state: "archived", word: "Archived in bb", since: null, detail: null });
    expect(said(agent, "archived", false)).toEqual({ kind: "lost-archived", sentence: "OATS lost its session, and its process still runs. Stop it, then start it from OATS.", note: "OATS lost its session", warning: null, acts: ["stop"], archived: true });
  });
  it("deleted in bb is a state of its own, \"Deleted in bb\": its conversation is gone; Start for a new one", () => {
    expect(state(agent, null, "missing")).toBe("deleted");
    expect(agentStatus(agent, null, NOW, "missing")).toMatchObject({ state: "deleted", word: "Deleted in bb" });
    expect(said(agent, "missing", false)).toEqual({ kind: "lost-deleted", sentence: "Its conversation is gone. Start it from OATS for a new one.", note: "its conversation is gone", warning: null, acts: ["start"], archived: false });
  });
  it("the two states have their word and their accessible name", () => {
    expect([STATE.archived, STATE.deleted]).toEqual([{ word: "Archived in bb", name: "archived in bb" }, { word: "Deleted in bb", name: "deleted in bb" }]);
  });
  it("on a thread that is open, with no thread named, or before bb has answered: \"stopped\", as the kernel calls it, and nothing of this feature's on an open thread", () => {
    for (const where of ["open", "none", "unknown"] as const) expect(state(agent, null, where)).toBe("stopped");
    expect(state(agent, null)).toBe("stopped"); // `where` left out, as every caller before this feature
    expect(said(agent, "open", true)).toBeNull();
    expect(said(agent, "unknown", false)).toBeNull();
  });
  it("only a row OATS did not stop is one: an operator's stop, a row that runs and a tmux row are never \"archived\" or \"deleted\"", () => {
    for (const other of [recorded("stoppedByOats"), recorded("working"), recorded("idle"), { ...agent, backend: "tmux" }, { ...agent, running: null, runtimeState: "unknown" }]) {
      for (const where of WHERES) expect(["archived", "deleted"]).not.toContain(state(other, null, where));
    }
  });
});

describe("failed (its session ended in a shell)", () => {
  // No recording holds this state: the sample's row with the fields the live scenes give it.
  const agent = sample("harvest-knowledge-helper", { running: false, runtimeState: "shell" });
  it("on an open thread: a message there starts it again; Restart, and no warning", () => {
    expect(said(agent, "open", true)).toEqual({ kind: "failed-open", sentence: "Its session ended. Restart it, or send a message here.", note: null, warning: null, acts: ["restart"], archived: false });
  });
  it("where its thread is not open, only where the thread is", () => {
    expect(said(agent, "archived", false)).toEqual({ kind: "threadless", sentence: null, note: "its conversation is archived in bb", warning: null, acts: null, archived: true });
    expect(said(agent, "unknown", false)).toBeNull();
  });
});

describe("unreachable", () => {
  const agent = sample("desktop-mockups-developer", { running: null, runtimeState: "unreachable", sessionEnd: "lost" });
  it("says nothing about a message: what status says and its reason are the roster's line, whatever its session's end", () => {
    expect(said(agent, "open", true)).toBeNull();
    for (const where of WHERES) expect(state(agent, null, where)).toBe("unreachable");
    expect(said(agent, "missing", false)).toEqual({ kind: "threadless", sentence: null, note: "its conversation was deleted in bb", warning: null, acts: null, archived: false });
  });
});

describe("what is not this feature's", () => {
  it("an agent that works or is idle on its thread", () => {
    for (const which of ["working", "idle"] as const) expect(said(recorded(which), "open", true)).toBeNull();
  });
  it("an agent on tmux, whatever its row says", () => {
    const agent = sample("kernel-fix-developer", { sessionEnd: "lost", outsideOats: { code: "running-outside-oats", backend: "tmux", message: "x" } });
    expect(agent.backend).toBe("tmux");
    for (const where of WHERES) expect(said(agent, where, false)).toBeNull();
  });
  it("a row the tree does not draw on its thread says where the thread is, once bb has answered; \"its bb thread is gone\" is said of none", () => {
    const agent = recorded("working");
    expect(WHERES.map((where) => said(agent, where, false)?.note ?? null)).toEqual(["its bb thread is not shown", "its conversation is archived in bb", "its conversation was deleted in bb", "it has no bb thread", null]);
  });
});
