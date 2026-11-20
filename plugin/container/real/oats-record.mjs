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
import { mkdirSync, readFileSync, readdirSync, realpathSync, writeFileSync } from "node:fs";
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
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => {
    stdout += chunk;
    process.stdout.write(chunk);
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
    process.stderr.write(chunk);
  });
  child.on("error", (error) => {
    process.stderr.write(`oats-record: ${config.oats} could not be started: ${error.message}\n`);
    process.exit(127);
  });
  child.on("close", (code, signal) => {
    mkdirSync(config.records, { recursive: true });
    const n = String(readdirSync(config.records).length + 1).padStart(4, "0");
    const words = argv.filter((word) => /^[a-z-]+$/.test(word)).slice(0, 3).join("-") || "none";
    const record = { at: startedAt.toISOString(), ms: Date.now() - startedAt.getTime(), delayMs, argv, cwd: process.cwd(), exit: code, signal, stdout, stderr };
    writeFileSync(join(config.records, `${n}-${process.pid}-${words}.json`), `${JSON.stringify(record, null, 1)}\n`);
    // Let the pipes drain before leaving with the kernel's own exit code.
    process.stdout.write("", () => process.exit(code ?? 1));
  });
}

if (delayMs > 0) setTimeout(run, delayMs);
else run();
