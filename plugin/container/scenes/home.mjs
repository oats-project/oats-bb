// The home's live scenes: every state of the home as a person meets it, at both widths and in both
// themes, each read before its image is taken.
//
//   detached     an agent whose session failed, one the kernel cannot reach, one whose bb thread is
//                gone: in the summary and in Home › Agents
//   pages-default  the release's default: the home alone, so no tile at all
//   fixtures     the recorded roster: three agents need the person (each card with its own reply),
//                the summary, the tiles, who works, what is finished; Home › Agents; a tile whose
//                count cannot be read; how soon a change the kernel records is on the home
//   home-stopped-asks  an agent OATS has stopped while bb holds a request on its thread: no answer,
//                no message, Start
//   home-many    eleven agents need the person, one of them on tmux: eight cards, then all
//   home-empty   a workspace with no agent
//   home-stale   OATS cannot be read after it was: the roster as last read, its acts held
//
// In `fixtures` also: a first read (loading, and one that fails), the installed oats older than the plugin works with, one that speaks a newer
// desktop API, one of a later minor than the plugin was tested with.
//
// A scene that opens, presses or changes something waits on what it then reads, and a failing
// check prints what it read (`printing`). Every image is measured (`sound`): nothing the home
// draws is past the window's edge, no word is broken across two lines, no two controls overlap,
// every control is high enough to press.
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { homedir, hostname } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { fill, gapsIn, loose, MAX_GAP, testId, textOf, texts, textsNamed, showSidebar, tight } from "../browser.mjs";
import { FAILS, fits, printing, refresh, setVerb, settled } from "./panel.mjs";

/** The oldest OATS the plugin works with, as kernel/compat.ts holds it: the card's "Required" says it. */
const FLOOR = /OATS_FLOOR = "([^"]+)"/.exec(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "..", "kernel", "compat.ts"), "utf8"))[1];
/** The recorded `oats version --json`, for a scene that changes what is installed. */
const VERSION = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "..", "test", "fixtures", "roster", "version.json"), "utf8"));
const STATUS = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "test", "fixtures", "roster", "status.json");
/** The machine's name as bb shows it (roster.mjs): no card and no row of the home says it. */
const MACHINE = process.env.MACHINE_NAME || hostname();
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

