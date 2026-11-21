// The whole `oats status --json` answers of a real kernel with the bb session provider
// (test/fixtures/status-recorded.json, one document per state; container/real/README.md says how
// they were recorded), read by the plugin's own parser and joined by the model: what the tree
// draws for an agent that is working, idle, waiting for a person (its own claim, and the one
// oats.core's hooks set for a question Claude Code asks), stopped by OATS, and whose thread was
// deleted in bb, and for a parent with two children.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseStatus } from "../../kernel/roster";
import type { Agent, BbThread } from "../../model/types";
import { view } from "../../model/view";
import { FIXTURES } from "../support/fake-oats.js";

type Recorded = Record<"working" | "idle" | "needsYou" | "question" | "stoppedByOats" | "threadDeleted" | "parentWithTwoChildren", unknown>;
const recorded = JSON.parse(readFileSync(join(FIXTURES, "roster/status-recorded.json"), "utf8")) as Recorded;

function agentsOf(state: keyof Recorded): Agent[] {
  const status = parseStatus(recorded[state]);
  if (!status.ok) throw new Error(`${state}: ${status.error.code}: ${status.error.message}`);
  return status.value.agents;
}
/** bb's thread of an agent, as the sidebar gives it: live, read, with nothing pending. */
const threadOf = (agent: Agent): BbThread => ({
  id: agent.threadId!,
  projectId: null,
  displayTitle: agent.instance,
  updatedAt: 1,
  isUnread: false,
  isArchived: false,
  isHidden: false,
  hasPendingInteraction: false,
});

const home = "/abs/deployment/agents/oats-developer/instances/flaky-ci-2-developer";
/** What every state's row of the one agent has in common: a soul with no messaging capability. */
const one = {
  instance: "flaky-ci-2-developer",
  soul: "oats-developer",
  home,
  parent: null,
  human: null,
  alias: null,
  team: null,
  address: null,
  backend: "bb",
  server: null,
  projectId: null,
  runtimeError: null,
};

describe("a real kernel's status, read by the parser", () => {
  it("names the workspace, and the agents root as its root", () => {
    const status = parseStatus(recorded.working);
    expect(status.ok && status.value.root).toBe("/abs/deployment/agents");
    expect(status.ok && status.value.workspace).toBe("local//abs/real/src/oats-real");
  });

  it("working: running true, state unknown, on its bb thread", () => {
    expect(agentsOf("working")).toEqual([{ ...one, threadId: "thr_ad488edeab", running: true, runtimeState: "unknown", waiting: null }]);
  });

  it("idle: running null, state unknown, the same thread", () => {
    expect(agentsOf("idle")).toEqual([{ ...one, threadId: "thr_ad488edeab", running: null, runtimeState: "unknown", waiting: null }]);
  });

  it("waiting for a person: the claim of `oats instance attention`, with the agent's message", () => {
    expect(agentsOf("needsYou")).toEqual([
      {
        ...one,
        threadId: "thr_ad488edeab",
        running: null,
        runtimeState: "unknown",
        waiting: { reason: "attention", message: "Keep the retry, or fail the job?", since: "2026-11-21T15:45:46.677Z" },
      },
    ]);
  });

  it("a question Claude Code asks: oats.core's claim, with the question's text, while the turn is open", () => {
    expect(agentsOf("question")).toEqual([
      {
        ...one,
        threadId: "thr_ad488edeab",
        running: true,
        runtimeState: "unknown",
        waiting: { reason: "question", message: "Retry the flaky job once more, or mark it as failed?", since: "2026-11-21T15:46:10.438Z" },
      },
    ]);
  });

  it("stopped by OATS: running false, state stopped, the thread kept", () => {
    expect(agentsOf("stoppedByOats")).toEqual([{ ...one, threadId: "thr_ad488edeab", running: false, runtimeState: "stopped", waiting: null }]);
  });

  it("its thread deleted in bb: running false, state stopped, still naming the thread that is gone", () => {
    expect(agentsOf("threadDeleted")).toEqual([{ ...one, threadId: "thr_4m85rand5n", running: false, runtimeState: "stopped", waiting: null }]);
  });

  it("a parent with two children: each child names its parent, in the kernel's order", () => {
    expect(agentsOf("parentWithTwoChildren").map((agent) => [agent.instance, agent.soul, agent.parent, agent.running, agent.threadId])).toEqual([
      ["harvest-knowledge-helper", "knowledge-harvester", "redesign-ui-lead", null, "thr_2tmxyug2qs"],
      ["desktop-mockups-developer", "oats-desktop-developer", "redesign-ui-lead", true, "thr_z3u3qec7bs"],
      ["redesign-ui-lead", "oats-product-expert", null, true, "thr_py96mk7bwc"],
    ]);
  });
});

describe("a real kernel's status, joined to bb's threads by the model", () => {
  const drawn = (state: keyof Recorded) => {
    const agents = agentsOf(state);
    return view(agents, agents.map(threadOf));
  };

  it.each([
    ["working", "working"],
    ["idle", "idle"],
    ["needsYou", "needs-you"],
    // A turn that is open on a question is drawn as needing the person, not as working.
    ["question", "needs-you"],
    ["stoppedByOats", "stopped"],
  ] as const)("%s is drawn in the tree as %s", (recordedState, drawnState) => {
    const result = drawn(recordedState);
    expect(result.roots.map((node) => [node.agent.instance, node.thread.id, node.state])).toEqual([["flaky-ci-2-developer", "thr_ad488edeab", drawnState]]);
    expect(result.detached).toEqual([]);
    expect(result.elsewhere).toEqual([]);
  });

  it("an agent whose thread was deleted in bb leaves the tree and is detached (\"thread missing\")", () => {
    const agents = agentsOf("threadDeleted");
    // bb no longer lists the thread the row names; another thread of bb's is not taken for it.
    const result = view(agents, [{ ...threadOf(agents[0]!), id: "thr_another" }]);
    expect(result.roots).toEqual([]);
    expect(result.detached.map((agent) => agent.instance)).toEqual(["flaky-ci-2-developer"]);
    expect(result.others.map((thread) => thread.id)).toEqual(["thr_another"]);
  });

  it("the two children are drawn under their parent, the working one first", () => {
    const result = drawn("parentWithTwoChildren");
    expect(result.roots.map((node) => [node.agent.instance, node.state, node.depth])).toEqual([["redesign-ui-lead", "working", 0]]);
    expect(result.roots[0]!.children.map((node) => [node.agent.instance, node.state, node.depth])).toEqual([
      ["desktop-mockups-developer", "working", 1],
      ["harvest-knowledge-helper", "idle", 1],
    ]);
    expect(result.working.map((node) => node.agent.instance).sort()).toEqual(["desktop-mockups-developer", "redesign-ui-lead"]);
  });
});
