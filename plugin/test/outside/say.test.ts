// The table of the spec, row by row: the state of an agent that something happened to outside OATS
// (the one state function, model/view.ts: always one of the plugin's set of state words) and the
// reason the plugin says after it (app/outside/say.ts), from the kernel's row as recorded and bb's
// answer for its thread.
import { describe, expect, it } from "vitest";
import { lineParts, rowWarns } from "../../app/outside/parts";
import { said, type Said } from "../../app/outside/say";
import { agentStatus } from "../../app/roster/status";
import { STATE } from "../../app/ui/words";
import type { Agent, ThreadWhere } from "../../model/types";
import { state } from "../../model/view";
import { notLoaded, outside, recorded, sample, tmuxRow } from "./rows";

const WHERES: ThreadWhere[] = ["open", "archived", "missing", "none", "unknown"];
const NOW = Date.parse("2026-11-21T16:00:00.000Z");
const PLAIN = { tone: "plain", rowTone: "plain", warning: null, acts: null, archived: false, message: false } as const;
/** Where a MESSAGE is the way on (the agent's own listed thread; model/rest.ts `messageResumes`): the line says so, and has no act of its own. */
const MESSAGE = { acts: [], message: true } as const;
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
  // What is said AFTER the state's word is never a state's word itself, nor a bare "Archived in bb" or
  // "Deleted in bb" standing as one (the warning of a process that may still run begins with the
  // fact, "Archived in bb while running: …", and follows the state's word on its line).
  const STATE_WORDS = [...SET, "Archived in bb", "Deleted in bb", "Archived in bb.", "Deleted in bb."];
  it("the set is the seven words of app/ui/words.ts", () => {
    expect(Object.values(STATE).map((each) => each.word).sort()).toEqual([...SET].sort());
  });
  it("for every row of the table and every answer of bb's: \"Archived in bb\" and \"Deleted in bb\" are reasons, never states", () => {
    for (const agent of [operator, lost, reported, unloaded, failed, unreachable, recorded("working"), recorded("idle")]) {
      expect(SET).toContain(word(agent));
      for (const where of WHERES) for (const attached of [true, false]) expect(STATE_WORDS).not.toContain(said(agent, where, attached)?.sentence ?? "");
    }
    expect([operator, lost, reported, unloaded, failed, unreachable].map(word)).toEqual(["Stopped", "Stopped", "Running outside OATS", "Idle", "Failed", "Unreachable"]);
  });
});

