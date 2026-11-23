// Spawn's live scenes: the New agent form, a page of its own (`/plugins/oats/new-agent`). Each
// state of it once, in both themes at both widths: empty; filled, with what will be created read
// and before the buttons; the soul's and the harness's lists open; a name the form refuses and
// one the kernel refuses; a model that is typed; a child of an agent; the preview while it is
// read, with a press that starts nothing, then read, then read again after a change; Spawn
// pressed (held, one spawn for three presses; where it lands has no image here: the fake makes no
// agent, and the created agent's thread is the real run's image); a spawn that ended
// without an answer (held, Check result under the same key); a refused spawn; a spawn the kernel
// refused and could not undo completely (its marker, through bb's own RPC); a harness chosen with
// no model resolved (the Model field marked Required, Spawn held); the form held while
// OATS cannot be read; and the way in under the release's default pages. What the fake `oats`
// answers is what the real kernel printed, recorded by the real run (test/fixtures/spawn/README.md).
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
/** The souls and the provider's harnesses are read: both fields can be opened. */
const SOULS_READ = `document.querySelector(${q("oats-spawn-soul")})?.disabled === false && document.querySelector(${q("oats-spawn-harness")})?.disabled === false`;
/** The form's first control. */
const FIRST = `document.querySelector(${q("oats-spawn-form")}).querySelector("button, select, textarea, input").getAttribute("data-testid")`;
/** What will be created is read for the values on screen: the facts are drawn, none being read again, and Spawn can be pressed. → the column's text. */
const READ = `(() => { const c = document.querySelector(${q("oats-spawn-preview")}); return c?.querySelector('[data-testid="oats-fact"]') && !c.querySelector(${q("oats-spawn-updating")}) && document.querySelector(${q("oats-spawn-submit")})?.disabled === false ? c.innerText.replace(/\\s+/g, " ").trim() : ""; })()`;
const reasonOf = textOf(testId("oats-disabled-reason"));
const fieldError = `(document.querySelector(${q("oats-spawn-form")})?.querySelector('[role="alert"]')?.innerText ?? "").replace(/\\s+/g, " ").trim()`;
/** Nothing of the form is wider than its page: no sideways scroll at any width. */
const FITS = `(() => { const p = document.querySelector(${q("oats-new-agent-page")}); if (!p) return false; const edge = p.getBoundingClientRect().right; return p.scrollWidth <= p.clientWidth + 1 && [...p.querySelectorAll('[role="radio"], button, input, textarea, label')].every((e) => e.getBoundingClientRect().right <= edge + 1); })()`;
const show = (id) => `document.querySelector(${q(id)})?.scrollIntoView({ block: "center" })`;

async function open(page, soul = "") {
  await page.goto(soul === "" ? FORM : `${FORM}/${soul}`);
  return Boolean(await page.until(`${visible(testId("oats-spawn-form"))} && ${SOULS_READ}`, 30));
}
const whole = (page) => page.evaluate(textOf(testId("oats-new-agent-page")));


// ---- what the scenes below add to ask the page and the fake `oats`
import { readFileSync as read } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const FIXTURES = join(fileURLToPath(new URL("../../test/fixtures/spawn/", import.meta.url)));
/** The name the recorded previews were asked with (the real run's): the scenes type the same, so that the form and the column agree. */
const NAME = "form-spawned-developer";
/** The agent the recorded preview with a relation is a child of: one of the live roster's too. */
const ANCHOR = "harvest-knowledge-helper";
const TASK = "Say hello, then wait.";
/** The fake's own log of the calls it answered: what the plugin really asked of `oats`. */
const FAKE_LOG = join(homedir(), "fake-oats.log");
/** The spawns the plugin asked the kernel to APPLY since `since` (an instant): each call's idempotency key. */
function applied(since) {
  return read(FAKE_LOG, "utf8")
    .split("\n")
    .filter((line) => line !== "")
    .map((line) => JSON.parse(line))
    .filter((call) => call.verb === "spawn" && Date.parse(call.at) >= since)
    .map((call) => call.argv[call.argv.indexOf("--idempotency-key") + 1]);
}
/** Ctrl+Enter, the form's key for Spawn, sent to what holds the focus (or to the instruction). */
const MOD_ENTER = `(() => { const on = document.activeElement && document.activeElement !== document.body ? document.activeElement : document.querySelector(${q("oats-spawn-task")}); on.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", ctrlKey: true, bubbles: true, cancelable: true })); return true; })()`;
const SPAWN = `document.querySelector(${q("oats-spawn-submit")})`;
const FIELDS = `document.querySelector(${q("oats-spawn-form")} + " fieldset")`;
/** The button and what is beside it, as a person reads them. */
const FOOT = `JSON.stringify({ button: ${SPAWN}.innerText.trim(), off: ${SPAWN}.disabled, reason: ${reasonOf}, fields: ${FIELDS}.disabled })`;
/** The column's text once it holds the facts of a preview named `name`, none being read again. */
const readFor = (name) => `(() => { const t = ${READ}; return t.includes(${JSON.stringify(`Name ${name} `)}) ? t : ""; })()`;
/** The open list of a choice is whole inside the window: its filter (where it has one), the option the keys are on (the chosen one, when it opens) and its frame are on screen. */
const listOnScreen = (id) =>
  `(() => { const list = document.querySelector(${q(`${id}-options`)}); if (!list) return ""; const filter = document.querySelector(${q(`${id}-filter`)}); const first = list.querySelector('[data-active="true"]'); const inside = (e) => { const r = e.getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight && r.width > 0; }; return JSON.stringify({ filter: filter === null ? null : inside(filter), first: first !== null && inside(first), list: inside(list.parentElement) }); })()`;
/** Each fact of the column, by its label, as one line. */
const FACTS = `JSON.stringify(Object.fromEntries([...document.querySelectorAll(${q("oats-spawn-preview")} + ' [data-testid="oats-fact"]')].map((f) => [f.querySelector("dt").innerText.trim(), f.querySelector("dd").innerText.replace(/\\s+/g, " ").trim()])))`;
/** No value of the column is broken inside a word: each part between two places it may break (after "/" and "-") is on one line. */
const NO_BREAK_INSIDE = `(() => { const parts = [...document.querySelectorAll(${q("oats-spawn-preview")} + " [data-part]")]; return parts.length > 0 && parts.every((part) => part.getClientRects().length <= 1); })()`;

