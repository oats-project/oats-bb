// Spawn's live scenes: the New agent form, a page of its own (`/plugins/oats/new-agent`). Each
// state of it once, in both themes at both widths: empty, filled with what will be created read,
// the preview while it is read, a name the form refuses and one the kernel refuses, a relation, a
// refused spawn, the held state while OATS cannot be read, and the way in under the release's
// default pages. The refusals are the real kernel's, recorded by the real run
// (test/fixtures/spawn/README.md).
import { fill, FOCUSED, showSidebar, testId, textOf, visible } from "../browser.mjs";

const FORM = "/plugins/oats/new-agent";
const q = (id) => JSON.stringify(testId(id));
/**
 * Picks the option `value` of one of the form's choices (app/spawn/Choice.tsx; `id` is its test
 * id) as a person does: a press on the field opens its list, a press on the option chooses it.
 * → whether the field then holds the value.
 */
export const choose = (id, value) =>
  `(async () => { const field = document.querySelector(${q(id)}); if (!field || field.disabled) return false; if (field.getAttribute("aria-expanded") !== "true") field.click(); let option; for (let i = 0; i < 40 && !option; i += 1) { await new Promise((done) => setTimeout(done, 50)); option = [...document.querySelectorAll(${q(`${id}-option`)})].find((e) => e.getAttribute("data-value") === ${JSON.stringify(value)}); } if (!option) return false; option.click(); await new Promise((done) => setTimeout(done, 50)); return document.querySelector(${q(id)}).getAttribute("data-value") === ${JSON.stringify(value)}; })()`;
const click = (selector) => `(() => { const e = document.querySelector(${JSON.stringify(selector)}); if (!e) return false; e.click(); return true; })()`;
/** The souls are read: the soul field lists them. */
const SOULS_READ = `document.querySelector(${q("oats-spawn-soul")})?.disabled === false`;
/** The form's first control. */
const FIRST = `document.querySelector(${q("oats-spawn-form")}).querySelector("button, select, textarea, input").getAttribute("data-testid")`;
/** What will be created is read for the values on screen: the facts are drawn, none being read again, and Spawn can be pressed. → the column's text. */
const READ = `(() => { const c = document.querySelector(${q("oats-spawn-preview")}); return c?.querySelector('[data-testid="oats-fact"]') && !c.querySelector(${q("oats-spawn-updating")}) && document.querySelector(${q("oats-spawn-submit")})?.disabled === false ? c.innerText.replace(/\\s+/g, " ").trim() : ""; })()`;
const reasonOf = textOf(testId("oats-disabled-reason"));
const fieldError = `(document.querySelector(${q("oats-spawn-form")})?.querySelector('[role="alert"]')?.innerText ?? "").replace(/\\s+/g, " ").trim()`;
/** Nothing of the form is wider than its page: no sideways scroll at any width. */
const FITS = `(() => { const p = document.querySelector(${q("oats-new-agent-page")}); return p ? p.scrollWidth <= p.clientWidth + 1 : false; })()`;
const show = (id) => `document.querySelector(${q(id)})?.scrollIntoView({ block: "center" })`;

async function open(page, soul = "") {
  await page.goto(soul === "" ? FORM : `${FORM}/${soul}`);
  return Boolean(await page.until(`${visible(testId("oats-spawn-form"))} && ${SOULS_READ}`, 30));
}
const whole = (page) => page.evaluate(textOf(testId("oats-new-agent-page")));

