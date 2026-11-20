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
// and later removes exactly that. An entry a person put in the file under another name is
// never touched; a name the launch carries is the launch's.
import { chmodSync, lstatSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { delimiter, isAbsolute, join, normalize } from "node:path";
import { randomBytes } from "node:crypto";
import { fail, isObject } from "./errors.mjs";

const NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
const STATE_DIR = ".oats-bb";
const ENV_RECORD = join(STATE_DIR, "launch-env.json");
const LAUNCH_RECORD = join(STATE_DIR, "launch.json");
const SANDBOX_RECORD = ".oats-bb-sandbox.json";

// Where a launch env entry may come from and still be written to a file: the kernel, a
// capability's hook (which must not return a secret) or a launch configuration's literal.
// A launch configuration's reference (fromEnv, fromFile) is a secret source; so is any
// source word this provider does not know.
const PLAIN_SOURCES = new Set(["kernel", "capability", "launch-config"]);

// bb's Claude runs with the Claude configuration and the account of bb's own server,
// never the launch's. A launch entry that would choose either cannot be honoured, and is
// refused rather than ignored (contract item 1, the preflights a provider launch skips).
const CONFIGURATION_NAMES = new Set(["CLAUDE_CONFIG_DIR"]);
// Which variables choose the account or the endpoint is Claude Code's list, and it grows
// (keys and tokens per cloud, base URLs, headers, sockets): so by pattern, not by name.
// Every ANTHROPIC_* variable does, but the ones that only pick a model.
const MODEL_NAMES = /^ANTHROPIC_(MODEL|SMALL_FAST_MODEL.*|DEFAULT_.*_MODEL.*|CUSTOM_MODEL_OPTION.*)$/;
const ACCOUNT_NAMES = /^(ANTHROPIC_.*|CLAUDE_CODE_USE_.*|CLAUDE_CODE_API_.*|CLAUDE_CODE_OAUTH_.*|CLAUDE_CODE_SKIP_.*_AUTH|AWS_BEARER_TOKEN_BEDROCK)$/;
const choosesAccount = (name) => ACCOUNT_NAMES.test(name) && !MODEL_NAMES.test(name);
// A name a JSON map cannot carry as a plain entry.
const UNCARRIABLE = new Set(["__proto__"]);

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
    if (!NAME.test(entry.name) || UNCARRIABLE.has(entry.name)) throw fail("E_BACKEND_LAUNCH_ENV", `the launch env entry ${JSON.stringify(entry.name)}${from} is not a variable name the bb backend can carry`);
    if (CONFIGURATION_NAMES.has(entry.name)) {
      throw fail("E_BACKEND_LAUNCH_ENV", `the launch sets ${entry.name}${from}, which the bb backend cannot honour: a bb thread's Claude loads the user settings and hooks of the Claude configuration bb's server runs with. Remove it from the launch`);
    }
    if (choosesAccount(entry.name)) {
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
 *  from an earlier launch, from a person's own entry, or from the environment bb's server
 *  was started with (which bb's Claude inherits). A settings file can set a variable but
 *  not remove one, so each is written with an empty value: the nearest thing to unset
 *  that can be carried, and never the inherited value. */
export function readUnset(unset, env) {
  if (unset === undefined || unset === null) return [];
  if (!Array.isArray(unset) || unset.some((name) => typeof name !== "string" || !NAME.test(name) || UNCARRIABLE.has(name))) throw fail("E_BACKEND_LAUNCH_ENV", "the launch's unset must be a list of variable names the bb backend can carry");
  // An empty value under one of these names would take from bb's Claude the configuration
  // or the credential bb's own server gives it.
  const chosen = unset.find((name) => CONFIGURATION_NAMES.has(name) || choosesAccount(name));
  if (chosen !== undefined) throw fail("E_BACKEND_LAUNCH_ENV", `the launch unsets ${chosen}, which the bb backend cannot honour: a bb thread's Claude takes its configuration and its account from bb's own server, and the launch can neither choose nor remove them`);
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

const CAPABILITY_ID = /^[a-z0-9][a-z0-9._-]{0,99}$/;
// A bare host: labels of letters, digits and dashes, an optional port. No wildcard, no
// scheme, no path, no user. An IPv4 address is such a host too.
const HOST = /^(?=.{1,253}(?::\d{1,5})?$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*(?::\d{1,5})?$/;

// What must never reach a message: control characters (C0, C1), line and paragraph
// separators, bidi overrides.
const UNPRINTABLE = /[\x00-\x1f\x7f-\x9f\u2028\u2029\u202a-\u202e\u2066-\u2069]/;
const oneLine = (value, max) => typeof value === "string" && value.length > 0 && value.length <= max && !UNPRINTABLE.test(value);
const SANDBOX_KEYS = ["domains", "write", "missing", "skipped", "unavailable"];
// The kernel relays at most 500 characters of a provider's message: what a message
// quotes is clipped so that the remedy and the counts always arrive.
const CAUSE_MAX = 240;
const clip = (text, max) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

/** The launch input's `sandbox`, as the kernel built it from recorded configuration:
 *
 *    {domains: [{host, capability, setting}], write: [{path, reason}],
 *     missing: [{capability, setting, team, optional}]}
 *    or {unavailable: "<cause>"} when the kernel could not resolve the configuration.
 *  (`skipped: [{capability, reason}]` is read if it comes; the kernel does not send it.)
 *
 *  `missing`: what a slot provider's line named and the deployment has no value for (a
 *  team with no recorded service): a host the sandbox would need and cannot be given.
 *
 *  → {domains, write, missing, optional, skipped, unavailable, unnamed, unnamedOptional,
 *  unnamedSkipped}: `missing` the rows that are not optional, `optional` the ones that
 *  are, `unavailable` the cause or null, and the three counts of rows that cannot be named
 *  in a message (counted, so that none is dropped).
 *
 *  The provider writes exactly `domains` and `write`, so each entry must be what the lists
 *  may hold (an exact host, an exact absolute path), in every mode: E_BACKEND_SANDBOX_HOST,
 *  E_BACKEND_SANDBOX_PATH. The rest is read by `sandboxed`: a launch that will run in bb's
 *  sandbox must understand everything it is told (an unknown key, a `missing` that is no
 *  list refuse it); a full-mode launch writes nothing and ignores all of it, whatever it
 *  holds. A row that cannot be named is still a gap: counted, never dropped. */
export function readSandbox(sandbox, { sandboxed = true } = {}) {
  const empty = { domains: [], write: [], missing: [], optional: [], unnamed: 0, unnamedOptional: 0, unavailable: null, skipped: [], unnamedSkipped: 0 };
  if (sandbox === undefined || sandbox === null) return empty;
  if (!isObject(sandbox)) throw fail("E_SESSION_START_FAILED", "the launch input's sandbox is not an object");
  // An unresolved configuration comes first: beside it nothing else is read (there are no
  // lists to write), whatever else the object holds. Its shape is not final: the cause is
  // a line, or an object with one under `message` or `cause`.
  // `false` and "" say "resolved": only a cause makes the configuration unavailable.
  if (sandbox.unavailable !== undefined && sandbox.unavailable !== null && sandbox.unavailable !== false && sandbox.unavailable !== "") {
    const given = isObject(sandbox.unavailable) ? [sandbox.unavailable.code, sandbox.unavailable.message ?? sandbox.unavailable.cause].filter((part) => oneLine(part, 2_000)).join(": ") : sandbox.unavailable;
    return { ...empty, unavailable: oneLine(given, 4_000) ? clip(given, CAUSE_MAX) : "no cause given" };
  }
  const unknown = Object.keys(sandbox).find((key) => !SANDBOX_KEYS.includes(key));
  if (unknown !== undefined && sandboxed) throw fail("E_SESSION_START_FAILED", `the launch input's sandbox has a key this provider does not know: ${oneLine(unknown, 60) ? unknown : "(unprintable)"}`);
  const list = (value, what, strict = true) => {
    if (value === undefined || value === null) return [];
    if (Array.isArray(value)) return value;
    if (strict) throw fail("E_SESSION_START_FAILED", `the launch input's sandbox.${what} is not a list`);
    return [value]; // one thing that is no row: counted as a gap that cannot be named
  };
  const domains = list(sandbox.domains, "domains").map((entry) => {
    const who = isObject(entry) && typeof entry.capability === "string" && entry.capability ? entry.capability : null;
    if (!isObject(entry) || !isExactHost(entry.host)) {
      throw fail("E_BACKEND_SANDBOX_HOST", `the launch asks the sandbox to allow ${JSON.stringify(isObject(entry) ? entry.host ?? null : entry)}${who ? ` (for ${who})` : ""}, which is not one exact host: no wildcard, scheme or path`);
    }
    if (who === null) throw fail("E_BACKEND_SANDBOX_HOST", `the launch asks the sandbox to allow ${entry.host} without saying which capability asked`);
    return { host: entry.host, capability: who, setting: typeof entry.setting === "string" ? entry.setting : null };
  });
  const write = list(sandbox.write, "write").map((entry) => {
    const path = isObject(entry) ? entry.path : null;
    if (!isExactPath(path)) {
      throw fail("E_BACKEND_SANDBOX_PATH", `the launch asks the sandbox to allow writes to ${JSON.stringify(path)}, which is not one exact absolute path`);
    }
    return { path, reason: typeof entry.reason === "string" ? entry.reason : null };
  });
  // The launch input is the kernel's: a row is taken as given, checked only for what a
  // message can carry (the kernel's own rules decide what a team id is).
  const word = (value) => value === undefined || value === null || oneLine(value, 256);
  const missing = [], optional = [], skipped = [];
  let unnamed = 0, unnamedOptional = 0, unnamedSkipped = 0;
  for (const entry of list(sandbox.missing, "missing", sandboxed)) {
    const isOptional = isObject(entry) && entry.optional === true;
    if (isObject(entry) && typeof entry.capability === "string" && CAPABILITY_ID.test(entry.capability) && word(entry.setting) && word(entry.team)) {
      (isOptional ? optional : missing).push({ capability: entry.capability, setting: entry.setting ?? null, team: entry.team ?? null });
    } else if (isOptional) unnamedOptional += 1;
    else unnamed += 1;
  }
  // What the kernel took no host for, and why: for readiness to say; never a refusal.
  for (const entry of list(sandbox.skipped, "skipped", false)) {
    if (isObject(entry) && typeof entry.capability === "string" && CAPABILITY_ID.test(entry.capability)) skipped.push({ capability: entry.capability, reason: oneLine(entry.reason, 200) ? entry.reason : null });
    else unnamedSkipped += 1;
  }
  return { domains, write, missing, optional, unnamed, unnamedOptional, unavailable: null, skipped, unnamedSkipped };
}

// A team id as the kernel writes one, and a setting key: what a record in the home must
// look like to be shown (the home is writable by its agent).
const RECORDED_WORD = /^[A-Za-z0-9][A-Za-z0-9._:@/+-]{0,255}$/;
/** One `missing` entry read back from the home's record. → the entry, or null. */
function readRecordedMissing(entry) {
  if (!isObject(entry) || typeof entry.capability !== "string" || !CAPABILITY_ID.test(entry.capability)) return null;
  for (const key of ["setting", "team"]) {
    if (entry[key] !== undefined && entry[key] !== null && (typeof entry[key] !== "string" || !RECORDED_WORD.test(entry[key]))) return null;
  }
  return { capability: entry.capability, setting: entry.setting ?? null, team: entry.team ?? null };
}

/** "oats.aweb's setting services for team default:acme.aweb.ai". */
export const describeMissing = (entry) => `${entry.capability}'s ${entry.setting ? `setting ${entry.setting}` : "service"}${entry.team ? ` for team ${entry.team}` : ""}`;

// A list of rows is cut to this many characters, each row to ROW_MAX, with a count of the
// rest: with the longest sentence that stands before it, the whole stays under the 500
// characters the kernel relays.
const LIST_MAX = 150;
const ROW_MAX = 110;
/** "a; b; 3 more" for the rows that fit and a count of the rest, some of which (`unnamed`)
 *  have no name that can be shown. */
export function gapList(rows, unnamed, { describe = describeMissing, noun = ["entry", "entries"] } = {}) {
  const shown = [];
  let length = 0;
  for (const row of rows) {
    const text = clip(describe(row), ROW_MAX);
    // The first row is always named (clipped if long); the rest while they fit.
    if (shown.length > 0 && (shown.length >= 16 || length + text.length > LIST_MAX)) break;
    shown.push(text);
    length += text.length + 2;
  }
  const rest = rows.length - shown.length + unnamed;
  if (rest === 0) return shown.join("; ");
  if (shown.length === 0) return unnamed === rest ? `${rest} ${noun[rest > 1 ? 1 : 0]} that cannot be shown` : `${rest} ${noun[rest > 1 ? 1 : 0]}, too long to list here`;
  return `${shown.join("; ")}; ${rest} more${unnamed > 0 ? " (not all can be shown)" : ""}`;
}

/** How a missing host gets recorded. Only oats.aweb has a command for it today. */
export function missingRemedy(rows) {
  const aweb = rows.some((row) => row.capability === "oats.aweb"), other = rows.some((row) => row.capability !== "oats.aweb");
  if (aweb && !other) return "Run `oats aweb setup` to record it";
  if (aweb) return "Run `oats aweb setup` for oats.aweb's, and record the other settings in the deployment's configuration";
  return "Record that setting in the deployment's configuration";
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

/** Whether the provider ever launched this home: its state directory is made by the first
 *  launch and stays (a move to another backend removes its records, not the directory). */
export function everLaunched(home) {
  return lstatSync(join(home, STATE_DIR), { throwIfNoEntry: false })?.isDirectory() === true;
}

/** The mode of the home's last launch, whether it was handed sandbox allowances, and what
 *  the deployment lacked for them; or null before a first launch. */
export function readLaunchRecord(home) {
  if (!everLaunched(home)) return null;
  const record = readJsonObject(join(home, LAUNCH_RECORD), "the provider's launch record");
  if (record === null) return null;
  const recorded = Array.isArray(record.missing) ? record.missing : [];
  const missing = recorded.map(readRecordedMissing).filter(Boolean);
  return {
    mode: ["auto", "accept-edits", "full"].includes(record.mode) ? record.mode : null, sandboxGiven: record.sandboxGiven === true,
    missing,
    // What the record holds and cannot be shown: entries that are not a capability id with
    // a plain setting and team, and what the launch itself could not name.
    unnamed: recorded.length - missing.length + (Number.isInteger(record.unnamed) && record.unnamed > 0 ? record.unnamed : 0),
  };
}

const PRINTABLE = /^[\x20-\x7e]{1,120}$/;
export const isExactHost = (value) => typeof value === "string" && HOST.test(value);
export const isExactPath = (value) => typeof value === "string" && isAbsolute(value) && normalize(value) === value && value !== "/" && !/[*?\x00-\x1f\x7f]/.test(value);

/** What the home's sandbox allowances are now, for readiness to show: the entries of the
 *  provider's record that are well formed AND are in settings.local.json's two lists at
 *  this moment. The record and the file sit in the home, which a sandboxed agent can
 *  write: neither is taken at its word. `mismatch` counts what the record claims and the
 *  file does not hold, or what is not a host, a path or a capability name at all. */
export function currentSandbox(home) {
  const record = readSandboxRecord(home);
  if (record === null) return { domains: [], write: [], mismatch: 0 };
  const settings = readJsonObject(join(home, ".claude", "settings.local.json"), "Claude's local settings") ?? {};
  const listAt = (keys) => { let at = settings; for (const key of keys) at = isObject(at) ? at[key] : undefined; return strings(at); };
  const allowedDomains = listAt(DOMAINS_KEYS), allowWrite = listAt(WRITE_KEYS);
  const domains = record.domains.filter((entry) => isExactHost(entry.host) && typeof entry.capability === "string" && CAPABILITY_ID.test(entry.capability) && allowedDomains.includes(entry.host))
    .map((entry) => ({ host: entry.host, capability: entry.capability, setting: typeof entry.setting === "string" && /^[A-Za-z0-9_.-]{1,60}$/.test(entry.setting) ? entry.setting : null }));
  const write = record.write.filter((entry) => isExactPath(entry.path) && allowWrite.includes(entry.path))
    .map((entry) => ({ path: entry.path, reason: typeof entry.reason === "string" && PRINTABLE.test(entry.reason) ? entry.reason : null }));
  return { domains, write, mismatch: record.domains.length - domains.length + record.write.length - write.length };
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
    const at = chain[chain.length - 1];
    // Whatever stands where a map belonged (a null, a string) holds nothing of ours.
    if (!isObject(at) || at[key] === undefined) return;
    chain.push(at[key]);
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
 *  sandbox allowances. Every other key is kept, and every entry under a name the launch
 *  does not carry; a name it carries is the launch's (a person's entry of that name is
 *  replaced). What an earlier launch wrote and this one does not carry is removed. */
export function writeLaunchSettings(home, { env, unset = [], sandbox, mode, sandboxGiven, missing = [], unnamed = 0, dryRun = false }) {
  const { settingsPath, envRecordPath, sandboxRecordPath } = directories(home, { create: !dryRun });
  const settings = readSettingsFile(settingsPath);
  const envRecord = everLaunched(home) ? readJsonObject(envRecordPath, "the provider's record") : null;
  const previousNames = strings(envRecord?.names);
  const previousSandbox = readSandboxRecord(home);
  env = { ...Object.fromEntries(unset.map((name) => [name, ""])), ...env };
  const names = Object.keys(env).sort();

  withdraw(settings, previousNames, previousSandbox);
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

  // A dry run has done everything that can refuse (a file that is not what it should be),
  // and writes nothing: the launch runs it before its first effect.
  if (dryRun) return { path: settingsPath, names, sandbox: sandboxRecord };

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
  writeJson(home, join(home, LAUNCH_RECORD), { mode: mode ?? null, sandboxGiven: sandboxGiven === true, missing, unnamed });
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
  // A home the provider never wrote to has nothing of its to remove, whatever its .claude is.
  if (!everLaunched(home) && !lstatSync(join(home, SANDBOX_RECORD), { throwIfNoEntry: false })) return false;
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
