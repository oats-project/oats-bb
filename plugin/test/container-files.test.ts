// The harnesses' files that one process writes and another reads while it runs (container/files.mjs):
// a whole file is renamed into place, and a log is read by its complete lines.
import { appendFileSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, beforeEach, expect, test } from "vitest";

interface Files {
  atomicWrite(file: string, content: string): void;
  completeLines(file: string): string[];
}
const files = (): Promise<Files> => import(pathToFileURL(join(__dirname, "..", "container", "files.mjs")).href) as Promise<Files>;

let dir = "";
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "container-files-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

test("a file written whole is the new content, with nothing left beside it; the old content stands until then", async () => {
  const { atomicWrite } = await files();
  const file = join(dir, "settings.json");
  writeFileSync(file, '{"old":true}');
  atomicWrite(file, '{"new":true}');
  expect(readFileSync(file, "utf8")).toBe('{"new":true}');
  expect(readdirSync(dir), "no file is left beside it").toEqual(["settings.json"]);
  // The first write of a file that was not there.
  atomicWrite(join(dir, "first.json"), "{}");
  expect(existsSync(join(dir, "first.json"))).toBe(true);
});

test("a log is read by its complete lines: a last line still being written is left for the next read", async () => {
  const { completeLines } = await files();
  const log = join(dir, "requests.jsonl");
  writeFileSync(log, "");
  expect(completeLines(log)).toEqual([]);
  appendFileSync(log, '{"n":1}\n{"n":2}\n');
  expect(completeLines(log)).toEqual(['{"n":1}', '{"n":2}']);
  // Half a record, as a reader finds it while the writer is at it.
  appendFileSync(log, '{"n":3,"at":"20');
  expect(completeLines(log)).toEqual(['{"n":1}', '{"n":2}']);
  appendFileSync(log, '26"}\n');
  expect(completeLines(log).map((line) => (JSON.parse(line) as { n: number }).n)).toEqual([1, 2, 3]);
});

test("a complete line that is not a record is not skipped: it is handed on, and fails where it is parsed", async () => {
  const { completeLines } = await files();
  const log = join(dir, "requests.jsonl");
  writeFileSync(log, '{"n":1}\nnot a record\n');
  const lines = completeLines(log);
  expect(lines).toEqual(['{"n":1}', "not a record"]);
  expect(() => lines.map((line) => JSON.parse(line) as unknown)).toThrow();
});
