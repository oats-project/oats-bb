// The harnesses' files that one process writes and another reads while it runs (container/files.mjs):
// a whole file is renamed into place, a log is read by its complete lines, and a file a process
// that is not ours writes is read by a wait for a whole one.
import { execFileSync } from "node:child_process";
import { appendFileSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, beforeEach, expect, test } from "vitest";

interface Files {
  atomicWrite(file: string, content: string): void;
  completeLines(file: string): string[];
  wholeJson(file: string, seconds?: number): unknown;
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

test("a file another's process writes is read whole at once when it is whole", async () => {
  const { wholeJson } = await files();
  const file = join(dir, "state.json");
  writeFileSync(file, '{"theme":"dark"}');
  expect(wholeJson(file)).toEqual({ theme: "dark" });
});

test("a file found half written is read again until it is whole", () => {
  // The read waits without a promise, so the writer is another process: it finishes the file 300 ms in.
  const file = join(dir, "state.json");
  writeFileSync(file, '{"theme":"da');
  const reader = `import { spawn } from "node:child_process"; import { pathToFileURL } from "node:url";
    const { wholeJson } = await import(pathToFileURL(process.argv[2]).href);
    spawn(process.execPath, ["-e", "setTimeout(() => require('node:fs').writeFileSync(process.argv[1], JSON.stringify({ theme: 'dark' })), 300)", process.argv[3]], { stdio: "ignore" });
    const started = Date.now(); const value = wholeJson(process.argv[3], 5);
    console.log(JSON.stringify({ value, waited: Date.now() - started >= 200 }));`;
  const script = join(dir, "reader.mjs");
  writeFileSync(script, reader);
  const out = execFileSync(process.execPath, [script, join(__dirname, "..", "container", "files.mjs"), file], { encoding: "utf8" });
  expect(JSON.parse(out) as unknown).toEqual({ value: { theme: "dark" }, waited: true });
});

test("a file that stays broken fails the read, with its name, its length and the parser's word: it is not skipped, and not taken for an empty one", async () => {
  const { wholeJson } = await files();
  const file = join(dir, "state.json");
  writeFileSync(file, '{"theme":"da');
  const started = Date.now();
  expect(() => wholeJson(file, 0.3)).toThrow(/state\.json did not parse in 0\.3 s \(another process writes it\): Unterminated string in JSON at position 12 .*It held 12 characters\.$/);
  expect(Date.now() - started, "it waited its time out first").toBeGreaterThanOrEqual(300);
});

test("the failure says nothing of what the file held: it is another program's state, and the message goes into a log", async () => {
  const { wholeJson } = await files();
  const file = join(dir, "state.json");
  // Each a way the parser can stop; the fourth is the one where the parser itself quotes the text.
  for (const held of ['{"key":"SECRETWORD', '{"key":"SECRETWORD"}}', '{"key":"SECRETWORD" x', '{"key": SECRETWORD}', "SECRETWORD"]) {
    writeFileSync(file, held);
    let said = "";
    try {
      wholeJson(file, 0);
    } catch (error) {
      said = (error as Error).message;
    }
    expect(said, held).toContain(`It held ${held.length} characters.`);
    expect(said, held).not.toMatch(/SECRET|key/);
  }
});
