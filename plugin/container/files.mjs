// Files that one process of a run writes and ANOTHER reads while it runs. Whole files, renamed
// into place (`atomicWrite`): the recording wrapper's settings, the fake oats' settings, pi's
// settings.json in the pi run, Claude Code's state before the tmux part. Logs another process
// appends to, read by their complete lines (`completeLines`): the fake oats' log, the two mocks'
// request logs. A plain write of a whole file empties it first and fills it after: a reader that
// comes between reads nothing, or half ("Unexpected end of JSON input", which failed a real run on
// main). The recording wrapper's RECORDS are written the same way by the wrapper itself
// (real/oats-record.mjs: it is installed alone, and imports nothing of this directory).
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
 *
 * So this reads what WAS asked. That something was NOT asked (an absence: no line of some kind) is
 * asserted only after the act it follows has answered: a line being written at that instant is
 * not in what this returns, and before the act has answered its line may not be written yet.
 */
export function completeLines(file) {
  const text = readFileSync(file, "utf8");
  return text.slice(0, text.lastIndexOf("\n") + 1).split("\n").filter((line) => line !== "");
}
