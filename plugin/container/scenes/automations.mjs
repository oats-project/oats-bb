// Automations' live scenes: the ONE list (schedules and triggers together), an automation's own
// page with its Runs, the Runs tab, the acts, the notices of a host with no name and no scheduler,
// and the page with `oats` gone; and their worst-case twins on the busy set (37 automations, five
// failing, one whose agent asks, fifty-run histories, names of sixty characters), where the
// page's type is held against bb's OWN Automations page. The lists are what the real kernel
// printed (test/fixtures/automations/); their times are the recording's, so each scene runs with
// the page's clock at the recording's own time: a last run is in the past and a next run ahead.
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { fill, FOCUSED, testId, textOf, texts, visible } from "../browser.mjs";
import { busy } from "./automations-busy.mjs";
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
/**
 * No icon is bb's generic glyph: at every image a scene takes of the page, the drawing of each icon then on it is held against the
 * drawing of a name no set holds. One check per scene and window, with the names it saw; a scene that takes no image of the page
 * (one with no `oats`, an old OATS) checks none.
 */
const iconsChecked = (scene) => ({
  ...scene,
  run: async (context) => {
    const seen = { drawn: new Set(), generic: new Set(), images: 0, probes: 0 };
    const page = {
      ...context.page,
      shot: async (name, options) => {
        if (options?.plugin !== false) {
          const read = JSON.parse(await context.page.evaluate(iconsDrawn));
          if (read.drawn.length > 0) {
            seen.images += 1;
            if (read.probe) seen.probes += 1;
            for (const each of read.drawn) seen.drawn.add(each);
            for (const each of read.generic) seen.generic.add(each);
          }
        }
        return context.page.shot(name, options);
      },
    };
    await scene.run({ ...context, page });
    if (seen.images > 0) context.check(seen.probes === seen.images && seen.generic.size === 0, `${context.at} every icon drawn in this scene's ${seen.images} images is one bb's set holds: none is bb's generic glyph`, `drawn: ${[...seen.drawn].join(", ")}; generic: ${[...seen.generic].join(", ") || "none"}; images with the probe: ${seen.probes} of ${seen.images}`);
  },
});


const RUN = testId("oats-run");
const PILLS = `${testId("oats-filter")} [role="radio"]`;
const menuOf = (id) => `${rowOf(id)} ${testId("oats-automation-menu")} button`;
const itemOf = (within) => `${within} [role="menuitem"]`;
/** A row's small line, part by part. */
const lineOf = (within) => `[...document.querySelectorAll(${JSON.stringify(`${within} ${testId("oats-automation-line")} [data-part]`)})].map((e) => e.innerText.replace(/^·\\s*/, "").replace(/\\s+/g, " ").trim())`;
/** Presses the element of `selector` whose text, its spaces made one, is `text` (a pill's label and its count are two pieces of text). */
const press = (selector, text) =>
  `(() => { const found = [...document.querySelectorAll(${JSON.stringify(selector)})].find((e) => e.innerText.replace(/\\s+/g, " ").trim() === ${JSON.stringify(text)}); if (!found) throw new Error("nothing to press: " + ${JSON.stringify(`${selector} "${text}"`)}); found.click(); return true; })()`;
const idsOf = `[...document.querySelectorAll(${JSON.stringify(ROW)})].map((e) => e.dataset.id)`;
/** What bb's own header says of the page: its title, and on a row's page the automation's name after it. */
const HEADER = textOf(testId("oats-automations-title"));
/** The marks of the sidebar's Automations link: each dot's name. */
const MARKS = `[...document.querySelectorAll(${JSON.stringify(`${testId("oats-page-link-automations")} ${testId("oats-mark")}`)})].map((e) => e.getAttribute("aria-label"))`;
/** Whether every box of `selector` is whole inside the window's width: nothing of it is cut at the right. */
const allInside = (selector) => `[...document.querySelectorAll(${JSON.stringify(selector)})].every((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.left >= 0 && r.right <= innerWidth + 0.5; })`;
/** The names of the list that are cut (an ellipsis, or text wider than its box): none may be. */
const cutNames = `[...document.querySelectorAll(${JSON.stringify(testId("oats-automation-name"))})].filter((e) => e.scrollWidth > e.clientWidth + 1 || getComputedStyle(e).textOverflow === "ellipsis").map((e) => e.innerText)`;
/** The computed type of the first element of `selector`: its size and its weight. */
const typeOf = (selector) => `(() => { const e = document.querySelector(${JSON.stringify(selector)}); if (!e) return "absent"; const s = getComputedStyle(e); return s.fontSize + " " + s.fontWeight; })()`;
/**
 * The icons of the page that bb drew as its generic glyph (a name its set does not hold), by name: the DRAWING of each against the
 * drawing of a name no set holds, which the page keeps, never seen, for this (app/automations/bb.tsx IconProbe). → JSON
 * { probe: whether that drawing is there, drawn: the names drawn, generic: those drawn as the generic glyph }
 */
const iconsDrawn = `(() => {
  const drawing = (svg) => svg.outerHTML.replace(/\\s(class|data-icon|data-testid|aria-[a-z]+|width|height|style)="[^"]*"/g, "");
  const probe = document.querySelector(${JSON.stringify(`${testId("oats-icon-probe")} svg`)});
  const all = [...document.querySelectorAll(${JSON.stringify(`${testId("oats-automations-page")} svg`)})].filter((svg) => svg !== probe);
  const name = (svg) => svg.getAttribute("data-icon") ?? "(no name)";
  const generic = probe === null ? [] : all.filter((svg) => drawing(svg) === drawing(probe)).map(name);
  return JSON.stringify({ probe: probe !== null && probe.innerHTML !== "", drawn: [...new Set(all.map(name))], generic: [...new Set(generic)] });
})()`;
const PLUGIN_DIR = fileURLToPath(new URL("../..", import.meta.url));
const FIXTURES = `${PLUGIN_DIR}/test/fixtures`;
/** The roster's agents the busy set gives to runs: one that asks, one that is stopped, one that runs (test/fixtures/roster/status.json). */
const BUSY_AGENTS = ["release-070-maintainer", "weekly-digest-helper", "kernel-fix-developer"];
const BUSY = busy(FIXTURES, { agents: BUSY_AGENTS });

/** On a row's own page: opens its "…" menu and presses the act of that label. */
async function pageAct(page, label) {
  const menu = testId("oats-automation-detail-menu");
  await page.evaluate(reach(`${menu} button`));
  await page.evaluate(click(`${menu} button`));
  await page.until(`(() => ${texts(itemOf(menu))}.includes(${JSON.stringify(label)}) ? "open" : "")()`, 15);
  await page.evaluate(click(itemOf(menu), label));
}