describe("stopped by an operator (sessionEnd \"stopped\")", () => {
  it("is the recorded row of a home OATS stopped", () => {
    expect([operator.running, operator.runtimeState, operator.sessionEnd, operator.outsideOats]).toEqual([false, "stopped", "stopped", undefined]);
  });
  it("on its open thread: the interim warning, in the warning tone, with Start; the row says nothing after the state's word", () => {
    expect(said(operator, "open", true)).toEqual({ ...PLAIN, kind: "stopped-open", sentence: "A message here starts it outside OATS.", tone: "warning", note: null, acts: ["start"] });
  });
  // The spec's author's ruling of 23 Nov 2026 (it reversed "an operator's stop, and only that"): a
  // safety sentence fails closed. One case per value the kernel gives `sessionEnd` (docs/desktop-cli-api.md
  // at v0.70.5, `row-session-end`), on a row the kernel calls stopped whose thread is open.
  for (const [sessionEnd, why] of [
    ["stopped", "an operator's stop"],
    [undefined, "a row that names none (a retire pending, a rollback incomplete, a spawn in progress)"],
    [null, "a row whose sessionEnd is null"],
    ["something-new", "a word this plugin does not know"],
  ] as const) {
    it(`sessionEnd ${JSON.stringify(sessionEnd) ?? "absent"} (${why}): the warning, with Start`, () => {
      expect(said({ ...operator, sessionEnd }, "open", true)).toEqual({ ...PLAIN, kind: "stopped-open", sentence: "A message here starts it outside OATS.", tone: "warning", note: null, acts: ["start"] });
    });
  }
  it("sessionEnd \"exited\" (its harness ended by itself) is no stop: the agent FAILED, and a message carries it on; no warning", () => {
    const exited = { ...operator, sessionEnd: "exited" };
    expect(word(exited)).toBe("Failed");
    expect(said(exited, "open", true)).toEqual({ ...PLAIN, ...MESSAGE, kind: "failed-open", sentence: "session ended", note: null });
  });
  it("sessionEnd \"lost\" (its session ended without OATS stopping it) is the one stop that is spared the warning", () => {
    expect(said({ ...operator, sessionEnd: "lost" }, "open", true)).toMatchObject({ kind: "lost-open", tone: "plain", ...MESSAGE });
  });
  it("with its thread archived in bb: the reason on its line, nothing after the state's word on its row, and the way to it; no warning", () => {
    expect(said(operator, "archived", false)).toEqual({ ...PLAIN, kind: "stopped-archived", sentence: "archived in bb", note: null, archived: true }); // its row says "Stopped" alone
  });
  it("with its thread deleted in bb: that it was deleted, as a warning; never \"its bb thread is gone\"", () => {
    expect(said(operator, "missing", false)).toEqual({ ...PLAIN, kind: "deleted", sentence: "deleted in bb", tone: "warning", note: "deleted in bb", rowTone: "warning" });
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
      ...PLAIN, kind: "lost-archived", sentence: "Archived in bb while running: it may still run.",
      tone: "warning", note: "may still run", rowTone: "warning", acts: ["stop"], archived: true,
    });
  });
  it("its thread deleted in bb: the same reason as for a stopped one, as a warning", () => {
    expect(said(lost, "missing", false)).toEqual({ ...PLAIN, kind: "deleted", sentence: "deleted in bb", tone: "warning", note: "deleted in bb", rowTone: "warning" });
  });
  it("archived is told from deleted, and a lost session from an operator's stop, by the row and bb's answer alone", () => {
    const kinds = (agent: Agent) => (["archived", "missing"] as const).map((where) => said(agent, where, false)!.kind);
    expect([kinds(lost), kinds(operator)]).toEqual([["lost-archived", "deleted"], ["stopped-archived", "deleted"]]);
  });
  it("on a thread that is open: the reason \"session lost\", and that a message is the way on (no Start on the line); no cause guessed, nothing promised, no warning, and never the operator's sentence", () => {
    expect(said(lost, "open", true)).toEqual({ ...PLAIN, ...MESSAGE, kind: "lost-open", sentence: "session lost", note: "session lost" });
    expect(said(lost, "open", true)!.sentence).not.toMatch(/outside OATS/);
    expect(said(lost, "open", true)!.sentence).not.toMatch(/machine|when|again by itself/);
    expect(said(lost, "unknown", false)).toBeNull();
  });
});

describe("the word \"stopped\" with no word that the row does not run, on a row that still shows a claim", () => {
  // No kernel prints it. The claim's gate lets the claim through (it asks `running: false`), so the row is drawn
  // "Needs you"; the home's card refuses it as a stop, and its line must warn as for a stop.
  it("on its open thread: the stop's warning, with Start, whatever it says of how its session ended", () => {
    for (const running of [null, true]) for (const sessionEnd of [undefined, "stopped", "lost", "exited"]) {
      const asks: Agent = { ...operator, running, sessionEnd, waiting: { reason: "question", message: "ok?", since: null } };
      expect([word(asks), said(asks, "open", true)?.kind, said(asks, "open", true)?.tone], `${running} ${sessionEnd}`).toEqual(["Needs you", "stopped-open", "warning"]);
      // And where bb has its thread archived, or has none of that id: what a stop says there.
      expect([said(asks, "archived", false)?.kind, said(asks, "missing", false)?.kind], `${running} ${sessionEnd}`).toEqual(["stopped-archived", "deleted"]);
    }
  });
});

