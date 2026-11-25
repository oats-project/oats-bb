// Files that one process of a run writes and ANOTHER reads while it runs (the harnesses' own:
// the recording wrapper's records and its settings, the fake oats' settings, the mocks' request
// logs). A plain write of a whole file empties it first and fills it after: a reader that comes
// between reads nothing, or half ("Unexpected end of JSON input", which failed a real run on main).
import { readFileSync, renameSync, writeFileSync } from "node:fs";

/**
 * Writes a whole file so that a reader sees the old content or the new, never part of either:
 * the content goes to a file beside it (`<file>.writing`, the same directory, so the rename is
 * within one file system), which is then renamed over it.
 */
export function atomicWrite(file, content) {
  const writing = `${file}.writing`;
  writeFileSync(writing, content);
  renameSync(writing, file);
}

/**
 * The lines of a log another process appends to, one record a line: the COMPLETE lines, each
 * ended by its newline. A last line with no newline yet is a record still being written, and is
 * left for the next read; a complete line that is not what it should be still fails where it is
 * parsed (nothing is skipped for not parsing).
 */
export function completeLines(file) {
  const text = readFileSync(file, "utf8");
  return text.slice(0, text.lastIndexOf("\n") + 1).split("\n").filter((line) => line !== "");
}
