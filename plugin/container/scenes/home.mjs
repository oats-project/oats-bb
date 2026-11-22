// The home's live scenes: every state of the home as a person meets it, at both widths and in both
// themes, each read before its image is taken.
//
//   detached     an agent whose session failed, one the kernel cannot reach, one whose bb thread is
//                gone: in the summary and in Home › Agents
//   fixtures     the recorded roster: three agents need the person (each card with its own reply),
//                the summary, the tiles, who works, what is finished; Home › Agents; a tile whose
//                count cannot be read; how soon a change the kernel records is on the home
//   home-many    eleven agents need the person, one of them on tmux: eight cards, then all
//   home-empty   a workspace with no agent
//   home-stale   OATS cannot be read after it was: the roster as last read, its acts held
//
// In `fixtures` also: the release's default (the home alone), a first read (loading, and one that
// fails), the installed oats older than the plugin works with, one that speaks a newer
// desktop API, one of a later minor than the plugin was tested with.
//
// A scene that opens, presses or changes something waits on what it then reads, and a failing
// check prints what it read (`printing`). Every image is measured (`sound`): nothing the home
// draws is past the window's edge, no word is broken across two lines, no two controls overlap,
// every control is high enough to press.
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { fill, testId, textOf, texts } from "../browser.mjs";
import { FAILS, fits, printing, refresh, setVerb, settled } from "./panel.mjs";

/** The recorded `oats version --json`, for a scene that changes what is installed. */
const VERSION = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "..", "test", "fixtures", "roster", "version.json"), "utf8"));
const STATUS = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "test", "fixtures", "roster", "status.json");
const HOME = "/plugins/oats/home";
const PAGE = testId("oats-home-page");
const within = (id) => `${PAGE} ${testId(id)}`;
const click = (selector) => `document.querySelector(${JSON.stringify(selector)}).click()`;
const card = (instance) => `${PAGE} [data-testid="oats-needs-card"][data-instance="${instance}"]`;
/** A section's heading as a person reads it: "Needs you 3". */
const headingOf = (id) => `(document.querySelector(${JSON.stringify(`${within(id)} h2`)})?.innerText ?? "").replace(/\\s+/g, " ").trim()`;
const heading = (id, words) => `new RegExp(${JSON.stringify(`^${words}$`)}, "i").test(${headingOf(id)})`;

/** The recorded roster with bb's own thread ids, changed for a stage. */
function roster(threads, change = () => {}) {
  const status = JSON.parse(readFileSync(STATUS, "utf8"));
  for (const group of status.agents) {
    for (const row of group.instances) {
      const real = row.session ? threads.get(row.session.threadId) : undefined;
      if (real !== undefined) row.session.threadId = real.id;
    }
  }
  change(status);
  return JSON.stringify(status);
}
/** The recorded tmux row, as a new agent that asks: an agent with no thread in bb. */
function asking(status, instance, minute, message) {
  const group = status.agents.find((each) => each.instances.some((row) => row.backend === "tmux"));
  const row = structuredClone(group.instances.find((each) => each.backend === "tmux"));
  const text = JSON.stringify(row).replaceAll(row.instance, instance);
  group.instances.push({ ...JSON.parse(text), running: true, runtimeState: "running", waitingOnYou: { reason: "attention", message, since: `2026-11-19T12:${String(minute).padStart(2, "0")}:00.000Z` } });
}
const MANY = 8;

export const stages = {
  "home-many": {
    label: "H2",
    enter: async ({ fake, threads, untilSnapshot }) => {
      fake({ status: { stdout: roster(threads, (status) => {
        for (let index = 0; index < MANY; index += 1) asking(status, `sweep-${index + 1}-helper`, 40 + index, `Sweep ${index + 1} is done: keep its checkpoint?`);
      }) } });
      await untilSnapshot((snapshot) => snapshot.ok === true && snapshot.agents.filter((agent) => agent.instance.startsWith("sweep-")).length === MANY);
    },
  },
  "home-empty": {
    label: "H3",
    enter: async ({ fake, threads, untilSnapshot }) => {
      fake({ status: { stdout: roster(threads, (status) => void (status.agents = status.agents.map((group) => ({ ...group, instances: [] })))) } });
      await untilSnapshot((snapshot) => snapshot.ok === true && snapshot.agents.length === 0);
    },
  },
  "home-stale": {
    label: "H4",
    enter: async ({ fake, threads, untilSnapshot }) => {
      fake({ status: { stdout: roster(threads) } });
      await untilSnapshot((snapshot) => snapshot.ok === true && snapshot.agents.length > 0);
      fake({ status: FAILS });
      await untilSnapshot((snapshot) => snapshot.ok === false && snapshot.last !== undefined && snapshot.last !== null);
    },
  },
};

