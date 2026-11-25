// The workspace's live scenes: the Workspace page and its four tabs (Souls, Capabilities, Teams,
// Machines), a soul's own page, and a soul's agent whose thread bb does not have. By the audit of
// the hidden pages and its ruling (25 Nov 2026).
import { testId, textOf, visible } from "../browser.mjs";

const q = (id) => JSON.stringify(testId(id));
/** The tab strip: each tab's words and whether it is the selected one. */
const TABS = `JSON.stringify([...document.querySelectorAll('[role="tab"]')].map((tab) => [tab.innerText.replace(/\\s+/g, " ").trim(), tab.getAttribute("aria-selected")]))`;
/**
 * The one-line texts of a list (`id`): each is ONE line high, nothing of it passes its row's edge,
 * and one that does not hold its whole text ends at a WORD with "…" (never mid-word): what stands
 * before the "…" is the start of the whole text (its title), and the whole text goes on with a
 * space or a mark there.
 */
const oneLines = (id) =>
  `JSON.stringify([...document.querySelectorAll(${q(id)})].map((line) => { const text = line.innerText.trim(); const whole = line.getAttribute("title") ?? ""; const box = line.getBoundingClientRect(); const cut = text.endsWith("…") && text !== whole; const kept = cut ? text.slice(0, -1) : text; return { text: text.slice(0, 60), oneLine: box.height > 0 && box.height < 2 * parseFloat(getComputedStyle(line).lineHeight || "20"), inside: line.scrollWidth <= line.clientWidth + 1, atWord: !cut || (whole.startsWith(kept) && /^[\\s,;:.()\\-]/.test(whole.slice(kept.length))) }; }).filter((line) => !(line.oneLine && line.inside && line.atWord)))`;
/** The sentences a tab must not hold any more (the audit's CUT rows), and the words that were nobody's. */
const GONE = /Pick a soul|This deployment|Servers OATS knows|saved instance routes|not mapped|thread missing|used by \d|in bb ·|elsewhere|Reading OATS|Spawn in bb/;

