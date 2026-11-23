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
    expect(said(agent, "archived", false)).toEqual({ kind: "stopped-archived", sentence: "Its conversation is archived in bb", tone: "plain", note: "its conversation is archived in bb", warning: null, acts: ["start"], archived: true });
  });
  it("on its open thread: the interim warning, that a message there starts it again without OATS; the roster's own Start", () => {
    expect(said(agent, "open", true)).toEqual({ kind: "stopped-open", sentence: "A message sent here in bb starts it again without OATS. Use Start.", tone: "warning", note: null, warning: null, acts: null, archived: false });
  });
  it("the warning is for an operator's stop and only that (sessionEnd \"stopped\"): never for a session OATS lost, where a message starts an agent OATS sees running", () => {
    expect(said({ ...agent, sessionEnd: undefined }, "open", true)).toBeNull(); // a row that names no end of its session (never launched): the roster's own line
    expect(said(recorded("threadDeleted"), "open", true)?.kind).toBe("stopped-host");
    // A thread that is listed and that the tree does not draw the agent on (hidden, or another row's) has no line of its own.
    expect(said(agent, "open", false)).toEqual({ kind: "threadless", sentence: null, tone: "plain", note: "its bb thread is not shown", warning: null, acts: null, archived: false });
  });
  it("with its thread deleted in bb: that it was deleted, and Start for a new one; never \"its bb thread is gone\"", () => {
    expect(said(agent, "missing", false)).toEqual({ kind: "stopped-deleted", sentence: "Its conversation was deleted in bb. Start it from OATS for a new one.", tone: "plain", note: "its conversation was deleted in bb", warning: null, acts: ["start"], archived: false });
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
        expect(said(agent, where, attached)).toEqual({ kind: "outside", sentence: null, tone: "warning", note: "running outside OATS", warning: REPORT, acts: ["stop", "start"], archived: where === "archived" });
      }
    }
  });
  it("view() takes what bb says of the threads it does not list, and counts by the same state function", () => {
    const lost = recorded("threadDeleted");
    const asked: string[] = [];
    const v = view([lost], [], (each) => (asked.push(each.instance), "archived"));
    expect(v.detached).toEqual([lost]);
    expect(asked).toEqual([lost.instance]); // the state of an agent on no thread is read with bb's answer
    expect(v.needing).toEqual([]); // "archived" is no "needs-you"
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
    expect(said(old, "open", true)?.kind).toBe("stopped-open");
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
    expect(said(agent, "archived", false)).toEqual({ kind: "lost-archived", sentence: "OATS lost its session, and its process still runs. Stop it, then start it from OATS.", tone: "plain", note: "OATS lost its session", warning: null, acts: ["stop"], archived: true });
  });
  it("deleted in bb is a state of its own, \"Deleted in bb\": its conversation is gone; Start for a new one", () => {
    expect(state(agent, null, "missing")).toBe("deleted");
    expect(agentStatus(agent, null, NOW, "missing")).toMatchObject({ state: "deleted", word: "Deleted in bb" });
    expect(said(agent, "missing", false)).toEqual({ kind: "lost-deleted", sentence: "Its conversation is gone. Start it from OATS for a new one.", tone: "plain", note: "its conversation is gone", warning: null, acts: ["start"], archived: false });
  });
  it("the two states have their word and their accessible name", () => {
    expect([STATE.archived, STATE.deleted]).toEqual([{ word: "Archived in bb", name: "archived in bb" }, { word: "Deleted in bb", name: "deleted in bb" }]);
  });
  it("on a thread that is open, with no thread named, or before bb has answered: \"stopped\", as the kernel calls it, and nothing of this feature's on an open thread", () => {
    for (const where of ["open", "none", "unknown"] as const) expect(state(agent, null, where)).toBe("stopped");
    expect(said(agent, "unknown", false)).toBeNull();
  });
  it("only a row OATS did not stop is one: an operator's stop, a row that runs and a tmux row are never \"archived\" or \"deleted\"", () => {
    for (const other of [recorded("stoppedByOats"), recorded("working"), recorded("idle"), { ...agent, backend: "tmux" }, { ...agent, running: null, runtimeState: "unknown" }]) {
      for (const where of WHERES) expect(["archived", "deleted"]).not.toContain(state(other, null, where));
    }
  });
});

describe("stopped with the host (sessionEnd \"lost\", its thread open)", () => {
  // The recorded row of a session OATS did not stop; on a thread that is open it is the host's stop (or the machine went down).
  const agent = recorded("threadDeleted");
  it("says so, and that OATS starts it again by itself; no warning, and never the operator's sentence", () => {
    expect(state(agent, null, "open")).toBe("stopped");
    expect(said(agent, "open", true)).toEqual({ kind: "stopped-host", sentence: "with the machine. OATS starts it again when the machine is back.", tone: "plain", note: "with the machine", warning: null, acts: null, archived: false });
  });
});

