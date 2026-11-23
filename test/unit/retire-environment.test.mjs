// The retire hook's last step (contract r32, A17): it deletes the home's bb environment
// where every thread on it is one the provider made for this home, and only then. bb
// keeps one environment per home, shared by a person's threads there too.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { appendFileSync, chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, readlinkSync, renameSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { noteThread, readRecord, recordDir } from "../../oats-package/capabilities/oats-bb/lib/record.mjs";
import { UNREACHABLE, environmentRow, fakeBbIn, projectRow, runBin, scratch, threadRow } from "../fixtures/harness.mjs";

const ENV = "env_home";
/** A thread of the home's project on the home's environment, archived (as the stop inside a retire leaves one). */
const onEnv = (id, extra = {}) => threadRow(id, "proj_a", "idle", { environmentId: ENV, archivedAt: 5, ...extra });
// The calls by name; the reads of a project's archived threads and of an environment's threads are named apart.
const verbs = (calls) => calls.map((c) => {
  const words = c.argv.filter((a) => !a.startsWith("-"));
  if (c.argv[1] === "list" && c.argv.includes("--environment")) return "thread list --environment";
  if (c.argv[1] === "list" && c.argv.includes("--archived")) return "thread list --archived";
  return words.slice(0, 2).join(" ");
});
const deletes = (calls) => calls.filter((c) => c.argv[0] === "environment" && c.argv[1] === "delete").map((c) => c.argv);
const WHY = /the home's bb environment was not deleted \((.+)\): its threads are archived only: if the home is kept, a person can unarchive one in bb and a message then starts its agent with no OATS around it/;

/** Every file of a tree with its type, mode, size and content hash (a link: where it points). */
function listing(root) {
  const out = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir).sort()) {
      const path = join(dir, name), stat = lstatSync(path);
      const what = stat.isSymbolicLink() ? `link ${readlinkSync(path)}` : stat.isDirectory() ? "dir" : `file ${stat.size} ${createHash("sha256").update(readFileSync(path)).digest("hex")}`;
      out.push(`${path.slice(root.length)} ${(stat.mode & 0o7777).toString(8)} ${what} ${stat.mtimeMs}`);
      if (stat.isDirectory() && !stat.isSymbolicLink()) walk(path);
    }
  };
  walk(root);
  return out;
}

/** A home with its state directory, and a retire of it against a scripted bb.
 *  `noted`: the threads the provider's launches noted for this home (null: none ever did). */
function setup(t, { noted = ["thr_a"] } = {}) {
  const { dir, home } = scratch(t);
  const state = mkdtempSync(join(tmpdir(), "oats-bb-retire-state-"));
  t.after(() => rmSync(state, { recursive: true, force: true }));
  const env = { XDG_STATE_HOME: state };
  for (const id of noted ?? []) noteThread(home, id, { env });
  const records = () => (existsSync(recordDir(env)) ? readdirSync(recordDir(env)) : []);
  /** The script of a home whose only thread the retire's own stop archived, unless told otherwise. */
  const retire = async (script = {}, { settings = {} } = {}) => {
    const bb = fakeBbIn(dir, {
      "project list": { stdout: [projectRow("proj_a", home)] }, "thread list": { stdout: [] },
      "thread list --archived": { stdout: [onEnv("thr_a")] }, "thread stop": { stdout: { ok: true } },
      "environment show": { stdout: environmentRow(ENV, home) }, "thread list --environment": { stdout: [onEnv("thr_a")] },
      "environment delete": { stdout: { ok: true } },
      ...(typeof script === "function" ? script(home) : script),
    });
    // (One log for every retire of this home: a run's calls are those after the ones before it.)
    const earlier = bb.calls().length;
    const run = await runBin(["retire-hook"], { env: { ...bb.env, ...env, OATS_INSTANCE_HOME: home, OATS_SETTINGS: JSON.stringify({ cli: bb.cli, ...settings }) } });
    assert.equal(run.status, 0, run.stderr);
    const lines = run.stdout.trim().split("\n");
    assert.equal(lines.length, 1, run.stdout);
    return { run, last: JSON.parse(lines[0]), calls: bb.calls().slice(earlier) };
  };
  return { dir, home, env, records, retire };
}

