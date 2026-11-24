#!/usr/bin/env node
// The pi run (README.md beside this file), inside the container once ../setup.sh has finished
// with REAL_PI=1: bb-app, the OATS kernel the real run pins, the bb session provider, pi with
// the OATS bridge on a mock model, and the plugin installed from the checkout with `oatsBin` set
// to the recording wrapper (../oats-record.mjs).
//
// First, by the plugin's RPC alone (no page):
//   P0b a preview with the harness pi that the kernel refuses (the bridge missing): the plugin's
//       spawnPlan answers the kernel's code and message unchanged (what the form puts under
//       Details).
// Then it proves, THROUGH THE NEW AGENT FORM in a browser, that a person can launch a pi agent on bb:
//   P1  a preview with the harness pi answers, and the form shows it;
//   P2  a spawn with the harness pi creates the agent, its bb thread opens, and it answers a turn;
//   P3  the pi agent's own needs-input (`oats instance attention`, run by pi's own shell in its
//       home) is on the home's card and on the thread's status line;
//   P4  a question a pi extension's dialog asks (the bridge's `question` claim) is there too, and
//       an answer on the home's card reaches pi;
//   P4b the Restart dialog of the running pi agent HOLDS a changed model that bb's list for pi does
//       not serve (the hold rests on bb's list as the app reads it, not on the kernel's refusal:
//       the kernel stops the session before the provider judges the model), sends nothing, and
//       the agent still runs;
//   P5  the plugin stops and retires the pi agent.
// Every check prints what it read. The images are taken in bb's light and dark themes, at both
// widths. What the kernel printed for the plugin's calls is kept in $OUT/answers/, as evidence:
// this run records no fixture (the fixtures are the main run's, ../scenario.mjs).
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fill, launchBrowser, showSidebar, testId, textOf, visible } from "../../browser.mjs";
import { sameImages } from "../../images.mjs";
import { choose } from "../../scenes/spawn.mjs";
import { Fixtures } from "../fixtures.mjs";

const REAL = process.env.REAL ?? "/home/node/real";
const OUT = process.env.OUT ?? "/home/node/out/real";
const DEPLOY = join(REAL, "deploy");
const RECORDS = join(REAL, "records");
const OATS = JSON.parse(readFileSync(join(REAL, "bin", "oats-record.json"), "utf8")).oats;
const BASE = process.env.BB_URL ?? "http://127.0.0.1:38886";
const VIEWPORTS = [
  { name: "1280x800", width: 1280, height: 800, mobile: false },
  { name: "390x800", width: 390, height: 800, mobile: true },
];
const VIEWS = ["light", "dark"].flatMap((theme) => VIEWPORTS.map((viewport) => ({ viewport, theme, suffix: theme === "light" ? "" : "-dark" })));
mkdirSync(OUT, { recursive: true });

// ---- what the run says (as ../scenario.mjs does)

let failures = 0;
const say = (line = "") => console.log(line);
const pass = (what) => say(`PASS ${what}`);
const fail = (what, detail = "") => {
  failures += 1;
  say(`FAIL ${what}${detail === "" ? "" : `\n     ${String(detail).slice(0, 1500)}`}`);
};
const check = (ok, what, detail) => (ok ? pass(what) : fail(what, detail));
const note = (what) => say(`NOTE ${what}`);
const show = (label, value) => say(`     ${label}: ${typeof value === "string" ? value : JSON.stringify(value)}`);
const step = (title) => say(`\n== ${title}`);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(what, read, seconds = 60) {
  const deadline = Date.now() + seconds * 1000;
  for (;;) {
    const value = await read();
    if (value) return value;
    if (Date.now() > deadline) {
      fail(`timed out after ${seconds} s waiting for ${what}`);
      return undefined;
    }
    await sleep(500);
  }
}

// ---- bb, the kernel, the mock model

const bb = (...args) => execFileSync("bb", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
const bbJson = (...args) => JSON.parse(bb(...args, "--json"));
const bbThread = (id) => bbJson("thread", "list", "--include-archived").find((thread) => thread.id === id);
const pendingIn = (threadId) => bbJson("thread", "interactions", "list", threadId).filter((interaction) => interaction.status === "pending");
/** The real `oats`, run in the deployment as a person would: not through the plugin, not recorded. */
function oats(...args) {
  const run = spawnSync(OATS, args, { cwd: DEPLOY, encoding: "utf8" });
  return { exit: run.status, stdout: run.stdout, stderr: run.stderr };
}
function rowOf(instance) {
  const run = oats("status", "--json");
  if (run.exit !== 0) throw new Error(`oats status --json exited ${run.exit}: ${run.stderr}`);
  for (const group of JSON.parse(run.stdout).agents) for (const row of group.instances) if (row.instance === instance) return row;
  return undefined;
}
const brief = (row) =>
  row === undefined
    ? "no row"
    : `backend ${row.backend}, harness ${row.harness}, model ${row.model}, thread ${row.session?.threadId}, running ${row.running}, runtimeState ${row.runtimeState}${row.waitingOnYou ? `, waitingOnYou ${JSON.stringify(row.waitingOnYou)}` : ""}`;
/**
 * What the kernel's row says of `running` for an agent that is IDLE (as ../scenario.mjs has it):
 * `running` is endpoint activity, not work: null from a provider that cannot tell whether a
 * harness is loaded, true from one that scans its harness (an idle agent's pi is loaded). Both are
 * accepted. That the agent is idle is what bb says of its thread, and what the screen says.
 */
const idleRunning = (row) => row.running === null || row.running === true;
const untilRow = (instance, what, matches, seconds = 60) =>
  until(`${instance} to read ${what} in oats status`, () => {
    const row = rowOf(instance);
    return row !== undefined && matches(row) ? row : undefined;
  }, seconds);
/** The pi mock's log (mock-openai.mjs): one line per request. Its chat requests that offer tools are the agents' turns. */
const piRequests = () => {
  const file = join(REAL, "mock", "pi-requests.jsonl");
  return existsSync(file) ? readFileSync(file, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line)) : [];
};
const piTurns = () => piRequests().filter((request) => request.event !== "listed" && request.tools > 0);

