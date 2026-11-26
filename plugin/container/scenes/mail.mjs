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
// Not drawn, because no recorded answer holds them (the unit tests hold their words, on a recorded
// answer with one named field changed: test/mail/mail.test.tsx): "Unverified sender", "Signature
// failed", "(no subject)", "<team>: <N> conversations can't be read", and the lines of
// E_MAIL_TOO_LARGE and of a read that ran out of time.
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { FOCUSED, testId, textOf, texts, visible } from "../browser.mjs";
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
 * Shows the agent's panel as a person gets to it, and turns it to its tab "Mail". → whether the mail's view is there.
 * At 1280 the tab is pressed only once bb's side panel is whole (`panelWhole`, ./panel.mjs says why): bb 0.50.1 can
 * mount the panel's content a second time a fraction of a second after it opens, and a press before that is a press
 * on a panel that is about to be mounted again.
 */
async function openMail(page, threads, viewport) {
  const thread = threads.get(AGENT.thread);
  await page.goto(`/projects/${thread.projectId}/threads/${thread.id}`);
  await page.until(visible(testId("oats-open-panel")), 30);
  await page.evaluate(click(testId("oats-open-panel")));
  if (!viewport.mobile) await page.until(panelWhole, 30);
  await page.until(visible(testId("oats-tab-mail")), 30);
  await page.evaluate(click(testId("oats-tab-mail")));
  return Boolean(await page.until(visible(testId("oats-mail")), 30));
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
      given.check(await openMail(given.page, given.threads, given.viewport), `${given.at} the tab Mail of the agent's panel shows the mail's view`, await given.page.evaluate("location.pathname"));
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
        read === JSON.stringify({ list: false, title: "<i>Markup</i> in a subject", first: "mail-writer", focus: "oats-mail-back", lines: 6, withheld: 2, made: 0, raw: false }),
        `${at} a press on a row shows the message in the list's place: its subject, the sender's alias as its first line, the body's five lines as text (two withheld: a control character, a line shaped like a credential), no element made of its markup, no bidi or zero-width character; the focus is on Back`,
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
];
