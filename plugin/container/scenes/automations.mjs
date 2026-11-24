// Automations' live scenes: the page with each list, a row's page of each kind, the notices of
// a host with no name and no scheduler, and the page with `oats` gone. The lists are what the real
// kernel printed (test/fixtures/automations/); their times are the recording's, so each scene runs
// with the page's clock at the recording's own time: a last run is in the past and a next run ahead.
import { readFileSync } from "node:fs";
import { fill, FOCUSED, testId, textOf, texts, visible } from "../browser.mjs";
import { hostname } from "node:os";

// The machine's name, as the checks' container was given it (ci.sh: MACHINE_NAME, the container's
// host name): the page names the machine that holds the deployment by it, never as "this computer".
const MACHINE = process.env.MACHINE_NAME || hostname();

const ROW = testId("oats-automation-row");
const count = (selector) => `document.querySelectorAll(${JSON.stringify(selector)}).length`;
const rowOf = (id) => `${ROW}[data-id="${id}"]`;
/** Presses the first element of `selector` (the one whose text is `text`, where given). */
const click = (selector, text = null) =>
  `(() => { const found = [...document.querySelectorAll(${JSON.stringify(selector)})].find((e) => ${text === null ? "true" : `e.innerText.trim() === ${JSON.stringify(text)}`}); if (!found) throw new Error("nothing to press: " + ${JSON.stringify(`${selector}${text === null ? "" : ` "${text}"`}`)}); found.click(); return true; })()`;
/**
 * Takes a scene's image with the thing its name claims in view: a row's page is longer than the
 * window, most of all at the phone's width, and an image must show the state it is named for.
 */
async function shotOf(page, selector, name) {
  await page.evaluate(`document.querySelector(${JSON.stringify(selector)})?.scrollIntoView({ block: "center" })`);
  await page.shot(name, { targets: true });
}
/**
 * The tokens under `within` (an id, a path, a cron, a code, a label, a flag, an account: every
 * word the page marks `data-token`, and every text it sets in its fixed-width face, in a `code` or
 * as a fact's value) that the layout broke INSIDE the token: a line that ends anywhere but at a
 * space or between two pieces the page keeps whole each. A hyphen and a slash are inside a token
 * ("oats-product-" / "expert" is broken). What a person or a source wrote as prose (a prompt, a
 * quoted answer) is not a token and is not looked at.
 * → those texts, each with the two characters the break fell between.
 */
const TOKENS = "[data-token], .font-mono, code, dd";
const NOT_TOKENS = '[data-testid="oats-automation-prose"], blockquote';
const brokenTokens = (within) => `JSON.stringify((() => {
  const broken = [];
  for (const element of document.querySelectorAll(${JSON.stringify(TOKENS.split(", ").map((one) => `${within} ${one}`).join(", "))})) {
    if (element.querySelector(${JSON.stringify(TOKENS)}) || element.closest(${JSON.stringify(NOT_TOKENS)}) || element.getClientRects().length === 0) continue;
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    const range = document.createRange();
    let last = null;
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      // Between two pieces the page keeps whole each (a cron, then its time zone) a line may end.
      if (node.parentElement !== element) last = null;
      for (let at = 0; at < node.data.length; at += 1) {
        const char = node.data[at];
        if (/\\s/.test(char)) { last = null; continue; }
        range.setStart(node, at); range.setEnd(node, at + 1);
        const box = range.getClientRects()[0];
        if (!box) continue;
        if (last && box.top >= last.bottom - 1) broken.push(element.innerText.trim() + " [" + last.char + "|" + char + "]");
        last = { char, bottom: box.bottom };
      }
    }
  }
  return broken;
})())`;
/**
 * Opens the Details of the notice or card at `within` and waits for `wanted` to be shown there.
 * → the text of `within` then (what it read, for the check to print, when `wanted` never came).
 */
async function opened(page, within, wanted) {
  await page.evaluate(`(() => { const fold = document.querySelector(${JSON.stringify(`${within} details`)}); if (fold && !fold.open) fold.querySelector("summary").click(); })()`);
  return (await page.until(`(() => { const text = ${textOf(within)}; return text.includes(${JSON.stringify(wanted)}) ? text : ""; })()`, 15)) ?? (await page.evaluate(textOf(within)));
}
/**
 * The text of `selector`, waited for: a read after a press or a navigation waits on the thing it
 * reads, never on another element and never at once. → its text, or "" when it never came.
 */
const read = async (page, selector, seconds = 15) => (await page.until(`(() => ${textOf(selector)})()`, seconds)) ?? "";
/** Waits until `expression` is `wanted` (compared as JSON). → what it was at the end, for the check to print. */
async function settle(page, expression, wanted, seconds = 15) {
  const same = `JSON.stringify(${expression}) === ${JSON.stringify(JSON.stringify(wanted))}`;
  await page.until(`(() => ${same})()`, seconds);
  return page.evaluate(expression);
}
/** Whether the whole box of `selector` is on screen: an image of it then shows it, and a person can reach it. */
const inView = (selector) =>
  `(() => { const e = document.querySelector(${JSON.stringify(selector)}); if (!e) return "absent"; const r = e.getBoundingClientRect(); return r.width > 0 && r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight ? "in" : "out " + [r.left, r.top, r.right, r.bottom].map(Math.round).join(","); })()`;
/** Brings `selector` to the middle of the screen, as a person scrolls to a row before using it. */
const reach = (selector) => `document.querySelector(${JSON.stringify(selector)})?.scrollIntoView({ block: "center" })`;
/** Opens the page at a route and waits for what it should draw. → the text of `wait`, or "" */
async function open(page, route, wait) {
  await page.goto(`/plugins/oats/automations${route}`);
  return page.until(`(() => { const t = ${textOf(wait)}; return t === "" ? "" : t; })()`, 30);
}

/**
 * The instant the recording's lists were printed: the scheduler's last tick in them, and a moment.
 * At it every "Last" of the lists is behind and every "Next" ahead, as they were for the kernel.
 */
const RECORDED_AT = new Date(Date.parse(JSON.parse(readFileSync(new URL("../../test/fixtures/automations/schedule-list.json", import.meta.url), "utf8")).result.scheduler.lastTick) + 15_000).toISOString();
/** Stages whose scene asserts an instant the server stamps itself (how old a read is): they keep the real clock. */
const REAL_CLOCK = new Set(["automations-slow"]);
/** A scene at the recording's time, with the real clock given back after it, whatever it did. */
const atTheRecording = (scene) =>
  REAL_CLOCK.has(scene.stage)
    ? scene
    : {
        ...scene,
        run: async (context) => {
          await context.page.clock(RECORDED_AT);
          try {
            await scene.run(context);
          } finally {
            await context.page.clock(null);
          }
        },
      };

