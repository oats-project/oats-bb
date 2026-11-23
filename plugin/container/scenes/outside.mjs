// The outside feature's live scenes: what the sidebar's row and the thread's line
// say when something happened to an OATS agent outside OATS (container/live-ui.mjs says what a
// scene is). Stages of its own: `outside`, every row of the feature's table that is a stop of OATS's
// or an act in bb, at once on one roster; `outside-host`, the two rows that are neither (stopped
// with the machine, idle with no harness loaded); and `outside-question`, the first roster while bb
// holds a question on the thread of the agent OATS recorded stopped. What OATS says is the fake's status (the fixtures' rows with the fields below); what bb
// says of each thread is bb's own answer, made true in bb itself: the threads said archived ARE
// archived in bb for the length of the stage (and unarchived when it ends).
//
//   weekly-digest-helper       stopped by an operator, its thread archived in bb
//   release-070-maintainer     stopped by an operator, its thread open (the roster's own line)
//   harvest-knowledge-helper   recorded stopped, with the kernel's `outsideOats` (thread open)
//   ranker-v3-probe            its session lost, its thread archived in bb
//   flaky-ci-developer         its session lost, its thread not in bb (deleted)
//   desktop-mockups-developer  failed (its session ended in a shell), its thread open
//   redesign-ui-lead           unreachable
//
// `outsideOats` is shaped as the kernel's own test shapes it at v0.70.5, not recorded live
// (test/fixtures/outside/README.md), and the fake's status lists `provider-outside-oats` in its features.
// The deleted thread is an id bb has no thread of (the fixture's own id, never made in bb): bb
// answers an id it never had as it answers a deleted one (it leaves it out). The agent's bb thread
// of the other stages is archived meanwhile, so that it is not listed as a thread of nobody's.
import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { showSidebar, testId, textOf, texts, visible } from "../browser.mjs";