test("retire deletes the home's bb environment once its threads are stopped and archived, every thread on it being in the home's record; then the record goes", async (t) => {
  const { home, env, records, retire } = setup(t);
  const before = listing(home);
  const { run, last, calls } = await retire({}, { settings: { hostDaemonPort: 40123 } });
  assert.deepEqual(last, { meta: { retired: true, archived: ["thr_a"], environments: [ENV] } });
  assert.equal(run.stderr, "");
  // The stop and the archive come first, the delete last; the list of the environment's threads is bb's whole one.
  assert.deepEqual(verbs(calls), ["project list", "thread list", "thread list --archived", "thread stop", "thread list --archived", "thread list", "machine env", "environment show", "thread list --environment", "environment delete"]);
  assert.deepEqual(calls.find((c) => c.argv.includes("--environment")).argv, ["thread", "list", "--environment", ENV, "--include-archived", "--include-hidden", "--json"]);
  assert.deepEqual(deletes(calls), [["environment", "delete", ENV, "--json"]]);
  // Every bb call is told this bb's host daemon port, the delete too (settings.oats.bb.hostDaemonPort).
  assert.deepEqual([...new Set(calls.map((c) => c.hostDaemonPort))], ["40123"]);
  // The home is not touched: the hook asks bb, and bb's delete of a local directory leaves it alone.
  assert.deepEqual(listing(home), before);
  assert.deepEqual(records(), [], "the record has answered its one question");
  assert.equal(readRecord(home, { env }).state, "missing");
});

test("retire deletes the environment of the threads it archived itself, and its receipt names them", async (t) => {
  const { retire } = setup(t, { noted: ["thr_first", "thr_a"] });
  const { last, calls } = await retire({
    "thread list": { stdout: [threadRow("thr_a", "proj_a", "idle", { environmentId: ENV })] },
    "thread show": { stdout: { thread: threadRow("thr_a", "proj_a", "idle", { environmentId: ENV }), environment: null, pendingTodos: null } },
    "thread archive": { stdout: { ok: true, threadId: "thr_a" } },
    "thread list --archived": { stdout: [onEnv("thr_a"), onEnv("thr_first")] },
    "thread list --environment": { stdout: [onEnv("thr_a"), onEnv("thr_first")] },
  });
  assert.deepEqual(last, { meta: { retired: true, archived: ["thr_a", "thr_first"], environments: [ENV] } });
  assert.ok(verbs(calls).indexOf("thread archive") < verbs(calls).indexOf("environment delete"));
});

test("a person's archived thread on the environment blocks the delete: archive only, and the warning says why", async (t) => {
  const { records, retire } = setup(t);
  const { last, calls, run } = await retire({
    "thread list --archived": { stdout: [onEnv("thr_a"), onEnv("thr_person")] },
    "thread list --environment": { stdout: [onEnv("thr_a"), onEnv("thr_person")] },
  });
  assert.deepEqual(deletes(calls), []);
  assert.deepEqual(last.meta, { archived: ["thr_a"] }, "the receipt names the home's own thread, and no environment");
  assert.match(last.warning, WHY);
  assert.equal(WHY.exec(last.warning)[1], `1 thread on bb environment ${ENV} is not in this home's thread record (a person's, or one the provider could not note): thr_person`);
  assert.equal(run.stderr, "");
  assert.deepEqual(records(), [], "the hook has decided: the record goes");
});

test("a person's thread that the hook itself stopped and archived blocks the delete too", async (t) => {
  const { retire } = setup(t);
  const { last, calls } = await retire({
    "thread list": { stdout: [threadRow("thr_person", "proj_a", "idle", { environmentId: ENV })] },
    "thread show": { stdout: { thread: threadRow("thr_person", "proj_a", "idle", { environmentId: ENV }), environment: null, pendingTodos: null } },
    "thread archive": { stdout: { ok: true, threadId: "thr_person" } },
    "thread list --archived": { stdout: [onEnv("thr_a"), onEnv("thr_person")] },
    "thread list --environment": { stdout: [onEnv("thr_a"), onEnv("thr_person")] },
  });
  assert.deepEqual(deletes(calls), []);
  assert.deepEqual(last.meta.archived, ["thr_person", "thr_a"], "what this hook archived is its own to report");
  assert.match(last.warning, /thr_person/);
});

