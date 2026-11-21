// `oats instance events`, read into the panel's activity rows: against the answer recorded from the
// real kernel (a spawn, a restart, a stop, a start and two waiting claims of the board), and against
// that answer changed for the kinds the recording does not hold.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { panelEvents, panelEventsArgv, parsePanelEvents } from "../../kernel/panel-events.js";

type Answer = { events: Record<string, unknown>[] } & Record<string, unknown>;
const recorded = (): Answer => structuredClone((JSON.parse(readFileSync(resolve(process.cwd(), "test/fixtures/panel/events.json"), "utf8")) as { result: Answer }).result);
const HOME = "/abs/deployment/agents/oats-expert/instances/panel-worktree-helper";
const row = (kind: string, data: unknown, incarnation: string | null = "2026-11-21T18:13:36.478Z") => ({
  eventsApi: 2, at: "2026-11-21T18:30:00.000Z", instance: "panel-worktree-helper", home: HOME, incarnation, producer: "kernel", kind, data,
});
const only = (kind: string, data: unknown, incarnation?: string | null) => {
  const document = recorded();
  document.events = [row(kind, data, incarnation)];
  const answer = parsePanelEvents(document);
  if (!answer.ok) throw new Error(answer.error.message);
  return answer.value.events[0]!;
};

