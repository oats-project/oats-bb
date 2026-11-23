// The table of the spec, row by row: the state of an agent that something happened to outside OATS
// (the one state function, model/view.ts: always one of the plugin's set of state words) and the
// reason the plugin says after it (app/outside/say.ts), from the kernel's row as recorded and bb's
// answer for its thread.
import { describe, expect, it } from "vitest";
import { said, type Said } from "../../app/outside/say";
import { agentStatus } from "../../app/roster/status";
import { STATE } from "../../app/ui/words";
import type { Agent, ThreadWhere } from "../../model/types";
import { state } from "../../model/view";
import { notLoaded, outside, recorded, sample } from "./rows";

const WHERES: ThreadWhere[] = ["open", "archived", "missing", "none", "unknown"];
const NOW = Date.parse("2026-11-21T16:00:00.000Z");
const PLAIN = { tone: "plain", rowTone: "plain", warning: null, acts: null, archived: false } as const;
const word = (agent: Agent) => agentStatus(agent, null, NOW).word;

/** The rows of the table, each with bb's answer for its thread and whether the tree draws it on its thread. */
const operator = recorded("stoppedByOats"); // sessionEnd "stopped"
const lost = recorded("threadDeleted"); // sessionEnd "lost"
const reported = outside();
const unloaded = notLoaded(); // recorded: its harness process ended, its session there
// No recording holds these two states: the sample's row with the fields the kernel's contract gives such a row.
const failed = sample("harvest-knowledge-helper", { running: false, runtimeState: "shell" });
const unreachable = sample("desktop-mockups-developer", { running: null, runtimeState: "unreachable", sessionEnd: "lost" });

describe("the state word is always one of the set", () => {
  const SET = ["Needs you", "Working", "Idle", "Stopped", "Failed", "Unreachable", "Running outside OATS"];
  it("the set is the seven words of app/ui/words.ts", () => {
    expect(Object.values(STATE).map((each) => each.word).sort()).toEqual([...SET].sort());
  });
  it("for every row of the table and every answer of bb's: \"Archived in bb\" and \"Deleted in bb\" are reasons, never states", () => {
    for (const agent of [operator, lost, reported, unloaded, failed, unreachable, recorded("working"), recorded("idle")]) {
      expect(SET).toContain(word(agent));
      for (const where of WHERES) for (const attached of [true, false]) expect(said(agent, where, attached)?.sentence ?? "").not.toMatch(/^(Archived|Deleted) in bb/);
    }
    expect([operator, lost, reported, unloaded, failed, unreachable].map(word)).toEqual(["Stopped", "Stopped", "Running outside OATS", "Idle", "Failed", "Unreachable"]);
  });
});

describe("stopped by an operator (sessionEnd \"stopped\")", () => {
  it("is the recorded row of a home OATS stopped", () => {
    expect([operator.running, operator.runtimeState, operator.sessionEnd, operator.outsideOats]).toEqual([false, "stopped", "stopped", undefined]);
  });
  it("on its open thread: the interim warning, in the warning tone, with the Start it names; the row says nothing after the soul", () => {
    expect(said(operator, "open", true)).toEqual({ ...PLAIN, kind: "stopped-open", sentence: "A message sent here in bb starts it again without OATS. Use Start.", tone: "warning", note: null, acts: ["start"] });
  });
  // The spec's author's ruling of 23 Nov 2026 (it reversed "an operator's stop, and only that"): a
  // safety sentence fails closed. One case per value the kernel gives `sessionEnd` (docs/desktop-cli-api.md
  // at v0.70.5, `row-session-end`), on a row the kernel calls stopped whose thread is open.
  for (const [sessionEnd, why] of [
    ["stopped", "an operator's stop"],
    ["exited", "a harness that ended by itself"],
    [undefined, "a row that names none (a retire pending, a rollback incomplete, a spawn in progress)"],
    [null, "a row whose sessionEnd is null"],
    ["something-new", "a word this plugin does not know"],
  ] as const) {
    it(`sessionEnd ${JSON.stringify(sessionEnd) ?? "absent"} (${why}): the warning, with Start`, () => {
      expect(said({ ...operator, sessionEnd }, "open", true)).toEqual({ ...PLAIN, kind: "stopped-open", sentence: "A message sent here in bb starts it again without OATS. Use Start.", tone: "warning", note: null, acts: ["start"] });
    });
  }
  it("sessionEnd \"lost\" (stopped with the machine: OATS resumes it) is the one stop that is spared the warning", () => {
    expect(said({ ...operator, sessionEnd: "lost" }, "open", true)).toMatchObject({ kind: "stopped-host", tone: "plain", acts: null });
  });
  it("with its thread archived in bb: the fact, the row's reason in the soul's place, and the way to it; no warning", () => {
    expect(said(operator, "archived", false)).toEqual({ ...PLAIN, kind: "stopped-archived", sentence: "Its conversation is archived in bb. Start begins a new one.", note: null, archived: true }); // the soul stays on its row
  });
  it("with its thread deleted in bb: that it was deleted, and to start it for a new one, as a warning; never \"its bb thread is gone\"", () => {
    expect(said(operator, "missing", false)).toEqual({ ...PLAIN, kind: "deleted", sentence: "Its conversation was deleted in bb. Start it from OATS for a new one.", tone: "warning", note: "deleted in bb", rowTone: "warning" });
  });
  it("before bb has answered, nothing is claimed of its thread", () => {
    expect(said(operator, "unknown", false)).toBeNull();
  });
});

