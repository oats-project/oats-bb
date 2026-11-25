// An agent on tmux, in bb (parts/README.md): its TERMINAL. One agent on the tmux backend, on the
// real kernel, and on its own page the button "Terminal", which opens bb's own Terminal tab on the
// kernel's viewer of its session (plugin/README.md, "A tmux agent's terminal").
//
// It runs after lost.mjs (the files' order), which prepares the container for an agent on tmux
// (the OATS tmux server with the run's PATH, Claude Code's first-run answers and folder trust):
// this part needs that, and says so where it is not there.
//
// WHAT IT ASSERTS, in every view (bb's light and dark themes, at each width):
//   the tab    a press of Terminal shows bb's terminal, titled with the agent's name, and tmux
//              then holds ONE client: the kernel's viewer (a temporary session `oatsview-…`
//              linked to the agent's window), never a client of the agents' own session;
//   the keys   what is typed in the tab reaches the agent: its pane holds the line;
//   one tab    a second press shows the same terminal: still one client, one terminal of bb's;
//   closing    closing the terminal leaves the agent running, in its window.
// And once, at the end: the agent stopped with OATS while its tab is open: the tab stays (the
// window is at a shell), the page says "Stopped", and Terminal is gone from it.
import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { hostname } from "node:os";
import { join } from "node:path";

const NAME = "seen-tmux-developer";
const SOUL = "oats-developer";
const CALLED = "Seen tmux developer"; // the instance name as the plugin's words: also the tab's title
const SESSION = "oats-agents";