const scenes = [
  {
    stage: "fixtures",
    name: "Automations: the one list",
    run: async ({ page, at, viewport, check }) => {
      await open(page, "", ROW);
      const tabs = await settle(page, texts('[role="tab"]'), ["Automations 18", "Runs"]);
      check(JSON.stringify(tabs) === JSON.stringify(["Automations 18", "Runs"]), `${at} Automations shows its two tabs: the list with its count, and Runs`, JSON.stringify(tabs));
      const title = await read(page, testId("oats-automations-title"));
      check(title === "Automations", `${at} bb's own header says the page's title, as text`, title);
      // What is failing comes first: a refused launch, an invalid definition, a wrong account, no trust, a failed source check.
      const first = await settle(page, `${idsOf}.slice(0, 5)`, ["local/hourly-check", "local/legacy-herdr", "oats-real/reconcile", "oats-real/release-check", "oats-real/harvest-closed"]);
      check(JSON.stringify(first) === JSON.stringify(["local/hourly-check", "local/legacy-herdr", "oats-real/reconcile", "oats-real/release-check", "oats-real/harvest-closed"]), `${at} the five failing automations lead the list`, JSON.stringify(first));
      const pills = await settle(page, texts(PILLS), ["All 18", "Schedules 11", "Triggers 7", "Needs you 0", "Failing 5"]);
      check(JSON.stringify(pills) === JSON.stringify(["All 18", "Schedules 11", "Triggers 7", "Needs you 0", "Failing 5"]), `${at} the filter counts every row, each kind, what needs a person and what is failing`, JSON.stringify(pills));
      // A row: when · the machine it runs on · its last run with what came of it; what failed in red.
      const failed = await settle(page, lineOf(rowOf("local/hourly-check")), ["Every hour", `Runs on ${MACHINE}`, "Last 2 min ago, Launch failed"]);
      check(JSON.stringify(failed) === JSON.stringify(["Every hour", `Runs on ${MACHINE}`, "Last 2 min ago, Launch failed"]), `${at} a schedule whose launch failed says when it runs, where, and its last run's outcome`, JSON.stringify(failed));
      const sentence = await read(page, `${rowOf("local/daily-review")} ${testId("oats-automation-sentence")}`);
      check(sentence === "Review open pull requests every weekday morning", `${at} a row says the one sentence of what it does, where one is written`, sentence);
      const owner = await page.evaluate(lineOf(rowOf("oats-real/nightly-digest")));
      check(JSON.stringify(owner) === JSON.stringify(["Daily at 07:00", `Runs on ${MACHINE}`, "@ana"]), `${at} a workspace automation names its owner; no row says a next run`, JSON.stringify(owner));
      const names = await page.evaluate(cutNames);
      check(names.length === 0, `${at} no name of the list is cut`, JSON.stringify(names));
      // D-037: while the page is shown, its row of the sidebar is the selected one; its mark says a failure.
      if (!viewport.mobile) {
        const marks = await settle(page, MARKS, ["Automations, a failure"]);
        check(JSON.stringify(marks) === JSON.stringify(["Automations, a failure"]), `${at} the sidebar's Automations link carries the red mark, named "Automations, a failure"`, JSON.stringify(marks));
        const current = `JSON.stringify([...document.querySelectorAll(${JSON.stringify(`${testId("oats-pages")} button`)})].filter((e) => e.getAttribute("aria-current") === "page").map((e) => e.innerText.trim()))`;
        const selected = await page.until(`(() => { const now = ${current}; return now === '["Automations"]' ? now : ""; })()`, 15);
        check(Boolean(selected), `${at} while Automations is shown its row of the sidebar is the selected one, and no other`, selected ?? (await page.evaluate(current)));
      }
      await page.shot(`automations-${viewport.name}-list`, { targets: true });

      // The filter: what is failing alone.
      await page.evaluate(press(PILLS, "Failing 5"));
      const failing = await settle(page, count(ROW), 5);
      check(failing === 5, `${at} "Failing" shows the five failing automations`, String(failing));
      await page.shot(`automations-${viewport.name}-list-failing`, { targets: true });
      await page.evaluate(press(PILLS, "All 18"));

      // A search nothing answers to.
      await page.evaluate(fill(testId("oats-search"), "nothing is called this"));
      const none = await page.until(`(() => ${count(ROW)} === 0 ? ${textOf(testId("oats-automations-no-match"))} : "")()`, 10);
      check(none === "No match", `${at} a search nothing answers to says "No match"`, String(none));
      await page.shot(`automations-${viewport.name}-no-match`, { targets: true });
    },
  },
  {
    stage: "fixtures",
    name: "Automations: one automation's page",
    run: async ({ page, at, viewport, check }) => {
      // A schedule whose last launch failed.
      await open(page, "/schedules/local/hourly-check", testId("oats-automation-detail"));
      const header = await settle(page, HEADER, "Automations / hourly-check");
      check(header === "Automations / hourly-check", `${at} bb's own header is the breadcrumb: the page's title, then the automation's name`, String(header));
      const none = await page.evaluate(`document.querySelector(${JSON.stringify(`${testId("oats-automation-detail")} nav`)}) === null`);
      check(none === true, `${at} the page draws no breadcrumb of its own`);
      const focus = await page.until(`(() => ${FOCUSED} === "oats-automation-name-heading" ? "name" : "")()`, 15);
      check(focus === "name", `${at} the page opens with the focus on the automation's name`, await page.evaluate(FOCUSED));
      const line = await page.until(`(() => { const now = ${lineOf(testId("oats-automation-identity"))}; return now.length === 3 ? JSON.stringify(now) : ""; })()`, 15);
      check(new RegExp(`^\\["Every hour","Runs on ${MACHINE}","Next in \\d+ min"\\]$`).test(line ?? ""), `${at} its own line says when, where and the next run`, String(line));
      const wrong = await read(page, testId("oats-automation-wrong"));
      check(wrong === "Launch failed", `${at} what is wrong stands under the line, by itself`, wrong);
      const does = await read(page, `${testId("oats-automation-sends")} h3`);
      check(does === "Instruction", `${at} what it does is headed "Instruction"`, does);
      const boxes = await page.evaluate(`[...document.querySelectorAll(${JSON.stringify(`${testId("oats-automation-sends")} *, ${testId("oats-run-error")}`)})].filter((e) => { const s = getComputedStyle(e); return parseFloat(s.borderTopWidth) > 0 && parseFloat(s.borderLeftWidth) > 0; }).length`);
      check(boxes === 0, `${at} the instruction and a failed run's words are plain text: no box around either`, String(boxes));
      // Its Runs: one failed run, open to the kernel's own code and message.
      const run = await read(page, `${RUN} ${testId("oats-run-said")}`);
      const mark = await page.evaluate(`document.querySelector(${JSON.stringify(`${RUN} [role="img"]`)})?.getAttribute("aria-label") ?? ""`);
      const error = await read(page, `${RUN} ${testId("oats-run-error")}`);
      check(run === "Launch failed" && mark === "Failed" && /^E_BACKEND_SANDBOXED_MODE /.test(error), `${at} a failed run says so by its mark and its word, and stands open to the kernel's code and message`, `${mark} | ${run} | ${error.slice(0, 80)}`);
      await page.shot(`automations-${viewport.name}-page-failed`, { targets: true });
      // The one closed fold.
      const closed = await page.evaluate(`document.querySelector(${JSON.stringify(testId("oats-automation-details"))})?.open`);
      await page.evaluate(click(`${testId("oats-automation-details")} summary`));
      const rows = await page.until(`(() => { const t = ${texts(`${testId("oats-automation-details")} [data-testid^="oats-automation-detail-"]`)}; return t.length > 0 ? JSON.stringify(t) : ""; })()`, 15);
      check(closed === false && /"Runs on .+","Schedule 0 \* \* \* \* · .+","File /.test(rows ?? ""), `${at} Details is closed until pressed, and holds where it runs, its cron and time zone and its file`, `${closed} ${rows}`);
      await shotOf(page, testId("oats-automation-details"), `automations-${viewport.name}-page-details`);
      // Escape goes back to the list, to the row it came from.
      await page.press("Escape");
      const back = await page.until(`(() => document.querySelector(${JSON.stringify(ROW)}) !== null && document.activeElement?.closest(${JSON.stringify(ROW)})?.dataset.id === "local/hourly-check" ? "row" : "")()`, 15);
      check(back === "row", `${at} Escape goes back to the list, with the focus on the row`, await page.evaluate(FOCUSED));

      // A trigger: what waits, then what fired, with the agent each made.
      await open(page, "/triggers/local/pr-triage", RUN);
      const runs = await settle(page, texts(`${RUN} ${testId("oats-run-said")}`), ["#42 opened · Waiting", "#43 opened · Waiting", "#45 opened · Waiting", "#41 opened · Agent launched"]);
      check(JSON.stringify(runs) === JSON.stringify(["#42 opened · Waiting", "#43 opened · Waiting", "#45 opened · Waiting", "#41 opened · Agent launched"]), `${at} a trigger's runs: what waits, then what fired`, JSON.stringify(runs));
      // The agent of the recording is none of this roster's: its row opens nothing, and has no chevron.
      const gone = await page.evaluate(`[document.querySelectorAll(${JSON.stringify(testId("oats-run-row"))}).length, document.querySelectorAll(${JSON.stringify(testId("oats-run-chevron"))}).length, document.querySelector(${JSON.stringify(testId("oats-run-agent"))})?.dataset.listed].join(" ")`);
      check(gone === "0 0 false", `${at} a run whose agent the roster no longer lists opens nothing: no chevron`, gone);
      await page.shot(`automations-${viewport.name}-page-trigger`, { targets: true });
    },
  },
  {
    stage: "fixtures",
    name: "Automations: the Runs tab",
    run: async ({ page, at, viewport, check }) => {
      await open(page, "/runs", RUN);
      const n = await settle(page, count(RUN), 9);
      check(n === 9, `${at} the Runs tab lists every automation's runs: nine in the recording`, String(n));
      const first = await read(page, `${RUN} ${testId("oats-run-owner")}`);
      check(first === "harvest-review", `${at} newest first, each led by its automation's name`, first);
      await page.shot(`automations-${viewport.name}-runs`, { targets: true });
      await page.evaluate(click(`${testId("oats-automations-runs")} [role="radio"]`, "Failed"));
      const failed = await settle(page, texts(`${RUN} ${testId("oats-run-owner")}`), ["hourly-check"]);
      check(JSON.stringify(failed) === JSON.stringify(["hourly-check"]), `${at} "Failed" keeps the one failed run`, JSON.stringify(failed));
      // An automation's name opens its page.
      await page.evaluate(click(`${RUN} ${testId("oats-run-owner")}`));
      const opened_ = await page.until(`(() => document.querySelector(${JSON.stringify(testId("oats-automation-detail"))})?.dataset.id ?? "")()`, 15);
      check(opened_ === "local/hourly-check", `${at} an automation's name in a run's row opens the automation`, String(opened_));
    },
  },
  {
    stage: "fixtures",
    name: "Automations: acting on a row",
    run: async ({ page, at, viewport, check }) => {
      const result = testId("oats-automations-result");
      const dialog = `${testId("oats-modal")} [role="dialog"]`;
      const said = (selector, seconds = 30) => page.until(`(() => ${textOf(selector)})()`, seconds);
      const openMenu = async (button, within) => {
        await page.evaluate(reach(button));
        await page.evaluate(click(button));
        return page.until(`(() => { const t = ${texts(itemOf(within))}; return t.length > 0 ? JSON.stringify(t) : ""; })()`, 15);
      };
      // A row's menu: the acts that apply to it; the row opens it and its switch turns it, so neither is in the menu.
      await open(page, "", ROW);
      const items = await openMenu(menuOf("local/daily-review"), rowOf("local/daily-review"));
      check(items === JSON.stringify(["Run now", "Test", "Edit summary", "Open file", "Delete…"]), `${at} a local schedule's menu holds Run now, Test, Edit summary, Open file and Delete…`, String(items));
      const menuBox = await page.evaluate(inView(`${rowOf("local/daily-review")} [role="menu"]`));
      check(menuBox === "in", `${at} the whole menu is on screen`, menuBox);
      await page.shot(`automations-${viewport.name}-menu`, { targets: true });
      // Run now: what happened, in words, above the list, where the focus goes.
      await page.evaluate(click(itemOf(rowOf("local/daily-review")), "Run now"));
      const ran = await said(result);
      check(ran === "local/daily-review: Agent launched Dismiss", `${at} Run now says "Agent launched", by the schedule's id`, ran);
      await page.shot(`automations-${viewport.name}-run-launched`, { targets: true });
      await page.evaluate(click(testId("oats-automations-result-dismiss")));
      // The switch: bare, as bb's own; its name says what it is, a press asks the kernel.
      const toggleOf = `${rowOf("local/weekly-cleanup")} [role="switch"]`;
      const toggle = [await page.evaluate(`document.querySelector(${JSON.stringify(toggleOf)})?.getAttribute("aria-checked") ?? ""`), await read(page, toggleOf), await page.evaluate(`document.querySelector(${JSON.stringify(toggleOf)})?.getAttribute("aria-label") ?? ""`)].join(" | ");
      check(toggle === `false |  | local/weekly-cleanup enabled on ${MACHINE}`, `${at} a row that is off has its switch off; the switch is drawn alone and named for what it turns`, toggle);
      await page.evaluate(reach(rowOf("local/weekly-cleanup")));
      await page.evaluate(click(toggleOf));
      const pressed = await page.until(`(() => document.querySelector(${JSON.stringify(toggleOf)})?.disabled === false && document.querySelector(${JSON.stringify(result)}) === null && document.querySelector(${JSON.stringify(testId("oats-automations-doing"))}) === null ? "settled" : "")()`, 30);
      check(pressed === "settled", `${at} a press of the switch is taken by the kernel without a refusal`, String(pressed));
      // Test, from the page's own menu: it starts nothing, and says so.
      await open(page, "/schedules/local/daily-review", testId("oats-automation-detail"));
      await openMenu(`${testId("oats-automation-detail-menu")} button`, testId("oats-automation-detail-menu"));
      await page.evaluate(click(itemOf(testId("oats-automation-detail-menu")), "Test"));
      const tested = await said(testId("oats-automation-test"));
      check(/^Test result Test passed\. It would start\./.test(tested ?? ""), `${at} a test says "Test passed. It would start.": it started nothing`, String(tested));
      await shotOf(page, testId("oats-automation-test"), `automations-${viewport.name}-test-passed`);
      // Delete…: asks first; Cancel deletes nothing.
      await openMenu(`${testId("oats-automation-detail-menu")} button`, testId("oats-automation-detail-menu"));
      await page.evaluate(click(itemOf(testId("oats-automation-detail-menu")), "Delete…"));
      const asks = await said(dialog, 15);
      check(/daily-review/.test(asks ?? "") && /removed from/.test(asks ?? ""), `${at} Delete… asks first, naming the schedule and the machine`, String(asks).slice(0, 200));
      await page.shot(`automations-${viewport.name}-delete-asks`, { targets: true });
      await page.evaluate(click(testId("oats-confirm-cancel")));
    },
  },
  {
    stage: "automations-busy",
    name: "Automations: the busy list beside bb's own type",
    run: async ({ page, at, viewport, check }) => {
      await open(page, "", ROW);
      const n = await settle(page, count(ROW), 37);
      check(n === 37, `${at} the busy list holds 37 automations`, String(n));
      // What needs a person first, then the five failing.
      const states = await settle(page, `[...document.querySelectorAll(${JSON.stringify(ROW)})].slice(0, 7).map((e) => e.dataset.state)`, ["needs", "failing", "failing", "failing", "failing", "failing", "calm"]);
      check(JSON.stringify(states) === JSON.stringify(["needs", "failing", "failing", "failing", "failing", "failing", "calm"]), `${at} the automation whose agent asks comes first, then the five failing, then the rest`, JSON.stringify(states));
      const pills = await settle(page, texts(PILLS), ["All 37", "Schedules 26", "Triggers 11", "Needs you 1", "Failing 5"]);
      check(JSON.stringify(pills) === JSON.stringify(["All 37", "Schedules 26", "Triggers 11", "Needs you 1", "Failing 5"]), `${at} the filter's five counts`, JSON.stringify(pills));
      // The one rule, three places: the rows drawn as failing, the filter's count, the sidebar's marks.
      const red = await page.evaluate(`document.querySelectorAll(${JSON.stringify(`${ROW}[data-failing="true"]`)}).length`);
      check(red === 5, `${at} five rows are drawn as failing: the filter's own count`, String(red));
      if (!viewport.mobile) {
        const marks = await settle(page, MARKS, ["Automations, needs you", "Automations, a failure"]);
        check(JSON.stringify(marks) === JSON.stringify(["Automations, needs you", "Automations, a failure"]), `${at} the sidebar's link carries both marks: amber, then red`, JSON.stringify(marks));
      }
      // No count of the filter is cut, and no name: a name of sixty characters is whole.
      const inside = await page.evaluate(allInside(PILLS));
      check(inside === true, `${at} every pill of the filter, with its count, is whole on screen`);
      const cut = await page.evaluate(cutNames);
      const sixty = await page.evaluate(`[...document.querySelectorAll(${JSON.stringify(testId("oats-automation-name"))})].every((e) => e.innerText.length === 60)`);
      check(cut.length === 0 && sixty === true, `${at} every name is sixty characters and none is cut`, JSON.stringify(cut.slice(0, 3)));
      // "Answer" is there for the one that asks, and on screen.
      const answer = await page.evaluate(inView(`${ROW}[data-state="needs"] ${testId("oats-automation-answer")}:not([hidden])`));
      const answers = await page.evaluate(`[...document.querySelectorAll(${JSON.stringify(`${ROW}[data-state="needs"] ${testId("oats-automation-answer")}`)})].filter((e) => e.getClientRects().length > 0).length`);
      check(answers === 1, `${at} the automation that asks has one "Answer" drawn`, `${answers} ${answer}`);
      // The card scrolls alone: with its last row brought into view, the tabs, the search and the filter are where they were.
      const head = `JSON.stringify([${JSON.stringify(testId("oats-tabs"))}, ${JSON.stringify(testId("oats-search"))}, ${JSON.stringify(testId("oats-filter"))}].map((s) => Math.round(document.querySelector(s).getBoundingClientRect().top)))`;
      const before = await page.evaluate(head);
      await page.evaluate(`(() => { const card = document.querySelector(${JSON.stringify(testId("oats-automations-rows"))}); card.scrollTop = card.scrollHeight; return true; })()`);
      const after = await page.evaluate(head);
      const scrolled = await page.evaluate(`document.querySelector(${JSON.stringify(testId("oats-automations-rows"))}).scrollTop > 0`);
      check(before === after && scrolled === true, `${at} the card of rows scrolls alone: the tabs, the search and the filter stay`, `${before} ${after} ${scrolled}`);
      await page.evaluate(`(() => { document.querySelector(${JSON.stringify(testId("oats-automations-rows"))}).scrollTop = 0; return true; })()`);
      const ours = { name: await page.evaluate(typeOf(`${ROW}[data-state="calm"] ${testId("oats-automation-name")}`)), small: await page.evaluate(typeOf(`${ROW}[data-state="calm"] ${testId("oats-automation-line")}`)) };
      await page.shot(`automations-${viewport.name}-busy-list`, { targets: true });

      // bb's OWN Automations page, in the same window: its row's name and its small line. Ours has the same size and weight, or this fails.
      await page.goto("/plugins/automations/automations");
      const theirs = await page.until(`(() => { const row = document.querySelector("[data-resource-row]"); if (!row) return ""; const type = (e) => { const s = getComputedStyle(e); return s.fontSize + " " + s.fontWeight; }; const name = row.querySelector("button span span"); const small = row.querySelector("button + span"); return name && small ? JSON.stringify({ name: type(name), small: type(small) }) : ""; })()`, 30);
      check(theirs === JSON.stringify(ours), `${at} the row's name and small line have bb's own size and weight (bb's Automations page, read now)`, `ours ${JSON.stringify(ours)} bb's ${theirs}`);
      await page.shot(`automations-${viewport.name}-bb-own-list`, { plugin: false });
    },
  },
  {
    stage: "automations-busy",
    name: "Automations: both marks, on the sidebar's row and on the home's tile",
    run: async ({ page, at, viewport, check }) => {
      // On the home the sidebar's Automations row is NOT the selected one: the amber and the red dot on a plain row (the list's own scene
      // reads them on the selected row), and on the home's tile. The contrast pass of the image reads each dot at 3:1.
      await page.goto("/plugins/oats/home");
      const tile = `[...document.querySelectorAll(${JSON.stringify(`${testId("oats-tile-automations")} ${testId("oats-mark")}`)})].map((e) => [e.getAttribute("aria-label"), e.dataset.tone ?? "failure"].join(": "))`;
      const onTile = await settle(page, tile, ["Automations, needs you: warning", "Automations, a failure: failure"], 30);
      check(JSON.stringify(onTile) === JSON.stringify(["Automations, needs you: warning", "Automations, a failure: failure"]), `${at} the home's Automations tile carries both marks: amber, then red`, JSON.stringify(onTile));
      if (!viewport.mobile) {
        const row = await settle(page, `[${MARKS}, document.querySelector(${JSON.stringify(testId("oats-page-link-automations"))})?.getAttribute("aria-current")]`, [["Automations, needs you", "Automations, a failure"], null]);
        check(JSON.stringify(row) === JSON.stringify([["Automations, needs you", "Automations, a failure"], null]), `${at} and so does the sidebar's row, which is not the selected one here`, JSON.stringify(row));
      }
      await shotOf(page, testId("oats-tile-automations"), `automations-${viewport.name}-busy-marks-home`);
    },
  },
  {
    stage: "automations-busy",
    name: "Automations: a busy automation's page and the busy Runs tab",
    run: async ({ page, at, viewport, check, threads }) => {
      // The one whose agent asks: a long instruction, fifty runs.
      await open(page, `/schedules/${BUSY.ids.long}`, RUN);
      const bounded = await page.evaluate(`[document.querySelector(${JSON.stringify(testId("oats-automation-prose"))})?.dataset.bounded, ${textOf(testId("oats-automation-prose-more"))}].join(" ")`);
      check(bounded === "true Show more", `${at} a long instruction is drawn to its bound, with "Show more"`, bounded);
      const ten = await settle(page, count(RUN), 10);
      const older = await read(page, testId("oats-runs-older"));
      check(ten === 10 && older === "Older", `${at} fifty runs are ten, then "Older"`, `${ten} ${older}`);
      // Its newest run's agent asks: "Needs you", Answer, and the whole row opens its chat.
      const asks = await settle(page, `[document.querySelector(${JSON.stringify(RUN)})?.dataset.outcome, ${textOf(`${RUN} ${testId("oats-run-said")}`)}, ${textOf(`${RUN} ${testId("oats-run-answer")}`)}].join(" | ")`, "asks | Needs you | Answer");
      check(asks === "asks | Needs you | Answer", `${at} a run whose agent asks says "Needs you", with Answer`, String(asks));
      // The second run's agent is stopped: Start… in its menu. The third runs: a chevron, no menu.
      const second = `${RUN}:nth-of-type(2)`;
      const third = `${RUN}:nth-of-type(3)`;
      const shape = await page.evaluate(`[document.querySelector(${JSON.stringify(`${second} ${testId("oats-run-menu")}`)}) !== null, document.querySelector(${JSON.stringify(`${third} ${testId("oats-run-menu")}`)}) !== null, document.querySelector(${JSON.stringify(`${third} ${testId("oats-run-chevron")}`)}) !== null, document.querySelectorAll(${JSON.stringify(testId("oats-run-chevron"))}).length].join(" ")`);
      check(shape === "true false true 3", `${at} a stopped agent's run has a menu, a running one's none; a chevron only on the three runs whose agent is still there`, shape);
      const head = await page.evaluate(lineOf(testId("oats-automation-identity")));
      check(head.at(-1) === "Needs you", `${at} the automation's own line ends in "Needs you"`, JSON.stringify(head));
      await page.shot(`automations-${viewport.name}-busy-page`, { targets: true });
      await shotOf(page, testId("oats-automation-history"), `automations-${viewport.name}-busy-page-runs`);
      await page.evaluate(click(testId("oats-runs-older")));
      const twenty = await settle(page, count(RUN), 20);
      check(twenty === 20, `${at} "Older" adds ten`, String(twenty));
      // The whole row opens the agent's chat: an agent on tmux has no thread, and its own page opens; an agent on bb, its thread.
      await page.evaluate(click(`${third} ${testId("oats-run-row")}`));
      const agentPage = await page.until(`(() => location.pathname.startsWith("/plugins/oats/agent") ? location.pathname : "")()`, 15);
      check(typeof agentPage === "string" && agentPage.includes("kernel-fix-developer"), `${at} the row of a run whose agent runs on tmux opens that agent's own page`, String(agentPage));
      await open(page, `/schedules/${BUSY.ids.long}`, RUN);
      await page.evaluate(click(`${RUN} ${testId("oats-run-row")}`));
      const thread = threads.get("thr_release").id;
      const there = await page.until(`(() => (location.pathname + location.search).includes(${JSON.stringify(thread)}) ? location.pathname : "")()`, 15);
      check(typeof there === "string", `${at} the row of a run whose agent has a bb thread opens that thread: its chat`, `${await page.evaluate("location.pathname + location.search")} (${thread})`);

      // The Runs tab on hundreds: fifty, then Older; filtered by automation and by result.
      await open(page, "/runs", RUN);
      const fifty = await settle(page, count(RUN), 50);
      check(fifty === 50, `${at} the Runs tab shows fifty of hundreds, then "Older"`, String(fifty));
      await page.shot(`automations-${viewport.name}-busy-runs`, { targets: true });
      const options = await page.evaluate(`document.querySelectorAll(${JSON.stringify(`${testId("oats-runs-by-automation")} option`)}).length`);
      check(options > 10, `${at} the runs can be filtered by automation: one choice for each that ran`, String(options));
      await page.evaluate(click(`${testId("oats-automations-runs")} [role="radio"]`, "Failed"));
      const failed = await settle(page, count(RUN), 1);
      check(failed === 1, `${at} "Failed" keeps the failed runs alone`, String(failed));
    },
  },
  {
    stage: "automations-acts-refused",
    name: "Automations: acts the kernel answers with a failure or a refusal",
    run: async ({ page, at, viewport, check }) => {
      const result = testId("oats-automations-result");
      const dialog = `${testId("oats-modal")} [role="dialog"]`;
      const said = (selector, seconds = 30) => page.until(`(() => ${textOf(selector)})()`, seconds);

      // Run now of a bb job without yolo: while it runs the page says so; then Launch failed, with the kernel's code
      await open(page, "/schedules/local/hourly-check", testId("oats-automation-detail-menu"));
      await pageAct(page, "Run now");
      const doing = await said(testId("oats-automations-doing"), 15);
      check(doing === "Running hourly-check…", `${at} while Run now runs the page says so in words`, doing);
      await page.shot(`automations-${viewport.name}-run-running`, { targets: true });
      const failed = await said(result);
      check(/^local\/hourly-check: Launch failed oats-developer-hourly-check-\d+ was not launched: .*E_BACKEND_SANDBOXED_MODE/.test(failed ?? ""), `${at} a launch the provider refused says Launch failed, with the kernel's reason`, failed);
      const tone = await page.evaluate(`document.querySelector(${JSON.stringify(`${result} ${testId("oats-result")}`)})?.getAttribute("data-tone") ?? ""`);
      check(tone === "failed", `${at} and is drawn as a failure`, tone);
      await page.shot(`automations-${viewport.name}-run-failed`, { targets: true });

      // Delete the kernel refuses: the dialog says it was not deleted, with the kernel's message and code
      await open(page, "/schedules/local/weekly-cleanup", testId("oats-automation-detail-menu"));
      await pageAct(page, "Delete…");
      await said(dialog);
      await page.evaluate(click(testId("oats-confirm-act")));
      const refused = await page.until(`(() => { const t = ${textOf(dialog)}; return /was not deleted/.test(t) ? t : ""; })()`, 30);
      check(/weekly-cleanup was not deleted E_SCHEDULE_UNKNOWN: no schedule "weekly-cleanup" in \/abs\/deployment/.test(refused ?? ""), `${at} a delete the kernel refuses says so, with its message and code`, refused);
      await page.shot(`automations-${viewport.name}-delete-refused`, { targets: true });
      await page.evaluate(click(testId("oats-confirm-close")));

      // Test of a schedule another computer runs: not ready here, and why
      await open(page, "/schedules/oats-real/weekly-report", testId("oats-automation-detail-menu"));
      await pageAct(page, "Test");
      const notReady = await said(testId("oats-automation-test"));
      check((notReady ?? "").startsWith("Test result Test failed. ") && (notReady ?? "").includes("report-server"), `${at} a schedule another computer runs fails its test, and says why`, notReady);
      await shotOf(page, testId("oats-automation-test"), `automations-${viewport.name}-test-not-ready`);

      // A one-press test the kernel answers with "this watches a capability's source": nothing ran, and that is said
      await open(page, "/triggers/oats-real/proposal-review", testId("oats-automation-detail-menu"));
      await pageAct(page, "Test");
      const nothing = await said(testId("oats-automation-nothing-ran"));
      check(nothing === "Nothing ran. Testing this trigger runs a capability's source command and needs your confirmation.", `${at} a test that ran nothing says so, without a failure`, nothing);
      await shotOf(page, testId("oats-automation-nothing-ran"), `automations-${viewport.name}-test-nothing-ran`);

      // A confirmed test whose source refuses: the poll failed, the kernel's error, and the source's own words as a quote
      await open(page, "/triggers/oats-real/harvest-review", testId("oats-automation-detail-menu"));
      await pageAct(page, "Test");
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
    stage: "automations-row-gone",
    name: "Automations: acts on a schedule that was removed after the list was read",
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
      await page.evaluate(reach(menuOf(id)));
      await page.evaluate(click(menuOf(id)));
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
      await open(page, `/schedules/${id}`, testId("oats-automation-detail-menu"));
      await pageAct(page, "Test");
      const card = testId("oats-automation-test");
      const refusedTest = (await refusal(card)) ?? (await now(card));
      check(refusedTest === `Test result The test did not run. ${KERNEL} E_SCHEDULE_UNKNOWN`, `${at} a test the kernel refuses says so in its card: that it did not run, the kernel's message, its code after, and no verdict`, refusedTest);
      await shotOf(page, card, `automations-${viewport.name}-test-refused`);
    },
  },
  {
    stage: "automations-busy-held",
    name: "Automations: the busy list under a notice",
    run: async ({ page, at, viewport, check }) => {
      // The worst case under a notice: 37 automations read, then a re-read the kernel refuses. The notice stands over the list;
      // the card of rows keeps a floor, and where the page's height does not hold the head, the notice and that floor, the page scrolls whole.
      await open(page, "", ROW);
      await settle(page, count(ROW), 37);
      await page.until(`(() => document.querySelector(${JSON.stringify(testId("oats-automations-refresh"))})?.disabled === false ? "ready" : "")()`, 40);
      refuseBusy();
      await page.evaluate(click(testId("oats-automations-refresh")));
      const notice = testId("oats-automations-failed");
      const failed = await page.until(`(() => { const t = ${textOf(notice)}; return t !== "" && !t.includes("Refreshing…") && document.querySelector(${JSON.stringify(testId("oats-automations-rereading"))}) === null ? t : ""; })()`, 40);
      check(/^Schedules could not be read/.test(failed ?? "") && (await page.evaluate(count(ROW))) === 37, `${at} the refused re-read is said over the 37 rows that were read`, String(failed).slice(0, 120));
      const card = testId("oats-automations-rows");
      const sizes = JSON.parse(await page.evaluate(`(() => { const page = document.querySelector(${JSON.stringify(testId("oats-automations-page"))}); const card = document.querySelector(${JSON.stringify(card)}); const row = document.querySelector(${JSON.stringify(`${ROW}[data-state="needs"]`)}); return JSON.stringify({ card: Math.round(card.getBoundingClientRect().height), row: Math.round(row.getBoundingClientRect().height), page: page.clientHeight, whole: page.scrollHeight }); })()`));
      // The row that needs a person is the first, and the tallest kind of row there is: the card holds it whole.
      check(sizes.card >= 352 && sizes.card >= sizes.row, `${at} under the notice the card of rows keeps its floor, and holds the row that needs a person whole`, JSON.stringify(sizes));
      // Its "Answer" can be reached: brought into view, it is on screen (the page scrolls whole where it has to).
      const answer = `${ROW}[data-state="needs"] ${testId("oats-automation-answer")}`;
      const reached = await page.evaluate(`(() => { const e = [...document.querySelectorAll(${JSON.stringify(answer)})].find((each) => each.getClientRects().length > 0); if (!e) return "none"; e.scrollIntoView({ block: "center" }); const r = e.getBoundingClientRect(); const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return r.top >= 0 && r.bottom <= innerHeight && top !== null && (e === top || e.contains(top)) ? "reached" : "hidden " + Math.round(r.top) + " " + Math.round(r.bottom); })()`);
      check(reached === "reached", `${at} under the notice the "Answer" of the automation that asks can be brought on screen, with nothing over it`, String(reached));
      await page.shot(`automations-${viewport.name}-busy-held`, { targets: true });
      // And the last of the 37 rows: the card scrolled to its end and brought into view.
      const last = await page.evaluate(`(() => { const card = document.querySelector(${JSON.stringify(card)}); card.scrollTop = card.scrollHeight; const rows = document.querySelectorAll(${JSON.stringify(ROW)}); const e = rows[rows.length - 1]; e.scrollIntoView({ block: "end" }); const r = e.getBoundingClientRect(); return r.bottom <= innerHeight + 0.5 && r.bottom > 0; })()`);
      check(last === true, `${at} under the notice the last of the 37 rows can be brought on screen`);
      await page.shot(`automations-${viewport.name}-busy-held-end`, { targets: true });
      // The stage is entered once for every window: the lists answer again before the next one reads them.
      readBusy();
      await page.evaluate(click(testId("oats-automations-refresh")));
      await page.until(`(() => document.querySelector(${JSON.stringify(notice)}) === null ? "gone" : "")()`, 40);
    },
  },
  {
    stage: "automations-slow",
    name: "Automations: reading, reading again, and a re-read that fails over the list still shown",
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
      check(reading === "Reading automations…", `${at} while the lists are read the page says "Reading automations…"`, String(reading));
      await page.shot(`automations-${viewport.name}-loading`, { targets: true });
      await page.until(visible(ROW), 60);

      // Refresh: the list stays, and the page says it is reading again
      await page.evaluate(click(testId("oats-automations-refresh")));
      // Waited for: the line of THIS re-read ("Refreshing…"), not any line about the list's age (one stands there by itself once the list is 30 s old).
      const stale = `${testId("oats-automations-page")} ${testId("oats-stale")}`;
      const again = (await page.until(`(() => { const t = ${textOf(stale)}; return t.startsWith("Refreshing…") ? t : ""; })()`, 15)) ?? (await page.evaluate(textOf(stale)));
      check(/^Refreshing… read .+\.$/.test(again ?? "") && (await page.evaluate(count(ROW))) === 18, `${at} while it reads again the page says so and keeps its 18 rows`, String(again));
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
      check(/^Schedules could not be read What is below is the last list that was read\. Held until the list can be read again: what each row is now is not known\. Read .+\. E_SCHEDULE_INVALID ▸ Details Retry$/.test(failed ?? "") && (await page.evaluate(count(ROW))) === 18, `${at} a re-read the kernel refuses is said over the list still shown, with how old that is`, String(failed));
      const heldSwitch = await page.until(`(() => { const s = document.querySelector(${JSON.stringify(`${ROW}[data-id="local/daily-review"] [role="switch"]`)}); return s && s.disabled ? s.title : ""; })()`, 15);
      check(heldSwitch === "Comes back when OATS is read again", `${at} over a list that could not be read again a row's switch is held, with the reason every held OATS act carries`, String(heldSwitch));
      await page.shot(`automations-${viewport.name}-failed-over-list`, { targets: true });
      slow();
    },
  },
  {
    stage: "automations-host-unnamed",
    name: "Automations: a host with no name",
    run: async ({ page, at, viewport, check }) => {
      const notice = await open(page, "", testId("oats-automations-host-unnamed"));
      check(notice === `${MACHINE} has no host name in OATS ▸ Details`, `${at} a machine with no host name says so in one line`, String(notice));
      const how = await opened(page, testId("oats-automations-host-unnamed"), "oats-local.yaml");
      check(/set host: name: to the name it goes by in the workspace/.test(how), `${at} where the key is, is one press away, under the notice's Details`, how);
      await page.shot(`automations-${viewport.name}-host-unnamed`, { targets: true });
    },
  },
  {
    stage: "automations-scheduler-off",
    name: "Automations: no host scheduler",
    run: async ({ page, at, viewport, check }) => {
      const dialog = `${testId("oats-modal")} [role="dialog"]`;
      const notice = await open(page, "", testId("oats-automations-scheduler-off"));
      check(notice === `The scheduler is off on ${MACHINE} Enable scheduler`, `${at} a scheduler that is off is one line, with Enable scheduler`, String(notice));
      await page.shot(`automations-${viewport.name}-scheduler-off`, { targets: true });
      // Enable scheduler asks first; on a computer with no service manager the kernel's refusal is said, and nothing claims it was enabled.
      await page.evaluate(click(testId("oats-automations-enable-scheduler")));
      const asks = await page.until(`(() => ${textOf(dialog)})()`, 15);
      check(new RegExp(`installs its scheduler's timer on ${MACHINE}`).test(asks ?? ""), `${at} Enable scheduler says what it installs, and where, before it does`, String(asks).slice(0, 200));
      await page.evaluate(click(testId("oats-confirm-act")));
      const refused = await page.until(`(() => { const t = ${textOf(dialog)}; return /may not have been enabled|was not enabled/.test(t) ? t : ""; })()`, 30);
      check(/E_SCHEDULE_HOST/.test(refused ?? ""), `${at} the kernel's refusal is said with its code`, String(refused).slice(0, 200));
      await page.shot(`automations-${viewport.name}-enable-scheduler-refused`, { targets: true });
      await page.evaluate(click(testId("oats-confirm-close")));
    },
  },
  {
    stage: "automations-scheduler-enabled",
    name: "Automations: Enable scheduler on a computer that takes the timer",
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
    stage: "automations-empty",
    name: "Automations: no schedule and no trigger yet",
    run: async ({ page, at, viewport, check }) => {
      const empty = await open(page, "", testId("oats-automations-empty"));
      check(empty === "No automations", `${at} with nothing yet the page says so in two words`, String(empty));
      await page.shot(`automations-${viewport.name}-empty`, { targets: true });
      await open(page, "/runs", testId("oats-runs-empty"));
      const runs = await read(page, testId("oats-runs-empty"));
      check(runs === "No runs", `${at} and its Runs tab says "No runs"`, runs);
    },
  },
  {
    stage: "automations-failed",
    name: "Automations: a list the kernel refuses",
    run: async ({ page, at, viewport, check }) => {
      const failed = await open(page, "", testId("oats-automations-failed"));
      check(/^Schedules could not be read Nothing can be shown of this deployment's schedules until they are read\. E_SCHEDULE_INVALID ▸ Details Retry$/.test(failed ?? ""), `${at} a list the kernel refuses says so in a person's words, its code after, with Retry`, String(failed));
      const n = await settle(page, count(ROW), 7);
      check(n === 7, `${at} and the other list's rows stand: the seven triggers`, String(n));
      await page.shot(`automations-${viewport.name}-failed`, { targets: true });
    },
  },
  {
    stage: "automations-poll-failed",
    name: "Automations: a trigger whose last poll failed",
    run: async ({ page, at, viewport, check }) => {
      await open(page, "", ROW);
      const line = await settle(page, `${lineOf(rowOf("local/graph-watch"))}.at(-1)`, "Poll failed");
      check(line === "Poll failed", `${at} a trigger whose last poll failed ends its line in "Poll failed"`, String(line));
      await open(page, "/triggers/local/graph-watch", testId("oats-automation-last-poll"));
      const notice = await read(page, testId("oats-automation-last-poll"));
      check(/^The last poll failed .*the source refused\./.test(notice), `${at} its page says when the poll failed and why, in words`, notice.slice(0, 200));
      await shotOf(page, testId("oats-automation-last-poll"), `automations-${viewport.name}-poll-failed`);
    },
  },
  {
    stage: "automations-status-failed",
    name: "Automations: a trigger whose state cannot be read",
    run: async ({ page, at, viewport, check }) => {
      const notice = await open(page, "/triggers/oats-real/proposal-review", testId("oats-automation-status-failed"));
      check(/^This trigger's state could not be read E_TRIGGER_UNKNOWN ▸ Details Retry$/.test(notice ?? ""), `${at} a trigger's state that cannot be read says so, with the kernel's code and Retry`, String(notice));
      const none = await page.evaluate(`[document.querySelector(${JSON.stringify(testId("oats-runs-empty"))}) === null, document.querySelectorAll(${JSON.stringify(RUN)}).length].join(" ")`);
      check(none === "true 0", `${at} and nothing is said of its runs: not that there are none`, none);
      await page.shot(`automations-${viewport.name}-status-failed`, { targets: true });
      // Every trigger's state is refused with it (the same verb), while the lists stand: the list says so, and so does the Runs tab.
      const over = await open(page, "", testId("oats-automations-state-failed"));
      const rows = await page.evaluate(count(ROW));
      check(/^Triggers' state could not be read Nothing can be shown of what the triggers fired, or of what failed, until it is read\. E_TRIGGER_UNKNOWN ▸ Details Retry$/.test(over ?? "") && rows === 18, `${at} every trigger's state refused while the lists stand is said over the list, which keeps its 18 rows`, `${rows} ${String(over)}`);
      await page.shot(`automations-${viewport.name}-state-failed-list`, { targets: true });
      const tab = await open(page, "/runs", testId("oats-automations-state-failed"));
      check(/^Triggers' state could not be read/.test(tab ?? ""), `${at} and over the Runs tab, whose table is then the schedules' runs alone`, String(tab).slice(0, 80));
      await page.shot(`automations-${viewport.name}-state-failed-runs`, { targets: true });
    },
  },
  {
    stage: "automations-old-oats",
    name: "Automations: an OATS without the automations lists",
    run: async ({ page, at, viewport, check }) => {
      const gate = await open(page, "", testId("oats-automations-gate"));
      check(/^Automations need OATS 0\.29 or later /.test(gate ?? ""), `${at} an OATS from before the lists says what it needs, in place of the list`, String(gate));
      await page.shot(`automations-${viewport.name}-old-oats`, { targets: true });
    },
  },
  {
    stage: "no-oats",
    name: "Automations: without oats",
    run: async ({ page, at, viewport, check }) => {
      const gate = await open(page, "", testId("oats-automations-gate"));
      // (The plugin's one notice since the text cut: its title, Details, the acts; what to do and the code are one press away.)
      const under = await page.evaluate(`(document.querySelector(${JSON.stringify(`${testId("oats-automations-gate")} ${testId("oats-notice-details")}`)})?.textContent ?? "")`);
      check(gate === `OATS is not installed on ${MACHINE} ▸ Details Retry Open settings` && /Install OATS there, or set the path to oats in the plugin's settings\..*OATS_NOT_FOUND/.test(under), `${at} with oats gone the page shows the plugin's one notice for it, naming the machine`, `${gate} | ${under}`);
      await page.shot(`automations-${viewport.name}-no-oats`, { targets: true });
    },
  },
];

/**
 * By hand only (LIVE_KEEP_GOING=1), for a run against a build that is broken on purpose (the mutation pass of these
 * checks): a scene that throws is one failed check and the run goes on, so that every other check still says what it
 * sees. In the gate a scene that throws stops the run, as ever.
 */
const keptGoing = (scene) =>
  process.env.LIVE_KEEP_GOING !== "1"
    ? scene
    : {
        ...scene,
        run: async (context) => {
          try {
            await scene.run(context);
          } catch (error) {
            context.check(false, `${context.at} the scene "${scene.name}" ran to its end`, String(error?.message ?? error).slice(0, 300));
          }
        },
      };

export default scenes.map(keptGoing).map(iconsChecked).map(atTheRecording);

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
// What the "automations-busy-held" stage's scene does once the busy lists are read: the schedules refused.
let refuseBusy = () => undefined;
let readBusy = () => undefined;

/** bb's own automations, for the busy list's check of our type against bb's page: one is enough to draw bb's row. Made once; bb keeps it. */
function bbAutomation() {
  const bb = (...args) => execFileSync("bb", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  const projects = JSON.parse(bb("project", "list", "--json"));
  const project = (Array.isArray(projects) ? projects : (projects.projects ?? projects.items))[0];
  const listed = JSON.parse(bb("automation", "list", "--project", project.id, "--json"));
  if ((Array.isArray(listed) ? listed : (listed.automations ?? listed.items ?? [])).length > 0) return;
  bb("automation", "create", "--project", project.id, "--name", BUSY.ids.names[0], "--cron", "0 9 * * 1-5", "--timezone", "Europe/Madrid", "--prompt", "Read the support inbox.", "--provider", "claude-code", "--model", "claude-opus-5-5", "--json");
}

export const stages = {
  // The busy set: 37 automations, five failing, fifty-run histories, names of sixty characters; the newest runs of its long schedule made by three of the roster's agents (one asks, one is stopped, one runs).
  "automations-busy": {
    label: "AU12",
    enter: async ({ fake, statusWithRealIds, threads, untilSnapshot }) => {
      bbAutomation();
      fake({ status: { stdout: statusWithRealIds(threads) }, "schedule list": { stdout: BUSY.schedules }, "trigger list": { stdout: BUSY.triggers }, "trigger status": { stdout: BUSY.status } });
      await settled(untilSnapshot);
    },
  },
  // The busy set once more, for the scene that has the kernel refuse a re-read over it.
  "automations-busy-held": {
    label: "AU13",
    enter: async ({ fake, statusWithRealIds, threads, untilSnapshot }) => {
      const busyLists = { status: { stdout: statusWithRealIds(threads) }, "trigger list": { stdout: BUSY.triggers }, "trigger status": { stdout: BUSY.status } };
      refuseBusy = () => fake({ ...busyLists, "schedule list": { stdout: REFUSAL } });
      readBusy = () => fake({ ...busyLists, "schedule list": { stdout: BUSY.schedules } });
      readBusy();
      await settled(untilSnapshot);
    },
  },
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
