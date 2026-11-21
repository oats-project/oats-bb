#!/usr/bin/env node
// TRIAL ONLY (test/contract/kernel/setup.sh puts it in place of the provider's command in
// a package that is never pushed): `session <verb>` goes to the tests' entry, which takes
// the sandboxed modes, and each request the kernel sends is kept, so the run can read what
// a real kernel hands the provider. Everything else is the provider's own command.
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const [command, verb] = process.argv.slice(2);
const kept = process.env.KERNEL_RUN_REQUESTS ?? "/home/node/kernel-run/requests";
if (command === "session") {
  const request = readFileSync(0);
  mkdirSync(kept, { recursive: true });
  writeFileSync(join(kept, `${String(readdirSync(kept).length + 1).padStart(4, "0")}-${verb}.json`), request);
  const run = spawnSync(process.execPath, [join(here, "../trial/sandboxed-bin.mjs"), ...process.argv.slice(2)], { input: request, stdio: ["pipe", "inherit", "inherit"] });
  process.exit(run.status ?? 1);
}
const run = spawnSync(process.execPath, [join(here, "oats-bb-shipped.mjs"), ...process.argv.slice(2)], { stdio: "inherit" });
process.exit(run.status ?? 1);
