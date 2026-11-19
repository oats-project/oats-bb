#!/usr/bin/env node
// A fake `bb` for the unit tests: it stands at the provider's one real boundary, bb's CLI.
// It answers from a script (FAKE_BB_SCRIPT, a JSON file) and records every call
// (FAKE_BB_LOG, one JSON line per call: argv, stdin, BB_SERVER_URL). The answers' shapes
// are bb-app 0.50.1's own, copied from a real server; test/contract runs the same provider
// against that real bb, which is what keeps this fake honest.
//
// Script: { "<command words>": <answer> | [<answer>, …] }, the key being the longest
// prefix of the non-option arguments ("thread list", "thread queue delete", "--version").
// An answer is { stdout?: <JSON value or string>, exit?: number, stderr?: string,
// error?: { code, message }, delayMs?: number }. A list is consumed one per call; its
// last answer repeats.
import { appendFileSync, readFileSync, writeFileSync, existsSync } from "node:fs";

const argv = process.argv.slice(2);
const script = JSON.parse(readFileSync(process.env.FAKE_BB_SCRIPT, "utf8"));
const stdin = await new Promise((resolve) => {
  let text = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk) => { text += chunk; });
  process.stdin.on("end", () => resolve(text));
});
appendFileSync(process.env.FAKE_BB_LOG, `${JSON.stringify({ argv, stdin, server: process.env.BB_SERVER_URL ?? null, context: process.env.BB_THREAD_ID ?? null })}\n`);

const words = argv[0] === "--version" ? ["--version"] : argv.filter((arg) => !arg.startsWith("-"));
let key = null;
for (let n = Math.min(words.length, 3); n > 0 && key === null; n -= 1) {
  const candidate = words.slice(0, n).join(" ");
  if (Object.hasOwn(script, candidate)) key = candidate;
}
if (key === null) {
  process.stderr.write(`fake bb: no scripted answer for ${JSON.stringify(argv)}\n`);
  process.exit(97);
}
let answer = script[key];
if (Array.isArray(answer)) {
  const counterFile = `${process.env.FAKE_BB_LOG}.${key.replace(/[^a-z]/g, "_")}.n`;
  const n = existsSync(counterFile) ? Number(readFileSync(counterFile, "utf8")) : 0;
  writeFileSync(counterFile, String(n + 1));
  answer = answer[Math.min(n, answer.length - 1)];
}
if (answer.delayMs) await new Promise((resolve) => setTimeout(resolve, answer.delayMs));
if (answer.error) {
  // bb's documented failure: the envelope on stdout, the readable line on stderr, exit 1.
  process.stderr.write(`Error: ${answer.error.message}\n`);
  process.stdout.write(`${JSON.stringify({ ok: false, error: answer.error }, null, 2)}\n`);
  process.exit(answer.exit ?? 1);
}
if (answer.stderr) process.stderr.write(answer.stderr);
if (answer.stdout !== undefined) process.stdout.write(typeof answer.stdout === "string" ? answer.stdout : `${JSON.stringify(answer.stdout, null, 2)}\n`);
process.exit(answer.exit ?? 0);
