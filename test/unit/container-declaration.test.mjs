// container/agent-child.json against the grammar of the base supervisor's
// optional child (oats-project/oats, docs/container.md, "An optional child").
// The supervisor refuses a bad declaration when the container starts; this
// refuses it before an image is built.
//
// `admit` is that grammar and nothing more: it mirrors parseChildDeclaration
// in container/agent/supervisor.mjs at the commit the container workflow
// pins, plus the supervisor's check that the name is the switch's. It must
// refuse what the supervisor refuses and admit what it admits.
// `admitForBuild` adds one check the supervisor can only make in a running
// image, as an approximation: the command's path, read as text, must not lie
// under a writable mount (the supervisor resolves the real path). What only a
// running image can show (the command exists, its real path, the file's owner
// and mode) is acceptance's, in the container workflow. Dependency-free.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { posix } from "node:path";
import test from "node:test";

const read = (name) => readFileSync(new URL(`../../container/${name}`, import.meta.url), "utf8");

const MAX_BYTES = 16 * 1024;
const WRITABLE_MOUNTS = ["/state", "/work", "/tmp", "/run", "/outbox", "/dev/shm"];
const RESERVED_NAMES = ["PATH", "HOME", "LD_PRELOAD", "NSS_WRAPPER_PASSWD", "NSS_WRAPPER_GROUP", "NODE_OPTIONS", "AGENT_CHILD"];
const SSHD_PORT = 2222;

class Refused extends Error {}
const refuse = (key) => { throw new Refused(key); };
const isObject = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
const keys = (value, key, required, optional = []) => {
  if (!isObject(value)) refuse(key);
  const prefix = key ? `${key}.` : "";
  for (const name of Object.keys(value)) if (!required.includes(name) && !optional.includes(name)) refuse(prefix + name);
  for (const name of required) if (!(name in value)) refuse(prefix + name);
};
const argv = (value, key) => {
  if (!Array.isArray(value) || !value.length || value.some((word) => typeof word !== "string" || word.includes("\0"))) refuse(key);
  if (!value[0].startsWith("/")) refuse(key);
};

/** The supervisor's grammar. Throws `Refused`, whose message is the key at
 * fault; returns the declaration when it is admitted. `switchName` is what
 * the deployment sets as AGENT_CHILD. */
export function admit(text, switchName) {
  if (Buffer.byteLength(text) > MAX_BYTES) refuse("(size)");
  let value;
  try { value = JSON.parse(text); } catch { refuse("(json)"); }
  keys(value, "", ["name", "command", "env", "ready", "listen", "version", "stopMs"], ["envFromFile"]);

  if (typeof value.name !== "string" || !/^[a-z0-9-]{1,20}$/.test(value.name)) refuse("name");
  if (value.name !== switchName) refuse("name");
  argv(value.command, "command");

  if (!isObject(value.env)) refuse("env");
  const fromFile = value.envFromFile === undefined ? {} : value.envFromFile;
  if (!isObject(fromFile)) refuse("envFromFile");
  for (const [key, entries] of [["env", value.env], ["envFromFile", fromFile]]) {
    for (const [name, entry] of Object.entries(entries)) {
      if (!/^[A-Z_][A-Z0-9_]*$/.test(name) || RESERVED_NAMES.includes(name) || typeof entry !== "string" || entry.includes("\0")) refuse(`${key}.${name}`);
    }
  }
  for (const [name, path] of Object.entries(fromFile)) {
    if (name in value.env) refuse(`envFromFile.${name}`);
    // Directly under /etc/agent-login/: one file name, no further directory.
    if (!/^\/etc\/agent-login\/[^/\0]+$/.test(path) || [".", ".."].includes(posix.basename(path))) refuse(`envFromFile.${name}`);
  }

  const { listen } = value;
  if (!Array.isArray(listen) || !listen.length) refuse("listen");
  for (const port of listen) if (!Number.isInteger(port) || port < 1024 || port > 65535 || port === SSHD_PORT) refuse("listen");
  if (new Set(listen).size !== listen.length) refuse("listen");

  keys(value.ready, "ready", ["url", "field"]);
  const url = typeof value.ready.url === "string" && /^http:\/\/127\.0\.0\.1:([1-9]\d{3,4})\/[A-Za-z0-9._~/?&=%-]*$/.exec(value.ready.url);
  if (!url || !listen.includes(Number(url[1]))) refuse("ready.url");
  if (typeof value.ready.field !== "string" || !/^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(value.ready.field)) refuse("ready.field");

  keys(value.version, "version", ["command", "file"]);
  argv(value.version.command, "version.command");
  const { file } = value.version;
  if (typeof file !== "string" || file.includes("\0") || !file.startsWith("/")) refuse("version.file");

  if (!Number.isInteger(value.stopMs) || value.stopMs < 1000 || value.stopMs > 8000) refuse("stopMs");
  return value;
}

