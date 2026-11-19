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

// Where a launch env entry may come from and still be written to a file: the kernel, a
// capability's hook (which must not return a secret) or a launch configuration's literal.
// A launch configuration's reference (fromEnv, fromFile) is a secret source; so is any
// source word this provider does not know.
const PLAIN_SOURCES = new Set(["kernel", "capability", "launch-config"]);

/** The launch input's env as a name → value map, or a refusal naming the entry
 *  (E_BACKEND_LAUNCH_ENV): one from a secret source or marked secret (it would sit in a
 *  file and in Claude's process, for every tool to read), or one this file cannot carry.
 *  The value is never part of a message. */
export function readLaunchEnv(env) {
  if (env === undefined || env === null) return {};
  if (!Array.isArray(env)) throw fail("E_BACKEND_LAUNCH_ENV", "the launch env must be a list of {name, value, source}");
  const out = {};
  for (const entry of env) {
    if (!isObject(entry) || typeof entry.name !== "string") throw fail("E_BACKEND_LAUNCH_ENV", "a launch env entry has no name");
    const from = typeof entry.source === "string" && entry.source ? ` (source ${entry.source}${typeof entry.capability === "string" ? `, ${entry.capability}` : ""})` : "";
    if (!NAME.test(entry.name)) throw fail("E_BACKEND_LAUNCH_ENV", `the launch env entry ${JSON.stringify(entry.name)}${from} is not a portable variable name`);
    const why = entry.secret === true || entry.source === "launch-config-reference" ? "comes from a secret source"
      : entry.secret !== undefined && entry.secret !== false ? "has a secret mark that is neither true nor false"
      : !PLAIN_SOURCES.has(entry.source) ? "has no source this backend knows to be free of secrets" : null;
    if (why !== null) {
      throw fail("E_BACKEND_LAUNCH_ENV", `the launch env entry ${entry.name}${from} ${why}: the bb backend carries launch env in the home's .claude/settings.local.json and puts no secret there. Remove it from the launch, or give bb's server the credential in its own environment`);
    }
    if (typeof entry.value !== "string" || /[\0\n\r]/.test(entry.value)) throw fail("E_BACKEND_LAUNCH_ENV", `the launch env entry ${entry.name}${from} is not a one-line string`);
    if (Object.hasOwn(out, entry.name)) throw fail("E_BACKEND_LAUNCH_ENV", `the launch env names ${entry.name} twice`);
    out[entry.name] = entry.value;
  }
  return out;
}

/** The names a launch leaves out on purpose (`unset`): they must not reach the process
 *  from an earlier launch or from a person's own entry. */
export function readUnset(unset, env) {
  if (unset === undefined || unset === null) return [];
  if (!Array.isArray(unset) || unset.some((name) => typeof name !== "string" || !NAME.test(name))) throw fail("E_BACKEND_LAUNCH_ENV", "the launch's unset must be a list of variable names");
  const both = unset.find((name) => Object.hasOwn(env, name));
  if (both !== undefined) throw fail("E_BACKEND_LAUNCH_ENV", `the launch both sets and unsets ${both}`);
  return unset;
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
 *  other key and every env entry the launch did not write or unset. The names this
 *  provider wrote are kept in `<home>/.oats-bb/launch-env.json`, so a variable a later
 *  launch no longer carries is removed, and a person's own entries are never touched.
 *
 *  This is the one place the provider writes Claude's local settings. What else a launch
 *  must put there (contract item 6: the sandbox allowances OATS's own messaging and events
 *  need in bb's sandboxed modes) is written here too, under the same record of what is
 *  ours, once its shape is decided. */
export function writeLaunchEnv(home, env, unset = []) {
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
  for (const name of [...previous, ...unset]) delete merged[name];
  for (const name of names) merged[name] = env[name];
  const next = { ...settings, env: merged };
  if (Object.keys(merged).length === 0) delete next.env;
  writeAtomic(settingsPath, `${JSON.stringify(next, null, 2)}\n`);
  writeAtomic(ownedPath, `${JSON.stringify({ names }, null, 2)}\n`);
  return { path: settingsPath, names };
}
