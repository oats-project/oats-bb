#!/usr/bin/env node
// The app's live checks (A13, A14), run by container/live.sh inside the container once bb-app
// runs, the plugin is installed from the checkout and the fake `oats` prints the fixtures.
//   A13 at 1280x800 and 390x800: the sidebar with the tree, an agent's thread with its header
//       row, the home page (its badge shows 3), and each of the four pages render.
//   A14 with the fake oats removed: bb's threads are listed, the "not found" line shows, and a
//       thread opens.
//   A16 an agent whose thread bb does not have: its soul's page says so, and Retire opens the
//       plan dialog.
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
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { launchBrowser, showSidebar, testId, textOf, texts, visible } from "./browser.mjs";
import { CONTRAST, failing } from "./contrast.mjs";

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

const fixtureThreads = JSON.parse(readFileSync(join(PLUGIN, "test/fixtures/threads.json"), "utf8")).threads;
const fixtureStatus = JSON.parse(readFileSync(join(PLUGIN, "test/fixtures/status.json"), "utf8"));

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

/** status.json as the fake prints it for this run: the same rows, with the bb threads' real ids. */
function statusWithRealIds(threads) {
  const status = structuredClone(fixtureStatus);
  for (const group of status.agents) {
    for (const row of group.instances) {
      const real = row.session ? threads.get(row.session.threadId) : undefined;
      if (real !== undefined) row.session.threadId = real.id;
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
  page.shot = async (name) => {
    const { theme: drawn, roots, rows } = JSON.parse(await page.evaluate(CONTRAST));
    const bad = failing(rows);
    const count = (kind) => rows.filter((row) => row.kind === kind).length;
    const lowest = (kinds) => Math.min(...rows.filter((row) => kinds.includes(row.kind)).map((row) => row.ratio));
    const dots = count("dot") === 0 ? "no state dot" : `its ${count("dot")} state dots at 3:1 or more (lowest ${lowest(["dot"])}:1)`;
    check(
      drawn === theme && roots.length > 0 && rows.length > 0 && bad.length === 0,
      `${at} ${name}: bb draws its ${theme} theme, and the plugin's ${count("text") + count("placeholder")} texts read at 4.5:1 or more (lowest ${lowest(["text", "placeholder"])}:1), ${dots}`,
      `theme ${drawn}; in ${roots.join(", ") || "nothing of the plugin"}: ${[...new Set(bad.map((row) => `${row.kind} ${row.what} ${row.ratio}:1 (needs ${row.need}; ${row.paint} on ${row.behind})${row.unsure === null ? "" : `, ${row.unsure}`}`))].join(" | ")}`,
    );
    await shot(theme === "light" ? name : `${name}-${theme}`);
  };
  return page;
}

async function a13(browser, viewport, threads, theme) {
  const at = `A13 ${theme} ${viewport.name}`;
  const page = await themedPage(browser, viewport, theme, at);
  try {
    // the sidebar with the tree
    await page.goto("/");
    check(await showSidebar(page, viewport), `${at} the thread list is the OATS sidebar`);
    await page.until(visible(testId("oats-tree")), 30);
    const rows = await page.evaluate(`[...document.querySelectorAll(${JSON.stringify(testId("oats-agent-row"))})].map((e) => e.getAttribute("data-sidebar-thread-id"))`);
    const expected = fixtureThreads.filter((thread) => thread.id !== "thr_plain").map((thread) => threads.get(thread.id).id);
    check(rows.length === 7 && expected.every((id) => rows.includes(id)), `${at} the tree draws the 7 bb agents, joined by bb's own thread ids`, JSON.stringify(rows));
    const child = `${testId("oats-agent-row")}[data-sidebar-thread-id="${threads.get("thr_mockups").id}"]`;
    check(await page.evaluate(`document.querySelector(${JSON.stringify(child)})?.className.includes("pl-6") === true`), `${at} a child is indented under its parent`);
    check((await page.evaluate(textOf(testId("oats-workspace-line")))).includes("8 agents"), `${at} the workspace line`, await page.evaluate(textOf(testId("oats-workspace-line"))));
    check((await page.evaluate(textOf(testId("oats-needs-line")))) === "3 need you", `${at} "3 need you"`, await page.evaluate(textOf(testId("oats-needs-line"))));
    const others = await page.evaluate(texts(testId("oats-other-row")));
    check(others.some((text) => text.includes("Plain bb thread")), `${at} the thread that is no agent is under Other threads`, JSON.stringify(others));
    await page.shot(`a13-${viewport.name}-sidebar`);

    // the home's badge: bb's own navigation entry for the home (the rail on desktop, the drawer on a
    // phone), never the plugin's own "3 need you" line, carries the label and draws the count
    const badge = await page.until(
      `(() => { const own = document.querySelector(${JSON.stringify(testId("oats-sidebar"))}); const entry = [...document.querySelectorAll("[aria-label]")].find((e) => !own?.contains(e) && /^OATS\\b.*3 agents need you/.test(e.getAttribute("aria-label"))); if (!entry) return ""; const r = entry.getBoundingClientRect(); const drawn = [...entry.querySelectorAll("*")].some((e) => e.children.length === 0 && e.textContent.trim() === "3"); return r.width > 0 && drawn ? entry.getAttribute("aria-label") : ""; })()`,
      15,
    );
    check(Boolean(badge), `${at} bb's navigation entry for the home shows the badge 3 (${badge ?? "not found"})`, await page.evaluate(`JSON.stringify([...document.querySelectorAll("[aria-label]")].map((e) => e.getAttribute("aria-label")).filter((l) => /OATS/.test(l)))`));

    // an agent's thread with its header row
    const mockups = threads.get("thr_mockups");
    await page.goto(`/projects/${mockups.projectId}/threads/${mockups.id}`);
    check(Boolean(await page.until(visible(testId("oats-identity-row")), 30)), `${at} an agent's thread shows the identity row`);
    const chips = await page.evaluate(textOf(testId("oats-identity-row")));
    check(
      ["oats-desktop-developer", "desktop-mockups-developer", "✓ desktop-mockups-developer", "parent · redesign-ui-lead", "home · …/instances/desktop-mockups-developer", "OATS"].every((chip) => chips.includes(chip)),
      `${at} the row's chips: soul, instance, alias, parent, home, OATS`,
      chips,
    );
    // By its place: the whole chip lies inside the row and inside the viewport, which is what the
    // pin is for. This does not see a chip covered by something drawn over it: `visible()` would,
    // but its probe point can land on the row beside a chip that has scrolled away, and pass.
    const chipInRow = await page.evaluate(
      `(() => { const chip = document.querySelector(${JSON.stringify(testId("oats-chip-oats"))})?.getBoundingClientRect(); const row = document.querySelector(${JSON.stringify(testId("oats-identity-row"))})?.getBoundingClientRect(); return Boolean(chip && row && chip.width > 0 && chip.left >= row.left && chip.right <= Math.min(row.right, innerWidth)); })()`,
    );
    check(chipInRow, `${at} the OATS chip is on screen, whatever the other chips' width`);
    const rowHeight = await page.evaluate(`document.querySelector(${JSON.stringify(testId("oats-identity-row"))})?.getBoundingClientRect().height ?? -1`);
    check(rowHeight > 0 && rowHeight < 50, `${at} the row is one line (${Math.round(rowHeight)} px)`);
    await page.shot(`a13-${viewport.name}-thread`);

    // a thread that is no agent has no row
    const plain = threads.get("thr_plain");
    await page.goto(`/projects/${plain.projectId}/threads/${plain.id}`);
    await sleep(3000);
    check(!(await page.evaluate(visible(testId("oats-identity-row")))), `${at} a thread that is no agent has no identity row`);

    // the home page
    await page.goto("/plugins/oats/home");
    check(Boolean(await page.until(visible(testId("oats-needs-card")), 30)), `${at} the home page renders`);
    const sections = await page.evaluate(`["needs", "working", "finished"].map((s) => document.querySelector('[data-testid="oats-home-' + s + '"] h2')?.innerText.replace(/\\s+/g, " ").trim())`);
    check(/^needs you 3$/i.test(sections[0] ?? "") && /^working 2$/i.test(sections[1] ?? ""), `${at} the home's counts: Needs you 3, Working 2`, JSON.stringify(sections));
    await page.shot(`a13-${viewport.name}-home`);

    // the four pages
    const pages = [
      ["souls", "oats-soul-row", "Souls"],
      ["capabilities", "oats-capability-row", "Capabilities"],
      ["teams", "oats-team-row", "Teams"],
      ["machines", "oats-machine-row", "Machines"],
    ];
    for (const [path, row, title] of pages) {
      await page.goto(`/plugins/oats/${path}`);
      const drawn = await page.until(visible(testId(row)), 30);
      const n = await page.evaluate(`document.querySelectorAll(${JSON.stringify(testId(row))}).length`);
      check(Boolean(drawn) && n > 0, `${at} ${title} renders (${n} rows)`);
      await page.shot(`a13-${viewport.name}-${path}`);
    }
    // a soul's own page: at phone width the detail replaces the list
    await page.goto("/plugins/oats/souls/oats-developer");
    check(Boolean(await page.until(visible(testId("oats-soul-detail")), 30)), `${at} a soul's page renders, with the spawn form`, await page.evaluate(textOf(testId("oats-souls-page"))));
    check((await page.evaluate(visible(testId("oats-soul-row")))) === !viewport.mobile, `${at} ${viewport.mobile ? "the list gives way to the soul, with Back" : "the list stays beside the soul"}`);
    await page.shot(`a13-${viewport.name}-soul`);
    // a package soul's key has a slash: its row opens its own page too
    await page.goto("/plugins/oats/souls");
    await page.until(visible(testId("oats-soul-row")), 30);
    const key = await page.evaluate(
      `(() => { const row = [...document.querySelectorAll(${JSON.stringify(testId("oats-soul-row"))})].find((e) => e.innerText.includes("/")); row?.click(); return row?.querySelector("span")?.innerText ?? null; })()`,
    );
    const heading = key === null ? "" : await page.until(`(() => { const t = ${textOf(`${testId("oats-soul-detail")} h2`)}; return t === ${JSON.stringify(key)} ? t : ""; })()`, 15);
    check(key !== null && heading === key, `${at} a package soul's row opens its page (${key})`, await page.evaluate("location.pathname + ' | ' + document.body.innerText.slice(0, 200)"));
  } finally {
    await page.close();
  }
}

/** A16: an agent of the status whose thread bb does not have, on its soul's page, and its Retire. */
async function a16(browser, viewport, theme) {
  const at = `A16 ${theme} ${viewport.name}`;
  const page = await themedPage(browser, viewport, theme, at);
  try {
    await page.goto("/plugins/oats/souls/oats-developer");
    const line = await page.until(`(() => { const t = ${textOf(testId("oats-soul-agent-detached"))}; return t.includes("flaky-ci-developer") ? t : ""; })()`, 30);
    check(Boolean(line) && /thread missing/.test(line), `${at} the soul's page says "thread missing" for the agent whose thread bb does not have`, line ?? (await page.evaluate(textOf(testId("oats-souls-page")))));
    await page.shot(`a16-${viewport.name}-soul`);
    await page.evaluate(`document.querySelector(${JSON.stringify(testId("oats-detached-retire"))}).click()`);
    const plan = await page.until(`(() => { const lines = document.querySelectorAll(${JSON.stringify(`${testId("oats-plan")} li`)}); return lines.length > 0 && document.querySelector(${JSON.stringify(testId("oats-plan-confirm"))})?.disabled === false ? lines.length : 0; })()`, 30);
    check(Boolean(plan), `${at} Retire opens the plan dialog, with the kernel's plan (${plan ?? 0} lines) and Confirm`, await page.evaluate(textOf(testId("oats-modal"))));
    await page.shot(`a16-${viewport.name}-plan`);
    await page.evaluate(`document.querySelector(${JSON.stringify(testId("oats-plan-cancel"))}).click()`);
    check(Boolean(await page.until(`document.querySelector(${JSON.stringify(testId("oats-modal"))}) === null`, 10)), `${at} Cancel closes the dialog`);
  } finally {
    await page.close();
  }
}

async function a14(browser, viewport, threads, theme) {
  const at = `A14 ${theme} ${viewport.name}`;
  const page = await themedPage(browser, viewport, theme, at);
  try {
    await page.goto("/");
    check(await showSidebar(page, viewport), `${at} the thread list is still drawn`);
    const line = await page.until(`(() => { const t = ${textOf(testId("oats-status-line"))}; return /not found/i.test(t) ? t : ""; })()`, 30);
    check(Boolean(line), `${at} the "not found" line shows: ${line ?? ""}`, await page.evaluate(textOf(testId("oats-sidebar"))));
    const listed = await page.evaluate(`[...document.querySelectorAll(${JSON.stringify(testId("oats-other-row"))})].map((e) => e.getAttribute("data-sidebar-thread-id"))`);
    check([...threads.values()].every((thread) => listed.includes(thread.id)), `${at} bb's threads are all listed (${listed.length})`, JSON.stringify(listed));
    check(!(await page.evaluate(visible(testId("oats-tree")))), `${at} no tree is drawn from a stale answer`);
    await page.shot(`a14-${viewport.name}-sidebar`);

    const target = threads.get("thr_redesign");
    await page.evaluate(`document.querySelector('${testId("oats-other-row")}[data-sidebar-thread-id="${target.id}"]').click()`);
    const opened = await page.until(`location.pathname.endsWith("/threads/${target.id}")`, 15);
    check(Boolean(opened), `${at} a thread opens from the list`, await page.evaluate("location.pathname"));
    await sleep(2500);
    check(!(await page.evaluate(visible(testId("oats-identity-row")))), `${at} the open thread has no OATS row while OATS cannot be read`);
    await page.shot(`a14-${viewport.name}-thread`);
  } finally {
    await page.close();
  }
}

// ---- the run

// A bb that was never opened shows its first-run guide in place of the app: mark it as done, as a
// person does by walking through it. (A setting of bb's own; nothing of the plugin depends on it.)
bb("settings", "general", "onboardingCompletedAt", new Date().toISOString());

const threads = threadsByFixtureId();
fake({ status: { stdout: statusWithRealIds(threads) } });
await untilSnapshot((snapshot) => snapshot.ok === true && snapshot.agents.some((agent) => agent.threadId === threads.get("thr_release").id));

const browser = await launchBrowser({ chromium: CHROMIUM, out: OUT, base: BASE });
try {
  for (const theme of THEMES) for (const viewport of VIEWPORTS) await a13(browser, viewport, threads, theme);

  // A16: the same status, with one agent on a thread bb does not have (its fixture id, unmapped).
  const detached = new Map([...threads].filter(([id]) => id !== "thr_ci"));
  fake({ status: { stdout: statusWithRealIds(detached) } });
  await untilSnapshot((snapshot) => snapshot.ok === true && snapshot.agents.some((agent) => agent.instance === "flaky-ci-developer" && agent.threadId === "thr_ci"));
  for (const theme of THEMES) for (const viewport of VIEWPORTS) await a16(browser, viewport, theme);

  // A14: the fake oats is removed for the length of the check, then put back.
  renameSync(OATS, `${OATS}.away`);
  try {
    await untilSnapshot((snapshot) => snapshot.ok === false && snapshot.code === "OATS_NOT_FOUND");
    for (const theme of THEMES) for (const viewport of VIEWPORTS) await a14(browser, viewport, threads, theme);
  } finally {
    if (existsSync(`${OATS}.away`)) renameSync(`${OATS}.away`, OATS);
  }
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
