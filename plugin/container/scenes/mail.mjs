// The live scenes of an agent's mail (container/live-ui.mjs says what a scene is): the tab "Mail"
// of the agent's panel, which is the OATS tab of the agent's thread at 1280x800 and the agent's own
// page at 390x800. Every scene is on the fixtures' roster (stage `fixtures`), on one agent, and
// changes only what the fake `oats` answers for the mail read, to one of the answers RECORDED from
// the real kernel and messaging layer (test/fixtures/mail/README.md):
//   the list, one message in its place (the hostile one), Back and the focus, the message the
//   messaging layer cut ("Shortened."); Older; no mail; the read in flight; each recorded refusal
//   as its one line with Retry, and the kernel's code and sentence under Details; one team whose
//   mail cannot be read.
// Every word of mail drawn here was made up for the recording. No scene prints a body in a check's
// line: a failing check prints the subject it read, or a count.
//
// And ONE scene on the busy workspace (stage `busy`, the shared set test/fixtures/busy: the worst-case rule): the
// mail of the set's busy agent, a full page of fifty messages, at both widths in both themes: the list's head, its
// end with "Older" under it, one message opened from the middle and the way back, the longest sender's name, the long
// report the messaging layer cut, and the longest subject. Its images
// (`busy-<view>-mail…`) are the ones a change to the Mail tab is judged by FIRST.
//
// Not drawn, because no recorded answer holds them (the unit tests hold their words, on a recorded
// answer with one named field changed: test/mail/mail.test.tsx): "Unverified sender", "Signature
// failed", "(no subject)", "<team>: <N> conversations can't be read", and the lines of
// E_MAIL_TOO_LARGE and of a read that ran out of time.
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { FOCUSED, showSidebar, testId, textOf, texts, visible } from "../browser.mjs";
import { atomicWrite } from "../files.mjs";
import { panelWhole } from "./panel.mjs";

const AGENT = { instance: "redesign-ui-lead", thread: "thr_redesign" };
const VERB = "operation run messaging:mail";
const FAKE_CONFIG = join(homedir(), ".local/bin/fake-oats.json");

/** What the fake `oats` answers for the mail read from now on: a recorded file, another behaviour, or (null) its default, the recorded mail. */
function answer(behaviour) {
  const config = JSON.parse(readFileSync(FAKE_CONFIG, "utf8"));
  const verbs = { ...config.verbs };
  if (behaviour === null) delete verbs[VERB];
  else verbs[VERB] = typeof behaviour === "string" ? { file: `mail/${behaviour}` } : behaviour;
  // Renamed into place (../files.mjs): the fake reads this file at every `oats` it stands for.
  atomicWrite(FAKE_CONFIG, JSON.stringify({ ...config, verbs }));
}

const inMail = (id) => `${testId("oats-mail")} ${testId(id)}`;
const click = (selector, index = 0) => `document.querySelectorAll(${JSON.stringify(selector)})[${index}].click()`;
const subjects = `JSON.stringify(${texts(inMail("oats-mail-subject"))})`;
/** A recorded body's first line as the view draws it (the set's bodies are plain lines: spaces folded, ends trimmed). */
const displayFirst = (body) => (body.split(/\r\n?|\n/)[0] ?? "").replace(/\s+/g, " ").trim();
/** The head is settled: no read is on its way (the head says "Reading…" while one is). What a scene waits for before it asserts a head with no read in it. */
const settledHead = `${textOf(inMail("oats-mail-read"))} !== "Reading…" && document.querySelector(${JSON.stringify(inMail("oats-mail-refresh"))})?.disabled === false`;
/** What is measured before an image: nothing of the mail is wider than the view, the page does not scroll sideways, and every control is high enough to press. */
const fits = (min) =>
  `JSON.stringify((() => { const root = document.querySelector(${JSON.stringify(testId("oats-mail"))}); const edge = root.getBoundingClientRect().right; return { wide: [...root.querySelectorAll("*")].filter((e) => e.getClientRects().length > 0 && e.getBoundingClientRect().right > Math.min(edge, innerWidth) + 0.5).length, scroll: document.documentElement.scrollWidth - innerWidth, low: [...root.querySelectorAll("button, summary")].filter((e) => e.getClientRects().length > 0 && e.getBoundingClientRect().height < ${min} - 0.5).length }; })())`;
async function fitted(page, viewport, check, at, what) {
  const read = await page.evaluate(fits(viewport.mobile ? 44 : 32));
  const fit = JSON.parse(read);
  check(fit.wide === 0 && fit.scroll <= 0 && fit.low === 0, `${at} ${what}: nothing of the mail passes its edge or the window's, and every control is at least ${viewport.mobile ? 44 : 32} px high`, read);
}
async function settled(page, viewport) {
  await page.until(`document.getAnimations().every((animation) => animation.playState !== "running")`, 5);
  if (!viewport.mobile) await page.until(`!location.pathname.includes("/threads/") || document.body.innerText.includes("Project checkout")`, 20);
}

