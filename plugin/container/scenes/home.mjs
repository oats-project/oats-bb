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
  {
    stage: "fixtures",
    name: "freshness: a change the kernel records is on the home within 3 s",
    run: async ({ page, at, check, record }) => {
      await page.goto("/plugins/oats/home");
      const working = (n) => `/^working ${n}$/i.test((document.querySelector('${testId("oats-home-working")} h2')?.innerText ?? "").replace(/\\s+/g, " ").trim())`;
      check(Boolean(await page.until(working(2), 30)), `${at} before the change the home lists 2 working agents`);
      const stopped = record({ "redesign-ui-lead": { running: false, runtimeState: "stopped" } });
      const shown = (await page.until(working(1), 15)) ? Date.now() - stopped : null;
      check(shown !== null && shown <= 3000, `${at} the home lists 1 working agent ${shown === null ? "never" : `${shown} ms`} after the kernel recorded the stop (3 s at most)`);
      const back = record();
      const again = (await page.until(working(2), 15)) ? Date.now() - back : null;
      check(again !== null && again <= 3000, `${at} and 2 again ${again === null ? "never" : `${again} ms`} after the kernel recorded that (3 s at most)`);
    },
  },
];