// ---- the plugin's RPC, and what the kernel printed for it

const inputFile = join(OUT, "rpc-input.json");
function rpc(method, input = null) {
  writeFileSync(inputFile, JSON.stringify(input));
  const run = spawnSync("bb", ["plugin", "rpc", "call", "oats", method, "--input-file", inputFile, "--json"], { encoding: "utf8" });
  let answer;
  try {
    answer = JSON.parse(run.stdout);
  } catch {
    answer = undefined;
  }
  if (run.status === 0 && answer !== undefined && !(answer.ok === false && answer.error !== undefined)) return { ok: true, value: answer.result ?? answer };
  return { ok: false, message: answer?.error?.message ?? (run.stderr.trim() || run.stdout.trim()) };
}
/** A call that must go through: its value; a refusal fails the run's check and answers undefined. */
function act(what, method, input) {
  const answer = rpc(method, input);
  if (!answer.ok) {
    fail(`${what}: the plugin's ${method} was refused`, answer.message);
    return undefined;
  }
  pass(`${what} (rpc ${method})`);
  show("answer", answer.value);
  return answer.value;
}
const records = () =>
  readdirSync(RECORDS)
    .filter((name) => name.endsWith(".json"))
    .map((name) => JSON.parse(readFileSync(join(RECORDS, name), "utf8")))
    .sort((a, b) => a.at.localeCompare(b.at));
/** The last call the plugin made whose argv starts with `words` and holds every one of `having`; undefined when there is none. */
function recorded(words, having = []) {
  const found = records().filter((record) => words.every((word, index) => record.argv[index] === word) && having.every((word) => record.argv.includes(word)));
  return found[found.length - 1];
}
const valueAfter = (argv, flag) => (argv.includes(flag) ? argv[argv.indexOf(flag) + 1] : undefined);
const snapshotAgent = (instance) => {
  rpc("refresh");
  const snapshot = rpc("snapshot");
  return snapshot.ok && snapshot.value.ok ? snapshot.value.agents.find((agent) => agent.instance === instance) : undefined;
};

// ---- the page

let browser;
/** `draw` once per view (bb's light and dark themes, at each width), with a page whose theme is checked; `shot(name)` saves `<scene>-<width>x<height>-<name>[-dark].png`. */
async function views(scene, draw) {
  for (const view of VIEWS) {
    const { viewport, theme, suffix } = view;
    const at = `${scene} ${theme} ${viewport.name}`;
    const page = await browser.page(viewport, { theme });
    try {
      const goto = page.goto;
      let checked = false;
      page.goto = async (path) => {
        await goto(path);
        if (checked) return;
        checked = true;
        const drawn = await page.until(`document.readyState === "complete" && (document.documentElement.classList.contains("dark") ? "dark" : "light")`, 15);
        check(drawn === theme, `${at}: bb draws its ${theme} theme`, String(drawn));
      };
      await draw({ page, at, viewport, theme, first: view === VIEWS[0], last: view === VIEWS[VIEWS.length - 1], shot: (name) => page.shot(`${scene}-${viewport.name}-${name}${suffix}`) });
    } finally {
      await page.close();
    }
  }
}
const q = (id) => JSON.stringify(testId(id));
/** The thread's own row: the state it draws, its status line, and the whole row. */
const THREAD_ROW = `JSON.stringify({ state: document.querySelector(${q("oats-status-line")})?.getAttribute("data-state") ?? null, status: ${textOf(testId("oats-status-line"))}, row: ${textOf(testId("oats-identity-row"))} })`;
/** The home's card of an agent that needs a person, found by what it asks: its text, its question line and its choices. */
const cardOf = (text) => `[...document.querySelectorAll(${q("oats-needs-card")})].find((e) => e.innerText.includes(${JSON.stringify(text)}))`;
const CARD = (text, choices) =>
  `(() => { const c = ${cardOf(text)}; return c && c.querySelectorAll(${q("oats-needs-choice")}).length === ${choices} ? JSON.stringify({ question: c.querySelector(${q("oats-needs-question")})?.innerText.trim(), choices: [...c.querySelectorAll(${q("oats-needs-choice")})].map((e) => e.innerText.trim()), card: c.innerText.replace(/\\s+/g, " ").trim() }) : ""; })()`;
const TILES_COUNTED = `![...document.querySelectorAll('[data-testid="oats-home-tiles"] button')].some((tile) => tile.innerText.includes("Counting"))`;

/**
 * The agent that needs a person, at every view: its card on the home (read once it holds its
 * `choices`: the card asks bb for them after it is drawn), and its thread's own row. `answer(view)`
 * runs last, on the home again.
 */
