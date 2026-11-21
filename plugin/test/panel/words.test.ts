// The instance panel's words: the OATS Desktop's, for the same facts.
import { describe, expect, it } from "vitest";
import {
  ageText, driftLines, harnessName, modelFromText, runtimeErrorLine, sessionLine, sharedWork, shortAge, stateText, waitedText, waitingClock, waitingDetail,
  waitingHead, waitingLabel, workFolder, workSentence,
} from "../../app/panel/words";

const NOW = Date.parse("2026-11-21T18:30:00.000Z");
const ago = (ms: number) => new Date(NOW - ms).toISOString();
const MIN = 60_000;
const HOUR = 60 * MIN;

describe("the header's state", () => {
  it("Running with the age of its last start, Stopped, Not reported", () => {
    expect(stateText({ running: true, startedAt: ago(42 * MIN) }, NOW)).toEqual({ state: "running", text: "Running · 42m", title: `started ${ago(42 * MIN)}` });
    expect(stateText({ running: true, startedAt: null }, NOW)).toEqual({ state: "running", text: "Running", title: null });
    expect(stateText({ running: false, startedAt: ago(MIN) }, NOW)).toEqual({ state: "stopped", text: "Stopped", title: null });
    expect(stateText({ running: null, startedAt: ago(MIN) }, NOW)).toEqual({ state: "unknown", text: "Not reported", title: null });
  });
  it("ages: compact for the header, in words for the session", () => {
    expect([shortAge(ago(20_000), NOW), shortAge(ago(59 * MIN), NOW), shortAge(ago(3 * HOUR), NOW), shortAge(ago(49 * HOUR), NOW), shortAge("soon", NOW), shortAge(null, NOW)]).toEqual(["<1m", "59m", "3h", "2d", null, null]);
    expect([ageText(ago(20_000), NOW), ageText(ago(5 * MIN), NOW), ageText(ago(3 * HOUR), NOW), ageText(ago(49 * HOUR), NOW), ageText(ago(40 * 24 * HOUR), NOW), ageText("soon", NOW)]).toEqual([
      "just now", "5 min ago", "3 h ago", "2 d ago", "2026-10-12", "soon",
    ]);
  });
});

describe("the older build chip", () => {
  it("says nothing when nothing moved", () => {
    expect(driftLines({ soul: null, modules: [] })).toBeNull();
  });
  it("says what moved, in the Desktop's sentences", () => {
    expect(
      driftLines({
        soul: "moved",
        modules: [
          { name: "oats.core", status: "moved", was: "1.26.0", now: "1.27.0", reason: null },
          { name: "oats.okf", status: "moved", was: null, now: "2.2.0", reason: null },
          { name: "oats.bb", status: "moved", was: "1.0.0", now: null, reason: null },
          { name: "oats.jira", status: "missing", was: null, now: null, reason: "package no longer locked" },
          { name: null, status: "missing", was: null, now: null, reason: null },
          { name: "oats.aweb", status: "unconfirmed", was: null, now: null, reason: null },
        ],
      }),
    ).toEqual([
      "Built from an older state of the workspace:",
      "• Its soul's repository has moved on since it was spawned.",
      "• oats.core has changed since (1.26.0 → 1.27.0).",
      "• oats.okf has changed since (now 2.2.0).",
      "• oats.bb has changed since.",
      "• oats.jira is no longer available (package no longer locked).",
      "• A capability is no longer available.",
      "• oats.aweb is unconfirmed.",
      "Re-spawning picks up the new state; this instance keeps what it was built with.",
    ]);
    expect(driftLines({ soul: "missing", modules: [] })?.[1]).toBe("• The soul commit it was spawned from is no longer found.");
    expect(driftLines({ soul: "unconfirmed", modules: [] })?.[1]).toBe("• Its soul is unconfirmed.");
  });
});

