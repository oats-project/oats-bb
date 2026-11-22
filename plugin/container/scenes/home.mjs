// The home's live scenes: every state of the home as a person meets it, at both widths and in both
// themes, each read before its image is taken.
//
//   fixtures     the recorded roster: three agents need the person (each card with its own reply),
//                the summary, the tiles, who works, what is finished; Home › Agents; a tile whose
//                count cannot be read; how soon a change the kernel records is on the home
//   home-many    eleven agents need the person, one of them on tmux: eight cards, then all
//   home-empty   a workspace with no agent
//   home-stale   OATS cannot be read after it was: the roster as last read, its acts held
//
// A scene that opens, presses or changes something waits on what it then reads, and a failing
// check prints what it read (`printing`). Every image is measured (`sound`): nothing the home
// draws is past the window's edge, no word is broken across two lines, no two controls overlap,
// every control is high enough to press.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { fill, testId, textOf, texts } from "../browser.mjs";
import { FAILS, fits, printing, refresh, setVerb, settled } from "./panel.mjs";

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

/** The every-image check, on the home's page. */
async function sound(page, viewport, check, at, what) {
  await settled(page, viewport);
  const fit = await fits(page, viewport, PAGE);
  check(
    fit.low.length === 0 && fit.wide === 0 && fit.scroll <= 0 && fit.broken.length === 0 && fit.overlap.length === 0,
    `${at} ${what}: nothing the home draws is past the window's edge, no word or id is broken across two lines, no two controls overlap, and every control is high enough to press`,
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
      check(await open(page, within("oats-needs-card")), `${at} the home draws its cards`, await page.evaluate(textOf(PAGE)));
      check((await page.evaluate(textOf(within("oats-home-title")))) === "Home", `${at} the page is headed "Home"`, await page.evaluate(textOf(within("oats-home-title"))));
      const needs = await page.until(`${heading("oats-home-needs", "needs you 3")} ? ${headingOf("oats-home-needs")} : ""`, 15);
      check(Boolean(needs), `${at} three agents need the person`, await page.evaluate(headingOf("oats-home-needs")));
      // every card: the agent's name as words, its soul and machine, what it asks, and a reply named for it
      const cards = JSON.parse(await page.evaluate(`JSON.stringify([...document.querySelectorAll(${JSON.stringify(within("oats-needs-card"))})].map((card) => ({ instance: card.dataset.instance, name: card.querySelector('[data-testid="oats-needs-name"]')?.innerText.trim(), state: card.querySelector('[data-testid="oats-state"]')?.innerText.replace(/\\s+/g, " ").trim(), reply: card.querySelector('[data-testid="oats-reply-text"]')?.getAttribute("aria-label") ?? null, text: card.innerText.replace(/\\s+/g, " ").trim() })))`));
      check(cards.length === 3 && cards.every((each) => each.reply === `Reply to ${each.name}` && /needs you/i.test(each.state ?? "") && !each.name.includes("-")), `${at} each card names its agent in words, says it needs the person, and has its own reply named for that agent`, JSON.stringify(cards));
      check(cards.some((each) => each.instance === "release-070-maintainer" && each.name === "Release 070 maintainer" && each.text.includes("Green light at 9f2e1c? Second reader done.")), `${at} a card says what its agent asks, in the agent's words`, JSON.stringify(cards));
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

      // a message typed on one agent's card: Send of that card alone
      const mine = card("flaky-ci-developer");
      await page.evaluate(fill(`${mine} ${testId("oats-reply-text")}`, "Yes: force-push it, then rerun the shard."));
      const sends = await page.until(`(() => { const sends = [...document.querySelectorAll(${JSON.stringify(within("oats-reply-send"))})].map((send) => [send.closest('[data-testid="oats-needs-card"]').dataset.instance, send.disabled]); return sends.filter(([, off]) => !off).length === 1 ? JSON.stringify(sends) : ""; })()`, 10);
      check(Boolean(sends) && JSON.parse(sends).some(([instance, off]) => instance === "flaky-ci-developer" && off === false), `${at} a message typed on one card enables Send on that card only`, sends);
      await shown(page, check, at, mine, "the card being answered");
      await sound(page, viewport, check, at, "a reply being written");
      await page.shot(`home-${viewport.name}-reply`);
      await page.evaluate(fill(`${mine} ${testId("oats-reply-text")}`, ""));

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
    name: "freshness: a change the kernel records is on the home within 3 s",
    run: async ({ page, at, check: plain, record }) => {
      const check = printing(plain);
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
      const all = 3 + MANY;
      check(await open(page, within("oats-home-needs-all")), `${at} the home offers the rest of what needs the person`, await page.evaluate(textOf(PAGE)));
      const first = JSON.parse(await page.evaluate(`JSON.stringify([...document.querySelectorAll(${JSON.stringify(within("oats-needs-card"))})].map((card) => card.dataset.instance))`));
      const more = await page.evaluate(textOf(within("oats-home-needs-all")));
      check(first.length === 8 && first[0] === `sweep-${MANY}-helper` && more === `Show all ${all}` && (await page.evaluate(heading("oats-home-needs", `needs you ${all}`))), `${at} eight cards, the newest claim first, the count of all in the heading, and "Show all ${all}"`, `${JSON.stringify(first)} | ${more} | ${await page.evaluate(headingOf("oats-home-needs"))}`);
      // the card of an agent on tmux: what it asks, where to answer, no reply box
      const tmux = await page.evaluate(`(() => { const card = document.querySelector(${JSON.stringify(card(`sweep-${MANY}-helper`))}); return JSON.stringify({ text: card.innerText.replace(/\\s+/g, " ").trim(), reply: card.querySelector('[data-testid="oats-reply"]') !== null }); })()`);
      check(JSON.parse(tmux).reply === false && JSON.parse(tmux).text.includes("Runs in tmux: answer it in its terminal.") && JSON.parse(tmux).text.includes(`Sweep ${MANY} is done: keep its checkpoint?`), `${at} an agent on tmux says what it asks and where to answer it, and has no reply box`, tmux);
      await sound(page, viewport, check, at, "the home with a card of an agent on tmux");
      await page.shot(`home-${viewport.name}-card-tmux`);
      await shown(page, check, at, within("oats-home-needs-all"), '"Show all"');
      await sound(page, viewport, check, at, "the cropped list's end");
      await page.shot(`home-${viewport.name}-needs-cropped`);
      await page.evaluate(click(within("oats-home-needs-all")));
      const shownAll = await page.until(`document.querySelectorAll(${JSON.stringify(within("oats-needs-card"))}).length === ${all} ? ${textOf(within("oats-home-needs-all"))} : ""`, 10);
      check(shownAll === "Show fewer", `${at} a press shows all ${all}, and the button then says "Show fewer"`, `${await page.evaluate(`document.querySelectorAll(${JSON.stringify(within("oats-needs-card"))}).length`)} cards | ${await page.evaluate(textOf(within("oats-home-needs-all")))}`);
      await shown(page, check, at, within("oats-home-needs-all"), '"Show fewer"');
      await sound(page, viewport, check, at, "the whole list's end");
      await page.shot(`home-${viewport.name}-needs-all`);
    },
  },
  {
    stage: "home-empty",
    name: "a workspace with no agent: what OATS does, and New agent",
    run: async ({ page, at, viewport, check: plain }) => {
      const check = printing(plain);
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
      const held = await page.evaluate(`JSON.stringify([...document.querySelectorAll(${JSON.stringify(within("oats-needs-card"))})].map((card) => ({ text: card.querySelector('[data-testid="oats-reply-text"]')?.disabled ?? null, send: card.querySelector('[data-testid="oats-reply-send"]')?.disabled ?? null, why: card.querySelector('[data-testid="oats-disabled-reason"]')?.innerText.trim() ?? null, open: card.querySelector('[data-testid="oats-needs-open"]').disabled })))`);
      check(JSON.parse(held).length === 3 && JSON.parse(held).every((each) => each.text === true && each.send === true && each.why === "Held until OATS is read again: what is shown may have changed." && each.open === false), `${at} every card's reply is held and says why; Open still opens`, held);
      await sound(page, viewport, check, at, "the home as last read");
      await page.shot(`home-${viewport.name}-stale`);
    },
  },
];
