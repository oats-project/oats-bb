// The provider's per-home record of the threads it made (contract r32, A17(1)(b)): where
// it is, what it holds, which directory it is a record of, and what reads as no record.
import assert from "node:assert/strict";
import { chmodSync, existsSync, linkSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { RecordError, identityOf, noteThread, readRecord, recordDir, removeRecord, sameHome, stateRoot } from "../../oats-package/capabilities/oats-bb/lib/record.mjs";
import { VERSION, call, callSeen, fakeBackend, fakeBbIn, projectRow, runBin, scratch, tellSent } from "../fixtures/harness.mjs";

/** A home and a state directory of its own (XDG_STATE_HOME), under one scratch directory. */
function layout(t) {
  const root = mkdtempSync(join(tmpdir(), "oats-bb-record-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const home = join(root, "homes/dev-a"), env = { XDG_STATE_HOME: join(root, "state") };
  mkdirSync(home, { recursive: true });
  return { root, home, env, dir: recordDir(env) };
}
const only = (dir) => { const names = readdirSync(dir); assert.equal(names.length, 1, names.join(" ")); return join(dir, names[0]); };
const mode = (path) => lstatSync(path).mode & 0o777;

test("where the record is: $XDG_STATE_HOME/oats-bb/homes, or .local/state in the user's home where that is unset or not absolute", () => {
  assert.equal(stateRoot({ XDG_STATE_HOME: "/var/state" }, "/home/u"), "/var/state/oats-bb");
  assert.equal(recordDir({ XDG_STATE_HOME: "/var/state" }, "/home/u"), "/var/state/oats-bb/homes");
  // The same default on every platform, macOS included: never ~/Library.
  assert.equal(stateRoot({}, "/Users/u"), "/Users/u/.local/state/oats-bb");
  for (const notAbsolute of ["", "state", "./state", "~/state"]) assert.equal(stateRoot({ XDG_STATE_HOME: notAbsolute }, "/home/u"), "/home/u/.local/state/oats-bb", notAbsolute);
  assert.equal(stateRoot({ XDG_STATE_HOME: 5 }, "/home/u"), "/home/u/.local/state/oats-bb");
});

test("a launch's note makes the record: directories 0700, one file 0600, the directory's identity and then one thread id a line, and nothing else", (t) => {
  const { home, env, dir } = layout(t);
  noteThread(home, "thr_one", { env });
  noteThread(home, "thr_two", { env });
  noteThread(home, "thr_two", { env }); // noted already: no second line
  assert.equal(mode(stateRoot(env)), 0o700);
  assert.equal(mode(dir), 0o700);
  const file = only(dir);
  assert.equal(mode(file), 0o600);
  const stat = statSync(home, { bigint: true });
  assert.equal(readFileSync(file, "utf8"), `oats-bb-home 1 dev=${stat.dev} ino=${stat.ino} birth=${stat.birthtimeNs > 0n ? stat.birthtimeNs : "-"}\nthr_one\nthr_two\n`);
  // Neither the file's name nor what it holds says where the home is.
  assert.match(file.slice(dir.length + 1), /^[0-9a-f]{64}$/);
  assert.equal(readFileSync(file, "utf8").includes(home), false);
  const record = readRecord(home, { env });
  assert.equal(record.state, "ok");
  assert.deepEqual([...record.ids], ["thr_one", "thr_two"]);
  assert.equal(record.file, file);
});

test("two homes never share a file, and a home reached through a link has the record of its real path", (t) => {
  const { root, home, env, dir } = layout(t);
  const other = join(root, "homes/dev-b");
  mkdirSync(other);
  noteThread(home, "thr_a", { env });
  noteThread(other, "thr_b", { env });
  assert.equal(readdirSync(dir).length, 2);
  assert.deepEqual([...readRecord(home, { env }).ids], ["thr_a"]);
  assert.deepEqual([...readRecord(other, { env }).ids], ["thr_b"]);
  const link = join(root, "link-to-a");
  symlinkSync(home, link);
  noteThread(link, "thr_a2", { env });
  assert.equal(readdirSync(dir).length, 2);
  assert.deepEqual([...readRecord(home, { env }).ids], ["thr_a", "thr_a2"]);
});

test("which directory a record is of: with a birth time, the inode and the birth time, whatever the device; without one, the device and the inode", () => {
  const recorded = { dev: 40n, ino: 7001n, birth: 1_795_000_000_123_456_789n };
  assert.equal(sameHome(recorded, { ...recorded }), true);
  // The btrfs reboot (oats#1266): the device number changed, the inode and the birth time did not.
  assert.equal(sameHome(recorded, { ...recorded, dev: 52n }), true);
  // The reuse case (ext4 gives a deleted directory's inode to a new one): an equal inode, another birth time.
  assert.equal(sameHome(recorded, { ...recorded, birth: recorded.birth + 1n }), false);
  assert.equal(sameHome(recorded, { ...recorded, ino: 7002n }), false);
  // A record that holds a birth time never matches a directory that shows none.
  assert.equal(sameHome(recorded, { ...recorded, birth: null }), false);
  // A record that holds none: the device and the inode, both.
  const bare = { dev: 40n, ino: 7001n, birth: null };
  assert.equal(sameHome(bare, { ...bare }), true);
  assert.equal(sameHome(bare, { ...bare, birth: 5n }), true);
  assert.equal(sameHome(bare, { ...bare, dev: 52n }), false);
  assert.equal(sameHome(bare, { ...bare, ino: 7002n }), false);
});

/** Rewrite the identity line of the home's record, as another directory would have left it. */
function rewriteIdentity(dir, change) {
  const file = only(dir);
  const [first, ...rest] = readFileSync(file, "utf8").split("\n");
  const [, dev, ino, birth] = /^oats-bb-home 1 dev=(\d+) ino=(\d+) birth=(\d+|-)$/.exec(first);
  const next = change({ dev: BigInt(dev), ino: BigInt(ino), birth: birth === "-" ? null : BigInt(birth) });
  writeFileSync(file, [`oats-bb-home 1 dev=${next.dev} ino=${next.ino} birth=${next.birth ?? "-"}`, ...rest].join("\n"));
}

test("a record read against the home's directory: another birth time under an equal inode is another home's; another device alone is the same home", (t) => {
  const { home, env, dir } = layout(t);
  noteThread(home, "thr_a", { env });
  const actual = identityOf(home);
  // Whatever this filesystem gives: the tests below write the identity they need.
  rewriteIdentity(dir, () => ({ dev: actual.dev, ino: actual.ino, birth: 1_700_000_000_000_000_000n }));
  assert.equal(readRecord(home, { env }).state, actual.birth === 1_700_000_000_000_000_000n ? "ok" : "mismatch", "an equal inode with another birth time");
  if (actual.birth !== null) {
    rewriteIdentity(dir, () => ({ dev: actual.dev + 12n, ino: actual.ino, birth: actual.birth }));
    assert.equal(readRecord(home, { env }).state, "ok", "the device changed, the inode and the birth time did not (a btrfs boot)");
    rewriteIdentity(dir, () => ({ dev: actual.dev, ino: actual.ino + 1n, birth: actual.birth }));
    assert.equal(readRecord(home, { env }).state, "mismatch", "another inode");
  }
  // A record that holds no birth time: the device and the inode decide.
  rewriteIdentity(dir, () => ({ dev: actual.dev, ino: actual.ino, birth: null }));
  assert.equal(readRecord(home, { env }).state, "ok");
  rewriteIdentity(dir, () => ({ dev: actual.dev + 12n, ino: actual.ino, birth: null }));
  assert.equal(readRecord(home, { env }).state, "mismatch");
});

test("a new directory at the same path is another home: the old record is not its record, a launch there starts a new one, and the old ids are gone", (t) => {
  const { home, env, dir } = layout(t);
  noteThread(home, "thr_old", { env });
  // The old directory is moved away before the new one is made, so the two are never one
  // inode, whatever the filesystem reuses (the reuse case is told apart by the birth time, above).
  renameSync(home, `${home}.gone`);
  mkdirSync(home);
  const before = readRecord(home, { env });
  assert.equal(before.state, "mismatch");
  assert.equal(before.ids, undefined, "it vouches for nothing here");
  // The retire hook leaves such a record as it is: it is not this home's to remove.
  removeRecord(before);
  assert.equal(existsSync(before.file), true);
  noteThread(home, "thr_new", { env });
  assert.deepEqual([...readRecord(home, { env }).ids], ["thr_new"]);
  assert.equal(readFileSync(only(dir), "utf8").includes("thr_old"), false);
  assert.equal(readdirSync(dir).length, 1, "one file per path: no leftover beside it");
});

test("a line that was not written whole makes the record malformed, and so does anything that is not one thread id", (t) => {
  const { home, env, dir } = layout(t);
  noteThread(home, "thr_a", { env });
  const file = only(dir);
  const whole = readFileSync(file, "utf8");
  for (const [tail, why] of [["thr_b", /last line was not written whole/], ["thr_", /last line was not written whole/], ["\n", /line 3 is not one thread id/], ["thr b\n", /line 3/], ["--yes\n", /line 3/], ["thr_b\r\n", /line 3/], [`${"x".repeat(129)}\n`, /line 3/]]) {
    writeFileSync(file, whole + tail);
    const record = readRecord(home, { env });
    assert.equal(record.state, "malformed", JSON.stringify(tail));
    assert.match(record.why, why);
    assert.equal(record.ids, undefined);
  }
  for (const text of ["", "thr_a\n", "oats-bb-home 2 dev=1 ino=2 birth=3\nthr_a\n", "oats-bb-home 1 dev=1 ino=2\nthr_a\n", whole.replace("\n", "\n\n")]) {
    writeFileSync(file, text);
    assert.equal(readRecord(home, { env }).state, "malformed", JSON.stringify(text));
  }
  writeFileSync(file, Buffer.concat([Buffer.from(whole), Buffer.from([0xff, 0xfe, 0x0a])]));
  assert.equal(readRecord(home, { env }).state, "malformed");
  // A malformed record can never vouch for anything again: the next launch starts a new
  // one, and the retire hook removes it.
  noteThread(home, "thr_c", { env });
  assert.deepEqual([...readRecord(home, { env }).ids], ["thr_c"]);
  writeFileSync(file, `${whole}thr_`);
  removeRecord(readRecord(home, { env }));
  assert.equal(existsSync(file), false);
  assert.equal(readRecord(home, { env }).state, "missing");
});

test("a file with other modes, another owner, a second name, or that is no regular file reads as unreadable; so does a directory of the record that is not the provider's", (t) => {
  const { root, home, env, dir } = layout(t);
  noteThread(home, "thr_a", { env });
  const file = only(dir);
  const unreadable = (why, options = {}) => {
    const record = readRecord(home, { env, ...options });
    assert.equal(record.state, "unreadable", String(why));
    assert.match(record.why, why);
    assert.equal(record.ids, undefined);
    // Not the provider's file: a launch does not write it, and the retire hook does not remove it.
    assert.throws(() => noteThread(home, "thr_b", { env, ...options }), RecordError);
    removeRecord(record);
  };
  for (const other of [0o644, 0o640, 0o660, 0o400, 0o700, 0o604]) {
    chmodSync(file, other);
    unreadable(new RegExp(`mode is ${other.toString(8)}, not 600`));
  }
  chmodSync(file, 0o600);
  assert.equal(readRecord(home, { env }).state, "ok");
  // Another owner: the file is this user's, and the reader is told it runs as someone else.
  unreadable(/another user's/, { uid: process.geteuid() + 1 });
  // A link to the record, and a directory in its place: neither is read, written or removed.
  const elsewhere = join(root, "elsewhere");
  renameSync(file, elsewhere);
  symlinkSync(elsewhere, file);
  unreadable(/it is a link/);
  assert.equal(lstatSync(file).isSymbolicLink(), true);
  rmSync(file);
  mkdirSync(file);
  unreadable(/not a regular file|could not be opened/);
  rmSync(file, { recursive: true });
  renameSync(elsewhere, file);
  // A second name for the same file (a hard link).
  linkSync(file, join(root, "second-name"));
  unreadable(/not a regular file with one name/);
  rmSync(join(root, "second-name"));
  assert.equal(readRecord(home, { env }).state, "ok");
  // The directories: 0700, this user's, real directories.
  for (const path of [dir, stateRoot(env)]) {
    chmodSync(path, 0o755);
    unreadable(/has mode 755, not 700/);
    chmodSync(path, 0o700);
  }
  unreadable(/another user's/, { uid: process.geteuid() + 1 });
  renameSync(dir, `${dir}.real`);
  symlinkSync(`${dir}.real`, dir);
  unreadable(/is not a directory/);
  assert.equal(existsSync(join(`${dir}.real`, file.slice(dir.length + 1))), true, "nothing was removed");
});

test("no record at all reads as missing, whatever is not there: the state directory, the homes directory, the file", (t) => {
  const { home, env, dir } = layout(t);
  assert.deepEqual(readRecord(home, { env }), { state: "missing", file: null });
  mkdirSync(stateRoot(env), { recursive: true, mode: 0o700 });
  assert.deepEqual(readRecord(home, { env }), { state: "missing", file: null });
  mkdirSync(dir, { mode: 0o700 });
  assert.deepEqual(readRecord(home, { env }), { state: "missing", file: null });
  removeRecord(readRecord(home, { env })); // nothing to remove, and no failure
  assert.deepEqual(readdirSync(dir), []);
  // A home that is not there cannot be matched to anything.
  assert.equal(readRecord(`${home}-none`, { env }).state, "unreadable");
  assert.throws(() => noteThread(`${home}-none`, "thr_a", { env }), RecordError);
  assert.throws(() => noteThread(home, "--yes", { env }), RecordError);
  assert.deepEqual(readdirSync(dir), []);
});

// The launch writes the record from its answer; the retire hook reads it (test/unit/retire-environment.test.mjs).
async function launchSetup(t, env) {
  const { dir, home } = scratch(t);
  const backend = await fakeBackend(t);
  const bb = fakeBbIn(dir, {
    "--version": { stdout: `${VERSION}\n` }, "project list": { stdout: [projectRow("proj_a", home)] }, "thread list": { stdout: [] },
    "thread spawn": [{ stdout: { id: "thr_new", projectId: "proj_a", environmentId: null, providerId: "claude-code", status: "starting" } }, { stdout: { id: "thr_next", projectId: "proj_a", environmentId: null, providerId: "claude-code", status: "starting" } }],
  });
  const input = { home, instance: "dev-a", harness: "claude", model: "claude-opus-5-5", yolo: true, env: [{ name: "OATS_INSTANCE", value: "dev-a", source: "kernel" }, { name: "OATS_INSTANCE_HOME", value: home, source: "kernel" }], args: [], promptFile: join(home, "TASK.md"), previous: null };
  return { dir, home, backend, bb, launch: () => callSeen("launch", input, { settings: backend.settings(), bb, env }) };
}

test("each launch adds the thread it made to the home's record, one line; a launch that is refused adds none", async (t) => {
  const state = mkdtempSync(join(tmpdir(), "oats-bb-record-state-"));
  t.after(() => rmSync(state, { recursive: true, force: true }));
  const env = { XDG_STATE_HOME: state };
  const { home, launch, bb } = await launchSetup(t, env);
  const first = await launch();
  assert.equal(first.doc.result.endpoint.threadId, "thr_new");
  assert.equal(first.stderr, "");
  assert.deepEqual([...readRecord(home, { env }).ids], ["thr_new"]);
  assert.equal((await launch()).doc.result.endpoint.threadId, "thr_next");
  assert.deepEqual([...readRecord(home, { env }).ids], ["thr_new", "thr_next"]);
  const lines = readFileSync(only(recordDir(env)), "utf8").split("\n");
  assert.deepEqual(lines.slice(1), ["thr_new", "thr_next", ""]);
  // bb's no to the spawn: no thread, and nothing noted.
  bb.setScript({ "--version": { stdout: `${VERSION}\n` }, "project list": { stdout: [projectRow("proj_a", home)] }, "thread list": { stdout: [] }, "thread spawn": { error: { code: "invalid_request", message: "HTTP 400: no" } } });
  assert.equal((await launch()).doc.ok, false);
  assert.deepEqual([...readRecord(home, { env }).ids], ["thr_new", "thr_next"]);
});

test("a record that cannot be written never fails the launch: the endpoint is answered, the command says so on stderr, and the thread is unmarked", async (t) => {
  const state = mkdtempSync(join(tmpdir(), "oats-bb-record-state-"));
  t.after(() => rmSync(state, { recursive: true, force: true }));
  // The state directory's place is taken by a file: nothing can be made below it.
  writeFileSync(join(state, "oats-bb"), "in the way\n");
  const env = { XDG_STATE_HOME: state };
  const { home, backend, launch } = await launchSetup(t, env);
  const { doc, stderr } = await launch();
  assert.deepEqual(doc.result, { endpoint: { server: backend.server, projectId: "proj_a", threadId: "thr_new" } });
  assert.match(stderr, /^oats bb: warning: bb thread thr_new runs, and could not be noted in this home's thread record \(.+\): the home's retire will archive its bb threads and not delete its bb environment\n$/);
  assert.equal(readRecord(home, { env }).state, "unreadable");
  assert.equal(readFileSync(join(state, "oats-bb"), "utf8"), "in the way\n");
  // And a record that is there and is not the provider's to write (another mode): the same.
  rmSync(join(state, "oats-bb"));
  noteThread(home, "thr_before", { env });
  chmodSync(only(recordDir(env)), 0o644);
  const again = await launch();
  assert.equal(again.doc.result.endpoint.threadId, "thr_next");
  assert.match(again.stderr, /could not be noted in this home's thread record \(the home's thread record is not the provider's to write: its mode is 644, not 600\)/);
  assert.equal(readFileSync(only(recordDir(env)), "utf8").includes("thr_next"), false);
});

test("no other verb writes the record, or makes one: inspect, inspectMany, input, stop, check and the launch hook leave the state directory as it is", async (t) => {
  const state = mkdtempSync(join(tmpdir(), "oats-bb-record-state-"));
  t.after(() => rmSync(state, { recursive: true, force: true }));
  const env = { XDG_STATE_HOME: state };
  const { dir, home } = scratch(t);
  const endpoint = { server: "http://127.0.0.1:38886", projectId: "proj_a", threadId: "thr_a" };
  const thread = { id: "thr_a", projectId: "proj_a", environmentId: "env_a", status: "idle", archivedAt: null, deletedAt: null, queuedWork: "none", environmentPath: home };
  const bb = fakeBbIn(dir, { "thread list": { stdout: [thread] }, "thread show": { stdout: { thread, environment: null, pendingTodos: null } }, "thread stop": { stdout: { ok: true } }, "thread archive": { stdout: { ok: true } },
    "thread interactions list": { stdout: [] }, "thread tell": { stdout: tellSent("thr_a") }, "project list": { stdout: [projectRow("proj_a", home)] } });
  const settings = { version: VERSION, trust: "single-user" };
  const verbs = [["inspect", { home, endpoint }], ["inspectMany", { homes: [{ home, endpoint }] }], ["input", { home, endpoint, text: "hello" }], ["stop", { home, endpoint, graceSeconds: 2 }], ["stop", { home, endpoint: null, graceSeconds: 2 }]];
  // The launch hook of a home that moves off bb, as the kernel runs it.
  const launchHook = () => runBin(["launch-hook"], { env: { ...bb.env, ...env, OATS_INSTANCE_HOME: home, OATS_BACKEND: "tmux", OATS_PREVIOUS_BACKEND: "bb", OATS_SETTINGS: JSON.stringify({ ...settings, cli: bb.cli }) } });
  // With no record: none is made.
  for (const [verb, input] of verbs) {
    const answer = await call(verb, input, { settings, bb, env });
    assert.equal(answer.ok, true, `${verb}: ${JSON.stringify(answer)}`);
    assert.deepEqual(readdirSync(state), [], verb);
  }
  assert.equal((await call("check", { home, soul: null }, { settings, bb, env })).ok, true);
  assert.equal((await launchHook()).status, 0);
  assert.deepEqual(readdirSync(state), []);
  // With one: it is as it was, to the byte and the time.
  noteThread(home, "thr_a", { env });
  const file = only(recordDir(env));
  const before = [readFileSync(file, "utf8"), statSync(file).mtimeMs, mode(file)];
  for (const [verb, input] of verbs) {
    assert.equal((await call(verb, input, { settings, bb, env })).ok, true, verb);
    assert.deepEqual([readFileSync(file, "utf8"), statSync(file).mtimeMs, mode(file)], before, verb);
  }
  assert.equal((await call("check", { home, soul: null }, { settings, bb, env })).ok, true);
  assert.equal((await launchHook()).status, 0);
  assert.deepEqual([readFileSync(file, "utf8"), statSync(file).mtimeMs, mode(file)], before);
  assert.deepEqual(readdirSync(recordDir(env)).length, 1);
});
