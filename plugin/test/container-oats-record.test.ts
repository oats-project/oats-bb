// The real run's recording wrapper (container/real/oats-record.mjs) writes each record whole: the
// run reads the records' directory while the plugin's calls end, and a record it finds parses.
import { execFileSync } from "node:child_process";
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test } from "vitest";

const WRAPPER = join(__dirname, "..", "container", "real", "oats-record.mjs");
let dir = "";
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "oats-record-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** The wrapper installed alone, as the real run installs it, over an `oats` that prints `answer`. */
function install(answer: string): { wrapper: string; records: string } {
  const wrapper = join(dir, "oats-record");
  const records = join(dir, "records");
  const oats = join(dir, "oats");
  copyFileSync(WRAPPER, wrapper);
  writeFileSync(oats, `#!/bin/sh\nprintf '%s' '${answer}'\n`);
  chmodSync(oats, 0o755);
  writeFileSync(join(dir, "oats-record.json"), JSON.stringify({ oats, records }));
  return { wrapper, records };
}

test("a call's record is one whole .json file, with what was asked and what was printed; nothing is left beside it", () => {
  const { wrapper, records } = install('{"ok":true}');
  const printed = execFileSync(process.execPath, [wrapper, "status", "--json"], { encoding: "utf8" });
  expect(printed, "the answer is passed through").toBe('{"ok":true}');
  const names = readdirSync(records);
  expect(names).toHaveLength(1);
  expect(names[0], "a record's name ends in .json, and its number is the first").toMatch(/^0001-\d+-status---json\.json$/);
  const record = JSON.parse(readFileSync(join(records, names[0]!), "utf8")) as { argv: string[]; exit: number; stdout: string };
  expect(record.argv).toEqual(["status", "--json"]);
  expect(record.exit).toBe(0);
  expect(record.stdout).toBe('{"ok":true}');
});

test("a file still being written is not a record: it is not counted for the next record's number, and is left as it is", () => {
  const { wrapper, records } = install("{}");
  mkdirSync(records);
  // Half a record of another call, as a killed wrapper leaves it: its name does not end in .json.
  writeFileSync(join(records, "0001-1-status.json.writing"), '{"at":"20');
  execFileSync(process.execPath, [wrapper, "status"], { encoding: "utf8" });
  const names = readdirSync(records).sort();
  expect(names.filter((name) => name.endsWith(".json")), "one record, numbered by the records alone").toHaveLength(1);
  expect(names.find((name) => name.endsWith(".json"))).toMatch(/^0001-/);
  expect(names).toContain("0001-1-status.json.writing");
  expect(names.filter((name) => name.endsWith(".writing")), "the wrapper's own file being written is gone: renamed into place").toEqual(["0001-1-status.json.writing"]);
  for (const name of names.filter((each) => each.endsWith(".json"))) expect(() => JSON.parse(readFileSync(join(records, name), "utf8")) as unknown).not.toThrow();
});
