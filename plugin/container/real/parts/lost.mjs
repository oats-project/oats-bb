// The lost session's part of the real run (parts/README.md): ONE agent on the TMUX backend, on the
// real kernel, taken through the three states a person meets on a deployment of tmux agents
// (running, stopped with OATS, and LOST: its tmux window gone, as after a crash or a reboot), with
// what the plugin shows and offers in each, and the kernel's own answers for the three acts that
// bring such an agent back (a plain start, a start with --resume, a restart), kept as fixtures.
//
// Every other agent of the run is on bb. This one is spawned on the command line (`oats spawn
// --backend tmux`: the plugin's own spawn is always a bb thread) and runs Claude Code on the run's
// mock model in a window of the OATS tmux server. What that needs of the container, beside what
// setup.sh gives the bb agents, is prepared here and said in the log (`prepare`):
//   - tmux (the image's: container/Dockerfile);
//   - the OATS tmux server, started by hand as the kernel's docs say for a shell whose PATH the
//     panes need (docs/execution-targets.md: `tmux -L oats new-session -d -s <session> -n hq`): a
//     pane's environment is its tmux server's, and the kernel's own server would not find `claude`
//     (it is in npm's prefix, which only this process's PATH holds) nor carry the placeholder key;
//   - Claude Code's folder trust for the deployment (`oats harness trust`, the kernel's command);
//   - Claude Code's first-run screens answered in its own state file (the theme chooser, the
//     question whether to use the API key in the environment): nothing answers them in a pane.
//
// The session is LOST as a crash loses it: its tmux window is killed (never `oats instance stop`);
// the kernel then prints `running: false` and `sessionEnd: "lost"` for the row, with no
// `runtimeState`.
//
// WHAT IT ASSERTS IS WHAT MAIN DOES, in two halves that each change with one switch below:
//   WORDS  the row and the page of a lost tmux agent. Today: plain "Stopped", as for one stopped
//          with OATS. Target (the one-predicate PR): "Stopped · session lost · tmux".
//   ACTS   what the agent's page offers. Today: Stop… and Retire… while it runs, Retire… alone
//          once it is stopped or lost: no Start and no Restart for an agent on tmux
//          (app/lifecycle/index.tsx `actsFor`). Target (the dialogs' third PR): START a stopped
//          one, RESUME a lost one, RESTART a running one, each through its dialog, each with the
//          result's line read.
// Until ACTS is on main the three acts are made on the command line, so that the kernel's answers
// exist as fixtures for whoever builds the dialogs (test/fixtures/lifecycle/README.md).
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { showSidebar } from "../../browser.mjs";
import { click, dialog, phaseIs } from "../../scenes/lifecycle.mjs";

/** The row and the page say that a tmux agent's session was lost (the one-predicate PR is on main). */
const WORDS = false;
/** Start and Restart are offered for an agent on tmux, and a lost one's Start resumes (the dialogs' third PR is on main). */
const ACTS = false;

const NAME = "lost-tmux-developer";
const SOUL = "oats-developer";
const CALLED = "Lost tmux developer"; // the instance name as the plugin's words (app/ui/words.ts `agentName`)
/** The placeholder the run's bb server has too (setup.sh): the mock model asks for no credential, Claude Code for one. */
const KEY = "placeholder-not-a-key";