export default [
  // A soul's page keeps the earlier form (a name, a task, Preview) until the workspace's pages are rebuilt.
  {
    stage: "fixtures",
    name: "the New agent form: the mode, a name it refuses, a name and a task and their preview",
    run: async ({ page, at, viewport, check }) => {
      await page.goto("/plugins/oats/souls/oats-developer");
      await page.until(visible(testId("oats-spawn-form")), 30);
      // the one line that says which mode a spawn asks for (text, no control); its contrast is checked at the screenshots below
      check((await page.evaluate(textOf(testId("oats-spawn-mode")))) === "Runs in bb's full mode: no sandbox." && (await page.evaluate(visible(testId("oats-spawn-mode")))), `${at} the New agent form says it runs in bb's full mode, with no sandbox`, await page.evaluate(textOf(testId("oats-soul-detail"))));
      // the spawn form: a name it refuses, then a name and a task it takes, and the preview
      await page.evaluate(fill(testId("oats-spawn-name"), "Bad Name"));
      const refused = await page.until(`(() => { const t = ${textOf(testId("oats-spawn-form"))}; return /Lower-case letters, digits and dashes/.test(t) ? t : ""; })()`, 10);
      check(Boolean(refused), `${at} the form says why it refuses a name`, await page.evaluate(textOf(testId("oats-spawn-form"))));
      await page.shot(`a13-${viewport.name}-soul-refused`);
      await page.evaluate(fill(testId("oats-spawn-name"), "ranker-v4-probe"));
      await page.evaluate(fill(testId("oats-spawn-task"), "Try depth 7."));
      check(Boolean(await page.until(`document.querySelector(${JSON.stringify(testId("oats-spawn-preview"))})?.disabled === false`, 10)), `${at} a name and a task enable Preview`);
      await page.evaluate(`document.querySelector(${JSON.stringify(testId("oats-spawn-preview"))}).click()`);
      check(Boolean(await page.until(`document.querySelector(${JSON.stringify(testId("oats-spawn-submit"))})?.disabled === false && ${visible(testId("oats-preview"))}`, 30)), `${at} Preview shows what OATS would do, and enables the spawn`, await page.evaluate(textOf(testId("oats-spawn-form"))));
      await page.evaluate(`document.querySelector(${JSON.stringify(testId("oats-spawn-submit"))}).scrollIntoView({ block: "center" })`);
      await page.shot(`a13-${viewport.name}-soul-form`);
    },
  },
  {
    stage: "fixtures",
    name: "the New agent form, empty: the soul first and in focus, nothing read, Spawn off with its reason",
    run: async ({ page, at, viewport, check }) => {
      check(await open(page), `${at} /plugins/oats/new-agent is the form, with the souls OATS lists`, await whole(page));
      const first = await page.evaluate(`JSON.stringify({ title: ${textOf(testId("oats-spawn-title"))}, first: ${FIRST}, labels: [...document.querySelector(${q("oats-spawn-form")}).querySelectorAll("label, #oats-spawn-relation-label")].map((e) => e.innerText.trim()), spawn: document.querySelector(${q("oats-spawn-submit")}).disabled, reason: ${reasonOf}, column: ${textOf(testId("oats-spawn-preview"))}, mode: ${textOf(testId("oats-spawn-mode"))} })`);
      check(
        first === JSON.stringify({ title: "New agent", first: "oats-spawn-soul", labels: ["Soul", "Opening instruction · optional", "Harness", "Model", "Relationship", "Name · optional"], spawn: true, reason: "Choose a soul first.", column: "WHAT WILL BE CREATED Choose a soul to see what will be created.", mode: "Runs in bb's full mode: no sandbox." }),
        `${at} the empty form: titled New agent, the soul first, the Desktop's fields in its order, Spawn off and saying why, the one line about bb's full mode`,
        first,
      );
      check((await page.until(`${FOCUSED} === "oats-spawn-soul"`, 10)) === true, `${at} the focus starts on the first field, the soul`, await page.evaluate(FOCUSED));
      check(await page.evaluate(FITS), `${at} nothing of the form is wider than the page`);
      await page.shot(`spawn-${viewport.name}-empty`, { targets: true });
    },
  },
  {
    stage: "fixtures",
    name: "the New agent form, filled: what will be created read from the kernel's preview; the focus order; a choice open",
    run: async ({ page, at, viewport, check }) => {
      check(await open(page, "oats-developer"), `${at} /plugins/oats/new-agent/oats-developer is the form with that soul chosen`, await whole(page));
      const landed = await page.until(`${FOCUSED} === "oats-spawn-task" && JSON.stringify({ title: ${textOf(testId("oats-spawn-title"))}, soul: document.querySelector(${q("oats-spawn-soul")}).getAttribute("data-value") })`, 10);
      check(landed === JSON.stringify({ title: "Spawn oats-developer in oats", soul: "oats-developer" }), `${at} opened with a soul: named as the Desktop names its dialog, the soul chosen, the focus on the instruction`, landed ?? (await page.evaluate(FOCUSED)));
      await page.evaluate(fill(testId("oats-spawn-task"), "Try depth 7 on the ranker and report the win rate."));
      await page.evaluate(fill(testId("oats-spawn-name"), "ranker-v4-probe"));
      const read = await page.until(`(() => { const t = ${READ}; return t.includes("Name ranker-v4-probe") ? t : ""; })()`, 30);
      check(
        Boolean(read) && /^WHAT WILL BE CREATED Name ranker-v4-probe Home .+ Works in .+ Harness .+ Team .+ CORE CAPABILITIES Knowledge .+ Messaging .+ Tasks .+ CAPABILITIES \d+ .+ Resolved by the installed CLI\. Spawn refuses if this changes before you confirm\.$/.test(read ?? ""),
        `${at} What will be created: the name and the home, where it works, the harness and the model, the team, the capabilities, in a person's words`,
        read ?? (await whole(page)),
      );
      const hint = await page.evaluate(`document.querySelector(${q("oats-spawn-form")}).innerText.includes("Instance name: ranker-v4-probe") && ${reasonOf} === "" && document.querySelector(${q("oats-spawn-submit")}).innerText.trim()`);
      check(hint === "Spawn", `${at} the name's line says the resulting name; the button is named for the act and can be pressed, with no reason beside it`, String(hint));
      // The focus order, by Tab from the first field.
      await page.evaluate(`document.querySelector(${q("oats-spawn-soul")}).focus()`);
      const order = [await page.evaluate(FOCUSED)];
      for (let i = 0; i < 7; i += 1) {
        await page.press("Tab");
        order.push(await page.evaluate(FOCUSED));
      }
      check(JSON.stringify(order) === JSON.stringify(["oats-spawn-soul", "oats-spawn-task", "oats-spawn-harness", "oats-spawn-model", "Independent", "oats-spawn-name", "oats-spawn-cancel", "oats-spawn-submit"]), `${at} Tab walks the form in its order: the soul, the instruction, the harness, the model, the relationship, the name, Cancel, Spawn`, JSON.stringify(order));
      // A choice open: the souls OATS lists, each with its description; Escape closes it, and the focus is back on the field.
      await page.evaluate(click(testId("oats-spawn-soul")));
      const souls = await page.until(`document.querySelector(${q("oats-spawn-soul-options")}) && JSON.stringify({ role: document.querySelector(${q("oats-spawn-soul-options")}).getAttribute("role"), options: [...document.querySelectorAll(${q("oats-spawn-soul-option")})].map((e) => [...e.querySelectorAll("span")].map((part) => part.innerText.trim())), chosen: document.querySelector(${q("oats-spawn-soul-option")} + '[aria-selected="true"]')?.getAttribute("data-value") })`, 10);
      const listed = JSON.parse(souls ?? "{}");
      check(listed.role === "listbox" && listed.chosen === "oats-developer" && listed.options?.length > 1 && listed.options.every((option) => option.length === 2 && option.every((part) => part !== "")), `${at} the soul field opens to the souls OATS lists, each with its description, the chosen one marked`, souls ?? (await whole(page)));
      await page.shot(`spawn-${viewport.name}-souls-open`, { targets: true });
      await page.press("Escape");
      const closed = await page.until(`!document.querySelector(${q("oats-spawn-soul-options")}) && ${FOCUSED}`, 10);
      check(closed === "oats-spawn-soul", `${at} Escape closes the list, and the focus is back on the field`, String(closed));
      check(await page.evaluate(FITS), `${at} nothing of the form is wider than the page`);
      await page.evaluate(show("oats-spawn-task"));
      await page.shot(`spawn-${viewport.name}-filled`, { targets: true });
      await page.evaluate(show("oats-spawn-preview"));
      await page.shot(`spawn-${viewport.name}-created`);
    },
  },
  {
    stage: "fixtures",
    name: "the New agent form: a name the form refuses says its fault; a relation names its instance",
    run: async ({ page, at, viewport, check }) => {
      check(await open(page, "oats-developer"), `${at} the form with a soul chosen`, await whole(page));
      await page.until(READ, 30);
      await page.evaluate(fill(testId("oats-spawn-name"), "Bad Name"));
      const refused = await page.until(`${fieldError} !== "" && JSON.stringify({ error: ${fieldError}, reason: ${reasonOf}, spawn: document.querySelector(${q("oats-spawn-submit")}).disabled, column: ${textOf(testId("oats-spawn-preview"))} })`, 10);
      check(
        refused === JSON.stringify({ error: "A space can’t be in a name. Use letters, digits and dashes.", reason: "The name can’t be used: its field says why.", spawn: true, column: "WHAT WILL BE CREATED Shown once the values above can be used. Resolved by the installed CLI. Spawn refuses if this changes before you confirm." }),
        `${at} a name with a space: the fault under the name, Spawn off with the reason beside it, and no stale facts in the column`,
        refused ?? (await whole(page)),
      );
      await page.evaluate(show("oats-spawn-submit"));
      await page.shot(`spawn-${viewport.name}-name-refused`, { targets: true });
      await page.evaluate(fill(testId("oats-spawn-name"), ""));
      await page.evaluate(`[...document.querySelectorAll(${JSON.stringify(`${testId("oats-spawn-relation")} [role="radio"]`)})].find((e) => e.innerText.trim() === "Child of").click()`);
      const asked = await page.until(`document.querySelector(${q("oats-spawn-relative")}) && JSON.stringify({ name: document.querySelector(${q("oats-spawn-relative")}).getAttribute("aria-label"), line: ${textOf(testId("oats-spawn-relation-line"))}, reason: ${reasonOf} })`, 10);
      check(asked === JSON.stringify({ name: "Child of which instance?", line: "Pick the instance this one is a child of.", reason: "Pick the instance first, or choose Independent." }), `${at} Child of asks which instance, and Spawn waits for it, saying so`, asked ?? (await whole(page)));
      check(await page.evaluate(choose("oats-spawn-relative", "flaky-ci-developer")), `${at} the instance is picked from the roster's agents`, await whole(page));
      const related = await page.until(`(() => { const t = ${READ}; return t ? JSON.stringify({ line: ${textOf(testId("oats-spawn-relation-line"))}, reason: ${reasonOf} }) : ""; })()`, 30);
      check(related === JSON.stringify({ line: "Spawns as a child of Flaky ci developer.", reason: "" }), `${at} with the instance picked the line says whose child it will be, by its name as words, and Spawn is back`, related ?? (await whole(page)));
      check(await page.evaluate(FITS), `${at} nothing of the form is wider than the page`);
      await page.evaluate(show("oats-spawn-relation"));
      await page.shot(`spawn-${viewport.name}-relation`, { targets: true });
    },
  },
  {
    stage: "spawn-slow",
    name: "the New agent form while the kernel works out the preview: Reading defaults…, then what will be created",
    run: async ({ page, at, viewport, check }) => {
      check(await open(page, "oats-developer"), `${at} the form with a soul chosen`, await whole(page));
      const reading = await page.until(`${textOf(testId("oats-spawn-status"))} === "Reading defaults…" && JSON.stringify({ column: ${textOf(testId("oats-spawn-preview"))}, spawn: document.querySelector(${q("oats-spawn-submit")}).disabled })`, 10);
      check(reading === JSON.stringify({ column: "WHAT WILL BE CREATED Reading defaults… Resolved by the installed CLI. Spawn refuses if this changes before you confirm.", spawn: false }), `${at} while the first preview is read the column and the status say Reading defaults…, in the place the facts will be; Spawn can be pressed and waits for it`, reading ?? (await whole(page)));
      await page.shot(`spawn-${viewport.name}-reading`, { targets: true });
      const read = await page.until(READ, 30);
      check(Boolean(read) && (read ?? "").includes("Name numbered by the kernel") && (await page.evaluate(textOf(testId("oats-spawn-status")))) === "", `${at} then what will be created, for a form with no name: the kernel numbers it`, read ?? (await whole(page)));
      await page.shot(`spawn-${viewport.name}-read`);
    },
  },
  {
    stage: "spawn-name-taken",
    name: "the New agent form: a name the kernel refuses at the preview, in a person's words under the name",
    run: async ({ page, at, viewport, check }) => {
      check(await open(page, "oats-developer"), `${at} the form with a soul chosen`, await whole(page));
      await page.evaluate(fill(testId("oats-spawn-name"), "flaky-ci-developer"));
      const said = await page.until(`${fieldError} !== "" && JSON.stringify({ error: ${fieldError}, reason: ${reasonOf}, notice: document.querySelector(${q("oats-spawn-preview")}).querySelector(${q("oats-notice")}) !== null })`, 30);
      check(said === JSON.stringify({ error: "An instance with this name already exists. Choose another name.", reason: "The name can’t be used: its field says why.", notice: false }), `${at} a name that is taken: the Desktop's sentence under the name, once, and Spawn off with its reason`, said ?? (await whole(page)));
      await page.evaluate(show("oats-spawn-submit"));
      await page.shot(`spawn-${viewport.name}-name-taken`, { targets: true });
    },
  },
  {
    stage: "spawn-refused",
    name: "the New agent form: a spawn the kernel refuses leads with a person's words, its code after, Details one press away",
    run: async ({ page, at, viewport, check }) => {
      check(await open(page, "oats-developer"), `${at} the form with a soul chosen`, await whole(page));
      await page.evaluate(fill(testId("oats-spawn-name"), "ranker-v4-probe"));
      await page.until(`(() => { const t = ${READ}; return t.includes("Name ranker-v4-probe") ? t : ""; })()`, 30);
      await page.evaluate(click(testId("oats-spawn-submit")));
      const refused = await page.until(`(() => { const r = document.querySelector(${q("oats-spawn-form")} + " " + ${q("oats-result")}); if (!r) return ""; const d = r.querySelector(${q("oats-spawn-details")}); return JSON.stringify({ role: r.getAttribute("role"), title: r.querySelector("h3").innerText, words: r.querySelector("p").innerText, code: [...r.querySelectorAll(":scope > p")].at(-1).innerText, details: d !== null && !d.open && d.querySelector("summary").innerText === "Details", path: location.pathname }); })()`, 30);
      check(
        refused === JSON.stringify({ role: "alert", title: "The agent was not spawned", words: "Something changed before the spawn went through. Nothing was created — check the updated values and press Spawn again.", code: "E_DECISION_STALE", details: true, path: "/plugins/oats/new-agent/oats-developer" }),
        `${at} a refused spawn: what happened and what to do in a person's words, then the kernel's code, its own message under Details, and the form still there`,
        refused ?? (await whole(page)),
      );
      const again = await page.until(`(() => { const t = ${READ}; return t && document.querySelector(${q("oats-spawn-submit")}).innerText.trim() === "Spawn" ? t : ""; })()`, 30);
      check(Boolean(again), `${at} what will be created is read again, and Spawn can be pressed again`, again ?? (await whole(page)));
      await page.evaluate(show("oats-result"));
      await page.shot(`spawn-${viewport.name}-refused`, { targets: true });
      await page.evaluate(click(`${testId("oats-spawn-details")} summary`));
      const details = await page.until(`document.querySelector(${q("oats-spawn-details")})?.open && ${textOf(`${testId("oats-spawn-details")} p`)}`, 10);
      check(Boolean(details), `${at} Details opens to the kernel's own message`, String(details));
      await page.shot(`spawn-${viewport.name}-refused-details`);
    },
  },
  {
    stage: "no-oats",
    name: "the New agent form while OATS cannot be read: held like the acts, under the roster's own notice",
    run: async ({ page, at, viewport, check }) => {
      await page.goto(`${FORM}/oats-developer`);
      const held = await page.until(`(() => { const n = document.querySelector(${q("oats-new-agent-page")} + " " + ${q("oats-unreadable")}); const f = document.querySelector(${q("oats-spawn-form")} + " fieldset"); return n && f ? JSON.stringify({ title: n.querySelector("h3").innerText, held: document.querySelectorAll(${q("oats-new-agent-page")} + " " + ${q("oats-held")}).length, notices: document.querySelectorAll(${q("oats-new-agent-page")} + " " + ${q("oats-notice")}).length, fields: f.disabled, spawn: document.querySelector(${q("oats-spawn-submit")}).disabled, reason: ${reasonOf} }) : ""; })()`, 30);
      check(/^\{"title":"OATS is not installed on [^"]+","held":1,"notices":1,"fields":true,"spawn":true,"reason":"Comes back when OATS is read again"\}$/.test(held ?? ""), `${at} the roster's one notice (what is wrong, the age, the acts held, Retry), the fields and Spawn off with the acts' own reason, and no second notice`, held ?? (await whole(page)));
      await page.shot(`a14-${viewport.name}-new-agent-held`, { targets: true });
    },
  },
  {
    stage: "pages-default",
    name: "the release's default pages: New agent is in the sidebar and opens the form, its first field the soul",
    run: async ({ page, at, viewport, check }) => {
      await page.goto("/");
      check(await showSidebar(page, viewport), `${at} the thread list is the OATS sidebar`);
      const there = await page.until(`${visible(testId("oats-new-agent"))} && document.querySelector(${q("oats-sidebar")}).querySelector(${q("oats-tree")}) !== null && !document.querySelector('[data-testid^="oats-page-link-"]') && ${textOf(testId("oats-new-agent"))}`, 30);
      check(there === "New agent", `${at} with only the home shown, New agent is in the sidebar, on screen, with no page link beside it`, there ?? (await page.evaluate(textOf(testId("oats-sidebar")))));
      await page.evaluate(click(testId("oats-new-agent")));
      const opened = await page.until(`${visible(testId("oats-spawn-form"))} && ${SOULS_READ} && JSON.stringify({ path: location.pathname, first: ${FIRST}, shown: document.querySelector(${q("oats-page-not-shown")}) === null })`, 30);
      check(opened === JSON.stringify({ path: "/plugins/oats/new-agent", first: "oats-spawn-soul", shown: true }), `${at} it opens the form's own page, the soul field first: the form is not one of the pages a release leaves out`, opened ?? (await page.evaluate("document.body.innerText.slice(0, 300)")));
      await page.shot(`pages-default-${viewport.name}-new-agent`, { targets: true });
    },
  },
];

const settled = (untilSnapshot) => untilSnapshot((snapshot) => snapshot.ok === true);
export const stages = {
  // The kernel takes six seconds over a preview: long enough to see the form while it reads.
  "spawn-slow": {
    label: "SP1",
    enter: async ({ fake, statusWithRealIds, threads, untilSnapshot }) => {
      fake({ status: { stdout: statusWithRealIds(threads) }, "spawn --preview": { file: "spawn/spawn-preview-unnamed.json", sleepMs: 6000 } });
      await settled(untilSnapshot);
    },
  },
  // The kernel's own refusal of a preview whose name is taken (recorded in the real run).
  "spawn-name-taken": {
    label: "SP2",
    enter: async ({ fake, statusWithRealIds, threads, untilSnapshot }) => {
      fake({ status: { stdout: statusWithRealIds(threads) }, "spawn --preview": { file: "spawn/spawn-preview-name-taken.json" } });
      await settled(untilSnapshot);
    },
  },
  // The preview answers; the apply is refused as the real kernel refuses a decision that moved.
  "spawn-refused": {
    label: "SP3",
    enter: async ({ fake, statusWithRealIds, threads, untilSnapshot }) => {
      fake({ status: { stdout: statusWithRealIds(threads) }, spawn: { file: "spawn/spawn-decision-stale.json" } });
      await settled(untilSnapshot);
    },
  },
};
