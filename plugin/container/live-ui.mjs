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
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { launchBrowser, lowTargets } from "./browser.mjs";
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
  writeFileSync(FAKE_CONFIG, JSON.stringify({ fixtures: join(PLUGIN, "test/fixtures"), log: FAKE_LOG, verbs }));

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
 * whether it runs as the kernel prints it for a tmux home today: `running` true or false, and no
 * runtimeState word (README).
 */
/** `as`: by instance, another `how` than the roster's own (a scene that starts a lost agent draws it running after). */
function tmuxRoster(threads, as = {}) {
  const status = JSON.parse(statusWithRealIds(threads));
  const rows = status.agents.flatMap((group) => group.instances);
  const model = rows.find((row) => row.instance === "kernel-fix-developer");
  const claim = rows.find((row) => row.instance === "release-070-maintainer").waitingOnYou;
  for (const group of status.agents) group.instances = group.instances.filter((row) => TMUX_ROSTER.bb.includes(row.instance));
  for (const row of status.agents.flatMap((group) => group.instances)) row.instance = TMUX_ROSTER.renamed[row.instance] ?? row.instance;
  for (const [instance, soul, parent, listed] of TMUX_ROSTER.tmux) {
    const how = as[instance] ?? listed;
    const row = structuredClone(model);
    Object.assign(row, { agent: soul, instance, home: model.home.replace("/oats-developer/instances/kernel-fix-developer", `/${soul}/instances/${instance}`), parentInstance: parent, waitingOnYou: how === "waiting" ? structuredClone(claim) : null });
    row.tmux = { ...model.tmux, window: instance };
    if (row.identity) row.identity = { ...row.identity, alias: instance };
    if (row.capabilityMeta?.["oats.aweb"]) row.capabilityMeta = { ...row.capabilityMeta, "oats.aweb": { ...row.capabilityMeta["oats.aweb"], alias: instance } };
    // What the kernel prints for a tmux home (awebai/oats lib/instance-listing.mjs `tmuxLiveness`):
    // `{ running: true }` for one whose harness runs and `{ running: false }` for one whose window is
    // gone, with NO runtimeState word in either. (status.json's own tmux row carries "unknown", from
    // the kernel it was recorded with.)
    delete row.runtimeState;
    row.running = how !== "stopped" && how !== "lost";
    // A lost session (the kernel's recorded row for a tmux home whose window was killed): not running, no word, and `sessionEnd: "lost"`.
    if (how === "lost") row.sessionEnd = "lost";
    status.agents.find((group) => group.name === soul).instances.push(row);
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
  page.shot = async (name, { plugin = true, targets = false } = {}) => {
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
      fake({ status: { stdout: tmuxRoster(threads) } });
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

// ---- the run

// A bb that was never opened shows its first-run guide in place of the app: mark it as done, as a
// person does by walking through it. (A setting of bb's own; nothing of the plugin depends on it.)
bb("settings", "general", "onboardingCompletedAt", new Date().toISOString());

const WORK_HOLD = "live-ui-working";
const WORK_HOLD_FILE = join(homedir(), "mock", "hold", WORK_HOLD);
// A run that was killed before its `finally` (in a kept container) left its hold: it does not outlive that run.
rmSync(WORK_HOLD_FILE, { force: true });
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
    const mine = scenes.filter((scene) => scene.stage === name);
    if (mine.length === 0) continue;
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
              const given = { page, at, viewport, theme, threads, fixtureThreads, check, sleep, pages, ALL_PAGES, pilot: PILOT, record: (changes) => record(threads, changes), fake, tmuxStatus: (as) => tmuxRoster(threads, as) };
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
