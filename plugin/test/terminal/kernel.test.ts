// The viewer's command, and where this machine's `oats` is (kernel/terminal.ts).
import { describe, expect, test } from "vitest";
import { DETACH_KEY_FEATURE, NO_STATUS_LINE_FEATURE, resolveBin, viewerArgv } from "../../kernel/terminal";

const HOME = "/srv/oats/agents/oats-developer/instances/kernel-fix-developer";

describe("the viewer's command", () => {
  test("is the kernel's `oats session attach --home`, by the absolute path it is given", () => {
    expect(viewerArgv("/opt/oats/bin/oats", HOME, [])).toEqual(["/opt/oats/bin/oats", "session", "attach", "--home", HOME]);
  });
  test("each flag is passed only where the kernel lists its feature", () => {
    expect(viewerArgv("/o", HOME, [DETACH_KEY_FEATURE])).toEqual(["/o", "session", "attach", "--home", HOME, "--detach-key", "C-\\"]);
    expect(viewerArgv("/o", HOME, [NO_STATUS_LINE_FEATURE])).toEqual(["/o", "session", "attach", "--home", HOME, "--no-status-line"]);
    expect(viewerArgv("/o", HOME, ["retire-plan", NO_STATUS_LINE_FEATURE, DETACH_KEY_FEATURE])).toEqual(["/o", "session", "attach", "--home", HOME, "--detach-key", "C-\\", "--no-status-line"]);
  });
  test("a home with spaces is one word of the command (an argv, never a shell line)", () => {
    expect(viewerArgv("/o", "/srv/my deploy/agents/x", [])).toContain("/srv/my deploy/agents/x");
  });
});

describe("where this machine's oats is", () => {
  const files = new Set(["/home/joan/.local/bin/oats", "/usr/bin/oats", "/opt/oats"]);
  const executable = (file: string) => files.has(file);
  test("the setting, where it is an absolute path to an executable", () => {
    expect(resolveBin("/opt/oats", "/usr/bin", executable)).toBe("/opt/oats");
    expect(resolveBin("/opt/none", "/usr/bin", executable)).toBeNull();
    expect(resolveBin("oats", "/usr/bin", executable)).toBeNull(); // never a name: bb's terminal has another PATH
  });
  test("else the first executable `oats` on the PATH, as an absolute path", () => {
    expect(resolveBin("", "/nope:/home/joan/.local/bin:/usr/bin", executable)).toBe("/home/joan/.local/bin/oats");
    expect(resolveBin("", "/usr/bin", executable)).toBe("/usr/bin/oats");
  });
  test("a relative or empty entry of the PATH is never searched; no oats is null", () => {
    expect(resolveBin("", ".::bin:/nope", executable)).toBeNull();
    expect(resolveBin("", undefined, executable)).toBeNull();
  });
});
