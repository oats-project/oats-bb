#!/usr/bin/env node
// oats.bb: the bb session provider. `session <verb>` is the kernel's to call (JSON in on
// stdin, one JSON document out); `retire-hook` is its retire hook; `doctor` is a person's.
import { sessionHandlers } from "../lib/commands.mjs";
import { bounded } from "../lib/errors.mjs";
import { removeLaunchSettings } from "../lib/local-settings.mjs";
import { FULL_MODE_ONLY, readinessResult } from "../lib/readiness.mjs";
import { readSettings } from "../lib/settings.mjs";
import { retire } from "../lib/stop.mjs";
import { PROVIDER, VERBS, answer, readStdin, settingsFromEnv } from "../lib/wire.mjs";

// The command takes no launch in a sandboxed mode yet (lib/commands.mjs says why).
const handlers = sessionHandlers();
/** doctor's arguments: `--json`, and `--soul <name>`, which the kernel reads to choose
 *  whose settings it resolves into OATS_SETTINGS and then forwards: it changes nothing
 *  here. → {json} | null for anything else. */
function doctorArgs(args) {
  let json = false;
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === "--json") json = true;
    else if (args[i] === "--soul" && typeof args[i + 1] === "string" && !args[i + 1].startsWith("--")) i += 1;
    else if (!/^--soul=.+/.test(args[i])) return null;
  }
  return { json };
}
// Every line a hook prints: a warning is cut to what the kernel relays.
const print = (doc) => process.stdout.write(`${JSON.stringify(typeof doc?.warning === "string" ? { ...doc, warning: bounded(doc.warning) } : doc)}\n`);

const USAGE = `oats bb: the bb session provider (oats.bb)

  oats bb doctor [--json] [--soul <name>]
                             check this deployment's bb: server, host daemon, version,
                             exposure, trust, bb's claude-code provider, orphaned threads
                             (--soul: whose settings to read; the kernel resolves them)

Called by the kernel (JSON on stdin, one JSON document on stdout):
  session launch | inspect | inspectMany | input | stop | check
  launch-hook                on another backend, removes what the provider wrote into the home
  retire-hook                archives the home's bb threads at retire
`;

async function main(argv) {
  const [command, ...rest] = argv;
  if (command === "session" && VERBS.includes(rest[0]) && rest.length === 1) {
    print(await answer(rest[0], await readStdin(), handlers));
    return 0;
  }
  if (command === "launch-hook" && rest.length === 0) {
    // Runs at every start of a home that has this capability, whatever its backend. On
    // this provider the launch verb writes Claude's local settings. On any other backend
    // the home has stopped being a provider home: what the provider wrote is removed, so
    // a tmux Claude neither reads a stale launch env nor keeps the sandbox allowances.
    const home = process.env.OATS_INSTANCE_HOME, backend = process.env.OATS_BACKEND;
    if (!home) { process.stderr.write("oats bb launch-hook: OATS_INSTANCE_HOME is not set\n"); return 2; }
    if (!backend || backend === PROVIDER || process.env.OATS_LAUNCH_PREVIEW === "1") return 0;
    try {
      if (removeLaunchSettings(home)) print({ warning: `this home starts on ${backend}, no longer on bb: the bb provider removed what it had written into .claude/settings.local.json (its launch env and sandbox allowances)` });
    } catch (error) {
      print({ warning: `the bb provider could not remove what it wrote into .claude/settings.local.json (${error?.message ?? error}); remove its env and sandbox entries by hand` });
    }
    return 0;
  }
  if (command === "retire-hook" && rest.length === 0) {
    const home = process.env.OATS_INSTANCE_HOME;
    if (!home) { process.stderr.write("oats bb retire-hook: OATS_INSTANCE_HOME is not set\n"); return 2; }
    // The settings are read inside retire, where a failure to read them or to reach bb is
    // kept quiet for a home the provider shows no sign of having launched (a tmux home).
    print(await retire(home, () => readSettings(settingsFromEnv(process.env)), { deadline: Date.now() + 40_000 }));
    return 0;
  }
  const doctor = command === "doctor" ? doctorArgs(rest) : null;
  if (doctor !== null) {
    const { result, credential } = await readinessResult(readSettings(settingsFromEnv(process.env)));
    result.warnings.push({ ...FULL_MODE_ONLY });
    if (doctor.json) print({ ...result, credential });
    else {
      process.stdout.write(`bb session provider: ${result.status}\n`);
      for (const problem of result.problems) process.stdout.write(`  problem ${problem.code}: ${problem.message}\n`);
      for (const warning of result.warnings) process.stdout.write(`  warning ${warning.code}: ${warning.message}\n`);
      if (credential) process.stdout.write(`  claude-code credential: ${credential}\n`);
    }
    return result.status === "ready" ? 0 : 1;
  }
  if (command === undefined || command === "--help" || command === "-h" || command === "help") { process.stdout.write(USAGE); return 0; }
  process.stderr.write(`oats bb: unknown command ${JSON.stringify(argv.join(" "))}\n\n${USAGE}`);
  return 2;
}

// A rejection here is an outcome in doubt (or a bug): nothing on stdout, a nonzero exit.
// So is a process that runs out of work before main has finished (a wait that nothing
// keeps alive): it must never end with status 0 and no answer, which reads as success.
let finished = false;
process.on("exit", (code) => {
  if (finished || code !== 0) return;
  process.stderr.write("oats bb: ended before it had an answer\n");
  process.exitCode = 1;
});
main(process.argv.slice(2)).then((code) => { finished = true; process.exitCode = code; }, (error) => {
  finished = true;
  process.stderr.write(`oats bb: ${error?.message ?? error}\n`);
  process.exitCode = 1;
});