test("an unmarked thread blocks the delete: several are counted, and the first are named", async (t) => {
  const { retire } = setup(t);
  const rows = [onEnv("thr_a"), ...Array.from({ length: 5 }, (_, i) => onEnv(`thr_unmarked_${i}`))];
  const { last, calls } = await retire({ "thread list --archived": { stdout: rows }, "thread list --environment": { stdout: rows } });
  assert.deepEqual(deletes(calls), []);
  assert.equal(WHY.exec(last.warning)[1], `5 threads on bb environment ${ENV} are not in this home's thread record (a person's, or one the provider could not note): thr_unmarked_0, thr_unmarked_1, thr_unmarked_2 and 2 more`);
  assert.ok(last.warning.length <= 480);
});

test("a thread on the environment that only bb's own list shows (another project's, a hidden one) blocks the delete", async (t) => {
  const { retire } = setup(t);
  const { last, calls } = await retire({ "thread list --environment": { stdout: [onEnv("thr_a"), threadRow("thr_elsewhere", "proj_other", "idle", { environmentId: ENV, archivedAt: 4, visibility: "hidden" })] } });
  assert.deepEqual(deletes(calls), []);
  assert.match(last.warning, /thr_elsewhere/);
  assert.deepEqual(last.meta, { archived: ["thr_a"] });
});

for (const [name, answer, why] of [
  ["a bb that does not answer it", UNREACHABLE, /^bb's list of the threads on environment env_home could not be read \(E_BACKEND_UNREACHABLE\)$/],
  ["a failure of bb's own", { error: { code: "error", message: "HTTP 500: boom" } }, /could not be read \(E_SESSION_UNAVAILABLE\)$/],
  ["something that is not a list", { stdout: { threads: [] } }, /could not be read \(E_SESSION_UNAVAILABLE\)$/],
  ["a row that cannot be read", { stdout: [onEnv("thr_a"), { id: "thr_b" }] }, /could not be read \(E_SESSION_UNAVAILABLE\)$/],
  ["a row of another environment", { stdout: [onEnv("thr_a"), onEnv("thr_a2", { environmentId: "env_other" })] }, /could not be read \(E_SESSION_UNAVAILABLE\)$/],
  ["a row that names no environment", { stdout: [onEnv("thr_a", { environmentId: null })] }, /could not be read \(E_SESSION_UNAVAILABLE\)$/],
  // A list that reads well and is short: it lacks a thread the hook itself saw on that environment.
  ["an empty list", { stdout: [] }, /^bb's list of the threads on environment env_home is not whole \(it lacks a thread of this home's bb project that is on it\)$/],
]) {
  test(`bb's list of the environment's threads that is not read whole blocks the delete: ${name}`, async (t) => {
    const { records, retire } = setup(t);
    const { last, calls } = await retire({ "thread list --environment": answer });
    assert.deepEqual(deletes(calls), []);
    assert.match(WHY.exec(last.warning)[1], why);
    assert.doesNotMatch(last.warning, /boom/);
    assert.deepEqual(last.meta, { archived: ["thr_a"] });
    // Nothing was decided: the record stays, and a retire run again, with bb readable, deletes.
    assert.equal(records().length, 1);
    assert.deepEqual((await retire()).last, { meta: { retired: true, archived: ["thr_a"], environments: [ENV] } });
    assert.deepEqual(records(), []);
  });
}

