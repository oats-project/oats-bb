// The instance panel's live scenes (container/live-ui.mjs says what a scene is): the Instance tab of
// an agent that needs you, with its sections open, its Soul tab, and a stopped agent. At 1280x800
// the panel is the OATS tab of the agent's thread; at 390x800, where bb has no side panel, it is
// the agent's own page.
//
// Their stage has the fake `oats` print the roster recorded from the real kernel for the panel
// (test/fixtures/panel/status-soul-moved.json: a child on its own worktree, idle in bb, whose board
// asked a question and whose soul's repository moved on; and its parent, stopped), with its two
// thread ids replaced by two of the threads the live checks made in bb.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { testId, textOf, visible } from "../browser.mjs";

const FIXTURE = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "test", "fixtures", "panel", "status-soul-moved.json");
const CHILD = { instance: "panel-worktree-helper", recorded: "thr_gx4sgexjgw", thread: "thr_mockups" };
const PARENT = { instance: "redesign-ui-lead", recorded: "thr_uz64t6aahn", thread: "thr_redesign" };

export const stages = {
  panel: {
    label: "P1",
    enter: async ({ fake, threads, untilSnapshot }) => {
      let status = readFileSync(FIXTURE, "utf8");
      for (const agent of [CHILD, PARENT]) status = status.replaceAll(agent.recorded, threads.get(agent.thread).id);
      fake({ status: { stdout: status } });
      await untilSnapshot((snapshot) => snapshot.ok === true && snapshot.agents.some((agent) => agent.instance === CHILD.instance && agent.threadId === threads.get(CHILD.thread).id));
    },
  },
};

const inPanel = (id) => `${testId("oats-panel")} ${testId(id)}`;
/** The header's state: [the mark's state, the word, what follows it, whether the mark is hidden from a screen reader]. */
const stateOf = `(() => { const line = document.querySelector(${JSON.stringify(`${testId("oats-panel")} ${testId("oats-panel-state")} ${testId("oats-status-line")}`)}); const state = line?.querySelector(${JSON.stringify(testId("oats-state"))}); const mark = state?.querySelector("[data-state]"); const word = state?.querySelector("span:not([data-state])")?.innerText.trim() ?? ""; const rest = [...(line?.children ?? [])].slice(1).map((e) => e.innerText.trim()).join(" "); return JSON.stringify([mark?.getAttribute("data-state"), word, rest, mark?.getAttribute("aria-hidden") === "true"]); })()`;
const click = (selector) => `document.querySelector(${JSON.stringify(selector)}).click()`;

/** Shows the panel of `agent`: the OATS tab of its thread, or on a phone its own page. */
async function open(page, viewport, threads, agent) {
  if (viewport.mobile) {
    await page.goto(`/plugins/oats/agent/${agent.instance}`);
  } else {
    const thread = threads.get(agent.thread);
    await page.goto(`/projects/${thread.projectId}/threads/${thread.id}`);
    await page.until(visible(testId("oats-chip-oats")), 30);
    await page.evaluate(click(testId("oats-chip-oats")));
  }
  return Boolean(await page.until(`${visible(testId("oats-panel"))} && document.querySelector(${JSON.stringify(inPanel("oats-panel-name"))})?.getAttribute("title") === ${JSON.stringify(agent.instance)}`, 30));
}

/** What the standard asks of every screen: nothing is cut sideways, and every control is high enough to press. */
async function fits(page, viewport) {
  const need = viewport.mobile ? 44 : 32;
  return JSON.parse(
    await page.evaluate(
      `(() => { const panel = document.querySelector(${JSON.stringify(testId("oats-panel"))}); const low = [...panel.querySelectorAll("button, summary, a")].filter((e) => e.getClientRects().length > 0 && e.getBoundingClientRect().height < ${need} - 0.5).map((e) => (e.innerText || e.getAttribute("aria-label") || e.tagName).trim() + " " + Math.round(e.getBoundingClientRect().height)); const wide = [...panel.querySelectorAll("*")].filter((e) => e.getClientRects().length > 0 && e.getBoundingClientRect().right > innerWidth + 0.5).length; return JSON.stringify({ low, wide, scroll: document.documentElement.scrollWidth - innerWidth }); })()`,
    ),
  );
}

