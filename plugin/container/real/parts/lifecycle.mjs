// The lifecycle's part of the real run (parts/README.md): each act through its DIALOG, in the
// browser, against the real kernel and the bb session provider, with the images.
//
// For each view (bb's light and dark themes, at each width) one agent of its own is spawned as a
// person's would be, on its worktree, and then, as a person does it:
//   Stop     from the row's menu in the sidebar: the plan, confirmed; the kernel's row reads stopped
//   Start    from the row's menu, or, on a provider that archived the thread at the stop, from the
//            archived thread's own row: the agent as the kernel has it now; started on a new thread
//   Restart  from the thread's own menu: restarted on a new thread
//   Retire   from the thread's own menu: the plan, confirmed; the kernel has no such agent after it
// A state is the same in both themes, so that each is real in light and in dark: at 1280 the agent
// has a child (its Stop plan is read with and without the children, the choice "Include child
// instances", and the kernel's answer for the plan without them is kept as a fixture; its Retire
// stops the child first and keeps the worktree); at 390 it has none, and its Retire also deletes
// the worktree ("Also delete the worktree").
// After each act the kernel is asked what it holds (`oats status`), never the plugin.
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { showSidebar } from "../../browser.mjs";
import { click, closed, dialog, menuTexts, openRowMenu, openThreadMenu, phaseIs, pick, folded, saysNow } from "../../scenes/lifecycle.mjs";

/** An instance name as the plugin's words (app/ui/words.ts `agentName`). */
const words = (instance) => {
  const text = instance.replace(/-+/g, " ").trim();
  return text.charAt(0).toUpperCase() + text.slice(1);
};

/** The Stop dialog's ONE consequence line: what a stop means for the agent's bb thread (app/lifecycle/words.ts `stopThreadLine`). */
const ARCHIVES = "Archives its thread.";
const WARNS = "A message in its thread starts it outside OATS.";
const stopLine = (archives) => (archives ? ARCHIVES : WARNS);
/** The dialog's lines in view, and what is under one of its folds, read from the page. */
const saysOf = async (page) => JSON.parse(await page.evaluate(saysNow));
const foldOf = async (page, id) => JSON.parse(await page.evaluate(folded(id)))?.text ?? "";
/** The plugin's own threshold and its shape of a release (app/lifecycle/words.ts `ARCHIVES_AT_STOP_FROM`, `RELEASE`): restated here, a run cannot read the app's code; they move together. */
const ARCHIVES_AT_STOP_FROM = "0.4.0";
const RELEASE = /^(\d+)\.(\d+)\.(\d+)(-[0-9A-Za-z.-]+)?(\+[0-9A-Za-z.-]+)?$/;
/**
 * Whether a provider of this version archives the thread of a home it stops, compared as the
 * plugin compares it (app/lifecycle/words.ts `stopArchivesThread`): a release from 0.4.0 on,
 * numerically, part by part; a pre-release of 0.4.0 itself, a version that is no release (a commit,
 * for a provider pinned by one) and none at all do not.
 */
function archivesByVersion(version) {
  const [have, need] = [typeof version === "string" ? RELEASE.exec(version) : null, RELEASE.exec(ARCHIVES_AT_STOP_FROM)];
  if (have === null || need === null) return false;
  for (const part of [1, 2, 3]) {
    const [mine, theirs] = [Number(have[part]), Number(need[part])];
    if (mine !== theirs) return mine > theirs;
  }
  return have[4] === undefined;
}

