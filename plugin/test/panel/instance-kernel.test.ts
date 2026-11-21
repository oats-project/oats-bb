// The roster's row of one instance, read into what the instance panel draws: against the answers
// recorded from the real kernel (test/fixtures/panel/README.md).
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { panelInstance, parsePanelInstance as parseRaw, type RawRow } from "../../kernel/panel-instance.js";

const read = (name: string): unknown => JSON.parse(readFileSync(resolve(process.cwd(), "test/fixtures", name), "utf8"));
const recorded = read("status-recorded.json") as Record<string, { agents: { instances: Record<string, unknown>[] }[] }>;

type Roster = { root: unknown; agents: ({ instances: Record<string, unknown>[] } & Record<string, unknown>)[] };
/** What the shared status read keeps for one instance: the roster's root, its agent row and its own row. */
function rawOf(document: unknown, instance: string): RawRow {
  const roster = document as Roster;
  for (const { instances, ...agent } of roster.agents) {
    const row = instances.find((candidate) => candidate.instance === instance);
    if (row !== undefined) return { root: roster.root, agent, row };
  }
  throw new Error(`the recording has no instance ${instance}`);
}
const parsePanelInstance = (document: unknown, instance: string) => parseRaw(rawOf(document, instance));

/** The recorded document with the instance's row changed by `change`: for the facts no recording holds. */
function withRow(name: string, instance: string, change: (row: Record<string, unknown>) => void): unknown {
  const document = structuredClone(read(name)) as { agents: { instances: Record<string, unknown>[] }[] };
  for (const group of document.agents) for (const row of group.instances) if (row.instance === instance) change(row);
  return document;
}

