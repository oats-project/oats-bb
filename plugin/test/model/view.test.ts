import { describe, expect, test } from "vitest";
import type { Agent, BbThread, Node } from "../../model/types";
import { claimOf, flatten, state, view } from "../../model/view";
import { fixtureAgents, fixtureThreads } from "../helpers/fixtures";

let clock = 1_000;
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
  running: null,
  runtimeState: "unknown",
  runtimeError: null,
  waiting: null,
  ...over,
});
const thread = (id: string, over: Partial<BbThread> = {}): BbThread => ({
  id,
  projectId: null,
  displayTitle: id,
  updatedAt: clock--, // earlier calls are newer, so the default order is the order written
  status: "idle", // bb's own status of the thread, and whether it holds a turn in line: what says whether its agent works
  queuedWork: "none",
  isUnread: false,
  isArchived: false,
  isHidden: false,
  hasPendingInteraction: false,
  ...over,
});
const threadsFor = (agents: Agent[]) => agents.map((a) => thread(a.threadId!));
const names = (nodes: Node[]) => nodes.map((node) => node.agent.instance);
const shape = (nodes: Node[]): unknown =>
  nodes.map((node) => (node.children.length ? { [node.agent.instance]: shape(node.children) } : node.agent.instance));
const claim = { reason: "question", message: "ok?", since: null };

describe("A1 view(): the tree", () => {
  test("each child is under its parent, with its depth", () => {
    const agents = [agent("lead"), agent("dev", { parent: "lead" }), agent("helper", { parent: "lead" })];
    const v = view(agents, threadsFor(agents));
    expect(shape(v.roots)).toEqual([{ lead: ["dev", "helper"] }]);
    expect(v.roots[0]!.depth).toBe(0);
    expect(v.roots[0]!.children.map((node) => node.depth)).toEqual([1, 1]);
  });

  test("the fixtures: two children under redesign-ui-lead, the other bb agents at the root", () => {
    const v = view(fixtureAgents(), fixtureThreads());
    const lead = v.roots.find((node) => node.agent.instance === "redesign-ui-lead")!;
    expect(names(lead.children).sort()).toEqual(["desktop-mockups-developer", "harvest-knowledge-helper"]);
    expect(names(v.roots).sort()).toEqual([
      "flaky-ci-developer",
      "ranker-v3-probe",
      "redesign-ui-lead",
      "release-070-maintainer",
      "weekly-digest-helper",
    ]);
  });

  test("an orphan, whose parent is not in the tree, is a root", () => {
    const agents = [
      agent("orphan", { parent: "gone" }),
      agent("on-tmux", { backend: "tmux", threadId: null }),
      agent("child-of-tmux", { parent: "on-tmux" }),
    ];
    const v = view(agents, [thread("thr_orphan"), thread("thr_child-of-tmux")]);
    expect(shape(v.roots)).toEqual(["orphan", "child-of-tmux"]);
  });

  test("a parent cycle is cut at the first repeat, and every agent is drawn once", () => {
    const agents = [agent("a", { parent: "b" }), agent("b", { parent: "c" }), agent("c", { parent: "a" })];
    const v = view(agents, threadsFor(agents));
    // walking up from a: a -> b -> c -> a (the repeat): c's link is the one cut
    expect(shape(v.roots)).toEqual([{ c: [{ b: ["a"] }] }]);
    expect(names(flatten(v.roots)).sort()).toEqual(["a", "b", "c"]);
  });

  test("an agent that names itself as its parent is a root", () => {
    const agents = [agent("self", { parent: "self" })];
    expect(shape(view(agents, threadsFor(agents)).roots)).toEqual(["self"]);
  });

  test("order at every level: needs-you, then working, then the rest, each newest first", () => {
    const agents = [
      agent("idle-old"),
      agent("idle-new"),
      agent("working-old", { running: true }),
      agent("working-new", { running: true }),
      agent("needs-old", { waiting: claim }),
      agent("needs-new", { waiting: claim }),
      agent("stopped-newest", { running: false, runtimeState: "stopped" }),
      agent("kid-idle", { parent: "idle-new" }),
      agent("kid-working", { parent: "idle-new", running: true }),
      agent("kid-needs", { parent: "idle-new", waiting: claim }),
    ];
    const at: Record<string, number> = {
      "idle-old": 10,
      "idle-new": 20,
      "working-old": 11,
      "working-new": 21,
      "needs-old": 12,
      "needs-new": 22,
      "stopped-newest": 99,
      "kid-idle": 90,
      "kid-working": 50,
      "kid-needs": 1,
    };
    const v = view(
      agents,
      // bb says which threads have a turn running: an agent works when its thread does, whatever the kernel's `running`.
      agents.map((a) => thread(a.threadId!, { updatedAt: at[a.instance]!, status: a.instance.includes("working") ? "active" : "idle" })),
    );
    expect(names(v.roots)).toEqual([
      "needs-new",
      "needs-old",
      "working-new",
      "working-old",
      "stopped-newest",
      "idle-new",
      "idle-old",
    ]);
    expect(names(v.roots.find((node) => node.agent.instance === "idle-new")!.children)).toEqual([
      "kid-needs",
      "kid-working",
      "kid-idle",
    ]);
  });

  test("depth is capped at 2: deeper nodes stay under their parent and are drawn at 2", () => {
    const agents = [
      agent("d0"),
      agent("d1", { parent: "d0" }),
      agent("d2", { parent: "d1" }),
      agent("d3", { parent: "d2" }),
      agent("d4", { parent: "d3" }),
    ];
    const v = view(agents, threadsFor(agents));
    expect(shape(v.roots)).toEqual([{ d0: [{ d1: [{ d2: [{ d3: ["d4"] }] }] }] }]);
    expect(flatten(v.roots).map((node) => node.depth)).toEqual([0, 1, 2, 2, 2]);
  });

  test("0 agents: an empty tree, every thread in others", () => {
    const v = view([], [thread("t1"), thread("t2")]);
    expect(v.roots).toEqual([]);
    expect(v.others.map((t) => t.id)).toEqual(["t1", "t2"]);
    expect([v.needsYou, v.working, v.finished, v.detached, v.elsewhere]).toEqual([[], [], [], [], []]);
  });

  test("200 agents in one chain that closes a cycle are joined in one pass", () => {
    const agents = Array.from({ length: 200 }, (_, i) =>
      agent(`n${i}`, { parent: i === 0 ? "n199" : `n${i - 1}` }),
    );
    const started = performance.now();
    const v = view(agents, threadsFor(agents));
    expect(performance.now() - started).toBeLessThan(500);
    expect(flatten(v.roots)).toHaveLength(200);
    expect(v.roots).toHaveLength(1);
  });
});

