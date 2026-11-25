// The lost session's part of the real run (parts/README.md): ONE agent on the TMUX backend, on the
// real kernel, taken through the three states a person meets on a deployment of tmux agents
// (running, stopped with OATS, and LOST: its tmux window gone, as after a crash or a reboot), with
// what the plugin shows and offers in each, and the three acts that bring such an agent back:
// RESTART a running one, START one stopped with OATS, RESUME a lost one. The kernel's answers for
// them are kept as fixtures (test/fixtures/lifecycle/README.md, "An agent on tmux").
//
// Every other agent of the run is on bb. This one is spawned on the command line (`oats spawn
// --backend tmux`: the plugin's own spawn is always a bb thread) and runs Claude Code on the run's
// mock model in a window of the OATS tmux server. What that needs of the container, beside what
// setup.sh gives the bb agents, is prepared here and said in the log (`prepare`):
//   - tmux (the image's: container/Dockerfile);
//   - the OATS tmux server, started by hand as the kernel's docs say for a shell whose PATH the
//     panes need (docs/execution-targets.md: `tmux -L oats new-session -d -s <session> -n hq`): a
//     pane's environment is its tmux server's, and the kernel's own server would not find `claude`
//     (it is in npm's prefix, which only this process's PATH holds; the spawn is then refused,
//     E_HARNESS_UNAVAILABLE) nor carry the placeholder key;
//   - Claude Code's folder trust for the deployment (`oats harness trust`, the kernel's command);
//   - Claude Code's first-run screens answered in its own state file (the theme chooser, the
//     question whether to use the API key in the environment): nothing answers them in a pane.
//
// The session is LOST as a crash loses it: its tmux window is killed (never `oats instance stop`);
// the kernel then prints `running: false` and `sessionEnd: "lost"` for the row, with no
// `runtimeState`. An OATS stop, by contrast, leaves the window at a shell: `runtimeState: "shell"`
// with `sessionEnd: "stopped"`.
//
// WHAT IT ASSERTS, in every view (bb's light and dark themes, at each width):
//   the words  the row's sessionEnd decides how a tmux agent that does not run is said. Stopped with
//              OATS: "Stopped · <soul> · tmux". LOST: the ROW draws "Lost · <soul> · tmux" (the
//              kernel's own word in the state's place, and no reason after it: the text cut's L17),
//              its title says "Stopped · <soul> · session lost · tmux", and its page says
//              "Stopped · session lost" on its header's state line: no sentence under it, no
//              "Last started";
//   the acts   each goes through its dialog, from the agent's page, with the result read: what
//              happened, where the agent runs, and for a resume what the kernel's `resume` said.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { showSidebar } from "../../browser.mjs";
import { click, closed, dialog, phaseIs } from "../../scenes/lifecycle.mjs";

const NAME = "lost-tmux-developer";
const SOUL = "oats-developer";
const CALLED = "Lost tmux developer"; // the instance name as the plugin's words (app/ui/words.ts `agentName`)
/** The placeholder the run's bb server has too (setup.sh): the mock model asks for no credential, Claude Code for one. */
const KEY = "placeholder-not-a-key";

/** What the plugin says and offers per state. */
const EXPECTED = {
  // Where the row has a sessionEnd, IT decides (plugin/README.md, "A provider home's row, case by
  // case"): "stopped" is "Stopped · <soul> · tmux" whatever runtimeState says (an OATS stop leaves
  // the window at a shell), and offers Start… alone. "lost": the row's TITLE (`row`: what it says
  // whole) is "Stopped · <soul> · session lost · tmux", and what it DRAWS in the state's place
  // (`drawn`) is "Lost": the kernel's own word, with no reason after it (the text cut's L17).
  running: { acts: ["Stop…", "Restart…", "Retire…"], words: ["Working", "Idle"], row: `Working · ${SOUL} · tmux`, drawn: ["Working", "Idle"] },
  stopped: { acts: ["Start…", "Retire…"], words: ["Stopped"], row: `Stopped · ${SOUL} · tmux`, drawn: ["Stopped"] },
  lost: { acts: ["Start…", "Retire…"], words: ["Stopped"], row: `Stopped · ${SOUL} · session lost · tmux`, drawn: ["Lost"] },
};
/**
 * The lost tmux agent's page: its header's state line, whole (the reason on the line, as on its row's title); and what
 * the page no longer says (the text cut). ("Last started <age>" is not among them: it is the Session card's own
 * labelled fact for an agent that does not run, where the row names a start; what went is the line of that name
 * under the header: `lastStarted`, below.)
 */
