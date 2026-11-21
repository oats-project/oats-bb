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
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { launchBrowser } from "./browser.mjs";
import { CONTRAST, failing, shown } from "./contrast.mjs";

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
const THEMES = ["light", "dark"];
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

const fixtureThreads = JSON.parse(readFileSync(join(PLUGIN, "test/fixtures/roster/threads.json"), "utf8")).threads;
const fixtureStatus = JSON.parse(readFileSync(join(PLUGIN, "test/fixtures/roster/status.json"), "utf8"));

/** One bb thread per fixture thread, found or made by its title: fixture thread id -> bb's thread. */
function threadsByFixtureId() {
  const project = listOf(bbJson("project", "list"), "projects")[0];
  if (project === undefined) throw new Error("live-ui: bb has no project (live.sh makes one)");
  const root = (project.sources ?? []).find((source) => source.path)?.path;
  const list = () => listOf(bbJson("thread", "list"), "threads");
  let existing = list();
  for (const wanted of fixtureThreads) {
    if (existing.some((thread) => thread.title === wanted.title)) continue;
    // No provider is installed in the container: the thread exists and ends in bb's "error"
    // status, which is all the join and the slots need.
    bb("thread", "spawn", "--project", project.id, "--environment", root, "--provider", "pi", "--model", "mock/echo", "--title", wanted.title, "--prompt", "hello", "--json");
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
  page.shot = async (name, { plugin = true } = {}) => {
    const { theme: drawn, roots, rows } = JSON.parse(await page.evaluate(CONTRAST));
    const bad = failing(rows);
    const count = (kind) => rows.filter((row) => row.kind === kind).length;
    const lowest = (kinds) => shown(Math.min(...rows.filter((row) => kinds.includes(row.kind)).map((row) => row.ratio)));
    const TEXTS = ["text", "value", "placeholder"];
    const texts = rows.filter((row) => TEXTS.includes(row.kind)).length;
    const dots = count("dot") === 0 ? "no state dot" : `its ${count("dot")} state dots at 3:1 or more (lowest ${lowest(["dot"])}:1)`;
    const ok = drawn === theme && (rows.length > 0 || !plugin) && bad.length === 0;
    check(ok, `${at} ${name}: bb draws its ${theme} theme, and ${rows.length === 0 ? "nothing of the plugin is in the page" : `the plugin's ${texts} texts read at 4.5:1 or more (lowest ${lowest(TEXTS)}:1), ${dots}`}`);
    // Every distinct failing row, whole: one run names all there is to fix in the scene.
    if (!ok) {
      console.log(`     theme ${drawn}; in ${roots.join(", ") || "nothing of the plugin"}`);
      for (const line of new Set(bad.map((row) => `${row.kind} ${row.what} ${shown(row.ratio)}:1 (needs ${row.need}; ${row.paint} on ${row.behind})${row.unsure === null ? "" : `, ${row.unsure}`}`))) console.log(`     ${line}`);
    }
    await shot(theme === "light" ? name : `${name}-${theme}`);
  };
  return page;
}

// ---- the scenes
//
// A scene is `{ stage, name, run }` in container/scenes/<feature>.mjs (its default export is the
// feature's list). `run({ page, at, viewport, theme, threads, fixtureThreads, check, sleep })` drives
// the page and takes its screenshots with `page.shot(name)`, which checks the contrast of what the
// plugin draws there; `at` leads every check's line; `threads` is fixture thread id -> bb's thread.
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

const FEATURES = ["roster", "home", "workspace", "spawn", "lifecycle"];
const SCENES = join(PLUGIN, "container", "scenes");

async function loadScenes() {
  const files = readdirSync(SCENES).filter((file) => file.endsWith(".mjs")).map((file) => file.slice(0, -4));
  const order = [...FEATURES.filter((feature) => files.includes(feature)), ...files.filter((feature) => !FEATURES.includes(feature)).sort()];
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
  // the kernel cannot reach and one whose session fell back to a shell.
  detached: {
    label: "A16",
    enter: async ({ threads }) => {
      const detached = new Map([...threads].filter(([id]) => id !== "thr_ci"));
      const states = {
        "weekly-digest-helper": { running: null, runtimeState: "unreachable", sessionEnd: null },
        "harvest-knowledge-helper": { running: false, runtimeState: "shell" },
      };
      fake({ status: { stdout: statusWithRealIds(detached, states) } });
      await untilSnapshot((snapshot) => snapshot.ok === true && snapshot.agents.some((agent) => agent.instance === "flaky-ci-developer" && agent.threadId === "thr_ci"));
    },
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

// ---- the run

// A bb that was never opened shows its first-run guide in place of the app: mark it as done, as a
// person does by walking through it. (A setting of bb's own; nothing of the plugin depends on it.)
bb("settings", "general", "onboardingCompletedAt", new Date().toISOString());

const threads = threadsByFixtureId();
const { scenes, stages } = await loadScenes();
const browser = await launchBrowser({ chromium: CHROMIUM, out: OUT, base: BASE });
try {
  for (const [name, stage] of Object.entries({ ...BUILT_IN, ...stages })) {
    const mine = scenes.filter((scene) => scene.stage === name);
    if (mine.length === 0) continue;
    try {
      await stage.enter({ fake, statusWithRealIds, threads, untilSnapshot });
      for (const theme of THEMES) {
        for (const viewport of VIEWPORTS) {
          const at = `${stage.label} ${theme} ${viewport.name}`;
          const page = await themedPage(browser, viewport, theme, at);
          try {
            for (const scene of mine) await scene.run({ page, at, viewport, theme, threads, fixtureThreads, check, sleep });
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
} finally {
  await browser.close();
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
