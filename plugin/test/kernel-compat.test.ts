// The compatible-OATS numbers (kernel/compat.ts): one place, and tied to the kernel the real run pins.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";
import { below, compat, compatibility, DESKTOP_API, OATS_FLOOR, OATS_TESTED_MINOR, versionParts } from "../kernel/compat";
import { parseVersion } from "../kernel/roster";
import { FIXTURES } from "./support/fake-oats.js";

test("the tested minor is the minor of the kernel the real run pins, and the floor is not above it", () => {
  const run = readFileSync(join(__dirname, "..", "container", "real", "run.sh"), "utf8");
  const pinned = /^KERNEL_NPM=\$\{KERNEL_NPM-(\d+\.\d+\.\d+)\}$/m.exec(run)?.[1];
  expect(pinned, "container/real/run.sh pins a kernel as KERNEL_NPM=${KERNEL_NPM-<version>}").toBeTruthy();
  expect(OATS_TESTED_MINOR).toBe(pinned!.split(".").slice(0, 2).join("."));
  expect(compatibility(OATS_FLOOR)).toBe("tested");
  expect(compatibility(pinned)).toBe("tested");
});

test("the plugin's floor is not below the floor of the bb session provider it ships beside", () => {
  // The provider's two manifests (oats-package/, beside plugin/ in the repository; container/ci.sh
  // copies them beside the plugin in the test container). Each says `compatibility.oats: ">=<version>"`.
  const mine = versionParts(OATS_FLOOR)!;
  for (const manifest of ["oats-package.json", join("capabilities", "oats-bb", "oats.json")]) {
    const file = join(__dirname, "..", "..", "oats-package", manifest);
    const declared: unknown = JSON.parse(readFileSync(file, "utf8")).compatibility?.oats;
    const floor = typeof declared === "string" ? /^>=(\d+\.\d+\.\d+)$/.exec(declared)?.[1] : undefined;
    expect(floor, `${file} declares compatibility.oats as ">=<version>" (it says ${JSON.stringify(declared)})`).toBeTruthy();
    // NOT BELOW, while main's manifests are behind the plugin's floor. Once the provider's floor is
    // the plugin's (oats-bb#40 raises it to 0.70.5), this line becomes: expect(floor).toBe(OATS_FLOOR).
    expect(below(mine, versionParts(floor!)!), `the plugin's floor ${OATS_FLOOR} is not below the provider's ${floor} (${manifest})`).toBe(false);
  }
});

test("where an installed OATS stands: older than the floor, tested, newer than tested, or not readable", () => {
  expect(compatibility("0.69.9")).toBe("older");
  expect(compatibility("0.29.0")).toBe("older");
  expect(compatibility("0.70.0")).toBe("older");
  expect(compatibility("0.70.4")).toBe("older");
  expect(compatibility("0.70.5")).toBe("tested");
  expect(compatibility("0.70.12")).toBe("tested");
  expect(compatibility("0.71.0")).toBe("newer");
  expect(compatibility("1.0.0")).toBe("newer");
  expect(compatibility("0.70.6-rc.2")).toBe("tested");
  for (const unreadable of ["", "latest", "v0.70", null, undefined]) expect(compatibility(unreadable)).toBe("unknown");
  expect(versionParts(" 0.70.3 ")).toEqual([0, 70, 3]);
});

test("from the kernel's own version answer: a later version of its JSON answers is said first; the recorded kernel is tested", () => {
  expect(compat({ version: "0.70.5", desktopApi: DESKTOP_API })).toBe("tested");
  expect(compat({ version: "0.70.5", desktopApi: DESKTOP_API + 1 })).toBe("newer-api");
  expect(compat({ version: "0.70.0", desktopApi: DESKTOP_API })).toBe("older");
  expect(compat({ version: "0.69.0", desktopApi: DESKTOP_API + 1 })).toBe("newer-api");
  expect(compat({ version: "0.69.0", desktopApi: null })).toBe("older");
  expect(compat({ version: "0.71.0", desktopApi: 1 })).toBe("newer");
  expect(compat(null)).toBe("unknown");
  // What the real kernel printed (recorded): read through the kernel module, it is one the plugin was tested with.
  const recorded = parseVersion(JSON.parse(readFileSync(join(FIXTURES, "roster", "version.json"), "utf8")).result ?? JSON.parse(readFileSync(join(FIXTURES, "roster", "version.json"), "utf8")));
  if (!recorded.ok) throw new Error(recorded.error.message);
  expect(compat(recorded.value)).toBe("tested");
});
