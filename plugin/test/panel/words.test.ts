// The instance panel's words: the OATS Desktop's, for the same facts.
import { describe, expect, it } from "vitest";
import { ATTACH, ageText, attachOffered, driftLines, harnessName, markText, modelFromText, nameMark, sessionWhere, sharedWork, workFolder, whenText, workSentence } from "../../app/panel/words";

const NOW = Date.parse("2026-11-21T18:30:00.000Z");
const ago = (ms: number) => new Date(NOW - ms).toISOString();
const MIN = 60_000;
const HOUR = 60 * MIN;

describe("an agent on tmux", () => {
  it("one word over the command that reaches its session: \"Runs in\" beside it already says tmux", () => {
    expect(ATTACH).toBe("Attach:");
  });
  it("the attach line: only while the kernel's own word is that it runs, whatever its state says", () => {
    expect(attachOffered(true, true, "working")).toBe(true);
    expect(attachOffered(true, true, "needs-you")).toBe(true);
    // one the kernel cannot reach, or says nothing of, that needs the person by a claim it still carries: `oats session attach` refuses for it
    expect(attachOffered(true, null, "needs-you")).toBe(false);
    expect(attachOffered(true, false, "needs-you")).toBe(false);
    expect(attachOffered(true, true, "stopped")).toBe(false);
    expect(attachOffered(true, true, "unreachable")).toBe(false);
    // an agent on a session provider has a thread, not a terminal
    expect(attachOffered(false, true, "working")).toBe(false);
  });
});

describe("ages", () => {
  it("ages: compact for the header, in words for the session", () => {
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
  it("one fact per work mode, not a sentence: the mode in a word or two, then the row's own fact that tells it apart", () => {
    expect(workSentence({ work: "worktree", ...facts })).toEqual(["worktree", " · ", { code: "agents/dev-a" }]);
    expect(workSentence({ work: "worktree", repo: null, branch: null, parent: null })).toEqual(["worktree"]);
    expect(workSentence({ work: "checkout", ...facts })).toEqual(["shared checkout", " · ", { code: "oats" }]);
    expect(workSentence({ work: "checkout", repo: null, branch: null, parent: null })).toEqual(["shared checkout"]);
    expect(workSentence({ work: "attached", ...facts })).toEqual([{ code: "lead-a" }, "'s tree"]);
    expect(workSentence({ work: "attached", repo: null, branch: null, parent: null })).toEqual(["its parent's tree"]);
    expect(workSentence({ work: "directory", ...facts })).toEqual(["own folder"]);
    expect(workSentence({ work: "workspace", ...facts })).toEqual(["workspace"]);
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
    expect(["claude", " PI ", "codex", "aider", "constructor"].map(harnessName)).toEqual(["Claude", "Pi", "Codex", "aider", "constructor"]);
    expect(modelFromText({ model: "claude-opus-5-5", modelFrom: "soul" })).toBe("the soul's choice");
    expect(modelFromText({ model: "m", modelFrom: "harness-default" })).toBe("the harness's default");
    expect(modelFromText({ model: "m", modelFrom: "local-default" })).toBe("this computer's default for every soul");
    expect(modelFromText({ model: null, modelFrom: "soul" })).toBeNull();
    expect(modelFromText({ model: "m", modelFrom: "toString" })).toBeNull();
  });
  it("says where the session runs", () => {
    expect(sessionWhere({ backend: "bb", threadId: "thr_gx4sgexjgw", tmuxSession: null })).toEqual({ where: "bb thread", id: "thr_gx4sgexjgw", idName: "the thread's id in bb" });
    expect(sessionWhere({ backend: "bb", threadId: null, tmuxSession: null })).toEqual({ where: "bb", id: null, idName: "the thread's id in bb" });
    expect(sessionWhere({ backend: "tmux", threadId: null, tmuxSession: "oats-main" })).toEqual({ where: "tmux session", id: "oats-main", idName: "the tmux session's name" });
    expect(sessionWhere({ backend: null, threadId: null, tmuxSession: "oats-main" })?.id).toBe("oats-main");
    expect(sessionWhere({ backend: null, threadId: null, tmuxSession: null })).toBeNull();
    // An instant in the plugin's one form: the time today, the date another day, local; what is no instant as sent.
    const noon = new Date(2026, 10, 21, 12, 0, 0).getTime();
    expect(whenText(new Date(2026, 10, 21, 9, 5, 0).toISOString(), noon)).toBe("09:05");
    expect(whenText(new Date(2026, 10, 20, 18, 23, 0).toISOString(), noon)).toBe("Nov 20, 18:23");
    expect(whenText("never", noon)).toBe("never");
  });
});

describe("an agent's mark", () => {
  it("the letters of its NAME, as the words beside it read: the first two words' initials, or a single word's first two characters", () => {
    expect(["overnight-sweep-developer", "roster-round-3-reviewer", "bb-plugin-lead", "panel-worktree-helper", "dev", "x", "ßeta-max", "3-reviewers", "Émile-zola"].map(nameMark)).toEqual([
      "OS", "RR", "BP", "PW", "DE", "X", "SM", "3R", "ÉZ",
    ]);
  });
  it("none where the name has no letter or digit", () => {
    expect(["--", "", "…"].map(nameMark)).toEqual([null, null, null]);
  });
  it("never the soul's letters: a name keeps its first word, which a soul's mark drops as a namespace", () => {
    expect([nameMark("oats-desktop-developer"), markText("oats-desktop-developer")]).toEqual(["OD", "DD"]);
  });
});

describe("a soul's mark", () => {
  it("two letters, the Desktop's grammar", () => {
    expect(["oats-expert", "oats.okf/knowledge-harvester", "oats-okf--knowledge-maintainer", "oats-desktop-developer", "dev", "x", "ßeta", "--", ""].map(markText)).toEqual([
      "OE", "KH", "KM", "DD", "DE", "X", "SE", "?", "?",
    ]);
  });
});
