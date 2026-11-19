#!/usr/bin/env node
// oats.bb: the bb session provider. Every subcommand but `doctor` and the retire hook is
// the kernel's to call: JSON in on stdin, one JSON document out.
import { inspect, inspectMany } from "../lib/inspect.mjs";
import { sendInput } from "../lib/input.mjs";
import { launch } from "../lib/launch.mjs";
import { readinessResult } from "../lib/readiness.mjs";
import { readSettings } from "../lib/settings.mjs";
import { retire, stop } from "../lib/stop.mjs";
import { PHASES, answerCheck, answerSession, readStdin, settingsOf } from "../lib/wire.mjs";

const withSettings = (run) => (input, rawSettings, options) => run(input, readSettings(rawSettings), options);
const handlers = {
  launch: withSettings(launch),
  inspect: withSettings(inspect),
  inspectMany: withSettings(inspectMany),
  input: withSettings(sendInput),
  stop: withSettings(stop),
};
const print = (doc) => process.stdout.write(`${JSON.stringify(doc)}\n`);

const USAGE = `oats bb: the bb session provider (oats.bb)

  oats bb doctor [--json]    check this deployment's bb: server, host daemon, version,
                             exposure, trust, bb's claude-code provider, orphaned threads

Called by the kernel (JSON on stdin, one JSON document on stdout):
  session launch | inspect | inspectMany | input | stop
  check                      the readiness check
  retire-hook                archives the home's bb threads at retire
`;

async function main(argv) {
  const [command, ...rest] = argv;
  if (command === "session" && PHASES.includes(rest[0]) && rest.length === 1) {
    print(await answerSession(rest[0], await readStdin(), handlers));
    return 0;
  }
  if (command === "check" && rest.length === 0) {
    print(await answerCheck(await readStdin(), (rawSettings, options) => readinessResult(readSettings(rawSettings), options)));
    return 0;
  }
  if (command === "retire-hook" && rest.length === 0) {
    const home = process.env.OATS_INSTANCE_HOME;
    if (!home) { process.stderr.write("oats bb retire-hook: OATS_INSTANCE_HOME is not set\n"); return 2; }
    print(await retire(home, readSettings(settingsOf(null, process.env)), { deadline: Date.now() + 40_000 }));
    return 0;
  }
  if (command === "doctor" && rest.every((arg) => arg === "--json")) {
    const result = await readinessResult(readSettings(settingsOf(null, process.env)));
    if (rest.includes("--json")) print(result);
    else {
      process.stdout.write(`bb session provider: ${result.status}\n`);
      for (const problem of result.problems) process.stdout.write(`  problem ${problem.code}: ${problem.message}\n`);
      for (const warning of result.warnings) process.stdout.write(`  warning ${warning.code}: ${warning.message}\n`);
    }
    return result.status === "ready" ? 0 : 1;
  }
  if (command === undefined || command === "--help" || command === "-h" || command === "help") { process.stdout.write(USAGE); return 0; }
  process.stderr.write(`oats bb: unknown command ${JSON.stringify(argv.join(" "))}\n\n${USAGE}`);
  return 2;
}

main(process.argv.slice(2)).then((code) => { process.exitCode = code; }, (error) => {
  process.stderr.write(`oats bb: ${error?.message ?? error}\n`);
  process.exitCode = 1;
});