const scenes = [
  {
    stage: "fixtures",
    name: "the two lists",
    run: async ({ page, at, viewport, check }) => {
      await open(page, "", ROW);
      const tabs = await settle(page, texts('[role="tab"]'), ["Schedules 11", "Triggers 7"]);
      check(JSON.stringify(tabs) === JSON.stringify(["Schedules 11", "Triggers 7"]), `${at} Automations shows its two tabs with their counts`, JSON.stringify(tabs));
      const groups = await settle(page, texts(`${testId("oats-automations-group")} h3`), [`Runs on ${MACHINE} 7`, "Needs attention here 3", "Runs elsewhere 1"]);
      check(JSON.stringify(groups) === JSON.stringify([`Runs on ${MACHINE} 7`, "Needs attention here 3", "Runs elsewhere 1"]), `${at} the schedules are grouped by where they run`, JSON.stringify(groups));
      const scheduler = await read(page, testId("oats-automations-scheduler"));
      check(/^Scheduler on · checked .+ · up to 5 at once$/.test(scheduler), `${at} the header says the scheduler is on`, scheduler);
      // A10: no id, path, cron or code of a row is broken inside a token, at either width.
      const cut = await page.evaluate(brokenTokens(testId("oats-automations-list")));
      check(cut === "[]", `${at} no id, path, cron or code in the list is broken inside a token`, cut);
      // B28: a run that failed, and one whose launch is not known, are marked in the list; a run that went well is not.
      const outcome = (id) => `(() => { const e = document.querySelector(${JSON.stringify(`${rowOf(id)} ${testId("oats-automation-last")}`)}); return e ? (e.dataset.tone ?? "plain") + ": " + ${textOf(`${rowOf(id)} ${testId("oats-automation-last")}`)} : ""; })()`;
      const marks = [await page.until(outcome("local/hourly-check"), 15), await page.until(outcome("local/status-check"), 15), await page.until(outcome("local/daily-review"), 15)];
      check(/^\["bad: Last .+ ago launch failed","warn: Last .+ ago launch state unknown","plain: Last .+ ago · agent active"\]$/.test(JSON.stringify(marks)), `${at} a failed run and an unknown launch are marked in the list, a run that went well is not`, JSON.stringify(marks));
      // D-037: while the page is shown, its row of the sidebar is the selected one, and no other.
      if (!viewport.mobile) {
        const current = `JSON.stringify([...document.querySelectorAll(${JSON.stringify(`${testId("oats-pages")} button`)})].filter((e) => e.getAttribute("aria-current") === "page").map((e) => e.innerText.trim()))`;
        const selected = await page.until(`(() => { const now = ${current}; return now === '["Automations"]' ? now : ""; })()`, 15);
        check(Boolean(selected), `${at} while Automations is shown its row of the sidebar is the selected one, and no other`, selected ?? (await page.evaluate(current)));
      }
      // From bb's wide layout up a row is its name across the row, then four facts under their headings; below it a row is a stack.
      const heads = await settle(page, visible('[role="columnheader"]:nth-of-type(2)'), !viewport.mobile);
      check(heads === !viewport.mobile, `${at} ${viewport.mobile ? "a row is a stack: the headings are not drawn" : "a row's facts sit under their four headings"}`);
      if (!viewport.mobile) {
        // The name has the row's whole width: its line starts at the row's left edge and the facts are under it, not beside it.
        const lines = await page.evaluate(`(() => { const cells = [...document.querySelector(${JSON.stringify(rowOf("local/daily-review"))}).querySelectorAll('[role="cell"]')].map((cell) => cell.getBoundingClientRect()); return cells[1].top >= cells[0].bottom - 1 && cells[0].width > cells[1].width * 3; })()`);
        check(lines === true, `${at} a row's name has the whole width of the row, and its facts are on the line under it`, String(lines));
      }
      await page.shot(`automations-${viewport.name}-schedules`, { targets: true });

      await open(page, "/triggers", ROW);
      const cutTriggers = await page.evaluate(brokenTokens(testId("oats-automations-list")));
      check(cutTriggers === "[]", `${at} no id, path or code in the triggers' list is broken inside a token`, cutTriggers);
      const n = await settle(page, count(ROW), 7);
      check(n === 7, `${at} the Triggers tab lists its 7 triggers`, String(n));
      await page.shot(`automations-${viewport.name}-triggers`, { targets: true });

      // the sidebar's row and its mark: two schedules of the recording failed their last run
      if (!viewport.mobile) {
        const mark = await page.until(`(() => document.querySelector(${JSON.stringify(`${testId("oats-page-link-automations")} ${testId("oats-mark")}`)})?.getAttribute("aria-label") ?? "")()`, 20);
        check(mark === "Automations, a run failed", `${at} the sidebar's Automations row carries a mark named "Automations, a run failed"`, String(mark));
      }

      // the filter and the search
      await open(page, "", ROW);
      await page.evaluate(`[...document.querySelectorAll('[role="radio"]')].find((radio) => radio.innerText.startsWith("Workspace")).click()`);
      const workspace = await page.until(`(() => ${count(ROW)} === 4 ? "4" : "")()`, 10);
      check(workspace === "4", `${at} Workspace shows the 4 schedules a member's repository holds`, String(await page.evaluate(count(ROW))));
      await page.shot(`automations-${viewport.name}-schedules-workspace`, { targets: true });

      // a search nothing answers to
      await open(page, "", ROW);
      await page.evaluate(fill(testId("oats-search"), "nothing is called this"));
      const none = await page.until(`(() => ${count(ROW)} === 0 ? ${textOf(`${testId("oats-automations-list")} ${testId("oats-empty")}`)} : "")()`, 10);
      check(none === "No schedules match.", `${at} a search nothing answers to says "No schedules match."`, String(none));
      await page.shot(`automations-${viewport.name}-no-match`, { targets: true });
    },
  },
  {
    stage: "fixtures",
    name: "a row's page",
    run: async ({ page, at, viewport, check }) => {
      const detail = testId("oats-automation-detail");
      // a spawn schedule on bb: the list gives way to the row's page, with Back
      const spawn = await open(page, "/schedules/local/daily-review", testId("oats-automation-spawns"));
      check(/Backend bb/.test(spawn) && /YOLO — skips permission prompts/.test(spawn), `${at} a schedule's page says what it spawns, on bb, in full mode`, spawn);
      check((await settle(page, visible(ROW), false)) === false && (await settle(page, visible(testId("oats-automation-back")), true)) === true, `${at} the list gives way to the row's page, with Back`);
      await shotOf(page, testId("oats-automation-spawns"), `automations-${viewport.name}-schedule`);
      // focus: the row's page opens with focus on Back, and Back returns it to the row it was opened from
      await open(page, "", ROW);
      await page.evaluate(`[...document.querySelectorAll(${JSON.stringify(ROW)})].find((row) => row.dataset.id === "local/daily-review").querySelector(${JSON.stringify(testId("oats-automation-open"))}).click()`);
      const onBack = await page.until(`(() => document.activeElement?.dataset?.testid === "oats-automation-back" ? "back" : "")()`, 15);
      check(onBack === "back", `${at} a row's page opens with the focus on Back`, await page.evaluate("document.activeElement?.outerHTML?.slice(0, 120)"));
      await page.evaluate(`document.querySelector(${JSON.stringify(testId("oats-automation-back"))}).click()`);
      const onRow = await page.until(`(() => document.activeElement?.dataset?.testid === "oats-automation-open" ? document.activeElement.closest(${JSON.stringify(ROW)}).dataset.id : "")()`, 15);
      check(onRow === "local/daily-review", `${at} Back returns the focus to the row the page was opened from`, String(onRow));

      // a run that did not happen: a word on its line, the kernel's reason one press away
      const failed = await open(page, "/schedules/local/hourly-check", testId("oats-automation-run"));
      check(/launch failed\s+▸?\s*Details$/.test(failed), `${at} a launch the provider refused says "launch failed", with Details to open`, failed);
      await page.evaluate(click(`${testId("oats-automation-run-error")} summary`));
      const why = await page.until(`(() => { const d = document.querySelector(${JSON.stringify(testId("oats-automation-run-error"))}); return d?.open ? d.querySelector("p")?.innerText ?? "" : ""; })()`, 15);
      check(/E_BACKEND_SANDBOXED_MODE/.test(why ?? ""), `${at} Details holds why, in the kernel's words`, String(why));
      await shotOf(page, testId("oats-automation-run-error"), `automations-${viewport.name}-schedule-launch-failed`);

      // an unknown run state, an invalid definition, a placement that needs attention
      const unknown = await open(page, "/schedules/local/status-check", testId("oats-automation-run-state"));
      check(/^Run state Run state unknown since/.test(unknown), `${at} a run whose state is unknown says so, with the command that checks it`, unknown);
      // A10: the commands to paste and the facts' values are whole on the page the read named.
      const cutCommand = await page.evaluate(brokenTokens(testId("oats-automation-detail")));
      check(cutCommand === "[]", `${at} no flag, id or path of a command to paste, and no fact's value, is broken inside a token`, cutCommand);
      await shotOf(page, testId("oats-automation-run-state"), `automations-${viewport.name}-schedule-run-unknown`);
      // a schedule whose agent is woken again: the wake's own card; and a row's page says once where it runs
      const wake = await open(page, "/schedules/local/daily-review", testId("oats-automation-wake"));
      check(wake === "Recurring wake-up Repeats Every 30 minutes Time zone Europe/Madrid Message Anything new on your review?", `${at} a schedule whose agent is woken again has a Recurring wake-up card: how often, in which time zone, and the message`, wake);
      const verdict = await read(page, testId("oats-automation-verdict"));
      const said = await page.evaluate(`(document.querySelector(${JSON.stringify(detail)}).innerText.match(/Runs on ${MACHINE}/g) ?? []).length`);
      check(verdict === `Runs on ${MACHINE}` && said === 1, `${at} a row's page says where it runs once, by the machine's name`, `${verdict} (said ${said} times)`);
      const cutDetail = await page.evaluate(brokenTokens(detail));
      check(cutDetail === "[]", `${at} no id, path, cron or code on a row's page is broken inside a token`, cutDetail);
      const invalid = await open(page, "/schedules/local/legacy-herdr", testId("oats-automation-problem"));
      const cutInvalid = await page.evaluate(brokenTokens(testId("oats-automation-detail")));
      check(cutInvalid === "[]", `${at} no code, field or path on an invalid definition's page is broken inside a token`, cutInvalid);
      check(invalid === "Invalid OATS cannot use this definition as it is written, so it does not run. ▸ Details", `${at} an invalid definition is said in a person's words, with Details to open`, invalid);
      const invalidSays = await opened(page, testId("oats-automation-problem"), "E_HERDR_REMOVED");
      check(/ Code E_HERDR_REMOVED Field backend/.test(invalidSays), `${at} under Details an invalid definition shows the kernel's code, field and message`, invalidSays);
      await shotOf(page, testId("oats-automation-problem"), `automations-${viewport.name}-schedule-invalid`);
      // a row that is not trusted here: the kernel's own line (what to add to oats-local.yaml) is on its page, each word whole
      const trust = await open(page, "/schedules/oats-real/release-check", testId("oats-automation-where"));
      const cutTrust = await page.evaluate(brokenTokens(testId("oats-automation-detail")));
      check(/oats-local\.yaml/.test(trust) && cutTrust === "[]", `${at} a row not trusted here says what to add to oats-local.yaml on its page, and no id, path or file name there is broken inside a token`, `${cutTrust} / ${trust}`);
      const where = await open(page, "/schedules/oats-real/reconcile", testId("oats-automation-where"));
      const cutWhere = await page.evaluate(brokenTokens(testId("oats-automation-detail")));
      check(cutWhere === "[]", `${at} no account, host or path on a workspace schedule's page is broken inside a token`, cutWhere);
      check(/Wrong account here/.test(where) && /Logged in github\.com\/ana/.test(where), `${at} a workspace schedule says why it does not run here`, where);
      await shotOf(page, testId("oats-automation-where"), `automations-${viewport.name}-schedule-wrong-account`);

      // a pull-request trigger with its state
      await page.goto("/plugins/oats/automations/triggers/oats-real/proposal-review");
      const lead = await page.until(`(() => { const t = ${textOf(testId("oats-automation-history-note"))}; return /live now/.test(t) ? t : ""; })()`, 30);
      check(lead === `on ${MACHINE} · 2 of 2 live now · 2 fired in all · 1 waiting`, `${at} a trigger's page reads its state: what is live, fired and waiting`, lead ?? (await read(page, detail)));
      // Read once the trigger's state is drawn (the wait above): its live instances are the page's long ids.
      const cutTrigger = await page.evaluate(brokenTokens(testId("oats-automation-detail")));
      check(cutTrigger === "[]", `${at} no id, path or code on a trigger's page, its live instances included, is broken inside a token`, cutTrigger);
      await shotOf(page, testId("oats-automation-history-note"), `automations-${viewport.name}-trigger`);

      // a capability source's trigger: its parameters and the source's own words, quoted
      await page.goto("/plugins/oats/automations/triggers/oats-real/harvest-review");
      const skipped = await page.until(`(() => ${textOf(testId("oats-automation-skipped"))})()`, 30);
      check(/says: harvest\/y not judged yet harvest\/z <img src=x onerror=alert\(1\)>/.test(skipped ?? ""), `${at} a capability source's words are quoted text, under whose they are`, skipped);
      const made = await page.evaluate(`document.querySelector(${JSON.stringify(detail)}).querySelectorAll("img, a").length`);
      check(made === 0, `${at} no image and no link is made from a source's text`, String(made));
      await shotOf(page, testId("oats-automation-skipped"), `automations-${viewport.name}-trigger-source`);

      // a source check that failed at a poll: its own card, with the kernel's message, code and field
      const check_ = await open(page, "/triggers/oats-real/harvest-closed", testId("oats-automation-problem"));
      check(/^Source check failed The source's check failed at the last poll \(.+\), so this trigger did not fire\. ▸ Details$/.test(check_ ?? "") && !/\(in /.test(check_ ?? ""), `${at} a source check that failed at a poll has its own card: what happened and when, never ahead of now, with Details to open`, check_);
      const checkSays = await opened(page, testId("oats-automation-problem"), "E_TRIGGER_INVALID");
      check(/Message on\.events: acme\.graph:harvest-branches has no event closed \(its events: opened, updated\) Code E_TRIGGER_INVALID Field on\.events/.test(checkSays), `${at} under Details the source check shows the kernel's message, code and field`, checkSays);
      await shotOf(page, testId("oats-automation-problem"), `automations-${viewport.name}-trigger-source-check-failed`);
    },
  },
  {
    stage: "fixtures",
    name: "two hours after the recording: a due time that has passed",
    run: async ({ page, at, viewport, check }) => {
      // The recorded lists as they are, read two hours later (a list kept, a host that was asleep):
      // hourly-check was due at 21:00 and status-check at 20:30. A time that has passed was due; it is never called next.
      await page.clock(new Date(Date.parse(RECORDED_AT) + 2 * 3600e3).toISOString());
      await open(page, "", ROW);
      const next = (id) => page.until(`(() => ${textOf(`${rowOf(id)} ${testId("oats-automation-next")}`)})()`, 15);
      const due = [await next("local/hourly-check"), await next("local/status-check"), await next("local/daily-review")];
      check(JSON.stringify(due) === JSON.stringify(["Was due 1 h ago", "Was due 2 h ago", "Next in 1 d"]), `${at} two hours on, a due time that has passed reads "Was due", and one still ahead reads "Next"`, JSON.stringify(due));
      const list = await page.evaluate(textOf(testId("oats-automations-list")));
      check(!/Next (\d+ \S+|less than a minute) ago/.test(list), `${at} no row of the list calls a time that has passed its next run`, (list.match(/Next [^·]{0,24} ago/) ?? [""])[0]);
      await page.shot(`automations-${viewport.name}-was-due`, { targets: true });
      const when = await open(page, "/schedules/local/hourly-check", testId("oats-automation-when"));
      check(/ Was due 1 h ago$/.test(when) && !/Next/.test(when), `${at} a row's page says it was due, and has no "Next" for it`, when);
      await shotOf(page, testId("oats-automation-when"), `automations-${viewport.name}-schedule-was-due`);
    },
  },
  {
    stage: "fixtures",
    name: "acting on a row",
    run: async ({ page, at, viewport, check }) => {
      const result = testId("oats-automations-result");
      // The plugin's own dialog: at the phone's width bb's drawer is a dialog too.
      const dialog = `${testId("oats-modal")} [role="dialog"]`;
      const said = (selector, seconds = 30) => page.until(`(() => ${textOf(selector)})()`, seconds);
      const gone = (selector) => page.until(`(() => document.querySelector(${JSON.stringify(selector)}) === null ? "gone" : "")()`, 15);

      const actions = (id) => `${rowOf(id)} [aria-label="Actions for ${id}"]`;
      const item = (id) => `${rowOf(id)} [role="menuitem"]`;
      const openMenu = async (id) => {
        // As a person does: the row's ⋯ brought to the middle of the screen, so its menu has room under it.
        await page.evaluate(reach(actions(id)));
        await page.evaluate(click(actions(id)));
        return page.until(`(() => { const t = ${texts(item(id))}; return t.length > 0 ? JSON.stringify(t) : ""; })()`, 15);
      };
      const focusOn = (what) => page.until(`(() => ${FOCUSED} === ${JSON.stringify(what)} ? "there" : "")()`, 15);

      // a row's menu: the Desktop's acts for what the row is, all of it on screen
      await open(page, "", ROW);
      const items = await openMenu("local/daily-review");
      check(items === JSON.stringify(["Open", "Test", "Run now", "Turn off here", "Open file", "Edit summary", "Delete…"]), `${at} a local schedule's menu holds Open, Test, Run now, Turn off here, Open file, Edit summary and Delete…`, String(items));
      const menuBox = await page.evaluate(inView(`${rowOf("local/daily-review")} [role="menu"]`));
      check(menuBox === "in", `${at} the whole menu is on screen`, menuBox);
      await page.shot(`automations-${viewport.name}-menu`, { targets: true });

      // Run now, from the menu: what happened, in words, above the list, where the focus goes
      await page.evaluate(click(item("local/daily-review"), "Run now"));
      const ran = await said(result);
      check(ran === "local/daily-review: Agent launched Dismiss", `${at} Run now says "Agent launched", by the schedule's id`, ran);
      check((await focusOn("oats-automations-result")) === "there", `${at} the result takes the focus`, await page.evaluate(FOCUSED));
      const resultBox = await page.evaluate(inView(result));
      check(resultBox === "in", `${at} the result is on screen, wherever the row was`, resultBox);
      await page.shot(`automations-${viewport.name}-run-launched`, { targets: true });
      await page.evaluate(click(testId("oats-automations-result-dismiss")));
      const dismissed = await page.until(`(() => document.querySelector(${JSON.stringify(result)}) === null && document.activeElement?.getAttribute("role") === "tab" ? "tab" : "")()`, 15);
      check(dismissed === "tab", `${at} Dismiss takes the result away and the focus goes to the page's tab, not nowhere`, await page.evaluate(FOCUSED));

      // the switch says what it is and what a press does; a press asks the kernel and the row is read again
      const toggleOf = `${rowOf("local/weekly-cleanup")} [role="switch"]`;
      const toggle = [await page.evaluate(`document.querySelector(${JSON.stringify(toggleOf)})?.getAttribute("aria-checked") ?? ""`), await read(page, toggleOf), await page.evaluate(`document.querySelector(${JSON.stringify(toggleOf)})?.title ?? ""`)].join(" | ");
      check(toggle === `false | ${MACHINE} Off | Off here: click to turn it on`, `${at} a row that is off here has its switch off, and says a press turns it on`, toggle);
      await page.evaluate(reach(rowOf("local/weekly-cleanup")));
      await page.evaluate(click(toggleOf));
      const pressed = await page.until(`(() => document.querySelector(${JSON.stringify(toggleOf)})?.disabled === false && document.querySelector(${JSON.stringify(result)}) === null && document.querySelector(${JSON.stringify(testId("oats-automations-doing"))}) === null ? "settled" : "")()`, 30);
      check(pressed === "settled", `${at} a press of the switch is taken by the kernel without a refusal, and the switch can be pressed again`, String(pressed));
      const onSwitch = await page.until(`(() => document.activeElement?.getAttribute("aria-label") === ${JSON.stringify(`local/weekly-cleanup enabled on ${MACHINE}`)} ? "switch" : "")()`, 15);
      check(onSwitch === "switch", `${at} after the press the focus is back on the switch`, await page.evaluate(FOCUSED));

      // Edit summary: the dialog takes the focus on its field, Tab stays inside it, and Escape gives the focus back to what opened it
      await openMenu("local/daily-review");
      await page.evaluate(click(item("local/daily-review"), "Edit summary"));
      const summary = await said(`${dialog} h2`);
      check(summary === "Summary of daily-review", `${at} Edit summary opens a dialog named for the schedule`, summary);
      const field = await page.until(`(() => document.activeElement?.name === "description" ? document.activeElement.value : "")()`, 15);
      check(field === "Review open pull requests every weekday morning", `${at} the dialog's focus starts on its field, which holds the summary`, String(field));
      await page.shot(`automations-${viewport.name}-edit-summary`, { targets: true });
      const order = [];
      for (let stop = 0; stop < 3; stop += 1) {
        await page.press("Tab");
        order.push(await page.evaluate(`document.activeElement?.getAttribute("data-testid") ?? document.activeElement?.getAttribute("name") ?? ""`));
      }
      check(order.join(" > ") === "oats-automation-summary-cancel > oats-automation-summary-save > description", `${at} Tab goes from the field to Cancel, to Save summary, and back to the field`, order.join(" > "));
      // a summary out of the kernel's rule is said under the field and is not sent
      await page.evaluate(fill(`${dialog} input[name="description"]`, "x".repeat(201)));
      await page.evaluate(click(testId("oats-automation-summary-save")));
      const rule = await page.until(`(() => { const t = ${textOf(dialog)}; return /A summary is one line of up to 200 characters, without control characters\./.test(t) ? t : ""; })()`, 15);
      check(Boolean(rule), `${at} a summary longer than the rule is said in the dialog, which stays open`, String(rule));
      await page.shot(`automations-${viewport.name}-edit-summary-rule`, { targets: true });
      await page.press("Escape");
      check((await gone(dialog)) === "gone", `${at} Escape closes the dialog`);
      check((await focusOn("Actions for local/daily-review")) === "there", `${at} Escape gives the focus back to the row's menu button`, await page.evaluate(FOCUSED));
      // saved: the dialog closes and the focus is back on what opened it
      await openMenu("local/daily-review");
      await page.evaluate(click(item("local/daily-review"), "Edit summary"));
      await said(`${dialog} h2`);
      await page.evaluate(fill(`${dialog} input[name="description"]`, "Review every open pull request"));
      await page.evaluate(click(testId("oats-automation-summary-save")));
      check((await gone(dialog)) === "gone", `${at} Save summary closes the dialog once the kernel took it`);
      check((await focusOn("Actions for local/daily-review")) === "there", `${at} after a save the focus is back on the row's menu button`, await page.evaluate(FOCUSED));

      // Test, from the list's menu: it opens the row's page, where the answer is, on screen and with the focus
      await openMenu("local/daily-review");
      await page.evaluate(click(item("local/daily-review"), "Test"));
      const ready = await said(testId("oats-automation-test"));
      check(/^Test result Ready: it would run here\./.test(ready ?? ""), `${at} Test from a row's menu opens the row's page and says it would run here`, ready);
      check((await focusOn("oats-automation-test-arrived")) === "there", `${at} the test's answer takes the focus`, await page.evaluate(FOCUSED));
      const answerBox = await page.evaluate(inView(`${testId("oats-automation-test")} h3, ${testId("oats-automation-test")} h2`));
      check(answerBox === "in", `${at} the test's answer is on screen without the person scrolling to it`, answerBox);
      await page.shot(`automations-${viewport.name}-test-from-menu`, { targets: true });

      // Delete: asks first, the focus on Cancel; Cancel deletes nothing
      await open(page, "/schedules/local/weekly-cleanup", testId("oats-automation-delete"));
      await page.evaluate(click(testId("oats-automation-delete")));
      const asks = await said(dialog);
      check((asks ?? "").startsWith("Delete schedule ") && (asks ?? "").includes(`weekly-cleanup is removed from ${MACHINE} and stops running here.`), `${at} Delete… asks first, in the Desktop's sentence`, asks);
      check((await focusOn("oats-confirm-cancel")) === "there", `${at} the confirmation's focus starts on Cancel`, await page.evaluate(FOCUSED));
      await page.shot(`automations-${viewport.name}-delete-confirm`, { targets: true });
      await page.press("Enter");
      check((await gone(dialog)) === "gone", `${at} Cancel closes it, and nothing is deleted`);
      // Delete, confirmed: the dialog says it was deleted; closed, the focus is on a row of the list
      await page.evaluate(click(testId("oats-automation-delete")));
      await said(dialog);
      await page.evaluate(click(testId("oats-confirm-act")));
      const deleted = await page.until(`(() => { const t = ${textOf(dialog)}; return /was deleted/.test(t) ? t : ""; })()`, 30);
      check((deleted ?? "").includes(`weekly-cleanup was deleted It is removed from ${MACHINE} and no longer runs here.`), `${at} a deleted schedule is said to be deleted, and what that means`, deleted);
      await page.shot(`automations-${viewport.name}-delete-done`, { targets: true });
      await page.evaluate(click(testId("oats-confirm-close")));
      check((await gone(dialog)) === "gone", `${at} Close closes it`);
      // The fake's list still holds the row: the focus is on the Open of the row beside it, not on the first row and not lost.
      const besideRow = `(() => { const rows = [...document.querySelectorAll(${JSON.stringify(ROW)})]; const at = rows.findIndex((row) => row.dataset.id === "local/weekly-cleanup"); const on = document.activeElement?.closest(${JSON.stringify(ROW)}); return at >= 0 && on && (on === rows[at + 1] || (at === rows.length - 1 && on === rows[at - 1])) && document.activeElement.getAttribute("data-testid") === "oats-automation-open" ? "beside" : ""; })()`;
      check((await page.until(besideRow, 15)) === "beside", `${at} after a delete the focus is on the row beside the deleted one, not lost`, await page.evaluate(FOCUSED));

      // Test of a pull-request trigger: what would fire and what is held
      await open(page, "/triggers/oats-real/proposal-review", testId("oats-automation-test-button"));
      await page.evaluate(click(testId("oats-automation-test-button")));
      const fires = await said(testId("oats-automation-test"));
      check(/gh acts as ana Would fire now: #41 → oats-developer-review-pr-41 #42 → oats-developer-review-pr-42 #43 → oats-developer-review-pr-43 \(held: concurrency\.max 2 reached \(2 live\)\)$/.test(fires ?? ""), `${at} a pull-request trigger's Test says who gh acts as, what would fire, and what is held and why`, fires);
      await shotOf(page, testId("oats-automation-test"), `automations-${viewport.name}-test-result`);

      // Test of a capability source's trigger: first what will run, where the person is; then Run test
      await open(page, "/triggers/oats-real/harvest-review", testId("oats-automation-test-button"));
      await page.evaluate(click(testId("oats-automation-test-button")));
      const confirm = await said(testId("oats-automation-test-confirm"));
      check((confirm ?? "").startsWith(`Test this trigger This runs acme.graph's source command on ${MACHINE}, now, once. Nothing is recorded and nothing is spawned.`), `${at} a capability source's Test first says what will run, and on which machine`, confirm);
      check((await focusOn("oats-automation-test-confirm-arrived")) === "there", `${at} the confirmation takes the focus`, await page.evaluate(FOCUSED));
      const confirmBox = await page.evaluate(inView(`${testId("oats-automation-test-confirm")} h3, ${testId("oats-automation-test-confirm")} h2`));
      check(confirmBox === "in", `${at} the confirmation is on screen without the person scrolling to it`, confirmBox);
      await page.shot(`automations-${viewport.name}-test-confirm`, { targets: true });
      // Cancel takes it away and gives the focus back to Test
      await page.evaluate(click(testId("oats-automation-test-cancel")));
      check((await gone(testId("oats-automation-test-confirm"))) === "gone" && (await focusOn("oats-automation-test-button")) === "there", `${at} Cancel takes the confirmation away and the focus is back on Test`, await page.evaluate(FOCUSED));
      // Back withdraws it: asked on this row's page, it is not there when the row is opened again from the list
      await page.evaluate(click(testId("oats-automation-test-button")));
      await said(testId("oats-automation-test-confirm"));
      await page.evaluate(click(testId("oats-automation-back")));
      await page.until(`(() => document.querySelector(${JSON.stringify(rowOf("oats-real/harvest-review"))}) ? "list" : "")()`, 15);
      await page.evaluate(reach(rowOf("oats-real/harvest-review")));
      await page.evaluate(click(`${rowOf("oats-real/harvest-review")} ${testId("oats-automation-open")}`));
      await page.until(`(() => document.querySelector(${JSON.stringify(testId("oats-automation-test-button"))}) ? "page" : "")()`, 15);
      // An absence: read once the row's page is drawn again, which is when a kept confirmation would be drawn too.
      const withdrawn = await page.evaluate(`document.querySelector(${JSON.stringify(testId("oats-automation-test-confirm"))}) === null ? "gone" : "still there"`);
      check(withdrawn === "gone", `${at} a confirmation left with Back is not there when the row is opened again`, withdrawn);
      // Test from the list's menu: the row's page opens and the confirmation, not Back, holds the focus, on screen
      await page.evaluate(click(testId("oats-automation-back")));
      await page.until(`(() => document.querySelector(${JSON.stringify(rowOf("oats-real/harvest-review"))}) ? "list" : "")()`, 15);
      await openMenu("oats-real/harvest-review");
      await page.evaluate(click(item("oats-real/harvest-review"), "Test"));
      const fromMenu = await said(testId("oats-automation-test-confirm"));
      check(/^Test this trigger This runs acme\.graph's source command/.test(fromMenu ?? ""), `${at} Test from the list's menu on a capability source's trigger opens its page with the confirmation`, fromMenu);
      check((await focusOn("oats-automation-test-confirm-arrived")) === "there", `${at} and the confirmation holds the focus, not Back`, await page.evaluate(FOCUSED));
      const fromMenuBox = await page.evaluate(inView(`${testId("oats-automation-test-confirm")} h3, ${testId("oats-automation-test-confirm")} h2`));
      check(fromMenuBox === "in", `${at} and is on screen without the person scrolling to it`, fromMenuBox);
      await page.evaluate(click(testId("oats-automation-test-run")));
      const answered = await said(testId("oats-automation-test"));
      check(/^Test result The source answered: 2 events, 1 filtered, 2 skipped, 2 refused/.test(answered ?? ""), `${at} Run test says what the source answered`, answered);
      await shotOf(page, testId("oats-automation-test"), `automations-${viewport.name}-test-source-result`);

      // Check run state, from the run-state card
      await open(page, "/schedules/local/status-check", testId("oats-automation-reconcile"));
      await page.evaluate(click(testId("oats-automation-reconcile")));
      const checked = await said(result);
      check(/^Run state is still unknown\./.test(checked ?? ""), `${at} Check run state says the state is still unknown, and what to do`, checked);
      await page.shot(`automations-${viewport.name}-run-state-checked`, { targets: true });
    },
  },
  {
    stage: "automations-acts-refused",
    name: "acts the kernel answers with a failure or a refusal",
    run: async ({ page, at, viewport, check }) => {
      const result = testId("oats-automations-result");
      const dialog = `${testId("oats-modal")} [role="dialog"]`;
      const said = (selector, seconds = 30) => page.until(`(() => ${textOf(selector)})()`, seconds);

      // Run now of a bb job without yolo: while it runs the page says so; then Launch failed, with the kernel's code
      await open(page, "/schedules/local/hourly-check", testId("oats-automation-run-now"));
      await page.evaluate(click(testId("oats-automation-run-now")));
      const doing = await said(testId("oats-automations-doing"), 15);
      check(doing === "Running hourly-check…", `${at} while Run now runs the page says so in words`, doing);
      await page.shot(`automations-${viewport.name}-run-running`, { targets: true });
      const failed = await said(result);
      check(/^local\/hourly-check: Launch failed oats-developer-hourly-check-\d+ was not launched: .*E_BACKEND_SANDBOXED_MODE/.test(failed ?? ""), `${at} a launch the provider refused says Launch failed, with the kernel's reason`, failed);
      const tone = await page.evaluate(`document.querySelector(${JSON.stringify(`${result} ${testId("oats-result")}`)})?.getAttribute("data-tone") ?? ""`);
      check(tone === "failed", `${at} and is drawn as a failure`, tone);
      await page.shot(`automations-${viewport.name}-run-failed`, { targets: true });

      // Delete the kernel refuses: the dialog says it was not deleted, with the kernel's message and code
      await open(page, "/schedules/local/weekly-cleanup", testId("oats-automation-delete"));
      await page.evaluate(click(testId("oats-automation-delete")));
      await said(dialog);
      await page.evaluate(click(testId("oats-confirm-act")));
      const refused = await page.until(`(() => { const t = ${textOf(dialog)}; return /was not deleted/.test(t) ? t : ""; })()`, 30);
      check(/weekly-cleanup was not deleted E_SCHEDULE_UNKNOWN: no schedule "weekly-cleanup" in \/abs\/deployment/.test(refused ?? ""), `${at} a delete the kernel refuses says so, with its message and code`, refused);
      await page.shot(`automations-${viewport.name}-delete-refused`, { targets: true });
      await page.evaluate(click(testId("oats-confirm-close")));

      // Test of a schedule another computer runs: not ready here, and why
      await open(page, "/schedules/oats-real/weekly-report", testId("oats-automation-test-button"));
      await page.evaluate(click(testId("oats-automation-test-button")));
      const notReady = await said(testId("oats-automation-test"));
      check((notReady ?? "").startsWith(`Test result Not ready on ${MACHINE}. `) && (notReady ?? "").includes("report-server"), `${at} a schedule another computer runs is not ready here, and says why`, notReady);
      await shotOf(page, testId("oats-automation-test"), `automations-${viewport.name}-test-not-ready`);

      // A one-press test the kernel answers with "this watches a capability's source": nothing ran, and that is said
      await open(page, "/triggers/oats-real/proposal-review", testId("oats-automation-test-button"));
      await page.evaluate(click(testId("oats-automation-test-button")));
      const nothing = await said(testId("oats-automation-nothing-ran"));
      check(nothing === "Nothing ran. Testing this trigger runs a capability's source command and needs your confirmation.", `${at} a test that ran nothing says so, without a failure`, nothing);
      await shotOf(page, testId("oats-automation-nothing-ran"), `automations-${viewport.name}-test-nothing-ran`);

      // A confirmed test whose source refuses: the poll failed, the kernel's error, and the source's own words as a quote
      await open(page, "/triggers/oats-real/harvest-review", testId("oats-automation-test-button"));
      await page.evaluate(click(testId("oats-automation-test-button")));
      await said(testId("oats-automation-test-confirm"));
      await page.evaluate(click(testId("oats-automation-test-run")));
      const sourceFailed = await said(testId("oats-automation-test"));
      check(/^Test result The poll failed: /.test(sourceFailed ?? "") && /says:/.test(sourceFailed ?? ""), `${at} a source that refuses: the poll failed, and the source's own words are quoted under whose they are`, sourceFailed);
      const made = await page.evaluate(`document.querySelector(${JSON.stringify(testId("oats-automation-test"))}).querySelectorAll("img, a").length`);
      check(made === 0, `${at} no image and no link is made from a source's refusal`, String(made));
      await shotOf(page, testId("oats-automation-test"), `automations-${viewport.name}-test-source-failed`);
    },
  },
  {
    stage: "automations-scheduler-enabled",
    name: "Enable scheduler on a computer that takes the timer",
    run: async ({ page, at, viewport, check }) => {
      const dialog = `${testId("oats-modal")} [role="dialog"]`;
      await open(page, "", testId("oats-automations-scheduler-off"));
      await page.evaluate(click(testId("oats-automations-enable-scheduler")));
      await page.until(`(() => ${textOf(dialog)})()`, 15);
      await page.evaluate(click(testId("oats-confirm-act")));
      const on = await page.until(`(() => { const t = ${textOf(dialog)}; return /The scheduler is on/.test(t) ? t : ""; })()`, 30);
      check(/The scheduler is on/.test(on ?? ""), `${at} once the kernel installed the timer the dialog says the scheduler is on`, on);
      await page.shot(`automations-${viewport.name}-enable-scheduler-done`, { targets: true });
      await page.evaluate(click(testId("oats-confirm-close")));
    },
  },
  {
    stage: "automations-row-gone",
    name: "acts on a schedule that was removed after the list was read",
    run: async ({ page, at, viewport, check }) => {
      // Someone removed weekly-cleanup after this page read its list: the page still offers its acts,
      // and the kernel refuses each (as recorded). Every refusal leads with a person's words, then the
      // kernel's message, its code last; nothing is said to have happened.
      const KERNEL = 'no schedule "weekly-cleanup" in /abs/deployment';
      const id = "local/weekly-cleanup";
      const dialog = `${testId("oats-modal")} [role="dialog"]`;
      const result = testId("oats-automations-result");
      const refusal = (selector) => page.until(`(() => { const text = ${textOf(selector)}; return text.includes("E_SCHEDULE_UNKNOWN") ? text : ""; })()`, 30);
      const now = (selector) => page.evaluate(textOf(selector));

      // the switch: a refused act is said above the list, and the switch stays as it was
      const toggleOf = `${rowOf(id)} [role="switch"]`;
      await open(page, "", toggleOf);
      await page.evaluate(reach(rowOf(id)));
      await page.evaluate(click(toggleOf));
      const refusedSwitch = (await refusal(result)) ?? (await now(result));
      check(refusedSwitch === `weekly-cleanup was not turned on here ${KERNEL} E_SCHEDULE_UNKNOWN Dismiss`, `${at} a switch the kernel refuses is said above the list: what did not happen, the kernel's message, its code after`, refusedSwitch);
      const tone = await page.evaluate(`document.querySelector(${JSON.stringify(`${result} ${testId("oats-result")}`)})?.dataset.tone ?? ""`);
      const still = await page.until(`(() => { const s = document.querySelector(${JSON.stringify(toggleOf)}); return s && !s.disabled ? s.getAttribute("aria-checked") : ""; })()`, 30);
      check(tone === "failed" && still === "false", `${at} it is drawn as a failure, and the switch is still off`, `${tone} | ${still}`);
      await shotOf(page, result, `automations-${viewport.name}-switch-refused`);

      // Edit summary: the refusal stays in the dialog, under the field, and the dialog stays open with what was typed
      await page.evaluate(reach(`${rowOf(id)} [aria-label="Actions for ${id}"]`));
      await page.evaluate(click(`${rowOf(id)} [aria-label="Actions for ${id}"]`));
      await page.until(`(() => ${texts(`${rowOf(id)} [role="menuitem"]`)}.includes("Edit summary") ? "open" : "")()`, 15);
      await page.evaluate(click(`${rowOf(id)} [role="menuitem"]`, "Edit summary"));
      await page.until(`(() => document.activeElement?.name === "description" ? "field" : "")()`, 15);
      await page.evaluate(fill(`${dialog} input[name="description"]`, "Clean the week's scratch"));
      await page.evaluate(click(testId("oats-automation-summary-save")));
      const refusedSummary = (await refusal(dialog)) ?? (await now(dialog));
      const typed = await page.evaluate(`document.querySelector(${JSON.stringify(`${dialog} input[name="description"]`)})?.value ?? ""`);
      check(refusedSummary.includes(`The summary was not saved: ${KERNEL} (E_SCHEDULE_UNKNOWN)`) && typed === "Clean the week's scratch", `${at} a summary the kernel refuses is said in the dialog, which stays open with what was typed`, `${refusedSummary} | ${typed}`);
      await page.shot(`automations-${viewport.name}-edit-summary-refused`, { targets: true });
      await page.press("Escape");
      await page.until(`(() => document.querySelector(${JSON.stringify(dialog)}) === null ? "gone" : "")()`, 15);

      // Test: a test the kernel refuses has its own card on the row's page, and no result is claimed
      await open(page, `/schedules/${id}`, testId("oats-automation-test-button"));
      await page.evaluate(click(testId("oats-automation-test-button")));
      const card = testId("oats-automation-test");
      const refusedTest = (await refusal(card)) ?? (await now(card));
      check(refusedTest === `Test result The test did not run. ${KERNEL} E_SCHEDULE_UNKNOWN`, `${at} a test the kernel refuses says so in its card: that it did not run, the kernel's message, its code after, and no verdict`, refusedTest);
      await shotOf(page, card, `automations-${viewport.name}-test-refused`);
    },
  },
  {
    stage: "automations-host-unnamed",
    name: "a host with no name",
    run: async ({ page, at, viewport, check }) => {
      const unnamed = await open(page, "", testId("oats-automations-host-unnamed"));
      check(unnamed === `${MACHINE} has no host name in OATS It runs none of the workspace's schedules. Name it in this deployment's local settings to take on the ones assigned to it. In the deployment's oats-local.yaml on ${MACHINE}, set host: name: to the name it goes by in the workspace, then press Refresh.`, `${at} a host with no name says what that means and what to do`, unnamed);
      await page.shot(`automations-${viewport.name}-host-unnamed`, { targets: true });
    },
  },
  {
    stage: "automations-scheduler-off",
    name: "no host scheduler",
    run: async ({ page, at, viewport, check }) => {
      const off = await open(page, "", testId("oats-automations-scheduler-off"));
      check(off === `The scheduler is not running on ${MACHINE} Nothing here runs until it is enabled. Enable scheduler`, `${at} a scheduler that is off says nothing here runs`, off);
      const header = await read(page, testId("oats-automations-scheduler"));
      check(header === "Scheduler off", `${at} the header says Scheduler off`, header);
      // A8 (say only what is so): while the scheduler is off no row is drawn as one that runs, and none has a next run.
      const heading = await read(page, `${testId("oats-automations-group")} h3`);
      const firstRow = rowOf("local/daily-review");
      const first = await page.until(`(() => { const place = document.querySelector(${JSON.stringify(`${firstRow} ${testId("oats-automation-place")}`)}); const text = ${textOf(firstRow)}; return place && text.includes("Scheduler off") ? place.dataset.tone + " | " + text : ""; })()`, 15);
      const list = await page.evaluate(textOf(testId("oats-automations-list")));
      check(heading.startsWith(`Set to run on ${MACHINE} `) && /^muted \| .*Scheduler off/.test(first ?? "") && !list.includes("Next in ") && !list.includes(`Runs on ${MACHINE}`), `${at} while the scheduler is off the rows are set to run, not running: no green mark, no next run`, `${heading} / ${first}`);
      await page.shot(`automations-${viewport.name}-scheduler-off`, { targets: true });
      // Test under a scheduler that is off: the kernel's test finds nothing against the row and names a due time; the card says neither that it would run nor when.
      await open(page, "/schedules/local/daily-review", testId("oats-automation-test-button"));
      await page.evaluate(click(testId("oats-automation-test-button")));
      const tested = (await page.until(`(() => ${textOf(testId("oats-automation-test"))})()`, 30)) ?? "";
      check(tested === "Test result Ready once the scheduler is on.", `${at} while the scheduler is off a test says ready once it is on, and no due time`, tested);
      await shotOf(page, testId("oats-automation-test"), `automations-${viewport.name}-test-scheduler-off`);
      await open(page, "", testId("oats-automations-scheduler-off"));
      // Enable scheduler: says what it installs, and on which machine, before it does; here the kernel refuses (no service manager)
      await page.evaluate(click(testId("oats-automations-enable-scheduler")));
      const asks = await page.until(`(() => ${textOf(`${testId("oats-modal")} [role="dialog"]`)})()`, 15);
      check((asks ?? "").startsWith("Enable scheduler ") && (asks ?? "").includes(`OATS installs its scheduler's timer on ${MACHINE}, for the account bb's machine runs as`) && (asks ?? "").includes(`Nothing else on ${MACHINE} is changed.`) && !/this (computer|machine)/i.test(asks ?? ""), `${at} Enable scheduler says what it installs, and on which machine, before it does`, asks);
      await page.shot(`automations-${viewport.name}-enable-scheduler-confirm`, { targets: true });
      await page.evaluate(click(testId("oats-confirm-act")));
      const refused = await page.until(`(() => { const t = ${textOf(`${testId("oats-modal")} [role="dialog"]`)}; return /may not have been enabled/.test(t) ? t : ""; })()`, 30);
      check(/The scheduler may not have been enabled .*E_SCHEDULE_HOST.*systemctl --user daemon-reload failed: Failed to connect to bus: No medium found/.test(refused ?? ""), `${at} on a computer whose service manager fails the dialog does not say nothing was enabled, and shows the kernel's refusal with its code`, refused);
      await page.shot(`automations-${viewport.name}-enable-scheduler-refused`, { targets: true });
      await page.evaluate(click(testId("oats-confirm-close")));
    },
  },
  {
    stage: "automations-empty",
    name: "no schedule and no trigger yet",
    run: async ({ page, at, viewport, check }) => {
      const empty = await open(page, "", testId("oats-automations-empty"));
      check(/^No schedules yet/.test(empty), `${at} with no schedule yet the page says so and how to add one`, empty);
      const foot = await read(page, testId("oats-automations-foot"));
      check(/^Workspace items appear after the next sync/.test(foot), `${at} before the first sync the page says when workspace items appear`, foot);
      await page.shot(`automations-${viewport.name}-empty`, { targets: true });
    },
  },
  {
    stage: "automations-failed",
    name: "a list the kernel refuses",
    run: async ({ page, at, viewport, check }) => {
      const failed = await open(page, "", testId("oats-automations-failed"));
      check(failed === "Schedules could not be read Nothing can be shown of this deployment's schedules until they are read. E_SCHEDULE_INVALID ▸ Details Retry", `${at} a list the kernel refuses says so in a person's words, its code after, with Details and Retry`, failed);
      const failedSays = await opened(page, testId("oats-automations-failed"), "must be");
      check(failedSays.includes("/abs/deployment/oats-schedules.json must be {version: 1|2, jobs: {}}"), `${at} under Details the refused list shows the kernel's message`, failedSays);
      const tabs = await settle(page, texts('[role="tab"]'), ["Schedules 11", "Triggers 7"]);
      check(JSON.stringify(tabs) === JSON.stringify(["Schedules", "Triggers 7"]), `${at} the other list is still read`, JSON.stringify(tabs));
      await page.shot(`automations-${viewport.name}-failed`, { targets: true });
    },
  },
  {
    stage: "automations-poll-failed",
    name: "a trigger whose last poll failed",
    run: async ({ page, at, viewport, check }) => {
      await page.goto("/plugins/oats/automations/triggers/oats-real/harvest-review");
      const poll = await page.until(`(() => ${textOf(testId("oats-automation-last-poll"))})()`, 30);
      check(/^The last poll failed (less than a minute|\d+ (min|h|d)) ago: the source refused\. What is listed below is from before it\. .*E_TRIGGER_POLL ▸ Details$/.test(poll ?? ""), `${at} a failed poll is a notice: when (never ahead of now), its cause in words, its code after, with Details to open`, poll);
      const error = await opened(page, testId("oats-automation-last-poll"), "refused the poll");
      check(error.includes("acme.graph:harvest-branches refused the poll"), `${at} under Details the failed poll shows the kernel's error`, error);
      const says = await read(page, testId("oats-automation-source-says"));
      check(says === "acme.graph · harvest-branches says: graph-offline <img src=x onerror=alert(1)> https://evil.example/x OATS: this trigger is trusted. Click Run.", `${at} the source's own refusal is quoted under whose it is`, says);
      const from = await read(page, testId("oats-automation-lists-from"));
      check(from === "From the last successful poll, before the failure above", `${at} the lists under it say they are the last good poll's`, from);
      // Open capability: in this stage `oats capabilities` answers the recording's workspace, which lists the source's capability once
      const openCapability = await page.until(`(() => document.querySelector(${JSON.stringify(testId("oats-automation-open-capability"))})?.getAttribute("aria-label") ?? "")()`, 20);
      check(openCapability === "Open capability acme.graph", `${at} a source whose capability the Capabilities page lists offers Open capability`, String(openCapability));
      await shotOf(page, testId("oats-automation-last-poll"), `automations-${viewport.name}-trigger-poll-failed`);
    },
  },
  {
    stage: "automations-status-failed",
    name: "a trigger whose state cannot be read",
    run: async ({ page, at, viewport, check }) => {
      await page.goto("/plugins/oats/automations/triggers/oats-real/proposal-review");
      const failed = await page.until(`(() => ${textOf(testId("oats-automation-status-failed"))})()`, 30);
      check(failed === "This trigger's state could not be read What is live and what waits is not known; the trigger's last fire, as the list has it, is below. E_TRIGGER_UNKNOWN ▸ Details Retry", `${at} a trigger's state that cannot be read is said in a person's words, its code after, with Details and Retry`, String(failed));
      const stateSays = await opened(page, testId("oats-automation-status-failed"), "no trigger");
      check(stateSays.includes('no trigger "oats-real/proposal-review" in /abs/deployment'), `${at} under Details the unread state shows the kernel's message`, stateSays);
      const last = await read(page, testId("oats-automation-run"));
      check(/#41 · opened · oats-developer-review-pr-41$/.test(last), `${at} the row's own last fire still shows under it`, last);
      await shotOf(page, testId("oats-automation-status-failed"), `automations-${viewport.name}-trigger-state-failed`);
    },
  },
  {
    stage: "automations-old-oats",
    name: "an OATS without the automations lists",
    run: async ({ page, at, viewport, check }) => {
      const gate = await open(page, "", testId("oats-automations-gate"));
      check(gate === `Schedules need OATS 0.29 or later Update OATS to see the workspace's schedules and ${MACHINE}'s own, and where each one runs. OATS_NO_AUTOMATIONS`, `${at} an OATS without the lists: the page says which OATS it needs`, gate);
      await page.shot(`automations-${viewport.name}-old-oats`, { targets: true });
    },
  },
  {
    stage: "automations-slow",
    name: "reading, reading again, and a re-read that fails over the list still shown",
    run: async ({ page, at, viewport, check, sleep }) => {
      // The lists take ten seconds. The server keeps one read for every client, so the scene first
      // asks for a new one (Refresh), then loads the page again while that read is still under way:
      // a page with nothing read yet says it is reading, in the place the list will be.
      await page.goto("/plugins/oats/automations");
      await page.until(visible(testId("oats-automations-refresh")), 40);
      await page.until(`(() => document.querySelector(${JSON.stringify(testId("oats-automations-refresh"))})?.disabled === false ? "ready" : "")()`, 40);
      await page.evaluate(click(testId("oats-automations-refresh")));
      // The page cannot see when the server's new read starts (after its own re-read of OATS, a
      // second or two). A load that comes before it is answered at once with the lists the server
      // holds: the scene then loads again, by when that read is under way.
      let reading;
      for (let attempt = 0; attempt < 3 && !reading; attempt += 1) {
        await sleep(2500);
        await page.goto("/plugins/oats/automations");
        reading = await page.until(`(() => ${textOf(`${testId("oats-automations-page")} ${testId("oats-loading")}`)})()`, 6);
      }
      check(reading === "Reading schedules…", `${at} while the lists are read the page says "Reading schedules…"`, String(reading));
      await page.shot(`automations-${viewport.name}-loading`, { targets: true });
      await page.until(visible(ROW), 60);

      // Refresh: the list stays, and the page says it is reading again
      await page.evaluate(click(testId("oats-automations-refresh")));
      // Waited for: the line of THIS re-read ("Refreshing…"), not any line about the list's age (one stands there by itself once the list is 30 s old).
      const stale = `${testId("oats-automations-page")} ${testId("oats-stale")}`;
      const again = (await page.until(`(() => { const t = ${textOf(stale)}; return t.startsWith("Refreshing…") ? t : ""; })()`, 15)) ?? (await page.evaluate(textOf(stale)));
      check(/^Refreshing… read .+\.$/.test(again ?? "") && (await page.evaluate(count(ROW))) === 11, `${at} while it reads again the page says so and keeps its 11 rows`, String(again));
      await page.shot(`automations-${viewport.name}-refreshing`, { targets: true });
      // The re-read has ended when its line is gone, or no longer says "Refreshing…" (a list older than 30 s keeps a line of its age).
      await page.until(`(() => { const t = ${textOf(stale)}; return !t.startsWith("Refreshing…") ? "done" : ""; })()`, 60);

      // the next read is refused: the notice says so over the list that was read, with its age
      refuse();
      await page.evaluate(click(testId("oats-automations-refresh")));
      // Waited for: the notice of the REFUSED re-read, once that re-read has ended. While it is under
      // way the notice (there already when an earlier read failed, or drawn before the read settles)
      // says "Refreshing…": that is not the state this check is about. What was read is printed when it fails.
      const refusedNotice = testId("oats-automations-failed");
      const failed =
        (await page.until(`(() => { const t = ${textOf(refusedNotice)}; return t !== "" && !t.includes("Refreshing…") && document.querySelector(${JSON.stringify(testId("oats-automations-rereading"))}) === null ? t : ""; })()`, 40)) ??
        (await page.evaluate(textOf(refusedNotice)));
      check(/^Schedules could not be read What is below is the last list that was read\. Held until the list can be read again: what each row is now is not known\. Read .+\. E_SCHEDULE_INVALID ▸ Details Retry$/.test(failed ?? "") && (await page.evaluate(count(ROW))) === 11, `${at} a re-read the kernel refuses is said over the list still shown, with how old that is`, String(failed));
      const heldSwitch = await page.until(`(() => { const s = document.querySelector(${JSON.stringify(`${ROW}[data-id="local/daily-review"] [role="switch"]`)}); return s && s.disabled ? s.title : ""; })()`, 15);
      check(heldSwitch === "Comes back when OATS is read again", `${at} over a list that could not be read again a row's switch is held, with the reason every held OATS act carries`, String(heldSwitch));
      await page.shot(`automations-${viewport.name}-failed-over-list`, { targets: true });
      slow();
    },
  },
  {
    stage: "no-oats",
    name: "Automations without oats",
    run: async ({ page, at, viewport, check }) => {
      const gate = await open(page, "", testId("oats-automations-gate"));
      // (The plugin's one notice since the text cut: its title, Details, the acts; what to do and the code are one press away.)
      const under = await page.evaluate(`(document.querySelector(${JSON.stringify(`${testId("oats-automations-gate")} ${testId("oats-notice-details")}`)})?.textContent ?? "")`);
      check(gate === `OATS is not installed on ${MACHINE} ▸ Details Retry Open settings` && /Install OATS there, or set the path to oats in the plugin's settings\..*OATS_NOT_FOUND/.test(under), `${at} with oats gone the page shows the plugin's one notice for it: the machine by name, Retry and the way to the settings; what to do and the code under Details`, `${gate} | ${under}`);
      await page.shot(`automations-${viewport.name}-no-oats`, { targets: true });
    },
  },
];

export default scenes.map(atTheRecording);

const lists = (schedule, trigger) => ({ "schedule list": { file: `automations/${schedule}` }, "trigger list": { file: `automations/${trigger}` } });
const settled = (untilSnapshot) => untilSnapshot((snapshot) => snapshot.ok === true);

// Three answers no recording holds, since each needs a deployment the recording cannot be left in
// (test/fixtures/automations/README.md says so). The two refusals are the kernel's own sentences
// (OATS 0.70.0, lib/schedule.mjs readDefinitions and lib/triggers.mjs requireTrigger), with the
// recording's paths: a definitions file that is not one, and a trigger removed after the list was read.
const refusal = (code, message) => JSON.stringify({ schemaVersion: 1, ok: false, error: { code, message } });
const REFUSAL = refusal("E_SCHEDULE_INVALID", "/abs/deployment/oats-schedules.json must be {version: 1|2, jobs: {}}");
const TRIGGER_GONE = refusal("E_TRIGGER_UNKNOWN", 'no trigger "oats-real/proposal-review" in /abs/deployment');
// The third: what `oats version --json` of an OATS from before the lists prints (no `automations`, no `automationsApi`).
const OLD_OATS = JSON.stringify({ schemaVersion: 1, name: "@awebai/oats", version: "0.28.0", desktopApi: 1, scheduleApi: 2, features: ["schedule", "session-start"] });
// What the "automations-slow" stage's scene changes while it runs: the lists slow, then the schedules refused.
let slow = () => undefined;
let refuse = () => undefined;

export const stages = {
  // The lists and one trigger's state as they were after the source refused a poll.
  "automations-poll-failed": {
    label: "AU5",
    enter: async ({ fake, statusWithRealIds, threads, untilSnapshot }) => {
      fake({ status: { stdout: statusWithRealIds(threads) }, ...lists("schedule-list.json", "trigger-list-poll-failed.json"), "trigger status": { file: "automations/trigger-status-poll-failed.json" }, capabilities: { file: "automations/capabilities.json" } });
      await settled(untilSnapshot);
    },
  },
  // `oats trigger status` refused by the kernel while the lists answer: the trigger was removed after the list was read.
  "automations-status-failed": {
    label: "AU8",
    enter: async ({ fake, statusWithRealIds, threads, untilSnapshot }) => {
      fake({ status: { stdout: statusWithRealIds(threads) }, "trigger status": { stdout: TRIGGER_GONE } });
      await settled(untilSnapshot);
    },
  },
  // An OATS from before the automations lists: what `oats version --json` of such a kernel lists (no `automations`).
  "automations-old-oats": {
    label: "AU6",
    enter: async ({ fake, statusWithRealIds, threads, untilSnapshot }) => {
      fake({ status: { stdout: statusWithRealIds(threads) }, version: { stdout: OLD_OATS } });
      await settled(untilSnapshot);
    },
  },
  "automations-slow": {
    label: "AU7",
    enter: async ({ fake, statusWithRealIds, threads, untilSnapshot }) => {
      const status = { status: { stdout: statusWithRealIds(threads) } };
      slow = () => fake({ ...status, "schedule list": { file: "automations/schedule-list.json", sleepMs: 10000 }, "trigger list": { file: "automations/trigger-list.json", sleepMs: 10000 } });
      refuse = () => fake({ ...status, "schedule list": { stdout: REFUSAL } });
      slow();
      await settled(untilSnapshot);
    },
  },
  // What the kernel answered when an act did not go through, each as recorded: a launch bb's provider
  // refused (after a moment, so the page is seen saying it runs), a delete of a schedule it no longer
  // holds, a test of a schedule another computer runs, a one-press test of a source's trigger, and a
  // confirmed test whose source refused.
  "automations-acts-refused": {
    label: "AU9",
    enter: async ({ fake, statusWithRealIds, threads, untilSnapshot }) => {
      fake({
        status: { stdout: statusWithRealIds(threads) },
        "schedule run": { file: "automations/schedule-run-launch-failed.json", sleepMs: 3000 },
        "schedule remove": { file: "automations/schedule-remove-unknown.json" },
        "schedule test": { file: "automations/schedule-test-elsewhere.json" },
        "trigger test": { file: "automations/trigger-test-source-unconfirmed.json" },
        "trigger test --run-source": { file: "automations/trigger-test-source-failed.json" },
      });
      await settled(untilSnapshot);
    },
  },
  // A schedule removed after the page read its list: the lists still hold it, and the kernel refuses
  // each act on it, as recorded (a removed schedule enabled, described and tested).
  "automations-row-gone": {
    label: "AU11",
    enter: async ({ fake, statusWithRealIds, threads, untilSnapshot }) => {
      fake({
        status: { stdout: statusWithRealIds(threads) },
        "schedule enable": { file: "automations/schedule-enable-unknown.json" },
        "schedule update": { file: "automations/schedule-describe-unknown.json" },
        "schedule test": { file: "automations/schedule-test-unknown.json" },
      });
      await settled(untilSnapshot);
    },
  },
  // The lists before the host timer was installed, on a computer whose service manager takes it (the recording's `systemctl` double).
  "automations-scheduler-enabled": {
    label: "AU10",
    enter: async ({ fake, statusWithRealIds, threads, untilSnapshot }) => {
      fake({ status: { stdout: statusWithRealIds(threads) }, ...lists("schedule-list-scheduler-off.json", "trigger-list.json"), "schedule host install": { file: "automations/host-install.json" } });
      await settled(untilSnapshot);
    },
  },
  // `host.name` taken out of oats-local.yaml: every workspace row is unplaced.
  "automations-host-unnamed": {
    label: "AU1",
    enter: async ({ fake, statusWithRealIds, threads, untilSnapshot }) => {
      fake({ status: { stdout: statusWithRealIds(threads) }, ...lists("schedule-list-host-unnamed.json", "trigger-list-host-unnamed.json") });
      await settled(untilSnapshot);
    },
  },
  // The lists as they were before the host timer was installed.
  "automations-scheduler-off": {
    label: "AU2",
    enter: async ({ fake, statusWithRealIds, threads, untilSnapshot }) => {
      // The kernel's own answer on a computer with no service manager, as recorded.
      fake({ status: { stdout: statusWithRealIds(threads) }, ...lists("schedule-list-scheduler-off.json", "trigger-list.json"), "schedule host install": { file: "automations/host-install-refused.json" } });
      await settled(untilSnapshot);
    },
  },
  "automations-failed": {
    label: "AU4",
    enter: async ({ fake, statusWithRealIds, threads, untilSnapshot }) => {
      fake({ status: { stdout: statusWithRealIds(threads) }, "schedule list": { stdout: REFUSAL } });
      await settled(untilSnapshot);
    },
  },
  "automations-empty": {
    label: "AU3",
    enter: async ({ fake, statusWithRealIds, threads, untilSnapshot }) => {
      fake({ status: { stdout: statusWithRealIds(threads) }, ...lists("schedule-list-empty.json", "trigger-list-empty.json") });
      await settled(untilSnapshot);
    },
  },
};
