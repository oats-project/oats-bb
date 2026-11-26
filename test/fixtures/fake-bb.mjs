#!/usr/bin/env node
// A fake `bb` for the unit tests: it stands at the provider's one real boundary, bb's CLI.
// It answers from a script (FAKE_BB_SCRIPT, a JSON file) and records every call
// (FAKE_BB_LOG, one JSON line per call: argv, stdin, BB_SERVER_URL, BB_HOST_DAEMON_PORT). The answers' shapes
// are bb-app 0.50.1's own, copied from a real server; test/contract runs the same provider
// against that real bb, which is what keeps this fake honest.
//
// Script: { "<command words>": <answer> | [<answer>, …] }, the key being the longest
// prefix of the non-option arguments ("thread list", "thread queue delete", "--version").
// An answer is { stdout?: <JSON value or string>, exit?: number, stderr?: string,
// error?: { code, message }, delayMs?: number, launcherChildMs?: number }. A list is consumed one per call; its
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
appendFileSync(process.env.FAKE_BB_LOG, `${JSON.stringify({ argv, stdin, server: process.env.BB_SERVER_URL ?? null, context: process.env.BB_THREAD_ID ?? null, hostDaemonPort: process.env.BB_HOST_DAEMON_PORT ?? null })}\n`);

const words = argv[0] === "--version" ? ["--version"] : argv.filter((arg) => !arg.startsWith("-"));
let key = null;
// The archived threads of a project are another read than the server's threads: keyed
// apart, so a test's list of "thread list" answers stays the plain read's.
const archivedRead = argv[0] === "thread" && argv[1] === "list" && argv.includes("--archived");
if (archivedRead) key = Object.hasOwn(script, "thread list --archived") ? "thread list --archived" : null;
// So are the threads on one environment (the retire hook's read before it deletes one).
const environmentRead = argv[0] === "thread" && argv[1] === "list" && argv.includes("--environment");
if (environmentRead) key = Object.hasOwn(script, "thread list --environment") ? "thread list --environment" : null;
for (let n = Math.min(words.length, 3); n > 0 && key === null && !archivedRead && !environmentRead; n -= 1) {
  const candidate = words.slice(0, n).join(" ");
  if (Object.hasOwn(script, candidate)) key = candidate;
}
// Two reads every stop and launch make have an answer when a test scripts none: a project
// with no archived thread, a thread with nothing held in line.
if (key === null && (archivedRead || words.slice(0, 3).join(" ") === "thread queue list")) {
  process.stdout.write("[]\n");
  process.exit(0);
}
// The read readiness makes where the deployment names its host daemon's port: the server's
// hosts. One, connected: the host the fake daemon of test/fixtures/harness.mjs says it is.
if (key === null && words.slice(0, 2).join(" ") === "host list") {
  process.stdout.write(`${JSON.stringify([{ id: "host_1", name: "checks", type: "persistent", status: "connected", lifecycle: { phase: "active" }, maxPermissionMode: "full", lastSeenAt: 1 }])}\n`);
  process.exit(0);
}
// And the read every retire and every move off bb makes: a project bb holds no env for.
if (key === null && words.slice(0, 3).join(" ") === "machine env list") {
  process.stdout.write(`${JSON.stringify({ variables: [], inheritedVariables: [] })}\n`);
  process.exit(0);
}
// And the read a retire makes of the environment each of the home's threads is on: one
// bb has destroyed already (its row at 0.50.1, trimmed), so there is nothing to delete.
if (key === null && words.slice(0, 2).join(" ") === "environment show") {
  process.stdout.write(`${JSON.stringify({ id: words[2], name: null, projectId: "proj_a", hostId: "host_1", path: null, status: "destroyed", environmentProviderId: "project-checkout", lifecycle: { phase: "destroyed", retireAt: null, teardown: { status: "removed", attempt: 1 } }, managed: false, workspaceProvisionType: "unmanaged" })}\n`);
  process.exit(0);
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
if (answer.launcherChildMs) {
  // As the real `bb`: a launcher whose child holds the same pipes. The child's pid goes
  // to the log, so a test can see whether a timeout ended it too.
  const { spawn } = await import("node:child_process");
  const child = spawn(process.execPath, ["-e", `setTimeout(() => {}, ${Number(answer.launcherChildMs)})`], { stdio: "inherit" });
  appendFileSync(process.env.FAKE_BB_LOG, `${JSON.stringify({ childPid: child.pid })}\n`);
  await new Promise((resolve) => child.on("close", resolve));
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