export default [
  {
    stage: "fixtures",
    name: "the Workspace page: its route opens the Souls tab; the strip holds the four tabs in the Desktop's order, Souls and Capabilities with their count; a press goes to a tab's own route",
    run: async ({ page, at, viewport, check }) => {
      await page.goto("/plugins/oats/workspace");
      check(Boolean(await page.until(visible(testId("oats-soul-row")), 30)), `${at} /plugins/oats/workspace draws the Souls tab`);
      const tabs = await page.until(`(() => { const now = ${TABS}; return /Souls \\d+/.test(now) && /Capabilities \\d+/.test(now) ? now : ""; })()`, 30);
      const read = JSON.parse(tabs || (await page.evaluate(TABS)));
      check(read.length === 4 && /^Souls \d+$/.test(read[0][0]) && /^Capabilities \d+$/.test(read[1][0]) && read[2][0] === "Teams" && read[3][0] === "Machines" && read.map((tab) => tab[1]).join() === "true,false,false,false", `${at} the strip: Souls and Capabilities with their count, Teams, Machines; Souls is the selected one`, JSON.stringify(read));
      // Nothing of the strip is cut, and it does not scroll sideways, at either width.
      const strip = JSON.parse(await page.evaluate(`(() => { const strip = document.querySelector(${q("oats-tabs")}); const last = [...strip.querySelectorAll('[role="tab"]')].at(-1).getBoundingClientRect(); return JSON.stringify({ fits: strip.scrollWidth <= strip.clientWidth + 1, last: last.right <= innerWidth }); })()`));
      check(strip.fits && strip.last, `${at} the four tabs fit the page's width: none is cut, and the strip does not scroll sideways`, JSON.stringify(strip));
      await page.evaluate(`document.querySelector(${q("oats-tab-teams")}).click()`);
      const onTeams = await page.until(`location.pathname.endsWith("/plugins/oats/teams") && document.querySelector(${q("oats-tab-teams")})?.getAttribute("aria-selected") === "true" && ${visible(testId("oats-team-row"))}`, 30);
      check(Boolean(onTeams), `${at} a press on Teams goes to its route, and its tab is the selected one`, await page.evaluate("location.pathname"));
    },
  },
  {
    stage: "fixtures",
    name: "the four tabs: rows, no sentence, a description on one line that ends at a word",
    run: async ({ page, at, viewport, check }) => {
      const tabs = [
        ["souls", "oats-soul-row", "Souls", "oats-soul-does"],
        ["capabilities", "oats-capability-row", "Capabilities", "oats-capability-does"],
        ["teams", "oats-team-row", "Teams", null],
        ["machines", "oats-machine-row", "Machines", null],
      ];
      for (const [path, row, title, line] of tabs) {
        await page.goto(`/plugins/oats/${path}`);
        const drawn = await page.until(visible(testId(row)), 30);
        const n = await page.evaluate(`document.querySelectorAll(${q(row)}).length`);
        check(Boolean(drawn) && n > 0, `${at} ${title} renders (${n} rows)`);
        const said = await page.evaluate(textOf(testId(`oats-${path}-page`)));
        check(!GONE.test(said), `${at} ${title} holds none of the sentences and words the audit cut`, said.slice(0, 400));
        if (line !== null) {
          // (The lines are measured once the page has laid them out: waited for, the first one says so by its width.)
          await page.until(`document.querySelector(${q(line)})?.clientWidth > 0`, 10);
          const wrong = JSON.parse(await page.evaluate(oneLines(line)));
          check(wrong.length === 0, `${at} ${title}: what each row does is ONE line, inside its row, and one that is cut ends at a word with "…"`, JSON.stringify(wrong.slice(0, 4)));
        }
        await page.shot(`a13-${viewport.name}-${path}`, { targets: true });
      }
      // Souls: in groups by where they come from, a package's soul by its own name under its group (its key whole in the row's title: nothing cut mid-word).
      await page.goto("/plugins/oats/souls");
      await page.until(visible(testId("oats-soul-row")), 30);
      const groups = JSON.parse(await page.evaluate(`JSON.stringify([...document.querySelectorAll(${q("oats-soul-group")})].map((group) => group.querySelector("h2")?.innerText.replace(/\\s+/g, " ").trim() ?? null))`));
      check(groups.length >= 2 && /^WORKSPACE \d+$/i.test(groups[0]) && groups.slice(1).every((heading) => /\d+$/.test(heading ?? "")), `${at} Souls: the workspace's own first, then each package with its version, each with its count`, JSON.stringify(groups));
      const names = JSON.parse(await page.evaluate(`JSON.stringify([...document.querySelectorAll(${q("oats-soul-name")})].map((name) => ({ text: name.innerText.trim(), whole: name.scrollWidth <= name.clientWidth + 1 })))`));
      check(names.length > 0 && names.every((name) => name.whole && !name.text.endsWith("…")), `${at} Souls: no soul's name is cut`, JSON.stringify(names.filter((name) => !name.whole || name.text.endsWith("…"))));
      // Capabilities: the core places first, and what capabilities are one press away, closed.
      await page.goto("/plugins/oats/capabilities");
      await page.until(visible(testId("oats-capability-row")), 30);
      const core = JSON.parse(await page.evaluate(`JSON.stringify([...document.querySelectorAll(${JSON.stringify(`${testId("oats-capabilities-core")} ${testId("oats-fact")}`)})].map((fact) => fact.querySelector("dt").innerText.trim()))`));
      const about = JSON.parse(await page.evaluate(`(() => { const fold = document.querySelector(${q("oats-capabilities-about")}); return JSON.stringify({ open: fold?.open ?? null, summary: fold?.querySelector("summary")?.innerText.replace(/\\s+/g, " ").trim() ?? null, folds: document.querySelectorAll(${JSON.stringify(`${testId("oats-capabilities-page")} details`)}).length }); })()`));
      check(JSON.stringify(core) === JSON.stringify(["Knowledge", "Messaging", "Tasks"]) && about.open === false && /About capabilities$/.test(about.summary ?? "") && about.folds === 1, `${at} Capabilities: the three core places first; what capabilities are is ONE fold, closed`, JSON.stringify({ core, about }));
    },
  },
  {
    stage: "fixtures",
    name: "a soul's own page: over the list with the way back, its facts, its capabilities and why, its agents as the roster says them, and New agent, which opens the form with that soul",
    run: async ({ page, at, viewport, check }) => {
      await page.goto("/plugins/oats/souls/oats-developer");
      check(Boolean(await page.until(visible(testId("oats-soul-detail")), 30)), `${at} a soul's page renders`, await page.evaluate(textOf(testId("oats-souls-page"))));
      const head = JSON.parse(await page.evaluate(`JSON.stringify({ list: document.querySelector(${q("oats-soul-row")}) !== null, tabs: document.querySelector(${q("oats-tabs")}) !== null, back: ${textOf(testId("oats-back"))}, key: ${textOf(`${testId("oats-soul-detail")} h2`)}, button: ${textOf(testId("oats-soul-new-agent"))}, off: document.querySelector(${q("oats-soul-new-agent")})?.disabled ?? null, fields: document.querySelectorAll(${JSON.stringify(`${testId("oats-souls-page")} input, ${testId("oats-souls-page")} textarea`)}).length })`));
      check(head.list === false && head.tabs === false && head.back === "← Souls" && head.key === "oats-developer" && head.button === "New agent" && head.off === false && head.fields === 0, `${at} the page is the soul's alone, at this width too: the way back, its key, ONE button "New agent", and no form of its own`, JSON.stringify(head));
      const facts = JSON.parse(await page.evaluate(`JSON.stringify([...document.querySelectorAll(${JSON.stringify(`${testId("oats-soul-detail")} ${testId("oats-fact")}`)})].map((fact) => fact.querySelector("dt").innerText.trim()))`));
      check(JSON.stringify(facts) === JSON.stringify(["Harness · model", "Teams"]), `${at} what its agents start with, and its teams`, JSON.stringify(facts));
      const capabilities = JSON.parse(await page.evaluate(`JSON.stringify([...document.querySelectorAll(${q("oats-soul-capability")})].map((row) => [...row.children].map((part) => part.innerText.trim())))`));
      check(capabilities.length > 0 && capabilities.every((row) => row.length >= 2) && capabilities.findIndex((row) => !row.includes("core")) >= capabilities.filter((row) => row.includes("core")).length, `${at} its capabilities are rows, the core ones first, each with why the soul has it`, JSON.stringify(capabilities));
      const agents = JSON.parse(await page.until(`(() => { const rows = [...document.querySelectorAll(${q("oats-soul-agent")})]; return rows.length === 0 ? "" : JSON.stringify(rows.map((row) => ({ where: row.getAttribute("data-where"), word: row.querySelector(${q("oats-state")})?.innerText.trim() ?? "", mark: row.querySelector(${JSON.stringify(`${testId("oats-state")} [data-mark]`)}) !== null }))); })()`, 30));
      check(agents.length === 2 && agents.every((agent) => agent.mark && agent.word !== ""), `${at} its agents are the roster's rows: each state a mark AND its word`, JSON.stringify(agents));
      const under = JSON.parse(await page.evaluate(`(() => { const fold = document.querySelector(${q("oats-soul-details")}); return JSON.stringify({ open: fold?.open ?? null, origin: /^from /.test(fold?.querySelector("p")?.textContent ?? ""), face: /github\\.com/.test(document.querySelector(${JSON.stringify(`${testId("oats-soul-detail")} header`)}).innerText) }); })()`));
      check(under.open === false && under.origin && under.face === false, `${at} where it is defined is under the page's one Details, closed, and not on its face`, JSON.stringify(under));
      await page.shot(`a13-${viewport.name}-soul`, { targets: true });
      // New agent: the form's own page, with this soul chosen.
      await page.evaluate(`document.querySelector(${q("oats-soul-new-agent")}).click()`);
      const form = await page.until(`location.pathname.endsWith("/plugins/oats/new-agent/oats-developer") && ${visible(testId("oats-spawn-form"))} ? location.pathname : ""`, 30);
      check(Boolean(form), `${at} New agent opens the New agent form with that soul chosen`, await page.evaluate("location.pathname"));
      // The way back from a soul's page, and a package soul: its row opens its own page by its key.
      await page.goto("/plugins/oats/souls");
      await page.until(visible(testId("oats-soul-row")), 30);
      const key = await page.evaluate(`(() => { const row = [...document.querySelectorAll(${q("oats-soul-row")})].find((each) => (each.getAttribute("title") ?? "").includes("/")); row?.click(); return row?.getAttribute("title") ?? null; })()`);
      const heading = key === null ? "" : await page.until(`(() => { const t = ${textOf(`${testId("oats-soul-detail")} h2`)}; return t === ${JSON.stringify(key)} ? t : ""; })()`, 15);
      check(key !== null && heading === key, `${at} a package soul's row opens its page (${key})`, await page.evaluate("location.pathname + ' | ' + document.body.innerText.slice(0, 200)"));
      await page.evaluate(`document.querySelector(${q("oats-back")}).click()`);
      check(Boolean(await page.until(`location.pathname.endsWith("/plugins/oats/souls") && ${visible(testId("oats-soul-row"))}`, 15)), `${at} "← Souls" goes back to the list`, await page.evaluate("location.pathname"));
    },
  },
  {
    stage: "detached",
    name: "a soul's agent whose thread bb does not have: what its row says elsewhere, with its acts",
    run: async ({ page, at, viewport, check }) => {
      await page.goto("/plugins/oats/souls/oats-expert");
      const row = `document.querySelector(${JSON.stringify(`${testId("oats-soul-agent")}[data-instance="weekly-digest-helper"]`)})`;
      const line = await page.until(`(() => { const t = (${row}?.innerText ?? "").replace(/\\s+/g, " ").trim(); return /Retire…/.test(t) ? t : ""; /* the agent by its one name, the instance as words */ })()`, 30);
      check(Boolean(line) && /Weekly digest helper/.test(line) && /(archived|deleted) in bb/.test(line) && !/thread missing/.test(line), `${at} the soul's page says of the agent whose thread bb does not have what the roster says of it ("archived in bb" or "deleted in bb"), with its acts`, line ?? (await page.evaluate(textOf(testId("oats-souls-page")))));
      await page.shot(`a16-${viewport.name}-soul`, { targets: true });
    },
  },
];