/**
 * Shows the agent's panel as a person gets to it, and turns it to its tab "Mail". → `{ whole, shown }`: whether bb's side panel became whole (at 390 there is none: true), and whether the mail's view is there.
 * At 1280 the tab is pressed only once bb's side panel is whole (`panelWhole`, ./panel.mjs says why): bb 0.50.1 can
 * mount the panel's content a second time a fraction of a second after it opens, and a press before that is a press
 * on a panel that is about to be mounted again.
 */
async function openMail(page, threads, viewport) {
  const thread = threads.get(AGENT.thread);
  await page.goto(`/projects/${thread.projectId}/threads/${thread.id}`);
  await page.until(visible(testId("oats-open-panel")), 30);
  await page.evaluate(click(testId("oats-open-panel")));
  // Its answer is kept: a panel that never becomes whole fails the scene's first check, and does not pass for a wait that ran out.
  const whole = viewport.mobile || Boolean(await page.until(panelWhole, 30));
  await page.until(visible(testId("oats-tab-mail")), 30);
  await page.evaluate(click(testId("oats-tab-mail")));
  return { whole, shown: Boolean(await page.until(visible(testId("oats-mail")), 30)) };
}
/** Leaves the panel on its first tab, as the scenes after this file's expect it (the panel remembers its tab for the window), with the fake's default answer back. */
async function leave(page) {
  answer(null);
  if (await page.evaluate(visible(testId("oats-tab-instance")))) await page.evaluate(click(testId("oats-tab-instance")));
}
/** A scene of this file: the fake's answer for it, the tab opened, and both put back whatever the scene did. */
const scene = (name, first, run) => ({
  stage: "fixtures",
  name,
  run: async (given) => {
    answer(first);
    try {
      const opened = await openMail(given.page, given.threads, given.viewport);
      given.check(opened.whole && opened.shown, `${given.at} the tab Mail of the agent's panel shows the mail's view`, `${await given.page.evaluate("location.pathname")}${opened.whole ? "" : "; bb's side panel never became whole (panelWhole)"}${opened.shown ? "" : "; the mail's view is not there"}`);
      await run(given);
    } finally {
      await leave(given.page);
    }
  },
});

const REFUSALS = [
  ["refused-messaging-too-old.json", "Its messaging is too old for mail.", "E_OPERATION_UNKNOWN", "too-old"],
  ["refused-no-messaging.json", "No messaging.", "E_OPERATION_UNAVAILABLE", "no-messaging"],
  ["refused-aw-too-old.json", "aw is too old to read mail.", "E_AW_TOO_OLD", "aw-too-old"],
  ["refused-no-identity.json", "Its mail can't be read.", "E_MAIL_UNREADABLE", "unreadable"],
  ["refused-bad-cursor.json", "Mail can't be read.", "E_BAD_ARGS", "other"],
];