describe("a row that still says it runs, and bb has its thread archived", () => {
  // A person archived the conversation of an agent whose process goes on: bb's Archive never touches the harness.
  const SENTENCE = "Archived in bb while running: it may still run.";
  // (On its row, in the reason's place: "may still run", what a person must not miss; the line says the whole.)
  const WARNS = { ...PLAIN, kind: "running-archived", sentence: SENTENCE, tone: "warning", note: "may still run", rowTone: "warning", acts: ["stop"], archived: true };
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

describe("the rows that warn (`rowWarns`): what a closed parent of the roster carries a mark for", () => {
  // The row's own rule, asked with the state the row draws: true for exactly three kinds.
  const warns = (agent: Agent, where: ThreadWhere) => rowWarns(said(agent, where, false), state(agent, null));
  it("its thread archived in bb while it ran; its session lost with its thread archived; its thread deleted in bb", () => {
    const runs = sample("harvest-knowledge-helper", { running: true });
    expect([said(runs, "archived", false)?.kind, warns(runs, "archived")]).toEqual(["running-archived", true]);
    expect([said(lost, "archived", false)?.kind, warns(lost, "archived")]).toEqual(["lost-archived", true]);
    expect([said(operator, "missing", false)?.kind, warns(operator, "missing")]).toEqual(["deleted", true]);
    expect([said(lost, "missing", false)?.kind, warns(lost, "missing")]).toEqual(["deleted", true]);
  });
  it("only with the state the reason follows: a lost session whose thread is archived, on a row that says another state (bb's own question makes it \"Needs you\"), draws no warning, so it warns nobody", () => {
    const lostArchived = said(lost, "archived", false);
    expect([lostArchived?.rowTone, rowWarns(lostArchived, "stopped"), rowWarns(lostArchived, "needs-you")]).toEqual(["warning", true, false]);
  });
  it("never an operator's stop with its thread archived, an idle agent bb has not answered for, or a row on tmux", () => {
    expect([said(operator, "archived", false)?.kind, warns(operator, "archived")]).toEqual(["stopped-archived", false]);
    expect(warns(unloaded, "unknown")).toBe(false);
    for (const row of ["tmux-row-running.json", "tmux-row-stopped.json", "tmux-row-lost.json"] as const) expect(warns(tmuxRow(row), "none")).toBe(false);
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
        expect(said(reported, where, attached)).toEqual({ ...PLAIN, kind: "outside", sentence: "stopped in OATS", tone: "warning", note: "", warning: REPORT, acts: ["stop", "start"], archived: where === "archived" });
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
  it("on its open thread: the reason \"not loaded\", and that a message is the way on (no Start on the line: what Start does is its dialog's to say); no warning", () => {
    expect(said(unloaded, "open", true)).toEqual({ ...PLAIN, ...MESSAGE, kind: "idle-unloaded", sentence: "not loaded", note: "not loaded" });
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
  it("the three reasons differ, and only the operator's stop says \"outside OATS\"", () => {
    expect(new Set(rows.map((row) => row.sentence)).size).toBe(3);
    expect(rows.map((row) => row.note)).toEqual([null, "session lost", "not loaded"]);
    expect(rows.map((row) => /outside OATS/.test(row.sentence ?? ""))).toEqual([true, false, false]);
  });
});

describe("an agent on tmux: the three recorded rows (OATS 0.70.5, the real run)", () => {
  it("its session lost (its window killed): \"Stopped\", and the reason \"session lost\" alone, on its row and on its page: no sentence (what Start does is its dialog's one line); nobody stopped it", () => {
    const lostTmux = tmuxRow("tmux-row-lost.json");
    expect([lostTmux.backend, word(lostTmux)]).toEqual(["tmux", "Stopped"]);
    const lostSaid = said(lostTmux, "none", false)!;
    expect(lostSaid).toEqual({ ...PLAIN, kind: "lost-tmux", sentence: "session lost", note: "session lost" });
    // The same reason word on bb, on the thread's line: the reason alone there too.
    expect(said(lost, "open", true)).toMatchObject({ kind: "lost-open", sentence: "session lost", note: "session lost", tone: "plain" });
    // No sentence of a lost session is said anywhere: not that nobody stopped it, not what a message or Start does.
    expect(JSON.stringify([lostSaid, said(lost, "open", true)])).not.toMatch(/Nobody stopped|without OATS stopping|To carry on|Start tries|Start begins/);
  });
  it("stopped with OATS (its window left at a shell): \"Stopped\", never \"Failed\", and nothing of this feature's: an operator stopped it", () => {
    const stoppedTmux = tmuxRow("tmux-row-stopped.json");
    expect([word(stoppedTmux), said(stoppedTmux, "none", false)]).toEqual(["Stopped", null]);
  });
  it("running: nothing", () => {
    const runningTmux = tmuxRow("tmux-row-running.json");
    expect([word(runningTmux), said(runningTmux, "none", false)]).toEqual(["Working", null]);
  });
});

describe("failed, unreachable, and what is not this feature's", () => {
  it("failed on an open thread: the reason \"session ended\", and that a message is the way on where the row says that it does not run (no Restart on the line); the roster's own act where the row does not say so; no warning", () => {
    expect(failed.running).toBe(false);
    expect(said(failed, "open", true)).toEqual({ ...PLAIN, ...MESSAGE, kind: "failed-open", sentence: "session ended", note: null });
    // `running` null or true beside "shell": nothing says that it does not run, so a message is not the designed way on: the line keeps the roster's own act.
    for (const running of [null, true]) expect(said({ ...failed, running }, "open", true), String(running)).toEqual({ ...PLAIN, kind: "failed-open", sentence: "session ended", note: null });
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
    expect(WHERES.map((where) => said(recorded("working"), where, false)?.note ?? null)).toEqual(["thread not shown in bb", "may still run", "deleted in bb", "no bb thread", null]); // (it runs, and bb has its thread archived: its row says that it may still run)
  });
});

describe("\"message to continue\": said only where a message carries the agent on under OATS, never where it would start it outside OATS", () => {
  /** What the thread's line says after the state, and whether it has an act of the lifecycle's own (null: the roster's act stands). */
  const line = (agent: Agent, where: ThreadWhere, attached: boolean, thread: object | null = null) => {
    const on = said(agent, where, attached, thread);
    const status = agentStatus(agent, null, NOW);
    const parts = lineParts(on, { state: status.state, since: status.since, detail: status.detail });
    return { words: [parts.since, parts.detail].filter((part) => part !== null).join(" · "), message: on?.message ?? false, acts: on?.acts ?? null };
  };
  it("said: a lost session and no harness loaded (recorded rows) and a harness that ended by itself, on the agent's own listed bb thread", () => {
    expect(line(lost, "open", true)).toEqual({ words: "session lost · message to continue", message: true, acts: [] });
    expect(line(unloaded, "open", true)).toEqual({ words: "not loaded · message to continue", message: true, acts: [] });
    expect(line(failed, "open", true)).toEqual({ words: "session ended · message to continue", message: true, acts: [] });
  });
  // A message in bb to any of these starts a harness OATS does not expect (the kernel then reports it "running outside OATS"), or reaches nothing.
  const NEVER: [string, Agent, ThreadWhere, boolean, (object | null)?][] = [
    ["an operator's stop (sessionEnd \"stopped\")", operator, "open", true],
    ["a stop that does not say how its session ended", { ...operator, sessionEnd: undefined }, "open", true],
    ["a stop whose sessionEnd is null", { ...operator, sessionEnd: null }, "open", true],
    ["a stop with a word of the session's end this plugin does not know", { ...operator, sessionEnd: "something-new" }, "open", true],
    ["the word \"stopped\" with no word that the row does not run, beside \"lost\"", { ...lost, running: null, runtimeState: "stopped" }, "open", true],
    ["an agent that runs outside OATS (the kernel's report)", reported, "open", true],
    ["a thread that failed at its start (it never ran)", lost, "open", true, { status: "error", startFailure: { message: "Command thread.start failed", detail: null } }],
    ["a session the kernel cannot reach", unreachable, "open", true],
    ["a failed row that does not say that it does not run", { ...failed, running: null }, "open", true],
    ["an agent that runs", recorded("working"), "open", true],
    ["a lost session whose thread bb has archived", lost, "archived", false],
    ["a lost session whose thread bb no longer has", lost, "missing", false],
    ["a lost session bb has not answered for", lost, "unknown", false],
    ["a lost session on a thread the roster does not draw it on", lost, "open", false],
    ["a lost session on tmux", tmuxRow("tmux-row-lost.json"), "none", false],
    ["a tmux agent stopped with OATS", tmuxRow("tmux-row-stopped.json"), "none", false],
  ];
  for (const [name, agent, where, attached, thread] of NEVER) {
    it(`never: ${name}`, () => {
      const read = line(agent, where, attached, thread ?? null);
      expect(read.message).toBe(false);
      expect(read.words).not.toMatch(/message to continue/);
      // And the act is never taken off the line for it: this feature's own (Start, Stop), or the roster's.
      expect(read.acts === null || read.acts.length > 0).toBe(true);
    });
  }
});

