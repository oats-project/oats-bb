// Spawn's live scenes: the New agent form on a soul's page.
import { fill, testId, textOf, visible } from "../browser.mjs";

export default [
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
];
