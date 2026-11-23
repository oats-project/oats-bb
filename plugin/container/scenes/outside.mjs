// The outside feature's live scenes: what the sidebar's row and the thread's line
// say when something happened to an OATS agent outside OATS (container/live-ui.mjs says what a
// scene is). Two stages of its own on one roster, every row of the feature's table at once:
// `outside`, and `outside-question`, the same while bb holds a question on the thread of the agent
// OATS recorded stopped. What OATS says is the fake's status (the fixtures' rows with the fields below); what bb
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
import { showSidebar, testId, textOf, visible } from "../browser.mjs";

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
const EVENTS = join(homedir(), "deployment", ".agents", "events", "live-ui.jsonl");

/** The stage's roster: the threads said archived are archived in bb, and the fake answers ROWS on a kernel that lists the feature. */
async function enter({ fake, statusWithRealIds, threads, untilSnapshot }) {
  for (const id of ARCHIVED) bb("thread", "archive", threads.get(id).id);
  const joined = new Map([...threads].filter(([id]) => id !== DELETED));
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
/** One row of the sidebar by its instance (a row with no thread to open) or by its thread: → `{ facts, state, warn, tag }`. */
const rowOf = (selector) =>
  `(() => { const flat = ${flat}; const row = document.querySelector(${JSON.stringify(selector)}); if (!row) return null; return { facts: flat(row.querySelector(${JSON.stringify(testId("oats-row-facts"))})), state: row.querySelector("[data-mark][data-state]")?.getAttribute("data-state") ?? null, warn: row.querySelector(${JSON.stringify(testId("oats-outside-mark"))})?.getAttribute("aria-label") ?? null }; })()`;
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
    `(() => { const flat = ${flat}; const row = document.querySelector(${JSON.stringify(testId("oats-identity-row"))}); const line = row?.querySelector(${JSON.stringify(testId("oats-status-line"))}); if (!line) return ""; const words = [flat(line.querySelector(${JSON.stringify(testId("oats-state"))})), ...[...line.querySelectorAll(${JSON.stringify(testId("oats-status-part"))})].map(flat)].join(" "); if (${test ? `!new RegExp(${JSON.stringify(wanted.source)}).test(words)` : "false"}) return ""; const acts = (e) => [...e.querySelectorAll(${JSON.stringify(testId("oats-status-act"))})].map(flat); const warning = row.querySelector(${JSON.stringify(testId("oats-outside-warning"))}); const notice = warning?.querySelector(${JSON.stringify(testId("oats-notice"))}); return JSON.stringify({ kind: row.getAttribute("data-outside"), state: line.getAttribute("data-state"), agent: flat(row.querySelector(${JSON.stringify(testId("oats-outside-agent"))})) || null, words, acts: acts(line), warning: notice ? { tone: notice.getAttribute("data-tone"), title: flat(notice.querySelector("h3")), text: flat(notice), acts: acts(notice) } : null }); })()`;
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
      const all = `JSON.stringify({ digest: ${rowOf(threadless("weekly-digest-helper"))}, ranker: ${rowOf(threadless("ranker-v3-probe"))}, flaky: ${rowOf(threadless("flaky-ci-developer"))}, outside: ${rowOf(onThread(threads.get("thr_harvest").id))}, failed: ${rowOf(onThread(threads.get("thr_mockups").id))}, unreachable: ${rowOf(onThread(threads.get("thr_redesign").id))}, open: ${rowOf(onThread(threads.get("thr_release").id))}, tree: ${textOf(testId("oats-tree"))}, marks: document.querySelectorAll(${JSON.stringify(testId("oats-outside-mark"))}).length })`;
      const settled = await page.until(`(() => { const now = ${all}; return /archived in bb/.test(now) && /Deleted in bb/.test(now) && /running outside OATS/.test(now) ? now : ""; })()`, 30);
      const rows = JSON.parse(settled || (await page.evaluate(all)));
      check(same(rows.digest, { facts: "Stopped · oats-expert · its conversation is archived in bb", state: "stopped", warn: null }), `${at} stopped, its thread archived in bb: "Stopped", and that its conversation is archived in bb`, JSON.stringify(rows.digest));
      check(same(rows.outside, { facts: "Stopped · knowledge-harvester · running outside OATS", state: "stopped", warn: "Running outside OATS" }) && rows.marks === 1, `${at} the kernel's outsideOats: the state OATS recorded, "running outside OATS", and the warning mark, on that row alone`, JSON.stringify([rows.outside, rows.marks]));
      check(same(rows.ranker, { facts: "Archived in bb · research-expert · OATS lost its session", state: "archived", warn: null }), `${at} a session lost, its thread archived in bb: "Archived in bb", and that OATS lost its session`, JSON.stringify(rows.ranker));
      check(same(rows.flaky, { facts: "Deleted in bb · oats-developer · its conversation is gone", state: "deleted", warn: null }), `${at} a session lost, its thread deleted in bb: "Deleted in bb", and that its conversation is gone`, JSON.stringify(rows.flaky));
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
      const marked = `document.querySelector(${JSON.stringify(`${onThread(thread.id)} ${testId("oats-outside-mark")}`)}) !== null`;
      check(Boolean(await page.until(`document.querySelector(${JSON.stringify(`${testId("oats-identity-row")} ${testId("oats-status-line")}`)})?.getAttribute("data-state") === "stopped" && !(${warned})`, 30)), `${at} before the report the thread's line says "Stopped", with no warning`);
      try {
        const reported = recordRows({ ...ROWS, [INSTANCE]: { ...STOPPED, outsideOats: report } });
        const onLine = (await page.until(warned, 15)) ? Date.now() - reported : null;
        check(onLine !== null && onLine <= 3000, `${at} the thread's line carries the kernel's report ${onLine === null ? "never" : `${onLine} ms`} after the kernel recorded it (3 s at most)`);
        // The row in the sidebar (beside the thread at 1280; in bb's drawer at 390, where it is read once the drawer is open).
        check(await showSidebar(page, viewport), `${at} the thread list is the OATS sidebar`);
        check(Boolean(await page.until(marked, viewport.mobile ? 15 : 3)), `${at} and its row in the sidebar has the warning mark`);
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
      check(line !== null && line.kind === "stopped-archived" && line.agent === "Weekly digest helper" && new RegExp(`^Stopped${SINCE} · Its conversation is archived in bb$`).test(line.words) && same(line.acts, ["Start", "Retire"]) && line.warning === null, `${at} stopped, archived: the archived thread's own row names the agent, says "Stopped" and "Its conversation is archived in bb", with Start and Retire`, line === null ? await shown() : JSON.stringify(line));
      // What bb 0.50.1 itself does with an archived thread opened by its id: the conversation, no composer, and its own bar.
      const bar = await page.until(`(() => { const text = document.body.innerText.replace(/\\s+/g, " "); return /Thread is archived/.test(text) ? JSON.stringify({ composer: document.querySelectorAll("textarea, [contenteditable=true], [role=textbox]").length, unarchive: [...document.querySelectorAll("button")].some((b) => b.innerText.trim() === "Unarchive") }) : ""; })()`, 15);
      check(bar === JSON.stringify({ composer: 0, unarchive: true }), `${at} bb shows the archived thread to read: no composer, "Thread is archived" and its own Unarchive`, bar ?? (await page.evaluate(`document.body.innerText.replace(/\\s+/g, " ").slice(-300)`)));
      await page.shot(`outside-${viewport.name}-thread-stopped-archived`, { targets: true });

      // a session lost, archived in bb
      await open("thr_research");
      const LOST = "Archived in bb · OATS lost its session, and its process still runs. Stop it, then start it from OATS.";
      line = await lineOf(page, /^Archived in bb · /);
      check(line !== null && line.kind === "lost-archived" && line.state === "archived" && line.words === LOST && same(line.acts, ["Stop", "Retire"]) && line.warning === null, `${at} lost, archived: "Archived in bb", that its process still runs, with Stop (then Start) and Retire`, line === null ? await shown() : JSON.stringify(line));
      await page.shot(`outside-${viewport.name}-thread-lost-archived`, { targets: true });

      // the kernel's report, on the open thread
      await open("thr_harvest");
      line = await lineOf(page, new RegExp(`^Stopped${SINCE}$`));
      const warned = line?.warning ?? null;
      check(
        line !== null && line.state === "stopped" && new RegExp(`^Stopped${SINCE}$`).test(line.words) && same(line.acts, []) && warned !== null && warned.tone === "warning" && warned.title === "Running outside OATS" && warned.text.includes(MESSAGE) && warned.text.includes("running-outside-oats") && same(warned.acts, ["Stop", "Start"]),
        `${at} outsideOats: under "Stopped", the kernel's message in the warning tone, its code after, with Stop and Start`,
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
      await page.until(`(${rowOf(threadless("flaky-ci-developer"))})?.facts.startsWith("Deleted in bb") === true`, 30);
      await page.evaluate(`document.querySelector(${JSON.stringify(threadless("flaky-ci-developer"))})?.click()`);
      check(Boolean(await page.until(`location.pathname.endsWith("/plugins/oats/agent/flaky-ci-developer")`, 15)), `${at} the row of an agent whose thread was deleted opens the agent's own page`, await page.evaluate("location.pathname"));
      const read = await page.until(
        `(() => { const flat = ${flat}; const head = document.querySelector(${JSON.stringify(testId("oats-panel-header"))}); const block = head?.querySelector(${JSON.stringify(testId("oats-outside-agent-block"))}); if (!block) return ""; return JSON.stringify({ name: flat(head.querySelector(${JSON.stringify(testId("oats-panel-name"))})), state: flat(head.querySelector(${JSON.stringify(`${testId("oats-panel-state")} ${testId("oats-state")}`)})), kind: block.getAttribute("data-outside"), sentence: flat(block.querySelector(":scope > p")), acts: [...block.querySelectorAll(${JSON.stringify(testId("oats-status-act"))})].map(flat) }); })()`,
        30,
      );
      check(
        read === JSON.stringify({ name: "Flaky ci developer", state: "Deleted in bb", kind: "lost-deleted", sentence: "Its conversation is gone. Start it from OATS for a new one.", acts: ["Start", "Retire"] }),
        `${at} its page says "Deleted in bb", that its conversation is gone, and has Start and Retire`,
        read ?? (await page.evaluate(textOf(testId("oats-agent-page")))),
      );
      await page.shot(`outside-${viewport.name}-agent-deleted`, { targets: true });
    },
  },
  {
    stage: "outside",
    name: "the instance panel's header with this feature's block at its largest (no listed thread, and the kernel's report): the tabs and the first part under them stay in view",
    run: async ({ page, at, viewport, check }) => {
      // The header does not scroll (who the agent is stays over the tabs), so what stands in it takes
      // its height from every tab. The largest it gets: an agent whose thread bb has archived (its
      // acts are here) that the kernel also reports running outside OATS (the notice, with its two acts).
      const INSTANCE = "weekly-digest-helper";
      const report = { code: "running-outside-oats", backend: "bb", message: MESSAGE.replaceAll(OUTSIDE, INSTANCE) };
      recordRows({ ...ROWS, [INSTANCE]: { ...STOPPED, outsideOats: report } });
      try {
        await page.goto(`/plugins/oats/agent/${INSTANCE}`);
        const read = await page.until(
          `(() => { const flat = ${flat}; const head = document.querySelector(${JSON.stringify(testId("oats-panel-header"))}); const block = head?.querySelector(${JSON.stringify(`${testId("oats-outside-agent-block")}[data-outside="outside"]`)}); const panel = document.querySelector('[role="tabpanel"]'); const tabs = document.querySelector('[role="tablist"]'); const first = panel?.querySelector("h2, h3"); if (!block || !panel || !tabs || !first) return ""; const box = (e) => { const r = e.getBoundingClientRect(); return { top: Math.round(r.top), bottom: Math.round(r.bottom) }; }; return JSON.stringify({ acts: [...block.querySelectorAll(${JSON.stringify(testId("oats-status-act"))})].map(flat), notice: flat(block.querySelector("h3")), header: box(head), tabs: box(tabs), first: { ...box(first), text: flat(first) }, panel: box(panel), window: innerHeight }); })()`,
          30,
        );
        const drawn = read ? JSON.parse(read) : null;
        // In view: the tabs whole, the first part's heading whole, and room under it for its first lines (two lines of a control's height).
        const room = viewport.mobile ? 88 : 64;
        check(
          drawn !== null && same(drawn.acts, ["Retire", "Stop", "Start"]) && drawn.notice === "Running outside OATS" && drawn.tabs.top >= drawn.header.bottom - 1 && drawn.tabs.bottom <= drawn.window && drawn.first.bottom + room <= drawn.window,
          `${at} with Retire, the kernel's notice and its Stop and Start in the header, the tabs and the first part under them (${drawn?.first.text ?? "none"}) are in view, with ${drawn === null ? "?" : drawn.window - drawn.first.bottom} px under its heading`,
          read ?? (await page.evaluate(textOf(testId("oats-agent-page")))),
        );
        await page.shot(`outside-${viewport.name}-agent-archived-outside`, { targets: true });
      } finally {
        recordRows(ROWS);
        await page.until(`document.querySelector(${JSON.stringify(`${testId("oats-outside-agent-block")}[data-outside="outside"]`)}) === null`, 15);
      }
    },
  },
  {
    stage: "outside-question",
    name: "bb has a question open for an agent OATS recorded stopped: its thread says \"Needs you\", and the kernel's report under it",
    run: async ({ page, at, viewport, threads, check }) => {
      const thread = threads.get("thr_harvest");
      check(question?.payload?.kind === "user_question", `${at} bb has a question open on the thread of the agent OATS recorded stopped`, JSON.stringify(question ?? null));
      // bb's question makes the thread "Needs you" (the roster's rule), and the report stands under the line.
      // (The home's card of such an agent carries the same notice once the rebuilt home calls it: README, "Outside OATS".)
      await page.goto(`/projects/${thread.projectId}/threads/${thread.id}`);
      const line = await lineOf(page, /^! Needs you · /);
      check(line !== null && line.words === "! Needs you · bb shows its question in this thread" && line.warning?.title === "Running outside OATS" && same(line.warning.acts, ["Stop", "Start"]), `${at} on its thread: "Needs you" for bb's question, and the kernel's report under the line`, line === null ? await page.evaluate(textOf(testId("oats-identity-row"))) : JSON.stringify(line));
      await page.shot(`outside-${viewport.name}-thread-outside-question`, { targets: true });
    },
  },
];