export default [
  {
    stage: "panel",
    name: "the Instance tab of an agent that needs you, its sections open, its Soul tab, a stopped agent",
    run: async ({ page, at, viewport, threads, check }) => {
      const where = viewport.mobile ? "the agent's page" : "the OATS tab of the agent's thread";
      check(await open(page, viewport, threads, CHILD), `${at} the panel shows on ${where}`);
      await page.until(visible(inPanel("oats-panel-work-sentence")), 30);
      const tabs = await page.evaluate(`[...document.querySelectorAll('${testId("oats-panel")} [role="tablist"][aria-label="Instance context"] [role="tab"]')].map((e) => e.innerText.trim() + ":" + e.getAttribute("aria-selected")).join(" ")`);
      check(tabs === "Instance:true Soul:false", `${at} the tabs, named Instance context: Instance (selected), Soul`, tabs);
      check((await page.evaluate(textOf(inPanel("oats-panel-name")))) === "Panel worktree helper", `${at} the header names the instance as words`);
      // The state is a mark AND its word; beside its word the mark is hidden from a screen reader, which reads the word.
      const state = await page.evaluate(stateOf);
      check(/^\["needs-you","Needs you","· waiting \d+ (min|h|d) \(since .+\)",true\]$/.test(state), `${at} the header says the state in words beside its mark, and since when: Needs you · waiting …`, state);
      const head = await page.evaluate(textOf(inPanel("oats-panel-waiting-head")));
      check(/^Asked for your attention · waiting \d+ (min|h|d) \(since .+\)$/.test(head), `${at} Needs input: the reason in words, how long and since when`, head);
      check((await page.evaluate(textOf(inPanel("oats-panel-waiting-message")))) === "How should I merge the pull request?", `${at} Needs input: the agent's message`);
      const work = await page.evaluate(textOf(inPanel("oats-panel-work-sentence")));
      check(work === "Works in its own worktree of oats-real, on branch agents/panel-worktree-helper.", `${at} Work: the mode in one sentence`, work);
      const session = await page.evaluate(textOf(inPanel("oats-panel-session")));
      check(["Harness Claude", "Model claude-opus-5-5 · the soul's choice", `Runs in bb · thread ${threads.get(CHILD.thread).id}`, "Started "].every((part) => session.includes(part)), `${at} Session: the harness, the model and where it came from, the thread, since when, each a labelled fact`, session);
      check((await page.evaluate(textOf(inPanel("oats-panel-lineage")))).includes("Parent redesign-ui-lead"), `${at} Lineage: the parent`);
      let fit = await fits(page, viewport);
      check(fit.low.length === 0 && fit.wide === 0 && fit.scroll <= 0, `${at} nothing is cut sideways and every control is high enough to press`, JSON.stringify(fit));
      await page.shot(`panel-${viewport.name}-instance`);

      // the older-build chip and the paths, open
      await page.evaluate(`document.querySelectorAll('${testId("oats-panel")} details').forEach((e) => { e.open = true; })`);
      const drift = await page.evaluate(textOf(inPanel("oats-panel-drift")));
      check(drift.includes("older build") && drift.includes("Its soul's repository has moved on since it was spawned."), `${at} older build opens to what moved since the spawn`, drift);
      const paths = await page.evaluate(textOf(inPanel("oats-panel-paths")));
      check(paths.includes("Folder") && paths.includes("/instances/panel-worktree-helper/work") && paths.includes("Home"), `${at} Paths: the folder and the home, each with its Copy`, paths);
      const copies = await page.evaluate(`[...document.querySelectorAll('${testId("oats-panel-paths")} button')].map((e) => e.getAttribute("aria-label")).join(", ")`);
      check(copies === "Copy folder path, Copy home path", `${at} the Copy buttons are named for what they copy`, copies);
      await page.evaluate(`document.querySelector(${JSON.stringify(inPanel("oats-panel-paths"))}).scrollIntoView({ block: "center" })`);
      fit = await fits(page, viewport);
      check(fit.low.length === 0 && fit.wide === 0 && fit.scroll <= 0, `${at} open, nothing is cut sideways and every control is high enough to press`, JSON.stringify(fit));
      await page.shot(`panel-${viewport.name}-instance-open`);

      // the Soul tab, from the soul's name in the header
      await page.evaluate(click(inPanel("oats-panel-soul-link")));
      check(Boolean(await page.until(`${textOf(inPanel("oats-panel-soul-name"))} === "oats-expert"`, 15)), `${at} the soul's name opens the Soul tab`);
      check((await page.evaluate(textOf(inPanel("oats-panel-soul-description")))) === "OATS expert: answers questions about OATS.", `${at} the Soul tab: the soul's description`);
      await page.evaluate(`document.querySelector(${JSON.stringify(inPanel("oats-panel-details"))}).open = true`);
      const details = await page.evaluate(textOf(inPanel("oats-panel-details")));
      check(details.includes("Details") && /agents root/i.test(details) && details.includes("/agents"), `${at} Details: the agents root, with its Copy`, details);
      check((await page.evaluate(`document.querySelector(${JSON.stringify(inPanel("oats-panel-open-soul"))})?.disabled`)) === false, `${at} Open soul page is offered`);
      fit = await fits(page, viewport);
      check(fit.low.length === 0 && fit.wide === 0 && fit.scroll <= 0, `${at} the Soul tab: nothing is cut sideways and every control is high enough to press`, JSON.stringify(fit));
      await page.shot(`panel-${viewport.name}-soul`);
      await page.evaluate(click(inPanel("oats-panel-open-soul")));
      check(Boolean(await page.until(`location.pathname.endsWith("/plugins/oats/souls/oats-expert")`, 15)), `${at} Open soul page opens the soul on the Souls page`, await page.evaluate("location.pathname"));

      // a stopped agent, in its own folder
      check(await open(page, viewport, threads, PARENT), `${at} the stopped agent's panel shows on ${where}`);
      await page.evaluate(click(inPanel("oats-tab-instance")));
      await page.until(visible(inPanel("oats-panel-work-sentence")), 30);
      const stopped = await page.evaluate(stateOf);
      check(stopped === JSON.stringify(["stopped", "Stopped", "", true]), `${at} a stopped agent's header says Stopped, beside its mark`, stopped);
      check((await page.evaluate(textOf(inPanel("oats-panel-work-sentence")))).startsWith("Has its own folder, not tied to one repository"), `${at} Work: an agent in its own folder`);
      check(!(await page.evaluate(visible(inPanel("oats-panel-waiting")))), `${at} a stopped agent shows no Needs input`);
      await page.shot(`panel-${viewport.name}-instance-stopped`);
      if (viewport.mobile) {
        await page.evaluate(click(testId("oats-agent-back")));
        check(Boolean(await page.until(`location.pathname.endsWith("/threads/${threads.get(PARENT.thread).id}")`, 15)), `${at} Back returns to the agent's thread`, await page.evaluate("location.pathname"));
      }
    },
  },
];