test("an environment bb cannot show blocks the delete; one bb no longer has, or has destroyed, is nothing to delete and nothing to warn of", async (t) => {
  const { retire, records } = setup(t);
  const unread = await retire({ "environment show": { error: { code: "error", message: "HTTP 500: boom" } } });
  assert.deepEqual(deletes(unread.calls), []);
  assert.equal(WHY.exec(unread.last.warning)[1], `bb environment ${ENV} could not be read (E_SESSION_UNAVAILABLE)`);
  assert.equal(records().length, 1, "nothing was decided: the record stays");
  for (const [answer, noted] of [[{ error: { code: "environment_not_found", message: "HTTP 404: Environment not found" } }, ["thr_a"]], [{ stdout: environmentRow(ENV, null, { status: "destroyed" }) }, ["thr_a"]], [{ stdout: environmentRow(ENV, null, { status: "destroyed" }) }, null]]) {
    const again = setup(t, { noted });
    const { last, calls } = await again.retire({ "environment show": answer });
    assert.deepEqual(last, { meta: { retired: true, archived: ["thr_a"] } }, JSON.stringify(answer));
    assert.equal(verbs(calls).includes("thread list --environment"), false);
    assert.deepEqual(deletes(calls), []);
  }
  // A row that does not say what the environment is proves nothing.
  const vague = await setup(t).retire({ "environment show": { stdout: { id: ENV, path: "/somewhere", status: "ready" } } });
  assert.deepEqual(deletes(vague.calls), []);
  assert.match(vague.last.warning, WHY);
});

test("only the local-path kind is deleted: an environment bb manages, or one of another provider, is archived only; one that is not the home's directory is not the home's", async (t) => {
  for (const [extra, said] of [[{ environmentProviderId: "git-worktree", isWorktree: true, managed: true, workspaceProvisionType: "managed" }, "git-worktree, managed by bb"], [{ environmentProviderId: "remote-machine" }, "remote-machine"], [{ managed: true }, "project-checkout, managed by bb"]]) {
    const { home, retire } = setup(t);
    const { last, calls } = await retire({ "environment show": { stdout: environmentRow(ENV, home, extra) } });
    assert.deepEqual(deletes(calls), [], said);
    assert.equal(WHY.exec(last.warning)[1], `bb environment ${ENV} is not a local directory bb leaves alone (it is ${said})`);
    assert.equal(verbs(calls).includes("thread list --environment"), false);
  }
  // An environment at another directory than the home is never deleted, and its threads are not listed.
  // A thread of the home's own on it (one moved to another directory) is left with an environment: the warning says so.
  for (const path of ["work", "-other", "/"]) {
    const { home, records, retire } = setup(t);
    const { last, calls } = await retire({ "environment show": { stdout: environmentRow(ENV, path === "/" ? "/" : path === "work" ? `${home}/work` : `${home}${path}`) } });
    assert.deepEqual(deletes(calls), [], path);
    assert.equal(verbs(calls).includes("thread list --environment"), false);
    assert.equal(WHY.exec(last.warning)[1], `1 thread of this home is on bb environment ${ENV}, which is not the home's directory and is never deleted: thr_a`);
    assert.deepEqual(last.meta, { archived: ["thr_a"] });
    assert.deepEqual(records(), [], "a no that rests on what was read: decided");
  }
  // A person's thread of the home's project that runs elsewhere (their worktree) is not this home's to speak of:
  // the home's own environment is deleted, and nothing is said of theirs.
  const { home, retire } = setup(t);
  const { last, calls } = await retire({
    "thread list --archived": { stdout: [onEnv("thr_a"), onEnv("thr_person", { environmentId: "env_theirs" })] },
    "environment show": [{ stdout: environmentRow(ENV, home) }, { stdout: environmentRow("env_theirs", `${home}-worktree`, { environmentProviderId: "git-worktree", managed: true }) }],
  });
  assert.deepEqual(last, { meta: { retired: true, archived: ["thr_a"], environments: [ENV] } });
  assert.deepEqual(deletes(calls), [["environment", "delete", ENV, "--json"]]);
});

test("a home with no record gets archive only, and the warning says a home spawned before the record gets none", async (t) => {
  const { retire, records } = setup(t, { noted: null });
  const { last, calls } = await retire();
  assert.deepEqual(deletes(calls), []);
  assert.equal(verbs(calls).includes("thread list --environment"), false, "with no record nothing more is asked of bb");
  assert.equal(WHY.exec(last.warning)[1], "this home has no thread record of the provider's (a home spawned before oats.bb kept one gets none)");
  // With no record that is this home's, the receipt keeps its rule: every thread of the home's project archived in bb.
  const both = await retire({ "thread list --archived": { stdout: [onEnv("thr_a"), onEnv("thr_earlier")] } });
  assert.deepEqual(both.last.meta, { archived: ["thr_a", "thr_earlier"] });
  assert.deepEqual(records(), []);
});

