// The plain deployment's part of the real run (parts/README.md): spawning from bb on a deployment
// that does NOT have the bb session provider.
//
// workspace.sh makes a second workspace and deployment beside the run's own ($REAL/plain/deploy):
// its capabilities are oats.core alone, so the kernel there knows no capability `oats.bb` and no
// backend `bb`. This part points the plugin at it (the `deployment` setting, which the server
// follows while it runs), and proves on the real kernel what the New agent form does there:
//   - the harness read answers "the provider is absent" (the kernel's E_CAPABILITY_UNKNOWN, kept);
//   - the form offers nothing of bb's (no Harness field, no red sentence, no Retry), and its
//     preview names NO backend, no mode and no harness: the kernel decides, and the column says
//     where the agent will run, once, from the preview's own `backend`;
//   - Spawn makes the agent where the kernel decided (tmux): bb's notice says it was created, and
//     what opens is the agent's own page; its row reads "Running · <soul> · tmux";
//   - the agent is then stopped and retired through the dialogs of its page.
// The kernel's answers are kept as fixtures (test/fixtures/spawn/README.md, "A deployment with no
// bb session provider"). The plugin is pointed back at the run's own deployment at the end, also
// when the part fails: the parts after it read that one.
//
// What an agent on tmux needs of the container is what parts/lost.mjs prepares (tmux, the OATS
// tmux server, Claude Code's first-run answers): this part asks for the same, for its own
// deployment's folder, and takes the server as it finds it (one per user: never ended here).
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { fill, showSidebar, testId, textOf, visible } from "../../browser.mjs";
import { click, dialog, phaseIs } from "../../scenes/lifecycle.mjs";
import { choose } from "../../scenes/spawn.mjs";

const REAL = process.env.REAL ?? "/home/node/real";
const OATS = JSON.parse(readFileSync(join(REAL, "bin", "oats-record.json"), "utf8")).oats;
const PLAIN = join(REAL, "plain", "deploy");
const SOUL = "oats-developer";
const NAME = "plain-tmux-developer";
const CALLED = "Plain tmux developer"; // the instance name as the plugin's words
const KEY = "placeholder-not-a-key";
const q = (id) => JSON.stringify(testId(id));
const clean = (expression) => `(${expression} ?? "").replace(/\\s+/g, " ").trim()`;