describe("A2 state(): first match wins", () => {
  const t = thread("t");
  test("one case per state, in order", () => {
    expect(state(agent("a", { waiting: claim }), t)).toBe("needs-you");
    expect(state(agent("a", { runtimeState: "unreachable", running: true }), t)).toBe("unreachable");
    expect(state(agent("a", { runtimeState: "stopped", running: true }), t)).toBe("stopped");
    expect(state(agent("a", { runtimeState: "shell", running: true }), t)).toBe("error");
    expect(state(agent("a", { running: true }), thread("t", { status: "active" }))).toBe("working");
    expect(state(agent("a", { running: null }), t)).toBe("idle");
    // A provider row the kernel calls not running beside the word "unknown": its session is there and no
    // harness is loaded. Not stopped (the spec's author, 2026-11-23): Stopped is said of a provider row
    // only when its word is "stopped" (test/outside/say.test.ts holds what the row then says).
    expect(state(agent("a", { running: false }), t)).toBe("idle");
  });
  // WORKING and IDLE of an agent on a bb thread are bb's own status of that thread. The kernel's
  // `running` is endpoint activity: a provider answers true for an idle agent whose harness is
  // loaded (docs/desktop-cli-api.md, "session-inspect-running"), so it does not say that the agent works.
  test("an agent on a bb thread works when bb says its thread does, whatever the kernel's running: every status of bb's, a turn in line, and a status bb adds later", () => {
    const on = (status: string, running: boolean | null, queuedWork = "none") => state(agent("a", { running }), thread("t", { status, queuedWork }));
    for (const running of [true, null]) {
      // A turn runs, is starting or is stopping.
      for (const status of ["active", "starting", "stopping"]) expect(on(status, running), `${status}, running ${running}`).toBe("working");
      // At rest: idle, or accepted and not started ("pending"), with nothing in line; bb's failed turn; a status of a later bb.
      for (const status of ["idle", "pending", "error", "hibernating", ""]) expect(on(status, running), `${status}, running ${running}`).toBe("idle");
      // At rest (idle, pending, bb's failed turn) with work bb will start by itself ("waiting"): the agent works.
      for (const status of ["idle", "pending", "error"]) expect(on(status, running, "waiting"), `${status} with a message waiting, running ${running}`).toBe("working");
      // A queued message that failed to send starts nothing: at rest (the provider's rule from oats-bb #40).
      for (const status of ["idle", "pending", "error"]) expect(on(status, running, "failed"), `${status} with a failed message, running ${running}`).toBe("idle");
      // A turn in progress works, whatever is in line behind it.
      for (const status of ["active", "starting", "stopping"]) for (const queuedWork of ["waiting", "failed"]) expect(on(status, running, queuedWork), `${status} with ${queuedWork} behind it, running ${running}`).toBe("working");
      // A queue word the plugin does not know is not work it can count: at rest.
      for (const status of ["idle", "pending", "error"]) expect(on(status, running, "retrying"), `${status} with an unknown queue word, running ${running}`).toBe("idle");
      expect(on("hibernating", running, "failed")).toBe("idle");
      // A status the plugin does not know is idle, work in line or not.
      expect(on("hibernating", running, "waiting")).toBe("idle");
    }
    // A row the kernel calls STOPPED (not running, beside the word "stopped" or no word: `recordedStopped`) is stopped, whatever bb's status says of the thread.
    for (const runtimeState of ["stopped", null]) for (const status of ["active", "idle"]) expect(state(agent("a", { running: false, runtimeState }), thread("t", { status })), `${status}, not running beside ${runtimeState}`).toBe("stopped");
    // Not running beside "unknown" (its session is there, no harness loaded) is not stopped: it reads as bb says of its thread.
    expect(on("active", false)).toBe("working");
    expect(on("idle", false)).toBe("idle");
  });
  test("a tmux agent's activity is the kernel's own word; a provider's agent whose thread bb does not list is idle, a loaded harness or not", () => {
    expect(state(agent("a", { backend: "tmux", running: true, runtimeState: null }), null)).toBe("working");
    expect(state(agent("a", { backend: "tmux", running: null, runtimeState: null }), null)).toBe("idle");
    expect(state(agent("a", { backend: "tmux", running: false, runtimeState: null }), null)).toBe("stopped");
    expect(state(agent("a", { running: true }), null)).toBe("idle");
    expect(state(agent("a", { running: null }), null)).toBe("idle");
    expect(state(agent("a", { running: false }), null)).toBe("idle"); // beside "unknown": there, not loaded, and not stopped
    for (const runtimeState of ["stopped", null]) expect(state(agent("a", { running: false, runtimeState }), null)).toBe("stopped");
  });
  test("an unknown runtimeState word is idle", () => {
    expect(state(agent("a", { runtimeState: "hibernating" }), t)).toBe("idle");
    expect(state(agent("a", { runtimeState: null }), t)).toBe("idle");
  });
  test("a pending interaction with no claim is needs-you", () => {
    expect(state(agent("a"), thread("t", { hasPendingInteraction: true }))).toBe("needs-you");
  });
  // The gate is the Desktop's: awebai/oats packages/client/waiting-on-you.mjs `waitingClaim`, at 95c7b43b3.
  // This test held "a claim wins over stopped" until 2026-11-21, when the spec's author changed A2:
  // one rule for the tree and the panel. The kernel prints no claim on a stopped row today, so the
  // stopped case is a rule for the type, unseen in a real run.
  test("a claim wins over unreachable and error; a row the kernel calls stopped shows no claim, unless bb holds a question on its thread", () => {
    for (const runtimeState of ["unreachable", "shell"]) {
      expect(state(agent("a", { waiting: claim, runtimeState, running: false }), t)).toBe("needs-you");
    }
    expect(state(agent("a", { waiting: claim, runtimeState: "stopped", running: false }), t)).toBe("stopped");
    expect(state(agent("a", { waiting: claim, runtimeState: "stopped", running: false }), thread("t", { hasPendingInteraction: true }))).toBe("needs-you");
  });
  // The spec's author amended A2 again on 2026-11-23: ONE claim rule for both backends. A claim is
  // hidden only for an agent the kernel calls stopped (its word "stopped", or not running with no
  // word); shown in every other case. The pairs are every pair the TYPE allows that matters, shaped by
  // hand, not recorded: today's kernel prints a claim only on a row it says runs (tmux) or does not
  // call not-running (a provider), so for the rows it prints now the rule changes nothing; it is
  // the rule for a row a later kernel prints (awebai/oats lib/instance-listing.mjs at 95c7b43b3).
  test("one claim rule for bb and tmux: hidden only for a row the kernel calls stopped, shown for every other pair of (running, runtimeState)", () => {
    for (const backend of ["bb", "tmux"]) {
      const shows = (over: Partial<Agent>) => claimOf(agent("a", { backend, waiting: claim, ...over })) !== null;
      // Hidden: the kernel calls it stopped.
      expect(shows({ running: false, runtimeState: "stopped" }), `${backend} stopped`).toBe(false);
      expect(shows({ running: false, runtimeState: null }), `${backend} not running, no word`).toBe(false);
      // Shown: it runs, the kernel says nothing of it, its harness ended in a shell, it cannot be reached, no harness is loaded.
      for (const [running, runtimeState] of [[true, null], [true, "running"], [true, "unknown"], [null, null], [null, "unknown"], [true, "shell"], [false, "shell"], [null, "unreachable"], [false, "unreachable"], [false, "unknown"], [null, "unsupported"]] as const) {
        expect(shows({ running, runtimeState }), `${backend} (${running}, ${runtimeState})`).toBe(true);
      }
    }
  });
  // The claim's gate and the state use ONE predicate for "the kernel calls this row stopped"
  // (`recordedStopped`: not running, beside the word "stopped" or no word). A provider's row that is
  // not running beside "unknown" has its session there with no harness loaded (the kernel's contract
  // for a provider home's row, v0.70.5; shaped, not recorded: the bb provider prints it from its next
  // release): it is not stopped, so a question it asked before its harness went away still waits for a person.
  test("a provider's row that is not running beside \"unknown\" keeps its claim: it needs you, shows the claim, and is counted; beside \"stopped\" or no word it shows none", () => {
    const unloaded = agent("a", { waiting: claim, running: false, runtimeState: "unknown" });
    expect(claimOf(unloaded)).toBe(claim);
    expect(state(unloaded, t)).toBe("needs-you");
    expect(view([unloaded], [thread("thr_a")]).needing).toEqual([unloaded]);
    expect(view([unloaded], []).needing).toEqual([unloaded]); // also with no thread listed
    for (const runtimeState of ["stopped", null]) {
      const stopped = agent("a", { waiting: claim, running: false, runtimeState });
      expect(claimOf(stopped)).toBeNull();
      expect(state(stopped, t)).toBe("stopped");
      expect(view([stopped], [thread("thr_a")]).needing).toEqual([]);
    }
  });
  // The one state that does not come from `running` and `runtimeState`: the kernel's report that a
  // harness runs in a home OATS recorded stopped (`outsideOats`, feature provider-outside-oats).
  test("a row with the kernel's outsideOats is \"outside\" before everything else, and is counted among the agents that need a person; a tmux row never is", () => {
    const report = { code: "running-outside-oats" as const, backend: "bb", message: "a harness runs in a on bb" };
    const outside = agent("a", { running: false, runtimeState: "stopped", outsideOats: report });
    expect(state(outside, t)).toBe("outside");
    expect(state(outside, null)).toBe("outside");
    expect(state({ ...outside, waiting: claim }, thread("t", { hasPendingInteraction: true }))).toBe("outside"); // one statement about it, also while bb holds a question
    expect(view([outside], [thread("thr_a")]).needing).toEqual([outside]);
    expect(view([outside], []).needing).toEqual([outside]);
    expect(view([outside], [thread("thr_a")]).needsYou).toEqual([]); // it does not wait: it runs
    expect(state({ ...outside, backend: "tmux" }, null)).toBe("stopped");
    expect(state(agent("a", { running: false, runtimeState: "stopped", outsideOats: null }), t)).toBe("stopped");
  });
  test("a tmux row with a claim: the claim wins over a shell and over a session that cannot be reached, as on bb; a stopped one shows none", () => {
    const tmux = (over: Partial<Agent>) => state(agent("a", { backend: "tmux", waiting: claim, ...over }), null);
    expect(tmux({ running: true, runtimeState: null })).toBe("needs-you");
    expect(tmux({ running: true, runtimeState: "running" })).toBe("needs-you");
    expect(tmux({ running: true, runtimeState: "shell" })).toBe("needs-you");
    expect(tmux({ running: null, runtimeState: "unreachable" })).toBe("needs-you");
    expect(tmux({ running: null, runtimeState: null })).toBe("needs-you");
    expect(tmux({ running: false, runtimeState: null })).toBe("stopped");
    expect(tmux({ running: false, runtimeState: "stopped" })).toBe("stopped");
  });
  // The spec's author amended A2 on 2026-11-22: an agent the kernel calls not running, with no
  // other word, is "stopped". It is what the kernel prints for a tmux row whose window is gone or
  // whose harness does not run: `{ running: false }` and no runtimeState (awebai/oats
  // lib/instance-listing.mjs:256, :261 at 95c7b43b3). It read "idle" until then.
  test("an agent the kernel calls not running, with no other word, is stopped: a tmux row as the kernel prints it; a failed or unreachable one is told first", () => {
    expect(state(agent("a", { backend: "tmux", running: false, runtimeState: null }), null)).toBe("stopped");
    expect(state(agent("a", { backend: "tmux", running: false, runtimeState: null, waiting: claim }), null)).toBe("stopped"); // and its claim is not shown
    expect(state(agent("a", { running: false, runtimeState: null }), t)).toBe("stopped");
    expect(state(agent("a", { running: false, runtimeState: "shell" }), t)).toBe("error");
    expect(state(agent("a", { running: false, runtimeState: "unreachable" }), t)).toBe("unreachable");
    expect(state(agent("a", { running: null, runtimeState: null }), t)).toBe("idle"); // nothing said: idle, as before
  });
  test("the fixtures: three need you, two work, one is stopped, one is idle and unread", () => {
    const v = view(fixtureAgents(), fixtureThreads());
    // Who waits, counted once for every place: the tree's three; none of them is thread-less here.
    expect(v.needing.map((agent) => agent.instance).sort()).toEqual(["flaky-ci-developer", "ranker-v3-probe", "release-070-maintainer"]);
    expect(names(v.needsYou).sort()).toEqual(["flaky-ci-developer", "ranker-v3-probe", "release-070-maintainer"]);
    expect(names(v.working).sort()).toEqual(["desktop-mockups-developer", "redesign-ui-lead"]);
    expect(names(v.finished)).toEqual(["harvest-knowledge-helper"]);
    expect(flatten(v.roots).find((node) => node.agent.instance === "weekly-digest-helper")!.state).toBe("stopped");
  });
});

