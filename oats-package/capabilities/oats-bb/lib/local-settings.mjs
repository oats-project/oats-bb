// What a launch writes into the home's `.claude/settings.local.json`, and nothing else of
// Claude's does the provider write (contract item 6):
//
// - `env`: the launch environment. Claude Code applies it to its own process, its tools
//   and its hooks; bb runs Claude with the `local` setting source and cwd = the home, so
//   nothing of it reaches bb's database. No secret goes into the file.
// - `sandbox.network.allowedDomains` and `sandbox.filesystem.allowWrite`: in bb's
//   sandboxed modes (auto, accept-edits), exactly the hosts and paths the kernel hands
//   the launch, which are the ones OATS's own messaging, knowledge, tasks and events need.
//   Claude Code adds them to bb's own sandbox settings; they never replace a restriction.
//
// The provider records what it wrote (`.oats-bb/launch-env.json`, `.oats-bb-sandbox.json`)
// and later removes exactly that: an entry a person put in the file is never touched.
import { chmodSync, lstatSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { delimiter, isAbsolute, join, normalize } from "node:path";
import { randomBytes } from "node:crypto";
import { fail, isObject } from "./errors.mjs";

const NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
export const STATE_DIR = ".oats-bb";
const ENV_RECORD = join(STATE_DIR, "launch-env.json");
const LAUNCH_RECORD = join(STATE_DIR, "launch.json");
export const SANDBOX_RECORD = ".oats-bb-sandbox.json";

// Where a launch env entry may come from and still be written to a file: the kernel, a
// capability's hook (which must not return a secret) or a launch configuration's literal.
// A launch configuration's reference (fromEnv, fromFile) is a secret source; so is any
// source word this provider does not know.
const PLAIN_SOURCES = new Set(["kernel", "capability", "launch-config"]);

// bb's Claude runs with the Claude configuration and the account of bb's own server,
// never the launch's. A launch entry that would choose either cannot be honoured, and is
// refused rather than ignored (contract item 1, the preflights a provider launch skips).
const CONFIGURATION_NAMES = new Set(["CLAUDE_CONFIG_DIR"]);
const ACCOUNT_NAMES = new Set([
  "ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "CLAUDE_CODE_OAUTH_TOKEN", "ANTHROPIC_BASE_URL",
  "CLAUDE_CODE_USE_BEDROCK", "CLAUDE_CODE_USE_VERTEX", "CLAUDE_CODE_USE_FOUNDRY", "AWS_BEARER_TOKEN_BEDROCK",
]);

/** The launch input's env as a name → value map, or a refusal naming the entry
 *  (E_BACKEND_LAUNCH_ENV): one that would choose Claude's configuration or account, one
 *  from a secret source or marked secret (it would sit in a file and in Claude's process,
 *  for every tool to read), or one this file cannot carry. The value is never part of a
 *  message. */
export function readLaunchEnv(env) {
  if (env === undefined || env === null) return {};
  if (!Array.isArray(env)) throw fail("E_BACKEND_LAUNCH_ENV", "the launch env must be a list of {name, value, source}");
  const out = {};
  for (const entry of env) {
    if (!isObject(entry) || typeof entry.name !== "string") throw fail("E_BACKEND_LAUNCH_ENV", "a launch env entry has no name");
    const from = typeof entry.source === "string" && entry.source ? ` (source ${entry.source}${typeof entry.capability === "string" ? `, ${entry.capability}` : ""})` : "";
    if (!NAME.test(entry.name)) throw fail("E_BACKEND_LAUNCH_ENV", `the launch env entry ${JSON.stringify(entry.name)}${from} is not a portable variable name`);
    if (CONFIGURATION_NAMES.has(entry.name)) {
      throw fail("E_BACKEND_LAUNCH_ENV", `the launch sets ${entry.name}${from}, which the bb backend cannot honour: a bb thread's Claude loads the user settings and hooks of the Claude configuration bb's server runs with. Remove it from the launch`);
    }
    if (ACCOUNT_NAMES.has(entry.name)) {
      throw fail("E_BACKEND_LAUNCH_ENV", `the launch sets ${entry.name}${from}, which would choose Claude's account or endpoint: a bb thread runs on the account of bb's own server. Remove it from the launch, or give bb's server the credential in its own environment`);
    }
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

/** The directories a launch puts first on PATH (`pathPrepend`: the home's kernel shim
 *  directory, so the agent's plain `oats` is the kernel that launched it), carried as the
 *  env file's PATH: those directories, then the launch's own PATH entry when it has one,
 *  else the PATH this provider was called with (the kernel's, as a tmux pane would get
 *  it). → the env map with PATH set, or the map as it was when there is nothing to
 *  prepend. A directory that cannot go on a PATH is refused by name. */
export function withPathPrepend(env, pathPrepend, ambientPath) {
  if (pathPrepend === undefined || pathPrepend === null) return env;
  if (!Array.isArray(pathPrepend)) throw fail("E_BACKEND_LAUNCH_ENV", "the launch's pathPrepend must be a list of directories");
  for (const dir of pathPrepend) {
    if (typeof dir !== "string" || !isAbsolute(dir) || dir.includes(delimiter) || /[\0\n\r]/.test(dir)) {
      throw fail("E_BACKEND_LAUNCH_ENV", `the launch's pathPrepend entry ${JSON.stringify(dir)} is not an absolute directory that can go on PATH`);
    }
  }
  if (pathPrepend.length === 0) return env;
  const base = Object.hasOwn(env, "PATH") ? env.PATH : typeof ambientPath === "string" ? ambientPath : "";
  return { ...env, PATH: [...pathPrepend, ...base.split(delimiter).filter((dir) => dir && !pathPrepend.includes(dir))].join(delimiter) };
}

// A bare host: labels of letters, digits and dashes, an optional port. No wildcard, no
// scheme, no path, no user. An IPv4 address is such a host too.
const HOST = /^(?=.{1,253}(?::\d{1,5})?$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*(?::\d{1,5})?$/;

/** The launch input's `sandbox`: {domains: [{host, capability, setting}], write: [{path,
 *  reason}]}, as the kernel built it from recorded configuration. The provider writes
 *  exactly this list, so it checks each entry is what the list may hold (an exact host,
 *  an exact absolute path) and refuses the launch otherwise (E_BACKEND_SANDBOX_HOST,
 *  E_BACKEND_SANDBOX_PATH), naming the entry. */
export function readSandbox(sandbox) {
  if (sandbox === undefined || sandbox === null) return { domains: [], write: [] };
  if (!isObject(sandbox)) throw fail("E_SESSION_START_FAILED", "the launch input's sandbox is not an object");
  for (const key of Object.keys(sandbox)) if (key !== "domains" && key !== "write") throw fail("E_SESSION_START_FAILED", `the launch input's sandbox has a key this provider does not know: ${key}`);
  const list = (value, what) => {
    if (value === undefined || value === null) return [];
    if (!Array.isArray(value)) throw fail("E_SESSION_START_FAILED", `the launch input's sandbox.${what} is not a list`);
    return value;
  };
  const domains = list(sandbox.domains, "domains").map((entry) => {
    const who = isObject(entry) && typeof entry.capability === "string" && entry.capability ? entry.capability : null;
    if (!isObject(entry) || typeof entry.host !== "string" || !HOST.test(entry.host)) {
      throw fail("E_BACKEND_SANDBOX_HOST", `the launch asks the sandbox to allow ${JSON.stringify(isObject(entry) ? entry.host ?? null : entry)}${who ? ` (for ${who})` : ""}, which is not one exact host: no wildcard, scheme or path`);
    }
    if (who === null) throw fail("E_BACKEND_SANDBOX_HOST", `the launch asks the sandbox to allow ${entry.host} without saying which capability asked`);
    return { host: entry.host, capability: who, setting: typeof entry.setting === "string" ? entry.setting : null };
  });
  const write = list(sandbox.write, "write").map((entry) => {
    const path = isObject(entry) ? entry.path : null;
    if (typeof path !== "string" || !isAbsolute(path) || normalize(path) !== path || path === "/" || /[*?\0\n]/.test(path)) {
      throw fail("E_BACKEND_SANDBOX_PATH", `the launch asks the sandbox to allow writes to ${JSON.stringify(path)}, which is not one exact absolute path`);
    }
    return { path, reason: typeof entry.reason === "string" ? entry.reason : null };
  });
  return { domains, write };
}

function realDirectory(path, what) {
  const stat = lstatSync(path, { throwIfNoEntry: false });
  if (!stat) return false;
  if (!stat.isDirectory()) throw fail("E_SESSION_START_FAILED", `${what} ${path} is not a directory (a link is not followed)`);
  return true;
}

/** Write a file whole or not at all, owner-only. The temporary file lives in the
 *  provider's own state directory (declared disposable), so a write killed before its
 *  rename leaves nothing that reads as the instance's work. */
function writeAtomic(home, path, text) {
  const tmp = join(home, STATE_DIR, `${randomBytes(6).toString("hex")}.tmp`);
  try {
    writeFileSync(tmp, text, { mode: 0o600, flag: "wx" });
    chmodSync(tmp, 0o600);
    renameSync(tmp, path);
  } catch (error) {
    rmSync(tmp, { force: true });
    throw error;
  }
}
const writeJson = (home, path, doc) => writeAtomic(home, path, `${JSON.stringify(doc, null, 2)}\n`);

function readJsonObject(path, what) {
  const stat = lstatSync(path, { throwIfNoEntry: false });
  if (!stat) return null;
  let doc;
  try { doc = JSON.parse(readFileSync(path, "utf8")); }
  catch (error) { throw fail("E_SESSION_START_FAILED", `${what} ${path} is not JSON (${error.message}): fix or remove it; the provider does not overwrite it`); }
  if (!isObject(doc)) throw fail("E_SESSION_START_FAILED", `${what} ${path} is not a JSON object: fix or remove it; the provider does not overwrite it`);
  return doc;
}

const strings = (value) => (Array.isArray(value) ? value.filter((item) => typeof item === "string") : []);

/** The mode of the home's last launch and whether it was handed sandbox allowances, or
 *  null before a first launch. */
export function readLaunchRecord(home) {
  if (!lstatSync(join(home, STATE_DIR), { throwIfNoEntry: false })?.isDirectory()) return null;
  const record = readJsonObject(join(home, LAUNCH_RECORD), "the provider's launch record");
  return record === null ? null : { mode: typeof record.mode === "string" ? record.mode : null, sandboxGiven: record.sandboxGiven === true };
}

/** The record of the sandbox entries this provider added: the launch's list (who asked
 *  for what, for readiness to show) and exactly which entries and keys it put in. */
export function readSandboxRecord(home) {
  const record = readJsonObject(join(home, SANDBOX_RECORD), "the provider's sandbox record");
  if (record === null) return null;
  return {
    domains: Array.isArray(record.domains) ? record.domains.filter(isObject) : [],
    write: Array.isArray(record.write) ? record.write.filter(isObject) : [],
    added: { domains: strings(record.added?.domains), write: strings(record.added?.write), keys: strings(record.added?.keys) },
  };
}

// The two lists, as paths of keys in settings.local.json.
const DOMAINS_KEYS = ["sandbox", "network", "allowedDomains"];
const WRITE_KEYS = ["sandbox", "filesystem", "allowWrite"];

/** Take `values` out of the list at `keys`, then delete the list and its parents where
 *  the provider created them (`created`, dotted paths) and they are now empty. */
function removeFrom(settings, keys, values, created) {
  const chain = [settings];
  for (const key of keys) {
    const next = chain[chain.length - 1][key];
    if (next === undefined) return;
    chain.push(next);
  }
  const list = chain[chain.length - 1];
  if (!Array.isArray(list)) return;
  const kept = list.filter((item) => !values.includes(item));
  chain[chain.length - 2][keys[keys.length - 1]] = kept;
  for (let depth = keys.length; depth >= 1; depth -= 1) {
    const value = chain[depth - 1][keys[depth - 1]];
    const empty = Array.isArray(value) ? value.length === 0 : isObject(value) && Object.keys(value).length === 0;
    if (!empty || !created.includes(keys.slice(0, depth).join("."))) break;
    delete chain[depth - 1][keys[depth - 1]];
  }
}

/** Add `values` to the list at `keys`. → what was added: the values not already there,
 *  and the keys that had to be created (dotted paths). */
function addTo(settings, keys, values, file) {
  if (values.length === 0) return { values: [], keys: [] };
  const addedKeys = [];
  let at = settings;
  keys.forEach((key, depth) => {
    const last = depth === keys.length - 1;
    if (at[key] === undefined) { at[key] = last ? [] : {}; addedKeys.push(keys.slice(0, depth + 1).join(".")); }
    else if (last ? !Array.isArray(at[key]) : !isObject(at[key])) {
      throw fail("E_SESSION_START_FAILED", `Claude's local settings ${file} has a "${keys.slice(0, depth + 1).join(".")}" that is not ${last ? "a list" : "a map"}: fix or remove it; the provider does not overwrite it`);
    }
    at = at[key];
  });
  const added = values.filter((value) => !at.includes(value));
  at.push(...added);
  return { values: added, keys: addedKeys };
}

function directories(home, { create }) {
  if (!statSync(home, { throwIfNoEntry: false })?.isDirectory()) throw fail("E_SESSION_START_FAILED", `the home ${home} is not a directory`);
  const claudeDir = join(home, ".claude"), stateDir = join(home, STATE_DIR);
  const hasClaude = realDirectory(claudeDir, "the home's"), hasState = realDirectory(stateDir, "the provider's state directory");
  if (create && !hasClaude) mkdirSync(claudeDir, { mode: 0o700 });
  if (create && !hasState) mkdirSync(stateDir, { mode: 0o700 });
  return { settingsPath: join(claudeDir, "settings.local.json"), envRecordPath: join(home, ENV_RECORD), sandboxRecordPath: join(home, SANDBOX_RECORD), hasClaude, hasState };
}

function readSettingsFile(settingsPath) {
  const settings = readJsonObject(settingsPath, "Claude's local settings") ?? {};
  if (settings.env !== undefined && !isObject(settings.env)) throw fail("E_SESSION_START_FAILED", `Claude's local settings ${settingsPath} has an "env" that is not a map: fix or remove it; the provider does not overwrite it`);
  return settings;
}

/** Take out of `settings` everything the records say this provider put in. */
function withdraw(settings, envNames, sandboxRecord) {
  if (isObject(settings.env)) {
    for (const name of envNames) delete settings.env[name];
  }
  if (sandboxRecord) {
    removeFrom(settings, DOMAINS_KEYS, sandboxRecord.added.domains, sandboxRecord.added.keys);
    removeFrom(settings, WRITE_KEYS, sandboxRecord.added.write, sandboxRecord.added.keys);
  }
}

/** Write a launch's settings into `<home>/.claude/settings.local.json` (0600): the env
 *  (minus `unset`), and, unless `sandbox` is null (bb's full mode has no sandbox), the
 *  sandbox allowances. Every other key, and every entry the provider did not write, is
 *  kept; what an earlier launch wrote and this one does not carry is removed. */
export function writeLaunchSettings(home, { env, unset = [], sandbox, mode, sandboxGiven }) {
  const { settingsPath, envRecordPath, sandboxRecordPath } = directories(home, { create: true });
  const settings = readSettingsFile(settingsPath);
  const envRecord = readJsonObject(envRecordPath, "the provider's record");
  const previousNames = strings(envRecord?.names);
  const previousSandbox = readSandboxRecord(home);
  const names = Object.keys(env).sort();

  withdraw(settings, [...previousNames, ...unset], previousSandbox);
  if (names.length > 0) settings.env = { ...(settings.env ?? {}), ...env };
  else if (isObject(settings.env) && Object.keys(settings.env).length === 0) delete settings.env;
  let sandboxRecord = null;
  if (sandbox !== null && (sandbox.domains.length > 0 || sandbox.write.length > 0)) {
    const domains = addTo(settings, DOMAINS_KEYS, [...new Set(sandbox.domains.map((entry) => entry.host))], settingsPath);
    const write = addTo(settings, WRITE_KEYS, [...new Set(sandbox.write.map((entry) => entry.path))], settingsPath);
    // Keys the provider created on an earlier launch are still the provider's.
    const keys = [...new Set([...domains.keys, ...write.keys, ...(previousSandbox?.added.keys ?? []).filter((key) => hasKey(settings, key))])];
    sandboxRecord = { domains: sandbox.domains, write: sandbox.write, added: { domains: domains.values, write: write.values, keys } };
  }

  // The records first, covering what was there and what will be: a launch cut short
  // between the writes leaves no entry of ours that a later one would take for a person's.
  writeJson(home, envRecordPath, { names: [...new Set([...previousNames, ...names])].sort() });
  if (sandboxRecord || previousSandbox) {
    writeJson(home, sandboxRecordPath, {
      domains: sandboxRecord?.domains ?? [], write: sandboxRecord?.write ?? [],
      added: {
        domains: [...new Set([...(previousSandbox?.added.domains ?? []), ...(sandboxRecord?.added.domains ?? [])])],
        write: [...new Set([...(previousSandbox?.added.write ?? []), ...(sandboxRecord?.added.write ?? [])])],
        keys: [...new Set([...(previousSandbox?.added.keys ?? []), ...(sandboxRecord?.added.keys ?? [])])],
      },
    });
  }
  writeJson(home, settingsPath, settings);
  writeJson(home, envRecordPath, { names });
  if (sandboxRecord) writeJson(home, sandboxRecordPath, sandboxRecord);
  else rmSync(sandboxRecordPath, { force: true });
  // What readiness needs to say of this home's sandbox: the mode it runs in, and whether
  // the kernel handed the launch any allowances at all.
  writeJson(home, join(home, LAUNCH_RECORD), { mode: mode ?? null, sandboxGiven: sandboxGiven === true });
  return { path: settingsPath, names, sandbox: sandboxRecord };
}

function hasKey(settings, dotted) {
  let at = settings;
  for (const key of dotted.split(".")) {
    if (!isObject(at) || at[key] === undefined) return false;
    at = at[key];
  }
  return true;
}

/** The home is no longer a provider home (it starts on another backend): take out of
 *  settings.local.json exactly what the provider wrote, and drop the records. → whether
 *  anything was there to remove. */
export function removeLaunchSettings(home) {
  const { settingsPath, envRecordPath, sandboxRecordPath, hasClaude, hasState } = directories(home, { create: false });
  const envRecord = hasState ? readJsonObject(envRecordPath, "the provider's record") : null;
  const sandboxRecord = readSandboxRecord(home);
  if (envRecord === null && sandboxRecord === null) return false;
  if (hasClaude && lstatSync(settingsPath, { throwIfNoEntry: false })) {
    const settings = readSettingsFile(settingsPath);
    withdraw(settings, strings(envRecord?.names), sandboxRecord);
    if (isObject(settings.env) && Object.keys(settings.env).length === 0) delete settings.env;
    if (!hasState) mkdirSync(join(home, STATE_DIR), { mode: 0o700 });
    writeJson(home, settingsPath, settings);
  }
  rmSync(envRecordPath, { force: true });
  rmSync(sandboxRecordPath, { force: true });
  rmSync(join(home, LAUNCH_RECORD), { force: true });
  return true;
}