export default async (run) => {
  const { step, check, show, note, until, sleep, oats, rowOf, views, DEPLOY, OUT } = run;
  const sh = (command, args, options = {}) => {
    const done = spawnSync(command, args, { encoding: "utf8", ...options });
    return { exit: done.status, stdout: done.stdout ?? "", stderr: done.stderr ?? "" };
  };
  const row = () => rowOf(NAME);
  const clients = () => sh("tmux", ["-L", "oats", "list-clients", "-F", "#{client_session}"]).stdout.split("\n").filter(Boolean);
  const pane = () => sh("tmux", ["-L", "oats", "capture-pane", "-p", "-t", `${SESSION}:${NAME}`]).stdout;
  /**
   * bb's terminals on this machine that have not ended, by its own CLI: their ids. (`bb terminal
   * list` lists exactly one scope: the machine's; `bb terminal close` takes an id and no flag.)
   * A list bb refuses is said, never read as "none": a helper that is blind fails where it is blind.
   */
  const terminals = () => {
    const listed = sh("bb", ["terminal", "list", "--machine", hostname(), "--json"]);
    let rows = null;
    try {
      const parsed = JSON.parse(listed.stdout);
      rows = Array.isArray(parsed) ? parsed : (parsed.sessions ?? parsed.terminals ?? null);
    } catch {
      rows = null;
    }
    if (listed.exit !== 0 || !Array.isArray(rows)) {
      check(false, "bb terminal list --machine <this machine> --json answers the machine's terminals", `exit ${listed.exit}: ${(listed.stdout || listed.stderr).slice(0, 300)}`);
      return [];
    }
    return rows.filter((row) => row.status !== "exited").map((row) => row.id);
  };
  const closeAll = () => terminals().forEach((id) => sh("bb", ["terminal", "close", id]));

  step(`C on-tmux: one agent on the tmux backend (${NAME}), for its terminal`);
  if (sh("tmux", ["-L", "oats", "has-session", "-t", SESSION]).exit !== 0) {
    check(false, "the OATS tmux server is up (lost.mjs prepares the container for an agent on tmux, before this part)", "tmux -L oats has-session: no");
    note("NO TERMINAL IN THIS RUN: nothing of a tmux agent's terminal was proven");
    return;
  }
  const file = join(OUT, `task-${NAME}.md`);
  writeFileSync(file, "Say hello, then wait.\n");
  const made = oats("spawn", SOUL, "--backend", "tmux", "--name", NAME, "--task-file", file, "--json");
  const spawned = made.exit === 0 ? JSON.parse(made.stdout).result : null;
  check(spawned?.launched === true && spawned.tmux?.window === NAME, `oats spawn ${SOUL} --backend tmux --name ${NAME}: launched, in a window of the OATS tmux server`, made.stdout.slice(0, 500) || made.stderr.slice(0, 500));
  if (spawned?.launched !== true) {
    note("NO TERMINAL IN THIS RUN: the kernel did not launch the agent on tmux");
    return;
  }
  await until(`${NAME} to run in oats status`, () => (row()?.running === true ? row() : undefined), 90);
  closeAll();

  const BUTTON = '[data-testid="oats-terminal-open"]';
  const xterm = `[...document.querySelectorAll(".xterm")].filter((x) => x.getBoundingClientRect().width > 0).length`;
  const tabs = `[...document.querySelectorAll('[role=tab],button')].filter((b) => b.getBoundingClientRect().width > 0 && (b.innerText ?? "").trim() === ${JSON.stringify(CALLED)}).length`;
  /** One printable key into the terminal that is in view, as its own input takes it. */
  const key = (ch) => {
    const code = ch.toUpperCase().charCodeAt(0);
    return `(() => { const t = [...document.querySelectorAll(".xterm textarea")].find((x) => x.closest(".xterm").getBoundingClientRect().width > 0); if (!t) return false; t.focus(); t.dispatchEvent(new KeyboardEvent("keydown", { key: ${JSON.stringify(ch)}, code: ${JSON.stringify(`Key${ch.toUpperCase()}`)}, keyCode: ${code}, which: ${code}, bubbles: true, cancelable: true })); return true; })()`;
  };

  await views("on-tmux", async ({ page, at, shot }) => {
    step(`C on-tmux, at ${at}: Terminal on the agent's page`);
    await page.goto(`/plugins/oats/agent/${NAME}`);
    const there = await page.until(`document.querySelector(${JSON.stringify(BUTTON)})?.disabled === false`, 60);
    check(Boolean(there), `${at} the page of the tmux agent that runs has Terminal, over its attach command`, await page.evaluate(`document.querySelector('[data-testid="oats-panel-attach"]')?.innerText ?? document.body.innerText.slice(0, 300)`));
    if (!there) return;
    await page.evaluate(`document.querySelector(${JSON.stringify(BUTTON)}).click()`);
    const shown = await page.until(`${xterm} === 1 && document.querySelector(${JSON.stringify(BUTTON)}).disabled === false`, 30);
    const attached = await until(`the kernel's viewer to be attached (${at})`, () => (clients().some((name) => name.startsWith("oatsview-")) ? clients() : undefined), 20);
    check(Boolean(shown) && (await page.evaluate(tabs)) >= 1, `${at} a press shows bb's terminal, in a tab titled "${CALLED}"; the page says nothing`, `${await page.evaluate(`document.querySelector('[data-testid="oats-terminal"]')?.innerText`)} | terminals in view: ${await page.evaluate(xterm)}`);
    check(Array.isArray(attached) && attached.length === 1 && attached[0].startsWith("oatsview-"), `${at} tmux holds ONE client, the kernel's viewer (a session of its own, linked to the agent's window)`, JSON.stringify(clients()));
    const first = terminals();
    check(first.length === 1, `${at} and bb holds ONE terminal on this machine: the one the press created`, JSON.stringify(first));
    await shot("terminal");
    // The keys: a line typed in the tab is typed to the agent.
    const token = `seen${"abcdefghij"[Date.now() % 10]}${"klmnopqrst"[Math.floor(Date.now() / 10) % 10]}`; // letters alone: each is one key
    for (const ch of token) await page.evaluate(key(ch));
    await sleep(500);
    await page.press("Enter");
    const arrived = await until(`the typed line in the agent's pane (${at})`, () => (pane().includes(token) ? token : undefined), 30);
    check(arrived === token, `${at} what is typed in the tab reaches the agent: its pane holds "${token}"`, pane().split("\n").filter((line) => line.trim() !== "").slice(-6).join(" | "));
    // One tab: a second press shows the same terminal.
    await page.evaluate(`document.querySelector(${JSON.stringify(BUTTON)}).click()`);
    await page.until(`document.querySelector(${JSON.stringify(BUTTON)}).disabled === false`, 30);
    await sleep(1500);
    const second = terminals();
    check(clients().length === 1 && second.length === 1 && second[0] === first[0], `${at} pressed again: the same terminal (found by its title and its home), still one client and one terminal of bb's`, `clients ${JSON.stringify(clients())}, terminals ${JSON.stringify(second)} (first ${JSON.stringify(first)})`);
    // Closing the terminal leaves the agent running, in its window.
    closeAll();
    await until(`no client attached (${at})`, () => (clients().length === 0 ? true : undefined), 20);
    check(clients().length === 0 && row()?.running === true && sh("tmux", ["-L", "oats", "list-windows", "-t", SESSION, "-F", "#{window_name}"]).stdout.split("\n").includes(NAME), `${at} the terminal closed: no client is left, and the agent runs on in its window`, `clients ${JSON.stringify(clients())}, running ${row()?.running}`);
  });

  step("C on-tmux, the agent stopped with OATS while its tab is open");
  await views("on-tmux-stopped", async ({ page, at, shot }) => {
    if (!at.includes("light 1280x800")) return; // once: one state, one view
    const again = oats("session", "start", "--home", join(DEPLOY, "agents", SOUL, "instances", NAME), "--json");
    if (row()?.running !== true) await until(`${NAME} to run again`, () => (row()?.running === true ? row() : undefined), 90);
    show("start (if it was stopped)", again.stdout.slice(0, 160) || again.stderr.slice(0, 160));
    await page.goto(`/plugins/oats/agent/${NAME}`);
    await page.until(`document.querySelector(${JSON.stringify(BUTTON)})?.disabled === false`, 60);
    await page.evaluate(`document.querySelector(${JSON.stringify(BUTTON)}).click()`);
    await page.until(`${xterm} === 1`, 30);
    const plan = oats("instance", "stop", NAME, "--plan", "--json");
    const revision = plan.exit === 0 ? JSON.parse(plan.stdout).result.planRevision : null;
    const stopped = oats("instance", "stop", NAME, "--apply", "--plan-revision", String(revision), "--idempotency-key", `on-tmux-stop-${Date.now()}`, "--json");
    check(stopped.exit === 0, `oats instance stop ${NAME}`, stopped.stdout.slice(0, 300) || stopped.stderr.slice(0, 300));
    const said = await page.until(`(() => { const s = document.querySelector('[data-testid="oats-panel-state"]')?.innerText.replace(/\\s+/g, " ").trim(); return s === "Stopped" ? s : ""; })()`, 60);
    check(said === "Stopped" && (await page.evaluate(`document.querySelector(${JSON.stringify(BUTTON)}) === null`)), `${at} the page says "Stopped", and Terminal is gone from it with the state`, String(said));
    check((await page.evaluate(xterm)) === 1 && clients().length === 1, `${at} the tab stays, and shows the window as it is (a shell, after the kernel's stop): one client still`, `terminals in view ${await page.evaluate(xterm)}, clients ${JSON.stringify(clients())}`);
    await shot("tab-after-stop");
    closeAll();
  });

  step(`C on-tmux, the end: ${NAME} is retired`);
  const gone = oats("retire", NAME, "--json");
  check(gone.exit === 0, `oats retire ${NAME}`, gone.stdout.slice(0, 400) || gone.stderr.slice(0, 400));
};
