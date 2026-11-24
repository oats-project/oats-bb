// The roster's ONE tree (model/view.ts `view().rows`): every agent is a row, whatever its backend,
// under its parent where the parent is a row and a root otherwise. Before, an agent with no bb
// thread (on tmux; or its thread not listed) was always a flat root, so a fold of the tree folded
// nothing on a roster of tmux agents. The rules are the tree's own, for all: a parent that is no
// row makes a root; a cycle is cut at one link; deeper than 2 is drawn at 2; every level is in
// the one order (test/model/order.test.ts), by the most urgent state of each row's SUBTREE
// (`urgent`: what a folded parent is marked with).
import { describe, expect, test } from "vitest";
import type { Agent, BbThread, Row } from "../../model/types";
import { board } from "../../app/home/board";
import { flatten, treeRows, view } from "../../model/view";

const agent = (instance: string, over: Partial<Agent> = {}): Agent => ({
  instance,
  soul: "soul-x",
  home: `/d/agents/soul-x/instances/${instance}`,
  parent: null,
  human: "joan",
  alias: instance,
  team: "default:oats.aweb.ai",
  address: null,
  backend: "bb",
  server: "http://127.0.0.1:38886",
  projectId: `proj_${instance}`,
  threadId: `thr_${instance}`,
  running: true,
  runtimeState: "unknown",
  runtimeError: null,
  waiting: null,
  ...over,
});
const thread = (id: string, over: Partial<BbThread> = {}): BbThread => ({ id, projectId: null, displayTitle: id, updatedAt: 1_000, status: "idle", queuedWork: "none", isUnread: false, isArchived: false, isHidden: false, hasPendingInteraction: false, ...over }) as BbThread;
const WAITS = { waiting: { reason: "attention", message: "Which branch?", since: "2026-11-19T12:00:00.000Z" } } as const;
/** An agent on tmux that runs. */
const tmux = (instance: string, over: Partial<Agent> = {}): Agent => agent(instance, { backend: "tmux", server: null, projectId: null, threadId: null, runtimeState: null, ...over });
/** An agent on tmux whose session was lost (the kernel's recorded row: not running, no word, `sessionEnd: "lost"`). */
const lost = (instance: string, over: Partial<Agent> = {}): Agent => tmux(instance, { running: false, sessionEnd: "lost", ...over });
const threadsOf = (agents: readonly Agent[]): BbThread[] => agents.filter((each) => each.backend !== "tmux" && each.threadId !== null).map((each) => thread(each.threadId as string));

/** The tree as it is drawn, in words: `name` for a row whose subtree is no more urgent than itself, `name!state` where it is, and its children in brackets, in order. */
const drawn = (rows: readonly Row[]): string => rows.map((row) => `${row.agent.instance}${row.urgent === row.state ? "" : `!${row.urgent}`}${row.children.length > 0 ? `[${drawn(row.children)}]` : ""}`).join(" ");
const rowOf = (rows: readonly Row[], instance: string): Row => {
  const row = flatten(rows).find((each) => each.agent.instance === instance);
  if (row === undefined) throw new Error(`no row of ${instance}`);
  return row;
};

describe("the pilot's own roster shape: eight agents on tmux, every session lost, one a child of another", () => {
  // (Made-up names: the shape alone is the pilot's: eight tmux rows, one parent link.)
  const eight = (child: Partial<Agent> = {}): Agent[] => [
    lost("alder-lead"),
    lost("birch-developer"),
    lost("cedar-developer"),
    lost("dogwood-maintainer"),
    lost("elm-reviewer", { parent: "cedar-developer", ...child }),
    lost("fir-helper"),
    lost("gorse-probe"),
    lost("hazel-developer"),
  ];

  test("seven roots in the kernel's order, and the child under its parent: one parent that a fold can close", () => {
    const { rows } = view(eight(), []);
    expect(drawn(rows)).toBe("alder-lead birch-developer cedar-developer[elm-reviewer] dogwood-maintainer fir-helper gorse-probe hazel-developer");
    expect(rows).toHaveLength(7);
    expect(rows.filter((row) => row.children.length > 0).map((row) => row.agent.instance)).toEqual(["cedar-developer"]);
    const child = rowOf(rows, "elm-reviewer");
    expect({ depth: child.depth, where: child.where, thread: child.thread, state: child.state }).toEqual({ depth: 1, where: "tmux", thread: null, state: "stopped" });
    expect(flatten(rows)).toHaveLength(8); // every agent is a row, once
  });

  test("the child waits on a person: its parent carries that (`urgent`) and stands first, itself still stopped", () => {
    const { rows, needing } = view(eight({ running: true, sessionEnd: null, ...WAITS }), []);
    expect(drawn(rows)).toBe("cedar-developer!needs-you[elm-reviewer] alder-lead birch-developer dogwood-maintainer fir-helper gorse-probe hazel-developer");
    const parent = rowOf(rows, "cedar-developer");
    expect({ state: parent.state, urgent: parent.urgent }).toEqual({ state: "stopped", urgent: "needs-you" });
    expect(rowOf(rows, "elm-reviewer").state).toBe("needs-you");
    expect(needing.map((each) => each.instance)).toEqual(["elm-reviewer"]); // who needs a person is counted as before
  });
});