export default [
  scene("mail: the list, one message in its place, Back, and the message that was cut", null, async ({ page, at, viewport, check }) => {
    const tabs = await page.evaluate(`[...document.querySelectorAll('${testId("oats-panel")} [role="tab"]')].map((e) => e.innerText.trim() + ":" + e.getAttribute("aria-selected")).join(" ")`);
    check(tabs === "Instance:false Soul:false Mail:true", `${at} the control is ONE tab of the agent's panel, "Mail", selected`, tabs);
    await page.until(visible(inMail("oats-mail-row")), 30);
    {
      const read = await page.evaluate(subjects);
      check(read === JSON.stringify(["<i>Markup</i> in a subject", "A long report", "Parser ready for a first read"]), `${at} the list: the mail the agent received, newest first, by subject; the message it sent is no row`, read);
    }
    {
      const rows = JSON.parse(await page.evaluate(`JSON.stringify(${texts(inMail("oats-mail-row"))})`));
      check(rows.length === 3 && rows.every((row) => /^mail-writer (just now|\d+ (min|h|d) ago) \S/.test(row)), `${at} each row: who it is from and its age, then its subject`, String(rows.length));
    }
    await page.until(settledHead, 20);
    {
      const head = await page.evaluate(`JSON.stringify([${textOf(inMail("oats-mail-refresh"))}, ${textOf(inMail("oats-mail-read"))}, document.querySelector(${JSON.stringify(inMail("oats-mail-list"))})?.getAttribute("aria-label")])`);
      check(head === JSON.stringify(["Refresh", "", "Mail, newest first"]), `${at} the head: Refresh, and no age for what was just read; the list is named "Mail, newest first"`, head);
    }
    const marked = await page.evaluate(`document.querySelectorAll('${testId("oats-mail")} i, ${testId("oats-mail")} b, ${testId("oats-mail")} a, ${testId("oats-mail")} script, ${testId("oats-mail")} img').length`);
    check(marked === 0, `${at} markup in a subject is text: no element is made of it`, String(marked));
    await settled(page, viewport);
    await fitted(page, viewport, check, at, "the list");
    await page.shot(`mail-${viewport.name}-list`, { targets: true });

    // one message: the hostile one
    await page.evaluate(click(inMail("oats-mail-row"), 0));
    await page.until(visible(inMail("oats-mail-message")), 15);
    {
      const read = await page.evaluate(`JSON.stringify({ list: ${visible(inMail("oats-mail-list"))}, title: ${textOf(`${inMail("oats-mail-message")} h3`)}, first: ${textOf(inMail("oats-mail-from"))}, focus: ${FOCUSED}, lines: document.querySelectorAll(${JSON.stringify(`${inMail("oats-mail-body")} p`)}).length, withheld: ${texts(`${inMail("oats-mail-body")} p`)}.filter((line) => line === "[withheld]").length, made: document.querySelectorAll('${testId("oats-mail-body")} b, ${testId("oats-mail-body")} a, ${testId("oats-mail-body")} script').length, raw: /[\\u202A-\\u202E\\u200B\\u0007]/.test(document.querySelector(${JSON.stringify(inMail("oats-mail-body"))}).innerText) })`);
      check(
        read === JSON.stringify({ list: false, title: "<i>Markup</i> in a subject", first: "mail-writer", focus: "oats-mail-back", lines: 5, withheld: 2, made: 0, raw: false }),
        `${at} a press on a row shows the message in the list's place: its subject, the sender's alias under it (apart from the body), the body's five lines as text (two withheld: a control character, a line shaped like a credential), no element made of its markup, no bidi or zero-width character; the focus is on Back`,
        read,
      );
    }
    await settled(page, viewport);
    await fitted(page, viewport, check, at, "the message");
    await page.shot(`mail-${viewport.name}-message`, { targets: true });
    await page.evaluate(click(inMail("oats-mail-back")));
    await page.until(visible(inMail("oats-mail-list")), 15);
    {
      const read = await page.evaluate(`document.activeElement === document.querySelectorAll(${JSON.stringify(inMail("oats-mail-row"))})[0]`);
      check(read === true, `${at} Back returns to the list, and the focus to the row it came from`, String(read));
    }

    // the message the messaging layer cut at 16 KiB
    await page.evaluate(click(inMail("oats-mail-row"), 1));
    await page.until(visible(inMail("oats-mail-shortened")), 15);
    {
      const read = await page.evaluate(`JSON.stringify([${textOf(`${inMail("oats-mail-message")} h3`)}, ${textOf(inMail("oats-mail-shortened"))}])`);
      check(read === JSON.stringify(["A long report", "Shortened."]), `${at} the 300 KB message the messaging layer cut: its lines, and "Shortened." under them`, read);
    }
    await page.evaluate(`document.querySelector(${JSON.stringify(inMail("oats-mail-shortened"))}).scrollIntoView({ block: "end" })`);
    await settled(page, viewport);
    await fitted(page, viewport, check, at, "the cut message");
    await page.shot(`mail-${viewport.name}-shortened`);
    await page.evaluate(click(inMail("oats-mail-back")));
  }),

  scene("mail: Older reads the page after the cursor and adds its mail", "mail-first-page.json", async ({ page, at, viewport, check }) => {
    await page.until(visible(inMail("oats-mail-older")), 30);
    {
      const read = await page.evaluate(`JSON.stringify([JSON.parse(${subjects}).length, ${textOf(inMail("oats-mail-older"))}])`);
      check(read === JSON.stringify([2, "Older"]), `${at} a first page of two, and "Older" at the list's end`, read);
    }
    await settled(page, viewport);
    await page.shot(`mail-${viewport.name}-older`, { targets: true });
    answer("mail-older-page.json");
    await page.evaluate(click(inMail("oats-mail-older")));
    const three = await page.until(`JSON.parse(${subjects}).length === 3`, 20);
    const read = await page.evaluate(`JSON.stringify([JSON.parse(${subjects})[2], ${visible(inMail("oats-mail-older"))}])`);
    check(Boolean(three) && read === JSON.stringify(["Parser ready for a first read", false]), `${at} Older adds the older page's received mail under the list, and leaves when no page is older`, read);
  }),

  scene("mail: no mail, and the read in flight", "mail-none.json", async ({ page, at, viewport, check, sleep }) => {
    await page.until(visible(inMail("oats-mail-empty")), 30);
    await page.until(settledHead, 20);
    {
      const read = await page.evaluate(`JSON.stringify([${textOf(inMail("oats-mail-empty"))}, ${textOf(inMail("oats-mail-refresh"))}, ${textOf(inMail("oats-mail-read"))}])`);
      check(read === JSON.stringify(["No mail.", "Refresh", ""]), `${at} an agent nobody wrote to: "No mail.", Refresh, and no "Read now"`, read);
    }
    await settled(page, viewport);
    await page.shot(`mail-${viewport.name}-none`, { targets: true });
    // A read that takes seconds: what was read stays, and the head says "Reading…".
    answer({ file: "mail/mail-none.json", sleepMs: 4000 });
    await page.evaluate(click(inMail("oats-mail-refresh")));
    const reading = await page.until(`${textOf(inMail("oats-mail-read"))} === "Reading…"`, 10);
    const held = await page.evaluate(`JSON.stringify([${textOf(inMail("oats-mail-empty"))}, document.querySelector(${JSON.stringify(inMail("oats-mail-refresh"))}).disabled])`);
    check(Boolean(reading) && held === JSON.stringify(["No mail.", true]), `${at} while it reads again: "Reading…" in the head, what was read stays, and Refresh is off`, held);
    await page.shot(`mail-${viewport.name}-reading`);
    await page.until(`${textOf(inMail("oats-mail-read"))} === ""`, 20);
    await sleep(100);
  }),

  scene("mail: why it cannot be read: each recorded refusal as its one line, with Retry and Details", REFUSALS[0][0], async ({ page, at, viewport, check }) => {
    for (const [file, line, code, name] of REFUSALS) {
      answer(file);
      // The first is read as the tab opens; each next one by the Retry of the one before.
      if (file !== REFUSALS[0][0]) await page.evaluate(click(inMail("oats-mail-retry")));
      const shown = await page.until(`${textOf(`${inMail("oats-notice")} h3`)} === ${JSON.stringify(line)}`, 20);
      const read = await page.evaluate(
        `JSON.stringify((() => { const notice = document.querySelector(${JSON.stringify(inMail("oats-notice"))}); const details = notice.querySelector(${JSON.stringify(testId("oats-notice-details"))}); return { title: notice.querySelector("h3").innerText.trim(), role: notice.getAttribute("role"), face: [...notice.children].filter((e) => e !== details).map((e) => e.innerText.replace(/\\s+/g, " ").trim()), open: details.open, refresh: Boolean(document.querySelector(${JSON.stringify(inMail("oats-mail-refresh"))})) }; })())`,
      );
      check(Boolean(shown) && read === JSON.stringify({ title: line, role: "alert", face: [line, "Retry"], open: false, refresh: false }), `${at} ${code}: ONE line on the face ("${line}"), then Retry; Details closed; the code is not on the face; no Refresh beside it`, read);
      await settled(page, viewport);
      await fitted(page, viewport, check, at, `the refusal ${code}`);
      await page.shot(`mail-${viewport.name}-refused-${name}`, { targets: true });
      if (file === REFUSALS[0][0]) {
        await page.evaluate(`document.querySelector(${JSON.stringify(`${inMail("oats-notice-details")} summary`)}).click()`);
        const under = await page.until(`(() => { const t = ${textOf(inMail("oats-notice-details"))}; return t.includes(${JSON.stringify(code)}) ? t : ""; })()`, 10);
        check(typeof under === "string" && under.includes("declares no operation"), `${at} under Details: the kernel's code and its own sentence`, String(under));
        await settled(page, viewport);
        await fitted(page, viewport, check, at, "the refusal's Details");
        await page.shot(`mail-${viewport.name}-refused-details`);
      }
    }
    // Retry reads again: with the mail back, the notice goes and the list is there.
    answer(null);
    await page.evaluate(click(inMail("oats-mail-retry")));
    const back = await page.until(visible(inMail("oats-mail-row")), 20);
    check(Boolean(back) && !(await page.evaluate(visible(inMail("oats-notice")))), `${at} Retry reads again: the mail shows and the notice is gone`);
  }),

  scene("mail: one team's mail cannot be read, and the other team's shows", "mail-identity-missing.json", async ({ page, at, viewport, check }) => {
    await page.until(visible(inMail("oats-mail-unread")), 30);
    const read = await page.evaluate(`JSON.stringify([JSON.parse(${subjects}).length, ${texts(inMail("oats-mail-unread"))}, document.querySelector(${JSON.stringify(testId("oats-mail"))}).innerText.includes("identity-missing")])`);
    check(read === JSON.stringify([3, ["wider: can't be read"], false]), `${at} one line at the list's end for the team whose mail cannot be read, without the provider's word; the other team's three messages show`, read);
    await settled(page, viewport);
    await fitted(page, viewport, check, at, "the list with a team that cannot be read");
    await page.shot(`mail-${viewport.name}-team-unread`, { targets: true });
  }),

  // THE BUSY WORKSPACE (the worst-case rule; container/README.md, "The busy workspace"): the Mail tab on the set's
  // busy agent, whose mail is a full page of fifty messages (test/fixtures/busy/mail.json, made by the set's generator
  // from the recorded answer). What the rule asks of a busy screen and this one may not yet do is MEASURED and said as
  // a NOTE (a number in every run's log), not failed, until its mend is ruled; what must hold on any data is checked.
  {
    stage: "busy",
    name: "mail: the busy agent's full page of fifty: the list's head and its end, a message from the middle and the way back, the longest sender's name, the long report, the longest subject",
    run: async ({ page, at, viewport, check }) => {
      const note = (what, measured) => console.log(`NOTE ${at} busy, ${what}: ${measured}`);
      const chat = JSON.parse(readFileSync(new URL("../../test/fixtures/busy/chat.json", import.meta.url), "utf8"));
      const answer = JSON.parse(readFileSync(new URL("../../test/fixtures/busy/mail.json", import.meta.url), "utf8")).result.result.mail;
      const received = answer.messages.filter((message) => message.direction === "received");
      // The busy agent's thread, as a person gets to it: its row of the sidebar.
      await page.goto("/");
      check(await showSidebar(page, viewport), `${at} the thread list is the OATS sidebar`);
      const href = await page.until(`(() => { const row = [...document.querySelectorAll(${JSON.stringify(`${testId("oats-sidebar")} ${testId("oats-tree")} a[href]`)})].find((a) => a.querySelector(${JSON.stringify(testId("oats-row-name"))})?.getAttribute("title")?.includes(${JSON.stringify(chat.agent)})); return row ? row.getAttribute("href") : ""; })()`, 60);
      check(typeof href === "string" && href.includes("/threads/"), `${at} the busy agent is a row of the sidebar, on its thread`, String(href));
      if (typeof href !== "string" || href === "") return;
      await page.goto(href);
      await page.until(visible(testId("oats-open-panel")), 60);
      await page.evaluate(click(testId("oats-open-panel")));
      const whole = viewport.mobile || Boolean(await page.until(panelWhole, 30));
      const named = await page.until(`document.querySelector(${JSON.stringify(`${testId("oats-panel")} ${testId("oats-panel-name")}`)})?.getAttribute("title") === ${JSON.stringify(chat.agent)} ? "1" : ""`, 30);
      check(whole && named === "1", `${at} the busy agent's panel is there, whole, and names it`, `${whole ? "" : "bb's side panel never became whole (panelWhole); "}named: ${String(named)}`);
      const tab = await page.until(visible(testId("oats-tab-mail")), 60);
      check(Boolean(tab), `${at} the busy agent's panel has the tab Mail`);
      if (!tab) return;
      await page.evaluate(click(testId("oats-tab-mail")));

      // THE LIST: the whole page, fifty rows, newest first.
      const rows = `document.querySelectorAll(${JSON.stringify(inMail("oats-mail-row"))})`;
      // The list is back after a message: its rows are there again. (Not "the list is on the screen": once a row far down
      // has the focus the list's own head stands over the screen, and a wait for it there runs out in silence.)
      const listBack = `${rows}.length === ${received.length}`;
      const listed = await page.until(`${rows}.length >= ${received.length} ? String(${rows}.length) : ""`, 60);
      check(listed === String(received.length) && received.length === 50, `${at} the busy agent's Mail lists its full page: fifty messages`, `${String(listed ?? (await page.evaluate(`String(${rows}.length)`)))} rows; the set holds ${received.length} received`);
      await page.until(settledHead, 20);
      {
        const head = await page.evaluate(`JSON.stringify([${textOf(inMail("oats-mail-refresh"))}, ${textOf(inMail("oats-mail-read"))}, document.querySelector(${JSON.stringify(inMail("oats-mail-list"))})?.getAttribute("aria-label")])`);
        check(head === JSON.stringify(["Refresh", "", "Mail, newest first"]), `${at} the head over fifty rows: Refresh, and no age for what was just read`, head);
      }
      {
        const first = await page.evaluate(`${textOf(inMail("oats-mail-subject"))}`);
        check(first === received[0].subject.replace(/\s+/g, " ").trim(), `${at} the first row is the newest message of the set`, String(first.length));
      }
      // What a busy list measures: how many screens of rows it is, how many subjects are cut to their one line, and how many rows take more than two lines.
      const pane = `document.querySelector(${JSON.stringify(`${testId("oats-panel")} [role="tabpanel"]`)})`;
      note("the list of fifty", await page.evaluate(`JSON.stringify((() => { const pane = ${pane}; const all = [...${rows}]; const line = (e) => parseFloat(getComputedStyle(e).lineHeight) || 20; return { rows: all.length, screens: pane ? Math.round((pane.scrollHeight / Math.max(1, pane.clientHeight)) * 10) / 10 : null, subjectsCut: [...document.querySelectorAll(${JSON.stringify(inMail("oats-mail-subject"))})].filter((each) => each.scrollWidth > each.clientWidth + 1).length, rowHeights: [Math.round(Math.min(...all.map((r) => r.getBoundingClientRect().height))), Math.round(Math.max(...all.map((r) => r.getBoundingClientRect().height)))], sendersOnTwoLines: all.filter((r) => { const who = r.firstElementChild; return who && who.getBoundingClientRect().height > line(who) * 1.5; }).length }; })())`));
      await settled(page, viewport);
      await fitted(page, viewport, check, at, "the list of fifty, at its head");
      await page.shot(`busy-${viewport.name}-mail`, { targets: true });

      // ITS END: the last row can be brought into view, whole, and what stands under it (an older page's "Older", where the set has one).
      const lastIn = `(() => { const all = ${rows}; const last = all[all.length - 1]; last.scrollIntoView({ block: "end" }); const box = last.getBoundingClientRect(); const pane = ${pane}?.getBoundingClientRect(); const older = document.querySelector(${JSON.stringify(inMail("oats-mail-older"))}); if (older) older.scrollIntoView({ block: "end" }); const o = older?.getBoundingClientRect(); return JSON.stringify({ lastWhole: box.height > 0 && box.top >= (pane?.top ?? 0) - 0.5 && box.bottom <= Math.min(pane?.bottom ?? innerHeight, innerHeight) + 0.5, older: older ? { text: older.innerText.trim(), inView: o.top >= 0 && o.bottom <= innerHeight + 0.5, height: Math.round(o.height) } : null, subject: last.querySelector(${JSON.stringify(testId("oats-mail-subject"))})?.innerText.trim().length ?? null }); })()`;
      const end = JSON.parse(await page.evaluate(lastIn));
      check(end.lastWhole === true, `${at} the last of the fifty rows can be brought into view`, JSON.stringify(end));
      if (answer.hasMore) check(end.older !== null && end.older.text === "Older" && end.older.inView && end.older.height >= (viewport.mobile ? 44 : 32) - 0.5, `${at} under the fifty: "Older", in view and high enough to press`, JSON.stringify(end.older));
      else {
        check(end.older === null, `${at} the set's page is the whole of the busy agent's mail: no "Older" under the fifty`, JSON.stringify(end.older));
        note("the list's end", "the set's answer says hasMore: false: no older page to reach");
      }
      // THE PANE's OWN END, as a person scrolls to it (the image is of that, not of a control aligned to the edge: brought
      // into view by itself a control stands ON the scrollport's edge, which says nothing of the room the pane leaves):
      // under the list's last control stands the pane's own bottom padding, whole.
      {
        const room = JSON.parse(await page.evaluate(`JSON.stringify((() => { const pane = ${pane}; pane.scrollTop = pane.scrollHeight; const box = pane.getBoundingClientRect(); const older = document.querySelector(${JSON.stringify(inMail("oats-mail-older"))}); const last = older ?? ${rows}[${rows}.length - 1]; return { under: Math.round((Math.min(box.bottom, innerHeight) - last.getBoundingClientRect().bottom) * 10) / 10, panePaddingBottom: parseFloat(getComputedStyle(pane).paddingBottom), atEnd: Math.abs(pane.scrollTop + pane.clientHeight - pane.scrollHeight) < 1 }; })())`));
        check(room.atEnd && room.panePaddingBottom > 0 && room.under >= room.panePaddingBottom - 1, `${at} at the pane's own end the list's last control has the pane's bottom padding under it (${room.panePaddingBottom} px): it is not flush on the edge`, JSON.stringify(room));
        note("the room under the list's last control, at the pane's end", JSON.stringify(room));
      }
      await settled(page, viewport);
      await fitted(page, viewport, check, at, "the list of fifty, at its end");
      await page.shot(`busy-${viewport.name}-mail-end`);

      // ONE MESSAGE FROM THE MIDDLE, and the way back: to the same row, and how far the list stands from where it was.
      const middle = Math.floor(received.length / 2);
      // The row is put near the pane's TOP before it is pressed: a browser brings a focused element to the middle when it
      // is off the screen, so a row that started in the middle would be "back in its place" by the focus alone.
      const placed = `(() => { const row = ${rows}[${middle}]; row.scrollIntoView({ block: "start" }); return String(Math.round(row.getBoundingClientRect().top)); })()`;
      const before = Number(await page.evaluate(placed));
      await page.evaluate(`${rows}[${middle}].click()`);
      await page.until(visible(inMail("oats-mail-message")), 30);
      {
        const read = await page.evaluate(`JSON.stringify({ list: ${visible(inMail("oats-mail-list"))}, title: ${textOf(`${inMail("oats-mail-message")} h3`)}, first: ${textOf(inMail("oats-mail-from"))}, focus: ${FOCUSED} })`);
        check(read === JSON.stringify({ list: false, title: received[middle].subject.replace(/\s+/g, " ").trim(), first: received[middle].from.alias, focus: "oats-mail-back" }), `${at} the ${middle + 1}th message opens in the list's place: its subject, its sender's alias under it; the focus is on Back`, (() => { const got = JSON.parse(read); return JSON.stringify({ list: got.list, titleLength: got.title.length, first: got.first, focus: got.focus }); })());
      }
      await page.evaluate(`${pane}?.scrollTo(0, 0)`);
      await settled(page, viewport);
      await fitted(page, viewport, check, at, "a message from the middle");
      await page.shot(`busy-${viewport.name}-mail-message`, { targets: true });
      await page.evaluate(click(inMail("oats-mail-back")));
      await page.until(listBack, 30);
      {
        const back = JSON.parse(await page.evaluate(`JSON.stringify((() => { const all = ${rows}; const row = all[${middle}]; const box = row.getBoundingClientRect(); const pane = ${pane}?.getBoundingClientRect(); return { rows: all.length, focused: document.activeElement === row, inView: box.top >= (pane?.top ?? 0) - 0.5 && box.bottom <= Math.min(pane?.bottom ?? innerHeight, innerHeight) + 0.5, top: Math.round(box.top) }; })())`));
        check(back.rows === received.length && back.focused && back.inView, `${at} Back returns to the list of fifty: the row it came from has the focus and is in view`, JSON.stringify(back));
        // WHERE the list stands after Back, against where it stood (the row was near the pane's top): a number, until it is ruled.
        note("the way back", JSON.stringify({ rowTopBefore: before, rowTopAfter: back.top, moved: back.top - before }));
        await settled(page, viewport);
        await page.shot(`busy-${viewport.name}-mail-back`);
      }

      // THE LONGEST SENDER's NAME of the set (its agents' names run to sixty characters): whole on its row, on as many
      // lines as it needs, with the age still beside it; whole as the first line of its message.
      const widest = received.reduce((best, message, index) => (message.from.alias.length > received[best].from.alias.length ? index : best), 0);
      await page.evaluate(`${rows}[${widest}].scrollIntoView({ block: "center" })`);
      {
        const row = JSON.parse(await page.evaluate(`JSON.stringify((() => { const row = ${rows}[${widest}]; const head = row.firstElementChild; const who = head.firstElementChild; const when = head.lastElementChild; const edge = row.getBoundingClientRect().right; const line = parseFloat(getComputedStyle(who).lineHeight) || 16; return { name: who.innerText.trim().length, lines: Math.round(who.getBoundingClientRect().height / line), inside: who.getBoundingClientRect().right <= edge + 0.5 && when.getBoundingClientRect().right <= edge + 0.5, age: when.innerText.trim() !== "" && when.getBoundingClientRect().width > 0, cut: who.scrollWidth > who.clientWidth + 1 }; })())`));
        check(received[widest].from.alias.length >= 55 && row.name === received[widest].from.alias.length && row.inside && row.age && !row.cut, `${at} the longest sender's name of the set (${received[widest].from.alias.length} characters) is whole on its row, inside it, with the row's age beside it`, JSON.stringify(row));
        note("the longest sender's name on its row", JSON.stringify(row));
      }
      await settled(page, viewport);
      await fitted(page, viewport, check, at, "the rows of long-named senders");
      await page.shot(`busy-${viewport.name}-mail-long-sender`, { targets: true });
      await page.evaluate(`${rows}[${widest}].click()`);
      await page.until(visible(inMail("oats-mail-message")), 30);
      {
        // WHO WROTE IT stands apart from WHAT WAS WRITTEN: the name is whole on the muted line under the subject, with the
        // age after it, and the first line under the head is the body's own first line.
        const first = JSON.parse(await page.evaluate(`JSON.stringify((() => { const who = document.querySelector(${JSON.stringify(inMail("oats-mail-who"))}); const name = who.querySelector(${JSON.stringify(testId("oats-mail-from"))}); const body = document.querySelector(${JSON.stringify(inMail("oats-mail-body"))}); const edge = document.querySelector(${JSON.stringify(testId("oats-mail"))}).getBoundingClientRect().right; return { name: name.innerText.trim().length, whole: who.scrollWidth <= who.clientWidth + 1 && who.getBoundingClientRect().right <= edge + 0.5, after: who.innerText.trim().slice(name.innerText.trim().length, name.innerText.trim().length + 3), inBody: body.contains(name), bodyFirst: body.querySelector("p")?.innerText.trim() ?? null, underSubject: who.getBoundingClientRect().top >= document.querySelector(${JSON.stringify(`${inMail("oats-mail-message")} h3`)}).getBoundingClientRect().bottom - 0.5 && who.getBoundingClientRect().bottom <= body.getBoundingClientRect().top + 0.5 }; })())`));
        check(first.name === received[widest].from.alias.length && first.whole && first.after === " · " && first.inBody === false && first.underSubject && first.bodyFirst === displayFirst(received[widest].body), `${at} on its message the longest sender's name is whole on the line under the subject, the age after it; and the first line under the head is the body's own first line`, JSON.stringify({ ...first, bodyFirst: first.bodyFirst === null ? null : first.bodyFirst.length }));
      }
      await fitted(page, viewport, check, at, "the message of a long-named sender");
      await page.evaluate(click(inMail("oats-mail-back")));
      await page.until(listBack, 30);

      // THE LONG REPORT (the first message of the set that the messaging layer cut: the recorded 16 KiB body): it opens, and says so at its end.
      const cut = received.findIndex((message) => message.truncated === true);
      check(cut >= 0, `${at} the set's mail holds a message the messaging layer cut`, String(cut));
      if (cut < 0) return;
      await page.evaluate(`${rows}[${cut}].click()`);
      // Its last line is far under the screen (16 KiB of lines): it is waited for as an element, brought into view, and only then read as drawn.
      await page.until(`document.querySelector(${JSON.stringify(inMail("oats-mail-shortened"))}) !== null`, 30);
      await page.evaluate(`document.querySelector(${JSON.stringify(inMail("oats-mail-shortened"))})?.scrollIntoView({ block: "end" })`);
      const said = await page.until(`${visible(inMail("oats-mail-shortened"))} ? ${textOf(inMail("oats-mail-shortened"))} : ""`, 15);
      check(said === "Shortened.", `${at} a long message of the busy agent's mail opens, and says "Shortened." at its end`, String(said));
      await settled(page, viewport);
      await fitted(page, viewport, check, at, "the long report, at its end");
      await page.shot(`busy-${viewport.name}-mail-shortened`);
      await page.evaluate(click(inMail("oats-mail-back")));
      await page.until(listBack, 30);

      // THE LONGEST SUBJECT of the set: one line on its row, whole on its message.
      const longest = received.reduce((best, message, index) => (message.subject.length > received[best].subject.length ? index : best), 0);
      await page.evaluate(`${rows}[${longest}].scrollIntoView({ block: "center" })`);
      {
        const row = JSON.parse(await page.evaluate(`JSON.stringify((() => { const subject = ${rows}[${longest}].querySelector(${JSON.stringify(testId("oats-mail-subject"))}); const line = parseFloat(getComputedStyle(subject).lineHeight) || 20; return { oneLine: subject.getBoundingClientRect().height <= line * 1.5, cut: subject.scrollWidth > subject.clientWidth + 1, length: subject.innerText.trim().length }; })())`));
        check(row.oneLine && row.length === received[longest].subject.replace(/\s+/g, " ").trim().length, `${at} the longest subject of the set (${received[longest].subject.length} characters) is ONE line on its row`, JSON.stringify(row));
        note("the longest subject on its row", JSON.stringify(row));
      }
      await page.evaluate(`${rows}[${longest}].click()`);
      await page.until(visible(inMail("oats-mail-message")), 30);
      {
        const title = JSON.parse(await page.evaluate(`JSON.stringify((() => { const title = document.querySelector(${JSON.stringify(`${inMail("oats-mail-message")} h3`)}); const line = parseFloat(getComputedStyle(title).lineHeight) || 20; return { whole: title.scrollWidth <= title.clientWidth + 1, lines: Math.round(title.getBoundingClientRect().height / line), length: title.innerText.replace(/\\s+/g, " ").trim().length }; })())`));
        check(title.whole && title.length === received[longest].subject.replace(/\s+/g, " ").trim().length, `${at} on its message the longest subject is whole, on as many lines as it needs`, JSON.stringify(title));
      }
      await page.evaluate(`${pane}?.scrollTo(0, 0)`);
      await settled(page, viewport);
      await fitted(page, viewport, check, at, "the message with the longest subject");
      await page.shot(`busy-${viewport.name}-mail-long-subject`);
      await page.evaluate(click(inMail("oats-mail-back")));
      // The panel is left on its first tab, as the scenes after this one expect it (it remembers its tab for the window).
      if (await page.evaluate(visible(testId("oats-tab-instance")))) await page.evaluate(click(testId("oats-tab-instance")));
    },
  },
];
