// The outside feature's part of the real run (parts/README.md): what bb's own acts do to an OATS
// agent WITHOUT OATS, on the real kernel and the bb session provider that archives a home's thread
// at its stop (oats-bb #40), with what the plugin then says and the act that mends it. It records
// the kernel's rows for those states, which the feature's tests read
// (test/fixtures/outside/README.md):
//   at rest        the agent idle, its harness loaded: `running: true`, `runtimeState: "unknown"`;
//   not loaded     its session there and no harness (the thread's harness process ended, as after
//                  a reboot or when bb lets it exit): `running: false`, `runtimeState: "unknown"`;
//   stopped        by OATS: `running: false`, `runtimeState: "stopped"`, `sessionEnd: "stopped"`,
//                  and bb has its thread ARCHIVED;
//   outside        that home again, after a person unarchived its thread and sent it a message in
//                  bb: the kernel's own report, `outsideOats`, beside the row OATS recorded;
//   archived while it ran   a running agent whose thread a person archived in bb: `running:
//                  false`, `runtimeState: "stopped"`, `sessionEnd: "lost"`.
// The agent is `flaky-ci-2-developer` of `oats-developer`, the name of the run's part A (retired
// there, so the name is free): the feature's tests name the rows by it.
//
// And it proves, through the plugin, in every view:
//   - "not loaded" is said as idle, never as stopped, and a message in the thread carries on;
//   - the agent that runs outside OATS: its row, its thread's line and the notice, and that the
//     notice's Stop stops it (OATS has it stopped again, the report gone, its thread archived);
//   - STOP WORKS on a home whose thread bb has archived while it ran: the one act the plugin
//     offers there, pressed, stops it.
// Each read waits on the state it asserts and prints what it read.
import { readdirSync, readFileSync, readlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { showSidebar } from "../../browser.mjs";
import { click, closed, dialog, phaseIs } from "../../scenes/lifecycle.mjs";

const NAME = "flaky-ci-2-developer";
const SOUL = "oats-developer";
// The plugin's words (app/outside/words.ts, app/ui/words.ts), restated: a run cannot read the app's code; they move together.
const SAYS = {
  notLoaded: "not loaded",
  notLoadedRow: "Idle · not loaded",
  outsideState: "Running outside OATS",
  outsideRecorded: "recorded stopped",
  outsideWhat: "Someone sent it a message in bb. Stop it, or start it from OATS so that OATS tracks it again.",
  archivedWhileRunning: "Archived in bb while running: it may still run.",
  archivedRow: "archived in bb",
};

export default async (run) => {
  const { step, check, show, note, until, oats, bb, rowOf, rpc, act, fixtures, views, DEPLOY, OUT } = run;
  const home = join(DEPLOY, "agents", SOUL, "instances", NAME);
  const CALLED = run.nameOf(NAME); // the instance name as the plugin draws it (scenario.mjs)

  // ---- the kernel's row, and bb's thread
  const row = () => rowOf(NAME);
  const brief = (r) => (r === undefined ? "no row" : JSON.stringify({ running: r.running, runtimeState: r.runtimeState ?? null, sessionEnd: r.sessionEnd ?? null, outsideOats: r.outsideOats?.code ?? null, threadId: r.session?.threadId ?? null }));
  const untilRow = (what, matches, seconds = 90) => until(`${NAME} ${what} in oats status`, () => (matches(row() ?? {}) ? row() : undefined), seconds);
  const threadNow = () => run.bbThread(row()?.session?.threadId);
  const briefThread = (t) => (t ? JSON.stringify({ id: t.id, status: t.status, archivedAt: t.archivedAt ?? null }) : "no thread");
  /** At rest: the kernel has it running (its harness is loaded) and bb says its turn is over. */
  const atRest = (what) => until(`${NAME} to be at rest (${what})`, () => {
    const r = row();
    return r?.session?.threadId && r.running === true && run.atRest(r) ? r : undefined;
  }, 120);
  /** `oats status --json` as printed, with this agent's row alone: the document a fixture of the feature is. */
  const keepStatus = (file) => {
    const document = run.status().document;
    const groups = document.agents.map((group) => ({ ...group, instances: group.instances.filter((each) => each.instance === NAME) })).filter((group) => group.instances.length > 0);
    fixtures.keep(file, JSON.stringify({ ...document, agents: groups }));
  };
  /** Stopped with OATS, by the plugin's own Stop; the provider archives the thread. */
  const stop = async (key) => {
    const plan = act(`stop plan of ${NAME}`, "stopPlan", { instance: NAME });
    act(`stop apply of ${NAME}`, "stopApply", { instance: NAME, revision: plan?.revision, key });
    const stopped = await untilRow("to read stopped by OATS", (r) => r.running === false && r.runtimeState === "stopped" && r.sessionEnd === "stopped" && (r.outsideOats ?? null) === null);
    const thread = await until(`bb to have the thread of ${NAME} archived`, () => (threadNow()?.archivedAt != null ? threadNow() : undefined), 30);
    check(Boolean(stopped) && thread?.archivedAt != null, "oats status: stopped by OATS, no report of a harness outside; bb: its thread is archived (this provider archives at stop)", `${brief(row())} | ${briefThread(threadNow())}`);
  };

  // ---- the page: the thread's own row, and the sidebar's row
  const flat = `(e) => (e?.innerText ?? "").replace(/\\s+/g, " ").trim()`;
  const IDENTITY = '[data-testid="oats-identity-row"]';
  /** The thread's own row once its words hold every one of `wanted` → { words, acts, notice }. When the wait runs out it is read as it is, for the check to print. */
  const lineOf = async (page, wanted) => {
    const read = (test) =>
      `(() => { const flat = ${flat}; const r = document.querySelector(${JSON.stringify(IDENTITY)}); if (!r) return ""; const words = flat(r); if (${test} && !${JSON.stringify(wanted)}.every((part) => words.includes(part))) return ""; const warning = r.querySelector('[data-testid="oats-outside-warning"]'); return JSON.stringify({ words, acts: [...r.querySelectorAll('[data-testid="oats-status-act"], [data-testid^="oats-agent-act-"]')].map(flat), notice: warning ? { boxed: warning.querySelector("h3") !== null, folded: warning.querySelector("details")?.open === false, text: (warning.querySelector("details")?.textContent ?? "").replace(/\\s+/g, " ").trim() } : null }); })()`;
    const found = (await page.until(read(true), 60)) || (await page.evaluate(read(false)));
    return found ? JSON.parse(found) : null;
  };
  /** The agent's row in the sidebar, on its thread or on none, once its facts hold `wanted` → the facts (the row's own title, whole). */
  const rowSays = async (page, viewport, wanted) => {
    rpc("refresh");
    await page.goto("/");
    await showSidebar(page, viewport);
    const read = (test) =>
      `(() => { const rows = [...document.querySelectorAll('[data-testid="oats-agent-row"], [data-testid="oats-agent-row-threadless"]')]; const mine = rows.find((r) => r.getAttribute("data-instance") === ${JSON.stringify(NAME)} || r.getAttribute("data-sidebar-thread-id") === ${JSON.stringify(row()?.session?.threadId ?? "")}); const facts = mine?.querySelector('[data-testid="oats-row-facts"]')?.getAttribute("title") ?? ""; return ${test} && !facts.includes(${JSON.stringify(wanted)}) ? "" : facts; })()`;
    return (await page.until(read(true), 60)) || (await page.evaluate(read(false)));
  };
  /** The agent's thread in bb, by the address the kernel's row gave for it while it was open (`open.url`), kept from then. */
  let threadPath = null;
  const noteThread = () => {
    const url = row()?.open?.url;
    if (typeof url === "string") threadPath = new URL(url).pathname;
  };
  /** One act of the plugin through its dialog, once the button that opens it is pressed → the dialog's last words. */
  const confirm = async (page, at, what) => {
    await page.until(phaseIs("ready"), 60);
    const before = await dialog(page);
    check(before.about === NAME, `${at} ${what}: the dialog is for ${NAME}`, JSON.stringify(before));
    await page.evaluate(click("oats-confirm-act"));
    await page.until(phaseIs("done"), 180);
    const after = await dialog(page);
    await page.evaluate(click("oats-confirm-close"));
    check(Boolean(await page.until(closed, 10)), `${at} ${what}: Close closes the dialog`);
    return after;
  };

  // =============================================================================================
  step(`C outside: ${NAME} again, on bb: at rest`);
  const file = join(OUT, `task-outside-${NAME}.md`);
  writeFileSync(file, "Wait for instructions.\n");
  const made = oats("spawn", SOUL, "--backend", "bb", "--yolo", "--name", NAME, "--task-file", file, "--json");
  check(made.exit === 0, `oats spawn ${SOUL} --backend bb --yolo --name ${NAME}`, made.stdout.slice(0, 400) || made.stderr.slice(0, 400));
  if (made.exit !== 0) return;
  let rest = await atRest("spawned");
  check(rest?.running === true && rest.runtimeState === "unknown", 'oats status, at rest: running true (its harness is loaded), runtimeState "unknown"', brief(row()));
  show("oats status", brief(row()));
  noteThread();
  keepStatus("outside/status-at-rest.json");

  // ---- not loaded
  step("C outside 1: no harness loaded (the thread's harness process ended): idle, never stopped; a message carries on");
  // The thread's harness process, as bb's host daemon started it: the processes whose working directory is the home; the one the others descend from is ended.
  const ofHome = readdirSync("/proc").filter((name) => /^\d+$/.test(name)).filter((pid) => {
    try {
      return readlinkSync(`/proc/${pid}/cwd`) === home;
    } catch {
      return false; // gone meanwhile, or not ours to read
    }
  }).map(Number);
  const parentOf = (pid) => Number(readFileSync(`/proc/${pid}/stat`, "utf8").split(") ").pop().split(" ")[1]);
  const top = ofHome.filter((pid) => !ofHome.includes(parentOf(pid)));
  check(top.length === 1, "the home has one harness process tree (bb's bridge and the Claude Code it runs)", JSON.stringify(ofHome.map((pid) => [pid, readFileSync(`/proc/${pid}/comm`, "utf8").trim(), parentOf(pid)])));
  for (const pid of top) process.kill(pid);
  const unloaded = await untilRow("to read not loaded", (r) => r.running === false && r.runtimeState === "unknown");
  check(unloaded?.running === false && unloaded.runtimeState === "unknown" && (unloaded.sessionEnd ?? null) === null, 'oats status, its harness process ended: running false beside runtimeState "unknown", and no sessionEnd: its session is there, with nothing loaded', brief(row()));
  show("oats status", brief(row()));
  keepStatus("outside/status-not-loaded.json");
  await views("real-outside", async ({ page, at, viewport, shot }) => {
    const facts = await rowSays(page, viewport, SAYS.notLoadedRow);
    check(facts.startsWith(SAYS.notLoadedRow), `${at} not loaded: the sidebar's row says "${SAYS.notLoadedRow}", never "Stopped"`, facts);
    await page.goto(threadPath);
    const line = await lineOf(page, ["Idle", SAYS.notLoaded]);
    check(line !== null && line.words.includes("Idle") && line.words.includes(SAYS.notLoaded) && !line.words.includes("Stopped") && line.notice === null, `${at} not loaded: the thread's line says "Idle · ${SAYS.notLoaded}", with no warning`, JSON.stringify(line));
    await shot("not-loaded-thread");
  });
  show("bb thread tell", bb("thread", "tell", row().session.threadId, "Carry on, then wait.").trim());
  rest = await atRest("after a message in its thread");
  check(rest?.running === true, "a message in its thread carried the conversation on: OATS reads it running at its next read, on the same thread", brief(row()));

  // ---- stopped with OATS: its thread archived
  step("C outside 2: stopped with OATS: the provider archives its thread");
  await stop("stop-0a7b1de0c001");
  show("oats status", brief(row()));
  keepStatus("outside/status-stopped-archived.json");

  // ---- in each view: it runs outside OATS, and Stop mends it; then its thread is archived in bb while it runs, and Stop works
  let view = 0;
  await views("real-outside", async ({ page, at, viewport, shot }) => {
    view += 1;
    step(`C outside 3, at ${at}: a person unarchives the stopped agent's thread and sends it a message: it runs outside OATS`);
    const threadId = row().session.threadId;
    show("bb thread unarchive", bb("thread", "unarchive", threadId).trim());
    show("bb thread tell", bb("thread", "tell", threadId, "Are you there?").trim());
    const reported = await untilRow("to carry the kernel's report of a harness outside OATS", (r) => r.outsideOats?.code === "running-outside-oats");
    check(reported?.running === false && reported.runtimeState === "stopped" && reported.sessionEnd === "stopped" && reported.outsideOats?.backend === "bb", "oats status: the row OATS recorded (stopped, not running), with outsideOats: running-outside-oats, on bb", JSON.stringify(reported?.outsideOats ?? brief(row())));
    if (view === 1) {
      show("the kernel's report", reported?.outsideOats);
      keepStatus("outside/status-outside.json");
    }
    const facts = await rowSays(page, viewport, SAYS.outsideState);
    check(facts.startsWith(SAYS.outsideState), `${at} the sidebar's row says "${SAYS.outsideState}"`, facts);
    await shot("outside-row");
    await page.goto(threadPath);
    let line = await lineOf(page, [SAYS.outsideState, SAYS.outsideRecorded]);
    check(line !== null && line.words.startsWith(`${SAYS.outsideState} · ${SAYS.outsideRecorded}`) && line.notice !== null && line.notice.boxed === false && line.notice.folded === true && line.notice.text.includes(SAYS.outsideWhat) && line.notice.text.includes("running-outside-oats") && !line.words.includes(SAYS.outsideWhat), `${at} its thread says "${SAYS.outsideState} · ${SAYS.outsideRecorded}", and under it, with no box, ONE fold (Details, closed) with what happened in a person's words ("${SAYS.outsideWhat}") and the kernel's own`, JSON.stringify(line));
    check(Array.isArray(line?.acts) && line.acts.some((label) => label.startsWith("Stop")) && line.acts.some((label) => label.startsWith("Start")), `${at} the line offers Stop… and Start…`, JSON.stringify(line?.acts));
    await shot("outside-thread");
    // The notice's Stop: the harness that runs outside OATS is stopped, as OATS recorded it.
    await page.evaluate(`[...document.querySelector(${JSON.stringify(IDENTITY)}).querySelectorAll('[data-testid="oats-outside-warning"] button')].find((button) => button.innerText.trim().startsWith("Stop")).click()`);
    let said = await confirm(page, at, "the notice's Stop");
    check(said.phase === "done" && said.body.includes(`${CALLED} stopped.`), `${at} the dialog says that it stopped`, JSON.stringify(said));
    const mended = await untilRow("to be stopped, the report gone", (r) => r.running === false && r.runtimeState === "stopped" && (r.outsideOats ?? null) === null);
    const archived = await until(`bb to have the thread of ${NAME} archived again`, () => (threadNow()?.archivedAt != null ? threadNow() : undefined), 30);
    check(Boolean(mended) && archived?.archivedAt != null, "oats status: stopped, and the kernel reports no harness outside OATS any more; bb: its thread is archived again", `${brief(row())} | ${briefThread(threadNow())}`);

    step(`C outside 4, at ${at}: started from OATS, then its thread ARCHIVED in bb while it runs: Stop works`);
    const started = act(`start of ${NAME}`, "start", { instance: NAME });
    await untilRow("to be on its new thread", (r) => r.session?.threadId === started?.threadId && r.running === true);
    await atRest("started from OATS");
    noteThread();
    const running = row().session.threadId;
    show("bb thread archive", bb("thread", "archive", running).trim());
    await until(`bb to have the running agent's thread archived`, () => (threadNow()?.archivedAt != null ? threadNow() : undefined), 30);
    // bb's Archive ended OATS's hold on the session, not the harness: the kernel reads the session as lost.
    const lost = await untilRow("to read its session lost", (r) => r.running === false && r.sessionEnd === "lost");
    check(lost?.runtimeState === "stopped" && lost.sessionEnd === "lost", 'oats status, its thread archived in bb while it ran: running false, runtimeState "stopped", sessionEnd "lost"', brief(row()));
    show("oats status", brief(row()));
    if (view === 1) keepStatus("outside/status-archived-while-running.json");
    const there = await rowSays(page, viewport, SAYS.archivedRow);
    check(there.includes(SAYS.archivedRow), `${at} the sidebar's row says what happened: "${SAYS.archivedRow}"`, there);
    await shot("archived-row");
    await page.goto(threadPath);
    line = await lineOf(page, [SAYS.archivedWhileRunning]);
    check(line !== null && line.words.includes(SAYS.archivedWhileRunning) && line.acts.some((label) => label.startsWith("Stop")), `${at} the archived thread's own row says "${SAYS.archivedWhileRunning}", and offers Stop`, JSON.stringify(line));
    show("the acts it offers", line?.acts);
    await shot("archived-thread");
    await page.evaluate(`[...document.querySelector(${JSON.stringify(IDENTITY)}).querySelectorAll('[data-testid="oats-status-act"], [data-testid^="oats-agent-act-"]')].find((button) => button.innerText.trim().startsWith("Stop")).click()`);
    said = await confirm(page, at, "Stop, on a home whose thread bb has archived");
    check(said.phase === "done" && said.body.includes(`${CALLED} stopped.`), `${at} STOP WORKS on a home whose thread is archived in bb: the dialog says that it stopped`, JSON.stringify(said));
    const down = await untilRow("to be stopped", (r) => r.running === false && r.runtimeState === "stopped" && r.sessionEnd === "stopped");
    check(Boolean(down), "oats status: stopped by OATS", brief(row()));
    show("oats status", brief(row()));
  });

  step(`C outside, the end: ${NAME} is retired`);
  const gone = oats("retire", NAME, "--json");
  check(gone.exit === 0, `oats retire ${NAME}`, gone.stdout.slice(0, 400) || gone.stderr.slice(0, 400));
  await until(`${NAME} to be gone from oats status`, () => (row() === undefined ? true : undefined));
  note("the outside feature's rows were recorded live on this provider: at rest, not loaded, stopped with its thread archived, and the kernel's outsideOats");
};