const LOST_LINE = /^Stopped\s*·\s*session lost$/;
const LOST_NEVER = /Nobody stopped|without OATS stopping|Start tries/;
/** The dialogs' ONE consequence line each, and the results' words (app/lifecycle/words.ts START, RESUME; the text cut). */
const SAYS = {
  start: "Starts a new conversation.",
  restart: "Stops what it is doing now.",
  resume: "Tries to continue its last conversation; else starts fresh.",
  /** Not said before the press any more: it is said when it happens (`waiting`). */
  resumeClaude: "Claude may first ask",
  started: `${CALLED} started.`,
  restarted: `${CALLED} restarted.`,
  resumed: `${CALLED} is back in its last conversation.`,
  fresh: `${CALLED} started fresh.`,
  where: /^Attach:/,
  waiting: "Waiting for you in its terminal.",
};

export default async (run) => {
  const { step, check, show, note, until, oats, rowOf, rpc, act, recorded, fixtures, views, DEPLOY, OUT } = run;
  const home = join(DEPLOY, "agents", SOUL, "instances", NAME);

  // ---- the container, for an agent on tmux
  const sh = (command, args, options = {}) => {
    const done = spawnSync(command, args, { encoding: "utf8", ...options });
    return { exit: done.status, stdout: done.stdout ?? "", stderr: done.stderr ?? "", error: done.error?.message ?? null };
  };
  const prepare = () => {
    const version = sh("tmux", ["-V"]);
    check(version.exit === 0, "tmux is in the container (container/Dockerfile): an agent on the tmux backend needs it", version.error ?? version.stderr);
    if (version.exit !== 0) return false;
    show("tmux", version.stdout.trim());
    // Claude Code's own first-run screens, answered where it keeps its answers: with neither, a
    // pane stops at the theme chooser, then at "use this API key?", and nothing presses a key there.
    const state = join(homedir(), ".claude.json");
    const held = existsSync(state) ? JSON.parse(readFileSync(state, "utf8")) : {};
    const approved = new Set([...(held.customApiKeyResponses?.approved ?? []), KEY.slice(-20)]);
    writeFileSync(`${state}.lost-part`, JSON.stringify({ ...held, hasCompletedOnboarding: true, customApiKeyResponses: { approved: [...approved], rejected: held.customApiKeyResponses?.rejected ?? [] } }, null, 2));
    renameSync(`${state}.lost-part`, state);
    // The folder trust, by the kernel's own command (docs/harness-trust.md): it writes one leaf of that file.
    const trust = oats("harness", "trust", "--dir", DEPLOY, "--harness", "claude", "--json");
    check(trust.exit === 0 && JSON.parse(trust.stdout).ok === true, "oats harness trust: Claude Code trusts the deployment's folder", trust.stdout.slice(0, 400) || trust.stderr);
    // The OATS tmux server (the kernel's socket name, `-L oats`), with this process's PATH (where
    // `claude` is) and the placeholder key: a pane's environment is its server's. No update of
    // Claude Code under the run's pin.
    const session = "oats-agents";
    const there = () => sh("tmux", ["-L", "oats", "has-session", "-t", session]).exit === 0;
    if (!there()) {
      const started = sh("tmux", ["-L", "oats", "new-session", "-d", "-s", session, "-n", "hq", "-x", "160", "-y", "50"], { env: { ...process.env, ANTHROPIC_API_KEY: KEY, DISABLE_AUTOUPDATER: "1" } });
      check(started.exit === 0, `the OATS tmux server is started by hand, as the kernel's docs say (tmux -L oats new-session -d -s ${session} -n hq), with this run's PATH and the placeholder key`, started.stderr);
    }
    const up = there();
    check(up, `the OATS tmux server holds the session ${session}`, sh("tmux", ["-L", "oats", "list-sessions"]).stderr);
    return up;
  };

  // ---- the kernel's row, and the pane
  const row = () => rowOf(NAME);
  /** The fields of the row a lost session is read from, for the log. */
  const brief = (r) => (r === undefined ? "no row" : JSON.stringify({ backend: r.backend, running: r.running, runtimeState: r.runtimeState ?? null, sessionEnd: r.sessionEnd ?? null, tmux: r.tmux ?? null, startedAt: r.startedAt ?? null }));
  const untilRow = (what, matches, seconds = 90) => until(`${NAME} ${what} in oats status`, () => (matches(row() ?? {}) ? row() : undefined), seconds);
  const pane = () => {
    const at = row()?.tmux;
    return at ? sh("tmux", ["-S", at.socket, "capture-pane", "-p", "-t", `${at.session}:${at.window}`]).stdout : "";
  };
  /** The agent runs and has taken a turn: the kernel says it runs, and its pane holds the mock model's answer. */
  const turned = async (what) => {
    const running = await untilRow(`to run (${what})`, (r) => r.running === true);
    const answered = await until(`${NAME}'s pane to hold the mock model's answer (${what})`, () => (/MOCK-REPLY/.test(pane()) ? pane() : undefined), 120);
    check(running?.running === true && Boolean(answered), `${what}: the agent runs in its tmux window and took a turn on the mock model`, `${brief(row())} | pane: ${pane().replace(/\s+/g, " ").trim().slice(-300)}`);
    return row();
  };
  /** Its session is lost as a crash loses it: the window is killed; nothing is asked of OATS. */
  const lose = async (what) => {
    const at = row().tmux;
    const killed = sh("tmux", ["-S", at.socket, "kill-window", "-t", `${at.session}:${at.window}`]);
    check(killed.exit === 0, `${what}: its tmux window is killed (tmux kill-window -t ${at.session}:${at.window}), as a crash would end it: OATS is told nothing`, killed.stderr);
    const lost = await untilRow("to read lost", (r) => r.running === false && r.sessionEnd === "lost");
    check(lost?.running === false && lost.sessionEnd === "lost" && (lost.runtimeState ?? null) === null, `${what}: oats status says running false, sessionEnd "lost", and no runtimeState`, brief(row()));
    show("oats status", brief(row()));
    return lost;
  };
  /** Stopped with OATS, by the plugin's own Stop (its plan, then its apply). */
  const stop = async (key) => {
    const plan = act(`stop plan of ${NAME}`, "stopPlan", { instance: NAME });
    check(plan?.targets?.[0]?.instance === NAME && plan.targets[0].backend === "tmux", "the kernel's stop plan names the agent, on tmux", JSON.stringify(plan?.targets));
    act(`stop apply of ${NAME}`, "stopApply", { instance: NAME, revision: plan?.revision, key });
    const stopped = await untilRow("to read stopped by OATS", (r) => r.running === false && r.sessionEnd === "stopped");
    check(stopped?.sessionEnd === "stopped" && stopped.runtimeState === "shell", 'oats status: running false, sessionEnd "stopped", runtimeState "shell" (the stop leaves its window at a shell)', brief(row()));
    show("oats status", brief(row()));
  };
  /** One row of `oats status --json`, as printed, for a fixture. */
  const keepRow = (file) => fixtures.keep(file, JSON.stringify(row()));
  /** A command of the kernel's made on the command line, its answer kept as printed. */
  const cli = (file, ...argv) => {
    const done = oats(...argv);
    show(`oats ${argv.join(" ")}`, `exit ${done.exit}`);
    let answer;
    try {
      answer = JSON.parse(done.stdout);
    } catch {
      answer = undefined;
    }
    check(answer !== undefined, `oats ${argv.slice(0, 3).join(" ")} … answered JSON`, done.stdout.slice(0, 300) || done.stderr.slice(0, 300));
    if (answer !== undefined && file !== null) fixtures.keep(file, done.stdout);
    return { exit: done.exit, answer };
  };
  /** The two refusals of `--resume` on a home that is not lost, each recorded once. */
  const resumeWhileRunning = () => {
    const refused = cli("lifecycle/tmux-resume-running.json", "session", "start", "--resume", "--home", home, "--json");
    check(refused.answer?.ok === false && refused.answer.error?.code === "E_SESSION_RUNNING", "oats session start --resume on a home that RUNS is refused: E_SESSION_RUNNING", JSON.stringify(refused.answer?.error ?? refused.answer).slice(0, 400));
    check(row()?.running === true, "and the agent goes on running", brief(row()));
  };
  const resumeWhileStopped = () => {
    const refused = cli("lifecycle/tmux-resume-not-lost.json", "session", "start", "--resume", "--home", home, "--json");
    check(refused.answer?.ok === false && refused.answer.error?.code === "E_RESUME_NOT_LOST", "oats session start --resume on a home that is NOT lost (stopped with OATS) is refused: E_RESUME_NOT_LOST", JSON.stringify(refused.answer?.error ?? refused.answer).slice(0, 400));
    check(row()?.running === false && row()?.sessionEnd === "stopped", "and the agent stays stopped", brief(row()));
  };

  // ---- what the plugin shows: the row in the sidebar, and the agent's page with its acts
  const ROW = `[data-testid="oats-agent-row-threadless"][data-instance="${NAME}"]`;
  const PAGE = '[data-testid="oats-agent-page"]';
  const clean = (expression) => `(${expression} ?? "").replace(/\\s+/g, " ").trim()`;
  /** The agent's page once it shows a state among `words` (a wait on the state it asserts) → what it says and offers. */
  const pageSays = (words) =>
    `(() => { const p = document.querySelector(${JSON.stringify(PAGE)}); const s = p?.querySelector('[data-testid="oats-panel-state"]'); if (!p || !s) return ""; const state = ${clean("s.innerText")}; if (!${JSON.stringify(words)}.some((word) => state.includes(word))) return ""; return JSON.stringify({ name: ${clean(`p.querySelector('[data-testid="oats-panel-name"]')?.innerText`)}, state, acts: [...p.querySelectorAll('[data-testid="oats-agent-acts"] button')].map((b) => b.innerText.trim()), kind: s.getAttribute("data-outside"), block: p.querySelector('[data-testid="oats-outside-agent-block"]') !== null, lastStarted: p.querySelector('[data-testid="oats-outside-last-started"]') !== null, whole: ${clean("p.innerText")} }); })()`;
  const pageNow = `(() => { const p = document.querySelector(${JSON.stringify(PAGE)}); return p ? ${clean("p.innerText")}.slice(0, 600) : ${clean("document.body.innerText")}.slice(0, 300); })()`;
  /** The agent's row in the sidebar, once its state is one of `words` → its facts, whole (the row's own title: state · soul or reason · where). */
  const rowSays = (words) => `(() => { const facts = document.querySelector(${JSON.stringify(ROW)})?.querySelector('[data-testid="oats-row-facts"]')?.getAttribute("title") ?? ""; return ${JSON.stringify(words)}.some((word) => facts.startsWith(word)) ? facts : ""; })()`;
  /**
   * In one view: the row in the sidebar and the agent's own page, for the state the kernel's row is
   * in, with their images; the words and the acts are the ones of EXPECTED.
   * → { at, row, name, state, acts }
   */
  const look = async ({ page, at, viewport, shot }, state) => {
    const { words, acts, row: rowWords, drawn } = EXPECTED[state];
    rpc("refresh");
    await page.goto("/");
    await showSidebar(page, viewport);
    const inRow = await page.until(rowSays(words), 60);
    check(inRow === rowWords, `${at} the ${state} tmux agent's row in the sidebar, among the agents with no bb thread: "${rowWords}"`, inRow ?? (await page.evaluate(`${clean(`document.querySelector(${JSON.stringify(ROW)})?.innerText ?? document.querySelector('[data-testid="oats-sidebar"]')?.innerText`)}.slice(0, 400)`)));
    // What the row DRAWS in the state's place (its title, above, says all of it).
    const word = (await page.until(`(() => { const word = ${clean(`document.querySelector(${JSON.stringify(ROW)})?.querySelector('[data-phrase="state"]')?.innerText`)}; return ${JSON.stringify(drawn)}.includes(word) ? word : ""; })()`, 10)) ?? (await page.evaluate(`${clean(`document.querySelector(${JSON.stringify(ROW)})?.querySelector('[data-phrase="state"]')?.innerText`)}`));
    check(drawn.includes(word), `${at} and it draws ${drawn.map((each) => `"${each}"`).join(" or ")} in the state's place`, String(word));
    await shot(`${state}-row`);
    await page.goto(`/plugins/oats/agent/${NAME}`);
    const said = await page.until(pageSays(words), 60);
    const read = said ? JSON.parse(said) : null;
    check(read !== null && read.name === CALLED, `${at} the agent's own page opens for it and says its state`, said ?? (await page.evaluate(pageNow)));
    check(JSON.stringify(read?.acts) === JSON.stringify(acts), `${at} the page offers ${acts.join(" and ")}`, JSON.stringify(read?.acts));
    if (state === "lost") check(read?.kind === "lost-tmux" && LOST_LINE.test(read.state) && read.block === false && read.lastStarted === false && !LOST_NEVER.test(read.whole), `${at} the lost agent's page says "Stopped · session lost" on its header's state line, and nothing of it under the tabs: no sentence, and no "Last started" line of its own (when it started is the Session card's fact)`, JSON.stringify(read));
    if (state === "stopped") check(read?.state === "Stopped" && read.block === false, `${at} the page of an agent stopped with OATS says nothing more than "Stopped": no block of what happened outside OATS`, JSON.stringify(read));
    await shot(`${state}-page`);
    return { at, row: inRow ?? null, ...read };
  };

  // =============================================================================================
  step(`C lost: the container, for one agent on the tmux backend (${NAME})`);
  if (!prepare()) {
    note("NO TMUX AGENT IN THIS RUN: the container could not hold one (above); nothing of a lost session was proven");
    return;
  }
  const file = join(OUT, `task-${NAME}.md`);
  writeFileSync(file, "Say hello, then wait.\n");
  const made = oats("spawn", SOUL, "--backend", "tmux", "--name", NAME, "--task-file", file, "--json");
  const spawned = made.exit === 0 ? JSON.parse(made.stdout).result : null;
  check(spawned?.launched === true && spawned.tmux?.window === NAME, `oats spawn ${SOUL} --backend tmux --name ${NAME}: launched, in a window of the OATS tmux server`, made.stdout.slice(0, 600) || made.stderr.slice(0, 600));
  show("the kernel's answer", spawned === null ? made.stderr : { launched: spawned.launched, tmux: spawned.tmux, attach: spawned.attach, launchPrompts: spawned.launchPrompts, warnings: spawned.warnings });
  if (spawned?.launched !== true) {
    note(`NO TMUX AGENT IN THIS RUN: the kernel did not launch ${NAME} on tmux (above); nothing of a lost session was proven`);
    return;
  }
  await turned("spawned");
  show("oats status", brief(row()));

  await throughTheDialogs();

  step(`C lost, the end: ${NAME} is retired`);
  const gone = oats("retire", NAME, "--json");
  check(gone.exit === 0, `oats retire ${NAME}`, gone.stdout.slice(0, 400) || gone.stderr.slice(0, 400));
  check((await until(`${NAME} to be gone from oats status`, () => (row() === undefined ? true : undefined))) === true, `oats status has no ${NAME} any more`, brief(row()));

  // =============================================================================================
  // In each view (bb's light and dark themes, at each width) the agent goes round once:
  // it runs (RESTART, through its dialog), it is stopped with OATS (START), it is lost (its Start
  // RESUMES), and runs again for the next view. The kernel's rows and answers are kept from the
  // first round.
  async function throughTheDialogs() {
    let round = 0;
    await views("real-tmux", async (view) => {
      const { page, at, shot } = view;
      round += 1;
      const first = round === 1;
      /** One act through its dialog, from the agent's own page → what the dialog said before the press, and its result. */
      const through = async (verb, name, title, before, never = []) => {
        await page.goto(`/plugins/oats/agent/${NAME}`);
        const offered = await page.until(`document.querySelector('[data-testid="oats-agent-act-${verb}"]') !== null && !document.querySelector('[data-testid="oats-agent-act-${verb}"]').disabled`, 60);
        check(Boolean(offered), `${at} ${name}: the agent's page offers ${verb === "start" ? "Start…" : "Restart…"}`, await page.evaluate(pageNow));
        await page.evaluate(click(`oats-agent-act-${verb}`));
        await page.until(phaseIs("ready"), 60);
        const said = await dialog(page);
        check(said.title === title && said.about === NAME && before.every((sentence) => said.body.includes(sentence)) && never.every((sentence) => !said.body.includes(sentence)), `${at} ${name}: the dialog is "${title}", for ${NAME}, and says before the press: ${before.join(" ")}`, JSON.stringify(said));
        await shot(`${name}-before`);
        await page.evaluate(click("oats-confirm-act"));
        await page.until(phaseIs("done"), 180);
        const result = JSON.parse(
          await page.evaluate(
            `(() => { const r = document.querySelector('[data-testid="oats-modal"] [data-testid="oats-result"]'); return JSON.stringify({ tone: r?.getAttribute("data-tone") ?? null, title: ${clean(`r?.querySelector("h3")?.innerText`)}, where: ${clean(`document.querySelector('[data-testid="oats-start-where"]')?.innerText`)}, waiting: ${clean(`document.querySelector('[data-testid="oats-start-waiting"] h3')?.innerText`)}, body: ${clean(`document.querySelector('[data-testid="oats-modal"]')?.innerText`)} }); })()`,
          ),
        );
        // Where it runs, under every result of an agent on tmux: the machine, and the command that attaches to its home.
        check(SAYS.where.test(result.where) && result.where.includes(`oats session attach --home ${home}`), `${at} ${name}: the result says how to reach it: "Attach:" and the command that attaches to its home`, JSON.stringify(result));
        // BEHIND THE RESULT (the text cut's L13): the page's header never says the state from before the act plainly: it
        // says "Reading…" until the roster is read again, and then what the roster says.
        const behind = await page.evaluate(`(() => { const s = document.querySelector(${JSON.stringify(`${PAGE} [data-testid="oats-panel-state"]`)}); return JSON.stringify({ reading: s?.querySelector('[data-testid="oats-reading"]') !== null, state: ${clean("s?.innerText")} }); })()`);
        // (Asserted for a START: before it the state is "Stopped", which must not stand behind "… started.". A restart's
        // state is the same word before and after, so the header's words prove nothing there, and nothing is claimed of it.)
        if (verb === "start") check(result.tone === "failed" || JSON.parse(behind).reading === true || !/^Stopped/.test(JSON.parse(behind).state), `${at} ${name}: behind a start's result the page's header says "Reading…", or already what the roster says now: never "Stopped" from before the act`, behind);
        await shot(`${name}-done`);
        await page.evaluate(click("oats-confirm-close"));
        check(Boolean(await page.until(closed, 10)), `${at} ${name}: Close closes the dialog`);
        return result;
      };
      /** The plugin's last call of `oats session <verb>` for the home, made in this round. */
      const asked = (verb, since) => {
        const call = recorded(["session", verb, "--home", home]);
        check(Date.parse(call.at) >= since, `${at} the plugin asked the kernel: oats session ${verb} --home <home>`, JSON.stringify([call.at, call.argv]));
        return { argv: call.argv, stdout: call.stdout, result: JSON.parse(call.stdout).result };
      };
      const NO_CHOICE = ["--launch-config", "--harness", "--model", "--yolo", "--no-yolo", "--reselect-launch"];

      // ---- it runs: RESTART
      step(`C lost, at ${at}: RESTART a running tmux agent, through its dialog`);
      await untilRow("to run", (r) => r.running === true);
      if (first) keepRow("lifecycle/tmux-row-running.json");
      await look(view, "running");
      if (first) resumeWhileRunning();
      let since = Date.now();
      const before = row().startedAt;
      let result = await through("restart", "restart", `Restart ${CALLED}`, [SAYS.restart], [SAYS.start, SAYS.resume]);
      let call = asked("restart", since);
      if (first) fixtures.keep("lifecycle/tmux-restart.json", call.stdout);
      check(result.tone === "done" && result.title === SAYS.restarted, `${at} the result says it restarted: "${SAYS.restarted}"`, JSON.stringify(result));
      check(Boolean(await untilRow("to be started anew", (r) => r.running === true && r.startedAt !== before)), "oats status: running, with a new start", brief(row()));
      await turned("restarted through the dialog");

      // ---- stopped with OATS: START
      step(`C lost, at ${at}: START a tmux agent stopped with OATS, through its dialog`);
      await stop(`stop-10574b1ed0c${round}`);
      if (first) keepRow("lifecycle/tmux-row-stopped.json");
      await look(view, "stopped");
      if (first) resumeWhileStopped();
      since = Date.now();
      result = await through("start", "start", `Start ${CALLED}`, [SAYS.start], [SAYS.resume]);
      call = asked("start", since);
      if (first) fixtures.keep("lifecycle/tmux-start.json", call.stdout);
      check(!call.argv.includes("--resume") && !call.argv.some((word) => NO_CHOICE.includes(word)), `${at} a start of an agent stopped with OATS is a plain session start: no --resume`, JSON.stringify(call.argv));
      check(result.tone === "done" && result.title === SAYS.started && (call.result?.resume ?? null) === null, `${at} the result says it started: "${SAYS.started}"`, JSON.stringify(result));
      await turned("started through the dialog");

      // ---- LOST: its Start RESUMES
      step(`C lost, at ${at}: RESUME a lost tmux agent, through its Start dialog`);
      await lose(`lost, at ${at}`);
      if (first) keepRow("lifecycle/tmux-row-lost.json");
      await look(view, "lost");
      since = Date.now();
      result = await through("start", "resume", `Start ${CALLED}`, [SAYS.resume], [SAYS.start, SAYS.resumeClaude]);
      call = asked("start", since);
      if (first) fixtures.keep("lifecycle/tmux-start-resume.json", call.stdout);
      const resume = call.result?.resume ?? null;
      show("the kernel's `resume`", resume);
      check(call.argv.includes("--resume") && !call.argv.some((word) => NO_CHOICE.includes(word)), `${at} the kernel was asked session start --resume, with no harness, model, mode or launch configuration (it refuses them with --resume)`, JSON.stringify(call.argv));
      check(typeof resume?.resumed === "boolean", `${at} the kernel's answer says whether the conversation was resumed`, JSON.stringify(resume));
      // What the result says is what the kernel's `resume` said, never a guess.
      if (resume?.resumed === true) check(result.tone === "done" && result.title === SAYS.resumed, `${at} resumed: the result says "${SAYS.resumed}"`, JSON.stringify(result));
      else check(result.tone === "unknown" && result.title === SAYS.fresh, `${at} not resumed (${resume?.reason ?? "no reason"}): the result says "${SAYS.fresh}", in the warning tone`, JSON.stringify(result));
      check((typeof resume?.waiting === "string") === (result.waiting === SAYS.waiting), `${at} it says that the harness waits in its terminal exactly when the kernel says so (waiting: ${resume?.waiting ?? "none"})`, JSON.stringify(result));
      const back = await untilRow("to run again", (r) => r.running === true);
      check(back?.running === true && (back.sessionEnd ?? null) === null, "oats status: it runs again, and the row no longer says lost", brief(row()));
    });
  }
};