async function needsYou(scene, { instance, soul, threadId, projectId, text, choices }, answer = async () => {}) {
  await views(scene, async (view) => {
    const { page, at, shot } = view;
    await page.goto("/plugins/oats/home");
    const card = await page.until(CARD(text, choices.length), 30);
    const read = JSON.parse(card || "{}");
    check(read.question === text && JSON.stringify(read.choices) === JSON.stringify(choices) && read.card.split(soul).length === 2, `${at}: the home's card of ${instance} says what it waits for, and its soul once (the agent's type is kept on a card: Joan's direction of 24 Nov 2026, L10)${choices.length > 0 ? `, with ${choices.length} choice(s)` : ""}`, card || (await page.evaluate(textOf(testId("oats-home-needs")))));
    show("card", read.card ?? "none");
    await page.until(TILES_COUNTED, 20);
    await page.evaluate(`(${cardOf(text)})?.scrollIntoView({ block: "center" })`);
    await shot("home");
    await page.goto(`/projects/${projectId}/threads/${threadId}`);
    // Waited for: the line that says what it waits for. A thread with a pending interaction can read "Needs you" before the claim's text has reached the page.
    const line = JSON.parse((await page.until(`document.querySelector(${q("oats-status-line")})?.getAttribute("data-state") === "needs-you" && ${textOf(testId("oats-status-line"))}.includes(${JSON.stringify(text)}) && ${THREAD_ROW}`, 30)) || (await page.evaluate(THREAD_ROW)));
    check(line.state === "needs-you" && line.status.replace(/^! /, "").startsWith("Needs you") && line.status.includes(text) && !line.row.includes("instance of"), `${at}: the thread's status line says "Needs you" and what it waits for, and its row says no soul`, JSON.stringify(line));
    show("status line", line.status);
    await shot("thread");
    await answer(view);
  });
}

// ---- the run

const evidence = new Fixtures({ out: join(OUT, "answers"), substitutions: [] });
const SOUL = "oats-developer";
const NAME = "pi-form-developer";
const MODEL = "mock/echo";
const TASK = "Say hello from pi, then wait.";
const HOME = join(DEPLOY, "agents", SOUL, "instances", NAME);
const kernel = JSON.parse(oats("version", "--json").stdout).version;

say(`== the pi run: bb ${bb("--version").trim()}, oats ${kernel}, pi ${execFileSync("pi", ["--version"], { encoding: "utf8" }).trim()}, ${existsSync(join(REAL, "refs.json")) ? readFileSync(join(REAL, "refs.json"), "utf8").trim() : "refs not recorded"}`);
// A bb that was never opened shows its first-run guide in place of the app (../../live-ui.mjs).
bb("settings", "general", "onboardingCompletedAt", new Date().toISOString());
// The pages a release shows (the plugin's setting `pages`; ../setup.sh shows them all for the main run): the pilot's own.
bb("plugin", "config", "oats", "set", "pages", "home");
browser = await launchBrowser({ chromium: process.env.CHROMIUM ?? "chromium", out: OUT, base: BASE });

