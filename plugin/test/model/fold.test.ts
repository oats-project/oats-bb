// The fold of the roster's tree (model/view.ts `treeRows`, `insideOf`, `ancestorsOf`): Joan's word
// of 24 Nov 2026, "children collapsed by default". Pure: the rows drawn for a tree and the set of
// parents a person opened; the mark a closed parent carries; the parents of the row on screen.
import { describe, expect, test } from "vitest";
import type { AgentState } from "../../model/types";
import { ancestorsOf, insideOf, treeRows, view } from "../../model/view";
import type { Agent, BbThread } from "../../model/types";

type Row = { agent: { instance: string }; state: AgentState; children: Row[] };
const row = (instance: string, state: AgentState, children: Row[] = []): Row => ({ agent: { instance }, state, children });

// lead ─┬─ dev ─── reviewer
//       └─ helper
// solo
// boss ─── aide
const tree = (states: Partial<Record<string, AgentState>> = {}): Row[] => {
  const of = (instance: string): AgentState => states[instance] ?? "working";
  return [
    row("lead", of("lead"), [row("dev", of("dev"), [row("reviewer", of("reviewer"))]), row("helper", of("helper"))]),
    row("solo", of("solo")),
    row("boss", of("boss"), [row("aide", of("aide"))]),
  ];
};
/** What is drawn, top to bottom: "name" for a leaf, "name+" a closed parent, "name-" an open one, after "!" the mark a closed parent carries, and "~warning" where that mark is in the warning tone. */
const drawn = (roots: Row[], opened: string[] = [], selected: string | null = null, warns?: string[]): string[] =>
  treeRows(roots, new Set(opened), selected, warns === undefined ? undefined : (node) => warns.includes(node.agent.instance)).map(({ node, parent, open, inside, insideTone }) => `${node.agent.instance}${parent ? (open ? "-" : "+") : ""}${inside === null ? "" : `!${inside}`}${insideTone === null ? "" : "~warning"}`);

describe("the rows drawn for a tree and the parents a person opened", () => {
  test.each<[string, string[], string | null, string[]]>([
    ["on load every parent is closed: the roots alone", [], null, ["lead+", "solo", "boss+"]],
    ["one press opens one level: its children, each parent among them closed", ["lead"], null, ["lead-", "dev+", "helper", "solo", "boss+"]],
    ["a parent opened inside an opened parent", ["lead", "dev"], null, ["lead-", "dev-", "reviewer", "helper", "solo", "boss+"]],
    ["a parent opened under a closed one stays out of sight with it, and is open again when its parent opens", ["dev"], null, ["lead+", "solo", "boss+"]],
    ["another root's parent, alone", ["boss"], null, ["lead+", "solo", "boss-", "aide"]],
    ["a name that is no parent, or no row at all, opens nothing", ["solo", "reviewer", "nobody"], null, ["lead+", "solo", "boss+"]],
    ["the row on screen is a grandchild: every parent above it is open, and no other", [], "reviewer", ["lead-", "dev-", "reviewer", "helper", "solo", "boss+"]],
    ["the row on screen is a child: its parent is open, its own children stay closed", [], "dev", ["lead-", "dev+", "helper", "solo", "boss+"]],
    ["the row on screen is a root, or a parent: nothing opens for it", [], "lead", ["lead+", "solo", "boss+"]],
    ["the row on screen is in no tree: nothing opens for it", [], "nobody", ["lead+", "solo", "boss+"]],
    ["what the person opened and the row on screen add up", ["boss"], "helper", ["lead-", "dev+", "helper", "solo", "boss-", "aide"]],
  ])("%s", (_name, opened, selected, rows) => {
    expect(drawn(tree(), opened, selected)).toEqual(rows);
  });

  test("a parent is never closed over the row on screen: with nothing opened by the person it stays open, and says that it cannot be closed now (pinned)", () => {
    // The person's set holds no "lead": they closed it, or never opened it. The row on screen is under it.
    expect(drawn(tree(), [], "helper")).toContain("lead-");
    const pinned = (opened: string[], selected: string | null) => treeRows(tree(), new Set(opened), selected).filter((each) => each.pinned).map((each) => each.node.agent.instance);
    expect(pinned([], "reviewer")).toEqual(["lead", "dev"]); // every parent above it
    expect(pinned(["lead", "boss"], "helper")).toEqual(["lead"]); // pinned whether or not the person opened it; one opened elsewhere is not
    expect(pinned(["lead"], "lead")).toEqual([]); // the row on screen is the parent itself: it can be closed
    expect(pinned(["lead"], null)).toEqual([]);
    // Once the row on screen is another, the parent is as the person left it: closed.
    expect(drawn(tree(), [], "solo")).toContain("lead+");
  });

  test("the order is the tree's own, untouched; and the tree is not changed", () => {
    const roots = tree();
    const before = JSON.stringify(roots);
    expect(treeRows(roots, new Set(["lead", "dev", "boss"])).map((each) => each.node.agent.instance)).toEqual(["lead", "dev", "reviewer", "helper", "solo", "boss", "aide"]);
    expect(JSON.stringify(roots)).toBe(before);
  });
});

