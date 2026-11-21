// The home's live scenes: the page with its three sections, and the reply box.
import { fill, testId, visible } from "../browser.mjs";

export default [
  {
    stage: "fixtures",
    name: "the home page and its reply box",
    run: async ({ page, at, viewport, check }) => {
      // the home page
      await page.goto("/plugins/oats/home");
      check(Boolean(await page.until(visible(testId("oats-needs-card")), 30)), `${at} the home page renders`);
      const sections = await page.evaluate(`["needs", "working", "finished"].map((s) => document.querySelector('[data-testid="oats-home-' + s + '"] h2')?.innerText.replace(/\\s+/g, " ").trim())`);
      check(/^needs you 3$/i.test(sections[0] ?? "") && /^working 2$/i.test(sections[1] ?? ""), `${at} the home's counts: Needs you 3, Working 2`, JSON.stringify(sections));
      await page.shot(`a13-${viewport.name}-home`);
      // the reply box, with a message typed: its fields, and Send enabled
      await page.evaluate(fill(testId("oats-reply-text"), "Keep depth 6 and sweep lr."));
      check(Boolean(await page.until(`document.querySelector(${JSON.stringify(testId("oats-reply-send"))})?.disabled === false`, 10)), `${at} a typed message enables Send`);
      await page.evaluate(`document.querySelector(${JSON.stringify(testId("oats-reply-send"))}).scrollIntoView({ block: "center" })`);
      await page.shot(`a13-${viewport.name}-home-reply`);
    },
  },
];