test("the receipt's archived, both ways: with the home's record only the threads in it (and this hook's own); with none, every archived thread of the home's project", async (t) => {
  const rows = [onEnv("thr_a"), onEnv("thr_earlier_home", { environmentId: "env_gone" }), onEnv("thr_b")];
  const script = (home) => ({
    "thread list": { stdout: [threadRow("thr_live", "proj_a", "idle", { environmentId: ENV })] },
    "thread show": { stdout: { thread: threadRow("thr_live", "proj_a", "idle", { environmentId: ENV }), environment: null, pendingTodos: null } },
    "thread archive": { stdout: { ok: true, threadId: "thr_live" } },
    "thread list --archived": { stdout: [onEnv("thr_live"), ...rows] },
    "thread list --environment": { stdout: [onEnv("thr_live"), onEnv("thr_a"), onEnv("thr_b")] },
    // The home's environment, then the earlier home's, which bb destroyed at its retire.
    "environment show": [{ stdout: environmentRow(ENV, home) }, { stdout: environmentRow("env_gone", null, { status: "destroyed" }) }],
  });
  // A home at a path an earlier home had: bb's project holds that home's thread too.
  const narrowed = await setup(t, { noted: ["thr_a", "thr_b", "thr_live"] }).retire(script);
  assert.deepEqual(narrowed.last, { meta: { retired: true, archived: ["thr_live", "thr_a", "thr_b"], environments: [ENV] } });
  // What this hook archived is listed even where the record does not hold it.
  const own = await setup(t, { noted: ["thr_a", "thr_b"] }).retire(script);
  assert.deepEqual(own.last.meta, { archived: ["thr_live", "thr_a", "thr_b"] });
  assert.match(own.last.warning, /thr_live/);
  // No record: today's rule.
  const whole = await setup(t, { noted: null }).retire(script);
  assert.deepEqual(whole.last.meta, { archived: ["thr_live", "thr_a", "thr_earlier_home", "thr_b"] });
  // A record that is this home's and names none of the project's archived threads: bb holds nothing of this home.
  const none = await setup(t, { noted: ["thr_never_seen"] }).retire({ "thread list --archived": { stdout: [onEnv("thr_earlier_home", { environmentId: "env_gone" })] }, "environment show": { stdout: environmentRow("env_gone", null, { status: "destroyed" }) } });
  assert.deepEqual(none.last, { meta: { retired: false, reason: "nothing-to-delete" } });
});

