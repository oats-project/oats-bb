// The compatible-OATS numbers (kernel/compat.ts): one place, and tied to the kernel the real run pins.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";
import { compatibility, OATS_FLOOR, OATS_TESTED_MINOR, versionParts } from "../kernel/compat";

test("the tested minor is the minor of the kernel the real run pins, and the floor is not above it", () => {
  const run = readFileSync(join(__dirname, "..", "container", "real", "run.sh"), "utf8");
  const pinned = /^KERNEL_NPM=\$\{KERNEL_NPM-(\d+\.\d+\.\d+)\}$/m.exec(run)?.[1];
  expect(pinned, "container/real/run.sh pins a kernel as KERNEL_NPM=${KERNEL_NPM-<version>}").toBeTruthy();
  expect(OATS_TESTED_MINOR).toBe(pinned!.split(".").slice(0, 2).join("."));
  expect(compatibility(OATS_FLOOR)).toBe("tested");
  expect(compatibility(pinned)).toBe("tested");
});

test("where an installed OATS stands: older than the floor, tested, newer than tested, or not readable", () => {
  expect(compatibility("0.69.9")).toBe("older");
  expect(compatibility("0.29.0")).toBe("older");
  expect(compatibility("0.70.0")).toBe("tested");
  expect(compatibility("0.70.3")).toBe("tested");
  expect(compatibility("0.71.0")).toBe("newer");
  expect(compatibility("1.0.0")).toBe("newer");
  expect(compatibility("0.70.1-rc.2")).toBe("tested");
  for (const unreadable of ["", "latest", "v0.70", null, undefined]) expect(compatibility(unreadable)).toBe("unknown");
  expect(versionParts(" 0.70.3 ")).toEqual([0, 70, 3]);
});