describe("the mark of a closed parent: the most urgent row its subtree hides, after its own state", () => {
  test.each<[string, Partial<Record<string, AgentState>>, string[], string[]]>([
    ["every hidden row is quiet (working, idle, stopped): no mark", { dev: "idle", reviewer: "stopped" }, [], ["lead+", "solo", "boss+"]],
    // (The lead's reader, P23: an UNREACHABLE row behind a fold is one a person must find: it is marked. Its rank in the roster's ORDER stays with working, idle and stopped.)
    ["a hidden row is unreachable: marked", { dev: "idle", reviewer: "stopped", helper: "unreachable" }, [], ["lead+!unreachable", "solo", "boss+"]],
    ["a row that needs a person, or one of rank 1, comes before an unreachable one", { dev: "unreachable", helper: "error" }, [], ["lead+!error", "solo", "boss+"]],
    ["a hidden child needs a person", { helper: "needs-you" }, [], ["lead+!needs-you", "solo", "boss+"]],
    ["a hidden GRANDchild needs a person: the root says so, and so does its closed parent once the root is open", { reviewer: "needs-you" }, [], ["lead+!needs-you", "solo", "boss+"]],
    ["(the same, the root open)", { reviewer: "needs-you" }, ["lead"], ["lead-", "dev+!needs-you", "helper", "solo", "boss+"]],
    ["a hidden row failed: a person must look", { aide: "error" }, [], ["lead+", "solo", "boss+!error"]],
    ["a hidden row runs outside OATS: a person must look", { dev: "outside" }, [], ["lead+!outside", "solo", "boss+"]],
    ["one that needs a person comes before one that must be looked at, wherever each stands", { dev: "error", reviewer: "outside", helper: "needs-you" }, [], ["lead+!needs-you", "solo", "boss+"]],
    ["among equals the first in the tree's order", { dev: "outside", helper: "error" }, [], ["lead+!outside", "solo", "boss+"]],
    ["the parent's OWN state is never the mark: a parent that needs a person over quiet children carries none", { lead: "needs-you", boss: "error" }, [], ["lead+", "solo", "boss+"]],
    ["an OPEN parent carries no mark: the row itself is in sight", { helper: "needs-you" }, ["lead"], ["lead-", "dev+", "helper", "solo", "boss+"]],
    ["a leaf carries none", { solo: "needs-you" }, [], ["lead+", "solo", "boss+"]],
  ])("%s", (_name, states, opened, rows) => {
    expect(drawn(tree(states), opened)).toEqual(rows);
  });

  test("insideOf, alone: nothing for a leaf and for quiet children; a rank 0 or 1 state otherwise", () => {
    expect(insideOf(row("a", "needs-you"))).toEqual({ state: null, tone: null, node: null });
    expect(insideOf(row("a", "working", [row("b", "idle"), row("c", "stopped")]))).toEqual({ state: null, tone: null, node: null });
    const failed = row("c", "error");
    // (With the state: the row it is the state of, so that the caller can name the chevron with that row's own words.)
    expect(insideOf(row("a", "working", [row("b", "idle", [failed])]))).toEqual({ state: "error", tone: null, node: failed });
  });

  // ONE principle: a closed parent carries a mark for any row inside it that itself carries one. A row whose own mark
  // is in the warning tone (the outside feature's: archived in bb while it ran) is one, though its state is quiet:
  // the caller says which rows warn (the model cannot tell), and a warning ranks with "must be looked at".
  test.each<[string, Partial<Record<string, AgentState>>, string[], string[], string[]]>([
    ["a hidden row that warns, its state quiet: its own state, in the warning tone", { helper: "stopped" }, ["helper"], [], ["lead+!stopped~warning", "solo", "boss+"]],
    ["a hidden GRANDchild that warns", { reviewer: "idle" }, ["reviewer"], [], ["lead+!idle~warning", "solo", "boss+"]],
    ["one that warns and one that waits: needs-you wins, in its own tone", { dev: "stopped", helper: "needs-you" }, ["dev"], [], ["lead+!needs-you", "solo", "boss+"]],
    ["one that warns before one that failed: of one rank, the first in the tree's order, with its own tone", { dev: "stopped", helper: "error" }, ["dev"], [], ["lead+!stopped~warning", "solo", "boss+"]],
    ["one that failed before one that warns: the failed one, plain", { dev: "error", helper: "stopped" }, ["helper"], [], ["lead+!error", "solo", "boss+"]],
    ["a row that carries no mark of its own (stopped, plainly archived: it does not warn) marks nothing", { helper: "stopped", aide: "stopped" }, [], [], ["lead+", "solo", "boss+"]],
    ["the parent's own warning is its own mark, never the one it carries", { lead: "stopped" }, ["lead"], [], ["lead+", "solo", "boss+"]],
    ["open: none", { helper: "stopped" }, ["helper"], ["lead"], ["lead-", "dev+", "helper", "solo", "boss+"]],
  ])("a row that warns: %s", (_name, states, warns, opened, rows) => {
    expect(drawn(tree(states), opened, null, warns)).toEqual(rows);
  });
});

