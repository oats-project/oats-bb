#!/usr/bin/env node
// Tests only: the provider's `session <verb>` with the sandboxed modes taken
// (sessionHandlers({ sandboxedModes: true })). The provider's own command refuses a launch
// in auto or accept-edits (bb homes run in full mode only: sandboxed modes are not offered);
// the code of those modes is here, and its tests reach it through this entry.
import { sessionHandlers } from "../../oats-package/capabilities/oats-bb/lib/commands.mjs";
import { VERBS, answer, readStdin } from "../../oats-package/capabilities/oats-bb/lib/wire.mjs";

const [command, verb, ...rest] = process.argv.slice(2);
if (command !== "session" || !VERBS.includes(verb) || rest.length > 0) {
  process.stderr.write("sandboxed-bin: session <verb> only\n");
  process.exitCode = 2;
} else {
  let finished = false;
  process.on("exit", (code) => { if (!finished && code === 0) process.exitCode = 1; });
  answer(verb, await readStdin(), sessionHandlers({ sandboxedModes: true })).then((doc) => {
    finished = true;
    process.stdout.write(`${JSON.stringify(doc)}\n`);
  }, (error) => {
    finished = true;
    process.stderr.write(`oats bb: ${error?.message ?? error}\n`);
    process.exitCode = 1;
  });
}
