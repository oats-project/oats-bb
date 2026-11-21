// The lifecycle's live scenes: Retire's plan dialog, opened from a soul's page.
import { testId, textOf, visible } from "../browser.mjs";

export default [
  {
    stage: "detached",
    name: "Retire opens the plan dialog with the kernel's plan",
    run: async ({ page, at, viewport, check }) => {
      await page.goto("/plugins/oats/souls/oats-developer");
      await page.until(visible(testId("oats-detached-retire")), 30);
      await page.evaluate(`document.querySelector(${JSON.stringify(testId("oats-detached-retire"))}).click()`);
      const plan = await page.until(`(() => { const lines = document.querySelectorAll(${JSON.stringify(`${testId("oats-plan")} li`)}); return lines.length > 0 && document.querySelector(${JSON.stringify(testId("oats-plan-confirm"))})?.disabled === false ? lines.length : 0; })()`, 30);
      check(Boolean(plan), `${at} Retire opens the plan dialog, with the kernel's plan (${plan ?? 0} lines) and Confirm`, await page.evaluate(textOf(testId("oats-modal"))));
      await page.shot(`a16-${viewport.name}-plan`);
      await page.evaluate(`document.querySelector(${JSON.stringify(testId("oats-plan-cancel"))}).click()`);
      check(Boolean(await page.until(`document.querySelector(${JSON.stringify(testId("oats-modal"))}) === null`, 10)), `${at} Cancel closes the dialog`);
    },
  },
];