describe("the parents of the row on screen", () => {
  test.each<[string, string[]]>([
    ["reviewer", ["dev", "lead"]],
    ["dev", ["lead"]],
    ["helper", ["lead"]],
    ["aide", ["boss"]],
    ["lead", []],
    ["solo", []],
    ["nobody", []],
  ])("above %s: %j", (instance, above) => {
    expect([...ancestorsOf(tree(), instance)].sort()).toEqual(above);
  });
});

test("over the view's own tree: a lead with a waiting child is closed on load, carries the child's mark, and keeps its own state", () => {
  const agent = (instance: string, over: Partial<Agent> = {}): Agent => ({ instance, soul: "soul-x", home: `/d/${instance}`, parent: null, human: "joan", alias: instance, team: "t", address: null, backend: "bb", server: "http://127.0.0.1:1", projectId: `p_${instance}`, threadId: `thr_${instance}`, running: true, runtimeState: "unknown", runtimeError: null, waiting: null, ...over });
  const thread = (id: string, status = "idle"): BbThread => ({ id, projectId: null, displayTitle: id, updatedAt: 1, status, queuedWork: "none", isUnread: false, isArchived: false, isHidden: false, hasPendingInteraction: false });
  const agents = [agent("quiet"), agent("lead"), agent("child", { parent: "lead", waiting: { reason: "attention", message: "?", since: "2026-11-19T12:00:00.000Z" } })];
  const { roots } = view(agents, [thread("thr_quiet"), thread("thr_lead", "active"), thread("thr_child")]);
  expect(treeRows(roots, new Set()).map(({ node, parent, open, inside }) => [node.agent.instance, node.state, parent, open, inside])).toEqual([
    ["lead", "working", true, false, "needs-you"], // first: its subtree's most urgent state brings it up (the one order)
    ["quiet", "idle", false, false, null],
  ]);
  expect(treeRows(roots, new Set(["lead"])).map(({ node, inside }) => [node.agent.instance, node.depth, inside])).toEqual([["lead", 0, null], ["child", 1, null], ["quiet", 0, null]]);
});