// ---- bb holds a request on the thread of an agent OATS has stopped
// The live run's bb threads run Claude Code on the mock model, which asks what a message names
// (real/mock-anthropic.mjs, MOCK-ASK): a message to the thread opens a question that bb then holds
// as a pending interaction. Asked once, when the stage is entered; answered when it is left, with
// bb's own CLI, as a person would in the thread.
const bbCli = (...args) => execFileSync("bb", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
const bbJsonCli = (...args) => JSON.parse(bbCli(...args, "--json"));
const STOPPED_ASKS = { instance: "flaky-ci-developer", thread: "thr_ci" };
const STOPPED_QUESTION = "Rerun the failed shard, or leave it?";
const STOPPED_ASK = { questions: [{ question: STOPPED_QUESTION, header: "Shard", multiSelect: false, options: [{ label: "Rerun", description: "Run it again." }, { label: "Leave it", description: "Do nothing." }] }] };
const pendingOn = (threadId) => bbJsonCli("thread", "interactions", "list", threadId).filter((interaction) => interaction.status === "pending");
/** bb's pending interaction on the thread, or undefined when none opened in `seconds`. */
async function untilPending(threadId, seconds) {
  for (const deadline = Date.now() + seconds * 1000; Date.now() < deadline; await new Promise((resolve) => setTimeout(resolve, 1000))) {
    const found = pendingOn(threadId)[0];
    if (found !== undefined) return found;
  }
  return undefined;
}
/** The question bb holds while the stage `home-stopped-asks` runs; undefined when none opened (its scene then fails, and says so). */
let heldQuestion;

export const stages = {
  "home-stopped-asks": {
    label: "H5",
    enter: async ({ fake, statusWithRealIds, threads, untilSnapshot }) => {
      fake({ status: { stdout: statusWithRealIds(threads, { [STOPPED_ASKS.instance]: { running: false, runtimeState: "stopped", waitingOnYou: null } }) } });
      await untilSnapshot((snapshot) => snapshot.ok === true && snapshot.agents.some((agent) => agent.instance === STOPPED_ASKS.instance && agent.running === false));
      const thread = threads.get(STOPPED_ASKS.thread);
      heldQuestion = undefined;
      // The mock asks only when the message is the last one Claude Code sends it, which it is not every time: a message that opened no question is sent once more.
      for (let attempt = 1; attempt <= 3 && heldQuestion === undefined; attempt += 1) {
        bbCli("thread", "tell", thread.id, `One more thing.\nMOCK-ASK:${JSON.stringify(STOPPED_ASK)}\n`);
        heldQuestion = await untilPending(thread.id, 45);
        if (heldQuestion === undefined) console.log(`NOTE home: the message to "${thread.title}" opened no question in 45 s (attempt ${attempt} of 3)`);
      }
    },
    leave: async ({ fake, threads }) => {
      const thread = threads.get(STOPPED_ASKS.thread);
      try {
        // Every request bb holds on the thread is answered, as a person would in it (a first message's
        // question can open after the second message was sent): bb is left as the stage found it.
        const deadline = Date.now() + 90_000;
        let left = pendingOn(thread.id);
        let status = bbJsonCli("thread", "show", thread.id).thread?.status;
        while (Date.now() < deadline && (left.length > 0 || status !== "idle")) {
          for (const interaction of left) {
            const asked = interaction.payload?.questions?.[0];
            if (asked !== undefined) bbCli("thread", "interactions", "answer", interaction.id, thread.id, "--choice", `${asked.id}=${asked.options[0].value}`);
          }
          await new Promise((resolve) => setTimeout(resolve, 1500));
          left = pendingOn(thread.id);
          status = bbJsonCli("thread", "show", thread.id).thread?.status;
        }
        // Said when it is not so: a later stage would then start on a thread that still asks, or still runs.
        if (left.length > 0 || status !== "idle") console.log(`NOTE home: after the stage home-stopped-asks the thread "${thread.title}" is not as it was found: ${left.length} pending request(s), status ${status}`);
      } finally {
        heldQuestion = undefined;
        fake();
      }
    },
  },
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
/**
 * Waits until the plugin's snapshot is one `matches` holds for. → that snapshot; undefined after
 * `seconds`, and `untilRoster.last` then says what the last try read or why it failed (the server
 * is between two settings for a moment after one changed), for the check that prints it.
 */
async function untilRoster(matches, seconds = 40) {
  const deadline = Date.now() + seconds * 1000;
  untilRoster.last = "never asked";
  while (Date.now() < deadline) {
    try {
      refresh();
      const read = snapshot();
      if (matches(read)) return read;
      untilRoster.last = JSON.stringify(read).slice(0, 300);
    } catch (error) {
      untilRoster.last = `the read failed: ${String(error?.message ?? error).slice(0, 300)}`;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return undefined;
}
/**
 * The `oats` the plugin runs is the plugin's setting `oatsBin`; unset, it is the `oats` of the PATH,
 * as the run has it. The fake is that one program either way, so nothing changes in what is read;
 * but a change of a setting that says WHERE OATS is read (`deployment`, `oatsBin`,
 * `host`; not `pages`) makes the plugin's server forget the roster it holds, which may be another
 * deployment's: the next read is a first read.
 */
const OATS_BIN = join(homedir(), ".local/bin/oats");
let named = false;
/** Names the fake by its path (`true`) or leaves `oatsBin` unset again (`false`); nothing is asked of bb when it is so already. */
function oatsBin(byPath) {
  if (byPath === named) return;
  execFileSync("bb", ["plugin", "config", "oats", ...(byPath ? ["set", "oatsBin", OATS_BIN] : ["unset", "oatsBin"])], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  named = byPath;
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
    name: "the home: what needs you, each card with its reply; the tiles, who works; no heading of its own and no summary line",
    run: async ({ page, at, viewport, check: plain }) => {
      const check = printing(plain);
      check(await open(page, within("oats-needs-card")), `${at} the home draws its cards`, await page.evaluate(textOf(PAGE)));
      // bb's bar over the page names it: the page has no heading "Home" of its own, and no summary line (the headings count).
      const bare = await page.evaluate(`JSON.stringify({ title: document.querySelector(${JSON.stringify(within("oats-home-title"))}) !== null, h1: document.querySelector(${JSON.stringify(`${PAGE} h1`)}) !== null, summary: document.querySelector(${JSON.stringify(within("oats-home-summary"))}) !== null })`);
      check(bare === JSON.stringify({ title: false, h1: false, summary: false }), `${at} the page has no heading of its own and no summary line`, bare);
      // New agent is on every home, first on the page: at a phone's width bb's sidebar is in a drawer, and the home is what a person sees.
      const head = await page.evaluate(`(() => { const head = document.querySelector(${JSON.stringify(within("oats-home-head"))}); const button = head?.querySelector('[data-testid="oats-home-new-agent"]'); const needs = document.querySelector(${JSON.stringify(within("oats-home-needs"))}); return JSON.stringify({ text: (head?.innerText ?? "").replace(/\\s+/g, " ").trim(), off: button?.disabled ?? null, first: Boolean(button && needs) && button.getBoundingClientRect().bottom <= needs.getBoundingClientRect().top + 1 }); })()`);
      check(head === JSON.stringify({ text: "New agent", off: false, first: true }), `${at} New agent is first on a home with agents, over what needs the person, and can be pressed`, head);
      const needs = await page.until(`${heading("oats-home-needs", "needs you 3")} ? ${headingOf("oats-home-needs")} : ""`, 15);
      check(Boolean(needs), `${at} three agents need the person`, await page.evaluate(headingOf("oats-home-needs")));
      // every card: the agent's name as words (its soul under it, no machine), what it asks, and the answer its request takes
      const cards = JSON.parse(await page.evaluate(`JSON.stringify([...document.querySelectorAll(${JSON.stringify(within("oats-needs-card"))})].map((card) => ({ instance: card.dataset.instance, offer: card.dataset.offer, name: card.querySelector('[data-testid="oats-needs-name"]')?.innerText.trim(), state: card.querySelector('[data-testid="oats-state"]')?.innerText.replace(/\\s+/g, " ").trim(), mark: card.querySelector('[data-testid="oats-state"] [data-mark][role="img"]')?.getAttribute("aria-label") ?? null, open: card.querySelector('[data-testid="oats-needs-open"]')?.innerText.trim(), replyShown: [...card.querySelectorAll('[data-testid="oats-reply-text"]')].some((box) => box.checkVisibility()), reply: card.querySelector('[data-testid="oats-reply-text"]')?.getAttribute("aria-label") ?? null, text: card.innerText.replace(/\\s+/g, " ").trim() })))`));
      check(cards.length === 3 && cards.every((each) => each.reply === `Reply to ${each.name}` && each.state === "!" && each.mark === "Needs input" && !/\bNeeds you\b/.test(each.text) && !each.name.includes("-") && each.open === (each.offer === "in-thread" ? "Answer" : "Open") && /\b(oats-[a-z-]+|knowledge-harvester|research-expert)\b/.test(each.text) && !new RegExp(MACHINE).test(each.text)), `${at} each card names its agent in words, keeps the mark (named for a screen reader) with no "Needs you" of its own (the heading says it), has Open, or Answer where its request is answered in its thread, and says its soul and no machine`, JSON.stringify(cards));
      // A card is as high as its lines: no empty room between two of them, nor at its edges (a line of a card stretched to
      // ten rem once: an empty 150 px under the soul, which no check of words could see).
      const cardGaps = JSON.parse(await page.evaluate(gapsIn(within("oats-needs-card-body"))));
      check(cardGaps.length === 3 && tight(cardGaps), `${at} each card is as high as what it holds: no gap over ${MAX_GAP} px between two of its lines or at its edges (heights ${cardGaps.map((card) => card.height).join(", ")} px)`, loose(cardGaps));
      check(cards.some((each) => each.instance === "release-070-maintainer" && each.name === "Release 070 maintainer" && each.text.includes("Green light at 9f2e1c? Second reader done.")), `${at} a card says what its agent asks, in the agent's words`, JSON.stringify(cards));
      // an agent that asks in its own words is answered by the reply on its card; one that waits for an approval is not offered a message as its answer
      const byOffer = Object.fromEntries(cards.map((each) => [each.instance, [each.offer, each.replyShown]]));
      check(byOffer["ranker-v3-probe"]?.join() === "reply,true" && byOffer["release-070-maintainer"]?.join() === "reply,true" && byOffer["flaky-ci-developer"]?.join() === "in-thread,false", `${at} the two that ask in their own words have the reply on their card; the one that waits for an approval has none in view`, JSON.stringify(byOffer));
      const permission = cards.find((each) => each.instance === "flaky-ci-developer");
      check(!permission.text.includes("Answer it in its thread.") && permission.open === "Answer" && permission.text.includes("Message instead") && !permission.text.includes("It waits for an approval"), `${at} the approval's card says where its answer is by its button, "Answer", with no sentence, and keeps a message behind "Message instead"`, permission.text);
      // the heading's count agrees with the foot of the sidebar
      if (!viewport.mobile) {
        const marked = await page.evaluate(`JSON.stringify({ marked: document.querySelectorAll(${JSON.stringify(`${testId("oats-sidebar")} ${testId("oats-tree")} [data-mark][data-state="needs-you"]`)}).length, foot: !(document.querySelector(${JSON.stringify(`${testId("oats-sidebar")} ${testId("oats-needs-line")}`)}) === null) })`);
        check(marked === JSON.stringify({ marked: 3, foot: false }), `${at} and the sidebar marks as many rows as the home counts, with no line of its own for the count`, marked);
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

      // the approval's card with "Message instead" opened: what a message does not do, then the box
      const waits = card("flaky-ci-developer");
      await page.evaluate(click(`${waits} ${testId("oats-needs-message")} summary`));
      const instead = await page.until(`(() => { const fold = document.querySelector(${JSON.stringify(`${waits} ${testId("oats-needs-message")}`)}); return fold?.open && fold.querySelector('[data-testid="oats-reply-text"]')?.checkVisibility() ? fold.innerText.replace(/\\s+/g, " ").trim() : ""; })()`, 10);
      check(Boolean(instead) && instead.includes("A message does not answer its request: it grants nothing, and the request stays open."), `${at} "Message instead" says what a message does not do, then offers the box`, instead ?? (await page.evaluate(textOf(waits))));
      await shown(page, check, at, waits, "the approval's card");
      await sound(page, viewport, check, at, "a message in place of an answer");
      await page.shot(`home-${viewport.name}-message-instead`);
      await page.evaluate(click(`${waits} ${testId("oats-needs-message")} summary`));

      // the tiles, with their counts read, and who works
      const tiles = await page.until(`(() => { const tiles = ${texts(`${within("oats-home-tiles")} button`)}; return tiles.length >= 4 && tiles.slice(0, 4).every((tile) => /\\d$/.test(tile)) ? JSON.stringify(tiles) : ""; })()`, 20);
      check(Boolean(tiles) && JSON.parse(tiles).every((tile) => !/^Agents\b/.test(tile)), `${at} the tiles: the pages that are shown, each the home counts with its count; no tile for the agents (the sidebar lists them)`, tiles ?? (await page.evaluate(`JSON.stringify(${texts(`${within("oats-home-tiles")} button`)})`)));
      // the Automations tile carries the mark its row in the sidebar carries (a run failed, in these fixtures)
      const mark = await page.until(`document.querySelector(${JSON.stringify(`${within("oats-tile-automations")} [aria-label]`)})?.getAttribute("aria-label") ?? ""`, 15);
      check(mark === "Automations, a run failed", `${at} the Automations tile is marked while a run failed, as its row in the sidebar`, mark);
      const working = await page.evaluate(`JSON.stringify(${texts(within("oats-working-row"))})`);
      const repeats = await page.evaluate(`document.querySelectorAll(${JSON.stringify(`${within("oats-working-row")} ${testId("oats-state")}, ${within("oats-finished-row")} ${testId("oats-state")}`)}).length`);
      check(JSON.parse(working).length > 0 && JSON.parse(working).every((row) => !/(Working|Running)$/.test(row) && /\b(oats-[a-z-]+|knowledge-harvester|research-expert)\b/.test(row)) && repeats === 0, `${at} every agent at work is a row under the heading "Running", with its soul beside its name: no row repeats the state's word`, working);
      const workingGaps = JSON.parse(await page.evaluate(gapsIn(`${within("oats-working-row")}, ${within("oats-finished-row")}`)));
      check(tight(workingGaps), `${at} each row of the Working and the Unread lists is as high as its line: no empty room in it (heights ${[...new Set(workingGaps.map((row) => row.height))].join(", ")} px)`, loose(workingGaps));
      await shown(page, check, at, within("oats-home-tiles"), "the tiles and who works");
      await sound(page, viewport, check, at, "the tiles and who works");
      await page.shot(`home-${viewport.name}-working`);
    },
  },
  {
    stage: "fixtures",
    name: "Home › Agents: every agent OATS has, and the way back",
    run: async ({ page, at, viewport, check: plain }) => {
      const check = printing(plain);
      // Nothing on the home leads to it (no tile for the agents): the view is reached by its address.
      check(await open(page, within("oats-home-needs")) && (await page.evaluate(`document.querySelector(${JSON.stringify(within("oats-tile-agents"))}) === null`)) === true, `${at} the home draws no tile for the agents`, await page.evaluate(textOf(PAGE)));
      check(await open(page, within("oats-home-agents"), `${HOME}/agents`), `${at} Home › Agents opens at its address`, await page.evaluate(textOf(PAGE)));
      const title = await page.until(`${heading("oats-home-agents", "agents 8")} ? ${headingOf("oats-home-agents")} : ""`, 15);
      check(Boolean(title) && (await page.evaluate("location.pathname")).endsWith("/home/agents"), `${at} Home › Agents, at its own address, has every agent`, `${await page.evaluate(headingOf("oats-home-agents"))} at ${await page.evaluate("location.pathname")}`);
      // ("tmux" is read by the glyph's name: on a row it is bb's terminal glyph, named "tmux".)
      const rows = JSON.parse(await page.evaluate(`JSON.stringify(${textsNamed(within("oats-home-agent-row"))})`));
      check(rows.length === 8 && rows.some((row) => /\btmux\b/.test(row) && !/runs in/.test(row)) && rows.some((row) => /Stopped$/.test(row)) && rows.every((row) => /\b(oats-[a-z-]+|knowledge-harvester|research-expert)\b/.test(row) && !new RegExp(`started by|${MACHINE}`).test(row)), `${at} the stopped agent and the one on tmux are in the list, each row with its soul and its state, where it is ("tmux"), and no machine or who started it`, JSON.stringify(rows));
      const agentGaps = JSON.parse(await page.evaluate(gapsIn(within("oats-home-agent-row"))));
      check(agentGaps.length === 8 && tight(agentGaps), `${at} each row of Home › Agents is as high as its line: no empty room in it (heights ${[...new Set(agentGaps.map((row) => row.height))].join(", ")} px)`, loose(agentGaps));
      // The one count line of the home is here: by state, each agent once; how many there are is the heading's count.
      const summary = await page.evaluate(textOf(within("oats-home-summary")));
      const counted = summary.split(" · ").map((part) => Number(part.split(" ")[0]));
      check(/^\d+ working · 3 need you/.test(summary) && !/agents/.test(summary) && counted.reduce((sum, n) => sum + n, 0) === 8, `${at} the count line counts each of the 8 agents once, by its state, with no total`, summary);
      const backWord = await page.evaluate(textOf(within("oats-home-back")));
      check(backWord === "‹ Home", `${at} the way back reads "‹ Home"`, backWord);
      check((await page.evaluate(`document.activeElement?.getAttribute("data-testid") ?? ""`)) === "oats-home-back", `${at} the keyboard is on ‹ Home`, await page.evaluate(`document.activeElement?.getAttribute("data-testid") ?? ""`));
      await sound(page, viewport, check, at, "Home › Agents");
      await page.shot(`home-${viewport.name}-agents`);
      // Esc returns, as ‹ Home does
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
      check(Boolean(back), `${at} ‹ Home leads to the home`, await page.evaluate("location.pathname"));
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
        await shown(page, check, at, within("oats-home-tiles"), "the tiles");
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
    name: "the installed oats against what the plugin is built for: the card, the card with no command, and nothing where no act is off",
    run: async ({ page, at, viewport, check: plain }) => {
      const check = printing(plain);
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
        check(older.startsWith("older | Compatible oats CLI required") && older === `older | Compatible oats CLI required Detected 0.69.4 Required ${FLOOR} or newer npm install -g @awebai/oats@0.70 Copy Check again`, `${at} the card says what was detected, what is required, and the command, with Copy, and nothing else`, older);
        // Behind the card New agent is off, with no reason beside it: the card under it, on the same screen, is why.
        const behind = await page.evaluate(`(() => { const head = document.querySelector(${JSON.stringify(within("oats-home-head"))}); const button = head?.querySelector('[data-testid="oats-home-new-agent"]'); return JSON.stringify({ text: (head?.innerText ?? "").replace(/\\s+/g, " ").trim(), off: button?.disabled ?? null, why: button?.title ?? null }); })()`);
        check(behind === JSON.stringify({ text: "New agent", off: true, why: "" }), `${at} behind the card New agent is off, with no reason beside it or in a title: the card says why`, behind);
        check((await page.evaluate(`document.querySelector(${JSON.stringify(within("oats-home-needs"))}) !== null`)) === true, `${at} and the roster is still drawn under it`, await page.evaluate(textOf(PAGE)));
        await sound(page, viewport, check, at, "the CLI card");
        await page.shot(`home-${viewport.name}-cli-older`);

        // its answers are of a later version than the plugin reads
        installed({ version: "0.74.0", desktopApi: 2 });
        check(await open(page, within("oats-home-cli")), `${at} an oats that speaks a newer desktop API draws the card`, await page.evaluate(textOf(PAGE)));
        const newerApi = await page.until(`(() => { const text = ${cardText}; return text.startsWith("newer-api") ? text : ""; })()`, 15);
        check(Boolean(newerApi) && newerApi === "newer-api | This plugin is older than the installed oats CLI Update the OATS plugin. Detected 0.74.0 Check again", `${at} the card names the plugin as the older one, says what to do in four words, and offers no npm command`, newerApi ?? (await page.evaluate(cardText)));
        await sound(page, viewport, check, at, "the newer-API card");
        await page.shot(`home-${viewport.name}-cli-newer-api`);

        // A check whose answer is the same as before ends too: the button is "Check again" once more, not "Checking…" for good.
        await page.evaluate(click(within("oats-home-cli-retry")));
        const ended = await page.until(`(() => { const button = document.querySelector(${JSON.stringify(within("oats-home-cli-retry"))}); return button && !button.disabled && button.innerText.trim() === "Check again" && document.querySelector(${JSON.stringify(within("oats-home-cli"))}) !== null ? "ended" : ""; })()`, 20);
        check(ended === "ended", `${at} a check that reads the same oats ends: the card stays, and Check again can be pressed again`, await page.evaluate(cardText));

        // of a later minor than the plugin was tested with: no act is turned off, so nothing is said of it (no line, no card), and New agent is on
        installed({ version: "0.71.2" });
        check(await open(page, within("oats-home-needs")), `${at} with an oats of a later minor the home draws`, await page.evaluate(textOf(PAGE)));
        const later = await page.until(`(() => { const button = document.querySelector(${JSON.stringify(within("oats-home-new-agent"))}); return document.querySelector(${JSON.stringify(within("oats-home-cli"))}) === null && button && !button.disabled ? JSON.stringify({ line: document.querySelector(${JSON.stringify(within("oats-home-cli-line"))}) !== null, said: /tested with|0\\.71\\.2|Check again/.test(document.querySelector(${JSON.stringify(PAGE)}).innerText) }) : ""; })()`, 20);
        check(later === JSON.stringify({ line: false, said: false }), `${at} an oats of a later minor: no line and no card, nothing said of it, and New agent is on`, later ?? (await page.evaluate(textOf(PAGE))));

        // After the install the person asks again, on the page: the notice goes without a reload.
        installed({ version: "0.69.4" });
        check(await open(page, within("oats-home-cli")), `${at} the older oats draws the card again`, await page.evaluate(textOf(PAGE)));
        setVerb("version", null);
        await page.evaluate(click(within("oats-home-cli-retry")));
        const gone = await page.until(`document.querySelector(${JSON.stringify(within("oats-home-cli-line"))}) === null && document.querySelector(${JSON.stringify(within("oats-home-cli"))}) === null`, 20);
        check(Boolean(gone), `${at} "Check again" reads the installed oats anew: with a tested one the notice goes, on the page as it is`, await page.evaluate(textOf(PAGE)));
      } finally {
        installed(null);
      }
      // the recorded oats again: a tested one says nothing
      check(await open(page, within("oats-home-needs")), `${at} the home draws again`, await page.evaluate(textOf(PAGE)));
      const quiet = await page.until(`document.querySelector(${JSON.stringify(within("oats-home-cli"))}) === null && document.querySelector(${JSON.stringify(within("oats-home-cli-line"))}) === null && document.querySelector(${JSON.stringify(within("oats-home-needs"))}) !== null`, 15);
      check(Boolean(quiet), `${at} with the tested oats the home says nothing of the CLI`, await page.evaluate(textOf(PAGE)));
    },
  },
  {
    // The home has no tile for the agents and the sidebar no line that opens the home: at a phone's
    // width, where bb keeps the sidebar in a drawer, the roster must be one press from the home.
    stage: "pages-default",
    name: "at a phone's width the whole roster is one press from the home: bb's own drawer over the plugin's page; an idle agent's row opens its thread, the tmux agent's row its page",
    run: async ({ page, at, viewport, threads, check: plain }) => {
      if (!viewport.mobile) return;
      const check = printing(plain);
      const SIDE = testId("oats-sidebar");
      const roster = `(() => { const side = document.querySelector(${JSON.stringify(SIDE)}); if (!side || side.getBoundingClientRect().width === 0) return ""; const rows = [...side.querySelectorAll(${JSON.stringify(`${testId("oats-agent-row")}, ${testId("oats-agent-row-threadless")}`)})]; return JSON.stringify(rows.map((row) => [row.getAttribute("data-sidebar-thread-id") ?? row.getAttribute("data-instance"), (row.querySelector(${JSON.stringify(testId("oats-row-facts"))})?.getAttribute("title") ?? "")])); })()`;
      const idle = threads.get("thr_harvest"); // harvest-knowledge-helper: idle
      const stopped = threads.get("thr_digest"); // weekly-digest-helper: stopped
      const TMUX = "kernel-fix-developer";
      const drawer = async (what) => {
        check(await open(page, within("oats-home-needs")), `${at} ${what}: the home (the plugin's page, with the default pages)`, await page.evaluate(textOf(PAGE)));
        // The roster is not on the page at this width: it is in bb's drawer, behind bb's own toggle. bb keeps the
        // drawer as a person left it (a scene before this one, or the press before, may have left it open): it is
        // closed first, with bb's own toggle, so that what follows proves the toggle OPENS it from the plugin's page.
        // (A closed drawer keeps the sidebar in the page where it was, INERT and under the page: bb marks it so. Its
        // box alone says nothing: "not on screen" is "inert, or not what a press at its place would reach".)
        const HIDDEN = `(() => { const side = document.querySelector(${JSON.stringify(SIDE)}); if (!side) return true; if (side.closest("[inert]") !== null) return true; const box = side.getBoundingClientRect(); if (box.width === 0) return true; const top = document.elementFromPoint(Math.min(Math.max(box.left + box.width / 2, 0), innerWidth - 1), Math.min(Math.max(box.top + 40, 0), innerHeight - 1)); return top === null || !side.contains(top); })()`;
        const TOGGLE = `(() => { const b = [...document.querySelectorAll("button")].find((b) => /^Toggle sidebar/i.test(b.getAttribute("aria-label") ?? "") && b.getBoundingClientRect().width > 0); b?.click(); return b?.getAttribute("aria-label") ?? null; })()`;
        const closedBy = (await page.evaluate(HIDDEN)) === true ? "as bb opened the page" : `by bb's own "${await page.evaluate(TOGGLE)}"`;
        const hidden = await page.until(`${HIDDEN} === true`, 10);
        check(Boolean(hidden), `${at} ${what}: with bb's drawer closed (${closedBy}) the sidebar is not on screen beside the home at this width`, String(await page.evaluate(HIDDEN)));
        check(await showSidebar(page, viewport), `${at} ${what}: bb's own toggle opens its drawer over the plugin's home, and the roster is in it`, await page.evaluate(`JSON.stringify([...document.querySelectorAll("button")].filter((b) => b.getBoundingClientRect().width > 0).map((b) => b.getAttribute("aria-label") ?? b.innerText.trim()).slice(0, 12))`));
        return page.until(`(() => { const rows = ${roster}; return rows !== "" && JSON.parse(rows).length >= 8 ? rows : ""; })()`, 20);
      };
      const first = await drawer("first");
      const rows = Object.fromEntries(JSON.parse(first || (await page.evaluate(roster)) || "[]"));
      check(Object.keys(rows).length === 8 && rows[idle.id] === "Idle · knowledge-harvester" && rows[stopped.id] === "Stopped · oats-expert" && rows[TMUX] === "Working · oats-developer · tmux", `${at} the drawer holds every agent of the roster, each with its state: an idle one, a stopped one and the one on tmux among the eight`, JSON.stringify(rows));
      await page.shot(`home-${viewport.name}-drawer`);
      // An idle agent's row opens its thread.
      await page.evaluate(`document.querySelector(${JSON.stringify(`${SIDE} ${testId("oats-agent-row")}[data-sidebar-thread-id="${idle.id}"]`)}).click()`);
      const onThread = await page.until(`location.pathname.endsWith(${JSON.stringify(`/threads/${idle.id}`)}) ? location.pathname : ""`, 20);
      check(Boolean(onThread), `${at} the idle agent's row, pressed in the drawer, opens its thread`, await page.evaluate("location.pathname"));
      // Back on the home: the drawer again, and the tmux agent's row opens its own page.
      await drawer("again");
      await page.evaluate(`document.querySelector(${JSON.stringify(`${SIDE} ${testId("oats-agent-row-threadless")}[data-instance="${TMUX}"]`)}).click()`);
      const onPage = await page.until(`location.pathname.endsWith(${JSON.stringify(`/plugins/oats/agent/${TMUX}`)}) && document.querySelector(${JSON.stringify(testId("oats-agent-page"))}) !== null ? location.pathname : ""`, 20);
      check(Boolean(onPage), `${at} the tmux agent's row, pressed in the drawer, opens its own page`, await page.evaluate("location.pathname"));
    },
  },
  {
    stage: "pages-default",
    name: "the release's default shows the home alone: no tile at all",
    run: async ({ page, at, viewport, check: plain }) => {
      const check = printing(plain);
      check(await open(page, within("oats-home-needs")), `${at} the home draws who needs the person`, await page.evaluate(textOf(PAGE)));
      // (bb gives the plugin's settings a moment after the page: the tiles of the other pages, if they were drawn first, go.)
      const tiles = await page.until(`document.querySelector(${JSON.stringify(within("oats-home-tiles"))}) === null ? "none" : ""`, 30);
      check(tiles === "none", `${at} with the default the home has no tile: a tile leads to a page that is shown, and the agents have none`, tiles ?? (await page.evaluate(`JSON.stringify(${texts(`${within("oats-home-tiles")} button`)})`)));
      await shown(page, check, at, within("oats-home-needs"), "what needs the person");
      await sound(page, viewport, check, at, "the home under the default");
      await page.shot(`home-${viewport.name}-default`);
    },
  },
  {
    stage: "fixtures",
    name: "a first read: \"Reading…\" while OATS is read, and what the home says when that read fails",
    run: async ({ page, at, viewport, check: plain }) => {
      const check = printing(plain);
      const status = verbNow("status");
      try {
        // A slow first read: the server holds no roster (the setting that names `oats` changed), and `oats status` takes its time.
        setVerb("status", { ...status, sleepMs: 12_000 });
        oatsBin(true);
        await page.goto(HOME);
        const reading = await page.until(`(() => { const text = ${textOf(PAGE)}; return text.includes("Reading…") ? text : ""; })()`, 10);
        check(reading === "Reading…", `${at} while the roster is read for the first time the home says so in one word, and nothing else`, reading ?? (await page.evaluate(textOf(PAGE))));
        await settled(page, viewport);
        // The image is of the state its name says, or there is none.
        if (reading === "Reading…") await page.shot(`home-${viewport.name}-loading`);
        // and it then draws what was read
        const drawn = await page.until(`document.querySelector(${JSON.stringify(within("oats-needs-card"))}) !== null`, 40);
        check(Boolean(drawn), `${at} and then draws the roster it read`, await page.evaluate(textOf(PAGE)));

        // A first read that fails: no roster was ever read under these settings.
        setVerb("status", FAILS);
        oatsBin(false);
        check((await untilRoster((roster) => roster.ok === false && (roster.last === undefined || roster.last === null))) !== undefined, `${at} the server has no roster and its read fails`, untilRoster.last);
        await page.goto(HOME);
        const failed = await page.until(`(() => { const notice = document.querySelector(${JSON.stringify(`${PAGE} ${testId("oats-notice")}`)}); return notice ? notice.querySelector("h3").innerText.trim() + " | " + notice.innerText.replace(/\\s+/g, " ").trim() : ""; })()`, 30);
        check(Boolean(failed) && /Retry/.test(failed) && !/\bRead .+ ago|Last read|Acts are off/.test(failed) && (await page.evaluate(`document.querySelector(${JSON.stringify(within("oats-home-needs"))}) === null && document.querySelector(${JSON.stringify(within("oats-home-tiles"))}) === null`)) === true, `${at} a first read that failed: one titled notice with Retry, no age of anything kept, and no roster drawn`, failed ?? (await page.evaluate(textOf(PAGE))));
        await sound(page, viewport, check, at, "the home that could not be read");
        if (Boolean(failed) && !/\bRead .+ ago|Last read/.test(failed)) await page.shot(`home-${viewport.name}-unreadable`);
      } finally {
        setVerb("status", status ?? null);
        oatsBin(false);
        check((await untilRoster((roster) => roster.ok === true)) !== undefined, `${at} and the roster is read again afterwards`, untilRoster.last);
      }
    },
  },
  {
    stage: "detached",
    name: "an agent whose session failed, one the kernel cannot reach, one whose bb thread is gone: on the home, and in Home › Agents with its count line",
    run: async ({ page, at, viewport, check: plain }) => {
      const check = printing(plain);
      check(await open(page, within("oats-home-tiles")), `${at} the home draws its tiles`, await page.evaluate(textOf(PAGE)));
      const total = await page.evaluate(`JSON.stringify({ agents: document.querySelector(${JSON.stringify(within("oats-tile-agents"))}) !== null, summary: document.querySelector(${JSON.stringify(within("oats-home-summary"))}) !== null })`);
      check(total === JSON.stringify({ agents: false, summary: false }), `${at} the home has no tile for the agents, and no summary line`, total);
      await shown(page, check, at, within("oats-home-tiles"), "the tiles");
      await sound(page, viewport, check, at, "the home with a failed and an unreachable agent");
      await page.shot(`home-${viewport.name}-states`);
      check(await open(page, within("oats-home-agent-row"), `${HOME}/agents`), `${at} Home › Agents opens`, await page.evaluate(textOf(PAGE)));
      // The one count line of the home is Home › Agents': it counts the failed agent and the unreachable one, each agent once, with no total.
      const summary = await page.until(`(() => { const text = ${textOf(within("oats-home-summary"))}; return /1 failed/.test(text) && /1 unreachable/.test(text) ? text : ""; })()`, 20);
      const numbers = String(summary ?? "").split(" · ").map((part) => Number(part.split(" ")[0]));
      const listed = await page.evaluate(headingOf("oats-home-agents"));
      check(Boolean(summary) && !/agents/.test(summary) && new RegExp(`^agents ?${numbers.reduce((sum, n) => sum + n, 0)}$`, "i").test(listed), `${at} the count line counts the failed agent and the unreachable one, each agent once: as many as the heading over the list says`, `${summary ?? (await page.evaluate(textOf(within("oats-home-summary"))))} under "${listed}"`);
      const read = `JSON.stringify(Object.fromEntries([...document.querySelectorAll(${JSON.stringify(within("oats-home-agent-row"))})].map((row) => [row.dataset.instance, row.innerText.replace(/\\s+/g, " ").trim()])))`;
      // Where its thread is comes from bb's own answer for its id (the one the sidebar's row reads): waited for.
      const answered = await page.until(`(() => { const rows = ${read}; return /deleted in bb/.test(JSON.parse(rows)["weekly-digest-helper"] ?? "") ? rows : ""; })()`, 30);
      const rows = JSON.parse(answered || (await page.evaluate(read)));
      check(/Unreachable$/.test(rows["desktop-mockups-developer"] ?? "") && /Failed$/.test(rows["harvest-knowledge-helper"] ?? "") && /deleted in bb/.test(rows["weekly-digest-helper"] ?? "") && !/gone/.test(rows["weekly-digest-helper"] ?? "") && /Stopped$/.test(rows["weekly-digest-helper"] ?? ""), `${at} each is a row with its state in words: Unreachable, Failed, and a stopped one whose thread bb answers is deleted ("deleted in bb", the sidebar's own word, the reason alone)`, JSON.stringify(rows));
      await sound(page, viewport, check, at, "Home › Agents with every state");
      await page.shot(`home-${viewport.name}-agents-states`);
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
      check(first.length === 8 && more === `Show all ${all}` && (await page.evaluate(heading("oats-home-needs", `needs you ${all}`))), `${at} eight cards, the count of all in the heading, and "Show all ${all}"`, `${JSON.stringify(first)} | ${more} | ${await page.evaluate(headingOf("oats-home-needs"))}`);
      // Those a person can answer here come first: the three with a thread in bb, then the agents on tmux, the newest claim first.
      check(first.slice(0, 3).every((instance) => !instance.startsWith("sweep-")) && first[3] === `sweep-${MANY}-helper`, `${at} the three that can be answered here come before the agents on tmux`, JSON.stringify(first));
      // the card of an agent on tmux: what it asks, where it runs in a word, where to answer it in five, Open, and no reply box and no command (that is on its page)
      const tmuxCard = card(`sweep-${MANY}-helper`);
      const tmux = await page.evaluate(`(() => { const card = document.querySelector(${JSON.stringify(tmuxCard)}); return JSON.stringify({ text: card.innerText.replace(/\\s+/g, " ").trim(), glyph: card.querySelector('[data-testid="oats-needs-where"] [data-tmux="glyph"][role="img"][aria-label="tmux"] [aria-hidden="true"] > *') !== null, reply: card.querySelector('[data-testid="oats-reply"]') !== null, command: card.querySelector("code")?.innerText ?? null, copy: card.querySelector('[data-testid="oats-copy"]') !== null, open: card.querySelector('[data-testid="oats-needs-open"]').innerText.trim() }); })()`);
      const read = JSON.parse(tmux);
      check(read.reply === false && /^Sweep \d+ helper [a-z][a-z0-9.\/-]* ·( tmux)? Open\b/.test(read.text) && read.glyph === true && read.text.endsWith("Answer it in its terminal.") && !/runs in tmux|It runs in tmux on|oats session attach|shows who it is/.test(read.text) && read.command === null && read.copy === false && read.open === "Open" && read.text.includes(`Sweep ${MANY} is done: keep its checkpoint?`), `${at} an agent on tmux says what it asks, its soul and bb's terminal glyph named "tmux" under its name, and "Answer it in its terminal."; it has Open, no command and no reply box`, tmux);
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
    stage: "home-stopped-asks",
    name: "an agent OATS has stopped while bb holds a request on its thread: its card offers no answer and no message, says so, and offers Start",
    run: async ({ page, at, viewport, threads, check: plain }) => {
      const check = printing(plain);
      check(heldQuestion !== undefined, `${at} bb holds a question on the stopped agent's thread (the stage opened it)`, heldQuestion === undefined ? "the mock model opened no question in three messages" : heldQuestion.id);
      const mine = card(STOPPED_ASKS.instance);
      await page.goto(HOME);
      // bb's pending request is what makes the card (the agent OATS stopped carries no claim): wait for the card in its stopped form, with bb's question read.
      const read = await page.until(`(() => { const card = document.querySelector(${JSON.stringify(mine)}); if (!card || card.dataset.offer !== "stopped") return ""; const question = card.querySelector('[data-testid="oats-needs-question"]')?.innerText.trim() ?? ""; return question === "" ? "" : JSON.stringify({ offer: card.dataset.offer, question, says: (card.querySelector('[data-testid="oats-needs-stopped"] p')?.innerText ?? "").replace(/\\s+/g, " ").trim(), choices: card.querySelectorAll('[data-testid="oats-needs-choice"]').length, reply: card.querySelector('[data-testid="oats-reply"]') !== null, fold: card.querySelector('[data-testid="oats-needs-message"]') !== null, buttons: [...card.querySelectorAll("button")].map((button) => button.innerText.trim() + (button.disabled ? " (off)" : "")) }); })()`, 60);
      check(
        read === JSON.stringify({ offer: "stopped", question: STOPPED_QUESTION, says: "Not running. Start it to answer.", choices: 0, reply: false, fold: false, buttons: ["Open", "Start…"] }),
        `${at} the card says what bb's request asks and that the agent is not running; it has no choice, no reply and no "Message instead"; its two buttons are Open and Start…`,
        read ?? (await page.evaluate(`(document.querySelector(${JSON.stringify(mine)})?.outerHTML ?? ${textOf(PAGE)}).slice(0, 900)`)),
      );
      await shown(page, check, at, mine, "the stopped agent's card");
      await sound(page, viewport, check, at, "the card of a stopped agent bb holds a request for");
      await page.shot(`home-${viewport.name}-card-stopped`);
      // Start… opens the lifecycle's own dialog, about this agent; nothing is started on the press, and nothing went to bb.
      await page.evaluate(click(`${mine} ${testId("oats-needs-start")}`));
      const dialog = await page.until(`(() => { const body = document.querySelector(${JSON.stringify(testId("oats-confirm"))}); return body ? body.getAttribute("data-about") : ""; })()`, 20);
      check(dialog === STOPPED_ASKS.instance, `${at} Start… opens the lifecycle's dialog, about this agent`, dialog);
      await page.evaluate(`(document.querySelector(${JSON.stringify(testId("oats-confirm-cancel"))}) ?? document.querySelector(${JSON.stringify(testId("oats-confirm-close"))}))?.click()`);
      check(Boolean(await page.until(`document.querySelector(${JSON.stringify(testId("oats-confirm"))}) === null`, 10)), `${at} and its Cancel closes it`, await page.evaluate(`document.querySelector(${JSON.stringify(testId("oats-confirm"))})?.getAttribute("data-phase") ?? "gone"`));
      const still = heldQuestion === undefined ? [] : pendingOn(threads.get(STOPPED_ASKS.thread).id).map((interaction) => interaction.id);
      check(heldQuestion !== undefined && still.includes(heldQuestion.id), `${at} and bb's request is still pending: nothing of the home answered it`, JSON.stringify(still));
    },
  },
  {
    stage: "home-empty",
    name: "a workspace with no agent: \"No agents yet.\", and New agent",
    run: async ({ page, at, viewport, check: plain }) => {
      const check = printing(plain);
      check(await open(page, within("oats-home-new-agent")), `${at} the home offers New agent`, await page.evaluate(textOf(PAGE)));
      const words = await page.evaluate(textOf(within("oats-empty")));
      check(words === "No agents yet.", `${at} it says that there are no agents yet, in three words`, words);
      const head = await page.evaluate(`(() => { const head = document.querySelector(${JSON.stringify(within("oats-home-head"))}); const button = head?.querySelector('[data-testid="oats-home-new-agent"]'); return JSON.stringify({ text: (head?.innerText ?? "").replace(/\\s+/g, " ").trim(), off: button?.disabled ?? null }); })()`);
      check(head === JSON.stringify({ text: "New agent", off: false }), `${at} and New agent is the one act, first on the page`, head);
      check((await page.evaluate(`document.querySelector(${JSON.stringify(within("oats-home-needs"))}) === null && document.querySelector(${JSON.stringify(within("oats-home-summary"))}) === null`)) === true, `${at} and draws no empty group and no count of nothing`, await page.evaluate(textOf(PAGE)));
      await sound(page, viewport, check, at, "the empty workspace");
      await page.shot(`home-${viewport.name}-empty`);
    },
  },
  {
    stage: "home-stale",
    name: "OATS cannot be read after it was: the roster as last read, marked once, its acts off under the one notice",
    run: async ({ page, at, viewport, check: plain }) => {
      const check = printing(plain);
      check(await open(page, within("oats-needs-card")), `${at} the home keeps its cards`, await page.evaluate(textOf(PAGE)));
      const notices = JSON.parse(await page.evaluate(`JSON.stringify(${texts(`${PAGE} ${testId("oats-notice")}`)})`));
      check(notices.length === 1 && /Read (less than a minute ago|\d+ (min|h|d) ago)\. Acts are off\./.test(notices[0]) && /Retry/.test(notices[0]), `${at} one notice says OATS cannot be read, how old what is shown is and that the acts are off, and offers Retry`, JSON.stringify(notices));
      const newAgent = await page.evaluate(`(() => { const head = document.querySelector(${JSON.stringify(within("oats-home-head"))}); return JSON.stringify({ off: head?.querySelector('[data-testid="oats-home-new-agent"]')?.disabled ?? null, why: head?.querySelector('[data-testid="oats-disabled-reason"]')?.innerText.trim() ?? null, said: /Held until OATS is read again/.test(document.querySelector(${JSON.stringify(PAGE)}).innerText) }); })()`);
      check(newAgent === JSON.stringify({ off: true, why: null, said: false }), `${at} New agent is held: off, with no reason beside it (the notice under it says why)`, newAgent);
      const held = await page.evaluate(`JSON.stringify([...document.querySelectorAll(${JSON.stringify(within("oats-needs-card"))})].map((card) => ({ offer: card.dataset.offer, text: card.querySelector('[data-testid="oats-reply-text"]')?.disabled ?? null, send: card.querySelector('[data-testid="oats-reply-send"]')?.disabled ?? null, why: [...card.querySelectorAll('[data-testid="oats-disabled-reason"]')].filter((reason) => reason.checkVisibility()).map((reason) => reason.innerText.trim()), open: card.querySelector('[data-testid="oats-needs-open"]').disabled })))`);
      const cards = JSON.parse(held);
      check(cards.length === 3 && cards.every((each) => each.text === true && each.send === true && each.open === false) && cards.filter((each) => each.offer === "reply").length === 2 && cards.every((each) => each.why.length === 0), `${at} every card's reply is held, no card says why by itself (the page's one notice does), and Open still opens`, held);
      await sound(page, viewport, check, at, "the home as last read");
      await page.shot(`home-${viewport.name}-stale`);
    },
  },
];