describe("the activity read", () => {
  it("asks for the last hundred rows of the exact home", () => {
    expect(panelEventsArgv("panel-worktree-helper", HOME)).toEqual({ ok: true, value: ["instance", "events", "panel-worktree-helper", "--home", HOME, "--limit", "100", "--json"] });
    expect(panelEventsArgv("--limit", HOME).ok).toBe(false);
    expect(panelEventsArgv("panel-worktree-helper", "relative/home").ok).toBe(false);
  });

  it("the recorded history: every row with its kind, its producer and its own facts", () => {
    const answer = parsePanelEvents(recorded());
    expect(answer.ok).toBe(true);
    if (!answer.ok) return;
    expect(panelEvents.parse(answer.value)).toEqual(answer.value);
    expect(answer.value).toMatchObject({
      count: 8, returned: 8, truncated: false,
      integrity: { unreadableRows: 0, foreignRows: 0, sources: [{ path: "home", status: "ok" }, { path: "workspace", status: "ok" }] },
      waitingOnYou: { producer: "oats.board", since: "2026-11-21T18:23:39.829Z", message: "Which base branch?" },
      waitingClaims: [{ producer: "oats.board", waiting: true, since: "2026-11-21T18:23:39.829Z", reason: "attention" }],
    });
    expect(answer.value.events.map((event) => `${event.kind} ${event.producer} ${event.incarnation}`)).toEqual([
      "spawned kernel current", "launched kernel current", "waiting oats.board current", "restarted kernel current", "launched kernel current", "stopped kernel current",
      "launched kernel current", "waiting oats.board current",
    ]);
    expect(answer.value.events[0]).toEqual({
      at: "2026-11-21T18:13:37.962Z", kind: "spawned", producer: "kernel", incarnation: "current",
      facts: [
        { key: "agent", value: "oats-expert" }, { key: "work", value: "worktree" }, { key: "branch", value: "agents/panel-worktree-helper" }, { key: "model", value: "claude-opus-5-5" },
        { key: "parentInstance", value: "redesign-ui-lead" }, { key: "relation", value: "child" }, { key: "harness", value: "claude" }, { key: "launched", value: true },
      ],
      setup: null, policy: null, differed: null,
    });
    expect(answer.value.events[1]?.facts).toEqual([{ key: "backend", value: "bb" }, { key: "launchConfig", value: null }, { key: "harness", value: "claude" }]);
    expect(answer.value.events[2]?.facts).toEqual([{ key: "waitingOnYou", value: true }, { key: "reason", value: "attention" }, { key: "message", value: "How should I merge the pull request?" }]);
    expect(answer.value.events[3]?.facts).toEqual([{ key: "phase", value: "restart-stop" }, { key: "signal", value: null }, { key: "waitedMs", value: 2064 }, { key: "stillRunningCount", value: 0 }]);
    expect(answer.value.events[5]?.facts).toEqual([{ key: "signal", value: null }, { key: "state", value: "stopped" }, { key: "waitedMs", value: 2149 }, { key: "stillRunningCount", value: 0 }]);
  });

  it("processes still running are a count, never their list", () => {
    const event = only("stop-refused", { phase: "stop", signal: "SIGTERM", state: "running", waitedMs: 10000, stillRunning: [{ pid: 41, command: "claude --secret" }, { pid: 42, command: "node" }], reason: "the harness did not exit" });
    expect(event.facts).toEqual([
      { key: "phase", value: "stop" }, { key: "signal", value: "SIGTERM" }, { key: "state", value: "running" }, { key: "waitedMs", value: 10000 }, { key: "reason", value: "the harness did not exit" },
      { key: "stillRunningCount", value: 2 },
    ]);
    expect(JSON.stringify(event)).not.toContain("secret");
  });

  it("the other kinds' facts: a retire, a retained worktree, an added worktree with its setup, a refused child spawn", () => {
    expect(only("retire-planned", { planRevision: "abc", children: 2, dirty: null }).facts).toEqual([{ key: "planRevision", value: "abc" }, { key: "children", value: 2 }, { key: "dirty", value: null }]);
    expect(only("retired", { agent: "dev", workRecovery: "/abs/recovery", keepDir: false, self: true, quarantine: false }).facts).toEqual([
      { key: "agent", value: "dev" }, { key: "workRecovery", value: "/abs/recovery" }, { key: "keepDir", value: false }, { key: "self", value: true }, { key: "quarantine", value: false },
    ]);
    expect(only("worktree-retained", { movedTo: "/abs/kept", branch: "agents/x", recordedBranch: "agents/y" }).facts.map((fact) => fact.key)).toEqual(["movedTo", "branch", "recordedBranch"]);
    const added = only("worktree-added", { purpose: "docs", path: "/abs/home/.work-docs", branch: "agents/x-docs", base: "main", member: 7, hooks: [{ capability: "oats.dev", ok: true, log: "/abs/log" }, { capability: "oats.x", ok: false, log: null }] });
    expect(added.facts).toEqual([{ key: "purpose", value: "docs" }, { key: "path", value: "/abs/home/.work-docs" }, { key: "branch", value: "agents/x-docs" }, { key: "base", value: "main" }]);
    expect(added.setup).toEqual([{ capability: "oats.dev", ok: true, log: "/abs/log" }, { capability: "oats.x", ok: false, log: null }]);
    const refused = only("child-spawn-refused", { child: "dev-b", agent: "dev", reason: "children are not allowed", policy: { allowed: false, origin: { kind: "soul", detail: "soul.yaml#/children" } } });
    expect(refused.policy).toEqual({ allowed: false, origin: "soul" });
    expect(refused.facts).toEqual([{ key: "child", value: "dev-b" }, { key: "agent", value: "dev" }, { key: "reason", value: "children are not allowed" }]);
    expect(only("launch-prompt", { status: "completed", class: "development-channel", action: "confirm", claudeVersion: "2.1.328", signatureId: "dev-channel-1", startId: "x" }).facts.map((fact) => fact.key)).toEqual([
      "status", "class", "action", "claudeVersion", "signatureId",
    ]);
    expect(only("upgrade-refused", { step: "hook oats.aweb", reason: "the hook failed" }).facts).toEqual([{ key: "reason", value: "the hook failed" }, { key: "step", value: "hook oats.aweb" }]);
  });

  it("a blocked launch's row says what its screen differed in; anything else of it drops that fact alone", () => {
    const differed = { nearest: "dev-channel-1", firstDifference: { index: 12, expected: "Do you trust this folder?", found: "" } };
    expect(only("launch-prompt", { status: "blocked", class: "development-channel", differed }).differed).toEqual({ nearest: "dev-channel-1", index: 12, expected: "Do you trust this folder?", found: "" });
    expect(only("launch-prompt", { status: "completed", differed }).differed).toBeNull();
    expect(only("stopped", { status: "blocked", differed }).differed).toBeNull();
    expect(only("launch-prompt", { status: "blocked", differed: { nearest: "x", firstDifference: { index: -1, expected: "a", found: "b" } } }).differed).toBeNull();
    expect(only("launch-prompt", { status: "blocked", differed: { nearest: "x", firstDifference: { index: 0, expected: "a".repeat(41), found: "b" } } }).differed).toBeNull();
    expect(only("launch-prompt", { status: "blocked", differed: "x" })).toMatchObject({ differed: null, facts: [{ key: "status", value: "blocked" }] });
  });

  it("a row of an earlier instance at this address, and one whose incarnation is not reported", () => {
    expect(only("spawned", {}, "2026-01-01T00:00:00.000Z").incarnation).toBe("earlier");
    expect(only("spawned", {}, null).incarnation).toBe("unknown");
  });

  it("a kind this plugin does not know keeps its row, and a malformed fact drops by itself", () => {
    expect(only("retire-warning", { message: "a hook warned", reason: "x" })).toMatchObject({ kind: "retire-warning", facts: [{ key: "reason", value: "x" }] });
    expect(only("spawned", { agent: 7, work: "directory", launched: "yes", worktreeHooks: [{ capability: "oats.dev" }] })).toMatchObject({ facts: [{ key: "work", value: "directory" }], setup: null });
    expect(only("stopped", "not facts").facts).toEqual([]);
  });

  it("an answer that is not this events document is the plugin's own error", () => {
    const old = parsePanelEvents({ ...recorded(), eventsApi: 1 });
    expect(!old.ok && old.error.code).toBe("OATS_BAD_ANSWER");
    const cut = recorded();
    delete (cut as Record<string, unknown>).integrity;
    expect(parsePanelEvents(cut).ok).toBe(false);
  });
});
