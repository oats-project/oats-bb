#!/usr/bin/env node
// Tests only: the provider's `session <verb>` two minutes from now
// (sessionHandlers({ now })). The pi model check refuses nothing where pi's configuration
// changed in the last minute and a half (bb's list may be older than it), and a test
// writes that configuration a moment before it calls: through this entry the call is made
// as it would be once that time has passed. The provider's own command reads the clock.
import { sessionHandlers } from "../../oats-package/capabilities/oats-bb/lib/commands.mjs";
import { VERBS, answer, readStdin } from "../../oats-package/capabilities/oats-bb/lib/wire.mjs";

const LATER_MS = 120_000;
const [command, verb, ...rest] = process.argv.slice(2);
if (command !== "session" || !VERBS.includes(verb) || rest.length > 0) {
  process.stderr.write("later-bin: session <verb> only\n");
  process.exitCode = 2;
} else {
  let finished = false;
  process.on("exit", (code) => { if (!finished && code === 0) process.exitCode = 1; });
  answer(verb, await readStdin(), sessionHandlers({ now: () => Date.now() + LATER_MS })).then((doc) => {
    finished = true;
    process.stdout.write(`${JSON.stringify(doc)}\n`);
  }, (error) => {
    finished = true;
    process.stderr.write(`oats bb: ${error?.message ?? error}\n`);
    process.exitCode = 1;
  });
}
