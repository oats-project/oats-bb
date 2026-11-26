#!/usr/bin/env node
// The app's live checks (A13, A14, A16), run by container/live.sh inside the container once bb-app
// runs, the plugin is installed from the checkout and the fake `oats` prints the fixtures.
//   A13 at 1280x800 and 390x800: the sidebar with the tree, an agent's thread with its header
//       row, the home page (its badge shows 3), and each of the four pages render.
//   A14 with the fake oats removed: bb's threads are listed, the "not found" line shows, and a
//       thread opens.
//   A16 an agent whose thread bb does not have: its soul's page says so, and Retire opens the
//       plan dialog. And the two states no fixture row is in: an agent the kernel cannot reach,
//       and one whose session fell back to a shell, the first on the open thread.
// Each runs twice, in bb's light theme and in its dark theme (bb's own appearance choice, set as
// bb keeps it: browser.mjs), and at every screenshot the contrast of what the plugin draws there
// is checked in that theme (contrast.mjs says what that covers).
// Screenshots go to $OUT (kept as CI artefacts): `<check>-<width>x<height>-<scene>.png` in the
// light theme and `…-dark.png` in the dark one. No dependency: it drives the image's Chromium
// over the DevTools protocol with node's own WebSocket (container/browser.mjs).
//
// The fixtures name threads bb does not have (`thr_release`, …). So that the join is real, this
// script makes one bb thread per fixture thread, by title, and has the fake print status.json
// with those threads' real ids: the same rows, joined by the ids bb gave.
import { execFileSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { launchBrowser, lowTargets, gapsIn, tight, loose, MAX_GAP } from "./browser.mjs";
import { atomicWrite, completeLines } from "./files.mjs";
import { CONTRAST, failing, shown } from "./contrast.mjs";
import { sameImages } from "./images.mjs";
import { TMUX_ROSTER } from "./tmux-roster.mjs";

const PLUGIN = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = process.env.OUT ?? join(homedir(), "out");
const BASE = process.env.BB_URL ?? "http://127.0.0.1:38886";
const CHROMIUM = process.env.CHROMIUM ?? "chromium";
const OATS = join(homedir(), ".local/bin/oats");
const FAKE_CONFIG = join(homedir(), ".local/bin/fake-oats.json");
const FAKE_LOG = join(homedir(), "fake-oats.log");
const VIEWPORTS = [
  { name: "1280x800", width: 1280, height: 800, mobile: false },
  { name: "390x800", width: 390, height: 800, mobile: true },
];
// The themes this run draws: both, unless LIVE_THEMES names them ("light", "dark" or "light,dark").
// CI runs the live stage as two jobs, one theme each (.github/workflows/plugin.yml), so that its
// wall time is half; on a machine `ci.sh live` and `ci.sh all` draw both. A value that names
// anything else stops the run: a typo must not pass as a run that drew nothing.
const ALL_THEMES = ["light", "dark"];
const THEMES = (process.env.LIVE_THEMES ?? "").trim() === "" ? ALL_THEMES : process.env.LIVE_THEMES.split(",").map((theme) => theme.trim());
if (new Set(THEMES).size !== THEMES.length || THEMES.some((theme) => !ALL_THEMES.includes(theme))) {
  console.error(`live-ui: LIVE_THEMES is ${JSON.stringify(process.env.LIVE_THEMES)}: it names the themes to draw, "light", "dark" or "light,dark"`);
  process.exit(2);
}
mkdirSync(OUT, { recursive: true });

let failures = 0;
const pass = (what) => console.log(`PASS ${what}`);
const fail = (what, detail = "") => {
  failures += 1;
  console.log(`FAIL ${what}${detail === "" ? "" : `\n     ${String(detail).slice(0, 600)}`}`);
};
const check = (ok, what, detail) => (ok ? pass(what) : fail(what, detail));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ---- bb and the fake oats

const bb = (...args) => execFileSync("bb", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
const bbJson = (...args) => JSON.parse(bb(...args, "--json"));
const listOf = (answer, key) => (Array.isArray(answer) ? answer : (answer[key] ?? answer.items ?? []));
function rpc(method) {
  const input = join(OUT, "ui-input.json");
  writeFileSync(input, "null");
  const answer = bbJson("plugin", "rpc", "call", "oats", method, "--input-file", input);
  return answer.result ?? answer;
}
const fake = (verbs = {}) =>
  // (Written whole and renamed into place: every fake oats the plugin starts reads it, at any moment.)
  atomicWrite(FAKE_CONFIG, JSON.stringify({ fixtures: join(PLUGIN, "test/fixtures"), log: FAKE_LOG, verbs }));

/**
 * By hand only, never in CI: LIVE_PILOT_IMAGES=1 takes the image set of the pilot's six screens as
 * a fresh install shows them: the plugin's `pages` stays UNSET, its default (the home alone), through
 * every stage, so no image holds the "Workspace" block of the five other pages, and only the
 * scenes of the six screens' features run (`PILOT_FEATURES`). A scene is told (`pilot: true`) and
 * reaches its screen as a person does then (an agent with no bb thread from its row in the
 * sidebar, not from its soul's page). Its checks that assert a page link or a tile of another page
 * do not hold in this pass and are not counted against it: the pass is for images; the gate is
 * the run without it.
 */
const PILOT = process.env.LIVE_PILOT_IMAGES === "1";
/** By hand only: LIVE_ONLY_STAGES="tmux-roster,…" runs those stages alone (a look at one screen, in minutes; never a gate). */
const ONLY_STAGES = (process.env.LIVE_ONLY_STAGES ?? "").split(",").map((name) => name.trim()).filter((name) => name !== "");
/** By hand only, never a gate: LIVE_ONLY_SCENE="words of a scene's name" runs the scenes whose name holds them, alone; LIVE_REPEAT=10 runs each that many times in every view (to show whether a check that failed once is the scene's or the product's). */
const ONLY_SCENE = (process.env.LIVE_ONLY_SCENE ?? "").trim();
const REPEAT = Math.max(1, Number.parseInt(process.env.LIVE_REPEAT ?? "1", 10) || 1);
const PILOT_FEATURES = ["roster", "outside", "panel", "home", "lifecycle", "spawn"];
/** Every page's id, as live.sh sets them for the checks (the default alone in the pilot's image pass); and how a stage or a scene sets the plugin's `pages`. */
const ALL_PAGES = PILOT ? "home" : "home, automations, souls, capabilities, teams, machines";
// (In the pilot's image pass "every page" is the setting as a fresh install has it: UNSET, by bb's own unset, never set to "home".)
const pages = (value) => void (PILOT && value === ALL_PAGES ? bb("plugin", "config", "oats", "unset", "pages") : bb("plugin", "config", "oats", "set", "pages", value));
/**
 * The setting `pages` as a fresh install has it: UNSET (bb's own `plugin config <id> unset <key>`),
 * not set to its default's value. A stage that shows the release's default leaves it so, and so
 * proves that an unset setting hides the five other pages, not only that "home" does.
 */
const pagesAsInstalled = () => void bb("plugin", "config", "oats", "unset", "pages");

const fixtureStatus = JSON.parse(readFileSync(join(PLUGIN, "test/fixtures/roster/status.json"), "utf8"));
/**
 * The title the bb session provider gives an agent's thread: the instance's name as words (oats-bb
 * `oats-package/capabilities/oats-bb/lib/title.mjs` `threadTitle`, the Desktop's
 * `instanceDisplayName`; bb keeps a title given at the spawn). THE ONE PLACE to change if the
 * provider's rule changes: the images then show in bb's own header what a person will see.
 */
const providerTitle = (instance) => {
  const words = instance.replace(/-+/g, " ").trim();
  const first = String.fromCodePoint(words.codePointAt(0));
  return first.toUpperCase() + words.slice(first.length);
};
/** The instance whose session is on a fixture thread, by the fixture's status; undefined for a thread that is no agent's. */
const instanceOn = (fixtureThreadId) => fixtureStatus.agents.flatMap((group) => group.instances).find((row) => row.session?.threadId === fixtureThreadId)?.instance;
// The fixture threads, each titled as it is in a deployment: an agent's thread as the provider
// titles it, a thread that is no agent's by the title a person gave it (the fixture's own).
const fixtureThreads = JSON.parse(readFileSync(join(PLUGIN, "test/fixtures/roster/threads.json"), "utf8")).threads.map((thread) => {
  const instance = instanceOn(thread.id);
  return instance === undefined ? thread : { ...thread, title: providerTitle(instance) };
});

/** One bb thread per fixture thread, found or made by its title: fixture thread id -> bb's thread. */
function threadsByFixtureId() {
  const project = listOf(bbJson("project", "list"), "projects")[0];
  if (project === undefined) throw new Error("live-ui: bb has no project (live.sh makes one)");
  const root = (project.sources ?? []).find((source) => source.path)?.path;
  const list = () => listOf(bbJson("thread", "list"), "threads");
  let existing = list();
  for (const wanted of fixtureThreads) {
    if (existing.some((thread) => thread.title === wanted.title)) continue;
    // A healthy thread: Claude Code on the mock model (live.sh) answers its one turn.
    bb("thread", "spawn", "--project", project.id, "--environment", root, "--provider", "claude-code", "--title", wanted.title, "--prompt", held(wanted) ? `hello MOCK-HOLD:${HOLD}` : "hello", "--json");
  }
  existing = list();
  const byId = new Map();
  for (const wanted of fixtureThreads) {
    const thread = existing.find((candidate) => candidate.title === wanted.title);
    if (thread === undefined) throw new Error(`live-ui: bb did not keep a thread titled "${wanted.title}"`);
    byId.set(wanted.id, thread);
  }
  return byId;
}

/** The last `lines` lines of a file, for a failing check's detail; says so when it cannot be read. */
function tail(file, lines = 12) {
  try {
    return readFileSync(file, "utf8").trimEnd().split("\n").slice(-lines).join("\n");
  } catch (error) {
    return `(${file} could not be read: ${error.message})`;
  }
}
/** A bb command's output; what failed, in words, when it fails: for a note or a check's detail. */
function tell(...args) {
  try {
    return bb(...args).trim();
  } catch (error) {
    return `(bb ${args.slice(0, 2).join(" ")} failed: ${String(error.stderr || error.message).trim().slice(0, 300)})`;
  }
}
/** The status bb gives one thread now (`bb thread show`), or what it printed where that is none. */
function statusNow(id) {
  const printed = tell("thread", "show", id, "--json");
  try {
    return JSON.parse(printed).thread?.status ?? "(no status)";
  } catch {
    return printed.slice(0, 200) || "(bb thread show printed nothing)";
  }
}
/** What bb itself says of a thread: its status now and the last entries of its log; for a note or a check's detail. */
const bbSays = (id, status = statusNow(id)) => `status ${status}; its log's end:\n${tell("thread", "log", id, "--format", "minimal", "--limit", "3").split("\n").slice(-12).join("\n")}`;

/**
 * The fixture threads, each healthy: its one turn was asked and answered, and bb shows it idle.
 * → fixture thread id -> bb's thread.
 *
 * Each thread is waited for by name. One that has not come to rest in START_SECONDS is said, with
 * what bb says of it, deleted and made again ONCE: bb starts the eight turns at once on a cold
 * Claude Code, and a thread has been seen to stay "pending" (bb's word for a turn in its queue)
 * with the other seven long idle; why is not known. It is bb's and the provider's start, not
 * anything the plugin's checks are about. A thread that is not healthy after that fails the run,
 * with every thread's name and status, what bb says of the ones that are not idle, and the end of
 * bb's and the mock model's logs.
 */
// By hand only, for a look at a real deployment's roster: LIVE_UI_STATUS_FILE is the path (inside
// the container) of an `oats status --json` answer. With it this run draws ONLY the stage
// "local-roster" from that file; without it that stage is skipped. The file is never part of the
// repository, and its scene prints counts only, never a name (container/README.md).
const LOCAL_STATUS = process.env.LIVE_UI_STATUS_FILE ?? "";
/**
 * The run's own bb threads (the fixtures'), for a scene of the pilot's image pass that draws a
 * roster with no agent on a bb thread: archived, nothing of the test container stands under that
 * roster ("Other threads"), as on a deployment whose bb has no such threads; `back()` puts back
 * exactly what `away()` archived. (By hand only, with LIVE_PILOT_IMAGES: an archived thread holds
 * no turn, so the scenes after it in that pass may read another state of those agents.)
 */
const awayThreads = [];
const ownThreads = {
  away: (threads) => {
    for (const thread of threads.values()) {
      bb("thread", "archive", thread.id);
      awayThreads.push(thread.id);
    }
  },
  back: () => {
    // Each one is tried: one that cannot be put back does not keep the others archived. What failed is said, then thrown.
    const failed = [];
    for (const id of awayThreads.splice(0)) {
      try {
        bb("thread", "unarchive", id);
      } catch (error) {
        failed.push(`${id}: ${String(error?.message ?? error).split("\n")[0]}`);
      }
    }
    if (failed.length > 0) throw new Error(`the image pass could not put back ${failed.length} thread(s) it archived: ${failed.join("; ")}`);
  },
};
/** The bb threads the local stage archived for its image, to put back when it leaves. */
const archivedForLocal = [];
const START_SECONDS = Number(process.env.LIVE_UI_START_SECONDS) || 120; // unset, empty or no number: 120
const AGAIN_SECONDS = 180;
// To PROVE the path a stuck thread takes (not part of a normal run): LIVE_UI_PROVE_STUCK=1 makes
// the first fixture thread's turn one the mock model does not answer (its hold file, real/mock-
// anthropic.mjs), so the thread does not come to rest; the hold is lifted when it is made again.
const HOLD = "live-ui-stuck";
const HOLD_FILE = join(homedir(), "mock", "hold", HOLD);
let holding = process.env.LIVE_UI_PROVE_STUCK === "1"; // only by hand (docker exec -e): ci.sh passes no such variable into the container
const held = (wanted) => holding && wanted.id === fixtureThreads[0].id;
async function healthyThreads() {
  const titleOf = new Map(fixtureThreads.map((thread) => [thread.id, thread.title]));
  const read = (threads) => {
    const all = listOf(bbJson("thread", "list"), "threads");
    return [...threads].map(([fixtureId, thread]) => ({ title: titleOf.get(fixtureId), id: thread.id, status: all.find((candidate) => candidate.id === thread.id)?.status ?? "absent" }));
  };
  const rest = async (threads, seconds) => {
    const deadline = Date.now() + seconds * 1000;
    let now = read(threads);
    while (Date.now() < deadline && !now.every((thread) => thread.status === "idle")) {
      await sleep(2000);
      now = read(threads);
    }
    return now;
  };
  let threads;
  let now;
  const again = [];
  try {
    if (holding) writeFileSync(HOLD_FILE, "");
    threads = threadsByFixtureId();
    now = await rest(threads, START_SECONDS);
    // One thread at a time, decided on what bb says of it NOW (the others' notes and deletes take
    // time, and a turn may have ended meanwhile): one that came to rest is left as it is.
    for (const thread of now.filter((candidate) => candidate.status !== "idle")) {
      const status = statusNow(thread.id);
      if (status === "idle") continue;
      console.log(`NOTE the fixture thread "${thread.title}" (${thread.id}) is ${status} after ${START_SECONDS} s, not idle; bb says: ${bbSays(thread.id, status)}\n     It is deleted and made again, once.`);
      const deleted = tell("thread", "delete", thread.id, "--yes");
      if (deleted.startsWith("(bb thread delete failed")) console.log(`NOTE ${deleted}: the thread is kept as it is`);
      else again.push(thread);
    }
  } finally {
    // The proof's hold is lifted here, after the stuck thread was judged and deleted and before
    // any is made again (and whatever was thrown): a thread made from here on is a healthy one.
    holding = false;
    rmSync(HOLD_FILE, { force: true });
  }
  if (again.length > 0) threads = threadsByFixtureId(); // makes the ones that are gone, by their titles
  if (now.some((thread) => thread.status !== "idle")) now = await rest(threads, again.length > 0 ? AGAIN_SECONDS : 0);
  const unwell = now.filter((thread) => thread.status !== "idle");
  check(
    unwell.length === 0,
    `the ${now.length} fixture threads are healthy: each one's turn was answered and bb shows it idle${again.length > 0 ? ` (${again.length} made again after ${START_SECONDS} s: ${again.map((thread) => `"${thread.title}"`).join(", ")})` : ""}`,
    now.map((thread) => `"${thread.title}": ${thread.status}`).join(" | "),
  );
  // Why, in full (a check's own detail is one short line): what bb says of each, and the logs' ends.
  if (unwell.length > 0) {
    for (const thread of unwell) console.log(`     bb on "${thread.title}" (${thread.id}): ${bbSays(thread.id)}`);
    console.log(`     bb's own output, its end:\n${tail(join(OUT, "bb.out"))}`);
    console.log(`     bb's server log, its end:\n${tail(join(homedir(), "bbdata", "logs", "server.1.log"))}`);
    console.log(`     the mock model's output, its end:\n${tail(join(OUT, "mock.out"))}`);
  }
  return threads;
}

/**
 * status.json as the fake prints it for this run: the same rows, with the bb threads' real ids.
 * `changes`: by instance, fields that replace the row's own (a state no fixture row is in).
 */
function statusWithRealIds(threads, changes = {}) {
  const status = structuredClone(fixtureStatus);
  for (const group of status.agents) {
    for (const row of group.instances) {
      const real = row.session ? threads.get(row.session.threadId) : undefined;
      if (real !== undefined) row.session.threadId = real.id;
      Object.assign(row, changes[row.instance] ?? {});
    }
  }
  return JSON.stringify(status);
}

/**
 * A roster that is MOSTLY tmux agents, as a deployment that ran on tmux before bb has it: three
 * agents on bb threads (one of them waiting) and nineteen on tmux, over a few souls, some waiting on
 * the person, some stopped, some with a parent. The real run holds no tmux-backed agent, so these
 * are not recorded as a set: each tmux row is the ONE row the kernel printed for a tmux home
 * (status.json's kernel-fix-developer), with its name, home, window, soul group and parent changed;
 * a waiting one carries the claim the kernel printed for release-070-maintainer; and each says
 * whether it runs in the three keys of a RECORDED tmux row of its kind (`SESSION_KEYS` of
 * test/fixtures/lifecycle/tmux-row-{running,stopped,lost}.json, OATS 0.70.5: one that runs, one
 * stopped with OATS, one whose session was lost), a key the recorded row does not have left out.
 * So the rows are DERIVED, not recorded (README).
 */
const SESSION_KEYS = ["running", "runtimeState", "sessionEnd"];
const recordedTmuxRow = (kind) => JSON.parse(readFileSync(join(PLUGIN, `test/fixtures/lifecycle/tmux-row-${kind}.json`), "utf8"));
/** `as`: by instance, another `how` than the roster's own (a scene that starts a lost agent draws it running after). */
/** `roster`: another set of agents than the stage's own, in the shape of `TMUX_ROSTER` (a scene that draws one of its own, and puts the stage's back). */
function tmuxRoster(threads, as = {}, roster = TMUX_ROSTER) {
  const status = JSON.parse(statusWithRealIds(threads));
  const rows = status.agents.flatMap((group) => group.instances);
  const model = rows.find((row) => row.instance === "kernel-fix-developer");
  const claim = rows.find((row) => row.instance === "release-070-maintainer").waitingOnYou;
  const recorded = { running: recordedTmuxRow("running"), waiting: recordedTmuxRow("running"), stopped: recordedTmuxRow("stopped"), lost: recordedTmuxRow("lost") };
  for (const group of status.agents) group.instances = group.instances.filter((row) => roster.bb.includes(row.instance));
  for (const row of status.agents.flatMap((group) => group.instances)) row.instance = roster.renamed[row.instance] ?? row.instance;
  for (const [instance, soul, parent, listed] of roster.tmux) {
    const how = as[instance] ?? listed;
    const row = structuredClone(model);
    Object.assign(row, { agent: soul, instance, home: model.home.replace("/oats-developer/instances/kernel-fix-developer", `/${soul}/instances/${instance}`), parentInstance: parent, waitingOnYou: how === "waiting" ? structuredClone(claim) : null });
    row.tmux = { ...model.tmux, window: instance };
    if (row.identity) row.identity = { ...row.identity, alias: instance };
    if (row.capabilityMeta?.["oats.aweb"]) row.capabilityMeta = { ...row.capabilityMeta, "oats.aweb": { ...row.capabilityMeta["oats.aweb"], alias: instance } };
    // What the kernel printed of the session of a tmux home of this kind, and nothing else of that
    // row: running `running: true` and no word; stopped with OATS `running: false`, the word "shell"
    // and `sessionEnd: "stopped"`; lost `running: false`, no word and `sessionEnd: "lost"`.
    // (status.json's own tmux row carries "unknown", from the kernel it was recorded with.)
    if (!Object.hasOwn(recorded, how)) throw new Error(`tmux-roster.mjs: ${instance} is "${how}", which is none of ${Object.keys(recorded).join(", ")}`);
    for (const key of SESSION_KEYS) {
      if (key in recorded[how]) row[key] = recorded[how][key];
      else delete row[key];
    }
    // (A soul the fixtures' status does not list gets a group of its own, shaped as the model's.)
    let group = status.agents.find((each) => each.name === soul);
    if (group === undefined) {
      group = { ...structuredClone(status.agents.find((each) => each.instances.length > 0 || each.name === "oats-developer") ?? status.agents[0]), name: soul, instances: [] };
      status.agents.push(group);
    }
    group.instances.push(row);
  }
  return JSON.stringify(status);
}

async function untilSnapshot(matches, seconds = 30) {
  const deadline = Date.now() + seconds * 1000;
  let last;
  while (Date.now() < deadline) {
    try {
      rpc("refresh");
      last = rpc("snapshot");
      if (matches(last)) return last;
    } catch (error) {
      last = { error: String(error) };
    }
    await sleep(1500);
  }
  throw new Error(`live-ui: the snapshot did not settle: ${JSON.stringify(last).slice(0, 400)}`);
}

/**
 * A page of one viewport in one theme, whose screenshots carry the theme in their name and are each
 * followed by the contrast check of what the plugin draws on the page at that moment.
 */
async function themedPage(browser, viewport, theme, at) {
  const page = await browser.page(viewport, { theme });
  const shot = page.shot;
  // `plugin: false`: a scene in which the plugin may draw nothing (a thread while OATS cannot be read).
  // `targets: true`: every control of the plugin in the page is as high as a person can press (32 px, 44 at phone width).
  // `gaps: "<selector>"`: every block the selector finds is as high as what it holds (browser.mjs `gapsIn`): no empty
  // room over MAX_GAP px between two of its lines or at its edges.
  page.shot = async (name, { plugin = true, targets = false, gaps = null } = {}) => {
    if (gaps !== null) {
      const measured = JSON.parse(await page.evaluate(gapsIn(gaps)));
      check(tight(measured), `${at} ${name}: ${measured.length} block(s) as high as what they hold: no gap over ${MAX_GAP} px between two lines or at an edge (heights ${measured.map((block) => block.height).join(", ")} px)`, measured.length === 0 ? `nothing drawn matches ${gaps}` : loose(measured));
    }
    if (targets) {
      const min = viewport.mobile ? 44 : 32;
      const low = JSON.parse(await page.evaluate(lowTargets(min)));
      check(low.length === 0, `${at} ${name}: every control is at least ${min} px high`, low.join(" | "));
    }
    const { theme: drawn, roots, rows } = JSON.parse(await page.evaluate(CONTRAST));
    const bad = failing(rows);
    const count = (kind) => rows.filter((row) => row.kind === kind).length;
    const lowest = (kinds) => shown(Math.min(...rows.filter((row) => kinds.includes(row.kind)).map((row) => row.ratio)));
    const TEXTS = ["text", "value", "placeholder"];
    const texts = rows.filter((row) => TEXTS.includes(row.kind)).length;
    const dots = count("dot") === 0 ? "no mark" : `its ${count("dot")} marks at 3:1 or more (lowest ${lowest(["dot"])}:1)`;
    const ok = drawn === theme && (rows.length > 0 || !plugin) && bad.length === 0;
    check(ok, `${at} ${name}: bb draws its ${theme} theme, and ${rows.length === 0 ? "nothing of the plugin is in the page" : `the plugin's ${texts} texts read at 4.5:1 or more (lowest ${lowest(TEXTS)}:1), ${dots}`}`);
    // Every distinct failing row, whole: one run names all there is to fix in the scene.
    if (!ok) {
      console.log(`     theme ${drawn}; in ${roots.join(", ") || "nothing of the plugin"}`);
      for (const line of new Set(bad.map((row) => `${row.kind} ${LOCAL_STATUS === "" ? row.what : "(text not printed: a real deployment's roster)"} ${shown(row.ratio)}:1 (needs ${row.need}; ${row.paint} on ${row.behind})${row.unsure === null ? "" : `, ${row.unsure}`}`))) console.log(`     ${line}`);
    }
    await shot(theme === "light" ? name : `${name}-${theme}`);
  };
  return page;
}

// ---- the scenes
//
// A scene is `{ stage, name, run }` in container/scenes/<feature>.mjs (its default export is the
// feature's list). `run({ page, at, viewport, theme, threads, fixtureThreads, check, sleep, record })` drives
// the page and takes its screenshots with `page.shot(name)`, which checks the contrast of what the
// plugin draws there; `at` leads every check's line; `threads` is fixture thread id -> bb's thread;
// `record(changes)` makes a change the kernel records (the fake's status with `changes` by
// instance, and a line in the event log) and answers when: a scene times how soon the screen shows it.
// A stage is what the fake `oats` answers while its scenes run. For each stage, in each theme and
// at each viewport, one page runs the stage's scenes: the features in the order of FEATURES (then
// any other file), each feature's scenes in its list's order.
//   fixtures  (A13) the fixtures as they are
//   detached  (A16) one agent on a thread bb does not have, one the kernel cannot reach and one
//             whose session fell back to a shell
//   no-oats   (A14) the fake oats removed
// A feature that needs another state exports `stages`: `{ <name>: { label, enter, leave? } }`, where
// `enter({ fake, statusWithRealIds, threads, untilSnapshot })` sets the fake and waits for the
// snapshot it makes; its stages run after these three.

const FEATURES = ["roster", "home", "workspace", "spawn", "lifecycle", "automations", "panel", "patterns"];
const SCENES = join(PLUGIN, "container", "scenes");

async function loadScenes() {
  const files = readdirSync(SCENES).filter((file) => file.endsWith(".mjs")).map((file) => file.slice(0, -4));
  const order = [...FEATURES.filter((feature) => files.includes(feature)), ...files.filter((feature) => !FEATURES.includes(feature)).sort()].filter((feature) => !PILOT || PILOT_FEATURES.includes(feature));
  const scenes = [];
  const stages = {};
  for (const feature of order) {
    const module = await import(pathToFileURL(join(SCENES, `${feature}.mjs`)).href);
    for (const scene of module.default ?? []) scenes.push({ ...scene, feature });
    for (const [name, stage] of Object.entries(module.stages ?? {})) {
      if (name in stages || name in BUILT_IN) throw new Error(`live-ui: the stage "${name}" of scenes/${feature}.mjs is already defined`);
      stages[name] = stage;
    }
  }
  return { scenes, stages };
}

const BUILT_IN = {
  fixtures: {
    label: "A13",
    enter: async ({ threads }) => {
      fake({ status: { stdout: statusWithRealIds(threads) } });
      await untilSnapshot((snapshot) => snapshot.ok === true && snapshot.agents.some((agent) => agent.threadId === threads.get("thr_release").id));
    },
  },
  // The same status, with one agent on a thread bb does not have (its fixture id, unmapped), one
  // the kernel cannot reach and one whose session fell back to a shell. The agent with no thread is
  // the one whose retire plan was recorded (lifecycle/retire-plan.json): the plan the fake answers
  // is the plan of the agent asked about.
  detached: {
    label: "A16",
    enter: async ({ threads }) => {
      const detached = new Map([...threads].filter(([id]) => id !== "thr_digest"));
      const states = {
        "desktop-mockups-developer": { running: null, runtimeState: "unreachable", sessionEnd: null },
        "harvest-knowledge-helper": { running: false, runtimeState: "shell" },
      };
      fake({ status: { stdout: statusWithRealIds(detached, states) } });
      await untilSnapshot((snapshot) => snapshot.ok === true && snapshot.agents.some((agent) => agent.instance === "weekly-digest-helper" && agent.threadId === "thr_digest"));
    },
  },
  // The release's default: only the home is a page that is shown, with the setting left as
  // installed (unset: `pagesAsInstalled`). Every other stage runs with all pages shown (live.sh,
  // which sets all six; this stage sets them again when it leaves); the scenes of this one assert what is absent. `pages(value)` is for a
  // scene that needs another set: it changes the setting; the scene then opens its page and waits on what it reads.
  // A deployment that is mostly tmux agents (tmuxRoster, above): what a person who ran OATS on tmux sees first.
  "tmux-roster": {
    label: "TM",
    enter: async ({ threads }) => {
      const status = tmuxRoster(threads);
      // Held here, with the three keys written out (not through the builder's list): what the screen
      // draws cannot tell a leftover word of the model row from none.
      const built = new Map(JSON.parse(status).agents.flatMap((group) => group.instances).map((row) => [row.instance, row]));
      const sessionOf = (row) => JSON.stringify(["running", "runtimeState", "sessionEnd"].map((key) => (key in row ? row[key] : "ABSENT")));
      const off = TMUX_ROSTER.tmux.filter(([instance, , , how]) => sessionOf(built.get(instance) ?? {}) !== sessionOf(recordedTmuxRow(how === "waiting" ? "running" : how))).map(([instance]) => instance);
      check(off.length === 0, `TM each of the ${TMUX_ROSTER.tmux.length} tmux rows says of its session exactly what the recorded row of its kind says: running, runtimeState and sessionEnd, a key that row lacks absent`, off.join(", "));
      fake({ status: { stdout: status } });
      await untilSnapshot((snapshot) => snapshot.ok === true && snapshot.agents.length === TMUX_ROSTER.bb.length + TMUX_ROSTER.tmux.length);
    },
  },
  "local-roster": {
    label: "LR",
    // With the release's default pages: what a person of that deployment sees first. Nothing of the
    // file is printed, on any path: a file that is no JSON names its path alone, and a roster that
    // does not arrive is told by its counts. The run's own bb threads (the fixtures') are archived
    // first, so that what stands under the roster is what that deployment's bb would show, not the
    // test container's threads.
    enter: async ({ threads }) => {
      let agents;
      const status = readFileSync(LOCAL_STATUS, "utf8");
      try {
        agents = JSON.parse(status).agents.flatMap((group) => group.instances).length;
      } catch {
        throw new Error(`the status file at ${LOCAL_STATUS} is not an oats status --json answer`);
      }
      for (const thread of threads.values()) {
        bb("thread", "archive", thread.id);
        archivedForLocal.push(thread.id);
      }
      fake({ status: { stdout: status } });
      pagesAsInstalled();
      const deadline = Date.now() + 60_000;
      let seen = "no answer";
      for (;;) {
        try {
          rpc("refresh");
          const snapshot = rpc("snapshot");
          seen = `ok ${snapshot.ok}, ${snapshot.ok ? snapshot.agents.length : 0} agents`;
          if (snapshot.ok === true && snapshot.agents.length === agents) break;
        } catch {
          seen = "the snapshot could not be read";
        }
        if (Date.now() > deadline) throw new Error(`the roster of the status file did not arrive: ${seen}, of ${agents} in the file`);
        await sleep(1500);
      }
    },
    // Only what `enter` archived is put back: a stage that failed before it archived anything leaves bb as it was.
    leave: async () => {
      pages(ALL_PAGES);
      for (const id of archivedForLocal.splice(0)) bb("thread", "unarchive", id);
    },
  },
  "pages-default": {
    label: "PG",
    enter: async ({ threads }) => {
      fake({ status: { stdout: statusWithRealIds(threads) } });
      pagesAsInstalled(); // the setting left as installed: unset
      // The fixtures' roster is WAITED for: the stage before this one drew another (found by a run whose
      // image of this stage was the tmux roster's).
      await untilSnapshot((snapshot) => snapshot.ok === true && snapshot.agents.some((agent) => agent.instance === "weekly-digest-helper") && snapshot.agents.length === 8);
    },
    leave: async () => pages(ALL_PAGES),
  },
  // THE BUSY WORKSPACE (test/fixtures/busy; the worst-case rule): every feature's worst-case scenes run here, on the
  // one shared set (`busyStage`, below).
  busy: busyStage(),
  // The fake oats is removed for the length of the stage, then put back.
  "no-oats": {
    label: "A14",
    enter: async () => {
      renameSync(OATS, `${OATS}.away`);
      await untilSnapshot((snapshot) => snapshot.ok === false && snapshot.code === "OATS_NOT_FOUND");
    },
    leave: async () => {
      if (existsSync(`${OATS}.away`)) renameSync(`${OATS}.away`, OATS);
    },
  },
};

/**
 * THE STAGE "busy": the fake oats answers the busy set (test/fixtures/busy: about sixty agents four levels deep, 24
 * souls, 37 automations, seven teams, five machines: its README), for every feature's worst-case scenes.
 *
 * The busy agents on a bb thread each stand on a REAL thread of this run (a busy workspace is mostly agents on bb: a
 * row with no thread standing for an agent that has one would be a picture of another problem). The stage MAKES
 * them. ONE has THE BUSY CHAT (the set's chat.json: a long conversation, with the agent that holds the full board): a
 * thread of its own, whose turns the mock model answers with the set's long answers (its say.json), one after the
 * other. Each of the others is an idle FORK of one healthy fixture thread (`bb thread fork --title`, with no prompt: no turn is
 * run and no harness is started for it), titled as the provider titles that agent's thread. Then, as the set says:
 * - an agent whose session was lost on bb has its thread ARCHIVED (the recorded row is of a thread a person archived);
 * - an agent the kernel says runs has a turn HELD OPEN on its thread (bb, not the kernel, says that an agent on a
 *   thread works: the same hold as the fixtures' two, with a hold of its own), so that the screen says "Working".
 * What it costs is said (a NOTE: the seconds, the threads made). When the stage leaves, the held turns are answered
 * and every thread it made is archived: the stages after it see none of them.
 */
const BUSY_HOLD = "live-ui-busy";
const BUSY_HOLD_FILE = join(homedir(), "mock", "hold", BUSY_HOLD);
const BUSY_SAY_FILE = join(homedir(), "mock", "say.json");
// Claude Code, while the busy stage has it away (the failed starts): where it was; and the way back.
const CLAUDE_AWAY = join(homedir(), "mock", "claude-away");
function claudeBack() {
  if (!existsSync(CLAUDE_AWAY)) return;
  const claude = readFileSync(CLAUDE_AWAY, "utf8").trim();
  if (claude !== "" && existsSync(`${claude}.away`)) renameSync(`${claude}.away`, claude);
  rmSync(CLAUDE_AWAY, { force: true });
}
function busyStage() {
  const made = []; // the threads this stage made: { instance, id }
  const away = []; // the fixtures' own threads it archived for its length
  const limited = []; // the host whose concurrency limit it raised, and what bb said of it before
  let starOff = false; // bb's star request was turned off by this stage
  // What bb holds of the thread of an agent that failed at its start: its status, and the types of its events.
  const recordOf = (thread) => (thread === undefined ? "no thread" : `${thread.status}; ${tell("thread", "log", thread.id, "--json").replace(/\s+/g, " ").match(/"type": ?"[a-z./-]+"/g)?.map((type) => type.replace(/"type": ?/, "")).join(" ") ?? "(no events read)"}`);
  const failedAtItsStart = (record) => /system\/error/.test(record) && !/turn\/started/.test(record);
  const set = () => JSON.parse(readFileSync(join(PLUGIN, "test/fixtures/busy/status.json"), "utf8"));
  const rowsOf = (status) => status.agents.flatMap((group) => group.instances);
  return {
    label: "BUSY",
    // The fixtures' own agents are not of this workspace: their threads are archived for the stage's length (but the
    // one that is no agent's: a person has threads of their own), and no turn is held on an archived thread.
    tellsAThread: true,
    enter: async ({ threads }) => {
      const started = Date.now();
      const project = listOf(bbJson("project", "list"), "projects")[0];
      const root = (project.sources ?? []).find((each) => each.path)?.path;
      // bb's own request for a star (after five prompts; the chat alone is ten) is no part of any image: off for the
      // stage's length, and on again when it leaves.
      starOff = !tell("plugin", "disable", "bb--github-star").startsWith("(bb plugin disable failed");
      const status = set();
      const onBb = rowsOf(status).filter((row) => row.backend === "bb" && typeof row.session?.threadId === "string");
      const source = threads.get("thr_harvest"); // an idle fixture thread: its one turn was answered
      const list = () => listOf(bbJson("thread", "list"), "threads");
      let existing = list();
      // THE BUSY CHAT: its thread is made by its first message and told the rest, each turn answered before the next.
      const chat = JSON.parse(readFileSync(join(PLUGIN, "test/fixtures/busy/chat.json"), "utf8"));
      const chatTitle = providerTitle(chat.agent);
      if (!existing.some((thread) => thread.title === chatTitle)) {
        atomicWrite(BUSY_SAY_FILE, JSON.stringify(Object.fromEntries(chat.turns.map((turn) => [turn.you, turn.agent]))));
        // A turn is answered when the thread's last output is that turn's answer and bb shows it idle (never by
        // "idle" alone: a thread just told is still idle for a moment).
        const answered = async (id, turn) => {
          const deadline = Date.now() + 90_000;
          const read = () => (tell("thread", "output", id).includes(turn.agent.slice(0, 60)) ? statusNow(id) : "not answered yet");
          let now = read();
          while (Date.now() < deadline && now !== "idle") {
            await sleep(1000);
            now = read();
          }
          return now;
        };
        bb("thread", "spawn", "--project", project.id, "--environment", root, "--provider", "claude-code", "--title", chatTitle, "--prompt", chat.turns[0].you, "--json");
        const id = list().find((thread) => thread.title === chatTitle)?.id;
        if (id === undefined) throw new Error(`live-ui: bb did not keep the busy chat's thread, titled "${chatTitle}"`);
        const stuck = [];
        for (const [n, turn] of chat.turns.entries()) {
          if (n > 0) bb("thread", "tell", id, turn.you);
          const now = await answered(id, turn);
          if (now !== "idle") stuck.push(`turn ${n + 1}: ${now}; bb's output of the thread: ${tell("thread", "output", id).slice(0, 120)}`);
        }
        rmSync(BUSY_SAY_FILE, { force: true });
        check(stuck.length === 0, `BUSY the busy chat's ${chat.turns.length} turns were each answered`, stuck.join(" | "));
        existing = list();
      }
      const chatted = Date.now();
      const { failedAtStart } = JSON.parse(readFileSync(join(PLUGIN, "test/fixtures/busy/threads.json"), "utf8"));
      // The rows the kernel says run: a thread of its own each, whose first turn is held open (bb, not the kernel, says
      // that an agent on a thread works). (Not the busy chat's: a held turn would add a message to its conversation,
      // and it asks: the screen says so whatever bb says.)
      const working = onBb.filter((row) => row.running === true && row.outsideOats === undefined && row.instance !== chat.agent);
      // Every other one: an idle fork of a healthy fixture thread (no turn is run, no harness started). The forks
      // come FIRST: bb 0.50.1 refuses a fork while another thread's first message is
      // still queued, and a thread that failed at its start keeps its one ("Stored queued message … is malformed", HTTP
      // 500; seen in this stage's third look): so they come before both.
      for (const row of onBb.filter((each) => !working.includes(each) && !failedAtStart.includes(each.instance))) {
        const title = providerTitle(row.instance);
        if (!existing.some((thread) => thread.title === title)) bb("thread", "fork", source.id, "--title", title);
      }
      existing = list();
      const forkedAt = Date.now();
      // FAILED AT ITS START: the set's row of such an agent is a lost session's; what says "failed" is bb's own record
      // of the thread (an error and never a turn). So its thread is made to fail at its start: a model the harness
      // cannot start with (TRIED HERE: a provider whose harness is not installed). What bb then holds of each is said.
      {
        const wanted = failedAtStart.filter((instance) => !existing.some((thread) => thread.title === providerTitle(instance)));
        if (wanted.length > 0) {
          // Nothing waits to start (the chat is had, no turn is held yet): the harness is taken away for the spawns.
          // The model is NAMED: with none, bb asks the harness for its default and refuses the spawn (HTTP 503) when
          // it cannot (seen in this stage's fifth look).
          const claude = realpathSync(execFileSync("sh", ["-c", "command -v claude"], { encoding: "utf8" }).trim());
          const said = [];
          // (Where it is, written down first: a run that is killed here finds it at its next start and puts it back.)
          writeFileSync(CLAUDE_AWAY, claude);
          renameSync(claude, `${claude}.away`);
          try {
            for (const instance of wanted) said.push(`${instance}: ${tell("thread", "spawn", "--project", project.id, "--environment", root, "--provider", "claude-code", "--model", source.model ?? "claude-opus-5-5", "--title", providerTitle(instance), "--prompt", "hello", "--json").replace(/\s+/g, " ").slice(0, 80)}`);
            const eventsOf = (instance) => recordOf(list().find((candidate) => candidate.title === providerTitle(instance)));
            const deadline = Date.now() + 60_000;
            while (Date.now() < deadline && !wanted.every((instance) => eventsOf(instance).includes("system/error"))) await sleep(2000);
            for (const instance of wanted) console.log(`NOTE BUSY failed at its start, ${instance}: bb says ${eventsOf(instance).slice(0, 500)}`);
            const failed = wanted.filter((instance) => failedAtItsStart(eventsOf(instance)));
            check(failed.length === wanted.length, `BUSY the ${wanted.length} threads of the agents that failed at their start did fail at their start in bb: an error and never a turn`, said.join(" | "));
          } finally {
            claudeBack();
          }
          existing = list();
        }
      }
      const failedMade = Date.now();
      // bb holds a new turn in line once as many threads run as the host has processors (its own "concurrency limit":
      // two in this container), and everything spawned after waits behind it: the limit is raised for the stage's
      // length to what the busy set's working agents need, and put back to bb's own when the stage leaves.
      const machines = bbJson("machine", "list");
      const host = (Array.isArray(machines) ? machines : (machines.machines ?? machines.hosts ?? machines.items ?? []))[0]?.id;
      if (typeof host !== "string") throw new Error("live-ui: bb lists no machine to raise the concurrency limit of");
      // (What bb says of the host's limit BEFORE, kept: the stage's leave reads that it says the same again.)
      limited.push({ host, before: tell("concurrency-limit", "host", host, "--json") });
      bb("concurrency-limit", "host", host, String(working.length + 4));
      mkdirSync(dirname(BUSY_HOLD_FILE), { recursive: true });
      writeFileSync(BUSY_HOLD_FILE, "");
      {
        for (const row of working) {
          const title = providerTitle(row.instance);
          if (!existing.some((thread) => thread.title === title)) bb("thread", "spawn", "--project", project.id, "--environment", root, "--provider", "claude-code", "--title", title, "--prompt", `hello MOCK-HOLD:${BUSY_HOLD}`, "--json");
        }
        existing = list();
      }
      const heldMade = Date.now();
      // The held turns are WAITED for: bb shows each of those threads active.
      const heldIds = new Map(working.map((row) => [row.instance, existing.find((thread) => thread.title === providerTitle(row.instance))?.id]));
      {
        const deadline = Date.now() + 180_000;
        while (Date.now() < deadline && working.some((row) => statusNow(heldIds.get(row.instance)) !== "active")) await sleep(2000);
      }
      const heldAt = Date.now();
      existing = list();
      const byInstance = new Map();
      for (const row of onBb) {
        const thread = existing.find((candidate) => candidate.title === providerTitle(row.instance));
        if (thread === undefined) throw new Error(`live-ui: bb did not keep the busy thread titled "${providerTitle(row.instance)}"`);
        byInstance.set(row.instance, thread);
        made.push({ instance: row.instance, id: thread.id });
      }
      for (const [fixtureId, thread] of threads) {
        if (instanceOn(fixtureId) === undefined) continue;
        bb("thread", "archive", thread.id);
        away.push(thread.id);
      }
      const all = Object.fromEntries(working.map((row) => [row.instance, statusNow(byInstance.get(row.instance).id)]));
      const idle = working.filter((row) => all[row.instance] !== "active");
      check(idle.length === 0, `BUSY bb has a turn running on the threads of the ${working.length} busy agents that work`, idle.map((row) => `${row.instance}: ${all[row.instance]}`).join(" | "));
      // The three failed starts, read AGAIN now that Claude Code is back and fourteen turns run: still an error and never a turn.
      {
        const now = list();
        const ran = failedAtStart.filter((instance) => !failedAtItsStart(recordOf(now.find((thread) => thread.title === providerTitle(instance)))));
        check(ran.length === 0, `BUSY the ${failedAtStart.length} threads that failed at their start still hold an error and no turn, with Claude Code back`, ran.join(" | "));
      }
      // An agent whose session was lost on bb: its thread is archived, as the recorded row's was.
      for (const row of onBb.filter((each) => each.sessionEnd === "lost" && !failedAtStart.includes(each.instance))) bb("thread", "archive", byInstance.get(row.instance).id);
      // The set, with this run's thread in each slot.
      let text = JSON.stringify(status);
      for (const row of onBb) text = text.split(row.session.threadId).join(byInstance.get(row.instance).id);
      fake({
        status: { stdout: text },
        souls: { file: "busy/souls.json" },
        teams: { file: "busy/teams.json" },
        "server list": { file: "busy/servers.json" },
        "schedule list": { file: "busy/schedule-list.json" },
        "trigger list": { file: "busy/trigger-list.json" },
        // The busy chat's agent's mail (a full page of fifty): the set holds ONE agent's, so every agent's Mail tab answers it.
        "operation run messaging:mail": { file: "busy/mail.json" },
      });
      const total = rowsOf(status).length;
      await untilSnapshot((snapshot) => snapshot.ok === true && snapshot.agents.length === total, 60);
      console.log(`NOTE BUSY the stage's start: the busy chat's ${chat.turns.length} turns in ${Math.round((chatted - started) / 1000)} s; the bb threads with no turn made as idle forks in ${Math.round((forkedAt - chatted) / 1000)} s; ${failedAtStart.length} threads failed at their start in ${Math.round((failedMade - forkedAt) / 1000)} s; ${working.length} threads spawned with a held turn in ${Math.round((heldMade - failedMade) / 1000)} s and all active after ${Math.round((heldAt - heldMade) / 1000)} more s; ${Math.round((Date.now() - started) / 1000)} s in all`);
    },
    leave: async ({ threads }) => {
      // The held turns are answered, and every thread this stage made is archived: no later stage sees one.
      rmSync(BUSY_HOLD_FILE, { force: true });
      rmSync(BUSY_SAY_FILE, { force: true });
      claudeBack();
      // bb's own concurrency limit is back: asked, and READ.
      for (const { host, before } of limited.splice(0)) {
        tell("concurrency-limit", "host", host, "auto");
        const after = tell("concurrency-limit", "host", host, "--json");
        check(after === before && !before.startsWith("(bb "), "BUSY bb's own concurrency limit is back for the host when the stage leaves: bb says of it what it said before the stage", `before ${before.slice(0, 200)} | after ${after.slice(0, 200)}`);
      }
      if (starOff) {
        tell("plugin", "enable", "bb--github-star");
        starOff = false;
      }
      // (Found by their titles too: a stage that stopped half way made threads it had not yet counted.)
      const list = () => listOf(bbJson("thread", "list"), "threads");
      const titles = new Set(rowsOf(set()).filter((row) => row.backend === "bb").map((row) => providerTitle(row.instance)));
      const ids = [...new Set([...made.splice(0).map((thread) => thread.id), ...list().filter((thread) => titles.has(thread.title)).map((thread) => thread.id)])];
      const deadline = Date.now() + 120_000;
      const running = () => list().filter((thread) => ids.includes(thread.id) && thread.status === "active");
      while (Date.now() < deadline && running().length > 0) await sleep(2000);
      const still = running();
      check(still.length === 0, "BUSY no turn of the stage's is still held when it leaves: bb shows none of its threads active", still.map((thread) => thread.title).join(" | "));
      const failed = [];
      for (const id of ids) {
        const said = tell("thread", "archive", id);
        if (said.startsWith("(bb thread archive failed") && !/already archived/i.test(said)) failed.push(`${id}: ${said}`);
      }
      check(failed.length === 0, `BUSY the ${ids.length} threads the stage made are archived when it leaves`, failed.slice(0, 3).join(" | "));
      // And the fixtures' own threads are back, for the stages after this one.
      const kept = away.splice(0).filter((id) => tell("thread", "unarchive", id).startsWith("(bb thread unarchive failed"));
      check(kept.length === 0, "BUSY the fixtures' own threads are put back when the stage leaves", kept.join(" | "));
      // And the fake oats answers the fixtures again, on this run's threads: the next stage starts from their roster, read.
      fake({ status: { stdout: statusWithRealIds(threads) } });
      await untilSnapshot((snapshot) => snapshot.ok === true && snapshot.agents.length === 8 && snapshot.agents.some((agent) => agent.instance === "weekly-digest-helper"), 60);
    },
  };
}

/**
 * A change the kernel records, as a scene makes one to time how soon the screen shows it (the UX
 * standard, section 6): the fake's status answers the fixtures with `changes` (by instance, fields
 * that replace the row's own), and one line is appended to the deployment's event log, which is
 * what the kernel does and what the plugin's watch sees. → the instant the change was recorded.
 */
const EVENTS = join(homedir(), "deployment", ".agents", "events", "live-ui.jsonl");
function record(threads, changes = {}) {
  fake({ status: { stdout: statusWithRealIds(threads, changes) } });
  const at = Date.now();
  appendFileSync(EVENTS, `${JSON.stringify({ kind: "live-ui", at: new Date(at).toISOString() })}\n`);
  return at;
}

/**
 * A change of ONE instance, as the kernel records it, for the event path (server/core.ts): the
 * line is appended to THAT instance's own file of the event log (`<agent>--<instance>.jsonl`),
 * which the watch names; the fake answers `oats instance events … --since` for it with `said`
 * (the fields of the kernel's answer the plugin reads: shaped here in step with `changes`, not
 * recorded), and its status answers the fixtures with `changes`, HELD `statusHeldMs` first: so a
 * scene can see what the events alone put on the screen before any status read can have answered.
 * → the instant the change was recorded.
 */
let heldSince = 0;
function recordFor(threads, { agent, instance }, { changes = {}, said = {}, statusHeldMs = 0 } = {}) {
  heldSince = Date.now(); // before the fake is rewritten: a status call that started at or after this may have read the new answer
  const answer = { schemaVersion: 1, ok: true, result: { eventsApi: 2, instance, incarnation: "2026-11-23T09:00:00.000Z", count: 0, returned: 0, truncated: false, events: [], lastEvent: null, waitingOnYou: null, waitingClaims: [], ...said } };
  fake({ status: { stdout: statusWithRealIds(threads, changes), ...(statusHeldMs > 0 ? { sleepMs: statusHeldMs } : {}) }, "instance events --since": { stdout: JSON.stringify(answer) } });
  const at = Date.now();
  appendFileSync(join(homedir(), "deployment", ".agents", "events", `${agent}--${instance}.jsonl`), `${JSON.stringify({ kind: "live-ui", at: new Date(at).toISOString() })}\n`);
  return at;
}

/**
 * Whether a status read that could carry the last `recordFor`'s change HAS ANSWERED: an `oats status`
 * the fake logged at or after the fake was rewritten, and that is no longer running. While none has,
 * nothing but the events can have put that change on the screen (a status read stamped before the
 * record whose process started after the fake was rewritten would answer the change under an older
 * stamp: this tells it).
 */
function statusAnsweredSinceRecord() {
  let calls = [];
  try {
    calls = completeLines(FAKE_LOG).map((line) => JSON.parse(line)); // (the fake oats appends while this reads)
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const running = (pid) => {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  };
  return calls.some((call) => call.verb === "status" && Date.parse(call.at) >= heldSince && !running(call.pid));
}

// ---- the run

// A bb that was never opened shows its first-run guide in place of the app: mark it as done, as a
// person does by walking through it. (A setting of bb's own; nothing of the plugin depends on it.)
bb("settings", "general", "onboardingCompletedAt", new Date().toISOString());

const WORK_HOLD = "live-ui-working";
const WORK_HOLD_FILE = join(homedir(), "mock", "hold", WORK_HOLD);
// A run that was killed before its `finally` (in a kept container) left its hold: it does not outlive that run.
rmSync(WORK_HOLD_FILE, { force: true });
claudeBack(); // a run that was killed while the busy stage had Claude Code away
// At this point every thread is a healthy one: its turn was answered and bb shows it idle. (Two are then given a turn that is held, below.)
const threads = await healthyThreads();
// Two agents of the fixtures WORK (redesign-ui-lead and desktop-mockups-developer: the roster's
// rows with `running: true`, and the two threads bb's fixture calls active). An agent on a bb
// thread works when BB says its thread does, so bb must have a turn running on those two threads
// while a scene reads them: each gets a message whose turn the mock model holds open (MOCK-HOLD)
// and is waited for until bb calls it active.
// The hold is taken PER STAGE, and lifted for a stage that tells a thread itself (`tellsAThread:
// true` on the stage, or its name below): a turn kept open across another stage's own turn was
// seen to keep that turn from starting. A stage with the hold lifted draws the two as idle.
const WORKING_THREADS = ["thr_redesign", "thr_mockups"];
/** Stages that tell a thread a message of their own (their scenes wait for its turn): the hold is lifted for them. */
const TELLS_A_THREAD = new Set(["home-stopped-asks"]);
let holdsNow = false;
const workingNow = () => WORKING_THREADS.map((id) => `${id}: ${statusNow(threads.get(id).id)}`);
/** Waits until bb says `status` of both threads; answers what it saw last. */
async function untilBoth(status, seconds) {
  const deadline = Date.now() + seconds * 1000;
  let seen = workingNow();
  while (!seen.every((line) => line.endsWith(`: ${status}`)) && Date.now() < deadline) {
    await sleep(1000);
    seen = workingNow();
  }
  return seen;
}
async function holdWorking(stage) {
  mkdirSync(dirname(WORK_HOLD_FILE), { recursive: true });
  writeFileSync(WORK_HOLD_FILE, "");
  for (const id of WORKING_THREADS) if (statusNow(threads.get(id).id) !== "active") bb("thread", "tell", threads.get(id).id, `carry on MOCK-HOLD:${WORK_HOLD}`);
  const seen = await untilBoth("active", 90);
  check(seen.every((line) => line.endsWith(": active")), `bb has a turn running on the threads of the two agents that work, for the stage "${stage}"`, seen.join(" | "));
  holdsNow = true;
}
async function releaseWorking(stage) {
  rmSync(WORK_HOLD_FILE, { force: true });
  const seen = await untilBoth("idle", 90);
  check(seen.every((line) => line.endsWith(": idle")), `the two held turns are answered and bb shows both threads idle, for the stage "${stage}" (it tells a thread itself)`, seen.join(" | "));
  holdsNow = false;
}
let browser;
let scenes;
let stages;
try {
  // (Everything that takes the hold is inside the `try` whose `finally` lifts it: whatever throws, no turn stays held.)
  ({ scenes, stages } = await loadScenes());
  if (PILOT) pages(ALL_PAGES); // live.sh showed every page for its own checks: the default from here on
  browser = await launchBrowser({ chromium: CHROMIUM, out: OUT, base: BASE });
  for (const [name, stage] of Object.entries({ ...BUILT_IN, ...stages })) {
    const mine = scenes.filter((scene) => scene.stage === name && (ONLY_SCENE === "" || scene.name.includes(ONLY_SCENE))).flatMap((scene) => Array.from({ length: REPEAT }, () => scene));
    if (mine.length === 0) continue;
    if (ONLY_STAGES.length > 0 && !ONLY_STAGES.includes(name)) continue;
    if ((name === "local-roster") !== (LOCAL_STATUS !== "")) continue; // the local stage alone, or every stage but it
    // The hold for this stage: taken, or lifted where the stage tells a thread itself.
    // (None for the local stage either: it archives the fixtures' threads, and no turn is held on an archived thread.)
    const wantsHold = !(stage.tellsAThread === true || TELLS_A_THREAD.has(name) || name === "local-roster");
    if (wantsHold !== holdsNow) await (wantsHold ? holdWorking : releaseWorking)(name);
    try {
      await stage.enter({ fake, statusWithRealIds, threads, untilSnapshot });
      for (const theme of THEMES) {
        for (const viewport of VIEWPORTS) {
          const at = `${stage.label} ${theme} ${viewport.name}`;
          const page = await themedPage(browser, viewport, theme, at);
          try {
            for (const scene of mine) {
              const given = { page, at, viewport, theme, threads, fixtureThreads, check, sleep, pages, ALL_PAGES, pilot: PILOT, record: (changes) => record(threads, changes), fake, tmuxStatus: (as, roster) => tmuxRoster(threads, as, roster), ownThreads, recordFor: (who, what) => recordFor(threads, who, what), statusAnsweredSinceRecord, retitle: (fixtureId, title) => void bb("thread", "update", threads.get(fixtureId).id, "--title", title) /* bb's own rename of a thread */, snapshot: () => rpc("snapshot") /* the server's roster as the app gets it now, with no read asked */ };
              if (!PILOT) await scene.run(given);
              else {
                // The image pass: a scene that needs a page the default does not show stops there, said, and the next one runs.
                try {
                  await scene.run(given);
                } catch (error) {
                  fail(`${at} (image pass) the scene "${scene.name}" stopped`, String(error?.message ?? error).split("\n")[0]);
                }
              }
            }
          } finally {
            await page.close();
          }
        }
      }
    } finally {
      await stage.leave?.({ fake, statusWithRealIds, threads, untilSnapshot });
    }
  }
  const unknown = scenes.filter((scene) => !(scene.stage in BUILT_IN) && !(scene.stage in stages));
  check(unknown.length === 0, "every scene names a stage that exists", unknown.map((scene) => `${scene.feature}: "${scene.name}" in "${scene.stage}"`).join(" | "));
  check(browser.errors.length === 0, "no uncaught exception in the page", browser.errors.slice(0, 3).join(" | "));
  // Every image here is of another screen or another state: none equals another.
  const same = sameImages(OUT);
  check(same.length === 0, "no two images of this run are the same image", same.map((names) => names.join(" = ")).join(" | "));
} finally {
  rmSync(WORK_HOLD_FILE, { force: true }); // the two held turns are answered now, whatever was thrown
  rmSync(BUSY_HOLD_FILE, { force: true }); // and the busy stage's
  rmSync(BUSY_SAY_FILE, { force: true });
  claudeBack();
  await browser?.close();
  fake(); // the fixtures as they are, for the checks that follow in live.sh
  try {
    rpc("refresh");
  } catch {
    // the next check reads for itself
  }
}

if (failures > 0) {
  console.log(`live-ui: ${failures} check(s) failed`);
  process.exit(1);
}
console.log("live-ui: all checks passed");
