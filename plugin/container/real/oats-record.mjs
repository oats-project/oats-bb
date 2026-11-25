#!/usr/bin/env node
// The recording wrapper of the real run (container/real/README.md): the plugin's `oatsBin` setting
// names this file, so every `oats` the plugin runs goes through it. It runs the real `oats` with
// the same arguments, directory and input, passes its output and exit code through unchanged, and
// keeps one file per call: what the plugin asked and what the kernel printed. The fixtures in
// test/fixtures/ are made from those files (fixtures.mjs).
//
// Configuration: `oats-record.json` beside this file:
//   { "oats": "<the real oats>", "records": "<directory>", "path": "<PATH for oats>",
//     "delayMs": 0,                      wait this long before every call ("oats taking seconds")
//     "delays": { "<first word>": ms } } or before the calls of one command (status, spawn, …)
import { spawn } from "node:child_process";
import { mkdirSync, readFileSync, readdirSync, realpathSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(realpathSync(fileURLToPath(import.meta.url)));
const config = JSON.parse(readFileSync(join(here, "oats-record.json"), "utf8"));
const argv = process.argv.slice(2);
const startedAt = new Date();
const delayMs = config.delays?.[argv[0] ?? ""] ?? config.delayMs ?? 0;

function run() {
  const env = { ...process.env, ...(config.path ? { PATH: config.path } : {}) };
  // Same process group as this wrapper: the plugin stops a call by signalling the group.
  const child = spawn(config.oats, argv, { cwd: process.cwd(), env, stdio: ["inherit", "pipe", "pipe"] });
  // Kept as bytes and decoded once at the end: a chunk can end in the middle of a character.
  const stdout = [];
  const stderr = [];
  child.stdout.on("data", (chunk) => {
    stdout.push(chunk);
    process.stdout.write(chunk);
  });
  child.stderr.on("data", (chunk) => {
    stderr.push(chunk);
    process.stderr.write(chunk);
  });
  child.on("error", (error) => {
    process.stderr.write(`oats-record: ${config.oats} could not be started: ${error.message}\n`);
    process.exit(127);
  });
  child.on("close", (code, signal) => {
    mkdirSync(config.records, { recursive: true });
    const n = String(readdirSync(config.records).filter((name) => name.endsWith(".json")).length + 1).padStart(4, "0");
    const words = argv.filter((word) => /^[a-z-]+$/.test(word)).slice(0, 3).join("-") || "none";
    const record = { at: startedAt.toISOString(), ms: Date.now() - startedAt.getTime(), delayMs, argv, cwd: process.cwd(), exit: code, signal, stdout: Buffer.concat(stdout).toString("utf8"), stderr: Buffer.concat(stderr).toString("utf8") };
    // Written whole beside its place, then renamed into it: the run reads this directory while the
    // plugin's calls end (scenario.mjs `records`), and a record it finds must be a whole one. The
    // name being written does not end in `.json`, so no reader takes it for a record.
    const file = join(config.records, `${n}-${process.pid}-${words}.json`);
    writeFileSync(`${file}.writing`, `${JSON.stringify(record, null, 1)}\n`);
    renameSync(`${file}.writing`, file);
    // Let the pipes drain before leaving with the kernel's own exit code.
    process.stdout.write("", () => process.exit(code ?? 1));
  });
}

if (delayMs > 0) setTimeout(run, delayMs);
else run();
