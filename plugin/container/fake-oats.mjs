#!/usr/bin/env node
// A fake `oats` for the plugin's tests: it prints the recorded answer of the verb it is asked
// (test/fixtures/) and logs every call. It stands at the one real boundary the plugin has, the
// `oats` process; the fixtures it prints are recorded from the real kernel or shaped as its
// reference documents them (test/fixtures/README.md).
//
// Configuration: the JSON file named by FAKE_OATS_CONFIG, else `fake-oats.json` beside this script:
//   { "fixtures": "<dir of the fixture files>",
//     "log": "<file: one JSON line per call>",              (optional)
//     "verbs": { "<verb>": { "file": "<feature>/x.json" | "stdout": "…", "exit": 0, "sleepMs": 0, "whileFile": "<file>",
//                            "grandchild": false, "stderr": "…" } } }   (optional overrides)
//
// The verbs it knows are the features' own lists: `<fixtures>/<feature>/verbs.json`, an object
// `{ "<verb>": { "file": "x.json" } }` whose files are beside it. A verb is the command's leading
// words, then the flags that tell it from another verb of the same words: status, "server list",
// "spawn --preview", spawn, "instance stop --plan", "retire --plan", retire. A call is the verb
// with the most words and flags among those whose words lead its argv and whose flags are in it;
// a call no verb matches is named by its first word. The verb "*" overrides every one.
import { spawn } from "node:child_process";
import { appendFileSync, existsSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(realpathSync(fileURLToPath(import.meta.url)));
const config = JSON.parse(readFileSync(process.env.FAKE_OATS_CONFIG ?? join(here, "fake-oats.json"), "utf8"));
const argv = process.argv.slice(2);
const after = (flag) => (argv.includes(flag) ? argv[argv.indexOf(flag) + 1] : undefined);

/** Every feature's verbs, each with its fixture's path from the fixtures directory. */
function featureVerbs() {
  const verbs = {};
  for (const feature of readdirSync(config.fixtures, { withFileTypes: true })) {
    const list = join(config.fixtures, feature.name, "verbs.json");
    if (!feature.isDirectory() || !existsSync(list)) continue;
    for (const [verb, behaviour] of Object.entries(JSON.parse(readFileSync(list, "utf8")))) {
      if (verb in verbs) throw new Error(`fake oats: the verb "${verb}" is in two features' verbs.json`);
      verbs[verb] = { ...behaviour, ...(behaviour.file === undefined ? {} : { file: join(feature.name, behaviour.file) }) };
    }
  }
  return verbs;
}
const defaults = featureVerbs();

function verbOf() {
  let best = argv[0] ?? "";
  let size = 0;
  for (const name of new Set([...Object.keys(defaults), ...Object.keys(config.verbs ?? {})])) {
    const parts = name.split(" ");
    const words = parts.filter((part) => !part.startsWith("--"));
    const flags = parts.filter((part) => part.startsWith("--"));
    if (name === "*" || parts.length <= size) continue;
    if (words.every((word, index) => argv[index] === word) && flags.every((flag) => argv.includes(flag))) {
      best = name;
      size = parts.length;
    }
  }
  return best;
}

const verb = verbOf();
const known = defaults[verb];
const behaviour = { ...known, ...config.verbs?.["*"], ...config.verbs?.[verb] };

const call = { at: new Date().toISOString(), pid: process.pid, verb, argv, cwd: process.cwd() };
const taskFile = after("--task-file");
if (taskFile !== undefined) {
  try {
    call.taskFile = { path: taskFile, mode: (statSync(taskFile).mode & 0o777).toString(8), text: readFileSync(taskFile, "utf8") };
  } catch (error) {
    call.taskFile = { path: taskFile, error: error.code };
  }
}
if (behaviour.grandchild) {
  // A child of this process's own, in its process group: it must not outlive a killed `oats`.
  const child = spawn("sleep", ["600"], { stdio: "ignore" });
  call.grandchild = child.pid;
}
if (config.log) appendFileSync(config.log, `${JSON.stringify(call)}\n`);

function answer() {
  if (behaviour.stderr) process.stderr.write(behaviour.stderr);
  if (known === undefined && behaviour.file === undefined && behaviour.stdout === undefined) {
    process.stdout.write(`${JSON.stringify({ schemaVersion: 1, ok: false, error: { code: "E_UNKNOWN_COMMAND", message: `fake oats: no answer for "${argv.join(" ")}"` } })}\n`);
    process.exit(1);
  }
  const text = behaviour.stdout ?? readFileSync(join(config.fixtures, behaviour.file), "utf8");
  let exit = behaviour.exit;
  if (exit === undefined) {
    // Like the kernel: a refusal exits nonzero.
    try {
      exit = JSON.parse(text).ok === false ? 1 : 0;
    } catch {
      exit = 0;
    }
  }
  process.stdout.write(text, () => process.exit(exit));
}

// `whileFile`: the answer WAITS for as long as that file is there (a test holds a read in flight by it, and lets it
// go by removing the file: a gate, where `sleepMs` is a length of time a test would then have to race).
if (behaviour.whileFile) {
  const gate = setInterval(() => {
    if (existsSync(behaviour.whileFile)) return;
    clearInterval(gate);
    answer();
  }, 10);
} else if (behaviour.sleepMs) setTimeout(answer, behaviour.sleepMs);
else answer();
