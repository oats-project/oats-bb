#!/usr/bin/env node
// A stand-in for bb-app's bridge worker in the unit tests, under its own file name: bb's
// host daemon runs one `node …/bb-provider-bridge-worker.mjs <artifact> provider-<id> <data
// dir>` per thread, and the thread's harness is its direct child. That parent is how the
// provider tells a harness bb started from one an agent left running (lib/processes.mjs).
// The real tree is pinned by test/contract.
//
//   node bb-provider-bridge-worker.mjs <artifact> provider-<id> <data dir> <harness command> <thread id> <cwd>
//
// It starts the harness (BB_THREAD_ID=<thread id> in its environment and no other, as the
// tests' own harness processes have), prints its pid, and stays. SIGTERM ends the harness,
// then this.
import { spawn } from "node:child_process";

const [command, threadId, cwd] = process.argv.slice(5);
const child = spawn(command, ["-e", "setTimeout(() => {}, 600000)"], { env: { BB_THREAD_ID: threadId }, stdio: "ignore", cwd });
child.once("spawn", () => process.stdout.write(`${child.pid}\n`));
child.once("exit", () => process.exit(0));
process.on("SIGTERM", () => child.kill("SIGKILL"));