/** What the plugin says and offers TODAY, per state; and what it will, once each switch is on. */
const EXPECTED = {
  running: { acts: ACTS ? ["Stop…", "Restart…", "Retire…"] : ["Stop…", "Retire…"], words: ["Working", "Idle"] },
  // An OATS stop leaves the agent's tmux window at a shell: the kernel's row is `runtimeState:
  // "shell"` with `sessionEnd: "stopped"`, and main draws that as "Failed · Its session ended".
  // The ruling (the specialist's, 23 Nov): where the row has a sessionEnd, IT decides: "stopped"
  // is "Stopped · <soul> · tmux" whatever runtimeState says; "lost" is "Stopped · session lost ·
  // tmux"; "exited", or "shell" with no sessionEnd, is "Failed".
  stopped: { acts: ACTS ? ["Start…", "Retire…"] : ["Retire…"], words: [WORDS ? "Stopped" : "Failed"], row: `Stopped · ${SOUL} · tmux` },
  lost: { acts: ACTS ? ["Start…", "Retire…"] : ["Retire…"], words: ["Stopped"], row: "Stopped · session lost · tmux" },
};
// The target's words, to be confirmed with their authors when the two PRs exist (the requirements:
// specs/lost-sessions.requirements.md, 1 and the kernel's facts). Read only with ACTS on.
const TARGET = {
  /** before the press, on a lost agent's Start */
  resumeBefore: "Start tries to bring it back in its last conversation; if that is gone, it starts fresh on its task.",
  /** after it, by the kernel's `resume.resumed` */
  resumed: "Back in its last conversation.",
  fresh: "Started fresh: its last conversation was not found.",
};

