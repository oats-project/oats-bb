// A tmux agent's terminal: the live scene (container/live-ui.mjs says what a scene is).
//
// The live checks have a fake `oats`, no tmux, and homes that are not on the disk (the fixtures'
// `/abs/deployment/…`): there is no session to attach to, and bb itself refuses a terminal in a
// directory that is not there. So this holds what a person sees where the tab does NOT come up, in
// the real bb: the button on the page of the agent on tmux that runs, a press, the command the
// server answered (the fake by its absolute path, with the flags its version lists), bb's
// refusal, and the page's ONE line with its fold, which says the command and bb's own words. That
// the tab comes up attached, takes keys and is one per agent is the real run's
// (container/real/parts/on-tmux.mjs), on a real kernel and tmux; that a command which ends at
// once is said with its status is the unit tests' (test/terminal).
import { testId } from "../browser.mjs";

const TMUX = "kernel-fix-developer"; // the fixtures' agent on tmux, which runs

export default [
  {
    stage: "fixtures",
    name: "a tmux agent's page has Terminal over its attach command; where the tab does not come up the page says one line, and its fold says which",
    run: async ({ page, at, viewport, check }) => {
      await page.goto(`/plugins/oats/agent/${TMUX}`);
      const open = testId("oats-terminal-open");
      const there = await page.until(`document.querySelector(${JSON.stringify(open)})?.disabled === false`, 40);
      const attach = `(() => { const e = document.querySelector(${JSON.stringify(testId("oats-panel-attach"))}); return e ? JSON.stringify({ buttons: [...e.querySelectorAll("button")].map((b) => b.getAttribute("aria-label") ?? b.innerText.trim()), command: e.querySelector(${JSON.stringify(testId("oats-command"))})?.innerText ?? null, title: e.querySelector(${JSON.stringify(open)})?.title ?? null }) : ""; })()`;
      const drawn = there ? JSON.parse(await page.evaluate(attach)) : null;
      check(
        drawn !== null && JSON.stringify(drawn.buttons) === JSON.stringify(["Terminal", "Copy the attach command"]) && /^oats session attach --home \S+$/.test(drawn.command ?? "") && drawn.title === "",
        `${at} the Session card of the tmux agent that runs: Terminal, then "Attach:" and the command to copy; no tooltip`,
        there ? JSON.stringify(drawn) : await page.evaluate(`document.body.innerText.slice(0, 300)`),
      );
      if (!there) return;
      await page.shot(`terminal-${viewport.name}-button`, { targets: true });
      await page.evaluate(`document.querySelector(${JSON.stringify(open)}).click()`);
      const said = await page.until(`document.querySelector(${JSON.stringify(testId("oats-terminal-said"))})?.innerText.trim() ?? ""`, 30);
      const fold = `(() => { const d = document.querySelector(${JSON.stringify(testId("oats-terminal-details"))}); if (!d) return ""; d.open = true; return JSON.stringify([...d.querySelectorAll("p")].map((p) => p.innerText.trim())); })()`;
      const lines = said ? JSON.parse(await page.evaluate(fold)) : [];
      check(
        said === "Terminal did not open." && lines.length === 2 && / session attach --home \S+ --detach-key C-\\ --no-status-line$/.test(lines[0]) && lines[0].startsWith("/") && /Terminal failed to open/.test(lines[1]),
        `${at} bb refuses the terminal (the fixtures' home is not on the disk): "Terminal did not open.", and under Details the command (oats by its absolute path, the viewer's two flags) and bb's own words`,
        `${said} ${JSON.stringify(lines)}`,
      );
      check((await page.evaluate(`document.querySelector(${JSON.stringify(open)}).disabled`)) === false && (await page.evaluate(`document.querySelectorAll(".xterm").length`)) === 0, `${at} no terminal is left in view, and Terminal is on again`, "");
      await page.shot(`terminal-${viewport.name}-did-not-open`, { targets: true });
    },
  },
];
