// The launch environment of a Claude home under bb (contract item 6): written into the
// home's `.claude/settings.local.json` `env`, which Claude Code applies to its own process,
// its tools and its hooks. bb runs Claude with the `local` setting source and cwd = the
// home, so nothing of it reaches bb's database. No secret goes into the file.
import { chmodSync, existsSync, lstatSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { fail, isObject } from "./errors.mjs";

const NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
export const STATE_DIR = ".oats-bb";
const OWNED_FILE = "launch-env.json";

/** The launch input's env as a name → value map, or a refusal naming the entry: one whose
 *  `secret` is not exactly false (E_BACKEND_LAUNCH_ENV: a secret would sit in a file and
 *  in Claude's process for every tool to read), or one this file cannot carry. */
export function readLaunchEnv(env) {
  if (env === undefined || env === null) return {};
  if (!Array.isArray(env)) throw fail("E_BACKEND_LAUNCH_ENV", "the launch env must be a list of {name, value, source, secret}");
  const out = {};
  for (const entry of env) {
    if (!isObject(entry) || typeof entry.name !== "string") throw fail("E_BACKEND_LAUNCH_ENV", "a launch env entry has no name");
    const from = typeof entry.source === "string" && entry.source ? ` (from ${entry.source})` : "";
    if (!NAME.test(entry.name)) throw fail("E_BACKEND_LAUNCH_ENV", `the launch env entry ${JSON.stringify(entry.name)}${from} is not a portable variable name`, { name: entry.name });
    if (entry.secret !== false) {
      throw fail("E_BACKEND_LAUNCH_ENV", `the launch env entry ${entry.name}${from} is ${entry.secret === true ? "a secret" : "not marked as not secret"}: the bb backend carries launch env in the home's .claude/settings.local.json and puts no secret there. Remove it from the launch, or give bb's server the credential in its own environment`, { name: entry.name });
    }
    if (typeof entry.value !== "string" || /[\0\n\r]/.test(entry.value)) throw fail("E_BACKEND_LAUNCH_ENV", `the launch env entry ${entry.name}${from} is not a one-line string`, { name: entry.name });
    if (Object.hasOwn(out, entry.name)) throw fail("E_BACKEND_LAUNCH_ENV", `the launch env names ${entry.name} twice`, { name: entry.name });
    out[entry.name] = entry.value;
  }
  return out;
}

function realDirectory(path, what) {
  const stat = lstatSync(path, { throwIfNoEntry: false });
  if (!stat) return false;
  if (!stat.isDirectory()) throw fail("E_SESSION_START_FAILED", `${what} ${path} is not a directory (a link is not followed)`);
  return true;
}

function writeAtomic(path, text) {
  const tmp = `${path}.${randomBytes(6).toString("hex")}.tmp`;
  try {
    writeFileSync(tmp, text, { mode: 0o600, flag: "wx" });
    chmodSync(tmp, 0o600);
    renameSync(tmp, path);
  } catch (error) {
    rmSync(tmp, { force: true });
    throw error;
  }
}

function readJsonObject(path, what) {
  if (!existsSync(path)) return null;
  let doc;
  try { doc = JSON.parse(readFileSync(path, "utf8")); }
  catch (error) { throw fail("E_SESSION_START_FAILED", `${what} ${path} is not JSON (${error.message}): fix or remove it; the launch does not overwrite it`); }
  if (!isObject(doc)) throw fail("E_SESSION_START_FAILED", `${what} ${path} is not a JSON object: fix or remove it; the launch does not overwrite it`);
  return doc;
}

/** Write the launch env into `<home>/.claude/settings.local.json` (0600), keeping every
 *  other key and every env entry the launch did not write. The names this provider wrote
 *  are kept in `<home>/.oats-bb/launch-env.json`, so a variable a later launch no longer
 *  carries is removed, and a person's own entries are never touched. */
export function writeLaunchEnv(home, env) {
  if (!realDirectory(home, "the home")) throw fail("E_SESSION_START_FAILED", `the home ${home} does not exist`);
  const claudeDir = join(home, ".claude");
  if (!realDirectory(claudeDir, "the home's")) mkdirSync(claudeDir, { mode: 0o700 });
  const stateDir = join(home, STATE_DIR);
  if (!realDirectory(stateDir, "the provider's state directory")) mkdirSync(stateDir, { mode: 0o700 });

  const settingsPath = join(claudeDir, "settings.local.json");
  const ownedPath = join(stateDir, OWNED_FILE);
  const settings = readJsonObject(settingsPath, "Claude's local settings") ?? {};
  if (settings.env !== undefined && !isObject(settings.env)) throw fail("E_SESSION_START_FAILED", `Claude's local settings ${settingsPath} has an "env" that is not a map: fix or remove it; the launch does not overwrite it`);
  const owned = readJsonObject(ownedPath, "the provider's record");
  const previous = Array.isArray(owned?.names) ? owned.names.filter((name) => typeof name === "string") : [];
  const names = Object.keys(env).sort();

  // The record first, covering both sets: a launch cut short between the two writes
  // leaves no entry of ours that the next launch would take for a person's.
  writeAtomic(ownedPath, `${JSON.stringify({ names: [...new Set([...previous, ...names])].sort() }, null, 2)}\n`);
  const merged = { ...(settings.env ?? {}) };
  for (const name of previous) delete merged[name];
  for (const name of names) merged[name] = env[name];
  const next = { ...settings, env: merged };
  if (Object.keys(merged).length === 0) delete next.env;
  writeAtomic(settingsPath, `${JSON.stringify(next, null, 2)}\n`);
  writeAtomic(ownedPath, `${JSON.stringify({ names }, null, 2)}\n`);
  return { path: settingsPath, names };
}
