// The home's board and its words: grouped from the roster the sidebar shows, counted by the one
// function for a state.
import { describe, expect, it } from "vitest";
import { board } from "../../app/home/board";
import { startedBy, summaryLine, tileCount } from "../../app/home/home-words";
import { attachCommand } from "../../app/panel/words";
import type { Agent, BbThread, Node } from "../../model/types";
import { view } from "../../model/view";

const NOW = Date.parse("2026-11-21T18:30:00.000Z");
const agent = (instance: string, change: Partial<Agent> = {}): Agent => ({
  instance, soul: "oats-expert", home: `/abs/${instance}`, parent: null, human: null, alias: null, team: null, address: null, backend: "bb", server: null, projectId: "proj",
  threadId: `thr_${instance}`, running: null, runtimeState: "unknown", runtimeError: null, waiting: null, ...change,
});
const thread = (id: string, change: Partial<BbThread> = {}): BbThread => ({ id, projectId: "proj", displayTitle: id, updatedAt: 0, isUnread: false, isArchived: false, isHidden: false, hasPendingInteraction: false, ...change });

const agents = [
  agent("lead", { running: true }),
  agent("asks-early", { parent: "lead", waiting: { reason: "attention", message: "first", since: "2026-11-21T18:00:00.000Z" } }),
  agent("asks-late", { waiting: { reason: "question", message: "second", since: "2026-11-21T18:20:00.000Z" } }),
  agent("idle-unread"),
  agent("stopped", { running: false, runtimeState: "stopped" }),
  agent("failed", { running: false, runtimeState: "shell" }),
  agent("gone-thread", { threadId: "thr_nowhere", running: false, runtimeState: "stopped" }),
  agent("on-tmux", { backend: "tmux", threadId: null, running: true, runtimeState: "running", human: "Ana" }),
];
const threads = ["lead", "asks-early", "asks-late", "idle-unread", "stopped", "failed"].map((name) => thread(`thr_${name}`, name === "idle-unread" ? { isUnread: true } : {}));

describe("the home's board", () => {
  const made = board(view(agents, threads), NOW);
  const names = (entries: { agent: Agent }[]) => entries.map((entry) => entry.agent.instance);

  it("holds every agent OATS has, in the sidebar's order: the tree, then the agents whose thread is gone, then the ones on tmux", () => {
    expect(names(made.all).sort()).toEqual(agents.map((each) => each.instance).sort());
    expect(names(made.all).slice(-2)).toEqual(["gone-thread", "on-tmux"]);
    // a child follows its parent, as in the tree
    expect(names(made.all).indexOf("asks-early")).toBe(names(made.all).indexOf("lead") + 1);
    expect(made.all.find((entry) => entry.agent.instance === "on-tmux")?.thread).toBeNull();
  });

  it("counts each agent once, by the state every place says for it", () => {
    expect(made.counts).toEqual({ "needs-you": 2, working: 2, idle: 1, stopped: 2, error: 1, unreachable: 0 });
    expect(Object.values(made.counts).reduce((sum, n) => sum + n, 0)).toBe(agents.length);
  });

  it("lists what needs the person newest claim first, what works in the sidebar's order, and what is finished and not looked at", () => {
    expect(names(made.needsYou)).toEqual(["asks-late", "asks-early"]);
    expect(names(made.working)).toEqual(["lead", "on-tmux"]);
    expect(names(made.finished)).toEqual(["idle-unread"]);
  });

  it("an agent that needs the person for a question bb shows has no instant: it comes after the ones that have", () => {
    const asks = [agent("claims", { waiting: { reason: "attention", message: null, since: "2026-11-21T18:00:00.000Z" } }), agent("bb-asks")];
    const both = board(view(asks, [thread("thr_claims"), thread("thr_bb-asks", { hasPendingInteraction: true })]), NOW);
    expect(names(both.needsYou)).toEqual(["claims", "bb-asks"]);
  });
});

describe("the order of what needs the person", () => {
  it("a claim an agent OATS stopped still carries orders nothing: it needs the person through bb's own question, with no instant", () => {
    const asks = [
      agent("stopped-asks", { running: false, runtimeState: "stopped", waiting: { reason: "permission", message: "dead", since: "2026-11-21T18:29:00.000Z" } }),
      agent("claims", { waiting: { reason: "attention", message: null, since: "2026-11-21T18:00:00.000Z" } }),
    ];
    const made = board(view(asks, [thread("thr_stopped-asks", { hasPendingInteraction: true }), thread("thr_claims")]), NOW);
    // by the dead claim's instant the stopped one would be first; with none it follows the one that has one
    expect(made.needsYou.map((entry) => entry.agent.instance)).toEqual(["claims", "stopped-asks"]);
  });
});

describe("the home's words", () => {
  it("the summary: every agent once, the plugin's state words, a state with no agent left out but for working and needs you", () => {
    expect(summaryLine({ "needs-you": 1, working: 2, idle: 3, stopped: 1, error: 1, unreachable: 0 })).toBe("8 agents · 2 working · 1 need you · 3 idle · 1 stopped · 1 failed");
    expect(summaryLine({ "needs-you": 3, working: 0, idle: 0, stopped: 0, error: 0, unreachable: 2 })).toBe("5 agents · 0 working · 3 need you · 2 unreachable");
    expect(summaryLine({ "needs-you": 0, working: 1, idle: 0, stopped: 0, error: 0, unreachable: 0 })).toBe("1 agent · 1 working · 0 need you");
  });
  it("a tile's count, and who started an agent", () => {
    expect([tileCount(4), tileCount("loading"), tileCount("failed")]).toEqual(["4", "Counting…", "Couldn't count"]);
    expect(startedBy({ human: "Ana", parent: "redesign-ui-lead" })).toBe("started by Ana");
    expect(startedBy({ human: null, parent: "redesign-ui-lead" })).toBe("started by Redesign ui lead");
    expect(startedBy({ human: null, parent: null })).toBeNull();
  });
  it("the command into a tmux agent's session names its home as one word of a shell", () => {
    expect(attachCommand("/abs/deployment/agents/oats-developer/instances/kernel-fix-developer")).toBe("oats session attach --home /abs/deployment/agents/oats-developer/instances/kernel-fix-developer");
    expect(attachCommand("/home/ana maria/it's/agents/x")).toBe(`oats session attach --home '/home/ana maria/it'\\''s/agents/x'`);
  });
});