describe("the panel's read of one instance", () => {
  it("a child on its own worktree, idle in bb: every fact is the row's own", () => {
    const answer = parsePanelInstance(read("panel/status.json"), "panel-worktree-helper");
    expect(answer).toEqual({
      ok: true,
      value: {
        instance: "panel-worktree-helper",
        soul: "oats-expert",
        description: "OATS expert: answers questions about OATS.",
        agentsRoot: "/abs/deployment/agents",
        home: "/abs/deployment/agents/oats-expert/instances/panel-worktree-helper",
        running: null,
        runtimeState: "unknown",
        runtimeError: null,
        startedAt: "2026-11-21T18:13:36.478Z",
        createdAt: "2026-11-21T18:13:36.478Z",
        drift: { soul: null, modules: [] },
        work: "worktree",
        repo: "oats-real",
        branch: "agents/panel-worktree-helper",
        parent: "redesign-ui-lead",
        sibling: null,
        human: null,
        harness: "claude",
        model: "claude-opus-5-5",
        modelFrom: "soul",
        backend: "bb",
        threadId: "thr_gx4sgexjgw",
        tmuxSession: null,
        messagingId: null,
      },
    });
    // What the read answers is what the contract carries.
    if (answer.ok) expect(panelInstance.parse(answer.value)).toEqual(answer.value);
  });

  it("a soul in its own folder: no branch, and the repository is the deployment's directory", () => {
    const answer = parsePanelInstance(read("panel/status.json"), "redesign-ui-lead");
    expect(answer.ok && answer.value).toMatchObject({ soul: "oats-product-expert", work: "directory", repo: "deployment", branch: null, parent: null });
  });

  it("a soul whose repository moved on since the spawn: the kernel's word for it", () => {
    const answer = parsePanelInstance(read("panel/status-soul-moved.json"), "panel-worktree-helper");
    expect(answer.ok && answer.value.drift).toEqual({ soul: "moved", modules: [] });
  });

  it("running and stopped are the kernel's words", () => {
    const working = parsePanelInstance(recorded.working, "flaky-ci-2-developer");
    expect(working.ok && working.value).toMatchObject({ running: true, runtimeState: "unknown", startedAt: "2026-11-21T15:44:59.291Z" });
    const stopped = parsePanelInstance(recorded.stoppedByOats, "flaky-ci-2-developer");
    expect(stopped.ok && stopped.value).toMatchObject({ running: false, runtimeState: "stopped" });
  });

  it("a module that moved or is gone is named with its versions and the kernel's reason; a recorded map says nothing", () => {
    const drifted = parsePanelInstance(
      withRow("panel/status.json", "panel-worktree-helper", (row) => {
        const modules = row.modules as unknown[];
        modules[0] = { ...(modules[0] as object), status: "missing", reason: "package no longer locked" };
        modules[1] = { ...(modules[1] as object), status: "moved", current: { commit: "abc", version: "1.27.0" } };
        modules.push({ status: "moved" }, "not a row");
      }),
      "panel-worktree-helper",
    );
    expect(drifted.ok && drifted.value.drift.modules).toEqual([
      { name: "oats.bb", status: "missing", was: "a3cca8511461e92c25d86f693365ec250b7c4684", now: "a3cca8511461e92c25d86f693365ec250b7c4684", reason: "package no longer locked" },
      { name: "oats.core", status: "moved", was: "1.26.0", now: "1.27.0", reason: null },
      { name: null, status: "moved", was: null, now: null, reason: null },
    ]);
    const map = parsePanelInstance(
      withRow("panel/status.json", "panel-worktree-helper", (row) => {
        row.modules = { "oats.core": { commit: "abc" } };
      }),
      "panel-worktree-helper",
    );
    expect(map.ok && map.value.drift.modules).toEqual([]);
  });

  it("the messaging id is the address, else the served identity in the Desktop's words", () => {
    const of = (change: (row: Record<string, unknown>) => void) => {
      const answer = parsePanelInstance(withRow("panel/status.json", "panel-worktree-helper", change), "panel-worktree-helper");
      return answer.ok ? answer.value.messagingId : answer.error;
    };
    expect(of((row) => (row.identityAddress = "oats.aweb.ai/panel-worktree-helper"))).toBe("oats.aweb.ai/panel-worktree-helper");
    expect(of((row) => (row.identity = { alias: "panel-worktree-helper", team: "default:oats.aweb.ai", provider: "oats.aweb" }))).toBe("alias panel-worktree-helper on default:oats.aweb.ai");
    expect(of((row) => (row.identity = { mode: "global", resident: "ana", grant: { expiresAt: "2026-12-01T00:00:00.000Z" } }))).toBe("acts as ana via grant, expires 2026-12-01T00:00:00.000Z");
    expect(of((row) => (row.identity = { mode: "global", address: "nw/ana", grant: {} }))).toBe("acts as nw/ana via grant");
    expect(of((row) => (row.identity = {}))).toBe("alias ? on ?");
  });

  it("a tmux row, a sibling and an owning human are read where the row has them", () => {
    const answer = parsePanelInstance(
      withRow("panel/status.json", "panel-worktree-helper", (row) => {
        delete row.backend;
        delete row.session;
        row.tmux = { session: "oats-main", socket: "/tmp/tmux-1000/default" };
        row.siblingInstance = "redesign-ui-lead";
        row.attributedHuman = "Ana";
        row.runtimeError = "bb did not answer";
      }),
      "panel-worktree-helper",
    );
    expect(answer.ok && answer.value).toMatchObject({ backend: null, threadId: null, tmuxSession: "oats-main", sibling: "redesign-ui-lead", human: "Ana", runtimeError: "bb did not answer" });
  });

  it("a fact of another type is unreported, never a failed read", () => {
    const answer = parsePanelInstance(
      withRow("panel/status.json", "panel-worktree-helper", (row) => {
        Object.assign(row, { work: 7, branch: "", model: null, running: "yes", startedAt: {}, soul: "moved", session: "thr_x", identity: "x", repo: 3 });
        delete row.agent;
      }),
      "panel-worktree-helper",
    );
    expect(answer.ok && answer.value).toMatchObject({
      soul: "oats-expert", work: null, branch: null, model: null, running: null, startedAt: null, threadId: null, messagingId: null, repo: "deployment",
      drift: { soul: null, modules: [] },
    });
  });

  it("a row without its frame (the roster's root, the row's instance and home) is the plugin's own error, naming the fault", () => {
    const raw = rawOf(read("panel/status.json"), "panel-worktree-helper");
    const noRoot = parseRaw({ ...raw, root: undefined });
    expect(!noRoot.ok && noRoot.error.code).toBe("OATS_BAD_ANSWER");
    expect(!noRoot.ok && noRoot.error.message).toContain("at root");
    const noHome = parseRaw({ ...raw, row: { instance: "panel-worktree-helper" } });
    expect(!noHome.ok && noHome.error.message).toContain("at row.home");
    expect(parseRaw({ root: "/abs/deployment/agents", agent: null, row: null }).ok).toBe(false);
  });
});