describe("one tree, whatever the backend of a parent or of its child", () => {
  test("an agent on a bb thread with a child on tmux: the child is under it", () => {
    const agents = [agent("lead"), tmux("helper", { parent: "lead" }), agent("other")];
    const { rows, roots, elsewhere } = view(agents, threadsOf(agents));
    expect(drawn(rows)).toBe("lead[helper] other");
    expect(rowOf(rows, "lead").where).toBe("thread");
    expect(rowOf(rows, "helper")).toMatchObject({ where: "tmux", thread: null, depth: 1 });
    // Those who read threads are told what they were: the tree of the agents on a bb thread, and who is on tmux.
    expect(roots.map((node) => node.agent.instance)).toEqual(["lead", "other"]);
    expect(roots.every((node) => node.children.length === 0)).toBe(true);
    expect(elsewhere.map((each) => each.instance)).toEqual(["helper"]);
  });

  test("an agent on tmux with a child on a bb thread: the child is under it, on its thread", () => {
    const agents = [tmux("lead"), agent("helper", { parent: "lead" })];
    const { rows, roots } = view(agents, threadsOf(agents));
    expect(drawn(rows)).toBe("lead[helper]");
    expect(rowOf(rows, "helper")).toMatchObject({ where: "thread", depth: 1 });
    expect(rowOf(rows, "helper").thread?.id).toBe("thr_helper");
    expect(roots.map((node) => node.agent.instance)).toEqual(["helper"]); // among the threads it has no parent that is drawn
  });

  test("an agent whose thread bb does not list (archived) is a row under its parent too, and a parent like any other", () => {
    const agents = [agent("lead"), agent("archived", { parent: "lead" }), tmux("under-archived", { parent: "archived" })];
    const { rows, detached } = view(agents, [thread("thr_lead"), thread("thr_archived", { isArchived: true })]);
    expect(drawn(rows)).toBe("lead[archived[under-archived]]");
    expect(rowOf(rows, "archived")).toMatchObject({ where: "detached", thread: null, depth: 1 });
    expect(rowOf(rows, "under-archived").depth).toBe(2);
    expect(detached.map((each) => each.instance)).toEqual(["archived"]);
  });

  test("a child whose parent is no row (OATS lists no such agent) is a root", () => {
    const { rows } = view([tmux("orphan", { parent: "gone-lead" }), tmux("own", { parent: "own" }), tmux("plain")], []);
    expect(drawn(rows)).toBe("orphan own plain"); // (one that names itself as its parent is a root too)
  });

  test("a cycle is cut at one link: every agent is drawn once", () => {
    const agents = [tmux("a", { parent: "c" }), tmux("b", { parent: "a" }), agent("c", { parent: "b" })];
    const { rows } = view(agents, threadsOf(agents));
    expect(flatten(rows).map((row) => row.agent.instance).sort()).toEqual(["a", "b", "c"]);
    expect(rows).toHaveLength(1);
    expect(drawn(rows)).toBe("b[c[a]]"); // walking up from the kernel's first (a, c, b), the link that would return to it (b's, to a) is the one dropped: the rule the threads' tree has
  });

  test("deeper than 2 is drawn at 2, on tmux as on a thread", () => {
    const agents = [tmux("d0"), tmux("d1", { parent: "d0" }), agent("d2", { parent: "d1" }), tmux("d3", { parent: "d2" }), tmux("d4", { parent: "d3" })];
    const { rows } = view(agents, threadsOf(agents));
    expect(drawn(rows)).toBe("d0[d1[d2[d3[d4]]]]");
    expect(flatten(rows).map((row) => row.depth)).toEqual([0, 1, 2, 2, 2]);
  });

  test("a second row of one name (the kernel should list none) is a root of its own; children go under the first", () => {
    const agents = [tmux("twin"), tmux("twin", { running: false, sessionEnd: "lost" }), tmux("child", { parent: "twin" })];
    const { rows } = view(agents, []);
    expect(flatten(rows)).toHaveLength(3);
    expect(rows.map((row) => [row.agent.instance, row.state, row.children.length])).toEqual([
      ["twin", "working", 1], // of one rank, in the kernel's order: the first, which holds the child
      ["twin", "stopped", 0], // then the second, alone
    ]);
  });
});