async function fillNamed(page, { relation = false } = {}) {
  await page.evaluate(fill(testId("oats-spawn-task"), TASK));
  if (relation) {
    await page.evaluate(`[...document.querySelectorAll(${JSON.stringify(`${testId("oats-spawn-relation")} [role="radio"]`)})].find((e) => e.innerText.trim() === "Child of").click()`);
    await page.until(`document.querySelector(${q("oats-spawn-relative")}) !== null`, 10);
    if (!(await page.evaluate(choose("oats-spawn-relative", ANCHOR)))) return undefined;
  }
  await page.evaluate(fill(testId("oats-spawn-name"), NAME));
  return page.until(readFor(NAME), 30);
}

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
    stage: "spawn-form",
    name: "the New agent form, empty: the soul first and in focus, nothing read, Spawn off with its reason",
    run: async ({ page, at, viewport, check }) => {
      check(await open(page), `${at} /plugins/oats/new-agent is the form, with the souls OATS lists`, await whole(page));
      const first = await page.evaluate(`JSON.stringify({ title: ${textOf(testId("oats-spawn-title"))}, first: ${FIRST}, labels: [...document.querySelector(${q("oats-spawn-form")}).querySelectorAll("label, #oats-spawn-relation-label")].map((e) => e.innerText.trim()), spawn: ${SPAWN}.disabled, reason: ${reasonOf}, column: ${textOf(testId("oats-spawn-preview"))}, mode: ${textOf(testId("oats-spawn-mode"))}, key: ${textOf(testId("oats-spawn-key"))} })`);
      check(
        first === JSON.stringify({ title: "New agent", first: "oats-spawn-soul", labels: ["Soul", "Opening instruction · optional", "Harness", "Model", "Relationship", "Name · optional"], spawn: true, reason: "Choose a soul first.", column: "WHAT WILL BE CREATED Choose a soul to see what will be created.", mode: "Runs in bb's full mode: no sandbox.", key: "Ctrl+Enter" }),
        `${at} the empty form: titled New agent, the soul first, the Desktop's fields in its order, Spawn off and saying why, its key beside it, the one line about bb's full mode`,
        first,
      );
      check((await page.until(`${FOCUSED} === "oats-spawn-soul"`, 10)) === true, `${at} the focus starts on the first field, the soul`, await page.evaluate(FOCUSED));
      check(await page.evaluate(FITS), `${at} nothing of the form is wider than the page`);
      await page.shot(`spawn-${viewport.name}-empty`, { targets: true });
    },
  },
  {
    stage: "spawn-form",
    name: "the New agent form, filled: what will be created read from the kernel's preview, before the buttons; the focus order; the soul and the harness lists open",
    run: async ({ page, at, viewport, check }) => {
      check(await open(page, "oats-developer"), `${at} /plugins/oats/new-agent/oats-developer is the form with that soul chosen`, await whole(page));
      const landed = await page.until(`${FOCUSED} === "oats-spawn-task" && JSON.stringify({ title: ${textOf(testId("oats-spawn-title"))}, soul: document.querySelector(${q("oats-spawn-soul")}).getAttribute("data-value") })`, 10);
      check(landed === JSON.stringify({ title: "Spawn oats-developer in oats", soul: "oats-developer" }), `${at} opened with a soul: named as the Desktop names its dialog, the soul chosen, the focus on the instruction`, landed ?? (await page.evaluate(FOCUSED)));
      const read = await fillNamed(page);
      check(
        Boolean(read) && new RegExp(`^WHAT WILL BE CREATED Name ${NAME} Home .+ Soul oats-developer Works in .+ Runs on .+ Harness .+ Session bb thread Access full mode: no sandbox Team .+ CORE CAPABILITIES Knowledge .+ Messaging .+ Tasks .+ CAPABILITIES \\d+ .+ Resolved by the installed CLI\\. Spawn refuses if this changes before you confirm\\.$`).test(read ?? ""),
        `${at} What will be created, from the kernel's answer: the name and the home, the soul, where it works and on which machine, the harness and the model, a bb thread in full mode, the team, the capabilities`,
        read ?? (await whole(page)),
      );
      const quiet = await page.evaluate(`JSON.stringify({ warnings: document.querySelector(${q("oats-spawn-preview")}).querySelectorAll(${q("oats-notice")}).length, whole: ${NO_BREAK_INSIDE} })`);
      check(quiet === JSON.stringify({ warnings: 0, whole: true }), `${at} no warning (the kernel gave none), and no value of the column is broken inside a word`, quiet);
      const foot = await page.evaluate(`JSON.stringify({ name: document.querySelector(${q("oats-spawn-form")}).innerText.includes(${JSON.stringify(`Instance name: ${NAME}`)}), foot: JSON.parse(${FOOT}) })`);
      check(foot === JSON.stringify({ name: true, foot: { button: "Spawn", off: false, reason: "", fields: false } }), `${at} the name's line says the resulting name; the button is named for the act and can be pressed, with no reason beside it`, foot);
      // What will be created comes before the buttons: beside the fields on a wide page, between the fields and the buttons on a phone.
      const order = await page.evaluate(`(() => { const c = document.querySelector(${q("oats-spawn-preview")}).getBoundingClientRect(); const b = ${SPAWN}.getBoundingClientRect(); const f = ${FIELDS}.getBoundingClientRect(); return JSON.stringify({ beside: c.left >= f.right, above: c.bottom <= b.top }); })()`);
      check(order === JSON.stringify(viewport.mobile ? { beside: false, above: true } : { beside: true, above: false }), `${at} ${viewport.mobile ? "on a phone what will be created is above Cancel and Spawn: it is read before the press" : "what will be created stands beside the fields and the buttons"}`, order);
      // The focus order, by Tab from the first field.
      await page.evaluate(`document.querySelector(${q("oats-spawn-soul")}).focus()`);
      const stops = [await page.evaluate(FOCUSED)];
      for (let i = 0; i < 7; i += 1) {
        await page.press("Tab");
        stops.push(await page.evaluate(FOCUSED));
      }
      check(JSON.stringify(stops) === JSON.stringify(["oats-spawn-soul", "oats-spawn-task", "oats-spawn-harness", "oats-spawn-model", "Independent", "oats-spawn-name", "oats-spawn-cancel", "oats-spawn-submit"]), `${at} Tab walks the form in its order: the soul, the instruction, the harness, the model, the relationship, the name, Cancel, Spawn`, JSON.stringify(stops));
      check(await page.evaluate(FITS), `${at} nothing of the form is wider than the page`);
      await page.evaluate(show("oats-spawn-task"));
      await page.shot(`spawn-${viewport.name}-filled`, { targets: true });
      // On a phone the column is under the fields: its own image, down to the buttons. (On a wide page it is beside them, in the image above.)
      if (viewport.mobile) {
        await page.evaluate(`${SPAWN}.scrollIntoView({ block: "end" })`);
        await page.shot(`spawn-${viewport.name}-preview`);
      }
      // The soul's list, open: the souls OATS lists, each with its description, a filter, the chosen one marked; all of it on screen.
      await page.evaluate(`window.scrollTo(0, 0); document.querySelector(${q("oats-new-agent-page")}).scrollTop = 0`);
      await page.evaluate(click(testId("oats-spawn-soul")));
      const souls = await page.until(`document.querySelector(${q("oats-spawn-soul-options")}) && JSON.stringify({ role: document.querySelector(${q("oats-spawn-soul-options")}).getAttribute("role"), options: [...document.querySelectorAll(${q("oats-spawn-soul-option")})].map((e) => [...e.querySelectorAll("span")].map((part) => part.innerText.trim())), chosen: document.querySelector(${q("oats-spawn-soul-option")} + '[aria-selected="true"]')?.getAttribute("data-value"), muted: [...document.querySelectorAll(${q("oats-spawn-soul-option")} + "[data-unavailable]")].map((e) => e.querySelectorAll("span")[1].innerText.trim()) })`, 10);
      const listed = JSON.parse(souls ?? "{}");
      check(listed.role === "listbox" && listed.chosen === "oats-developer" && listed.options?.length > 1 && listed.options.every((option) => option.length === 2 && option.every((part) => part !== "")) && listed.muted.length > 0 && listed.muted.every((detail) => detail === "This soul can’t be spawned."), `${at} the soul field opens to the souls OATS lists, each with its description, the chosen one marked, and one that cannot be spawned drawn apart and saying so`, souls ?? (await whole(page)));
      const soulsOn = await page.evaluate(listOnScreen("oats-spawn-soul"));
      check(soulsOn === JSON.stringify({ filter: true, first: true, list: true }), `${at} the open list is whole on screen: its filter, the chosen soul, its frame`, soulsOn);
      await page.shot(`spawn-${viewport.name}-souls-open`, { targets: true });
      await page.press("Escape");
      const closed = await page.until(`!document.querySelector(${q("oats-spawn-soul-options")}) && ${FOCUSED}`, 10);
      check(closed === "oats-spawn-soul", `${at} Escape closes the list, and the focus is back on the field`, String(closed));
      // The harness's list, open: the soul's default with what the kernel resolved, then what the provider declares, each marked with what bb says of it when bb cannot run it here.
      await page.evaluate(click(testId("oats-spawn-harness")));
      const harnesses = await page.until(`document.querySelector(${q("oats-spawn-harness-options")}) && JSON.stringify([...document.querySelectorAll(${q("oats-spawn-harness-option")})].map((e) => e.querySelector("span").innerText.trim()))`, 10);
      // bb in the checks' container has Claude Code and no pi: what the list says of pi is bb's own state, read.
      check(harnesses === JSON.stringify(["The soul's default: Claude Code", "Claude Code", "pi · not installed in bb"]), `${at} the harness field opens to the soul's default, with the harness the kernel resolved, then the ones the provider declares; the one bb has not installed says so`, harnesses ?? (await whole(page)));
      await page.shot(`spawn-${viewport.name}-harness-open`, { targets: true });
      await page.press("Escape");
      check(await page.evaluate(choose("oats-spawn-harness", "pi")), `${at} pi can still be chosen`, await whole(page));
      const said = await page.until(`/bb has not installed pi on this machine, so a spawn on it is refused\\. Install it in bb’s settings, or pick another harness\\./.test(document.querySelector(${q("oats-spawn-form")}).innerText) && document.querySelector(${q("oats-spawn-harness")}).innerText.replace(/\\s+/g, " ").trim()`, 10);
      check(said === "pi · not installed in bb ▾", `${at} chosen, the field keeps the mark and says under it what bb lacks and what to do, before any press`, said ?? (await whole(page)));
      await page.evaluate(show("oats-spawn-harness"));
      await page.shot(`spawn-${viewport.name}-harness-not-installed`, { targets: true });
    },
  },
  {
    stage: "spawn-form",
    name: "the New agent form: a name the form refuses says its fault; a model that is typed has its field",
    run: async ({ page, at, viewport, check }) => {
      check(await open(page, "oats-developer"), `${at} the form with a soul chosen`, await whole(page));
      await page.until(READ, 30);
      await page.evaluate(fill(testId("oats-spawn-name"), "Bad Name"));
      const refused = await page.until(`${fieldError} !== "" && JSON.stringify({ error: ${fieldError}, reason: ${reasonOf}, spawn: ${SPAWN}.disabled, column: ${textOf(testId("oats-spawn-preview"))} })`, 10);
      check(
        refused === JSON.stringify({ error: "A space can’t be in a name. Use letters, digits and dashes.", reason: "The name can’t be used: its field says why.", spawn: true, column: "WHAT WILL BE CREATED Shown once the values above can be used." }),
        `${at} a name with a space: the fault under the name, Spawn off with the reason beside it, and no stale facts in the column`,
        refused ?? (await whole(page)),
      );
      await page.evaluate(show("oats-spawn-name"));
      await page.shot(`spawn-${viewport.name}-name-refused`, { targets: true });
      await page.evaluate(fill(testId("oats-spawn-name"), ""));
      check(await page.evaluate(choose("oats-spawn-model", "__custom__")), `${at} Custom… is picked in the model's list`, await whole(page));
      const typed = await page.until(`document.querySelector(${q("oats-spawn-model-id")}) && JSON.stringify({ placeholder: document.querySelector(${q("oats-spawn-model-id")}).placeholder, foot: JSON.parse(${FOOT}) })`, 10);
      check(typed === JSON.stringify({ placeholder: "Type a model ID", foot: { button: "Spawn", off: true, reason: "Type the model ID, or choose Default.", fields: false } }), `${at} a field for the model's id appears under the choice, and Spawn waits for it, saying so`, typed ?? (await whole(page)));
      await page.evaluate(show("oats-spawn-model-id"));
      await page.shot(`spawn-${viewport.name}-model-id`, { targets: true });
    },
  },
  {
    stage: "spawn-related",
    name: "the New agent form, a child of an agent: the instance picked by name, and who it is started under read from the kernel's answer",
    run: async ({ page, at, viewport, check }) => {
      check(await open(page, "oats-developer"), `${at} the form with a soul chosen`, await whole(page));
      await page.evaluate(`[...document.querySelectorAll(${JSON.stringify(`${testId("oats-spawn-relation")} [role="radio"]`)})].find((e) => e.innerText.trim() === "Child of").click()`);
      const asked = await page.until(`document.querySelector(${q("oats-spawn-relative")}) && JSON.stringify({ label: [...document.querySelector(${q("oats-spawn-relation")}).querySelectorAll("label")].map((e) => e.innerText.trim()), name: document.querySelector(${q("oats-spawn-relative")}).getAttribute("aria-label"), line: ${textOf(testId("oats-spawn-relation-line"))}, reason: ${reasonOf} })`, 10);
      check(asked === JSON.stringify({ label: ["Which instance"], name: "Child of which instance?", line: "Pick the instance this one is a child of.", reason: "Pick the instance first, or choose Independent." }), `${at} Child of asks which instance, under its label, and Spawn waits for it, saying so`, asked ?? (await whole(page)));
      const read = await fillNamed(page, { relation: true });
      const facts = JSON.parse((await page.evaluate(FACTS)) ?? "{}");
      const line = await page.evaluate(textOf(testId("oats-spawn-relation-line")));
      check(Boolean(read) && facts.Relationship === "child of Harvest knowledge helper" && line === "Spawns as a child of Harvest knowledge helper.", `${at} with the instance picked the form says whose child it will be, and What will be created says it too, from the kernel's answer: "Relationship ${facts.Relationship}"`, JSON.stringify({ facts, line }));
      check(await page.evaluate(FITS), `${at} nothing of the form is wider than the page`);
      await page.evaluate(show("oats-spawn-relation"));
      await page.shot(`spawn-${viewport.name}-relation`, { targets: true });
      if (viewport.mobile) {
        await page.evaluate(`${SPAWN}.scrollIntoView({ block: "end" })`);
        await page.shot(`spawn-${viewport.name}-relation-preview`);
      }
    },
  },
  {
    stage: "spawn-slow",
    name: "the New agent form while the kernel works out the preview: Spawn is off and says so, a press starts nothing; then what will be created; then a change read again",
    run: async ({ page, at, viewport, check }) => {
      const since = Date.now();
      check(await open(page, "oats-developer"), `${at} the form with a soul chosen`, await whole(page));
      const reading = await page.until(`${reasonOf} === "Reading defaults…" && JSON.stringify({ column: ${textOf(testId("oats-spawn-preview"))}, foot: JSON.parse(${FOOT}) })`, 10);
      check(reading === JSON.stringify({ column: "WHAT WILL BE CREATED Reading defaults…", foot: { button: "Spawn", off: true, reason: "Reading defaults…", fields: false } }), `${at} while the first preview is read the column says Reading defaults… in the place the facts will be, and Spawn is off with that as its reason`, reading ?? (await whole(page)));
      // A press now, by the button or by the key, would start an agent the screen has not shown: it starts nothing.
      await page.evaluate(`${SPAWN}.click()`);
      await page.evaluate(MOD_ENTER);
      await page.evaluate(show("oats-spawn-submit"));
      await page.shot(`spawn-${viewport.name}-reading`, { targets: true });
      const read = await page.until(READ, 30);
      check(Boolean(read) && (read ?? "").includes("Resolved by the installed CLI"), `${at} then what will be created, and only then its foot ("Resolved by the installed CLI…") and a Spawn that can be pressed`, read ?? (await whole(page)));
      check(applied(since).length === 0 && (await page.evaluate("location.pathname")).startsWith(FORM), `${at} and the presses made during the read started nothing: the kernel was asked to apply no spawn`, JSON.stringify(applied(since)));
      await page.evaluate(`${SPAWN}.scrollIntoView({ block: "end" })`);
      await page.shot(`spawn-${viewport.name}-read`);
      // A value changes: the last facts stay, marked as being read again, and Spawn waits for the new ones.
      await page.evaluate(fill(testId("oats-spawn-task"), TASK));
      const updating = await page.until(`document.querySelector(${q("oats-spawn-updating")}) && JSON.stringify({ mark: ${textOf(testId("oats-spawn-updating"))}, facts: document.querySelectorAll(${q("oats-spawn-preview")} + ' [data-testid="oats-fact"]').length > 0, foot: JSON.parse(${FOOT}) })`, 10);
      check(updating === JSON.stringify({ mark: "Updating…", facts: true, foot: { button: "Spawn", off: true, reason: "Reading defaults…", fields: false } }), `${at} after a change the facts stay under "Updating…", and Spawn is off until the preview of the new values is on screen`, updating ?? (await whole(page)));
      await page.shot(`spawn-${viewport.name}-updating`);
      await page.until(READ, 30);
    },
  },
  {
    stage: "spawn-flight",
    name: "the New agent form, Spawn pressed: held and saying Spawning…, a second press starts nothing; then it leaves for the thread the kernel named",
    run: async ({ page, at, viewport, check, threads }) => {
      const since = Date.now();
      check(await open(page, "oats-developer"), `${at} the form with a soul chosen`, await whole(page));
      check(Boolean(await fillNamed(page)), `${at} the form is filled and its preview read`, await whole(page));
      await page.evaluate(`${SPAWN}.click()`);
      const flying = await page.until(`${SPAWN}.innerText.trim() === "Spawning…" && JSON.stringify({ foot: JSON.parse(${FOOT}), busy: ${SPAWN}.getAttribute("aria-busy"), said: ${textOf(testId("oats-spawn-status"))}, cancel: document.querySelector(${q("oats-spawn-cancel")}).disabled })`, 10);
      check(flying === JSON.stringify({ foot: { button: "Spawning…", off: true, reason: "", fields: true }, busy: "true", said: "Spawning…", cancel: true }), `${at} on the press the button reads "Spawning…" and is held, with every field and Cancel; it is announced`, flying ?? (await whole(page)));
      // One press makes one agent: the button again, and the key, while it is in flight.
      await page.evaluate(`${SPAWN}.click()`);
      await page.evaluate(MOD_ENTER);
      await page.evaluate(show("oats-spawn-submit"));
      await page.shot(`spawn-${viewport.name}-spawning`, { targets: true });
      const target = threads.get("thr_ci");
      const opened = await page.until(`location.pathname.endsWith(${JSON.stringify(`/threads/${target.id}`)}) && ${visible(testId("oats-identity-row"))} && location.pathname`, 40);
      check(Boolean(opened), `${at} when the kernel answers, the form opens the thread the kernel named for the new agent; it does not stay filled with Spawn live`, opened ?? (await page.evaluate("location.pathname + ' ' + document.body.innerText.slice(0, 200)")));
      const keys = applied(since);
      check(keys.length === 1, `${at} and the three presses made one spawn: the kernel was asked to apply once`, JSON.stringify(keys));
      // No image of where it lands: the fake has no kernel to make an agent, so the thread it names is one of the fixture's, and an
      // image of it would read "Spawn took me to another agent". The created state is the unit tests' and the real run's to show.
    },
  },
  {
    stage: "spawn-unknown",
    name: "the New agent form, a spawn that ended without an answer: the form is held, and the one act is Check result, under the same key",
    run: async ({ page, at, viewport, check }) => {
      const since = Date.now();
      check(await open(page, "oats-developer"), `${at} the form with a soul chosen`, await whole(page));
      // No name: the kernel would number a second agent, so nothing but the key keeps a second press from making one.
      await page.evaluate(fill(testId("oats-spawn-task"), TASK));
      await page.until(READ, 30);
      await page.evaluate(`${SPAWN}.click()`);
      const unknown = `(() => { const r = document.querySelector(${q("oats-spawn-foot")} + " " + ${q("oats-result")}); return r && ${SPAWN}.innerText.trim() === "Check result" ? JSON.stringify({ tone: r.getAttribute("data-tone"), title: r.querySelector("h3").innerText, words: r.querySelector("p").innerText, foot: JSON.parse(${FOOT}), path: location.pathname }) : ""; })()`;
      const said = await page.until(unknown, 30);
      check(
        said === JSON.stringify({ tone: "unknown", title: "It is not known whether the agent was spawned", words: "OATS ended without saying whether the instance was created. Press Check result: it asks OATS again, and starts nothing twice.", foot: { button: "Check result", off: false, reason: "", fields: true }, path: `${FORM}/oats-developer` }),
        `${at} the outcome is not known: the form says so in a person's words, holds every field, and offers Check result alone`,
        said ?? (await whole(page)),
      );
      await page.evaluate(show("oats-result"));
      await page.shot(`spawn-${viewport.name}-unknown`, { targets: true });
      // Check result asks the kernel again under the same key: what it made it replays, what it did not it makes once.
      await page.evaluate(MOD_ENTER);
      await page.until(`${SPAWN}.innerText.trim() === "Spawning…"`, 5);
      await page.until(unknown, 30);
      const keys = applied(since);
      check(keys.length === 2 && keys[0] === keys[1] && /^[0-9a-f]{32}$/.test(keys[0] ?? ""), `${at} Check result asked again with the SAME idempotency key: the kernel cannot make a second agent from it`, JSON.stringify(keys));
    },
  },
  {
    stage: "spawn-name-taken",
    name: "the New agent form: a name the kernel refuses at the preview, in a person's words under the name, with its code",
    run: async ({ page, at, viewport, check }) => {
      check(await open(page, "oats-developer"), `${at} the form with a soul chosen`, await whole(page));
      await page.evaluate(fill(testId("oats-spawn-name"), ANCHOR));
      const said = await page.until(`${fieldError} !== "" && JSON.stringify({ error: ${fieldError}, reason: ${reasonOf}, notice: document.querySelector(${q("oats-spawn-preview")}).querySelector(${q("oats-notice")}) !== null })`, 30);
      check(said === JSON.stringify({ error: "An instance with this name already exists. Choose another name. (E_INSTANCE_NAME_TAKEN)", reason: "The name can’t be used: its field says why.", notice: false }), `${at} a name that is an agent's: the kernel's refusal in the Desktop's sentence under the name, with its code, once; Spawn off with its reason`, said ?? (await whole(page)));
      await page.evaluate(show("oats-spawn-name"));
      await page.shot(`spawn-${viewport.name}-name-taken`, { targets: true });
    },
  },
  {
    stage: "spawn-preview-refused",
    name: "the New agent form: a preview the kernel refuses is a notice where the facts would be, in a person's words, with its code, Details and Retry; Spawn is off and says where the reason is",
    run: async ({ page, at, viewport, check }) => {
      check(await open(page, "oats-developer"), `${at} the form with a soul chosen`, await whole(page));
      check(await page.evaluate(choose("oats-spawn-model", "__custom__")), `${at} Custom… is picked in the model's list`, await whole(page));
      await page.evaluate(fill(testId("oats-spawn-model-id"), "no-such-provider/no-such-model"));
      const refused = await page.until(`(() => { const n = document.querySelector(${q("oats-spawn-preview")} + " " + ${q("oats-notice")}); const d = n?.querySelector(${q("oats-notice-details")}); return n ? JSON.stringify({ tone: n.getAttribute("data-tone"), title: n.querySelector("h3").innerText, words: n.querySelector("div p").innerText, code: n.querySelector(":scope > p").innerText, details: d !== null && !d.open, retry: [...n.querySelectorAll("button")].map((b) => b.innerText.trim()), foot: JSON.parse(${FOOT}) }) : ""; })()`, 30);
      check(
        refused === JSON.stringify({ tone: "error", title: "This can’t be spawned as it is", words: "That model isn’t available for this harness. Pick another model, or keep the default.", code: "E_MODEL_UNKNOWN", details: true, retry: ["Retry"], foot: { button: "Spawn", off: true, reason: "OATS refused these values: “What will be created” says why.", fields: false } }),
        `${at} a model no harness has: the kernel's refusal of the preview as a notice in the column (the Desktop's sentence, the code, Details closed, Retry), and Spawn off, saying where the reason is`,
        refused ?? (await whole(page)),
      );
      await page.evaluate(`${SPAWN}.scrollIntoView({ block: "end" })`);
      await page.shot(`spawn-${viewport.name}-preview-refused`, { targets: true });
    },
  },
  {
    stage: "spawn-refused",
    name: "the New agent form: a spawn the kernel refuses leads with a person's words, its code after, Details one press away; the values are kept and the preview read again",
    run: async ({ page, at, viewport, check }) => {
      check(await open(page, "oats-developer"), `${at} the form with a soul chosen`, await whole(page));
      check(Boolean(await fillNamed(page)), `${at} the form is filled and its preview read`, await whole(page));
      await page.evaluate(`${SPAWN}.click()`);
      const refused = await page.until(`(() => { const r = document.querySelector(${q("oats-spawn-foot")} + " " + ${q("oats-result")}); const d = r?.querySelector(${q("oats-spawn-details")}); const again = r?.querySelector(${q("oats-spawn-reread")}); return r && again && !${SPAWN}.disabled ? JSON.stringify({ role: r.getAttribute("role"), title: r.querySelector("h3").innerText, words: r.querySelector("p").innerText, again: again.innerText, code: [...r.querySelectorAll(":scope > p")].at(-1).innerText, details: d !== null && !d.open && d.querySelector("summary").innerText.replace(/\\s+/g, " ").trim(), kept: [document.querySelector(${q("oats-spawn-task")}).value, document.querySelector(${q("oats-spawn-name")}).value], foot: JSON.parse(${FOOT}), path: location.pathname }) : ""; })()`, 40);
      check(
        refused ===
          JSON.stringify({ role: "alert", title: "The agent was not spawned", words: "Something changed before the spawn went through. Nothing was created — check the updated values and press Spawn again.", again: "“What will be created” was read again: it shows the values as they are now.", code: "E_DECISION_STALE", details: "▸ Details", kept: [TASK, NAME], foot: { button: "Spawn", off: false, reason: "", fields: false }, path: `${FORM}/oats-developer` }),
        `${at} a refused spawn: what happened and what to do in a person's words, that the preview was read again, the kernel's code, its own message behind Details (drawn as something to press); the instruction and the name are kept, and Spawn is back`,
        refused ?? (await whole(page)),
      );
      await page.evaluate(show("oats-result"));
      await page.shot(`spawn-${viewport.name}-refused`, { targets: true });
      await page.evaluate(click(`${testId("oats-spawn-details")} summary`));
      const details = await page.until(`document.querySelector(${q("oats-spawn-details")})?.open && ${textOf(`${testId("oats-spawn-details")} p`)}`, 10);
      check(/^the previewed decision changed/.test(details ?? ""), `${at} Details opens to the kernel's own message`, String(details));
      await page.evaluate(show("oats-spawn-submit"));
      await page.shot(`spawn-${viewport.name}-refused-details`);
    },
  },
  {
    stage: "spawn-model-required",
    name: "the New agent form: a harness the person chose that is not the soul's own, for which the kernel resolves no model: the Model field is marked Required, Spawn is held with that word, and no default is promised",
    run: async ({ page, at, viewport, check }) => {
      const since = Date.now();
      check(await open(page, "oats-developer"), `${at} the form with a soul chosen`, await whole(page));
      await page.until(READ, 30);
      // The Harness row (its value, then where it came from), the Model field (what it shows, its mark) and the button.
      const MODEL = `(() => { const field = document.querySelector(${q("oats-spawn-model")}); const error = field?.closest('[data-testid="oats-field"]')?.querySelector('[role="alert"]'); const harness = [...document.querySelectorAll(${q("oats-spawn-preview")} + ' [data-testid="oats-fact"]')].find((fact) => fact.querySelector("dt")?.innerText.trim() === "Harness")?.querySelector("dd")?.innerText.replace(/\\s+/g, " ").trim() ?? null; return JSON.stringify({ harness, field: field?.innerText.replace(/\\s+/g, " ").trim() ?? null, mark: error ? error.innerText.trim() : null, invalid: field?.getAttribute("aria-invalid") === "true", foot: JSON.parse(${FOOT}) }); })()`;
      const is = (read, harness, field, rest) => read !== null && harness(read.harness ?? "") && field.test(read.field ?? "") && JSON.stringify({ mark: read.mark, invalid: read.invalid, foot: read.foot }) === JSON.stringify(rest);
      // The soul's own harness, as the kernel resolves it with none chosen: its own model, and nothing held.
      const own = await page.until(`${READ} && ${MODEL}`, 30);
      check(is(own ? JSON.parse(own) : null, (row) => row.startsWith("Claude Code · claude-opus-5-5"), /^Default · claude-opus-5-5 ?▾$/, { mark: null, invalid: false, foot: { button: "Spawn", off: false, reason: "", fields: false } }), `${at} with no harness chosen: the soul's own harness and model, and Spawn is not held`, own ?? (await page.evaluate(MODEL)));
      // Another harness, CHOSEN by the person: the kernel resolves no model for it (the soul's is Claude Code's), and one is required.
      check(await page.evaluate(choose("oats-spawn-harness", "pi")), `${at} pi is chosen in the harness's list`, await whole(page));
      const held = await page.until(`(() => { const read = JSON.parse(${MODEL}); return read.mark === "Required" && read.foot.reason === "Required" ? JSON.stringify(read) : ""; })()`, 30);
      check(is(held ? JSON.parse(held) : null, (row) => /^pi(?! ·)/.test(row) && row.includes("chosen for this spawn"), /^Default ?▾$/, { mark: "Required", invalid: true, foot: { button: "Spawn", off: true, reason: "Required", fields: false } }), `${at} chosen by the person: the column names the harness alone, the Model field says "Default" and is marked "Required", and Spawn is held with that word: no sentence, and no default promised`, held ?? (await page.evaluate(MODEL)));
      check(!/bb’s default|harness’s own|harness's own/.test(await whole(page)), `${at} nothing on the form promises a default`, await whole(page));
      // A press, by the button or by the key, starts nothing: read after the time a spawn takes to reach the fake's log.
      await page.evaluate(`${SPAWN}.click()`);
      await page.evaluate(MOD_ENTER);
      await page.until("false", 2);
      check(applied(since).length === 0, `${at} and a press starts nothing: the kernel was asked to apply no spawn`, JSON.stringify(applied(since)));
      await page.evaluate(show("oats-spawn-model"));
      await page.shot(`spawn-${viewport.name}-model-required`, { targets: true });
      // A model picked: the mark goes and Spawn is armed.
      check(await page.evaluate(choose("oats-spawn-model", "__custom__")), `${at} Custom… is picked in the model's list`, await whole(page));
      await page.evaluate(fill(testId("oats-spawn-model-id"), "github-copilot/claude-fable-5.2"));
      const ARMED = `(() => { const read = JSON.parse(${MODEL}); return read.mark === null && read.foot.off === false && read.foot.reason === "" ? JSON.stringify(read) : ""; })()`;
      const armed = await page.until(`${READ} && ${ARMED}`, 30);
      check(Boolean(armed), `${at} a model picked: the mark goes, and Spawn is armed`, armed ?? (await page.evaluate(MODEL)));
    },
  },
  {
    stage: "spawn-unconfirmed",
    name: "the New agent form: a spawn the kernel refused and could not undo completely (its marker, through bb's own RPC) is never 'nothing was created': held, with what to clean up under Details and nothing to press but Close",
    run: async ({ page, at, viewport, check }) => {
      const since = Date.now();
      check(await open(page, "oats-developer"), `${at} the form with a soul chosen`, await whole(page));
      check(Boolean(await fillNamed(page)), `${at} the form is filled and its preview read`, await whole(page));
      await page.evaluate(`${SPAWN}.click()`);
      const SAID = `(() => { const r = document.querySelector(${q("oats-spawn-foot")} + " " + ${q("oats-result")}); return JSON.stringify({ tone: r?.getAttribute("data-tone") ?? null, title: r?.querySelector("h3").innerText ?? null, words: r?.querySelector("p").innerText ?? null, code: r ? [...r.querySelectorAll("p, span, code")].some((e) => e.innerText.trim() === "E_BACKEND_NOT_READY") : null, button: ${SPAWN}.innerText.trim(), off: ${SPAWN}.disabled, fields: ${FIELDS}.disabled, cancel: ${textOf(testId("oats-spawn-cancel"))}, path: location.pathname }); })()`;
      const said = await page.until(`document.querySelector(${q("oats-spawn-foot")} + " " + ${q("oats-result")}) && ${SPAWN}.innerText.trim() !== "Spawning…" && ${SPAWN}.innerText.trim() !== "Spawn" && ${SAID}`, 30);
      check(
        said ===
          JSON.stringify({ tone: "failed", title: "The spawn was refused, and could not be undone completely", words: "OATS refused the spawn and could not undo all of it: part of the instance may still be there. Details says what to clean up; don’t spawn again before it is.", code: true, button: "Spawn incomplete", off: true, fields: true, cancel: "Close", path: `${FORM}/oats-developer` }),
        `${at} the kernel's marker reached the form: it says the spawn was refused and not undone completely, with the kernel's code; every field and the button are held, and the one press left is Close`,
        said ?? (await page.evaluate(SAID)),
      );
      // A press, by the button or by the key, asks the kernel nothing more: the one spawn stays the one.
      await page.evaluate(`${SPAWN}.click()`);
      await page.evaluate(MOD_ENTER);
      await page.evaluate(show("oats-result"));
      await page.shot(`spawn-${viewport.name}-unconfirmed`, { targets: true });
      await page.evaluate(click(`${testId("oats-spawn-details")} summary`));
      const details = await page.until(`document.querySelector(${q("oats-spawn-details")})?.open && ${textOf(`${testId("oats-spawn-details")} p`)}`, 10);
      check(/rollback INCOMPLETE, clean up manually: instance home .+: still present$/.test(details ?? ""), `${at} Details opens to the kernel's own message, which names what is left`, String(details));
      // An absence is not read at once: a second spawn would be in the fake's log well within two seconds of its press (the one made is there in under one).
      await page.until("false", 2);
      const keys = applied(since);
      check(keys.length === 1, `${at} and a press started nothing: the kernel was asked to spawn once`, JSON.stringify(keys));
    },
  },
  {
    stage: "no-oats",
    name: "the New agent form while OATS cannot be read: held like the acts, under the roster's own notice with the age of what is shown",
    run: async ({ page, at, viewport, check }) => {
      await page.goto(`${FORM}/oats-developer`);
      const held = await page.until(`(() => { const n = document.querySelector(${q("oats-new-agent-page")} + " " + ${q("oats-unreadable")}); const f = ${FIELDS}; return n && f ? JSON.stringify({ title: n.querySelector("h3").innerText, age: /Showing what was read .+ ago\\./.test(n.innerText), held: document.querySelectorAll(${q("oats-new-agent-page")} + " " + ${q("oats-held")}).length, notices: document.querySelectorAll(${q("oats-new-agent-page")} + " " + ${q("oats-notice")}).length, foot: JSON.parse(${FOOT}) }) : ""; })()`, 30);
      check(/^\{"title":"OATS is not installed on [^"]+","age":true,"held":1,"notices":1,"foot":\{"button":"Spawn","off":true,"reason":"Comes back when OATS is read again","fields":true\}\}$/.test(held ?? ""), `${at} the roster's one notice (what is wrong, the age of what is shown, the acts held, Retry), every field and Spawn off with the acts' own reason, and no second notice`, held ?? (await whole(page)));
      // A press, by the button or by the key, starts nothing.
      await page.evaluate(`${SPAWN}.click()`);
      await page.evaluate(MOD_ENTER);
      // An absence is not read at once: the form is given the time a press takes to show (the button reads "Spawning…" in the same tick), and must not have moved.
      const moved = await page.until(`!location.pathname.startsWith(${JSON.stringify(FORM)}) || ${SPAWN}.innerText.trim() !== "Spawn" ? JSON.stringify({ path: location.pathname, button: ${SPAWN}.innerText.trim() }) : ""`, 2);
      check(!moved, `${at} and a press starts nothing`, String(moved));
      await page.shot(`spawn-${viewport.name}-held`, { targets: true });
    },
  },
  {
    stage: "pages-default",
    name: "the release's default pages: New agent is in the sidebar and on the home, and each opens the form, its first field the soul",
    run: async ({ page, at, viewport, check }) => {
      await page.goto("/");
      check(await showSidebar(page, viewport), `${at} the thread list is the OATS sidebar`);
      const there = await page.until(`${visible(testId("oats-new-agent"))} && document.querySelector(${q("oats-sidebar")}).querySelector(${q("oats-tree")}) !== null && !document.querySelector('[data-testid^="oats-page-link-"]') && ${textOf(testId("oats-new-agent"))}`, 30);
      check(there === "New agent", `${at} with only the home shown, New agent is in the sidebar, on screen, with no page link beside it`, there ?? (await page.evaluate(textOf(testId("oats-sidebar")))));
      await page.evaluate(click(testId("oats-new-agent")));
      const opened = await page.until(`${visible(testId("oats-spawn-form"))} && ${SOULS_READ} && JSON.stringify({ path: location.pathname, first: ${FIRST}, shown: document.querySelector(${q("oats-page-not-shown")}) === null })`, 30);
      check(opened === JSON.stringify({ path: "/plugins/oats/new-agent", first: "oats-spawn-soul", shown: true }), `${at} it opens the form's own page, the soul field first: the form is not one of the pages a release leaves out`, opened ?? (await page.evaluate("document.body.innerText.slice(0, 300)")));
      // At a phone's width bb's sidebar is in its drawer, and the form opened from it is the picture the form's own
      // stage takes there (spawn-390x800-empty): the two were the same image in some runs and not in others (a drawer
      // still closing), and the run refuses two images that are the same. The checks above hold it; the image is the
      // desktop's, where the sidebar stands beside the form.
      if (!viewport.mobile) await page.shot(`pages-default-${viewport.name}-new-agent`, { targets: true });
      // And on the home, which is what a person sees at a phone's width (bb's sidebar is in a drawer there): New agent is in
      // the home's heading, can be pressed, and opens the same page. The checks hold it in the page; no image is taken here
      // (the home's own image of this stage is of its summary and its one tile, further down), and where the press lands
      // is the image above.
      await page.goto("/plugins/oats/home");
      // Read once the home itself says the default has drawn: its tiles are the Agents tile alone, counted (as the home's own
      // scene of this stage waits). The button is drawn under every value of `pages`, so alone it would say nothing of them.
      const HOME = `(() => { const b = document.querySelector(${q("oats-home-new-agent")}); return JSON.stringify({ words: b?.innerText.trim() ?? null, off: b?.disabled ?? null, tiles: [...document.querySelectorAll(${q("oats-home-tiles")} + " button")].map((tile) => tile.getAttribute("data-testid")), links: document.querySelectorAll('[data-testid^="oats-page-link-"]').length }); })()`;
      const onHome = await page.until(`${visible(testId("oats-home-new-agent"))} && (() => { const tiles = [...document.querySelectorAll(${q("oats-home-tiles")} + " button")]; return tiles.length === 1 && /\\d$/.test(tiles[0].innerText.trim()); })() && ${HOME}`, 30);
      check(onHome === JSON.stringify({ words: "New agent", off: false, tiles: ["oats-tile-agents"], links: 0 }), `${at} with only the home shown (its one tile is Agents), New agent is on the home too, on screen and pressable`, onHome ?? (await page.evaluate(HOME)));
      await page.evaluate(click(testId("oats-home-new-agent")));
      // The form takes the focus in an effect after it is drawn: the wait is for the focus too, and a wait that ends without it prints where it was.
      const LANDED = `JSON.stringify({ path: location.pathname, first: document.querySelector(${q("oats-spawn-form")}) ? ${FIRST} : null, focus: ${FOCUSED}, shown: document.querySelector(${q("oats-page-not-shown")}) === null })`;
      const fromHome = await page.until(`${visible(testId("oats-spawn-form"))} && ${SOULS_READ} && ${FOCUSED} === "oats-spawn-soul" && ${LANDED}`, 30);
      check(fromHome === JSON.stringify({ path: "/plugins/oats/new-agent", first: "oats-spawn-soul", focus: "oats-spawn-soul", shown: true }), `${at} pressed on the home, it opens the form's own page with the soul field first, and in focus`, fromHome ?? (await page.evaluate(LANDED)));
    },
  },
];

// ---- the stages: what the fake `oats` answers while the form's scenes run. Every answer is one
// the real kernel printed (test/fixtures/spawn/README.md), whole; the two changes a stage makes are
// how long an answer takes, and, in the spawn's answer, the id of the bb thread (the fixture
// threads of a live run have ids of their own, as in the status every stage answers).
const settled = (untilSnapshot) => untilSnapshot((snapshot) => snapshot.ok === true);
const NAMED = { file: "spawn/spawn-preview-named.json" };
/** The kernel's answer of a spawn, with the thread it names set to one bb has in this run. */
const spawnedOn = (thread) => {
  const answer = JSON.parse(read(join(FIXTURES, "spawn.json"), "utf8"));
  answer.result.session.endpoint.threadId = thread.id;
  return JSON.stringify(answer);
};
const stage = (label, verbs) => ({
  label,
  enter: async ({ fake, statusWithRealIds, threads, untilSnapshot }) => {
    fake({ status: { stdout: statusWithRealIds(threads) }, "spawn --preview": NAMED, ...verbs(threads) });
    await settled(untilSnapshot);
  },
});
/**
 * A spawn the kernel refused and could not roll back completely. SHAPED, not recorded: a rollback
 * that fails cannot be made in the real run (the kernel's own removal of the home would have to
 * fail). It is the recorded refusal of a spawn on pi (spawn-pi-refused.json) with what the kernel
 * writes on that path instead of " — spawn rolled back" (awebai/oats lib/core.mjs at v0.70.5, the
 * note of line 5235 with the entry of 5234), and the marker `unconfirmedSpawn` sets (3863-3865).
 */
const rollbackIncomplete = () => {
  const answer = JSON.parse(read(join(FIXTURES, "spawn-pi-refused.json"), "utf8"));
  if (!answer.error.message.endsWith(" — spawn rolled back")) throw new Error("spawn-pi-refused.json no longer ends with the kernel's ' — spawn rolled back'");
  if (!answer.error.message.startsWith("form-pi-developer ")) throw new Error("spawn-pi-refused.json no longer leads with the instance it was recorded for");
  // (The recording is of another instance's spawn: the message names this scene's, as the kernel would.)
  answer.error.message = `${NAME} ${answer.error.message.slice("form-pi-developer ".length, -" — spawn rolled back".length)} — rollback INCOMPLETE, clean up manually: instance home /abs/deployment/agents/oats-developer/instances/${NAME}: still present`;
  answer.error.details = { ...answer.error.details, unconfirmed: true };
  return JSON.stringify(answer);
};
/**
 * The preview of a harness the person chose, for which the kernel resolves no model. SHAPED, not
 * recorded: the real run's bb has no pi to preview (the kernel refuses that preview from 0.70.1:
 * spawn-preview-pi-refused.json). It is the recorded preview of the form filled
 * (spawn-preview-named.json: the soul's own launch, Claude Code and its model) with the harness
 * "pi" and no model in each place the kernel says them (`harness`, `model`, `modelSource`,
 * `launch.effective`, `decision.effective`), and `launch.from: "flag"`, the kernel's word for a
 * harness named on the call ("chosen for this spawn"): what OATS 0.70.0 answered `--harness pi` on
 * a soul that declares claude, as the first form's real run met it. The stage answers it only to
 * a preview that names a harness; one that names none gets the recorded answer.
 */
const noModel = () => {
  const answer = JSON.parse(read(join(FIXTURES, "spawn-preview-named.json"), "utf8"));
  const result = answer.result;
  if (result.harness !== "claude" || typeof result.model !== "string") throw new Error("spawn-preview-named.json no longer resolves claude with a model of the soul's");
  Object.assign(result, { harness: "pi", model: null, modelSource: null });
  result.launch = { ...result.launch, effective: { ...result.launch.effective, harness: "pi", model: null }, from: "flag" };
  result.decision.effective = { ...result.decision.effective, harness: "pi", model: null };
  return JSON.stringify(answer);
};
export const stages = {
  // The form's own stage: the preview the kernel printed for a named, independent agent (no warning: it gave none).
  "spawn-form": stage("SP0", () => ({})),
  // The same for a child of an agent of the roster.
  "spawn-related": stage("SP1", () => ({ "spawn --preview": { file: "spawn/spawn-preview-child.json" } })),
  // The kernel takes six seconds over a preview: long enough to see, and to press, while it reads.
  "spawn-slow": stage("SP2", () => ({ "spawn --preview": { ...NAMED, sleepMs: 6000 } })),
  // The kernel takes six seconds over the spawn, then answers it: the form in flight, then the agent's thread.
  "spawn-flight": stage("SP3", (threads) => ({ spawn: { stdout: spawnedOn(threads.get("thr_ci")), sleepMs: 6000 } })),
  // `oats spawn` ends with no answer (it prints nothing and fails): whether it made the agent is not known.
  "spawn-unknown": stage("SP4", () => ({ spawn: { stdout: "", stderr: "oats: killed\n", exit: 137 } })),
  // The kernel's own refusal of a preview whose name is an agent's.
  "spawn-name-taken": stage("SP5", () => ({ "spawn --preview": { file: "spawn/spawn-preview-name-taken.json" } })),
  // The kernel's own refusal of a preview whose model no harness has.
  "spawn-preview-refused": stage("SP7", () => ({ "spawn --preview": { file: "spawn/spawn-preview-model-refused.json" } })),
  // The preview answers; the apply is refused as the real kernel refuses a decision that moved.
  "spawn-refused": stage("SP6", () => ({ spawn: { file: "spawn/spawn-decision-stale.json" } })),
  // The preview answers; the apply is refused, and the kernel marks that it could not undo all of it.
  "spawn-unconfirmed": stage("SP8", () => ({ spawn: { stdout: rollbackIncomplete(), exit: 1 } })),
  // A preview that names a harness (the fake tells a verb by its flags) resolves that harness and no model; one that names none, the soul's own.
  "spawn-model-required": stage("SP9", () => ({ "spawn --preview --harness": { stdout: noModel() } })),
};
