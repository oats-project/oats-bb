// The lifecycle's part of the real run (parts/README.md): each act through its DIALOG, in the
// browser, against the real kernel and the bb session provider, with the images.
//
// For each view (bb's light and dark themes, at each width) one agent of its own is spawned as a
// person's would be, on its worktree, and then, as a person does it:
//   Stop     from the row's menu in the sidebar: the plan, confirmed; the kernel's row reads stopped
//   Start    from the row's menu: the agent as the kernel has it now; started on a new thread
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
import { click, closed, dialog, menuTexts, openRowMenu, openThreadMenu, phaseIs, pick } from "../../scenes/lifecycle.mjs";

/** An instance name as the plugin's words (app/ui/words.ts `agentName`). */
const words = (instance) => {
  const text = instance.replace(/-+/g, " ").trim();
  return text.charAt(0).toUpperCase() + text.slice(1);
};

export default async (run) => {
  const { step, check, show, note, until, oats, rowOf, rpc, recorded, fixtures, evidence, views, OUT } = run;
  let view = 0;

  /** An agent of its own, spawned on the command line as the plugin's spawn does it (full mode, on bb). */
  const spawn = (name, parent) => {
    const file = join(OUT, `task-${name}.md`);
    writeFileSync(file, "Wait for instructions.\n");
    const made = oats("spawn", "oats-expert", "--backend", "bb", "--yolo", "--name", name, ...(parent ? ["--parent", parent] : []), "--task-file", file, "--json");
    check(made.exit === 0, `oats spawn oats-expert --name ${name}${parent ? ` --parent ${parent}` : ""}`, made.stdout || made.stderr);
  };
  const idle = (name) => until(`${name} to be there and idle in oats status`, () => {
    const row = rowOf(name);
    return row?.session?.threadId && row.running === null ? row : undefined;
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
    check(items.includes("Stop agent (OATS)") && items.includes("Restart agent (OATS)") && items.includes("Retire agent (OATS)") && !items.includes("Start agent (OATS)"), `${at} the menu of an agent that runs holds Stop, Restart and Retire, and no Start`, JSON.stringify(items));
    check(await pick(page, "Stop agent (OATS)"), `${at} Stop agent (OATS) is pressed`);
    await ready();
    let said = await dialog(page);
    check(said.title === `Stop ${called}?` && said.about === name && /what will happen/i.test(said.body) && /what is kept/i.test(said.body) && said.body.includes("Nothing is deleted.") && said.focus === "oats-confirm-cancel", `${at} the Stop dialog is the kernel's plan for ${name}, as what will happen and what is kept, the focus on Cancel`, JSON.stringify(said));
    check(said.body.includes("A message sent in its thread starts it again without OATS. To talk to it again, use Start."), `${at} it says what a stop means for the agent's thread`, said.body);
    if (child !== null) {
      check(said.body.includes(`Stops 2 sessions, children first: ${called}, ${words(child)}.`) && said.body.includes("Include child instances On"), `${at} with a child, the plan stops both, children first, and offers the choice`, said.body);
      // Without the children: the kernel is asked again, for the agent alone.
      await page.evaluate(`document.querySelector('[data-testid="oats-plan-choice"] [role="switch"]').click()`);
      await page.until(`document.querySelector('[data-testid="oats-confirm"]')?.innerText.includes("children not included") && ${phaseIs("ready")} && !document.querySelector('[data-testid="oats-confirm-act"]').disabled`, 60);
      said = await dialog(page);
      check(said.body.includes(`Stops the session of ${called}.`) && said.body.includes(`Not stopped: ${words(child)} (children not included).`) && said.body.includes("Include child instances Off"), `${at} without "Include child instances" the kernel's plan is for ${name} alone, and says who is not stopped`, said.body);
      const alone = recorded(["instance", "stop", name], ["--plan", "--no-recursive"]);
      check(JSON.parse(alone.stdout).result?.recursive === false, "the plugin asked the kernel for the plan with --no-recursive", alone.stdout.slice(0, 300));
      if (theme === "light") fixtures.keep("lifecycle/stop-plan-no-recursive.json", alone.stdout);
      await page.evaluate(`document.querySelector('[data-testid="oats-plan-choice"] [role="switch"]').click()`);
      await page.until(`document.querySelector('[data-testid="oats-confirm"]')?.innerText.includes("Stops 2 sessions") && ${phaseIs("ready")} && !document.querySelector('[data-testid="oats-confirm-act"]').disabled`, 60);
    }
    await shot("stop-before");
    await page.evaluate(click("oats-confirm-act"));
    await settledAs("done", 120);
    said = await dialog(page);
    check(said.phase === "done" && said.body.includes(child === null ? `${called} stopped.` : "2 sessions stopped."), `${at} the dialog says that it stopped`, JSON.stringify(said));
    row = await stopped(name);
    check(row?.session?.threadId === spawnedOn, "oats status: stopped, on the same thread", JSON.stringify(row?.session));
    if (child !== null) await stopped(child);
    await shot("stop-done");
    check(await close(), `${at} Close closes the dialog`);

    // ---- Start, from the row's menu
    check(await rowDrawn(spawnedOn), `${at} the stopped agent keeps its row`);
    check(await openRowMenu(page, viewport, spawnedOn), `${at} its row's menu opens`);
    check(await pick(page, "Start agent (OATS)"), `${at} Start agent (OATS) is pressed`);
    await ready();
    said = await dialog(page);
    check(said.title === `Start ${called}` && said.about === name && said.body.includes("Ready to start.") && said.body.includes("Runs in bb's full mode: no sandbox.") && said.body.includes("Starts a new conversation. The current one stays readable in bb, archived.") && said.act === "Start" && said.off === false, `${at} the Start dialog names the agent as the kernel has it now, says that it starts a new conversation, and starts nothing by itself`, JSON.stringify(said));
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
    check(await pick(page, "Restart agent (OATS)"), `${at} Restart agent (OATS) is pressed`);
    await ready();
    said = await dialog(page);
    check(said.title === `Restart ${called}` && said.body.includes("Restart stops the current harness after checking the new configuration.") && said.body.includes("Starts a new conversation. The current one stays readable in bb, archived.") && said.act === "Restart", `${at} the Restart dialog says that the current harness is stopped first and that it starts a new conversation, and restarts nothing by itself`, JSON.stringify(said));
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
    check(await pick(page, "Retire agent (OATS)"), `${at} Retire agent (OATS) is pressed`);
    await ready();
    said = await dialog(page);
    check(
      said.title === `Retire ${called}?` && said.about === name && said.body.includes("Saves a recovery copy of any uncommitted work, then deletes its home folder.") && said.body.includes("This cannot be undone. Its conversation stays readable in bb, archived.") && said.body.includes("Keeps its worktree, moved aside") && said.body.includes("Also delete the worktree Off") && said.focus === "oats-confirm-cancel",
      `${at} the Retire dialog is the kernel's plan for ${name}: what goes, what stays, the worktree's choice, the focus on Cancel`,
      JSON.stringify(said),
    );
    if (child !== null) check(said.body.includes(`Stops its 1 child instance first: ${words(child)}. They are kept, with their homes.`), `${at} its child is stopped first and kept`, said.body);
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
    check(said.phase === "done" && said.body.includes(`${called} retired.`) && said.body.includes("Home folder deleted.") && said.body.includes(discard ? "Worktree deleted." : "Worktree kept at") && said.body.includes("Its conversation stays readable in bb, archived."), `${at} the dialog says what the retire did: the home, the worktree ${discard ? "deleted" : "kept"}, and the thread archived`, JSON.stringify(said));
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
