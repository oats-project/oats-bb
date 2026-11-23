// The patterns' live scenes (the UX standard, sections 3 and 5): the pattern book
// (/plugins/oats/patterns) draws every pattern of app/ui.tsx in each of its states. Each scene
// asserts in the page what its image's name says, and the contrast and the target sizes are
// checked at every image (`targets: true` on each shot).
import { FOCUSED, testId, textOf, texts, visible } from "../browser.mjs";

// A pattern, read INSIDE the pattern book only. The same patterns are drawn around it (the sidebar
// says "Reading OATS…" under the id "oats-status-line" until its first read answers, and the
// instance panel, when it is open, has a status line, notices and tabs of its own), so a read of
// the whole document takes whichever comes first in it, which depends on when the read runs.
// A dialog and an open menu's list are inside the page too (drawn over it, with no portal); they are
// read by ids and roles that nothing else in the document carries while the book is open.
const book = (id) => `${testId("oats-patterns-page")} ${testId(id)}`;
const click = (id) => `document.querySelector(${JSON.stringify(testId(id))}).click()`;
const into = (id) => `document.querySelector(${JSON.stringify(testId(id))}).scrollIntoView({ block: "center" })`;
const STATES = [
  ["needs-you", "Needs you", "Needs input"],
  ["working", "Working", "running"],
  ["idle", "Idle", "status unknown"],
  ["stopped", "Stopped", "stopped"],
  ["error", "Failed", "failed"],
  ["unreachable", "Unreachable", "unreachable"],
  // A session OATS lost to an act in bb (the outside feature: README, "Outside OATS").
  ["archived", "Archived in bb", "archived in bb"],
  ["deleted", "Deleted in bb", "deleted in bb"],
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
      check(JSON.stringify(drawn) === JSON.stringify(STATES.map((state) => [...state, true])), `${at} the eight states: each a mark and its word, the mark beside the word hidden from a screen reader, the lone mark named`, JSON.stringify(drawn));
      const lines = await page.evaluate(texts(book("oats-status-line")));
      check(lines[0] === "! Needs you · waiting 27 min (since 14:03) · Asked you a question Open" && lines[1] === "Working", `${at} the status line: the word, since when, the reason, the act`, JSON.stringify(lines));
      await page.shot(`patterns-${viewport.name}-states`, { targets: true });
    },
  },
  {
    stage: "fixtures",
    name: "the harness can run a page at a given instant, and give the real clock back",
    run: async ({ page, at, check }) => {
      // page.clock(at): what a scene on recorded answers runs under, so that "3 h ago" is not the
      // age of the recording. Proven here on the page itself: the instant, the pace, a date built
      // from parts, and the real clock afterwards.
      const AT = "2026-11-21T20:21:00.000Z";
      try {
        await page.clock(AT);
        await page.goto("/plugins/oats/patterns");
        const first = JSON.parse(await page.evaluate(`JSON.stringify({ now: Date.now(), made: new Date().getTime(), fixed: new Date(2020, 0, 2, 3, 4).getFullYear(), parsed: new Date("2026-01-01T00:00:00.000Z").toISOString(), is: new Date() instanceof Date, bare: typeof Date(), cloned: structuredClone(new Date()) instanceof Date, name: Date.name })`));
        const near = (ms) => Math.abs(ms - Date.parse(AT)) < 60_000;
        check(near(first.now) && near(first.made) && first.fixed === 2020 && first.parsed === "2026-01-01T00:00:00.000Z" && first.is && first.bare === "string" && first.cloned && first.name === "Date", `${at} the page's clock starts at the instant asked for; a date built from parts or a string is itself, and Date is still a faithful Date (called bare, cloned, by name)`, JSON.stringify(first));
        const later = await page.evaluate(`new Promise((done) => setTimeout(() => done(Date.now()), 1200))`);
        check(later - first.now >= 1000 && later - first.now < 10_000, `${at} and goes on at the real pace`, String(later - first.now));
      } finally {
        await page.clock(null);
      }
      await page.goto("/plugins/oats/patterns");
      await page.until(visible(testId("oats-patterns-notices")), 30); // the next scenes read the pattern book as it is drawn
      const real = await page.evaluate(`Date.now()`);
      check(Math.abs(real - Date.now()) < 60_000, `${at} cleared, the next page has the real clock`, String(real - Date.now()));
    },
  },
  {
    stage: "fixtures",
    name: "notices, empty, loading, stale, results",
    run: async ({ page, at, viewport, check }) => {
      await page.evaluate(into("oats-patterns-notices"));
      const notices = JSON.parse(await page.evaluate(`JSON.stringify([...document.querySelectorAll('${book("oats-notice")}')].map((e) => [e.getAttribute("data-tone"), e.getAttribute("role"), e.querySelector("h3").innerText]))`));
      check(
        JSON.stringify(notices) === JSON.stringify([["info", "status", "No OATS deployment is set"], ["warning", "status", "OATS is older than this plugin needs"], ["error", "alert", "OATS could not be read"]]),
        `${at} the three notices: each titled, the failure an alert`,
        JSON.stringify(notices),
      );
      const stale = await page.evaluate(texts(book("oats-stale")));
      check(stale[0].startsWith("Showing what was read 2 min ago.") && stale[1] === "Refreshing… showing what was read just now.", `${at} the stale line says the age of what is shown, and a re-read in flight`, JSON.stringify(stale));
      const empty = await page.evaluate(textOf(book("oats-empty")));
      const loading = JSON.parse(await page.evaluate(`JSON.stringify({ role: document.querySelector('${book("oats-loading")}').getAttribute("role"), words: ${textOf(book("oats-loading"))} })`));
      check(empty === "No agents yet. New agent" && loading.role === "status" && loading.words === "Reading your agents…", `${at} the empty state says its sentence with the act that fills it, and the loading state is announced with its words`, JSON.stringify([empty, loading]));
      // The kernel's own message is one press away, under Details.
      const details = JSON.parse(await page.evaluate(`JSON.stringify({ open: document.querySelector('${book("oats-notice-details")}').open, summary: ${textOf(`${book("oats-notice-details")} summary`)} })`));
      check(details.open === false && /^▸\s?Details$/.test(details.summary), `${at} a notice keeps the kernel's message under Details, closed`, JSON.stringify(details));
      await page.shot(`patterns-${viewport.name}-notices`, { targets: true });
      await page.evaluate(`document.querySelectorAll('${book("oats-result")}')[1].scrollIntoView({ block: "center" })`);
      const results = JSON.parse(await page.evaluate(`JSON.stringify([...document.querySelectorAll('${book("oats-result")}')].map((e) => [e.getAttribute("data-tone"), e.getAttribute("role")]))`));
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
          `JSON.stringify({ heading: ${textOf(`${book("oats-section")} h2`)}, cards: [...document.querySelectorAll('${testId("oats-patterns-blocks")} section[aria-label]')].map((e) => e.getAttribute("aria-label")), tags: [...document.querySelectorAll('${testId("oats-patterns-blocks")} [data-tone]')].map((e) => e.getAttribute("data-tone") + ":" + e.innerText), code: document.querySelector('${testId("oats-patterns-blocks")} code').innerText, switches: [...document.querySelectorAll('${testId("oats-patterns-blocks")} [role="switch"]')].map((e) => [e.getAttribute("aria-checked"), e.disabled, e.getAttribute("aria-label")]) })`,
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
      await page.evaluate(`document.querySelector('${book("oats-tab-schedules")}').focus()`);
      await page.press("ArrowRight");
      const tabs = JSON.parse(await page.evaluate(`JSON.stringify({ selected: [...document.querySelectorAll('${testId("oats-patterns-page")} [role="tab"]')].map((e) => e.getAttribute("aria-selected")), focus: ${FOCUSED} })`));
      check(JSON.stringify(tabs.selected) === '["false","true","false"]' && tabs.focus === "oats-tab-triggers", `${at} Right on the tabs selects the next tab and moves the focus to it`, JSON.stringify(tabs));
      await page.shot(`patterns-${viewport.name}-controls`, { targets: true });
      // The row's menu, open: its button is named, the focus is on its first item, an item that is off says why.
      await page.evaluate(`document.querySelector('${book("oats-menu")} button').focus()`);
      await page.press("Enter");
      const menu = JSON.parse(
        await page.evaluate(`JSON.stringify({ button: document.querySelector('${book("oats-menu")} button').getAttribute("aria-label"), expanded: document.querySelector('${book("oats-menu")} button').getAttribute("aria-expanded"), items: ${texts('[role="menuitem"]')}, focus: ${FOCUSED} })`),
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
          `JSON.stringify([...document.querySelectorAll('${book("oats-field")}')].map((field) => { const control = field.querySelector("input, textarea, select"); const said = (control.getAttribute("aria-describedby") ?? "").split(" ").filter(Boolean).map((id) => document.getElementById(id)?.innerText ?? ""); return { name: control.labels[0]?.innerText, described: said, invalid: control.getAttribute("aria-invalid") }; }))`,
        ),
      );
      check(
        JSON.stringify(form) ===
          JSON.stringify([
            { name: "Opening instruction · optional", described: ["What this agent is for."], invalid: null },
            { name: "Name · optional", described: ["Lower-case letters, digits and dashes; starts with a letter or a digit; 63 characters at most."], invalid: "true" },
          ]) && (await page.evaluate(textOf(book("oats-disabled-reason")))) === "Reading what will be created…",
        `${at} the form: each control is named by its label alone ("· optional" where it is), described by its hint or its refusal, invalid with a refusal; a button that is off has its reason beside it`,
        JSON.stringify(form),
      );
      // The form's focus order: its fields in their order; the button that is off is no stop.
      await page.evaluate(`document.querySelector('${testId("oats-patterns-form")} textarea').focus()`);
      const fields = [await page.evaluate(`document.activeElement.labels?.[0]?.innerText ?? ""`)];
      await page.press("Tab");
      fields.push(await page.evaluate(`document.activeElement.labels?.[0]?.innerText ?? ""`));
      await page.press("Tab");
      const after = await page.evaluate(`document.activeElement?.closest('${testId("oats-patterns-form")}') === null`);
      check(JSON.stringify(fields) === JSON.stringify(["Opening instruction · optional", "Name · optional"]) && after === true, `${at} Tab walks the form's fields in their order and passes the button that is off`, JSON.stringify([fields, after]));
      await page.shot(`patterns-${viewport.name}-form`, { targets: true });
    },
  },
  {
    stage: "fixtures",
    name: "a menu opened at the page's lower left edge is whole on screen",
    run: async ({ page, at, viewport, check }) => {
      // The last thing on the page, at its left edge: under the button there is no room, nor to its
      // left, where the list hangs by default. The list takes the other edge and is brought into view.
      const button = `${testId("oats-patterns-edges")} ${testId("oats-menu")} button`;
      await page.evaluate(`document.querySelector(${JSON.stringify(button)}).focus()`);
      await page.press("Enter");
      const list = `document.querySelector(${JSON.stringify(`${testId("oats-patterns-edges")} [role="menu"]`)})`;
      const whole = `(() => { const e = ${list}; if (!e) return ""; const r = e.getBoundingClientRect(); const p = document.querySelector(${JSON.stringify(testId("oats-patterns-page"))}).getBoundingClientRect(); return r.width > 0 && r.left >= Math.max(0, p.left) && r.right <= Math.min(innerWidth, p.right) && r.top >= 0 && r.bottom <= innerHeight ? JSON.stringify({ edge: e.getAttribute("data-edge"), items: e.querySelectorAll('[role="menuitem"]').length, focus: ${FOCUSED} }) : ""; })()`;
      const seen = await page.until(whole, 10);
      const drawn = seen ? JSON.parse(seen) : null;
      check(
        drawn !== null && drawn.edge === "left" && drawn.items === 7 && drawn.focus === "oats-menu-item-Run now",
        `${at} the menu's seven items are all inside the page and the window, hung from the button's left edge, the focus on the first`,
        seen ?? (await page.evaluate(`(() => { const e = ${list}; if (!e) return "no menu"; const r = e.getBoundingClientRect(); return JSON.stringify({ left: r.left, right: r.right, top: r.top, bottom: r.bottom, innerWidth, innerHeight, edge: e.getAttribute("data-edge") }); })()`)),
      );
      await page.shot(`patterns-${viewport.name}-menu-at-the-edge`, { targets: true });
      await page.press("Escape");
      check(Boolean(await page.until(`${list} === null`, 10)), `${at} Escape closes it`);
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
        ["oats-patterns-open-checking", "checking", (d) => d.phase === "reading" && d.body.includes("Checking instance…") && !d.body.includes("Reading the plan") && d.off === true],
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
      // A result that is not confirmed: neither done nor failed, with its code after the words and the next step.
      await page.evaluate(`document.querySelector('${testId("oats-patterns-open-unknown")}').focus()`);
      await page.press("Enter");
      await page.until(visible(testId("oats-confirm")), 10);
      const unknown = JSON.parse(await page.evaluate(`JSON.stringify({ tone: document.querySelector('${testId("oats-confirm")} ${testId("oats-result")}')?.getAttribute("data-tone"), body: ${textOf(testId("oats-confirm"))}, focus: ${FOCUSED} })`));
      check(unknown.tone === "unknown" && unknown.body.includes("Result not confirmed") && unknown.body.indexOf("OATS_TIMEOUT") > unknown.body.indexOf("Check again before assuming") && unknown.body.includes("Check again") && unknown.focus === "oats-confirm-close", `${at} a result that is not confirmed is drawn as neither done nor failed: its words, the code after them, Check again, the focus on Close`, JSON.stringify(unknown));
      await page.shot(`patterns-${viewport.name}-confirm-not-confirmed`, { targets: true });
      await page.press("Escape");
      await page.until(`document.querySelector('${testId("oats-modal")}') === null`, 10);
      // A dialog that holds more than the window gives it: it says so above and below, and the room of
      // those two lines is kept, so that the body does not change height while it is scrolled.
      await page.evaluate(`document.querySelector('${testId("oats-patterns-open-long")}').focus()`);
      await page.press("Enter");
      await page.until(`${visible(testId("oats-confirm"))} && document.querySelector('${testId("oats-modal-below")}') !== null`, 10);
      const scrolled = `(() => { const body = document.querySelector('${testId("oats-modal-body")}'); return JSON.stringify({ height: body.clientHeight, above: document.querySelector('${testId("oats-modal-above")}')?.innerText ?? null, below: document.querySelector('${testId("oats-modal-below")}')?.innerText ?? null }); })()`;
      // Scrolls the body, WAITS for the lines the place should then say, and reads them with the body's height (what it read is printed when the wait fails).
      const scrollTo = async (top, above, below) => {
        await page.evaluate(`(() => { const body = document.querySelector('${testId("oats-modal-body")}'); body.scrollTop = ${top === "end" ? "body.scrollHeight" : top}; })()`);
        await page.until(`(() => { const read = JSON.parse(${scrolled}); return read.above === ${JSON.stringify(above)} && read.below === ${JSON.stringify(below)}; })()`, 10);
        return JSON.parse(await page.evaluate(scrolled));
      };
      const atTop = JSON.parse(await page.evaluate(scrolled));
      await page.shot(`patterns-${viewport.name}-confirm-long`, { targets: true });
      const atEnd = await scrollTo("end", "More above", null);
      const midway = await scrollTo(200, "More above", "More below");
      const again = await scrollTo(0, null, "More below");
      check(
        atTop.above === null && atTop.below === "More below" && atEnd.above === "More above" && atEnd.below === null && midway.above === "More above" && midway.below === "More below" && again.above === null && again.below === "More below",
        `${at} a dialog longer than the window says "More below" at its top, both in between, "More above" at its end, and "More below" again back at the top`,
        JSON.stringify({ atTop, midway, atEnd, again }),
      );
      check(new Set([atTop.height, atEnd.height, midway.height, again.height]).size === 1, `${at} its body keeps one height while it is scrolled: the two lines keep their room`, JSON.stringify([atTop.height, midway.height, atEnd.height, again.height]));
      await page.press("Escape");
      await page.until(`document.querySelector('${testId("oats-modal")}') === null`, 10);
      // A result through bb's own toaster (app/ui/notify.ts): `sonner` is bb's shim in the BUILT plugin, so the
      // toast is one bb draws. A result leaves by itself; a failure stays until it is dismissed.
      const toasts = `[...document.querySelectorAll("[data-sonner-toast]")].map((toast) => ({ text: toast.innerText.replace(/\\s+/g, " ").trim(), buttons: [...toast.querySelectorAll("button")].map((button) => button.innerText.trim()).filter((label) => label !== "") }))`;
      await page.evaluate(`document.querySelector('${testId("oats-patterns-notify-failed")}').click()`);
      await page.evaluate(`document.querySelector('${testId("oats-patterns-notify-done")}').click()`);
      const drawn = await page.until(`(() => { const all = ${toasts}; return all.length === 2 ? JSON.stringify(all) : null; })()`, 10);
      const both = drawn ? JSON.parse(drawn) : [];
      check(
        both.some((toast) => toast.text.startsWith("Weekly digest helper started.") && toast.buttons.includes("Open Weekly digest helper")) && both.some((toast) => toast.text.includes("Weekly digest helper wasn't started") && toast.text.includes("OATS refused this start as busy. Nothing was started.")),
        `${at} a result and a failure are told through bb's own toaster: the result with "Open <agent>", the failure with its sentence`,
        JSON.stringify(both),
      );
      await page.shot(`patterns-${viewport.name}-toasts`);
      const left = await page.until(`(() => { const all = ${toasts}; return all.length === 1 ? JSON.stringify(all) : null; })()`, 15);
      check(Boolean(left) && JSON.parse(left)[0].text.includes("wasn't started"), `${at} the result leaves by itself; the failure stays until it is dismissed`, String(left));
      await page.evaluate(`document.querySelector('[data-sonner-toast] button[aria-label="Dismiss notification"]')?.click()`);
      await page.until(`document.querySelectorAll("[data-sonner-toast]").length === 0`, 10);
    },
  },
];