const bb = (...args) => execFileSync("bb", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
const bbJson = (...args) => JSON.parse(bb(...args, "--json"));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const OUTSIDE = "harvest-knowledge-helper";
const MESSAGE = `a harness runs in ${OUTSIDE} on bb, and OATS recorded this instance stopped: stop it with \`oats instance stop ${OUTSIDE}\`, or start it from OATS`;
const STOPPED = { running: false, runtimeState: "stopped", sessionEnd: "stopped", open: null, waitingOnYou: null };
const LOST = { running: false, runtimeState: "stopped", sessionEnd: "lost", open: null, waitingOnYou: null };
const ROWS = {
  "release-070-maintainer": STOPPED,
  [OUTSIDE]: { ...STOPPED, outsideOats: { code: "running-outside-oats", backend: "bb", message: MESSAGE } },
  "ranker-v3-probe": LOST,
  "flaky-ci-developer": LOST,
  "desktop-mockups-developer": { running: false, runtimeState: "shell" },
  "redesign-ui-lead": { running: null, runtimeState: "unreachable", sessionEnd: null },
};
/** The fixture threads bb holds archived while the stage runs. */
const ARCHIVED = ["thr_digest", "thr_research", "thr_ci"];
/** The fixture thread whose row keeps the fixture's own id: bb has no thread of it. */
const DELETED = "thr_ci";

/** The stage's status: the fixtures' rows with `rows`, as a kernel that lists `provider-outside-oats` prints it (the feature is in the status document's own `features`, which is where the plugin reads it). */
const statusOf = (statusWithRealIds, joined, rows) => {
  const status = JSON.parse(statusWithRealIds(joined, rows));
  status.features = [...new Set([...(status.features ?? []), "provider-outside-oats"])];
  return JSON.stringify(status);
};
/**
 * A change the kernel records while the stage runs, as live-ui's `record` makes one (the fake's
 * status with `rows`, and a line in the deployment's event log, which the plugin's watch sees),
 * keeping the stage's own features and threads: set by the stage's `enter`. → when it was recorded.
 */
let recordRows = () => {
  throw new Error("outside: the stage was not entered");
};
/** live-ui's `untilSnapshot` (asks the server to read OATS again until its snapshot matches), for a scene that changes the roster and is not about how soon: set by the stage's `enter`. */
let untilRoster = async () => {
  throw new Error("outside: the stage was not entered");
};
const EVENTS = join(homedir(), "deployment", ".agents", "events", "live-ui.jsonl");

/**
 * The rows of the stage `outside-host`: the three rows that read "not running", on threads that
 * are open, with nothing archived in bb: an operator's stop, and two rows that are NOT a stop of
 * OATS's. (The operator's stop is not the fixtures' own stopped agent: its thread's image is the
 * roster's `a13-…-thread-stopped`, and no two images of a run may be the same image.)
 *   harvest-knowledge-helper   stopped by an operator (sessionEnd "stopped"), its thread open Shaped as the kernel's contract says (docs/desktop-cli-api.md
 * at v0.70.5, "A status row of a provider home"), not recorded: `running: false` for an idle bb
 * thread exists only from the provider's next release.
 *   release-070-maintainer     stopped with the host (sessionEnd "lost"), its thread open
 *   desktop-mockups-developer  idle, no harness loaded (running false, runtimeState "unknown", no sessionEnd)
 */
const HOST_ROWS = {
  "harvest-knowledge-helper": STOPPED,
  "release-070-maintainer": LOST,
  "desktop-mockups-developer": { running: false, runtimeState: "unknown", waitingOnYou: null },
};

/** The stage's roster: the threads said archived are archived in bb, and the fake answers ROWS on a kernel that lists the feature. */
async function enter({ fake, statusWithRealIds, threads, untilSnapshot }) {
  for (const id of ARCHIVED) bb("thread", "archive", threads.get(id).id);
  const joined = new Map([...threads].filter(([id]) => id !== DELETED));
  untilRoster = untilSnapshot;
  recordRows = (rows) => {
    fake({ status: { stdout: statusOf(statusWithRealIds, joined, rows) } });
    const at = Date.now();
    appendFileSync(EVENTS, `${JSON.stringify({ kind: "live-ui", at: new Date(at).toISOString() })}\n`);
    return at;
  };
  fake({ status: { stdout: statusOf(statusWithRealIds, joined, ROWS) } });
  await untilSnapshot((snapshot) => snapshot.ok === true && snapshot.agents.some((agent) => agent.instance === OUTSIDE && agent.outsideOats?.code === "running-outside-oats"));
}
async function leave({ fake, threads }) {
  for (const id of ARCHIVED) bb("thread", "unarchive", threads.get(id).id);
  fake();
}

// bb's question on the thread of the agent OATS recorded stopped: a message there started it again,
// and the mock model asks what the message names (real/mock-anthropic.mjs, MOCK-ASK). Asked ONCE,
// when its stage is entered, and answered when the stage is left, as a person would: the pages of
// the stage all see the one question.
const QUESTION = "Keep the harvest running, or stop here?";
const ASK = { questions: [{ question: QUESTION, header: "Harvest", multiSelect: false, options: [{ label: "Keep running", description: "Go on." }, { label: "Stop here", description: "Stop now." }] }] };
const pendingOn = (threadId) => bbJson("thread", "interactions", "list", threadId).filter((interaction) => interaction.status === "pending");
/** → bb's pending interaction, or undefined when none opened in `seconds`. */
async function untilPending(threadId, seconds) {
  for (const deadline = Date.now() + seconds * 1000; Date.now() < deadline; await sleep(1000)) {
    const found = pendingOn(threadId)[0];
    if (found !== undefined) return found;
  }
  return undefined;
}
/** The question bb holds while the stage `outside-question` runs; undefined when none opened (its scenes then fail, and say so). */
let question;

export const stages = {
  outside: { label: "OUT", enter, leave },
  "outside-host": {
    label: "OUTH",
    enter: async ({ fake, statusWithRealIds, threads, untilSnapshot }) => {
      fake({ status: { stdout: statusOf(statusWithRealIds, threads, HOST_ROWS) } });
      await untilSnapshot((snapshot) => snapshot.ok === true && snapshot.agents.some((agent) => agent.instance === "release-070-maintainer" && agent.sessionEnd === "lost"));
    },
    leave: async ({ fake }) => fake(),
  },
  "outside-question": {
    label: "OUTQ",
    enter: async (stage) => {
      await enter(stage);
      const thread = stage.threads.get("thr_harvest");
      question = undefined;
      // The mock asks only when the message is the last one Claude Code sends it, which it has been
      // seen not to be (one turn in nine, in this feature's own runs: the model answered with its
      // line of text instead). A message that opened no question is said, and sent once more.
      for (let attempt = 1; attempt <= 3 && question === undefined; attempt += 1) {
        bb("thread", "tell", thread.id, `One more thing.\nMOCK-ASK:${JSON.stringify(ASK)}\n`);
        question = await untilPending(thread.id, 45);
        if (question === undefined) console.log(`NOTE outside: the message to "${thread.title}" opened no question in 45 s (attempt ${attempt} of 3); bb says its status is ${bbJson("thread", "show", thread.id).thread?.status}`);
      }
    },
    leave: async (stage) => {
      const thread = stage.threads.get("thr_harvest");
      try {
        if (question !== undefined) {
          const asked = question.payload.questions[0];
          bb("thread", "interactions", "answer", question.id, thread.id, "--choice", `${asked.id}=${asked.options[0].value}`);
          for (const deadline = Date.now() + 60_000; Date.now() < deadline && (pendingOn(thread.id).length > 0 || bbJson("thread", "show", thread.id).thread?.status !== "idle"); ) await sleep(1000);
        }
      } finally {
        question = undefined;
        await leave(stage);
      }
    },
  },
};

const flat = `(e) => (e?.innerText ?? "").replace(/\\s+/g, " ").trim()`;
/** The acts of a place, in order: this feature's own buttons and the line's (`oats-status-act`), and the lifecycle's `AgentActs` (`oats-agent-act-<verb>`, named with "…": each opens its dialog). */
const ACT = '[data-testid="oats-status-act"], [data-testid^="oats-agent-act-"]';
/** One row of the sidebar by its instance (a row with no thread to open) or by its thread: → `{ facts, state, tone, lines }`: its second line's words, its mark's state and tone, and how many lines that second line takes. */
const rowOf = (selector) =>
  `(() => { const flat = ${flat}; const row = document.querySelector(${JSON.stringify(selector)}); if (!row) return null; const facts = row.querySelector(${JSON.stringify(testId("oats-row-facts"))}); const mark = row.querySelector("[data-mark][data-state]"); return { facts: flat(facts), state: mark?.getAttribute("data-state") ?? null, tone: mark?.getAttribute("data-tone") ?? null, lines: facts ? Math.round(facts.getBoundingClientRect().height / parseFloat(getComputedStyle(facts).lineHeight)) : 0 }; })()`;
const threadless = (instance) => `${testId("oats-agent-row-threadless")}[data-instance="${instance}"]`;
const onThread = (id) => `${testId("oats-agent-row")}[data-sidebar-thread-id="${id}"]`;

/**
 * The thread's own row, read once its line says `wanted` (a RegExp of the line's words: the state
 * word, then each part after its separator): → `{ kind, words, acts, warning }`, where `acts` are
 * the line's own buttons and `warning` the notice under it (`{ tone, title, text, acts }`) or null.
 * When the wait runs out the row is read as it is, for the failing check to print.
 */
async function lineOf(page, wanted) {
  const read = (test) =>
    `(() => { const flat = ${flat}; const row = document.querySelector(${JSON.stringify(testId("oats-identity-row"))}); const line = row?.querySelector(${JSON.stringify(testId("oats-status-line"))}); if (!line) return ""; const words = [flat(line.querySelector(${JSON.stringify(testId("oats-state"))})), ...[...line.querySelectorAll(${JSON.stringify(testId("oats-status-part"))})].map(flat)].join(" "); if (${test ? `!new RegExp(${JSON.stringify(wanted.source)}).test(words)` : "false"}) return ""; const acts = (e) => [...e.querySelectorAll(${JSON.stringify(ACT)})].map(flat); const warning = row.querySelector(${JSON.stringify(testId("oats-outside-warning"))}); const notice = warning?.querySelector(${JSON.stringify(testId("oats-notice"))}); const fold = notice?.querySelector(${JSON.stringify(testId("oats-notice-details"))}); return JSON.stringify({ kind: row.getAttribute("data-outside"), state: line.getAttribute("data-state"), stateTone: line.querySelector(${JSON.stringify(testId("oats-state"))})?.getAttribute("data-tone") ?? null, agent: flat(row.querySelector(${JSON.stringify(testId("oats-outside-agent"))})) || null, words, tones: [...line.querySelectorAll(${JSON.stringify(testId("oats-status-part"))})].map((part) => part.getAttribute("data-tone")).filter(Boolean), acts: acts(line), warning: notice ? { tone: notice.getAttribute("data-tone"), title: flat(notice.querySelector("h3")), text: flat(notice), folded: fold ? !fold.open : null, kernel: (fold?.textContent ?? "").replace(/\\s+/g, " ").trim(), does: [...notice.querySelectorAll(${JSON.stringify(testId("oats-outside-act"))})].map(flat), acts: acts(notice) } : null }); })()`;
  const found = (await page.until(read(true), 30)) || (await page.evaluate(read(false)));
  return found ? JSON.parse(found) : null;
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
/** "since 14:03", or with its date: the time of the agent's last recorded stop, where the fake's events hold one. */
const SINCE = "( · since (\\w+ \\d+, )?\\d\\d:\\d\\d)?";

export default [
  {
    stage: "outside",
    name: "the sidebar's rows: each says what happened, and none says \"its bb thread is gone\"",
    run: async ({ page, at, viewport, threads, check }) => {
      await page.goto("/");
      check(await showSidebar(page, viewport), `${at} the thread list is the OATS sidebar`);
      // bb's own answer arrives after the roster: the rows are waited for, by what they say.
      const all = `JSON.stringify({ digest: ${rowOf(threadless("weekly-digest-helper"))}, ranker: ${rowOf(threadless("ranker-v3-probe"))}, flaky: ${rowOf(threadless("flaky-ci-developer"))}, outside: ${rowOf(onThread(threads.get("thr_harvest").id))}, failed: ${rowOf(onThread(threads.get("thr_mockups").id))}, unreachable: ${rowOf(onThread(threads.get("thr_redesign").id))}, open: ${rowOf(onThread(threads.get("thr_release").id))}, tree: ${textOf(testId("oats-tree"))}, outsides: document.querySelectorAll(${JSON.stringify(`${testId("oats-tree")} [data-mark][data-state="outside"]`)}).length, words: ${texts(`${testId("oats-tree")} ${testId("oats-row-facts")}`)}.map((facts) => facts.split(" · ")[0]) })`;
      const settled = await page.until(`(() => { const now = ${all}; return /archived in bb/.test(now) && /deleted in bb/.test(now) && /Running outside OATS/.test(now) ? now : ""; })()`, 30);
      const rows = JSON.parse(settled || (await page.evaluate(all)));
      // The reason takes the soul's place on a row: each of these rows' second line is ONE line, never two.
      check(same(rows.digest, { facts: "Stopped · archived in bb", state: "stopped", tone: null, lines: 1 }), `${at} stopped, its thread archived in bb: "Stopped · archived in bb", on one line`, JSON.stringify(rows.digest));
      check(same(rows.outside, { facts: "Running outside OATS", state: "outside", tone: null, lines: 1 }) && rows.outsides === 1, `${at} the kernel's outsideOats: the state IS "Running outside OATS", with its mark, alone on its line, on that row alone; no "Stopped" beside it`, JSON.stringify([rows.outside, rows.outsides]));
      check(same(rows.ranker, { facts: "Stopped · archived in bb", state: "stopped", tone: "warning", lines: 1 }), `${at} a session lost, its thread archived in bb: "Stopped" with its mark in the warning tone, then "archived in bb"`, JSON.stringify(rows.ranker));
      check(same(rows.flaky, { facts: "Stopped · deleted in bb", state: "stopped", tone: "warning", lines: 1 }), `${at} a session lost, its thread deleted in bb: "Stopped" with its mark in the warning tone, then "deleted in bb"`, JSON.stringify(rows.flaky));
      // Every row's state word is one of the set: "Archived in bb" and "Deleted in bb" are reasons after a state, never states.
      const SET = ["Needs you", "Working", "Idle", "Stopped", "Failed", "Unreachable", "Running outside OATS"];
      check(rows.words.length === 8 && rows.words.every((word) => SET.includes(word)), `${at} every row's state word is one of the set (${SET.join(", ")})`, JSON.stringify(rows.words));
      check(rows.failed?.facts === "Failed · oats-desktop-developer" && rows.unreachable?.facts === "Unreachable · oats-product-expert" && rows.open?.facts === "Stopped · oats-maintainer", `${at} failed, unreachable and stopped on an open thread: the roster's own words, with nothing after the soul`, JSON.stringify([rows.failed, rows.unreachable, rows.open]));
      check(!/its bb thread is gone/.test(rows.tree), `${at} no row says "its bb thread is gone"`, rows.tree);
      // The one the kernel reports running outside OATS is counted among those that need a person (no other agent of this roster waits).
      const foot = await page.evaluate(textOf(testId("oats-needs-line")));
      check(foot === "! 1 need you", `${at} the roster's foot counts the agent that runs outside OATS: "1 need you"`, foot);
      // No row's second line is cut.
      const cut = await page.evaluate(`[...document.querySelectorAll(${JSON.stringify(`${testId("oats-tree")} ${testId("oats-row-facts")}`)})].filter((e) => e.scrollWidth > e.clientWidth + 1).map((e) => e.innerText)`);
      check(cut.length === 0, `${at} no row's words are cut`, JSON.stringify(cut));
      await page.shot(`outside-${viewport.name}-sidebar`);
    },
  },
  {
    stage: "outside",
    name: "freshness: the kernel's report of a home that runs outside OATS is on its row and on its thread within 3 s",
    run: async ({ page, at, viewport, threads, check }) => {
      // The agent OATS stopped whose thread is open: the kernel then reports a harness in it (a
      // message was sent in its thread), and takes the report back once OATS has stopped it again.
      const INSTANCE = "release-070-maintainer";
      const thread = threads.get("thr_release");
      const report = { code: "running-outside-oats", backend: "bb", message: MESSAGE.replaceAll(OUTSIDE, INSTANCE) };
      await page.goto(`/projects/${thread.projectId}/threads/${thread.id}`);
      const warned = `document.querySelector(${JSON.stringify(`${testId("oats-identity-row")} ${testId("oats-outside-warning")}[data-instance="${INSTANCE}"]`)}) !== null`;
      const marked = `document.querySelector(${JSON.stringify(`${onThread(thread.id)} [data-mark][data-state="outside"]`)}) !== null`;
      check(Boolean(await page.until(`document.querySelector(${JSON.stringify(`${testId("oats-identity-row")} ${testId("oats-status-line")}`)})?.getAttribute("data-state") === "stopped" && !(${warned})`, 30)), `${at} before the report the thread's line says "Stopped", with no warning`);
      try {
        const reported = recordRows({ ...ROWS, [INSTANCE]: { ...STOPPED, outsideOats: report } });
        const onLine = (await page.until(warned, 15)) ? Date.now() - reported : null;
        check(onLine !== null && onLine <= 3000, `${at} the thread's line carries the kernel's report ${onLine === null ? "never" : `${onLine} ms`} after the kernel recorded it (3 s at most)`);
        // The row in the sidebar (beside the thread at 1280; in bb's drawer at 390, where it is read once the drawer is open).
        check(await showSidebar(page, viewport), `${at} the thread list is the OATS sidebar`);
        check(Boolean(await page.until(marked, viewport.mobile ? 15 : 3)), `${at} and its row in the sidebar is in the state "Running outside OATS"`);
      } finally {
        const back = recordRows(ROWS);
        const gone = (await page.until(`!(${warned})`, 15)) ? Date.now() - back : null;
        check(gone !== null && gone <= 3000, `${at} and the report is gone ${gone === null ? "never" : `${gone} ms`} after the kernel took it back (3 s at most)`);
      }
    },
  },
  {
    stage: "outside",
    name: "the thread's line, row by row of the table",
    run: async ({ page, at, viewport, threads, check }) => {
      const open = async (fixtureId) => {
        const thread = threads.get(fixtureId);
        await page.goto(`/projects/${thread.projectId}/threads/${thread.id}`);
        return thread;
      };
      const shown = () => page.evaluate(textOf(testId("oats-identity-row")));

      // stopped, archived: the way to the conversation is its row in the sidebar, which opens the archived thread.
      await page.goto("/");
      check(await showSidebar(page, viewport), `${at} the thread list is the OATS sidebar`);
      const digest = threads.get("thr_digest");
      await page.until(`(${rowOf(threadless("weekly-digest-helper"))})?.facts.includes("archived in bb") === true`, 30);
      await page.evaluate(`document.querySelector(${JSON.stringify(threadless("weekly-digest-helper"))})?.click()`);
      check(Boolean(await page.until(`location.pathname.endsWith("/threads/${digest.id}")`, 15)), `${at} the row of a stopped agent whose conversation is archived opens that thread in bb`, await page.evaluate("location.pathname"));
      let line = await lineOf(page, new RegExp(`^Stopped${SINCE} · Its conversation is archived in bb$`));
      check(line !== null && line.kind === "stopped-archived" && line.agent === "Weekly digest helper" && new RegExp(`^Stopped${SINCE} · Its conversation is archived in bb$`).test(line.words) && same(line.acts, ["Start…", "Retire…"]) && line.warning === null, `${at} stopped, archived: the archived thread's own row names the agent, says "Stopped" and "Its conversation is archived in bb", with the lifecycle's Start… and Retire…`, line === null ? await shown() : JSON.stringify(line));
      // What bb 0.50.1 itself does with an archived thread opened by its id: the conversation, no composer, and its own bar.
      const bar = await page.until(`(() => { const text = document.body.innerText.replace(/\\s+/g, " "); return /Thread is archived/.test(text) ? JSON.stringify({ composer: document.querySelectorAll("textarea, [contenteditable=true], [role=textbox]").length, unarchive: [...document.querySelectorAll("button")].some((b) => b.innerText.trim() === "Unarchive") }) : ""; })()`, 15);
      check(bar === JSON.stringify({ composer: 0, unarchive: true }), `${at} bb shows the archived thread to read: no composer, "Thread is archived" and its own Unarchive`, bar ?? (await page.evaluate(`document.body.innerText.replace(/\\s+/g, " ").slice(-300)`)));
      await page.shot(`outside-${viewport.name}-thread-stopped-archived`, { targets: true });

      // a session lost, archived in bb
      await open("thr_research");
      const LOST = new RegExp(`^Stopped${SINCE} · Its conversation was archived in bb while it ran, and its process may still run\\. Stop it, then start it from OATS\\.$`);
      line = await lineOf(page, LOST);
      check(line !== null && line.kind === "lost-archived" && line.state === "stopped" && line.stateTone === "warning" && same(line.tones, ["warning"]) && LOST.test(line.words) && same(line.acts, ["Stop", "Retire"]) && line.warning === null, `${at} lost, archived: "Stopped" in the warning tone, that its process may still run, with Stop (Start comes once it is stopped) and Retire`, line === null ? await shown() : JSON.stringify(line));
      await page.shot(`outside-${viewport.name}-thread-lost-archived`, { targets: true });

      // the kernel's report, on the open thread
      await open("thr_harvest");
      const OUTSIDE_LINE = /^Running outside OATS · recorded stopped( since (\w+ \d+, )?\d\d:\d\d)?$/;
      line = await lineOf(page, OUTSIDE_LINE);
      const warned = line?.warning ?? null;
      check(
        line !== null && line.state === "outside" && line.stateTone === "warning" && OUTSIDE_LINE.test(line.words) && same(line.acts, []) && warned !== null && warned.tone === "warning" && warned.title === "Harvest knowledge helper is running in bb, but OATS recorded it as stopped." && warned.text.includes("Someone sent it a message in bb. Stop it, or start it from OATS so that OATS tracks it again.") && !/`|oats instance stop|running-outside-oats/.test(warned.text) && warned.folded === true && warned.kernel.includes(MESSAGE) && warned.kernel.includes("running-outside-oats") && same(warned.does, ["Stop stops the harness that runs outside OATS", "Start starts it from OATS, in a new conversation"]) && same(warned.acts, ["Stop", "Start"]),
        `${at} outsideOats: ONE state, "Running outside OATS", in the warning tone, then what OATS recorded; the notice in a person's words (no command and no backtick on screen), the kernel's sentence and its code folded under Details, and Stop and Start each with what it does`,
        line === null ? await shown() : JSON.stringify(line),
      );
      await page.shot(`outside-${viewport.name}-thread-outside`, { targets: true });

      // failed, on its open thread
      await open("thr_mockups");
      line = await lineOf(page, /^Failed · /);
      check(line !== null && line.words === "Failed · Its session ended. Restart it, or send a message here." && same(line.acts, ["Restart"]) && line.warning === null, `${at} failed, open: "Failed", that a message here starts it again, with Restart and no warning`, line === null ? await shown() : JSON.stringify(line));
      await page.shot(`outside-${viewport.name}-thread-failed`, { targets: true });

      // unreachable: what status says, and nothing about a message
      await open("thr_redesign");
      line = await lineOf(page, /^Unreachable · /);
      check(line !== null && line.words === "Unreachable · OATS cannot reach its session" && same(line.acts, ["Retry"]) && line.warning === null && !/message/i.test(await shown()), `${at} unreachable: what status says, with Retry, and nothing about a message`, line === null ? await shown() : JSON.stringify(line));
      await page.shot(`outside-${viewport.name}-thread-unreachable`, { targets: true });

      // stopped, on an open thread: bb's composer is live under it, and the line says what a message there does
      await open("thr_release");
      const OPEN = new RegExp(`^Stopped${SINCE} · A message sent here in bb starts it again without OATS\\. Use Start\\.$`);
      line = await lineOf(page, OPEN);
      const composer = await page.evaluate(`document.querySelectorAll("textarea, [contenteditable=true], [role=textbox]").length`);
      check(line !== null && line.state === "stopped" && OPEN.test(line.words) && same(line.acts, ["Start"]) && line.warning === null && composer > 0, `${at} stopped, open: "Stopped", since when, that a message sent here starts it again without OATS, with Start; bb's composer is there`, line === null ? await shown() : JSON.stringify({ line, composer }));
      await page.shot(`outside-${viewport.name}-thread-stopped-open`, { targets: true });
    },
  },
  {
    stage: "outside",
    name: "an agent whose thread was deleted in bb: its row opens its own page, where its state, what happened, Start and Retire are",
    run: async ({ page, at, viewport, check }) => {
      await page.goto("/");
      check(await showSidebar(page, viewport), `${at} the thread list is the OATS sidebar`);
      await page.until(`(${rowOf(threadless("flaky-ci-developer"))})?.facts === "Stopped · deleted in bb"`, 30);
      await page.evaluate(`document.querySelector(${JSON.stringify(threadless("flaky-ci-developer"))})?.click()`);
      check(Boolean(await page.until(`location.pathname.endsWith("/plugins/oats/agent/flaky-ci-developer")`, 15)), `${at} the row of an agent whose thread was deleted opens the agent's own page`, await page.evaluate("location.pathname"));
      const read = await page.until(
        `(() => { const flat = ${flat}; const head = document.querySelector(${JSON.stringify(testId("oats-panel-header"))}); const block = document.querySelector(${JSON.stringify(`[role="tabpanel"] > ${testId("oats-outside-agent-block")}:first-child`)}); if (!head || !block) return ""; return JSON.stringify({ name: flat(head.querySelector(${JSON.stringify(testId("oats-panel-name"))})), state: flat(head.querySelector(${JSON.stringify(`${testId("oats-panel-state")} ${testId("oats-state")}`)})), kind: block.getAttribute("data-outside"), sentence: flat(block.querySelector(":scope > p")), acts: [...block.querySelectorAll(${JSON.stringify(ACT)})].map(flat) }); })()`,
        30,
      );
      check(
        read === JSON.stringify({ name: "Flaky ci developer", state: "Stopped", kind: "deleted", sentence: "Its conversation was deleted in bb. Start it from OATS for a new one.", acts: ["Start…", "Retire…"] }),
        `${at} its page says "Stopped", that its conversation was deleted in bb, and has the lifecycle's Start… and Retire…`,
        read ?? (await page.evaluate(textOf(testId("oats-agent-page")))),
      );
      await page.shot(`outside-${viewport.name}-agent-deleted`, { targets: true });
    },
  },
  {
    stage: "outside",
    name: "the agent's own page with this feature's block at its largest (no listed thread, and the kernel's report): the header over the tabs stays small and says the state, and the block is first on the Instance tab's page",
    run: async ({ page, at, viewport, check }) => {
      // The header over the tabs does not scroll (who the agent is stays in view), so what stands in it
      // takes its height from every tab: the block is on the Instance tab's page, first, and scrolls
      // with it. The largest it gets: an agent whose thread bb has archived (its Retire is there) that
      // the kernel also reports running outside OATS (the notice, with its two acts).
      const INSTANCE = "weekly-digest-helper";
      const report = { code: "running-outside-oats", backend: "bb", message: MESSAGE.replaceAll(OUTSIDE, INSTANCE) };
      const reported = (snapshot) => snapshot.ok === true && snapshot.agents.some((agent) => agent.instance === INSTANCE && agent.outsideOats != null);
      recordRows({ ...ROWS, [INSTANCE]: { ...STOPPED, outsideOats: report } });
      try {
        // The scene is about where the block stands, not about how soon the report arrives (the scene
        // before times that): the server's roster is waited for before the page is opened.
        await untilRoster(reported);
        await page.goto(`/plugins/oats/agent/${INSTANCE}`);
        const read = await page.until(
          `(() => { const flat = ${flat}; const head = document.querySelector(${JSON.stringify(testId("oats-panel-header"))}); const panel = document.querySelector('[role="tabpanel"]'); const tabs = document.querySelector('[role="tablist"]'); const block = panel?.querySelector(${JSON.stringify(`:scope > ${testId("oats-outside-agent-block")}[data-outside="outside"]:first-child`)}); const title = block?.querySelector("h3"); if (!head || !tabs || !block || !title) return ""; const box = (e) => { const r = e.getBoundingClientRect(); return { top: Math.round(r.top), bottom: Math.round(r.bottom) }; }; return JSON.stringify({ state: flat(head.querySelector(${JSON.stringify(`${testId("oats-panel-state")} ${testId("oats-state")}`)})), inHeader: head.querySelector(${JSON.stringify(testId("oats-outside-agent-block"))}) !== null, acts: [...block.querySelectorAll(${JSON.stringify(ACT)})].map(flat), notice: flat(title), header: box(head), tabs: box(tabs), title: box(title), window: innerHeight }); })()`,
          30,
        );
        const drawn = read ? JSON.parse(read) : null;
        check(
          drawn !== null && drawn.state === "Running outside OATS" && drawn.inHeader === false && same(drawn.acts, ["Retire", "Stop", "Start"]) && drawn.notice === "Weekly digest helper is running in bb, but OATS recorded it as stopped." && drawn.header.bottom <= drawn.window / 2 && drawn.tabs.top >= drawn.header.bottom - 1 && drawn.tabs.bottom <= drawn.window && drawn.title.bottom <= drawn.window,
          `${at} the header says "Running outside OATS" and ends ${drawn === null ? "?" : drawn.header.bottom} px down (the upper half of the window); the tabs are whole; the block is first under them, with Retire, the notice's title in view, and its Stop and Start`,
          read ?? (await page.evaluate(textOf(testId("oats-agent-page")))),
        );
        await page.shot(`outside-${viewport.name}-agent-archived-outside`, { targets: true });
      } finally {
        recordRows(ROWS);
        await untilRoster((snapshot) => snapshot.ok === true && !reported(snapshot));
        await page.until(`document.querySelector(${JSON.stringify(`${testId("oats-outside-agent-block")}[data-outside="outside"]`)}) === null`, 15);
      }
    },
  },
  {
    stage: "outside-host",
    name: "the three rows that read \"not running\" are never confused: an operator's stop, stopped with the machine, not loaded; on the sidebar's rows and on each thread's line",
    run: async ({ page, at, viewport, threads, check }) => {
      const shown = () => page.evaluate(textOf(testId("oats-identity-row")));
      const [operator, host, idle] = [threads.get("thr_harvest"), threads.get("thr_release"), threads.get("thr_mockups")];

      // The sidebar's three rows, side by side: two words of state, and what tells the two stopped ones apart.
      await page.goto("/");
      check(await showSidebar(page, viewport), `${at} the thread list is the OATS sidebar`);
      const all = `JSON.stringify({ operator: ${rowOf(onThread(operator.id))}, host: ${rowOf(onThread(host.id))}, idle: ${rowOf(onThread(idle.id))}, words: ${texts(`${testId("oats-tree")} ${testId("oats-row-facts")}`)}.map((facts) => facts.split(" · ")[0]) })`;
      const settled = await page.until(`(() => { const now = ${all}; return /with the machine/.test(now) && /not loaded/.test(now) ? now : ""; })()`, 30);
      const rows = JSON.parse(settled || (await page.evaluate(all)));
      check(
        same([rows.operator, rows.host, rows.idle], [
          { facts: "Stopped · knowledge-harvester", state: "stopped", tone: null, lines: 1 },
          { facts: "Stopped · with the machine", state: "stopped", tone: null, lines: 1 },
          { facts: "Idle · not loaded", state: "idle", tone: null, lines: 1 },
        ]) && rows.words.every((word) => ["Needs you", "Working", "Idle", "Stopped", "Failed", "Unreachable", "Running outside OATS"].includes(word)),
        `${at} the three rows: "Stopped · <soul>" (an operator's stop), "Stopped · with the machine", "Idle · not loaded": no two say the same, the one that is not stopped does not say Stopped, each on one line, and every state word is one of the set`,
        JSON.stringify(rows),
      );
      await page.shot(`outside-${viewport.name}-three-sidebar`);

      // (1) an operator's stop: "Stopped", the warning (in the warning tone), Start
      await page.goto(`/projects/${operator.projectId}/threads/${operator.id}`);
      const OPERATOR = new RegExp(`^Stopped${SINCE} · A message sent here in bb starts it again without OATS\\. Use Start\\.$`);
      const one = await lineOf(page, OPERATOR);
      check(one !== null && one.state === "stopped" && OPERATOR.test(one.words) && one.stateTone === "warning" && same(one.tones, ["warning"]) && same(one.acts, ["Start"]), `${at} (1) an operator's stop: "Stopped", the warning in the warning tone, Start`, one === null ? await shown() : JSON.stringify(one));
      await page.shot(`outside-${viewport.name}-three-1-operator-stop`, { targets: true });

      // (2) stopped with the machine: "Stopped · with the machine …", no warning
      await page.goto(`/projects/${host.projectId}/threads/${host.id}`);
      const HOST = new RegExp(`^Stopped${SINCE} · with the machine\\. OATS starts it again when the machine is back\\.$`);
      const two = await lineOf(page, HOST);
      check(two !== null && two.state === "stopped" && HOST.test(two.words) && two.stateTone === null && same(two.tones, []) && same(two.acts, ["Start"]) && two.warning === null && !/without OATS/.test(two.words), `${at} (2) stopped with the machine: "Stopped · with the machine", that OATS starts it again; no warning tone, and not the operator's sentence`, two === null ? await shown() : JSON.stringify(two));
      await page.shot(`outside-${viewport.name}-three-2-stopped-with-machine`, { targets: true });

      // (3) its session is there, not loaded: "Idle · not loaded …", no warning
      await page.goto(`/projects/${idle.projectId}/threads/${idle.id}`);
      const three = await lineOf(page, /^Idle · /);
      check(three !== null && three.state === "idle" && three.words === "Idle · not loaded. To carry on, send it a message here. Start begins a new conversation." && three.stateTone === null && same(three.tones, []) && same(three.acts, ["Start"]) && three.warning === null, `${at} (3) not loaded: "Idle", never "Stopped"; that a message here carries on and Start begins a new conversation; no warning tone`, three === null ? await shown() : JSON.stringify(three));
      await page.shot(`outside-${viewport.name}-three-3-idle-not-loaded`, { targets: true });

      // Never confused: the state word tells (3) from (1) and (2), the tone tells (1) from (2) and (3), and no two lines say the same.
      const lines = [one, two, three];
      check(
        lines.every((line) => line !== null) && same(lines.map((line) => line.state), ["stopped", "stopped", "idle"]) && same(lines.map((line) => line.tones.includes("warning")), [true, false, false]) && new Set(lines.map((line) => line.words.replace(new RegExp(SINCE), ""))).size === 3,
        `${at} the three are told apart: by the state word ("Stopped", "Stopped", "Idle") and by the tone (a warning for the operator's stop alone)`,
        JSON.stringify(lines),
      );
    },
  },
  {
    stage: "outside-question",
    name: "bb has a question open for an agent OATS recorded stopped: its thread says \"Needs you\", and the kernel's report under it",
    run: async ({ page, at, viewport, threads, check }) => {
      const thread = threads.get("thr_harvest");
      check(question?.payload?.kind === "user_question", `${at} bb has a question open on the thread of the agent OATS recorded stopped`, JSON.stringify(question ?? null));
      // bb's question would make any other agent's line "Needs you": this one runs outside OATS, and that is the one statement about it.
      // (The home's card of such an agent carries the same notice once the rebuilt home calls it: README, "Outside OATS".)
      await page.goto(`/projects/${thread.projectId}/threads/${thread.id}`);
      const line = await lineOf(page, /^Running outside OATS · /);
      check(line !== null && line.state === "outside" && /^Running outside OATS · recorded stopped/.test(line.words) && line.warning?.title === "Harvest knowledge helper is running in bb, but OATS recorded it as stopped." && same(line.warning.acts, ["Stop", "Start"]), `${at} on its thread, while bb holds a question: still ONE statement, "Running outside OATS", and the notice under the line`, line === null ? await page.evaluate(textOf(testId("oats-identity-row"))) : JSON.stringify(line));
      await page.shot(`outside-${viewport.name}-thread-outside-question`, { targets: true });
    },
  },
];