/** `admit`, and the command's path as written must not lie under a writable
 * mount. The supervisor refuses on the real path, which only the image has:
 * this catches the plain case before a build, and acceptance the rest. */
export function admitForBuild(text, switchName) {
  const value = admit(text, switchName);
  const command = posix.normalize(value.command[0]);
  if (WRITABLE_MOUNTS.some((mount) => command === mount || command.startsWith(`${mount}/`))) refuse("command");
  return value;
}

const committed = read("agent-child.json");
const switchName = /^\s*AGENT_CHILD: "([^"]*)"$/m.exec(read("compose.agent.child.yaml"))?.[1];

test("the declaration is valid under the base supervisor's grammar and declares bb on loopback", () => {
  assert.equal(switchName, "bb", "the fragment's switch");
  assert.deepEqual(admitForBuild(committed, switchName), {
    name: "bb",
    // bb's data stays in its default directory, /state/home/.bb: no --data-dir.
    command: ["/usr/local/bin/bb-app", "--no-in-app-updates", "--server-bind-host", "127.0.0.1"],
    env: { BB_TELEMETRY: "false" },
    envFromFile: { CLAUDE_CODE_OAUTH_TOKEN: "/etc/agent-login/claude-token" },
    ready: { url: "http://127.0.0.1:38887/status", field: "connected" },
    listen: [38886, 38887],
    version: { command: ["/usr/local/bin/bb", "--version"], file: "/opt/agent-child/version" },
    stopMs: 8000,
  });
  assert.doesNotMatch(committed, /data-dir|BB_DATA_DIR|0\.0\.0\.0|\[::\]/, "bb's default data directory, and no wider address");
  assert.ok(committed.endsWith("}\n"));
});