export default async (run) => {
  const { step, check, show, note, until, oats, rowOf, rpc, recorded, fixtures, evidence, views, OUT } = run;
  let view = 0;

  // The Stop dialog says two things of the agent's thread, from two facts. Before the stop (the
  // confirmation): what a provider of this VERSION does, the version being the one the kernel
  // prints for the capability, read here once as the plugin's server reads it. After it (the
  // result): what bb shows of the thread, which is what the stop did (run.stopArchives()).
  const shown = oats("capabilities", "show", "oats.bb", "--json");
  let providerVersion = null;
  try {
    const version = JSON.parse(shown.stdout).result?.version;
    providerVersion = typeof version === "string" ? version : null;
  } catch {
    providerVersion = null; // no JSON printed: the check below says what was
  }
  check(shown.exit === 0 && providerVersion !== null, "oats capabilities show oats.bb --json names the provider's version", shown.stdout.slice(0, 300) || shown.stderr);
  const saysArchives = archivesByVersion(providerVersion);
  note(`the bb session provider's version, as the kernel prints it: ${JSON.stringify(providerVersion)}: the Stop dialog's confirmation ${saysArchives ? "says the thread is archived (a release from " + ARCHIVES_AT_STOP_FROM + ")" : "warns that a message in the thread starts the agent again (no release from " + ARCHIVES_AT_STOP_FROM + ": below it, a pre-release of it, or a commit)"}; its result says what the stop did (${run.stopArchives() === null ? "not read: no stop of this run yet" : run.stopArchives() ? "archived" : "kept"})`);

  /** An agent of its own, spawned on the command line as the plugin's spawn does it (full mode, on bb). */
  const spawn = (name, parent) => {
    const file = join(OUT, `task-${name}.md`);
    writeFileSync(file, "Wait for instructions.\n");
    const made = oats("spawn", "oats-expert", "--backend", "bb", "--yolo", "--name", name, ...(parent ? ["--parent", parent] : []), "--task-file", file, "--json");
    check(made.exit === 0, `oats spawn oats-expert --name ${name}${parent ? ` --parent ${parent}` : ""}`, made.stdout || made.stderr);
  };
  const idle = (name) => until(`${name} to be there and idle in oats status`, () => {
    const row = rowOf(name);
    // At rest: the kernel's `running` is null from a provider that cannot tell and true from one that scans its harness
    // (oats-bb #40); that its turn is over is bb's word (run.atRest, scenario.mjs).
    return row?.session?.threadId && run.atRest(row) ? row : undefined;
  }, 120);
  const stopped = (name) => until(`${name} to read stopped in oats status`, () => {
    const row = rowOf(name);
    return row?.running === false && row.runtimeState === "stopped" ? row : undefined;
  });

  await views("real-lifecycle", async ({ page, at, viewport, theme, shot }) => {
    view += 1;
    const name = `dialogs-${view}-helper`;
    const child = viewport.mobile ? null : `dialogs-${view}-child`;
    const called = words(name);
    const ready = () => page.until(phaseIs("ready"), 60);
    const settledAs = (kind, seconds) => page.until(phaseIs(kind), seconds);
    const close = async () => {
      await page.evaluate(click("oats-confirm-close"));
      return Boolean(await page.until(closed, 10));
    };
    /** The thread the agent is on, as the kernel's row says, drawn as a row of the plugin's sidebar. */
    const rowDrawn = async (threadId) => {
      rpc("refresh");
      await page.goto("/");
      await showSidebar(page, viewport);
      return Boolean(await page.until(`document.querySelector('[data-testid="oats-agent-row"][data-sidebar-thread-id="${threadId}"]') !== null`, 60));
    };
    /** The agent's own thread in bb, opened as its row opens it. */
    const openThread = async (threadId) => {
      if (!(await rowDrawn(threadId))) return false;
      const path = await page.evaluate(`new URL(document.querySelector('[data-testid="oats-agent-row"][data-sidebar-thread-id="${threadId}"]').href).pathname`);
      await page.goto(path);
      return true;
    };

    step(`C lifecycle ${view}: ${name}, at ${at}: spawned, then stopped, started, restarted and retired through the dialogs`);
    spawn(name, null);
    if (child !== null) spawn(child, name);
    let row = await idle(name);
    if (child !== null) await idle(child);
    const spawnedOn = row.session.threadId;

    // ---- Stop, from the row's menu
    check(await rowDrawn(spawnedOn), `${at} ${called} has a row in the sidebar`);
    check(await openRowMenu(page, viewport, spawnedOn), `${at} its row's menu opens`);
    const items = await menuTexts(page);
    check(items.includes("Stop (OATS)") && items.includes("Restart (OATS)") && items.includes("Retire (OATS)") && !items.includes("Start (OATS)"), `${at} the menu of an agent that runs holds Stop, Restart and Retire, and no Start`, JSON.stringify(items));
    check(await pick(page, "Stop (OATS)"), `${at} Stop (OATS) is pressed`);
    await ready();
    let said = await dialog(page);
    check(said.title === `Stop ${called}?` && said.about === name && !/what will happen|what is kept|nothing is forced/i.test(said.body) && (await foldOf(page, "oats-plan-details")).includes("Nothing is deleted.") && said.focus === "oats-confirm-cancel", `${at} the Stop dialog is the kernel's plan for ${name}: no section heading, that nothing is deleted under Details, the focus on Cancel`, JSON.stringify(said));
    check((await saysOf(page))[0] === stopLine(saysArchives) && !said.body.includes(stopLine(!saysArchives)), `${at} before the stop its ONE consequence line says what a provider of this version does to the agent's thread: "${stopLine(saysArchives)}"`, said.body);
    if (child !== null) {
      check(JSON.stringify(await saysOf(page)) === JSON.stringify([stopLine(saysArchives), `Also stops: ${words(child)}.`]) && said.body.includes("Include child instances On"), `${at} with a child, the second and last line says who else is stopped, and the choice is offered`, said.body);
      // Without the children: the kernel is asked again, for the agent alone.
      await page.evaluate(`document.querySelector('[data-testid="oats-plan-choice"] [role="switch"]').click()`);
      await page.until(`document.querySelector('[data-testid="oats-confirm"]')?.innerText.includes("Include child instances Off") && !document.querySelector('[data-testid="oats-confirm"]')?.innerText.includes("Also stops") && ${phaseIs("ready")} && !document.querySelector('[data-testid="oats-confirm-act"]').disabled`, 60);
      said = await dialog(page);
      check(JSON.stringify(await saysOf(page)) === JSON.stringify([stopLine(saysArchives)]) && !said.body.includes(words(child)) && said.body.includes("Include child instances Off"), `${at} without "Include child instances" the kernel's plan is for ${name} alone: its one line, nobody else named, and the choice says Off`, said.body);
      const alone = recorded(["instance", "stop", name], ["--plan", "--no-recursive"]);
      check(JSON.parse(alone.stdout).result?.recursive === false, "the plugin asked the kernel for the plan with --no-recursive", alone.stdout.slice(0, 300));
      if (theme === "light") fixtures.keep("lifecycle/stop-plan-no-recursive.json", alone.stdout);
      await page.evaluate(`document.querySelector('[data-testid="oats-plan-choice"] [role="switch"]').click()`);
      await page.until(`document.querySelector('[data-testid="oats-confirm"]')?.innerText.includes("Also stops") && ${phaseIs("ready")} && !document.querySelector('[data-testid="oats-confirm-act"]').disabled`, 60);
    }
    await shot("stop-before");
    await page.evaluate(click("oats-confirm-act"));
    await settledAs("done", 120);
    said = await dialog(page);
    check(said.phase === "done" && said.body.includes(child === null ? `${called} stopped.` : "2 sessions stopped."), `${at} the dialog says that it stopped`, JSON.stringify(said));
    // What the result says of the thread is what bb shows of it after the stop, whatever the version said before.
    check(said.body.includes(WARNS) === !run.stopArchives() && !said.body.includes(ARCHIVES), `${at} after the stop the result says of the thread what bb shows: ${run.stopArchives() ? "archived, so nothing more than its title" : `still live, so "${WARNS}"`}`, said.body);
    row = await stopped(name);
    check(row?.session?.threadId === spawnedOn, "oats status: stopped, on the same thread", JSON.stringify(row?.session));
    if (child !== null) await stopped(child);
    await shot("stop-done");
    check(await close(), `${at} Close closes the dialog`);

    // ---- Start: from the row's menu, or, where the provider archived the thread at the stop, from the archived thread's own row
    const stoppedOn = run.bbThread(spawnedOn);
    check(run.stoppedThread(stoppedOn), `bb: the stop left the thread as this run's provider leaves one: ${run.stoppedAs()}`, JSON.stringify(stoppedOn ?? null));
    if (!run.stopArchives()) {
      check(await rowDrawn(spawnedOn), `${at} the stopped agent keeps its row`);
      check(await openRowMenu(page, viewport, spawnedOn), `${at} its row's menu opens`);
      check(await pick(page, "Start (OATS)"), `${at} Start (OATS) is pressed`);
    } else {
      // bb lists no archived thread: the agent keeps a row of the roster on no thread, which opens its
      // archived conversation, and that thread's own row has the acts (scenario.mjs, archivedShots).
      rpc("refresh");
      await page.goto("/");
      await showSidebar(page, viewport);
      const kept = `document.querySelector('[data-testid="oats-agent-row-threadless"][data-instance="${name}"][data-opens="thread"]')`;
      check(Boolean(await page.until(`${kept} !== null`, 60)), `${at} the stopped agent keeps its row, which opens its archived thread`, await page.evaluate(`(document.querySelector('[data-testid="oats-sidebar"]')?.innerText ?? "").replace(/\\s+/g, " ").trim()`));
      await page.evaluate(`${kept}?.click()`);
      const start = `document.querySelector('[data-testid="oats-identity-row"][data-outside="stopped-archived"] [data-testid="oats-agent-act-start"]')`;
      const offered = await page.until(`location.pathname.endsWith("/threads/${spawnedOn}") && ${start} !== null && ${start}.disabled === false && ${start}.innerText.trim()`, 60);
      check(offered === "Start…", `${at} the row opens the archived thread, whose own row offers Start…`, `${offered}; at ${await page.evaluate("location.pathname")}: ${await page.evaluate(`(document.querySelector('[data-testid="oats-identity-row"]')?.innerText ?? "").replace(/\\s+/g, " ").trim()`)}`);
      await page.evaluate(`${start}?.click()`);
    }
    await ready();
    said = await dialog(page);
    // What the dialog says a start begins (app/lifecycle/words.ts START), decided from the agent's RECORDED bb
    // thread: one bb lists, or one bb has archived (it is asked for that one thread): on both providers, the one
    // that leaves a stopped agent's thread open and the one that archives it at the stop, the conversation stays
    // readable in bb, archived.
    check(said.title === `Start ${called}` && said.about === name && !said.body.includes("Ready to start.") && (await foldOf(page, "oats-start-details")).includes("Runs in bb's full mode: no sandbox.") && JSON.stringify(await saysOf(page)) === JSON.stringify(["Starts a new conversation."]) && said.act === "Start" && said.off === false, `${at} the Start dialog names the agent as the kernel has it now, says that it starts a new conversation, and starts nothing by itself`, JSON.stringify(said));
    const offered = JSON.parse(await page.evaluate(`JSON.stringify([...(document.querySelector('[data-testid="oats-start-harness"]')?.options ?? [])].map((option) => option.text))`));
    show("the harnesses the Start dialog offers", offered);
    check(offered.length === 0 || offered[0].startsWith("Keep the recorded harness"), `${at} the harness starts on the recorded one`, JSON.stringify(offered));
    await shot("start-before");
    await page.evaluate(click("oats-confirm-act"));
    await settledAs("done", 180);
    said = await dialog(page);
    check(said.phase === "done" && said.body.includes(`${called} started.`), `${at} the dialog says that it started`, JSON.stringify(said));
    const startedOn = (await until(`${name} to be on a new thread`, () => {
      const now = rowOf(name);
      return now?.session?.threadId && now.session.threadId !== spawnedOn && now.running !== false ? now : undefined;
    }, 120))?.session?.threadId;
    const startAnswer = JSON.parse(recorded(["session", "start", "--home", row.home]).stdout);
    check(startAnswer.result?.session?.endpoint?.threadId === startedOn, "oats session start named the thread the agent is now on, and no harness, model or mode was passed", JSON.stringify(recorded(["session", "start", "--home", row.home]).argv));
    check(!recorded(["session", "start", "--home", row.home]).argv.some((word) => ["--harness", "--model", "--yolo"].includes(word)), "the start passed no --harness, --model or --yolo");
    if (view === 1) {
      // Whether a bb home's start can say that Claude Code ignored the channel option (the Desktop's D-176).
      evidence.keep("start-launch-prompts.json", JSON.stringify({ launchPrompts: startAnswer.result?.launchPrompts ?? null, warnings: startAnswer.result?.warnings ?? null }, null, 1));
      note(`a start's answer for a bb home carries launchPrompts: ${JSON.stringify(startAnswer.result?.launchPrompts ?? null)}`);
    }
    await shot("start-done");
    check(await close(), `${at} Close closes the dialog`);

    // ---- Restart, from the thread's own menu
    check(await openThread(startedOn), `${at} the agent's new thread opens from its row`);
    check(await openThreadMenu(page), `${at} the thread's own menu opens`);
    check(await pick(page, "Restart (OATS)"), `${at} Restart (OATS) is pressed`);
    await ready();
    said = await dialog(page);
    check(said.title === `Restart ${called}` && (await saysOf(page)).at(-1) === "Starts a new conversation." && (await saysOf(page)).length <= 2 && (await saysOf(page)).slice(0, -1).every((line) => line === "Stops what it is doing now.") && said.act === "Restart", `${at} the Restart dialog says that it starts a new conversation (and first, only where bb says the agent works on a turn now, that it stops what it is doing), and it restarts nothing by itself`, JSON.stringify(said));
    await shot("restart-before");
    await page.evaluate(click("oats-confirm-act"));
    await settledAs("done", 180);
    said = await dialog(page);
    check(said.phase === "done" && said.body.includes(`${called} restarted.`), `${at} the dialog says that it restarted`, JSON.stringify(said));
    const restartedOn = (await until(`${name} to be on its next thread`, () => {
      const now = rowOf(name);
      return now?.session?.threadId && now.session.threadId !== startedOn && now.running !== false ? now : undefined;
    }, 120))?.session?.threadId;
    check(Boolean(restartedOn), "oats status: restarted, on a new thread", String(restartedOn));
    await shot("restart-done");
    check(await close(), `${at} Close closes the dialog`);

    // ---- Retire, from the thread's own menu
    const discard = viewport.mobile;
    check(await openThread(restartedOn), `${at} the restarted agent's thread opens from its row`);
    check(await openThreadMenu(page), `${at} the thread's own menu opens`);
    check(await pick(page, "Retire (OATS)"), `${at} Retire (OATS) is pressed`);
    await ready();
    said = await dialog(page);
    check(
      said.title === `Retire ${called}?` && said.about === name && (await saysOf(page))[0] === "This cannot be undone." && (await foldOf(page, "oats-plan-details")).includes("Deletes its home.") && (await foldOf(page, "oats-plan-details")).includes("Keeps its worktree, moved aside") && said.body.includes("Also delete the worktree Off") && said.focus === "oats-confirm-cancel",
      `${at} the Retire dialog is the kernel's plan for ${name}: that it cannot be undone; what goes and what stays under Details; the worktree's choice; the focus on Cancel`,
      JSON.stringify(said),
    );
    if (child !== null) check((await saysOf(page))[1] === `Also stops: ${words(child)}.`, `${at} its child is stopped too: the dialog's second line names it`, said.body);
    if (discard) {
      await page.evaluate(`document.querySelector('[data-testid="oats-plan-choice"] [role="switch"]').click()`);
      await page.until(`document.querySelector('[data-testid="oats-plan-warning"]') !== null`, 10);
      said = await dialog(page);
      check(said.body.includes("Deletes its worktree.") && said.body.includes("Also delete the worktree On"), `${at} with "Also delete the worktree" on, the worktree is among what goes`, said.body);
    }
    await shot("retire-before");
    await page.evaluate(click("oats-confirm-act"));
    await settledAs("done", 300);
    said = await dialog(page);
    check(said.phase === "done" && said.body.includes(`${called} retired.`) && !said.body.includes("Home folder deleted.") && said.body.includes("Worktree kept, at:") === !discard && said.body.includes("Conversation archived in bb."), `${at} the dialog says what a person needs after the retire: ${discard ? "no worktree kept" : "where the worktree was kept"}, and the thread archived`, JSON.stringify(said));
    await until(`${name} to be gone from oats status`, () => (rowOf(name) === undefined ? true : undefined));
    const retire = recorded(["retire", name], ["--plan-revision"]);
    check(retire.argv.includes("--discard-worktree") === discard, `oats retire was asked ${discard ? "with" : "without"} --discard-worktree, under the plan's revision`, JSON.stringify(retire.argv));
    if (discard && theme === "light") fixtures.keep("lifecycle/retire-apply-discard.json", retire.stdout);
    await shot("retire-done");
    check(await close(), `${at} Close closes the dialog`);
    if (child !== null) {
      // The child was stopped and kept; it is retired on the command line so that the run leaves nothing of this part.
      const gone = oats("retire", child, "--json");
      check(gone.exit === 0, `oats retire ${child} (the kept child, after the part)`, gone.stdout || gone.stderr);
    }
  });
};
