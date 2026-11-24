// The Stop dialog's "Before you confirm", on the real kernel (parts/README.md): what it says first
// of the agent a stop would interrupt, FROM FACTS (app/lifecycle/words.ts `stopPlanView`).
//
// The kernel's plan carries `midTask: true` for every session that runs (reported activity: a
// harness is loaded), an idle agent's too, and the dialog said of each "reports it is in the
// middle of a task". It now says two facts, and nothing where there is neither:
//   - "uncommitted work": the plan's own observation of the work tree;
//   - "mid-turn": bb's word on the agent's thread;
//   as words after the agent's name, on its ONE line ("<Name> · uncommitted work · mid-turn").
// In each view one agent of its own, on a worktree, is taken through the three cases, the dialog
// opened from its row's menu each time:
//   idle, its work tree clean     no box at all (the kernel's plan says midTask true all the same);
//   a file left in its work tree  the work line;
//   a turn held open too          the work line, then the turn line; then the stop is confirmed.
// The turn is held open by the run's mock model (a message that holds `MOCK-HOLD:<name>` is not
// answered while the file mock/hold/<name> exists).
import { rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { showSidebar } from "../../browser.mjs";
import { click, closed, dialog, openRowMenu, phaseIs, pick } from "../../scenes/lifecycle.mjs";


export default async (run) => {
  const { step, check, show, until, oats, bb, rowOf, rpc, recorded, evidence, views, DEPLOY, OUT } = run;
  const HOLDS = join(dirname(DEPLOY), "mock", "hold");
  let view = 0;

  await views("real-stop-facts", async ({ page, at, viewport, shot }) => {
    view += 1;
    const name = `stop-facts-${view}-helper`;
    const called = run.nameOf(name); // the instance name as the plugin draws it (scenario.mjs)
    const WORK = `${called} · uncommitted work`;
    const BOTH = `${called} · uncommitted work · mid-turn`;
    step(`C stop-facts ${view}: ${name}, at ${at}: what the Stop dialog says before the confirmation, from facts`);
    const file = join(OUT, `task-${name}.md`);
    writeFileSync(file, "Wait for instructions.\n");
    const made = oats("spawn", "oats-expert", "--backend", "bb", "--yolo", "--name", name, "--task-file", file, "--json");
    check(made.exit === 0, `oats spawn oats-expert --name ${name}`, made.stdout.slice(0, 400) || made.stderr.slice(0, 400));
    const idle = await until(`${name} to be there and idle in oats status`, () => {
      const row = rowOf(name);
      return row?.session?.threadId && run.atRest(row) ? row : undefined;
    }, 120);
    const threadId = idle?.session?.threadId;
    const home = idle?.home;

    /** The Stop dialog, opened from the agent's row once the row is drawn in a state among `states` → what it says, and its "Before you confirm" lines (null: no box). */
    const open = async (states) => {
      rpc("refresh");
      await page.goto("/");
      await showSidebar(page, viewport);
      const rowSelector = `[data-testid="oats-agent-row"][data-sidebar-thread-id="${threadId}"]`;
      const facts = await page.until(`(() => { const facts = document.querySelector(${JSON.stringify(rowSelector)})?.querySelector('[data-testid="oats-row-facts"]')?.getAttribute("title") ?? ""; return ${JSON.stringify(states)}.some((word) => facts.startsWith(word)) ? facts : ""; })()`, 60);
      check(Boolean(facts), `${at} ${called}'s row says ${states.join(" or ")}`, String(facts));
      check(await openRowMenu(page, viewport, threadId), `${at} its row's menu opens`);
      check(await pick(page, "Stop (OATS)"), `${at} Stop (OATS) is pressed`);
      await page.until(phaseIs("ready"), 60);
      const said = await dialog(page);
      const attention = JSON.parse(await page.evaluate(`(() => { const box = document.querySelector('[data-testid="oats-plan-attention"]'); return JSON.stringify(box === null ? null : [...box.querySelectorAll("li")].map((line) => line.innerText.replace(/\\s+/g, " ").trim())); })()`));
      return { said, attention };
    };
    const cancel = async () => {
      await page.evaluate(click("oats-confirm-cancel"));
      check(Boolean(await page.until(closed, 10)), `${at} Cancel closes the dialog, and nothing was stopped`, JSON.stringify(rowOf(name)?.running));
    };
    /** What the kernel's plan said of the agent, as the plugin last asked it. */
    const planned = () => JSON.parse(recorded(["instance", "stop", name], ["--plan"]).stdout).result?.targets?.find((target) => target.instance === name);

    // ---- idle, its work tree clean: no box, though the kernel's plan says midTask true
    let { said, attention } = await open(["Idle"]);
    let target = planned();
    show("the kernel's plan, for the idle agent", { midTask: target?.midTask, session: target?.session, work: target?.work ? { observed: target.work.observed, changed: target.work.changed, untracked: target.work.untracked } : null });
    check(said.title === `Stop ${called}?` && target?.midTask === true && target.work?.observed === true && target.work.changed + target.work.untracked === 0, `${at} the kernel's plan for the idle agent says midTask true (its session runs), and a clean work tree`, JSON.stringify(target ?? null));
    const state = await page.evaluate(`(document.querySelector('[data-testid="oats-plan-details"]')?.textContent ?? "").replace(/\\s+/g, " ").trim()`);
    check(attention === null && !/middle of a task/.test(said.body) && state.includes("Session running"), `${at} IDLE, nothing uncommitted: the dialog has no box of facts at all, and says "Session running" in its current state, under Details`, JSON.stringify({ attention, body: said.body, details: state }));
    await shot("idle");
    if (view === 1) evidence.keep("stop-plan-idle-loaded.json", recorded(["instance", "stop", name], ["--plan"]).stdout);
    await cancel();

    // ---- a file left in its work tree: the work line
    writeFileSync(join(home, "work", "notes-left-behind.txt"), "not committed\n");
    ({ said, attention } = await open(["Idle"]));
    target = planned();
    check(target?.work?.untracked === 1, "the kernel's plan observed one untracked file in its work tree", JSON.stringify(target?.work ?? null));
    check(JSON.stringify(attention) === JSON.stringify([WORK]), `${at} UNCOMMITTED WORK: the box says "${WORK}", and nothing else`, JSON.stringify(attention));
    await shot("work");
    await cancel();

    // ---- a turn held open too: the turn line after the work line; then the stop
    writeFileSync(join(HOLDS, name), "");
    try {
      show("bb thread tell", bb("thread", "tell", threadId, `Keep going on this.\nMOCK-HOLD:${name}\n`).trim());
      const active = await until(`bb to have ${name}'s thread in a turn`, () => (run.bbThread(threadId)?.status === "active" ? run.bbThread(threadId) : undefined), 60);
      check(active?.status === "active", "bb: its thread is in a turn (the mock model holds the answer)", JSON.stringify(active ? { status: active.status } : null));
      ({ said, attention } = await open(["Working"]));
      check(JSON.stringify(attention) === JSON.stringify([BOTH]), `${at} IN A TURN, with uncommitted work: the box says "${BOTH}", on the agent's one line`, JSON.stringify(attention));
      await shot("turn");
      await page.evaluate(click("oats-confirm-act"));
      await page.until(phaseIs("done"), 120);
      said = await dialog(page);
      check(said.phase === "done" && said.body.includes(`${called} stopped.`), `${at} confirmed: the dialog says that it stopped`, JSON.stringify(said));
      await page.evaluate(click("oats-confirm-close"));
      check(Boolean(await page.until(closed, 10)), `${at} Close closes the dialog`);
    } finally {
      rmSync(join(HOLDS, name), { force: true });
    }
    const stopped = await until(`${name} to read stopped in oats status`, () => {
      const row = rowOf(name);
      return row?.running === false && row.runtimeState === "stopped" ? row : undefined;
    });
    check(Boolean(stopped), "oats status: stopped", JSON.stringify(stopped ? { running: stopped.running, runtimeState: stopped.runtimeState } : null));
    const gone = oats("retire", name, "--discard-worktree", "--json");
    check(gone.exit === 0, `oats retire ${name} --discard-worktree (after the part)`, gone.stdout.slice(0, 300) || gone.stderr.slice(0, 300));
  });
};