describe("a session OATS lost (sessionEnd \"lost\")", () => {
  it("is the recorded row of an agent whose thread was deleted in bb: the kernel calls it stopped", () => {
    expect([lost.running, lost.runtimeState, lost.sessionEnd, state(lost, null)]).toEqual([false, "stopped", "lost", "stopped"]);
  });
  it("its thread archived in bb: \"Stopped\" in the warning tone, that its process may still run, and Stop", () => {
    expect(said(lost, "archived", false)).toEqual({
      ...PLAIN, kind: "lost-archived", sentence: "Its conversation was archived in bb while it ran, and its process may still run. Stop it, then start it from OATS.",
      tone: "warning", note: "archived in bb", rowTone: "warning", acts: ["stop"], archived: true,
    });
  });
  it("its thread deleted in bb: the same reason as for a stopped one, as a warning", () => {
    expect(said(lost, "missing", false)).toEqual({ ...PLAIN, kind: "deleted", sentence: "Its conversation was deleted in bb. Start it from OATS for a new one.", tone: "warning", note: "deleted in bb", rowTone: "warning" });
  });
  it("archived is told from deleted, and a lost session from an operator's stop, by the row and bb's answer alone", () => {
    const kinds = (agent: Agent) => (["archived", "missing"] as const).map((where) => said(agent, where, false)!.kind);
    expect([kinds(lost), kinds(operator)]).toEqual([["lost-archived", "deleted"], ["stopped-archived", "deleted"]]);
  });
  it("on a thread that is open it stopped with the machine: that OATS starts it again by itself; no warning, and never the operator's sentence", () => {
    expect(said(lost, "open", true)).toEqual({ ...PLAIN, kind: "stopped-host", sentence: "with the machine. OATS starts it again when the machine is back.", note: "with the machine" });
    expect(said(lost, "unknown", false)).toBeNull();
  });
});

describe("a row that still says it runs, and bb has its thread archived", () => {
  // A person archived the conversation of an agent whose process goes on: bb's Archive never touches the harness.
  const SENTENCE = "Its conversation was archived in bb while it ran, and its process may still run. Stop it, then start it from OATS.";
  const WARNS = { ...PLAIN, kind: "running-archived", sentence: SENTENCE, tone: "warning", note: "archived in bb", rowTone: "warning", acts: ["stop"], archived: true };
  it("the warning, the reason after its state's word, and Stop: for a harness the kernel says is loaded, and for one it cannot tell", () => {
    for (const running of [true, null]) {
      const runs = sample("harvest-knowledge-helper", { running });
      expect(said(runs, "archived", false), `running ${running}`).toEqual(WARNS);
      expect(word(runs)).toBe("Idle"); // its state's word stays: bb lists no thread to read a turn from
    }
    // An agent that asked a person something keeps "Needs you", and warns the same.
    const asks: Agent = { ...sample("harvest-knowledge-helper", { running: true }), waiting: { reason: "question", message: "ok?", since: null } };
    expect([word(asks), said(asks, "archived", false)]).toEqual(["Needs you", WARNS]);
  });
  it("never for a row the kernel says has no harness loaded, a failed or an unreachable one, a stopped one, or a thread that is not archived", () => {
    expect(said(unloaded, "archived", false)).toEqual({ ...PLAIN, kind: "threadless", sentence: null, note: "archived in bb", archived: true });
    expect(said(failed, "archived", false)?.kind).toBe("threadless");
    expect(said(unreachable, "archived", false)?.kind).toBe("threadless");
    // A claim makes a failed or an unreachable row "Needs you": still not a row that runs.
    const claim = { reason: "question", message: "ok?", since: null };
    for (const runtimeState of ["shell", "unreachable"]) expect(said({ ...sample("harvest-knowledge-helper", { running: null, runtimeState }), waiting: claim }, "archived", false)?.kind, runtimeState).toBe("threadless");
    expect(said(operator, "archived", false)?.kind).toBe("stopped-archived");
    const runs = sample("harvest-knowledge-helper", { running: true });
    expect([said(runs, "open", true), said(runs, "missing", false)?.kind, said(runs, "unknown", false)]).toEqual([null, "threadless", null]);
  });
});

