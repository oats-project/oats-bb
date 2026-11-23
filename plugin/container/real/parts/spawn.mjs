// Spawn's part of the real run (parts/README.md). The scenario's own part A spawns an agent
// through the plugin's RPC; this part holds what the New agent form adds to that:
//   1. the harnesses the bb session provider declares, as the plugin reads them for the form and
//      for the Start and Restart dialogs (`oats capabilities show oats.bb --json`);
//   2. the refusals the form words, as the real kernel prints them: a name that is taken (at the
//      preview), a decision that moved (at the apply), and a spawn on a harness the provider
//      declares that bb cannot launch in this container (pi, when bb has no pi provider here);
//   3. the previews the live scenes answer, as the kernel prints them (named; a child of an agent);
//   4. THE FORM, in a browser, from the sidebar's New agent under the release's default pages. In
//      every view (both themes, both widths) the same state: the empty form; filled as a child of
//      an agent, with what will be created read; a spawn the kernel refuses (harness pi, where bb
//      has not installed it). Then one agent spawned through the form with Mod+Enter, once, and
//      its thread, the same in every view.
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
  const unnamed = act("the preview of an empty form", "spawnPlan", { soul: SOUL, task: "" });
  const unnamedCall = recorded(["spawn", SOUL], ["--preview"]);
  check(JSON.stringify(unnamedCall.argv) === JSON.stringify(["spawn", SOUL, "--backend", "bb", "--yolo", "--preview", "--json"]), "the plugin passed nothing a person did not choose: no --name, no task file, no --harness, no --model, no relation", JSON.stringify(unnamedCall.argv));
  check(unnamed?.facts.identity[0]?.text === "numbered by the kernel" && typeof unnamed?.revision === "string", "the kernel decides it, and the facts say the kernel numbers the agent", JSON.stringify(unnamed?.facts.identity));
  fixtures.keep("spawn/spawn-preview-unnamed.json", unnamedCall.stdout);

  step("Spawn: the refusals the form words, as the kernel prints them");
  const taken = [...run.status().rows.keys()][0];
  const nameTaken = refused("a preview with a name that is taken", "E_INSTANCE_NAME_TAKEN", "spawnPlan", { soul: SOUL, name: taken, task: "" }, ["spawn", SOUL], ["--preview"]);
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
    const PI = { soul: SOUL, name: "form-pi-developer", task: "", harness: "pi" };
    const pi = rpc("spawnPlan", PI);
    const piCall = recorded(["spawn", SOUL], ["--harness"]);
    check(piCall.argv[piCall.argv.indexOf("--harness") + 1] === "pi" && piCall.argv.includes("--preview"), "picking a listed harness passes --harness <id> on the preview", JSON.stringify(piCall.argv));
    // The kernel decides a spawn on pi and then asks the provider whether bb can launch it here.
    const spawned = pi.ok ? rpc("spawn", { ...PI, key: "spawn-form-pi-1", revision: pi.value.revision }) : pi;
    if (spawned.ok) {
      const row = await until("the pi agent's row", () => rowOf("form-pi-developer"), 60);
      check(row?.backend === "bb" && row?.harness === "pi", "the kernel has the agent on bb, on pi", JSON.stringify(row && { backend: row.backend, harness: row.harness }));
      piSpawned = row?.harness === "pi";
    } else {
      const refusedCall = recorded(["spawn", SOUL], pi.ok ? ["--harness", "--idempotency-key"] : ["--harness"]);
      let kernel;
      try {
        kernel = JSON.parse(refusedCall.stdout).error;
      } catch {
        kernel = undefined;
      }
      show("the kernel's refusal", spawned.message);
      // Only the provider's own "not ready" is this case: any other refusal (a decision that moved, a busy kernel) fails the run.
      check(kernel?.code === "E_BACKEND_NOT_READY" || kernel?.code === "E_HARNESS_UNAVAILABLE" || kernel?.code === "E_BACKEND_HARNESS", `the refusal is the kernel's or the provider's word that pi cannot be launched here (${kernel?.code})`, spawned.message);
      check(kernel !== undefined && spawned.message.endsWith(`${kernel.code}: ${kernel.message}`), `this container cannot launch pi (${pi.ok ? "refused at the spawn" : "refused at the preview"}), and the plugin shows the kernel's refusal unchanged (${kernel?.code})`, spawned.message);
      check(rowOf("form-pi-developer") === undefined || rowOf("form-pi-developer")?.running !== true, "and no pi agent runs");
      if (kernel !== undefined) fixtures.keep("spawn/spawn-pi-refused.json", refusedCall.stdout);
      note("NO SPAWN WITH HARNESS pi IN THIS RUN: bb in this container has no pi provider it can launch; the refusal above is what the form shows");
    }
  }

  step("Spawn: the previews the form's live scenes answer, as the kernel prints them: a named one, and one with a relation");
  const ANCHOR = rowOf("harvest-knowledge-helper") !== undefined ? "harvest-knowledge-helper" : taken;
  const named = act("the preview of a named form", "spawnPlan", { soul: SOUL, name: NAME, task: TASK });
  const namedCall = recorded(["spawn", SOUL], ["--preview", NAME]);
  check(named?.facts.identity[0]?.text === NAME && !named.facts.facts.some((fact) => fact.label === "Relationship") && named.facts.warnings.length === 0, "named as asked, independent (no Relationship row), and with no warning: the kernel gives none", JSON.stringify(named?.facts));
  const rows = (facts) => Object.fromEntries((facts?.facts ?? []).map((fact) => [fact.label, fact.parts.map((part) => part.text).join("")]));
  check(rows(named?.facts).Soul === SOUL && rows(named?.facts).Session === "bb thread" && rows(named?.facts).Access === "full mode: no sandbox" && typeof rows(named?.facts)["Works in"] === "string" && "Team" in rows(named?.facts), "the facts say the soul, where it works, the team, that the session is a bb thread and the access the kernel decided (full mode), each from the kernel's answer", JSON.stringify(rows(named?.facts)));
  fixtures.keep("spawn/spawn-preview-named.json", namedCall.stdout);
  const child = act("the preview of a child of an agent", "spawnPlan", { soul: SOUL, name: NAME, task: TASK, relation: { kind: "child", to: ANCHOR } });
  const childCall = recorded(["spawn", SOUL], ["--preview", "--relation"]);
  const anchorHome = rowOf(ANCHOR)?.home ?? "";
  const at = childCall.argv.indexOf("--relation");
  check(JSON.stringify(childCall.argv.slice(at, at + 6)) === JSON.stringify(["--relation", "child", "--relative-to", ANCHOR, "--relative-root", anchorHome.split("/").slice(0, -3).join("/")]), "the relation is passed as --relation child --relative-to <anchor> --relative-root <the agents root of the anchor's home>", JSON.stringify(childCall.argv));
  check(rows(child?.facts).Relationship === `child of ${ANCHOR}`, "and the kernel's answer says who it is started under: the Relationship row is read from it", JSON.stringify(rows(child?.facts)));
  fixtures.keep("spawn/spawn-preview-child.json", childCall.stdout);
  // A preview the kernel refuses for another reason than the name, if it has one for a model nobody has: kept for the live scene of that state.
  const noModel = rpc("spawnPlan", { soul: SOUL, task: "", model: "no-such-provider/no-such-model" });
  if (noModel.ok) note("the kernel's preview takes a model id nobody has (it decides, and the harness refuses at the launch): no refused preview was recorded for it");
  else {
    const refusedCall = recorded(["spawn", SOUL], ["--preview", "--model"]);
    show("the kernel's refusal of a model nobody has", noModel.message);
    fixtures.keep("spawn/spawn-preview-model-refused.json", refusedCall.stdout);
  }

  step("Spawn: through the form, from the sidebar's New agent under the release's default pages: one state in every view");
  // The release's default: only the home is a page. New agent must still be there (the second UX read's S1).
  const ALL = "home, automations, souls, capabilities, teams, machines";
  const q = (id) => JSON.stringify(testId(id));
  const pi = Array.isArray(declared) && declared.includes("pi");
  const fillForm = async (page, at) => {
    check(await page.evaluate(choose("oats-spawn-soul", SOUL)), `${at} the soul is chosen from the souls OATS lists`, await page.evaluate(textOf(testId("oats-spawn-form"))));
    await page.evaluate(fill(testId("oats-spawn-task"), TASK));
    await page.evaluate(`[...document.querySelectorAll(${JSON.stringify(`${testId("oats-spawn-relation")} [role="radio"]`)})].find((e) => e.innerText.trim() === "Child of").click()`);
    check(await page.evaluate(choose("oats-spawn-relative", ANCHOR)), `${at} Child of, and the instance picked from the roster`, await page.evaluate(textOf(testId("oats-spawn-relation"))));
    await page.evaluate(fill(testId("oats-spawn-name"), NAME));
    // What will be created, read for exactly these values: only then can Spawn be pressed.
    return page.until(`(() => { const c = document.querySelector(${q("oats-spawn-preview")}); return c?.querySelector("dd")?.innerText === ${JSON.stringify(NAME)} && !c.querySelector(${q("oats-spawn-updating")}) && document.querySelector(${q("oats-spawn-submit")}).disabled === false ? c.innerText.replace(/\\s+/g, " ") : ""; })()`, 60);
  };
  bb("plugin", "config", "oats", "set", "pages", "home");
  try {
    // Pass 1: nothing is created, so every view shows the same state.
    await views("real-form", async ({ page, at, viewport, shot }) => {
      await page.goto("/");
      check(await showSidebar(page, viewport), `${at} the thread list is the OATS sidebar`);
      const button = await page.until(`${visible(testId("oats-new-agent"))} && !document.querySelector('[data-testid^="oats-page-link-"]')`, 30);
      check(Boolean(button), `${at} under the default pages the sidebar has New agent, and no page link`, await page.evaluate(textOf(testId("oats-sidebar"))));
      await page.evaluate(`document.querySelector(${q("oats-new-agent")}).click()`);
      // The form's own page, its first field the soul, with nothing chosen.
      const first = await page.until(`(() => { const f = document.querySelector(${q("oats-spawn-form")}); const c = f?.querySelector("button, select, textarea, input"); return c && c.disabled === false && document.querySelector(${q("oats-spawn-harness")})?.disabled !== true ? JSON.stringify({ path: location.pathname, first: c.getAttribute("data-testid"), title: document.querySelector(${q("oats-spawn-title")})?.innerText, off: document.querySelector(${q("oats-disabled-reason")})?.innerText }) : ""; })()`, 30);
      check(first === JSON.stringify({ path: "/plugins/oats/new-agent", first: "oats-spawn-soul", title: "New agent", off: "Choose a soul first." }), `${at} New agent opens the form's page: the soul field first, and Spawn off with its reason`, first ?? (await page.evaluate("document.body.innerText.slice(0, 300)")));
      await shot("empty");
      const read = await fillForm(page, at);
      check(Boolean(read) && new RegExp(`Name ${NAME} Home .*Soul ${SOUL} Works in .*Runs on .*Harness Claude Code · .*Session bb thread Access full mode: no sandbox Team .*Relationship child of Harvest knowledge helper`).test(read ?? "") && /Resolved by the installed CLI/.test(read ?? ""), `${at} What will be created, from the kernel's preview of these values: the name, the home, the soul, where it works and on which machine, the harness and the model, a bb thread in full mode, the team, and whose child it is`, read ?? (await page.evaluate(textOf(testId("oats-new-agent-page")))));
      await page.evaluate(`document.querySelector(${q("oats-spawn-task")}).scrollIntoView({ block: "center" })`);
      await shot("filled");
      // On a phone the column is under the fields: its own image, down to the buttons. (On a wide page it is beside them, in the image above.)
      if (viewport.mobile) {
        await page.evaluate(`document.querySelector(${q("oats-spawn-submit")}).scrollIntoView({ block: "end" })`);
        await shot("preview");
      }
      if (!pi) return;
      // A refusal, the real one: harness pi, which bb here has not installed. The form says it at the choice, and the kernel refuses the spawn.
      check(await page.evaluate(choose("oats-spawn-harness", "pi")), `${at} harness pi is picked`, await page.evaluate(textOf(testId("oats-spawn-form"))));
      const marked = await page.until(`/not installed in bb/.test(document.querySelector(${q("oats-spawn-harness")}).innerText) && /bb has not installed pi on this machine/.test(document.querySelector(${q("oats-spawn-form")}).innerText)`, 30);
      check(Boolean(marked), `${at} the choice marks pi as not installed in bb, and the field says what to do, from bb's own state of its providers`, await page.evaluate(textOf(testId("oats-spawn-form"))));
      // OATS 0.70.0 decides the preview and refuses at the spawn; from 0.70.1 the preview asks the provider's own check and refuses there.
      const how = await page.until(`document.querySelector(${q("oats-spawn-submit")}).disabled === false && /Harness pi · /.test(document.querySelector(${q("oats-spawn-preview")}).innerText.replace(/\\s+/g, " ")) ? "decided" : document.querySelector(${q("oats-spawn-preview")} + " " + ${q("oats-notice")} + '[data-tone="error"]') ? "refused" : ""`, 60);
      if (how === "refused") {
        const said = await page.evaluate(`JSON.stringify({ words: document.querySelector(${q("oats-spawn-preview")} + " " + ${q("oats-notice")} + '[data-tone="error"]').innerText.replace(/\\s+/g, " "), off: document.querySelector(${q("oats-spawn-submit")}).disabled, reason: ${textOf(testId("oats-disabled-reason"))} })`);
        check(/^\{"words":"This can’t be spawned as it is bb isn’t ready to launch this agent as chosen\. Details says what bb needs; or pick another harness above\. .*E_BACKEND_NOT_READY.*","off":true,"reason":"OATS refused these values: “What will be created” says why\."\}$/.test(said), `${at} the PREVIEW on pi is refused (this kernel asks the provider at the preview): a person's words, the kernel's code, Details and Retry where the facts would be, and Spawn off for that reason`, said);
      } else {
        check(how === "decided", `${at} the preview on pi answers (this kernel asks the provider only at the spawn)`, await page.evaluate(textOf(testId("oats-new-agent-page"))));
        await page.evaluate(`document.querySelector(${q("oats-spawn-submit")}).click()`);
        const refusedText = await page.until(`(() => { const r = document.querySelector(${q("oats-spawn-foot")} + " " + ${q("oats-result")}); return r && r.getAttribute("data-tone") === "failed" ? r.innerText.replace(/\\s+/g, " ") : ""; })()`, 180);
        check(/^The agent was not spawned bb isn’t ready to launch this agent, so the spawn was rolled back\. Nothing was created\. Details says what bb needs\. .*E_BACKEND_NOT_READY$/.test(refusedText ?? ""), `${at} the spawn on pi is refused: a person's words, Details, then the kernel's code; the form and its values stay`, refusedText ?? (await page.evaluate(textOf(testId("oats-new-agent-page")))));
      }
      check(rowOf(NAME) === undefined, `${at} and nothing was created`);
      await page.evaluate(`(document.querySelector(${q("oats-spawn-foot")} + " " + ${q("oats-result")}) ?? document.querySelector(${q("oats-spawn-preview")} + " " + ${q("oats-notice")} + '[data-tone="error"]')).scrollIntoView({ block: "center" })`);
      await shot("refused");
    });
    // Pass 2: the spawn, once, in the first view; every other view shows the same created agent's thread.
    let opened = null;
    await views("real-form", async ({ page, at, shot }) => {
      if (opened === null) {
        await page.goto("/plugins/oats/new-agent");
        await page.until(`document.querySelector(${q("oats-spawn-soul")})?.disabled === false`, 30);
        await fillForm(page, at);
        // Mod+Enter, from the instruction: the form's key for Spawn (sent as the page's own key event).
        await page.evaluate(`(() => { const t = document.querySelector(${q("oats-spawn-task")}); t.focus(); t.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", ctrlKey: true, bubbles: true, cancelable: true })); })()`);
        const held = await page.until(`document.querySelector(${q("oats-spawn-submit")})?.innerText.trim() === "Spawning…" && document.querySelector(${q("oats-spawn-submit")}).disabled && document.querySelector(${q("oats-spawn-form")} + " fieldset").disabled`, 10);
        check(Boolean(held), `${at} on the press Spawn reads "Spawning…" and is held, with the fields`, await page.evaluate(textOf(testId("oats-spawn-foot"))).catch(() => "the page had already moved on"));
        opened = (await page.until(`/\\/threads\\/thr_/.test(location.pathname) ? location.pathname : ""`, 180)) ?? "";
        const row = rowOf(NAME);
        check(opened !== "" && row?.backend === "bb" && typeof row?.session?.threadId === "string" && opened.endsWith(row.session.threadId) && row.parentInstance === ANCHOR, `${at} Ctrl+Enter spawned ${NAME} on bb, as a child of ${ANCHOR}, and opened its thread`, JSON.stringify({ opened, row: row && { backend: row.backend, thread: row.session?.threadId, parent: row.parentInstance } }));
      } else {
        await page.goto(opened);
      }
      const there = await page.until(`/\\/threads\\/thr_/.test(location.pathname) && ${visible(testId("oats-identity-row"))} && ${textOf(testId("oats-identity-row"))}`, 60);
      check(Boolean(there), `${at} the created agent's thread, with the plugin's own row for it`, String(there));
      await shot("created");
    });
  } finally {
    bb("plugin", "config", "oats", "set", "pages", ALL);
  }
  const applies = run.records().filter((record) => record.argv[0] === "spawn" && record.argv.includes(NAME) && record.argv.includes("--idempotency-key") && !record.argv.includes("--harness"));
  check(applies.length === 1, `one press made one spawn of ${NAME}: the kernel was asked to apply once`, JSON.stringify(applies.map((record) => record.argv)));
  const apply = applies[0];
  const preview = run.records().filter((record) => record.argv[0] === "spawn" && record.argv.includes(NAME) && record.argv.includes("--preview") && record.argv.includes("--relation") && !record.argv.includes("--harness")).at(-1);
  const previewed = preview === undefined ? undefined : JSON.parse(preview.stdout).result;
  check(apply !== undefined && apply.argv.includes("--yolo") && apply.argv[apply.argv.indexOf("--expect-decision") + 1] === previewed?.decision.revision, "the form's spawn asked for bb's full mode and applied the decision its preview showed", JSON.stringify(apply?.argv));
  check(apply !== undefined && !apply.argv.includes("--harness") && !apply.argv.includes("--model") && apply.argv.includes("--relation"), "with the soul's default harness and the default model, neither was passed; the relation was", JSON.stringify(apply?.argv));
  show("the harness list in this run", { declared, piSpawned });
};