test("a home respawned at the same path, with an old record left behind, deletes nothing on the old record's strength", async (t) => {
  const { home, env, records, retire } = setup(t, { noted: ["thr_old"] });
  const oldRecord = readFileSync(join(recordDir(env), records()[0]), "utf8");
  // The old home goes without a retire, and a new one is made at its path: another directory.
  renameSync(home, `${home}.gone`);
  mkdirSync(join(home, "work"), { recursive: true });
  // Before the new home's first launch noted anything: the old record is all there is, and bb still has the old home's thread on the path's environment.
  const first = await retire({ "thread list --archived": { stdout: [onEnv("thr_old")] }, "thread list --environment": { stdout: [onEnv("thr_old")] } });
  assert.deepEqual(deletes(first.calls), []);
  assert.equal(WHY.exec(first.last.warning)[1], "this home has no thread record of the provider's (a home spawned before oats.bb kept one gets none)");
  assert.deepEqual(first.last.meta, { archived: ["thr_old"] }, "no record of this home: the receipt's earlier rule");
  assert.equal(readFileSync(join(recordDir(env), records()[0]), "utf8"), oldRecord, "a record of another directory is left as it is");
  // After the new home launched: its record names its own thread, and the old home's thread on the shared environment is unmarked.
  noteThread(home, "thr_new", { env });
  const rows = [onEnv("thr_new"), onEnv("thr_old")];
  const second = await retire({ "thread list --archived": { stdout: rows }, "thread list --environment": { stdout: rows } });
  assert.deepEqual(deletes(second.calls), []);
  assert.match(WHY.exec(second.last.warning)[1], /^1 thread on bb environment env_home is not in this home's thread record .*: thr_old$/);
  assert.deepEqual(second.last.meta, { archived: ["thr_new"] });
});

test("a record with a torn line is malformed: archive only, the warning says so, and the record goes", async (t) => {
  const { env, records, retire } = setup(t);
  appendFileSync(join(recordDir(env), records()[0]), "thr_b"); // a line cut short: no line end
  const { last, calls } = await retire();
  assert.deepEqual(deletes(calls), []);
  assert.equal(WHY.exec(last.warning)[1], "this home's thread record is malformed (its last line was not written whole)");
  assert.deepEqual(last.meta, { archived: ["thr_a"] });
  assert.deepEqual(records(), []);
});

test("a record that is unreadable (another mode) blocks the delete and is left where it is", async (t) => {
  const { env, records, retire } = setup(t);
  const file = join(recordDir(env), records()[0]);
  chmodSync(file, 0o644);
  const { last, calls } = await retire();
  assert.deepEqual(deletes(calls), []);
  assert.equal(WHY.exec(last.warning)[1], "this home's thread record is unreadable (its mode is 644, not 600)");
  assert.equal(existsSync(file), true, "not the provider's file to remove");
});

test("the delete is asked only once every thread of the home is stopped and archived: one that would not stop, or an archived one whose stop is not confirmed, leaves archive only", async (t) => {
  const stuckHome = setup(t, { noted: ["thr_first", "thr_a"] });
  const stuck = await stuckHome.retire({
    "thread list": { stdout: [threadRow("thr_a", "proj_a", "active", { environmentId: ENV })] },
    "thread show": { stdout: { thread: threadRow("thr_a", "proj_a", "active", { environmentId: ENV }), environment: null, pendingTodos: null } },
    "thread list --archived": { stdout: [onEnv("thr_first")] },
  });
  assert.deepEqual(deletes(stuck.calls), []);
  assert.deepEqual(stuck.last.meta, { archived: ["thr_first"], left: ["thr_a"] });
  assert.match(WHY.exec(stuck.last.warning)[1], /^not every bb thread of this home was stopped and archived$/);
  assert.equal(stuckHome.records().length, 1, "nothing was decided: the record stays for a retire run again");
  // The usual home, one thread that was never restarted: the thread that will not stop is on no
  // archived row, so no environment is looked at. Nothing is decided there either, and the record stays.
  const soleHome = setup(t);
  const sole = await soleHome.retire({
    "thread list": { stdout: [threadRow("thr_a", "proj_a", "active", { environmentId: ENV })] },
    "thread show": { stdout: { thread: threadRow("thr_a", "proj_a", "active", { environmentId: ENV }), environment: null, pendingTodos: null } },
    "thread list --archived": { stdout: [] },
  });
  assert.deepEqual(sole.last.meta, { archived: [], left: ["thr_a"] });
  assert.equal(verbs(sole.calls).includes("environment show"), false);
  assert.equal(soleHome.records().length, 1);
  assert.deepEqual((await soleHome.retire()).last, { meta: { retired: true, archived: ["thr_a"], environments: [ENV] } }, "a retire run again, the thread stopped by then, deletes");
  const unswept = await setup(t).retire({ "thread stop": { error: { code: "error", message: "HTTP 500: no" } } });
  assert.deepEqual(deletes(unswept.calls), []);
  assert.equal(unswept.last.meta.unswept, true);
  assert.match(unswept.last.warning, WHY);
  // And a thread bb's list shows unarchived on the environment (unarchived by a person a moment ago): bb would refuse, and it is not asked.
  const liveHome = setup(t);
  const live = await liveHome.retire({ "thread list --environment": { stdout: [onEnv("thr_a", { archivedAt: null })] } });
  assert.deepEqual(deletes(live.calls), []);
  assert.equal(WHY.exec(live.last.warning)[1], `a thread on bb environment ${ENV} is not archived`);
  assert.equal(liveHome.records().length, 1);
});

test("where the home's archived threads cannot be listed, no environment is looked for, and the warning says so", async (t) => {
  const { retire, records } = setup(t);
  const { last, calls } = await retire({ "thread list --archived": UNREACHABLE });
  assert.equal(verbs(calls).includes("environment show"), false);
  assert.deepEqual(last.meta, { archived: [], unswept: true });
  assert.equal(WHY.exec(last.warning)[1], "the home's archived bb threads could not be listed");
  assert.equal(records().length, 1, "nothing was decided: the record stays");
});

for (const [name, answer, said] of [
  ["bb refuses it", { error: { code: "invalid_request", message: "HTTP 409: Environment still has live threads" } }, /bb said: HTTP 409: Environment still has live threads\n$/],
  ["bb is down by then", UNREACHABLE, /bb said: fetch failed: connect ECONNREFUSED 127\.0\.0\.1:38886\n$/],
  ["bb's answer cannot be read", { stdout: "<html>", exit: 0 }, /bb said: bb environment delete answered something that is not JSON\n$/],
]) {
  test(`a delete that is not done never fails the retire: ${name}; the threads stay archived only, and the hook notes it on stderr`, async (t) => {
    const { records, retire } = setup(t);
    const { run, last, calls } = await retire({ "environment delete": answer });
    assert.equal(deletes(calls).length, 1);
    assert.deepEqual(last.meta, { archived: ["thr_a"] }, "no environment in the receipt, and the retire is not failed");
    // The warning says it was not done and what to run; bb's own words are on stderr.
    assert.equal(WHY.exec(last.warning)[1], "bb was asked to delete bb environment env_home and did not: delete it in bb (bb environment delete env_home)");
    assert.match(run.stderr, /^oats bb: warning: /);
    assert.match(run.stderr, said);
    assert.match(run.stderr, /^oats bb: warning: bb did not delete environment env_home of this home: its threads are archived only: if the home is kept, a person can unarchive one in bb and a message then starts its agent with no OATS around it\. Delete it in bb \(bb environment delete env_home\)\. bb said: /);
    assert.equal(run.stderr.trim().split("\n").length, 1);
    // bb did not do it: the record stays, and a retire run again, with bb answering, deletes.
    assert.equal(records().length, 1);
    assert.deepEqual((await retire()).last, { meta: { retired: true, archived: ["thr_a"], environments: [ENV] } });
    assert.deepEqual(records(), []);
  });
}

test("a delete bb does not answer does not hold the retire: the hook ends within its own time, with the note on stderr", async (t) => {
  const { retire } = setup(t);
  const started = Date.now();
  const { run, last } = await retire({ "environment delete": { delayMs: 120_000, stdout: { ok: true } } });
  assert.ok(Date.now() - started < 40_000, `the hook took ${Date.now() - started} ms`);
  assert.deepEqual(last.meta, { archived: ["thr_a"] });
  assert.match(last.warning, WHY);
  assert.match(run.stderr, /bb did not delete environment env_home of this home: .*bb said: bb environment delete did not answer within 10 s\n$/);
});

// The rule of the warning: whenever a thread of the home is left without a deleted
// environment. bb gives a thread its environment when its first turn starts, so a home
// retired before that has none to delete, and with the home kept the door is as open.
test("a thread of the home that has no environment yet (its first turn never started) leaves nothing to delete, and the retire warns as for archive only", async (t) => {
  const bare = onEnv("thr_a", { environmentId: null, status: "pending" });
  const { last, calls, run } = await setup(t).retire({ "thread list --archived": { stdout: [bare] } });
  assert.deepEqual(last.meta, { archived: ["thr_a"] });
  assert.equal(WHY.exec(last.warning)[1], "1 thread of this home has no bb environment to delete yet (bb makes one when a thread's first turn starts): thr_a");
  assert.equal(verbs(calls).includes("environment show"), false);
  assert.equal(run.stderr, "");
  // With no record every thread of the home's project is taken for the home's.
  const unrecorded = await setup(t, { noted: null }).retire({ "thread list --archived": { stdout: [bare, onEnv("thr_b", { environmentId: undefined })] } });
  assert.equal(WHY.exec(unrecorded.last.warning)[1], "2 threads of this home have no bb environment to delete yet (bb makes one when a thread's first turn starts): thr_a, thr_b");
  // One of an earlier home at this path, which this home's record does not hold, is not this home's to warn of; one this hook archived is.
  const earlier = await setup(t).retire({ "thread list --archived": { stdout: [onEnv("thr_a"), onEnv("thr_earlier", { environmentId: null })] } });
  assert.deepEqual(earlier.last, { meta: { retired: true, archived: ["thr_a"], environments: [ENV] } });
  const own = await setup(t).retire({
    "thread list": { stdout: [threadRow("thr_held", "proj_a", "pending", { environmentId: null })] },
    "thread show": { stdout: { thread: threadRow("thr_held", "proj_a", "pending", { environmentId: null }), environment: null, pendingTodos: null } },
    "thread archive": { stdout: { ok: true, threadId: "thr_held" } },
    "thread list --archived": { stdout: [onEnv("thr_held", { environmentId: null }), onEnv("thr_a")] },
  });
  assert.deepEqual(own.last.meta, { archived: ["thr_held", "thr_a"], environments: [ENV] });
  assert.match(WHY.exec(own.last.warning)[1], /^1 thread of this home has no bb environment to delete yet .*: thr_held$/);
});

test("run twice, the hook is quiet the second time: the environment is destroyed, and the record is gone", async (t) => {
  const { home, retire } = setup(t);
  assert.deepEqual((await retire()).last.meta.environments, [ENV]);
  const { last, calls, run } = await retire({ "environment show": { stdout: environmentRow(ENV, null, { status: "destroyed" }) } });
  assert.deepEqual(last, { meta: { retired: true, archived: ["thr_a"] } });
  assert.deepEqual(deletes(calls), []);
  assert.equal(run.stderr, "");
  assert.equal(existsSync(home), true);
});

test("a no that rests on what was read is decided, and the record goes: a retire run again says there is no record, and deletes nothing", async (t) => {
  const { records, retire } = setup(t);
  const rows = [onEnv("thr_a"), onEnv("thr_person")];
  const script = { "thread list --archived": { stdout: rows }, "thread list --environment": { stdout: rows } };
  assert.match(WHY.exec((await retire(script)).last.warning)[1], /thr_person$/);
  assert.deepEqual(records(), []);
  const again = await retire(script);
  assert.deepEqual(deletes(again.calls), []);
  assert.match(WHY.exec(again.last.warning)[1], /^this home has no thread record/);
});

test("where bb cannot be asked at all nothing was decided: the record stays, and a retire run again deletes", async (t) => {
  const { records, retire } = setup(t);
  const down = await retire({ "project list": UNREACHABLE });
  assert.deepEqual(down.last.meta, { archived: [], unchecked: true });
  assert.equal(records().length, 1);
  const again = await retire();
  assert.deepEqual(again.last, { meta: { retired: true, archived: ["thr_a"], environments: [ENV] } });
  assert.deepEqual(records(), []);
});

test("a home bb has nothing of (one that never launched on bb) is told nothing, and no record is made for it", async (t) => {
  const { records, retire } = setup(t, { noted: null });
  const { last, calls, run } = await retire({ "project list": { stdout: [] } });
  assert.deepEqual(last, { meta: { retired: false, reason: "nothing-to-delete" } });
  assert.deepEqual(verbs(calls), ["project list", "thread list"]);
  assert.equal(run.stderr, "");
  assert.deepEqual(records(), []);
});

test("the retire's warning stays inside what the kernel relays with the environment's part in it", async (t) => {
  const { retire } = setup(t);
  const rows = Array.from({ length: 30 }, (_, i) => onEnv(`thr_${String(i).padStart(3, "0")}_${"x".repeat(60)}`));
  const { last } = await retire({
    "thread list": { stdout: rows.slice(0, 10).map((row) => ({ ...row, archivedAt: null })) }, "thread archive": { error: { code: "error", message: `HTTP 500: ${"boom ".repeat(200)}` } },
    "thread list --archived": { stdout: rows }, "thread list --environment": { stdout: rows },
  });
  assert.ok(last.warning.length <= 480, String(last.warning.length));
  assert.doesNotMatch(last.warning, /boom/);
});