describe("the kernel's outsideOats", () => {
  const REPORT = {
    code: "running-outside-oats", backend: "bb",
    message: "a harness runs in flaky-ci-2-developer on bb, and OATS recorded this instance stopped: stop it with `oats instance stop flaky-ci-2-developer`, or start it from OATS",
  };
  it("is a row OATS recorded stopped, with the report; its state is \"Running outside OATS\", wherever its thread is", () => {
    expect([reported.running, reported.runtimeState, reported.sessionEnd, reported.outsideOats]).toEqual([false, "stopped", "stopped", REPORT]);
    expect([state(reported, null), word(reported)]).toEqual(["outside", "Running outside OATS"]);
  });
  it("says that OATS recorded it stopped, as a fact after the state, with the report for its notice and its two acts; its row says the state alone", () => {
    for (const where of WHERES) {
      for (const attached of [true, false]) {
        expect(said(reported, where, attached)).toEqual({ ...PLAIN, kind: "outside", sentence: "recorded stopped", tone: "warning", note: "", warning: REPORT, acts: ["stop", "start"], archived: where === "archived" });
      }
    }
  });
  it("on a kernel that does not list the feature nothing is said of it: the row is an ordinary stopped one", () => {
    const old = outside(false);
    expect(old.outsideOats).toBeUndefined();
    expect([word(old), said(old, "open", true)?.kind, said(old, "archived", false)?.kind]).toEqual(["Stopped", "stopped-open", "stopped-archived"]);
  });
});

describe("idle, no harness loaded (running false beside runtimeState \"unknown\", no sessionEnd)", () => {
  // RECORDED (test/fixtures/outside/status-not-loaded.json): the row the kernel printed, on the provider that
  // scans its harness (oats-bb #40), for an agent whose thread's harness process had ended.
  it("is the contract's row, and is \"Idle\", never \"Stopped\"", () => {
    expect([unloaded.running, unloaded.runtimeState, unloaded.sessionEnd, state(unloaded, null), word(unloaded)]).toEqual([false, "unknown", undefined, "idle", "Idle"]);
  });
  it("on its open thread: that a message there carries the conversation on and Start begins a new one; Start, and no warning", () => {
    expect(said(unloaded, "open", true)).toEqual({ ...PLAIN, kind: "idle-unloaded", sentence: "not loaded. To carry on, send it a message here. Start begins a new conversation.", note: "not loaded", acts: ["start"] });
  });
  it("an idle agent the kernel says nothing of (running null: today's idle bb thread) says none of it", () => {
    expect(said(recorded("idle"), "open", true)).toBeNull();
  });
  it("a row that does not run with no word at all, and a tmux row that does not run, are stopped as before", () => {
    expect([state({ ...unloaded, backend: "tmux" }, null), state({ ...unloaded, runtimeState: null }, null)]).toEqual(["stopped", "stopped"]);
  });
});

describe("the three rows that read \"not running\" are never confused", () => {
  const rows: Said[] = [said(operator, "open", true)!, said(lost, "open", true)!, said(unloaded, "open", true)!];
  it("the state word tells an agent that is not loaded (Idle) from the two that are stopped", () => {
    expect([operator, lost, unloaded].map(word)).toEqual(["Stopped", "Stopped", "Idle"]);
  });
  it("the tone tells an operator's stop (a warning) from the other two (none)", () => {
    expect(rows.map((row) => row.tone)).toEqual(["warning", "plain", "plain"]);
  });
  it("the three sentences and the three rows' reasons differ, and only the operator's stop says \"without OATS\"", () => {
    expect(new Set(rows.map((row) => row.sentence)).size).toBe(3);
    expect(rows.map((row) => row.note)).toEqual([null, "with the machine", "not loaded"]);
    expect(rows.map((row) => /without OATS/.test(row.sentence ?? ""))).toEqual([true, false, false]);
  });
});

describe("failed, unreachable, and what is not this feature's", () => {
  it("failed on an open thread: that a message there starts it again; the line's own Restart, and no warning", () => {
    expect(said(failed, "open", true)).toEqual({ ...PLAIN, kind: "failed-open", sentence: "Its session ended. Restart it, or send a message here.", note: null });
    expect(said(failed, "archived", false)).toEqual({ ...PLAIN, kind: "threadless", sentence: null, note: "archived in bb", archived: true });
  });
  it("unreachable says nothing about a message: what status says and its reason are the roster's line, whatever its session's end", () => {
    expect(said(unreachable, "open", true)).toBeNull();
    expect(said(unreachable, "missing", false)).toEqual({ ...PLAIN, kind: "threadless", sentence: null, note: "deleted in bb" });
  });
  it("an agent that works or is idle on its thread, and an agent on tmux whatever its row says", () => {
    for (const which of ["working", "idle"] as const) expect(said(recorded(which), "open", true)).toBeNull();
    const tmux = sample("kernel-fix-developer", { sessionEnd: "lost", outsideOats: { code: "running-outside-oats", backend: "tmux", message: "x" } });
    expect(tmux.backend).toBe("tmux");
    for (const where of WHERES) expect(said(tmux, where, false)).toBeNull();
  });
  it("a row the tree does not draw on its thread says where the thread is, once bb has answered; \"its bb thread is gone\" is said of none", () => {
    expect(WHERES.map((where) => said(recorded("working"), where, false)?.note ?? null)).toEqual(["thread not shown in bb", "archived in bb", "deleted in bb", "no bb thread", null]);
  });
});