export default async (run) => {
  const { step, check, show, note, until, bb, rpc, records, fixtures, views, DEPLOY } = run;
  const sh = (command, args, options = {}) => {
    const done = spawnSync(command, args, { encoding: "utf8", ...options });
    return { exit: done.status, stdout: done.stdout ?? "", stderr: done.stderr ?? "", error: done.error?.message ?? null };
  };
  /** The real `oats`, in the second deployment (the run's own `oats()` is bound to its first). */
  const oats = (...args) => sh(OATS, args, { cwd: PLAIN });
  const rows = () => {
    const answer = oats("status", "--json");
    try {
      return JSON.parse(answer.stdout).agents.flatMap((group) => group.instances ?? []);
    } catch {
      return [];
    }
  };
  const row = () => rows().find((each) => each.instance === NAME);
  const brief = (r) => (r === undefined ? "no row" : JSON.stringify({ backend: r.backend, running: r.running, runtimeState: r.runtimeState ?? null, sessionEnd: r.sessionEnd ?? null, tmux: r.tmux ?? null, session: r.session ?? null }));
  const pane = () => {
    const at = row()?.tmux;
    return at ? sh("tmux", ["-S", at.socket, "capture-pane", "-p", "-t", `${at.session}:${at.window}`]).stdout : "";
  };
  /** The calls the plugin made in the second deployment since `from` (the recorder writes each call's cwd). */
  const mine = (from) => records().slice(from).filter((record) => record.cwd === PLAIN);
  const lastOf = (from, words, having = []) => mine(from).filter((record) => words.every((word, index) => record.argv[index] === word) && having.every((word) => record.argv.includes(word))).at(-1);
  /** The plugin reads the deployment `root`: its snapshot says so. */
  const pointedAt = (root) => until(`the plugin to read ${root}`, () => { const answer = rpc("snapshot"); return answer.ok && answer.value.ok === true && answer.value.deployment.root === root ? answer.value : undefined; }, 60);

  step(`C plain: the container, for one agent on tmux in the second deployment (${NAME})`);
  check(existsSync(join(PLAIN, "oats-local.yaml")), "the second deployment is there (workspace.sh): a directory that holds oats-local.yaml", PLAIN);
  if (sh("tmux", ["-V"]).exit !== 0) {
    check(false, "tmux is in the container (container/Dockerfile): an agent on the tmux backend needs it");
    return;
  }
  // Claude Code's first-run answers, and its trust of this deployment's folder (as parts/lost.mjs for the first).
  const state = join(homedir(), ".claude.json");
  const held = existsSync(state) ? JSON.parse(readFileSync(state, "utf8")) : {};
  const approved = new Set([...(held.customApiKeyResponses?.approved ?? []), KEY.slice(-20)]);
  writeFileSync(`${state}.plain-part`, JSON.stringify({ ...held, hasCompletedOnboarding: true, customApiKeyResponses: { approved: [...approved], rejected: held.customApiKeyResponses?.rejected ?? [] } }, null, 2));
  renameSync(`${state}.plain-part`, state);
  const trust = oats("harness", "trust", "--dir", PLAIN, "--harness", "claude", "--json");
  check(trust.exit === 0 && JSON.parse(trust.stdout).ok === true, "oats harness trust: Claude Code trusts the second deployment's folder", trust.stdout.slice(0, 400) || trust.stderr);
  const session = "oats-agents";
  const there = () => sh("tmux", ["-L", "oats", "has-session", "-t", session]).exit === 0;
  if (!there()) {
    const started = sh("tmux", ["-L", "oats", "new-session", "-d", "-s", session, "-n", "hq", "-x", "160", "-y", "50"], { env: { ...process.env, ANTHROPIC_API_KEY: KEY, DISABLE_AUTOUPDATER: "1" } });
    check(started.exit === 0, `the OATS tmux server is started by hand (tmux -L oats new-session -d -s ${session} -n hq), with this run's PATH and the placeholder key`, started.stderr);
  }
  check(there(), `the OATS tmux server holds the session ${session}`, sh("tmux", ["-L", "oats", "list-sessions"]).stderr);

  step("C plain 1: what the kernel says of this deployment: no capability oats.bb, and its own session backends");
  const shown = oats("capabilities", "show", "oats.bb", "--json");
  let absent = null;
  try {
    absent = JSON.parse(shown.stdout);
  } catch {
    absent = null;
  }
  check(shown.exit !== 0 && absent?.ok === false && absent.error?.code === "E_CAPABILITY_UNKNOWN", "oats capabilities show oats.bb --json: refused, E_CAPABILITY_UNKNOWN: the provider is absent here", (shown.stdout || shown.stderr).slice(0, 400));
  if (absent !== null) fixtures.keep("spawn/capabilities-show-bb-absent.json", shown.stdout);
  const version = oats("version", "--json");
  const probe = version.exit === 0 ? JSON.parse(version.stdout) : {};
  check(Array.isArray(probe.sessionBackends) && probe.sessionBackends.includes("tmux"), "oats version --json lists the kernel's own session backends, tmux among them", JSON.stringify({ sessionBackends: probe.sessionBackends, harnesses: probe.harnesses }));
  show("the kernel's own lists", { sessionBackends: probe.sessionBackends, harnesses: probe.harnesses, launchOptions: probe.launchOptions });

  step("C plain 2: the plugin is pointed at the second deployment (its `deployment` setting, followed while it runs)");
  const from = records().length;
  bb("plugin", "config", "oats", "set", "deployment", PLAIN);
  try {
    const read = await pointedAt(PLAIN);
    check(read !== undefined, "the plugin's snapshot is of the second deployment", JSON.stringify(rpc("snapshot")).slice(0, 300));
    if (read === undefined) return;
    const list = rpc("spawnHarnesses");
    check(list.ok && list.value.provider === false && list.value.harnesses.length === 0, "the plugin's harness read answers that the provider is absent: no harness, `provider: false` (an answer, not a failed read)", JSON.stringify(list.ok ? list.value : list.message));

    step("C plain 3: the New agent form there: nothing of bb's is offered; the preview says where the agent will run; Spawn; the agent's own page");
    let spawnedAt = null;
    await views("real-plain-form", async ({ page, at, viewport, shot }) => {
      await page.goto("/");
      check(await showSidebar(page, viewport), `${at}: the thread list is the OATS sidebar`);
      const button = await page.until(visible(testId("oats-new-agent")), 30);
      check(Boolean(button), `${at}: the sidebar has New agent`, await page.evaluate(textOf(testId("oats-sidebar"))));
      await page.evaluate(`document.querySelector(${q("oats-new-agent")})?.click()`);
      const ready = await page.until(`${visible(testId("oats-spawn-form"))} && document.querySelector(${q("oats-spawn-soul")})?.disabled === false && location.pathname`, 30);
      check(ready === "/plugins/oats/new-agent", `${at}: New agent opens the form, with the souls read`, String(ready));
      check(await page.evaluate(choose("oats-spawn-soul", SOUL)), `${at}: the soul ${SOUL} is chosen`, await page.evaluate(textOf(testId("oats-spawn-form"))));
      const name = spawnedAt === null ? NAME : `${NAME}-${viewport.name}`;
      await page.evaluate(fill(testId("oats-spawn-name"), name));
      const FORM = `(() => { const form = document.querySelector(${q("oats-new-agent-page")}); const column = document.querySelector(${q("oats-spawn-preview")}); const facts = [...(column?.querySelectorAll('[data-testid="oats-fact"]') ?? [])].filter((fact) => fact.closest("details") === null).map((fact) => [${clean('fact.querySelector("dt")?.innerText')}, ${clean('fact.querySelector("dd")?.innerText')}]); const submit = document.querySelector(${q("oats-spawn-submit")}); return JSON.stringify({ name: facts.find(([label]) => label === "Name")?.[1] ?? null, runsIn: facts.filter(([label]) => label === "Runs in").map(([, value]) => value), harness: facts.find(([label]) => label === "Harness")?.[1] ?? null, access: facts.find(([label]) => label === "Access")?.[1] ?? null, updating: column?.querySelector(${q("oats-spawn-updating")}) !== null, harnessField: document.querySelector(${q("oats-spawn-harness")}) !== null, retry: document.querySelector(${q("oats-spawn-harness-retry")}) !== null, alert: form?.querySelector('[role="alert"]') !== null, text: ${clean("form?.innerText")}, off: submit?.disabled ?? null }); })()`;
      const read = await page.until(`(() => { const now = JSON.parse(${FORM}); return now.name === ${JSON.stringify(name)} && !now.updating && now.off === false ? JSON.stringify(now) : ""; })()`, 60);
      const drawn = read ? JSON.parse(read) : JSON.parse(await page.evaluate(FORM));
      check(Boolean(read), `${at}: the kernel's preview is read for the values on screen, and Spawn is armed by a soul and a name alone`, JSON.stringify(drawn));
      check(drawn.harnessField === false && drawn.retry === false && drawn.alert === false && !/Harnesses could not be read|bb is not set up|bb’s default|not installed in bb/.test(drawn.text), `${at}: nothing of bb's is offered and nothing is said to have failed: no Harness field, no Retry, no red sentence`, JSON.stringify({ harnessField: drawn.harnessField, retry: drawn.retry, alert: drawn.alert }));
      check(JSON.stringify(drawn.runsIn) === JSON.stringify(["tmux session"]) && drawn.text.split("tmux session").length === 2 && !/bb thread/.test(drawn.text), `${at}: the column says where it will run, once, in view: "Runs in / tmux session" (from the preview's own backend); never "bb thread"`, JSON.stringify({ runsIn: drawn.runsIn, harness: drawn.harness, access: drawn.access }));
      show("what will be created", { name: drawn.name, harness: drawn.harness, runsIn: drawn.runsIn, access: drawn.access });
      await page.evaluate(`document.querySelector(${q("oats-spawn-submit")}).scrollIntoView({ block: "center" })`);
      await shot("preview");
      if (spawnedAt !== null) return;
      // Spawn, once, in the first view: bb's notice, and the new agent's OWN PAGE (it has no thread in bb).
      spawnedAt = at;
      await page.evaluate(`document.querySelector(${q("oats-spawn-submit")}).click()`);
      const opened = await page.until(`location.pathname.endsWith(${JSON.stringify(`/plugins/oats/agent/${NAME}`)}) ? location.pathname : ""`, 180);
      check(Boolean(opened), `${at}: Spawn created the agent and opened its own page`, opened ?? (await page.evaluate(`location.pathname + " " + ${clean("document.body.innerText")}.slice(0, 400)`)));
      const CREATED = `Created ${CALLED}.`;
      const next = await page.until(`document.body.innerText.includes(${JSON.stringify(CREATED)}) && document.querySelector('[data-testid="oats-agent-page"]') !== null ? ${JSON.stringify(CREATED)} : ""`, 30);
      check(next === CREATED, `${at}: and bb's notice says "${CREATED}" over it`, next ?? (await page.evaluate(`${clean("document.body.innerText")}.slice(0, 400)`)));
      await shot("created");
    });

    step("C plain 4: what the plugin asked the kernel, and what the kernel answered (kept as fixtures)");
    const preview = lastOf(from, ["spawn", SOUL], ["--preview", NAME]);
    const applied = lastOf(from, ["spawn", SOUL], ["--idempotency-key", NAME]);
    for (const [what, call] of [["preview", preview], ["spawn", applied]]) {
      check(call !== undefined && ["--backend", "--yolo", "--harness", "--model"].every((flag) => !call.argv.includes(flag)), `the form's ${what} named NO backend, no mode, no harness and no model: the kernel decided`, JSON.stringify(call?.argv ?? "no such call"));
    }
    const previewed = preview === undefined ? null : JSON.parse(preview.stdout);
    check(previewed?.ok === true && previewed.result.backend === "tmux", 'the kernel\'s preview says where it decided to run it: `backend: "tmux"`', JSON.stringify(previewed?.ok ? { backend: previewed.result.backend, backendStatus: previewed.result.backendStatus, harness: previewed.result.harness, model: previewed.result.model, yolo: previewed.result.decision?.effective?.yolo } : previewed));
    if (preview !== undefined) fixtures.keep("spawn/spawn-preview-no-provider.json", preview.stdout);
    const spawned = applied === undefined ? null : JSON.parse(applied.stdout);
    check(spawned?.ok === true && spawned.result.launched === true && spawned.result.backend === "tmux" && spawned.result.tmux?.window === NAME, "the kernel spawned and launched it, in a window of the OATS tmux server; its answer names no bb thread", JSON.stringify(spawned?.ok ? { launched: spawned.result.launched, backend: spawned.result.backend, tmux: spawned.result.tmux, session: spawned.result.session ?? null, attach: spawned.result.attach } : spawned));
    if (applied !== undefined) fixtures.keep("spawn/spawn-no-provider.json", applied.stdout);
    const running = await until(`${NAME} to run on tmux in the second deployment's oats status`, () => (row()?.running === true ? row() : undefined), 90);
    check(running?.backend === "tmux" && running.running === true, "oats status there: the agent, on tmux, running", brief(row()));
    if (running !== undefined) fixtures.keep("spawn/status-row-no-provider.json", JSON.stringify(running));
    const answered = await until(`${NAME}'s pane to hold the mock model's answer`, () => (/MOCK-REPLY/.test(pane()) ? pane() : undefined), 120);
    check(Boolean(answered), "the agent took a turn on the mock model in its tmux window", pane().replace(/\s+/g, " ").trim().slice(-300));

    step("C plain 5: the new agent in the sidebar and on its page: Running, on tmux");
    const ROW = `[data-testid="oats-agent-row-threadless"][data-instance="${NAME}"]`;
    const PAGE = '[data-testid="oats-agent-page"]';
    const WANT = `Running · ${SOUL} · tmux`;
    await views("real-plain-agent", async ({ page, at, viewport, shot }) => {
      rpc("refresh");
      await page.goto("/");
      await showSidebar(page, viewport);
      const facts = await page.until(`(() => { const facts = document.querySelector(${JSON.stringify(ROW)})?.querySelector('[data-testid="oats-row-facts"]')?.getAttribute("title") ?? ""; return facts.startsWith("Running") ? facts : ""; })()`, 60);
      check(facts === WANT, `${at}: the new agent's row in the sidebar: "${WANT}"`, facts ?? (await page.evaluate(`${clean(`document.querySelector(${JSON.stringify(ROW)})?.innerText`)} || ${clean("document.body.innerText")}.slice(0, 300)`)));
      await shot("row");
      await page.goto(`/plugins/oats/agent/${NAME}`);
      const said = await page.until(`(() => { const p = document.querySelector(${JSON.stringify(PAGE)}); const s = p?.querySelector('[data-testid="oats-panel-state"]'); if (!p || !s || !${clean("s.innerText")}.includes("Running")) return ""; return JSON.stringify({ name: ${clean(`p.querySelector('[data-testid="oats-panel-name"]')?.innerText`)}, state: ${clean("s.innerText")}, acts: [...p.querySelectorAll('[data-testid="oats-agent-acts"] button')].map((b) => b.innerText.trim()) }); })()`, 60);
      check(said === JSON.stringify({ name: CALLED, state: "Running", acts: ["Stop…", "Restart…", "Retire…"] }), `${at}: its own page: "${CALLED}", Running, with Stop…, Restart… and Retire…`, said ?? (await page.evaluate(`${clean(`document.querySelector(${JSON.stringify(PAGE)})?.innerText`)}.slice(0, 400)`)));
      await shot("page");
    });

    step("C plain 6: it is stopped, then retired, through the dialogs of its page");
    let done = false;
    await views("real-plain-end", async ({ page, at, shot }) => {
      if (done) return;
      done = true;
      for (const [verb, word, after] of [["stop", "Stop", (r) => r !== undefined && r.running === false], ["retire", "Retire", (r) => r === undefined]]) {
        await page.goto(`/plugins/oats/agent/${NAME}`);
        const offered = await page.until(`document.querySelector('[data-testid="oats-agent-act-${verb}"]') !== null && !document.querySelector('[data-testid="oats-agent-act-${verb}"]').disabled`, 60);
        check(Boolean(offered), `${at} ${verb}: the agent's page offers it`, await page.evaluate(`${clean(`document.querySelector(${JSON.stringify(PAGE)})?.innerText`)}.slice(0, 300)`));
        await page.evaluate(click(`oats-agent-act-${verb}`));
        await page.until(phaseIs("ready"), 60);
        const said = await dialog(page);
        check(said.title.startsWith(word) && said.title.includes(CALLED) && said.about === NAME, `${at} ${verb}: the dialog is the ${word} of ${CALLED} ("${said.title}")`, JSON.stringify({ title: said.title, about: said.about }));
        await page.evaluate(click("oats-confirm-act"));
        const ended = await page.until(phaseIs("done"), 180);
        check(Boolean(ended), `${at} ${verb}: the act ran to its result`, JSON.stringify(await dialog(page)).slice(0, 400));
        await shot(`${verb}-done`);
        const then = await until(`${NAME} to be ${verb === "stop" ? "stopped" : "gone"} in the second deployment's oats status`, () => (after(row()) ? true : undefined), 120);
        check(then === true, `oats status there after the ${verb}: ${verb === "stop" ? "the agent does not run" : "no such agent"}`, brief(row()));
      }
    });
  } finally {
    // The run's own deployment again, for the parts after this one: also when something above failed.
    bb("plugin", "config", "oats", "set", "deployment", DEPLOY);
    const back = await pointedAt(DEPLOY);
    check(back !== undefined, "the plugin reads the run's own deployment again", JSON.stringify(rpc("snapshot")).slice(0, 300));
    if (row() !== undefined) note(`LEFT BEHIND in the second deployment: ${NAME} (${brief(row())}): the container is thrown away`);
  }
};
