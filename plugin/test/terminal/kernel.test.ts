// The viewer's command, and where this machine's `oats` is (kernel/terminal.ts).
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { DETACH_KEY_FEATURE, isExecutable, NO_STATUS_LINE_FEATURE, resolveBin, viewerArgv } from "../../kernel/terminal";

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
  test("on a real disk: an executable FILE is one; a directory of that name is passed over, as a spawn passes it over", () => {
    const root = mkdtempSync(join(tmpdir(), "bb-plugin-oats-terminal-"));
    try {
      // `<root>/work/oats` is a checkout (a directory, which anyone may enter); `<root>/bin/oats` is the command.
      mkdirSync(join(root, "work", "oats"), { recursive: true });
      mkdirSync(join(root, "bin"));
      writeFileSync(join(root, "bin", "oats"), "#!/bin/sh\n");
      chmodSync(join(root, "bin", "oats"), 0o755);
      writeFileSync(join(root, "bin", "plain"), "not a command\n");
      chmodSync(join(root, "bin", "plain"), 0o644);
      expect([isExecutable(join(root, "work", "oats")), isExecutable(join(root, "bin", "oats")), isExecutable(join(root, "bin", "plain")), isExecutable(join(root, "none"))]).toEqual([false, true, false, false]);
      expect(resolveBin("", `${join(root, "work")}:${join(root, "bin")}`)).toBe(join(root, "bin", "oats"));
      expect(resolveBin(join(root, "work", "oats"), "")).toBeNull();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
  test("a relative or empty entry of the PATH is never searched; no oats is null", () => {
    expect(resolveBin("", ".::bin:/nope", executable)).toBeNull();
    expect(resolveBin("", undefined, executable)).toBeNull();
  });
});
