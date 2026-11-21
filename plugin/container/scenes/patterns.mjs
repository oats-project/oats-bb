// The patterns' live scenes (the UX standard, sections 3 and 5): the pattern book
// (/plugins/oats/patterns) draws every pattern of app/ui.tsx in each of its states. Each scene
// asserts in the page what its image's name says, and the contrast and the target sizes are
// checked at every image (`targets: true` on each shot).
import { FOCUSED, testId, textOf, texts, visible } from "../browser.mjs";

const click = (id) => `document.querySelector(${JSON.stringify(testId(id))}).click()`;
const into = (id) => `document.querySelector(${JSON.stringify(testId(id))}).scrollIntoView({ block: "center" })`;
const STATES = [
  ["needs-you", "Needs you", "Needs input"],
  ["working", "Working", "running"],
  ["idle", "Idle", "status unknown"],
  ["stopped", "Stopped", "stopped"],
  ["error", "Failed", "failed"],
  ["unreachable", "Unreachable", "unreachable"],
];

export default [
  {
    stage: "fixtures",
    name: "every state: its mark and its word, and the name a screen reader says",
    run: async ({ page, at, viewport, check }) => {
      await page.goto("/plugins/oats/patterns");
      check(Boolean(await page.until(visible(testId("oats-patterns-states")), 30)), `${at} the pattern book renders`);
      const drawn = JSON.parse(
        await page.evaluate(
          `JSON.stringify([...document.querySelectorAll('${testId("oats-patterns-state-list")} li')].map((li) => [li.querySelector('${testId("oats-state")}').getAttribute("data-state"), li.querySelector('${testId("oats-state")}').innerText.replace(/^!\\s*/, "").trim(), li.querySelector('[role="img"]').getAttribute("aria-label"), li.querySelector('${testId("oats-state")} [aria-hidden="true"]') !== null]))`,
        ),
      );
      check(JSON.stringify(drawn) === JSON.stringify(STATES.map((state) => [...state, true])), `${at} the six states: each a mark and its word, the mark beside the word hidden from a screen reader, the lone mark named`, JSON.stringify(drawn));
      const lines = await page.evaluate(texts(testId("oats-status-line")));
      check(lines[0] === "! Needs you · waiting 27 min (since 14:03) · Asked you a question Open" && lines[1] === "Working", `${at} the status line: the word, since when, the reason, the act`, JSON.stringify(lines));
      await page.shot(`patterns-${viewport.name}-states`, { targets: true });
    },
  },
  {
    stage: "fixtures",
    name: "notices, empty, loading, stale, results",
    run: async ({ page, at, viewport, check }) => {
      await page.evaluate(into("oats-patterns-notices"));
      const notices = JSON.parse(await page.evaluate(`JSON.stringify([...document.querySelectorAll('${testId("oats-notice")}')].map((e) => [e.getAttribute("data-tone"), e.getAttribute("role"), e.querySelector("h3").innerText]))`));
      check(
        JSON.stringify(notices) === JSON.stringify([["info", "status", "No OATS deployment is set"], ["warning", "status", "OATS is older than this plugin needs"], ["error", "alert", "OATS could not be read"]]),
        `${at} the three notices: each titled, the failure an alert`,
        JSON.stringify(notices),
      );
      const stale = await page.evaluate(texts(testId("oats-stale")));
      check(stale[0].startsWith("Showing what was read 2 min ago.") && stale[1] === "Refreshing… showing what was read just now.", `${at} the stale line says the age of what is shown, and a re-read in flight`, JSON.stringify(stale));
      const empty = await page.evaluate(textOf(testId("oats-empty")));
      const loading = JSON.parse(await page.evaluate(`JSON.stringify({ role: document.querySelector('${testId("oats-loading")}').getAttribute("role"), words: ${textOf(testId("oats-loading"))} })`));
      check(empty === "No agents yet. New agent" && loading.role === "status" && loading.words === "Reading your agents…", `${at} the empty state says its sentence with the act that fills it, and the loading state is announced with its words`, JSON.stringify([empty, loading]));
      // The kernel's own message is one press away, under Details.
      const details = JSON.parse(await page.evaluate(`JSON.stringify({ open: document.querySelector('${testId("oats-notice-details")}').open, summary: ${textOf(`${testId("oats-notice-details")} summary`)} })`));
      check(details.open === false && /^▸\s?Details$/.test(details.summary), `${at} a notice keeps the kernel's message under Details, closed`, JSON.stringify(details));
      await page.shot(`patterns-${viewport.name}-notices`, { targets: true });
      await page.evaluate(`document.querySelectorAll('${testId("oats-result")}')[1].scrollIntoView({ block: "center" })`);
      const results = JSON.parse(await page.evaluate(`JSON.stringify([...document.querySelectorAll('${testId("oats-result")}')].map((e) => [e.getAttribute("data-tone"), e.getAttribute("role")]))`));
      check(JSON.stringify(results) === JSON.stringify([["done", "status"], ["failed", "alert"], ["unknown", "alert"]]), `${at} the three results: done, failed, not known`, JSON.stringify(results));
      await page.shot(`patterns-${viewport.name}-results`, { targets: true });
    },
  },
  {
    stage: "fixtures",
    name: "a section, cards, tags, a disclosure open, code, switches off and disabled",
    run: async ({ page, at, viewport, check }) => {
      await page.evaluate(into("oats-patterns-blocks"));
      const blocks = JSON.parse(
        await page.evaluate(
          `JSON.stringify({ heading: ${textOf(`${testId("oats-section")} h2`)}, cards: [...document.querySelectorAll('${testId("oats-patterns-blocks")} section[aria-label]')].map((e) => e.getAttribute("aria-label")), tags: [...document.querySelectorAll('${testId("oats-patterns-blocks")} [data-tone]')].map((e) => e.getAttribute("data-tone") + ":" + e.innerText), code: document.querySelector('${testId("oats-patterns-blocks")} code').innerText, switches: [...document.querySelectorAll('${testId("oats-patterns-blocks")} [role="switch"]')].map((e) => [e.getAttribute("aria-checked"), e.disabled, e.getAttribute("aria-label")]) })`,
        ),
      );
      check(
        /^runs 2$/i.test(blocks.heading) && JSON.stringify(blocks.cards) === JSON.stringify(["Weekly digest", "Nightly sweep"]) && JSON.stringify(blocks.tags) === JSON.stringify(["plain:default", "muted:workspace", "warn:wrong account"]) && blocks.code === "oats schedule run weekly-digest" && JSON.stringify(blocks.switches) === JSON.stringify([["false", false, null], ["true", true, "workspace/sweep enabled on this computer"]]),
        `${at} a section with its count, two titled cards (one that needs a look), the three tags, a kernel's word as code, a switch that is off and one that is disabled and named for its row`,
        JSON.stringify(blocks),
      );
      // The disclosure in the card's second part opens with the keyboard.
      await page.evaluate(`document.querySelector('${testId("oats-patterns-blocks")} summary').focus()`);
      await page.press("Enter");
      const open = await page.evaluate(`document.querySelector('${testId("oats-patterns-blocks")} details').open`);
      check(open === true, `${at} Enter on a disclosure's summary opens it`);
      await page.shot(`patterns-${viewport.name}-blocks`, { targets: true });
    },
  },
  {
    stage: "fixtures",
    name: "the controls, the menu open, the form",
    run: async ({ page, at, viewport, check }) => {
      await page.evaluate(into("oats-patterns-controls"));
      // The tabs: the arrow keys move the selection and the focus.
      await page.evaluate(`document.querySelector('${testId("oats-tab-schedules")}').focus()`);
      await page.press("ArrowRight");
      const tabs = JSON.parse(await page.evaluate(`JSON.stringify({ selected: [...document.querySelectorAll('[role="tab"]')].map((e) => e.getAttribute("aria-selected")), focus: ${FOCUSED} })`));
      check(JSON.stringify(tabs.selected) === '["false","true","false"]' && tabs.focus === "oats-tab-triggers", `${at} Right on the tabs selects the next tab and moves the focus to it`, JSON.stringify(tabs));
      await page.shot(`patterns-${viewport.name}-controls`, { targets: true });
      // The row's menu, open: its button is named, the focus is on its first item, an item that is off says why.
      await page.evaluate(`document.querySelector('${testId("oats-menu")} button').focus()`);
      await page.press("Enter");
      const menu = JSON.parse(
        await page.evaluate(`JSON.stringify({ button: document.querySelector('${testId("oats-menu")} button').getAttribute("aria-label"), expanded: document.querySelector('${testId("oats-menu")} button').getAttribute("aria-expanded"), items: ${texts('[role="menuitem"]')}, focus: ${FOCUSED} })`),
      );
      check(
        menu.button === "Actions for Weekly digest helper" && menu.expanded === "true" && JSON.stringify(menu.items) === JSON.stringify(["Run now", "Edit… Defined in the workspace file.", "Remove…"]) && menu.focus === "oats-menu-item-run",
        `${at} the menu is open: named for its row, its three items, the focus on the first`,
        JSON.stringify(menu),
      );
      await page.shot(`patterns-${viewport.name}-menu-open`, { targets: true });
      await page.press("Escape");
      const closed = await page.evaluate(`JSON.stringify({ menu: document.querySelector('[role="menu"]') === null, focus: ${FOCUSED} })`);
      check(closed === JSON.stringify({ menu: true, focus: "Actions for Weekly digest helper" }), `${at} Escape closes the menu and the focus is back on its button`, closed);
      await page.evaluate(into("oats-patterns-form"));
      // Each control's accessible name is its label's own words; the hint and the refusal describe it.
      const form = JSON.parse(
        await page.evaluate(
          `JSON.stringify([...document.querySelectorAll('${testId("oats-field")}')].map((field) => { const control = field.querySelector("input, textarea, select"); const said = (control.getAttribute("aria-describedby") ?? "").split(" ").filter(Boolean).map((id) => document.getElementById(id)?.innerText ?? ""); return { name: control.labels[0]?.innerText, described: said, invalid: control.getAttribute("aria-invalid") }; }))`,
        ),
      );
      check(
        JSON.stringify(form) ===
          JSON.stringify([
            { name: "Opening instruction · optional", described: ["What this agent is for."], invalid: null },
            { name: "Name · optional", described: ["Lower-case letters, digits and dashes; starts with a letter or a digit; 63 characters at most."], invalid: "true" },
          ]) && (await page.evaluate(textOf(testId("oats-disabled-reason")))) === "Reading what will be created…",
        `${at} the form: each control is named by its label alone ("· optional" where it is), described by its hint or its refusal, invalid with a refusal; a button that is off has its reason beside it`,
        JSON.stringify(form),
      );
      await page.shot(`patterns-${viewport.name}-form`, { targets: true });
    },
  },
  {
    stage: "fixtures",
    name: "a confirmation: before the act, in progress, done, refused, and another agent's plan; its focus order",
    run: async ({ page, at, viewport, check }) => {
      const dialog = () => page.evaluate(`JSON.stringify({ title: ${textOf(`${testId("oats-modal")} h2`)}, about: document.querySelector('${testId("oats-confirm")}')?.getAttribute("data-about"), phase: document.querySelector('${testId("oats-confirm")}')?.getAttribute("data-phase"), body: ${textOf(testId("oats-confirm"))}, focus: ${FOCUSED} })`);
      await page.evaluate(into("oats-patterns-dialogs"));
      await page.evaluate(`document.querySelector('${testId("oats-patterns-open-retire")}').focus()`);
      await page.press("Enter");
      await page.until(visible(testId("oats-confirm")), 10);
      const before = JSON.parse(await dialog());
      check(
        before.title === "Retire Weekly digest helper?" && before.about === "weekly-digest-helper" && before.phase === "ready" && /what will happen/i.test(before.body) && /what is kept/i.test(before.body) && before.focus === "oats-confirm-cancel",
        `${at} the confirmation before the act: titled with the act and the agent, what will happen, what is kept, the focus on Cancel (it is destructive)`,
        JSON.stringify(before),
      );
      // The focus order: it stays in the dialog, and goes round.
      const order = [];
      for (let stop = 0; stop < 3; stop += 1) {
        await page.press("Tab");
        order.push(await page.evaluate(FOCUSED));
      }
      check(JSON.stringify(order) === JSON.stringify(["oats-confirm-act", "oats-confirm-cancel", "oats-confirm-act"]), `${at} Tab walks Cancel, Retire and round again: the focus stays in the dialog`, JSON.stringify(order));
      await page.shot(`patterns-${viewport.name}-confirm-before`, { targets: true });
      await page.press("Enter"); // Retire
      const running = JSON.parse(await dialog());
      await page.press("Escape");
      const still = JSON.parse(await dialog());
      check(running.phase === "running" && running.body.includes("Retiring…") && still.phase === "running", `${at} the act in progress: the dialog says so, and Escape does not close it`, JSON.stringify([running, still]));
      // Nothing in the dialog can be pressed while the act runs: Tab and Shift+Tab leave the focus on the dialog.
      await page.press("Tab");
      const tabbed = await page.evaluate(`document.activeElement?.getAttribute("role")`);
      await page.press("Shift+Tab");
      const back = await page.evaluate(`document.activeElement?.getAttribute("role")`);
      check(tabbed === "dialog" && back === "dialog", `${at} while the act runs Tab and Shift+Tab keep the focus on the dialog`, JSON.stringify([tabbed, back]));
      await page.shot(`patterns-${viewport.name}-confirm-running`, { targets: true });
      await page.evaluate(`window.dispatchEvent(new CustomEvent("oats-patterns", { detail: "done" }))`);
      await page.until(`document.querySelector('${testId("oats-confirm")}')?.getAttribute("data-phase") === "done"`, 10);
      const done = JSON.parse(await dialog());
      check(done.phase === "done" && done.body.includes("Weekly digest helper was retired.") && !/what will happen/i.test(done.body) && done.focus === "oats-confirm-close", `${at} after the act: the result in the plan's place, and the focus on Close`, JSON.stringify(done));
      await page.shot(`patterns-${viewport.name}-confirm-done`, { targets: true });
      await page.evaluate(click("oats-confirm-close"));
      const opener = await page.until(`document.querySelector('${testId("oats-modal")}') === null && ${FOCUSED}`, 10);
      check(opener === "oats-patterns-open-retire", `${at} Close returns the focus to the button that opened the dialog`, String(opener));
      // A refusal: a person's words, then the kernel's code and message, each line whole.
      await page.press("Enter");
      await page.until(visible(testId("oats-confirm")), 10);
      await page.evaluate(click("oats-confirm-act"));
      await page.evaluate(`window.dispatchEvent(new CustomEvent("oats-patterns", { detail: "failed" }))`);
      await page.until(`document.querySelector('${testId("oats-confirm")}')?.getAttribute("data-phase") === "failed"`, 10);
      const refused = JSON.parse(await dialog());
      check(refused.phase === "failed" && refused.body.includes("Weekly digest helper could not be retired.") && refused.body.includes("E_CHILDREN_RUNNING: a child would not stop") && refused.body.includes("Review again"), `${at} a refusal: what happened in words, the kernel's code and message after, the next step`, JSON.stringify(refused));
      // The refused dialog's stops, in order: the next step, Details, Close, and round again.
      const walked = [];
      for (let stop = 0; stop < 4; stop += 1) {
        await page.press("Tab");
        walked.push(await page.evaluate(`document.activeElement?.tagName === "SUMMARY" ? "Details" : ${FOCUSED}`));
      }
      check(JSON.stringify(walked) === JSON.stringify(["Review again", "Details", "oats-confirm-close", "Review again"]), `${at} Tab in the refused dialog walks Review again, Details, Close and round again: a disclosure is a stop, and the focus stays in the dialog`, JSON.stringify(walked));
      await page.shot(`patterns-${viewport.name}-confirm-refused`, { targets: true });
      await page.evaluate(click("oats-confirm-close"));
      // Another agent's plan is never shown under this agent's name.
      await page.evaluate(click("oats-patterns-open-other"));
      await page.until(visible(testId("oats-confirm")), 10);
      const other = JSON.parse(await dialog());
      const off = await page.evaluate(`document.querySelector('${testId("oats-confirm-act")}').disabled`);
      check(other.body.includes("This is not the plan for this agent.") && !/what will happen/i.test(other.body) && off === true, `${at} a plan that is another agent's is not shown, and cannot be confirmed`, JSON.stringify(other));
      await page.shot(`patterns-${viewport.name}-confirm-other-agent`, { targets: true });
      await page.press("Escape");
      // The other states of a confirmation: the plan being read, blocked with its reason, a plan that names no agent, and one that is not destructive.
      for (const [opener, name, holds] of [
        ["oats-patterns-open-reading", "reading", (d) => d.phase === "reading" && d.body.includes("Reading the plan from OATS…") && d.off === true],
        ["oats-patterns-open-blocked", "blocked", (d) => d.phase === "ready" && d.reason === "Tick the box to discard its work." && d.off === true],
        ["oats-patterns-open-unnamed", "unnamed", (d) => d.phase === "ready" && d.reason === "OATS did not say which agent this plan is for." && d.off === true],
        ["oats-patterns-open-stop", "stop", (d) => d.title === "Stop Weekly digest helper?" && d.phase === "ready" && d.off === false && d.focus === "oats-confirm-act"],
      ]) {
        await page.evaluate(`document.querySelector('${testId(opener)}').focus()`);
        await page.press("Enter");
        await page.until(visible(testId("oats-confirm")), 10);
        const state = JSON.parse(await page.evaluate(`JSON.stringify({ title: ${textOf(`${testId("oats-modal")} h2`)}, phase: document.querySelector('${testId("oats-confirm")}').getAttribute("data-phase"), body: ${textOf(testId("oats-confirm"))}, reason: document.querySelector('${testId("oats-confirm-blocked")}')?.innerText ?? null, off: document.querySelector('${testId("oats-confirm-act")}').disabled, focus: ${FOCUSED} })`));
        check(holds(state), `${at} a confirmation, ${name}: ${name === "stop" ? "not destructive, the focus starts on the act" : "it cannot be confirmed, and says why"}`, JSON.stringify(state));
        await page.shot(`patterns-${viewport.name}-confirm-${name}`, { targets: true });
        await page.press("Escape");
        await page.until(`document.querySelector('${testId("oats-modal")}') === null`, 10);
      }
    },
  },
];