describe("idle, no harness loaded (running false beside runtimeState \"unknown\", no sessionEnd)", () => {
  // Shaped as the kernel's contract says (docs/desktop-cli-api.md at v0.70.5, "A status row of a provider
  // home"), not recorded: `running: false` for an idle bb thread exists only from the provider's next
  // release; until then such a thread reads `running: null`. The sample's idle row with that one field.
  const agent = sample("harvest-knowledge-helper", { running: false });
  it("is the contract's row: not running, the word \"unknown\", no sessionEnd", () => {
    expect([agent.running, agent.runtimeState, agent.sessionEnd]).toEqual([false, "unknown", undefined]);
  });
  it("is \"idle\", never \"stopped\": Stopped is said of a provider row only when its word is \"stopped\"", () => {
    for (const where of WHERES) expect(state(agent, null, where)).toBe("idle");
    expect(agentStatus(agent, null, NOW, "open").word).toBe("Idle");
  });
  it("on its open thread: that a message there carries the conversation on and Start begins a new one; Start, and no warning", () => {
    expect(said(agent, "open", true)).toEqual({ kind: "idle-unloaded", sentence: "not loaded. To carry on, send it a message here. Start begins a new conversation.", tone: "plain", note: "not loaded", warning: null, acts: ["start"], archived: false });
  });
  it("an idle agent the kernel says nothing of (running null: today's idle bb thread) says none of it", () => {
    expect(said(recorded("idle"), "open", true)).toBeNull();
  });
  it("a tmux row that does not run is stopped whatever its word, as before", () => {
    expect(state({ ...agent, backend: "tmux" }, null, "none")).toBe("stopped");
    expect(state({ ...agent, runtimeState: null }, null, "open")).toBe("stopped");
  });
});

describe("the three rows that read \"not running\" are never confused", () => {
  const operator = said(recorded("stoppedByOats"), "open", true)!;
  const host = said(recorded("threadDeleted"), "open", true)!;
  const unloaded = said(sample("harvest-knowledge-helper", { running: false }), "open", true)!;
  it("the state word tells an agent that is not loaded (Idle) from the two that are stopped", () => {
    expect([recorded("stoppedByOats"), recorded("threadDeleted"), sample("harvest-knowledge-helper", { running: false })].map((agent) => agentStatus(agent, null, NOW, "open").word)).toEqual(["Stopped", "Stopped", "Idle"]);
  });
  it("the tone tells an operator's stop (a warning) from the other two (none)", () => {
    expect([operator.tone, host.tone, unloaded.tone]).toEqual(["warning", "plain", "plain"]);
  });
  it("the three sentences and the three rows' words differ, and only the operator's stop says \"without OATS\"", () => {
    expect(new Set([operator.sentence, host.sentence, unloaded.sentence]).size).toBe(3);
    expect([operator.note, host.note, unloaded.note]).toEqual([null, "with the machine", "not loaded"]);
    expect([operator, host, unloaded].map((row) => /without OATS/.test(row.sentence ?? ""))).toEqual([true, false, false]);
  });
});

describe("failed (its session ended in a shell)", () => {
  // No recording holds this state: the sample's row with the fields the live scenes give it.
  const agent = sample("harvest-knowledge-helper", { running: false, runtimeState: "shell" });
  it("on an open thread: a message there starts it again; Restart, and no warning", () => {
    expect(said(agent, "open", true)).toEqual({ kind: "failed-open", sentence: "Its session ended. Restart it, or send a message here.", tone: "plain", note: null, warning: null, acts: ["restart"], archived: false });
  });
  it("where its thread is not open, only where the thread is", () => {
    expect(said(agent, "archived", false)).toEqual({ kind: "threadless", sentence: null, tone: "plain", note: "its conversation is archived in bb", warning: null, acts: null, archived: true });
    expect(said(agent, "unknown", false)).toBeNull();
  });
});

describe("unreachable", () => {
  const agent = sample("desktop-mockups-developer", { running: null, runtimeState: "unreachable", sessionEnd: "lost" });
  it("says nothing about a message: what status says and its reason are the roster's line, whatever its session's end", () => {
    expect(said(agent, "open", true)).toBeNull();
    for (const where of WHERES) expect(state(agent, null, where)).toBe("unreachable");
    expect(said(agent, "missing", false)).toEqual({ kind: "threadless", sentence: null, tone: "plain", note: "its conversation was deleted in bb", warning: null, acts: null, archived: false });
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