describe("A3 view(): where everything else goes", () => {
  const only = (v: ReturnType<typeof view>) => ({
    roots: names(flatten(v.roots)),
    others: v.others.map((t) => t.id),
    detached: v.detached.map((a) => a.instance),
    elsewhere: v.elsewhere.map((a) => a.instance),
  });

  test("a thread with no agent is in others only", () => {
    const v = view([agent("a")], [thread("thr_a"), thread("thr_plain")]);
    expect(only(v)).toEqual({ roots: ["a"], others: ["thr_plain"], detached: [], elsewhere: [] });
  });
  test("the fixtures: the plain bb thread is the only other thread", () => {
    expect(view(fixtureAgents(), fixtureThreads()).others.map((t) => t.id)).toEqual(["thr_plain"]);
  });
  test("others are newest first, and leave out archived and hidden threads", () => {
    const v = view(
      [],
      [
        thread("old", { updatedAt: 1 }),
        thread("new", { updatedAt: 9 }),
        thread("archived", { isArchived: true }),
        thread("hidden", { isHidden: true }),
      ],
    );
    expect(v.others.map((t) => t.id)).toEqual(["new", "old"]);
  });
  test("an agent whose thread is archived is in detached only", () => {
    const v = view([agent("a")], [thread("thr_a", { isArchived: true })]);
    expect(only(v)).toEqual({ roots: [], others: [], detached: ["a"], elsewhere: [] });
  });
  test("an agent whose thread is hidden, deleted, or was never recorded is in detached only", () => {
    const agents = [agent("hidden"), agent("deleted"), agent("no-id", { threadId: null })];
    const v = view(agents, [thread("thr_hidden", { isHidden: true })]);
    expect(only(v)).toEqual({ roots: [], others: [], detached: ["hidden", "deleted", "no-id"], elsewhere: [] });
  });
  test("a tmux agent is in elsewhere only, even when it names a thread", () => {
    const v = view([agent("t", { backend: "tmux", threadId: "thr_x" })], [thread("thr_x")]);
    expect(only(v)).toEqual({ roots: [], others: ["thr_x"], detached: [], elsewhere: ["t"] });
  });
  test("the fixtures: the tmux agent is elsewhere", () => {
    expect(view(fixtureAgents(), fixtureThreads()).elsewhere.map((a) => a.instance)).toEqual(["kernel-fix-developer"]);
  });
  test("a duplicate thread id: the first agent in the kernel's order is drawn, the second is detached", () => {
    const v = view([agent("first", { threadId: "thr_same" }), agent("second", { threadId: "thr_same" })], [thread("thr_same")]);
    expect(only(v)).toEqual({ roots: ["first"], others: [], detached: ["second"], elsewhere: [] });
  });
  test("a child of a detached agent is a root", () => {
    const v = view([agent("gone"), agent("kid", { parent: "gone" })], [thread("thr_kid")]);
    expect(only(v)).toEqual({ roots: ["kid"], others: [], detached: ["gone"], elsewhere: [] });
  });
  test("an agent on another session provider is joined like a bb agent", () => {
    const v = view([agent("x", { backend: "other" })], [thread("thr_x")]);
    expect(only(v).roots).toEqual(["x"]);
  });
});