test("a declaration with an unknown key, a wrong port, a writable command path or a foreign env-from-file path is refused by the same grammar", () => {
  const base = JSON.parse(committed);
  /** [what, the key the refusal names, a change to a copy of the committed declaration] */
  const cases = [
    ["an unknown top-level key", "restart", (d) => { d.restart = "always"; }],
    ["an unknown key in ready", "ready.timeoutMs", (d) => { d.ready.timeoutMs = 60_000; }],
    ["an unknown key in version", "version.env", (d) => { d.version.env = {}; }],
    ...["name", "command", "env", "ready", "listen", "version", "stopMs"].map((key) => [`no ${key}`, key, (d) => { delete d[key]; }]),
    ["no ready.url", "ready.url", (d) => { delete d.ready.url; }],
    ["no ready.field", "ready.field", (d) => { delete d.ready.field; }],
    ["no version.command", "version.command", (d) => { delete d.version.command; }],
    ["no version.file", "version.file", (d) => { delete d.version.file; }],
    ["a name with a capital", "name", (d) => { d.name = "Bb"; }],
    ["a name of 21 characters", "name", (d) => { d.name = "b".repeat(21); }],
    ["an empty name", "name", (d) => { d.name = ""; }],
    ["a name that is not the switch's", "name", (d) => { d.name = "bb2"; }],
    ["a command that is a string", "command", (d) => { d.command = "/usr/local/bin/bb-app"; }],
    ["an empty command", "command", (d) => { d.command = []; }],
    ["a command found on PATH", "command", (d) => { d.command[0] = "bb-app"; }],
    ["a command with a number in it", "command", (d) => { d.command.push(1); }],
    ["an env value that is not a string", "env.BB_TELEMETRY", (d) => { d.env.BB_TELEMETRY = false; }],
    ["a lowercase env name", "env.bb_telemetry", (d) => { d.env.bb_telemetry = "false"; }],
    ...["PATH", "HOME", "LD_PRELOAD", "NSS_WRAPPER_PASSWD", "NSS_WRAPPER_GROUP", "NODE_OPTIONS", "AGENT_CHILD"].flatMap((name) => [
      [`${name} in env`, `env.${name}`, (d) => { d.env[name] = "x"; }],
      [`${name} in envFromFile`, `envFromFile.${name}`, (d) => { d.envFromFile[name] = "/etc/agent-login/x"; }],
    ]),
    ["a name in both env and envFromFile", "envFromFile.BB_TELEMETRY", (d) => { d.envFromFile.BB_TELEMETRY = "/etc/agent-login/telemetry"; }],
    ...["/state/home/token", "/etc/agent-login/sub/token", "/etc/agent-login/", "/etc/agent-login/..", "/etc/agent-login", "/etc/passwd", "etc/agent-login/claude-token", "/etc/agent-login/../shadow"].map((path) => [`envFromFile from ${path}`, "envFromFile.CLAUDE_CODE_OAUTH_TOKEN", (d) => { d.envFromFile.CLAUDE_CODE_OAUTH_TOKEN = path; }]),
    ["an envFromFile that is null", "envFromFile", (d) => { d.envFromFile = null; }],
    ["an envFromFile that is a list", "envFromFile", (d) => { d.envFromFile = ["/etc/agent-login/claude-token"]; }],
    ["an empty listen", "listen", (d) => { d.listen = []; }],
    ["a duplicate port", "listen", (d) => { d.listen = [38886, 38887, 38886]; }],
    ["sshd's port", "listen", (d) => { d.listen.push(2222); }],
    ["a privileged port", "listen", (d) => { d.listen.push(443); }],
    ["a port past 65535", "listen", (d) => { d.listen.push(65536); }],
    ["a port that is a string", "listen", (d) => { d.listen = ["38886", 38887]; }],
    ["a ready port that is not declared", "ready.url", (d) => { d.ready.url = "http://127.0.0.1:38888/status"; }],
    ["a ready URL on every address", "ready.url", (d) => { d.ready.url = "http://0.0.0.0:38887/status"; }],
    ["a ready URL by name", "ready.url", (d) => { d.ready.url = "http://localhost:38887/status"; }],
    ["a ready URL over https", "ready.url", (d) => { d.ready.url = "https://127.0.0.1:38887/status"; }],
    ["a ready URL with a login", "ready.url", (d) => { d.ready.url = "http://user@127.0.0.1:38887/status"; }],
    ["a ready URL without a path", "ready.url", (d) => { d.ready.url = "http://127.0.0.1:38887"; }],
    ["a ready URL with a fragment", "ready.url", (d) => { d.ready.url = "http://127.0.0.1:38887/status#x"; }],
    ["a ready URL with a space", "ready.url", (d) => { d.ready.url = "http://127.0.0.1:38887/sta tus"; }],
    ["an empty ready field", "ready.field", (d) => { d.ready.field = ""; }],
    ["a nested ready field", "ready.field", (d) => { d.ready.field = "daemon.connected"; }],
    ["a ready field of 65 characters", "ready.field", (d) => { d.ready.field = "c".repeat(65); }],
    ["a NUL in the command", "command", (d) => { d.command.push("a\0b"); }],
    ["a NUL in the version command", "version.command", (d) => { d.version.command.push("a\0b"); }],
    ["a version command on PATH", "version.command", (d) => { d.version.command = ["bb", "--version"]; }],
    ["a relative version file", "version.file", (d) => { d.version.file = "version"; }],
    ["a version file with a NUL", "version.file", (d) => { d.version.file = "/opt/agent-child/version\0"; }],
    ["an env value with a NUL", "env.BB_TELEMETRY", (d) => { d.env.BB_TELEMETRY = "false\0"; }],
    ["a stop budget over the cap", "stopMs", (d) => { d.stopMs = 8001; }],
    ["a stop budget under a second", "stopMs", (d) => { d.stopMs = 999; }],
    ["a stop budget that is a string", "stopMs", (d) => { d.stopMs = "8000"; }],
  ];
  const refused = (key) => (error) => error instanceof Refused && error.message === key;
  const changedBy = (change) => { const changed = structuredClone(base); change(changed); return JSON.stringify(changed); };
  for (const [what, key, change] of cases) {
    for (const check of [admit, admitForBuild]) assert.throws(() => check(changedBy(change), "bb"), refused(key), `${what} must be refused, naming ${key}`);
  }

  // A command under a writable mount: the grammar admits the text (the
  // supervisor refuses it on the real path, in the image); the build check
  // refuses the path as written.
  for (const path of ["/state/home/bb-app", "/work/bb-app", "/tmp/bb-app", "/run/bb-app", "/outbox/bb-app", "/dev/shm/bb-app", "/usr/../state/bb-app", "/state", "//tmp/bb-app"]) {
    const text = changedBy((d) => { d.command[0] = path; });
    assert.equal(admit(text, "bb").command[0], path, `the grammar alone admits ${path}`);
    assert.throws(() => admitForBuild(text, "bb"), refused("command"), `a command at ${path} must be refused before a build`);
  }

  // What the supervisor's grammar admits, this admits too: neither check is
  // stricter than the base, so a declaration valid there never fails here.
  for (const [what, change] of [
    ["a version file with a dot segment", (d) => { d.version.file = "/opt/agent-child/./version"; }],
    ["a version command under a writable mount", (d) => { d.version.command = ["/tmp/bb", "--version"]; }],
    ["a command with a dot-dot that stays read-only", (d) => { d.command[0] = "/usr/local/bin/../bin/bb-app"; }],
    ["a command in a directory whose name starts like a mount", (d) => { d.command[0] = "/statement/bb-app"; }],
    ["a ready URL with a query", (d) => { d.ready.url = "http://127.0.0.1:38886/health?full=1&x=%20"; }],
    ["a ready URL that is only the root path", (d) => { d.ready.url = "http://127.0.0.1:38887/"; }],
    ["an empty env", (d) => { d.env = {}; }],
    ["an empty envFromFile", (d) => { d.envFromFile = {}; }],
    ["an env name that starts with an underscore", (d) => { d.env._X9 = ""; }],
    ["the ports at both ends of the range", (d) => { d.listen = [1024, 65535, 38887]; }],
    ["a one-character name's stop budget at the floor", (d) => { d.stopMs = 1000; }],
    ["a ready field of 64 characters", (d) => { d.ready.field = "_".repeat(64); }],
    ["a version command of one word", (d) => { d.version.command = ["/usr/local/bin/bb"]; }],
  ]) {
    const text = changedBy(change);
    for (const check of [admit, admitForBuild]) assert.deepEqual(check(text, "bb"), JSON.parse(text), `${what} is admitted`);
  }
  for (const [what, key, text] of [
    ["text that is not JSON", "(json)", committed.slice(0, -2)],
    ["a list", "", "[]"],
    ["more than 16 KiB", "(size)", JSON.stringify({ ...base, env: { PAD: "x".repeat(16 * 1024) } })],
  ]) assert.throws(() => admit(text, "bb"), refused(key), what);
  assert.throws(() => admit(committed, "other"), refused("name"), "the switch names another child");

  // The optional key may be absent, and the admitted file passes unchanged.
  const { envFromFile, ...without } = base;
  assert.deepEqual(admit(JSON.stringify(without), "bb"), without);
  assert.deepEqual(admit(committed, "bb"), base);
});
