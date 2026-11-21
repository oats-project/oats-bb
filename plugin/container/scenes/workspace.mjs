// The workspace's live scenes: the four pages, a soul's own page, and a soul's agent whose thread
// bb does not have.
import { testId, textOf, visible } from "../browser.mjs";

export default [
  {
    stage: "fixtures",
    name: "the four pages",
    run: async ({ page, at, viewport, check }) => {
      // the four pages
      const pages = [
        ["souls", "oats-soul-row", "Souls"],
        ["capabilities", "oats-capability-row", "Capabilities"],
        ["teams", "oats-team-row", "Teams"],
        ["machines", "oats-machine-row", "Machines"],
      ];
      for (const [path, row, title] of pages) {
        await page.goto(`/plugins/oats/${path}`);
        const drawn = await page.until(visible(testId(row)), 30);
        const n = await page.evaluate(`document.querySelectorAll(${JSON.stringify(testId(row))}).length`);
        check(Boolean(drawn) && n > 0, `${at} ${title} renders (${n} rows)`);
        await page.shot(`a13-${viewport.name}-${path}`);
      }
    },
  },
  {
    stage: "fixtures",
    name: "a soul's own page",
    run: async ({ page, at, viewport, check }) => {
      // a soul's own page: at phone width the detail replaces the list
      await page.goto("/plugins/oats/souls/oats-developer");
      check(Boolean(await page.until(visible(testId("oats-soul-detail")), 30)), `${at} a soul's page renders, with the spawn form`, await page.evaluate(textOf(testId("oats-souls-page"))));
      check((await page.evaluate(visible(testId("oats-soul-row")))) === !viewport.mobile, `${at} ${viewport.mobile ? "the list gives way to the soul, with Back" : "the list stays beside the soul"}`);
      await page.shot(`a13-${viewport.name}-soul`);
      // a package soul's key has a slash: its row opens its own page too
      await page.goto("/plugins/oats/souls");
      await page.until(visible(testId("oats-soul-row")), 30);
      const key = await page.evaluate(
        `(() => { const row = [...document.querySelectorAll(${JSON.stringify(testId("oats-soul-row"))})].find((e) => e.innerText.includes("/")); row?.click(); return row?.querySelector("span")?.innerText ?? null; })()`,
      );
      const heading = key === null ? "" : await page.until(`(() => { const t = ${textOf(`${testId("oats-soul-detail")} h2`)}; return t === ${JSON.stringify(key)} ? t : ""; })()`, 15);
      check(key !== null && heading === key, `${at} a package soul's row opens its page (${key})`, await page.evaluate("location.pathname + ' | ' + document.body.innerText.slice(0, 200)"));
    },
  },
  {
    stage: "detached",
    name: "a soul's agent whose thread bb does not have",
    run: async ({ page, at, viewport, check }) => {
      await page.goto("/plugins/oats/souls/oats-developer");
      const line = await page.until(`(() => { const t = ${textOf(testId("oats-soul-agent-detached"))}; return t.includes("flaky-ci-developer") ? t : ""; })()`, 30);
      check(Boolean(line) && /thread missing/.test(line), `${at} the soul's page says "thread missing" for the agent whose thread bb does not have`, line ?? (await page.evaluate(textOf(testId("oats-souls-page")))));
      await page.shot(`a16-${viewport.name}-soul`);
    },
  },
];