const FAKE_CONFIG = join(homedir(), ".local/bin/fake-oats.json");
/** What the fake `oats` answers for a verb now (undefined: its recorded answer), to put it back after a scene changed it. */
const verbNow = (verb) => JSON.parse(readFileSync(FAKE_CONFIG, "utf8")).verbs?.[verb];
/** The plugin's own snapshot, as a client reads it. */
function snapshot() {
  const input = join(homedir(), "home-snapshot-input.json");
  writeFileSync(input, "null");
  const answer = JSON.parse(execFileSync("bb", ["plugin", "rpc", "call", "oats", "snapshot", "--input-file", input, "--json"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }));
  return answer.value ?? answer.result ?? answer;
}
/** Waits until the plugin's snapshot is one `matches` holds for. → that snapshot, or undefined after `seconds`. */
async function untilRoster(matches, seconds = 40) {
  const deadline = Date.now() + seconds * 1000;
  while (Date.now() < deadline) {
    try {
      refresh();
      const read = snapshot();
      if (matches(read)) return read;
    } catch {
      // the server is between two settings: asked again below
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return undefined;
}
/** Every page of the plugin, for the setting `pages` (the release's default is `home` alone). Two spellings of one value: setting the other is a change. */
const EVERY_PAGE = ["home, automations, souls, capabilities, teams, machines", "home,automations,souls,capabilities,teams,machines"];
let spelled = -1;
/**
 * Sets which pages are shown. A change of the plugin's settings also makes its server forget the
 * roster it holds (it may be another deployment's): the next read is a first read. `value` left
 * out: every page, in the spelling that is a change from the last one set here.
 */
function pages(value) {
  if (value === undefined) spelled = (spelled + 1) % EVERY_PAGE.length;
  execFileSync("bb", ["plugin", "config", "oats", "set", "pages", value ?? EVERY_PAGE[spelled]], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}
/** Every page is shown, and the roster is read: what every scene but the default's starts from. */
async function everyPage(check, at) {
  if (spelled === -1) pages();
  const read = await untilRoster((roster) => roster.ok === true);
  check(read !== undefined, `${at} every page is shown, and the roster is read`, JSON.stringify(read ?? null).slice(0, 300));
}
/** No tile still counts: an image shows one state (a scene about "Counting…" would not wait for this). */
const counted = `![...document.querySelectorAll(${JSON.stringify(`${PAGE} ${testId("oats-home-tiles")} button`)})].some((tile) => tile.innerText.includes("Counting"))`;

/** The every-image check, on the home's page. */
async function sound(page, viewport, check, at, what) {
  await settled(page, viewport);
  await page.until(counted, 20);
  const fit = await fits(page, viewport, PAGE);
  check(
    fit.low.length === 0 && fit.wide === 0 && fit.scroll <= 0 && fit.broken.length === 0 && fit.overlap.length === 0 && fit.turned.length === 0,
    `${at} ${what}: nothing the home draws is past the window's edge, no word or id is broken across two lines, no two controls overlap, a fold's mark is turned when its fold is open and only then, and every control is high enough to press`,
    JSON.stringify(fit),
  );
}
/** Brings a part of the home to the top of what is seen for its image, with half of the gap above it and nothing of the part before it. → whether its start is in view. */
const bring = (selector) =>
  `(() => { const part = document.querySelector(${JSON.stringify(selector)}); if (!part) return false; part.scrollIntoView({ block: "start" }); const pane = document.querySelector(${JSON.stringify(PAGE)}); pane.scrollTop = Math.max(0, pane.scrollTop - 8); const box = part.getBoundingClientRect(); return box.top >= 0 && box.top < innerHeight - 80; })()`;
async function shown(page, check, at, selector, what) {
  const inView = await page.evaluate(bring(selector));
  check(inView === true, `${at} ${what} is in view for its image, from its start`, inView);
}
/** Opens the home and waits until it has drawn `selector`, in view or further down the page. → whether it did. */
async function open(page, selector, path = HOME) {
  await page.goto(path);
  return Boolean(await page.until(`document.querySelector(${JSON.stringify(selector)}) !== null`, 30));
}

export default [
  {
    stage: "fixtures",
    name: "the home: what needs you, each card with its reply; the summary, the tiles, who works",
    run: async ({ page, at, viewport, check: plain }) => {
      const check = printing(plain);
      await everyPage(check, at);
      check(await open(page, within("oats-needs-card")), `${at} the home draws its cards`, await page.evaluate(textOf(PAGE)));
      check((await page.evaluate(textOf(within("oats-home-title")))) === "Home", `${at} the page is headed "Home"`, await page.evaluate(textOf(within("oats-home-title"))));
      const needs = await page.until(`${heading("oats-home-needs", "needs you 3")} ? ${headingOf("oats-home-needs")} : ""`, 15);
      check(Boolean(needs), `${at} three agents need the person`, await page.evaluate(headingOf("oats-home-needs")));
      // every card: the agent's name as words, its soul and machine, what it asks, and the answer its request takes
      const cards = JSON.parse(await page.evaluate(`JSON.stringify([...document.querySelectorAll(${JSON.stringify(within("oats-needs-card"))})].map((card) => ({ instance: card.dataset.instance, offer: card.dataset.offer, name: card.querySelector('[data-testid="oats-needs-name"]')?.innerText.trim(), state: card.querySelector('[data-testid="oats-state"]')?.innerText.replace(/\\s+/g, " ").trim(), open: card.querySelector('[data-testid="oats-needs-open"]')?.innerText.trim(), replyShown: [...card.querySelectorAll('[data-testid="oats-reply-text"]')].some((box) => box.checkVisibility()), reply: card.querySelector('[data-testid="oats-reply-text"]')?.getAttribute("aria-label") ?? null, text: card.innerText.replace(/\\s+/g, " ").trim() })))`));
      check(cards.length === 3 && cards.every((each) => each.reply === `Reply to ${each.name}` && /needs you/i.test(each.state ?? "") && !each.name.includes("-") && each.open === "Open thread"), `${at} each card names its agent in words, says it needs the person, and says where Open leads`, JSON.stringify(cards));
      check(cards.some((each) => each.instance === "release-070-maintainer" && each.name === "Release 070 maintainer" && each.text.includes("Green light at 9f2e1c? Second reader done.")), `${at} a card says what its agent asks, in the agent's words`, JSON.stringify(cards));
      // an agent that asks in its own words is answered by the reply on its card; one that waits for an approval is not offered a message as its answer
      const byOffer = Object.fromEntries(cards.map((each) => [each.instance, [each.offer, each.replyShown]]));
      check(byOffer["ranker-v3-probe"]?.join() === "reply,true" && byOffer["release-070-maintainer"]?.join() === "reply,true" && byOffer["flaky-ci-developer"]?.join() === "in-thread,false", `${at} the two that ask in their own words have the reply on their card; the one that waits for an approval has none in view`, JSON.stringify(byOffer));
      const permission = cards.find((each) => each.instance === "flaky-ci-developer");
      check(permission.text.includes("It waits for an approval, and bb lists no request to answer here: open its thread to see what it waits for.") && permission.text.includes("Write a message instead"), `${at} the approval's card says where its answer is, and keeps a message behind "Write a message instead"`, permission.text);
      // the summary counts every agent once, and agrees with the foot of the sidebar
      const summary = await page.evaluate(textOf(within("oats-home-summary")));
      const counted = summary.split(" · ").map((part) => Number(part.split(" ")[0]));
      check(/^8 agents · \d+ working · 3 need you/.test(summary) && counted.slice(1).reduce((sum, n) => sum + n, 0) === counted[0], `${at} the summary counts each of the 8 agents once, by its state`, summary);
      if (!viewport.mobile) {
        const foot = await page.evaluate(textOf(testId("oats-needs-line")));
        check(/^!?\s*3 need you$/.test(foot), `${at} and the sidebar's foot says the same number as the home`, foot);
      }
      await sound(page, viewport, check, at, "the home");
      await page.shot(`home-${viewport.name}-home`);

      // a message typed on the card of an agent that asks in its own words: Send of that card alone, and all of what is written in view
      const mine = card("ranker-v3-probe");
      const written = "Keep depth 6 and sweep lr first; try depth 7 only if the sweep's best run is under 0.71, and tell me which it was.";
      await page.evaluate(fill(`${mine} ${testId("oats-reply-text")}`, written));
      const sends = await page.until(`(() => { const sends = [...document.querySelectorAll(${JSON.stringify(within("oats-reply-send"))})].filter((send) => send.checkVisibility()).map((send) => [send.closest('[data-testid="oats-needs-card"]').dataset.instance, send.disabled]); return sends.filter(([, off]) => !off).length === 1 ? JSON.stringify(sends) : ""; })()`, 10);
      check(Boolean(sends) && JSON.parse(sends).some(([instance, off]) => instance === "ranker-v3-probe" && off === false), `${at} a message typed on one card enables Send on that card only`, sends);
      const box = JSON.parse(await page.evaluate(`(() => { const box = document.querySelector(${JSON.stringify(`${mine} ${testId("oats-reply-text")}`)}); return JSON.stringify({ shown: box.clientHeight, needs: box.scrollHeight, lines: Math.round(box.scrollHeight / parseFloat(getComputedStyle(box).lineHeight)) }); })()`));
      check(box.needs <= box.shown + 1 && (viewport.mobile ? box.lines > 1 : true), `${at} the box is as high as what is written in it: nothing of the message is cut`, JSON.stringify(box));
      await shown(page, check, at, mine, "the card being answered");
      await sound(page, viewport, check, at, "a reply being written");
      await page.shot(`home-${viewport.name}-reply`);
      await page.evaluate(fill(`${mine} ${testId("oats-reply-text")}`, ""));

      // the approval's card with "Write a message instead" opened: what a message does not do, then the box
      const waits = card("flaky-ci-developer");
      await page.evaluate(click(`${waits} ${testId("oats-needs-message")} summary`));
      const instead = await page.until(`(() => { const fold = document.querySelector(${JSON.stringify(`${waits} ${testId("oats-needs-message")}`)}); return fold?.open && fold.querySelector('[data-testid="oats-reply-text"]')?.checkVisibility() ? fold.innerText.replace(/\\s+/g, " ").trim() : ""; })()`, 10);
      check(Boolean(instead) && instead.includes("A message does not answer its request: it grants nothing, and the request stays open."), `${at} "Write a message instead" says what a message does not do, then offers the box`, instead ?? (await page.evaluate(textOf(waits))));
      await shown(page, check, at, waits, "the approval's card");
      await sound(page, viewport, check, at, "a message in place of an answer");
      await page.shot(`home-${viewport.name}-message-instead`);
      await page.evaluate(click(`${waits} ${testId("oats-needs-message")} summary`));

      // the tiles, with their counts read, and who works
      const tiles = await page.until(`(() => { const tiles = ${texts(`${within("oats-home-tiles")} button`)}; return tiles.length >= 5 && tiles.slice(0, 5).every((tile) => /\\d$/.test(tile)) ? JSON.stringify(tiles) : ""; })()`, 20);
      check(Boolean(tiles) && JSON.parse(tiles)[0] === "Agents 8", `${at} the tiles: Agents and the pages, each of the five the home counts with its count`, tiles ?? (await page.evaluate(`JSON.stringify(${texts(`${within("oats-home-tiles")} button`)})`)));
      // the Automations tile carries the mark its row in the sidebar carries (a run failed, in these fixtures)
      const mark = await page.until(`document.querySelector(${JSON.stringify(`${within("oats-tile-automations")} [aria-label]`)})?.getAttribute("aria-label") ?? ""`, 15);
      check(mark === "Automations, a run failed", `${at} the Automations tile is marked while a run failed, as its row in the sidebar`, mark);
      const working = await page.evaluate(`JSON.stringify(${texts(within("oats-working-row"))})`);
      check(JSON.parse(working).length > 0 && JSON.parse(working).every((row) => /Working$/.test(row)), `${at} every agent at work is a row that ends with its state in words`, working);
      await shown(page, check, at, within("oats-home-summary"), "the summary, the tiles and who works");
      await sound(page, viewport, check, at, "the tiles and who works");
      await page.shot(`home-${viewport.name}-working`);
    },
  },
  {
    stage: "fixtures",
    name: "Home › Agents: every agent OATS has, and the way back",
    run: async ({ page, at, viewport, check: plain }) => {
      const check = printing(plain);
      await everyPage(check, at);
      check(await open(page, within("oats-tile-agents")), `${at} the home draws the Agents tile`, await page.evaluate(textOf(PAGE)));
      await page.evaluate(click(within("oats-tile-agents")));
      const title = await page.until(`${heading("oats-home-agents", "every agent 8")} ? ${headingOf("oats-home-agents")} : ""`, 15);
      check(Boolean(title) && (await page.evaluate("location.pathname")).endsWith("/home/agents"), `${at} Agents opens Home › Agents, at its own address, with every agent`, `${await page.evaluate(headingOf("oats-home-agents"))} at ${await page.evaluate("location.pathname")}`);
      const rows = JSON.parse(await page.evaluate(`JSON.stringify(${texts(within("oats-home-agent-row"))})`));
      check(rows.length === 8 && rows.some((row) => /runs in tmux/.test(row)) && rows.some((row) => /Stopped$/.test(row)) && rows.every((row) => /started by joan/.test(row)), `${at} the stopped agent and the one on tmux are in the list, each row with its state and who started it`, JSON.stringify(rows));
      check((await page.evaluate(`document.activeElement?.getAttribute("data-testid") ?? ""`)) === "oats-home-back", `${at} the keyboard is on Back to Home`, await page.evaluate(`document.activeElement?.getAttribute("data-testid") ?? ""`));
      await sound(page, viewport, check, at, "Home › Agents");
      await page.shot(`home-${viewport.name}-agents`);
      // Esc returns, as Back to Home does
      await page.evaluate(`document.activeElement.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }))`);
      const escaped = await page.until(`document.querySelector(${JSON.stringify(within("oats-home-needs"))}) !== null && location.pathname.endsWith("/home") ? location.pathname : ""`, 15);
      check(Boolean(escaped), `${at} Esc on Home › Agents leads back to the home`, await page.evaluate("location.pathname"));
      check(await open(page, within("oats-home-agent-row"), `${HOME}/agents`), `${at} Home › Agents opens by its address`, await page.evaluate(textOf(PAGE)));
      // an agent with no bb thread opens its own page
      await page.evaluate(`[...document.querySelectorAll(${JSON.stringify(within("oats-home-agent-row"))})].find((row) => row.dataset.instance === "kernel-fix-developer").querySelector('[data-testid="oats-home-agent"]').click()`);
      const agentPage = await page.until(`location.pathname.endsWith("/agent/kernel-fix-developer") ? location.pathname : ""`, 15);
      check(Boolean(agentPage), `${at} an agent with no bb thread opens its own page`, await page.evaluate("location.pathname"));
      // and the way back
      check(await open(page, within("oats-home-back"), `${HOME}/agents`), `${at} Home › Agents opens by its address again`, await page.evaluate(textOf(PAGE)));
      await page.evaluate(click(within("oats-home-back")));
      const back = await page.until(`document.querySelector(${JSON.stringify(within("oats-home-needs"))}) !== null && location.pathname.endsWith("/home") ? location.pathname : ""`, 15);
      check(Boolean(back), `${at} Back to Home leads to the home`, await page.evaluate("location.pathname"));
    },
  },
  {
    stage: "fixtures",
    name: "a tile whose count cannot be read says so and still leads to its page",
    run: async ({ page, at, viewport, check: plain }) => {
      const check = printing(plain);
      await everyPage(check, at);
      setVerb("teams", FAILS);
      try {
        refresh();
        check(await open(page, within("oats-tile-teams")), `${at} the home draws its tiles`, await page.evaluate(textOf(PAGE)));
        const tile = await page.until(`(() => { const text = ${textOf(within("oats-tile-teams"))}; return text === "Teams Couldn't count" ? text : ""; })()`, 20);
        check(Boolean(tile), `${at} the Teams tile says "Couldn't count"`, await page.evaluate(textOf(within("oats-tile-teams"))));
        const others = await page.until(`(() => { const text = ${textOf(within("oats-tile-souls"))}; return /\\d$/.test(text) ? text : ""; })()`, 20);
        check(Boolean(others), `${at} and the other tiles keep their counts`, await page.evaluate(textOf(within("oats-tile-souls"))));
        await shown(page, check, at, within("oats-home-summary"), "the tiles");
        await sound(page, viewport, check, at, "a tile that could not count");
        await page.shot(`home-${viewport.name}-tile-failed`);
      } finally {
        setVerb("teams", null);
        refresh();
      }
    },
  },
  {
    stage: "fixtures",
    name: "the installed oats against what the plugin is built for: the card, the card with no command, the one line",
    run: async ({ page, at, viewport, check: plain }) => {
      const check = printing(plain);
      await everyPage(check, at);
      /** What the fake `oats version --json` answers from now on; the server's kept answer is dropped by a refresh. */
      const installed = (fields) => {
        setVerb("version", fields === null ? null : { stdout: JSON.stringify({ ...VERSION, ...fields }) });
        refresh();
      };
      const cardText = `(() => { const card = document.querySelector(${JSON.stringify(within("oats-home-cli"))}); return card ? card.getAttribute("data-state") + " | " + card.innerText.replace(/\\s+/g, " ").trim() : ""; })()`;
      try {
        // older than the plugin works with
        installed({ version: "0.69.4" });
        check(await open(page, within("oats-home-cli")), `${at} an oats older than the plugin works with draws the card`, await page.evaluate(textOf(PAGE)));
        const older = await page.evaluate(cardText);
        check(older.startsWith("older | Compatible oats CLI required") && older.includes("Detected 0.69.4") && older.includes("Required 0.70.0 or newer, with desktop API 1") && older.includes("npm install -g @awebai/oats@0.70") && /Copy$/.test(older), `${at} the card says what was detected, what is required, and the command, with Copy`, older);
        check((await page.evaluate(`document.querySelector(${JSON.stringify(within("oats-home-needs"))}) !== null`)) === true, `${at} and the roster is still drawn under it`, await page.evaluate(textOf(PAGE)));
        await sound(page, viewport, check, at, "the CLI card");
        await page.shot(`home-${viewport.name}-cli-older`);

        // its answers are of a later version than the plugin reads
        installed({ version: "0.74.0", desktopApi: 2 });
        check(await open(page, within("oats-home-cli")), `${at} an oats that speaks a newer desktop API draws the card`, await page.evaluate(textOf(PAGE)));
        const newerApi = await page.until(`(() => { const text = ${cardText}; return text.startsWith("newer-api") ? text : ""; })()`, 15);
        check(Boolean(newerApi) && newerApi.includes("This plugin is older than the installed oats CLI") && newerApi.includes("The installed oats CLI is 0.74.0, which speaks a newer desktop API (2) than this plugin's (1). Update the OATS plugin to use it.") && !newerApi.includes("npm"), `${at} the card names the plugin as the older one, and offers no npm command`, newerApi ?? (await page.evaluate(cardText)));
        await sound(page, viewport, check, at, "the newer-API card");
        await page.shot(`home-${viewport.name}-cli-newer-api`);

        // of a later minor than the plugin was tested with
        installed({ version: "0.71.2" });
        check(await open(page, within("oats-home-cli-line")), `${at} an oats of a later minor draws the one line`, await page.evaluate(textOf(PAGE)));
        const line = await page.evaluate(textOf(within("oats-home-cli-line")));
        check(line === "This plugin was tested with oats CLIs up to 0.70; the installed CLI is 0.71.2." && (await page.evaluate(`document.querySelector(${JSON.stringify(within("oats-home-cli"))}) === null`)) === true, `${at} one line, and no card`, line);
        await sound(page, viewport, check, at, "the tested-up-to line");
        await page.shot(`home-${viewport.name}-cli-newer`);
      } finally {
        installed(null);
      }
      // the recorded oats again: a tested one says nothing
      check(await open(page, within("oats-home-needs")), `${at} the home draws again`, await page.evaluate(textOf(PAGE)));
      const quiet = await page.until(`document.querySelector(${JSON.stringify(within("oats-home-cli"))}) === null && document.querySelector(${JSON.stringify(within("oats-home-cli-line"))}) === null && document.querySelector(${JSON.stringify(within("oats-home-summary"))}) !== null`, 15);
      check(Boolean(quiet), `${at} with the tested oats the home says nothing of the CLI`, await page.evaluate(textOf(PAGE)));
    },
  },
  {
    stage: "fixtures",
    name: "the release's default shows the home alone: the Agents tile and no other",
    run: async ({ page, at, viewport, check: plain }) => {
      const check = printing(plain);
      await everyPage(check, at);
      pages("home");
      try {
        check((await untilRoster((roster) => roster.ok === true)) !== undefined, `${at} the roster is read under the default`, "");
        check(await open(page, within("oats-home-tiles")), `${at} the home draws its tiles`, await page.evaluate(textOf(PAGE)));
        const tiles = await page.until(`(() => { const tiles = ${texts(`${within("oats-home-tiles")} button`)}; return tiles.length === 1 ? JSON.stringify(tiles) : ""; })()`, 20);
        check(tiles === JSON.stringify(["Agents 8"]), `${at} with the default the one tile is Agents: a tile leads to a page that is shown`, tiles ?? (await page.evaluate(`JSON.stringify(${texts(`${within("oats-home-tiles")} button`)})`)));
        await shown(page, check, at, within("oats-home-summary"), "the summary and the one tile");
        await sound(page, viewport, check, at, "the home under the default");
        await page.shot(`home-${viewport.name}-default`);
      } finally {
        pages();
        await untilRoster((roster) => roster.ok === true);
      }
    },
  },
  {
    stage: "fixtures",
    name: "a first read: \"Reading your agents…\" while OATS is read, and what the home says when that read fails",
    run: async ({ page, at, viewport, check: plain }) => {
      const check = printing(plain);
      await everyPage(check, at);
      const status = verbNow("status");
      try {
        // A slow first read: the server holds no roster (its settings changed), and `oats status` takes its time.
        setVerb("status", { ...status, sleepMs: 12_000 });
        pages();
        await page.goto(HOME);
        const reading = await page.until(`(() => { const text = ${textOf(PAGE)}; return text.includes("Reading your agents") ? text : ""; })()`, 10);
        check(reading === "Home Reading your agents…", `${at} while the roster is read for the first time the home says so, and nothing else`, reading ?? (await page.evaluate(textOf(PAGE))));
        await settled(page, viewport);
        await page.shot(`home-${viewport.name}-loading`);
        // and it then draws what was read
        const drawn = await page.until(`document.querySelector(${JSON.stringify(within("oats-needs-card"))}) !== null`, 40);
        check(Boolean(drawn), `${at} and then draws the roster it read`, await page.evaluate(textOf(PAGE)));

        // A first read that fails: no roster was ever read under these settings.
        setVerb("status", FAILS);
        pages();
        check((await untilRoster((roster) => roster.ok === false && (roster.last === undefined || roster.last === null))) !== undefined, `${at} the server has no roster and its read fails`, JSON.stringify(snapshot()).slice(0, 300));
        await page.goto(HOME);
        const failed = await page.until(`(() => { const notice = document.querySelector(${JSON.stringify(`${PAGE} ${testId("oats-notice")}`)}); return notice ? notice.querySelector("h3").innerText.trim() + " | " + notice.innerText.replace(/\\s+/g, " ").trim() : ""; })()`, 30);
        check(Boolean(failed) && /Retry/.test(failed) && !/Showing what was read/.test(failed) && (await page.evaluate(`document.querySelector(${JSON.stringify(within("oats-home-needs"))}) === null && document.querySelector(${JSON.stringify(within("oats-home-tiles"))}) === null`)) === true, `${at} a first read that failed: one titled notice with Retry, no age of anything kept, and no roster drawn`, failed ?? (await page.evaluate(textOf(PAGE))));
        await sound(page, viewport, check, at, "the home that could not be read");
        await page.shot(`home-${viewport.name}-unreadable`);
      } finally {
        setVerb("status", status ?? null);
        pages();
        await untilRoster((roster) => roster.ok === true);
      }
    },
  },
  {
    stage: "detached",
    name: "an agent whose session failed, one the kernel cannot reach, one whose bb thread is gone: in the summary and in Home › Agents",
    run: async ({ page, at, viewport, check: plain }) => {
      const check = printing(plain);
      await everyPage(check, at);
      check(await open(page, within("oats-home-summary")), `${at} the home draws its summary`, await page.evaluate(textOf(PAGE)));
      const summary = await page.until(`(() => { const text = ${textOf(within("oats-home-summary"))}; return /1 failed/.test(text) && /1 unreachable/.test(text) ? text : ""; })()`, 20);
      const numbers = String(summary ?? "").split(" · ").map((part) => Number(part.split(" ")[0]));
      check(Boolean(summary) && numbers.slice(1).reduce((sum, n) => sum + n, 0) === numbers[0], `${at} the summary counts the failed agent and the unreachable one, each agent once`, summary ?? (await page.evaluate(textOf(within("oats-home-summary")))));
      await shown(page, check, at, within("oats-home-summary"), "the summary");
      await sound(page, viewport, check, at, "the home with a failed and an unreachable agent");
      await page.shot(`home-${viewport.name}-states`);
      check(await open(page, within("oats-home-agent-row"), `${HOME}/agents`), `${at} Home › Agents opens`, await page.evaluate(textOf(PAGE)));
      const rows = JSON.parse(await page.evaluate(`JSON.stringify(Object.fromEntries([...document.querySelectorAll(${JSON.stringify(within("oats-home-agent-row"))})].map((row) => [row.dataset.instance, row.innerText.replace(/\\s+/g, " ").trim()])))`));
      check(/Unreachable$/.test(rows["desktop-mockups-developer"] ?? "") && /Failed$/.test(rows["harvest-knowledge-helper"] ?? "") && /its bb thread is gone/.test(rows["weekly-digest-helper"] ?? "") && /Stopped$/.test(rows["weekly-digest-helper"] ?? ""), `${at} each is a row with its state in words: Unreachable, Failed, and a stopped one whose bb thread is gone`, JSON.stringify(rows));
      await sound(page, viewport, check, at, "Home › Agents with every state");
      await page.shot(`home-${viewport.name}-agents-states`);
    },
  },
  {
    stage: "fixtures",
    name: "freshness: a change the kernel records is on the home within 3 s",
    run: async ({ page, at, check: plain, record }) => {
      const check = printing(plain);
      await everyPage(check, at);
      check(await open(page, within("oats-home-working")), `${at} the home lists who works`, await page.evaluate(textOf(PAGE)));
      const before = await page.until(`(() => { const text = ${headingOf("oats-home-working")}; return /^working \\d+$/i.test(text) ? text : ""; })()`, 30);
      const n = Number(String(before ?? "").split(" ")[1]);
      check(Number.isInteger(n) && n > 1, `${at} before the change the home counts who works`, before);
      const stopped = record({ "redesign-ui-lead": { running: false, runtimeState: "stopped" } });
      const fewer = (await page.until(heading("oats-home-working", `working ${n - 1}`), 15)) ? Date.now() - stopped : null;
      check(fewer !== null && fewer <= 3000, `${at} the home lists ${n - 1} working ${fewer === null ? "never" : `${fewer} ms`} after the kernel recorded the stop (3 s at most)`, await page.evaluate(headingOf("oats-home-working")));
      const back = record();
      const again = (await page.until(heading("oats-home-working", `working ${n}`), 15)) ? Date.now() - back : null;
      check(again !== null && again <= 3000, `${at} and ${n} again ${again === null ? "never" : `${again} ms`} after the kernel recorded that (3 s at most)`, await page.evaluate(headingOf("oats-home-working")));
    },
  },
  {
    stage: "home-many",
    name: "more agents need the person than the home shows at once: eight, then all; an agent on tmux has its card",
    run: async ({ page, at, viewport, check: plain }) => {
      const check = printing(plain);
      await everyPage(check, at);
      const all = 3 + MANY;
      check(await open(page, within("oats-home-needs-all")), `${at} the home offers the rest of what needs the person`, await page.evaluate(textOf(PAGE)));
      const first = JSON.parse(await page.evaluate(`JSON.stringify([...document.querySelectorAll(${JSON.stringify(within("oats-needs-card"))})].map((card) => card.dataset.instance))`));
      const more = await page.evaluate(textOf(within("oats-home-needs-all")));
      check(first.length === 8 && more === `Show all ${all}` && (await page.evaluate(heading("oats-home-needs", `needs you ${all}`))), `${at} eight cards, the count of all in the heading, and "Show all ${all}"`, `${JSON.stringify(first)} | ${more} | ${await page.evaluate(headingOf("oats-home-needs"))}`);
      // Those a person can answer here come first: the three with a thread in bb, then the agents on tmux, the newest claim first.
      check(first.slice(0, 3).every((instance) => !instance.startsWith("sweep-")) && first[3] === `sweep-${MANY}-helper`, `${at} the three that can be answered here come before the agents on tmux`, JSON.stringify(first));
      // the card of an agent on tmux: what it asks, where it runs and how to reach its terminal (to copy), where Open leads, and no reply box
      const tmuxCard = card(`sweep-${MANY}-helper`);
      const tmux = await page.evaluate(`(() => { const card = document.querySelector(${JSON.stringify(tmuxCard)}); return JSON.stringify({ text: card.innerText.replace(/\\s+/g, " ").trim(), reply: card.querySelector('[data-testid="oats-reply"]') !== null, command: card.querySelector("code")?.innerText ?? null, copy: card.querySelector('[data-testid="oats-copy"]') !== null, open: card.querySelector('[data-testid="oats-needs-open"]').innerText.trim() }); })()`);
      const read = JSON.parse(tmux);
      check(read.reply === false && read.text.includes("· runs in tmux") && read.text.includes("It runs in tmux on") && read.text.includes("Answer it in its terminal") && /^oats session attach --home \S+\/sweep-\d+-helper$/.test(read.command ?? "") && read.copy === true && read.open === "Open its page" && read.text.includes("Open its page shows who it is and how it runs.") && read.text.includes(`Sweep ${MANY} is done: keep its checkpoint?`), `${at} an agent on tmux says what it asks, on which machine it runs, the command that reaches its terminal (to copy) and where Open leads; it has no reply box`, tmux);
      await shown(page, check, at, tmuxCard, "the card of an agent on tmux");
      await sound(page, viewport, check, at, "the home with a card of an agent on tmux");
      await page.shot(`home-${viewport.name}-card-tmux`);
      await shown(page, check, at, within("oats-home-needs-all"), '"Show all"');
      await sound(page, viewport, check, at, "the cropped list's end");
      await page.shot(`home-${viewport.name}-needs-cropped`);
      await page.evaluate(click(within("oats-home-needs-all")));
      const shownAll = await page.until(`document.querySelectorAll(${JSON.stringify(within("oats-needs-card"))}).length === ${all} ? ${textOf(within("oats-home-needs-all"))} : ""`, 10);
      check(shownAll === "Show fewer", `${at} a press shows all ${all}, and the button then says "Show fewer"`, `${await page.evaluate(`document.querySelectorAll(${JSON.stringify(within("oats-needs-card"))}).length`)} cards | ${await page.evaluate(textOf(within("oats-home-needs-all")))}`);
      // the image shows what the press revealed: the ninth card onward, down to "Show fewer"
      const ninth = `${PAGE} [data-testid="oats-needs-card"]:nth-of-type(9)`;
      await shown(page, check, at, ninth, "the first card the press revealed");
      await sound(page, viewport, check, at, "the cards the press revealed");
      await page.shot(`home-${viewport.name}-needs-all`);
    },
  },
  {
    stage: "home-empty",
    name: "a workspace with no agent: what OATS does, and New agent",
    run: async ({ page, at, viewport, check: plain }) => {
      const check = printing(plain);
      await everyPage(check, at);
      check(await open(page, within("oats-home-new-agent")), `${at} the home offers New agent`, await page.evaluate(textOf(PAGE)));
      const words = await page.evaluate(textOf(within("oats-empty")));
      check(words === "OATS runs your agents: each one is a soul at work on a machine of yours. Start one, and Home shows what needs you and what you have. New agent", `${at} it says what OATS does in two lines`, words);
      check((await page.evaluate(`document.querySelector(${JSON.stringify(within("oats-home-needs"))}) === null && document.querySelector(${JSON.stringify(within("oats-home-summary"))}) === null`)) === true, `${at} and draws no empty group and no count of nothing`, await page.evaluate(textOf(PAGE)));
      await sound(page, viewport, check, at, "the empty workspace");
      await page.shot(`home-${viewport.name}-empty`);
    },
  },
  {
    stage: "home-stale",
    name: "OATS cannot be read after it was: the roster as last read, marked once, its acts held",
    run: async ({ page, at, viewport, check: plain }) => {
      const check = printing(plain);
      check(await open(page, within("oats-needs-card")), `${at} the home keeps its cards`, await page.evaluate(textOf(PAGE)));
      const notices = JSON.parse(await page.evaluate(`JSON.stringify(${texts(`${PAGE} ${testId("oats-notice")}`)})`));
      check(notices.length === 1 && /Showing what was read /.test(notices[0]) && /Retry/.test(notices[0]), `${at} one notice says OATS cannot be read, how old what is shown is, and offers Retry`, JSON.stringify(notices));
      const held = await page.evaluate(`JSON.stringify([...document.querySelectorAll(${JSON.stringify(within("oats-needs-card"))})].map((card) => ({ offer: card.dataset.offer, text: card.querySelector('[data-testid="oats-reply-text"]')?.disabled ?? null, send: card.querySelector('[data-testid="oats-reply-send"]')?.disabled ?? null, why: [...card.querySelectorAll('[data-testid="oats-disabled-reason"]')].filter((reason) => reason.checkVisibility()).map((reason) => reason.innerText.trim()), open: card.querySelector('[data-testid="oats-needs-open"]').disabled })))`);
      const cards = JSON.parse(held);
      check(cards.length === 3 && cards.every((each) => each.text === true && each.send === true && each.open === false) && cards.filter((each) => each.offer === "reply").length === 2 && cards.filter((each) => each.offer === "reply").every((each) => each.why.join() === "Held until OATS is read again: what is shown may have changed."), `${at} every card's reply is held, a reply in view says why beside it, and Open still opens`, held);
      await sound(page, viewport, check, at, "the home as last read");
      await page.shot(`home-${viewport.name}-stale`);
    },
  },
];