export default async (run) => {
  const { step, check, show, note, until, oats, rowOf, rpc, act, recorded, fixtures, evidence, views, DEPLOY, OUT } = run;
  const home = join(DEPLOY, "agents", SOUL, "instances", NAME);

  // ---- the container, for an agent on tmux
  const sh = (command, args, options = {}) => {
    const done = spawnSync(command, args, { encoding: "utf8", ...options });
    return { exit: done.status, stdout: done.stdout ?? "", stderr: done.stderr ?? "", error: done.error?.message ?? null };
  };
  /** The OATS tmux server: the kernel's socket name (`-L oats`), or the socket a row names. */
  const tmux = (...args) => sh("tmux", ["-L", "oats", ...args]);
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
    // The OATS tmux server, with this process's PATH (where `claude` is) and the placeholder key:
    // a pane's environment is its server's. No update of Claude Code under the run's pin.
    const session = "oats-agents";
    if (tmux("has-session", "-t", session).exit !== 0) {
      const started = sh("tmux", ["-L", "oats", "new-session", "-d", "-s", session, "-n", "hq", "-x", "160", "-y", "50"], { env: { ...process.env, ANTHROPIC_API_KEY: KEY, DISABLE_AUTOUPDATER: "1" } });
      check(started.exit === 0, `the OATS tmux server is started by hand, as the kernel's docs say (tmux -L oats new-session -d -s ${session} -n hq), with this run's PATH and the placeholder key`, started.stderr);
    }
    return tmux("has-session", "-t", session).exit === 0;
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

  // ---- what the plugin shows: the row in the sidebar, and the agent's page with its acts
  const ROW = `[data-testid="oats-agent-row-threadless"][data-instance="${NAME}"]`;
  const PAGE = '[data-testid="oats-agent-page"]';
  const clean = (expression) => `(${expression} ?? "").replace(/\\s+/g, " ").trim()`;
  /** The agent's page once it shows a state among `words` (a wait on the state it asserts) → what it says and offers. */
  const pageSays = (words) =>
    `(() => { const p = document.querySelector(${JSON.stringify(PAGE)}); const s = p?.querySelector('[data-testid="oats-panel-state"]'); if (!p || !s) return ""; const state = ${clean("s.innerText")}; if (!${JSON.stringify(words)}.some((word) => state.includes(word))) return ""; return JSON.stringify({ name: ${clean(`p.querySelector('[data-testid="oats-panel-name"]')?.innerText`)}, state, acts: [...p.querySelectorAll('[data-testid="oats-agent-acts"] button')].map((b) => b.innerText.trim()), session: ${clean(`p.querySelector('[data-testid="oats-panel-session-line"]')?.innerText`)}, attach: ${clean(`p.querySelector('[data-testid="oats-panel-attach"]')?.innerText`)}, work: ${clean(`p.querySelector('[data-testid="oats-panel-work-sentence"]')?.innerText`)} }); })()`;
  const pageNow = `(() => { const p = document.querySelector(${JSON.stringify(PAGE)}); return p ? ${clean("p.innerText")}.slice(0, 600) : ${clean("document.body.innerText")}.slice(0, 300); })()`;
  /** The agent's row in the sidebar, once it says one of `words`. */
  const rowSays = (words) => `(() => { const r = document.querySelector(${JSON.stringify(ROW)}); if (!r) return ""; const text = ${clean("r.innerText")}; return ${JSON.stringify(words)}.some((word) => text.includes(word)) ? text : ""; })()`;
  /**
   * In each view: the row in the sidebar and the agent's own page, for the state the kernel's row is
   * in, with their images; the acts the page offers are the ones of EXPECTED.
   */
  const shown = async (state) => {
    const { words } = EXPECTED[state];
    const seen = [];
    await views(`real-tmux-${state}`, async ({ page, at, viewport, shot }) => {
      rpc("refresh");
      await page.goto("/");
      await showSidebar(page, viewport);
      const inRow = await page.until(rowSays(words), 60);
      check(Boolean(inRow), `${at} the ${state} tmux agent has a row in the sidebar, among the agents with no bb thread, with its state in a word`, inRow ?? (await page.evaluate(`${clean(`document.querySelector('[data-testid="oats-sidebar"]')?.innerText`)}.slice(0, 400)`)));
      await shot("row");
      await page.goto(`/plugins/oats/agent/${NAME}`);
      const said = await page.until(pageSays(words), 60);
      const read = said ? JSON.parse(said) : null;
      check(read !== null && read.name === CALLED, `${at} the agent's own page opens for it and says its state`, said ?? (await page.evaluate(pageNow)));
      check(JSON.stringify(read?.acts) === JSON.stringify(EXPECTED[state].acts), `${at} the page offers ${EXPECTED[state].acts.join(" and ")}${ACTS ? "" : state === "running" ? ": no Restart for an agent on tmux (main today)" : ": no Start for an agent on tmux (main today)"}`, JSON.stringify(read?.acts));
      await shot("page");
      seen.push({ at, row: inRow ?? null, ...read });
    });
    return seen;
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

  // ---- 1. it runs
  step("C lost 1: it runs: what the plugin shows and offers for a running agent on tmux");
  await turned("spawned");
  show("oats status", brief(row()));
  keepRow("lifecycle/tmux-row-running.json");
  const running = await shown("running");
  show("the plugin, for the running tmux agent", running);
  // --resume on a home that RUNS: the kernel's refusal, and nothing is started.
  const whileRunning = cli("lifecycle/tmux-resume-running.json", "session", "start", "--resume", "--home", home, "--json");
  check(whileRunning.answer?.ok === false && whileRunning.answer.error?.code === "E_SESSION_RUNNING", "oats session start --resume on a home that RUNS is refused: E_SESSION_RUNNING", JSON.stringify(whileRunning.answer?.error ?? whileRunning.answer).slice(0, 400));
  check(row()?.running === true, "and the agent goes on running", brief(row()));

  // ---- RESTART a running one
  step(`C lost 2: RESTART a running tmux agent${ACTS ? ", through its dialog" : " (on the command line: the plugin offers no Restart for it today)"}`);
  const before = row().startedAt;
  if (ACTS) {
    await restartThroughDialog();
  } else {
    const restarted = cli("lifecycle/tmux-restart.json", "session", "restart", "--home", home, "--json");
    check(restarted.exit === 0 && restarted.answer?.ok === true, "oats session restart --home <home> --json: restarted", JSON.stringify(restarted.answer?.error ?? {}).slice(0, 400));
    show("the kernel's answer", pick(restarted.answer?.result));
  }
  const again = await untilRow("to be started anew", (r) => r.running === true && r.startedAt !== before);
  check(Boolean(again), "oats status: running, with a new start", brief(row()));
  await turned("restarted");

  // ---- 2. stopped with OATS
  step("C lost 3: stopped with OATS (the plugin's own Stop): what the plugin shows and offers");
  const plan = act(`stop plan of ${NAME}`, "stopPlan", { instance: NAME });
  check(plan?.targets?.[0]?.instance === NAME && plan.targets[0].backend === "tmux", "the kernel's stop plan names the agent, on tmux", JSON.stringify(plan?.targets));
  act(`stop apply of ${NAME}`, "stopApply", { instance: NAME, revision: plan?.revision, key: "stop-10574b1ed0c1" });
  const stopped = await untilRow("to read stopped by OATS", (r) => r.running === false && r.sessionEnd === "stopped");
  check(stopped?.sessionEnd === "stopped" && stopped.runtimeState === "shell", 'oats status: running false, sessionEnd "stopped", runtimeState "shell" (the stop leaves its window at a shell)', brief(row()));
  show("oats status", brief(row()));
  keepRow("lifecycle/tmux-row-stopped.json");
  const stoppedSeen = await shown("stopped");
  show("the plugin, for the tmux agent stopped with OATS", stoppedSeen);
  if (WORDS) for (const seen of stoppedSeen) check((seen.row ?? "").replace(CALLED, "").trim().startsWith(EXPECTED.stopped.row) && !/lost|failed/i.test(seen.state ?? ""), `${seen.at} an agent stopped with OATS reads "${EXPECTED.stopped.row}": its sessionEnd decides, not the shell its window is left at`, JSON.stringify({ row: seen.row, page: seen.state }));
  else note(`MAIN TODAY: a tmux agent stopped with OATS (the kernel's row: runtimeState "shell", sessionEnd "stopped") is drawn as "${stoppedSeen[0]?.state}", in the row as "${stoppedSeen[0]?.row}"`);
  // --resume on a home that is NOT lost (stopped with OATS): the kernel's refusal.
  const notLost = cli("lifecycle/tmux-resume-not-lost.json", "session", "start", "--resume", "--home", home, "--json");
  check(notLost.answer?.ok === false && notLost.answer.error?.code === "E_RESUME_NOT_LOST", "oats session start --resume on a home that is NOT lost (stopped with OATS) is refused: E_RESUME_NOT_LOST", JSON.stringify(notLost.answer?.error ?? notLost.answer).slice(0, 400));
  check(row()?.running === false && row()?.sessionEnd === "stopped", "and the agent stays stopped", brief(row()));

  // ---- START a stopped one
  step(`C lost 4: START a tmux agent stopped with OATS${ACTS ? ", through its dialog" : " (on the command line: the plugin offers no Start for it today)"}`);
  if (ACTS) {
    await startThroughDialog({ lost: false });
  } else {
    const started = cli("lifecycle/tmux-start.json", "session", "start", "--home", home, "--json");
    check(started.exit === 0 && started.answer?.ok === true, "oats session start --home <home> --json (a plain start): started", JSON.stringify(started.answer?.error ?? {}).slice(0, 400));
    show("the kernel's answer", pick(started.answer?.result));
  }
  await turned("started after an OATS stop");

  // ---- 3. LOST
  step("C lost 5: its session is LOST (its tmux window killed): the row, the page, the acts");
  await lose("the first loss");
  keepRow("lifecycle/tmux-row-lost.json");
  const lostSeen = await shown("lost");
  show("the plugin, for the lost tmux agent", lostSeen);
  for (const seen of lostSeen) {
    // (Without the agent's own name, which holds the word.)
    const says = (seen.row ?? "").replace(CALLED, "").trim();
    if (WORDS) check(says.includes(EXPECTED.lost.row), `${seen.at} the row says that its session was lost: "${EXPECTED.lost.row}"`, says);
    else check(says.startsWith("Stopped ·") && !/lost/i.test(says) && seen.state === "Stopped", `${seen.at} MAIN TODAY: the row and the page say plain "Stopped" for a lost session: nothing says it was lost, nor that a start could bring it back`, JSON.stringify({ row: says, page: seen.state }));
  }

  // ---- RESUME a lost one
  if (ACTS) {
    step("C lost 6: RESUME a lost tmux agent, through its Start dialog");
    await startThroughDialog({ lost: true });
    await untilRow("to run again", (r) => r.running === true);
  } else {
    step("C lost 6: MAIN TODAY, a start of the lost agent: no place of the plugin offers one; its RPC, asked directly, starts it FRESH and then fails");
    const since = Date.now();
    const direct = rpc("start", { instance: NAME });
    const asked = recorded(["session", "start", "--home", home]);
    const kernel = JSON.parse(asked.stdout);
    show("the plugin's start (rpc), which no button offers for this agent", direct.ok ? direct.value : direct.message);
    show("what it asked the kernel", asked.argv);
    show("the kernel's answer", pick(kernel.result) ?? kernel.error);
    check(Date.parse(asked.at) >= since && !asked.argv.includes("--resume"), "MAIN TODAY: the plugin's start asks the kernel for a PLAIN start (no --resume): a fresh conversation on its task, the last one left behind", JSON.stringify(asked.argv));
    check(kernel.ok === true && (kernel.result?.resume ?? null) === null, "the kernel started it, and its answer carries no `resume` object (none was asked)", JSON.stringify(pick(kernel.result)));
    check(!direct.ok && /NO_THREAD_NAMED/.test(direct.message), "MAIN TODAY: the plugin then refuses its own call (NO_THREAD_NAMED): the kernel names no bb thread for an agent on tmux, though it runs", direct.ok ? JSON.stringify(direct.value) : direct.message);
    evidence.keep("tmux-plain-start-on-lost.json", asked.stdout);
    await turned("started fresh by the plugin's plain start");
    // Whether the plugin, having refused, shows that the agent runs: its own snapshot at the next read.
    rpc("refresh");
    const after = await until("the plugin's snapshot to say what the kernel says of the agent it refused to have started", () => {
      const agent = rpc("snapshot").value?.agents?.find((each) => each.instance === NAME);
      return agent?.running === true ? agent : undefined;
    }, 30);
    check(after?.running === true, "after that refusal the plugin's own snapshot, read again, has the agent running: the row is right, only the call's answer was wrong", JSON.stringify(after ? { running: after.running, runtimeState: after.runtimeState ?? null, backend: after.backend } : rpc("snapshot").value?.agents?.find((each) => each.instance === NAME) ?? null));
    // The resume itself, on the command line, for the fixture: lost once more, then `--resume`.
    step("C lost 7: lost again, then oats session start --resume (on the command line): the kernel's `resume` object");
    await lose("the second loss");
    const resumed = cli("lifecycle/tmux-start-resume.json", "session", "start", "--resume", "--home", home, "--json");
    check(resumed.exit === 0 && resumed.answer?.ok === true && typeof resumed.answer.result?.resume?.resumed === "boolean", "oats session start --resume --home <home> --json: started, and the answer says whether the conversation was resumed", JSON.stringify(resumed.answer?.error ?? resumed.answer?.result?.resume ?? {}).slice(0, 400));
    show("the kernel's `resume`", resumed.answer?.result?.resume ?? null);
    show("the kernel's answer", pick(resumed.answer?.result));
    const back = await untilRow("to run again", (r) => r.running === true);
    check(back?.running === true && (back.sessionEnd ?? null) === null, "oats status: it runs again, and the row no longer says lost", brief(row()));
    show("its pane", pane().replace(/\s+/g, " ").trim().slice(-400));
  }

  // ---- the end: nothing of this part is left
  step(`C lost 8: ${NAME} is retired`);
  const gone = oats("retire", NAME, "--json");
  check(gone.exit === 0, `oats retire ${NAME}`, gone.stdout.slice(0, 400) || gone.stderr.slice(0, 400));
  await until(`${NAME} to be gone from oats status`, () => (row() === undefined ? true : undefined));

  // =============================================================================================
  // THE TARGET (ACTS on): the three acts through their dialogs, from the agent's own page. Written
  // against the dialogs as they are for an agent on bb (scenes/lifecycle.mjs); not run until the
  // dialogs' third PR is on main, and its words are to be confirmed with its author then.
  /** A start's or a restart's answer without its long members (the composition, the capabilities): what says where the agent now runs. */
  function pick(result) {
    return result ? Object.fromEntries(Object.entries(result).filter(([, value]) => JSON.stringify(value).length <= 300)) : null;
  }
  async function throughDialog(verb, title, read) {
    await views(`real-tmux-${verb}`, async ({ page, at, viewport, shot }) => {
      // One act per run of the part: the first view makes it, the others would find another state.
      if (throughDialog.done?.has(verb)) return;
      (throughDialog.done ??= new Set()).add(verb);
      await page.goto(`/plugins/oats/agent/${NAME}`);
      await page.until(`document.querySelector('[data-testid="oats-agent-act-${verb === "resume" ? "start" : verb}"]') !== null`, 60);
      await page.evaluate(click(`oats-agent-act-${verb === "resume" ? "start" : verb}`));
      await page.until(phaseIs("ready"), 60);
      let said = await dialog(page);
      check(said.title === title && said.about === NAME, `${at} the ${verb} dialog is for ${NAME}`, JSON.stringify(said));
      await read.before(said, at);
      await shot("before");
      await page.evaluate(click("oats-confirm-act"));
      await page.until(phaseIs("done"), 180);
      said = await dialog(page);
      await read.after(said, at);
      await shot("done");
      void viewport;
    });
  }
  /** Where a tmux agent runs, as a result must say it: the tmux session the kernel's answer names (`target`), and the plugin's own attach command for the home. */
  function saysWhere(body, answer) {
    return typeof answer?.target?.session === "string" && body.includes(answer.target.session) && body.includes(`oats session attach --home ${home}`);
  }
  async function restartThroughDialog() {
    await throughDialog("restart", `Restart ${CALLED}`, {
      before: async () => {},
      after: async (said, at) => {
        const asked = recorded(["session", "restart", "--home", home]);
        const answer = JSON.parse(asked.stdout).result;
        fixtures.keep("lifecycle/tmux-restart.json", asked.stdout);
        check(said.phase === "done" && said.body.includes(`${CALLED} restarted.`) && saysWhere(said.body, answer), `${at} the result says it restarted, and where it runs (the attach command)`, JSON.stringify(said));
      },
    });
  }
  async function startThroughDialog({ lost }) {
    await throughDialog(lost ? "resume" : "start", `Start ${CALLED}`, {
      before: async (said, at) => {
        if (lost) check(said.body.includes(TARGET.resumeBefore), `${at} before the press, the dialog says what a start of a lost agent tries: "${TARGET.resumeBefore}"`, said.body);
        else check(!said.body.includes(TARGET.resumeBefore), `${at} a start of an agent stopped with OATS promises no resume`, said.body);
      },
      after: async (said, at) => {
        const asked = recorded(["session", "start", "--home", home]);
        const answer = JSON.parse(asked.stdout).result;
        fixtures.keep(lost ? "lifecycle/tmux-start-resume.json" : "lifecycle/tmux-start.json", asked.stdout);
        check(asked.argv.includes("--resume") === lost, `${at} the kernel was asked ${lost ? "session start --resume" : "a plain session start"}`, JSON.stringify(asked.argv));
        check(said.phase === "done" && saysWhere(said.body, answer), `${at} the result says where it runs (the attach command)`, JSON.stringify(said));
        if (lost) check(said.body.includes(answer?.resume?.resumed === true ? TARGET.resumed : TARGET.fresh), `${at} the result says what the kernel's \`resume\` said (resumed: ${answer?.resume?.resumed}, reason: ${answer?.resume?.reason ?? "none"})`, said.body);
      },
    });
  }
};
