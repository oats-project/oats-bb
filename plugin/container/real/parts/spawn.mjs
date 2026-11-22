// Spawn's part of the real run (parts/README.md). The scenario's own part A spawns an agent
// through the plugin's RPC; this part holds what the New agent form adds to that:
//   1. the harnesses the bb session provider declares, as the plugin reads them for the form and
//      for the Start and Restart dialogs (`oats capabilities show oats.bb --json`);
//   2. the refusals the form words, as the real kernel prints them: a name that is taken (at the
//      preview), a decision that moved (at the apply), and a harness the provider declares that
//      this container cannot launch (pi, when it is not installed here);
//   3. one agent spawned THROUGH THE FORM, in a browser: the page opened from the sidebar's New
//      agent under the release's default pages, a soul chosen, the preview read, Spawn pressed,
//      the new agent's thread opened; with the images of the form in both themes at both widths.
// What the kernel printed for the plugin's own calls is kept as the feature's fixtures.
import { fill, showSidebar, testId, textOf, visible } from "../../browser.mjs";
import { choose } from "../../scenes/spawn.mjs";

const SOUL = "oats-developer";
const NAME = "form-spawned-developer";
const TASK = "Say hello, then wait.";

export default async (run) => {
  const { step, check, note, show, act, recorded, refused, fixtures, rowOf, until, rpc, views, bb } = run;

  step("Spawn: the harnesses the bb session provider declares, read through the plugin");
  const list = act("the provider's harnesses", "spawnHarnesses", null);
  const call = recorded(["capabilities", "show"]);
  check(JSON.stringify(call.argv) === JSON.stringify(["capabilities", "show", "oats.bb", "--json"]), "the plugin asked the kernel for the bb capability as the deployment resolves it, and nothing else", JSON.stringify(call.argv));
  const declared = JSON.parse(call.stdout).result?.sessionProviders?.bb?.harnesses;
  check(Array.isArray(declared) && declared.length > 0 && JSON.stringify(list?.harnesses) === JSON.stringify(declared), "the plugin's list is the one the provider's manifest declares, in its order", JSON.stringify({ plugin: list?.harnesses, kernel: declared }));
  check(typeof list?.hostId === "string" && list.hostId !== "", "with the bb machine that holds the deployment, where bb's own model list is asked", JSON.stringify(list?.hostId));
  fixtures.keep("spawn/capabilities-show-bb.json", call.stdout);

  step("Spawn: a preview with no name and no instruction (what the empty form asks)");
  const unnamed = act("the preview of an empty form", "spawnPreview", { soul: SOUL, task: "" });
  const unnamedCall = recorded(["spawn", SOUL], ["--preview"]);
  check(JSON.stringify(unnamedCall.argv) === JSON.stringify(["spawn", SOUL, "--backend", "bb", "--yolo", "--preview", "--json"]), "the plugin passed nothing a person did not choose: no --name, no task file, no --harness, no --model, no relation", JSON.stringify(unnamedCall.argv));
  check(unnamed?.facts.identity[0]?.text === "numbered by the kernel" && typeof unnamed?.revision === "string", "the kernel decides it, and the facts say the kernel numbers the agent", JSON.stringify(unnamed?.facts.identity));
  fixtures.keep("spawn/spawn-preview-unnamed.json", unnamedCall.stdout);

  step("Spawn: the refusals the form words, as the kernel prints them");
  const taken = [...run.status().rows.keys()][0];
  const nameTaken = refused("a preview with a name that is taken", "E_INSTANCE_NAME_TAKEN", "spawnPreview", { soul: SOUL, name: taken, task: "" }, ["spawn", SOUL], ["--preview"]);
  if (nameTaken !== undefined) fixtures.keep("spawn/spawn-preview-name-taken.json", nameTaken.record.stdout);
  // A decision the kernel does not hold (a revision of its shape that it never answered): what a
  // person meets when something moved between the preview they saw and their press.
  const stale = refused("a spawn whose decision moved", "E_DECISION_STALE", "spawn", { soul: SOUL, name: "form-stale-developer", task: "", key: "spawn-form-stale-1", revision: "0".repeat(24) }, ["spawn", SOUL], ["--expect-decision"]);
  if (stale !== undefined) fixtures.keep("spawn/spawn-decision-stale.json", stale.record.stdout);
  check(rowOf("form-stale-developer") === undefined, "and nothing was created");

  // The provider declares pi; whether THIS container can launch it is the kernel's to say.
  let piSpawned = false;
  if (Array.isArray(declared) && declared.includes("pi")) {
    step("Spawn: harness pi, as the provider declares it");
    const pi = rpc("spawnPreview", { soul: SOUL, task: "", harness: "pi" });
    const piCall = recorded(["spawn", SOUL], ["--harness"]);
    check(piCall.argv[piCall.argv.indexOf("--harness") + 1] === "pi" && piCall.argv.includes("--preview"), "picking a listed harness passes --harness <id> on the preview", JSON.stringify(piCall.argv));
    if (pi.ok) {
      fixtures.keep("spawn/spawn-preview-pi.json", piCall.stdout);
      const spawned = act("spawn with harness pi", "spawn", { soul: SOUL, name: "form-pi-developer", task: "", harness: "pi", key: "spawn-form-pi-1" });
      const row = spawned === undefined ? undefined : await until("the pi agent's row", () => rowOf("form-pi-developer"), 60);
      check(row?.backend === "bb" && row?.harness === "pi", "the kernel has the agent on bb, on pi", JSON.stringify(row && { backend: row.backend, harness: row.harness }));
      piSpawned = row?.harness === "pi";
    } else {
      let kernel;
      try {
        kernel = JSON.parse(piCall.stdout).error;
      } catch {
        kernel = undefined;
      }
      show("the kernel's refusal", pi.message);
      check(kernel !== undefined && pi.message.endsWith(`${kernel.code}: ${kernel.message}`), `this container cannot launch pi, and the plugin shows the kernel's refusal unchanged (${kernel?.code})`, pi.message);
      if (kernel !== undefined) fixtures.keep("spawn/spawn-preview-pi-refused.json", piCall.stdout);
      note("NO SPAWN WITH HARNESS pi IN THIS RUN: the container has no pi the kernel can launch; the refusal above is what the form shows");
    }
  }

  step("Spawn: one agent through the form, from the sidebar's New agent under the release's default pages");
  // The release's default: only the home is a page. New agent must still be there (the second UX read's S1).
  const ALL = "home, automations, souls, capabilities, teams, machines";
  bb("plugin", "config", "oats", "set", "pages", "home");
  let spawnedBy = null;
  try {
    await views("real-form", async ({ page, at, viewport, shot }) => {
      await page.goto("/");
      check(await showSidebar(page, viewport), `${at} the thread list is the OATS sidebar`);
      const button = await page.until(`${visible(testId("oats-new-agent"))} && !document.querySelector('[data-testid^="oats-page-link-"]')`, 30);
      check(Boolean(button), `${at} under the default pages the sidebar has New agent, and no page link`, await page.evaluate(textOf(testId("oats-sidebar"))));
      await page.evaluate(`document.querySelector(${JSON.stringify(testId("oats-new-agent"))}).click()`);
      // The form's own page, its first field the soul, with nothing chosen.
      const first = await page.until(`(() => { const f = document.querySelector(${JSON.stringify(testId("oats-spawn-form"))}); const c = f?.querySelector("select, textarea, input"); return c && c.options.length > 1 ? JSON.stringify({ path: location.pathname, first: c.getAttribute("data-testid"), title: document.querySelector(${JSON.stringify(testId("oats-spawn-title"))})?.innerText, off: document.querySelector(${JSON.stringify(testId("oats-disabled-reason"))})?.innerText }) : ""; })()`, 30);
      check(first === JSON.stringify({ path: "/plugins/oats/new-agent", first: "oats-spawn-soul", title: "New agent", off: "Choose a soul first." }), `${at} New agent opens the form's page: the soul field first, and Spawn off with its reason`, first ?? (await page.evaluate("document.body.innerText.slice(0, 300)")));
      await shot("empty");
      // A soul, an instruction and a name: the kernel's preview of exactly these.
      await page.evaluate(choose(testId("oats-spawn-soul"), SOUL));
      await page.evaluate(fill(testId("oats-spawn-task"), TASK));
      const name = spawnedBy === null ? NAME : `${NAME}-${viewport.name}`;
      await page.evaluate(fill(testId("oats-spawn-name"), name));
      const read = await page.until(`(() => { const c = document.querySelector(${JSON.stringify(testId("oats-spawn-preview"))}); const name = c?.querySelector("dd")?.innerText; return name === ${JSON.stringify(name)} && !c.querySelector(${JSON.stringify(testId("oats-spawn-updating"))}) && document.querySelector(${JSON.stringify(testId("oats-spawn-submit"))}).disabled === false ? c.innerText.replace(/\\s+/g, " ") : ""; })()`, 60);
      check(Boolean(read) && /Name .*Home .*Works in .*Harness Claude Code · /.test(read ?? "") && /Resolved by the installed CLI/.test(read ?? ""), `${at} What will be created: the name, the home, where it works, the harness and the model, from the kernel's preview of these values`, read ?? (await page.evaluate(textOf(testId("oats-new-agent-page")))));
      await page.evaluate(`document.querySelector(${JSON.stringify(testId("oats-spawn-submit"))}).scrollIntoView({ block: "center" })`);
      await shot("filled");
      if (spawnedBy !== null) return;
      // Spawn, once, in the first view: the new agent's thread opens.
      spawnedBy = at;
      await page.evaluate(`document.querySelector(${JSON.stringify(testId("oats-spawn-submit"))}).click()`);
      const opened = await page.until(`/\\/threads\\/thr_/.test(location.pathname) ? location.pathname : ""`, 180);
      const row = rowOf(NAME);
      check(Boolean(opened) && row?.backend === "bb" && typeof row?.session?.threadId === "string" && String(opened).endsWith(row.session.threadId), `${at} Spawn created ${NAME} on bb and opened its thread`, JSON.stringify({ opened, row: row && { backend: row.backend, thread: row.session?.threadId }, page: await page.evaluate(textOf(testId("oats-new-agent-page"))) }));
    });
  } finally {
    bb("plugin", "config", "oats", "set", "pages", ALL);
  }
  const apply = recorded(["spawn", SOUL], ["--idempotency-key", NAME]);
  const preview = recorded(["spawn", SOUL], ["--preview", NAME]);
  const previewed = JSON.parse(preview.stdout).result;
  check(apply.argv.includes("--yolo") && apply.argv[apply.argv.indexOf("--expect-decision") + 1] === previewed.decision.revision, "the form's spawn asked for bb's full mode and applied the decision its preview showed", JSON.stringify(apply.argv));
  check(!apply.argv.includes("--harness") && !apply.argv.includes("--model") && !apply.argv.includes("--relation"), "with the soul's default harness, the default model and no relation, none was passed", JSON.stringify(apply.argv));
  show("the harness list in this run", { declared, piSpawned });
};
