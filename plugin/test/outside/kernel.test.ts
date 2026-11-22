// kernel/outside.ts: the two facts of a raw status row, and the gate on the kernel's feature.
import { describe, expect, it } from "vitest";
import { OUTSIDE_CODE, OUTSIDE_FEATURE, parseOutsideRow } from "../../kernel/outside";
import { outsideDocument } from "./rows";

const raw = (): Record<string, unknown> => structuredClone((outsideDocument() as { agents: { instances: Record<string, unknown>[] }[] }).agents[0]!.instances[0]!);
const REPORT = {
  code: "running-outside-oats", backend: "bb",
  message: "a harness runs in flaky-ci-2-developer on bb, and OATS recorded this instance stopped: stop it with `oats instance stop flaky-ci-2-developer`, or start it from OATS",
};

describe("parseOutsideRow", () => {
  it("the names are the kernel's (lib/kernel-features.mjs, lib/session-providers.mjs at v0.70.5)", () => {
    expect([OUTSIDE_FEATURE, OUTSIDE_CODE]).toEqual(["provider-outside-oats", "running-outside-oats"]);
  });
  it("reads the report and how the session ended, on a kernel that lists the feature", () => {
    expect(parseOutsideRow(raw(), true)).toEqual({ instance: "flaky-ci-2-developer", sessionEnd: "stopped", outsideOats: REPORT });
  });
  it("reads nothing of outsideOats on a kernel that does not list the feature, whatever the row holds", () => {
    expect(parseOutsideRow(raw(), false)).toEqual({ instance: "flaky-ci-2-developer", sessionEnd: "stopped", outsideOats: null });
  });
  it("a row with no key is no report: never null made true, never false", () => {
    for (const value of [undefined, null, false, true, "running-outside-oats", []]) {
      const row = raw();
      if (value === undefined) delete row.outsideOats;
      else row.outsideOats = value;
      expect(parseOutsideRow(row, true)?.outsideOats).toBeNull();
    }
  });
  it("takes the report only in the kernel's exact shape: the three keys, the one code, a one-line message of at most 500 characters", () => {
    const broken: Record<string, unknown>[] = [
      { ...REPORT, code: "something-else" },
      { ...REPORT, extra: 1 },
      { code: REPORT.code, backend: REPORT.backend },
      { ...REPORT, message: "" },
      { ...REPORT, message: "one line\nand a second" },
      { ...REPORT, message: "x".repeat(501) },
      { ...REPORT, message: 7 },
      { ...REPORT, backend: "" },
    ];
    for (const report of broken) expect(parseOutsideRow({ ...raw(), outsideOats: report }, true)?.outsideOats).toBeNull();
    expect(parseOutsideRow({ ...raw(), outsideOats: { ...REPORT, message: "x".repeat(500) } }, true)?.outsideOats?.message).toHaveLength(500);
  });
  it("takes it only on a row OATS recorded stopped, whose backend is the report's (the kernel's rule for a relayed row)", () => {
    expect(parseOutsideRow({ ...raw(), running: true }, true)?.outsideOats).toBeNull();
    expect(parseOutsideRow({ ...raw(), running: null, runtimeState: "unknown" }, true)?.outsideOats).toBeNull();
    expect(parseOutsideRow({ ...raw(), runtimeState: "shell" }, true)?.outsideOats).toBeNull();
    expect(parseOutsideRow({ ...raw(), backend: "tmux" }, true)?.outsideOats).toBeNull();
  });
  it("a row with no sessionEnd has none; a row with no instance is no row", () => {
    const row = raw();
    delete row.sessionEnd;
    expect(parseOutsideRow(row, true)?.sessionEnd).toBeNull();
    expect(parseOutsideRow({ home: "/abs" }, true)).toBeNull();
  });
});