try {
  step("P0 the deployment through the plugin, and what bb and the provider say of pi");
  rpc("refresh");
  const first = rpc("snapshot");
  // Not pi's: the plugin reads this kernel at all. A failure here is about the plugin on this kernel.
  check(first.ok && first.value.ok === true && first.value.deployment.root === DEPLOY, `the plugin reads the deployment through the real oats ${kernel}`, JSON.stringify(first));
  const souls = act("the souls", "souls");
  check(souls?.souls.some((soul) => soul.name === SOUL && soul.spawnable), `${SOUL} is spawnable`, JSON.stringify(souls?.souls.map((soul) => [soul.name, soul.spawnable])));
  const state = await (await fetch(`${BASE}/api/v1/system/providers/state?providerId=pi`)).json();
  check(state.providers?.[0]?.providerId === "pi" && state.providers[0].status === "ready", "bb reports its pi provider ready", JSON.stringify(state.providers?.map((provider) => [provider.providerId, provider.status, provider.installedVersion])));
  const packages = JSON.parse(readFileSync(join(process.env.HOME, ".pi", "agent", "settings.json"), "utf8")).packages;
  check(JSON.stringify(packages) === JSON.stringify([`npm:@awebai/oats-pi@${kernel}`]), "bb's pi configuration lists the OATS bridge at the kernel's own version, and nothing else", JSON.stringify(packages));
  const list = act("the provider's harnesses", "spawnHarnesses", null);
  check(list?.harnesses.includes("pi"), "the bb session provider declares pi", JSON.stringify(list?.harnesses));

  step("P0b a preview with the harness pi, refused: the bridge is not in bb's pi configuration");
  // What a person meets on a machine where pi is not set up for bb. The provider reads bb's pi
  // configuration at every check, so the bridge is taken out of its list for one call and put back.
  const piSettings = join(process.env.HOME, ".pi", "agent", "settings.json");
  const asInstalled = readFileSync(piSettings, "utf8");
  let refusedPreview;
  try {
    writeFileSync(piSettings, `${JSON.stringify({ ...JSON.parse(asInstalled), packages: [] }, null, 2)}\n`);
    refusedPreview = rpc("spawnPlan", { soul: SOUL, name: "pi-refused-developer", task: "", harness: "pi", model: MODEL });
  } finally {
    writeFileSync(piSettings, asInstalled);
  }
  const refusedCall = recorded(["spawn", SOUL], ["--preview", "pi-refused-developer"]);
  let refusal;
  try {
    refusal = JSON.parse(refusedCall?.stdout ?? "").error;
  } catch {
    refusal = undefined; // no JSON printed: the check below says what was
  }
  check(refusedPreview.ok === false && refusal?.code === "E_BACKEND_NOT_READY" && /@awebai\/oats-pi/.test(refusal.message), "the kernel refuses the preview itself, with the provider's word that the bridge is missing (E_BACKEND_NOT_READY)", refusedCall?.stdout || JSON.stringify(refusedPreview));
  check(refusedPreview.ok === false && refusal !== undefined && refusedPreview.message.endsWith(`${refusal.code}: ${refusal.message}`), "and the plugin shows the kernel's refusal unchanged", JSON.stringify(refusedPreview));
  show("kernel", refusal === undefined ? "no refusal" : `${refusal.code}: ${refusal.message}`);
  show("plugin", refusedPreview.ok ? refusedPreview.value : refusedPreview.message);
  if (refusal !== undefined) evidence.keep("spawn-preview-pi-refused.json", refusedCall.stdout);
  check(rowOf("pi-refused-developer") === undefined, "and nothing was created");

  step("P1 + P2 the New agent form: the harness pi, its preview, the spawn, the thread");
  let spawnedAt = null;
  let opened = null;
  await views("real-pi-form", async ({ page, at, viewport, first: firstView, shot }) => {
    await page.goto("/");
    check(await showSidebar(page, viewport), `${at}: the thread list is the OATS sidebar`);
    const button = await page.until(visible(testId("oats-new-agent")), 30);
    check(Boolean(button), `${at}: the sidebar has New agent`, await page.evaluate(textOf(testId("oats-sidebar"))));
    await page.evaluate(`document.querySelector(${q("oats-new-agent")})?.click()`);
    const ready = await page.until(`${visible(testId("oats-spawn-form"))} && document.querySelector(${q("oats-spawn-soul")})?.disabled === false && document.querySelector(${q("oats-spawn-harness")})?.disabled === false && location.pathname`, 30);
    check(ready === "/plugins/oats/new-agent", `${at}: New agent opens the form, with the souls and the harnesses read`, String(ready));
    check(await page.evaluate(choose("oats-spawn-soul", SOUL)), `${at}: the soul ${SOUL} is chosen`, await page.evaluate(textOf(testId("oats-spawn-form"))));
    // The harness, from the list the provider declares; the model, from bb's own list for its pi provider.
    check(await page.evaluate(choose("oats-spawn-harness", "pi")), `${at}: the harness pi is chosen from the provider's list`, await page.evaluate(textOf(testId("oats-spawn-form"))));
    const offered = await page.until(choose("oats-spawn-model", MODEL), 30);
    check(Boolean(offered), `${at}: the model ${MODEL} is chosen from the models bb lists for its pi provider`, await page.evaluate(textOf(testId("oats-spawn-form"))));
    await page.evaluate(fill(testId("oats-spawn-task"), TASK));
    const name = spawnedAt === null ? NAME : `${NAME}-${viewport.name}`;
    await page.evaluate(fill(testId("oats-spawn-name"), name));
    const read = await page.until(`(() => { const c = document.querySelector(${q("oats-spawn-preview")}); const name = c?.querySelector("dd")?.innerText; return name === ${JSON.stringify(name)} && !c.querySelector(${q("oats-spawn-updating")}) && document.querySelector(${q("oats-spawn-submit")}).disabled === false ? c.innerText.replace(/\\s+/g, " ") : ""; })()`, 60);
    check(Boolean(read) && new RegExp(`Name ${name} Works in .*Harness pi · ${MODEL.replace("/", "\\/")} .*Access `).test(read ?? ""), `${at}: What will be created, from the kernel's preview with the harness pi, in view: the name, where it works, "Harness pi · ${MODEL}", the access`, read ?? (await page.evaluate(textOf(testId("oats-new-agent-page")))));
    show("what will be created", read ?? "not read");
    const previewCall = recorded(["spawn", SOUL], ["--preview", name]);
    check(previewCall !== undefined && valueAfter(previewCall.argv, "--harness") === "pi" && valueAfter(previewCall.argv, "--model") === MODEL && previewCall.argv.includes("--yolo") && valueAfter(previewCall.argv, "--backend") === "bb", `${at}: the form's preview passed --harness pi, --model ${MODEL}, --backend bb and --yolo`, JSON.stringify(previewCall?.argv));
    const previewed = previewCall === undefined ? undefined : JSON.parse(previewCall.stdout);
    check(previewed?.ok === true && previewed.result.launch?.effective?.harness === "pi" && previewed.result.launch.effective.model === MODEL, `${at}: the kernel's preview answered: the launch is pi on ${MODEL}`, JSON.stringify(previewed?.ok ? previewed.result.launch : previewed));
    if (firstView && previewCall !== undefined) evidence.keep("spawn-preview-pi.json", previewCall.stdout);
    // At the phone's width the fields and what will be created are two screens: one image of each.
    if (viewport.mobile) {
      await page.evaluate(`document.querySelector(${q("oats-spawn-harness")}).scrollIntoView({ block: "center" })`);
      await shot("fields");
    }
    await page.evaluate(`document.querySelector(${q("oats-spawn-submit")}).scrollIntoView({ block: "center" })`);
    await shot("preview");
    if (spawnedAt !== null) return;
    // Spawn, once, in the first view: the new agent's thread opens.
    spawnedAt = at;
    await page.evaluate(`document.querySelector(${q("oats-spawn-submit")}).click()`);
    opened = await page.until(`/\\/threads\\/thr_/.test(location.pathname) ? location.pathname : ""`, 180);
    check(Boolean(opened), `${at}: Spawn created the agent and opened its thread`, opened ?? (await page.evaluate(textOf(testId("oats-new-agent-page")))));
  });
  const applied = recorded(["spawn", SOUL], ["--idempotency-key", NAME]);
  if (applied === undefined) throw new Error("the form's spawn made no oats call: nothing to go on with");
  evidence.keep("spawn-pi.json", applied.stdout);
  const spawned = JSON.parse(applied.stdout);
  check(valueAfter(applied.argv, "--harness") === "pi" && valueAfter(applied.argv, "--model") === MODEL && applied.argv.includes("--yolo") && applied.argv.includes("--expect-decision"), "the form's spawn passed --harness pi, --model, --yolo, and applied the decision its preview showed", JSON.stringify(applied.argv));
  check(spawned.ok === true && spawned.result.launched === true, "the kernel spawned and launched it", applied.stdout.slice(0, 600));
  let row = await untilRow(NAME, "on bb, on pi", (r) => r.backend === "bb" && r.harness === "pi" && typeof r.session?.threadId === "string");
  const threadId = row?.session?.threadId;
  check(Boolean(opened) && String(opened).endsWith(threadId), "the thread the form opened is the one the kernel names", JSON.stringify({ opened, threadId }));
  show("oats status", brief(row));
  const thread = bbThread(threadId);
  const projectId = thread?.projectId;
  check(thread?.providerId === "pi", "bb: the thread is one of its pi provider", JSON.stringify(thread && { id: thread.id, providerId: thread.providerId, status: thread.status, title: thread.title }));
  // The turn: pi asked the mock model with the opening instruction, got its line, and the thread is at rest.
  const turn = await until("pi's first turn to reach the model", () => piTurns().find((request) => request.event === "answered" && request.lastRole === "user" && request.lastText.includes(TASK)), 120);
  row = await untilRow(NAME, "idle, its first turn over", (r) => idleRunning(r) && bbThread(threadId)?.status === "idle", 120);
  check(turn !== undefined && row !== undefined, `the pi agent answered one turn: the model was asked with the opening instruction on ${turn?.model}, and the thread is idle`, JSON.stringify({ turn, row: brief(rowOf(NAME)) }));
  show("the turn", turn);
  show("oats status", brief(row));
  const mine = snapshotAgent(NAME);
  // Read again after bb said the turn was over: the row the wait matched may be from before it ended.
  row = rowOf(NAME) ?? row;
  check(mine?.threadId === threadId && mine.running === (row?.running ?? null), "the plugin's snapshot has the agent as the kernel does: its thread, and the kernel's word for whether a harness is loaded", JSON.stringify({ plugin: mine && { threadId: mine.threadId, running: mine.running }, kernel: brief(row) }));
  await views("real-pi-idle", async ({ page, at, shot }) => {
    await page.goto(`/projects/${projectId}/threads/${threadId}`);
    const line = JSON.parse((await page.until(`document.querySelector(${q("oats-status-line")})?.getAttribute("data-state") === "idle" && ${THREAD_ROW}`, 30)) || (await page.evaluate(THREAD_ROW)));
    check(line.state === "idle" && line.status.startsWith("Idle") && !line.row.includes("instance of") && line.row.includes("Instance panel"), `${at}: the pi agent's thread says "Idle" in its own row, with the way to its instance panel (where its soul is)`, JSON.stringify(line));
    const reply = await page.until(`(document.body.innerText.match(/MOCK-REPLY \\d+/) ?? [""])[0]`, 30);
    check(Boolean(reply), `${at}: and the thread shows what pi answered (${reply})`, await page.evaluate("document.body.innerText.slice(0, 600)"));
    show("header row", line.row);
    await shot("thread");
  });

  step("P3 the pi agent asks for a person itself (oats instance attention, by pi's own shell in its home)");
  const CLAIM = "Ship the pi run, or wait for the pilot?";
  const tell = (text) => say(`     ${bb("thread", "tell", threadId, text).trim()}`);
  const callOf = (name, args) => `MOCK-CALL:${JSON.stringify({ name, arguments: args })}\n`;
  let before = piRequests().length;
  tell(`Ask the person what to do.\n${callOf("bash", { command: `oats instance attention --message ${JSON.stringify(CLAIM)}` })}`);
  row = await untilRow(NAME, "its own claim", (r) => r.waitingOnYou != null, 90);
  const toolResult = piRequests().slice(before).find((request) => request.lastRole !== "user" && request.event === "answered");
  check(row?.waitingOnYou?.message === CLAIM && row.waitingOnYou.producer === "agent", "oats status: a waiting claim of the agent's own, with its message: pi's shell ran oats as this instance, in its home (the project env reached it)", brief(row));
  show("oats status", brief(row));
  show("what the tool answered pi", toolResult?.lastText ?? "no tool result reached the model yet");
  await untilRow(NAME, "its turn over", (r) => bbThread(threadId)?.status === "idle", 60);
  const claim = snapshotAgent(NAME)?.waiting;
  check(claim?.message === CLAIM && claim.reason === row?.waitingOnYou?.reason, "the plugin's snapshot has the claim, with the kernel's reason and the agent's message", JSON.stringify(claim));
  await needsYou("real-pi-needs-you", { instance: NAME, soul: SOUL, threadId, projectId, text: CLAIM, choices: [] });
  tell(`Thank you, go on.\n${callOf("bash", { command: "oats instance attention --clear" })}`);
  row = await untilRow(NAME, "no claim, idle", (r) => r.waitingOnYou == null && idleRunning(r) && bbThread(threadId)?.status === "idle", 90);
  check(row !== undefined, "the claim is cleared by the agent, and it is idle", brief(rowOf(NAME)));

  step("P4 a pi extension's dialog asks a question: the bridge's claim, answered on the home's card");
  const QUESTION = "Allow the pi run to continue?";
  before = piRequests().length;
  tell(`One more thing before you go on.\n${callOf("ask_person", { title: QUESTION, question: "The run goes on once you allow it." })}`);
  const dialog = await until("bb to show the dialog as a pending interaction", () => pendingIn(threadId)[0], 90);
  show("bb's pending interaction", dialog);
  row = await untilRow(NAME, "the bridge's claim", (r) => r.waitingOnYou != null, 60);
  check(row?.waitingOnYou?.reason === "question" && row.waitingOnYou.producer === "oats.pi", "oats status: a waiting claim of producer oats.pi, reason question", brief(row));
  show("oats status", brief(row));
  const asked = snapshotAgent(NAME)?.waiting;
  check(asked?.reason === "question", "the plugin's snapshot has the claim, with the kernel's reason", JSON.stringify(asked));
  check(row?.waitingOnYou?.message === QUESTION, "and the claim's text is the dialog's title", JSON.stringify(row?.waitingOnYou));
  // A confirm of pi's has two answers; the plugin's card offers them as bb names them.
  const CHOICES = ["Yes", "No"];
  await needsYou("real-pi-question", { instance: NAME, soul: SOUL, threadId, projectId, text: QUESTION, choices: CHOICES }, async ({ page, at, last }) => {
    if (!last) return;
    // The last view answers it on the home's card, as a person does.
    await page.goto("/plugins/oats/home");
    const card = await page.until(CARD(QUESTION, CHOICES.length), 30);
    await page.evaluate(`[...(${cardOf(QUESTION)})?.querySelectorAll(${q("oats-needs-choice")}) ?? []].find((e) => e.innerText.trim() === "Yes")?.click()`);
    const answered = await until("bb to have no pending interaction for the thread", () => pendingIn(threadId).length === 0, 60);
    check(Boolean(answered), `${at}: "Yes" on the card answers the dialog`, card || JSON.stringify(pendingIn(threadId)));
  });
  if (pendingIn(threadId).length > 0) fail("the dialog is still open: the home's card offered no way to answer it", JSON.stringify(pendingIn(threadId)));
  row = await untilRow(NAME, "no claim, its turn over", (r) => r.waitingOnYou == null && idleRunning(r) && bbThread(threadId)?.status === "idle", 90);
  check(row !== undefined, "oats status: the claim is cleared once the dialog is answered, and the agent is idle", brief(rowOf(NAME)));
  const answer = piRequests().slice(before).find((request) => request.lastRole !== "user" && request.event === "answered");
  check(/the person answered: true/.test(answer?.lastText ?? ""), "the answer reached pi: the model was asked again with the tool's result, the person's Yes", JSON.stringify(answer));
  show("what the tool answered pi", answer?.lastText ?? "nothing");

  step("P4b Restart does not stop what it cannot start: a changed model bb's list for pi does not serve is HELD in the dialog (by bb's list, read by the app; the kernel is asked nothing)");
  // (The wrapper writes a call's record when the call ENDS: a restart sent in P4b would have no record yet at P4b's
  // own end. So what the wrapper recorded is read again after P5's stop, where such a call has ended.)
  const beforeHold = records().length;
  const restartsSinceHold = () => records().slice(beforeHold).filter((record) => record.argv[0] === "session" && record.argv[1] === "restart").map((record) => record.argv.join(" "));
  {
    // Since here, the plugin may ask the kernel for no restart and no stop of this agent (its own `oats status` reads are not counted).
    const before = records().length;
    const asked = () => records().slice(before).filter((record) => (record.argv[0] === "session" && record.argv[1] === "restart") || (record.argv[0] === "instance" && record.argv[1] === "stop")).map((record) => record.argv.join(" "));
    row = rowOf(NAME);
    check(row?.waitingOnYou == null && idleRunning(row) && bbThread(threadId)?.status === "idle", "before: the pi agent runs, idle, with no claim", brief(row));
    const page = await browser.page(VIEWPORTS[0], { theme: "light" });
    try {
      await page.goto(`/plugins/oats/agent/${NAME}`);
      const restart = `document.querySelector(${JSON.stringify(`${testId("oats-agent-acts")} ${testId("oats-agent-act-restart")}`)})`;
      check(Boolean(await page.until(`${restart} !== null && ${restart}.disabled === false`, 60)), "the pi agent's page offers Restart…", await page.evaluate(textOf(testId("oats-agent-page"))));
      await page.evaluate(`${restart}.click()`);
      const ready = `document.querySelector(${q("oats-confirm")})?.getAttribute("data-phase") === "ready"`;
      check(Boolean(await page.until(ready, 60)), "the Restart dialog opens on the kernel's check of the agent");
      const says = `(document.querySelector(${q("oats-start-model")})?.closest(${q("oats-field")})?.querySelector('[role="alert"]')?.innerText ?? "")`;
      const state = `JSON.stringify({ off: document.querySelector(${q("oats-confirm-act")})?.disabled ?? null, field: ${says}, beside: document.querySelector(${q("oats-confirm-blocked")})?.innerText ?? null, why: document.getElementById(document.querySelector(${q("oats-confirm-act")})?.getAttribute("aria-describedby") ?? "")?.innerText ?? "" })`;
      /** Type a model, and wait for what the dialog makes of it once bb's list has answered (never a fixed time). */
      const typed = async (model, armed) => {
        await page.evaluate(fill(testId("oats-start-model"), model));
        const settled = await page.until(armed ? `document.querySelector(${q("oats-confirm-act")})?.disabled === false && ${says} === ""` : `document.querySelector(${q("oats-confirm-act")})?.disabled === true && ${says} === "Not found"`, 30);
        const read = await page.evaluate(state);
        show(`typed ${JSON.stringify(model)}`, read);
        return Boolean(settled);
      };
      // bb lists pi's models as <provider>/<id>, routed by the provider (the mock's: mock/echo, mock/nested/echo2).
      check(await typed("echo", true), "ARMED: `echo`, the bare id of the one listed model mock/echo (so the app's list carries each model's provider: bb's routeProviderId)");
      check(await typed("nested/echo2", true), "ARMED: `nested/echo2`, a bare id that holds a slash (mock/nested/echo2 minus its provider)");
      check(await typed("echo2", false), "HELD, Not found: `echo2`, which a listed id only ENDS in (mock/nested/echo2): pi has no such model, and the provider would refuse it after the stop");
      check(await typed("nosuchmodel", false), "HELD, Not found: `nosuchmodel`, a model pi does not have");
      const held = JSON.parse(await page.evaluate(state));
      check(held.off === true && held.beside === null && held.why === "Not found", "Restart is off, described by the field's mark, with no copy of the word beside it", JSON.stringify(held));
      await page.shot(`real-pi-restart-held-${VIEWPORTS[0].name}`);
      // Pressed all the same.
      await page.evaluate(`document.querySelector(${q("oats-confirm-act")})?.click()`);
      check(Boolean(await page.evaluate(ready)), "pressed all the same, the dialog stays as it was: nothing is confirmed");
      await page.evaluate(`document.querySelector(${q("oats-confirm-cancel")})?.click()`);
      check(Boolean(await page.until(`document.querySelector('[role="dialog"]') === null`, 10)), "Cancel closes the dialog");
    } finally {
      await page.close();
    }
    // What proves that nothing was sent is the page: the button off, and the dialog still "ready" after the press.
    // The wrapper's records agree as far as they can here (a call that has ENDED), and are read again after P5's stop.
    check(asked().length === 0, "the wrapper has recorded NO `oats session restart` and NO `oats instance stop` since the dialog opened (of the calls that have ended)", JSON.stringify(asked()));
    row = rowOf(NAME);
    check(row !== undefined && idleRunning(row) && row.runtimeState !== "stopped" && bbThread(threadId)?.status === "idle" && bbThread(threadId)?.archivedAt == null, "after: the pi agent still runs, on the same thread, not archived", `${brief(row)} ${JSON.stringify({ status: bbThread(threadId)?.status, archivedAt: bbThread(threadId)?.archivedAt ?? null })}`);
  }

  step("P5 the plugin stops and retires the pi agent");
  const stopPlan = act("stop plan", "stopPlan", { instance: NAME });
  // The plan is the kernel's facts (the dialogs word them): this agent, alone, on bb.
  check(stopPlan?.instance === NAME && stopPlan.targets?.length === 1 && stopPlan.targets[0].instance === NAME && stopPlan.targets[0].soul === SOUL && stopPlan.targets[0].backend === "bb", "the stop plan names the pi agent, its soul and bb, and no other agent", JSON.stringify(stopPlan));
  act("stop apply", "stopApply", { instance: NAME, revision: stopPlan?.revision, key: "stop-a1b2c3d4e5f6" });
  row = await untilRow(NAME, "stopped by OATS", (r) => r.running === false && r.runtimeState === "stopped");
  show("oats status", brief(row));
  // (P4b's last word: a restart sent by its press is expected to have ended by now, and would then be recorded.
  // Not certain: this waits for the stop, not for that call, and a call the plugin killed leaves no record. The
  // page is the proof that nothing was sent; this read is a second witness.)
  check(restartsSinceHold().length === 0, "the wrapper recorded NO `oats session restart` between the held Restart dialog and this stop", JSON.stringify(restartsSinceHold()));
  // What the stop left of the pi thread, by provider (../scenario.mjs, stopLeft): archived (a provider that archives at stop), or there and not active.
  const stoppedOn = bbThread(threadId);
  const stopLeft = stoppedOn === undefined ? "gone" : stoppedOn.archivedAt != null ? "archived" : stoppedOn.status === "active" ? "active" : "kept";
  check(stopLeft === "archived" || stopLeft === "kept", `bb: the stopped pi agent's thread is ${stopLeft}: one of the two a stop leaves (archived, or kept and no longer active)`, JSON.stringify(stoppedOn && { id: stoppedOn.id, status: stoppedOn.status, archivedAt: stoppedOn.archivedAt }));
  // A stop ends the thread's pi. One pi can outlive it by about a minute: bb starts a pi of its
  // own in the home to list the thread's models when the thread is opened in bb (the provider's
  // README, "Stopping"), and the kernel refuses a retire while a process works in the home. The
  // run opened the thread for its images, so that pi is usually there: the retire is asked at once,
  // as a person would, and its refusal is kept as the kernel printed it; then the run waits for
  // that pi to leave, says how long, and retires.
  const workingIn = () => execFileSync("sh", ["-c", `for p in /proc/[0-9]*; do [ "$(readlink $p/cwd 2>/dev/null)" = "$1" ] && cat $p/comm; done; true`, "sh", HOME], { encoding: "utf8" }).split("\n").filter(Boolean);
  const stoppedAt = Date.now();
  // Read once: what is printed is what decides.
  const afterStop = workingIn();
  show("working in the home right after the stop", afterStop);
  /** The retire's plan is for the pi agent, by the kernel's facts; shown, as the plan the retire is applied on. */
  const planHolds = (plan) => {
    show("the retire plan", plan);
    check(plan?.instance === NAME && plan.home === HOME && plan.backend === "bb" && plan.session === "none" && plan.children?.length === 0, "the retire plan is for the pi agent: its home, on bb, no session left, no child", JSON.stringify(plan));
  };
  // Whether that pi is there is bb's to decide: with none in the home the step says so, keeps
  // nothing and fails nothing.
  let retired = false;
  if (!afterStop.includes("pi")) {
    note("NO REFUSED RETIRE IN THIS RUN: no pi works in the agent's home right after the stop; nothing is kept");
  } else {
    const EARLY = "retire-1f2e3d4c5b6a";
    const early = rpc("retirePlan", { instance: NAME });
    const asked = early.ok ? rpc("retireApply", { instance: NAME, revision: early.value.revision, key: EARLY }) : early;
    const call = recorded(["retire", NAME], early.ok ? [EARLY] : ["--plan"]);
    let refusal;
    try {
      refusal = JSON.parse(call?.stdout ?? "").error;
    } catch {
      refusal = undefined; // no JSON printed: the lines below say what was
    }
    if (asked.ok) {
      // That pi left between the look and the retire: the retire went through, and it is the run's retire.
      // Its plan is held to the same facts as the later one, and its answer is shown.
      retired = true;
      planHolds(early.value);
      show("the retire's answer", asked.value);
      note("NO REFUSED RETIRE IN THIS RUN: the pi in the agent's home left before the retire was asked, and the retire went through");
    } else {
      check(refusal?.code === "E_RUNTIME_QUIESCE_FAILED" && /\bpi\b/.test(refusal.message), `a retire asked at once is refused by the kernel while that pi works in the home, ${early.ok ? "at the apply" : "at the plan"}, naming it (E_RUNTIME_QUIESCE_FAILED)`, call?.stdout || call?.stderr || asked.message);
      check(refusal !== undefined && asked.message.endsWith(`${refusal.code}: ${refusal.message}`), "and the plugin shows the kernel's refusal unchanged", asked.message);
      show("kernel", refusal === undefined ? "no refusal" : `${refusal.code}: ${refusal.message}`);
      show("plugin", asked.message);
      show("the kernel's call", call && { argv: call.argv, exit: call.exit, stderr: call.stderr });
      if (refusal !== undefined) {
        // The kernel's answer as printed, and the whole of the call beside it (argv, exit code, stdout, stderr).
        evidence.keep("retire-pi-refused.json", call.stdout);
        evidence.keep("retire-pi-refused.call.json", JSON.stringify({ argv: call.argv, exit: call.exit, stdout: call.stdout, stderr: call.stderr }));
      }
      check(rowOf(NAME) !== undefined && existsSync(HOME), "and nothing was removed: the agent's row and its home are there");
    }
  }
  if (!retired) {
    const empty = await until("no process to work in the agent's home", () => workingIn().length === 0, 150);
    check(Boolean(empty), `no process is left working in the agent's home ${Math.round((Date.now() - stoppedAt) / 1000)} s after the stop`, JSON.stringify(workingIn()));
    const retirePlan = rpc("retirePlan", { instance: NAME });
    check(retirePlan.ok, "retire plan (rpc retirePlan)", retirePlan.ok ? "" : retirePlan.message);
    planHolds(retirePlan.ok ? retirePlan.value : undefined);
    act("retire apply", "retireApply", { instance: NAME, revision: retirePlan.ok ? retirePlan.value.revision : undefined, key: "retire-0a1b2c3d4e5f" });
  }
  check(rowOf(NAME) === undefined && !existsSync(HOME), "oats status: no row is left, and the home is removed");
  check(bbThread(threadId)?.archivedAt != null, "bb: the agent's thread is archived", JSON.stringify(bbThread(threadId)));

  check(browser.errors.length === 0, "no uncaught exception in the page", browser.errors.slice(0, 3).join(" | "));
} finally {
  await browser.close();
}

if (existsSync(join(REAL, "mock", "pi-requests.jsonl"))) writeFileSync(join(OUT, "pi-mock-requests.jsonl"), readFileSync(join(REAL, "mock", "pi-requests.jsonl")));

step("the images");
// One state per scene: no two images of the run are the same image.
const same = sameImages(OUT);
for (const names of same) fail(`two scenes produced the same image: ${names.join(" = ")}`);
if (same.length === 0) pass("no two images of the run are the same image");
for (const line of evidence.write()) say(`     answers/${line}`);

if (failures > 0) {
  say(`\n== pi run: ${failures} check(s) failed`);
  process.exit(1);
}
say("\n== pi run: all checks passed");