describe("the Work card", () => {
  const facts = { repo: "oats", branch: "agents/dev-a", parent: "lead-a" };
  it("one sentence per work mode, with the row's own facts", () => {
    expect(workSentence({ work: "worktree", ...facts })).toEqual(["Works in its own worktree of ", { code: "oats" }, ", on branch ", { code: "agents/dev-a" }, "."]);
    expect(workSentence({ work: "worktree", repo: null, branch: null, parent: null })).toEqual(["Works in its own worktree of ", "its soul's repository", "."]);
    expect(workSentence({ work: "checkout", ...facts })).toEqual(["Works in the shared checkout of ", { code: "oats" }, ", alongside the other instances that use it."]);
    expect(workSentence({ work: "attached", ...facts })).toEqual(["Works in ", { code: "lead-a" }, "'s tree", ", sharing its branch and changes."]);
    expect(workSentence({ work: "attached", repo: null, branch: null, parent: null })).toEqual(["Works in ", "its parent's tree", ", sharing its branch and changes."]);
    expect(workSentence({ work: "directory", ...facts })).toEqual(["Has its own folder, not tied to one repository: free to work across repos as its task needs."]);
    expect(workSentence({ work: "workspace", ...facts })).toEqual(["Sees the whole workspace: reads across every member repository."]);
  });
  it("no sentence for a mode that is unreported or unknown", () => {
    expect(workSentence({ work: null, ...facts })).toBeNull();
    expect(workSentence({ work: "constructor", ...facts })).toBeNull();
  });
  it("the folder is <home>/work, shared in the modes that link it", () => {
    expect(workFolder("/abs/deployment/agents/dev/instances/dev-a/")).toBe("/abs/deployment/agents/dev/instances/dev-a/work");
    expect(["worktree", "directory", "checkout", "attached", "workspace", null].map(sharedWork)).toEqual([false, false, true, true, true, false]);
  });
});

describe("the Session card", () => {
  it("names the harness, and where the model came from only beside a model", () => {
    expect(["claude", " PI ", "codex", "aider"].map(harnessName)).toEqual(["Claude", "Pi", "Codex", "aider"]);
    expect(modelFromText({ model: "claude-opus-5-5", modelFrom: "soul" })).toBe("the soul's choice");
    expect(modelFromText({ model: "m", modelFrom: "harness-default" })).toBe("the harness's default");
    expect(modelFromText({ model: "m", modelFrom: "local-default" })).toBe("this computer's default for every soul");
    expect(modelFromText({ model: null, modelFrom: "soul" })).toBeNull();
    expect(modelFromText({ model: "m", modelFrom: "toString" })).toBeNull();
  });
  it("says where the session runs", () => {
    expect(sessionLine({ backend: "bb", threadId: "thr_gx4sgexjgw", tmuxSession: null })).toBe("bb · thread thr_gx4sgexjgw");
    expect(sessionLine({ backend: "bb", threadId: null, tmuxSession: null })).toBe("bb");
    expect(sessionLine({ backend: "tmux", threadId: null, tmuxSession: "oats-main" })).toBe("tmux · oats-main");
    expect(sessionLine({ backend: null, threadId: null, tmuxSession: "oats-main" })).toBe("tmux · oats-main");
    expect(sessionLine({ backend: null, threadId: null, tmuxSession: null })).toBe("");
    expect(runtimeErrorLine("bb did not answer")).toBe("OATS says: bb did not answer");
  });
});

describe("Needs input", () => {
  it("the reason in words, never the raw reason", () => {
    const claim = (reason: string | null) => ({ reason, message: null, since: null });
    expect(["permission", "question", "attention", "valueOf", null].map((reason) => waitingLabel(claim(reason)))).toEqual([
      "Waiting for a tool approval", "Asked you a question", "Asked for your attention", "Needs input", "Needs input",
    ]);
  });
  it("the detail is the message, else the reason in words, else nothing", () => {
    expect(waitingDetail({ reason: "question", message: "Keep the retry?", since: null })).toBe("Keep the retry?");
    expect(waitingDetail({ reason: "question", message: "  ", since: null })).toBe("Asked you a question");
    expect(waitingDetail({ reason: "other", message: null, since: null })).toBeNull();
  });
  it("how long, and since when", () => {
    expect([waitedText(ago(20_000), NOW), waitedText(ago(12 * MIN), NOW), waitedText(ago(5 * HOUR), NOW), waitedText(ago(50 * HOUR), NOW), waitedText(ago(-MIN), NOW), waitedText(null, NOW)]).toEqual([
      "under a minute", "12 min", "5 h", "2 d", "under a minute", "under a minute",
    ]);
    const local = (y: number, m: number, d: number, h: number, min: number) => new Date(y, m, d, h, min).toISOString();
    const now = new Date(2026, 10, 21, 18, 30).getTime();
    expect(waitingClock(local(2026, 10, 21, 14, 3), now)).toBe("14:03");
    expect(waitingClock(local(2026, 9, 2, 9, 5), now)).toBe("Oct 2, 09:05");
    expect(waitingClock(local(2025, 9, 2, 14, 3), now)).toBe("2025-10-02 14:03");
    expect(waitingClock("soon", now)).toBe("");
    expect(waitingHead({ reason: "attention", message: null, since: local(2026, 10, 21, 18, 18) }, now)).toBe("Asked for your attention · waiting 12 min (since 18:18)");
    expect(waitingHead({ reason: null, message: null, since: null }, now)).toBe("Needs input · waiting under a minute");
  });
});
