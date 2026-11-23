// The kernel's report in the roster: kernel/outside.ts (the report's shape) and kernel/roster.ts
// (the row's `sessionEnd` and `outsideOats` in the plugin's `Agent`, the gate on the kernel's feature).
import { describe, expect, it } from "vitest";
import { OUTSIDE_CODE, OUTSIDE_FEATURE, readOutsideOats } from "../../kernel/outside";
import { agentsOf, outsideDocument, recorded } from "./rows";

const REPORT = {
  code: "running-outside-oats", backend: "bb",
  message: "a harness runs in flaky-ci-2-developer on bb, and OATS recorded this instance stopped: stop it with `oats instance stop flaky-ci-2-developer`, or start it from OATS",
};
const STOPPED = { backend: "bb", running: false, runtimeState: "stopped" } as const;
/** The document with its one row changed. */
const withRow = (change: (row: Record<string, unknown>) => void, feature = true) => {
  const document = structuredClone(outsideDocument(feature));
  change(document.agents[0]!.instances[0]!);
  return agentsOf(document)[0]!;
};

describe("readOutsideOats", () => {
  it("the names are the kernel's (lib/kernel-features.mjs, lib/session-providers.mjs at v0.70.5)", () => {
    expect([OUTSIDE_FEATURE, OUTSIDE_CODE]).toEqual(["provider-outside-oats", "running-outside-oats"]);
  });
  it("reads the report in the kernel's exact shape: the three keys, the one code, a one-line message of at most 500 characters", () => {
    expect(readOutsideOats(REPORT, STOPPED)).toEqual(REPORT);
    expect(readOutsideOats({ ...REPORT, message: "x".repeat(500) }, STOPPED)?.message).toHaveLength(500);
    // 500 characters as the kernel counts them (code points): an astral character is one, and two UTF-16 units.
    expect([...(readOutsideOats({ ...REPORT, message: "𝒙".repeat(500) }, STOPPED)?.message ?? "")]).toHaveLength(500);
    expect(readOutsideOats({ ...REPORT, message: "𝒙".repeat(501) }, STOPPED)).toBeNull();
    const broken: unknown[] = [
      undefined, null, false, true, "running-outside-oats", [],
      { ...REPORT, code: "something-else" },
      { ...REPORT, extra: 1 },
      { code: REPORT.code, backend: REPORT.backend },
      { ...REPORT, message: "" },
      { ...REPORT, message: "one line\nand a second" },
      { ...REPORT, message: "x".repeat(501) },
      { ...REPORT, message: 7 },
      { ...REPORT, backend: "" },
    ];
    for (const value of broken) expect(readOutsideOats(value, STOPPED)).toBeNull();
  });
  it("takes it only on a row OATS recorded stopped, whose backend is the report's (the kernel's rule for a relayed row)", () => {
    expect(readOutsideOats(REPORT, { ...STOPPED, running: true })).toBeNull();
    expect(readOutsideOats(REPORT, { backend: "bb", running: null, runtimeState: "unknown" })).toBeNull();
    expect(readOutsideOats(REPORT, { ...STOPPED, runtimeState: "shell" })).toBeNull();
    expect(readOutsideOats(REPORT, { ...STOPPED, backend: "tmux" })).toBeNull();
    expect(readOutsideOats(REPORT, { ...STOPPED, backend: null })).toBeNull();
  });
});

describe("the roster's rows (parseStatus)", () => {
  it("an agent carries the kernel's report and how its session ended, where the status document lists the feature", () => {
    const agent = agentsOf(outsideDocument())[0]!;
    expect([agent.instance, agent.running, agent.runtimeState, agent.sessionEnd, agent.outsideOats]).toEqual(["flaky-ci-2-developer", false, "stopped", "stopped", REPORT]);
  });
  it("reads nothing of outsideOats where the document's features do not list it, whatever the row holds; nor from a document with no features", () => {
    const agent = agentsOf(outsideDocument(false))[0]!;
    expect([agent.sessionEnd, "outsideOats" in agent]).toEqual(["stopped", false]);
    const { features: _, ...bare } = outsideDocument();
    expect("outsideOats" in agentsOf(bare)[0]!).toBe(false);
  });
  it("a key of another shape is no report and never a failed read", () => {
    for (const value of [null, false, "yes", { ...REPORT, code: "other" }, { ...REPORT, extra: true }]) {
      expect("outsideOats" in withRow((row) => (row.outsideOats = value))).toBe(false);
    }
    expect("outsideOats" in withRow((row) => (row.running = true))).toBe(false);
  });
  it("a recorded row with no report has no key, and its sessionEnd is the kernel's: \"stopped\" for an operator's stop, \"lost\" for a session it did not stop, none for one that runs", () => {
    expect(["stoppedByOats", "threadDeleted", "working"].map((which) => recorded(which as "working")).map((agent) => [agent.sessionEnd, "outsideOats" in agent])).toEqual([["stopped", false], ["lost", false], [undefined, false]]);
  });
});