describe("a name the kernel listed twice, and the row on screen", () => {
  test("the page of that name holds open the parent of the row that HAS one, though its other row, a root, stands before it", () => {
    const agents = [tmux("kid", { parent: "lead" }), tmux("kid"), tmux("lead")];
    const { rows } = view(agents, []);
    expect(drawn(rows)).toBe("kid lead[kid]"); // the second row is a root; the first is under its parent
    const shown = treeRows(rows, new Set(), "kid");
    expect(shown.map((row) => [row.node.agent.instance, row.parent, row.open])).toEqual([
      ["kid", false, false],
      ["lead", true, true],
      ["kid", false, false],
    ]);
  });
});

describe("the one order, over the one tree", () => {
  test("every level: the most urgent subtree first, then the kernel's order; a grandchild's state rises through both parents", () => {
    const agents = [
      tmux("quiet-root"),
      agent("bb-root"),
      tmux("deep-root"),
      tmux("mid", { parent: "deep-root" }),
      tmux("calm-sibling", { parent: "deep-root" }),
      tmux("leaf", { parent: "mid", ...WAITS }),
      tmux("failed-root", { running: false, sessionEnd: "exited", runtimeState: "shell" }),
    ];
    const { rows } = view(agents, threadsOf(agents));
    expect(drawn(rows)).toBe("deep-root!needs-you[mid!needs-you[leaf] calm-sibling] failed-root quiet-root bb-root");
    expect(rowOf(rows, "failed-root").state).toBe("error");
  });

  test("a parent more urgent than everything under it keeps its own state as `urgent`", () => {
    const agents = [tmux("lead", WAITS), tmux("failed-child", { parent: "lead", running: false, sessionEnd: "exited", runtimeState: "shell" })];
    const { rows } = view(agents, []);
    expect(drawn(rows)).toBe("lead[failed-child]");
    expect(rowOf(rows, "lead").urgent).toBe("needs-you");
  });

  test("two children of one rank: the parent carries the first in the order", () => {
    const agents = [tmux("lead"), agent("outside-child", { parent: "lead", running: false, runtimeState: "stopped", sessionEnd: "stopped", outsideOats: { code: "running-outside-oats", backend: "bb", message: "a harness runs in outside-child on bb" } }), tmux("failed-child", { parent: "lead", running: false, sessionEnd: "exited", runtimeState: "shell" })];
    const { rows } = view(agents, threadsOf(agents));
    expect(drawn(rows)).toBe("lead!outside[outside-child failed-child]");
  });
});

describe("the home's list of every agent is the tree with every row shown", () => {
  test("an agent with no bb thread comes right after its parent's rows, where the sidebar draws it (before the one tree: at its own place among the roots)", () => {
    const agents = [tmux("early-tmux-child", { parent: "lead" }), agent("first"), agent("lead"), agent("lead-child", { parent: "lead" }), tmux("under-tmux", { parent: "early-tmux-child" }), agent("last")];
    const drawnNow = view(agents, threadsOf(agents));
    expect(drawn(drawnNow.rows)).toBe("first lead[early-tmux-child[under-tmux] lead-child] last");
    expect(board(drawnNow, Date.parse("2026-11-24T12:00:00.000Z")).all.map((entry) => [entry.agent.instance, entry.thread === null])).toEqual([
      ["first", false],
      ["lead", false],
      ["early-tmux-child", true],
      ["under-tmux", true],
      ["lead-child", false],
      ["last", false],
    ]);
  });
});
