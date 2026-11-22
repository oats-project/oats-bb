// The outside feature's live scenes: what the sidebar's row, the thread's line and the home's card
// say when something happened to an OATS agent outside OATS (container/live-ui.mjs says what a
// scene is). One stage of its own, `outside`: every row of the feature's table at once, in one
// roster. What OATS says is the fake's status (the fixtures' rows with the fields below); what bb
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
// (test/fixtures/outside/README.md), and the fake's version lists `provider-outside-oats`.
// The deleted thread is an id bb has no thread of (the fixture's own id, never made in bb): bb
// answers an id it never had as it answers a deleted one (it leaves it out). The agent's bb thread
// of the other stages is archived meanwhile, so that it is not listed as a thread of nobody's.
import { execFileSync } from "node:child_process";
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

export const stages = {
  outside: {
    label: "OUT",
    enter: async ({ fake, statusWithRealIds, threads, untilSnapshot }) => {
      for (const id of ARCHIVED) bb("thread", "archive", threads.get(id).id);
      const joined = new Map([...threads].filter(([id]) => id !== DELETED));
      fake({ status: { stdout: statusWithRealIds(joined, ROWS) }, version: { file: "outside/version-0.70.5.json" } });
      // The snapshot is read again (and with it, by Retry's own path, the kernel's version).
      await untilSnapshot((snapshot) => snapshot.ok === true && snapshot.agents.some((agent) => agent.instance === OUTSIDE && agent.running === false && agent.runtimeState === "stopped"));
    },
    leave: async ({ fake, threads }) => {
      for (const id of ARCHIVED) bb("thread", "unarchive", threads.get(id).id);
      fake();
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
      check(same(rows.ranker, { facts: "Archived in bb · research-expert · OATS lost its session", state: "error", warn: null }), `${at} a session lost, its thread archived in bb: "Archived in bb", and that OATS lost its session`, JSON.stringify(rows.ranker));
      check(same(rows.flaky, { facts: "Deleted in bb · oats-developer · its conversation is gone", state: "error", warn: null }), `${at} a session lost, its thread deleted in bb: "Deleted in bb", and that its conversation is gone`, JSON.stringify(rows.flaky));
      check(rows.failed?.facts === "Failed · oats-desktop-developer" && rows.unreachable?.facts === "Unreachable · oats-product-expert" && rows.open?.facts === "Stopped · oats-maintainer", `${at} failed, unreachable and stopped on an open thread: the roster's own words, with nothing after the soul`, JSON.stringify([rows.failed, rows.unreachable, rows.open]));
      check(!/its bb thread is gone/.test(rows.tree), `${at} no row says "its bb thread is gone"`, rows.tree);
      // No row's second line is cut.
      const cut = await page.evaluate(`[...document.querySelectorAll(${JSON.stringify(`${testId("oats-tree")} ${testId("oats-row-facts")}`)})].filter((e) => e.scrollWidth > e.clientWidth + 1).map((e) => e.innerText)`);
      check(cut.length === 0, `${at} no row's words are cut`, JSON.stringify(cut));
      await page.shot(`outside-${viewport.name}-sidebar`);
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
      check(line !== null && line.kind === "stopped-archived" && line.agent === "Weekly digest helper" && new RegExp(`^Stopped${SINCE} · Its conversation is archived in bb$`).test(line.words) && same(line.acts, ["Start"]) && line.warning === null, `${at} stopped, archived: the archived thread's own row names the agent, says "Stopped" and "Its conversation is archived in bb", with Start`, line === null ? await shown() : JSON.stringify(line));
      // What bb 0.50.1 itself does with an archived thread opened by its id: the conversation, no composer, and its own bar.
      const bar = await page.until(`(() => { const text = document.body.innerText.replace(/\\s+/g, " "); return /Thread is archived/.test(text) ? JSON.stringify({ composer: document.querySelectorAll("textarea, [contenteditable=true], [role=textbox]").length, unarchive: [...document.querySelectorAll("button")].some((b) => b.innerText.trim() === "Unarchive") }) : ""; })()`, 15);
      check(bar === JSON.stringify({ composer: 0, unarchive: true }), `${at} bb shows the archived thread to read: no composer, "Thread is archived" and its own Unarchive`, bar ?? (await page.evaluate(`document.body.innerText.replace(/\\s+/g, " ").slice(-300)`)));
      await page.shot(`outside-${viewport.name}-thread-stopped-archived`, { targets: true });

      // a session lost, archived in bb
      await open("thr_research");
      const LOST = "Archived in bb · OATS lost its session, and its process still runs. Stop it, then start it from OATS.";
      line = await lineOf(page, /^Archived in bb · /);
      check(line !== null && line.kind === "lost-archived" && line.state === "error" && line.words === LOST && same(line.acts, ["Stop"]) && line.warning === null, `${at} lost, archived: "Archived in bb", that its process still runs, and Stop (then Start)`, line === null ? await shown() : JSON.stringify(line));
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

      // stopped, on an open thread: the roster's own line
      await open("thr_release");
      line = await lineOf(page, new RegExp(`^Stopped${SINCE}`));
      check(line !== null && line.state === "stopped" && same(line.acts, ["Start"]) && line.warning === null && !/archived|deleted/i.test(line.words), `${at} stopped, open: the roster's own line, with Start; nothing of an archive`, line === null ? await shown() : JSON.stringify(line));
      await page.shot(`outside-${viewport.name}-thread-stopped-open`, { targets: true });
    },
  },
  {
    stage: "outside",
    name: "the home's card of an agent OATS stopped that bb has a question open for says the kernel's report",
    run: async ({ page, at, viewport, threads, check }) => {
      // bb has a question open on the thread of the agent OATS recorded stopped: a message there
      // started it again (the mock model asks what the message names: real/mock-anthropic.mjs).
      const thread = threads.get("thr_harvest");
      const QUESTION = "Keep the harvest running, or stop here?";
      const ask = { questions: [{ question: QUESTION, header: "Harvest", multiSelect: false, options: [{ label: "Keep running", description: "Go on." }, { label: "Stop here", description: "Stop now." }] }] };
      const pending = () => bbJson("thread", "interactions", "list", thread.id).filter((interaction) => interaction.status === "pending");
      bb("thread", "tell", thread.id, `One more thing.\nMOCK-ASK:${JSON.stringify(ask)}\n`);
      let asked;
      for (const deadline = Date.now() + 60_000; Date.now() < deadline && asked === undefined; ) {
        asked = pending()[0];
        if (asked === undefined) await sleep(1000);
      }
      check(asked?.payload?.kind === "user_question", `${at} bb has a question open on the thread of the agent OATS recorded stopped`, JSON.stringify(asked ?? null));
      try {
        await page.goto("/plugins/oats/home");
        const card = `[...document.querySelectorAll(${JSON.stringify(testId("oats-needs-card"))})].find((e) => e.querySelector(${JSON.stringify(`${testId("oats-outside-warning")}[data-instance="${OUTSIDE}"]`)}))`;
        const read = await page.until(`(() => { const flat = ${flat}; const card = ${card}; const notice = card?.querySelector(${JSON.stringify(testId("oats-notice"))}); if (!notice) return ""; notice.scrollIntoView({ block: "center" }); return JSON.stringify({ tone: notice.getAttribute("data-tone"), title: flat(notice.querySelector("h3")), text: flat(notice), acts: [...notice.querySelectorAll(${JSON.stringify(testId("oats-status-act"))})].map(flat), warnings: document.querySelectorAll(${JSON.stringify(testId("oats-outside-warning"))}).length }); })()`, 30);
        const said = read ? JSON.parse(read) : null;
        check(
          said !== null && said.tone === "warning" && said.title === "Running outside OATS" && said.text.includes(MESSAGE) && same(said.acts, ["Stop", "Start"]) && said.warnings === 1,
          `${at} the home's card of that agent says the kernel's message in the warning tone, with Stop and Start; no other card does`,
          read ?? (await page.evaluate(textOf(testId("oats-home-needs")))),
        );
        await page.shot(`outside-${viewport.name}-home-card`);
        // The thread itself: bb's question makes it "Needs you", and the report stands under the line.
        await page.goto(`/projects/${thread.projectId}/threads/${thread.id}`);
        const line = await lineOf(page, /^! Needs you · /);
        check(line !== null && line.words === "! Needs you · bb shows its question in this thread" && line.warning?.title === "Running outside OATS" && same(line.warning.acts, ["Stop", "Start"]), `${at} on its thread: "Needs you" for bb's question, and the kernel's report under the line`, line === null ? await page.evaluate(textOf(testId("oats-identity-row"))) : JSON.stringify(line));
        await page.shot(`outside-${viewport.name}-thread-outside-question`, { targets: true });
      } finally {
        // The question is answered, as a person would, so that the next page starts from the stage's own state.
        if (asked !== undefined) {
          const question = asked.payload.questions[0];
          bb("thread", "interactions", "answer", asked.id, thread.id, "--choice", `${question.id}=${question.options[0].value}`);
          for (const deadline = Date.now() + 60_000; Date.now() < deadline && (pending().length > 0 || bbJson("thread", "show", thread.id).thread?.status !== "idle"); ) await sleep(1000);
        }
      }
    },
  },
];
