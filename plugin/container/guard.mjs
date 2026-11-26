// IMPORTED FIRST, before any other import, by every .mjs entry of this directory that changes the machine it runs
// on:  import "./guard.mjs";
// The same rule as guard.sh (read it): refused with one line and a non-zero exit, before anything is touched,
// wherever the mark of the checks' image is not. An import of this file is the whole guard: it has no export.
import { statSync } from "node:fs";
import { basename } from "node:path";

// (A FILE, as guard.sh's `-f` has it: a directory of that name is no mark.)
if (!(statSync("/etc/oats-bb-checks-image", { throwIfNoEntry: false })?.isFile() ?? false) || process.env.OATS_BB_CHECKS_MARK_ABSENT === "1") {
  process.stderr.write(`refused: ${basename(process.argv[1] ?? "this script")} runs only inside the container of the oats-bb plugin checks (it changes the machine it runs on); start it with plugin/container/ci.sh, never by hand\n`);
  process.exit(97);
}
