// What the roster's row says of an agent's board (kernel/roster.ts `boardOf`): that it has one, and
// that it asks. From the kernel's own row (recorded: test/fixtures/panel/status-board.json), only
// on a kernel that lists the feature; a key is `true` or ABSENT, never false. And through the whole
// backend: a roster whose only change is a board's first fact IS published.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { parseStatus } from "../../kernel/roster.js";
import { startBackend, type Backend } from "../support/backend.js";

const FILE = join(__dirname, "..", "fixtures", "panel", "status-board.json");
const ASKS = "panel-worktree-helper";
type Recorded = { features?: string[]; agents: { instances: { instance: string; board?: { facts: unknown[]; questions: unknown[] } | null }[] }[] };
const recorded = (): Recorded => JSON.parse(readFileSync(FILE, "utf8")) as Recorded;
const rowOf = (document: Recorded) => document.agents.flatMap((group) => group.instances).find((row) => row.instance === ASKS)!;
function said(document: Recorded) {
  const read = parseStatus(document);
  if (!read.ok) throw new Error(read.error.message);
  const agent = read.value.agents.find((each) => each.instance === ASKS)!;
  return { hasBoard: agent.hasBoard, boardAsks: agent.boardAsks, keys: ["hasBoard", "boardAsks"].filter((key) => key in agent) };
}

describe("the roster's row and the agent's board", () => {
  it("facts and a question: it has a board, and it asks", () => {
    expect(said(recorded())).toEqual({ hasBoard: true, boardAsks: true, keys: ["hasBoard", "boardAsks"] });
  });

  it("facts alone: it has a board, and the other key is absent", () => {
    const document = recorded();
    rowOf(document).board!.questions = [];
    expect(said(document)).toEqual({ hasBoard: true, boardAsks: undefined, keys: ["hasBoard"] });
  });

  it("a question alone: both", () => {
    const document = recorded();
    rowOf(document).board!.facts = [];
    expect(said(document).keys).toEqual(["hasBoard", "boardAsks"]);
  });

  it("no board, an empty board, no key, or a kernel without the feature: neither key (absent, not false)", () => {
    const none = recorded();
    rowOf(none).board = null;
    const empty = recorded();
    rowOf(empty).board = { facts: [], questions: [] };
    const keyless = recorded();
    delete rowOf(keyless).board;
    const old = recorded();
    old.features = (old.features ?? []).filter((feature) => feature !== "instance-board");
    for (const document of [none, empty, keyless, old]) expect(said(document)).toEqual({ hasBoard: undefined, boardAsks: undefined, keys: [] });
  });
});

describe("a board's change alone is published", () => {
  let backend: Backend | undefined;
  afterEach(async () => {
    await backend?.dispose();
    backend = undefined;
  });

  it("a roster whose only change is a board gaining its first fact is published, and the row then says it has a board", async () => {
    const before = recorded();
    const fact = rowOf(before).board!.facts[0];
    rowOf(before).board = null;
    const after = recorded();
    rowOf(after).board = null;
    rowOf(after).board = { facts: [fact], questions: [] };
    backend = await startBackend({ verbs: { status: { stdout: JSON.stringify(before) } } });
    type Snapshot = { at: string; agents: { instance: string; hasBoard?: true }[] };
    const first = await backend.rpc<Snapshot>("snapshot");
    expect(first.agents.find((agent) => agent.instance === ASKS)!.hasBoard).toBeUndefined();
    const published = backend.server.harness.realtimeSignals.length;
    await backend.fake.behave({ status: { stdout: JSON.stringify(after) } });
    await backend.rpc("refresh");
    const next = await backend.rpc<Snapshot>("snapshot");
    expect(next.agents.find((agent) => agent.instance === ASKS)!.hasBoard).toBe(true);
    expect(backend.server.harness.realtimeSignals.length).toBe(published + 1);
    // And the same roster read again publishes nothing.
    await backend.rpc("refresh");
    expect(backend.server.harness.realtimeSignals.length).toBe(published + 1);
  }, 20_000);
});
